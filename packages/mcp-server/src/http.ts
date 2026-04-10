import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { Effect } from 'effect';
import express from 'express';
import { loadConfig } from './config.js';
import { ConfigError } from './errors.js';
import { registerTools } from './register-tools.js';

const startup = Effect.gen(function* () {
  const config = yield* loadConfig();

  yield* Effect.logInfo(`Configured with ${config.spaces.length} spaces (dynamic queries, no prefetch)`);

  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    const server = new McpServer(
      {
        name: 'hypergraph-mcp',
        version: '0.1.0',
        description:
          'Read-only access to Geo Protocol knowledge graphs — browse spaces, search entities, inspect properties and relations, and traverse the graph.',
      },
      {
        instructions: [
          'Hypergraph MCP provides read-only access to Geo Protocol knowledge graphs.',
          'Each knowledge graph is organized into spaces (e.g., "AI", "Crypto"), which contain typed entities (e.g., Event, Person, Organization) with properties and relations between them.',
          '',
          'IMPORTANT: The same entity type (e.g., "Bounty", "Project") often exists in MULTIPLE spaces. Never assume a type is only in one space.',
          '',
          'Recommended workflow:',
          '1. get_entity_types — omit space to see ALL types across ALL spaces at once.',
          '2. search_entities or list_entities — omit space to search/list across all spaces.',
          '3. get_entity — get full details for a specific entity by ID.',
          '4. get_related_entities — traverse the graph from an entity.',
          '',
          'All name inputs (spaces, types, relation types) support fuzzy matching.',
          'When no limit is specified, results default to 50. Use limit and offset for pagination.',
        ].join('\n'),
      },
    );
    registerTools(server, config);

    // Stateless mode: omit sessionIdGenerator entirely (exactOptionalPropertyTypes)
    const transport = new StreamableHTTPServerTransport({});

    res.on('close', () => {
      transport.close();
      server.close();
    });

    // SDK Transport type vs StreamableHTTPServerTransport mismatch under exactOptionalPropertyTypes
    await server.connect(transport as unknown as Transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/mcp', (_req, res) => {
    res.status(405).json({ error: 'Method Not Allowed. Use POST for MCP requests.' });
  });

  app.delete('/mcp', (_req, res) => {
    res.status(405).json({ error: 'Method Not Allowed. Sessions are not supported in stateless mode.' });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const port = Number(process.env.PORT) || 3000;

  yield* Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve) => {
        app.listen(port, '0.0.0.0', () => resolve());
      }),
    catch: (cause) => new Error(`Failed to start HTTP server: ${cause}`),
  });

  yield* Effect.logInfo(`HTTP server listening on 0.0.0.0:${port}`);
});

const main = startup.pipe(
  Effect.catchAll((error) => {
    let message: string;

    if (error instanceof ConfigError) {
      message = `Configuration error: ${error.message}`;
    } else {
      message = `Server failed to start: ${String(error)}`;
    }

    return Effect.logError(message).pipe(Effect.andThen(Effect.die(error)));
  }),
);

Effect.runPromise(main).catch(() => process.exit(1));
