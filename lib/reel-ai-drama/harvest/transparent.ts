import sharp from 'sharp';

/**
 * Made drawings without their paper (iteration 4): the image model draws on plain white, and a white square
 * on a dark ground or over a photo reads as paper. Both modes are pixel code, no model:
 *   - 'ink' (marker line art: expression sketches, drawings, the harvest's line sketches): the white goes,
 *     inside the figure too; each pixel's alpha is its darkness, and its colour is un-blended from white, so
 *     anti-aliased strokes stay smooth on any ground and the kit can tint the lines.
 *   - 'paper' (a cut-paper collage element): only the white connected to the border goes (flood fill), so
 *     the element keeps its own paper; the band where it meets the background is softened.
 * A result that removes almost nothing or almost everything is refused (null): the caller keeps the original.
 */

export type AlphaMode = 'ink' | 'paper';

/** At or above: background white. At or below: full ink. */
export const INK_WHITE = 235;
export const INK_BLACK = 90;
/** Flood fill: near-white the collage background may be. */
export const PAPER_WHITE = 242;
/** Share of opaque pixels a usable result keeps (less: nothing drawn; more: no background found). */
export const MIN_KEPT = 0.004;
export const MAX_KEPT = 0.97;

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/** Returns a transparent PNG, or null when the picture has no plain background to remove. */
export async function removePaper(input: Buffer | string, mode: AlphaMode): Promise<{ png: Buffer; kept: number } | null> {
  const { data, info } = await sharp(input).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const n = w * h;
  const out = Buffer.from(data);
  const lum = (i: number) => 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  let kept = 0;
  if (mode === 'ink') {
    for (let i = 0; i < n; i++) {
      const l = lum(i);
      const a = l >= INK_WHITE ? 0 : l <= INK_BLACK ? 1 : (INK_WHITE - l) / (INK_WHITE - INK_BLACK);
      const alpha = Math.min(a, data[i * 4 + 3] / 255);
      out[i * 4 + 3] = clamp255(alpha * 255);
      if (alpha > 0) {
        // Un-blend from white: the stroke's own colour, without the paper showing through its edge.
        for (let c = 0; c < 3; c++) out[i * 4 + c] = clamp255(255 - (255 - data[i * 4 + c]) / Math.max(a, 1e-3));
      } else for (let c = 0; c < 3; c++) out[i * 4 + c] = 0;
      if (alpha > 0.1) kept++;
    }
  } else {
    const white = (i: number) => Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) >= PAPER_WHITE;
    const bg = new Uint8Array(n);
    const stack: number[] = [];
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (white(y * w + x)) stack.push(y * w + x);
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (white(y * w + x)) stack.push(y * w + x);
    while (stack.length) {
      const i = stack.pop()!;
      if (bg[i]) continue;
      bg[i] = 1;
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && !bg[i - 1] && white(i - 1)) stack.push(i - 1);
      if (x < w - 1 && !bg[i + 1] && white(i + 1)) stack.push(i + 1);
      if (y > 0 && !bg[i - w] && white(i - w)) stack.push(i - w);
      if (y < h - 1 && !bg[i + w] && white(i + w)) stack.push(i + w);
    }
    for (let i = 0; i < n; i++) {
      if (bg[i]) {
        out[i * 4 + 3] = 0;
        continue;
      }
      const x = i % w;
      const edge = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (i >= w && bg[i - w]) || (i + w < n && bg[i + w]);
      if (edge) out[i * 4 + 3] = clamp255(Math.min(data[i * 4 + 3], 255 * Math.max(0.35, (255 - lum(i)) / (255 - 128))));
      kept++;
    }
  }
  const share = kept / n;
  if (share < MIN_KEPT || share > MAX_KEPT) return null;
  const png = await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  return { png, kept: Math.round(share * 10_000) / 10_000 };
}

/**
 * Cutouts from the background remover (iteration 10): pixel code, no model. The remover answers in alpha, and how sure it
 * was is what grades the cut. The clean-up works on the remover's own answer (never on an earlier clean-up), keeps the
 * picture's canvas so its measured boxes stay true, and returns null when there's nothing worth keeping:
 *   - the silhouette goes solid: below CUT_BELIEF of its interior's alpha is the old background, above it is the subject;
 *   - stray islands go; a person also loses what hangs on them by a neck far thinner than a limb, and hair-thin spikes
 *     above the head. Small holes the remover left in the body are filled;
 *   - the edge moves in a little, and the band around it takes its colour from inside, so no old background stays as a fringe.
 */

