/**
 * CityView — 城市视觉层：楼模型/马路/广场铺装，全部纯视觉。
 * 物理与玩法真相仍是 content.blocks（这里只生成隐形热区盒给编辑器拾取），
 * 楼模型作为热区盒的子节点自动跟随编辑器拖拽。
 * 无头环境没有渲染资产时整体跳过，仿真与浏览器物理一致。
 */
import * as THREE from 'three';

export interface BuildingStyles {
  tallMin?: number;
  tall: string[];
  mid: string[];
}

/** 确定性风格挑选：同一 seed+index 永远选同一栋楼（刷新/重载不变脸）。 */
function pick(list: string[], seed: number, index: number): string {
  const h = (Math.imul(index + 1, 2654435761) ^ Math.imul((seed | 0) + 1, 40503)) >>> 0;
  return list[h % list.length];
}

export function hasCityAssets(assets: Record<string, any>, styles?: BuildingStyles): boolean {
  if (!styles?.tall?.length || !styles?.mid?.length) return false;
  return [...styles.tall, ...styles.mid].every((k) => !!assets[k]?.scene);
}

/** 隐形热区盒（编辑器拾取/拖拽行为不变）+ 按块尺寸拉伸的楼模型子节点。 */
export function makeBlockVisual(
  b: { x: number; z: number; w: number; d: number; h: number },
  index: number,
  assets: Record<string, any>,
  styles: BuildingStyles,
  seed: number,
): THREE.Mesh {
  const hitMat = new THREE.MeshBasicMaterial();
  hitMat.visible = false;
  const hit = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), hitMat);
  hit.position.set(b.x, b.h / 2, b.z);
  hit.castShadow = false;
  hit.userData = { type: 'block', index };

  const list = b.h >= (styles.tallMin ?? 13) ? styles.tall : styles.mid;
  const gltf = assets[pick(list, seed, index)];
  if (gltf?.scene) {
    const model = gltf.scene.clone(true) as THREE.Object3D;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    // 楼模型原点在底部中心（Kenney 约定）；三轴拉伸填满块体
    model.scale.set(b.w / Math.max(size.x, 0.01), b.h / Math.max(size.y, 0.01), b.d / Math.max(size.z, 0.01));
    model.position.set(0, -b.h / 2, 0);
    model.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    hit.add(model);
  }
  return hit;
}

/** 马路线位置：格网走廊中线（cell=26, range=2 → ±13/±39），与 content-lib 的 roadIntersections 同构。 */
function roadLines(town: any): number[] {
  const lines: number[] = [];
  for (let k = -town.gridRange; k <= town.gridRange - 1; k++) lines.push((k + 0.5) * town.cell);
  return lines;
}

function cloneTile(gltf: any, w: number, d: number, rotYDeg = 0): THREE.Object3D {
  const m = gltf.scene.clone(true) as THREE.Object3D;
  m.rotation.y = (rotYDeg * Math.PI) / 180;
  m.scale.set(w, 1, d);
  m.traverse((o: any) => {
    if (!o.isMesh) return;
    o.receiveShadow = true;
    // 铺装贴着地面，远景深度精度不够会闪面——用 polygonOffset 让铺装稳赢深度测试
    // （clone 共享材质实例，重复设置无副作用）
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -2;
      mat.polygonOffsetUnits = -4;
      mat.side = THREE.FrontSide;   // 双面薄片顶/底面远景互打，剔除底面
    }
  });
  return m;
}

/** 沿走廊铺路：路口之间一整段拉伸（无重叠无缝隙），交叉口铺十字件。纯视觉，无碰撞。 */
export function buildRoads(scene: THREE.Scene, town: any, assets: Record<string, any>): void {
  const straight = assets['road-straight'];
  const cross = assets['road-crossroad'];
  if (!straight?.scene || !cross?.scene) return;

  const rw = town.roadWidth ?? 9;
  const half = town.groundHalf;
  const lines = roadLines(town);
  const group = new THREE.Group();
  group.name = 'CityRoads';
  const Y = 0.05;   // 抬离地面，避免与地面深度打架

  // 交叉口
  for (const rx of lines) for (const rz of lines) {
    const t = cloneTile(cross, rw, rw);
    t.position.set(rx, Y, rz);
    group.add(t);
  }
  // 路段端点表：地图边缘 + 各路口边缘
  const stops = [-half, ...lines, half];
  for (const r of lines) {
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i] + (lines.includes(stops[i]) ? rw / 2 : 0);
      const b = stops[i + 1] - (lines.includes(stops[i + 1]) ? rw / 2 : 0);
      const len = b - a;
      if (len <= 0.1) continue;
      const mid = (a + b) / 2;
      const vert = cloneTile(straight, rw, rw, 0);   // 车道沿 Z
      vert.scale.set(rw, 1, len);
      vert.position.set(r, Y, mid);
      group.add(vert);
      const horiz = cloneTile(straight, rw, rw, 90); // 车道沿 X（旋转后本地 Z 对齐世界 X）
      horiz.scale.set(rw, 1, len);
      horiz.position.set(mid, Y, r);
      group.add(horiz);
    }
  }
  scene.add(group);
}

/** 广场铺装：plaza 格整块铺地砖。 */
export function buildPlaza(scene: THREE.Scene, town: any, assets: Record<string, any>): void {
  const tile = assets['plaza-tile'];
  if (!tile?.scene) return;
  const rw = town.roadWidth ?? 9;
  const size = town.cell - rw;   // 减去四周马路
  for (const [cx, cz] of town.plaza ?? []) {
    const t = cloneTile(tile, size, size);
    t.position.set(cx * town.cell, 0.03, cz * town.cell);
    scene.add(t);
  }
}
