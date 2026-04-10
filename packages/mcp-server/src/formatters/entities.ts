import type { GeoEntity, NameMaps } from '../graphql-client.js';

type GeoValue = GeoEntity['valuesList'][number];

export const extractPropertyValue = (value: GeoValue): string | null => {
  if (value.text !== null && value.text !== undefined) return value.text;
  if (value.float !== null && value.float !== undefined) return String(value.float);
  if (value.boolean !== null && value.boolean !== undefined) return String(value.boolean);
  if (value.datetime !== null && value.datetime !== undefined) return value.datetime;
  if (value.point !== null && value.point !== undefined) return JSON.stringify(value.point);
  if (value.schedule !== null && value.schedule !== undefined) return JSON.stringify(value.schedule);
  return null;
};

const TRUNCATION_LIMIT = 500;

const truncateValue = (value: string): string => {
  if (value.length <= TRUNCATION_LIMIT) return value;
  const total = value.length;
  return `${value.slice(0, TRUNCATION_LIMIT)}... (truncated, ${total.toLocaleString()} chars total)`;
};

const buildGeoUrl = (spaceId: string, entityId: string): string =>
  `https://www.geobrowser.io/space/${spaceId}/${entityId}`;

const resolveTypeName = (id: string, names?: NameMaps): string => names?.typeNames.get(id) ?? id;

const resolvePropertyName = (id: string, names?: NameMaps): string => names?.propertyNames.get(id) ?? id;

export const formatEntity = (
  entity: GeoEntity,
  options?: {
    showSpace?: boolean | undefined;
    spaceName?: string | undefined;
    spaceId?: string | undefined;
    skipEmpty?: boolean | undefined;
    names?: NameMaps | undefined;
  },
): string => {
  const lines: string[] = [];
  const names = options?.names;

  // Header
  lines.push(`### ${entity.name ?? '(unnamed)'}`);

  // Type names
  const typeNames = entity.typeIds.map((id) => resolveTypeName(id, names));
  lines.push(`**Type:** ${typeNames.length > 0 ? typeNames.join(', ') : '(untyped)'}`);
  lines.push(`**ID:** ${entity.id}`);

  if (options?.showSpace && options.spaceName) {
    lines.push(`**Space:** ${options.spaceName}`);
  }

  // Geo URL
  if (options?.spaceId) {
    lines.push(`**URL:** ${buildGeoUrl(options.spaceId, entity.id)}`);
  }

  lines.push('');

  // Properties section
  lines.push('**Properties:**');

  const values = entity.valuesList;
  if (values.length === 0 && !options?.skipEmpty) {
    lines.push('- (none)');
  }

  for (const value of values) {
    const propName = resolvePropertyName(value.propertyId, names);
    const extracted = extractPropertyValue(value);
    if (extracted === null) {
      if (!options?.skipEmpty) lines.push(`- ${propName}: (empty)`);
      continue;
    }
    lines.push(`- ${propName}: ${truncateValue(extracted)}`);
  }

  // Relations section
  const relations = entity.relationsList;
  if (relations.length > 0) {
    lines.push('');
    lines.push('**Relations:**');
    for (const relation of relations) {
      const relName = resolvePropertyName(relation.typeId, names);
      const targetName = relation.toEntity.name ?? relation.toEntity.id;
      lines.push(`- ${relName}: ${targetName}`);
    }
  }

  return lines.join('\n');
};

export type RelatedEntityInfo = {
  entity: GeoEntity;
  relationTypeName: string;
  direction: 'outgoing' | 'incoming';
  spaceName?: string;
  spaceId?: string;
};

export const formatEntityList = (
  entities: GeoEntity[],
  options: {
    spaceName: string;
    typeName?: string;
    total: number;
    limit?: number;
    offset?: number;
    filters?: Array<{ property: string; operator: string; value?: string | undefined }>;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc' | undefined;
    crossSpace?: boolean;
    fallbackNote?: string;
    spaceResolver?: (entity: GeoEntity) => { name: string; id: string } | undefined;
    names?: NameMaps | undefined;
  },
): string => {
  const lines: string[] = [];

  if (options.fallbackNote) {
    lines.push(`> ${options.fallbackNote}`);
    lines.push('');
  }

  if (options.typeName) {
    lines.push(
      options.crossSpace
        ? `## ${options.typeName} entities across all spaces`
        : `## ${options.typeName} entities in ${options.spaceName}`,
    );
  } else {
    lines.push(
      options.crossSpace ? '## Search results across all spaces' : `## Search results in ${options.spaceName}`,
    );
  }

  if (options.filters?.length) {
    const filterStr = options.filters
      .map((f) => (f.value !== undefined ? `${f.property} ${f.operator} ${f.value}` : `${f.property} ${f.operator}`))
      .join(' | ');
    lines.push(`**Filters:** ${filterStr}`);
  }
  if (options.sortBy) {
    lines.push(`**Sorted by:** ${options.sortBy} ${options.sortOrder ?? 'asc'}`);
  }

  if (options.limit !== undefined) {
    lines.push(`Showing ${entities.length} of ${options.total} entities`);
  } else {
    lines.push(`Found ${options.total} entities`);
  }

  lines.push('');

  for (const entity of entities) {
    const spaceInfo = options.spaceResolver?.(entity);
    lines.push(
      formatEntity(entity, {
        showSpace: options.crossSpace,
        spaceName: spaceInfo?.name,
        spaceId: spaceInfo?.id,
        skipEmpty: true,
        names: options.names,
      }),
    );
    lines.push('');
  }

  return lines.join('\n');
};

