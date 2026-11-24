/**
 * Pure perceptual-hash comparison: no image libraries, so browser code may import it. The harvest (filters.ts) and
 * the used-photo ledger (used.ts) share it.
 */

/** Hamming distance at or under which two 64-bit pHashes are the same picture (starting value; tune). */
export const NEAR_DUPLICATE = 8;

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) {
    let x = Number.parseInt(a[i], 16) ^ Number.parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export const isPhash = (key: string) => /^[0-9a-f]{16}$/.test(key);
