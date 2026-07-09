import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { validateContent } from '../../content-lib/core.mjs';

type Sel =
  | { type: 'cover'; index: number; mesh: THREE.Mesh }
  | { type: 'enemy'; index: number; mesh: THREE.Mesh }
  | { type: 'spawn-player'; mesh: THREE.Object3D };

export default class Editor {
  private g: any;
  private controls!: OrbitControls;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private sel: Sel | null = null;
  private dragging = false;
  private gizmos = new THREE.Group();
  private enemyMeshes: THREE.Mesh[] = [];
  private playerGizmo!: THREE.Object3D;
  private panel!: HTMLElement;
  private props!: HTMLElement;
  private issuesEl!: HTMLElement;

  constructor(game: any) { this.g = game; }

  enter() {
    (window as any).__editor = this;
    this.g.running = false;
    try { document.exitPointerLock(); } catch { /* ignore */ }
    this.controls = new OrbitControls(this.g.camera, this.g.renderer.domElement);
    this.g.camera.position.set(0, 74, 64);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.buildGizmos();
    this.buildPanel();
    this.g.renderer.domElement.addEventListener('pointerdown', this.onDown);
    this.g.renderer.domElement.addEventListener('pointermove', this.onMove);
    this.g.renderer.domElement.addEventListener('pointerup', this.onUp);
    this.g.renderer.setAnimationLoop(() => { this.controls.update(); this.g.renderer.render(this.g.scene, this.g.camera); });
  }

  private enemyInstances() {
    const prefabs = this.g.content.arena.prefabs;
    return this.g.content.arena.entities
      .map((e: any, i: number) => ({ e, i }))
      .filter(({ e }: any) => prefabs[e.prefab]?.controller === 'SoldierNPC');
  }

