/**
 * ContentLoader — 内容包加载器（P1：引擎与内容分离）。
 * 游戏 = 引擎(代码) + 内容包(JSON)。本文件负责：
 *   1) 加载 scene.json / missions.json
 *   2) 把程序化小镇参数"物化"成显式建筑列表 blocks[]（校验和未来的编辑器都操作这份物化数据）
 */

export interface TownParams {
  groundHalf: number;
  cell: number;
  gridRange: number;
  plaza: [number, number][];
  seed: number;
  buildingWidth: [number, number];
  buildingHeight: [number, number];
}

export interface Block { x: number; z: number; w: number; d: number; h: number; }

export interface SceneContent {
  name: string;
  version: number;
  town: TownParams;
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

/** 确定性伪随机（种子固定 → 小镇布局固定，可复现、可校验） */
export function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 把程序化参数物化成显式建筑列表。 */
export function materializeBlocks(t: TownParams): Block[] {
  const rand = mulberry32(t.seed);
  const isPlaza = (gx: number, gz: number) => t.plaza.some(([px, pz]) => px === gx && pz === gz);
  const blocks: Block[] = [];
  const [w0, w1] = t.buildingWidth;
  const [h0, h1] = t.buildingHeight;
  for (let gx = -t.gridRange; gx <= t.gridRange; gx++) {
    for (let gz = -t.gridRange; gz <= t.gridRange; gz++) {
      if (isPlaza(gx, gz)) continue;
      const w = w0 + rand() * (w1 - w0);
      const d = w0 + rand() * (w1 - w0);
      const h = h0 + rand() * (h1 - h0);
      blocks.push({ x: gx * t.cell, z: gz * t.cell, w, d, h });
    }
  }
  return blocks;
}

export async function loadContent(sceneUrl: string, missionsUrl: string): Promise<Content> {
  const [sceneRes, missionsRes] = await Promise.all([fetch(sceneUrl), fetch(missionsUrl)]);
  if (!sceneRes.ok) throw new Error(`无法加载 ${sceneUrl}: HTTP ${sceneRes.status}`);
  if (!missionsRes.ok) throw new Error(`无法加载 ${missionsUrl}: HTTP ${missionsRes.status}`);
  const scene = (await sceneRes.json()) as SceneContent;
  const missionsPack = (await missionsRes.json()) as { missions: MissionData[] };
  return { scene, missions: missionsPack.missions ?? [], blocks: materializeBlocks(scene.town) };
}
