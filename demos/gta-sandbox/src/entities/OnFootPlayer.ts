/**
 * OnFootPlayer — 第三人称步行玩家（士兵）。走/跑 + 越肩相机。
 * 靠近汽车按 F 上车（把控制权和相机交给 Car，自己隐藏、失活）。
 */
import * as THREE from 'three';
import { Component, Input } from '@engine';
import type Physics from '@engine/Physics';
import type { Character } from '@engine/Physics';
import type { SoldierInstance } from '../util/build';

const CAP_HALF = 0.6, CAP_RADIUS = 0.35, FOOT = CAP_HALF + CAP_RADIUS;
const FACING_OFFSET = Math.PI;
const MOUSE = 0.0022;
const MAX_SPEED = 5.0, ACCEL = MAX_SPEED / 0.09, DECEL = -10;
const TP_DIST = 4.2, TP_PIVOT_Y = 1.45, TP_SIDE = 0.6;

export default class OnFootPlayer extends Component {
  private camera: THREE.PerspectiveCamera;
  private physics: Physics;
  private scene: THREE.Scene;
  private soldier: SoldierInstance;
  private character!: Character;

  private mixer!: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current = 'Idle';

  public active = true;
  private yaw = 0; private pitch = 0.05; private isLocked = false;
  private speed = new THREE.Vector3();
  private vVel = 0; private grounded = false;
  private modelYaw = 0;

  private aimDir = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, physics: Physics, scene: THREE.Scene, soldier: SoldierInstance) {
    super();
    this.name = 'OnFootPlayer';
    this.camera = camera; this.physics = physics; this.scene = scene; this.soldier = soldier;
  }

  get Yaw() { return this.yaw; }

  Initialize(): void {
    const pos = this.parent!.Position;
    this.character = this.physics.createCharacter(pos.clone(), CAP_HALF, CAP_RADIUS);
    this.physics.colliderToEntity.set(this.character.collider.handle, this.parent);
    const m = this.soldier.model;
    m.position.set(pos.x, pos.y - FOOT, pos.z);   // place feet on the ground from frame 0
    this.scene.add(m);
    this.mixer = new THREE.AnimationMixer(m);
    for (const clip of this.soldier.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.actions['Idle']?.play();

    Input.AddMouseMoveListner(this.onMouse);
    document.addEventListener('pointerlockchange', () => { this.isLocked = !!document.pointerLockElement; });
    Input.AddClickListner(() => { if (!this.isLocked) document.body.requestPointerLock(); });
    Input.AddKeyDownListner((e: KeyboardEvent) => {
      if (e.repeat || !this.active) return;
      if (e.code === 'KeyF') this.tryEnterCar();
    });
    this.updateAim();
  }

  private onMouse = (e: MouseEvent) => {
    if (!this.isLocked || !this.active) return;
    this.yaw -= e.movementX * MOUSE;
    this.pitch -= e.movementY * MOUSE;
    this.pitch = Math.max(-1.1, Math.min(1.1, this.pitch));
  };

  private updateAim() {
    this.aimDir.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)).normalize();
    this.fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    this.right.set(-this.fwd.z, 0, this.fwd.x);
  }

  private setAnim(name: string) {
    if (this.current === name || !this.actions[name]) return;
    this.actions[this.current]?.fadeOut(0.2);
    this.actions[name].reset().fadeIn(0.2).play();
    this.current = name;
  }

  private tryEnterCar() {
    const carEnt = this.FindEntity('Car');
    if (!carEnt) return;
    const car = carEnt.GetComponent('Car');
    const d = this.parent!.Position.distanceTo(car.Position);
    if (d < 5.0) { this.deactivate(); car.enterAsDriver(this); }
  }

  /** 被 Car 调用：下车后在指定位置复活步行控制。 */
  activate(pos: THREE.Vector3) {
    this.active = true;
    this.soldier.model.visible = true;
    this.character.body.setNextKinematicTranslation({ x: pos.x, y: pos.y + 0.2, z: pos.z });
    this.speed.set(0, 0, 0); this.vVel = 0;
  }
  private deactivate() { this.active = false; this.soldier.model.visible = false; }

  Update(t: number): void {
    if (!this.active || t <= 0) { this.mixer && this.mixer.update(t); return; }
    this.updateAim();

    const f = Input.GetKeyDown('KeyW') - Input.GetKeyDown('KeyS');
    const r = Input.GetKeyDown('KeyD') - Input.GetKeyDown('KeyA');
    const dir = this.tmp.copy(this.fwd).multiplyScalar(f).addScaledVector(this.right, r);
    if (dir.lengthSq() > 0) dir.normalize();
    this.speed.addScaledVector(this.speed, DECEL * t);
    this.speed.addScaledVector(dir, ACCEL * t);
    if (this.speed.length() > MAX_SPEED) this.speed.setLength(MAX_SPEED);

    this.grounded = this.character.controller.computedGrounded();
    if (this.grounded && this.vVel < 0) this.vVel = -1;
    this.vVel += -20 * t;
    if (Input.GetKeyDown('Space') && this.grounded) this.vVel = 6;

    this.character.controller.computeColliderMovement(this.character.collider, { x: this.speed.x * t, y: this.vVel * t, z: this.speed.z * t });
    const mv = this.character.controller.computedMovement();
    const p = this.character.body.translation();
    const next = { x: p.x + mv.x, y: p.y + mv.y, z: p.z + mv.z };
    if (next.y < FOOT) next.y = FOOT;   // town ground is flat at y=0 → never sink below resting height
    this.character.body.setNextKinematicTranslation(next);

    const m = this.soldier.model;
    m.position.set(next.x, next.y - FOOT, next.z);
    const targetYaw = Math.atan2(this.aimDir.x, this.aimDir.z) + FACING_OFFSET;
    let dy = targetYaw - this.modelYaw;
    while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    this.modelYaw += dy * Math.min(1, 12 * t);
    m.rotation.y = this.modelYaw;

    const spd = Math.hypot(this.speed.x, this.speed.z);
    this.setAnim(spd > 3.0 ? 'Run' : spd > 0.15 ? 'Walk' : 'Idle');
    this.mixer.update(t);

    const pivot = this.tmp.set(next.x, next.y + TP_PIVOT_Y, next.z);
    const cam = new THREE.Vector3().copy(pivot).addScaledVector(this.aimDir, -TP_DIST).addScaledVector(this.right, TP_SIDE);
    this.camera.position.copy(cam);
    this.camera.lookAt(pivot.x + this.aimDir.x, pivot.y + this.aimDir.y, pivot.z + this.aimDir.z);
    this.parent!.SetPosition(m.position);
  }
}
