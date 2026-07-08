/**
 * content-lib/core.mjs — 内容包核心逻辑（P2：单一实现，双端共用）。
 * 浏览器（游戏加载时校验）和 Node CLI（编辑工具）import 的是同一份代码，
 * 保证"游戏认为合法"和"编辑器认为合法"永远一致。
 * 纯函数、无 IO、无依赖。
 */

/** 确定性伪随机（种子固定 → 小镇布局固定，可复现、可校验） */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 把程序化小镇参数物化成显式建筑列表 [{x,z,w,d,h}]。 */
export function materializeBlocks(t) {
  const rand = mulberry32(t.seed);
  const isPlaza = (gx, gz) => t.plaza.some(([px, pz]) => px === gx && pz === gz);
  const blocks = [];
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

function insideBlock(x, z, b, margin) {
  return (
    x > b.x - b.w / 2 - margin && x < b.x + b.w / 2 + margin &&
    z > b.z - b.d / 2 - margin && z < b.z + b.d / 2 + margin
  );
}

function hitBlock(x, z, blocks, margin) {
  for (const b of blocks) if (insideBlock(x, z, b, margin)) return b;
  return null;
}

/**
 * 语义校验：把"任务点在楼里/出生点插墙"这类内容 bug 拦在加载/保存时。
 * @returns {{where:string, message:string}[]} 空数组 = 通过
 */
export function validateContent(c) {
  const issues = [];
  const half = c.scene?.town?.groundHalf;

  if (!c.scene?.town) issues.push({ where: 'scene.town', message: '缺少小镇参数' });
  if (!c.scene?.spawns?.player) issues.push({ where: 'scene.spawns.player', message: '缺少玩家出生点' });
  if (!c.scene?.assets?.soldier || !c.scene?.assets?.sky) issues.push({ where: 'scene.assets', message: '缺少 soldier/sky 资产路径' });
  if (!half || half <= 0) issues.push({ where: 'scene.town.groundHalf', message: 'groundHalf 必须为正数' });
  if (issues.length) return issues;

  const inBounds = (x, z, margin) => Math.abs(x) < half - margin && Math.abs(z) < half - margin;

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

  c.missions.forEach((m, i) => {
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

/** 列出所有马路交叉口（网格走廊中线交点）——给编辑器/AI 推荐合法任务点用。 */
export function roadIntersections(t) {
  const mids = [];
  for (let g = -t.gridRange; g < t.gridRange; g++) mids.push((g + 0.5) * t.cell);
  const pts = [];
  for (const x of mids) for (const z of mids) pts.push([x, z]);
  return pts;
}
