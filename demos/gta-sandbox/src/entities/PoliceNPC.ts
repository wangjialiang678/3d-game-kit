/**
 * PoliceNPC — 追捕玩家的警察（蓝色士兵变体）。
 * 直接追击：步行玩家 → 追人；玩家在车里 → 追车（车更快，可以甩掉）。
 * 抓捕判定由 WantedSystem 统一做（离玩家足够近 = 被捕）。
 */
import * as THREE from 'three';
import { Component } from '@engine';
import type { SoldierInstance } from '../util/build';

const FACING_OFFSET = Math.PI;

export default class PoliceNPC extends Component {
  private scene: THREE.Scene;
  private soldier: SoldierInstance;
  private mixer!: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current = '';
  private tmp = new THREE.Vector3();
  private speed: number;

  constructor(soldier: SoldierInstance, scene: THREE.Scene, speed: number) {
    super();
    this.name = 'PoliceNPC';
    this.soldier = soldier;
    this.scene = scene;
    this.speed = speed;
  }

  get Position(): THREE.Vector3 { return this.soldier.model.position; }

  Initialize(): void {
    const m = this.soldier.model;
    m.position.copy(this.parent!.Position); m.position.y = 0;
    this.scene.add(m);
    this.mixer = new THREE.AnimationMixer(m);
    for (const clip of this.soldier.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.setAnim('Run');
  }

  private setAnim(name: string) {
    if (this.current === name || !this.actions[name]) return;
    this.actions[this.current]?.fadeOut(0.2);
    this.actions[name].reset().fadeIn(0.2).play();
    this.current = name;
  }

  /** 由 WantedSystem 在移除时调用，清理场景对象。 */
  dispose(): void {
    this.scene.remove(this.soldier.model);
  }

  private activeCar(): any | null {
    const cars = this.parent!.parent!.GetAll((e) => !!e.GetComponent('Car')).map((e) => e.GetComponent('Car'));
    return cars.find((car) => car.Active) ?? null;
  }

  Update(t: number): void {
    const playerEnt = this.FindEntity('Player');
    if (!playerEnt) return;
    const car = this.activeCar();
    const target: THREE.Vector3 = car?.Active ? car.Position : playerEnt.Position;

    const m = this.soldier.model;
    this.tmp.copy(target).sub(m.position); this.tmp.y = 0;
    const dist = this.tmp.length();

    if (dist > 1.2) {
      this.tmp.normalize();
      m.position.addScaledVector(this.tmp, this.speed * t);
      m.rotation.y = Math.atan2(this.tmp.x, this.tmp.z) + FACING_OFFSET;
      this.setAnim('Run');
    } else {
      this.setAnim('Idle');
    }
    m.position.y = 0;
    this.mixer.update(t);
    this.parent!.SetPosition(m.position);
  }
}
