/** Component base class (port of three-fps Component.js). */
import type Entity from './Entity';

export default class Component {
  public name: string = '';
  public parent: Entity | null = null;

  Initialize(): void {}

  SetParent(parent: Entity): void {
    this.parent = parent;
  }

  GetComponent(name: string): any {
    return this.parent!.GetComponent(name);
  }

  FindEntity(name: string): any {
    return this.parent!.FindEntity(name);
  }

  Broadcast(msg: any): void {
    this.parent!.Broadcast(msg);
  }

  Update(_t: number): void {}

  PhysicsUpdate(_world: any, _timeStep: number): void {}
}
