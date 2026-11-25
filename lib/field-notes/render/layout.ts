/**
 * Slide layout (CONTRACT-v4 section 6, Tommy 2026-11-06): plain text set over a real photo. "The text is
 * doing the work here, the photos are just the background."
 *   - One left-aligned block, horizontally centred on the canvas and, by default, vertically centred.
 *     Tip: the value headline (Pragmatica Extended Bold, large, up to TIP_HEADLINE_MAX_LINES lines) then one
 *     plain Roboto body paragraph. Any backticked code still in the body is set in a monospace style (the
 *     backticks are not drawn). The block may shift up or down by at most about 15% of the canvas height,
 *     only when the centre is clearly busier than that spot.
 *   - Cover: a `hand` line ("field notes", Hershey Sans pen strokes) above the Pragmatica headline; the block
 *     moves above or below the detected faces, never over them. No face: `cover_no_face`.
 *   - Follow: a `hand` line (a PLACEHOLDER until Tommy picks the wording) and the follow handle, centred,
 *     with no logo (dropped 2026-11-06).
 *   - Contrast: white text. The photo is darkened gently behind and around the block (feathered, darken.ts),
 *     raised in steps until every line band of every block passes the readability check on the darkened pixels
 *     (contrastBands: the rendered check's own measure, on any run of lines it could measure), plus a faint text
 *     shadow. A tip block unreadable at `darkenCap` first moves to the nearest spot inside the 15% band that reads;
 *     still unreadable: `placementFailed` with `no_calm_region`, so the run swaps the photo.
 * No marks, arrows, underlines, emphasis, packing or region hunting. Type never shrinks below its minimum:
 * text that will not fit is reported `too_long`. Lengths are the writing gates' job (write/caps.ts).
 */
import sharp from 'sharp';

import { FIELD_NOTES_DEFAULT_SETTINGS, FOLLOW_HANDLE, type Block, type BlockRole, type Rect, type SlideKind } from '../types';
import { colorContrast, darkenSamples, isLargeType, lumStats, sampleRegion, WHITE_HEX } from './contrast';
import { darkenPhoto, type DarkenZone } from './darken';
import { expandRect, faceZone, rectsOverlap, unionRect } from './geometry';
import { handStrokes } from './handwrite';
import { textWidthPx, wrapLines, type Family, type TextFamily } from './metrics';
import { CANVAS_H, CANVAS_W, preparePhoto, type DetectFaces, type PreparedPhoto } from './photo';
import type { FitProblem } from './problems';
import { analyzeCanvas, busyness, windowStats, type Analysis } from './regions';

/** Safe margin on every side (px). */
export const DEFAULT_MARGIN = 80;
/** The widest a text block may wrap (px): 100px of photo either side. */
export const BLOCK_MAX_W = 880;
export const HEADLINE_TRACKING_EM = -0.02;
export const LINE_HEIGHT = { headline: 1.08, body: 1.34 } as const;
/** Space under the hand line, and under the headline, as a share of the type below / the body size. */
export const HAND_GAP = 22;
export const HEADLINE_GAP_EM = 0.55;
/** Pixels sampled around each block for the readability check. */
export const SAMPLE_PAD = 14;
/** The overlay is at full strength this far round the block, then fades over the feather. */
export const CORE_PAD = 44;
export const FEATHER_PX = 300;
/** Darkening steps: start gentle, raise by this until the block reads, stop at the cap. */
export const DARKEN_FLOOR = 0.1;
export const DARKEN_STEP = 0.05;
/** A tip block may leave the centre by at most this share of the canvas height, and only for a clearly calmer spot. */
export const MAX_SHIFT_RATIO = 0.15;
/** The centre is "clearly busier" when its busyness exceeds the spot's by this much and by this ratio. */
export const BUSIER_BY = 0.12;
export const BUSIER_RATIO = 0.75;
export const SHIFT_EDGE = 24;
export const LOGO_SIZE = 200;
/** The "H" of the HELIOS wordmark is this fraction of the mark's width (measured on the asset). */
export const LOGO_H_RATIO = 167 / 1200;
export const DEFAULT_LOGO_CLEAR = 48;
/** The stable placement-failure reason for a cover whose photo has no detected face. */
export const COVER_NO_FACE = 'cover_no_face';
/** The cover's code-written hand line (Tommy, 2026-11-06). */
export const COVER_HAND_TEXT = 'field notes';
/** PLACEHOLDER wording for the Follow slide's hand line: Tommy picks the real line at samples (PLAN 2026-11-06). */
/** The Follow slide's hand line (Tommy, 2026-11-06: "any"; lead's pick, no posting cadence promised). */
export const FOLLOW_HAND_TEXT = 'follow for more field notes';
/** Hershey cap heights (px) of the hand lines. */
export const HAND_SIZE: Record<'cover' | 'follow', number> = { cover: 58, follow: 54 };
/** Faint shadow under the white text (the photo treatment carries the contrast; this only lifts the edges). */
export const TEXT_SHADOW = '0 1px 3px rgba(0,0,0,0.4), 0 0 24px rgba(0,0,0,0.3)';
/** Soft target: the gray-level spread of the darkened photo under a block (busy texture fights the letters). */
export const TEXTURE_STD = 36;

