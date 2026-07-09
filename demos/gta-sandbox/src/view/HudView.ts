/**
 * HudView — GTA demo 的 DOM 呈现层。
 * 系统层只维护状态和发事件；这里集中处理 HUD、toast、目标导航和速度表。
 */
import * as THREE from 'three';
import { Component } from '@engine';
import { Bus } from '../events';

const MAX_STARS = 5;
const TOAST_SECS = 2.5;

export default class HudView extends Component {
  private camera: THREE.Camera;
  private starsEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private objEl!: HTMLElement;
  private navEl!: HTMLElement;
  private promptEl!: HTMLElement;
  private speedEl!: HTMLElement;
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
    this.starsEl = document.getElementById('wanted')!;
    this.toastEl = document.getElementById('toast')!;
    this.objEl = document.querySelector('#mission .obj') as HTMLElement;
    this.navEl = document.querySelector('#mission .nav') as HTMLElement;
    this.promptEl = document.getElementById('prompt') as HTMLElement;
    this.speedEl = document.getElementById('speed') as HTMLElement;

    this.renderStars(0);
    Bus.on('wanted-changed', (data) => this.renderStars(data?.level ?? 0));
    Bus.on('toast', (data) => this.showToast(data?.text ?? String(data ?? '')));
  }

  private renderStars(level: number) {
    let html = '';
    for (let i = 1; i <= MAX_STARS; i++) html += `<span class="${i <= level ? 'on' : ''}">★</span>`;
    this.setHtml('stars', this.starsEl, html);
  }

  private showToast(text: string) {
    this.setText('toastText', this.toastEl, text);
    this.setStyle('toastOpacity', this.toastEl, 'opacity', '1');
    this.toastTimer = TOAST_SECS;
  }

  private playerGroundPos(): THREE.Vector3 | null {
    const car = this.activeCar();
    if (car?.Active) return car.Position;
    return (this.FindEntity('Player')?.Position as THREE.Vector3 | undefined) ?? null;
  }

  private cars(): any[] {
    return this.parent!.parent!.GetAll((e) => !!e.GetComponent('Car')).map((e) => e.GetComponent('Car'));
  }

  private activeCar(): any | null {
    return this.cars().find((car) => car.Active) ?? null;
  }

  private nearestCar(pos: THREE.Vector3): any | null {
    let best: any = null;
    let bestDist = Infinity;
    for (const car of this.cars()) {
      const d = pos.distanceTo(car.Position);
      if (d < bestDist) { best = car; bestDist = d; }
    }
    return best;
  }

  /** HUD 导航：目标的相机相对方向箭头 + 距离。玩家不可能再"找不到目标"。 */
  private navText(target: [number, number] | null, playerPos: THREE.Vector3 | null): string {
    if (!target || !playerPos) return '';
    const dx = target[0] - playerPos.x, dz = target[1] - playerPos.z;
    const dist = Math.hypot(dx, dz);
    this.camera.getWorldDirection(this.camDir);
    const rel = Math.atan2(dx, dz) - Math.atan2(this.camDir.x, this.camDir.z);
    const idx = ((Math.round(-rel / (Math.PI / 4)) % 8) + 8) % 8;
    return `${HudView.ARROWS[idx]} 目标 ${Math.round(dist)} m`;
  }

  private updatePrompt() {
    const onfoot = this.FindEntity('Player')?.GetComponent('OnFootPlayer');
    if (!onfoot) return;
    const activeCar = this.activeCar();
    const nearestCar = this.nearestCar(onfoot.parent!.Position);
    if (activeCar) {
      this.setStyle('promptDisplay', this.promptEl, 'display', 'block');
      this.setHtml('promptHtml', this.promptEl, '按 <b>F</b> 下车');
    } else if (onfoot.active && nearestCar && onfoot.parent!.Position.distanceTo(nearestCar.Position) < 5.0) {
      this.setStyle('promptDisplay', this.promptEl, 'display', 'block');
      this.setHtml('promptHtml', this.promptEl, '按 <b>F</b> 上车');
    } else {
      this.setStyle('promptDisplay', this.promptEl, 'display', 'none');
    }

    if (activeCar) {
      this.setStyle('speedDisplay', this.speedEl, 'display', 'block');
      this.setHtml('speedHtml', this.speedEl, `${Math.abs(Math.round(activeCar.Speed * 3.6))} <small>km/h</small>`);
    } else {
      this.setStyle('speedDisplay', this.speedEl, 'display', 'none');
    }
  }

  private setText(key: string, el: HTMLElement, value: string) {
    if (this.cache[key] === value) return;
    el.textContent = value;
    this.cache[key] = value;
  }

  private setHtml(key: string, el: HTMLElement, value: string) {
    if (this.cache[key] === value) return;
    el.innerHTML = value;
    this.cache[key] = value;
  }

  private setStyle(key: string, el: HTMLElement, prop: 'display' | 'opacity', value: string) {
    if (this.cache[key] === value) return;
    el.style[prop] = value;
    this.cache[key] = value;
  }

  Update(t: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= t;
      if (this.toastTimer <= 0) this.setStyle('toastOpacity', this.toastEl, 'opacity', '0');
    }

    const missions = this.FindEntity('Missions')?.GetComponent('MissionSystem');
    if (missions) {
      this.setText('missionText', this.objEl, missions.CurrentText);
      this.setText('navText', this.navEl, this.navText(missions.CurrentTarget, this.playerGroundPos()));
    }

    this.updatePrompt();
  }
}
