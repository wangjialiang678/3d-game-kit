export function triggerEvents(events, excluded = ['toast']) {
  const deny = new Set(excluded);
  return (events ?? []).filter((event) => !deny.has(event));
}

/** Condition evaluator shared by ECA rule packs. Keep intentionally small. */
export function evalCondition(cond, eventData) {
  if (!cond) return true;
  if (cond.minLevel !== undefined && !((eventData?.level ?? 0) >= cond.minLevel)) return false;
  return true;
}

function actionNames(actions) {
  return Object.keys(actions ?? {}).join('/');
}

/** L0: validate event names, action names, and action-specific parameters. */
export function validateRules(rulesPack, content, options) {
  const events = options?.triggerEvents ?? triggerEvents(options?.events ?? [], options?.excludedTriggerEvents);
  const actions = options?.actions ?? {};
  const issues = [];
  (rulesPack?.rules ?? []).forEach((r, i) => {
    const tag = `rules[${i}]`;
    if (!events.includes(r.on)) issues.push({ where: tag, message: `未知规则触发事件 "${r.on}"（可用：${events.join('/')}）` });
    if (!Array.isArray(r.do) || !r.do.length) issues.push({ where: tag, message: '缺少 do 动作列表' });
    (r.do ?? []).forEach((a, j) => {
      const spec = actions[a.action];
      if (!spec) {
        issues.push({ where: `${tag}.do[${j}]`, message: `未知动作 "${a.action}"（词汇表：${actionNames(actions)}）` });
        return;
      }
      const err = spec.validate?.(a, content);
      if (err) issues.push({ where: `${tag}.do[${j}]`, message: err });
    });
  });
  return issues;
}

/** L1: simulate a single event against an abstract state object. */
export function simulateEvent(rulesPack, content, state, eventName, eventData, options) {
  const actions = options?.actions ?? {};
  for (const r of rulesPack?.rules ?? []) {
    if (r.on !== eventName || !evalCondition(r.if, eventData)) continue;
    for (const a of r.do ?? []) actions[a.action]?.simulate?.(a, content, state);
  }
  return state;
}

export function createRulesCore(options) {
  const events = options?.triggerEvents ?? triggerEvents(options?.events ?? [], options?.excludedTriggerEvents);
  const actions = options?.actions ?? {};
  return {
    RULE_TRIGGER_EVENTS: events,
    evalCondition,
    validateRules: (rulesPack, content) => validateRules(rulesPack, content, { triggerEvents: events, actions }),
    simulateEvent: (rulesPack, content, state, eventName, eventData) =>
      simulateEvent(rulesPack, content, state, eventName, eventData, { actions }),
  };
}
