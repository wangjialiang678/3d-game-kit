/**
 * FlightRecorder — 常驻飞行记录仪（黑匣子）+ 卡死/穿模看门狗。
 *
 * 解决的问题：玩家/学员反馈"我卡住了/穿模了"却拿不出现场——
 *   1) 黑匣子：5Hz 环形缓冲最近 2 分钟的游戏状态 + 关键事件（被捕/上下车/星级/任务）
 *   2) 看门狗（不靠截图的状态断言，每秒巡检）：
 *      - 卡死：方向键按住 >2s 但位移≈0
 *      - 穿模：玩家胶囊中心落在任一建筑 AABB 内
 *      触发即记事件 + 屏幕横幅提示
 *   3) F9 一键下载诊断包 JSON（含快照环 + 事件流 + 内容包指纹），学员直接把文件发给老师/AI
 */
import { EventBus, Input } from '@engine';
import { contentFingerprint, insideAnyBlock } from '../../content-lib/core.mjs';

const HZ = 5, KEEP = 600;          // 5Hz × 120s
const INPUT_KEEP = 36_000;         // 60Hz × 10min
const STUCK_SECS = 2;

export default class FlightRecorder {
  private g: any;
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
  private banner: HTMLElement;
  private lastPos = { x: 0, z: 0 };
  private stuckFor = 0;
  private alerted: Record<string, number> = {};

  constructor(game: any) {
    this.g = game;
    (window as any).__flight = this;
    EventBus.tap((event, data) => this.event(event, data));
    this.banner = document.createElement('div');
    this.banner.style.cssText = 'position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:60;display:none;'
      + 'background:#7a2b2b;color:#ffd9d9;padding:8px 18px;border-radius:6px;font:700 14px Arial;';
    document.body.appendChild(this.banner);
    setInterval(() => this.sample(), 1000 / HZ);
    setInterval(() => this.watchdog(), 1000);
    document.addEventListener('keydown', (e) => { if (e.code === 'F9') this.download(); });
  }

  /** 组件在关键时刻调用：__flight.event('bust', {...}) */
  event(name: string, data?: any) {
    this.events.push({ tick: this.g.tick ?? 0, t: +performance.now().toFixed(0), name, ...data });
    if (this.events.length > 400) this.events.shift();
  }

  private cars(): any[] {
    const entities = this.g.em?.GetAll?.((e: any) => !!e.GetComponent('Car')) ?? [];
    return entities.map((e: any) => e.GetComponent('Car'));
  }

  private activeCar(): any | null {
    return this.cars().find((car: any) => car.Active) ?? null;
  }

  private state() {
    const g = this.g;
    const of = g.em?.Get('Player')?.GetComponent('OnFootPlayer');
    const car = this.activeCar() ?? this.cars()[0];
    const w = g.em?.Get('Wanted')?.GetComponent('WantedSystem');
    const ms = g.em?.Get('Missions')?.GetComponent('MissionSystem');
    if (!of) return null;
    const cap = of.character?.body?.translation?.();
    return {
      t: +performance.now().toFixed(0),
      mode: car?.Active ? 'car' : 'foot',
      pos: cap ? [+cap.x.toFixed(1), +cap.y.toFixed(2), +cap.z.toFixed(1)] : null,
      carPos: car ? [+car.Position.x.toFixed(1), +car.Position.z.toFixed(1)] : null,
      wanted: w?.Level ?? 0, mission: ms?.idx ?? 0,
      keys: ['KeyW', 'KeyA', 'KeyS', 'KeyD'].filter(k => Input.GetKeyDown(k)),
    };
  }

  private finalState() {
    const car = this.activeCar();
    const player = this.g.em?.Get('Player');
    const p = car?.Active ? car.Position : player?.Position;
    const w = this.g.em?.Get('Wanted')?.GetComponent('WantedSystem');
    const ms = this.g.em?.Get('Missions')?.GetComponent('MissionSystem');
    return {
      tick: this.g.tick ?? 0,
      playerPos: p ? [+p.x.toFixed(3), +p.z.toFixed(3)] : null,
      wanted: w?.Level ?? 0,
      mission: ms?.idx ?? 0,
    };
  }

  recordInputTick(tick: number) {
    if (this.replaying) return;
    const keys = new Set(Input.SnapshotKeys());
    const keysDown = [...keys].filter((k) => !this.prevKeys.has(k));
    const keysUp = [...this.prevKeys].filter((k) => !keys.has(k));
    const mouse = Input.LastMouseDelta;
    const entry: any = { tick };
    if (keysDown.length) entry.keysDown = keysDown;
    if (keysUp.length) entry.keysUp = keysUp;
    if (mouse.dx || mouse.dy) entry.mouse = [mouse.dx, mouse.dy];
    if (entry.keysDown || entry.keysUp || entry.mouse) {
      this.inputs.push(entry);
      if (this.inputs.length > INPUT_KEEP) this.inputs.shift();
    }
    this.prevKeys = keys;
  }

