import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SpacesConfig } from '../config.js';
import { formatSpacesList } from '../formatters/spaces.js';

export const registerListSpacesTool = (server: McpServer, config: SpacesConfig): void => {
  server.registerTool(
    'list_spaces',
    {
      title: 'List Spaces',
      description:
        'List all available knowledge graph spaces. Use this only when the user explicitly asks about spaces, or when you need to enumerate available data sources. To find entities, use search_entities directly — omitting the space parameter searches all spaces at once.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const note =
        '> **Note:** Spaces organize the data source, not the topic. An entity named "Geo" may live in the "Crypto" space. Use search_entities without a space parameter to find entities across all spaces.\n' +
        '> **Warning:** Do NOT pick a space from this list to narrow your search — you will miss entities in other spaces. Only pass `space` if the user explicitly asks to restrict to a specific space.\n\n';
      const text = note + formatSpacesList(config.spaces);
      return { content: [{ type: 'text' as const, text }] };
    },
  );
};
