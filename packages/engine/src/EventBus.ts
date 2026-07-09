type Handler = (data?: any) => void;
type Tap = (event: string, data?: any) => void;

class EventBusClass {
  private registered = new Set<string>();
  private handlers = new Map<string, Handler[]>();
  private taps: Tap[] = [];

  register(...events: string[]): void {
    for (const event of events) this.registered.add(event);
  }

  on(event: string, h: Handler): void {
    this.warnUnknown(event);
    const list = this.handlers.get(event) ?? [];
    list.push(h);
    this.handlers.set(event, list);
  }

  emit(event: string, data?: any): void {
    this.warnUnknown(event);
    for (const tap of [...this.taps]) tap(event, data);
    for (const h of [...(this.handlers.get(event) ?? [])]) h(data);
  }

  tap(fn: Tap): void {
    this.taps.push(fn);
  }

  reset(): void {
    this.handlers.clear();
    this.taps = [];
  }

  private warnUnknown(event: string): void {
    if (!this.registered.has(event)) console.warn(`[EventBus] 未注册事件 "${event}"`);
  }
}

export const EventBus = new EventBusClass();
export type { Handler };
