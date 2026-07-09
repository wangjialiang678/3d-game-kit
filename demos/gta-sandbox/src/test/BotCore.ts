import { Input } from '@engine';

export interface StepResult {
  name: string;
  pass: boolean;
  ms: number;
  ticks: number;
  tick: number;
  detail?: string;
}

export interface BotResult {
  pass: boolean;
  done: boolean;
  steps: StepResult[];
}

export interface BotCoreOptions {
  onLog?: (message: string, steps: StepResult[]) => void;
  onDone?: (result: BotResult) => void;
}

type State =
  | 'walk-m0'
  | 'wait-m0'
  | 'walk-car'
  | 'enter-car'
  | 'drive-m1'
  | 'wanted-flee'
  | 'done'
  | 'failed';

const wrap = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

export default class BotCore {
  private g: any;
  private opts: BotCoreOptions;
  private state: State = 'walk-m0';
  private stateTime = 0;
  private stateTick = 0;
  private localTick = 0;
  private held = new Set<string>();
  private steps: StepResult[] = [];
  private pass = false;
  private done = false;

  private route: [number, number][] = [];
  private routeIndex = 0;
  private reverseTime = 0;
  private reverseSteer: 'KeyA' | 'KeyD' = 'KeyA';
  private lastDriveSample = { x: 0, z: 0, t: 0 };
  private raisedOnce = false;
  private raisedTwice = false;
  private sawWanted2 = false;
  private dt = 1 / 60;

  constructor(game: any, options: BotCoreOptions = {}) {
    this.g = game;
    this.opts = options;
    this.stateTick = this.tickNow();
  }

  get Result(): BotResult {
    return { pass: this.pass, done: this.done, steps: this.steps.map((s) => ({ ...s })) };
  }

  tick(dt = 1 / 60) {
    if (this.done) return;
    this.dt = dt;
    this.localTick++;
    this.stateTime += dt;

    switch (this.state) {
      case 'walk-m0':
        this.tickWalkMission0();
        break;
      case 'wait-m0':
        this.tickWaitMission0();
        break;
      case 'walk-car':
        this.tickWalkCar();
        break;
      case 'enter-car':
        this.tickEnterCar();
        break;
      case 'drive-m1':
        this.tickDriveMission1();
        break;
      case 'wanted-flee':
        this.tickWantedFlee();
        break;
      default:
        break;
    }
  }

  private tickNow(): number {
    return Number.isFinite(this.g.tick) ? this.g.tick : this.localTick;
  }

  private of() { return this.g.em.Get('Player').GetComponent('OnFootPlayer') as any; }
  private car() { return this.g.em.Get('Car').GetComponent('Car') as any; }
  private ms() { return this.g.em.Get('Missions').GetComponent('MissionSystem') as any; }
  private wanted() { return this.g.em.Get('Wanted').GetComponent('WantedSystem') as any; }

  private log(message: string) {
    this.opts.onLog?.(message, this.steps);
  }

  private setHeld(code: string, down: boolean) {
    if (down && !this.held.has(code)) {
      this.held.add(code);
      Input.Press(code);
    } else if (!down && this.held.has(code)) {
      this.held.delete(code);
      Input.Release(code);
    }
  }

  private tap(code: string) {
    Input.Press(code);
    Input.Release(code);
  }

  private release(...codes: string[]) {
    for (const code of codes) this.setHeld(code, false);
  }

  private releaseAll() {
    for (const code of [...this.held]) this.setHeld(code, false);
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG']) Input.Release(code);
  }

  private start(state: State) {
    this.state = state;
    this.stateTime = 0;
    this.stateTick = this.tickNow();
    this.route = [];
    this.routeIndex = 0;
    this.reverseTime = 0;
    this.raisedOnce = false;
    this.raisedTwice = false;
    this.sawWanted2 = false;
  }

