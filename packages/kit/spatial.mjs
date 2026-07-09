/** Deterministic pseudo-random generator. */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns true when point (x,z) lies inside any axis-aligned block, expanded by margin. */
export function insideAnyBlock(blocks, x, z, margin = 0) {
  return (blocks ?? []).some((b) =>
    x > b.x - b.w / 2 - margin && x < b.x + b.w / 2 + margin &&
    z > b.z - b.d / 2 - margin && z < b.z + b.d / 2 + margin);
}

/** Finds the nearest clear spot around (x,z) by expanding in a small spiral. */
export function findClearSpot(blocks, x, z, margin = 1.0) {
  if (!insideAnyBlock(blocks, x, z, margin)) return [x, z];
  for (let r = 2; r <= 60; r += 2) {
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      const cx = x + Math.cos(t) * r;
      const cz = z + Math.sin(t) * r;
      if (!insideAnyBlock(blocks, cx, cz, margin)) return [cx, cz];
    }
  }
  return [x, z];
}

/** Stable FNV-1a hash for content/replay fingerprints. */
export function fingerprint(value) {
  const payload = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