  loadReplay(dumpJson: any) {
    const dump = typeof dumpJson === 'string' ? JSON.parse(dumpJson) : dumpJson;
    const fp = contentFingerprint(this.g.content);
    if (dump.contentFingerprint && dump.contentFingerprint !== fp) {
      console.warn(`[replay] content fingerprint mismatch dump=${dump.contentFingerprint} current=${fp}`);
      EventBus.emit('toast', { text: '回放内容指纹不一致，仍继续尝试重演' });
    }
    if (dump.runSeed !== undefined && dump.runSeed !== this.g.runSeed) {
      console.warn(`[replay] runSeed mismatch dump=${dump.runSeed} current=${this.g.runSeed}`);
      this.g.em?.Get('Wanted')?.GetComponent('WantedSystem')?.setSeed?.(dump.runSeed);
    }

    this.replayInputs = [...(dump.inputs ?? [])].sort((a, b) => a.tick - b.tick);
    this.replayIndex = 0;
    this.replayFinalState = dump.finalState ?? null;
    const lastReplayInput = this.replayInputs.length ? this.replayInputs[this.replayInputs.length - 1] : null;
    this.replayEndTick = this.replayFinalState?.tick ?? (lastReplayInput?.tick ?? 0);
    this.replaying = true;
    this.replayDone = false;
    this.prevKeys = new Set();
    Input.SetReplayMode(true);
    console.log(`[replay] loaded inputs=${this.replayInputs.length} seed=${dump.runSeed ?? 'unknown'} endTick=${this.replayEndTick}`);
  }

  replay(dumpJson: any) {
    this.loadReplay(dumpJson);
  }

  applyReplayTick(tick: number) {
    if (!this.replaying || this.replayDone) return;
    while (this.replayIndex < this.replayInputs.length && this.replayInputs[this.replayIndex].tick <= tick) {
      const entry = this.replayInputs[this.replayIndex++];
      for (const code of entry.keysUp ?? []) Input.Release(code);
      for (const code of entry.keysDown ?? []) Input.Press(code);
      if (entry.mouse) Input.AccumulateMouse(entry.mouse[0], entry.mouse[1]);
    }
  }

  afterReplayTick(tick: number) {
    if (!this.replaying || this.replayDone) return;
    if (tick >= this.replayEndTick && this.replayIndex >= this.replayInputs.length) this.finishReplay(tick);
  }

  private finishReplay(tick: number) {
    this.replayDone = true;
    this.replaying = false;
    const actual = this.finalState();
    const pos = actual.playerPos ?? [NaN, NaN];
    console.log(`[replay] done tick=${tick} playerPos=(${pos[0]},${pos[1]})`);

    if (this.replayFinalState?.playerPos) {
      const [ex, ez] = this.replayFinalState.playerPos;
      const dist = Math.hypot((pos[0] ?? NaN) - ex, (pos[1] ?? NaN) - ez);
      const match = dist < 0.5 &&
        actual.wanted === this.replayFinalState.wanted &&
        actual.mission === this.replayFinalState.mission;
      console.log(match ? 'REPLAY_MATCH' : `REPLAY_MISMATCH ${JSON.stringify({ dist, expected: this.replayFinalState, actual })}`);
    }
    Input.SetReplayMode(false);
  }

  private sample() {
    const s = this.state();
    if (!s) return;
    this.ring.push(s);
    if (this.ring.length > KEEP) this.ring.shift();
  }

  private alert(key: string, msg: string, data: any) {
    const now = performance.now();
    if (now - (this.alerted[key] || 0) < 8000) return;   // 同类告警 8s 冷却
    this.alerted[key] = now;
    this.event('BUG:' + key, data);
    console.warn(`[flight] 🐞 ${msg}`, data);
    this.banner.textContent = `🐞 ${msg} — 按 F9 下载诊断包发给老师/AI`;
    this.banner.style.display = 'block';
    setTimeout(() => { this.banner.style.display = 'none'; }, 6000);
  }

  /** 状态断言巡检（不需要截图就能发现卡死/穿模） */
  private watchdog() {
    const s = this.state();
    if (!s?.pos || !this.g.content) return;
    const [x, , z] = s.pos;
    // 断言1：穿模——玩家中心在建筑 AABB 内
    if (s.mode === 'foot' && insideAnyBlock(this.g.content.blocks, x, z, -0.1)) {
      this.alert('inside-block', '检测到玩家卡进建筑内部', { pos: s.pos });
    }
    // 断言2：卡死——按着方向键却不动
    const moving = Math.hypot(x - this.lastPos.x, z - this.lastPos.z) > 0.3;
    const pressing = s.keys.length > 0;
    this.stuckFor = pressing && !moving ? this.stuckFor + 1 : 0;
    if (this.stuckFor >= STUCK_SECS) {
      this.alert('stuck', '检测到按键卡死（按住方向键但无位移）', { pos: s.pos, keys: s.keys, mode: s.mode });
    }
    this.lastPos = { x, z };
  }

  /** 诊断包：快照环 + 事件流 + 内容包指纹 */
  dump() {
    return {
      when: new Date().toISOString(),
      contentName: this.g.content?.scene?.name,
      contentFingerprint: contentFingerprint(this.g.content),
      runSeed: this.g.runSeed,
      finalState: this.finalState(),
      inputs: this.inputs.map((i) => ({
        tick: i.tick,
        ...(i.keysDown ? { keysDown: [...i.keysDown] } : {}),
        ...(i.keysUp ? { keysUp: [...i.keysUp] } : {}),
        ...(i.mouse ? { mouse: [...i.mouse] } : {}),
      })),
      blocks: this.g.content?.blocks?.length,
      missions: this.g.content?.missions?.length,
      events: this.events.map((e) => ({ ...e })),
      ring: this.ring.map((s) => ({ ...s })),
    };
  }

  download() {
    const blob = new Blob([JSON.stringify(this.dump(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `flight-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.event('dump-downloaded');
  }
}
