/**
 * @engine — 共用游戏框架的公开入口。
 * 任何 demo 都 `import { Entity, Component, ... } from '@engine'`。
 */
export { default as Entity } from './Entity';
export { default as Component } from './Component';
export { default as EntityManager } from './EntityManager';
export { FiniteStateMachine, State } from './FiniteStateMachine';
export { default as Physics, initPhysics } from './Physics';
export type { Character, RayHit } from './Physics';
export { default as Input } from './Input';
