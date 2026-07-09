/**
 * rules.mjs — ECA 规则引擎的纯逻辑核心（双端共用：游戏 / CLI / L1 模拟器）。
 *
 * 设计原则（AI 编辑的护栏所在）：
 *   1. 动作词汇表是**封闭**的：只有 ACTIONS 里注册过的动作能用，AI 不能发明新动作
 *   2. 每个动作**自带校验**：teleport_player 只接受内容包命名点位且落点必须是空地——
 *      "传送进建筑里"这类 bug 在规则层是**写不出来**的（对比：代码层写 (0,0) 没人拦）
 *   3. 规则是数据：可 diff、可校验、可在 L1 无渲染模拟——不用开浏览器就能测逻辑
 * 纯函数、无 DOM、无渲染依赖。
 */
import { insideAnyBlock } from './core.mjs';
import { EVENTS } from './events.mjs';
import { createRulesCore } from '@kit/core/rules-core.mjs';

export { EVENTS };
// toast 是呈现事件，同时 toast 动作也会发 toast；禁止作为规则触发源，避免数据写出 toast→toast 递归。
export const RULE_TRIGGER_EVENTS = EVENTS.filter((e) => e !== 'toast');

/** 命名点位解析：规则里只允许引用内容包点位，不允许裸坐标。 */
export function resolvePoint(name, content) {
  if (name === 'spawns.player') { const p = content.scene.spawns.player; return [p[0], p[2]]; }
  if (name === 'spawns.car') { const p = content.scene.spawns.car.pos; return [p[0], p[2]]; }
  const m = /^mission\.(\d+)$/.exec(name);
  if (m) { const pos = content.missions[+m[1]]?.pos; return pos ? [pos[0], pos[1]] : null; }
  return null;
}

/** 封闭动作词汇表：validate(纯校验) + simulate(抽象状态执行，L1 用)。游戏侧真实执行器在 RuleSystem。 */
export const ACTIONS = {
  teleport_player: {
    validate(p, content) {
      if (!p.to) return 'teleport_player 缺少 to（命名点位）';
      const pt = resolvePoint(p.to, content);
      if (!pt) return `未知点位 "${p.to}"（可用：spawns.player / spawns.car / mission.<i>）`;
      if (insideAnyBlock(content.blocks, pt[0], pt[1], 1.0)) return `点位 ${p.to}(${pt[0]},${pt[1]}) 在建筑内，禁止作为传送目标`;
      return null;
    },
    simulate(p, content, state) { state.playerPos = resolvePoint(p.to, content); },
  },
  toast: {
    validate(p) { return p.text?.trim() ? null : 'toast 缺少 text'; },
    simulate(p, _c, state) { state.toasts.push(p.text); },
  },
};

const core = createRulesCore({ triggerEvents: RULE_TRIGGER_EVENTS, actions: ACTIONS });

/** 条件求值（受限词汇：目前支持 minLevel）。 */
export const evalCondition = core.evalCondition;
/** L0：规则包静态校验——事件名/动作名/参数/点位全部合法才放行。 */
export const validateRules = core.validateRules;
/** L1：抽象执行一个事件——不渲染、不开浏览器，纯状态推演。 */
export const simulateEvent = core.simulateEvent;
