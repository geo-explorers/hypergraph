/**
 * Translates MCP tool filter parameters to GraphQL filter objects
 * compatible with the Geo API's EntityFilter type.
 */

export type PropertyFilter = {
  property: string;
  operator: 'eq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'not_exists';
  value?: string | undefined;
};

type GraphQLFilter = Record<string, unknown>;

/** Build a property value filter given a resolved property ID, operator, and value */
export function buildPropertyFilter(
  propertyId: string,
  operator: PropertyFilter['operator'],
  value?: string,
): GraphQLFilter {
  const base = { propertyId: { is: propertyId } };

  if (operator === 'exists') {
    return { values: { some: base } };
  }
  if (operator === 'not_exists') {
    return { not: { values: { some: base } } };
  }

  if (value === undefined) return {};

  switch (operator) {
    case 'eq': {
      const num = Number(value);
      if (!Number.isNaN(num) && value.trim() !== '') {
        return { values: { some: { ...base, float: { is: num } } } };
      }
      return { values: { some: { ...base, text: { is: value } } } };
    }
    case 'contains':
      return { values: { some: { ...base, text: { includes: value } } } };
    case 'gt': {
      const num = Number(value);
      if (!Number.isNaN(num) && value.trim() !== '') {
        return { values: { some: { ...base, float: { greaterThan: num } } } };
      }
      // Treat as string/date comparison — not directly supported by API, skip
      return {};
    }
    case 'gte': {
      // API doesn't have greaterThanOrEqualTo, approximate with greaterThan
      const num = Number(value);
      if (!Number.isNaN(num) && value.trim() !== '') {
        return { values: { some: { ...base, float: { greaterThan: num - 1 } } } };
      }
      return {};
    }
    case 'lt': {
      const num = Number(value);
      if (!Number.isNaN(num) && value.trim() !== '') {
        return { values: { some: { ...base, float: { lessThan: num } } } };
      }
      return {};
    }
    case 'lte': {
      // API doesn't have lessThanOrEqualTo, approximate with lessThan
      const num = Number(value);
      if (!Number.isNaN(num) && value.trim() !== '') {
        return { values: { some: { ...base, float: { lessThan: num + 1 } } } };
      }
      return {};
    }
    default:
      return {};
  }
}

/** Build a name search filter */
export function buildNameFilter(query: string): GraphQLFilter {
  return { name: { includesInsensitive: query } };
}

/** Build a relation filter (outgoing: entity has relation TO target) */
export function buildRelationFilter(toEntityId: string, relationTypeId?: string): GraphQLFilter {
  const some: Record<string, unknown> = { toEntityId: { is: toEntityId } };
  if (relationTypeId) {
    some.typeId = { is: relationTypeId };
  }
  return { relations: { some } };
}

/** Build a backlinks filter (incoming: some entity has relation TO this entity) */
export function buildBacklinksFilter(toEntityId: string, relationTypeId?: string): GraphQLFilter {
  const some: Record<string, unknown> = { toEntityId: { is: toEntityId } };
  if (relationTypeId) {
    some.typeId = { is: relationTypeId };
  }
  return { backlinks: { some } };
}

/** Combine multiple filters with AND */
export function combineFilters(filters: GraphQLFilter[]): GraphQLFilter {
  const nonEmpty = filters.filter((f) => Object.keys(f).length > 0);
  if (nonEmpty.length === 0) return {};
  if (nonEmpty.length === 1) return nonEmpty[0];
  return { and: nonEmpty };
}
