/**
 * content-lib/core.mjs — 内容包核心逻辑（P2：单一实现，双端共用）。
 * 浏览器（游戏加载时校验）和 Node CLI（编辑工具）import 的是同一份代码，
 * 保证"游戏认为合法"和"编辑器认为合法"永远一致。
 * 纯函数、无 IO、无依赖。
 */

import { mulberry32, insideAnyBlock, findClearSpot, fingerprint } from '@kit/core/spatial.mjs';

export { mulberry32, insideAnyBlock, findClearSpot };

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

// Keep in sync with demos/gta-sandbox/src/game/PrefabRegistry.ts built-in registrations.
export const PREFAB_CONTROLLER_TYPES = ['OnFootPlayer', 'Car', 'PoliceNPC'];

/** 解析实体实例 at 字段：只允许 spawns.* 命名点位或 [x,z] 内容坐标。 */
export function resolveEntityPoint(scene, at) {
  if (Array.isArray(at)) {
    if (at.length !== 2 || at.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
    return [at[0], at[1]];
  }
  if (typeof at !== 'string') return null;
  if (at === 'spawns.player') {
    const p = scene?.spawns?.player;
    return Array.isArray(p) ? [p[0], p[2]] : null;
  }
  if (at === 'spawns.car') {
    const p = scene?.spawns?.car?.pos;
    return Array.isArray(p) ? [p[0], p[2]] : null;
  }
  return null;
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

  validatePrefabs(c, issues, inBounds);

  c.missions.forEach((m, i) => {
    const tag = `missions[${i}]`;
    if (!m.text?.trim()) issues.push({ where: tag, message: '任务缺少 text' });
    if (!m.pos && !m.special) issues.push({ where: tag, message: '任务必须有 pos（到点）或 special（特殊类型）' });
    if (m.special && m.special !== 'wanted') issues.push({ where: tag, message: `未知 special 类型 "${m.special}"` });
    if (m.needCar && !hasEntityController(c.scene, 'Car')) issues.push({ where: tag, message: 'needCar=true 但场景里没有汽车实体实例' });
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

function placementMarginFor(controller) {
  if (controller === 'Car') return 1.5;
  return 1.0;
}

function hasEntityController(scene, controller) {
  const prefabs = scene?.prefabs ?? {};
  return (scene?.entities ?? []).some((e) => prefabs[e.prefab]?.controller === controller);
}

function validatePrefabs(c, issues, inBounds) {
  const scene = c.scene;
  const prefabs = scene.prefabs;
  const entities = scene.entities;

  if (!prefabs || typeof prefabs !== 'object') {
    issues.push({ where: 'scene.prefabs', message: '缺少 prefabs 预制体定义' });
    return;
  }
  if (!Array.isArray(entities)) {
    issues.push({ where: 'scene.entities', message: '缺少 entities 实例表' });
    return;
  }

  for (const required of ['player', 'car', 'police']) {
    if (!prefabs[required]) issues.push({ where: `scene.prefabs.${required}`, message: '缺少内置 prefab 定义' });
  }

  for (const [name, prefab] of Object.entries(prefabs)) {
    if (name.startsWith('_')) continue;
    const where = `scene.prefabs.${name}.controller`;
    if (!prefab || typeof prefab !== 'object') {
      issues.push({ where: `scene.prefabs.${name}`, message: 'prefab 必须是对象' });
      continue;
    }
    if (!PREFAB_CONTROLLER_TYPES.includes(prefab.controller)) {
      issues.push({ where, message: `未知 controller "${prefab.controller}"（可用：${PREFAB_CONTROLLER_TYPES.join('/')})` });
    }
  }

  const seenNames = new Set();
  entities.forEach((e, i) => {
    const tag = `scene.entities[${i}]`;
    if (!e || typeof e !== 'object') {
      issues.push({ where: tag, message: '实体实例必须是对象' });
      return;
    }
    if (!e.name || typeof e.name !== 'string') issues.push({ where: `${tag}.name`, message: '实例 name 必须是非空字符串' });
    else if (seenNames.has(e.name)) issues.push({ where: `${tag}.name`, message: `实例 name 重复 "${e.name}"` });
    else seenNames.add(e.name);

    const prefab = prefabs[e.prefab];
    if (!prefab) {
      issues.push({ where: `${tag}.prefab`, message: `未定义 prefab "${e.prefab}"` });
      return;
    }

    const point = resolveEntityPoint(scene, e.at);
    if (!point) {
      issues.push({ where: `${tag}.at`, message: 'at 必须是 spawns.* 命名点位或 [x,z] 坐标数组' });
      return;
    }
    const [x, z] = point;
    if (!inBounds(x, z, placementMarginFor(prefab.controller))) {
      issues.push({ where: `${tag}.at`, message: `实例落点 (${x},${z}) 超出地图边界(±${scene.town.groundHalf})` });
    }
    const b = hitBlock(x, z, c.blocks, placementMarginFor(prefab.controller));
    if (b) {
      issues.push({ where: `${tag}.at`, message: `实例落点 (${x},${z}) 在建筑内部（建筑中心 ${b.x},${b.z}）` });
    }
  });
}

const TUNING_SPEC = {
  player: ['maxSpeed', 'accelTime', 'jumpVelocity', 'mouseSpeed'],
  car: ['maxSpeed', 'accel', 'brake', 'reverseMax', 'steer'],
  police: ['speed', 'perStar', 'escapeDist', 'escapeTime', 'bustDist', 'cullDist', 'spawnRadius'],
  mission: ['completeRadius'],
};

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 策划调参表校验：先拦结构/范围，再拦会破坏可玩性的跨项关系。
 * 这些关系是护栏，不是调平衡：防止"警察比车还快"这类保存后必坏的内容进入游戏。
 */
export function validateTuning(t) {
  const issues = [];
  if (!t || typeof t !== 'object') return [{ where: 'tuning', message: '缺少 tuning 调参表' }];

  for (const [section, fields] of Object.entries(TUNING_SPEC)) {
    const obj = t[section];
    if (!obj || typeof obj !== 'object') {
      issues.push({ where: `tuning.${section}`, message: `缺少 ${section} 配置段` });
      continue;
    }
    for (const field of fields) {
      const where = `tuning.${section}.${field}`;
      const value = obj[field];
      if (!isFiniteNumber(value)) issues.push({ where, message: `${field} 必须是数字` });
      else if (value <= 0) issues.push({ where, message: `${field} 必须为正数` });
    }
  }

  if (issues.length) return issues;

  if (t.car.maxSpeed < t.police.speed * 2) {
    issues.push({
      where: 'tuning.car.maxSpeed',
      message: `车必须显著快于警察，否则开车甩脱不可玩：car.maxSpeed=${t.car.maxSpeed} < police.speed*2=${t.police.speed * 2}`,
    });
  }
  if (t.player.maxSpeed <= t.police.speed) {
    issues.push({
      where: 'tuning.player.maxSpeed',
      message: `步行必须能拉开警察距离，否则被抓是必然不是失误：player.maxSpeed=${t.player.maxSpeed} <= police.speed=${t.police.speed}`,
    });
  }
  if (t.police.escapeDist >= t.police.cullDist) {
    issues.push({
      where: 'tuning.police.escapeDist',
      message: `甩脱距离必须小于警察消散距离，否则先消散就无法稳定触发跟丢：escapeDist=${t.police.escapeDist} >= cullDist=${t.police.cullDist}`,
    });
  }
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

export function contentFingerprint(content) {
  return fingerprint({
    scene: content.scene,
    missions: content.missions,
    rules: content.rules,
    tuning: content.tuning,
  });
}
