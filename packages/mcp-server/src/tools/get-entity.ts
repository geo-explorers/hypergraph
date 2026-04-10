import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SpacesConfig } from '../config.js';
import { formatEntity } from '../formatters/entities.js';
import { fetchEntity, fetchNameMaps } from '../graphql-client.js';

export const registerGetEntityTool = (server: McpServer, config: SpacesConfig): void => {
  server.registerTool(
    'get_entity',
    {
      title: 'Get Entity',
      description:
        'Get full details for a single entity by its ID. Returns all properties (with human-readable labels), outgoing relations, and type information. Use this after finding an entity via search_entities, list_entities, or get_related_entities to inspect its complete data.',
      inputSchema: {
        id: z.string().describe('The entity ID to look up (from search or list results)'),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      try {
        const allSpaceIds = config.spaces.map((s) => s.id);
        const [entity, names] = await Promise.all([
          fetchEntity(config.endpoint, id),
          fetchNameMaps(config.endpoint, allSpaceIds),
        ]);

        if (!entity) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Entity "${id}" not found. Provide a valid entity ID from search results.`,
              },
            ],
            isError: true,
          };
        }

        const text = formatEntity(entity, { names });
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to fetch entity "${id}": ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
};