  private completeStep(name: string, detail?: string) {
    this.steps.push({
      name,
      pass: true,
      ms: Math.round(this.stateTime * 1000),
      ticks: this.tickNow() - this.stateTick,
      tick: this.tickNow(),
      detail,
    });
  }

  private failStep(name: string, detail?: string) {
    this.steps.push({
      name,
      pass: false,
      ms: Math.round(this.stateTime * 1000),
      ticks: this.tickNow() - this.stateTick,
      tick: this.tickNow(),
      detail,
    });
    this.finish(false);
  }

  private finish(pass: boolean) {
    if (this.done) return;
    this.pass = pass;
    this.done = true;
    this.state = pass ? 'done' : 'failed';
    this.releaseAll();
    this.opts.onDone?.(this.Result);
  }

  private walkTo(tx: number, tz: number, tol: number, label: string): boolean {
    const of = this.of();
    const p = of.parent.Position;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < tol) {
      this.release('KeyW', 'KeyA', 'KeyS', 'KeyD');
      return true;
    }
    of.yaw = Math.atan2(-dx, -dz);
    of.pitch = 0;
    this.setHeld('KeyW', true);
    this.release('KeyA', 'KeyS', 'KeyD');
    this.log(`${label}  剩 ${dist.toFixed(0)}m`);
    return false;
  }

  private tickWalkMission0() {
    const m0 = this.g.content.missions[0].pos as [number, number];
    if (this.ms().idx >= 1 || this.walkTo(m0[0], m0[1], 3.0, `步行 -> (${m0[0]},${m0[1]})`)) {
      this.start('wait-m0');
      return;
    }
    if (this.stateTime > 45) this.failStep('任务①：步行到光柱', 'walk timeout');
  }

  private tickWaitMission0() {
    if (this.ms().idx >= 1) {
      this.completeStep('任务①：步行到光柱');
      this.start('walk-car');
      return;
    }
    this.log('等待任务①判定...');
    if (this.stateTime > 3) this.failStep('任务①：步行到光柱', 'mission idx did not advance');
  }

  private tickWalkCar() {
    const carPos = this.g.content.scene.spawns.car.pos;
    if (this.walkTo(carPos[0], carPos[2], 4.0, '走到车边')) {
      this.start('enter-car');
      return;
    }
    if (this.stateTime > 60) this.failStep('走到车边并上车(F)', 'walk to car timeout');
  }

  private tickEnterCar() {
    if (this.stateTime === 0) this.tap('KeyF');
    if (!this.raisedOnce) {
      this.tap('KeyF');
      this.raisedOnce = true;
    }
    if (this.car().Active) {
      this.completeStep('走到车边并上车(F)', 'entered car');
      this.start('drive-m1');
      this.startDrive([[13, 39], [-39, 39], this.g.content.missions[1].pos as [number, number]]);
      return;
    }
    this.log('等待上车...');
    if (this.stateTime > 2) this.failStep('走到车边并上车(F)', 'enter car timeout');
  }

  private startDrive(route: [number, number][]) {
    const car = this.car();
    this.route = route;
    this.routeIndex = 0;
    this.reverseTime = 0;
    this.lastDriveSample = { x: car.Position.x, z: car.Position.z, t: this.stateTime };
    this.setHeld('KeyW', true);
    this.release('KeyA', 'KeyS', 'KeyD');
  }

  private driveRoute(tol: number, stop?: () => boolean): boolean {
    if (stop?.()) return true;
    if (this.routeIndex >= this.route.length) return true;

    const car = this.car();
    const [tx, tz] = this.route[this.routeIndex];
    const p = car.Position;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < tol) {
      this.routeIndex++;
      if (this.routeIndex >= this.route.length) return true;
      return false;
    }

    const desired = Math.atan2(-dx, -dz);
    const err = wrap(desired - car.heading);

    if (this.reverseTime > 0) {
      this.reverseTime -= this.dt;
      this.setHeld('KeyW', false);
      this.setHeld('KeyS', true);
      this.setHeld(this.reverseSteer, true);
      this.setHeld(this.reverseSteer === 'KeyA' ? 'KeyD' : 'KeyA', false);
      if (this.reverseTime <= 0) {
        this.release('KeyS', 'KeyA', 'KeyD');
        this.setHeld('KeyW', true);
      }
      return false;
    }

    this.setHeld('KeyW', true);
    this.setHeld('KeyS', false);
    if (err > 0.08) { this.setHeld('KeyA', true); this.setHeld('KeyD', false); }
    else if (err < -0.08) { this.setHeld('KeyD', true); this.setHeld('KeyA', false); }
    else this.release('KeyA', 'KeyD');

    if (this.stateTime - this.lastDriveSample.t > 1.2) {
      if (Math.hypot(p.x - this.lastDriveSample.x, p.z - this.lastDriveSample.z) < 0.3) {
        this.reverseSteer = err > 0 ? 'KeyD' : 'KeyA';
        this.reverseTime = 1.4;
        this.log('卡住，倒车打轮脱困...');
      }
      this.lastDriveSample = { x: p.x, z: p.z, t: this.stateTime };
    }

    this.log(`驾驶 -> 路点${this.routeIndex + 1}/${this.route.length} (${tx},${tz})  剩 ${dist.toFixed(0)}m`);
    return false;
  }

  private tickDriveMission1() {
    const routeDone = this.driveRoute(4.0);
    if (this.ms().idx >= 2) {
      this.release('KeyW', 'KeyA', 'KeyS', 'KeyD');
      this.completeStep('任务②：开车到西北路口');
      this.start('wanted-flee');
      return;
    }
    if (routeDone) this.release('KeyW', 'KeyA', 'KeyS', 'KeyD');
    if (this.stateTime > 150) this.failStep('任务②：开车到西北路口', 'drive timeout');
  }

  private chooseFleeRoute(): [number, number][] {
    const car = this.car();
    const roads = [-39, -13, 13, 39];
    const snap = (v: number) => roads.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
    const corners: [number, number][] = [[39, 39], [39, -39], [-39, 39], [-39, -39]];
    const cops = this.g.em.entities
      .filter((e: any) => String(e.Name).startsWith('Police'))
      .map((e: any) => e.GetComponent('PoliceNPC').Position);
    const score = (c: [number, number]) => cops.length ? Math.min(...cops.map((p: any) => Math.hypot(c[0] - p.x, c[1] - p.z))) : 999;
    const target = corners.reduce((a, b) => (score(b) > score(a) ? b : a));
    const p = car.Position;
    return [[target[0], snap(p.z)], [target[0], target[1]]];
  }

  private tickWantedFlee() {
    if (this.wanted().Level >= 2) this.sawWanted2 = true;
    if (!this.raisedOnce) {
      this.tap('KeyG');
      this.raisedOnce = true;
      return;
    }
    if (this.stateTime > 0.2 && !this.raisedTwice) {
      this.tap('KeyG');
      this.raisedTwice = true;
      return;
    }
    if (this.raisedTwice && this.stateTime < 2 && !this.sawWanted2) {
      this.log('等待通缉>=2星...');
      return;
    }
    if (this.raisedTwice && !this.sawWanted2 && this.stateTime >= 2) {
      this.failStep('任务③：惹2星通缉并甩掉', 'wanted level did not reach 2');
      return;
    }

    if (this.wanted().Level === 0 && this.ms().idx >= 3) {
      this.release('KeyW', 'KeyA', 'KeyS', 'KeyD');
      this.completeStep('任务③：惹2星通缉并甩掉');
      this.finish(true);
      return;
    }

    if (!this.route.length || this.routeIndex >= this.route.length) {
      this.startDrive(this.chooseFleeRoute());
    }
    this.driveRoute(4.0, () => this.wanted().Level === 0);
    this.log(`逃逸中  通缉 ${this.wanted().Level} 星`);

    if (this.stateTime > 180) this.failStep('任务③：惹2星通缉并甩掉', 'flee timeout');
  }
}
