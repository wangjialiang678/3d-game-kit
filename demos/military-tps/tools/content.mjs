#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContent, validateTuning } from '../content-lib/core.mjs';
import { validateRules } from '../content-lib/rules.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ARENA = join(ROOT, 'public/content/arena.json');
const RULES = join(ROOT, 'public/content/rules.json');
const TUNING = join(ROOT, 'public/content/tuning.json');

const load = () => {
  const arena = JSON.parse(readFileSync(ARENA, 'utf8'));
  const rules = JSON.parse(readFileSync(RULES, 'utf8'));
  const tuning = JSON.parse(readFileSync(TUNING, 'utf8'));
  return { arena, rules, tuning, content: { arena, rules, tuning } };
};

const validateAll = (content) => [
  ...validateContent(content),
  ...validateRules(content.rules, content),
  ...validateTuning(content.tuning),
];

const refuse = (issues) => {
  console.error(`⛔ 校验失败（${issues.length} 处），已拒绝保存：`);
  for (const issue of issues) console.error(`  - [${issue.where}] ${issue.message}`);
};

const cloneJson = (v) => JSON.parse(JSON.stringify(v));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const parsePos = (s) => {
  const v = String(s ?? '').split(',').map(Number);
  if (v.length !== 2 || v.some(Number.isNaN)) {
    console.error(`--pos 需要 x,z 两个数字，收到 "${s}"`);
    process.exit(1);
  }
  return v;
};
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
const { arena, rules, tuning, content } = load();

switch (cmd) {
  case 'validate': {
    const issues = validateAll(content);
    if (!issues.length) {
      const enemies = arena.entities.filter((e) => arena.prefabs[e.prefab]?.controller === 'SoldierNPC').length;
      console.log(`✅ military 内容包 + 规则包 + tuning 校验通过（${arena.covers.length} 个掩体，${enemies} 个敌人，${rules.rules.length} 条规则）`);
      break;
    }
    console.error(`⛔ ${issues.length} 处问题：`);
    for (const issue of issues) console.error(`  - [${issue.where}] ${issue.message}`);
    process.exit(1);
  }

  case 'list': {
    if (sub === 'covers') console.log(JSON.stringify(arena.covers, null, 2));
    else if (sub === 'entities') console.log(JSON.stringify(arena.entities, null, 2));
    else if (sub === 'tuning') console.log(JSON.stringify(tuning, null, 2));
    else {
      console.error('list 什么？covers | entities | tuning');
      process.exit(1);
    }
    break;
  }

  case 'tune': {
    const path = sub;
    const raw = process.argv[4];
    const value = Number(raw);
    if (!path || !raw || Number.isNaN(value)) {
      console.error('用法：tune <dot.path> <number>，例如 tune enemy.speed 2.8');
      process.exit(1);
    }
    const nextTuning = cloneJson(tuning);
    if (!setDot(nextTuning, path, value)) {
      console.error(`未知 tuning 路径 "${path}"`);
      process.exit(1);
    }
    const nextContent = { arena, rules, tuning: nextTuning };
    const issues = validateAll(nextContent);
    if (issues.length) {
      refuse(issues);
      process.exit(1);
    }
    writeFileSync(TUNING, JSON.stringify(nextTuning, null, 2) + '\n');
    console.log(`✅ tuning.${path} = ${value}，校验通过，已保存`);
    break;
  }

  case 'move-enemy': {
    const name = sub;
    const pos = parsePos(arg('pos'));
    const nextArena = cloneJson(arena);
    const ent = nextArena.entities.find((e) => e.name === name);
    if (!ent) { console.error(`没有敌人实例 "${name}"`); process.exit(1); }
    ent.at = pos;
    const nextContent = { arena: nextArena, rules, tuning };
    const issues = validateAll(nextContent);
    if (issues.length) { refuse(issues); process.exit(1); }
    writeFileSync(ARENA, JSON.stringify(nextArena, null, 2) + '\n');
    console.log(`✅ ${name} 移动到 (${pos[0]}, ${pos[1]})`);
    break;
  }

  case 'move-cover': {
    const index = Number(sub);
    const pos = parsePos(arg('pos'));
    const nextArena = cloneJson(arena);
    if (!nextArena.covers[index]) { console.error(`没有 covers[${index}]`); process.exit(1); }
    nextArena.covers[index].x = pos[0];
    nextArena.covers[index].z = pos[1];
    const nextContent = { arena: nextArena, rules, tuning };
    const issues = validateAll(nextContent);
    if (issues.length) { refuse(issues); process.exit(1); }
    writeFileSync(ARENA, JSON.stringify(nextArena, null, 2) + '\n');
    console.log(`✅ covers[${index}] 移动到 (${pos[0]}, ${pos[1]})`);
    break;
  }

  default:
    console.log('命令：validate | list <covers|entities|tuning> | tune <dot.path> <number> | move-enemy <name> --pos x,z | move-cover <i> --pos x,z');
    process.exit(cmd ? 1 : 0);
}
