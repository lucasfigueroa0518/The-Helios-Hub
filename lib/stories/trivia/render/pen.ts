/**
 * The pen-tool arrow for AI Trivia's "Tap to reveal" (AT-33), copied from the Stories homemade style
 * (lib/stories/render/pen.ts, owned elsewhere) so this series doesn't move when that one does.
 * Seeded, so the same copy always draws the same stroke: level, with a hand's wobble.
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
 * A right-pointing arrow inside a w×h box, level (AT-37): the shaft starts and ends on the box's
 * middle line with only a hand's wobble between, and the two head strokes are mirror images, so the
 * arrow points straight right, the way a thumb draws it when it means "this way".
 */
export function arrowPaths(w: number, h: number, seed: number): { shaft: string; head: string } {
  const rand = rng(seed);
  const pad = 10;
  const y = h * 0.5;
  const x1 = w - pad;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 5; i++) pts.push([pad + (x1 - pad) * (i / 5), y]);
  const shaft = wobbly(pts, rand, 4);
  const len = Math.min(h * 0.42, 44);
  const a = 150 * (Math.PI / 180);
  const head = `M${f(x1 + Math.cos(a) * len)} ${f(y - Math.sin(a) * len)} L${f(x1)} ${f(y)} L${f(x1 + Math.cos(a) * len)} ${f(y + Math.sin(a) * len)}`;
  return { shaft, head };
}
