/** Helpers for the shared Soldier.glb (three.js "vanguard", mixamorig skeleton, Idle/Walk/Run). */
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface SoldierInstance {
  model: THREE.Object3D;
  animations: THREE.AnimationClip[];
  rightHand: THREE.Bone | null;
}

/** Clone the soldier (own skeleton + materials) and optionally tint it for enemy variety. */
export function cloneSoldier(gltf: any, tint?: THREE.ColorRepresentation): SoldierInstance {
  const model = skeletonClone(gltf.scene) as THREE.Object3D;
  let rightHand: THREE.Bone | null = null;
  model.traverse((o: any) => {
    if (!rightHand && o.name && /RightHand$/.test(o.name)) rightHand = o;
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      if (tint !== undefined) {
        o.material = (o.material as THREE.Material).clone();
        (o.material as any).color = new THREE.Color(tint);
      }
    }
  });
  return { model, animations: gltf.animations, rightHand };
}

/** Build a simple low-poly rifle from primitives (attaches to a hand bone in third person). */
export function buildRifle(): THREE.Group {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2b30, metalness: 0.6, roughness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a1e, metalness: 0.1, roughness: 0.8 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.62), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.42), dark);
  barrel.position.set(0, 0.02, -0.5);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.1), dark);
  mag.position.set(0, -0.14, 0.02);
  mag.rotation.x = -0.25;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.24), wood);
  stock.position.set(0, -0.02, 0.42);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.14, 0.05), dark);
  grip.position.set(0, -0.11, 0.2);
  grip.rotation.x = 0.35;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.03), dark);
  sight.position.set(0, 0.09, -0.05);

  g.add(body, barrel, mag, stock, grip, sight);
  g.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}

/** A small additive muzzle-flash sprite that can be flashed on shoot. */
export function buildMuzzleFlash(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,190,1)');
  grad.addColorStop(0.4, 'rgba(255,170,60,0.8)');
  grad.addColorStop(1, 'rgba(255,120,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(32, 32, 32, 0, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(0.5);
  s.visible = false;
  return s;
}
