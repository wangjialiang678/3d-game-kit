import * as THREE from 'three';
import { Component, Entity } from '@engine';
import type Physics from '@engine/Physics';
import OnFootPlayer from '../entities/OnFootPlayer';
import Car from '../entities/Car';
import PoliceNPC from '../entities/PoliceNPC';
import { buildCar, cloneSoldier } from '../util/build';
import type { Content, TuningContent } from '../content/ContentLoader';
import type { PrefabDefinition } from '../../content-lib/core';

export interface PrefabDeps {
  camera: THREE.PerspectiveCamera;
  physics: Physics;
  scene: THREE.Scene;
  content: Content;
  tuning: TuningContent;
  assets: Record<string, any>;
}

export type PrefabParams = PrefabDefinition & {
  position: THREE.Vector3;
  headingDeg?: number;
};

export type ComponentFactory = (deps: PrefabDeps, params: PrefabParams) => Component;

export default class PrefabRegistry {
  private deps: PrefabDeps;
  private factories = new Map<string, ComponentFactory>();

  constructor(deps: PrefabDeps) {
    this.deps = deps;
    this.registerBuiltIns();
  }

  register(type: string, factory: ComponentFactory): void {
    this.factories.set(type, factory);
  }

  spawn(prefabName: string, name: string, pos: THREE.Vector3, instanceParams: Record<string, any> = {}): Entity {
    const prefab = this.deps.content.scene.prefabs[prefabName];
    if (!prefab) throw new Error(`[prefab] 未定义 prefab "${prefabName}"`);
    const factory = this.factories.get(prefab.controller);
    if (!factory) throw new Error(`[prefab] 未注册 controller "${prefab.controller}"`);

    const params = { ...prefab, ...instanceParams, position: pos.clone() } as PrefabParams;
    const entity = new Entity();
    entity.SetName(name);
    entity.SetPosition(pos.clone());
    entity.AddComponent(factory(this.deps, params));
    return entity;
  }

  private registerBuiltIns() {
    // Keep in sync with content-lib/core.mjs PREFAB_CONTROLLER_TYPES.
    this.register('OnFootPlayer', (deps, params) =>
      new OnFootPlayer(
        deps.camera,
        deps.physics,
        deps.scene,
        cloneSoldier(deps.assets[params.model ?? 'soldier']),
        deps.tuning.player,
      ));

    this.register('Car', (deps, params) =>
      new Car(
        deps.camera,
        deps.physics,
        deps.scene,
        buildCar(params.color ?? '#2f6fb0'),
        params.position,
        ((params.headingDeg ?? 180) * Math.PI) / 180,
        deps.tuning.car,
      ));

    this.register('PoliceNPC', (deps, params) =>
      new PoliceNPC(
        cloneSoldier(deps.assets[params.model ?? 'soldier'], params.tint ?? '#2a4bd7'),
        deps.scene,
        deps.tuning.police.speed,
      ));
  }
}
