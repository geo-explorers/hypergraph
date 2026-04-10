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

export const registerSearchEntitiesTool = (server: McpServer, config: SpacesConfig): void => {
  server.registerTool(
    'search_entities',
    {
      title: 'Search Entities',
      description:
        'Search for entities by name across all knowledge graph spaces. Note: this tool matches entity names, not their content or relations. To find entities related to another entity (e.g., "articles published by Cointelegraph"), use the related_to parameter instead of putting the publisher name in query. For location/relation queries ("Events in Paris", "articles by Cointelegraph"): call `get_entity_types` first to see what relations an entity type has (e.g., Event has `location -> City`), then use `related_to` — e.g., `related_to: {entity: "Paris", relation_type: "location", direction: "outgoing"}` with `type: "Event"`. Do NOT put "Paris" in the `query` field. Omit "space" (almost always correct) to search all spaces at once — entity topics often don\'t match space names (e.g., a company named "Geo" is in the "Crypto" space). Only pass "space" if the user explicitly asks to restrict to a specific space. Use filters for property-based searches (e.g., Bounty Budget = 1000) rather than fetching all entities and filtering manually. Space and type names are fuzzy-matched. Results are limited to 50 by default — use limit/offset to paginate. Use compact=true for large result sets to get a token-efficient table — then call get_entity for details on specific results.',
      inputSchema: {
        space: z
          .string()
          .optional()
          .describe(
            'Only provide this when the user explicitly names a space to restrict to. Do NOT guess a space from the entity type or topic. Omitting this (the default) searches all spaces.',
          ),
        query: z.string().describe('Search term to match against entity names (case-insensitive substring match)'),
        type: z.string().optional().describe('Optional: filter by entity type name (e.g., "Event", "Person")'),
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
    async ({ space, query, type, limit, offset, filters, sort_by, sort_order, related_to, compact }) => {
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

        const targetSpaceIds = resolvedSpaceId ? [resolvedSpaceId] : allSpaceIds;
        const warnings: string[] = [];

        // Resolve type, property, and relation IDs in parallel where possible
        // Note: API crashes with INTERNAL_SERVER_ERROR when using name filter without typeIds,
        // so we always need to fetch type IDs even when no type filter is specified.
        const [matchedTypes, allTypeIds, propertyResolutions, relatedToResolution] = await Promise.all([
          // Resolve type name
          type ? resolveTypeIdByName(config.endpoint, type, targetSpaceIds) : Promise.resolve(undefined),

          // Fetch all type IDs (needed when no type filter — API requires typeIds with name filter)
          !type ? fetchAllTypeIds(config.endpoint, targetSpaceIds) : Promise.resolve(undefined),

          // Resolve property filter names
          filters?.length
            ? Promise.all(filters.map((f) => resolvePropertyIdByName(config.endpoint, f.property, targetSpaceIds)))
            : Promise.resolve(undefined),

          // Resolve related_to entity — needs typeIds to avoid API crash
          related_to
            ? fetchAllTypeIds(config.endpoint, targetSpaceIds).then((relTypeIds) =>
                fetchEntitiesConnection(config.endpoint, {
                  typeIds: relTypeIds,
                  filter: buildNameFilter(related_to.entity),
                  first: 5,
                }),
              )
            : Promise.resolve(undefined),
        ]);

        // Process type resolution
        let typeIds: string[] | undefined;
        let typeName: string | undefined;

        if (type && matchedTypes) {
          if (matchedTypes.length === 0) {
            // Don't error — just warn and skip type filter
            warnings.push(`Type "${type}" not found — searching across all types`);
            // Still need all type IDs for the name filter
            typeIds = await fetchAllTypeIds(config.endpoint, targetSpaceIds);
          } else {
            typeIds = [...new Set(matchedTypes.map((t) => t.id))];
            typeName = matchedTypes[0].name;
          }
        } else if (allTypeIds) {
          typeIds = allTypeIds;
        }

        // Build GraphQL filters
        const graphqlFilters: Record<string, unknown>[] = [];

        // Name search filter
        graphqlFilters.push(buildNameFilter(query));

        // Property value filters
        if (filters?.length && propertyResolutions) {
          for (let i = 0; i < filters.length; i++) {
            const resolved = propertyResolutions[i];
            if (resolved.length === 0) {
              warnings.push(`Filter property '${filters[i].property}' not found — filter skipped`);
              continue;
            }
            graphqlFilters.push(buildPropertyFilter(resolved[0].id, filters[i].operator, filters[i].value));
          }
        }

        // Relation filter
        if (related_to && relatedToResolution) {
          if (relatedToResolution.entities.length === 0) {
            warnings.push(`No entities found matching "${related_to.entity}" for relation filter`);
          } else {
            const targetId = relatedToResolution.entities[0].id;
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

        // Execute query
        const queryEntities = async () => {
          if (resolvedSpaceId) {
            return fetchEntitiesConnection(config.endpoint, {
              typeIds,
              spaceId: resolvedSpaceId,
              filter: activeFilter,
              first: effectiveLimit,
              offset: offset ?? 0,
            });
          }

          // Cross-space: query each space in parallel
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

        let { totalCount, entities } = await queryEntities();

        // Auto-fallback: if a specific space was requested but returned no results,
        // try all spaces
        if (entities.length === 0 && resolvedSpaceId && !related_to) {
          const fallbackResults = await Promise.all(
            allSpaceIds.map((sid) =>
              fetchEntitiesConnection(config.endpoint, {
                typeIds,
                spaceId: sid,
                filter: activeFilter,
                first: effectiveLimit + (offset ?? 0),
              }),
            ),
          );

          const fallbackEntities = fallbackResults.flatMap((r) => r.entities);
          const fallbackTotal = fallbackResults.reduce((sum, r) => sum + r.totalCount, 0);

          if (fallbackEntities.length > 0) {
            const start = offset ?? 0;
            entities = fallbackEntities.slice(start, start + effectiveLimit);
            totalCount = fallbackTotal;

            // Fetch name maps for display
            const names = await fetchNameMaps(config.endpoint, allSpaceIds);

            const mainOptions = {
              spaceName: 'all spaces',
              ...(typeName !== undefined && { typeName }),
              total: totalCount,
              limit: effectiveLimit,
              ...(offset !== undefined && { offset }),
              crossSpace: true,
              fallbackNote: `No results found in "${spaceName}". Showing results from all spaces:`,
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
          }
        }

        if (entities.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No entities found matching "${query}" in ${spaceName}.`,
              },
            ],
          };
        }

        // Fetch name maps for display
        const names = await fetchNameMaps(config.endpoint, targetSpaceIds);

        const mainOptions = {
          spaceName,
          ...(typeName !== undefined && { typeName }),
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
              text: `Failed to search entities: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
};
