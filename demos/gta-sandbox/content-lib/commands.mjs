/**
 * Shared content edit commands for gta-sandbox.
 *
 * Pure module: callers provide an in-memory content object, commands mutate it
 * only after parameter validation, and execute() rolls back automatically if
 * the full content/rules/tuning validation fails after applying a command.
 */
import { validateContent, validateTuning } from './core.mjs';
import { validateRules } from './rules.mjs';

const cloneJson = (v) => JSON.parse(JSON.stringify(v));

function issue(where, message) {
  return { where, message };
}

export function validateAll(content) {
  return [
    ...validateContent(content),
    ...validateRules(content.rules, content),
    ...validateTuning(content.tuning),
  ];
}

function restore(target, snapshot) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, cloneJson(snapshot));
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateIndex(arr, index, where) {
  if (!Number.isInteger(index)) return [issue(where, 'index 必须是整数')];
  if (index < 0 || index >= arr.length) return [issue(where, `不存在 index=${index}`)];
  return [];
}

function validatePos2(pos, where) {
  if (!Array.isArray(pos) || pos.length !== 2 || pos.some((v) => !isFiniteNumber(v))) {
    return [issue(where, 'pos 必须是 [x,z] 数字数组')];
  }
  return [];
}

function validatePos3(pos, where) {
  if (!Array.isArray(pos) || pos.length !== 3 || pos.some((v) => !isFiniteNumber(v))) {
    return [issue(where, 'pos 必须是 [x,y,z] 数字数组')];
  }
  return [];
}

function ensureSceneBlocks(content) {
  content.scene.blocks = content.blocks;
}

function setDot(obj, path, value) {
  const parts = String(path ?? '').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (!cur || typeof cur !== 'object' || !(p in cur)) return false;
    cur = cur[p];
  }
  const last = parts.at(-1);
  if (!last || !cur || typeof cur !== 'object' || !(last in cur)) return false;
  cur[last] = value;
  return true;
}

function validateBlockPatch(size, where) {
  if (!size || typeof size !== 'object') return [issue(where, 'size 必须是对象')];
  const allowed = new Set(['w', 'd', 'h']);
  const issues = [];
  for (const key of Object.keys(size)) {
    if (!allowed.has(key)) issues.push(issue(`${where}.${key}`, '只允许 w/d/h'));
    else if (!isFiniteNumber(size[key]) || size[key] <= 0) issues.push(issue(`${where}.${key}`, '尺寸必须是正数'));
  }
  if (!Object.keys(size).length) issues.push(issue(where, 'size 至少包含 w/d/h 之一'));
  return issues;
}

function validateBlock(block, where) {
  if (!block || typeof block !== 'object') return [issue(where, 'block 必须是对象')];
  const issues = [];
  for (const key of ['x', 'z', 'w', 'd', 'h']) {
    if (!isFiniteNumber(block[key])) issues.push(issue(`${where}.${key}`, `${key} 必须是数字`));
  }
  if (isFiniteNumber(block.w) && block.w <= 0) issues.push(issue(`${where}.w`, 'w 必须为正数'));
  if (isFiniteNumber(block.d) && block.d <= 0) issues.push(issue(`${where}.d`, 'd 必须为正数'));
  if (isFiniteNumber(block.h) && block.h <= 0) issues.push(issue(`${where}.h`, 'h 必须为正数'));
  return issues;
}

function validateMissionPayload(mission, where) {
  if (!mission || typeof mission !== 'object') return [issue(where, 'mission 必须是对象')];
  const issues = [];
  if (typeof mission.text !== 'string') issues.push(issue(`${where}.text`, 'text 必须是字符串'));
  if (mission.pos !== undefined) issues.push(...validatePos2(mission.pos, `${where}.pos`));
  if (mission.special !== undefined && typeof mission.special !== 'string') issues.push(issue(`${where}.special`, 'special 必须是字符串'));
  if (mission.needCar !== undefined && typeof mission.needCar !== 'boolean') issues.push(issue(`${where}.needCar`, 'needCar 必须是 boolean'));
  return issues;
}

function validateEntityAt(at, where) {
  if (typeof at === 'string') return [];
  return validatePos2(at, where);
}

