/**
 * SoldierNPC — enemy soldier. Direct-chase + shoot AI (no navmesh; arena is open).
 * States: idle → chase → shoot → dead. Uses Soldier.glb Idle/Walk/Run; death = topple.
 */
import * as THREE from 'three';
import Component from '@engine/Component';
import type Physics from '@engine/Physics';
import { buildRifle, buildMuzzleFlash, type SoldierInstance } from '../util/soldier';

const FOOT = 0.6 + 0.35;
const FACING_OFFSET = Math.PI;
const VIEW_DIST = 45, SHOOT_RANGE = 16, MOVE_SPEED = 2.6;
const FIRE_INTERVAL = 1.1;

type S = 'idle' | 'chase' | 'shoot' | 'dead';

export default class SoldierNPC extends Component {
  private scene: THREE.Scene;
  private physics: Physics;
  private soldier: SoldierInstance;
  private mixer!: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private current = '';
  private state: S = 'idle';

  private npcBody: any;
  private player: any;
  public health = 100;

  private rifle = buildRifle();
  private muzzle = buildMuzzleFlash();
  private handWP = new THREE.Vector3();
  private handWQ = new THREE.Quaternion();

  private fireTimer = 0;
  private deathTilt = 0;
  private idleWander = 0;

  private toPlayer = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  constructor(model: SoldierInstance, scene: THREE.Scene, physics: Physics) {
    super();
    this.name = 'SoldierNPC';
    this.soldier = model;
    this.scene = scene;
    this.physics = physics;
  }

  Initialize(): void {
    this.player = this.FindEntity('Player');
    const m = this.soldier.model;
    m.rotation.order = 'YXZ';
    m.position.copy(this.parent!.Position);
    m.position.y = 0;
    this.scene.add(m);

    this.mixer = new THREE.AnimationMixer(m);
    for (const clip of this.soldier.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.setAnim('Idle');

    this.scene.add(this.rifle);
    this.rifle.add(this.muzzle);
    this.muzzle.position.set(0, 0.02, -0.72);

    const cap = this.physics.createKinematicCapsule(m.position.clone(), 0.6, 0.35);
    this.npcBody = cap.body;
    this.physics.colliderToEntity.set(cap.collider.handle, this.parent);

    this.parent!.RegisterEventHandler(this.takeHit, 'hit');
  }

  private setAnim(name: string) {
    if (this.current === name || !this.actions[name]) return;
    this.actions[this.current]?.fadeOut(0.2);
    this.actions[name].reset().fadeIn(0.2).play();
    this.current = name;
  }

  takeHit = (msg: any) => {
    if (this.state === 'dead') return;
    this.health = Math.max(0, this.health - (msg.amount ?? 10));
    if (this.health === 0) { this.state = 'dead'; }
    else if (this.state === 'idle') this.state = 'chase';
  };

  private canSee(dist: number): boolean {
    if (dist > VIEW_DIST) return false;
    const from = this.tmp.copy(this.soldier.model.position); from.y = 1.4;
    const dir = this.toPlayer.clone().setY((this.player.Position.y + 1.4) - 1.4).normalize();
    const hit = this.physics.raycast(from, dir, dist + 1);
    return !!hit && this.physics.colliderToEntity.get(hit.collider.handle) === this.player;
  }

  private facePlayer(t: number) {
    const yaw = Math.atan2(this.toPlayer.x, this.toPlayer.z) + FACING_OFFSET;
    let dy = yaw - this.soldier.model.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    this.soldier.model.rotation.y += dy * Math.min(1, 8 * t);
  }

  Update(t: number): void {
    const m = this.soldier.model;

    if (this.state === 'dead') {
      this.deathTilt = Math.min(Math.PI / 2, this.deathTilt + t * 3.0);
      m.rotation.x = -this.deathTilt;
      m.position.y = Math.max(-0.3, m.position.y - t * 0.2);
      this.mixer.update(t * 0.3);
      this.rifle.visible = this.deathTilt < 1.0;
      return;
    }

    this.toPlayer.copy(this.player.Position).sub(m.position); this.toPlayer.y = 0;
    const dist = this.toPlayer.length();

    switch (this.state) {
      case 'idle':
        this.setAnim('Idle');
        this.idleWander -= t;
        if (this.canSee(dist)) this.state = 'chase';
        break;
      case 'chase':
        this.setAnim('Run');
        this.facePlayer(t);
        if (dist > 0.1) { this.toPlayer.normalize(); m.position.addScaledVector(this.toPlayer, MOVE_SPEED * t); }
        if (dist <= SHOOT_RANGE && this.canSee(dist)) { this.state = 'shoot'; this.fireTimer = 0.3; }
        break;
      case 'shoot':
        this.setAnim('Idle');
        this.facePlayer(t);
        if (dist > SHOOT_RANGE * 1.15) { this.state = 'chase'; break; }
        this.fireTimer -= t;
        if (this.fireTimer <= 0) {
          this.fireTimer = FIRE_INTERVAL;
          this.muzzle.visible = true; (this.muzzle as any)._life = 0.05;
          if (this.canSee(dist)) this.player.Broadcast({ topic: 'hit', amount: 8, from: this.parent });
        }
        break;
    }

    m.position.y = 0;
    this.mixer.update(t);

    // sync hittable capsule
    this.npcBody.setNextKinematicTranslation({ x: m.position.x, y: m.position.y + FOOT, z: m.position.z });

    // rifle: position from right hand, barrel oriented along facing
    if (this.soldier.rightHand) {
      this.soldier.rightHand.updateWorldMatrix(true, false);
      this.soldier.rightHand.getWorldPosition(this.handWP);
      this.rifle.position.copy(this.handWP);
      this.rifle.rotation.set(0, m.rotation.y, 0);
    }
    if (this.muzzle.visible) { (this.muzzle as any)._life -= t; if ((this.muzzle as any)._life <= 0) this.muzzle.visible = false; }

    this.parent!.SetPosition(m.position);
  }
}
