import { request } from 'graphql-request';

/** Meta-type ID for "Type" entities in the Geo knowledge graph */
export const TYPE_META_TYPE_ID = 'e7d737c536764c609fa16aa64a8c90ad';

export interface GeoEntity {
  id: string;
  name: string | null;
  typeIds: string[];
  valuesList: Array<{
    propertyId: string;
    text: string | null;
    boolean: boolean | null;
    float: number | null;
    datetime: string | null;
    point: unknown | null;
    schedule: unknown | null;
  }>;
  relationsList: Array<{
    typeId: string;
    toEntity: { id: string; name: string | null };
  }>;
}

/** Maps for resolving type/property IDs to human-readable names */
export type NameMaps = {
  typeNames: Map<string, string>;
  propertyNames: Map<string, string>;
};

const ENTITY_FIELDS = /* GraphQL */ `
  id
  name
  typeIds
  valuesList {
    propertyId
    text
    boolean
    float
    datetime
    point
    schedule
  }
  relationsList {
    typeId
    toEntity { id name }
  }
`;

const FETCH_ENTITY_QUERY = /* GraphQL */ `
  query FetchEntity($id: UUID!) {
    entity(id: $id) {
      ${ENTITY_FIELDS}
    }
  }
`;

const FETCH_ENTITIES_CONNECTION_QUERY = /* GraphQL */ `
  query FetchEntitiesConnection($typeIds: UUIDFilter, $spaceId: UUID, $filter: EntityFilter, $first: Int, $offset: Int) {
    entitiesConnection(typeIds: $typeIds, spaceId: $spaceId, filter: $filter, first: $first, offset: $offset) {
      totalCount
      nodes {
        ${ENTITY_FIELDS}
      }
    }
  }
`;

const TYPES_LIST_QUERY = /* GraphQL */ `
  query TypesList($spaceId: UUID!, $first: Int) {
    typesList(spaceId: $spaceId, first: $first) {
      id
      name
    }
  }
`;

