import { EVENTS } from './events.mjs';
import { createRulesCore } from '@kit/core/rules-core.mjs';

export { EVENTS };
export const RULE_TRIGGER_EVENTS = EVENTS.filter((event) => event !== 'toast');

export const ACTIONS = {
  toast: {
    validate(p) { return p.text?.trim() ? null : 'toast 缺少 text'; },
    simulate(p, _content, state) { state.toasts.push(p.text); },
  },
};

const core = createRulesCore({ triggerEvents: RULE_TRIGGER_EVENTS, actions: ACTIONS });

export const evalCondition = core.evalCondition;
export const validateRules = core.validateRules;
export const simulateEvent = core.simulateEvent;
