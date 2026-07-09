/**
 * ThirdPersonPlayer — visible soldier + over-the-shoulder third-person camera,
 * togglable to first-person with V. WASD relative to camera, Idle/Walk/Run anims,
 * raycast shooting (crosshair = screen center in both modes), rifle in right hand.
 */
import * as THREE from 'three';
import Component from '@engine/Component';
import Input from '@engine/Input';
import type Physics from '@engine/Physics';
import type { Character } from '@engine/Physics';
import { buildRifle, buildMuzzleFlash, type SoldierInstance } from '../util/soldier';
import { Bus } from '../events';
import type { TuningContent } from '../../content-lib/core';

const CAP_HALF = 0.6, CAP_RADIUS = 0.35, FOOT = CAP_HALF + CAP_RADIUS;
const MODEL_SCALE = 1.0;
const FACING_OFFSET = Math.PI;          // Soldier.glb faces +Z; flip to face aim
const DECEL = -10;
const TP_DIST = 4.0, TP_PIVOT_Y = 1.45, TP_SIDE = 0.6, FP_EYE = 1.62;

export interface PointerLockAdapter {
  isLocked(): boolean;
  request(): void;
  onChange(fn: () => void): void;
}

export default class ThirdPersonPlayer extends Component {
  private camera: THREE.PerspectiveCamera;
  private physics: Physics;
  private scene: THREE.Scene;
  private soldier: SoldierInstance;
  private playerTuning: TuningContent['player'];
  private weaponTuning: TuningContent['weapon'];
  private pointer: PointerLockAdapter;
  private character!: Character;

  private mixer!: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current = 'Idle';

  private rifle = buildRifle();
  private muzzle = buildMuzzleFlash();
  private handWP = new THREE.Vector3();
  private handWQ = new THREE.Quaternion();

  public mode: 'TP' | 'FP' = 'TP';
  public yaw = 0; public pitch = 0.05;
  private isLocked = false;

  private speed = new THREE.Vector3();
  private vVel = 0; private grounded = false;
  private modelYaw = 0;

  private shooting = false; private shootTimer = 0;
  public magAmmo: number; private ammoPerMag: number; public ammo: number; private damage: number;
  private reloading = false; private reloadTimer = 0;
  private health: number;
  private audioCtx?: AudioContext;

  private aimDir = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor(
    camera: THREE.PerspectiveCamera,
    physics: Physics,
    scene: THREE.Scene,
    soldier: SoldierInstance,
    playerTuning: TuningContent['player'],
    weaponTuning: TuningContent['weapon'],
    pointer: PointerLockAdapter,
  ) {
    super();
    this.name = 'ThirdPersonPlayer';
    this.camera = camera;
    this.physics = physics;
    this.scene = scene;
    this.soldier = soldier;
    this.playerTuning = playerTuning;
    this.weaponTuning = weaponTuning;
    this.pointer = pointer;
    this.ammoPerMag = weaponTuning.ammoPerMag;
    this.magAmmo = weaponTuning.ammoPerMag;
    this.ammo = weaponTuning.reserveAmmo;
    this.damage = weaponTuning.damage;
    this.health = playerTuning.health;
  }

  get PlayerCollider() { return this.character.collider; }
  get Health() { return this.health; }
  get Ammo() { return { mag: this.magAmmo, reserve: this.ammo }; }

