/** Entity (port of three-fps Entity.js) — a named bag of components with a message bus. */
import { Vector3, Quaternion } from 'three';
import type Component from './Component';
import type EntityManager from './EntityManager';

export default class Entity {
  public name: string | number | null = null;
  public id: number = 0;
  public components: Record<string, Component> = {};
  public position = new Vector3();
  public rotation = new Quaternion();
  public parent: EntityManager | null = null;
  private eventHandlers: Record<string, ((msg: any) => void)[]> = {};

  AddComponent(component: Component): void {
    component.SetParent(this);
    this.components[component.name] = component;
  }

  SetParent(parent: EntityManager): void { this.parent = parent; }
  SetName(name: string | number): void { this.name = name; }
  get Name() { return this.name; }

  GetComponent(name: string): any { return this.components[name]; }

  SetPosition(position: Vector3): void { this.position.copy(position); }
  get Position(): Vector3 { return this.position; }

  SetRotation(rotation: Quaternion): void { this.rotation.copy(rotation); }
  get Rotation(): Quaternion { return this.rotation; }

  FindEntity(name: string): Entity | undefined { return this.parent!.Get(name); }

  RegisterEventHandler(handler: (msg: any) => void, topic: string): void {
    if (!this.eventHandlers[topic]) this.eventHandlers[topic] = [];
    this.eventHandlers[topic].push(handler);
  }

  Broadcast(msg: { topic: string; [k: string]: any }): void {
    if (!this.eventHandlers[msg.topic]) return;
    for (const handler of this.eventHandlers[msg.topic]) handler(msg);
  }

  PhysicsUpdate(world: any, timeStep: number): void {
    for (const k in this.components) this.components[k].PhysicsUpdate(world, timeStep);
  }

  Update(timeElapsed: number): void {
    for (const k in this.components) this.components[k].Update(timeElapsed);
  }
}
