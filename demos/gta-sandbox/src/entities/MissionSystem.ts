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

interface MissionTuning {
  completeRadius: number;
}

export default class MissionSystem extends Component {
  private scene: THREE.Scene;
  private marker = buildMarker();
  private idx = 0;
  private wantedPeaked = false;
  private time = 0;
  private missions: Mission[];
  private tuning: MissionTuning;

  constructor(scene: THREE.Scene, missions: Mission[], tuning: MissionTuning) {
    super();
    this.name = 'MissionSystem';
    this.scene = scene;
    this.missions = missions;
    this.tuning = tuning;
  }

  Initialize(): void {
    this.scene.add(this.marker);
    this.applyMission();
  }

  private cur(): Mission | undefined { return this.missions[this.idx]; }

  get CurrentText(): string {
    return this.cur()?.text ?? '🎉 全部任务完成！自由游览小镇吧';
  }

  get CurrentTarget(): [number, number] | null {
    return this.cur()?.pos ?? null;
  }

  private applyMission() {
    const m = this.cur();
    if (!m) {
      this.marker.visible = false;
      Bus.emit('mission-changed', { text: this.CurrentText });
      return;
    }
    if (m.pos) {
      this.marker.visible = true;
      this.marker.position.set(m.pos[0], 25, m.pos[1]);
    } else {
      this.marker.visible = false;
    }
    Bus.emit('mission-changed', { text: this.CurrentText });
  }

  private complete() {
    Bus.emit('toast', { text: `✅ 任务完成：${this.cur()!.text}` });
    Bus.emit('mission-complete', { idx: this.idx });
    this.idx++;
    this.wantedPeaked = false;
    this.applyMission();
  }

  private activeCar(): any | null {
    const cars = this.parent!.parent!.GetAll((e) => !!e.GetComponent('Car')).map((e) => e.GetComponent('Car'));
    return cars.find((car) => car.Active) ?? null;
  }

  Update(t: number): void {
    this.time += t;
    if (this.marker.visible) {
      (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.15 * Math.sin(this.time * 3);
      this.marker.rotation.y += t * 0.8;
    }

    const m = this.cur();
    if (!m) return;

    const car = this.activeCar();
    const playerPos: THREE.Vector3 = car?.Active ? car.Position : (this.FindEntity('Player')!.Position as THREE.Vector3);

    if (m.pos) {
      const dx = playerPos.x - m.pos[0], dz = playerPos.z - m.pos[1];
      const near = Math.hypot(dx, dz) < this.tuning.completeRadius;
      if (near && (!m.needCar || car?.Active)) this.complete();
    } else if (m.special === 'wanted') {
      const wanted = this.FindEntity('Wanted')?.GetComponent('WantedSystem');
      if (!wanted) return;
      if (wanted.Level >= 2) this.wantedPeaked = true;
      if (this.wantedPeaked && wanted.Level === 0) this.complete();
    }
  }
}
