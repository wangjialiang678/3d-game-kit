type Tap = (event: string, data?: any) => void;
type EventBusLike = { tap(fn: Tap): void; emit?(event: string, data?: any): void };
type InputLike = {
  SnapshotKeys?(): string[];
  LastMouseDelta?: { dx: number; dy: number };
  SetReplayMode?(enabled: boolean): void;
  Release?(code: string): void;
  Press?(code: string): void;
  AccumulateMouse?(dx: number, dy: number): void;
};

export interface WatchdogAlert {
  key: string;
  message: string;
  data?: any;
}

export interface FlightRecorderOptions {
  game: any;
  state: () => any | null;
  finalState: () => any;
  contentFingerprint?: () => string | null | undefined;
  eventBus?: EventBusLike;
  input?: InputLike;
  watchdogs?: Array<(state: any) => WatchdogAlert | null | undefined>;
  compareFinalState?: (expected: any, actual: any) => { match: boolean; detail?: any };
  sampleHz?: number;
  keepSamples?: number;
  inputKeep?: number;
  keyCodes?: string[];
  exposeGlobal?: string;
}

const hasDocument = () => typeof document !== 'undefined';
const hasWindow = () => typeof window !== 'undefined';

export default class FlightRecorder {
  private opts: FlightRecorderOptions;
  private ring: any[] = [];
  private events: any[] = [];
  private inputs: any[] = [];
  private prevKeys = new Set<string>();
  private replayInputs: any[] = [];
  private replayIndex = 0;
  private replaying = false;
  private replayDone = false;
  private replayEndTick = 0;
  private replayFinalState: any = null;
  private alerted: Record<string, number> = {};
  private banner: HTMLElement | null = null;
  private sampleTimer: any = null;
  private watchdogTimer: any = null;

