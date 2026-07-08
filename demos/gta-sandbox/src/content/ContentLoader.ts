/**
 * ContentLoader — 内容包加载器（浏览器侧）。
 * 核心逻辑（物化/校验）在 ../../content-lib/core.mjs —— 与 Node CLI 编辑工具共用同一实现。
 */
import { materializeBlocks } from '../../content-lib/core.mjs';
import type { TownParams, Block } from '../../content-lib/core';

export type { TownParams, Block };

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
}

export async function loadContent(sceneUrl: string, missionsUrl: string): Promise<Content> {
  const [sceneRes, missionsRes] = await Promise.all([fetch(sceneUrl), fetch(missionsUrl)]);
  if (!sceneRes.ok) throw new Error(`无法加载 ${sceneUrl}: HTTP ${sceneRes.status}`);
  if (!missionsRes.ok) throw new Error(`无法加载 ${missionsUrl}: HTTP ${missionsRes.status}`);
  const scene = (await sceneRes.json()) as SceneContent;
  const missionsPack = (await missionsRes.json()) as { missions: MissionData[] };
  // 显式 blocks 优先（编辑器产物）；否则由 town 种子物化
  const blocks = scene.blocks?.length ? scene.blocks : materializeBlocks(scene.town);
  return { scene, missions: missionsPack.missions ?? [], blocks };
}
