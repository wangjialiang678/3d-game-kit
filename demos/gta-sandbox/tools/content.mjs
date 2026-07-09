#!/usr/bin/env node
/**
 * content.mjs — gta-sandbox 内容包的 headless 编辑工具（P2：编辑器=操作层，AI/CLI 是它的客户端）。
 * 与游戏共用同一份校验逻辑（content-lib/core.mjs），所有写操作先校验、不合法拒绝保存。
 *
 * 用法（在 demos/gta-sandbox 目录，或用绝对路径）：
 *   node tools/content.mjs validate
 *   node tools/content.mjs list missions|blocks|spawns|entities|roads|tuning
 *   node tools/content.mjs tune police.speed 5
 *   node tools/content.mjs add-entity --prefab car --name Car2 --at -13,39
 *   node tools/content.mjs remove-entity <name>
 *   node tools/content.mjs set-mission <index> --pos <x,z> [--text "..."] [--need-car true|false]
 *   node tools/content.mjs add-mission --text "..." (--pos <x,z> | --special wanted) [--need-car true]
 *   node tools/content.mjs remove-mission <index>
 *   node tools/content.mjs set-spawn player --pos <x,y,z>
 *   node tools/content.mjs set-spawn car --pos <x,y,z> [--heading <deg>]
 *   scene/missions 写操作加 --force 可跳过校验强行保存（仅调试用）；tuning 不允许强制写坏关系断言
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { materializeBlocks, validateContent, validateTuning, roadIntersections } from '../content-lib/core.mjs';
import { validateRules } from '../content-lib/rules.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCENE = join(ROOT, 'public/content/scene.json');
const MISSIONS = join(ROOT, 'public/content/missions.json');
const RULES = join(ROOT, 'public/content/rules.json');
const TUNING = join(ROOT, 'public/content/tuning.json');

const makeContent = (scene, missionsPack, rules, tuning) => {
  const blocks = scene.blocks?.length ? scene.blocks : materializeBlocks(scene.town);
  return { scene, missions: missionsPack.missions, blocks, rules, tuning };
};

const validateAll = (content) => [
  ...validateContent(content),
  ...validateRules(content.rules, content),
  ...validateTuning(content.tuning),
];

const load = () => {
  const scene = JSON.parse(readFileSync(SCENE, 'utf8'));
  const missionsPack = JSON.parse(readFileSync(MISSIONS, 'utf8'));
  const rules = JSON.parse(readFileSync(RULES, 'utf8'));
  const tuning = JSON.parse(readFileSync(TUNING, 'utf8'));
  return { scene, missionsPack, rules, tuning, content: makeContent(scene, missionsPack, rules, tuning) };
};

const refuse = (issues) => {
  console.error(`⛔ 校验失败（${issues.length} 处），已拒绝保存：`);
  for (const i of issues) console.error(`  - [${i.where}] ${i.message}`);
};

const save = (scene, missionsPack, rules, tuning, force) => {
  const content = makeContent(scene, missionsPack, rules, tuning);
  const issues = validateAll(content);
  if (issues.length && !force) {
    refuse(issues);
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
const parseAt = (s) => {
  if (!s) { console.error('--at 必填（spawns.* 或 x,z）'); process.exit(1); }
  if (s.includes(',')) return parsePos(s, 2);
  return s;
};
const cloneJson = (v) => JSON.parse(JSON.stringify(v));
const setDot = (obj, path, value) => {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (!cur || typeof cur !== 'object' || !(p in cur)) return false;
    cur = cur[p];
  }
  const last = parts.at(-1);
  if (!last || !cur || typeof cur !== 'object' || !(last in cur)) return false;
  cur[last] = value;
  return true;
};

const [cmd, sub] = process.argv.slice(2);
const { scene, missionsPack, rules, tuning, content } = load();

switch (cmd) {
  case 'validate': {
    const issues = validateAll(content);
    if (!issues.length) { console.log(`✅ 内容包 + 规则包 + tuning 校验通过（${content.blocks.length} 栋建筑，${content.missions.length} 个任务，${rules.rules.length} 条规则）`); break; }
    console.error(`⛔ ${issues.length} 处问题：`);
    for (const i of issues) console.error(`  - [${i.where}] ${i.message}`);
    process.exit(1);
  }

  case 'list': {
    if (sub === 'missions') console.log(JSON.stringify(content.missions, null, 2));
    else if (sub === 'blocks') console.log(JSON.stringify(content.blocks.map(b => ({ x: +b.x.toFixed(1), z: +b.z.toFixed(1), w: +b.w.toFixed(1), d: +b.d.toFixed(1), h: +b.h.toFixed(1) })), null, 2));
    else if (sub === 'spawns') console.log(JSON.stringify(scene.spawns, null, 2));
    else if (sub === 'entities') console.log(JSON.stringify(scene.entities ?? [], null, 2));
    else if (sub === 'tuning') console.log(JSON.stringify(tuning, null, 2));
    else if (sub === 'roads') {
      console.log('马路交叉口（合法任务点候选）:');
      console.log(roadIntersections(scene.town).map(p => `(${p[0]}, ${p[1]})`).join('  '));
    } else { console.error('list 什么？missions | blocks | spawns | entities | roads | tuning'); process.exit(1); }
    break;
  }

  case 'add-entity': {
    const prefab = arg('prefab');
    const name = arg('name');
    const at = parseAt(arg('at'));
    if (!prefab || !name) { console.error('用法：add-entity --prefab <prefab> --name <name> --at <spawns.*|x,z>'); process.exit(1); }
    const nextScene = cloneJson(scene);
    if (!Array.isArray(nextScene.entities)) nextScene.entities = [];
    nextScene.entities.push({ prefab, name, at });
    save(nextScene, missionsPack, rules, tuning, has('force'));
    break;
  }

  case 'remove-entity': {
    const name = sub;
    if (!name) { console.error('用法：remove-entity <name>'); process.exit(1); }
    const nextScene = cloneJson(scene);
    const before = nextScene.entities?.length ?? 0;
    nextScene.entities = (nextScene.entities ?? []).filter((e) => e.name !== name);
    if (nextScene.entities.length === before) { console.error(`没有实体 "${name}"`); process.exit(1); }
    save(nextScene, missionsPack, rules, tuning, has('force'));
    break;
  }

  case 'tune': {
    const path = sub;
    const raw = process.argv[4];
    const value = Number(raw);
    if (!path || !raw || Number.isNaN(value)) { console.error('用法：tune <dot.path> <number>，例如 tune police.speed 5'); process.exit(1); }
    const nextTuning = cloneJson(tuning);
    if (!setDot(nextTuning, path, value)) { console.error(`未知 tuning 路径 "${path}"`); process.exit(1); }
    const nextContent = makeContent(scene, missionsPack, rules, nextTuning);
    const issues = validateAll(nextContent);
    if (issues.length) {
      refuse(issues);
      process.exit(1);
    }
    writeFileSync(TUNING, JSON.stringify(nextTuning, null, 2) + '\n');
    console.log(`✅ tuning.${path} = ${value}，校验通过，已保存`);
    break;
  }

  case 'set-mission': {
    const i = Number(sub);
    const m = missionsPack.missions[i];
    if (!m) { console.error(`没有 missions[${i}]`); process.exit(1); }
    if (arg('pos')) m.pos = parsePos(arg('pos'), 2);
    if (arg('text')) m.text = arg('text');
    if (arg('need-car')) m.needCar = arg('need-car') === 'true';
    save(scene, missionsPack, rules, tuning, has('force'));
    break;
  }

  case 'add-mission': {
    const m = { text: arg('text', '') };
    if (arg('pos')) m.pos = parsePos(arg('pos'), 2);
    if (arg('special')) m.special = arg('special');
    if (arg('need-car')) m.needCar = arg('need-car') === 'true';
    missionsPack.missions.push(m);
    save(scene, missionsPack, rules, tuning, has('force'));
    break;
  }

  case 'remove-mission': {
    const i = Number(sub);
    if (!missionsPack.missions[i]) { console.error(`没有 missions[${i}]`); process.exit(1); }
    missionsPack.missions.splice(i, 1);
    save(scene, missionsPack, rules, tuning, has('force'));
    break;
  }

  case 'set-spawn': {
    if (sub === 'player') scene.spawns.player = parsePos(arg('pos'), 3);
    else if (sub === 'car') {
      if (arg('pos')) scene.spawns.car.pos = parsePos(arg('pos'), 3);
      if (arg('heading')) scene.spawns.car.headingDeg = Number(arg('heading'));
    } else { console.error('set-spawn player|car'); process.exit(1); }
    save(scene, missionsPack, rules, tuning, has('force'));
    break;
  }

  default:
    console.log('命令：validate | list <missions|blocks|spawns|entities|roads|tuning> | add-entity | remove-entity | tune <dot.path> <number> | set-mission <i> | add-mission | remove-mission <i> | set-spawn <player|car>');
    process.exit(cmd ? 1 : 0);
}
