import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SpacesConfig } from '../config.js';
import { extractTypeSchema, formatAllSpacesTypesList, formatTypesList } from '../formatters/types.js';
import { resolveSpace } from '../fuzzy.js';
import { fetchEntities, fetchNameMaps, TYPE_META_TYPE_ID } from '../graphql-client.js';

export const registerGetEntityTypesTool = (server: McpServer, config: SpacesConfig): void => {
  server.registerTool(
    'get_entity_types',
    {
      title: 'Get Entity Types',
      description:
        'List all entity types with their property schemas and relation types. Omit space (recommended — do this first) to see ALL types across ALL spaces at once. The same type name (e.g., "Bounty") can exist in multiple spaces — you must query without a space to discover all of them. The Relations column shows what graph links each type has (e.g., "location -> City") — call this before using `related_to` in `search_entities` or `list_entities` to discover the right relation type and direction. Space name is fuzzy-matched.',
      inputSchema: {
        space: z
          .string()
          .optional()
          .describe(
            'Name of the knowledge graph space to browse types in (e.g., "AI"). Omit to get types from all spaces at once — recommended unless you already know which space to look in.',
          ),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ space }) => {
      try {
        if (!space) {
          // Query Type meta-entities and name maps from all spaces in parallel
          const allSpaceIds = config.spaces.map((s) => s.id);
          const [spaceResults, names] = await Promise.all([
            Promise.all(
              config.spaces.map(async (s) => {
                const typeEntities = await fetchEntities(config.endpoint, {
                  typeIds: [TYPE_META_TYPE_ID],
                  spaceId: s.id,
                  first: 200,
                });
                return { name: s.name, typeEntities };
              }),
            ),
            fetchNameMaps(config.endpoint, allSpaceIds),
          ]);

          const spacesWithTypes = spaceResults.map((s) => ({
            name: s.name,
            types: s.typeEntities.map((e) => extractTypeSchema(e, names)),
          }));
          const text = formatAllSpacesTypesList(spacesWithTypes);
          return { content: [{ type: 'text' as const, text }] };
        }

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

        const [typeEntities, names] = await Promise.all([
          fetchEntities(config.endpoint, {
            typeIds: [TYPE_META_TYPE_ID],
            spaceId: resolved.id,
            first: 200,
          }),
          fetchNameMaps(config.endpoint, [resolved.id]),
        ]);
        const types = typeEntities.map((e) => extractTypeSchema(e, names));
        const text = formatTypesList(types, resolved.name);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to fetch entity types: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
};