  Initialize(): void {
    const pos = this.parent!.Position;
    this.character = this.physics.createCharacter(pos.clone(), CAP_HALF, CAP_RADIUS);
    this.physics.colliderToEntity.set(this.character.collider.handle, this.parent);

    const m = this.soldier.model;
    m.scale.setScalar(MODEL_SCALE);
    this.scene.add(m);
    this.mixer = new THREE.AnimationMixer(m);
    for (const clip of this.soldier.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.actions['Idle']?.play();

    this.scene.add(this.rifle);
    this.rifle.add(this.muzzle);
    this.muzzle.position.set(0, 0.02, -0.72);

    Bus.emit('ammo-changed', { mag: this.magAmmo, reserve: this.ammo });
    Bus.emit('health-changed', { health: this.health });

    // input
    Input.AddMouseMoveListner(this.onMouse);
    this.pointer.onChange(() => { this.isLocked = this.pointer.isLocked(); });
    Input.AddClickListner(() => { if (!this.isLocked) this.pointer.request(); });
    Input.AddMouseDownListner((e: MouseEvent) => { if (e.button === 0 && !this.reloading) { this.shooting = true; this.shootTimer = 0; } });
    Input.AddMouseUpListner((e: MouseEvent) => { if (e.button === 0) this.shooting = false; });
    Input.AddKeyDownListner((e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'KeyV') this.toggleMode();
      if (e.code === 'KeyR') this.reload();
    });

    this.parent!.RegisterEventHandler((msg: any) => this.takeDamage(msg), 'hit');
    this.updateAim();
  }

  private toggleMode() {
    this.setCameraMode(this.mode === 'TP' ? 'FP' : 'TP');
  }

  public setCameraMode(mode: 'TP' | 'FP') {
    this.mode = mode;
    this.soldier.model.visible = this.mode === 'TP';
    this.rifle.visible = this.mode === 'TP';
  }

