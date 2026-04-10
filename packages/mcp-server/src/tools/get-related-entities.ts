import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SpacesConfig } from '../config.js';
import type { RelatedEntityInfo } from '../formatters/entities.js';
import { formatRelatedEntityList, formatRelatedEntityListCompact } from '../formatters/entities.js';
import { resolveTypes } from '../fuzzy.js';
import { fetchEntities, fetchEntity, fetchNameMaps } from '../graphql-client.js';

export const registerGetRelatedEntitiesTool = (server: McpServer, config: SpacesConfig): void => {
  server.registerTool(
    'get_related_entities',
    {
      title: 'Get Related Entities',
      description:
        'Traverse the knowledge graph from a known entity. Use direction: "incoming" to find entities that point TO the given entity (e.g., people who "Works at" a company — search for the company, then get incoming "Works at" relations). Use direction: "outgoing" to follow links FROM the entity. Omit relation_type to see all connections at once and discover available relation type names before filtering. Use compact=true for large result sets to get a token-efficient table — then call get_entity for details on specific results.',
      inputSchema: {
        entity_id: z.string().describe('The entity ID to traverse from'),
        relation_type: z
          .string()
          .optional()
          .describe('Optional: filter by relation type name (fuzzy matched, e.g., "Types", "Organizer")'),
        direction: z
          .enum(['outgoing', 'incoming', 'both'])
          .optional()
          .default('both')
          .describe(
            'Traversal direction: "outgoing" (entity -> targets), "incoming" (sources -> entity), or "both" (default)',
          ),
        limit: z.number().optional().describe('Optional: max results (default: 50). Use offset for pagination.'),
        offset: z.number().optional().describe('Optional: number of results to skip (for pagination)'),
        compact: z
          .boolean()
          .optional()
          .describe(
            'Optional: return results as a compact table instead of full entity cards. Recommended for large result sets.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ entity_id, relation_type, direction, limit, offset, compact }) => {
      const DEFAULT_LIMIT = 50;

      try {
        const allSpaceIds = config.spaces.map((s) => s.id);

        // Fetch the source entity and name maps in parallel
        const [entity, names] = await Promise.all([
          fetchEntity(config.endpoint, entity_id),
          fetchNameMaps(config.endpoint, allSpaceIds),
        ]);

        if (!entity) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Entity "${entity_id}" not found. Provide a valid entity ID from search results.`,
              },
            ],
            isError: true,
          };
        }

        const dir = direction ?? 'both';
        const results: RelatedEntityInfo[] = [];

        // Outgoing: relations FROM this entity TO targets
        if (dir === 'outgoing' || dir === 'both') {
          for (const rel of entity.relationsList) {
            const relTypeName = names.propertyNames.get(rel.typeId) ?? rel.typeId;

            // Filter by relation type name if specified
            if (relation_type) {
              const matched = resolveTypes(relation_type, [{ id: rel.typeId, name: relTypeName }]);
              if (matched.length === 0) continue;
            }

            // Fetch the target entity for full details
            const targetEntity = await fetchEntity(config.endpoint, rel.toEntity.id);
            if (targetEntity) {
              results.push({
                entity: targetEntity,
                relationTypeName: relTypeName,
                direction: 'outgoing',
              });
            }
          }
        }

        // Incoming: entities that have relations pointing TO this entity
        if (dir === 'incoming' || dir === 'both') {
          // Use relations filter to find entities with relations pointing to this entity
          const filter: Record<string, unknown> = {
            relations: {
              some: {
                toEntityId: { is: entity_id },
              },
            },
          };

          // Query each space in parallel for incoming entities
          const spaceResults = await Promise.all(
            allSpaceIds.map((sid) =>
              fetchEntities(config.endpoint, {
                spaceId: sid,
                filter,
                first: 200,
              }),
            ),
          );
          const incomingEntities = spaceResults.flat();

          for (const incoming of incomingEntities) {
            // Find matching relations from this entity to the source
            for (const rel of incoming.relationsList) {
              if (rel.toEntity.id !== entity_id) continue;

              const relTypeName = names.propertyNames.get(rel.typeId) ?? rel.typeId;

              if (relation_type) {
                const matched = resolveTypes(relation_type, [{ id: rel.typeId, name: relTypeName }]);
                if (matched.length === 0) continue;
              }

              results.push({
                entity: incoming,
                relationTypeName: relTypeName,
                direction: 'incoming',
              });
              break; // Only add this entity once
            }
          }
        }

        const start = offset ?? 0;
        const effectiveLimit = limit ?? DEFAULT_LIMIT;
        const sliced = results.slice(start, start + effectiveLimit);

        if (sliced.length === 0) {
          const entityName = entity.name ?? entity_id;

          if (relation_type) {
            // Show available relation types
            const allRelTypes = entity.relationsList.map((r) => names.propertyNames.get(r.typeId) ?? r.typeId);
            const uniqueTypes = [...new Set(allRelTypes)].sort();
            const hint =
              uniqueTypes.length > 0
                ? `\nAvailable outgoing relation types on "${entityName}": ${uniqueTypes.join(', ')}`
                : '';
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `No ${dir === 'both' ? '' : `${dir} `}related entities found for "${entityName}" with relation type "${relation_type}".${hint}`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: `No ${dir === 'both' ? '' : `${dir} `}related entities found for "${entityName}".`,
              },
            ],
          };
        }

        const formatOptions = {
          sourceEntityName: entity.name ?? entity_id,
          direction: dir,
          ...(relation_type !== undefined && { relationTypeName: relation_type }),
          total: results.length,
          limit: effectiveLimit,
          ...(offset !== undefined && { offset }),
          names,
        };

        const text = compact
          ? formatRelatedEntityListCompact(sliced, formatOptions)
          : formatRelatedEntityList(sliced, formatOptions);

        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to get related entities: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
};
