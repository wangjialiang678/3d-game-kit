/**
 * Prop — 静态街景装饰（喷泉/树/雕塑…）。
 * 碰撞尺寸显式来自 prefab 数据（物理真相在内容包里，两端一致）；
 * GLB 模型只管视觉，无头环境没有渲染资产时自动退化为纯碰撞体。
 */
import * as THREE from 'three';
import { Component } from '@engine';
import type Physics from '@engine/Physics';
import { buildProp } from '../util/build';

export default class Prop extends Component {
  private scene: THREE.Scene;
  private physics: Physics;
  private gltf: any;
  private scale: number;
  private yawDeg: number;
  private collider: [number, number, number] | null;

  constructor(gltf: any, scene: THREE.Scene, physics: Physics,
              opts: { scale?: number; modelYawDeg?: number; collider?: [number, number, number] } = {}) {
    super();
    this.name = 'Prop';
    this.gltf = gltf;
    this.scene = scene;
    this.physics = physics;
    this.scale = opts.scale ?? 1;
    this.yawDeg = opts.modelYawDeg ?? 0;
    this.collider = Array.isArray(opts.collider) && opts.collider.length === 3 ? opts.collider : null;
  }

  Initialize(): void {
    const pos = this.parent!.Position;
    if (this.collider) {
      const half = new THREE.Vector3(this.collider[0] / 2, this.collider[1] / 2, this.collider[2] / 2);
      this.physics.addStaticBox(new THREE.Vector3(pos.x, half.y, pos.z), half);
    }
    if (this.gltf?.scene) {
      const { model } = buildProp(this.gltf, this.scale, this.yawDeg);
      model.position.set(pos.x, 0, pos.z);
      this.scene.add(model);
    }
  }

  Update(): void { /* 静态装饰，无逐帧逻辑 */ }
}