/** Alpha below this isn't part of the silhouette at all. */
export const CUT_FAINT = 16;
/** Alpha at or above this is solid picture; between CUT_FAINT and this the remover wasn't sure. */
export const CUT_SOLID = 200;
/** Share of the interior's alpha a pixel needs to count as the subject. */
export const CUT_BELIEF = 0.6;
/** The mask work runs at this long side; the shape decisions don't need more. */
const CUT_WORK_PX = 720;
/** A person's neck-cut radius, as a share of the head's width: a wrist is well above twice this, a stray bridge below it. */
const NECK_OF_HEAD = 0.15;
/** With no head measured, the same radius as a share of the root of the silhouette's area. */
const NECK_OF_AREA = 0.03;
/** A spike above the head is thinner than twice this share of the head's width. */
const SPIKE_OF_HEAD = 0.035;
/** A piece beyond the neck stays only when it touches the body and is smaller than this share of it (fingers, a tuft). */
const PIECE_OF_BODY = 0.015;
/** A second part of a thing stays when at least this share of its main part (the two halves of a split lamp). */
const PART_OF_THING = 0.15;
/** A hole in the silhouette is a remover's mistake below this share of its area; above it, a real gap. */
const HOLE_OF_AREA = 0.01;
/** The band whose colour comes from inside, in edge moves: an old background's fringe runs a few pixels into the subject. */
const COLOUR_DEPTH = 4;
/** The contour's smoothing radius: the picture's long side over this. */
const CONTOUR_SOFT = 620;
/** A person's contour is smoothed by at least this share of the head's width: tufts the remover left in hair read as teeth. */
const CONTOUR_OF_HEAD = 0.012;
/** How steep the contour's alpha ramp is across the smoothed mask. */
const CONTOUR_RAMP = 4;
/** A larger hole is still a mistake when the remover half-believed it was picture, up to this share of the area (a real gap comes back fully clear). */
const UNSURE_HOLE_OF_AREA = 0.1;

export type CutBox = { x: number; y: number; w: number; h: number };
export type CutMeasures = {
  /** Share of the silhouette the remover wasn't sure of. 0–1. */
  edge_softness: number;
  /** Share of the silhouette outside its main piece, on the remover's answer. 0–1. */
  islands: number;
  /** Share of the clean edge in long axis-aligned runs away from the image's border. 0–1. */
  straight_cuts: number;
  /** Share of the silhouette the clean-up took away. 0–1. */
  lost: number;
  /** Share of the silhouette's edge still showing the old background's colour after the clean-up. 0–1. */
  fringe: number;
};

const r4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** 3-4 chamfer distance (in px × 3) from each mask pixel to the nearest non-mask pixel. Beyond the image counts as mask, so an open edge isn't eaten. */
function insideDistance(mask: Uint8Array, w: number, h: number): Int32Array {
  const d = new Int32Array(w * h);
  const far = 1 << 28;
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? far : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w]! + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1]! + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1]! + 4);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i]!;
      if (x < w - 1) v = Math.min(v, d[i + 1]! + 3);
      if (y < h - 1) {
        v = Math.min(v, d[i + w]! + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1]! + 4);
        if (x > 0) v = Math.min(v, d[i + w - 1]! + 4);
      }
      d[i] = v;
    }
  }
  return d;
}

/** The mask without everything within `r` px of its outside. */
const eroded = (mask: Uint8Array, w: number, h: number, r: number): Uint8Array => {
  const d = insideDistance(mask, w, h);
  return Uint8Array.from(d, (v) => (v > r * 3 ? 1 : 0));
};

/** The mask grown by `r` px, limited to `within`. */
function grown(mask: Uint8Array, w: number, h: number, r: number, within: Uint8Array): Uint8Array {
  const d = insideDistance(Uint8Array.from(mask, (v) => (v ? 0 : 1)), w, h);
  return Uint8Array.from(d, (v, i) => (within[i] && v <= r * 3 ? 1 : 0));
}

