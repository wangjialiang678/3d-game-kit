import { fetchJsonReader, loadPack } from '@kit/core/content-pipeline.mjs';
import type { ArenaContent, TuningContent } from '../../content-lib/core';

export type { ArenaContent, TuningContent };

export interface Content {
  arena: ArenaContent;
  rules: { version: number; rules: any[] };
  tuning: TuningContent;
}

export async function loadContent(arenaUrl: string, rulesUrl: string, tuningUrl: string): Promise<Content> {
  return loadPack<Content>({
    files: { arena: arenaUrl, rules: rulesUrl, tuning: tuningUrl },
    reader: fetchJsonReader(),
    build: ({ arena, rules, tuning }) => ({ arena, rules, tuning }),
  });
}