export type SlideInput = {
  kind: SlideKind;
  photoId?: string;
  /** Any image the renderer can decode; oriented and cover-fitted here. */
  photo: Buffer;
  /** Cover: the code-written headline. Tip: the value the reader gets (never the tool's name). Not used on follow. */
  headline?: string;
  /** Tip: what it is, in plain words. A backticked span is drawn in a monospace style. */
  body?: string;
  /** Kept in the layout for traceability; nothing random is drawn from it now. */
  seed?: string | number;
};

export type PlannerDeps = {
  detectFaces?: DetectFaces;
  /** The strongest overlay allowed (settings `darkenCap`); default FIELD_NOTES_DEFAULT_SETTINGS.darkenCap. */
  darkenCap?: number;
  margin?: number;
  /** Skip photo prep when the caller already has it. */
  prepared?: PreparedPhoto;
};

export type PlacedBlock = Block & {
  index: number;
  /** Text: font size. Hand: Hershey cap height. */
  fontPx: number;
  family: Family;
  /** The colour drawn (white). */
  color: string;
  large: boolean;
  trackingEm: number;
  lineHeight: number;
  /** Estimated line count (the render check measures the real one). */
  lines: number;
  /** Estimated width of the longest line (px). */
  inkW: number;
};

export type LogoPlacement = { rect: Rect; clear: number; zone: Rect; hHeight: number };

export type PlacementFailReason = typeof COVER_NO_FACE | 'no_calm_region';

export type DarkenStep = {
  darken: number;
  /** The weakest block's mean contrast at this step. */
  contrast: number;
  /** Every block passes the readability check (hard). */
  ok: boolean;
  /** The texture under every block is calm enough (soft: only keeps the overlay rising). */
  calm: boolean;
};

export type DarkenPlan = DarkenZone & {
  /** The overlay strength applied (also on every block's `darken`). */
  value: number;
  cap: number;
  /** Every step tried, in order: the last is the one applied. */
  steps: DarkenStep[];
};

export type SlideLayout = {
  kind: SlideKind;
  photoId: string;
  /** The prepared photo WITH the darkening baked in (what the slide shows). */
  photo: PreparedPhoto;
  /** The prepared photo before darkening. */
  basePhoto: PreparedPhoto;
  faces: Rect[];
  blocks: PlacedBlock[];
  logo: LogoPlacement | null;
  darken: DarkenPlan;
  /** How far (px) the block moved from the vertical centre; 0 on most slides. */
  shiftY: number;
  margin: number;
  seed: string;
  /** No usable placement: unreadable even at the darken cap, no room off the faces, or a cover with no face. The run swaps the photo. */
  placementFailed: boolean;
  /** Why placement failed (set whenever `placementFailed` is). `cover_no_face` wants a `people` photo. */
  failReason?: PlacementFailReason;
  /** Problems found while planning (slide number 0; the post-level caller numbers them). */
  problems: FitProblem[];
  notes: string[];
};