  constructor(options: FlightRecorderOptions) {
    this.opts = {
      sampleHz: 5,
      keepSamples: 600,
      inputKeep: 36_000,
      keyCodes: ['KeyW', 'KeyA', 'KeyS', 'KeyD'],
      exposeGlobal: '__flight',
      ...options,
    };
    if (hasWindow() && this.opts.exposeGlobal) (window as any)[this.opts.exposeGlobal] = this;
    this.opts.eventBus?.tap((event, data) => this.event(event, data));
    this.installBanner();
    this.sampleTimer = setInterval(() => this.sample(), 1000 / this.opts.sampleHz!);
    this.watchdogTimer = setInterval(() => this.watchdog(), 1000);
    if (hasDocument()) {
      document.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).code === 'F9') this.download();
      });
    }
  }

  event(name: string, data?: any) {
    this.events.push({ tick: this.opts.game.tick ?? 0, t: +performance.now().toFixed(0), name, ...data });
    if (this.events.length > 400) this.events.shift();
  }

  recordInputTick(tick: number) {
    const input = this.opts.input;
    if (this.replaying || !input?.SnapshotKeys) return;
    const keys = new Set(input.SnapshotKeys());
    const keysDown = [...keys].filter((k) => !this.prevKeys.has(k));
    const keysUp = [...this.prevKeys].filter((k) => !keys.has(k));
    const mouse = input.LastMouseDelta ?? { dx: 0, dy: 0 };
    const entry: any = { tick };
    if (keysDown.length) entry.keysDown = keysDown;
    if (keysUp.length) entry.keysUp = keysUp;
    if (mouse.dx || mouse.dy) entry.mouse = [mouse.dx, mouse.dy];
    if (entry.keysDown || entry.keysUp || entry.mouse) {
      this.inputs.push(entry);
      if (this.inputs.length > this.opts.inputKeep!) this.inputs.shift();
    }
    this.prevKeys = keys;
  }

  loadReplay(dumpJson: any) {
    const dump = typeof dumpJson === 'string' ? JSON.parse(dumpJson) : dumpJson;
    const fp = this.opts.contentFingerprint?.();
    if (dump.contentFingerprint && fp && dump.contentFingerprint !== fp) {
      console.warn(`[replay] content fingerprint mismatch dump=${dump.contentFingerprint} current=${fp}`);
      this.opts.eventBus?.emit?.('toast', { text: '回放内容指纹不一致，仍继续尝试重演' });
    }
    this.replayInputs = [...(dump.inputs ?? [])].sort((a, b) => a.tick - b.tick);
    this.replayIndex = 0;
    this.replayFinalState = dump.finalState ?? null;
    const lastReplayInput = this.replayInputs.length ? this.replayInputs[this.replayInputs.length - 1] : null;
    this.replayEndTick = this.replayFinalState?.tick ?? (lastReplayInput?.tick ?? 0);
    this.replaying = true;
    this.replayDone = false;
    this.prevKeys = new Set();
    this.opts.input?.SetReplayMode?.(true);
    console.log(`[replay] loaded inputs=${this.replayInputs.length} seed=${dump.runSeed ?? 'unknown'} endTick=${this.replayEndTick}`);
  }

  replay(dumpJson: any) {
    this.loadReplay(dumpJson);
  }

  applyReplayTick(tick: number) {
    const input = this.opts.input;
    if (!this.replaying || this.replayDone || !input) return;
    while (this.replayIndex < this.replayInputs.length && this.replayInputs[this.replayIndex].tick <= tick) {
      const entry = this.replayInputs[this.replayIndex++];
      for (const code of entry.keysUp ?? []) input.Release?.(code);
      for (const code of entry.keysDown ?? []) input.Press?.(code);
      if (entry.mouse) input.AccumulateMouse?.(entry.mouse[0], entry.mouse[1]);
    }
  }

  afterReplayTick(tick: number) {
    if (!this.replaying || this.replayDone) return;
    if (tick >= this.replayEndTick && this.replayIndex >= this.replayInputs.length) this.finishReplay(tick);
  }

  private finishReplay(tick: number) {
    this.replayDone = true;
    this.replaying = false;
    const actual = this.opts.finalState();
    const pos = actual?.playerPos ?? [NaN, NaN];
    console.log(`[replay] done tick=${tick} playerPos=(${pos[0]},${pos[1]})`);
    if (this.replayFinalState) {
      const result = this.opts.compareFinalState?.(this.replayFinalState, actual) ?? this.defaultCompareFinalState(this.replayFinalState, actual);
      console.log(result.match ? 'REPLAY_MATCH' : `REPLAY_MISMATCH ${JSON.stringify({ ...result.detail, expected: this.replayFinalState, actual })}`);
    }
    this.opts.input?.SetReplayMode?.(false);
  }

  private defaultCompareFinalState(expected: any, actual: any) {
    const detail: any = {};
    if (expected?.playerPos) {
      const [ex, ez] = expected.playerPos;
      const [ax, az] = actual?.playerPos ?? [NaN, NaN];
      detail.playerDist = Math.hypot((ax ?? NaN) - ex, (az ?? NaN) - ez);
      if (!(detail.playerDist < 0.5)) return { match: false, detail };
    }
    for (const key of Object.keys(expected ?? {})) {
      if (key === 'tick' || key === 'playerPos') continue;
      if (JSON.stringify(expected[key]) !== JSON.stringify(actual?.[key])) {
        detail.key = key;
        detail.expectedValue = expected[key];
        detail.actualValue = actual?.[key];
        return { match: false, detail };
      }
    }
    return { match: true, detail };
  }

  private sample() {
    const s = this.opts.state();
    if (!s) return;
    this.ring.push(s);
    if (this.ring.length > this.opts.keepSamples!) this.ring.shift();
  }

  private watchdog() {
    const s = this.opts.state();
    if (!s) return;
    for (const check of this.opts.watchdogs ?? []) {
      const alert = check(s);
      if (alert) this.alert(alert.key, alert.message, alert.data);
    }
  }

  private installBanner() {
    if (!hasDocument()) return;
    this.banner = document.createElement('div');
    this.banner.style.cssText = 'position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:60;display:none;'
      + 'background:#7a2b2b;color:#ffd9d9;padding:8px 18px;border-radius:6px;font:700 14px Arial;';
    document.body.appendChild(this.banner);
  }

  private alert(key: string, msg: string, data: any) {
    const now = performance.now();
    if (now - (this.alerted[key] || 0) < 8000) return;
    this.alerted[key] = now;
    this.event('BUG:' + key, data);
    console.warn(`[flight] ${msg}`, data);
    if (this.banner) {
      this.banner.textContent = `${msg} - 按 F9 下载诊断包发给老师/AI`;
      this.banner.style.display = 'block';
      setTimeout(() => { if (this.banner) this.banner.style.display = 'none'; }, 6000);
    }
  }

  dump() {
    return {
      when: new Date().toISOString(),
      contentName: this.opts.game.content?.scene?.name ?? this.opts.game.content?.arena?.name,
      contentFingerprint: this.opts.contentFingerprint?.(),
      runSeed: this.opts.game.runSeed,
      finalState: this.opts.finalState(),
      inputs: this.inputs.map((i) => ({
        tick: i.tick,
        ...(i.keysDown ? { keysDown: [...i.keysDown] } : {}),
        ...(i.keysUp ? { keysUp: [...i.keysUp] } : {}),
        ...(i.mouse ? { mouse: [...i.mouse] } : {}),
      })),
      events: this.events.map((e) => ({ ...e })),
      ring: this.ring.map((s) => ({ ...s })),
    };
  }

  download() {
    if (!hasDocument()) return;
    const blob = new Blob([JSON.stringify(this.dump(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `flight-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.event('dump-downloaded');
  }

  dispose() {
    clearInterval(this.sampleTimer);
    clearInterval(this.watchdogTimer);
    if (this.banner?.parentElement) this.banner.parentElement.removeChild(this.banner);
  }
}