/** 4-connected pieces of a mask: a label per pixel (0: none) and each label's area. */
function pieces(mask: Uint8Array, w: number, h: number): { labels: Int32Array; areas: number[] } {
  const labels = new Int32Array(w * h);
  const areas = [0];
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || labels[s]) continue;
    const id = areas.length;
    let area = 0;
    labels[s] = id;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      area += 1;
      const x = p % w;
      if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = id; stack.push(p - 1); }
      if (x < w - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = id; stack.push(p + 1); }
      if (p >= w && mask[p - w] && !labels[p - w]) { labels[p - w] = id; stack.push(p - w); }
      if (p + w < mask.length && mask[p + w] && !labels[p + w]) { labels[p + w] = id; stack.push(p + w); }
    }
    areas.push(area);
  }
  return { labels, areas };
}

const largestLabel = (areas: readonly number[]) => areas.reduce((best, a, i) => (a > (areas[best] ?? 0) ? i : best), 0);
const only = (labels: Int32Array, id: number) => Uint8Array.from(labels, (l) => (l === id ? 1 : 0));

/** The piece holding `head`'s centre (or most of its box), else the largest. */
function headLabel(labels: Int32Array, areas: readonly number[], w: number, h: number, head: CutBox | null): number {
  if (head) {
    const count = new Map<number, number>();
    for (let y = Math.floor(head.y * h); y < Math.min(h, Math.ceil((head.y + head.h) * h)); y++) {
      for (let x = Math.floor(head.x * w); x < Math.min(w, Math.ceil((head.x + head.w) * w)); x++) {
        const l = labels[y * w + x]!;
        if (l) count.set(l, (count.get(l) ?? 0) + 1);
      }
    }
    const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) return best[0];
  }
  return largestLabel(areas);
}

/** Share of a mask's edge in axis-aligned runs of `minRun` px or more. The image's border isn't an edge (that's an open side, not a cut). Pure. */
export function straightEdgeShare(mask: Uint8Array, w: number, h: number, minRun: number): number {
  let edge = 0;
  let straight = 0;
  const walk = (len: number, across: number, at: (along: number, line: number) => number) => {
    for (let line = 0; line < across; line++) {
      for (const side of [-1, 1]) {
        const beyond = line + side;
        if (beyond < 0 || beyond >= across) continue;
        let run = 0;
        for (let along = 0; along <= len; along++) {
          const on = along < len && mask[at(along, line)] && !mask[at(along, beyond)];
          if (on) {
            run += 1;
            continue;
          }
          edge += run;
          if (run >= minRun) straight += run;
          run = 0;
        }
      }
    }
  };
  walk(w, h, (x, y) => y * w + x);
  walk(h, w, (y, x) => y * w + x);
  return edge ? r4(straight / edge) : 0;
}

/** Holes in a mask (not reached from the image's border) filled: small ones, and larger ones the remover half-believed (`unsure`, per cell, its mean alpha is past half of `cutoff`). */
function fillHoles(mask: Uint8Array, w: number, h: number, area: number, unsure: Uint8Array): Uint8Array {
  const { labels, areas } = pieces(Uint8Array.from(mask, (v) => (v ? 0 : 1)), w, h);
  const open = new Set<number>();
  for (let x = 0; x < w; x++) { open.add(labels[x]!); open.add(labels[(h - 1) * w + x]!); }
  for (let y = 0; y < h; y++) { open.add(labels[y * w]!); open.add(labels[y * w + w - 1]!); }
  const believed = new Int32Array(areas.length);
  for (let i = 0; i < labels.length; i++) believed[labels[i]!]! += unsure[i]!;
  return Uint8Array.from(mask, (v, i) => {
    const l = labels[i]!;
    if (v) return 1;
    if (open.has(l)) return 0;
    return areas[l]! <= area * HOLE_OF_AREA || (areas[l]! <= area * UNSURE_HOLE_OF_AREA && believed[l]! * 2 >= areas[l]!) ? 1 : 0;
  });
}

/** CIE Lab of an sRGB colour. Fringe is judged by how different two colours look. Pure. */
export function labOf(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const Y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const Z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}

