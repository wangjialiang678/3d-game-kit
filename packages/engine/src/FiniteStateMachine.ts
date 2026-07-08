/** Finite state machine (port of three-fps FiniteStateMachine.js) — used by NPC & weapon. */
export class State {
  public parent: any;
  constructor(parent: any) { this.parent = parent; }
  get Name(): string { return ''; }
  Enter(_prevState: State | null): void {}
  Update(_t: number): void {}
  Exit(): void {}
}

export class FiniteStateMachine {
  public states: Record<string, State> = {};
  public currentState: State | null = null;

  AddState(name: string, state: State): void {
    this.states[name] = state;
  }

  SetState(name: string): void {
    const prevState = this.currentState;
    if (prevState) {
      if (prevState.Name === name) return;
      prevState.Exit();
    }
    const state = this.states[name];
    this.currentState = state;
    state.Enter(prevState);
  }

  Update(t: number): void {
    if (this.currentState) this.currentState.Update(t);
  }
}
