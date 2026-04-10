import type { SpaceConfig } from './config.js';

export type TypeInfo = { id: string; name: string };

export const normalize = (input: string): string =>
  input
    .toLowerCase()
    .replace(/\b(the|space|one|program)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();

export const resolveSpace = (input: string, spaces: SpaceConfig[]): SpaceConfig | undefined => {
  const normalized = normalize(input);
  if (normalized === '') return undefined;

  return (
    spaces.find((s) => normalize(s.name) === normalized) ??
    spaces.find((s) => normalize(s.name).startsWith(normalized)) ??
    spaces.find((s) => normalize(s.name).includes(normalized)) ??
    spaces.find((s) => normalized.includes(normalize(s.name)))
  );
};

export const resolveTypes = <T extends TypeInfo>(name: string, types: T[]): T[] => {
  const lower = name.toLowerCase();

  const exact = types.filter((t) => t.name.toLowerCase() === lower);
  if (exact.length > 0) return exact;

  const starts = types.filter((t) => t.name.toLowerCase().startsWith(lower));
  if (starts.length > 0) return starts;

  const includes = types.filter((t) => t.name.toLowerCase().includes(lower));
  return includes;
};
