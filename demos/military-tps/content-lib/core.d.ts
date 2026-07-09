export interface Issue { where: string; message: string; }
export interface Cover { name?: string; x: number; z: number; w: number; h: number; d: number; material?: 'metal' | 'wall'; }
export type PrefabControllerType = 'ThirdPersonPlayer' | 'SoldierNPC';
export interface PrefabDefinition {
  controller: PrefabControllerType;
  model?: string;
  tint?: string;
  [key: string]: any;
}
export interface EntityInstance {
  prefab: string;
  name: string;
  at: 'spawns.player' | [number, number];
  tint?: string;
  [key: string]: any;
}
export interface ArenaContent {
  name: string;
  version: number;
  groundHalf: number;
  wallHeight: number;
  assets: Record<string, string>;
  spawns: { player: [number, number, number] };
  covers: Cover[];
  prefabs: Record<string, PrefabDefinition>;
  entities: EntityInstance[];
}
export interface TuningContent {
  player: { maxSpeed: number; accelTime: number; jumpVelocity: number; mouseSpeed: number; health: number };
  weapon: { fireRate: number; damage: number; ammoPerMag: number; reserveAmmo: number; reloadSecs: number };
  enemy: { speed: number; viewDist: number; shootRange: number; fireInterval: number; damage: number; health: number };
}
export const PREFAB_CONTROLLER_TYPES: PrefabControllerType[];
export function resolveEntityPoint(arena: ArenaContent, at: EntityInstance['at']): [number, number] | null;
export function validateContent(content: any): Issue[];
export function validateTuning(tuning: any): Issue[];
export function insideAnyBlock(covers: Cover[], x: number, z: number, margin?: number): boolean;
export function contentFingerprint(content: any): string;
