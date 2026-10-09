/**
 * Hand-drawn pen strokes for the homemade style (S-53): the arrows,
 * strike-throughs and underlines someone draws with Instagram's pen tool.
 * Seeded, so the same frame always draws the same stroke (renders are
 * reproducible), but no two strokes are perfectly straight.
 */

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A string's seed, so a stroke depends on what it's drawn for. */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const f = (n: number) => Math.round(n * 10) / 10;

/** A smooth path through points with a little wobble (quadratic midpoints). */
function wobbly(points: Array<[number, number]>, rand: () => number, wobble: number): string {
  const p = points.map(([x, y], i) => (i === 0 || i === points.length - 1 ? [x, y] : [x + (rand() - 0.5) * wobble, y + (rand() - 0.5) * wobble]) as [number, number]);
  let d = `M${f(p[0]![0])} ${f(p[0]![1])}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [x, y] = p[i]!;
    const [nx, ny] = p[i + 1]!;
    d += ` Q${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`;
  }
  const last = p[p.length - 1]!;
  return `${d} L${f(last[0])} ${f(last[1])}`;
}

/**
 * A right-pointing arrow inside a w×h box: a slightly curved shaft and a
 * two-stroke head, the way a thumb draws it.
 */
export function arrowPaths(w: number, h: number, seed: number): { shaft: string; head: string } {
  const rand = rng(seed);
  const pad = 10;
  const y0 = h * (0.55 + (rand() - 0.5) * 0.2);
  const x1 = w - pad;
  const y1 = h * 0.5 + (rand() - 0.5) * 6;
  const sag = (rand() - 0.3) * h * 0.35;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    pts.push([pad + (x1 - pad) * t, y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * sag]);
  }
  const shaft = wobbly(pts, rand, 5);
  const len = Math.min(h * 0.42, 44);
  const a1 = (150 + (rand() - 0.5) * 16) * (Math.PI / 180);
  const a2 = (-150 + (rand() - 0.5) * 16) * (Math.PI / 180);
  const head = `M${f(x1 + Math.cos(a1) * len)} ${f(y1 + Math.sin(a1) * len)} L${f(x1)} ${f(y1)} L${f(x1 + Math.cos(a2) * len * (0.9 + rand() * 0.2))} ${f(y1 + Math.sin(a2) * len)}`;
  return { shaft, head };
}

/** A quick strike-through scribble across a w×h box (two passes). */
export function strikePath(w: number, h: number, seed: number): string {
  const rand = rng(seed);
  const y = h * 0.52;
  const tilt = (rand() - 0.5) * h * 0.3;
  const a = wobbly([[-6, y + tilt], [w * 0.35, y + tilt * 0.3 + (rand() - 0.5) * 6], [w * 0.7, y - tilt * 0.3], [w + 6, y - tilt]], rand, 6);
  const b = wobbly([[w + 4, y - tilt + 7], [w * 0.5, y + 5 + (rand() - 0.5) * 6], [-4, y + tilt + 9]], rand, 6);
  return `${a} ${b.replace(/^M/, 'M')}`;
}

/** A loose underline under a w×h box. */
export function underlinePath(w: number, h: number, seed: number): string {
  const rand = rng(seed);
  const y = h - 8;
  return wobbly([[4, y + (rand() - 0.5) * 6], [w * 0.33, y + (rand() - 0.5) * 8], [w * 0.66, y + (rand() - 0.5) * 8], [w - 4, y - 4 - rand() * 8]], rand, 4);
}
