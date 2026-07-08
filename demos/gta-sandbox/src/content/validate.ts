/**
 * validate — 内容包语义校验（P1 的核心价值）。
 * 把"任务点写进建筑里/出生点插在墙里"这类内容 bug 从运行时提前到加载时，
 * 校验不过就不开局，红字直接告诉你哪条数据错在哪。
 */
import type { Content, Block, MissionData } from './ContentLoader';

export interface Issue { where: string; message: string; }

/** 点(x,z)是否落在某建筑的 AABB 内（margin 为安全外扩距离）。 */
function insideBlock(x: number, z: number, b: Block, margin: number): boolean {
  return (
    x > b.x - b.w / 2 - margin && x < b.x + b.w / 2 + margin &&
    z > b.z - b.d / 2 - margin && z < b.z + b.d / 2 + margin
  );
}

function hitBlock(x: number, z: number, blocks: Block[], margin: number): Block | null {
  for (const b of blocks) if (insideBlock(x, z, b, margin)) return b;
  return null;
}

export function validateContent(c: Content): Issue[] {
  const issues: Issue[] = [];
  const half = c.scene?.town?.groundHalf;

  // --- 基本结构 ---
  if (!c.scene?.town) issues.push({ where: 'scene.town', message: '缺少小镇参数' });
  if (!c.scene?.spawns?.player) issues.push({ where: 'scene.spawns.player', message: '缺少玩家出生点' });
  if (!c.scene?.assets?.soldier || !c.scene?.assets?.sky) issues.push({ where: 'scene.assets', message: '缺少 soldier/sky 资产路径' });
  if (!half || half <= 0) issues.push({ where: 'scene.town.groundHalf', message: 'groundHalf 必须为正数' });
  if (issues.length) return issues; // 结构都不对，后面没法查

  const inBounds = (x: number, z: number, margin: number) =>
    Math.abs(x) < half - margin && Math.abs(z) < half - margin;

  // --- 出生点 ---
  const [px, , pz] = c.scene.spawns.player;
  if (!inBounds(px, pz, 1)) issues.push({ where: 'spawns.player', message: `玩家出生点 (${px},${pz}) 超出地图边界(±${half})` });
  const pb = hitBlock(px, pz, c.blocks, 0.6);
  if (pb) issues.push({ where: 'spawns.player', message: `玩家出生点 (${px},${pz}) 在建筑内部（建筑中心 ${pb.x},${pb.z}）` });

  if (c.scene.spawns.car) {
    const [cx, , cz] = c.scene.spawns.car.pos;
    if (!inBounds(cx, cz, 2)) issues.push({ where: 'spawns.car', message: `汽车出生点 (${cx},${cz}) 超出地图边界` });
    const cb = hitBlock(cx, cz, c.blocks, 1.5);
    if (cb) issues.push({ where: 'spawns.car', message: `汽车出生点 (${cx},${cz}) 在建筑内部（建筑中心 ${cb.x},${cb.z}）` });
  }

  // --- 任务 ---
  c.missions.forEach((m: MissionData, i: number) => {
    const tag = `missions[${i}]`;
    if (!m.text?.trim()) issues.push({ where: tag, message: '任务缺少 text' });
    if (!m.pos && !m.special) issues.push({ where: tag, message: '任务必须有 pos（到点）或 special（特殊类型）' });
    if (m.special && m.special !== 'wanted') issues.push({ where: tag, message: `未知 special 类型 "${m.special}"` });
    if (m.needCar && !c.scene.spawns.car) issues.push({ where: tag, message: 'needCar=true 但场景里没有汽车出生点' });
    if (m.pos) {
      const [x, z] = m.pos;
      if (!inBounds(x, z, 3)) issues.push({ where: tag, message: `任务点 (${x},${z}) 超出地图边界(±${half})` });
      const b = hitBlock(x, z, c.blocks, 1.5);
      if (b) issues.push({
        where: tag,
        message: `任务点 (${x},${z}) 在建筑内部（建筑中心 ${b.x.toFixed(0)},${b.z.toFixed(0)}，尺寸 ${b.w.toFixed(0)}×${b.d.toFixed(0)}）——光柱会生成在楼里，玩家永远走不到。请把任务点放在马路上（路口在 ±13/±39 一类网格间走廊）`,
      });
    }
  });

  return issues;
}
