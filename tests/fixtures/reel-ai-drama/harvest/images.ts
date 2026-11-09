import sharp from 'sharp';

/**
 * Deterministic fixture pictures, made at test time so no binary files are checked in: a seeded
 * arrangement of shapes, distinct enough per seed that their perceptual hashes differ.
 */

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

export function seedOf(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function shapesSvg(seed: number, w: number, h: number): string {
  const r = rng(seed);
  const color = () => `rgb(${Math.floor(r() * 255)},${Math.floor(r() * 255)},${Math.floor(r() * 255)})`;
  const shapes: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const x = Math.floor(r() * w);
    const y = Math.floor(r() * h);
    const s = Math.floor((0.15 + r() * 0.35) * Math.min(w, h));
    shapes.push(r() > 0.5 ? `<circle cx="${x}" cy="${y}" r="${s / 2}" fill="${color()}"/>` : `<rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s * 0.7}" fill="${color()}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${color()}"/>${shapes.join('')}</svg>`;
}

export async function makeJpeg(seed: number, w = 1600, h = 1000): Promise<Buffer> {
  return sharp(Buffer.from(shapesSvg(seed, w, h))).jpeg({ quality: 90 }).toBuffer();
}

export async function makePng(seed: number, w = 1080, h = 1920): Promise<Buffer> {
  return sharp(Buffer.from(shapesSvg(seed, w, h))).png().toBuffer();
}

/** The same picture re-encoded smaller and a touch brighter: a near-identical copy. */
export async function nearCopy(original: Buffer): Promise<Buffer> {
  const m = await sharp(original).metadata();
  return sharp(original).resize(Math.round((m.width ?? 1000) * 0.6)).modulate({ brightness: 1.05 }).jpeg({ quality: 70 }).toBuffer();
}
