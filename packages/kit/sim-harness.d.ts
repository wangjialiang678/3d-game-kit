export interface Harness {
  section(title: string): void;
  check(label: string, ok: boolean, detail?: string): void;
  issues(label: string, issues: Array<{ where: string; message: string }>): void;
  finish(success?: string, failure?: string): never;
  readonly failed: number;
  readonly name: string;
}

export function harness(name?: string): Harness;
