import { Input } from '@engine';
import * as THREE from 'three';
import { Bus } from '../events';

interface StepResult { name: string; pass: boolean; ms: number; detail?: string; }

const now = () => performance.now();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default class AutoTest {
  private g: any;
  private hud: HTMLElement;
  private steps: StepResult[] = [];
  private allDead = false;
  private victoryToast = false;

  constructor(game: any) {
    this.g = game;
    this.hud = document.createElement('div');
    this.hud.style.cssText = 'position:fixed;left:24px;top:118px;z-index:40;color:#7cf27c;font:700 14px monospace;text-shadow:0 1px 3px #000;white-space:pre;';
    document.body.appendChild(this.hud);
    Bus.on('all-enemies-dead', () => { this.allDead = true; });
    Bus.on('toast', (data) => { if (String(data?.text ?? '').includes('全歼')) this.victoryToast = true; });
  }

  private log(msg: string) {
    this.hud.textContent = `AUTOTEST\n${this.steps.map((s) => `${s.pass ? 'PASS' : 'FAIL'} ${s.name} (${(s.ms / 1000).toFixed(1)}s)`).join('\n')}\n> ${msg}`;
  }

  private player() { return this.g.em.Get('Player').GetComponent('ThirdPersonPlayer'); }

  private aliveEnemies() {
    return this.g.em.GetAll((e: any) => {
      const npc = e.GetComponent('SoldierNPC');
      return !!npc && !npc.Dead;
    });
  }

  private nearestEnemy() {
    const p = this.g.em.Get('Player').Position;
    let best: any = null;
    let bestDist = Infinity;
    for (const enemy of this.aliveEnemies()) {
      const d = p.distanceTo(enemy.Position);
      if (d < bestDist) { best = enemy; bestDist = d; }
    }
    return best;
  }

  private startShooting() {
    document.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
  }

  private stopShooting() {
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  }

  private releaseMovement() {
    Input.Release('KeyW');
    Input.Release('KeyA');
    Input.Release('KeyD');
  }

  private enemyHp(target: any): number {
    return target.GetComponent('SoldierNPC')?.health ?? 0;
  }

  private aimAt(target: any) {
    const pc = this.player();
    pc.setCameraMode('FP');
    pc.aimAtWorld(new THREE.Vector3(target.Position.x, 1.15, target.Position.z));
    const playerEnt = this.g.em.Get('Player');
    const dx = target.Position.x - playerEnt.Position.x;
    const dz = target.Position.z - playerEnt.Position.z;
    return Math.hypot(dx, dz);
  }

  private async clearEnemies(timeoutMs: number) {
    const t0 = now();
    let targetName = '';
    let lastHp = 0;
    let hpChangedAt = now();
    let forceClose = false;
    let strafeDir: 'KeyA' | 'KeyD' = 'KeyA';
    let nextStrafeFlip = now() + 1200;
    this.startShooting();
    try {
      while (now() - t0 < timeoutMs) {
        const target = this.nearestEnemy();
        if (!target) return true;
        const dist = this.aimAt(target);
        const hp = this.enemyHp(target);

        if (target.Name !== targetName) {
          targetName = target.Name;
          lastHp = hp;
          hpChangedAt = now();
          forceClose = false;
          strafeDir = 'KeyA';
          nextStrafeFlip = now() + 1200;
          this.startShooting();
        } else if (hp < lastHp) {
          lastHp = hp;
          hpChangedAt = now();
          forceClose = false;
          this.startShooting();
        } else if (hp > lastHp) {
          lastHp = hp;
          hpChangedAt = now();
        }

        const staleMs = now() - hpChangedAt;
        if (staleMs > 2000 && dist > 2.5) forceClose = true;

        if (forceClose && dist > 2.5) {
          // The target is not taking damage, usually because cover is between the ray and the NPC.
          // Stop wasting ammo, keep aiming, and push in with alternating strafe to slide around cover.
          this.stopShooting();
          Input.Press('KeyW');
          if (now() >= nextStrafeFlip) {
            strafeDir = strafeDir === 'KeyA' ? 'KeyD' : 'KeyA';
            nextStrafeFlip = now() + 1200;
          }
          Input.Press(strafeDir);
          Input.Release(strafeDir === 'KeyA' ? 'KeyD' : 'KeyA');
        } else {
          Input.Release('KeyA');
          Input.Release('KeyD');
          if (dist > 10) Input.Press('KeyW');
          else Input.Release('KeyW');
          this.startShooting();
        }

        this.log(`engaging ${target.Name} ${dist.toFixed(1)}m hp=${hp} stale=${(staleMs / 1000).toFixed(1)}s close=${forceClose} alive=${this.aliveEnemies().length}`);
        await sleep(50);
      }
      return false;
    } finally {
      this.releaseMovement();
      this.stopShooting();
    }
  }

  private async waitFor(cond: () => boolean, timeoutMs: number, label: string) {
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
    try { pass = await fn(); }
    catch (e) { this.steps.push({ name, pass: false, ms: now() - t0, detail: String(e) }); return false; }
    this.steps.push({ name, pass, ms: now() - t0, detail: detail?.() });
    return pass;
  }

  async run() {
    let ok = true;
    ok = await this.step('全歼 5 名敌人', () => this.clearEnemies(180_000), () => `remaining=${this.aliveEnemies().length}`) && ok;
    ok = await this.step('胜利事件与 toast', async () => {
      const eventOk = await this.waitFor(() => this.allDead, 3_000, 'waiting all-enemies-dead');
      const toastOk = await this.waitFor(() => this.victoryToast, 3_000, 'waiting victory toast');
      return eventOk && toastOk;
    }) && ok;
    this.finish(ok);
  }

  private finish(ok: boolean) {
    const result = { pass: ok, steps: this.steps, done: true };
    (window as any).__autotest = result;
    document.title = ok ? 'AUTOTEST PASS' : 'AUTOTEST FAIL';
    this.log(ok ? 'complete' : 'failed');
    console.log('[autotest]', JSON.stringify(result, null, 2));
  }
}