/** The band of the silhouette the old background can reach into, as a share of the head's width. */
const FRINGE_DEPTH_OF_HEAD = 0.07;
/** Where the subject's own colours are looked for around an edge cell, as a share of the head's width. */
const SUBJECT_REACH_OF_HEAD = 0.28;
/** Further than this (Lab) from anything of the subject nearby: it isn't the subject. */
const FRINGE_FAR = 24;
/** The least a cell differs from the subject nearby to count as mixed with the old background (Lab). */
const FRINGE_NEAR = 6;
/** How close to the line between subject and old background a cell has to lie (Lab): how a blended edge pixel behaves. */
const FRINGE_LINE = 9;
/** How much of the old background a blended cell holds, at the least. */
const FRINGE_MIX = 0.22;
const PALETTE_BIN = 14;
const PALETTE_SIZE = 16;
/** A colour is the old background's when the photo holds it and the cut holds under this share of what the photo does. */
const PALETTE_CUT_SHARE = 0.4;
const PALETTE_MIN_SHARE = 0.004;

/** The colours of a cut's source photo that the cut left behind: its old background. No registration needed, so a crop or a resize doesn't matter. Pure. */
export function backgroundPalette(source: { data: Uint8Array | Buffer; channels: number }, inner: readonly (readonly [number, number, number])[]): [number, number, number][] {
  const key = (c: readonly number[]) => `${Math.floor(c[0]! / PALETTE_BIN)},${Math.floor((c[1]! + 128) / PALETTE_BIN)},${Math.floor((c[2]! + 128) / PALETTE_BIN)}`;
  const bins = new Map<string, { n: number; sum: [number, number, number] }>();
  const { data, channels } = source;
  let total = 0;
  for (let i = 0; i + channels <= data.length; i += channels) {
    const lab = labOf(data[i]!, data[i + 1]!, data[i + 2]!);
    const k = key(lab);
    const b = bins.get(k) ?? { n: 0, sum: [0, 0, 0] };
    b.n += 1;
    b.sum[0] += lab[0]; b.sum[1] += lab[1]; b.sum[2] += lab[2];
    bins.set(k, b);
    total += 1;
  }
  if (!total) return [];
  const own = new Map<string, number>();
  for (const c of inner) own.set(key(c), (own.get(key(c)) ?? 0) + 1);
  const innerTotal = Math.max(1, inner.length);
  return [...bins.entries()]
    .map(([k, b]) => ({ share: b.n / total, cut: (own.get(k) ?? 0) / innerTotal, mean: [b.sum[0] / b.n, b.sum[1] / b.n, b.sum[2] / b.n] as [number, number, number] }))
    .filter((b) => b.share >= PALETTE_MIN_SHARE && b.cut < b.share * PALETTE_CUT_SHARE)
    .sort((a, b) => b.share - b.cut - (a.share - a.cut))
    .slice(0, PALETTE_SIZE)
    .map((b) => b.mean);
}

const dist3 = (a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number) => Math.hypot(a[ai]! - b[bi]!, a[ai + 1]! - b[bi + 1]!, a[ai + 2]! - b[bi + 2]!);

/**
 * Where a person's silhouette still shows the old background, on the low-res working grid. A cell near the edge is judged
 * against the subject's own colours deep inside nearby: too far from them, or lying on the line between them and a colour of
 * the old background (how a blended pixel behaves), it's fringe. Only fringe reached from outside is removed, so a real
 * colour inside the body stays. `lab`: 3 floats per cell. Returns what's kept, and the share of the edge band left marked. Pure.
 */
