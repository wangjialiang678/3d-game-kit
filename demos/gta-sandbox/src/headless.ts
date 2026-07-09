import * as THREE from 'three';
import { fileURLToPath } from 'node:url';

function installDomShim() {
  if (typeof (globalThis as any).document !== 'undefined') return;

  const listeners = new Map<string, Function[]>();
  const add = (type: string, fn: Function) => listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  const remove = (type: string, fn: Function) => listeners.set(type, (listeners.get(type) ?? []).filter((h) => h !== fn));
  const element = () => ({
    style: {},
    children: [] as any[],
    parentElement: null as any,
    textContent: '',
    innerHTML: '',
    appendChild(child: any) { this.children.push(child); child.parentElement = this; return child; },
    removeChild(child: any) { this.children = this.children.filter((c) => c !== child); child.parentElement = null; },
    remove() { /* noop */ },
    click() { /* noop */ },
    setAttribute() { /* noop */ },
  });

  const body = element();
  Object.assign(globalThis as any, {
    window: globalThis,
    document: {
      pointerLockElement: null,
      body: { ...body, requestPointerLock() { /* noop */ } },
      activeElement: null,
      addEventListener: add,
      removeEventListener: remove,
      exitPointerLock() { /* noop */ },
      createElement: element,
      getElementById() { return null; },
      querySelector() { return null; },
    },
    addEventListener: add,
    removeEventListener: remove,
  });
}

function makeHeadlessSoldier(): any {
  const model = new THREE.Group();
  const hand = new THREE.Bone();
  hand.name = 'RightHand';
  model.add(hand);
  return { model, animations: [], rightHand: hand };
}

function makeHeadlessCar(): THREE.Group {
  return new THREE.Group();
}

function summarizeEvents(events: any[]) {
  return events.map((e) => {
    if (e.name === 'mission-complete') return `${e.name}#${e.idx}`;
    if (e.name === 'wanted-raise' || e.name === 'wanted-changed' || e.name === 'wanted-drop') return `${e.name}:${e.level}`;
    return e.name;
  });
}

export async function runHeadlessSim() {
  installDomShim();
  const started = performance.now();

  const [
    engine,
    contentPipeline,
    core,
    rules,
    assemble,
    flightModule,
    botModule,
  ] = await Promise.all([
    import('@engine'),
    import('@kit/core/content-pipeline.mjs'),
    import('../content-lib/core.mjs'),
    import('../content-lib/rules.mjs'),
    import('./game/assemble'),
    import('./debug/FlightRecorder'),
    import('./test/BotCore'),
  ]);

  engine.EventBus.reset();
  engine.Input.ClearEventListners();
  engine.Input.SetReplayMode(false);
  await engine.initPhysics();

  const contentRoot = fileURLToPath(new URL('../public/content/', import.meta.url));
  const content = await contentPipeline.loadPack({
    files: {
      scene: 'scene.json',
      missionsPack: 'missions.json',
      rules: 'rules.json',
      tuning: 'tuning.json',
    },
    reader: contentPipeline.nodeJsonReader(contentRoot),
    build: ({ scene, missionsPack, rules: rulesPack, tuning }: any) => {
      const blocks = scene.blocks?.length ? scene.blocks : core.materializeBlocks(scene.town);
      return { scene, missions: missionsPack.missions ?? [], blocks, rules: rulesPack, tuning };
    },
    validators: [
      (c: any) => [
        ...core.validateContent(c),
        ...rules.validateRules(c.rules, c),
        ...core.validateTuning(c.tuning),
      ],
    ],
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, 1, 0.05, 2000);
  const game: any = {
    content,
    scene,
    camera,
    assets: {},
    blockMeshes: [],
    runSeed: 42,
    tick: 0,
  };

  const assembled = assemble.assembleGame({
    content,
    scene,
    camera,
    assets: {},
    seed: game.runSeed,
    includeHud: false,
    blockMeshes: game.blockMeshes,
    makeSoldier: makeHeadlessSoldier,
    makeCar: makeHeadlessCar,
    initialize: false,
  });
  game.physics = assembled.physics;
  game.em = assembled.em;
  game.prefabs = assembled.prefabs;

  const FlightRecorder = flightModule.default;
  const recorder = new FlightRecorder(game);
  game.recorder = recorder;
  game.em.EndSetup();

  const BotCore = botModule.default;
  const bot = new BotCore(game);
  const step = 1 / 60;
  const maxTicks = 60 * 260;

  try {
    while (!bot.Result.done && game.tick < maxTicks) {
      const tick = game.tick;
      recorder.applyReplayTick(tick);
      game.physics.step();
      game.em.Update(step);
      bot.tick(step);
      recorder.recordInputTick(tick);
      game.tick++;
      recorder.afterReplayTick(game.tick);
    }

    const missions = game.em.Get('Missions')?.GetComponent('MissionSystem');
    const dump = recorder.dump();
    const result = bot.Result;
    const pass = result.pass && (missions?.idx ?? 0) >= 3;
    const report = {
      pass,
      ticks: game.tick,
      elapsedMs: Math.round(performance.now() - started),
      missionIndex: missions?.idx ?? null,
      missionTicks: result.steps
        .filter((s: any) => s.name.startsWith('任务'))
        .map((s: any, i: number) => ({ mission: i + 1, tick: s.tick, ticks: s.ticks })),
      steps: result.steps,
      events: summarizeEvents(dump.events),
    };
    if (!pass && !result.done) {
      return { ...report, error: `headless sim exceeded maxTicks=${maxTicks}` };
    }
    return report;
  } finally {
    recorder.dispose();
    engine.Input.ResetState();
  }
}
