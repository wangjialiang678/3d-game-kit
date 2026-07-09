/** 极简事件总线：玩法系统发事件，RuleSystem（和飞行记录仪）订阅。 */
type Handler = (data?: any) => void;
const handlers: Record<string, Handler[]> = {};

export const Bus = {
  on(event: string, h: Handler) { (handlers[event] ??= []).push(h); },
  emit(event: string, data?: any) {
    (window as any).__flight?.event(event, data);   // 所有事件自动进黑匣子
    for (const h of handlers[event] ?? []) h(data);
  },
};