  private buildGizmos() {
    this.g.scene.add(this.gizmos);
    const sp = this.g.content.arena.spawns.player;
    this.playerGizmo = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3.5, 16), new THREE.MeshBasicMaterial({ color: 0x37d67a }));
    this.playerGizmo.position.set(sp[0], 1.75, sp[2]);
    this.playerGizmo.userData = { type: 'spawn-player' };
    this.gizmos.add(this.playerGizmo);

    this.enemyInstances().forEach(({ e, i }: any) => {
      const [x, z] = e.at;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 8, 16),
        new THREE.MeshBasicMaterial({ color: 0xff4d3f, transparent: true, opacity: 0.78 }),
      );
      mesh.position.set(x, 4, z);
      mesh.userData = { type: 'enemy', index: i };
      this.gizmos.add(mesh);
      this.enemyMeshes.push(mesh);
    });
    this.g.coverMeshes.forEach((mesh: THREE.Mesh, i: number) => { mesh.userData = { type: 'cover', index: i }; });
  }

  private pick(ev: PointerEvent): Sel | null {
    const r = this.g.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.g.camera);
    const hits = this.ray.intersectObjects([...this.gizmos.children, ...this.g.coverMeshes], false);
    if (!hits.length) return null;
    const mesh = hits[0].object as THREE.Mesh;
    const u = mesh.userData;
    if (u.type === 'cover') return { type: 'cover', index: u.index, mesh };
    if (u.type === 'enemy') return { type: 'enemy', index: u.index, mesh };
    if (u.type === 'spawn-player') return { type: 'spawn-player', mesh };
    return null;
  }

  private onDown = (ev: PointerEvent) => {
    const sel = this.pick(ev);
    this.select(sel);
    if (sel) { this.dragging = true; this.controls.enabled = false; }
  };

  private onMove = (ev: PointerEvent) => {
    if (!this.dragging || !this.sel) return;
    const r = this.g.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.g.camera);
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.ground, hit)) return;
    this.applyMove(Math.round(hit.x * 2) / 2, Math.round(hit.z * 2) / 2);
    this.fillProps();
  };

  private onUp = () => { this.dragging = false; this.controls.enabled = true; };

  private applyMove(x: number, z: number) {
    const arena = this.g.content.arena;
    const sel = this.sel!;
    if (sel.type === 'cover') {
      const c = arena.covers[sel.index];
      c.x = x; c.z = z; sel.mesh.position.x = x; sel.mesh.position.z = z;
    } else if (sel.type === 'enemy') {
      arena.entities[sel.index].at = [x, z]; sel.mesh.position.x = x; sel.mesh.position.z = z;
    } else {
      arena.spawns.player[0] = x; arena.spawns.player[2] = z; sel.mesh.position.x = x; sel.mesh.position.z = z;
    }
  }

  private select(sel: Sel | null) {
    if (this.sel?.type === 'cover') ((this.sel.mesh.material as THREE.MeshStandardMaterial).emissive as THREE.Color)?.set(0x000000);
    this.sel = sel;
    if (sel?.type === 'cover') {
      const mat = sel.mesh.material as THREE.MeshStandardMaterial;
      if (mat.emissive) mat.emissive.set(0x664400);
    }
    this.fillProps();
  }

  private buildPanel() {
    const el = document.createElement('div');
    el.innerHTML = `
      <style>
        #kit-editor { position: fixed; right: 16px; top: 16px; z-index: 50; width: 304px;
          background: rgba(12,14,18,.94); border: 1px solid #2f3540; border-radius: 8px;
          color: #dfe6ee; font: 13px/1.55 Arial; padding: 14px 16px; }
        #kit-editor h3 { font-size: 15px; color: #ffd23f; margin-bottom: 8px; }
        #kit-editor .hint { opacity: .62; font-size: 12px; margin-bottom: 10px; }
        #kit-editor label { display: flex; justify-content: space-between; align-items: center; margin: 4px 0; gap: 8px; }
        #kit-editor input { width: 152px; background: #1a1e26; color: #fff; border: 1px solid #39404d; border-radius: 4px; padding: 3px 6px; }
        #kit-editor .row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
        #kit-editor button { flex: 1; min-width: 88px; padding: 7px 4px; border: none; border-radius: 5px; cursor: pointer; font-weight: 700; background: #2b3442; color: #dfe6ee; }
        #kit-editor button.primary { background: #ffd23f; color: #14161a; }
        #kit-editor button.danger { background: #7a2b2b; color: #ffd9d9; }
        #kit-issues { margin-top: 10px; font-size: 12px; max-height: 200px; overflow: auto; }
        #kit-issues .bad { color: #ff8a8a; margin: 3px 0; }
        #kit-issues .good { color: #7cf27c; }
      </style>
      <div id="kit-editor">
        <h3>Military Editor</h3>
        <div class="hint">Pick and drag covers, enemy spawn pillars, or player spawn. Save reloads the arena JSON.</div>
        <div id="kit-props"><i>No selection</i></div>
        <div class="row">
          <button id="kit-validate">Validate</button>
          <button id="kit-save" class="primary">Save reload</button>
          <button id="kit-discard" class="danger">Discard</button>
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
  }

  private input(label: string, value: number | string, onChange: (v: string) => void, type = 'number') {
    const id = `kit-f-${Math.random().toString(36).slice(2, 8)}`;
    setTimeout(() => document.getElementById(id)?.addEventListener('change', (e) => { onChange((e.target as HTMLInputElement).value); this.syncSelMesh(); }));
    return `<label>${label}<input id="${id}" type="${type}" value="${value}" step="0.5"></label>`;
  }

  private fillProps() {
    const arena = this.g.content.arena;
    const sel = this.sel;
    if (!sel) { this.props.innerHTML = '<i>No selection</i>'; return; }
    if (sel.type === 'cover') {
      const c = arena.covers[sel.index];
      this.props.innerHTML = `<b>Cover #${sel.index}</b>` +
        this.input('x', c.x, (v) => { c.x = +v; }) + this.input('z', c.z, (v) => { c.z = +v; }) +
        this.input('w', c.w, (v) => { c.w = +v; }) + this.input('h', c.h, (v) => { c.h = +v; }) + this.input('d', c.d, (v) => { c.d = +v; });
    } else if (sel.type === 'enemy') {
      const e = arena.entities[sel.index];
      this.props.innerHTML = `<b>${e.name}</b>` +
        this.input('x', e.at[0], (v) => { e.at[0] = +v; }) + this.input('z', e.at[1], (v) => { e.at[1] = +v; }) +
        this.input('tint', e.tint ?? '#7a6a44', (v) => { e.tint = v; }, 'text');
    } else {
      const p = arena.spawns.player;
      this.props.innerHTML = '<b>Player spawn</b>' + this.input('x', p[0], (v) => { p[0] = +v; }) + this.input('z', p[2], (v) => { p[2] = +v; });
    }
  }

  private syncSelMesh() {
    const arena = this.g.content.arena;
    const sel = this.sel;
    if (!sel) return;
    if (sel.type === 'cover') {
      const c = arena.covers[sel.index];
      sel.mesh.geometry.dispose();
      sel.mesh.geometry = new THREE.BoxGeometry(c.w, c.h, c.d);
      sel.mesh.position.set(c.x, c.h / 2, c.z);
    } else if (sel.type === 'enemy') {
      const e = arena.entities[sel.index];
      sel.mesh.position.set(e.at[0], 4, e.at[1]);
    } else {
      const p = arena.spawns.player;
      sel.mesh.position.set(p[0], 1.75, p[2]);
    }
  }

  private validate(): boolean {
    const issues = validateContent(this.g.content);
    this.issuesEl.innerHTML = issues.length
      ? issues.map((i: any) => `<div class="bad">[${i.where}] ${i.message}</div>`).join('')
      : '<div class="good">Validation passed</div>';
    return issues.length === 0;
  }

  private async save() {
    if (!this.validate()) return;
    const round = (v: number) => Math.round(v * 10) / 10;
    const arena = {
      ...this.g.content.arena,
      covers: this.g.content.arena.covers.map((c: any) => ({ ...c, x: round(c.x), z: round(c.z), w: round(c.w), h: round(c.h), d: round(c.d) })),
      entities: this.g.content.arena.entities.map((e: any) => Array.isArray(e.at) ? { ...e, at: [round(e.at[0]), round(e.at[1])] } : e),
    };
    const res = await fetch('/__kit/save-content', { method: 'POST', body: JSON.stringify({ arena }) });
    const json = await res.json();
    if (json.ok) location.reload();
    else this.issuesEl.innerHTML = '<div class="bad">Save failed. Use dev server and check validation.</div>';
  }
}
