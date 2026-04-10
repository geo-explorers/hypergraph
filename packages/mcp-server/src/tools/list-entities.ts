import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SpacesConfig } from '../config.js';
import {
  buildBacklinksFilter,
  buildNameFilter,
  buildPropertyFilter,
  buildRelationFilter,
  combineFilters,
} from '../filter-builder.js';
import { formatEntityList, formatEntityListCompact } from '../formatters/entities.js';
import { resolveSpace } from '../fuzzy.js';
import {
  fetchAllTypeIds,
  fetchEntitiesConnection,
  fetchNameMaps,
  resolvePropertyIdByName,
  resolveTypeIdByName,
} from '../graphql-client.js';

export const registerListEntitiesTool = (server: McpServer, config: SpacesConfig): void => {
  server.registerTool(
    'list_entities',
    {
      title: 'List Entities',
      description:
        'List all entities of a specific type. Omit space (recommended) to list across ALL spaces at once — the same type name (e.g., "Bounty") often exists in multiple spaces and you\'d miss results by specifying one. Provide space only to narrow when you\'re sure all entities are in one space. Use filters to narrow by property values (e.g., {"property":"Bounty Budget","operator":"eq","value":"1000"}). Space and type names are fuzzy-matched. Returns up to 50 results by default — use limit/offset for large sets. Use compact=true for token-efficient output on large result sets.',
      inputSchema: {
        space: z
          .string()
          .optional()
          .describe(
            'Only provide this when the user explicitly names a space to restrict to. Do NOT guess a space from the type name or topic. Omitting this (the default) lists across all spaces.',
          ),
        type: z.string().describe('Entity type name to filter by (e.g., "Event", "Person", "Organization")'),
        limit: z.number().optional().describe('Optional: max results (default: 50). Use offset for pagination.'),
        offset: z.number().optional().describe('Optional: number of results to skip (for pagination)'),
        filters: z
          .array(
            z.object({
              property: z
                .string()
                .describe('Property name to filter on (fuzzy-matched, e.g. "publish_date", "efficacy")'),
              operator: z
                .enum(['eq', 'contains', 'gt', 'gte', 'lt', 'lte', 'exists', 'not_exists'])
                .describe('eq=equals, contains=substring, gt/gte/lt/lte=comparison, exists/not_exists=presence check'),
              value: z.string().optional().describe('Value to compare against (omit for exists/not_exists)'),
            }),
          )
          .optional()
          .describe('Filter entities by property values. All filters are ANDed.'),
        sort_by: z.string().optional().describe('Property name to sort results by (fuzzy-matched)'),
        sort_order: z.enum(['asc', 'desc']).optional().describe('Sort direction (default: asc)'),
        related_to: z
          .object({
            entity: z
              .string()
              .describe('Name of the entity to filter by relation (case-insensitive substring match on entity names)'),
            relation_type: z
              .string()
              .optional()
              .describe('Optional: relation type to filter on (fuzzy-matched property name)'),
            direction: z
              .enum(['outgoing', 'incoming'])
              .optional()
              .describe(
                'Direction of relation. "outgoing" (default): result entity points TO the named entity. "incoming": named entity points TO the result entity.',
              ),
          })
          .optional()
          .describe(
            'Filter results by their graph relation to a named entity. Example: to find articles published by Cointelegraph, use related_to: { entity: "Cointelegraph", direction: "outgoing" }',
          ),
        compact: z
          .boolean()
          .optional()
          .describe(
            'Optional: return results as a compact table (Name, Type, ID) instead of full entity cards. Recommended for large result sets.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ space, type, limit, offset, filters, sort_by, sort_order, related_to, compact }) => {
      const DEFAULT_LIMIT = 50;

      try {
        let resolvedSpaceId: string | undefined;
        let spaceName: string;
        const allSpaceIds = config.spaces.map((s) => s.id);

        if (space !== undefined) {
          const resolved = resolveSpace(space, config.spaces);
          if (!resolved) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Space "${space}" not found. Available spaces: ${config.spaces.map((s) => s.name).join(', ')}`,
                },
              ],
              isError: true,
            };
          }
          resolvedSpaceId = resolved.id;
          spaceName = resolved.name;
        } else {
          resolvedSpaceId = undefined;
          spaceName = 'all spaces';
        }

        // Resolve type name to type IDs
        const targetSpaceIds = resolvedSpaceId ? [resolvedSpaceId] : allSpaceIds;
        const matchedTypes = await resolveTypeIdByName(config.endpoint, type, targetSpaceIds);

        if (matchedTypes.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Type "${type}" not found in ${spaceName}. Try get_entity_types to see available types.`,
              },
            ],
            isError: true,
          };
        }

        const typeIds = [...new Set(matchedTypes.map((t) => t.id))];
        const typeName = matchedTypes[0].name;
        const warnings: string[] = [];

        // Build GraphQL filter from property filters
        const graphqlFilters: Record<string, unknown>[] = [];

        if (filters?.length) {
          const propertyResolutions = await Promise.all(
            filters.map((f) => resolvePropertyIdByName(config.endpoint, f.property, targetSpaceIds)),
          );

          for (let i = 0; i < filters.length; i++) {
            const resolved = propertyResolutions[i];
            if (resolved.length === 0) {
              warnings.push(`Filter property '${filters[i].property}' not found — filter skipped`);
              continue;
            }
            graphqlFilters.push(buildPropertyFilter(resolved[0].id, filters[i].operator, filters[i].value));
          }
        }

        // Handle related_to filter
        if (related_to) {
          // API crashes with name filter without typeIds, so fetch all type IDs first
          const relTypeIds = await fetchAllTypeIds(config.endpoint, targetSpaceIds);
          const targetResults = await fetchEntitiesConnection(config.endpoint, {
            typeIds: relTypeIds,
            filter: buildNameFilter(related_to.entity),
            first: 5,
          });

          if (targetResults.entities.length === 0) {
            warnings.push(`No entities found matching "${related_to.entity}" for relation filter`);
          } else {
            const targetId = targetResults.entities[0].id;
            let relationTypeId: string | undefined;

            if (related_to.relation_type) {
              const resolvedRelType = await resolvePropertyIdByName(
                config.endpoint,
                related_to.relation_type,
                targetSpaceIds,
              );
              if (resolvedRelType.length > 0) {
                relationTypeId = resolvedRelType[0].id;
              } else {
                warnings.push(`Relation type "${related_to.relation_type}" not found — filtering by entity only`);
              }
            }

            const direction = related_to.direction ?? 'outgoing';
            if (direction === 'outgoing') {
              graphqlFilters.push(buildRelationFilter(targetId, relationTypeId));
            } else {
              graphqlFilters.push(buildBacklinksFilter(targetId, relationTypeId));
            }
          }
        }

        const combinedFilter = combineFilters(graphqlFilters);
        const effectiveLimit = limit ?? DEFAULT_LIMIT;
        const activeFilter = Object.keys(combinedFilter).length > 0 ? combinedFilter : undefined;

        // Query entities with all filters applied at API level
        const queryFn = resolvedSpaceId
          ? () =>
              fetchEntitiesConnection(config.endpoint, {
                typeIds,
                spaceId: resolvedSpaceId,
                filter: activeFilter,
                first: effectiveLimit,
                offset: offset ?? 0,
              })
          : async () => {
              // Cross-space: query each space in parallel and combine
              const results = await Promise.all(
                allSpaceIds.map((sid) =>
                  fetchEntitiesConnection(config.endpoint, {
                    typeIds,
                    spaceId: sid,
                    filter: activeFilter,
                    first: effectiveLimit + (offset ?? 0),
                  }),
                ),
              );
              const allEntities = results.flatMap((r) => r.entities);
              const totalCount = results.reduce((sum, r) => sum + r.totalCount, 0);
              const start = offset ?? 0;
              return {
                totalCount,
                entities: allEntities.slice(start, start + effectiveLimit),
              };
            };

        const { totalCount, entities } = await queryFn();

        // Fetch name maps for display
        const names = await fetchNameMaps(config.endpoint, targetSpaceIds);

        if (entities.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No ${typeName} entities found in ${spaceName}.`,
              },
            ],
          };
        }

        const mainOptions = {
          spaceName,
          typeName,
          total: totalCount,
          limit: effectiveLimit,
          ...(offset !== undefined && { offset }),
          ...(resolvedSpaceId === undefined && { crossSpace: true }),
          names,
        };

        let text = compact
          ? formatEntityListCompact(entities, mainOptions)
          : formatEntityList(entities, {
              ...mainOptions,
              ...(filters?.length && { filters }),
              ...(sort_by !== undefined && { sortBy: sort_by, sortOrder: sort_order }),
            });

        if (warnings.length > 0) {
          text = `> Warning: ${warnings.join('\n> Warning: ')}\n\n${text}`;
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to list entities: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
};