const formatEntityTableRows = (
  entities: GeoEntity[],
  showSpace: boolean,
  spaceResolver?: (entity: GeoEntity) => { name: string; id: string } | undefined,
  names?: NameMaps,
): string => {
  const rows = entities.map((e) => {
    const name = e.name ?? '(unnamed)';
    const type = e.typeIds.map((id) => resolveTypeName(id, names)).join(', ') || '(untyped)';
    const space = showSpace ? (spaceResolver?.(e)?.name ?? '') : null;
    return space !== null ? `| ${name} | ${type} | ${space} | ${e.id} |` : `| ${name} | ${type} | ${e.id} |`;
  });
  const header = showSpace
    ? '| Name | Type | Space | ID |\n|------|------|-------|-----|'
    : '| Name | Type | ID |\n|------|------|-----|';
  return [header, ...rows].join('\n');
};

export const formatEntityListCompact = (
  entities: GeoEntity[],
  options: {
    spaceName: string;
    typeName?: string;
    total: number;
    limit?: number;
    offset?: number;
    crossSpace?: boolean;
    fallbackNote?: string;
    spaceResolver?: (entity: GeoEntity) => { name: string; id: string } | undefined;
    names?: NameMaps | undefined;
  },
): string => {
  const lines: string[] = [];

  if (options.fallbackNote) {
    lines.push(`> ${options.fallbackNote}`);
    lines.push('');
  }

  if (options.typeName) {
    lines.push(
      options.crossSpace
        ? `## ${options.typeName} entities across all spaces`
        : `## ${options.typeName} entities in ${options.spaceName}`,
    );
  } else {
    lines.push(
      options.crossSpace ? '## Search results across all spaces' : `## Search results in ${options.spaceName}`,
    );
  }

  lines.push(
    options.limit !== undefined
      ? `Showing ${entities.length} of ${options.total} entities`
      : `Found ${options.total} entities`,
  );
  lines.push('');
  lines.push(formatEntityTableRows(entities, !!options.crossSpace, options.spaceResolver, options.names));
  return lines.join('\n');
};

export const formatRelatedEntityListCompact = (
  relatedEntities: RelatedEntityInfo[],
  options: {
    sourceEntityName: string;
    direction: 'outgoing' | 'incoming' | 'both';
    relationTypeName?: string;
    total: number;
    limit?: number;
    offset?: number;
    names?: NameMaps | undefined;
  },
): string => {
  const lines: string[] = [];

  const dirLabel =
    options.direction === 'outgoing'
      ? 'outgoing from'
      : options.direction === 'incoming'
        ? 'incoming to'
        : 'related to';
  lines.push(`## Entities ${dirLabel} ${options.sourceEntityName}`);

  if (options.relationTypeName) {
    lines.push(`**Relation type filter:** ${options.relationTypeName}`);
  }

  lines.push(
    options.limit !== undefined
      ? `Showing ${relatedEntities.length} of ${options.total} related entities`
      : `Found ${options.total} related entities`,
  );
  lines.push('');

  lines.push('| Name | Type | Relation | Dir | ID |');
  lines.push('|------|------|----------|-----|-----|');
  for (const related of relatedEntities) {
    const e = related.entity;
    const name = e.name ?? '(unnamed)';
    const type = e.typeIds.map((id) => resolveTypeName(id, options.names)).join(', ') || '(untyped)';
    const arrow = related.direction === 'outgoing' ? '->' : '<-';
    lines.push(`| ${name} | ${type} | ${related.relationTypeName} | ${arrow} | ${e.id} |`);
  }

  return lines.join('\n');
};

export const formatRelatedEntityList = (
  relatedEntities: RelatedEntityInfo[],
  options: {
    sourceEntityName: string;
    direction: 'outgoing' | 'incoming' | 'both';
    relationTypeName?: string;
    total: number;
    limit?: number;
    offset?: number;
    names?: NameMaps | undefined;
  },
): string => {
  const lines: string[] = [];

  const dirLabel =
    options.direction === 'outgoing'
      ? 'outgoing from'
      : options.direction === 'incoming'
        ? 'incoming to'
        : 'related to';
  lines.push(`## Entities ${dirLabel} ${options.sourceEntityName}`);

  if (options.relationTypeName) {
    lines.push(`**Relation type filter:** ${options.relationTypeName}`);
  }

  if (options.limit !== undefined) {
    lines.push(`Showing ${relatedEntities.length} of ${options.total} related entities`);
  } else {
    lines.push(`Found ${options.total} related entities`);
  }

  lines.push('');

  for (const related of relatedEntities) {
    const arrow = related.direction === 'outgoing' ? '->' : '<-';
    lines.push(`**${arrow} ${related.relationTypeName}**`);
    lines.push(
      formatEntity(related.entity, {
        spaceName: related.spaceName,
        spaceId: related.spaceId,
        names: options.names,
      }),
    );
    lines.push('');
  }

  return lines.join('\n');
};
