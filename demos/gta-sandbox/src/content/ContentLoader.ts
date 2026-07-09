/**
 * ContentLoader — 内容包加载器（浏览器侧）。
 * 核心逻辑（物化/校验）在 ../../content-lib/core.mjs —— 与 Node CLI 编辑工具共用同一实现。
 */
import { materializeBlocks } from '../../content-lib/core.mjs';
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
  const [sceneRes, missionsRes, rulesRes, tuningRes] = await Promise.all([fetch(sceneUrl), fetch(missionsUrl), fetch(rulesUrl), fetch(tuningUrl)]);
  if (!sceneRes.ok) throw new Error(`无法加载 ${sceneUrl}: HTTP ${sceneRes.status}`);
  if (!missionsRes.ok) throw new Error(`无法加载 ${missionsUrl}: HTTP ${missionsRes.status}`);
  if (!rulesRes.ok) throw new Error(`无法加载 ${rulesUrl}: HTTP ${rulesRes.status}`);
  if (!tuningRes.ok) throw new Error(`无法加载 ${tuningUrl}: HTTP ${tuningRes.status}`);
  const scene = (await sceneRes.json()) as SceneContent;
  const missionsPack = (await missionsRes.json()) as { missions: MissionData[] };
  const rules = await rulesRes.json();
  const tuning = (await tuningRes.json()) as TuningContent;
  // 显式 blocks 优先（编辑器产物）；否则由 town 种子物化
  const blocks = scene.blocks?.length ? scene.blocks : materializeBlocks(scene.town);
  return { scene, missions: missionsPack.missions ?? [], blocks, rules, tuning };
}
