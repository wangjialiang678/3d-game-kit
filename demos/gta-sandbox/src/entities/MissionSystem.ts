/**
 * MissionSystem — 数据驱动的任务链。
 * 任务是数组数据：到点任务（可要求开车）+ 特殊任务（通缉→甩脱）。
 * 黄色光柱 = 当前目标点；全部完成显示通关。
 */
import * as THREE from 'three';
import { Component } from '@engine';
import { buildMarker } from '../util/build';

interface Mission {
  text: string;
  pos?: [number, number];   // 到点任务
  needCar?: boolean;        // 必须开着车到
  special?: 'wanted';       // 特殊：通缉≥2星后甩到 0
}

const MISSIONS: Mission[] = [
  { text: '① 步行到东侧路口的黄色光柱', pos: [26, 0] },
  { text: '② 上车(F)，开到西北角光柱', pos: [-52, -52], needCar: true },
  { text: '③ 按 G 惹麻烦(≥2星)，再甩掉警察(归零)', special: 'wanted' },
];

export default class MissionSystem extends Component {
  private scene: THREE.Scene;
  private marker = buildMarker();
  private idx = 0;
  private wantedPeaked = false;
  private objEl = document.querySelector('#mission .obj') as HTMLElement;
  private time = 0;

  constructor(scene: THREE.Scene) {
    super();
    this.name = 'MissionSystem';
    this.scene = scene;
  }

  Initialize(): void {
    this.scene.add(this.marker);
    this.applyMission();
  }

  private cur(): Mission | undefined { return MISSIONS[this.idx]; }

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
      this.marker.position.set(m.pos[0], 3, m.pos[1]);
    } else {
      this.marker.visible = false;
    }
  }

  private complete() {
    const wanted = this.FindEntity('Wanted')?.GetComponent('WantedSystem');
    wanted?.toast(`✅ 任务完成：${this.cur()!.text}`);
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
