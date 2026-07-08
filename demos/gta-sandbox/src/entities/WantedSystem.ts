/**
 * WantedSystem — GTA 式通缉系统。
 * 按 G 惹麻烦 → 通缉 +1 星（最多 5）；警力 = 星级 × 2。
 * 与所有警察拉开 45m 并保持 5 秒 → 降 1 星；星级归零警察消散。
 * 步行时被警察贴身 → BUSTED：清星、送回广场。
 */
import * as THREE from 'three';
import { Component, Input, Entity } from '@engine';
import PoliceNPC from './PoliceNPC';
import { cloneSoldier } from '../util/build';

const MAX_STARS = 5;
const PER_STAR = 2;          // 每星警察数
const ESCAPE_DIST = 45;      // 甩脱距离
const ESCAPE_TIME = 5;       // 保持秒数降一星
const BUST_DIST = 1.8;       // 步行被捕距离

export default class WantedSystem extends Component {
  private scene: THREE.Scene;
  private soldierGltf: any;
  private level = 0;
  private escapeTimer = 0;
  private police: Entity[] = [];
  private spawnSeq = 0;

  private starsEl = document.getElementById('wanted')!;
  private toastEl = document.getElementById('toast')!;
  private toastTimer = 0;

  constructor(scene: THREE.Scene, soldierGltf: any) {
    super();
    this.name = 'WantedSystem';
    this.scene = scene;
    this.soldierGltf = soldierGltf;
  }

  get Level() { return this.level; }

  Initialize(): void {
    this.renderStars();
    Input.AddKeyDownListner((e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'KeyG') this.raise('制造了事端！');
    });
  }

  raise(reason: string) {
    if (this.level < MAX_STARS) this.level++;
    this.toast(`⭐ 通缉 ${this.level} 星 — ${reason}`);
    this.renderStars();
    this.syncPolice();
  }

  private renderStars() {
    let html = '';
    for (let i = 1; i <= MAX_STARS; i++) html += `<span class="${i <= this.level ? 'on' : ''}">★</span>`;
    this.starsEl.innerHTML = html;
  }

  toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = '1';
    this.toastTimer = 2.5;
  }

  private em() { return (this.parent as any).parent; }

  private playerGroundPos(): THREE.Vector3 {
    const car = this.FindEntity('Car')?.GetComponent('Car');
    if (car?.Active) return car.Position;
    return this.FindEntity('Player')!.Position as THREE.Vector3;
  }

  /** 让在场警察数量 = 星级×2。 */
  private syncPolice() {
    const want = this.level * PER_STAR;
    const p = this.playerGroundPos();
    while (this.police.length < want) {
      const ang = Math.random() * Math.PI * 2;
      const spawn = new THREE.Vector3(p.x + Math.cos(ang) * 30, 0, p.z + Math.sin(ang) * 30);
      spawn.x = Math.max(-70, Math.min(70, spawn.x));
      spawn.z = Math.max(-70, Math.min(70, spawn.z));
      const e = new Entity();
      e.SetName(`Police${this.spawnSeq++}`);
      e.SetPosition(spawn);
      e.AddComponent(new PoliceNPC(cloneSoldier(this.soldierGltf, 0x2a4bd7), this.scene));
      this.em().Add(e);       // EndSetup 之后 Add 会自动 Initialize（引擎已支持）
      this.police.push(e);
    }
    while (this.police.length > want) {
      const e = this.police.pop()!;
      e.GetComponent('PoliceNPC').dispose();
      this.em().Remove(e);
    }
  }

  private bust() {
    this.level = 0;
    this.renderStars();
    this.syncPolice();
    this.toast('🚨 BUSTED！被捕 — 罚款后释放');
    // 送回中央广场
    const of = this.FindEntity('Player')!.GetComponent('OnFootPlayer');
    of.activate(new THREE.Vector3(0, 1.2, 0));
  }

  Update(t: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= t;
      if (this.toastTimer <= 0) this.toastEl.style.opacity = '0';
    }
    if (this.level === 0) return;

    const p = this.playerGroundPos();
    let nearest = Infinity;
    for (const e of this.police) {
      const d = e.GetComponent('PoliceNPC').Position.distanceTo(p);
      nearest = Math.min(nearest, d);
    }

    // 被捕：仅步行状态可被贴身抓住（在车里警察追不上）
    const car = this.FindEntity('Car')?.GetComponent('Car');
    if (!car?.Active && nearest < BUST_DIST) { this.bust(); return; }

    // 甩脱降星
    if (nearest > ESCAPE_DIST) {
      this.escapeTimer += t;
      if (this.escapeTimer >= ESCAPE_TIME) {
        this.escapeTimer = 0;
        this.level--;
        this.renderStars();
        this.syncPolice();
        this.toast(this.level === 0 ? '✅ 甩掉警察了！通缉解除' : `通缉降为 ${this.level} 星`);
      }
    } else {
      this.escapeTimer = 0;
    }
  }
}
