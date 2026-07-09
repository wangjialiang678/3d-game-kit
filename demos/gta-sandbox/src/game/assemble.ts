import * as THREE from 'three';
import { Entity, EntityManager, Physics } from '@engine';
import type { Component } from '@engine';
import WantedSystem from '../entities/WantedSystem';
import MissionSystem from '../entities/MissionSystem';
import RuleSystem from '../entities/RuleSystem';
import HudView from '../view/HudView';
import PrefabRegistry from './PrefabRegistry';
import type { Content } from '../content/ContentLoader';
import type { SoldierInstance } from '../util/build';

export interface AssembleOptions {
  content: Content;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  assets: Record<string, any>;
  seed: number;
  includeHud?: boolean;
  blockMeshes?: THREE.Mesh[];
  makeSoldier?: (asset: any, tint?: THREE.ColorRepresentation) => SoldierInstance;
  makeCar?: (color?: THREE.ColorRepresentation) => THREE.Group;
  initialize?: boolean;
}

export interface AssembledGame {
  physics: Physics;
  em: EntityManager;
  prefabs: PrefabRegistry;
  blockMeshes: THREE.Mesh[];
}

function entityPosition(content: Content, instance: any): THREE.Vector3 {
  const at = instance.at;
  if (Array.isArray(at)) return new THREE.Vector3(at[0], 0, at[1]);
  if (at === 'spawns.player') {
    const p = content.scene.spawns.player;
    return new THREE.Vector3(p[0], p[1], p[2]);
  }
  if (at === 'spawns.car') {
    const p = content.scene.spawns.car.pos;
    return new THREE.Vector3(p[0], p[1], p[2]);
  }
  throw new Error(`[scene] 未知实体点位 ${String(at)}`);
}

function entityParams(content: Content, instance: any): Record<string, any> {
  const { prefab: _prefab, name: _name, at, ...params } = instance;
  if (at === 'spawns.car' && params.headingDeg === undefined) {
    params.headingDeg = content.scene.spawns.car.headingDeg;
  }
  return params;
}

function makeMeshMaterial(base: any, fallback: THREE.ColorRepresentation) {
  return base ?? new THREE.MeshBasicMaterial({ color: fallback });
}

export function buildTown(options: {
  content: Content;
  physics: Physics;
  scene: THREE.Scene;
  assets: Record<string, any>;
  blockMeshes?: THREE.Mesh[];
}) {
  const { content, physics, scene, assets } = options;
  const blockMeshes = options.blockMeshes ?? [];
  blockMeshes.length = 0;

  const half = content.scene.town.groundHalf;
  const groundMaterial = assets['matGround'];
  if (groundMaterial) {
    const ground = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 1, half * 2), makeMeshMaterial(groundMaterial, 0x444444));
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    scene.add(ground);
  }
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(half, 0.5, half));

  for (const b of content.blocks) {
    const wallMaterial = assets['matWall'];
    if (wallMaterial) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), makeMeshMaterial(wallMaterial, 0x777777));
      mesh.position.set(b.x, b.h / 2, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      blockMeshes.push(mesh);
    }
    physics.addStaticBox(new THREE.Vector3(b.x, b.h / 2, b.z), new THREE.Vector3(b.w / 2, b.h / 2, b.d / 2));
  }

  return blockMeshes;
}

function addSingleton(em: EntityManager, name: string, component: Component) {
  const entity = new Entity();
  entity.SetName(name);
  entity.AddComponent(component);
  em.Add(entity);
}

export function assembleGame(options: AssembleOptions): AssembledGame {
  const physics = new Physics(-9.81);
  const em = new EntityManager();
  const blockMeshes = options.blockMeshes ?? [];

  buildTown({
    content: options.content,
    physics,
    scene: options.scene,
    assets: options.assets,
    blockMeshes,
  });

  const prefabs = new PrefabRegistry({
    camera: options.camera,
    physics,
    scene: options.scene,
    content: options.content,
    tuning: options.content.tuning,
    assets: options.assets,
    makeSoldier: options.makeSoldier,
    makeCar: options.makeCar,
  });

  for (const instance of options.content.scene.entities) {
    em.Add(prefabs.spawn(instance.prefab, instance.name, entityPosition(options.content, instance), entityParams(options.content, instance)));
  }

  addSingleton(em, 'Wanted', new WantedSystem(prefabs, options.content.tuning.police, options.seed));
  addSingleton(em, 'Rules', new RuleSystem(options.content.rules, options.content));
  addSingleton(em, 'Missions', new MissionSystem(options.scene, options.content.missions, options.content.tuning.mission));
  if (options.includeHud) addSingleton(em, 'Hud', new HudView(options.camera));

  if (options.initialize !== false) em.EndSetup();
  return { physics, em, prefabs, blockMeshes };
}