export function removeFringe(keep: Uint8Array, lab: Float32Array, w: number, h: number, headPx: number, palette: readonly (readonly [number, number, number])[], crownTo = 0): { keep: Uint8Array; removed: number; fringe: number } {
  const depth = Math.max(2, Math.round(FRINGE_DEPTH_OF_HEAD * headPx));
  const reach = Math.max(4, Math.round(SUBJECT_REACH_OF_HEAD * headPx));
  const stride = Math.max(1, Math.round(reach / 7));
  const inside = insideDistance(keep, w, h);
  const marked = new Uint8Array(w * h);
  let band = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!keep[i] || inside[i]! > depth * 3) continue;
      band += 1;
      let best = -1;
      let bestD = Infinity;
      for (let dy = -reach; dy <= reach; dy += stride) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -reach; dx <= reach; dx += stride) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (inside[j]! <= depth * 3) continue;
          const d = dist3(lab, i * 3, lab, j * 3);
          if (d < bestD) { bestD = d; best = j; }
        }
      }
      if (best < 0 || bestD < FRINGE_NEAR) continue;
      if (bestD > FRINGE_FAR) { marked[i] = 1; continue; }
      const S = [lab[best * 3]!, lab[best * 3 + 1]!, lab[best * 3 + 2]!];
      const c = [lab[i * 3]! - S[0]!, lab[i * 3 + 1]! - S[1]!, lab[i * 3 + 2]! - S[2]!];
      for (const B of palette) {
        const v = [B[0] - S[0]!, B[1] - S[1]!, B[2] - S[2]!];
        const len2 = v[0]! * v[0]! + v[1]! * v[1]! + v[2]! * v[2]!;
        if (len2 < FRINGE_FAR * FRINGE_FAR) continue;
        const t = (c[0]! * v[0]! + c[1]! * v[1]! + c[2]! * v[2]!) / len2;
        if (t < FRINGE_MIX || t > 1.15) continue;
        if (Math.hypot(c[0]! - t * v[0]!, c[1]! - t * v[1]!, c[2]! - t * v[2]!) < FRINGE_LINE) { marked[i] = 1; break; }
      }
    }
  }
  // Inward from the outside, through marked cells only.
  const out = Uint8Array.from(keep);
  const stack: number[] = [];
  const open = (i: number) => {
    if (!out[i] || !marked[i]) return;
    out[i] = 0;
    stack.push(i);
  };
  for (let i = 0; i < out.length; i++) {
    if (!keep[i] || !marked[i]) continue;
    const x = i % w;
    if ((x > 0 && !keep[i - 1]) || (x < w - 1 && !keep[i + 1]) || (i >= w && !keep[i - w]) || (i + w < out.length && !keep[i + w])) open(i);
  }
  let removed = 0;
  while (stack.length) {
    const p = stack.pop()!;
    removed += 1;
    const x = p % w;
    if (x > 0) open(p - 1);
    if (x < w - 1) open(p + 1);
    if (p >= w) open(p - w);
    if (p + w < out.length) open(p + w);
  }
  let left = 0;
  for (let i = 0; i < out.length; i++) {
    if (!out[i] || !marked[i]) continue;
    // Round the crown there is only hair at the edge: a colour nothing nearby has goes, even behind a dark rim.
    if (i < crownTo * w && inside[i]! <= depth * 1.5) { out[i] = 0; removed += 1; } else left += 1;
  }
  return { keep: out, removed, fringe: band ? r4(left / band) : 0 };
}

/** A person's head from the shape alone, when nothing measured it: the silhouette's first rows, a head's height in. Pure. */
export function headFromShape(keep: Uint8Array, w: number, h: number): CutBox | null {
  let top = -1;
  let bottom = -1;
  const spans: { a: number; b: number; n: number }[] = [];
  for (let y = 0; y < h; y++) {
    let a = w, b = -1, n = 0;
    for (let x = 0; x < w; x++) if (keep[y * w + x]) { a = Math.min(a, x); b = Math.max(b, x); n += 1; }
    spans.push({ a, b, n });
    if (n) { if (top < 0) top = y; bottom = y; }
  }
  if (top < 0) return null;
  const tall = bottom - top + 1;
  // Below the hair's stray tips and above the shoulders.
  const rows = spans.slice(top + Math.round(tall * 0.08), top + Math.round(tall * 0.2)).filter((s) => s.n);
  if (!rows.length) return null;
  const mid = (list: number[]) => [...list].sort((p, q) => p - q)[Math.floor(list.length / 2)]!;
  const a = mid(rows.map((s) => s.a)), b = mid(rows.map((s) => s.b));
  const wide = b - a + 1;
  return { x: a / w, y: top / h, w: wide / w, h: Math.min(1 - top / h, (wide * 1.25) / h) };
}

