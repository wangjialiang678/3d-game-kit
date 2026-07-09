/**
 * ContentLoader — 内容包加载器（浏览器侧）。
 * 核心逻辑（物化/校验）在 ../../content-lib/core.mjs —— 与 Node CLI 编辑工具共用同一实现。
 */
import { materializeBlocks } from '../../content-lib/core.mjs';
import { fetchJsonReader, loadPack } from '@kit/core/content-pipeline.mjs';
import type { TownParams, Block, TuningContent, PrefabDefinition, EntityInstance } from '../../content-lib/core';

export type { TownParams, Block, TuningContent };

export interface SceneContent {
  name: string;
  version: number;
  town: TownParams;
  /** 可选：显式建筑列表（编辑器保存后写入；存在时优先于 town 种子生成） */
  blocks?: Block[];
  spawns: {
    player: [number, number, number];
    car: { pos: [number, number, number]; headingDeg: number };
  };
  prefabs: Record<string, PrefabDefinition>;
  entities: EntityInstance[];
  assets: Record<string, string>;
}

export interface MissionData {
  text: string;
  pos?: [number, number];
  needCar?: boolean;
  special?: 'wanted';
}

export interface Content {
  scene: SceneContent;
  missions: MissionData[];
  /** 由 town 参数物化出的建筑列表（单一事实来源，校验/编辑器都用它） */
  blocks: Block[];
  /** ECA 规则包（事件-条件-动作，封闭动作词汇表） */
  rules: { version: number; rules: any[] };
  /** 策划调参表（速度/警力/任务半径等可调数值） */
  tuning: TuningContent;
}

export async function loadContent(sceneUrl: string, missionsUrl: string, rulesUrl: string, tuningUrl: string): Promise<Content> {
  return loadPack<Content>({
    files: { scene: sceneUrl, missionsPack: missionsUrl, rules: rulesUrl, tuning: tuningUrl },
    reader: fetchJsonReader(),
    build: ({ scene, missionsPack, rules, tuning }) => {
      const s = scene as SceneContent;
      const blocks = s.blocks?.length ? s.blocks : materializeBlocks(s.town);
      return { scene: s, missions: (missionsPack as { missions: MissionData[] }).missions ?? [], blocks, rules, tuning: tuning as TuningContent };
    },
  });
}
