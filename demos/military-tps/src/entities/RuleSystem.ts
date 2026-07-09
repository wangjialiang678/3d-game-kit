import { Component } from '@engine';
import { Bus } from '../events';
import { RULE_TRIGGER_EVENTS, evalCondition } from '../../content-lib/rules.mjs';
import type { Content } from '../content/ContentLoader';
import type { RulesPack } from '../../content-lib/rules';

export default class RuleSystem extends Component {
  private rules: RulesPack;
  private content: Content;

  constructor(rules: RulesPack, content: Content) {
    super();
    this.name = 'RuleSystem';
    this.rules = rules;
    this.content = content;
  }

  Initialize(): void {
    for (const event of RULE_TRIGGER_EVENTS) Bus.on(event, (data) => this.run(event, data));
  }

  private run(eventName: string, data?: any) {
    for (const rule of this.rules.rules ?? []) {
      if (rule.on !== eventName || !evalCondition(rule.if, data)) continue;
      for (const action of rule.do ?? []) this.exec(action);
    }
  }

  private exec(action: any) {
    switch (action.action) {
      case 'toast':
        Bus.emit('toast', { text: action.text });
        break;
      default:
        console.error(`[rules] 未注册的动作 ${action.action}`, this.content.arena.name);
    }
  }
}
