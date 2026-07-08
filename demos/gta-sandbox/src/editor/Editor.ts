/**
 * Editor — 游戏内可视化编辑器（P4）。
 * 游戏中按 E 进入：轨道相机俯瞰小镇，点选建筑/任务点/出生点，拖拽移动、
 * 属性面板改数值、增删对象；[校验] 跑与 CLI/游戏同一份规则；[保存] 写回
 * public/content/*.json（经 vite 中间件）并重载——人与 AI 编辑的是同一份内容数据。
 *
 * 注意：编辑模式冻结游戏模拟，物理碰撞体不实时重建；因此退出只有两条路：
 * 保存并重载 / 放弃并重载（保证画面-数据-物理三者一致）。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { validateContent } from '../../content-lib/core.mjs';

type Sel =
  | { type: 'block'; index: number; mesh: THREE.Mesh }
  | { type: 'mission'; index: number; mesh: THREE.Mesh }
  | { type: 'spawn-player'; mesh: THREE.Object3D }
  | { type: 'spawn-car'; mesh: THREE.Object3D };

export default class Editor {
  private g: any;
  private controls!: OrbitControls;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private sel: Sel | null = null;
  private dragging = false;

  private gizmos = new THREE.Group();
  private missionMeshes: THREE.Mesh[] = [];
  private playerGizmo!: THREE.Object3D;
  private carGizmo!: THREE.Object3D;

  private panel!: HTMLElement;
  private props!: HTMLElement;
  private issuesEl!: HTMLElement;

  constructor(game: any) { this.g = game; }

  enter() {
    (window as any).__editor = this;   // 供测试/AI 代理编程操作
    const g = this.g;
    g.running = false;
    try { document.exitPointerLock(); } catch { /* ignore */ }

    // 俯瞰相机 + 轨道控制
    this.controls = new OrbitControls(g.camera, g.renderer.domElement);
    g.camera.position.set(0, 90, 70);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.buildGizmos();
    this.buildPanel();

    g.renderer.domElement.addEventListener('pointerdown', this.onDown);
    g.renderer.domElement.addEventListener('pointermove', this.onMove);
    g.renderer.domElement.addEventListener('pointerup', this.onUp);
    g.renderer.setAnimationLoop(() => { this.controls.update(); g.renderer.render(g.scene, g.camera); });
  }

  // ---------- 场景标记 ----------
  private buildGizmos() {
    const g = this.g;
    g.scene.add(this.gizmos);
    // 所有任务点（编辑模式下全部可见，橙色小柱）
    this.g.content.missions.forEach((m: any, i: number) => {
      if (!m.pos) return;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1.2, 1.2, 10, 16),
        new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.75 }),
      );
      mesh.position.set(m.pos[0], 5, m.pos[1]);
      mesh.userData = { type: 'mission', index: i };
      this.gizmos.add(mesh);
      this.missionMeshes.push(mesh);
    });
    // 玩家出生点（绿色锥）
    const sp = g.content.scene.spawns;
    this.playerGizmo = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3.5, 16), new THREE.MeshBasicMaterial({ color: 0x37d67a }));
    this.playerGizmo.position.set(sp.player[0], 1.75, sp.player[2]);
    this.playerGizmo.userData = { type: 'spawn-player' };
    this.gizmos.add(this.playerGizmo);
    // 汽车出生点（蓝色块）
    this.carGizmo = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 4.2), new THREE.MeshBasicMaterial({ color: 0x3f8cff, transparent: true, opacity: 0.8 }));
    this.carGizmo.position.set(sp.car.pos[0], 0.6, sp.car.pos[2]);
    this.carGizmo.rotation.y = (sp.car.headingDeg * Math.PI) / 180;
    this.carGizmo.userData = { type: 'spawn-car' };
    this.gizmos.add(this.carGizmo);
    // 建筑 mesh 打标（由 main.buildTown 暴露）
    g.blockMeshes.forEach((mesh: THREE.Mesh, i: number) => { mesh.userData = { type: 'block', index: i }; });
  }

  // ---------- 拾取与拖拽 ----------
  private pick(ev: PointerEvent): Sel | null {
    const g = this.g;
    const r = g.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, g.camera);
    const hits = this.ray.intersectObjects([...this.gizmos.children, ...g.blockMeshes], false);
    if (!hits.length) return null;
    const o = hits[0].object as THREE.Mesh;
    const u = o.userData;
    if (u.type === 'block') return { type: 'block', index: u.index, mesh: o };
    if (u.type === 'mission') return { type: 'mission', index: u.index, mesh: o };
    if (u.type === 'spawn-player') return { type: 'spawn-player', mesh: o };
    if (u.type === 'spawn-car') return { type: 'spawn-car', mesh: o };
    return null;
  }

  private onDown = (ev: PointerEvent) => {
    const s = this.pick(ev);
    this.select(s);
    if (s) { this.dragging = true; this.controls.enabled = false; }
  };

  private onMove = (ev: PointerEvent) => {
    if (!this.dragging || !this.sel) return;
    const g = this.g;
    const r = g.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, g.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.ground, hit)) return;
    const x = Math.round(hit.x * 2) / 2, z = Math.round(hit.z * 2) / 2;   // 0.5m 吸附
    this.applyMove(x, z);
    this.fillProps();
  };

  private onUp = () => { this.dragging = false; this.controls.enabled = true; };

  private applyMove(x: number, z: number) {
    const c = this.g.content;
    const s = this.sel!;
    if (s.type === 'block') { const b = c.blocks[s.index]; b.x = x; b.z = z; s.mesh.position.x = x; s.mesh.position.z = z; }
    else if (s.type === 'mission') { c.missions[s.index].pos = [x, z]; s.mesh.position.x = x; s.mesh.position.z = z; }
    else if (s.type === 'spawn-player') { const sp = c.scene.spawns.player; sp[0] = x; sp[2] = z; s.mesh.position.x = x; s.mesh.position.z = z; }
    else if (s.type === 'spawn-car') { const cp = c.scene.spawns.car.pos; cp[0] = x; cp[2] = z; s.mesh.position.x = x; s.mesh.position.z = z; }
  }

  private select(s: Sel | null) {
    // 高亮：还原旧选中
    if (this.sel?.type === 'block') ((this.sel.mesh.material as THREE.MeshStandardMaterial).emissive as THREE.Color)?.set(0x000000);
    this.sel = s;
    if (s?.type === 'block') {
      const m = s.mesh.material as THREE.MeshStandardMaterial;
      if (m.emissive) m.emissive.set(0x664400);
    }
    this.fillProps();
  }

  // ---------- 面板 ----------
  private buildPanel() {
    const el = document.createElement('div');
    el.innerHTML = `
      <style>
        #kit-editor { position: fixed; right: 16px; top: 16px; z-index: 50; width: 300px;
          background: rgba(12,14,18,.94); border: 1px solid #2f3540; border-radius: 10px;
          color: #dfe6ee; font: 13px/1.6 Arial; padding: 14px 16px; }
        #kit-editor h3 { font-size: 15px; letter-spacing: 2px; color: #ffd23f; margin-bottom: 8px; }
        #kit-editor .hint { opacity: .55; font-size: 12px; margin-bottom: 10px; }
        #kit-editor label { display: flex; justify-content: space-between; align-items: center; margin: 4px 0; gap: 8px; }
        #kit-editor input[type=number], #kit-editor input[type=text] { width: 150px; background: #1a1e26; color: #fff;
          border: 1px solid #39404d; border-radius: 4px; padding: 3px 6px; }
        #kit-editor .row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
        #kit-editor button { flex: 1; min-width: 84px; padding: 7px 4px; border: none; border-radius: 5px; cursor: pointer;
          font-weight: 700; background: #2b3442; color: #dfe6ee; }
        #kit-editor button.primary { background: #ffd23f; color: #14161a; }
        #kit-editor button.danger { background: #7a2b2b; color: #ffd9d9; }
        #kit-editor #kit-issues { margin-top: 10px; font-size: 12px; max-height: 200px; overflow: auto; }
        #kit-editor #kit-issues .bad { color: #ff8a8a; margin: 3px 0; }
        #kit-editor #kit-issues .good { color: #7cf27c; }
      </style>
      <div id="kit-editor">
        <h3>🛠 编辑模式</h3>
        <div class="hint">左键点选（建筑/橙柱=任务点/绿锥=玩家/蓝块=车），拖拽移动（0.5m 吸附），右键旋转视角</div>
        <div id="kit-props"><i>未选中对象</i></div>
        <div class="row">
          <button id="kit-add-block">＋建筑</button>
          <button id="kit-add-mission">＋任务点</button>
          <button id="kit-del" class="danger">删除选中</button>
        </div>
        <div class="row">
          <button id="kit-validate">校验</button>
          <button id="kit-save" class="primary">保存并重载</button>
          <button id="kit-discard" class="danger">放弃并重载</button>
        </div>
        <div id="kit-issues"></div>
      </div>`;
    document.body.appendChild(el);
    this.panel = el;
    this.props = el.querySelector('#kit-props')!;
    this.issuesEl = el.querySelector('#kit-issues')!;

    el.querySelector('#kit-validate')!.addEventListener('click', () => this.validate());
    el.querySelector('#kit-save')!.addEventListener('click', () => this.save());
    el.querySelector('#kit-discard')!.addEventListener('click', () => location.reload());
    el.querySelector('#kit-add-block')!.addEventListener('click', () => this.addBlock());
    el.querySelector('#kit-add-mission')!.addEventListener('click', () => this.addMission());
    el.querySelector('#kit-del')!.addEventListener('click', () => this.deleteSelected());
  }

  private input(label: string, value: number | string, onChange: (v: string) => void, type = 'number') {
    const id = `kit-f-${Math.random().toString(36).slice(2, 8)}`;
    setTimeout(() => document.getElementById(id)?.addEventListener('change', (e) => { onChange((e.target as HTMLInputElement).value); this.syncSelMesh(); }));
    return `<label>${label}<input id="${id}" type="${type}" value="${value}" step="0.5"></label>`;
  }

  private fillProps() {
    const c = this.g.content;
    const s = this.sel;
    if (!s) { this.props.innerHTML = '<i>未选中对象</i>'; return; }
    if (s.type === 'block') {
      const b = c.blocks[s.index];
      this.props.innerHTML = `<b>建筑 #${s.index}</b>` +
        this.input('x', b.x.toFixed(1), v => { b.x = +v; }) + this.input('z', b.z.toFixed(1), v => { b.z = +v; }) +
        this.input('宽 w', b.w.toFixed(1), v => { b.w = +v; }) + this.input('深 d', b.d.toFixed(1), v => { b.d = +v; }) +
        this.input('高 h', b.h.toFixed(1), v => { b.h = +v; });
    } else if (s.type === 'mission') {
      const m = c.missions[s.index];
      this.props.innerHTML = `<b>任务点 #${s.index}</b>` +
        this.input('文字', m.text, v => { m.text = v; }, 'text') +
        this.input('x', m.pos[0], v => { m.pos[0] = +v; }) + this.input('z', m.pos[1], v => { m.pos[1] = +v; });
    } else if (s.type === 'spawn-player') {
      const sp = c.scene.spawns.player;
      this.props.innerHTML = `<b>玩家出生点</b>` +
        this.input('x', sp[0], v => { sp[0] = +v; }) + this.input('z', sp[2], v => { sp[2] = +v; });
    } else {
      const cp = c.scene.spawns.car;
      this.props.innerHTML = `<b>汽车出生点</b>` +
        this.input('x', cp.pos[0], v => { cp.pos[0] = +v; }) + this.input('z', cp.pos[2], v => { cp.pos[2] = +v; }) +
        this.input('朝向°', cp.headingDeg, v => { cp.headingDeg = +v; });
    }
  }

  /** 面板数值改动后，把选中对象的 mesh 同步到数据。 */
  private syncSelMesh() {
    const c = this.g.content;
    const s = this.sel;
    if (!s) return;
    if (s.type === 'block') {
      const b = c.blocks[s.index];
      s.mesh.geometry.dispose();
      s.mesh.geometry = new THREE.BoxGeometry(b.w, b.h, b.d);
      s.mesh.position.set(b.x, b.h / 2, b.z);
    } else if (s.type === 'mission') {
      const m = c.missions[s.index];
      s.mesh.position.set(m.pos[0], 5, m.pos[1]);
    } else if (s.type === 'spawn-player') {
      const sp = c.scene.spawns.player;
      s.mesh.position.set(sp[0], 1.75, sp[2]);
    } else {
      const cp = c.scene.spawns.car;
      s.mesh.position.set(cp.pos[0], 0.6, cp.pos[2]);
      s.mesh.rotation.y = (cp.headingDeg * Math.PI) / 180;
    }
  }

  // ---------- 增删 ----------
  private addBlock() {
    const c = this.g.content;
    const b = { x: 0, z: 0, w: 8, d: 8, h: 8 };
    c.blocks.push(b);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), this.g.assets['matWall']);
    mesh.position.set(b.x, b.h / 2, b.z); mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData = { type: 'block', index: c.blocks.length - 1 };
    this.g.scene.add(mesh);
    this.g.blockMeshes.push(mesh);
    this.select({ type: 'block', index: c.blocks.length - 1, mesh });
  }

  private addMission() {
    const c = this.g.content;
    c.missions.push({ text: '新任务：到达光柱', pos: [0, 13] });
    const i = c.missions.length - 1;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 10, 16),
      new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.75 }),
    );
    mesh.position.set(0, 5, 13);
    mesh.userData = { type: 'mission', index: i };
    this.gizmos.add(mesh);
    this.missionMeshes.push(mesh);
    this.select({ type: 'mission', index: i, mesh });
  }

  private deleteSelected() {
    const c = this.g.content;
    const s = this.sel;
    if (!s) return;
    if (s.type === 'block') {
      c.blocks.splice(s.index, 1);
      this.g.scene.remove(s.mesh);
      this.g.blockMeshes.splice(s.index, 1);
      this.g.blockMeshes.forEach((m: THREE.Mesh, i: number) => { m.userData.index = i; });
    } else if (s.type === 'mission') {
      c.missions.splice(s.index, 1);
      this.gizmos.remove(s.mesh);
      this.missionMeshes.splice(this.missionMeshes.indexOf(s.mesh), 1);
      // 重排剩余任务 gizmo 的 index（跳过无 pos 任务）
      let k = 0;
      c.missions.forEach((m: any, i: number) => { if (m.pos) { const mm = this.missionMeshes[k++]; if (mm) mm.userData.index = i; } });
    } else { return; }  // 出生点不可删
    this.select(null);
  }

  // ---------- 校验与保存 ----------
  private contentForValidate() {
    const c = this.g.content;
    return { scene: c.scene, missions: c.missions, blocks: c.blocks };
  }

  private validate(): boolean {
    const issues = validateContent(this.contentForValidate());
    this.issuesEl.innerHTML = issues.length
      ? issues.map((i: any) => `<div class="bad">⛔ [${i.where}] ${i.message}</div>`).join('')
      : '<div class="good">✅ 校验通过</div>';
    return issues.length === 0;
  }

  private async save() {
    if (!this.validate()) return;   // 与游戏/CLI 同一份规则；不合法不落盘
    const c = this.g.content;
    const round = (v: number) => Math.round(v * 10) / 10;
    const scene = {
      ...c.scene,
      blocks: c.blocks.map((b: any) => ({ x: round(b.x), z: round(b.z), w: round(b.w), d: round(b.d), h: round(b.h) })),
    };
    const missionsPack = { _comment: '任务内容包（可视化编辑器保存）。任务点必须在马路上，加载时自动校验。', version: 1, missions: c.missions };
    const res = await fetch('/__kit/save-content', { method: 'POST', body: JSON.stringify({ scene, missionsPack }) });
    if ((await res.json()).ok) location.reload();
    else this.issuesEl.innerHTML = '<div class="bad">保存失败（仅 dev server 下可用）</div>';
  }
}
