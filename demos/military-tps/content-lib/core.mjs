import { fingerprint, insideAnyBlock } from '@kit/core/spatial.mjs';

export { insideAnyBlock };

export const PREFAB_CONTROLLER_TYPES = ['ThirdPersonPlayer', 'SoldierNPC'];

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function coverHit(covers, x, z, margin = 0) {
  return (covers ?? []).find((c) =>
    x > c.x - c.w / 2 - margin && x < c.x + c.w / 2 + margin &&
    z > c.z - c.d / 2 - margin && z < c.z + c.d / 2 + margin) ?? null;
}

function inBounds(arena, x, z, margin) {
  return Math.abs(x) < arena.groundHalf - margin && Math.abs(z) < arena.groundHalf - margin;
}

export function resolveEntityPoint(arena, at) {
  if (Array.isArray(at)) {
    if (at.length !== 2 || at.some((v) => !isFiniteNumber(v))) return null;
    return [at[0], at[1]];
  }
  if (at === 'spawns.player') {
    const p = arena?.spawns?.player;
    return Array.isArray(p) ? [p[0], p[2]] : null;
  }
  return null;
}

export function validateContent(content) {
  const issues = [];
  const arena = content?.arena ?? content;
  if (!arena || typeof arena !== 'object') return [{ where: 'arena', message: '缺少 arena 内容包' }];
  if (!isFiniteNumber(arena.groundHalf) || arena.groundHalf <= 5) issues.push({ where: 'arena.groundHalf', message: 'groundHalf 必须是大于 5 的数字' });
  if (!isFiniteNumber(arena.wallHeight) || arena.wallHeight <= 0) issues.push({ where: 'arena.wallHeight', message: 'wallHeight 必须为正数' });
  if (!arena.assets?.soldier || !arena.assets?.sky) issues.push({ where: 'arena.assets', message: '缺少 soldier/sky 资产路径' });
  if (!Array.isArray(arena.spawns?.player) || arena.spawns.player.length !== 3) issues.push({ where: 'arena.spawns.player', message: '玩家出生点必须是 [x,y,z]' });
  if (!Array.isArray(arena.covers)) issues.push({ where: 'arena.covers', message: 'covers 必须是数组' });
  if (!arena.prefabs || typeof arena.prefabs !== 'object') issues.push({ where: 'arena.prefabs', message: '缺少 prefabs 定义' });
  if (!Array.isArray(arena.entities)) issues.push({ where: 'arena.entities', message: 'entities 必须是数组' });
  if (issues.length) return issues;

  arena.covers.forEach((c, i) => {
    const tag = `arena.covers[${i}]`;
    for (const k of ['x', 'z', 'w', 'h', 'd']) {
      if (!isFiniteNumber(c[k])) issues.push({ where: `${tag}.${k}`, message: `${k} 必须是数字` });
    }
    if (isFiniteNumber(c.w) && c.w <= 0) issues.push({ where: `${tag}.w`, message: 'w 必须为正数' });
    if (isFiniteNumber(c.h) && c.h <= 0) issues.push({ where: `${tag}.h`, message: 'h 必须为正数' });
    if (isFiniteNumber(c.d) && c.d <= 0) issues.push({ where: `${tag}.d`, message: 'd 必须为正数' });
    if (isFiniteNumber(c.x) && isFiniteNumber(c.z) && isFiniteNumber(c.w) && isFiniteNumber(c.d) &&
      !inBounds(arena, c.x, c.z, Math.max(c.w, c.d) / 2)) {
      issues.push({ where: tag, message: `掩体 (${c.x},${c.z}) 超出场地边界` });
    }
    if (c.material && !['metal', 'wall'].includes(c.material)) issues.push({ where: `${tag}.material`, message: 'material 只能是 metal 或 wall' });
  });

  for (const [name, prefab] of Object.entries(arena.prefabs)) {
    if (!prefab || typeof prefab !== 'object') {
      issues.push({ where: `arena.prefabs.${name}`, message: 'prefab 必须是对象' });
      continue;
    }
    if (!PREFAB_CONTROLLER_TYPES.includes(prefab.controller)) {
      issues.push({ where: `arena.prefabs.${name}.controller`, message: `未知 controller "${prefab.controller}"（可用：${PREFAB_CONTROLLER_TYPES.join('/')})` });
    }
  }

  const seen = new Set();
  let enemies = 0;
  arena.entities.forEach((e, i) => {
    const tag = `arena.entities[${i}]`;
    if (!e || typeof e !== 'object') {
      issues.push({ where: tag, message: '实体实例必须是对象' });
      return;
    }
    if (!e.name || typeof e.name !== 'string') issues.push({ where: `${tag}.name`, message: '实例 name 必须是非空字符串' });
    else if (seen.has(e.name)) issues.push({ where: `${tag}.name`, message: `实例 name 重复 "${e.name}"` });
    else seen.add(e.name);
    const prefab = arena.prefabs[e.prefab];
    if (!prefab) {
      issues.push({ where: `${tag}.prefab`, message: `未定义 prefab "${e.prefab}"` });
      return;
    }
    const pt = resolveEntityPoint(arena, e.at);
    if (!pt) {
      issues.push({ where: `${tag}.at`, message: 'at 必须是 spawns.player 或 [x,z]' });
      return;
    }
    const [x, z] = pt;
    const margin = prefab.controller === 'ThirdPersonPlayer' ? 1.0 : 0.8;
    if (!inBounds(arena, x, z, margin)) issues.push({ where: `${tag}.at`, message: `实例落点 (${x},${z}) 超出场地边界(±${arena.groundHalf})` });
    const hit = coverHit(arena.covers, x, z, margin);
    if (hit) issues.push({ where: `${tag}.at`, message: `实例落点 (${x},${z}) 在掩体 ${hit.name ?? ''} 内` });
    if (prefab.controller === 'SoldierNPC') enemies++;
  });
  if (enemies < 1) issues.push({ where: 'arena.entities', message: '至少需要 1 个敌人实例' });
  return issues;
}

