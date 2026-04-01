import { request } from 'graphql-request';

export const TYPES_LIST_QUERY = /* GraphQL */ `
  query TypesList($spaceId: UUID!, $first: Int) {
    typesList(spaceId: $spaceId, first: $first) {
      id
      name
    }
  }
`;

export const PROPERTIES_CONNECTION_QUERY = /* GraphQL */ `
  query PropertiesConnection($spaceId: UUID!, $first: Int, $after: Cursor) {
    propertiesConnection(spaceId: $spaceId, first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          name
          dataTypeName
        }
      }
    }
  }
`;

export const ENTITIES_CONNECTION_QUERY = /* GraphQL */ `
  query EntitiesConnection($spaceId: UUID!, $first: Int, $after: Cursor) {
    entitiesConnection(spaceId: $spaceId, first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          name
          typeIds
          valuesList(filter: { spaceId: { is: $spaceId } }) {
            propertyId
            text
            boolean
            float
            datetime
            point
            schedule
          }
          relationsList(filter: { spaceId: { is: $spaceId } }) {
            typeId
            toEntity {
              id
              name
            }
          }
        }
      }
    }
  }
`;

export type TypesListResult = {
  typesList: Array<{
    id: string;
    name: string | null;
  }> | null;
};

export type PropertyNode = {
  id: string;
  name: string | null;
  dataTypeName: string | null;
};

export type PropertiesConnectionResult = {
  propertiesConnection: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: PropertyNode }>;
  };
};

export type EntityNode = {
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
    toEntity: {
      id: string;
      name: string | null;
    };
  }>;
};

export type EntitiesConnectionResult = {
  entitiesConnection: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: EntityNode }>;
  };
};

// Keep old types for backward compat with store.ts
export type PropertiesResult = {
  properties: PropertyNode[];
};

export type EntitiesResult = {
  entities: EntityNode[];
};

export const fetchTypes = async (endpoint: string, spaceId: string): Promise<TypesListResult['typesList']> => {
  const result = await request<TypesListResult>(`${endpoint}/graphql`, TYPES_LIST_QUERY, {
    spaceId,
    first: 1000,
  });
  return result.typesList ?? [];
};

export const fetchPropertiesPage = async (
  endpoint: string,
  spaceId: string,
  first: number,
  after: string | null,
): Promise<PropertiesConnectionResult['propertiesConnection']> => {
  const result = await request<PropertiesConnectionResult>(`${endpoint}/graphql`, PROPERTIES_CONNECTION_QUERY, {
    spaceId,
    first,
    after,
  });
  return result.propertiesConnection;
};

export const fetchEntitiesPage = async (
  endpoint: string,
  spaceId: string,
  first: number,
  after: string | null,
): Promise<EntitiesConnectionResult['entitiesConnection']> => {
  const result = await request<EntitiesConnectionResult>(`${endpoint}/graphql`, ENTITIES_CONNECTION_QUERY, {
    spaceId,
    first,
    after,
  });
  return result.entitiesConnection;
};