export const COMMANDS = {
  'move-mission': {
    params: ['index', 'pos'],
    validateParams(params, content) {
      return [
        ...validateIndex(content.missions, params.index, 'move-mission.index'),
        ...validatePos2(params.pos, 'move-mission.pos'),
      ];
    },
    apply(content, params) {
      content.missions[params.index].pos = [...params.pos];
    },
  },

  'set-mission-text': {
    params: ['index', 'text'],
    validateParams(params, content) {
      return [
        ...validateIndex(content.missions, params.index, 'set-mission-text.index'),
        ...(typeof params.text === 'string' ? [] : [issue('set-mission-text.text', 'text 必须是字符串')]),
      ];
    },
    apply(content, params) {
      content.missions[params.index].text = params.text;
    },
  },

  'set-mission-need-car': {
    params: ['index', 'needCar'],
    validateParams(params, content) {
      return [
        ...validateIndex(content.missions, params.index, 'set-mission-need-car.index'),
        ...(typeof params.needCar === 'boolean' ? [] : [issue('set-mission-need-car.needCar', 'needCar 必须是 boolean')]),
      ];
    },
    apply(content, params) {
      content.missions[params.index].needCar = params.needCar;
    },
  },

  'add-mission': {
    params: ['mission'],
    validateParams(params) {
      return validateMissionPayload(params.mission, 'add-mission.mission');
    },
    apply(content, params) {
      content.missions.push(cloneJson(params.mission));
    },
  },

  'remove-mission': {
    params: ['index'],
    validateParams(params, content) {
      return validateIndex(content.missions, params.index, 'remove-mission.index');
    },
    apply(content, params) {
      content.missions.splice(params.index, 1);
    },
  },

  'move-block': {
    params: ['index', 'pos'],
    validateParams(params, content) {
      return [
        ...validateIndex(content.blocks, params.index, 'move-block.index'),
        ...validatePos2(params.pos, 'move-block.pos'),
      ];
    },
    apply(content, params) {
      const block = content.blocks[params.index];
      block.x = params.pos[0];
      block.z = params.pos[1];
      ensureSceneBlocks(content);
    },
  },

  'resize-block': {
    params: ['index', 'size'],
    validateParams(params, content) {
      return [
        ...validateIndex(content.blocks, params.index, 'resize-block.index'),
        ...validateBlockPatch(params.size, 'resize-block.size'),
      ];
    },
    apply(content, params) {
      Object.assign(content.blocks[params.index], params.size);
      ensureSceneBlocks(content);
    },
  },

  'add-block': {
    params: ['block'],
    validateParams(params) {
      return validateBlock(params.block, 'add-block.block');
    },
    apply(content, params) {
      content.blocks.push(cloneJson(params.block));
      ensureSceneBlocks(content);
    },
  },

  'remove-block': {
    params: ['index'],
    validateParams(params, content) {
      return validateIndex(content.blocks, params.index, 'remove-block.index');
    },
    apply(content, params) {
      content.blocks.splice(params.index, 1);
      ensureSceneBlocks(content);
    },
  },

  'set-spawn': {
    params: ['kind', 'pos', 'headingDeg'],
    validateParams(params) {
      const issues = [];
      if (!['player', 'car'].includes(params.kind)) issues.push(issue('set-spawn.kind', 'kind 必须是 player 或 car'));
      if (params.pos !== undefined) issues.push(...validatePos3(params.pos, 'set-spawn.pos'));
      if (params.kind === 'player' && params.headingDeg !== undefined) issues.push(issue('set-spawn.headingDeg', 'player 不支持 headingDeg'));
      if (params.headingDeg !== undefined && !isFiniteNumber(params.headingDeg)) issues.push(issue('set-spawn.headingDeg', 'headingDeg 必须是数字'));
      if (params.pos === undefined && params.headingDeg === undefined) issues.push(issue('set-spawn', 'pos 或 headingDeg 至少提供一个'));
      return issues;
    },
    apply(content, params) {
      if (params.kind === 'player') {
        content.scene.spawns.player = [...params.pos];
      } else {
        if (params.pos !== undefined) content.scene.spawns.car.pos = [...params.pos];
        if (params.headingDeg !== undefined) content.scene.spawns.car.headingDeg = params.headingDeg;
      }
    },
  },

  'add-entity': {
    params: ['prefab', 'name', 'at'],
    validateParams(params) {
      const issues = [];
      if (!params.prefab || typeof params.prefab !== 'string') issues.push(issue('add-entity.prefab', 'prefab 必须是非空字符串'));
      if (!params.name || typeof params.name !== 'string') issues.push(issue('add-entity.name', 'name 必须是非空字符串'));
      issues.push(...validateEntityAt(params.at, 'add-entity.at'));
      return issues;
    },
    apply(content, params) {
      if (!Array.isArray(content.scene.entities)) content.scene.entities = [];
      content.scene.entities.push({ prefab: params.prefab, name: params.name, at: cloneJson(params.at) });
    },
  },

  'remove-entity': {
    params: ['name'],
    validateParams(params, content) {
      const issues = [];
      if (!params.name || typeof params.name !== 'string') issues.push(issue('remove-entity.name', 'name 必须是非空字符串'));
      else if (!(content.scene.entities ?? []).some((e) => e.name === params.name)) issues.push(issue('remove-entity.name', `没有实体 "${params.name}"`));
      return issues;
    },
    apply(content, params) {
      content.scene.entities = (content.scene.entities ?? []).filter((e) => e.name !== params.name);
    },
  },

  tune: {
    params: ['path', 'value'],
    validateParams(params) {
      const issues = [];
      if (!params.path || typeof params.path !== 'string') issues.push(issue('tune.path', 'path 必须是 dot.path 字符串'));
      if (!isFiniteNumber(params.value)) issues.push(issue('tune.value', 'value 必须是数字'));
      return issues;
    },
    apply(content, params) {
      if (!setDot(content.tuning, params.path, params.value)) {
        throw new Error(`未知 tuning 路径 "${params.path}"`);
      }
    },
  },
};

export function execute(content, cmdName, params = {}) {
  const cmd = COMMANDS[cmdName];
  if (!cmd) return [issue('command', `未知命令 "${cmdName}"`)];

  const paramIssues = cmd.validateParams(params, content);
  if (paramIssues.length) return paramIssues;

  const before = cloneJson(content);
  try {
    cmd.apply(content, params);
  } catch (e) {
    restore(content, before);
    return [issue(cmdName, String(e?.message ?? e))];
  }

  const issues = validateAll(content);
  if (issues.length) restore(content, before);
  return issues;
}
