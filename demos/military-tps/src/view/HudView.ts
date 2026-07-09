import * as THREE from 'three';
import { Component } from '@engine';
import { Bus } from '../events';

const TOAST_SECS = 2.8;

export default class HudView extends Component {
  private camera: THREE.Camera;
  private ammoEl!: HTMLElement;
  private magEl!: HTMLElement;
  private reserveEl!: HTMLElement;
  private healthBar!: HTMLElement;
  private toastEl!: HTMLElement;
  private objectiveEl!: HTMLElement;
  private navEl!: HTMLElement;
  private toastTimer = 0;
  private camDir = new THREE.Vector3();
  private cache: Record<string, string> = {};

  private static ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

  constructor(camera: THREE.Camera) {
    super();
    this.name = 'HudView';
    this.camera = camera;
  }

  Initialize(): void {
    this.ammoEl = document.getElementById('ammo')!;
    this.magEl = this.ammoEl.querySelector('.mag')!;
    this.reserveEl = this.ammoEl.querySelector('.reserve')!;
    this.healthBar = document.getElementById('health-bar')!;
    this.toastEl = document.getElementById('toast')!;
    this.objectiveEl = document.querySelector('#objective .text') as HTMLElement;
    this.navEl = document.querySelector('#objective .nav') as HTMLElement;

    Bus.on('ammo-changed', (data) => this.setAmmo(data?.mag ?? 0, data?.reserve ?? 0));
    Bus.on('weapon-fired', (data) => this.setAmmo(data?.mag ?? 0, data?.reserve ?? 0));
    Bus.on('health-changed', (data) => this.setHealth(data?.health ?? 0));
    Bus.on('player-hit', (data) => this.setHealth(data?.health ?? 0));
    Bus.on('enemy-killed', (data) => this.showToast(`Enemy down. ${data?.remaining ?? 0} remaining.`));
    Bus.on('toast', (data) => this.showToast(data?.text ?? String(data ?? '')));
  }

  private setAmmo(mag: number, reserve: number) {
    this.setText('mag', this.magEl, String(mag));
    this.setText('reserve', this.reserveEl, `/ ${reserve}`);
  }

  private setHealth(value: number) {
    this.healthBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
  }

  private showToast(text: string) {
    this.setText('toastText', this.toastEl, text);
    this.toastEl.style.opacity = '1';
    this.toastTimer = TOAST_SECS;
  }

  private aliveEnemies(): any[] {
    return this.parent!.parent!.GetAll((e) => {
      const npc = e.GetComponent('SoldierNPC');
      return !!npc && !npc.Dead;
    });
  }

  private nearestEnemy(player: THREE.Vector3 | null): any | null {
    if (!player) return null;
    let best: any = null;
    let bestDist = Infinity;
    for (const enemy of this.aliveEnemies()) {
      const d = player.distanceTo(enemy.Position);
      if (d < bestDist) { best = enemy; bestDist = d; }
    }
    return best;
  }

  private navText(target: THREE.Vector3 | null, playerPos: THREE.Vector3 | null): string {
    if (!target || !playerPos) return '';
    const dx = target.x - playerPos.x;
    const dz = target.z - playerPos.z;
    const dist = Math.hypot(dx, dz);
    this.camera.getWorldDirection(this.camDir);
    const rel = Math.atan2(dx, dz) - Math.atan2(this.camDir.x, this.camDir.z);
    const idx = ((Math.round(-rel / (Math.PI / 4)) % 8) + 8) % 8;
    return `${HudView.ARROWS[idx]} nearest hostile ${Math.round(dist)} m`;
  }

  private setText(key: string, el: HTMLElement, value: string) {
    if (this.cache[key] === value) return;
    el.textContent = value;
    this.cache[key] = value;
  }

  Update(t: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= t;
      if (this.toastTimer <= 0) this.toastEl.style.opacity = '0';
    }

    const enemies = this.aliveEnemies();
    this.setText('objective', this.objectiveEl, enemies.length ? `Neutralize hostiles: ${enemies.length}` : 'Area secure');
    const player = this.FindEntity('Player')?.Position as THREE.Vector3 | undefined;
    this.setText('nav', this.navEl, this.navText(this.nearestEnemy(player ?? null)?.Position ?? null, player ?? null));
  }
}
