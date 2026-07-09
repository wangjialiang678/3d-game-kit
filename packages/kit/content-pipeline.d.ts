import type { Issue } from './rules-core.mjs';

export type JsonReader = (path: string, key?: string) => Promise<any>;
export function fetchJsonReader(): JsonReader;
export function nodeJsonReader(baseDir?: string): JsonReader;

export class ContentValidationError extends Error {
  issues: Issue[];
  constructor(issues: Issue[]);
}

export function loadPack<TContent = any>(opts: {
  files: Record<string, string>;
  reader?: JsonReader;
  build?: (raw: Record<string, any>) => TContent;
  validators?: Array<(content: TContent) => Issue[]>;
}): Promise<TContent>;
