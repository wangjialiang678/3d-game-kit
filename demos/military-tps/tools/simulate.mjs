#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from '@kit/core/sim-harness.mjs';
import { validateContent, validateTuning, insideAnyBlock, resolveEntityPoint } from '../content-lib/core.mjs';
import { validateRules, simulateEvent } from '../content-lib/rules.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => JSON.parse(readFileSync(join(ROOT, 'public/content', file), 'utf8'));

const arena = read('arena.json');
const rules = read('rules.json');
const tuning = read('tuning.json');
const content = { arena, rules, tuning };
const sim = harness('military-tps');

console.log('===== L0 静态校验 =====');
const l0 = [...validateContent(content), ...validateRules(rules, content), ...validateTuning(tuning)];
for (const issue of l0) console.log(`  ⛔ [${issue.where}] ${issue.message}`);
sim.check('内容包 + 规则包 + tuning 静态校验', l0.length === 0, `${arena.covers.length} 掩体 / ${arena.entities.length} 实例 / ${rules.rules.length} 规则`);

console.log('\n===== L1 抽象模拟（无渲染） =====');

{
  const state = { toasts: [] };
  simulateEvent(rules, content, state, 'all-enemies-dead', {});
  sim.check('敌人全灭触发胜利 toast', state.toasts.some((t) => String(t).includes('全歼')));
}

{
  const enemies = arena.entities.filter((e) => arena.prefabs[e.prefab]?.controller === 'SoldierNPC');
  sim.check('敌人实例数量为 5', enemies.length === 5, `actual=${enemies.length}`);
}

{
  let ok = true;
  let why = '';
  for (const [i, e] of arena.entities.entries()) {
    const pt = resolveEntityPoint(arena, e.at);
    if (!pt) { ok = false; why = `entities[${i}] at 无法解析`; break; }
    if (insideAnyBlock(arena.covers, pt[0], pt[1], 0.8)) { ok = false; why = `${e.name} 落在掩体内`; break; }
  }
  sim.check('出生点/敌人摆放合法', ok, why);
}

{
  const shotsToKill = Math.ceil(tuning.enemy.health / tuning.weapon.damage);
  const magazineEnoughForAll = tuning.weapon.ammoPerMag + tuning.weapon.reserveAmmo >= shotsToKill * 5;
  sim.check('默认弹药足够全歼敌人', magazineEnoughForAll, `need=${shotsToKill * 5}`);
}

sim.finish('L0+L1 全部通过');
