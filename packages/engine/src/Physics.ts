/**
 * Physics — thin wrapper over Rapier (modern WASM physics, replaces the original Ammo.js).
 * Provides: static level trimesh, kinematic character controller, dynamic bodies, raycast.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export async function initPhysics(): Promise<void> {
  await RAPIER.init();
}

export interface Character {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
}

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  collider: RAPIER.Collider;
  toi: number;
}

export default class Physics {
  public world: RAPIER.World;
  public RAPIER = RAPIER;
  /** Map collider handle -> owning Entity (set by whoever creates a collider). */
  public colliderToEntity = new Map<number, any>();

  constructor(gravity = -9.81) {
    this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
  }

  /** Build one static trimesh collider from merged level geometry. */
  addTrimesh(vertices: Float32Array, indices: Uint32Array): RAPIER.Collider {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices);
    return this.world.createCollider(desc, body);
  }

  /** Kinematic capsule + character controller for the player. */
  createCharacter(pos: THREE.Vector3, halfHeight = 0.65, radius = 0.3): Character {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z);
    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius);
    const collider = this.world.createCollider(colDesc, body);

    const controller = this.world.createCharacterController(0.02);
    controller.enableAutostep(0.5, 0.3, true);
    controller.enableSnapToGround(0.5);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);

    return { body, collider, controller };
  }

  /** Static box collider (arena ground / walls / cover). */
  addStaticBox(center: THREE.Vector3, half: THREE.Vector3): RAPIER.Collider {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z));
    return this.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z), body);
  }

  /** Kinematic capsule used as a hittable body for NPCs (moved to follow the model each frame). */
  createKinematicCapsule(pos: THREE.Vector3, halfHeight = 0.9, radius = 0.4): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z);
    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius);
    const collider = this.world.createCollider(colDesc, body);
    return { body, collider };
  }

  /** Kinematic box (vehicles / moving platforms — you move it each frame). */
  createKinematicBox(pos: THREE.Vector3, half: THREE.Vector3): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z);
    const body = this.world.createRigidBody(bodyDesc);
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z), body);
    return { body, collider };
  }

  /** Dynamic rigid body with a box/convex collider (ammo boxes). */
  createDynamicBox(pos: THREE.Vector3, half: THREE.Vector3, mass = 1): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z);
    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setMass(mass);
    const collider = this.world.createCollider(colDesc, body);
    return { body, collider };
  }

  /** Raycast; returns nearest hit with world point/normal, or null. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 1000, exclude?: RAPIER.Collider): RayHit | null {
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, undefined, exclude, undefined);
    if (!hit) return null;
    const point = ray.pointAt(hit.timeOfImpact);
    return {
      point: new THREE.Vector3(point.x, point.y, point.z),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
      toi: hit.timeOfImpact,
    };
  }

  step(): void {
    this.world.step();
  }
}
