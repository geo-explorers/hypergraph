import { Duration, Effect } from 'effect';
import type { SpacesConfig } from './config.js';
import { PrefetchError } from './errors.js';
import type { EntityNode, PropertyNode, TypesListResult } from './graphql-client.js';
import { fetchEntitiesPage, fetchPropertiesPage, fetchTypes } from './graphql-client.js';

export type PrefetchedType = {
  id: string;
  name: string | null;
};

export type PrefetchedProperty = PropertyNode;

export type PrefetchedEntity = EntityNode;

export type PrefetchedSpace = {
  spaceName: string;
  spaceId: string;
  types: PrefetchedType[];
  properties: PrefetchedProperty[];
  entities: PrefetchedEntity[];
};

const PAGE_SIZE = 1000;

const fetchAllEntities = async (endpoint: string, spaceId: string): Promise<PrefetchedEntity[]> => {
  const all: PrefetchedEntity[] = [];
  let after: string | null = null;

  while (true) {
    const page = await fetchEntitiesPage(endpoint, spaceId, PAGE_SIZE, after);
    for (const edge of page.edges) {
      all.push(edge.node);
    }

    if (!page.pageInfo.hasNextPage) {
      break;
    }

    after = page.pageInfo.endCursor;
  }

  return all;
};

const fetchAllProperties = async (endpoint: string, spaceId: string): Promise<PrefetchedProperty[]> => {
  const all: PrefetchedProperty[] = [];
  let after: string | null = null;

  while (true) {
    const page = await fetchPropertiesPage(endpoint, spaceId, PAGE_SIZE, after);
    for (const edge of page.edges) {
      all.push(edge.node);
    }

    if (!page.pageInfo.hasNextPage) {
      break;
    }

    after = page.pageInfo.endCursor;
  }

  return all;
};

const mapTypes = (rawTypes: TypesListResult['typesList']): PrefetchedType[] => {
  const types = rawTypes ?? [];
  return types.map((t) => ({
    id: t.id,
    name: t.name,
  }));
};

const prefetchSpace = (
  spaceId: string,
  spaceName: string,
  endpoint: string,
): Effect.Effect<PrefetchedSpace, PrefetchError> =>
  Effect.tryPromise({
    try: async () => {
      const [rawTypes, properties, entities] = await Promise.all([
        fetchTypes(endpoint, spaceId),
        fetchAllProperties(endpoint, spaceId),
        fetchAllEntities(endpoint, spaceId),
      ]);
      return {
        spaceName,
        spaceId,
        types: mapTypes(rawTypes),
        properties,
        entities,
      };
    },
    catch: (cause) => new PrefetchError({ space: spaceName, cause }),
  });

export const prefetchAll = (config: SpacesConfig): Effect.Effect<PrefetchedSpace[], PrefetchError> =>
  Effect.forEach(config.spaces, (space) => prefetchSpace(space.id, space.name, config.endpoint), {
    concurrency: 'unbounded',
  }).pipe(
    Effect.timeout(Duration.minutes(5)),
    Effect.catchTag('TimeoutException', () =>
      Effect.fail(
        new PrefetchError({
          space: 'all',
          cause: 'Prefetch exceeded 5-minute timeout',
        }),
      ),
    ),
  );
