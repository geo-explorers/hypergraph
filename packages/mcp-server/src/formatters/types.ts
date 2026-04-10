import type { GeoEntity, NameMaps } from '../graphql-client.js';

export type TypeWithSchema = {
  id: string;
  name: string;
  properties: string[];
  relations: Array<{ name: string; targetTypeName?: string }>;
};

/** Extract type schema from Type meta-entities (their relations point to properties/relation types) */
export function extractTypeSchema(typeEntity: GeoEntity, names?: NameMaps): TypeWithSchema {
  const properties: string[] = [];
  const relations: Array<{ name: string; targetTypeName?: string }> = [];

  for (const rel of typeEntity.relationsList) {
    const relTypeName = names?.propertyNames.get(rel.typeId) ?? rel.typeId;
    const targetName = rel.toEntity.name ?? rel.toEntity.id;

    // Relations whose type is "Properties" or similar point to property definitions
    // Relations whose type is "Relations" point to relation type definitions
    // We use the target entity name as the property/relation name
    if (relTypeName.toLowerCase().includes('propert')) {
      properties.push(targetName);
    } else if (relTypeName.toLowerCase().includes('relation')) {
      relations.push({ name: targetName });
    } else {
      // Other relations — include as relations
      relations.push({ name: relTypeName, targetTypeName: targetName });
    }
  }

  return {
    id: typeEntity.id,
    name: typeEntity.name ?? typeEntity.id,
    properties,
    relations,
  };
}

export const formatTypesList = (types: TypeWithSchema[], spaceName: string): string => {
  if (types.length === 0) {
    return `## Entity Types in ${spaceName}\n\nNo entity types found.`;
  }

  // Deduplicate by name, merge properties/relations
  const byName = new Map<
    string,
    {
      ids: string[];
      properties: Set<string>;
      relations: Map<string, string | undefined>;
    }
  >();

  for (const t of types) {
    let entry = byName.get(t.name);
    if (!entry) {
      entry = { ids: [], properties: new Set(), relations: new Map() };
      byName.set(t.name, entry);
    }
    entry.ids.push(t.id);
    for (const p of t.properties) {
      entry.properties.add(p);
    }
    for (const r of t.relations) {
      entry.relations.set(r.name, r.targetTypeName);
    }
  }

  const header = '| Type | IDs | Properties | Relations |\n|------|-----|------------|-----------|';
  const rows = [...byName.entries()].map(([name, entry]) => {
    const ids = entry.ids.join(', ');
    const propNames = entry.properties.size > 0 ? [...entry.properties].join(', ') : '(none)';
    const relNames =
      entry.relations.size > 0
        ? [...entry.relations.entries()].map(([rName, target]) => (target ? `${rName} -> ${target}` : rName)).join(', ')
        : '(none)';
    return `| ${name} | ${ids} | ${propNames} | ${relNames} |`;
  });
  return `## Entity Types in ${spaceName}\n\n${header}\n${rows.join('\n')}`;
};

export const formatAllSpacesTypesList = (spaces: Array<{ name: string; types: TypeWithSchema[] }>): string => {
  const sections = spaces.filter((s) => s.types.length > 0).map((s) => formatTypesList(s.types, s.name));

  if (sections.length === 0) {
    return '## Entity Types across all spaces\n\nNo entity types found.';
  }

  return `## Entity Types across all spaces\n\n${sections.join('\n\n')}`;
};