// ── type ladders ────────────────────────────────────────────────────────────

type Sizes = { headline: number; body: number };

/** Largest to smallest. The last entry is the minimum: text never shrinks past it. Follow's `headline` is the handle. */
export const SIZE_LADDERS: Record<SlideKind, Sizes[]> = {
  cover: [112, 104, 98, 92, 86].map((h) => ({ headline: h, body: 0 })),
  tip: [84, 76, 70, 66, 62, 58, 54, 50, 46].map((h, i) => ({ headline: h, body: [52, 50, 48, 46, 44, 42, 40, 38, 36][i]! })),
  follow: [84, 78, 72, 66, 60].map((h) => ({ headline: h, body: 0 })),
};
/** A tip block taller than this is too dominant; the ladder steps down until it is under (or at the minimum). */
export const TIP_BLOCK_MAX_H = 800;
/** The value headline may wrap to this many lines; the ladder steps down until it does (or reaches the minimum). */
export const TIP_HEADLINE_MAX_LINES = 3;

export function minSizes(kind: SlideKind): Sizes {
  const l = SIZE_LADDERS[kind];
  return l[l.length - 1]!;
}

// ── text ────────────────────────────────────────────────────────────────────

/** The tip's body paragraph: whitespace collapsed; backticks kept (they mark code, drawn in monospace). */
export function tipBody(body: string | undefined): string {
  return (body ?? '').replace(/\s+/g, ' ').trim();
}

type Item = { role: BlockRole; text: string };

