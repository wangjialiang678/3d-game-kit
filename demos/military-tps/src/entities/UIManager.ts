/** UIManager — drives the DOM HUD (ammo counter + health bar). Port of three-fps UIManager. */
import Component from '@engine/Component';

export default class UIManager extends Component {
  private ammoEl!: HTMLElement;
  private magEl!: HTMLElement;
  private reserveEl!: HTMLElement;
  private healthBar!: HTMLElement;

  constructor() {
    super();
    this.name = 'UIManager';
  }

  Initialize(): void {
    this.ammoEl = document.getElementById('ammo')!;
    this.magEl = this.ammoEl.querySelector('.mag')!;
    this.reserveEl = this.ammoEl.querySelector('.reserve')!;
    this.healthBar = document.getElementById('health-bar')!;
  }

  SetAmmo(mag: number, reserve: number): void {
    this.magEl.textContent = String(mag);
    this.reserveEl.textContent = `/ ${reserve}`;
  }

  SetHealth(pct: number): void {
    this.healthBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }
}
