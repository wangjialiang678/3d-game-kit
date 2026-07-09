/**
 * AutoTest — 页内试玩机器人包装层。
 * 真实路线/驾驶/逃逸逻辑在 BotCore，供浏览器 playtest 与 Node headless 共用。
 */
import BotCore, { type BotResult, type StepResult } from './BotCore';

export default class AutoTest {
  private g: any;
  private hud: HTMLElement;
  private bot!: BotCore;
  private timer: number | null = null;

  constructor(game: any) {
    this.g = game;
    this.hud = document.createElement('div');
    this.hud.style.cssText = 'position:fixed;left:24px;top:110px;z-index:40;color:#7cf27c;font:700 14px monospace;text-shadow:0 1px 3px #000;white-space:pre;';
    document.body.appendChild(this.hud);
  }

  private render(message: string, steps: StepResult[]) {
    this.hud.textContent =
      `🤖 AUTOTEST\n${steps.map(s => `${s.pass ? '✅' : '❌'} ${s.name} (${(s.ms / 1000).toFixed(1)}s)`).join('\n')}\n▶ ${message}`;
  }

  run() {
    this.bot = new BotCore(this.g, {
      onLog: (message, steps) => this.render(message, steps),
      onDone: (result) => this.finish(result),
    });
    this.timer = window.setInterval(() => this.bot.tick(0.05), 50);
  }

  private finish(result: BotResult) {
    if (this.timer !== null) window.clearInterval(this.timer);
    (window as any).__autotest = result;
    document.title = result.pass ? 'AUTOTEST PASS' : 'AUTOTEST FAIL';
    this.render(result.pass ? '全部通过' : '存在失败步骤（后续步骤已跳过）', result.steps);
    console.log('[autotest]', JSON.stringify(result, null, 2));
  }
}
