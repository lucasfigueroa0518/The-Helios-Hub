import sharp from 'sharp';

/**
 * A 64-bit difference hash (dHash) of an image: grayscale, shrunk to 9×8,
 * each bit says whether a pixel is brighter than its right neighbour. A
 * recompressed, resized or lightly recropped copy lands a few bits away; a
 * different picture lands about half the bits away. ME-45's safety net: a
 * template that near-duplicates one on cooldown is blocked too.
 */
export async function dhash(input: string | Buffer): Promise<string> {
  const { data } = await sharp(input).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (data[y * 9 + x]! > data[y * 9 + x + 1]! ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** At or under this many differing bits, two images are the same picture. */
export const NEAR_DUPLICATE_BITS = 10;

export const nearDuplicate = (a: string | null, b: string | null): boolean => a !== null && b !== null && hamming(a, b) <= NEAR_DUPLICATE_BITS;
