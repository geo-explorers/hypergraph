import type { SpaceConfig } from '../config.js';

export const formatSpacesList = (spaces: SpaceConfig[]): string => {
  const lines = spaces.map((s) => `- **${s.name}** (ID: ${s.id})`);
  return `## Available Spaces\n\n${lines.join('\n')}`;
};
