import * as THREE from 'three';
import { Component, Entity } from '@engine';
import type Physics from '@engine/Physics';
import ThirdPersonPlayer, { type PointerLockAdapter } from '../entities/ThirdPersonPlayer';
import SoldierNPC from '../entities/SoldierNPC';
import { cloneSoldier } from '../util/soldier';
import type { ArenaContent, EntityInstance, PrefabDefinition, TuningContent } from '../../content-lib/core';

export interface PrefabDeps {
  camera: THREE.PerspectiveCamera;
  physics: Physics;
  scene: THREE.Scene;
  arena: ArenaContent;
  tuning: TuningContent;
  assets: Record<string, any>;
  pointer: PointerLockAdapter;
}

type PrefabParams = PrefabDefinition & EntityInstance & { position: THREE.Vector3 };
type ComponentFactory = (deps: PrefabDeps, params: PrefabParams) => Component;

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

  spawn(instance: EntityInstance, position: THREE.Vector3): Entity {
    const prefab = this.deps.arena.prefabs[instance.prefab];
    if (!prefab) throw new Error(`[prefab] 未定义 prefab "${instance.prefab}"`);
    const factory = this.factories.get(prefab.controller);
    if (!factory) throw new Error(`[prefab] 未注册 controller "${prefab.controller}"`);
    const entity = new Entity();
    entity.SetName(instance.name);
    entity.SetPosition(position.clone());
    entity.AddComponent(factory(this.deps, { ...prefab, ...instance, position }));
    return entity;
  }

  private registerBuiltIns() {
    this.register('ThirdPersonPlayer', (deps, params) =>
      new ThirdPersonPlayer(
        deps.camera,
        deps.physics,
        deps.scene,
        cloneSoldier(deps.assets[params.model ?? 'soldier']),
        deps.tuning.player,
        deps.tuning.weapon,
        deps.pointer,
      ));

    this.register('SoldierNPC', (deps, params) =>
      new SoldierNPC(
        cloneSoldier(deps.assets[params.model ?? 'soldier'], params.tint ?? '#7a6a44'),
        deps.scene,
        deps.physics,
        deps.tuning.enemy,
      ));
  }
}
