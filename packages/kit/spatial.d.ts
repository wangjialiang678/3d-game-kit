export interface BlockLike {
  x: number;
  z: number;
  w: number;
  d: number;
}

export function mulberry32(seed: number): () => number;
export function insideAnyBlock(blocks: BlockLike[], x: number, z: number, margin?: number): boolean;
export function findClearSpot(blocks: BlockLike[], x: number, z: number, margin?: number): [number, number];
export function fingerprint(value: unknown): string;
