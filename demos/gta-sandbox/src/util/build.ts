/** 资产/程序化模型工具：士兵克隆、程序化汽车、任务标记。 */
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface SoldierInstance {
  model: THREE.Object3D;
  animations: THREE.AnimationClip[];
  rightHand: THREE.Bone | null;
}

export function cloneSoldier(gltf: any, tint?: THREE.ColorRepresentation): SoldierInstance {
  const model = skeletonClone(gltf.scene) as THREE.Object3D;
  let rightHand: THREE.Bone | null = null;
  model.traverse((o: any) => {
    if (!rightHand && o.name && /RightHand$/.test(o.name)) rightHand = o;
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      if (tint !== undefined) { o.material = (o.material as THREE.Material).clone(); (o.material as any).color = new THREE.Color(tint); }
    }
  });
  return { model, animations: gltf.animations, rightHand };
}

/** 程序化低多边形汽车（车身+车顶+挡风+4轮），原点在车底中心。 */
export function buildCar(color: THREE.ColorRepresentation = 0x2f6fb0): THREE.Group {
  const car = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x223044, metalness: 0.3, roughness: 0.1 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111114, metalness: 0.1, roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 4.0), bodyMat);
  body.position.y = 0.55;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.0), bodyMat);
  cabin.position.set(0, 1.05, -0.1);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.5, 2.02), glassMat);
  glass.position.set(0, 1.08, -0.1);
  car.add(body, cabin, glass);

  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 16);
  const wheelPos: [number, number, number][] = [[-1.0, 0.42, 1.3], [1.0, 0.42, 1.3], [-1.0, 0.42, -1.3], [1.0, 0.42, -1.3]];
  for (const [x, y, z] of wheelPos) {
    const w = new THREE.Mesh(wheelGeo, tireMat);
    w.rotation.z = Math.PI / 2; w.position.set(x, y, z);
    car.add(w);
  }
  car.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return car;
}

/** 任务/目标点的发光光柱（50m 高，比所有建筑都高，任何角度都能看到）。 */
export function buildMarker(color: THREE.ColorRepresentation = 0xffcc22): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 1.8, 50, 24, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
  );
  m.position.y = 25;
  return m;
}
