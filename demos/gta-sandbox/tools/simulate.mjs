#!/usr/bin/env node
/**
 * simulate.mjs — L1 抽象层模拟器：**不渲染、不开浏览器**，纯逻辑推演游戏内容。
 *
 * 验证金字塔里的中间层：
 *   L0 静态校验（微秒）→ 本文件先跑一遍
 *   L1 抽象模拟（毫秒）→ 本文件的主体：把事件喂给规则引擎的抽象执行器，断言状态
 *   L2 渲染验证（分钟）→ tools/playtest.mjs（只留给"必须看见"的问题）
 *
 * 今天那个"被捕传送进楼里"的 bug，在这里 1 毫秒就会被抓住——不需要截图。
 *
 *   node tools/simulate.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { materializeBlocks, validateContent, insideAnyBlock } from '../content-lib/core.mjs';
import { validateRules, simulateEvent, resolvePoint } from '../content-lib/rules.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (f) => JSON.parse(readFileSync(join(ROOT, 'public/content', f), 'utf8'));

const t0 = performance.now();
const scene = read('scene.json');
const missionsPack = read('missions.json');
const rules = read('rules.json');
const blocks = scene.blocks?.length ? scene.blocks : materializeBlocks(scene.town);
const content = { scene, missions: missionsPack.missions, blocks, rules };

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};

console.log('===== L0 静态校验 =====');
const l0 = [...validateContent(content), ...validateRules(rules, content)];
for (const i of l0) console.log(`  ⛔ [${i.where}] ${i.message}`);
check('内容包 + 规则包静态校验', l0.length === 0, `${blocks.length} 楼 / ${content.missions.length} 任务 / ${rules.rules.length} 规则`);

console.log('\n===== L1 抽象模拟（无渲染） =====');

// 场景1：被捕流程——今天那个 bug 的抽象重演
{
  const state = { playerPos: [-39, -39], wanted: 2, toasts: [] };
  simulateEvent(rules, content, state, 'busted', {});
  const [x, z] = state.playerPos;
  check('被捕后传送到出生点', x === scene.spawns.player[0] && z === scene.spawns.player[2], `→ (${x},${z})`);
  check('被捕落点不在任何建筑内', !insideAnyBlock(blocks, x, z, 1.0));
  check('被捕有玩家提示', state.toasts.some(t => t.includes('BUSTED')));
}

// 场景2：条件规则——3星警告只在≥3星时触发
{
  const s2 = { playerPos: [0, 13], toasts: [] };
  simulateEvent(rules, content, s2, 'wanted-raise', { level: 2 });
  check('2星不触发高星警告', s2.toasts.length === 0);
  simulateEvent(rules, content, s2, 'wanted-raise', { level: 3 });
  check('3星触发高星警告', s2.toasts.some(t => t.includes('警力')));
}

// 场景3：任务链可通关性（抽象走一遍）
{
  let ok = true, why = '';
  content.missions.forEach((m, i) => {
    if (m.pos && insideAnyBlock(blocks, m.pos[0], m.pos[1], 1.5)) { ok = false; why = `任务${i}点位在楼内`; }
    if (m.needCar && !scene.spawns.car) { ok = false; why = `任务${i}需要车但没有车`; }
  });
  check('任务链抽象可通关', ok, why);
}

// 性质检查：规则里所有 teleport 目标，换任何合法内容都必须落在空地
{
  let ok = true, why = '';
  for (const r of rules.rules) for (const a of r.do) {
    if (a.action !== 'teleport_player') continue;
    const pt = resolvePoint(a.to, content);
    if (!pt || insideAnyBlock(blocks, pt[0], pt[1], 1.0)) { ok = false; why = `${a.to} 非法`; }
  }
  check('全部 teleport 目标合法（性质检查）', ok, why);
}

const ms = (performance.now() - t0).toFixed(1);
console.log(`\n${failed === 0 ? '🎉 L0+L1 全部通过' : `💥 ${failed} 项失败`}（总耗时 ${ms}ms —— 对比 L2 渲染试玩约 40,000ms）`);
process.exit(failed === 0 ? 0 : 1);