const PROPERTIES_QUERY = /* GraphQL */ `
  query PropertiesConnection($spaceId: UUID!, $first: Int, $after: Cursor) {
    propertiesConnection(spaceId: $spaceId, first: $first, after: $after) {
      edges {
        node {
          id
          name
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export type QueryParams = {
  typeIds?: string[] | undefined;
  spaceId?: string | undefined;
  filter?: Record<string, unknown> | undefined;
  first?: number | undefined;
  offset?: number | undefined;
};

function buildVariables(params: QueryParams): Record<string, unknown> {
  const vars: Record<string, unknown> = {};
  if (params.typeIds?.length) vars.typeIds = { in: params.typeIds };
  if (params.spaceId) vars.spaceId = params.spaceId;
  if (params.filter && Object.keys(params.filter).length > 0) vars.filter = params.filter;
  if (params.first !== undefined) vars.first = params.first;
  if (params.offset !== undefined) vars.offset = params.offset;
  return vars;
}

/** Fetch a single entity by ID */
export async function fetchEntity(endpoint: string, id: string): Promise<GeoEntity | null> {
  const result = await request<{ entity: GeoEntity | null }>(`${endpoint}/graphql`, FETCH_ENTITY_QUERY, { id });
  return result.entity;
}

/** Fetch a flat list of entities (uses entitiesConnection internally) */
export async function fetchEntities(endpoint: string, params: QueryParams): Promise<GeoEntity[]> {
  const result = await request<{
    entitiesConnection: {
      nodes: GeoEntity[];
    };
  }>(`${endpoint}/graphql`, FETCH_ENTITIES_CONNECTION_QUERY, buildVariables(params));
  return result.entitiesConnection.nodes;
}

/** Fetch entities with totalCount for pagination info */
export async function fetchEntitiesConnection(
  endpoint: string,
  params: QueryParams,
): Promise<{ totalCount: number; entities: GeoEntity[] }> {
  const result = await request<{
    entitiesConnection: {
      totalCount: number;
      nodes: GeoEntity[];
    };
  }>(`${endpoint}/graphql`, FETCH_ENTITIES_CONNECTION_QUERY, buildVariables(params));
  return {
    totalCount: result.entitiesConnection.totalCount,
    entities: result.entitiesConnection.nodes,
  };
}

/** Fetch type and property name maps for resolving IDs to human-readable names */
export async function fetchNameMaps(endpoint: string, spaceIds: string[]): Promise<NameMaps> {
  const [typeResults, propertyResults] = await Promise.all([
    Promise.all(
      spaceIds.map((spaceId) =>
        request<{ typesList: Array<{ id: string; name: string | null }> | null }>(
          `${endpoint}/graphql`,
          TYPES_LIST_QUERY,
          { spaceId, first: 1000 },
        ).then((r) => r.typesList ?? []),
      ),
    ),
    Promise.all(
      spaceIds.map((spaceId) =>
        request<{
          propertiesConnection: {
            edges: Array<{ node: { id: string; name: string | null } }>;
          };
        }>(`${endpoint}/graphql`, PROPERTIES_QUERY, { spaceId, first: 1000 }).then((r) =>
          r.propertiesConnection.edges.map((e) => e.node),
        ),
      ),
    ),
  ]);

  const typeNames = new Map<string, string>();
  for (const t of typeResults.flat()) {
    if (t.name) typeNames.set(t.id, t.name);
  }

  const propertyNames = new Map<string, string>();
  for (const p of propertyResults.flat()) {
    if (p.name) propertyNames.set(p.id, p.name);
  }

  return { typeNames, propertyNames };
}

/** Fetch all type IDs for the given spaces (needed because name filter crashes without typeIds) */
export async function fetchAllTypeIds(endpoint: string, spaceIds: string[]): Promise<string[]> {
  const results = await Promise.all(
    spaceIds.map((spaceId) =>
      request<{ typesList: Array<{ id: string }> | null }>(`${endpoint}/graphql`, TYPES_LIST_QUERY, {
        spaceId,
        first: 1000,
      }).then((r) => r.typesList ?? []),
    ),
  );
  return [...new Set(results.flat().map((t) => t.id))];
}

/** Resolve a type name to type IDs by querying typesList for the given spaces */
export async function resolveTypeIdByName(
  endpoint: string,
  name: string,
  spaceIds: string[],
): Promise<Array<{ id: string; name: string }>> {
  const results = await Promise.all(
    spaceIds.map((spaceId) =>
      request<{ typesList: Array<{ id: string; name: string | null }> | null }>(
        `${endpoint}/graphql`,
        TYPES_LIST_QUERY,
        { spaceId, first: 1000 },
      ).then((r) => r.typesList ?? []),
    ),
  );

  const allTypes = results.flat().filter((t): t is { id: string; name: string } => t.name !== null);

  return fuzzyMatchByName(name, allTypes);
}

/** Resolve a property name to property IDs by querying propertiesConnection */
export async function resolvePropertyIdByName(
  endpoint: string,
  name: string,
  spaceIds: string[],
): Promise<Array<{ id: string; name: string }>> {
  const results = await Promise.all(
    spaceIds.map((spaceId) =>
      request<{
        propertiesConnection: {
          edges: Array<{ node: { id: string; name: string | null } }>;
        };
      }>(`${endpoint}/graphql`, PROPERTIES_QUERY, { spaceId, first: 1000 }).then((r) =>
        r.propertiesConnection.edges.map((e) => e.node),
      ),
    ),
  );

  const allProps = results.flat().filter((p): p is { id: string; name: string } => p.name !== null);

  return fuzzyMatchByName(name, allProps);
}

function fuzzyMatchByName<T extends { id: string; name: string }>(input: string, items: T[]): T[] {
  const lower = input.toLowerCase().replace(/_/g, ' ');
  const dedup = (arr: T[]) => {
    const seen = new Set<string>();
    return arr.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  };

  const norm = (s: string) => s.toLowerCase().replace(/_/g, ' ');

  const exact = items.filter((t) => norm(t.name) === lower);
  if (exact.length > 0) return dedup(exact);

  const prefix = items.filter((t) => norm(t.name).startsWith(lower));
  if (prefix.length > 0) return dedup(prefix);

  const includes = items.filter((t) => norm(t.name).includes(lower));
  return dedup(includes);
}
