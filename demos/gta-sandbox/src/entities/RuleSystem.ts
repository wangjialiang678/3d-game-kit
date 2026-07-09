/**
 * RuleSystem — ECA 规则的游戏侧执行器。
 * 规则本体在 content/rules.json（数据），词汇表与校验在 content-lib/rules.mjs（双端共用）。
 * 这里只做一件事：把"抽象动作"绑定到真实组件效果——且真实执行器再叠一层运行时防御
 * （teleport_player 强制过 findClearSpot），数据层+运行时双保险。
 */
import * as THREE from 'three';
import { Component } from '@engine';
import { Bus } from '../events';
import { EVENTS, evalCondition, resolvePoint } from '../../content-lib/rules.mjs';
import { findClearSpot } from '../../content-lib/core.mjs';
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
    for (const ev of EVENTS) {
      Bus.on(ev, (data) => this.run(ev, data));
    }
  }

  private run(eventName: string, data?: any) {
    for (const r of this.rules.rules ?? []) {
      if (r.on !== eventName || !evalCondition(r.if, data)) continue;
      for (const a of r.do) this.exec(a);
    }
  }

  /** 真实执行器（与 rules.mjs 的抽象 simulate 一一对应） */
  private exec(a: any) {
    switch (a.action) {
      case 'teleport_player': {
        const pt = resolvePoint(a.to, this.content);
        if (!pt) return console.error(`[rules] 未知点位 ${a.to}`);
        // 运行时第二道防御：即使内容后来被改坏，也自愈到最近空地
        const [x, z] = findClearSpot(this.content.blocks, pt[0], pt[1], 1.0);
        this.FindEntity('Player')!.GetComponent('OnFootPlayer').activate(new THREE.Vector3(x, 1.2, z));
        break;
      }
      case 'toast':
        this.FindEntity('Wanted')?.GetComponent('WantedSystem')?.toast(a.text);
        break;
      default:
        console.error(`[rules] 未注册的动作 ${a.action}（词汇表之外，已忽略）`);
    }
  }
}
