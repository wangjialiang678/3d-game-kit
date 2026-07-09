/**
 * GTA Sandbox — 3d-game-kit demo（共用 @engine 框架）。
 * 用 Three.js（网页/WebGL）+ Rapier 做的小镇沙盒：步行/开车、上下车、通缉、任务。
 * 明确：这是 Three.js 项目，不是 Godot / Unity / Unreal 引擎。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { initPhysics, Input } from '@engine';
import type { Physics, EntityManager } from '@engine';
import { loadContent, type Content } from './content/ContentLoader';
import { validateContent, validateTuning } from '../content-lib/core.mjs';
import { validateRules } from '../content-lib/rules.mjs';
import type { Issue } from '../content-lib/core';
import FlightRecorder from './debug/FlightRecorder';
import type PrefabRegistry from './game/PrefabRegistry';
import { assembleGame } from './game/assemble';

class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private physics!: Physics;
  private em!: EntityManager;
  private clock = new THREE.Clock();
  private assets: Record<string, any> = {};
  private running = false;
  private prefabs!: PrefabRegistry;
  private recorder!: FlightRecorder;
  private pendingReplayDump: any = null;
  public runSeed = 0;
  public tick = 0;
  public content!: Content;
  public blockMeshes: THREE.Mesh[] = [];   // 编辑器用：与 content.blocks 按下标对齐
  private editorOpen = false;

  async init() {
    await initPhysics();
    this.setupGraphics();

    // ---- P1：加载内容包并校验（校验不过就不开局，红字报错） ----
    try {
      this.content = await loadContent('/content/scene.json', '/content/missions.json', '/content/rules.json', '/content/tuning.json');
    } catch (e) {
      this.showContentErrors([{ where: 'content', message: String(e) }]);
      return;
    }
    const issues = [
      ...validateContent(this.content),
      ...validateRules(this.content.rules, this.content),   // L0：规则包也一样先校验再开局
      ...validateTuning(this.content.tuning),
    ];
    if (issues.length) { this.showContentErrors(issues); return; }

    await this.loadAssets();
    const btn = document.getElementById('play') as HTMLButtonElement;
    btn.textContent = 'PLAY'; btn.disabled = false;
    btn.addEventListener('click', () => this.start());
    (window as any).__flight = {
      loadReplay: (dump: any) => this.loadReplay(dump),
      replay: (dump: any) => this.loadReplay(dump),
      dump: () => {
        throw new Error('游戏尚未开局，无法 dump；回放请调用 __flight.loadReplay(dump)');
      },
    };

    // P3：?autotest → 试玩机器人自动开局并打穿全部任务（验证闭环）
    if (new URLSearchParams(location.search).has('autotest')) {
      this.start();
      const { default: AutoTest } = await import('./test/AutoTest');
      new AutoTest(this).run();
    }
  }

  showContentErrors(issues: Issue[]) {
    const el = document.getElementById('content-errors') as HTMLElement;
    el.style.display = 'block';
    el.innerHTML =
      `<div class="ce-title">⛔ 内容包校验失败（${issues.length} 处）—— 修复 public/content/*.json 后刷新</div>` +
      issues.map((i) => `<div class="ce-item"><b>${i.where}</b>：${i.message}</div>`).join('');
    const btn = document.getElementById('play') as HTMLButtonElement;
    btn.textContent = '内容包校验失败';
    btn.disabled = true;
    console.error('[content] validation failed:', issues);
  }

  setupGraphics() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.05, 2000);
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.6);
    sun.position.set(40, 70, 25); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 90;
    sun.shadow.camera.left = -s; sun.shadow.camera.right = s; sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 260; sun.shadow.bias = -0.0004;
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x55503f, 0.6));
    addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); });
  }

  private tex(name: string, rep: number) {
    const load = (suf: string, srgb = false) => {
      const t = new THREE.TextureLoader().load(`/assets/textures/${name}_${suf}.jpg`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    return new THREE.MeshStandardMaterial({ map: load('diff', true), normalMap: load('nor'), roughnessMap: load('rough') });
  }

  async loadAssets() {
    const gltf = new GLTFLoader(); const rgbe = new RGBELoader();
    const bar = document.getElementById('progress')!;
    const jobs: Promise<void>[] = [];
    const add = (p: Promise<any>, n: string) => jobs.push(p.then(r => { this.assets[n] = r; }));
    add(gltf.loadAsync(this.content.scene.assets.soldier), 'soldier');   // 资产路径来自内容包
    add(rgbe.loadAsync(this.content.scene.assets.sky), 'sky');
    let done = 0; jobs.forEach(j => j.then(() => { done++; bar.style.width = `${done / jobs.length * 100}%`; }));
    await Promise.all(jobs);
    const sky = this.assets['sky'] as THREE.Texture;
    sky.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.background = sky;
    this.scene.environment = new THREE.PMREMGenerator(this.renderer).fromEquirectangular(sky).texture;
    this.assets['matGround'] = this.tex('ground', 60);
    this.assets['matWall'] = this.tex('wall', 3);
  }

  private parseReplayDump(dump: any) {
    return typeof dump === 'string' ? JSON.parse(dump) : dump;
  }

  loadReplay(dump: any) {
    this.pendingReplayDump = this.parseReplayDump(dump);
    const urlSeed = new URLSearchParams(location.search).get('seed');
    if (urlSeed !== null && this.pendingReplayDump.runSeed !== undefined && Number(urlSeed) !== Number(this.pendingReplayDump.runSeed)) {
      console.warn(`[replay] URL seed=${urlSeed} 与 dump.runSeed=${this.pendingReplayDump.runSeed} 不一致；本次使用 dump.runSeed`);
    }
    if (!this.running) this.start();
    else {
      this.recorder.loadReplay(this.pendingReplayDump);
      this.pendingReplayDump = null;
    }
  }

  start() {
    if (this.running) return;
    (document.getElementById('menu') as HTMLElement).style.display = 'none';
    (document.getElementById('hud') as HTMLElement).style.display = 'block';
    Input.SetReplayMode(false);
    this.tick = 0;
    const url = new URLSearchParams(location.search);
    const seedRaw = this.pendingReplayDump?.runSeed ?? url.get('seed');
    const seed = Number(seedRaw);
    this.runSeed = Number.isFinite(seed) ? Math.trunc(seed) : (Date.now() % 0x80000000);

    const assembled = assembleGame({
      content: this.content,
      scene: this.scene,
      camera: this.camera,
      assets: this.assets,
      seed: this.runSeed,
      includeHud: true,
      blockMeshes: this.blockMeshes,
      initialize: false,
    });
    this.physics = assembled.physics;
    this.em = assembled.em;
    this.prefabs = assembled.prefabs;

    // 飞行记录仪先安装 EventBus tap，再初始化各系统，避免漏掉 Initialize 阶段的 mission-changed 等事件。
    this.recorder = new FlightRecorder(this);

    this.em.EndSetup();
    if (this.pendingReplayDump) {
      this.recorder.loadReplay(this.pendingReplayDump);
      this.pendingReplayDump = null;
    }
    this.scene.add(this.camera);
    if (!Input.ReplayMode) {
      try { document.body.requestPointerLock(); } catch { /* headless/autotest 下没有指针锁 */ }
    }

    // P4：按 E 进入可视化编辑器（懒加载；输入框聚焦时不触发）
    document.addEventListener('keydown', async (e) => {
      if (Input.ReplayMode) return;
      if (e.code !== 'KeyE' || this.editorOpen) return;
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      this.editorOpen = true;
      const { default: Editor } = await import('./editor/Editor');
      new Editor(this).enter();
    });
    this.running = true; this.clock.start();
    this.renderer.setAnimationLoop(this.loop);
  }

  // 固定步长累加器：低帧率（无头/慢机器）时每帧补跑多个逻辑子步，
  // 保证"游戏时间 = 真实时间"——游戏速度不随帧率变慢（帧率无关性）。
  private acc = 0;
  private static readonly STEP = 1 / 60;
  private static readonly MAX_SUBSTEPS = 12;   // ≥5fps 时仍能 1:1 实时

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
    if (n === Game.MAX_SUBSTEPS) this.acc = 0;   // 极端卡顿时丢弃积压，避免螺旋死亡
    this.renderer.render(this.scene, this.camera);
  };
}

const game = new Game();
game.init();
(window as any).__game = game;