  public aimAtWorld(target: THREE.Vector3) {
    const body = this.character?.body?.translation?.();
    const origin = this.mode === 'FP' && body
      ? new THREE.Vector3(body.x, body.y + FP_EYE, body.z)
      : this.camera.position;
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const dz = target.z - origin.z;
    const flat = Math.hypot(dx, dz);
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(dy, flat)));
  }

  private onMouse = (e: MouseEvent) => {
    if (!this.isLocked) return;
    this.yaw -= e.movementX * this.playerTuning.mouseSpeed;
    this.pitch -= e.movementY * this.playerTuning.mouseSpeed;
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
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

  private reload() {
    if (this.reloading || this.magAmmo === this.ammoPerMag || this.ammo === 0) return;
    this.reloading = true; this.shooting = false; this.reloadTimer = this.weaponTuning.reloadSecs;
  }

  private takeDamage(msg: any) {
    this.health = Math.max(0, this.health - (msg.amount ?? 8));
    Bus.emit('player-hit', { amount: msg.amount ?? 8, health: this.health });
    Bus.emit('health-changed', { health: this.health });
  }

  private gunshot() {
    try {
      if (!this.audioCtx) this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = this.audioCtx, t = ctx.currentTime;
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
      src.connect(lp).connect(g).connect(ctx.destination); src.start(t);
    } catch { /* ignore */ }
  }

  private raycast() {
    this.camera.getWorldPosition(this.tmp);
    const hit = this.physics.raycast(this.tmp, this.aimDir, 1000, this.character.collider);
    if (!hit) return;
    const ent = this.physics.colliderToEntity.get(hit.collider.handle);
    if (ent) ent.Broadcast({ topic: 'hit', from: this.parent, amount: this.damage, hitResult: hit });
  }

  private shoot(t: number) {
    if (!this.shooting) return;
    if (!this.magAmmo) { this.reload(); return; }
    if (this.shootTimer <= 0) {
      this.magAmmo--;
      Bus.emit('weapon-fired', { mag: this.magAmmo, reserve: this.ammo });
      Bus.emit('ammo-changed', { mag: this.magAmmo, reserve: this.ammo });
      this.shootTimer = this.weaponTuning.fireRate;
      this.raycast();
      this.gunshot();
      this.muzzle.visible = true; (this.muzzle as any)._life = 0.05;
      this.muzzle.scale.setScalar(0.4 + Math.random() * 0.3);
    }
    this.shootTimer -= t;
  }

  Update(t: number): void {
    if (t <= 0) return;
    this.updateAim();

    // ---- movement ----
    const f = Input.GetKeyDown('KeyW') - Input.GetKeyDown('KeyS');
    const r = Input.GetKeyDown('KeyD') - Input.GetKeyDown('KeyA');
    const dir = this.tmp.copy(this.fwd).multiplyScalar(f).addScaledVector(this.right, r);
    if (dir.lengthSq() > 0) dir.normalize();

    const accel = this.playerTuning.maxSpeed / this.playerTuning.accelTime;
    this.speed.addScaledVector(this.speed, DECEL * t);
    this.speed.addScaledVector(dir, accel * t);
    if (this.speed.length() > this.playerTuning.maxSpeed) this.speed.setLength(this.playerTuning.maxSpeed);

    this.grounded = this.character.controller.computedGrounded();
    if (this.grounded && this.vVel < 0) this.vVel = -1;
    this.vVel += -20 * t;
    if (Input.GetKeyDown('Space') && this.grounded) this.vVel = this.playerTuning.jumpVelocity;

    const desired = { x: this.speed.x * t, y: this.vVel * t, z: this.speed.z * t };
    this.character.controller.computeColliderMovement(this.character.collider, desired);
    const mv = this.character.controller.computedMovement();
    const p = this.character.body.translation();
    const next = { x: p.x + mv.x, y: p.y + mv.y, z: p.z + mv.z };
    this.character.body.setNextKinematicTranslation(next);

    // ---- model placement + facing (face aim horizontally) ----
    const m = this.soldier.model;
    m.position.set(next.x, next.y - FOOT, next.z);
    const targetYaw = Math.atan2(this.aimDir.x, this.aimDir.z) + FACING_OFFSET;
    let dy = targetYaw - this.modelYaw;
    while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    this.modelYaw += dy * Math.min(1, 12 * t);
    m.rotation.y = this.modelYaw;

    // ---- animation by speed ----
    const spd = Math.hypot(this.speed.x, this.speed.z);
    this.setAnim(spd > 3.0 ? 'Run' : spd > 0.15 ? 'Walk' : 'Idle');
    this.mixer.update(t);

    // ---- rifle: position from right hand, barrel oriented along aim ----
    if (this.soldier.rightHand) {
      this.soldier.rightHand.updateWorldMatrix(true, false);
      this.soldier.rightHand.getWorldPosition(this.handWP);
      this.rifle.position.copy(this.handWP);
      this.rifle.rotation.set(-this.aimDir.y * 0.5, Math.atan2(this.aimDir.x, this.aimDir.z) + Math.PI, 0);
    }

    // ---- shooting + muzzle fade ----
    if (this.reloading) {
      this.reloadTimer -= t;
      if (this.reloadTimer <= 0) {
        this.reloading = false;
        const need = this.ammoPerMag - this.magAmmo;
        this.magAmmo = Math.min(this.ammo + this.magAmmo, this.ammoPerMag);
        this.ammo = Math.max(0, this.ammo - need);
        Bus.emit('ammo-changed', { mag: this.magAmmo, reserve: this.ammo });
      }
    }
    this.shoot(t);
    if (this.muzzle.visible) { (this.muzzle as any)._life -= t; if ((this.muzzle as any)._life <= 0) this.muzzle.visible = false; }

    // ---- camera ----
    const pivot = this.tmp.set(next.x, next.y + TP_PIVOT_Y, next.z);
    if (this.mode === 'TP') {
      const cam = new THREE.Vector3().copy(pivot).addScaledVector(this.aimDir, -TP_DIST).addScaledVector(this.right, TP_SIDE);
      this.camera.position.copy(cam);
      this.camera.lookAt(pivot.x + this.aimDir.x, pivot.y + this.aimDir.y, pivot.z + this.aimDir.z);
    } else {
      this.camera.position.set(next.x, next.y + FP_EYE, next.z);
      this.camera.lookAt(next.x + this.aimDir.x, next.y + FP_EYE + this.aimDir.y, next.z + this.aimDir.z);
    }
    this.parent!.SetPosition(this.soldier.model.position);
  }
}