/** A box blur run three times (near enough a Gaussian), the image's border extended. `radius` in px. Pure. */
function softened(mask: Uint8Array, w: number, h: number, radius: number): Float32Array {
  let cur = Float32Array.from(mask);
  let next = new Float32Array(w * h);
  const across = (src: Float32Array, dst: Float32Array, len: number, lines: number, at: (along: number, line: number) => number) => {
    for (let line = 0; line < lines; line++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += src[at(Math.min(len - 1, Math.max(0, k)), line)]!;
      for (let k = 0; k < len; k++) {
        dst[at(k, line)] = sum / (2 * radius + 1);
        sum += src[at(Math.min(len - 1, k + radius + 1), line)]! - src[at(Math.max(0, k - radius), line)]!;
      }
    }
  };
  for (let pass = 0; pass < 3; pass++) {
    across(cur, next, w, h, (x, y) => y * w + x);
    [cur, next] = [next, cur];
    across(cur, next, h, w, (y, x) => y * w + x);
    [cur, next] = [next, cur];
  }
  return cur;
}

/** A person's silhouette without the hair-thin spikes above the head, and without what they held on. Pure. */
function withoutSpikes(mask: Uint8Array, w: number, h: number, head: CutBox): Uint8Array {
  const spike = Math.max(1, SPIKE_OF_HEAD * head.w * w);
  const opened = grown(eroded(mask, w, h, spike), w, h, spike, mask);
  const line = Math.round((head.y + head.h / 2) * h);
  const kept = Uint8Array.from(mask, (v, i) => (v && (i >= line * w || opened[i]) ? 1 : 0));
  const left = pieces(kept, w, h);
  return only(left.labels, headLabel(left.labels, left.areas, w, h, head));
}

/** What of a low-res silhouette stays. Pure. */
function keepMask(mask: Uint8Array, w: number, h: number, person: boolean, head: CutBox | null): { keep: Uint8Array; islands: number } {
  const total = mask.reduce((n, v) => n + v, 0);
  const { labels, areas } = pieces(mask, w, h);
  const main = headLabel(labels, areas, w, h, person ? head : null);
  const islands = total ? 1 - areas[main]! / total : 1;
  if (!person) {
    const keep = Uint8Array.from(labels, (l) => (l && areas[l]! >= areas[main]! * PART_OF_THING ? 1 : 0));
    return { keep, islands };
  }
  const headPx = head ? head.w * w : 0;
  const neck = Math.max(1, head ? NECK_OF_HEAD * headPx : NECK_OF_AREA * Math.sqrt(total));
  const one = only(labels, main);
  const inner = pieces(eroded(one, w, h, neck), w, h);
  let keep: Uint8Array = one;
  if (inner.areas.length > 1) {
    const core = only(inner.labels, headLabel(inner.labels, inner.areas, w, h, head));
    const body = grown(core, w, h, neck, one);
    const rest = pieces(Uint8Array.from(one, (v, i) => (v && !body[i] ? 1 : 0)), w, h);
    const bodyArea = body.reduce((n, v) => n + v, 0);
    const stays = new Set<number>();
    for (let i = 0; i < body.length; i++) {
      if (!body[i]) continue;
      const x = i % w;
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        const l = n >= 0 && n < body.length ? rest.labels[n]! : 0;
        if (l && rest.areas[l]! < bodyArea * PIECE_OF_BODY) stays.add(l);
      }
    }
    keep = Uint8Array.from(body, (v, i) => (v || stays.has(rest.labels[i]!) ? 1 : 0));
  }
  if (head) keep = withoutSpikes(keep, w, h, head);
  return { keep, islands };
}

/**
 * Measures a remover's answer and cleans it. `data` is RGBA, not changed; `clean` is the new RGBA, or null when the
 * silhouette is a haze with no body (nothing is cleaned: the grade will refuse it). Pure.
 */
