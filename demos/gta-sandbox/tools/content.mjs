#!/usr/bin/env node
/**
 * content.mjs — gta-sandbox 内容包的 headless 编辑工具。
 * CLI 只解析参数和写盘；所有内容变更统一进入 content-lib/commands.mjs。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { materializeBlocks, roadIntersections } from '../content-lib/core.mjs';
import { execute, validateAll } from '../content-lib/commands.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCENE = join(ROOT, 'public/content/scene.json');
const MISSIONS = join(ROOT, 'public/content/missions.json');
const RULES = join(ROOT, 'public/content/rules.json');
const TUNING = join(ROOT, 'public/content/tuning.json');

const makeContent = (scene, missionsPack, rules, tuning) => {
  const blocks = scene.blocks?.length ? scene.blocks : materializeBlocks(scene.town);
  return { scene, missions: missionsPack.missions, blocks, rules, tuning };
};

const load = () => {
  const scene = JSON.parse(readFileSync(SCENE, 'utf8'));
  const missionsPack = JSON.parse(readFileSync(MISSIONS, 'utf8'));
  const rules = JSON.parse(readFileSync(RULES, 'utf8'));
  const tuning = JSON.parse(readFileSync(TUNING, 'utf8'));
  return { missionsPack, content: makeContent(scene, missionsPack, rules, tuning) };
};

const refuse = (issues) => {
  console.error(`⛔ 校验失败（${issues.length} 处），已拒绝保存：`);
  for (const i of issues) console.error(`  - [${i.where}] ${i.message}`);
};

const save = (content, missionsPack, targets) => {
  if (targets.scene) writeFileSync(SCENE, JSON.stringify(content.scene, null, 2) + '\n');
  if (targets.missions) {
    writeFileSync(MISSIONS, JSON.stringify({ ...missionsPack, missions: content.missions }, null, 2) + '\n');
  }
  if (targets.tuning) writeFileSync(TUNING, JSON.stringify(content.tuning, null, 2) + '\n');
};

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};

const parsePos = (s, n) => {
  const v = String(s ?? '').split(',').map(Number);
  if (v.length !== n || v.some(Number.isNaN)) {
    console.error(`--pos 需要 ${n} 个数字（逗号分隔），收到 "${s}"`);
    process.exit(1);
  }
  return v;
};

const parseAt = (s) => {
  if (!s) { console.error('--at 必填（spawns.* 或 x,z）'); process.exit(1); }
  if (s.includes(',')) return parsePos(s, 2);
  return s;
};

const parseBool = (s) => {
  if (s === 'true') return true;
  if (s === 'false') return false;
  console.error(`boolean 参数必须是 true|false，收到 "${s}"`);
  process.exit(1);
};

const run = (content, name, params) => {
  const issues = execute(content, name, params);
  if (issues.length) {
    refuse(issues);
    process.exit(1);
  }
};

const [cmd, sub] = process.argv.slice(2);
const { missionsPack, content } = load();

switch (cmd) {
  case 'validate': {
    const issues = validateAll(content);
    if (!issues.length) {
      console.log(`✅ 内容包 + 规则包 + tuning 校验通过（${content.blocks.length} 栋建筑，${content.missions.length} 个任务，${content.rules.rules.length} 条规则）`);
      break;
    }
    console.error(`⛔ ${issues.length} 处问题：`);
    for (const i of issues) console.error(`  - [${i.where}] ${i.message}`);
    process.exit(1);
  }

  case 'list': {
    if (sub === 'missions') console.log(JSON.stringify(content.missions, null, 2));
    else if (sub === 'blocks') console.log(JSON.stringify(content.blocks.map(b => ({ x: +b.x.toFixed(1), z: +b.z.toFixed(1), w: +b.w.toFixed(1), d: +b.d.toFixed(1), h: +b.h.toFixed(1) })), null, 2));
    else if (sub === 'spawns') console.log(JSON.stringify(content.scene.spawns, null, 2));
    else if (sub === 'entities') console.log(JSON.stringify(content.scene.entities ?? [], null, 2));
    else if (sub === 'tuning') console.log(JSON.stringify(content.tuning, null, 2));
    else if (sub === 'roads') {
      console.log('马路交叉口（合法任务点候选）:');
      console.log(roadIntersections(content.scene.town).map(p => `(${p[0]}, ${p[1]})`).join('  '));
    } else { console.error('list 什么？missions | blocks | spawns | entities | roads | tuning'); process.exit(1); }
    break;
  }

  case 'add-entity': {
    const prefab = arg('prefab');
    const name = arg('name');
    const at = parseAt(arg('at'));
    run(content, 'add-entity', { prefab, name, at });
    save(content, missionsPack, { scene: true });
    console.log('✅ 校验通过，已保存');
    break;
  }

  case 'remove-entity': {
    if (!sub) { console.error('用法：remove-entity <name>'); process.exit(1); }
    run(content, 'remove-entity', { name: sub });
    save(content, missionsPack, { scene: true });
    console.log('✅ 校验通过，已保存');
    break;
  }

  case 'tune': {
    const path = sub;
    const raw = process.argv[4];
    const value = Number(raw);
    if (!path || !raw || Number.isNaN(value)) {
      console.error('用法：tune <dot.path> <number>，例如 tune police.speed 5');
      process.exit(1);
    }
    run(content, 'tune', { path, value });
    save(content, missionsPack, { tuning: true });
    console.log(`✅ tuning.${path} = ${value}，校验通过，已保存`);
    break;
  }

  case 'set-mission': {
    const index = Number(sub);
    if (!Number.isInteger(index)) { console.error('用法：set-mission <index> [--pos x,z] [--text "..."] [--need-car true|false]'); process.exit(1); }
    let changed = false;
    if (arg('pos')) { run(content, 'move-mission', { index, pos: parsePos(arg('pos'), 2) }); changed = true; }
    if (arg('text')) { run(content, 'set-mission-text', { index, text: arg('text') }); changed = true; }
    if (arg('need-car')) { run(content, 'set-mission-need-car', { index, needCar: parseBool(arg('need-car')) }); changed = true; }
    if (!changed) { console.error('set-mission 需要至少一个 --pos/--text/--need-car'); process.exit(1); }
    save(content, missionsPack, { missions: true });
    console.log('✅ 校验通过，已保存');
    break;
  }

  case 'add-mission': {
    const mission = { text: arg('text', '') };
    if (arg('pos')) mission.pos = parsePos(arg('pos'), 2);
    if (arg('special')) mission.special = arg('special');
    if (arg('need-car')) mission.needCar = parseBool(arg('need-car'));
    run(content, 'add-mission', { mission });
    save(content, missionsPack, { missions: true });
    console.log('✅ 校验通过，已保存');
    break;
  }

  case 'remove-mission': {
    const index = Number(sub);
    run(content, 'remove-mission', { index });
    save(content, missionsPack, { missions: true });
    console.log('✅ 校验通过，已保存');
    break;
  }

  case 'set-spawn': {
    if (sub === 'player') {
      run(content, 'set-spawn', { kind: 'player', pos: parsePos(arg('pos'), 3) });
    } else if (sub === 'car') {
      const params = { kind: 'car' };
      if (arg('pos')) params.pos = parsePos(arg('pos'), 3);
      if (arg('heading')) params.headingDeg = Number(arg('heading'));
      run(content, 'set-spawn', params);
    } else { console.error('set-spawn player|car'); process.exit(1); }
    save(content, missionsPack, { scene: true });
    console.log('✅ 校验通过，已保存');
    break;
  }

  default:
    console.log('命令：validate | list <missions|blocks|spawns|entities|roads|tuning> | add-entity | remove-entity | tune <dot.path> <number> | set-mission <i> | add-mission | remove-mission <i> | set-spawn <player|car>');
    process.exit(cmd ? 1 : 0);
}
