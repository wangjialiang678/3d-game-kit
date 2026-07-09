#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute } from '../content-lib/commands.mjs';
import { materializeBlocks } from '../content-lib/core.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (name) => JSON.parse(readFileSync(join(ROOT, 'public/content', name), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const makeContent = () => {
  const scene = read('scene.json');
  const missionsPack = read('missions.json');
  const rules = read('rules.json');
  const tuning = read('tuning.json');
  const blocks = scene.blocks?.length ? scene.blocks : materializeBlocks(scene.town);
  return { scene, missions: missionsPack.missions, blocks, rules, tuning };
};

{
  const content = makeContent();
  const issues = execute(content, 'move-mission', { index: 0, pos: [13, -13] });
  assert.equal(issues.length, 0);
  assert.deepEqual(content.missions[0].pos, [13, -13]);
}

{
  const content = makeContent();
  const before = clone(content);
  const issues = execute(content, 'move-mission', { index: 0, pos: [26, 0] });
  assert.ok(issues.length > 0);
  assert.deepEqual(content, before, 'failed command must roll content back');
}

{
  const content = makeContent();
  assert.equal(execute(content, 'set-mission-text', { index: 0, text: '测试任务' }).length, 0);
  assert.equal(content.missions[0].text, '测试任务');
}

{
  const content = makeContent();
  const issues = execute(content, 'tune', { path: 'police.speed', value: 9 });
  assert.ok(issues.length > 0);
  assert.equal(content.tuning.police.speed, 4.4, 'invalid tuning must roll back');
}

{
  const content = makeContent();
  assert.equal(execute(content, 'add-entity', { prefab: 'car', name: 'Car2', at: [-13, 39] }).length, 0);
  assert.ok(content.scene.entities.some((e) => e.name === 'Car2'));
  assert.equal(execute(content, 'remove-entity', { name: 'Car2' }).length, 0);
  assert.equal(content.scene.entities.some((e) => e.name === 'Car2'), false);
}

console.log('✅ command tests passed');
