/**
 * Military TPS demo built on @engine plus @kit/core middleware.
 * Gameplay data lives in public/content; this file assembles rendering,
 * physics, prefab instances, views, rules, recorder, editor, and autotest.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { Physics, initPhysics, EntityManager, Entity, Input } from '@engine';
import HudView from './view/HudView';
import { loadContent, type Content } from './content/ContentLoader';
import { validateContent, validateTuning, resolveEntityPoint } from '../content-lib/core.mjs';
import { validateRules } from '../content-lib/rules.mjs';
import type { Issue, EntityInstance } from '../content-lib/core';
import PrefabRegistry from './game/PrefabRegistry';
import RuleSystem from './entities/RuleSystem';
import FlightRecorder from './debug/FlightRecorder';

class Game {
  public renderer!: THREE.WebGLRenderer;
  public scene!: THREE.Scene;
  public camera!: THREE.PerspectiveCamera;
  public physics!: Physics;
  public em!: EntityManager;
  public content!: Content;
  public assets: Record<string, any> = {};
  public coverMeshes: THREE.Mesh[] = [];
  public running = false;
  public tick = 0;
  public runSeed = 0;

  private clock = new THREE.Clock();
  private prefabs!: PrefabRegistry;
  private editorOpen = false;
  private recorder: any = null;

  async init() {
    await initPhysics();
    this.setupGraphics();

    try {
      this.content = await loadContent('/content/arena.json', '/content/rules.json', '/content/tuning.json');
    } catch (e) {
      this.showContentErrors([{ where: 'content', message: String(e) }]);
      return;
    }

    const issues = [
      ...validateContent(this.content),
      ...validateRules(this.content.rules, this.content),
      ...validateTuning(this.content.tuning),
    ];
    if (issues.length) { this.showContentErrors(issues); return; }

    await this.loadAssets();
    const btn = document.getElementById('start_game') as HTMLButtonElement;
    btn.textContent = 'DEPLOY';
    btn.disabled = false;
    btn.addEventListener('click', () => this.startGame());

    (window as any).__flight = {
      dump: () => { throw new Error('游戏尚未开局，无法 dump'); },
    };

    if (new URLSearchParams(location.search).has('autotest')) {
      this.startGame();
      const { default: AutoTest } = await import('./test/AutoTest');
      new AutoTest(this).run();
    }
  }

  showContentErrors(issues: Issue[]) {
    const el = document.getElementById('content-errors') as HTMLElement;
    el.style.display = 'block';
    el.innerHTML =
      `<div class="ce-title">内容包校验失败（${issues.length} 处）- 修复 public/content/*.json 后刷新</div>` +
      issues.map((i) => `<div class="ce-item"><b>${i.where}</b>: ${i.message}</div>`).join('');
    const btn = document.getElementById('start_game') as HTMLButtonElement;
    btn.textContent = 'CONTENT ERROR';
    btn.disabled = true;
    console.error('[content] validation failed:', issues);
  }

  setupGraphics() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 2000);

    const sun = new THREE.DirectionalLight(0xffdcc0, 2.4);
    sun.position.set(-25, 40, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 45;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
    sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x53422e, 0.5));

    window.addEventListener('resize', this.onResize);
  }

  onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private loadTex(name: string, repeat: number): THREE.MeshStandardMaterial {
    const load = (suffix: string, srgb = false) => {
      const t = new THREE.TextureLoader().load(`/assets/textures/${name}_${suffix}.jpg`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    return new THREE.MeshStandardMaterial({
      map: load('diff', true),
      normalMap: load('nor'),
      roughnessMap: load('rough'),
      metalness: name === 'metal' ? 0.7 : 0.0,
    });
  }

  async loadAssets() {
    const gltf = new GLTFLoader();
    const rgbe = new RGBELoader();
    const jobs: Promise<void>[] = [];
    const bar = document.getElementById('progress')!;
    const track = (p: Promise<any>, name: string) => jobs.push(p.then((r) => { this.assets[name] = r; }));

    track(gltf.loadAsync(this.content.arena.assets.soldier), 'soldier');
    track(rgbe.loadAsync(this.content.arena.assets.sky), 'sky');

    let done = 0;
    jobs.forEach((j) => j.then(() => { done++; bar.style.width = `${(done / jobs.length) * 100}%`; }));
    await Promise.all(jobs);

    const sky = this.assets['sky'] as THREE.Texture;
    sky.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.background = sky;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromEquirectangular(sky).texture;

    this.assets['matGround'] = this.loadTex('ground', 24);
    this.assets['matWall'] = this.loadTex('wall', 4);
    this.assets['matMetal'] = this.loadTex('metal', 2);
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.physics.addStaticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(w / 2, h / 2, d / 2));
    return mesh;
  }

  buildArena() {
    const { matGround, matWall, matMetal } = this.assets;
    const arena = this.content.arena;
    const half = arena.groundHalf;
    const ground = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 1, half * 2), matGround);
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(half, 0.5, half));

    const h = arena.wallHeight;
    this.box(half * 2, h, 1, matWall, 0, h / 2, -half);
    this.box(half * 2, h, 1, matWall, 0, h / 2, half);
    this.box(1, h, half * 2, matWall, -half, h / 2, 0);
    this.box(1, h, half * 2, matWall, half, h / 2, 0);

    this.coverMeshes = [];
    for (const cover of arena.covers) {
      const mat = cover.material === 'metal' ? matMetal : matWall;
      const mesh = this.box(cover.w, cover.h, cover.d, mat, cover.x, cover.h / 2, cover.z);
      mesh.userData = { type: 'cover', name: cover.name, index: this.coverMeshes.length };
      this.coverMeshes.push(mesh);
    }
  }

  private entityPosition(instance: EntityInstance): THREE.Vector3 {
    if (instance.at === 'spawns.player') {
      const p = this.content.arena.spawns.player;
      return new THREE.Vector3(p[0], p[1], p[2]);
    }
    const point = resolveEntityPoint(this.content.arena, instance.at);
    if (!point) throw new Error(`[scene] 未知实体点位 ${String(instance.at)}`);
    return new THREE.Vector3(point[0], 0, point[1]);
  }

  startGame() {
    if (this.running) return;
    document.getElementById('menu')!.style.display = 'none';
    document.getElementById('crosshair')!.style.display = 'block';
    document.getElementById('hud')!.style.display = 'block';

    Input.ClearEventListners();
    this.tick = 0;
    this.runSeed = Date.now() % 0x80000000;
    this.physics = new Physics(-9.81);
    this.em = new EntityManager();
    this.buildArena();

    this.prefabs = new PrefabRegistry({
      camera: this.camera,
      physics: this.physics,
      scene: this.scene,
      arena: this.content.arena,
      tuning: this.content.tuning,
      assets: this.assets,
      pointer: {
        isLocked: () => Input.PointerLocked,
        request: () => { try { Input.RequestPointerLock(); } catch { /* headless */ } },
        onChange: (fn) => document.addEventListener('pointerlockchange', fn),
      },
    });

    for (const instance of this.content.arena.entities) {
      this.em.Add(this.prefabs.spawn(instance, this.entityPosition(instance)));
    }

    const rules = new Entity();
    rules.SetName('Rules');
    rules.AddComponent(new RuleSystem(this.content.rules, this.content));
    this.em.Add(rules);

    const hud = new Entity();
    hud.SetName('Hud');
    hud.AddComponent(new HudView(this.camera));
    this.em.Add(hud);

    this.recorder = new FlightRecorder(this);
    this.em.EndSetup();
    this.scene.add(this.camera);
    try { Input.RequestPointerLock(); } catch { /* headless/autotest */ }

    this.installEditorShortcut();

    this.running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(this.loop);
  }

  private installEditorShortcut() {
    document.addEventListener('keydown', async (e) => {
      if (e.code !== 'KeyE' || this.editorOpen) return;
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      this.editorOpen = true;
      const { default: Editor } = await import('./editor/Editor');
      new Editor(this).enter();
    });
  }

  private acc = 0;
  private static readonly STEP = 1 / 60;
  private static readonly MAX_SUBSTEPS = 12;

  loop = () => {
    if (!this.running) return;
    this.acc += Math.min(0.25, this.clock.getDelta());
    let n = 0;
    while (this.acc >= Game.STEP && n < Game.MAX_SUBSTEPS) {
      const tick = this.tick;
      this.recorder?.applyReplayTick(tick);
      this.physics.step();
      this.em.Update(Game.STEP);
      this.recorder?.recordInputTick(tick);
      this.acc -= Game.STEP;
      this.tick++;
      this.recorder?.afterReplayTick(this.tick);
      n++;
    }
    if (n === Game.MAX_SUBSTEPS) this.acc = 0;
    this.renderer.render(this.scene, this.camera);
  };
}

const game = new Game();
game.init();
(window as any).__game = game;