function itemsFor(input: SlideInput): Item[] {
  if (input.kind === 'follow') return [{ role: 'hand', text: FOLLOW_HAND_TEXT }, { role: 'headline', text: FOLLOW_HANDLE }];
  const headline = (input.headline ?? '').replace(/`/g, '').trim();
  if (input.kind === 'cover') return [{ role: 'hand', text: COVER_HAND_TEXT }, ...(headline ? [{ role: 'headline' as const, text: headline }] : [])];
  const body = tipBody(input.body);
  return [...(headline ? [{ role: 'headline' as const, text: headline }] : []), ...(body ? [{ role: 'body' as const, text: body }] : [])];
}

function textProblems(input: SlideInput): FitProblem[] {
  const out: FitProblem[] = [];
  for (const t of [input.headline, input.body].filter((x): x is string => !!x)) {
    if (t.includes('!')) out.push({ kind: 'forbidden_text', slide: 0, message: `"${t.slice(0, 40)}" has an exclamation mark; the brand has none` });
    if (/\p{Extended_Pictographic}/u.test(t)) out.push({ kind: 'forbidden_text', slide: 0, message: `"${t.slice(0, 40)}" has an emoji; the brand uses Lucide icons only` });
  }
  return out;
}

// ── stack geometry ──────────────────────────────────────────────────────────

type GeoItem = { item: Item; fontPx: number; family: Family; trackingEm: number; lineHeight: number; lines: number; inkW: number; /** Relative to the block's top-left. */ rect: Rect };

type Geometry = { width: number; height: number; items: GeoItem[]; /** False when a single word is wider than the block (it would overflow). */ fits: boolean };

/** Lays the items out top to bottom at `sizes`, wrapping at BLOCK_MAX_W; the block is as wide as its longest line. */
export function stackGeometry(kind: SlideKind, items: Item[], sizes: Sizes, maxW = BLOCK_MAX_W): Geometry {
  const out: GeoItem[] = [];
  let y = 0;
  let fits = true;
  for (const [n, item] of items.entries()) {
    if (item.role === 'hand') {
      // The hand line keeps its size unless it would run wider than the block; then it scales down to fit.
      const want = HAND_SIZE[kind === 'follow' ? 'follow' : 'cover'];
      const natural = handStrokes(item.text, want).ink.w;
      const size = natural > maxW * 0.94 ? Math.floor((want * maxW * 0.94) / natural) : want;
      const h = handStrokes(item.text, size);
      if (h.ink.w > maxW) fits = false;
      out.push({ item, fontPx: size, family: 'hand', trackingEm: 0, lineHeight: 1, lines: 1, inkW: h.ink.w, rect: { x: 0, y, w: h.ink.w, h: h.ink.h } });
      y += h.ink.h + HAND_GAP;
      continue;
    }
    const family: TextFamily = item.role === 'headline' ? 'heading' : 'body';
    const fontPx = item.role === 'headline' ? sizes.headline : sizes.body;
    const trackingEm = family === 'heading' ? HEADLINE_TRACKING_EM : 0;
    const lineHeight = family === 'heading' ? LINE_HEIGHT.headline : LINE_HEIGHT.body;
    if (item.text.split(/\s+/).some((w) => textWidthPx(w, fontPx, family, trackingEm) > maxW * 0.97)) fits = false;
    const lines = wrapLines(item.text, fontPx, family, maxW, trackingEm);
    const inkW = Math.ceil(Math.max(...lines.map((l) => textWidthPx(l, fontPx, family, trackingEm))));
    const h = Math.ceil(lines.length * fontPx * lineHeight);
    out.push({ item, fontPx, family, trackingEm, lineHeight, lines: lines.length, inkW, rect: { x: 0, y, w: maxW, h } });
    const next = items[n + 1];
    y += h + (next ? Math.round((next.role === 'body' ? sizes.body : fontPx) * HEADLINE_GAP_EM) : 0);
  }
  if (out.length && out[out.length - 1]!.item.role === 'hand') y -= HAND_GAP;
  // The block is as wide as its longest line (plus slack for the browser's own metrics), never wider than maxW.
  const inkW = Math.max(0, ...out.map((g) => g.inkW));
  const width = Math.min(maxW, Math.ceil(inkW / 0.97) + 6);
  for (const g of out) if (g.family !== 'hand') g.rect.w = width;
  return { width, height: y, items: out, fits };
}

function pickSizes(kind: SlideKind, items: Item[], margin: number): { geo: Geometry; tooLong: boolean } {
  const ladder = SIZE_LADDERS[kind];
  const room = CANVAS_H - 2 * margin;
  const maxH = kind === 'tip' ? TIP_BLOCK_MAX_H : room;
  const headlineOk = (geo: Geometry) => kind !== 'tip' || geo.items.every((g) => g.item.role !== 'headline' || g.lines <= TIP_HEADLINE_MAX_LINES);
  for (const sizes of ladder) {
    const geo = stackGeometry(kind, items, sizes);
    if (geo.fits && geo.height <= maxH && headlineOk(geo)) return { geo, tooLong: false };
  }
  const min = stackGeometry(kind, items, ladder[ladder.length - 1]!);
  return { geo: min, tooLong: !min.fits || min.height > room };
}

function placeRects(geo: Geometry, origin: { x: number; y: number }): Rect[] {
  return geo.items.map((g) => ({ x: g.rect.x + origin.x, y: g.rect.y + origin.y, w: g.rect.w, h: g.rect.h }));
}

// ── vertical placement ─────────────────────────────────────────────────────

/** Tip: the centre, unless it is clearly busier than a spot within MAX_SHIFT_RATIO of it (faces count as busy). */
export function tipOffset(analysis: Analysis, geo: Geometry, x: number, faces: Rect[], margin: number): { y: number; shiftY: number; centre: number; best: number } {
  const y0 = Math.round((CANVAS_H - geo.height) / 2);
  const maxShift = Math.round(CANVAS_H * MAX_SHIFT_RATIO);
  // A shifted block keeps SHIFT_EDGE px more than the margin: Pragmatica's glyph box overhangs its line box.
  const lo = Math.max(margin + SHIFT_EDGE, y0 - maxShift);
  const hi = Math.min(CANVAS_H - margin - SHIFT_EDGE - geo.height, y0 + maxShift);
  const score = (y: number) => {
    const rect = expandRect({ x, y, w: geo.width, h: geo.height }, CORE_PAD / 2);
    const facePenalty = faces.some((f) => rectsOverlap(rect, faceZone(f))) ? 1 : 0;
    return busyness(windowStats(analysis, rect)) + facePenalty;
  };
  const y0c = Math.min(Math.max(y0, lo), Math.max(lo, hi));
  const centre = score(y0c);
  let best = { y: y0c, s: centre, cost: centre };
  for (let y = lo; y <= hi; y += 10) {
    const s = score(y);
    const cost = s + 0.15 * (Math.abs(y - y0) / Math.max(1, maxShift));
    if (cost < best.cost) best = { y, s, cost };
  }
  const clearly = centre - best.s >= BUSIER_BY && best.s <= centre * BUSIER_RATIO;
  const y = clearly ? best.y : y0c;
  return { y, shiftY: y - y0, centre, best: best.s };
}

/**
 * Every top y a tip block may take inside the MAX_SHIFT_RATIO band (10px steps, the band's ends included), nearest to
 * `preferred` first. The contrast fallback walks this list when the preferred spot is unreadable even at the cap.
 */
export function tipShiftCandidates(geo: Geometry, preferred: number, margin: number): number[] {
  const y0 = Math.round((CANVAS_H - geo.height) / 2);
  const maxShift = Math.round(CANVAS_H * MAX_SHIFT_RATIO);
  const lo = Math.max(margin + SHIFT_EDGE, y0 - maxShift);
  const hi = Math.max(lo, Math.min(CANVAS_H - margin - SHIFT_EDGE - geo.height, y0 + maxShift));
  const ys = new Set<number>([preferred, lo, hi]);
  for (let y = lo; y <= hi; y += 10) ys.add(y);
  return [...ys].filter((y) => y >= lo && y <= hi).sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b);
}

/**
 * The rects the planner's readability check samples for each block, in canvas px (before SAMPLE_PAD): one band per
 * estimated line, as wide as the block's widest estimated line; a hand line is its pen ink. The rendered check
 * samples the browser's tight ink box, which is a run of those lines; the line count and the block height are only
 * estimates (the post of 2026-11-08 had one body line fewer than planned, and the planner's region took in darker
 * photo below the real text). Requiring EVERY band to pass bounds any run of them: a mean luminance under the limit
 * on each band keeps it under on their union, and so do the p10/p90 percentiles. So the planner passes a slide only
 * when the rendered check, which measures with the same `colorContrast`, will.
 */
export function contrastBands(geo: Geometry, origin: { x: number; y: number }): Rect[][] {
  return geo.items.map((g) => {
    const x = g.rect.x + origin.x;
    const y = g.rect.y + origin.y;
    if (g.family === 'hand') return [{ x, y, w: g.rect.w, h: g.rect.h }];
    const lineH = g.fontPx * g.lineHeight;
    const w = Math.max(1, Math.min(g.rect.w, g.inkW));
    return Array.from({ length: Math.max(1, g.lines) }, (_, i) => ({ x, y: y + i * lineH, w, h: lineH }));
  });
}

/** Cover: the y nearest the centre where no line of the block touches a face's clear zone, or null. */
export function coverOffset(geo: Geometry, x: number, faces: Rect[], margin: number): number | null {
  const y0 = Math.round((CANVAS_H - geo.height) / 2);
  const zones = faces.map(faceZone);
  const clear = (y: number) => placeRects(geo, { x, y }).every((r) => !zones.some((z) => rectsOverlap(r, z)));
  let best: number | null = null;
  for (let y = margin; y <= CANVAS_H - margin - geo.height; y += 5) {
    if (clear(y) && (best === null || Math.abs(y - y0) < Math.abs(best - y0))) best = y;
  }
  return best;
}

// ── the planner ─────────────────────────────────────────────────────────────

/** The seed recorded on the layout: from the input, else the photo id, kind and headline. */
export function slideSeed(input: SlideInput): string {
  return String(input.seed ?? `${input.photoId ?? 'photo'}:${input.kind}:${(input.headline ?? '').slice(0, 24)}`);
}

function darkenSteps(cap: number): number[] {
  const out: number[] = [];
  const top = Math.max(0, cap);
  for (let d = Math.min(DARKEN_FLOOR, top); d < top - 1e-9; d += DARKEN_STEP) out.push(Math.round(d * 1000) / 1000);
  out.push(Math.round(top * 1000) / 1000);
  return [...new Set(out)];
}

export async function planSlide(input: SlideInput, deps: PlannerDeps = {}): Promise<SlideLayout> {
  const seed = slideSeed(input);
  const margin = deps.margin ?? DEFAULT_MARGIN;
  const cap = deps.darkenCap ?? FIELD_NOTES_DEFAULT_SETTINGS.darkenCap;
  const problems: FitProblem[] = textProblems(input);
  const notes: string[] = [];
  const items = itemsFor(input);

  const base = deps.prepared ?? (await preparePhoto(await sharp(input.photo).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 95 }).toBuffer()));
  const faces = deps.detectFaces ? await deps.detectFaces(base.jpeg) : [];
  const noFace = input.kind === 'cover' && faces.length === 0;

  let placementFailed = false;
  let failReason: PlacementFailReason | undefined;
  const fail = (reason: PlacementFailReason) => { if (!placementFailed) { placementFailed = true; failReason = reason; } };
  if (noFace) {
    fail(COVER_NO_FACE);
    problems.push({ kind: 'cover_no_face', slide: 0, message: `${COVER_NO_FACE}: no face was detected in the cover photo; the cover needs a photo of our faces, swap it for a people photo` });
  }

  // Size: the largest step of the ladder that fits (a cover steps down further only to clear the faces).
  let { geo, tooLong } = pickSizes(input.kind, items, margin);
  if (tooLong) problems.push({ kind: 'too_long', slide: 0, message: `the text needs ${geo.height}px at the minimum type size${geo.fits ? '' : ' and a word is wider than the block'}; it does not fit between the ${margin}px margins` });

  let x = Math.round((CANVAS_W - geo.width) / 2);
  let y = Math.round((CANVAS_H - geo.height) / 2);
  let shiftY = 0;
  const isLarge = (g: GeoItem) => g.family !== 'body' && (g.family === 'hand' || isLargeType(g.fontPx));
  // The readability check at one spot: every line band of every block, darkened uniformly (the bands sit inside the
  // overlay's full-strength core), through the same colorContrast the rendered check uses.
  const bandSamples = (oy: number) => contrastBands(geo, { x, y: oy }).map((bands, i) => ({
    bands: bands.map((r) => sampleRegion(base.raw, expandRect(r, SAMPLE_PAD))),
    large: isLarge(geo.items[i]!),
  }));
  const readAt = (blocks: ReturnType<typeof bandSamples>, d: number) => {
    const cs = blocks.flatMap(({ bands, large }) => bands.map((s) => colorContrast(lumStats(darkenSamples(s, d)), 1, large)));
    return { ok: cs.every((c) => c.ok), contrast: Math.min(...cs.map((c) => c.mean)) };
  };
  if (input.kind === 'tip') {
    const t = tipOffset(await analyzeCanvas(base.raw), geo, x, faces, margin);
    y = t.y;
    shiftY = t.shiftY;
    if (shiftY) notes.push(`the centre is busier (${t.centre.toFixed(2)}) than ${shiftY < 0 ? 'above' : 'below'} it (${t.best.toFixed(2)}); the block moved ${Math.abs(shiftY)}px`);
    // Unreadable here even at the cap: the nearest spot inside the 15% band that reads at the cap, if any (otherwise
    // the slide fails below with the photo-swap reason).
    if (!readAt(bandSamples(y), cap).ok) {
      const y0 = Math.round((CANVAS_H - geo.height) / 2);
      const spot = tipShiftCandidates(geo, y, margin).find((cy) => cy !== y && readAt(bandSamples(cy), cap).ok);
      if (spot !== undefined) {
        notes.push(`white text did not read at ${y - y0 >= 0 ? '+' : ''}${y - y0}px even at the darken cap ${cap}; the block moved to ${spot - y0 >= 0 ? '+' : ''}${spot - y0}px, where it does`);
        y = spot;
        shiftY = spot - y0;
      }
    }
  } else if (input.kind === 'cover' && faces.length) {
    let found: number | null = null;
    for (const sizes of SIZE_LADDERS.cover) {
      const g = stackGeometry('cover', items, sizes);
      if (!g.fits) continue;
      const gx = Math.round((CANVAS_W - g.width) / 2);
      found = coverOffset(g, gx, faces, margin);
      if (found !== null) { geo = g; x = gx; y = found; break; }
    }
    if (found === null) {
      fail('no_calm_region');
      problems.push({ kind: 'no_calm_region', slide: 0, message: 'no room above or below the faces for the cover text at its minimum size; swap the photo' });
    }
  }

  const rects = placeRects(geo, { x, y });

  // No logo on any slide, the Follow slide included (Tommy, 2026-11-06: "drop it").
  const logo: LogoPlacement | null = null;

  // Contrast: raise the overlay from the floor in steps until every line band of every block reads in white (see
  // contrastBands: the same measure as the rendered check, on every run of lines it could measure). The body paragraph
  // is held to the normal-text ratio (4.5:1) whatever its size: it is read, not glanced at. Busy texture behind the
  // text is a soft target: the overlay keeps rising (to the cap at most) until the texture under each block is calm
  // enough, but texture alone never fails a slide.
  const blocksAt = bandSamples(y);
  const textures = geo.items.map((_, i) => grayStd(sampleRegion(base.raw, expandRect(rects[i]!, SAMPLE_PAD))));
  const steps: DarkenStep[] = [];
  for (const d of darkenSteps(cap)) {
    const { ok, contrast } = readAt(blocksAt, d);
    const calm = textures.every((t) => t * (1 - d) <= TEXTURE_STD);
    steps.push({ darken: d, contrast, ok, calm });
    if (ok && calm) break;
  }
  const last = steps[steps.length - 1]!;
  if (!last.ok) {
    fail('no_calm_region');
    problems.push({ kind: 'no_calm_region', slide: 0, message: `white text is unreadable on this photo even darkened to the cap ${cap} (weakest contrast ${last.contrast.toFixed(2)}); swap the photo` });
  }
  // Near faces the full-strength core and the fade are cut short so the darkening stops before it reaches them.
  const ink = unionRect(rects.length ? rects : [{ x, y, w: geo.width, h: geo.height }]);
  const faceGap = faces.length ? Math.min(...faces.map((f) => gapBetween(ink, f))) : Infinity;
  const pad = Math.max(SAMPLE_PAD + 2, Math.min(CORE_PAD, faceGap * 0.3));
  const zone: DarkenZone = { core: expandRect(ink, pad), feather: Math.min(FEATHER_PX, Math.max(40, faceGap - pad)) };
  const photo = await darkenPhoto(base, zone, last.darken);

  const blocks: PlacedBlock[] = geo.items.map((g, index) => ({
    index, role: g.item.role, text: g.item.text, region: rects[index]!, fill: 'white', darken: last.darken,
    fontPx: g.fontPx, family: g.family, color: WHITE_HEX, large: g.family !== 'body' && (g.family === 'hand' || isLargeType(g.fontPx)),
    trackingEm: g.trackingEm, lineHeight: g.lineHeight, lines: g.lines, inkW: g.inkW,
  }));

  return {
    kind: input.kind, photoId: input.photoId ?? '', photo, basePhoto: base, faces, blocks, logo,
    darken: { ...zone, value: last.darken, cap, steps }, shiftY, margin, seed,
    placementFailed, ...(failReason ? { failReason } : {}), problems, notes,
  };
}

/** Gray-level standard deviation (0-255) of packed RGB samples. */
export function grayStd(samples: Uint8Array): number {
  const n = Math.floor(samples.length / 3);
  if (!n) return 0;
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const v = 0.299 * samples[i * 3]! + 0.587 * samples[i * 3 + 1]! + 0.114 * samples[i * 3 + 2]!;
    s += v;
    s2 += v * v;
  }
  const m = s / n;
  return Math.sqrt(Math.max(0, s2 / n - m * m));
}

/** Shortest distance between two rects (0 when they touch or overlap). */
function gapBetween(a: Rect, b: Rect): number {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
  return Math.hypot(dx, dy);
}
