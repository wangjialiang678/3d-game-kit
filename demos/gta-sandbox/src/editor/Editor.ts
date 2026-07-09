/**
 * Editor — 游戏内可视化编辑器。
 *
 * 所有内容变更都通过 content-lib/commands.mjs 执行；拖拽时只移动
 * mesh 做视觉预览，pointerup 才提交一条命令，因此一次拖拽就是一步 undo。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { execute, validateAll } from '../../content-lib/commands.mjs';

type Sel =
  | { type: 'block'; index: number; mesh: THREE.Mesh }
  | { type: 'mission'; index: number; mesh: THREE.Mesh }
  | { type: 'spawn-player'; mesh: THREE.Object3D }
  | { type: 'spawn-car'; mesh: THREE.Object3D };

type SelRef =
  | { type: 'block'; index: number }
  | { type: 'mission'; index: number }
  | { type: 'spawn-player' }
  | { type: 'spawn-car' }
  | null;

export default class Editor {
  private g: any;
  private controls!: OrbitControls;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private sel: Sel | null = null;
  private dragging = false;
  private dragMoved = false;

  private history: string[] = [];
  private redoHistory: string[] = [];
  private readonly historyCap = 50;

  private gizmos = new THREE.Group();
  private missionMeshes: THREE.Mesh[] = [];
  private playerGizmo!: THREE.Object3D;
  private carGizmo!: THREE.Object3D;

  private panel!: HTMLElement;
  private props!: HTMLElement;
  private issuesEl!: HTMLElement;

  constructor(game: any) { this.g = game; }

  enter() {
    (window as any).__editor = this;
    const g = this.g;
    g.running = false;
    try { document.exitPointerLock(); } catch { /* ignore */ }

    this.controls = new OrbitControls(g.camera, g.renderer.domElement);
    g.camera.position.set(0, 90, 70);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.rebuildBlocks();
    this.buildGizmos();
    this.buildPanel();

    g.renderer.domElement.addEventListener('pointerdown', this.onDown);
    g.renderer.domElement.addEventListener('pointermove', this.onMove);
    g.renderer.domElement.addEventListener('pointerup', this.onUp);
    document.addEventListener('keydown', this.onKeyDown);
    g.renderer.setAnimationLoop(() => { this.controls.update(); g.renderer.render(g.scene, g.camera); });
  }

  // ---------- snapshots / commands ----------
  private snapshot(): string {
    return JSON.stringify(this.g.content);
  }

  private restore(json: string) {
    const next = JSON.parse(json);
    const content = this.g.content;
    for (const key of Object.keys(content)) delete content[key];
    Object.assign(content, next);
  }

  private pushHistory(before: string) {
    this.history.push(before);
    if (this.history.length > this.historyCap) this.history.shift();
    this.redoHistory = [];
  }

  private command(name: string, params: any, ref: SelRef = this.selRef()): boolean {
    const before = this.snapshot();
    const issues = execute(this.g.content, name, params);
    if (issues.length) {
      this.renderIssues(issues);
      this.refresh(ref);
      return false;
    }
    this.pushHistory(before);
    this.refresh(ref);
    return true;
  }

  undo() {
    const previous = this.history.pop();
    if (!previous) return;
    const current = this.snapshot();
    this.redoHistory.push(current);
    this.restore(previous);
    this.refresh(this.selRef());
  }

  redo() {
    const next = this.redoHistory.pop();
    if (!next) return;
    const current = this.snapshot();
    this.history.push(current);
    this.restore(next);
    this.refresh(this.selRef());
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (!(e.metaKey || e.ctrlKey) || e.code !== 'KeyZ') return;
    e.preventDefault();
    if (e.shiftKey) this.redo();
    else this.undo();
  };

  // ---------- scene markers ----------
  private makeBlockMesh(b: any, index: number): THREE.Mesh {
    const base = this.g.assets['matWall'];
    const mat = base?.clone ? base.clone() : new THREE.MeshStandardMaterial({ color: 0x777777 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { type: 'block', index };
    return mesh;
  }

  private rebuildBlocks() {
    for (const mesh of this.g.blockMeshes ?? []) {
      this.g.scene.remove(mesh);
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
    }
    this.g.blockMeshes = [];
    this.g.content.blocks.forEach((b: any, i: number) => {
      const mesh = this.makeBlockMesh(b, i);
      this.g.scene.add(mesh);
      this.g.blockMeshes.push(mesh);
    });
  }

  private disposeGizmos() {
    this.g.scene.remove(this.gizmos);
    this.gizmos.traverse((o: any) => {
      o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach((m: THREE.Material) => m.dispose());
      else o.material?.dispose?.();
    });
  }

  private buildGizmos() {
    const g = this.g;
    this.gizmos = new THREE.Group();
    this.missionMeshes = [];
    g.scene.add(this.gizmos);

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

    const sp = g.content.scene.spawns;
    this.playerGizmo = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3.5, 16), new THREE.MeshBasicMaterial({ color: 0x37d67a }));
    this.playerGizmo.position.set(sp.player[0], 1.75, sp.player[2]);
    this.playerGizmo.userData = { type: 'spawn-player' };
    this.gizmos.add(this.playerGizmo);

    this.carGizmo = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 4.2), new THREE.MeshBasicMaterial({ color: 0x3f8cff, transparent: true, opacity: 0.8 }));
    this.carGizmo.position.set(sp.car.pos[0], 0.6, sp.car.pos[2]);
    this.carGizmo.rotation.y = (sp.car.headingDeg * Math.PI) / 180;
    this.carGizmo.userData = { type: 'spawn-car' };
    this.gizmos.add(this.carGizmo);
  }

  private refresh(ref: SelRef = this.selRef()) {
    this.sel = null;
    this.rebuildBlocks();
    this.disposeGizmos();
    this.buildGizmos();
    this.selectByRef(ref);
  }

  // ---------- picking / dragging ----------
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
    this.dragMoved = false;
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
    const x = Math.round(hit.x * 2) / 2;
    const z = Math.round(hit.z * 2) / 2;
    this.applyMoveVisual(x, z);
    this.dragMoved = true;
  };

  private onUp = () => {
    const s = this.sel;
    this.dragging = false;
    this.controls.enabled = true;
    if (!s || !this.dragMoved) return;
    this.commitVisualMove(s);
    this.dragMoved = false;
  };

  private applyMoveVisual(x: number, z: number) {
    const s = this.sel!;
    if (s.type === 'block') {
      s.mesh.position.x = x;
      s.mesh.position.z = z;
    } else if (s.type === 'mission') {
      s.mesh.position.x = x;
      s.mesh.position.z = z;
    } else if (s.type === 'spawn-player') {
      s.mesh.position.x = x;
      s.mesh.position.z = z;
    } else if (s.type === 'spawn-car') {
      s.mesh.position.x = x;
      s.mesh.position.z = z;
    }
  }

  private commitVisualMove(s: Sel) {
    const x = +(s.mesh.position.x.toFixed(1));
    const z = +(s.mesh.position.z.toFixed(1));
    if (s.type === 'block') {
      this.command('move-block', { index: s.index, pos: [x, z] }, { type: 'block', index: s.index });
    } else if (s.type === 'mission') {
      this.command('move-mission', { index: s.index, pos: [x, z] }, { type: 'mission', index: s.index });
    } else if (s.type === 'spawn-player') {
      const y = this.g.content.scene.spawns.player[1];
      this.command('set-spawn', { kind: 'player', pos: [x, y, z] }, { type: 'spawn-player' });
    } else {
      const car = this.g.content.scene.spawns.car;
      this.command('set-spawn', { kind: 'car', pos: [x, car.pos[1], z] }, { type: 'spawn-car' });
    }
  }

  private selRef(s: Sel | null = this.sel): SelRef {
    if (!s) return null;
    if (s.type === 'block' || s.type === 'mission') return { type: s.type, index: s.index };
    return { type: s.type };
  }

  private selectByRef(ref: SelRef) {
    if (!ref) return this.select(null);
    if (ref.type === 'block') return this.select(ref.index < this.g.blockMeshes.length ? { type: 'block', index: ref.index, mesh: this.g.blockMeshes[ref.index] } : null);
    if (ref.type === 'mission') {
      const mesh = this.missionMeshes.find((m) => m.userData.index === ref.index);
      return this.select(mesh ? { type: 'mission', index: ref.index, mesh } : null);
    }
    if (ref.type === 'spawn-player') return this.select({ type: 'spawn-player', mesh: this.playerGizmo });
    return this.select({ type: 'spawn-car', mesh: this.carGizmo });
  }

  private select(s: Sel | null) {
    if (this.sel?.type === 'block') {
      const mat = this.sel.mesh.material as THREE.MeshStandardMaterial;
      mat.emissive?.set(0x000000);
    }
    this.sel = s;
    if (s?.type === 'block') {
      const mat = s.mesh.material as THREE.MeshStandardMaterial;
      mat.emissive?.set(0x664400);
    }
    this.fillProps();
  }

  // ---------- panel ----------
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
    setTimeout(() => document.getElementById(id)?.addEventListener('change', (e) => onChange((e.target as HTMLInputElement).value)));
    return `<label>${label}<input id="${id}" type="${type}" value="${value}" step="0.5"></label>`;
  }

  private fillProps() {
    const c = this.g.content;
    const s = this.sel;
    if (!s) { this.props.innerHTML = '<i>未选中对象</i>'; return; }
    if (s.type === 'block') {
      const b = c.blocks[s.index];
      this.props.innerHTML = `<b>建筑 #${s.index}</b>` +
        this.input('x', b.x.toFixed(1), v => this.command('move-block', { index: s.index, pos: [+v, b.z] }, { type: 'block', index: s.index })) +
        this.input('z', b.z.toFixed(1), v => this.command('move-block', { index: s.index, pos: [b.x, +v] }, { type: 'block', index: s.index })) +
        this.input('宽 w', b.w.toFixed(1), v => this.command('resize-block', { index: s.index, size: { w: +v } }, { type: 'block', index: s.index })) +
        this.input('深 d', b.d.toFixed(1), v => this.command('resize-block', { index: s.index, size: { d: +v } }, { type: 'block', index: s.index })) +
        this.input('高 h', b.h.toFixed(1), v => this.command('resize-block', { index: s.index, size: { h: +v } }, { type: 'block', index: s.index }));
    } else if (s.type === 'mission') {
      const m = c.missions[s.index];
      this.props.innerHTML = `<b>任务点 #${s.index}</b>` +
        this.input('文字', m.text, v => this.command('set-mission-text', { index: s.index, text: v }, { type: 'mission', index: s.index }), 'text') +
        this.input('x', m.pos[0], v => this.command('move-mission', { index: s.index, pos: [+v, m.pos[1]] }, { type: 'mission', index: s.index })) +
        this.input('z', m.pos[1], v => this.command('move-mission', { index: s.index, pos: [m.pos[0], +v] }, { type: 'mission', index: s.index }));
    } else if (s.type === 'spawn-player') {
      const sp = c.scene.spawns.player;
      this.props.innerHTML = `<b>玩家出生点</b>` +
        this.input('x', sp[0], v => this.command('set-spawn', { kind: 'player', pos: [+v, sp[1], sp[2]] }, { type: 'spawn-player' })) +
        this.input('z', sp[2], v => this.command('set-spawn', { kind: 'player', pos: [sp[0], sp[1], +v] }, { type: 'spawn-player' }));
    } else {
      const cp = c.scene.spawns.car;
      this.props.innerHTML = `<b>汽车出生点</b>` +
        this.input('x', cp.pos[0], v => this.command('set-spawn', { kind: 'car', pos: [+v, cp.pos[1], cp.pos[2]] }, { type: 'spawn-car' })) +
        this.input('z', cp.pos[2], v => this.command('set-spawn', { kind: 'car', pos: [cp.pos[0], cp.pos[1], +v] }, { type: 'spawn-car' })) +
        this.input('朝向°', cp.headingDeg, v => this.command('set-spawn', { kind: 'car', headingDeg: +v }, { type: 'spawn-car' }));
    }
  }

  // ---------- add/remove ----------
  private addBlock() {
    const before = this.g.content.blocks.length;
    if (this.command('add-block', { block: { x: 0, z: 0, w: 8, d: 8, h: 8 } }, { type: 'block', index: before })) {
      this.selectByRef({ type: 'block', index: before });
    }
  }

  private addMission() {
    const before = this.g.content.missions.length;
    if (this.command('add-mission', { mission: { text: '新任务：到达光柱', pos: [0, 13] } }, { type: 'mission', index: before })) {
      this.selectByRef({ type: 'mission', index: before });
    }
  }

  private deleteSelected() {
    const s = this.sel;
    if (!s) return;
    if (s.type === 'block') this.command('remove-block', { index: s.index }, null);
    else if (s.type === 'mission') this.command('remove-mission', { index: s.index }, null);
  }

  // ---------- validate / save ----------
  private renderIssues(issues: any[]) {
    this.issuesEl.innerHTML = issues.length
      ? issues.map((i: any) => `<div class="bad">⛔ [${i.where}] ${i.message}</div>`).join('')
      : '<div class="good">✅ 校验通过</div>';
  }

  private validate(): boolean {
    const issues = validateAll(this.g.content);
    this.renderIssues(issues);
    return issues.length === 0;
  }

  private async save() {
    if (!this.validate()) return;
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