export function cleanCutRaw(
  data: Uint8Array | Buffer,
  w: number,
  h: number,
  opts: { person: boolean; head?: CutBox | null; source?: { data: Uint8Array | Buffer; channels: number } | null },
): CutMeasures & { clean: Uint8Array | null } {
  const n = w * h;
  let silhouette = 0;
  let unsure = 0;
  const hist = new Int32Array(256);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3]!;
    if (a >= CUT_FAINT) silhouette += 1;
    if (a >= CUT_FAINT && a < CUT_SOLID) unsure += 1;
    if (a >= 128) hist[a]! += 1;
  }
  const edge_softness = silhouette ? r4(unsure / silhouette) : 1;
  let solidCount = 0;
  for (let a = 128; a < 256; a++) solidCount += hist[a]!;
  let level = 255;
  for (let a = 128, seen = 0; a < 256; a++) {
    seen += hist[a]!;
    if (seen * 2 >= solidCount && solidCount) { level = a; break; }
  }
  const cutoff = CUT_BELIEF * level;

  // Low-res shape work.
  const s = Math.min(1, CUT_WORK_PX / Math.max(w, h));
  const lw = Math.max(1, Math.round(w * s));
  const lh = Math.max(1, Math.round(h * s));
  const cell = (x: number, y: number) => Math.floor((y * lh) / h) * lw + Math.floor((x * lw) / w);
  const hits = new Int32Array(lw * lh);
  const all = new Int32Array(lw * lh);
  const alphaSum = new Float64Array(lw * lh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = cell(x, y);
      const a = data[(y * w + x) * 4 + 3]!;
      all[c]! += 1;
      alphaSum[c]! += a;
      if (a >= cutoff) hits[c]! += 1;
    }
  }
  const low = Uint8Array.from(hits, (v, i) => (v * 2 >= all[i]! && all[i]! ? 1 : 0));
  const halfBelieved = Uint8Array.from(alphaSum, (v, i) => (all[i]! && v / all[i]! >= cutoff / 2 ? 1 : 0));
  const lowArea = low.reduce((sum, v) => sum + v, 0);
  if (!lowArea) return { edge_softness, islands: 1, straight_cuts: 0, lost: 1, fringe: 0, clean: null };
  const filled = fillHoles(low, lw, lh, lowArea, halfBelieved);
  // Nothing measured a head: the shape gives one, so a person's stray tips and fringe still have a size to be judged by.
  const head = opts.head ?? (opts.person ? headFromShape(filled, lw, lh) : null);
  const shaped = keepMask(filled, lw, lh, opts.person, head);
  const islands = shaped.islands;
  let keep = shaped.keep;
  // The old background inside the cut, judged by colour: a person's only (a thing's edge may be any colour).
  let fringe = 0;
  if (opts.person && head) {
    const lab = new Float32Array(lw * lh * 3);
    const seen = new Int32Array(lw * lh);
    const sums = new Float64Array(lw * lh * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3]! < cutoff) continue;
        const c = cell(x, y);
        seen[c]! += 1;
        sums[c * 3]! += data[i]!;
        sums[c * 3 + 1]! += data[i + 1]!;
        sums[c * 3 + 2]! += data[i + 2]!;
      }
    }
    const inner: [number, number, number][] = [];
    const deep = insideDistance(keep, lw, lh);
    const deepBy = Math.max(2, FRINGE_DEPTH_OF_HEAD * head.w * lw) * 3;
    for (let c = 0; c < seen.length; c++) {
      if (!seen[c]) continue;
      const [L, A, B] = labOf(sums[c * 3]! / seen[c]!, sums[c * 3 + 1]! / seen[c]!, sums[c * 3 + 2]! / seen[c]!);
      lab[c * 3] = L; lab[c * 3 + 1] = A; lab[c * 3 + 2] = B;
      if (keep[c] && deep[c]! > deepBy) inner.push([L, A, B]);
    }
    const palette = opts.source ? backgroundPalette(opts.source, inner) : [];
    const cleaned = removeFringe(keep, lab, lw, lh, head.w * lw, palette, Math.round((head.y + head.h / 2) * lh));
    fringe = cleaned.fringe;
    // What fringe left hanging goes with it.
    keep = withoutSpikes(cleaned.keep, lw, lh, head);
  }
  const kept = keep.reduce((sum, v) => sum + v, 0);
  const lost = r4(Math.max(0, 1 - kept / Math.max(lowArea, 1)));
  const straight_cuts = straightEdgeShare(keep, lw, lh, Math.max(6, Math.round(0.08 * Math.sqrt(kept))));
  const measures = { edge_softness, islands: r4(islands), straight_cuts, lost, fringe };
  if (edge_softness >= CUT_UNSURE_REJECT || lost >= CUT_LOST_REJECT) return { ...measures, clean: null };

  // Full-res edge: solid inside, moved in a little, a one-pixel ramp, its colour from inside.
  const full = new Uint8Array(n);
  const inside = (c: number) => {
    const cx = c % lw;
    return keep[c] && (cx === 0 || keep[c - 1]) && (cx === lw - 1 || keep[c + 1]) && (c < lw || keep[c - lw]) && (c + lw >= keep.length || keep[c + lw]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = cell(x, y);
      // A cell inside the shape is all subject; only its boundary cells follow the remover's own edge.
      if (keep[c] && (inside(c) || data[i * 4 + 3]! >= cutoff)) full[i] = 1;
    }
  }
  const move = Math.max(1, Math.round(Math.min(w, h) / 900));
  const core = eroded(full, w, h, move);
  const out = Uint8Array.from(data);
  // The contour comes out smooth at any size: what the remover and the working grid left as steps goes, and one ramp remains.
  const contourPx = Math.max(Math.round(Math.max(w, h) / CONTOUR_SOFT), head ? Math.round(CONTOUR_OF_HEAD * head.w * w) : 0, 1);
  const smooth = softened(core, w, h, contourPx);
  for (let i = 0; i < n; i++) out[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, (smooth[i]! - 0.5) * CONTOUR_RAMP + 0.5)) * 255);
  // Colour from inside, ring by ring: nearest core pixel's colour out to where the alpha ends.
  const queue = new Int32Array(n);
  let front = 0;
  let tail = 0;
  const filledColour = eroded(full, w, h, move * COLOUR_DEPTH);
  for (let i = 0; i < n; i++) if (filledColour[i]) queue[tail++] = i;
  const reach = new Int32Array(n);
  const limit = move * COLOUR_DEPTH + 2;
  while (front < tail) {
    const p = queue[front++]!;
    if (reach[p]! >= limit) continue;
    const x = p % w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (q < 0 || q >= n || filledColour[q]) continue;
      filledColour[q] = 1;
      reach[q] = reach[p]! + 1;
      out[q * 4] = out[p * 4]!;
      out[q * 4 + 1] = out[p * 4 + 1]!;
      out[q * 4 + 2] = out[p * 4 + 2]!;
      queue[tail++] = q;
    }
  }
  return { ...measures, clean: out };
}

