/**
 * Car — 可驾驶的汽车（arcade 运动学 + 前向射线防撞墙 + 追车相机）。
 * 玩家靠近按 F 上车 → 接管控制与相机；驾驶中按 F 下车。
 */
import * as THREE from 'three';
import { Component, Input } from '@engine';
import type Physics from '@engine/Physics';
import type OnFootPlayer from './OnFootPlayer';
import { Bus } from '../events';

const HALF = new THREE.Vector3(0.95, 0.6, 2.0);
const BODY_Y = 0.7;
const FRICTION = 0.9;
const CAM_DIST = 8.5, CAM_HEIGHT = 4.0;

interface CarTuning {
  maxSpeed: number;
  accel: number;
  brake: number;
  reverseMax: number;
  steer: number;
}

export default class Car extends Component {
  private camera: THREE.PerspectiveCamera;
  private physics: Physics;
  private scene: THREE.Scene;
  private model: THREE.Group;
  private tuning: CarTuning;
  private body: any; private collider: any;

  public active = false;
  private heading = 0;
  private speed = 0;
  private ground = new THREE.Vector3();
  private onfoot: OnFootPlayer | null = null;
  private enteredAt = 0;   // guard: the same F keydown that entered must not instantly exit

  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, physics: Physics, scene: THREE.Scene, model: THREE.Group, spawn: THREE.Vector3, heading: number, tuning: CarTuning) {
    super();
    this.name = 'Car';
    this.camera = camera; this.physics = physics; this.scene = scene; this.model = model;
    this.ground.copy(spawn); this.heading = heading;
    this.tuning = tuning;
  }

  get Position(): THREE.Vector3 { return this.ground; }
  get Speed(): number { return this.speed; }
  get Active(): boolean { return this.active; }

  Initialize(): void {
    this.model.position.copy(this.ground);
    this.model.rotation.y = this.heading;
    this.scene.add(this.model);
    const cap = this.physics.createKinematicBox(this.tmp.copy(this.ground).setY(this.ground.y + BODY_Y), HALF);
    this.body = cap.body; this.collider = cap.collider;
    this.physics.colliderToEntity.set(this.collider.handle, this.parent);

    Input.AddKeyDownListner((e: KeyboardEvent) => {
      if (e.repeat || !this.active) return;
      // both OnFootPlayer and Car listen to F; the keydown that entered the car
      // reaches this handler too — ignore F for a short window after entering.
      if (e.code === 'KeyF' && performance.now() - this.enteredAt > 300) this.exit();
    });
  }

  enterAsDriver(onfoot: OnFootPlayer) { this.onfoot = onfoot; this.active = true; this.enteredAt = performance.now(); Bus.emit('enter-car'); }

  private exit() {
    this.active = false;
    this.updateVectors();
    // 安全落点：依次尝试 右/左/后/前 四个方向，用射线确认没有墙/建筑挡着，
    // 否则玩家会被放进建筑碰撞体里、卡住动不了（曾是真实 bug）。
    const candidates = [
      this.right.clone().multiplyScalar(2.4),
      this.right.clone().multiplyScalar(-2.4),
      this.fwd.clone().multiplyScalar(-3.4),
      this.fwd.clone().multiplyScalar(3.4),
    ];
    const origin = new THREE.Vector3(this.ground.x, this.ground.y + 1.0, this.ground.z);
    let exitPos: THREE.Vector3 | null = null;
    for (const off of candidates) {
      const hit = this.physics.raycast(origin, off.clone().normalize(), off.length() + 0.5, this.collider);
      if (!hit) { exitPos = new THREE.Vector3(this.ground.x + off.x, 0, this.ground.z + off.z); break; }
    }
    if (!exitPos) exitPos = new THREE.Vector3(this.ground.x, 0, this.ground.z); // 全堵死就原地（车顶）
    Bus.emit('exit-car', { at: [+exitPos.x.toFixed(1), +exitPos.z.toFixed(1)] });
    this.onfoot?.activate(exitPos);
  }

  private updateVectors() {
    this.fwd.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    this.right.set(-this.fwd.z, 0, this.fwd.x);
  }

  Update(t: number): void {
    if (!this.active || t <= 0) return;
    this.updateVectors();

    const throttle = Input.GetKeyDown('KeyW') - Input.GetKeyDown('KeyS');
    if (throttle > 0) this.speed = Math.min(this.tuning.maxSpeed, this.speed + this.tuning.accel * t);
    else if (throttle < 0) this.speed = Math.max(-this.tuning.reverseMax, this.speed - this.tuning.brake * t);
    else this.speed *= Math.pow(FRICTION, t * 60);
    if (Math.abs(this.speed) < 0.05) this.speed = 0;

    // steering (only while rolling; turn rate scales with speed)
    const steer = Input.GetKeyDown('KeyA') - Input.GetKeyDown('KeyD');
    const speedFactor = Math.min(1, Math.abs(this.speed) / 4);
    this.heading += steer * this.tuning.steer * t * speedFactor * Math.sign(this.speed || 1);

    // forward raycast — stop before hitting a wall/building
    if (this.speed !== 0) {
      const dir = this.tmp.copy(this.fwd).multiplyScalar(Math.sign(this.speed));
      const origin = new THREE.Vector3(this.ground.x, this.ground.y + BODY_Y, this.ground.z);
      const hit = this.physics.raycast(origin, dir, HALF.z + Math.abs(this.speed) * t + 0.6, this.collider);
      if (hit) this.speed = 0;
    }

    this.ground.addScaledVector(this.fwd, this.speed * t);
    this.ground.y = 0;

    this.body.setNextKinematicTranslation({ x: this.ground.x, y: this.ground.y + BODY_Y, z: this.ground.z });
    this.model.position.copy(this.ground);
    this.model.rotation.y = this.heading;
    this.parent!.SetPosition(this.ground);

    // chase camera (behind heading)
    const camPos = this.tmp.copy(this.ground).addScaledVector(this.fwd, -CAM_DIST); camPos.y = this.ground.y + CAM_HEIGHT;
    this.camera.position.lerp(camPos, Math.min(1, 8 * t));
    this.camera.lookAt(this.ground.x + this.fwd.x * 3, this.ground.y + 1.2, this.ground.z + this.fwd.z * 3);
  }
}
