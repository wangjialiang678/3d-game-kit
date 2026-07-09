export interface Issue {
  where: string;
  message: string;
}

export interface RuleActionSpec<TContent = any, TState = any> {
  validate?: (params: any, content: TContent) => string | null | undefined;
  simulate?: (params: any, content: TContent, state: TState) => void;
}

export interface RulesCoreOptions<TContent = any, TState = any> {
  events?: string[];
  triggerEvents?: string[];
  excludedTriggerEvents?: string[];
  actions: Record<string, RuleActionSpec<TContent, TState>>;
}

export function triggerEvents(events: string[], excluded?: string[]): string[];
export function evalCondition(cond: any, eventData?: any): boolean;
export function validateRules<TContent = any, TState = any>(rulesPack: any, content: TContent, options: RulesCoreOptions<TContent, TState>): Issue[];
export function simulateEvent<TContent = any, TState = any>(
  rulesPack: any,
  content: TContent,
  state: TState,
  eventName: string,
  eventData: any,
  options: RulesCoreOptions<TContent, TState>
): TState;
export function createRulesCore<TContent = any, TState = any>(options: RulesCoreOptions<TContent, TState>): {
  RULE_TRIGGER_EVENTS: string[];
  evalCondition: typeof evalCondition;
  validateRules: (rulesPack: any, content: TContent) => Issue[];
  simulateEvent: (rulesPack: any, content: TContent, state: TState, eventName: string, eventData?: any) => TState;
};