/** Haze: more of the silhouette unsure than this has no body to show. Rough from CUT_UNSURE_ROUGH: well past an edge band (2–5% on a good cut). */
export const CUT_UNSURE_REJECT = 0.6;
export const CUT_UNSURE_ROUGH = 0.15;
/** Most of the silhouette off its main piece, or taken by the clean-up: the cut didn't find one subject. */
export const CUT_LOST_REJECT = 0.5;
export const CUT_LOST_ROUGH = 0.15;
/** A person has no long straight edges: these shares of the edge are a mask's mistake. A thing may be straight. */
export const CUT_STRAIGHT_REJECT = 0.5;
export const CUT_STRAIGHT_ROUGH = 0.2;
/** `sharpness` is the width it stays sharp at, as a share of the frame: a sixth of the frame is the least a cutout can do; a third is a good small figure. */
export const CUT_SHARP_REJECT = 1 / 6;
export const CUT_SHARP_ROUGH = 1 / 3;

/** Old background still inside the cut after the clean-up, as a share of its edge band: a visible halo, then one that can't be hidden. */
export const CUT_FRINGE_ROUGH = 0.12;
export const CUT_FRINGE_REJECT = 0.4;

export type CutGrade = 'clean' | 'rough' | 'rejected';

/** The grade of a cut from its measures. Pure. */
export function gradeCut(m: { edge_softness: number; islands: number; straight_cuts: number; sharpness: number; lost?: number; fringe?: number }, person: boolean): CutGrade {
  const lost = Math.max(m.lost ?? 0, m.islands);
  const straight = person ? m.straight_cuts : 0;
  const fringe = m.fringe ?? 0;
  if (m.edge_softness >= CUT_UNSURE_REJECT || lost >= CUT_LOST_REJECT || straight >= CUT_STRAIGHT_REJECT || m.sharpness < CUT_SHARP_REJECT || fringe >= CUT_FRINGE_REJECT) return 'rejected';
  if (m.edge_softness >= CUT_UNSURE_ROUGH || lost >= CUT_LOST_ROUGH || straight >= CUT_STRAIGHT_ROUGH || m.sharpness < CUT_SHARP_ROUGH || fringe >= CUT_FRINGE_ROUGH) return 'rough';
  return 'clean';
}
