/**
 * AutoTest — 页内试玩机器人（P3：验证闭环）。
 * 用 `?autotest` 启动：机器人走真实输入路径（Input.Press/Release + 设定视角），
 * 像玩家一样打穿三个任务：步行到点 → 上车开到点 → 惹通缉再甩掉。
 * 结果写到 window.__autotest 和 document.title（PASS/FAIL），供无头运行器读取。
 */
import { Input } from '@engine';

interface StepResult { name: string; pass: boolean; ms: number; detail?: string; }

const now = () => performance.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export default class AutoTest {
  private g: any;
  private hud: HTMLElement;
  private steps: StepResult[] = [];

  constructor(game: any) {
    this.g = game;
    this.hud = document.createElement('div');
    this.hud.style.cssText = 'position:fixed;left:24px;top:110px;z-index:40;color:#7cf27c;font:700 14px monospace;text-shadow:0 1px 3px #000;white-space:pre;';
    document.body.appendChild(this.hud);
  }

  private log(msg: string) {
    this.hud.textContent = `🤖 AUTOTEST\n${this.steps.map(s => `${s.pass ? '✅' : '❌'} ${s.name} (${(s.ms / 1000).toFixed(1)}s)`).join('\n')}\n▶ ${msg}`;
  }

  private of() { return this.g.em.Get('Player').GetComponent('OnFootPlayer'); }
  private car() { return this.g.em.Get('Car').GetComponent('Car'); }
  private ms() { return this.g.em.Get('Missions').GetComponent('MissionSystem'); }
  private wanted() { return this.g.em.Get('Wanted').GetComponent('WantedSystem'); }

  /** 步行到 (tx,tz)：设定视角朝向 + 按住 W（与真人操作同路径）。 */
  private async walkTo(tx: number, tz: number, tol: number, timeoutMs: number): Promise<boolean> {
    const of = this.of();
    const t0 = now();
    Input.Press('KeyW');
    try {
      while (now() - t0 < timeoutMs) {
        const p = of.parent.Position;
        const dx = tx - p.x, dz = tz - p.z;
        if (Math.hypot(dx, dz) < tol) return true;
        of.yaw = Math.atan2(-dx, -dz);   // aimDir = (-sin yaw, -cos yaw) ∝ (dx,dz)
        of.pitch = 0;
        this.log(`步行 → (${tx},${tz})  剩 ${Math.hypot(dx, dz).toFixed(0)}m`);
        await sleep(50);
      }
      return false;
    } finally { Input.Release('KeyW'); }
  }

  /** 开车沿路点行驶（含卡住自动倒车脱困；stop() 返回 true 时提前结束）。 */
  private async driveTo(waypoints: [number, number][], tol: number, timeoutMs: number, stop?: () => boolean): Promise<boolean> {
    const car = this.car();
    const t0 = now();
    let wp = 0;
    let lastPos = { x: car.Position.x, z: car.Position.z, t: now() };
    Input.Press('KeyW');
    try {
      while (now() - t0 < timeoutMs && wp < waypoints.length) {
        if (stop?.()) return true;
        const [tx, tz] = waypoints[wp];
        const p = car.Position;
        const dx = tx - p.x, dz = tz - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist < tol) { wp++; continue; }

        const desired = Math.atan2(-dx, -dz);
        const err = wrap(desired - car.heading);
        if (err > 0.08) { Input.Press('KeyA'); Input.Release('KeyD'); }
        else if (err < -0.08) { Input.Press('KeyD'); Input.Release('KeyA'); }
        else { Input.Release('KeyA'); Input.Release('KeyD'); }

        // 卡住检测：1.2s 没挪动 → 倒车 + 朝目标一侧打轮脱困（倒车时转向效果反转）
        if (now() - lastPos.t > 1200) {
          if (Math.hypot(p.x - lastPos.x, p.z - lastPos.z) < 0.3) {
            this.log('卡住，倒车打轮脱困…');
            Input.Release('KeyW');
            if (err > 0) { Input.Press('KeyD'); Input.Release('KeyA'); }
            else { Input.Press('KeyA'); Input.Release('KeyD'); }
            Input.Press('KeyS');
            await sleep(1400);
            Input.Release('KeyS'); Input.Release('KeyA'); Input.Release('KeyD');
            Input.Press('KeyW');
          }
          lastPos = { x: p.x, z: p.z, t: now() };
        }
        this.log(`驾驶 → 路点${wp + 1}/${waypoints.length} (${tx},${tz})  剩 ${dist.toFixed(0)}m`);
        await sleep(50);
      }
      return wp >= waypoints.length;
    } finally { Input.Release('KeyW'); Input.Release('KeyA'); Input.Release('KeyD'); Input.Release('KeyS'); }
  }

  /** 动态逃逸：反复选"离警察最远的路口"，**沿马路 L 形路线**开过去（直线斜穿会撞楼）。
   *  到达后重选目标（警察逼近哪个角，就换对角），距离越拉越大直到通缉归零。 */
  private async fleeUntilClear(timeoutMs: number): Promise<boolean> {
    const car = this.car();
    const ROADS = [-39, -13, 13, 39];
    const snap = (v: number) => ROADS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
    const corners: [number, number][] = [[39, 39], [39, -39], [-39, 39], [-39, -39]];
    const t0 = now();
    while (now() - t0 < timeoutMs) {
      if (this.wanted().Level === 0) return true;
      const cops = this.g.em.entities
        .filter((e: any) => String(e.Name).startsWith('Police'))
        .map((e: any) => e.GetComponent('PoliceNPC').Position);
      const score = (c: [number, number]) =>
        cops.length ? Math.min(...cops.map((p: any) => Math.hypot(c[0] - p.x, c[1] - p.z))) : 999;
      const target = corners.reduce((a, b) => (score(b) > score(a) ? b : a));
      const p = car.Position;
      // L 形路网路线：先沿当前所在行(路)开到目标列，再沿目标列开到目标路口
      const route: [number, number][] = [[target[0], snap(p.z)], [target[0], target[1]]];
      this.log(`逃逸 → 路口(${target[0]},${target[1]})  通缉 ${this.wanted().Level} 星`);
      await this.driveTo(route, 4.0, 40_000, () => this.wanted().Level === 0);
      if (this.wanted().Level === 0) return true;
      // 已在目标角落且警察全被跟丢时，driveTo 会立即返回——必须让出主线程，
      // 否则这里变成无 await 的同步死循环，把游戏（含甩脱计时）整个锁死。
      await sleep(150);
    }
    return this.wanted().Level === 0;
  }

  private async waitFor(cond: () => boolean, timeoutMs: number, label: string): Promise<boolean> {
    const t0 = now();
    while (now() - t0 < timeoutMs) {
      if (cond()) return true;
      this.log(label);
      await sleep(100);
    }
    return false;
  }

  private async step(name: string, fn: () => Promise<boolean>, detail?: () => string) {
    const t0 = now();
    let pass = false;
    try { pass = await fn(); } catch (e) { pass = false; this.steps.push({ name, pass, ms: now() - t0, detail: String(e) }); return pass; }
    this.steps.push({ name, pass, ms: now() - t0, detail: detail?.() });
    return pass;
  }

  async run() {
    const content = this.g.content;
    const m0 = content.missions[0].pos as [number, number];
    const m1 = content.missions[1].pos as [number, number];
    const carPos = content.scene.spawns.car.pos;

    let ok = true;

    ok = await this.step('任务①：步行到光柱', async () => {
      const reached = await this.walkTo(m0[0], m0[1], 3.0, 45_000);
      return reached && await this.waitFor(() => this.ms().idx >= 1, 3_000, '等待任务①判定…');
    }) && ok;

    if (!ok) return this.finish(false);

    ok = await this.step('走到车边并上车(F)', async () => {
      // 目标=车中心、容差4m：贴着车身任何一面都算到（直线瞄"车旁点"会被车身碰撞体顶住）
      const near = await this.walkTo(carPos[0], carPos[2], 4.0, 60_000);
      if (!near) return false;
      Input.Press('KeyF'); await sleep(80); Input.Release('KeyF');
      return this.waitFor(() => this.car().Active, 2_000, '等待上车…');
    }) && ok;
    if (!ok) return this.finish(false);

    ok = await this.step('任务②：开车到西北路口', async () => {
      // 路线顺着车头初始朝向（+z）规划：先南下→西行→北上，全程转弯不掉头
      // 超时按无头软件渲染（游戏时间~0.3x）放宽
      const route: [number, number][] = [[13, 39], [-39, 39], [m1[0], m1[1]]];
      const done = await this.driveTo(route, 4.0, 150_000);
      return done && await this.waitFor(() => this.ms().idx >= 2, 3_000, '等待任务②判定…');
    }) && ok;
    if (!ok) return this.finish(false);

    ok = await this.step('任务③：惹2星通缉并甩掉', async () => {
      // 黑匣子遥测：逐秒记录通缉/警察/车辆状态，失败时由运行器打印
      const tele: any[] = [];
      (window as any).__tele = tele;
      const sampler = setInterval(() => {
        try {
          const w = this.wanted(); const car = this.car();
          const cops = this.g.em.entities.filter((e: any) => String(e.Name).startsWith('Police')).map((e: any) => e.GetComponent('PoliceNPC').Position);
          const p = car.Position;
          tele.push({ lvl: w.Level, esc: +w.escapeTimer.toFixed(1), n: cops.length,
            d: cops.length ? +Math.min(...cops.map((c: any) => Math.hypot(c.x - p.x, c.z - p.z))).toFixed(0) : null,
            car: [+p.x.toFixed(0), +p.z.toFixed(0)], v: +car.Speed.toFixed(0) });
        } catch (e) { tele.push({ err: String(e).slice(0, 80) }); }
      }, 1000);
      try {
        Input.Press('KeyG'); await sleep(60); Input.Release('KeyG'); await sleep(150);
        Input.Press('KeyG'); await sleep(60); Input.Release('KeyG');
        const raised = await this.waitFor(() => this.wanted().Level >= 2, 2_000, '等待通缉≥2星…');
        if (!raised) return false;
        // 动态逃逸甩警察（通缉归零即停）
        const cleared = await this.fleeUntilClear(180_000);
        return cleared && await this.waitFor(() => this.ms().idx >= 3, 5_000, '等待任务③判定…');
      } finally { clearInterval(sampler); }
    }) && ok;

    this.finish(ok);
  }

  private finish(ok: boolean) {
    const result = { pass: ok, steps: this.steps, done: true };
    (window as any).__autotest = result;
    document.title = ok ? 'AUTOTEST PASS' : 'AUTOTEST FAIL';
    this.log(ok ? '全部通过 🎉' : '存在失败步骤（后续步骤已跳过）');
    console.log('[autotest]', JSON.stringify(result, null, 2));
  }
}
