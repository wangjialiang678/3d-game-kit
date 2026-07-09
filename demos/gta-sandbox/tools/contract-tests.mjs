#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { materializeBlocks, contentFingerprint, validateContent } from '../content-lib/core.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (f) => JSON.parse(readFileSync(join(ROOT, 'public/content', f), 'utf8'));

const scene = read('scene.json');
const missionsPack = read('missions.json');
const rules = read('rules.json');
const tuning = read('tuning.json');
const blocks = scene.blocks?.length ? scene.blocks : materializeBlocks(scene.town);

function withScene(nextScene) {
  return { scene: nextScene, missions: missionsPack.missions, blocks, rules, tuning };
}

function sceneWithPrefabs() {
  return {
    ...scene,
    prefabs: {
      player: { controller: 'OnFootPlayer', model: 'soldier' },
      car: { controller: 'Car', model: 'procedural-car', color: '#2f6fb0' },
      police: { controller: 'PoliceNPC', model: 'soldier', tint: '#2a4bd7' },
    },
    entities: [
      { prefab: 'player', name: 'Player', at: 'spawns.player' },
      { prefab: 'car', name: 'Car', at: 'spawns.car' },
    ],
  };
}

function issuesFor(nextScene) {
  return validateContent(withScene(nextScene));
}

function assertIssue(nextScene, where, text) {
  const issues = issuesFor(nextScene);
  assert(
    issues.some((i) => i.where === where && i.message.includes(text)),
    `missing expected issue ${where}: ${text}\nactual=${JSON.stringify(issues, null, 2)}`,
  );
}

{
  const issues = issuesFor(sceneWithPrefabs());
  assert.deepEqual(issues, [], `valid prefab scene should pass:\n${JSON.stringify(issues, null, 2)}`);
}

{
  const next = sceneWithPrefabs();
  next.prefabs.car.controller = 'Boat';
  assertIssue(next, 'scene.prefabs.car.controller', '未知 controller');
}

{
  const next = sceneWithPrefabs();
  next.entities.push({ prefab: 'missing', name: 'Ghost', at: 'spawns.player' });
  assertIssue(next, 'scene.entities[2].prefab', '未定义 prefab');
}

{
  const next = sceneWithPrefabs();
  next.entities.push({ prefab: 'car', name: 'Car', at: [-13, 39] });
  assertIssue(next, 'scene.entities[2].name', '重复');
}

{
  const next = sceneWithPrefabs();
  next.entities.push({ prefab: 'car', name: 'Car3', at: [26, 0] });
  assertIssue(next, 'scene.entities[2].at', '建筑内部');
}

{
  const base = contentFingerprint(withScene(sceneWithPrefabs()));
  const changed = contentFingerprint(withScene({ ...sceneWithPrefabs(), name: 'changed-scene-name' }));
  assert.match(base, /^[a-f0-9]{8}$/);
  assert.notEqual(base, changed, 'content fingerprint should change when scene content changes');
}

console.log('✅ contract tests passed');
