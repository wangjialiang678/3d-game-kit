import type { Plugin } from 'vite';
import type { Issue } from './rules-core.mjs';

export function contentSavePlugin(opts: {
  root: string;
  files: Record<string, string>;
  validate?: (payload: Record<string, any>) => Issue[];
}): Plugin;