const SPEC = {
  player: ['maxSpeed', 'accelTime', 'jumpVelocity', 'mouseSpeed', 'health'],
  weapon: ['fireRate', 'damage', 'ammoPerMag', 'reserveAmmo', 'reloadSecs'],
  enemy: ['speed', 'viewDist', 'shootRange', 'fireInterval', 'damage', 'health'],
};

export function validateTuning(t) {
  const issues = [];
  if (!t || typeof t !== 'object') return [{ where: 'tuning', message: '缺少 tuning 调参表' }];
  for (const [section, fields] of Object.entries(SPEC)) {
    const obj = t[section];
    if (!obj || typeof obj !== 'object') {
      issues.push({ where: `tuning.${section}`, message: `缺少 ${section} 配置段` });
      continue;
    }
    for (const field of fields) {
      const value = obj[field];
      if (!isFiniteNumber(value)) issues.push({ where: `tuning.${section}.${field}`, message: `${field} 必须是数字` });
      else if (value <= 0) issues.push({ where: `tuning.${section}.${field}`, message: `${field} 必须为正数` });
    }
  }
  if (issues.length) return issues;
  if (t.enemy.speed >= t.player.maxSpeed) {
    issues.push({
      where: 'tuning.enemy.speed',
      message: `敌人速度必须低于玩家速度，否则追击不可玩：enemy.speed=${t.enemy.speed} >= player.maxSpeed=${t.player.maxSpeed}`,
    });
  }
  if (t.enemy.shootRange >= t.enemy.viewDist) {
    issues.push({
      where: 'tuning.enemy.shootRange',
      message: `敌人射程必须小于视距，否则视野逻辑失去意义：shootRange=${t.enemy.shootRange} >= viewDist=${t.enemy.viewDist}`,
    });
  }
  if (t.weapon.damage >= t.enemy.health) {
    issues.push({
      where: 'tuning.weapon.damage',
      message: `单发伤害不能一枪秒杀默认敌人：damage=${t.weapon.damage} >= enemy.health=${t.enemy.health}`,
    });
  }
  return issues;
}

export function contentFingerprint(content) {
  return fingerprint({
    arena: content.arena,
    rules: content.rules,
    tuning: content.tuning,
  });
}
