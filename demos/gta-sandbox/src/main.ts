/**
 * GTA Sandbox — 3d-game-kit demo（共用 @engine 框架）。
 * 用 Three.js（网页/WebGL）+ Rapier 做的小镇沙盒：步行/开车、上下车、通缉、任务。
 * 明确：这是 Three.js 项目，不是 Godot / Unity / Unreal 引擎。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { Physics, initPhysics, EntityManager, Entity } from '@engine';
import OnFootPlayer from './entities/OnFootPlayer';
import Car from './entities/Car';
import WantedSystem from './entities/WantedSystem';
import MissionSystem from './entities/MissionSystem';
import { cloneSoldier, buildCar } from './util/build';

const TOWN = 78;   // ground half-size
const CELL = 26;   // city block spacing

class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private physics!: Physics;
  private em!: EntityManager;
  private clock = new THREE.Clock();
  private assets: Record<string, any> = {};
  private running = false;

  async init() {
    await initPhysics();
    this.setupGraphics();
    await this.loadAssets();
    const btn = document.getElementById('play') as HTMLButtonElement;
    btn.textContent = 'PLAY'; btn.disabled = false;
    btn.addEventListener('click', () => this.start());
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
    add(gltf.loadAsync('/assets/characters/Soldier.glb'), 'soldier');
    add(rgbe.loadAsync('/assets/sky/kloofendal_48d_partly_cloudy_puresky.hdr'), 'sky');
    let done = 0; jobs.forEach(j => j.then(() => { done++; bar.style.width = `${done / jobs.length * 100}%`; }));
    await Promise.all(jobs);
    const sky = this.assets['sky'] as THREE.Texture;
    sky.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.background = sky;
    this.scene.environment = new THREE.PMREMGenerator(this.renderer).fromEquirectangular(sky).texture;
    this.assets['matGround'] = this.tex('ground', 60);
    this.assets['matWall'] = this.tex('wall', 3);
  }

  buildTown() {
    // ground
    const ground = new THREE.Mesh(new THREE.BoxGeometry(TOWN * 2, 1, TOWN * 2), this.assets['matGround']);
    ground.position.y = -0.5; ground.receiveShadow = true; this.scene.add(ground);
    this.physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(TOWN, 0.5, TOWN));
    // city blocks on a grid; roads are the gaps at x,z = ±13, ±39 ...
    const rand = mulberry32(1337);
    for (let gx = -2; gx <= 2; gx++) {
      for (let gz = -2; gz <= 2; gz++) {
        if (gx === 0 && gz === 0) continue;            // central plaza
        const cx = gx * CELL, cz = gz * CELL;
        const w = 11 + rand() * 6, d = 11 + rand() * 6, h = 6 + rand() * 17;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.assets['matWall']);
        mesh.position.set(cx, h / 2, cz); mesh.castShadow = true; mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.physics.addStaticBox(new THREE.Vector3(cx, h / 2, cz), new THREE.Vector3(w / 2, h / 2, d / 2));
      }
    }
  }

  start() {
    (document.getElementById('menu') as HTMLElement).style.display = 'none';
    (document.getElementById('hud') as HTMLElement).style.display = 'block';
    this.physics = new Physics(-9.81);
    this.em = new EntityManager();
    this.buildTown();

    // player on foot
    const player = new Entity(); player.SetName('Player');
    player.AddComponent(new OnFootPlayer(this.camera, this.physics, this.scene, cloneSoldier(this.assets['soldier'])));
    player.SetPosition(new THREE.Vector3(13, 1.2, 13));
    this.em.Add(player);

    // a drivable car parked on the road
    const car = new Entity(); car.SetName('Car');
    car.AddComponent(new Car(this.camera, this.physics, this.scene, buildCar(0x2f6fb0), new THREE.Vector3(13, 0, 5), Math.PI));
    this.em.Add(car);

    // wanted system (G to raise heat, police chase, escape to cool down)
    const wanted = new Entity(); wanted.SetName('Wanted');
    wanted.AddComponent(new WantedSystem(this.scene, this.assets['soldier']));
    this.em.Add(wanted);

    // mission chain (walk → drive → wanted-and-escape)
    const missions = new Entity(); missions.SetName('Missions');
    missions.AddComponent(new MissionSystem(this.scene, this.camera));
    this.em.Add(missions);

    this.em.EndSetup();
    this.scene.add(this.camera);
    document.body.requestPointerLock();
    this.running = true; this.clock.start();
    this.renderer.setAnimationLoop(this.loop);
  }

  private prompt = document.getElementById('prompt') as HTMLElement;
  private speedEl = document.getElementById('speed') as HTMLElement;
  private updatePrompt() {
    const onfoot = this.em.Get('Player')?.GetComponent('OnFootPlayer');
    const car = this.em.Get('Car')?.GetComponent('Car');
    if (!onfoot || !car) return;
    if (car.Active) { this.prompt.style.display = 'block'; this.prompt.innerHTML = '按 <b>F</b> 下车'; }
    else if (onfoot.active && onfoot.parent!.Position.distanceTo(car.Position) < 5.0) { this.prompt.style.display = 'block'; this.prompt.innerHTML = '按 <b>F</b> 上车'; }
    else this.prompt.style.display = 'none';
    // speedometer while driving
    if (car.Active) {
      this.speedEl.style.display = 'block';
      this.speedEl.innerHTML = `${Math.abs(Math.round(car.Speed * 3.6))} <small>km/h</small>`;
    } else this.speedEl.style.display = 'none';
  }

  loop = () => {
    if (!this.running) return;
    const dt = Math.min(1 / 30, this.clock.getDelta());
    this.physics.step();
    this.em.Update(dt);
    this.updatePrompt();
    this.renderer.render(this.scene, this.camera);
  };
}

// small deterministic PRNG so the town layout is stable
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const game = new Game();
game.init();
(window as any).__game = game;
