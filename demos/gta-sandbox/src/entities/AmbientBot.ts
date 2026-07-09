/**
 * AmbientBot — 氛围 NPC：站在原地循环播放一个动画片段（街头表演机器人等）。
 * 模型、片段名、缩放来自 prefab 数据；不参与追捕/碰撞，纯视觉彩蛋。
 * 无头环境没有渲染资产时自动退化为空组件（不影响任何仿真逻辑）。
 */
import * as THREE from 'three';
import { Component } from '@engine';
import { cloneSoldier } from '../util/build';

export default class AmbientBot extends Component {
  private scene: THREE.Scene;
  private gltf: any;
  private mixer: THREE.AnimationMixer | null = null;
  private clip: string;
  private scale: number;
  private yawDeg: number;

  constructor(gltf: any, scene: THREE.Scene,
              opts: { clip?: string; scale?: number; modelYawDeg?: number } = {}) {
    super();
    this.name = 'AmbientBot';
    this.gltf = gltf;
    this.scene = scene;
    this.clip = opts.clip ?? 'Idle';
    this.scale = opts.scale ?? 1;
    this.yawDeg = opts.modelYawDeg ?? 0;
  }

  Initialize(): void {
    if (!this.gltf?.scene) return;   // headless：纯视觉组件，无资产即无事可做
    const instance = cloneSoldier(this.gltf);
    const m = instance.model;
    m.scale.setScalar(this.scale);
    m.position.copy(this.parent!.Position);
    m.position.y = 0;
    m.rotation.y = (this.yawDeg * Math.PI) / 180;
    this.scene.add(m);
    this.mixer = new THREE.AnimationMixer(m);
    const clip = instance.animations.find((c) => c.name === this.clip) ?? instance.animations[0];
    if (clip) this.mixer.clipAction(clip).play();
  }

  Update(t: number): void {
    this.mixer?.update(t);
  }
}
