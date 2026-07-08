#!/usr/bin/env node
/**
 * content.mjs — gta-sandbox 内容包的 headless 编辑工具（P2：编辑器=操作层，AI/CLI 是它的客户端）。
 * 与游戏共用同一份校验逻辑（content-lib/core.mjs），所有写操作先校验、不合法拒绝保存。
 *
 * 用法（在 demos/gta-sandbox 目录，或用绝对路径）：
 *   node tools/content.mjs validate
 *   node tools/content.mjs list missions|blocks|spawns|roads
 *   node tools/content.mjs set-mission <index> --pos <x,z> [--text "..."] [--need-car true|false]
 *   node tools/content.mjs add-mission --text "..." (--pos <x,z> | --special wanted) [--need-car true]
 *   node tools/content.mjs remove-mission <index>
 *   node tools/content.mjs set-spawn player --pos <x,y,z>
 *   node tools/content.mjs set-spawn car --pos <x,y,z> [--heading <deg>]
 *   任何写操作加 --force 可跳过校验强行保存（仅调试用）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { materializeBlocks, validateContent, roadIntersections } from '../content-lib/core.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCENE = join(ROOT, 'public/content/scene.json');
const MISSIONS = join(ROOT, 'public/content/missions.json');

const load = () => {
  const scene = JSON.parse(readFileSync(SCENE, 'utf8'));
  const missionsPack = JSON.parse(readFileSync(MISSIONS, 'utf8'));
  const blocks = scene.blocks?.length ? scene.blocks : materializeBlocks(scene.town);  // 显式 blocks（编辑器产物）优先
  return { scene, missionsPack, content: { scene, missions: missionsPack.missions, blocks } };
};

const save = (scene, missionsPack, force) => {
  const blocks = scene.blocks?.length ? scene.blocks : materializeBlocks(scene.town);
  const content = { scene, missions: missionsPack.missions, blocks };
  const issues = validateContent(content);
  if (issues.length && !force) {
    console.error(`⛔ 校验失败（${issues.length} 处），已拒绝保存：`);
    for (const i of issues) console.error(`  - [${i.where}] ${i.message}`);
    process.exit(1);
  }
  writeFileSync(SCENE, JSON.stringify(scene, null, 2) + '\n');
  writeFileSync(MISSIONS, JSON.stringify(missionsPack, null, 2) + '\n');
  console.log(issues.length ? `⚠️ 已强制保存（存在 ${issues.length} 处校验问题）` : '✅ 校验通过，已保存');
};

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const has = (name) => process.argv.includes(`--${name}`);
const parsePos = (s, n) => {
  const v = s.split(',').map(Number);
  if (v.length !== n || v.some(Number.isNaN)) { console.error(`--pos 需要 ${n} 个数字（逗号分隔），收到 "${s}"`); process.exit(1); }
  return v;
};

const [cmd, sub] = process.argv.slice(2);
const { scene, missionsPack, content } = load();

switch (cmd) {
  case 'validate': {
    const issues = validateContent(content);
    if (!issues.length) { console.log(`✅ 内容包校验通过（${content.blocks.length} 栋建筑，${content.missions.length} 个任务）`); break; }
    console.error(`⛔ ${issues.length} 处问题：`);
    for (const i of issues) console.error(`  - [${i.where}] ${i.message}`);
    process.exit(1);
  }

  case 'list': {
    if (sub === 'missions') console.log(JSON.stringify(content.missions, null, 2));
    else if (sub === 'blocks') console.log(JSON.stringify(content.blocks.map(b => ({ x: +b.x.toFixed(1), z: +b.z.toFixed(1), w: +b.w.toFixed(1), d: +b.d.toFixed(1), h: +b.h.toFixed(1) })), null, 2));
    else if (sub === 'spawns') console.log(JSON.stringify(scene.spawns, null, 2));
    else if (sub === 'roads') {
      console.log('马路交叉口（合法任务点候选）:');
      console.log(roadIntersections(scene.town).map(p => `(${p[0]}, ${p[1]})`).join('  '));
    } else { console.error('list 什么？missions | blocks | spawns | roads'); process.exit(1); }
    break;
  }

  case 'set-mission': {
    const i = Number(sub);
    const m = missionsPack.missions[i];
    if (!m) { console.error(`没有 missions[${i}]`); process.exit(1); }
    if (arg('pos')) m.pos = parsePos(arg('pos'), 2);
    if (arg('text')) m.text = arg('text');
    if (arg('need-car')) m.needCar = arg('need-car') === 'true';
    save(scene, missionsPack, has('force'));
    break;
  }

  case 'add-mission': {
    const m = { text: arg('text', '') };
    if (arg('pos')) m.pos = parsePos(arg('pos'), 2);
    if (arg('special')) m.special = arg('special');
    if (arg('need-car')) m.needCar = arg('need-car') === 'true';
    missionsPack.missions.push(m);
    save(scene, missionsPack, has('force'));
    break;
  }

  case 'remove-mission': {
    const i = Number(sub);
    if (!missionsPack.missions[i]) { console.error(`没有 missions[${i}]`); process.exit(1); }
    missionsPack.missions.splice(i, 1);
    save(scene, missionsPack, has('force'));
    break;
  }

  case 'set-spawn': {
    if (sub === 'player') scene.spawns.player = parsePos(arg('pos'), 3);
    else if (sub === 'car') {
      if (arg('pos')) scene.spawns.car.pos = parsePos(arg('pos'), 3);
      if (arg('heading')) scene.spawns.car.headingDeg = Number(arg('heading'));
    } else { console.error('set-spawn player|car'); process.exit(1); }
    save(scene, missionsPack, has('force'));
    break;
  }

  default:
    console.log('命令：validate | list <missions|blocks|spawns|roads> | set-mission <i> | add-mission | remove-mission <i> | set-spawn <player|car>');
    process.exit(cmd ? 1 : 0);
}
