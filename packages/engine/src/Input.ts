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

  constructor() {
    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      this.keyDown.forEach((h) => h(e));
    });
    document.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    document.addEventListener('mousemove', (e) => this.mouseMove.forEach((h) => h(e)));
    document.addEventListener('mousedown', (e) => this.mouseDown.forEach((h) => h(e)));
    document.addEventListener('mouseup', (e) => this.mouseUp.forEach((h) => h(e)));
    document.addEventListener('click', (e) => this.click.forEach((h) => h(e)));
    // Clear held keys when focus / pointer-lock is lost — otherwise a missed
    // keyup leaves a key "stuck down" and the character keeps moving on its own.
    window.addEventListener('blur', () => { this.keys = {}; });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) this.keys = {}; });
  }

  GetKeyDown(code: string): number {
    return this.keys[code] ? 1 : 0;
  }

  /** 编程式按键（测试机器人/录像回放用）——走与真实键盘完全相同的路径。 */
  Press(code: string): void {
    this.keys[code] = true;
    const e = { code, repeat: false } as KeyboardEvent;
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
    this.keys = {};
  }
}

const Input = new InputManager();
export default Input;
