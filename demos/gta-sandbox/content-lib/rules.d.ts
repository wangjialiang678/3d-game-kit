/** 类型声明：content-lib/rules.mjs */
import type { Issue } from './core';

export interface RuleAction { action: string; [k: string]: any; }
export interface Rule { on: string; if?: { minLevel?: number }; do: RuleAction[]; }
export interface RulesPack { version: number; rules: Rule[]; }

export const EVENTS: string[];
export const RULE_TRIGGER_EVENTS: string[];
export const ACTIONS: Record<string, {
  validate(params: any, content: any): string | null;
  simulate(params: any, content: any, state: any): void;
}>;
export function resolvePoint(name: string, content: any): [number, number] | null;
export function evalCondition(cond: any, eventData: any): boolean;
export function validateRules(rulesPack: RulesPack, content: any): Issue[];
export function simulateEvent(rulesPack: RulesPack, content: any, state: any, eventName: string, eventData?: any): any;
