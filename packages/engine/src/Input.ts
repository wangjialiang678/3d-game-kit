/**
 * Input — global keyboard/mouse singleton (port of the original three-fps Input.js).
 * Components subscribe to mouse/keyboard events; keys are polled via GetKeyDown.
 */
type Handler = (e: any) => void;

class InputManager {
  private keys: Record<string, boolean> = {};
  private mouseMove: Handler[] = [];
  private mouseDown: Handler[] = [];
  private mouseUp: Handler[] = [];
  private click: Handler[] = [];
  private keyDown: Handler[] = [];
  private pointerLocked = false;
  private replayMode = false;
  private mouseDX = 0;
  private mouseDY = 0;
  private lastMouseDelta = { dx: 0, dy: 0 };

  constructor() {
    document.addEventListener('keydown', (e) => {
      if (this.replayMode) return;
      this.keys[e.code] = true;
      this.keyDown.forEach((h) => h(e));
    });
    document.addEventListener('keyup', (e) => {
      if (this.replayMode) return;
      this.keys[e.code] = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (this.replayMode) return;
      if (this.pointerLocked) this.AccumulateMouse(e.movementX, e.movementY);
      this.mouseMove.forEach((h) => h(e));
    });
    document.addEventListener('mousedown', (e) => {
      if (this.replayMode) return;
      this.mouseDown.forEach((h) => h(e));
    });
    document.addEventListener('mouseup', (e) => {
      if (this.replayMode) return;
      this.mouseUp.forEach((h) => h(e));
    });
    document.addEventListener('click', (e) => {
      if (this.replayMode) return;
      this.click.forEach((h) => h(e));
    });
    // Clear held keys when focus / pointer-lock is lost — otherwise a missed
    // keyup leaves a key "stuck down" and the character keeps moving on its own.
    window.addEventListener('blur', () => { if (!this.replayMode) this.ResetState(); });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = !!document.pointerLockElement;
      if (!this.pointerLocked && !this.replayMode) this.ResetState();
    });
  }

  GetKeyDown(code: string): number {
    return this.keys[code] ? 1 : 0;
  }

  get PointerLocked(): boolean {
    return this.pointerLocked;
  }

  get ReplayMode(): boolean {
    return this.replayMode;
  }

  get LastMouseDelta(): { dx: number; dy: number } {
    return { ...this.lastMouseDelta };
  }

  RequestPointerLock(): void {
    document.body.requestPointerLock();
  }

  SetReplayMode(enabled: boolean): void {
    this.replayMode = enabled;
    this.ResetState();
  }

  ResetState(): void {
    this.keys = {};
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.lastMouseDelta = { dx: 0, dy: 0 };
  }

  SnapshotKeys(): string[] {
    return Object.keys(this.keys).filter((k) => this.keys[k]).sort();
  }

  AccumulateMouse(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  ConsumeMouseDelta(): { dx: number; dy: number } {
    const delta = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.lastMouseDelta = delta;
    return delta;
  }

  /** 编程式按键（测试机器人/录像回放用）——走与真实键盘完全相同的路径。 */
  Press(code: string): void {
    const repeat = !!this.keys[code];
    this.keys[code] = true;
    const e = { code, repeat } as KeyboardEvent;
    this.keyDown.forEach((h) => h(e));
  }
  Release(code: string): void {
    this.keys[code] = false;
  }

  AddMouseMoveListner(h: Handler) { this.mouseMove.push(h); }
  AddMouseDownListner(h: Handler) { this.mouseDown.push(h); }
  AddMouseUpListner(h: Handler) { this.mouseUp.push(h); }
  AddClickListner(h: Handler) { this.click.push(h); }
  AddKeyDownListner(h: Handler) { this.keyDown.push(h); }

  ClearEventListners() {
    this.mouseMove = [];
    this.mouseDown = [];
    this.mouseUp = [];
    this.click = [];
    this.keyDown = [];
    this.ResetState();
  }
}

const Input = new InputManager();
export default Input;
