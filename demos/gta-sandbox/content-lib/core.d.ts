/** 类型声明：content-lib/core.mjs（实现是 .mjs 以便浏览器与 Node CLI 共用） */
export interface TownParams {
  groundHalf: number;
  cell: number;
  gridRange: number;
  plaza: [number, number][];
  seed: number;
  buildingWidth: [number, number];
  buildingHeight: [number, number];
}
export interface Block { x: number; z: number; w: number; d: number; h: number; }
export interface Issue { where: string; message: string; }

export function mulberry32(seed: number): () => number;
export function materializeBlocks(t: TownParams): Block[];
export function validateContent(c: any): Issue[];
export function roadIntersections(t: TownParams): [number, number][];
export function insideAnyBlock(blocks: Block[], x: number, z: number, margin?: number): boolean;
export function findClearSpot(blocks: Block[], x: number, z: number, margin?: number): [number, number];
