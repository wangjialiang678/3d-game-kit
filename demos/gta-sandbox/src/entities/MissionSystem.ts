/**
 * MissionSystem — 数据驱动的任务链。
 * 任务是数组数据：到点任务（可要求开车）+ 特殊任务（通缉→甩脱）。
 * 黄色光柱 = 当前目标点；全部完成显示通关。
 */
import * as THREE from 'three';
import { Component } from '@engine';
import { buildMarker } from '../util/build';
import { Bus } from '../events';

interface Mission {
  text: string;
  pos?: [number, number];   // 到点任务
  needCar?: boolean;        // 必须开着车到
  special?: 'wanted';       // 特殊：通缉≥2星后甩到 0
}
// P1：任务不再硬编码，由内容包 public/content/missions.json 提供（加载时已做"任务点不在建筑里"校验）。

export default class MissionSystem extends Component {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private marker = buildMarker();
  private idx = 0;
  private wantedPeaked = false;
  private objEl = document.querySelector('#mission .obj') as HTMLElement;
  private navEl = document.querySelector('#mission .nav') as HTMLElement;
  private time = 0;
  private camDir = new THREE.Vector3();
  private missions: Mission[];

  constructor(scene: THREE.Scene, camera: THREE.Camera, missions: Mission[]) {
    super();
    this.name = 'MissionSystem';
    this.scene = scene;
    this.camera = camera;
    this.missions = missions;
  }

  Initialize(): void {
    this.scene.add(this.marker);
    this.applyMission();
  }

  private cur(): Mission | undefined { return this.missions[this.idx]; }

  private applyMission() {
    const m = this.cur();
    if (!m) {
      this.objEl.textContent = '🎉 全部任务完成！自由游览小镇吧';
      this.marker.visible = false;
      return;
    }
    this.objEl.textContent = m.text;
    if (m.pos) {
      this.marker.visible = true;
      this.marker.position.set(m.pos[0], 25, m.pos[1]);
    } else {
      this.marker.visible = false;
      this.navEl.textContent = '';
    }
  }

  /** HUD 导航：目标的相机相对方向箭头 + 距离。玩家不可能再"找不到目标"。 */
  private static ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  private updateNav(playerPos: THREE.Vector3, m: Mission) {
    if (!m.pos) { this.navEl.textContent = ''; return; }
    const dx = m.pos[0] - playerPos.x, dz = m.pos[1] - playerPos.z;
    const dist = Math.hypot(dx, dz);
    this.camera.getWorldDirection(this.camDir);
    const rel = Math.atan2(dx, dz) - Math.atan2(this.camDir.x, this.camDir.z);
    const idx = ((Math.round(-rel / (Math.PI / 4)) % 8) + 8) % 8;
    this.navEl.textContent = `${MissionSystem.ARROWS[idx]} 目标 ${Math.round(dist)} m`;
  }

  private complete() {
    const wanted = this.FindEntity('Wanted')?.GetComponent('WantedSystem');
    wanted?.toast(`✅ 任务完成：${this.cur()!.text}`);
    Bus.emit('mission-complete', { idx: this.idx });
    this.idx++;
    this.wantedPeaked = false;
    this.applyMission();
  }

  Update(t: number): void {
    this.time += t;
    if (this.marker.visible) {
      (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.15 * Math.sin(this.time * 3);
      this.marker.rotation.y += t * 0.8;
    }

    const m = this.cur();
    if (!m) return;

    const car = this.FindEntity('Car')?.GetComponent('Car');
    const playerPos: THREE.Vector3 = car?.Active ? car.Position : (this.FindEntity('Player')!.Position as THREE.Vector3);
    this.updateNav(playerPos, m);

    if (m.pos) {
      const dx = playerPos.x - m.pos[0], dz = playerPos.z - m.pos[1];
      const near = Math.hypot(dx, dz) < 3.5;
      if (near && (!m.needCar || car?.Active)) this.complete();
    } else if (m.special === 'wanted') {
      const wanted = this.FindEntity('Wanted')?.GetComponent('WantedSystem');
      if (!wanted) return;
      if (wanted.Level >= 2) this.wantedPeaked = true;
      if (this.wantedPeaked && wanted.Level === 0) this.complete();
    }
  }
}
