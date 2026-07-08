/**
 * main.ts — three-military-tps
 * A third-person (togglable first-person) military shooter built on the same ECS engine,
 * with all-new CC0 assets: three.js "Soldier" (Mixamo-rigged), Poly Haven HDRI sky + PBR textures,
 * a procedural arena, and a procedural rifle.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import Physics, { initPhysics } from '@engine/Physics';
import EntityManager from '@engine/EntityManager';
import Entity from '@engine/Entity';
import UIManager from './entities/UIManager';
import ThirdPersonPlayer from './entities/ThirdPersonPlayer';
import SoldierNPC from './entities/SoldierNPC';
import { cloneSoldier } from './util/soldier';

const ARENA = 30; // half-extent

class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private physics!: Physics;
  private entityManager!: EntityManager;
  private clock = new THREE.Clock();
  private assets: Record<string, any> = {};
  private running = false;

  async init() {
    await initPhysics();
    this.setupGraphics();
    await this.loadAssets();
    this.setupStartButton();
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

    track(gltf.loadAsync('/assets/characters/Soldier.glb'), 'soldier');
    track(rgbe.loadAsync('/assets/sky/the_sky_is_on_fire.hdr'), 'sky');

    let done = 0;
    jobs.forEach((j) => j.then(() => { done++; bar.style.width = `${(done / jobs.length) * 100}%`; }));
    await Promise.all(jobs);

    // sky + image-based lighting
    const sky = this.assets['sky'] as THREE.Texture;
    sky.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.background = sky;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromEquirectangular(sky).texture;

    // materials (built after renderer exists)
    this.assets['matGround'] = this.loadTex('ground', 24);
    this.assets['matWall'] = this.loadTex('wall', 4);
    this.assets['matMetal'] = this.loadTex('metal', 2);
  }

  setupStartButton() {
    const btn = document.getElementById('start_game') as HTMLButtonElement;
    btn.textContent = 'DEPLOY';
    btn.disabled = false;
    btn.addEventListener('click', () => this.startGame());
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.physics.addStaticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(w / 2, h / 2, d / 2));
    return mesh;
  }

  buildArena() {
    const { matGround, matWall, matMetal } = this.assets;
    // ground
    const ground = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2, 1, ARENA * 2), matGround);
    ground.position.y = -0.5; ground.receiveShadow = true;
    this.scene.add(ground);
    this.physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(ARENA, 0.5, ARENA));
    // perimeter walls
    const H = 4;
    this.box(ARENA * 2, H, 1, matWall, 0, H / 2, -ARENA);
    this.box(ARENA * 2, H, 1, matWall, 0, H / 2, ARENA);
    this.box(1, H, ARENA * 2, matWall, -ARENA, H / 2, 0);
    this.box(1, H, ARENA * 2, matWall, ARENA, H / 2, 0);
    // cover: containers (metal) + concrete blocks
    const covers: [number, number, number, number, number, number, THREE.Material][] = [
      [6, 2.6, 2.5, -12, 1.3, -10, matMetal], [6, 2.6, 2.5, 14, 1.3, -6, matMetal],
      [2.5, 2.6, 6, -8, 1.3, 12, matMetal], [6, 2.6, 2.5, 10, 1.3, 15, matMetal],
      [3, 2, 3, 0, 1, -14, matWall], [3, 2, 3, -18, 1, 6, matWall],
      [3, 2, 3, 18, 1, 10, matWall], [3, 2, 3, 6, 1, 4, matWall],
      [2.5, 2.6, 6, 20, 1.3, -16, matMetal], [6, 2.6, 2.5, -20, 1.3, -18, matMetal],
      [3, 2, 3, -6, 1, -4, matWall], [3, 2, 3, 12, 1, -20, matWall],
    ];
    for (const [w, h, d, x, y, z, m] of covers) this.box(w, h, d, m, x, y, z);
  }

  startGame() {
    document.getElementById('menu')!.style.display = 'none';
    document.getElementById('crosshair')!.style.display = 'block';
    document.getElementById('hud')!.style.display = 'block';

    this.physics = new Physics(-9.81);
    this.entityManager = new EntityManager();
    this.buildArena();

    const ui = new Entity(); ui.SetName('UIManager'); ui.AddComponent(new UIManager());
    this.entityManager.Add(ui);

    // player (third person soldier)
    const player = new Entity(); player.SetName('Player');
    player.AddComponent(new ThirdPersonPlayer(this.camera, this.physics, this.scene, cloneSoldier(this.assets['soldier'])));
    player.SetPosition(new THREE.Vector3(0, 2, 6));
    this.entityManager.Add(player);

    // enemy soldiers (recolored variants)
    const spawns: [number, number, number, number][] = [
      [-18, -18, 0xb04030, 0], [18, -14, 0x7a6a44, 1], [16, 16, 0x4a6a3a, 2],
      [-16, 14, 0x8a5a30, 3], [0, 22, 0x5a5a6a, 4],
    ];
    spawns.forEach(([x, z, tint, i]) => {
      const e = new Entity(); e.SetName(`Enemy${i}`);
      e.SetPosition(new THREE.Vector3(x, 0, z));
      e.AddComponent(new SoldierNPC(cloneSoldier(this.assets['soldier'], tint), this.scene, this.physics));
      this.entityManager.Add(e);
    });

    this.entityManager.EndSetup();
    this.scene.add(this.camera);

    document.body.requestPointerLock();
    this.running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(this.loop);
  }

  // 固定步长累加器：帧率无关性——低帧率时每帧补跑逻辑子步，游戏时间=真实时间
  private acc = 0;
  private static readonly STEP = 1 / 60;
  private static readonly MAX_SUBSTEPS = 12;

  loop = () => {
    if (!this.running) return;
    this.acc += Math.min(0.25, this.clock.getDelta());
    let n = 0;
    while (this.acc >= Game.STEP && n < Game.MAX_SUBSTEPS) {
      this.physics.step();
      this.entityManager.Update(Game.STEP);
      this.acc -= Game.STEP;
      n++;
    }
    if (n === Game.MAX_SUBSTEPS) this.acc = 0;
    this.renderer.render(this.scene, this.camera);
  };
}

const game = new Game();
game.init();
(window as any).__game = game;
