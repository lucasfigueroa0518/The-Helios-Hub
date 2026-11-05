// The stage's solver (iterations 9 and 10): the model says what the shot is; this says where everything goes. Position,
// size and depth are arithmetic on measured pictures (lib/reel-ai-drama/harvest/regions.ts), so a composition is right by
// construction and needs no fixing later. Pure: no DOM, no clock, no randomness but a seed made from the cast. Node tests
// and the frame's build() run the same code.
//
//   solveStage(moment)   → { pieces, labels, marks, speech, hook, arrows, ledge, report }: every piece's one place
//   solveTimeline(spec)  → { moments, z, labelTimes, camera, report, … }: that one layout through time
//
// The final layout comes first and it is the only layout: each piece has one spot for its whole life, and pieces that are
// never on screen together may share room. Arrivals don't reshuffle anything; the camera reveals what's there.
//
// What holds, by construction (ITERATION-9.md, ITERATION-10-CONTRACT.md §2):
//   I1  every piece has a keep. No other piece and no text covers more than keepMax of a keep.
//   I2  depth is derived: a piece whose body would cover another's keep goes behind it.
//   I3  every head is whole in the frame and clear of the caption band.
//   I4  a label sits by its owner and lands no earlier than its owner. Different owners never stack.
//   I5  through time nobody crosses a keep (nothing moves but the camera, and one limited `slide`).
//   I6  no room: shrink evenly, then allow more body overlap, then report `stage_tight`. It always returns a layout.
//   I7  an open edge of a cutout is off the frame or behind the ledge, a torn band across the frame's foot. Nothing fades.
//   I8  pieces hold their final spots from arrival.
//   I9  a camera aim and every marked phrase stay inside the frame through every move: the camera is a window that only
//       crops the stage, and it moves in straight lines between poses that each contain what they must.
//   I10 a wide picture that can't fill the frame without cutting its keep becomes a print.
//   I11 a fill's or a background's keep counts as a keep.
//   I12 words in a picture sit below the caption band at rest, and an aim's words do in every pose.
//   I13 a head has a maximum as well as a minimum, and people in a frame stay within a set ratio (lead_inset excepted).
//   I14 the usable area is filled: pieces take the room there is, and a lone small piece gets the camera on it.
//   I15 nothing is drawn wider than sharp_width_px, camera included.
//   I16 only trusted faces are heads, and the biggest face is never assumed to be the head.
//   I17 labels live for a beat, or until the next person arrives; names sit in clear space, never on a chest; words about
//       the frame take a free band, never a person.
//   I18 marks clear hair and plates; plates never sit on a head, face or chin, and stay inside the frame.
//   I19 one credit per picture on screen, and a picture isn't repeated within a stage.
//   I20 people in a frame are matched in tone, with one outline and no glow.
//
// Variety comes from the words the frame gives (arrangement, style, side) and from a seed.

import { arrowBetween } from './geometry.js';
import { EXPRESSIONS, crossesHead, expressionBounds, headOf } from './settings/index.js';
import { isPage } from './components/style.js';

export const STAGE = {
  W: 1080,
  H: 1920,
  /** Nothing that matters above this: the caption band's keep-out ends at 560. */
  top: 600,
  /** Nothing readable below this: the platform's UI. */
  bottom: 1500,
  /** The overlay zone's sides: where words may go. */
  words: { x0: 96, x1: 940 },
  /** A face's centre stays between these. A bust stands low only as far as its body needs to reach the ledge. */
  faceBand: [720, 1200],
  /** The subject line (kit/FRAME.md): where a face belongs. A body runs off the foot only when it can from here. */
  subject: [800, 1100],
  /** No more than this share of a keep may be covered. */
  keepMax: 0.05,
};
/** The whiteboard's writable area, inside its frame. */
export const WHITEBOARD_BOUNDS = { x0: 96, x1: 984, y0: 620, y1: 1500 };
/** How long a camera or a `slide` takes by default, seconds. */
export const SLIDE = 0.55;
/** The measured limits of the frame's composition: tests and the screen check read these. */
export const LIMITS = {
  /** A head's height at rest, px. */
  headMax: 540,
  headMin: 150,
  insetMin: 105,
  /** A head through any camera, px. */
  headOnScreen: 680,
  /** The largest head over the smallest, in one frame, outside lead_inset. */
  headRatio: 1.4,
  /** The same in lead_inset: a deliberate difference, not a giant beside a thumbnail. */
  insetRatio: 1.8,
  /** How much of a neck shows over the ledge: it never sits on a chin. */
  neck: 24,
  /** An arrow's length between the real items, px. */
  arrowMin: 170,
  /** A slide's distance, px. */
  slideMax: 150,
  /** The ledge never rises above this. */
  ledgeTop: 1290,
  /** How far a camera may zoom to reveal what's on so far; how far an aim may. */
  revealZoom: 2.2,
  aimZoom: 2.6,
  /** A label's life, seconds. */
  labelBeat: 2.4,
  labelRead: 1.1,
  dateBeat: 3.2,
  /** The hook words are up by this. */
  hookBy: 1.2,
  /** A plain moment's content covers at least this much of the usable area, or spans at least this much of it. */
  fillShare: 0.3,
  fillSpan: 0.8,
};
/** Shrinking, evenly: every size in the shot times these, largest first. */
const SHRINK = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.44];
/** 0: bodies are obstacles. 1: only keeps are; a loose piece may lie over a body. */
const LEVELS = [0, 1];
/** Head height of a person on the stage, px at full size, by the number of people at once. */
const HEAD_PX = { 1: 470, 2: 400, 3: 330, 4: 270, 5: 225 };
const INSET_HEAD = 0.65;
/** An inset standing in a row of people keeps most of their size: it takes a column of its own. */
const COLUMN_INSET_HEAD = 0.9;
const LEAD_HEAD = 1.12;
/** Loose pieces keep this far off the frame's sides. */
const EDGE = 30;
const GAP = 22;
/** A label or plate this far from what it clears. */
const WORD_GAP = 14;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const LAYER_RANK = { fill: 0, print: 1, card: 1, custom: 2, words: 2, drawing: 2, person: 2, thing: 3, logo: 4, note: 5 };
const TEXT_KINDS = new Set(['headline', 'page', 'document', 'post', 'article', 'screenshot']);
const DRAWN_KINDS = new Set(['sketch', 'drawing', 'expression', 'collage', 'setting']);
const okBox = (b) => Boolean(b) && [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0;
const isBig = (q) => ['print', 'card', 'drawing', 'thing', 'words', 'custom'].includes(q.kind);
const unionOf = (list) => {
  const x0 = Math.min(...list.map((b) => b.x)), y0 = Math.min(...list.map((b) => b.y));
  const x1 = Math.max(...list.map((b) => b.x + b.w)), y1 = Math.max(...list.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
/** Whether two things with lifetimes are ever on screen together. */
export const together = (a, b) => (a.at ?? 0) < (b.until ?? Infinity) - 1e-3 && (b.at ?? 0) < (a.until ?? Infinity) - 1e-3;

/** A small seeded generator (LCG), one per solve, so a cast always lands the same way. */
function seeded(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
export function hashString(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

// ── Measured pictures ────────────────────────────────────────────────────────────────────────────────

const parsed = new Map();
/** A grid `{ w, h, cells }` as bytes (shape: 1 opaque; tone: 0–15, 255 transparent). Null when absent. */
export function gridOf(g, tone = false) {
  if (!g?.cells || !(g.w > 0) || !(g.h > 0)) return null;
  const key = `${tone ? 't' : 's'}${g.w}x${g.h}:${g.cells}`;
  let cells = parsed.get(key);
  if (!cells) {
    cells = new Uint8Array(g.w * g.h);
    for (let i = 0; i < cells.length; i++) {
      const c = g.cells[i];
      cells[i] = tone ? (c === '.' || c === undefined ? 255 : parseInt(c, 16)) : c === '1' ? 1 : 0;
    }
    if (parsed.size > 2000) parsed.clear();
    parsed.set(key, cells);
  }
  return { w: g.w, h: g.h, cells };
}
const atGrid = (g, u, v) => g.cells[Math.min(g.h - 1, Math.max(0, Math.floor(v * g.h))) * g.w + Math.min(g.w - 1, Math.max(0, Math.floor(u * g.w)))];

/** Mean luminance (0–1) of a picture's tone grid over a 0–1 box, opaque cells only; null when it has none. Pure. */
export function toneIn(regions, box = { x: 0, y: 0, w: 1, h: 1 }) {
  const g = gridOf(regions?.tone, true);
  if (!g) return null;
  let sum = 0, n = 0;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const u = (x + 0.5) / g.w, v = (y + 0.5) / g.h;
      if (u < box.x || u > box.x + box.w || v < box.y || v > box.y + box.h) continue;
      const c = g.cells[y * g.w + x];
      if (c === 255) continue;
      sum += c / 15;
      n += 1;
    }
  }
  return n ? sum / n : null;
}

/** Whether a picture really is transparent around its subject: measured when it can be, else its flags. */
export function isCut(media) {
  const g = gridOf(media?.regions?.shape);
  if (g) {
    let empty = 0;
    for (let i = 0; i < g.cells.length; i++) if (!g.cells[i]) empty += 1;
    return empty / g.cells.length > 0.06;
  }
  return Boolean(media?.flags?.includes?.('cutout') || media?.flags?.includes?.('transparent'));
}

/** What a picture is on a stage: person | thing | logo | card | print | drawing. Pure. */
export function pieceKind(media) {
  if (!media) return 'print';
  if (media.made || DRAWN_KINDS.has(media.made_kind)) return 'drawing';
  if (media.kind === 'logo' || media.flags?.includes?.('logo')) return 'logo';
  if (isCut(media)) return facesOf(media).length || (media.people ?? []).filter(Boolean).length ? 'person' : 'thing';
  if (TEXT_KINDS.has(media.kind)) return 'card';
  return 'print';
}

/** A face the detector barely believes, when a much surer one is on the picture, is a false alarm. */
const WEAK_FACE = 0.6;
const SURE_FACE = 0.8;
/**
 * The faces that may be heads (I16). When the harvest graded them (`trusted`), only the trusted; on an older inventory, a
 * named face or a confident one, and a weak one only when nothing surer is on the picture.
 */
export function facesOf(media) {
  const list = (Array.isArray(media?.regions?.faces) && media.regions.faces.length ? media.regions.faces : media?.face ? [media.face] : []).filter(okBox);
  if (list.some((f) => 'trusted' in f)) return list.filter((f) => f.trusted);
  const named = (media?.people ?? []).filter(Boolean).length > 0;
  const surest = Math.max(0, ...list.map((f) => (Number.isFinite(f.score) ? f.score : 0)));
  return list.filter((f) => (f.name ? true : surest >= SURE_FACE ? !(f.score < WEAK_FACE) : named || !(f.score < WEAK_FACE)));
}
/** The main head on a picture: its named person's, else the surest, else the highest. Never the biggest (I16). */
export function mainFace(faces, media = null) {
  if (!faces?.length) return null;
  const want = (media?.people ?? []).filter(Boolean);
  const hit = faces.find((f) => f.name && want.some((n) => String(n).toLowerCase() === String(f.name).toLowerCase()));
  if (hit) return hit;
  return [...faces].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.y - b.y)[0];
}

/** A person's head in 0–1 of the image: the face box, its crown and sides found on the silhouette when the picture is cut, hair included. Pure. */
export function headIn(media, face, aspect = (media?.width > 0 && media?.height > 0 ? media.width / media.height : 1)) {
  const est = headOf(face);
  const g = gridOf(media?.regions?.shape);
  if (!g || !isCut(media)) return { x: est.x, y: Math.max(0, est.y), w: est.w, h: est.y + est.h - Math.max(0, est.y) };
  // Up the middle of the face until the silhouette ends: that is the crown.
  const u = face.x + face.w / 2;
  const limit = Math.max(0, face.y - face.h * 1.1);
  let crown = face.y;
  for (let v = face.y; v >= limit; v -= 1 / g.h / 2) {
    let hit = false;
    for (const du of [-0.25, 0, 0.25]) if (atGrid(g, u + du * face.w, v)) hit = true;
    if (!hit) break;
    crown = v;
  }
  void aspect;
  const y = Math.max(0, Math.min(crown, face.y - face.h * 0.2));
  // Across the head's upper half until the silhouette ends: that is the hair.
  let x0 = est.x, x1 = est.x + est.w;
  const limX = face.w * 0.6;
  for (let v = y; v <= face.y + face.h * 0.4; v += 1 / g.h / 2) {
    let a = u, b = u;
    while (a > 0 && a > face.x - limX && atGrid(g, a - 1 / g.w, v)) a -= 1 / g.w / 2;
    while (b < 1 && b < face.x + face.w + limX && atGrid(g, b + 1 / g.w, v)) b += 1 / g.w / 2;
    if (a < x0) x0 = a;
    if (b > x1) x1 = b;
  }
  return { x: x0, y, w: x1 - x0, h: face.y + face.h - y };
}

const visibleOf = (media) => (okBox(media?.regions?.visible) ? media.regions.visible : { x: 0, y: 0, w: 1, h: 1 });
/** The picture's measured words, 0–1 of the image: [{ text, box }]. */
export function wordsOf(media) {
  const r = media?.regions ?? {};
  const W = media?.width, H = media?.height;
  let words = (Array.isArray(r.words) ? r.words : []).filter((w) => okBox(w?.box)).map((w) => ({ text: String(w.text ?? ''), box: w.box }));
  if (!words.length && Array.isArray(media?.boxes) && W > 0 && H > 0) {
    words = media.boxes.filter(okBox).map((b) => ({ text: String(b.text ?? ''), box: { x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H } }));
  }
  return words;
}
const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9$%.]+/g, ' ').replace(/(?<!\d)\.|\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter(Boolean);
const surnameOf = (s) => norm(s).split(' ').at(-1) ?? '';
/** What OCR confuses reads as one: AI and Al, O and 0. */
const looseWord = (t) => String(t).replace(/[il1|]/g, 'l').replace(/0/g, 'o');
/** Boxes on one line merged into one box each, top to bottom. */
function intoLines(boxes) {
  const out = [];
  for (const b of [...boxes].sort((a, c) => a.y - c.y || a.x - c.x)) {
    const hit = out.find((l) => Math.abs((l.y + l.h / 2) - (b.y + b.h / 2)) < 0.5 * Math.max(l.h, b.h));
    if (!hit) { out.push({ ...b }); continue; }
    Object.assign(hit, unionOf([hit, b]));
  }
  return out;
}
/**
 * A phrase on a picture's OCR words, line by line: one box per line it runs over, top to bottom (the last word may be cut
 * short: "regul" finds "regulators"). Where the phrase is part of a longer box, its share of that box is estimated from the
 * letters, so a mark stays the phrase's size. Empty when absent. Pure.
 */
export function phraseLines(media, phrase) {
  const words = wordsOf(media);
  const want = tokens(phrase);
  if (!want.length || !words.length) return [];
  const toks = [];
  words.forEach((w, i) => tokens(w.text).forEach((t, j) => toks.push({ t, i, j })));
  for (let s = 0; s < toks.length; s++) {
    let k = 0;
    while (k < want.length && s + k < toks.length) {
      const tk = toks[s + k].t;
      const a = looseWord(tk), b = looseWord(want[k]);
      const ok = a === b || (k === want.length - 1 && a.startsWith(b)) || (k === 0 && want.length > 1 && a.endsWith(b));
      if (!ok) break;
      k += 1;
    }
    if (k < want.length) continue;
    const hit = toks.slice(s, s + k);
    const len = (list) => list.reduce((n, t) => n + t.length, 0) + Math.max(0, list.length - 1);
    const boxes = [...new Set(hit.map((x) => x.i))].map((i) => {
      const w = words[i];
      const all = tokens(w.text);
      const mine = hit.filter((x) => x.i === i);
      if (all.length <= mine.length) return w.box;
      const total = len(all) || 1;
      const before = len(all.slice(0, mine[0].j)) + (mine[0].j > 0 ? 1 : 0);
      const span = len(all.slice(mine[0].j, mine[0].j + mine.length));
      return { x: w.box.x + (w.box.w * before) / total, y: w.box.y, w: (w.box.w * span) / total, h: w.box.h };
    });
    return intoLines(boxes);
  }
  return [];
}
/** The tallest line of words a picture shows, as a phrase: what a mark on it goes to when the words it was asked for aren't there. Null without words. Pure. */
export function headlinePhrase(media) {
  const words = wordsOf(media);
  if (!words.length) return null;
  const lines = [];
  for (const w of [...words].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    const line = lines.find((l) => Math.abs((l.y + l.h / 2) - (w.box.y + w.box.h / 2)) < 0.5 * Math.max(l.h, w.box.h));
    if (line) { line.words.push(w); line.h = Math.max(line.h, w.box.h); } else lines.push({ y: w.box.y, h: w.box.h, words: [w] });
  }
  const best = lines.reduce((a, b) => (b.h > a.h ? b : a));
  return best.words.sort((a, b) => a.box.x - b.box.x).map((w) => w.text).join(' ');
}
/** Word boxes on the line of `box`: what must stay whole when a camera reads it (a phrase's line, not the phrase). */
export function lineAround(media, box) {
  const words = wordsOf(media).map((w) => w.box);
  const same = words.filter((b) => Math.abs((b.y + b.h / 2) - (box.y + box.h / 2)) < 0.6 * Math.max(b.h, box.h));
  return same.length ? unionOf([...same, box]) : box;
}

/**
 * A picture's keep, 0–1 of the image: what must stay visible. Pure.
 * person: head and upper shoulders; logo, thing, drawing: the whole visible box; card: its words or face; print: the
 * heads in it, else its middle.
 */
export function keepOf(media, kind = pieceKind(media)) {
  const vis = visibleOf(media);
  const faces = facesOf(media);
  if (kind === 'person') {
    const f = mainFace(faces, media);
    if (!f) return { x: vis.x + vis.w * 0.15, y: vis.y, w: vis.w * 0.7, h: vis.h * 0.42 };
    const head = headIn(media, f);
    const x0 = Math.max(vis.x, Math.min(head.x, f.x - f.w * 0.3)), x1 = Math.min(vis.x + vis.w, Math.max(head.x + head.w, f.x + f.w * 1.3));
    const y1 = Math.min(vis.y + vis.h, f.y + f.h * 1.28);
    return { x: x0, y: head.y, w: Math.max(0.01, x1 - x0), h: Math.max(0.01, y1 - head.y) };
  }
  if (kind === 'card') {
    const boxes = [...wordsOf(media).map((w) => w.box), ...faces];
    return boxes.length ? unionOf(boxes) : vis;
  }
  if (kind === 'print') {
    if (faces.length) {
      const heads = faces.map((f) => headIn(media, f));
      const u = unionOf(heads);
      return { x: Math.max(0, u.x), y: Math.max(0, u.y), w: Math.min(1, u.x + u.w) - Math.max(0, u.x), h: Math.min(1, u.y + u.h) - Math.max(0, u.y) };
    }
    return { x: 0.15, y: 0.15, w: 0.7, h: 0.7 };
  }
  return vis;
}

/** What a whole-frame picture must not lose (I10, I11): its trusted heads and its words. Null when nothing was measured. */
export function subjectOf(media) {
  const heads = facesOf(media).map((f) => headIn(media, f));
  const words = wordsOf(media).map((w) => w.box);
  const boxes = [...heads, ...words];
  if (!boxes.length) return null;
  const u = unionOf(boxes);
  return { x: Math.max(0, u.x), y: Math.max(0, u.y), w: Math.min(1, u.x + u.w) - Math.max(0, u.x), h: Math.min(1, u.y + u.h) - Math.max(0, u.y) };
}

/** Sample points over a keep, on the piece's own silhouette only. */
function keepPoints(keep, shape, n = 7) {
  const pts = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = keep.x + (keep.w * (i + 0.5)) / n, v = keep.y + (keep.h * (j + 0.5)) / n;
      if (!shape || atGrid(shape, u, v)) pts.push([u, v]);
    }
  }
  return pts.length >= 4 ? pts : Array.from({ length: n * n }, (_, k) => [keep.x + (keep.w * ((k % n) + 0.5)) / n, keep.y + (keep.h * (Math.floor(k / n) + 0.5)) / n]);
}

/** A picture's measures seen through a crop (0–1 of the image), for a piece showing part of it. */
function croppedMedia(media, c) {
  const rel = (b) => ({ ...b, x: (b.x - c.x) / c.w, y: (b.y - c.y) / c.h, w: b.w / c.w, h: b.h / c.h });
  const inside = (b) => b.x + b.w > c.x + 0.01 && b.x < c.x + c.w - 0.01 && b.y + b.h > c.y + 0.01 && b.y < c.y + c.h - 0.01;
  const r = media.regions ?? {};
  const regions = { ...r };
  if (Array.isArray(r.faces)) regions.faces = r.faces.filter(inside).map(rel);
  if (Array.isArray(r.words)) regions.words = r.words.filter((w) => inside(w.box)).map((w) => ({ ...w, box: rel(w.box) }));
  if (Array.isArray(r.photos)) regions.photos = r.photos.filter(inside).map(rel);
  if (okBox(r.visible)) {
    const x0 = Math.max(r.visible.x, c.x), y0 = Math.max(r.visible.y, c.y), x1 = Math.min(r.visible.x + r.visible.w, c.x + c.w), y1 = Math.min(r.visible.y + r.visible.h, c.y + c.h);
    regions.visible = x1 > x0 && y1 > y0 ? rel({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }) : { x: 0, y: 0, w: 1, h: 1 };
  }
  const resample = (g, tone) => {
    const src = gridOf(g, tone);
    if (!src) return g;
    let cells = '';
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const v = atGrid(src, c.x + c.w * ((x + 0.5) / src.w), c.y + c.h * ((y + 0.5) / src.h));
        cells += tone ? (v === 255 ? '.' : v.toString(16)) : v ? '1' : '0';
      }
    }
    return { w: src.w, h: src.h, cells };
  };
  if (r.shape) regions.shape = resample(r.shape, false);
  if (r.tone) regions.tone = resample(r.tone, true);
  return { ...media, width: media.width * c.w, height: media.height * c.h, face: null, boxes: undefined, regions };
}

/**
 * Where a cut stops at its image's border (I7): for each side, the span along that side where the picture runs into it, or
 * null. From the harvest's `open_edges` when it was measured, and the silhouette says how far. Pure.
 */
export function openEdgesOf(media, shape, vis) {
  const said = media?.regions?.open_edges ?? media?.open_edges ?? null;
  const span = (side) => {
    if (!shape) return null;
    const along = side === 'left' || side === 'right' ? shape.h : shape.w;
    let a = -1, b = -1, n = 0;
    for (let i = 0; i < along; i++) {
      const hit = side === 'left' ? shape.cells[i * shape.w] : side === 'right' ? shape.cells[i * shape.w + shape.w - 1] : side === 'top' ? shape.cells[i] : shape.cells[(shape.h - 1) * shape.w + i];
      if (hit) { if (a < 0) a = i; b = i; n += 1; }
    }
    return n >= 2 ? [a / along, (b + 1) / along] : null;
  };
  const out = {};
  for (const side of ['left', 'right', 'top', 'bottom']) {
    const measured = span(side);
    if (said && said[side] === false) out[side] = null;
    else if (said && said[side] === true) out[side] = measured ?? (side === 'left' || side === 'right' ? [Math.max(vis.y, 0.5), vis.y + vis.h] : [vis.x, vis.x + vis.w]);
    else out[side] = said ? null : measured;
  }
  // A body cut straight inside its picture has a foot as open as the picture's border: it doesn't end, it stops.
  if (!out.bottom && shape && (media?.regions?.cut?.straight_cuts ?? 0) >= STRAIGHT_CUT && (media?.people ?? []).length) {
    for (let y = shape.h - 1; y >= 0; y--) {
      let a = -1, b = -1;
      for (let x = 0; x < shape.w; x++) if (shape.cells[y * shape.w + x]) { if (a < 0) a = x; b = x; }
      if (a < 0) continue;
      if ((b + 1 - a) / shape.w >= vis.w * 0.3) { out.bottom = [a / shape.w, (b + 1) / shape.w]; out.foot = (y + 1) / shape.h; }
      break;
    }
  }
  return out;
}
/** How far along its picture a cut body's open foot is: its border, or where a straight cut stops it. */
export const footOf = (open) => open?.foot ?? 1;

/** How much of a cut's edge runs straight before it counts as a cut body, not an outline. */
const STRAIGHT_CUT = 0.05;

/** Pragmatica's and the hand's widths, estimated generously so a box never overruns: em per letter. */
const WIDE_EM = 0.68;
const HAND_EM = 0.5;
/** A note's type by role: its size, and how far the room may take it. */
const NOTE_ROLES = { figure: { font: 150, max: 220, min: 92 }, place: { font: 88, max: 118, min: 58 }, date: { font: 76, max: 116, min: 52 }, body: { font: 60, max: 76, min: 42 } };
/** A note's lines and size at its role's type. Pure. */
export function noteBox(text, role = 'body') {
  const r = NOTE_ROLES[role] ?? NOTE_ROLES.body;
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const chars = words.join(' ').length;
  const perLine = role === 'figure' ? 14 : role === 'body' ? 22 : 18;
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur.length + 1 + w.length) > Math.max(perLine, Math.ceil(chars / Math.max(1, Math.ceil(chars / perLine))))) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return { role: NOTE_ROLES[role] ? role : 'body', font: r.font, max: r.max, min: r.min, lines, w: longest * r.font * HAND_EM + 16, h: lines.length * r.font * 1.12 + 10 };
}

/** The kind a treatment is on a stage. */
const TREATMENT_KIND = { page: 'card', post: 'card', document: 'card', headline: 'card', newspaper: 'card', board: 'card', lift: 'card', map: 'print', photo: 'print', number: 'words', stat: 'words', lower_third: 'words', flash_reveal: 'fill', phone_shot: 'fill', click_reveal: 'fill', burst: 'fill', pull_quote: 'fill' };
/** A treatment with no picture of its own: how wide for how tall. Stage.js passes `aspect` when it knows better. */
function treatmentAspect(p) {
  const o = p.opts ?? {};
  if (p.treatment === 'number') { const v = String(o.value ?? '').length || 1, l = String(o.label ?? '').length; return Math.max(v * 118 * 0.74, l * 34) / (118 * 1.05 + (o.label ? 74 : 0) + 36); }
  if (p.treatment === 'lower_third') return (Math.max(String(o.name ?? '').length * 46, String(o.role ?? '').length * 24) + 48) / (o.role ? 150 : 110);
  if (p.treatment === 'stat') return (o.kind === 'bar' || o.kind === 'scale') ? 1.05 : 1.35;
  if (p.treatment === 'headline') return 2;
  if (p.treatment === 'map') return 1.15;
  if (p.treatment === 'board' || p.treatment === 'newspaper') return 0.8;
  return 1.3;
}

/**
 * A frame's piece, ready to solve: its id, role and timing with what was measured. `media` is its inventory record; a
 * piece may instead carry `kind`, `aspect` and `regions` directly (tests). Also: treatment, opts, fill, onto, custom,
 * note + note_role, crop.
 */
/** A word line has to clear the picture's own edge by this for its letters to be whole. */
const EDGE_TOUCH = 0.004;
/** The most of a picture worth giving up to lose a line its own edge cuts. */
const EDGE_CROP_MOST = 0.2;
/**
 * The crop that takes off a line of words the picture's own top or bottom edge cuts through: half a sentence is never part
 * of what it shows. Null when no measured word touches either edge. Pure.
 */
export function edgeCutCrop(media) {
  if (media?.regions?.cut || media?.kind === 'logo') return null;
  const words = wordsOf(media).map((w) => w.box);
  if (!words.length) return null;
  let y0 = 0, y1 = 1;
  // The harvest saw letters running off the edge over a line of words: that block is broken, whatever it read of it.
  const cutAt = media?.regions?.edge_cut;
  if (Number.isFinite(cutAt?.top) && cutAt.top <= EDGE_CROP_MOST) y0 = cutAt.top;
  if (Number.isFinite(cutAt?.bottom) && 1 - cutAt.bottom <= EDGE_CROP_MOST) y1 = cutAt.bottom;
  for (const b of words) {
    if (b.y <= EDGE_TOUCH && b.h <= EDGE_CROP_MOST) y0 = Math.max(y0, b.y + b.h + 0.01);
    if (b.y + b.h >= 1 - EDGE_TOUCH && b.h <= EDGE_CROP_MOST) y1 = Math.min(y1, b.y - 0.01);
  }
  if (y0 === 0 && y1 === 1) return null;
  return { x: 0, y: y0, w: 1, h: y1 - y0 };
}

/** The most a backdrop's crop is enlarged to lose a picture's words. */
const BACKDROP_BAND = 0.25;
/** The least of a picture over a head worth blowing up to a ground. */
const BACKDROP_SCENE = 0.08;
/**
 * What of a picture a blurred backdrop shows, so no words of its own lie behind the captions: the tallest band of it no
 * measured word touches. `words: true` when it has none tall enough: then the look has to hide them. Pure.
 */
export function backdropBand(media) {
  const widest = (boxes) => {
    let best = { y: 0, h: 0 };
    let from = 0;
    for (const b of [...boxes].sort((p, q) => p.y - q.y)) {
      if (b.y - from > best.h) best = { y: from, h: b.y - from };
      from = Math.max(from, b.y + b.h);
    }
    return 1 - from > best.h ? { y: from, h: 1 - from } : best;
  };
  const words = wordsOf(media).map((w) => w.box);
  // Blurred, a face or the skin under it turns into a ghost behind the caption: a person's picture gives the scene above the head.
  const faces = facesOf(media);
  if (faces.length) {
    const top = Math.min(...faces.map((f) => f.y));
    const scene = widest([...words, { y: top, h: 1 - top }]);
    if (scene.h >= BACKDROP_SCENE) return { y: scene.y, h: scene.h, words: false };
  }
  const wordless = widest(words);
  return wordless.h >= BACKDROP_BAND ? { y: wordless.y, h: wordless.h, words: false } : { y: 0, h: 1, words: true };
}

/**
 * How far a piece may open past its resting size about its own middle and stay on screen and clear of `keeps`, frame px. 1 at
 * the least. Pure.
 */
export function lensRoom(base, keeps = [], room = { x0: 30, x1: STAGE.W - 30, y0: STAGE.top - 40, y1: STAGE.bottom }) {
  const cx = base.x + base.w / 2, cy = base.y + base.h / 2;
  let s = Math.min((cx - room.x0) / (base.w / 2), (room.x1 - cx) / (base.w / 2), (cy - room.y0) / (base.h / 2), (room.y1 - cy) / (base.h / 2));
  for (const k of keeps) {
    // Scaling about the middle, it meets a keep when both axes have reached it; the later axis decides.
    const gx = k.x > cx ? (k.x - cx) / (base.w / 2) : k.x + k.w < cx ? (cx - k.x - k.w) / (base.w / 2) : 0;
    const gy = k.y > cy ? (k.y - cy) / (base.h / 2) : k.y + k.h < cy ? (cy - k.y - k.h) / (base.h / 2) : 0;
    s = Math.min(s, Math.max(gx, gy));
  }
  return Math.max(1, s);
}

/** Whether a lone sheet leaves so much of the usable area bare that the ground reads as a void: under this share it takes a backdrop. */
const BARE_SHARE = 0.62;
/**
 * The print or card on its own that needs its own blurred self behind it (I10, I14): no other picture beside it for its whole
 * life, on a plain dark ground, and a good part of the usable area left bare. Never a page. Pure.
 */
export function bareSheets(moments, prepared, ground) {
  if (ground !== 'charcoal') return [];
  const by = new Map(prepared.map((p) => [p.id, p]));
  const out = new Set();
  const bad = new Set();
  for (const m of moments) {
    const shown = m.pieces.filter((pl) => by.get(pl.id)?.kind !== 'note');
    for (const pl of shown) {
      const p = by.get(pl.id);
      // Blurred, a page is only fog: it keeps the plain ground.
      if (!p || (p.kind !== 'print' && p.kind !== 'card') || facesOf(p.media).length || isPage(p.media)) { bad.add(pl.id); continue; }
      if (shown.length > 1) { bad.add(pl.id); continue; }
      if (fillOf([pl], prepared).share < BARE_SHARE) out.add(pl.id);
    }
  }
  return [...out].filter((id) => !bad.has(id));
}

export function preparePiece(p) {
  if (p.pts) return p;
  const given = p.media ?? { width: p.aspect ?? 1, height: 1, regions: p.regions ?? null, people: p.people ?? [], flags: p.flags ?? [], kind: p.mediaKind ?? null, made: p.made ?? false, made_kind: p.made_kind ?? null };
  const shaved = okBox(p.crop) ? null : edgeCutCrop(given);
  const media = okBox(p.crop) ? croppedMedia(given, p.crop) : shaved ? croppedMedia(given, shaved) : given;
  const treatment = p.treatment ?? null;
  let kind = p.kind ?? (p.custom ? 'custom' : p.note != null ? 'note' : treatment ? (TREATMENT_KIND[treatment] ?? 'card') : p.fill && !isPlaced(p) ? 'fill' : pieceKind(media));
  const note = p.note != null ? noteBox(p.note, p.note_role ?? (NOTE_ROLES[p.role] ? p.role : 'body')) : null;
  let aspect = p.aspect ?? (note ? note.w / note.h : p.custom?.aspect ? p.custom.aspect : p.size ? p.size.w / p.size.h : media.width > 0 && media.height > 0 && (!treatment || p.media) && !(treatment && !p.media) ? media.width / media.height : treatment ? treatmentAspect(p) : 1);
  // A rejected cut is shown as a print (contract §1); so is a cut whose head stops at its image's top: a frame hides that, and nothing else can.
  let shape0 = kind === 'person' || kind === 'thing' ? gridOf(media.regions?.shape) : null;
  const vis0 = kind === 'person' || kind === 'thing' ? visibleOf(media) : { x: 0, y: 0, w: 1, h: 1 };
  let open = kind === 'person' || kind === 'thing' ? openEdgesOf(media, shape0, vis0) : null;
  let asPrint = p.asPrint ?? false;
  if (kind === 'person' || kind === 'thing') {
    if (media.regions?.cut?.grade === 'rejected') asPrint = 'rejected_cut';
    const f = mainFace(facesOf(media), media);
    const hd = f ? headIn(media, f, aspect) : null;
    const spanOf = (e) => (e ? e[1] - e[0] : 0);
    if (spanOf(open?.top) >= (hd ? hd.w : vis0.w * 0.45) * 0.55) asPrint = asPrint || 'cut_at_top';
    if (kind === 'thing' && Math.max(spanOf(open?.left), spanOf(open?.right), spanOf(open?.bottom), spanOf(open?.top)) >= 0.18) asPrint = asPrint || 'cut_at_side';
  }
  if (asPrint) { kind = 'print'; shape0 = null; open = null; }
  // A logo is its visible box: its empty margin isn't part of it, and it stays solid (holes in a wordmark still count).
  const crop = okBox(p.crop) ? p.crop : kind === 'logo' ? visibleOf(media) : shaved && (kind === 'print' || kind === 'card' || kind === 'fill') ? shaved : null;
  if (kind === 'logo' && !okBox(p.crop)) aspect = (aspect * crop.w) / crop.h;
  const whole = kind === 'logo' || kind === 'note' || kind === 'print' || kind === 'card' || kind === 'words' || kind === 'custom' || kind === 'fill';
  // Line art is solid too: lines over a drawing's lines read as a mess, whatever its pixels say.
  const shape = shape0;
  const vis = whole ? { x: 0, y: 0, w: 1, h: 1 } : visibleOf(media);
  const fillKeep = kind === 'fill' ? subjectOf(media) : null;
  const focus = kind === 'fill' && okBox(media.regions?.focus) ? media.regions.focus : null;
  const keep = kind === 'fill' ? fillKeep ?? { x: 0.45, y: 0.45, w: 0.1, h: 0.1 } : kind === 'logo' || kind === 'note' || kind === 'words' || kind === 'custom' ? vis : keepOf(media, kind);
  const faces = facesOf(media);
  const trustedFace = kind === 'person' || kind === 'print' || kind === 'card' || kind === 'fill' ? mainFace(faces, media) : null;
  const drawnPerson = kind === 'drawing' && (media.people ?? []).filter(Boolean).length > 0;
  const estFace = (kind === 'person' || drawnPerson) && !faces.length ? { x: vis.x + vis.w * 0.3, y: vis.y + vis.h * 0.1, w: vis.w * 0.4, h: Math.min(vis.h * 0.26, vis.w * 0.5 * aspect) } : null;
  const face = trustedFace ?? estFace;
  const head = face ? headIn(media, face, aspect) : null;
  // What may not be touched at all: every head; a drawing's lines; a logo's middle; a note's words.
  const heads = kind === 'person' || kind === 'print' || kind === 'fill' ? faces.map((f) => headIn(media, f, aspect)) : [];
  const coreHeads = kind === 'person' ? (head ? [head, ...heads.filter((b) => Math.abs(b.x - head.x) > 0.02)] : heads) : heads;
  const core = coreHeads.length ? coreHeads.flatMap((b) => keepPoints(b, shape, 6)) : kind === 'drawing' ? keepPoints(keep, null, 9) : kind === 'logo' ? keepPoints({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 }, null, 5) : kind === 'note' ? keepPoints({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 }, null, 5) : [];
  // Bands of the silhouette, for what may sit beside it: a head's narrow, shoulders are wide.
  const bands = [];
  if (shape) {
    const N = 9;
    for (let j = 0; j < N; j++) {
      const v0 = vis.y + (vis.h * j) / N, v1 = vis.y + (vis.h * (j + 1)) / N;
      let a = Infinity, b = -Infinity;
      for (let y = Math.floor(v0 * shape.h); y < Math.ceil(v1 * shape.h) && y < shape.h; y++) {
        for (let x = 0; x < shape.w; x++) if (shape.cells[y * shape.w + x]) { a = Math.min(a, x / shape.w); b = Math.max(b, (x + 1) / shape.w); }
      }
      if (b > a) bands.push({ x: a, y: v0, w: b - a, h: v1 - v0 });
    }
  }
  const sharp = media.regions?.sharp_width_px ?? media.sharp_width_px ?? given.regions?.sharp_width_px ?? null;
  const maxW = Number.isFinite(sharp) && sharp > 0 ? sharp * (crop ? crop.w : 1) : Infinity;
  const words = kind === 'card' || kind === 'print' || kind === 'fill' ? wordsOf(media).map((w) => w.box) : [];
  return {
    ...p, media, source: given, kind, treatment, aspect, crop, rebased: okBox(p.crop), shape, vis, keep, softKeep: kind === 'fill' && !fillKeep, pts: keepPoints(keep, shape), core, face, head, measuredHead: Boolean(trustedFace), markable: Boolean(trustedFace) || (drawnPerson && Boolean(head)),
    open, asPrint, bands, maxW, words, note, focus, at: p.at ?? 0, until: Number.isFinite(p.until) && p.until > (p.at ?? 0) ? p.until : Infinity,
  };
}

// ── Geometry ─────────────────────────────────────────────────────────────────────────────────────────

const toFrame = (pl, u, v) => {
  const x = pl.x + u * pl.w, y = pl.y + v * pl.h;
  if (!pl.rot) return [x, y];
  const a = (pl.rot * Math.PI) / 180, cx = pl.x + pl.w / 2, cy = pl.y + pl.h / 2;
  return [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)];
};
const toImage = (pl, X, Y) => {
  let x = X, y = Y;
  if (pl.rot) {
    const a = (-pl.rot * Math.PI) / 180, cx = pl.x + pl.w / 2, cy = pl.y + pl.h / 2;
    x = cx + (X - cx) * Math.cos(a) - (Y - cy) * Math.sin(a);
    y = cy + (X - cx) * Math.sin(a) + (Y - cy) * Math.cos(a);
  }
  return [(x - pl.x) / pl.w, (y - pl.y) / pl.h];
};
/** A 0–1 box of a placed piece as a frame-px box (its bounding box when tilted). */
export function boxInFrame(pl, b) {
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([u, v]) => toFrame(pl, u, v));
  const x0 = Math.min(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1]));
  const x1 = Math.max(...pts.map((p) => p[0])), y1 = Math.max(...pts.map((p) => p[1]));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const boxGap = (a, b) => Math.hypot(Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)), Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)));
const pad = (b, d) => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });

/** The share of `b`'s keep under `a`'s silhouette, each at its placement. Pure. */
export function keepCovered(a, plA, b, plB) {
  const under = ([u, v]) => {
    const [X, Y] = toFrame(plB, u, v);
    const [ua, va] = toImage(plA, X, Y);
    if (ua < a.vis.x || ua > a.vis.x + a.vis.w || va < a.vis.y || va > a.vis.y + a.vis.h) return false;
    return !a.shape || Boolean(atGrid(a.shape, ua, va));
  };
  // A head itself is never covered at all: a sliver over a nose is what a viewer sees first.
  if (b.core?.some(under)) return 1;
  let hit = 0;
  for (const pt of b.pts) if (under(pt)) hit += 1;
  return hit / b.pts.length;
}
/** The share of a keep under a frame-px box (a label, a mark). Pure. */
export function keepUnderBox(box, b, plB) {
  const inBox = ([u, v]) => { const [X, Y] = toFrame(plB, u, v); return X >= box.x && X <= box.x + box.w && Y >= box.y && Y <= box.y + box.h; };
  if (b.core?.some(inBox)) return 1;
  let hit = 0;
  for (const [u, v] of b.pts) {
    const [X, Y] = toFrame(plB, u, v);
    if (X >= box.x && X <= box.x + box.w && Y >= box.y && Y <= box.y + box.h) hit += 1;
  }
  return hit / b.pts.length;
}
/** The share of a box lying on a piece's silhouette. Pure. */
export function boxOnBody(box, q, pl) {
  let hit = 0;
  const NX = 7, NY = 4;
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const [u, v] = toImage(pl, box.x + (box.w * (i + 0.5)) / NX, box.y + (box.h * (j + 0.5)) / NY);
      if (u < q.vis.x || u > q.vis.x + q.vis.w || v < q.vis.y || v > q.vis.y + q.vis.h) continue;
      if (!q.shape || atGrid(q.shape, u, v)) hit += 1;
    }
  }
  return hit / (NX * NY);
}
/** Where a person's chest and tie are, frame px: under the chin, the head's width. No words go here (I17). */
export function chestOf(q, pl) {
  if (!q.head) return null;
  const hd = boxInFrame(pl, q.head);
  return { x: hd.x + hd.w * 0.12, y: hd.y + hd.h, w: hd.w * 0.76, h: hd.h * 1.5 };
}

// ── Words ────────────────────────────────────────────────────────────────────────────────────────────

/** Roboto 500 at 36px and the Pragmatica sizes (FRAME.md § label): estimated widths, generous so a label never overruns its plate's spot. */
const CHAR = { tag: 19.2, sub: 14.6, date: 0.68, number: 0.74, numberSub: 36 };
const DATE_FONT = (text) => Math.max(44, Math.min(60, Math.floor(780 / (0.66 * Math.max(1, String(text ?? '').length)))));
/** Long words on one line get split at a comma into name and role, else wrapped. Pure. */
export function labelLines(text, sub, maxW, kind = 'label') {
  if (kind === 'date' || kind === 'number') return { text, sub: sub ?? null, wrap: null };
  const width = (s) => String(s ?? '').length * CHAR.tag + 40;
  if (!sub && width(text) > maxW) {
    const at = String(text).indexOf(', ');
    if (at > 0) return { text: String(text).slice(0, at), sub: String(text).slice(at + 2), wrap: null };
  }
  return { text, sub: sub ?? null, wrap: width(text) > maxW ? maxW : null };
}
/** A label's size on screen, px, plate included. Pure. */
export function labelSize({ text, sub = null, kind = 'label', wrap = null, size = 84 }) {
  if (kind === 'date') {
    const font = DATE_FONT(text);
    return { w: Math.min(844, String(text).length * font * CHAR.date + 48), h: 32 + 24 + font * 1.02 + (sub ? 48 : 0) };
  }
  if (kind === 'number') {
    return { w: Math.min(844, Math.max(String(text).length * size * CHAR.number, String(sub ?? '').length * CHAR.numberSub) + 56), h: 36 + size * 1.05 + (sub ? 74 : 0) };
  }
  const textW = String(text).length * CHAR.tag + 40;
  const subW = String(sub ?? '').length * CHAR.sub + 40;
  const lines = wrap ? Math.ceil(textW / (wrap - 40)) : 1;
  const w = wrap ? wrap : Math.max(textW, subW);
  return { w: Math.min(844, w), h: 24 + lines * 42 + (sub ? 38 : 0) };
}

/** The hook words: large, one to three lines across the words zone. Pure. */
export function hookBox(text) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const width = STAGE.words.x1 - STAGE.words.x0;
  const lay = (font) => {
    const per = Math.floor(width / (font * WIDE_EM));
    const lines = [];
    let cur = '';
    for (const w of words) {
      if (cur && cur.length + 1 + w.length > per) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  let font = 96;
  let lines = lay(font);
  while (font > 56 && (lines.length > 3 || Math.max(...lines.map((l) => l.length)) * font * WIDE_EM > width)) { font -= 4; lines = lay(font); }
  return { font, lines, w: Math.min(width, Math.max(...lines.map((l) => l.length)) * font * WIDE_EM + 8), h: lines.length * font * 1.06 + 8 };
}

/** A speech plate's size: its hand type, wrapped to a width. Pure. */
export function plateSize(text, maxW = 520) {
  const font = 50;
  const per = Math.max(6, Math.floor((maxW - 48) / (font * HAND_EM)));
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > per) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return { lines, font, w: Math.min(maxW, longest * font * HAND_EM + 48), h: lines.length * font * 1.08 + 32 };
}

// ── The plan ─────────────────────────────────────────────────────────────────────────────────────────

const headTarget = (n) => HEAD_PX[Math.max(1, Math.min(5, n))] ?? 225;

/** Which arrangement a shot is, when the frame doesn't say. */
export function pickArrangement(pieces) {
  pieces = pieces.filter((p) => p.kind !== 'fill');
  const people = pieces.filter((p) => p.kind === 'person').length;
  const paper = pieces.filter((p) => p.kind === 'print' || p.kind === 'card').length;
  if (people === 2) return 'face_off';
  if (people > 2) return 'row';
  if (people === 1 && pieces.filter((p) => p.kind !== 'fill').length > 1) return 'lead_inset';
  if (paper >= 2) return 'pile';
  return 'row';
}

/** The most people on at once. */
function peakOf(list) {
  let peak = 0;
  for (const p of list) peak = Math.max(peak, list.filter((q) => q.at <= p.at && p.at < q.until).length);
  return peak;
}

/** The people's head centres across the frame, left to right. */
function headSlots(n, arrangement, spread, b) {
  const W = STAGE.W;
  if (n === 1) return [W / 2];
  const span = Math.min(1, (b.x1 - b.x0) / W);
  if (n === 2) {
    const base = arrangement === 'row' ? 215 : arrangement === 'pile' ? 190 : arrangement === 'facing' ? 225 : arrangement === 'turned_away' ? 275 : arrangement === 'leads_to' ? 250 : 250;
    const d = base * spread * span;
    return [W / 2 - d, W / 2 + d];
  }
  const m = ((arrangement === 'pile' ? 230 : 175) + (1 - spread) * 120) * span + (1 - span) * W * 0.5;
  return Array.from({ length: n }, (_, i) => m + ((W - 2 * m) * i) / (n - 1));
}
function sideRank(p, order) {
  if (order) { const i = order.indexOf(p.id); if (i >= 0) return i; }
  return p.side === 'left' ? -1 : p.side === 'right' ? 99 : p.index;
}

/** A lead's share of the width in a crowd, against everyone else's 1. */
const CROWD_LEAD_SPAN = 1.5;
/** Heads on different lines may stand a little closer than their width. */
const CROWD_HEAD_ROOM = 1.12;
/**
 * Who a crowd's line is about, when three or more share the frame: the plan's lead, else whoever speaks, else whoever is
 * marked most, else the first to arrive. Everyone arriving together with nothing to tell them apart: null, a true row. Pure.
 */
export function crowdLead(people, plan = {}) {
  if (people.length < 3) return null;
  const named = people.find((p) => p.role === 'lead');
  if (named) return named;
  const here = new Set(people.map((p) => p.id));
  const speaker = (plan.speech ?? []).find((sp) => here.has(sp.on));
  if (speaker) return people.find((p) => p.id === speaker.on);
  const marked = (id) => (plan.marks ?? []).filter((m) => m.on === id).length;
  const most = Math.max(...people.map((p) => marked(p.id)));
  if (most > 0) return people.find((p) => marked(p.id) === most);
  const first = Math.min(...people.map((p) => p.at ?? 0));
  const earliest = people.filter((p) => (p.at ?? 0) === first);
  return earliest.length < people.length ? earliest[0] : null;
}
/** The head centres and widths of a crowd: the lead's slot wider, the rest even, across the whole width. Pure. */
export function crowdSlots(n, leadCol, b = { x0: 0, x1: STAGE.W }) {
  const margin = 40;
  const span = b.x1 - b.x0 - 2 * margin;
  const unit = span / (n - 1 + CROWD_LEAD_SPAN);
  const widths = Array.from({ length: n }, (_, i) => (i === leadCol ? unit * CROWD_LEAD_SPAN : unit));
  let x = b.x0 + margin;
  const centres = widths.map((w) => { const c = x + w / 2; x += w; return c; });
  return { centres, widths };
}
/** How low a ledge is worth reaching for: under this the platform's own UI lies anyway. */
const LEDGE_LOW = STAGE.bottom;
/** How much larger than the shot's size a body may stand to get its ledge there. */
const LEDGE_GROW = 1.4;
const LEDGE_GROW_BESIDE = 1.12;

/** The ledge's top: it hides what's left of every open edge on the frame. Infinity when none is left. */
function ledgeNeeded(plan, placedOnes = false) {
  let top = Infinity;
  for (const p of plan.flat) {
    if (!p.open || !plan.placed.has(p.id) || isPlaced(p) !== Boolean(placedOnes)) continue;
    const pl = plan.placed.get(p.id);
    const see = (u, v) => {
      const [X, Y] = toFrame(pl, u, v);
      if (X < -3 || X > STAGE.W + 3 || Y > STAGE.H + 3) return;
      top = Math.min(top, Y);
    };
    for (let i = 0; i <= 6; i++) {
      const k = i / 6;
      if (p.open.left) see(0, p.open.left[0] + (p.open.left[1] - p.open.left[0]) * k);
      if (p.open.right) see(1, p.open.right[0] + (p.open.right[1] - p.open.right[0]) * k);
      if (p.open.bottom) see(p.open.bottom[0] + (p.open.bottom[1] - p.open.bottom[0]) * k, footOf(p.open));
    }
  }
  return top;
}

/** Place the people: one head line, bodies running to the frame's foot or behind the ledge, sized to the shot. */
function placePeople(plan, people, s, opt) {
  const { order, arrangement, jitter } = plan;
  const hasLead = people.some((q) => q.role === 'lead');
  const inset = (p) => Boolean(p.belongs) || p.role === 'inset' || (arrangement === 'lead_inset' && p.role !== 'lead' && hasLead);
  const main = people.filter((p) => !inset(p));
  // An inset on with two or more people has no free side: it takes a column, or it lands on someone.
  const columned = people.filter((p) => inset(p) && main.filter((q) => together(p, q)).length >= 2);
  const isColumned = (p) => columned.includes(p);
  const others = people.filter((p) => inset(p) && !isColumned(p));
  const standing = people.filter((p) => !inset(p) || isColumned(p));
  const peak = peakOf(standing);
  // Columns: people on at once stand apart; people who never meet may take one column.
  const sorted = [...standing].sort((a, b) => sideRank(a, order) - sideRank(b, order));
  let columns = sorted.map((_, i) => i);
  if (peak < sorted.length) {
    const taken = Array.from({ length: peak }, () => []);
    const byArrival = [...sorted].sort((a, b) => a.at - b.at || sideRank(a, order) - sideRank(b, order));
    const col = new Map();
    for (const p of byArrival) {
      const range = p.side === 'right' ? [...taken.keys()].reverse() : [...taken.keys()];
      const free = range.find((k) => !taken[k].some((q) => together(p, q))) ?? range[0];
      taken[free].push(p);
      col.set(p.id, free);
    }
    columns = sorted.map((p) => col.get(p.id));
  }
  const n = Math.max(1, peak);
  // Three or more on at once are a scene, not a line-up: one of them is who the line is about.
  const onAtPeak = n >= 3 && !opt.plain && arrangement !== 'lead_inset' && arrangement !== 'pile' ? standing.filter((p) => !isColumned(p)) : [];
  const crowdOf = onAtPeak.length >= 3 ? crowdLead(onAtPeak, plan) : null;
  const leadCol = crowdOf ? columns[sorted.indexOf(crowdOf)] : -1;
  const crowded = crowdOf ? crowdSlots(n, leadCol, plan.bounds) : null;
  const slots = crowded ? crowded.centres : headSlots(n, arrangement, opt.spread, plan.bounds);
  const spacing = n > 1 ? Math.abs(slots[1] - slots[0]) : plan.bounds.x1 - plan.bounds.x0;
  const spacingOf = (p) => {
    if (!crowded) return spacing;
    const col = columns[sorted.indexOf(p)];
    return crowded.widths[col] * CROWD_HEAD_ROOM;
  };
  const isLead = (p) => p.role === 'lead' || p === crowdOf;
  const lonely = n === 1 && plan.flat.some((q) => q.kind !== 'fill' && (isBig(q) || q.kind === 'logo' || q.kind === 'note'));
  const bigOthers = plan.flat.filter(isBig).length;
  const room = plan.bounds.x1 - plan.bounds.x0 - 24;
  // Sizes first, so one frame's heads stay within the ratio.
  const sizeOf = (p, target, isInset) => {
    let hpx = Math.min(LIMITS.headMax, target * s);
    hpx = Math.max(isInset ? LIMITS.insetMin : LIMITS.headMin, hpx);
    let h = hpx / Math.max(0.02, p.head.h);
    // Heads stand clear of each other; shoulders may overlap, and the depth check keeps what must show.
    if (!isInset) h = Math.min(h, (Math.min(spacingOf(p), room) - 10) / Math.max(0.01, p.head.w * p.aspect));
    h = Math.min(h, p.maxW / p.aspect);
    return h;
  };
  // One person beside a picture leaves that picture room to show.
  const crowd = n < 2 ? (lonely && bigOthers >= 1 ? 0.84 : 1) : arrangement === 'pile' ? 0.82 : arrangement === 'row' ? 0.9 : 1;
  const heights = new Map();
  // The plan's own lead takes all the ratio allows; one the layout worked out, less.
  const leadBoost = (p) => (p === crowdOf ? (p.role === 'lead' ? LIMITS.headRatio * 0.98 : 1.2) : p.role === 'lead' ? LEAD_HEAD : 1);
  for (const p of main) heights.set(p.id, sizeOf(p, crowd * headTarget(n) * leadBoost(p), false));
  for (const p of columned) heights.set(p.id, sizeOf(p, crowd * headTarget(n) * COLUMN_INSET_HEAD, true));
  const ceiling = plan.ceiling;
  /** Which side edge of a cut body runs off the frame, from where it stands: the head stays in. */
  const sideOff = (p, cx, h) => {
    if (plan.onBoard || !p.open) return null;
    const w = h * p.aspect;
    const fits = (side) => (side === 'left' ? -3 + p.head.x * w >= 12 : STAGE.W + 3 - w + (p.head.x + p.head.w) * w <= STAGE.W - 12);
    // Only the outermost columns have a frame edge beside them.
    const near = n === 1 ? STAGE.W / 2 + 40 : slots[0] + 60;
    const left = p.open.left && cx <= near && fits('left');
    const right = p.open.right && cx >= STAGE.W - near && fits('right');
    if (left && right) return p.open.left[0] <= p.open.right[0] ? 'left' : 'right';
    return left ? 'left' : right ? 'right' : null;
  };
  /** How far down its picture a cut body's edges all stay out of sight, standing here. Null: nothing's open. */
  const openFrom = (p, off) => {
    const vs = [];
    if (p.open?.bottom) vs.push(footOf(p.open));
    if (p.open?.left && off !== 'left') vs.push(p.open.left[0]);
    if (p.open?.right && off !== 'right') vs.push(p.open.right[0]);
    return vs.length ? Math.min(...vs) : null;
  };
  /**
   * Where a cut body has to reach (decision 2). Its foot runs off the frame when it can with the face on the subject line;
   * a body that can't, however low the head goes, has the ledge: it reaches the ledge's highest line, and the head stays up.
   */
  const reachTo = (p, h, off) => {
    const v = openFrom(p, off);
    if (v == null) return null;
    const reach = (v - (p.face.y + p.face.h / 2)) * h;
    return STAGE.subject[1] + reach >= STAGE.H + 20 ? STAGE.H + 20 : LIMITS.ledgeTop + 14;
  };
  // One head line: as low as the most demanding cut body needs, so the heads stay level.
  const lineFor = (p, h, cx) => {
    const off = sideOff(p, cx, h);
    const want = reachTo(p, h, off);
    if (want == null) return STAGE.faceBand[0];
    return want - (openFrom(p, off) - (p.face.y + p.face.h / 2)) * h;
  };
  const cxOf = (p, i) => {
    let lean = 0;
    if (lonely) lean = (p.side === 'left' || (!p.side && p.open?.left && !p.open?.right) ? -1 : p.side === 'right' || (!p.side && p.open?.right && !p.open?.left) ? 1 : plan.seed % 2 ? 1 : -1) * 170;
    if (arrangement === 'solo' && !p.side) lean = 0;
    return slots[columns[i]] + jitter(p.id, 'x', 16) + lean;
  };
  // A body whose cut edge would leave a tall ledge stands larger, up to the head limits: the ledge sits as low as it can.
  for (const p of main) {
    if (!p.open || opt.plain) continue;
    const h = heights.get(p.id);
    const v = openFrom(p, sideOff(p, cxOf(p, sorted.indexOf(p)), h));
    const faceV = p.face.y + p.face.h / 2;
    if (v == null || v <= faceV) continue;
    const need = (LEDGE_LOW - STAGE.subject[1]) / (v - faceV);
    if (need <= h) continue;
    const grown = Math.min(need, h * (lonely ? LEDGE_GROW_BESIDE : LEDGE_GROW), LIMITS.headMax / Math.max(0.02, p.head.h), (Math.min(spacingOf(p), room) - 10) / Math.max(0.01, p.head.w * p.aspect), p.maxW / p.aspect);
    if (grown > h) heights.set(p.id, grown);
  }
  // Sizes settled, so one frame's heads stay within the ratio.
  const floorHead = Math.min(...main.map((p) => heights.get(p.id) * p.head.h));
  for (const p of main) {
    const most = (floorHead * (isLead(p) ? LIMITS.headRatio : Math.min(LIMITS.headRatio, 1.2))) / Math.max(0.02, p.head.h);
    if (heights.get(p.id) > most) heights.set(p.id, most);
  }
  const shared = Math.min(STAGE.faceBand[1], Math.max(opt.cy, ...sorted.map((p, i) => (isColumned(p) ? 0 : lineFor(p, heights.get(p.id), cxOf(p, i))))));
  const stand = (p, cx, h0, cyWanted, isInset) => {
    let h = h0;
    const faceV = p.face.y + p.face.h / 2;
    const bottomV = p.vis.y + p.vis.h;
    let cy = clamp(cyWanted, STAGE.faceBand[0], STAGE.faceBand[1]);
    const crownOf = (hh, c) => c - (faceV - p.head.y) * hh;
    // A cut body stands low enough to reach the frame's foot or, failing that, the ledge's highest line.
    const off = sideOff(p, cx, h);
    const want = reachTo(p, h, off);
    if (want != null) {
      const reached = cy + (openFrom(p, off) - faceV) * h;
      if (reached < want) cy = Math.min(STAGE.faceBand[1], cy + (want - reached));
    } else if (cy + (bottomV - faceV) * h < STAGE.bottom - 30 && bottomV > faceV && !isInset) {
      // A whole figure stands on the usable area's foot.
      cy = Math.min(STAGE.faceBand[1], cy + (STAGE.bottom - 30 - (cy + (bottomV - faceV) * h)));
    }
    if (crownOf(h, cy) < ceiling) cy += ceiling - crownOf(h, cy);
    let y = cy - faceV * h;
    const w = h * p.aspect;
    let x = cx - (p.head.x + p.head.w / 2) * w;
    const b = plan.bounds;
    // An open side goes off the frame on the side it stands, when the head stays in: what's left for the ledge sits lower.
    if (off === 'left' && x > -2) x = Math.min(x, -3);
    else if (off === 'right' && x + w < STAGE.W + 2) x = Math.max(x, STAGE.W + 3 - w);
    // The keep stays in the frame; a wide body (a sofa, an arm) may bleed off the side it stands on.
    const keepLeft = x + p.keep.x * w, keepRight = keepLeft + p.keep.w * w;
    const margin = 12 + Math.abs(Math.sin((plan.tilt(p) * Math.PI) / 180)) * h * 0.5;
    if (keepLeft < b.x0 + margin) x += b.x0 + margin - keepLeft;
    else if (keepRight > b.x1 - margin) x -= keepRight - (b.x1 - margin);
    if (plan.onBoard) {
      const left = x + p.vis.x * w, right = left + p.vis.w * w;
      if (left < b.x0) x += b.x0 - left;
      else if (right > b.x1) x -= right - b.x1;
    }
    return { x, y, w, h, rot: plan.tilt(p) };
  };
  sorted.forEach((p, i) => {
    const col = columns[i];
    // Staggered heads in a pile and along a chain; a row's share a line.
    const dip = crowdOf ? (p === crowdOf ? 46 : col % 2 ? -44 : -8) : arrangement === 'row' ? 0 : arrangement === 'pile' && n >= 2 ? (col % 2 ? -40 : 40) : arrangement === 'leads_to' && n >= 2 ? (col - (n - 1) / 2) * 56 : n >= 3 ? (col % 2 ? -24 : 24) : 0;
    plan.placed.set(p.id, stand(p, cxOf(p, i), heights.get(p.id), shared + dip + jitter(p.id, 'y', 12), isColumned(p)));
  });
  // A small body's cut edge doesn't drag the ledge up onto a larger one's chin: it stands lower, within the band.
  const chinLine = Math.max(0, ...sorted.filter((p) => p.measuredHead).map((p) => { const pl = plan.placed.get(p.id); return pl.y + (p.face.y + p.face.h) * pl.h + LIMITS.neck; }));
  for (const p of sorted) {
    const pl = plan.placed.get(p.id);
    const v = openFrom(p, sideOff(p, pl.x + (p.head.x + p.head.w / 2) * pl.w, pl.h));
    if (v == null) continue;
    const edge = pl.y + v * pl.h;
    const short = chinLine + 15 - edge;
    if (short <= 0 || !p.measuredHead) continue;
    const face = pl.y + (p.face.y + p.face.h / 2) * pl.h;
    const down = Math.min(short, STAGE.faceBand[1] - face);
    if (down > 0 && pl.y + (p.face.y + p.face.h) * pl.h + down + LIMITS.neck <= chinLine + 1e-3) plan.placed.set(p.id, { ...pl, y: pl.y + down });
  }
  // Insets: smaller figures in front, on the free side of the lead.
  others.forEach((p, i) => {
    const owner = p.belongs ? plan.placed.get(p.belongs) : null;
    const lead = sorted[0] ? plan.placed.get(sorted[0].id) : null;
    const ref = owner ?? lead;
    const leadHeadX = ref && sorted[0] ? ref.x + (sorted[0].head.x + sorted[0].head.w / 2) * ref.w : STAGE.W / 2;
    const goRight = p.side ? p.side === 'right' : leadHeadX < STAGE.W / 2;
    const cx = goRight ? STAGE.W - 200 - i * 240 : 200 + i * 240;
    let h = sizeOf(p, headTarget(n || 1) * INSET_HEAD, true);
    // A deliberate difference, not a giant beside a thumbnail.
    const biggest = Math.max(0, ...main.filter((q) => together(p, q)).map((q) => heights.get(q.id) * q.head.h));
    if (biggest) h = Math.min(p.maxW / p.aspect, Math.max(h, (biggest / LIMITS.insetRatio) / Math.max(0.02, p.head.h)));
    plan.placed.set(p.id, stand(p, cx, h, 1170, true));
  });
}

const LOGO_AREA = { people: 68000, alone: 115000 };
/** How big a loose piece may be shown, on its longest side, px. */
function longestShown(p, plan, s) {
  if (p.note) return Infinity;
  const coming = plan.flat.filter((q) => q.kind !== 'fill' && q !== p && together(p, q)).length;
  let longest;
  const bigs = plan.flat.filter((q) => isBig(q) && together(p, q)).length;
  const withPeople = plan.flat.some((q) => q.kind === 'person' && together(p, q));
  // A logo's size is its area: a long wordmark takes more length for the same presence.
  if (p.kind === 'logo') longest = !coming ? 900 : Math.min(760, Math.sqrt((withPeople ? LOGO_AREA.people : LOGO_AREA.alone) * Math.max(p.aspect, 1 / p.aspect)));
  else if (p.kind === 'thing' && withPeople) longest = p.aspect >= 2 ? 620 : 480;
  else if (withPeople) longest = bigs <= 1 ? 680 : bigs === 2 ? 540 : 440;
  else longest = 1020;
  if (p.role === 'lead') longest *= 1.15;
  if (p.belongs) longest *= p.kind === 'logo' || p.kind === 'thing' ? 0.8 : 0.62;
  return longest * s;
}
const shownAspect = (p) => (p.vis.w * p.aspect) / Math.max(0.01, p.vis.h);
const CIRCLE_ROOM = 150;
/** The largest shown box of `p` in a w×h room. */
function fitShown(p, w, h, plan, s) {
  // A circle runs around what it marks: that room is the piece's.
  if (plan.marks?.some((m) => m.on === p.id && m.kind === 'circle')) { w -= CIRCLE_ROOM; h -= CIRCLE_ROOM; }
  const a = shownAspect(p);
  let sw = Math.min(w, h * a);
  const longest = longestShown(p, plan, s);
  if (a >= 1) sw = Math.min(sw, longest); else sw = Math.min(sw, longest * a);
  sw = Math.min(sw, p.maxW * p.vis.w);
  if (p.note) {
    const base = p.note.w;
    sw = Math.min(sw, base * (p.note.max / p.note.font));
  }
  if (p.custom?.min_width && sw < p.custom.min_width) return { w: 0, h: 0 };
  if (p.note && sw < p.note.w * (p.note.min / p.note.font)) return { w: 0, h: 0 };
  return { w: sw, h: sw / a };
}
/**
 * Iteration 11, the solver's `place`: { x, y, w, rotate?, z? }, px on the 1080x1920 frame. It sets the box of what shows of the
 * piece (a cutout's empty margin isn't part of it), and the piece stays there: nothing below moves, sizes or tilts it, and no
 * guarantee is forced on it. Measured checks report on it. Pure.
 */
export const isPlaced = (p) => Boolean(p?.place) && [p.place.x, p.place.y, p.place.w].every(Number.isFinite) && p.place.w > 0;
function placeExact(p) {
  const { x, y, w, rotate } = p.place;
  return placeShown(p, { x, y, w, h: w / shownAspect(p) }, Number.isFinite(rotate) ? rotate : 0);
}
/** The depth a placed piece asks for wins over the derived one. */
function placedDepth(z, flat) {
  for (const p of flat) if (isPlaced(p) && Number.isFinite(p.place.z)) z.set(p.id, p.place.z);
  return z;
}
/** A shown box as a placement. */
function placeShown(p, box, rot) {
  const w = box.w / p.vis.w;
  const h = w / p.aspect;
  return { x: box.x - p.vis.x * w, y: box.y - p.vis.y * h, w, h, rot };
}
/** How much room a tilt costs. */
const tiltCost = (rot, w, h) => (rot ? Math.abs(Math.sin((rot * Math.PI) / 180)) * Math.max(w, h) * 0.5 + 4 : 0);

/** What a loose piece must not lie on, frame px: what's placed and on with it, and the reserved words. */
function obstaclesFor(p, plan, level) {
  const out = [];
  for (const [id, pl] of plan.placed) {
    if (id === p.id) continue;
    const q = plan.byId.get(id);
    if (!together(p, q)) continue;
    if (q.kind === 'fill') {
      if (!q.softKeep) out.push(pad(boxInFrame(pl, q.keep), GAP));
      else if (q.focus && !plan.overFocus) out.push(pad(boxInFrame(pl, q.focus), GAP));
      continue;
    }
    if (q.bands.length) {
      if (level === 0) for (const b of q.bands) out.push(pad(boxInFrame(pl, b), GAP * 0.5));
      else {
        out.push(pad(boxInFrame(pl, q.keep), GAP * 0.5));
        const k = boxInFrame(pl, q.keep);
        const chest = chestOf(q, pl);
        if (chest) out.push({ ...chest, h: Math.min(chest.h, Math.max(0, k.y + k.h + 40 - chest.y)) });
      }
    } else {
      out.push(pad(boxInFrame(pl, q.vis), GAP));
    }
  }
  for (const r of plan.reserved) if (!r.owner || r.owner !== p.id) if (together(p, r)) out.push(pad(r, 10));
  return out;
}

const MIN_RECT = 60;
/** The maximal empty rectangles of a room, given the boxes it holds. */
export function freeRects(room, boxes) {
  let rects = [{ x0: room.x0, y0: room.y0, x1: room.x1, y1: room.y1 }];
  for (const o of boxes) {
    const next = [];
    const ox1 = o.x + o.w, oy1 = o.y + o.h;
    for (const r of rects) {
      if (o.x >= r.x1 || ox1 <= r.x0 || o.y >= r.y1 || oy1 <= r.y0) { next.push(r); continue; }
      if (o.x - r.x0 >= MIN_RECT) next.push({ ...r, x1: o.x });
      if (r.x1 - ox1 >= MIN_RECT) next.push({ ...r, x0: ox1 });
      if (o.y - r.y0 >= MIN_RECT) next.push({ ...r, y1: o.y });
      if (r.y1 - oy1 >= MIN_RECT) next.push({ ...r, y0: oy1 });
    }
    rects = next.filter((a, i) => !next.some((b, j) => j !== i && b.x0 <= a.x0 && b.y0 <= a.y0 && b.x1 >= a.x1 && b.y1 >= a.y1 && (j < i || b.x0 !== a.x0 || b.y0 !== a.y0 || b.x1 !== a.x1 || b.y1 !== a.y1)));
  }
  return rects;
}

/** The usable room of a shot, frame px. */
function roomOf(plan) {
  const b = plan.bounds;
  const m = plan.onBoard ? 0 : EDGE;
  const y1 = Math.min(b.y1, STAGE.bottom, plan.ledge < Infinity ? plan.ledge - 10 : Infinity);
  return { x0: b.x0 + m, x1: b.x1 - m, y0: Math.max(b.y0, plan.ceilingFor ?? 0), y1 };
}

/** The tag a piece carries under it: its label's height, reserved as one with it. */
function tagOf(p, plan) {
  const l = plan.labels.find((x) => x.owner === p.id);
  return l ? labelSize(l) : null;
}

/** Where a loose piece would like to be, with how much it cares. */
function anchorOf(p, plan) {
  const { placed, byId } = plan;
  if (p.belongs && placed.has(p.belongs)) {
    const o = byId.get(p.belongs);
    const k = boxInFrame(placed.get(p.belongs), o.keep);
    const outward = p.side ? (p.side === 'right' ? 1 : -1) : k.x + k.w / 2 > STAGE.W / 2 ? 1 : -1;
    return { x: k.x + k.w / 2 + outward * (k.w / 2 + 120), y: k.y + k.h / 2 + 60, strong: p.kind === 'logo' ? 0.2 : 0.5 };
  }
  // What a person belongs to lands by them.
  const dep = plan.flat.find((q) => q.belongs === p.id && placed.has(q.id));
  if (dep) {
    const k = boxInFrame(placed.get(dep.id), dep.keep);
    return { x: k.x + k.w / 2, y: k.y - 120, strong: 0.5 };
  }
  if (p.kind === 'logo') return { x: p.side === 'left' ? 280 : p.side === 'right' ? 800 : 540, y: 700, strong: 0.14 };
  return { x: p.side === 'left' ? 280 : p.side === 'right' ? 800 : 540, y: 1000, strong: p.side ? 0.2 : 0.05 };
}

const MIN_WORDMARK = 170;
const MIN_PRINT = 280;
/** The greedy step with people on stage: the free room that holds this piece largest, near where it wants to be. */
function placeFree(p, plan, s, level) {
  const room = roomOf(plan);
  const rects = freeRects(room, obstaclesFor(p, plan, level));
  const tag = tagOf(p, plan);
  const anchor = anchorOf(p, plan);
  const rot = plan.tilt(p);
  let best = null;
  for (const r of rects) {
    const tagH = tag ? tag.h + WORD_GAP : 0;
    const cost = tiltCost(rot, r.x1 - r.x0, r.y1 - r.y0);
    const fit = fitShown(p, r.x1 - r.x0 - 2 * Math.min(cost, 24), r.y1 - r.y0 - tagH - 2 * Math.min(cost, 24), plan, s);
    if (!(fit.w > 0)) continue;
    // Under these a picture says nothing on a phone.
    const minW = p.kind === 'logo' ? (p.aspect >= 2 ? MIN_WORDMARK : 90) : p.kind === 'note' ? 0 : p.kind === 'thing' ? 150 : p.kind === 'print' ? MIN_PRINT : 180;
    if (Math.max(fit.w, fit.h) < minW) continue;
    const x = clamp(anchor.x - fit.w / 2, r.x0, r.x1 - fit.w);
    const y = clamp(anchor.y - fit.h / 2, r.y0, r.y1 - fit.h - tagH);
    const score = Math.sqrt(fit.w * fit.h) - Math.hypot(x + fit.w / 2 - anchor.x, y + fit.h / 2 - anchor.y) * anchor.strong;
    if (!best || score > best.score) best = { score, box: { x, y, ...fit }, tagH, tag };
  }
  if (!best) return false;
  plan.placed.set(p.id, placeShown(p, best.box, rot));
  if (tag) plan.reserved.push({ id: `under:${p.id}`, owner: p.id, at: p.at, until: p.until, x: best.box.x, y: best.box.y + best.box.h + WORD_GAP, w: tag.w, h: tag.h, w0: best.box.w });
  return true;
}

/** Let what was placed take the room left around it, largest first. */
function grow(loose, plan, s, level) {
  const room = roomOf(plan);
  for (const p of [...loose].sort((a, b) => weightOf(b) - weightOf(a))) {
    const pl = plan.placed.get(p.id);
    if (!pl || p.belongs || p.onto) continue;
    const seen = boxInFrame({ ...pl, rot: 0 }, p.vis);
    const tag = plan.reserved.find((r) => r.id === `under:${p.id}`);
    const rects = freeRects(room, obstaclesFor(p, plan, level));
    const cx = seen.x + seen.w / 2, cy = seen.y + seen.h / 2;
    const inRect = rects.filter((r) => cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1);
    let best = null;
    for (const r of inRect) {
      const fit = fitShown(p, r.x1 - r.x0, r.y1 - r.y0 - (tag ? tag.h + WORD_GAP : 0), plan, s);
      if (!best || fit.w * fit.h > best.fit.w * best.fit.h) best = { fit, r };
    }
    if (!best || best.fit.w <= seen.w * 1.02) continue;
    const scale = Math.min(best.fit.w / seen.w, 1.6);
    const w = seen.w * scale, h = seen.h * scale;
    const tagH = tag ? tag.h + WORD_GAP : 0;
    const x = clamp(cx - w / 2, best.r.x0, best.r.x1 - w), y = clamp(cy - h / 2, best.r.y0, best.r.y1 - h - tagH);
    plan.placed.set(p.id, placeShown(p, { x, y, w, h }, pl.rot));
    if (tag) { tag.x = x; tag.y = y + h + WORD_GAP; }
  }
}

/** How much room a piece gets beside others. */
function weightOf(p) {
  let w = p.kind === 'logo' ? 0.55 : p.kind === 'note' ? ({ figure: 0.8, place: 0.55, date: 0.5, body: 0.65 })[p.note.role] : p.kind === 'drawing' ? 1.25 : p.kind === 'words' ? 1.25 : 1.3;
  if (p.role === 'lead') w *= 2.1;
  return w;
}

/** Whether an arrow crosses this cut of the pieces. */
const crossesCut = (plan, L, R) => plan.arrowLinks.some(([a, b]) => (L.some((p) => p.id === a) && R.some((p) => p.id === b)) || (L.some((p) => p.id === b) && R.some((p) => p.id === a)));

/** What standing on the side it wasn't asked for leaves of a piece's worth. */
const WRONG_SIDE = 0.35;
const WIDE_CELL = 700;
const WIDE_TILT = 1.4;
const MIN_FIGURE = 230;
const UNREADABLE = 500;
const SMALL_CELL = 120000;
const SMALL_LOGO = 40000;
/** The slicing of a room among pieces in order: each cut along one axis, by weight, keeping `gap` (an arrow's length where an arrow crosses). Best filling wins. */
function slice(items, r, plan, s, depth = 0) {
  if (items.length === 1) {
    const p = items[0];
    const tag = tagOf(p, plan);
    const fit = fitShown(p, r.x1 - r.x0, r.y1 - r.y0 - (tag ? tag.h + WORD_GAP : 0), plan, s);
    if (!(fit.w > 0)) return null;
    // A cell too small to say anything on a phone counts for little, however large its neighbour gets.
    const least = p.kind === 'note' ? 0 : p.kind === 'logo' ? SMALL_LOGO : SMALL_CELL;
    // The side it was asked for is part of what it means.
    const cx = (r.x0 + r.x1) / 2;
    const wrongSide = (p.side === 'right' && cx < STAGE.W / 2) || (p.side === 'left' && cx > STAGE.W / 2);
    // A figure too small to know on a phone is hardly there, whoever it stands beside.
    const faint = p.kind === 'drawing' && (p.media?.people ?? []).filter(Boolean).length > 0 && fit.h < MIN_FIGURE ? 0.3 : 1;
    // Under what can be read at all, no neighbour's size makes up for it.
    const floor = p.kind === 'logo' ? (p.aspect >= 2 ? MIN_WORDMARK : 90) : p.kind === 'note' ? 0 : p.kind === 'thing' ? 150 : p.kind === 'print' ? MIN_PRINT : 180;
    const lost = Math.max(fit.w, fit.h) < floor ? UNREADABLE : 0;
    return { cells: [{ p, r }], score: weightOf(p) * Math.sqrt(fit.w * fit.h) * (fit.w * fit.h < least ? 0.5 : 1) * faint * (wrongSide ? WRONG_SIDE : 1) - lost };
  }
  const total = items.reduce((n, p) => n + weightOf(p), 0);
  let k0 = 1;
  let acc = weightOf(items[0]);
  while (k0 < items.length - 1 && acc + weightOf(items[k0]) / 2 < total / 2) { acc += weightOf(items[k0]); k0 += 1; }
  const splits = items.length <= 5 ? [...new Set([k0, Math.max(1, k0 - 1), Math.min(items.length - 1, k0 + 1)])] : [k0];
  // A cut between the sides asked for says what the plan said.
  for (let k = 1; k < items.length; k++) if (items[k - 1].side !== items[k].side && items[k - 1].side && items[k].side && !splits.includes(k)) splits.push(k);
  // What belongs to something isn't cut off from it, while there's another cut to make.
  const together2 = (a, b) => a.belongs === b.id || b.belongs === a.id || (a.side && a.side === b.side);
  const whole = splits.filter((k) => !together2(items[k - 1], items[k]));
  if (whole.length) splits.splice(0, splits.length, ...whole);
  else if (items.length > 2) {
    const any = Array.from({ length: items.length - 1 }, (_, i) => i + 1).filter((k) => !together2(items[k - 1], items[k]));
    if (any.length) splits.splice(0, splits.length, ...any);
  }
  const force = plan.sliceForce?.(depth, items) ?? null;
  const orients = force ?? ['h', 'v'];
  let best = null;
  for (const k of splits) {
    const L = items.slice(0, k), R = items.slice(k);
    const crossed = crossesCut(plan, L, R);
    const gap = crossed ? plan.arrowGap : plan.cellGap;
    const weighed = plan.solo && depth === 0 ? 0.74 : L.reduce((n, p) => n + weightOf(p), 0) / total;
    // A wide picture does more with the width than a tall one: the weights are a start, not the answer.
    const shares = items.length <= 3 ? [weighed, weighed * 0.7, 1 - (1 - weighed) * 0.7, (weighed + 0.5) / 2] : [weighed, weighed * 0.8, 1 - (1 - weighed) * 0.8, (weighed + 0.5) / 2];
    for (const o of orients) {
      const len = o === 'h' ? r.x1 - r.x0 : r.y1 - r.y0;
      if (len - gap < 80) continue;
      for (const share of shares) {
        const a = (len - gap) * share;
        const ra = o === 'h' ? { ...r, x1: r.x0 + a } : { ...r, y1: r.y0 + a };
        const rb = o === 'h' ? { ...r, x0: r.x0 + a + gap } : { ...r, y0: r.y0 + a + gap };
        const A = slice(L, ra, plan, s, depth + 1), B = slice(R, rb, plan, s, depth + 1);
        if (!A || !B) continue;
        const score = A.score + B.score;
        if (!best || score > best.score) best = { cells: [...A.cells, ...B.cells], score };
      }
    }
  }
  return best;
}

/** Nobody on stage: the whole room is cut among the pieces, each as large as its cell lets it. */
function placeSliced(loose, plan, s) {
  const room = roomOf(plan);
  // Words already reserved keep their band.
  for (const r of plan.reserved) {
    if (r.id === 'hook') continue;
    if (r.y + r.h / 2 < (room.y0 + room.y1) / 2) room.y0 = Math.max(room.y0, r.y + r.h + GAP);
    else room.y1 = Math.min(room.y1, r.y - GAP);
  }
  const seedMirror = plan.seed % 2 === 1;
  // Reading order: left to right, or along the arrows.
  const order = [...loose];
  if (plan.arrangement === 'leads_to' && plan.arrowLinks.length) {
    const next = new Map(plan.arrowLinks.map(([a, b]) => [a, b]));
    const starts = order.filter((p) => next.has(p.id) && !plan.arrowLinks.some(([, b]) => b === p.id));
    const chain = [];
    for (const st of starts) for (let c = st.id; c && !chain.includes(c); c = next.get(c)) chain.push(c);
    order.sort((a, b) => (chain.indexOf(a.id) < 0 ? 99 : chain.indexOf(a.id)) - (chain.indexOf(b.id) < 0 ? 99 : chain.indexOf(b.id)));
  } else {
    order.sort((a, b) => (a.side === 'left' ? -1 : a.side === 'right' ? 1 : 0) - (b.side === 'left' ? -1 : b.side === 'right' ? 1 : 0) || (b.role === 'lead' ? 1 : 0) - (a.role === 'lead' ? 1 : 0) || a.index - b.index);
  }
  // The pictures first, the words about them after.
  order.sort((a, b) => (a.kind === 'note' ? 1 : 0) - (b.kind === 'note' ? 1 : 0));
  // What belongs to something stands next to it.
  for (const p of [...order]) {
    if (!p.belongs || !order.some((q) => q.id === p.belongs)) continue;
    order.splice(order.indexOf(p), 1);
    // Over its owner when an arrow leaves the owner: under it, the arrow would run straight through.
    const arrowOut = plan.arrowLinks.some(([a]) => a === p.belongs);
    order.splice(order.findIndex((q) => q.id === p.belongs) + (arrowOut ? 0 : 1), 0, p);
  }
  // Pieces that never meet share a cell: each has all of it for its own time. They don't split the room between them.
  const slots = [];
  for (const p of order) {
    const slot = slots.find((g) => g.every((q) => !together(p, q)));
    if (slot) slot.push(p);
    else slots.push([p]);
  }
  const membersOf = new Map(slots.map((g) => [g[0], g]));
  const reps = slots.map((g) => g[0]);
  // A pile needs three to be a pile: two pieces stand apart.
  const piled = plan.arrangement === 'pile' && reps.length >= 3;
  plan.cellGap = piled ? 8 : GAP;
  plan.arrowGap = LIMITS.arrowMin + 44;
  plan.solo = plan.arrangement === 'solo' && reps.length > 1;
  // A row can't hold an arrow that has to jump over its neighbour.
  const skips = plan.arrowLinks.some(([a, b]) => {
    const i = reps.findIndex((p) => p.id === a), j = reps.findIndex((p) => p.id === b);
    return i >= 0 && j >= 0 && Math.abs(i - j) > 1;
  });
  plan.sliceForce = (depth, items) => {
    // What belongs to something stands under it, as one unit; pieces asked for one side stack there.
    const owned = items.length === 2 && (items[0].belongs === items[1].id || items[1].belongs === items[0].id);
    if (owned) return ['v'];
    // An arrow between them needs a length neither has to give up on a stack.
    if (items.length >= 2 && items.every((p) => p.side) && new Set(items.map((p) => p.side)).size === 1 && !crossesCut(plan, items.slice(0, 1), items.slice(1))) return ['v'];
    if (plan.arrangement === 'row' && items.length <= 3 && !skips) return ['h'];
    if (depth === 0 && ['face_off', 'facing', 'turned_away'].includes(plan.arrangement)) return ['h'];
    return null;
  };
  // One long page alone: as wide as it can stand, running on under the frame for the camera to read down.
  if (order.length === 1 && order[0].kind === 'card' && order[0].aspect < (room.x1 - room.x0) / (room.y1 - room.y0)) {
    const p = order[0];
    const w = Math.min(room.x1 - room.x0, longestShown(p, plan, s), p.maxW);
    const y = room.y0;
    plan.placed.set(p.id, { x: (room.x0 + room.x1 - w) / 2, y, w, h: w / p.aspect, rot: 0 });
    return true;
  }
  let cut = slice(reps, room, plan, s);
  if (!cut) { plan.sliceForce = null; cut = slice(reps, room, plan, s); }
  if (!cut) return false;
  const inflate = piled || (plan.style === 'paper' && reps.length >= 3) ? 1.05 : 1;
  for (const { p, r } of cut.cells.flatMap((c) => membersOf.get(c.p).map((p) => ({ p, r: c.r })))) {
    const tag = tagOf(p, plan);
    const tagH = tag ? tag.h + WORD_GAP : 0;
    const w0 = r.x1 - r.x0, h0 = r.y1 - r.y0 - tagH;
    // A long sheet tilts less: the same angle costs its height and runs its corners out of the room.
    const rot = w0 > WIDE_CELL ? clamp(plan.tilt(p), -WIDE_TILT, WIDE_TILT) : plan.tilt(p);
    const t = tiltCost(rot, w0, h0);
    const fit = fitShown(p, (w0 - Math.min(t, 18)) * inflate, (h0 - Math.min(t, 18)) * inflate, plan, s);
    if (!(fit.w > 0)) return false;
    const slackX = w0 - fit.w, slackY = h0 - fit.h;
    // Turned away: each party to its own far side.
    let cx = r.x0 + slackX / 2 + (plan.jitter(p.id, 'cx', 1)) * Math.max(0, slackX) * 0.22;
    // Words still to come take the rest of a row this piece doesn't fill.
    if (plan.wordsWaiting && r.y0 <= room.y0 + 1 && slackX >= plan.wordsWaiting + GAP) cx = r.x0;
    if (plan.arrangement === 'turned_away') cx = r.x0 + (r.x0 + w0 / 2 < STAGE.W / 2 ? 0 : slackX);
    if (plan.arrangement === 'facing' && slackX > 0) cx = r.x0 + (r.x0 + w0 / 2 < STAGE.W / 2 ? slackX : 0);
    const cy = r.y0 + slackY / 2 + plan.jitter(p.id, 'cy', 1) * Math.max(0, slackY) * 0.22;
    const box = { x: clamp(cx, room.x0, room.x1 - fit.w), y: clamp(cy, room.y0, room.y1 - fit.h - tagH), ...fit };
    plan.placed.set(p.id, placeShown(p, box, rot));
    if (tag) plan.reserved.push({ id: `under:${p.id}`, owner: p.id, at: p.at, until: p.until, x: box.x, y: box.y + box.h + WORD_GAP, w: tag.w, h: tag.h, w0: box.w });
  }
  // The person a line is about is the largest; figures of equal standing are equal.
  const drawnPeople = loose.filter((p) => p.kind === 'drawing' && (p.media?.people ?? []).filter(Boolean).length);
  if (drawnPeople.length > 1) {
    const size = (p) => { const pl = plan.placed.get(p.id); return pl.h * p.vis.h; };
    const plain = drawnPeople.filter((p) => p.role !== 'lead');
    const lead = drawnPeople.find((p) => p.role === 'lead');
    const least = Math.min(...plain.map(size));
    const most = lead ? size(lead) / 1.12 : Infinity;
    for (const p of plain) {
      const cap = Math.min(least * 1.15, most);
      if (size(p) > cap) {
        const pl = plan.placed.get(p.id);
        const seen = boxInFrame({ ...pl, rot: 0 }, p.vis);
        const k = cap / seen.h;
        plan.placed.set(p.id, placeShown(p, { x: seen.x + (seen.w * (1 - k)) / 2, y: seen.y + (seen.h * (1 - k)) / 2, w: seen.w * k, h: seen.h * k }, pl.rot));
        const tag = plan.reserved.find((x) => x.id === `under:${p.id}`);
        if (tag) { tag.x = seen.x + (seen.w * (1 - k)) / 2; tag.y = seen.y + (seen.h * (1 + k)) / 2 + WORD_GAP; }
      }
    }
  }
  return true;
}

/** I2: depth from what would be hidden. Edges a→b mean a behind b. Null on a cycle. */
function deriveDepth(pieces, placed, keepMax = STAGE.keepMax) {
  const ids = pieces.map((p) => p.id);
  const after = new Map(ids.map((id) => [id, new Set()]));
  const degree = new Map(ids.map((id) => [id, 0]));
  const edge = (a, b) => { if (!after.get(a).has(b)) { after.get(a).add(b); degree.set(b, degree.get(b) + 1); } };
  for (const a of pieces) {
    for (const b of pieces) {
      if (a === b || !together(a, b)) continue;
      if (b.kind === 'fill') edge(b.id, a.id);
      else if (a.kind !== 'fill' && !(isPlaced(a) && isPlaced(b)) && keepCovered(a, placed.get(a.id), b, placed.get(b.id)) > keepMax) edge(a.id, b.id);
    }
    if (a.onto && after.has(a.onto.piece)) edge(a.onto.piece, a.id);
  }
  const rank = (p) => (LAYER_RANK[p.kind] ?? 2) * 100 + (p.role === 'lead' ? 40 : 0) + Math.min(50, (p.at ?? 0) * 5);
  const out = [];
  const ready = pieces.filter((p) => degree.get(p.id) === 0);
  while (ready.length) {
    ready.sort((x, y) => rank(x) - rank(y) || x.index - y.index);
    const p = ready.shift();
    out.push(p.id);
    for (const q of after.get(p.id)) {
      degree.set(q, degree.get(q) - 1);
      if (degree.get(q) === 0) ready.push(pieces.find((x) => x.id === q));
    }
  }
  return out.length === pieces.length ? new Map(out.map((id, i) => [id, i + 1])) : null;
}

/** A free side of a head for marks of an inner state. Null when neither has room: the solve shrinks, the shot pulls back. */
const HAIR_ROOM = [1, 1.12, 1.25, 1.4];
const HAIR_LIMITS = [0.03, 0.15, 1];
function markSpot(mark, plan, taken) {
  const p = plan.byId.get(mark.on);
  const pl = plan.placed.get(mark.on);
  if (!p || !pl || !p.markable || !EXPRESSIONS[mark.kind]) return null;
  const faceBox = { x: pl.x + p.face.x * pl.w, y: pl.y + p.face.y * pl.h, w: p.face.w * pl.w, h: p.face.h * pl.h };
  const head = { x: pl.x + p.head.x * pl.w, y: pl.y + p.head.y * pl.h, w: p.head.w * pl.w, h: p.head.h * pl.h };
  const headCx = head.x + head.w / 2;
  // Argue marks go between the heads; the rest take the head's roomier side first.
  const peers = [...plan.placed.entries()].filter(([id]) => id !== mark.on && plan.byId.get(id).kind === 'person');
  const toward = peers.length ? Math.sign(peers.reduce((n, [id, q]) => n + (q.x + q.w / 2 - headCx), 0)) || 1 : headCx < STAGE.W / 2 ? 1 : -1;
  const sides = mark.side ? [mark.side, -mark.side] : mark.kind === 'argue' ? [toward, -toward] : [headCx < STAGE.W / 2 ? 1 : -1, headCx < STAGE.W / 2 ? -1 : 1];
  // Marks clear the hair (I18): a measured head box is narrower than the hair round it, so the silhouette decides.
  const onHair = (box) => (p.shape ? boxOnBody(box, p, pl) : 0);
  // Clear of the hair first, either side, at any room; only then the least it can touch.
  const tries = [...HAIR_LIMITS.flatMap((most) => sides.flatMap((side) => HAIR_ROOM.map((k) => ({ side, k, most }))))];
  for (const { side, k, most } of tries) {
    const roomy = { x: head.x + (head.w * (1 - k)) / 2, y: head.y + (head.h * (1 - k)) / 2, w: head.w * k, h: head.h * k };
    const box = expressionBounds(mark.kind, faceBox, side, roomy);
    if (!box) continue;
    if (box.x < 24 || box.x + box.w > STAGE.W - 24 || box.y < plan.ceiling - 24) continue;
    if (onHair(box) > most) continue;
    let clear = true;
    for (const [id, q] of plan.placedPieces()) {
      if (id === mark.on || !together(q, plan.byId.get(mark.on))) continue;
      if (q.kind !== 'fill' && keepUnderBox(box, q, plan.placed.get(id)) > STAGE.keepMax) { clear = false; break; }
      if (q.kind === 'fill' && !q.softKeep && keepUnderBox(box, q, plan.placed.get(id)) > STAGE.keepMax) { clear = false; break; }
    }
    if (clear && taken.some((t) => overlap(box, t))) clear = false;
    if (clear) return { id: mark.id, on: mark.on, kind: mark.kind, side, box, face: faceBox, head: roomy, roomK: k };
  }
  return null;
}

/** Whether words may lie here: no keep, no chest, nothing already placed at the same time; `body`: how much of them may lie on a figure. */
function wordsClear(r, l, plan, taken, body = 0) {
  // On the ledge, nothing's body is in the way: it stands behind.
  const onLedge = r.y >= plan.ledge + 16;
  for (const [id, q] of plan.placedPieces()) {
    if (!together(l, q)) continue;
    const pl = plan.placed.get(id);
    if (q.kind === 'fill') { if (!q.softKeep && keepUnderBox(r, q, pl) > STAGE.keepMax) return false; continue; }
    if (keepUnderBox(r, q, pl) > STAGE.keepMax) return false;
    if (onLedge) continue;
    if (q.kind === 'person') {
      const chest = chestOf(q, pl);
      if (chest && overlap(r, chest)) return false;
      if (boxOnBody(r, q, pl) > body) return false;
    } else if (q.shape && boxOnBody(r, q, pl) > 0.5) return false;
  }
  return !taken.some((t) => together(l, t) && overlap(r, pad(t, 6)));
}

/** A name in clear space beside its owner, above the head, or at the body's outer edge (I17). A word about the frame: a free band, on nobody (I4, I17). */
function labelSpot(label, plan, taken, frameTaken) {
  const size = labelSize(label);
  const { x0, x1 } = STAGE.words;
  const y0 = Math.max(plan.ceilingFor ?? STAGE.top, plan.bounds.y0), y1 = Math.min(STAGE.bottom, plan.bounds.y1);
  const fits = (r) => r.x >= x0 - 0.5 && r.x + r.w <= x1 + 0.5 && r.y >= y0 - 0.5 && r.y + r.h <= y1 + 0.5;
  const keeps = [...plan.placedPieces()].filter(([id, q]) => q.kind !== 'fill' && together(label, q)).map(([id, q]) => ({ id, box: boxInFrame(plan.placed.get(id), q.keep) }));
  if (label.owner && plan.byId.has(label.owner) && plan.placed.has(label.owner)) {
    const reserved = plan.reserved.find((r) => r.id === `under:${label.owner}`);
    const q = plan.byId.get(label.owner);
    if (reserved) {
      const others = plan.reserved.filter((t) => t !== reserved && !taken.includes(t));
      for (const x of [reserved.x, reserved.x + (reserved.w0 ?? 0) / 2 - size.w / 2]) {
        const r = { x: clamp(x, x0, x1 - size.w), y: reserved.y, w: size.w, h: size.h };
        if (fits(r) && wordsClear(r, label, plan, taken.concat(others), 0.02)) return r;
      }
    }
    const own = (keeps.find((k) => k.id === label.owner) ?? { box: boxInFrame(plan.placed.get(label.owner), q.keep) }).box;
    const ownerCx = own.x + own.w / 2;
    const nearest = (r) => {
      const mine = boxGap(r, own);
      const cx = r.x + r.w / 2;
      for (const k of keeps) if (k.id !== label.owner && boxGap(r, k.box) + 1 < mine) return false;
      for (const k of keeps) {
        if (k.id === label.owner) continue;
        const otherCx = k.box.x + k.box.w / 2;
        if (Math.abs(cx - otherCx) + 40 < Math.abs(cx - ownerCx) && plan.byId.get(k.id).kind === 'person') return false;
      }
      return true;
    };
    const outward = ownerCx < STAGE.W / 2 ? -1 : 1;
    const tries = [];
    const side = (dx) => (dx > 0 ? own.x + own.w + WORD_GAP : own.x - WORD_GAP - size.w);
    const pl = plan.placed.get(label.owner);
    const hd = q.head ? boxInFrame(pl, q.head) : own;
    const zone = (x) => clamp(x, x0, x1 - size.w);
    if (q.kind === 'person') {
      // Beside the head, in the clear; a tight bust has room only above the shoulder.
      for (const dx of [outward, -outward]) for (let d = 0; d <= hd.h; d += 24) tries.push({ x: side(dx), y: hd.y + d, body: 0.02 });
      // Above the crown.
      for (let d = WORD_GAP; d <= 120; d += 24) tries.push({ x: zone(hd.x + hd.w / 2 - size.w / 2), y: hd.y - d - size.h, body: 0 });
      // On the ledge, under the owner.
      if (plan.ledge < Infinity) tries.push({ x: zone(hd.x + hd.w / 2 - size.w / 2), y: plan.ledge + 22, body: 0 });
      // At the body's outer edge.
      const outer = outward < 0 ? 0 : 1;
      for (let d = 0; d <= hd.h * 1.6; d += 26) {
        const yy = hd.y + hd.h + d;
        const [ex] = toFrame(pl, outer, (yy - pl.y) / pl.h);
        tries.push({ x: zone(outward < 0 ? Math.max(x0, ex) : Math.min(x1 - size.w, ex - size.w)), y: yy, body: 0.5 });
      }
    } else {
      const x = zone(own.x + own.w / 2 - size.w / 2);
      for (let d = WORD_GAP; d <= 280; d += 26) tries.push({ x, y: own.y + own.h + d, body: 0.02 });
      for (let d = WORD_GAP; d <= 120; d += 26) tries.push({ x, y: own.y - d - size.h, body: 0.02 });
      for (const dx of [outward, -outward]) for (let d = 0; d <= own.h; d += 30) tries.push({ x: side(dx), y: own.y + d, body: 0.02 });
    }
    for (const t of tries) {
      const r = { x: t.x, y: t.y, w: size.w, h: size.h };
      if (fits(r) && nearest(r) && wordsClear(r, label, plan, taken, t.body)) return r;
    }
    return null;
  }
  // A frame label: the free band above everyone, else the foot of the usable area, else wherever is clear of everybody.
  const stacked = frameTaken.length ? frameTaken[frameTaken.length - 1] : null;
  const tries = [];
  if (stacked) tries.push({ x: stacked.x, y: stacked.y + stacked.h + 12 });
  // With the pictures already down, right beside the first that leaves room: a heading, not a stray.
  if (plan.wordsLast) {
    const first = plan.flat.filter((q) => plan.placed.has(q.id) && together(label, q)).sort((a, b) => a.at - b.at)[0];
    if (first) { const b = boxInFrame(plan.placed.get(first.id), first.vis); tries.push({ x: b.x + b.w + GAP, y: b.y + (b.h - size.h) / 2 }); }
  }
  const right = plan.seed % 2 === 1;
  const across = right ? [x1 - size.w, x0] : [x0, x1 - size.w];
  if (plan.ledge < Infinity) for (const x of across) tries.push({ x, y: plan.ledge + 22 });
  for (const x of across) tries.push({ x, y: y0 + 4 });
  for (const x of across) tries.push({ x, y: y1 - size.h });
  for (let y = y0 + 4; y <= y1 - size.h; y += 34) for (const x of [...across, (x0 + x1 - size.w) / 2]) tries.push({ x, y });
  for (const t of tries) {
    const r = { x: t.x, y: t.y, w: size.w, h: size.h };
    if (fits(r) && wordsClear(r, label, plan, taken, 0)) return r;
  }
  return null;
}

/** A speech plate beside its speaker: never on a head, a face or a chin; inside the words zone (I18). */
function plateSpot(sp, plan, taken) {
  const q = plan.byId.get(sp.on);
  const pl = plan.placed.get(sp.on);
  if (!q || !pl) return null;
  const { x0, x1 } = STAGE.words;
  const y0 = Math.max(plan.ceilingFor ?? STAGE.top, STAGE.top), y1 = STAGE.bottom;
  const hd = q.head ? boxInFrame(pl, q.head) : boxInFrame(pl, q.keep);
  const cx = hd.x + hd.w / 2;
  const roomy = cx < STAGE.W / 2 ? 1 : -1;
  const sides = sp.side === 'left' ? [-1, 1] : sp.side === 'right' ? [1, -1] : [roomy, -roomy];
  const widths = [520, 440, 360, 760, 640, 300, 240];
  const clearOf = (r) => {
    if (r.x < x0 - 0.5 || r.x + r.w > x1 + 0.5 || r.y < y0 - 0.5 || r.y + r.h > y1 + 0.5) return false;
    // Never on a head, a face or a chin: anyone's, if they're on together.
    for (const [id, o] of plan.placedPieces()) {
      if (o.kind !== 'person' || !o.head || !together(sp, o)) continue;
      const b = boxInFrame(plan.placed.get(id), o.head);
      if (overlap(r, { ...b, h: b.h * 1.15 })) return false;
    }
    return wordsClear(r, sp, plan, taken, 0.04);
  };
  for (const maxW of widths) {
    const size = plateSize(sp.text, maxW);
    // A plate wider than the usual only makes sense over the head: beside it, it would crowd the frame.
    for (const side of maxW > 520 ? [] : sides) {
      const x = side > 0 ? hd.x + hd.w + 36 : hd.x - 36 - size.w;
      for (let d = -size.h * 0.4; d <= hd.h * 0.5; d += 26) {
        const r = { x, y: hd.y + d, w: size.w, h: size.h };
        if (clearOf(r)) return { ...r, tail: side > 0 ? 'left' : 'right', lines: size.lines, font: size.font };
      }
    }
    // Above the head, its tail pointing down.
    for (let d = 30; d <= 140; d += 26) {
      const r = { x: clamp(cx - size.w / 2, x0, x1 - size.w), y: hd.y - d - size.h, w: size.w, h: size.h };
      if (clearOf(r)) return { ...r, tail: 'bottom', tailX: clamp(cx - r.x, 34, r.w - 34), lines: size.lines, font: size.font };
    }
  }
  return null;
}

/** A piece put on a named spot in another picture: fitted to it. Null when the spot isn't measured. */
function ontoSpot(p, plan) {
  const host = plan.byId.get(p.onto.piece);
  const hostAt = plan.placed.get(p.onto.piece);
  if (!host || !hostAt) return null;
  const r = host.media?.regions ?? {};
  const name = p.onto.box;
  const list = [r.boxes, r.spots, host.media?.boxes];
  let b = null;
  for (const g of list) {
    if (!g) continue;
    if (Array.isArray(g)) {
      const hit = g.find((x) => x?.name === name || x?.id === name || x?.label === name || norm(x?.text) === norm(name));
      if (hit) b = hit.box ?? hit;
    } else if (g[name]) b = g[name];
    if (b) break;
  }
  if (!b && /^photo:?(\d*)$/.test(String(name))) b = (r.photos ?? [])[Number(String(name).replace(/\D/g, '') || 0)];
  if (!b) b = phraseLines(host.media, name)[0] ?? null;
  if (!okBox(b)) return null;
  const px = b.x > 1 || b.w > 1 ? { x: b.x / host.media.width, y: b.y / host.media.height, w: b.w / host.media.width, h: b.h / host.media.height } : b;
  const room = boxInFrame({ ...hostAt, rot: 0 }, px);
  const a = shownAspect(p);
  const w = Math.min(room.w, room.h * a), h = w / a;
  return placeShown(p, { x: room.x + (room.w - w) / 2, y: room.y + (room.h - h) / 2, w, h }, hostAt.rot ?? 0);
}

export const softGround = (p) => Boolean(p.asGround) && p.softKeep && p.media?.kind === 'place_photo';
/** A fill's one placement: cover the frame, the keep whole, its words and faces below the caption band. Null: it can't (I10). */
export function fillPlacement(p, fx = 0.5) {
  const W = STAGE.W, H = STAGE.H;
  const h0 = Math.max(H, W / p.aspect);
  const K = p.keep;
  for (const s of [1, 1.08, 1.18, 1.3, 1.45, 1.6]) {
    const h = h0 * s, w = h * p.aspect;
    // A blurred ground of a place has nothing to keep sharp, and nothing of its own to lose. Anything else stays inside its limit.
    if (w > p.maxW && !softGround(p)) return null;
    const keepW = K.w * w;
    if (!p.softKeep && keepW > W - 60) return null;
    const x = clamp(W * fx - (K.x + K.w / 2) * w, W - w, 0);
    const y = clamp(1050 - (K.y + K.h / 2) * h, H - h, 0);
    if (p.softKeep) return { x, y, w, h, rot: 0 };
    const top = y + K.y * h, bottom = top + K.h * h;
    if (top < 572 || bottom > STAGE.bottom + 40) continue;
    const left = x + K.x * w;
    if (left < 20 || left + keepW > W - 20) continue;
    // A head a whole frame can't be this big.
    if (p.head && p.head.h * h > LIMITS.headOnScreen) return null;
    return { x, y, w, h, rot: 0 };
  }
  return null;
}

/**
 * An arrow between two real items, bent round what's in its way: it never runs through a keep, a label or a plate, and it ends
 * inside the frame. The straightest clear one wins. `crossing` names what the least bad one still hits, when none is clear.
 */
export function routeArrow(a, fb, tb, plan, words = []) {
  const f = plan.byId.get(a.from), t = plan.byId.get(a.to);
  const gap = Math.max(40, boxGap(fb, tb));
  const inWay = [];
  for (const [id, q] of plan.placedPieces()) {
    if (id === a.from || id === a.to || q.kind === 'fill' || !together(q, f) || !together(q, t)) continue;
    inWay.push({ what: id, box: boxInFrame(plan.placed.get(id), q.kind === 'person' ? q.keep : q.vis) });
  }
  for (const l of words) if (l.owner !== a.from && l.owner !== a.to) inWay.push({ what: l.text ?? l.id, box: l });
  const hit = (pts) => {
    for (const o of inWay) {
      const b = pad(o.box, 10);
      if (pts.some(([x, y]) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)) return o.what;
    }
    return null;
  };
  const room = plan.bounds;
  const inFrame = (pts) => pts.every(([x, y]) => x >= room.x0 + 8 && x <= Math.min(room.x1, STAGE.W) - 8 && y >= room.y0 && y <= Math.min(room.y1, STAGE.H));
  let least = null;
  for (const k of ARROW_BENDS) {
    const bend = k * gap;
    const line = arrowBetween(fb, tb, { pad: 18, bend });
    const pts = [...line.shaft.pts, ...line.flick1.pts, ...line.flick2.pts];
    const crossing = hit(pts) ?? (inFrame(pts) ? null : 'the frame\'s edge');
    if (!crossing) return { bend, length: line.shaft.length, crossing: null };
    least ??= { bend, length: line.shaft.length, crossing };
  }
  return least;
}
const RING_ROOM = 44;
const ARROW_BENDS = [0.1, -0.1, 0.3, -0.3, 0.6, -0.6, 1, -1, 1.6, -1.6];

/** One attempt at one size. */
function attempt(base, s, level, opt) {
  const plan = {
    ...base,
    placed: new Map(),
    reserved: [],
    ledge: Infinity,
    progress: 0,
    placedPieces() { return [...plan.placed.keys()].map((id) => [id, plan.byId.get(id)]); },
  };
  // The hook's band is protected before anything is placed.
  plan.ceiling = STAGE.top;
  plan.ceilingFor = STAGE.top;
  if (base.hook) {
    const size = hookBox(base.hook.text);
    const y = Math.max(plan.bounds.y0, STAGE.top) + 6;
    plan.hookAt = { ...base.hook, ...size, x: STAGE.words.x0, y };
    plan.ceiling = y + size.h + WORD_GAP;
    plan.ceilingFor = plan.ceiling;
    plan.reserved.push({ id: 'hook', at: Math.min(base.hook.at ?? 0, LIMITS.hookBy), until: Infinity, x: 0, y: y - 6, w: STAGE.W, h: size.h + 12 });
  }
  // What the solver placed is fixed before anything else, and the rest lays out around it.
  const fixed = plan.flat.filter(isPlaced);
  for (const p of fixed) plan.placed.set(p.id, placeExact(p));
  // Whole-frame pictures.
  for (const f of plan.flat) {
    if (f.kind !== 'fill') continue;
    const pl = fillPlacement(f, opt.fx);
    if (!pl) return { plan, fail: `the picture ${f.id} can't fill the frame` };
    plan.placed.set(f.id, pl);
  }
  const people = plan.flat.filter((p) => p.kind === 'person' && !isPlaced(p));
  if (people.length) placePeople(plan, people, s, opt);
  // Heads stay on the line: a body pushed down by the words above it is too big for this frame.
  if (!opt.lastResort) {
    for (const p of people) {
      const pl = plan.placed.get(p.id);
      if (pl.y + (p.face.y + p.face.h / 2) * pl.h > STAGE.faceBand[1] + 12) return { plan, fail: `${p.id}'s head sits below the line` };
    }
  }
  // The people must be able to share the stage, and stand clear of a background's keep.
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i], b = people[j];
      if (!together(a, b)) continue;
      if (keepCovered(a, plan.placed.get(a.id), b, plan.placed.get(b.id)) > STAGE.keepMax && keepCovered(b, plan.placed.get(b.id), a, plan.placed.get(a.id)) > STAGE.keepMax) return { plan, fail: 'people' };
    }
    for (const f of plan.flat) {
      if (f.kind !== 'fill' || f.softKeep || !together(people[i], f)) continue;
      if (keepCovered(people[i], plan.placed.get(people[i].id), f, plan.placed.get(f.id)) > STAGE.keepMax) return { plan, fail: `background: ${people[i].id} covers ${f.id}` };
    }
    for (const q of fixed) {
      if (!together(people[i], q)) continue;
      const pl = plan.placed.get(people[i].id), ql = plan.placed.get(q.id);
      if (keepCovered(people[i], pl, q, ql) > STAGE.keepMax && keepCovered(q, ql, people[i], pl) > STAGE.keepMax) return { plan, fail: `${people[i].id} and the placed ${q.id} cover each other` };
    }
  }
  plan.progress = 1;
  // The ledge: it hides what the frame doesn't.
  const need = ledgeNeeded(plan);
  if (need < Infinity) {
    plan.ledge = need - 14;
    if (plan.ledge < LIMITS.ledgeTop && !opt.lastResort) return { plan, fail: 'open edge above the ledge' };
    // What was measured and isn't the person (a cup taken for a face) stays under the ledge, when the ledge can reach it.
    for (const p of people) {
      const pl = plan.placed.get(p.id);
      if (!p.measuredHead) continue;
      for (const f of p.media?.regions?.faces ?? []) {
        if (f.trusted !== false || f.y <= p.face.y + p.face.h) continue;
        const top = pl.y + f.y * pl.h - 14;
        const chin = pl.y + (p.face.y + p.face.h) * pl.h + LIMITS.neck * 2;
        if (top < plan.ledge && top > chin && top >= LIMITS.ledgeTop) plan.ledge = top;
      }
    }
    // The ledge never sits on a chin: a head needs something under it.
    for (const p of people) {
      const pl = plan.placed.get(p.id);
      if (!p.measuredHead || plan.ledge >= pl.y + (p.face.y + p.face.h) * pl.h + LIMITS.neck) continue;
      if (!opt.lastResort) return { plan, fail: `the ledge sits on ${p.id}'s chin` };
      plan.ledgeOnChin = true;
    }
    plan.ledge = Math.max(plan.ledge, LIMITS.ledgeTop);
    if (need - 14 < LIMITS.ledgeTop) plan.openEdgeShown = true;
    // It rises a little to carry a word about the frame: bodies stand behind it, and that band is free.
    const band = Math.max(0, ...plan.labels.filter((l) => !l.owner).map((l) => labelSize(l).h));
    const chins = Math.max(0, ...people.map((p) => { const b = boxInFrame(plan.placed.get(p.id), p.keep); return b.y + b.h + 8; }));
    // However high it would rise, it stops short of a chin.
    const heads = Math.max(0, ...people.filter((p) => p.measuredHead).map((p) => { const pl = plan.placed.get(p.id); return pl.y + (p.face.y + p.face.h) * pl.h + LIMITS.neck; }));
    if (band) plan.ledge = Math.max(LIMITS.ledgeTop, chins, opt.lastResort ? 0 : heads, Math.min(plan.ledge, STAGE.bottom - band - 34));
    // A chin held the ledge under an edge it has to hide: this size won't do.
    if (plan.ledge > need - 13) {
      if (!opt.lastResort) return { plan, fail: 'the ledge can clear the chin or hide the edge, not both' };
      plan.openEdgeShown = true;
    }
  }
  // A placed piece's cut edge in frame gets the ledge when the ledge can reach it; when it can't, the edge shows and the checks say so.
  if (fixed.length) {
    const edge = ledgeNeeded(plan, true);
    if (edge < Infinity && edge - 14 >= LIMITS.ledgeTop) plan.ledge = Math.min(plan.ledge, edge - 14);
  }
  plan.progress = 2;
  // What has one place to be goes first: marks, then names, then frame words, then plates.
  const taken = plan.reserved.filter((r) => r.id === 'hook');
  const marks = [];
  const lateMarks = [];
  for (const m of plan.marks) {
    if (!EXPRESSIONS[m.kind]) continue;
    const q = plan.byId.get(m.on);
    if (q?.kind !== 'person') { lateMarks.push(m); continue; }
    if (!q.markable) continue;
    const spot = markSpot(m, plan, taken);
    if (!spot) {
      // A mark never takes the whole frame down with it: at the last it's dropped, and the manifest says so.
      if (opt.lastResort) continue;
      return { plan, fail: `no room for ${m.kind} marks on ${m.on}` };
    }
    marks.push(spot);
    const held = { ...spot.box, at: q.at, until: q.until };
    taken.push(held);
    plan.reserved.push({ ...held, id: `mark:${m.id}`, owner: m.on });
  }
  const labels = [];
  const frameTaken = [];
  const labelFor = (l) => {
    const r = labelSpot(l, plan, taken, frameTaken);
    if (!r) return false;
    const entry = { ...l, ...r };
    labels.push(entry);
    taken.push(entry);
    plan.reserved.push(entry);
    if (!l.owner) frameTaken.push(r);
    return true;
  };
  for (const l of plan.labels.filter((x) => x.owner && plan.byId.get(x.owner)?.kind === 'person')) {
    if (!labelFor(l)) return { plan, fail: `no room for the label "${l.text}"` };
  }
  // With nobody on stage the pictures are the frame: its words take what they leave, unless they leave none.
  const openLoose = plan.flat.filter((p) => p.kind !== 'person' && p.kind !== 'fill' && !p.onto && !isPlaced(p));
  const frameWords = plan.labels.filter((x) => !x.owner);
  const wordsAfter = !opt.wordsFirst && !people.length && !plan.onBoard && frameWords.length > 0 && openLoose.length > 0 && !plan.flat.some((f) => f.kind === 'fill') && !openLoose.some((p) => p.belongs && !openLoose.some((q) => q.id === p.belongs));
  if (!wordsAfter) {
    for (const l of frameWords) {
      if (!labelFor(l)) return { plan, fail: `no room for the label "${l.text}"` };
    }
  }
  plan.progress = 3;
  const plates = [];
  const plateFor = (sp) => {
    const r = plateSpot(sp, plan, taken);
    if (!r) return false;
    const entry = { ...sp, ...r };
    plates.push(entry);
    taken.push(entry);
    plan.reserved.push(entry);
    return true;
  };
  for (const sp of plan.speech.filter((x) => plan.placed.has(x.on))) {
    if (!plateFor(sp)) return { plan, fail: `no room for the speech "${String(sp.text).slice(0, 24)}"` };
  }
  plan.progress = 4;
  // Loose pieces.
  const loose = plan.flat.filter((p) => p.kind !== 'person' && p.kind !== 'fill' && !p.onto && !isPlaced(p)).sort((a, b) => looseOrder(a) - looseOrder(b) || a.index - b.index);
  // A fill's keep, or what's measured as its subject, is something to stand clear of: pieces go where it isn't.
  const withPeople = people.length > 0 || plan.flat.some((f) => f.kind === 'fill' && (!f.softKeep || (f.focus && loose.some((p) => together(p, f)))));
  let done = false;
  if (wordsAfter) plan.wordsWaiting = Math.max(...frameWords.map((l) => labelSize(l).w));
  if (!withPeople && !fixed.length && loose.length && !loose.some((p) => p.belongs && !loose.some((q) => q.id === p.belongs))) done = placeSliced(loose, plan, s);
  plan.wordsWaiting = 0;
  plan.wordsLast = wordsAfter;
  if (wordsAfter) {
    const missed = !done || frameWords.some((l) => !labelFor(l));
    if (missed) return attempt(base, s, level, { ...opt, wordsFirst: true });
  }
  if (!done) {
    plan.placed = new Map([...plan.placed].filter(([id]) => !loose.some((p) => p.id === id)));
    plan.reserved = plan.reserved.filter((r) => !String(r.id).startsWith('under:') || labels.some((l) => l.id === r.id));
    for (const p of loose) {
      if (placeFree(p, plan, s, level)) continue;
      // What a soft fill's subject leaves may be too little at the last: better over it than nowhere, and the manifest says so.
      if (!opt.lastResort || !plan.flat.some((f) => f.kind === 'fill' && f.focus && together(p, f))) return { plan, fail: `no spot for ${p.id}` };
      plan.overFocus = true;
      plan.overFocusBy = p.id;
      const placedOver = placeFree(p, plan, s, level);
      plan.overFocus = false;
      if (!placedOver) return { plan, fail: `no spot for ${p.id}` };
    }
    grow(loose, plan, s, level);
  }
  for (const p of plan.flat.filter((x) => x.onto && !isPlaced(x))) {
    const pl = ontoSpot(p, plan);
    if (pl) plan.placed.set(p.id, pl);
    else {
      plan.ontoMissed = [...(plan.ontoMissed ?? []), p.id];
      if (!placeFree(p, plan, s, level)) return { plan, fail: `no spot for ${p.id}` };
    }
  }
  plan.progress = 5;
  const z = deriveDepth(plan.flat, plan.placed);
  if (!z) return { plan, fail: 'depth cycle' };
  plan.z = z;
  for (const m of lateMarks) {
    const q = plan.byId.get(m.on);
    if (!q?.markable) continue;
    const spot = markSpot(m, plan, taken);
    // A mark on a drawing is a touch: no spot for it isn't worth shrinking the whole board.
    if (!spot) continue;
    marks.push(spot);
    taken.push({ ...spot.box, at: q.at, until: q.until });
  }
  plan.solvedMarks = marks;
  for (const l of plan.labels.filter((x) => x.owner && plan.byId.get(x.owner)?.kind !== 'person')) {
    if (!labelFor(l)) return { plan, fail: `no room for the label "${l.text}"` };
  }
  for (const sp of plan.speech.filter((x) => !plates.some((y) => y.id === x.id))) {
    if (!plateFor(sp)) return { plan, fail: `no room for the speech "${String(sp.text).slice(0, 24)}"` };
  }
  plan.solvedPlates = plates;
  plan.solvedLabels = labels;
  // Arrows: between the two real items, long enough to read as one.
  const arrows = [];
  for (const a of plan.arrows) {
    const f = plan.byId.get(a.from), t = plan.byId.get(a.to);
    if (!f || !t || !plan.placed.has(a.from) || !plan.placed.has(a.to)) continue;
    const fb = boxInFrame(plan.placed.get(a.from), f.kind === 'person' ? f.keep : f.vis);
    const tb = boxInFrame(plan.placed.get(a.to), t.kind === 'person' ? t.keep : t.vis);
    const route = routeArrow(a, fb, tb, plan, [...labels, ...plates]);
    if (route.length < LIMITS.arrowMin && !opt.lastResort) return { plan, fail: `the arrow ${a.from} to ${a.to} is only ${Math.round(route.length)}px` };
    if (route.crossing && !opt.lastResort) return { plan, fail: `the arrow ${a.from} to ${a.to} crosses ${route.crossing}` };
    if (route.crossing) plan.arrowCrossing = [...(plan.arrowCrossing ?? []), `${a.from} to ${a.to}`];
    arrows.push({ ...a, fromBox: fb, toBox: tb, length: route.length, bend: route.bend, id: a.id ?? `arrow-${arrows.length}` });
  }
  plan.solvedArrows = arrows;
  return { plan, fail: null };
}
const looseOrder = (p) => (p.belongs ? 5 : p.role === 'lead' ? 0 : p.kind === 'print' || p.kind === 'card' || p.kind === 'drawing' || p.kind === 'words' || p.kind === 'custom' ? 1 : p.kind === 'thing' ? 2 : p.kind === 'note' ? 3 : 4);

/** Faces on the subject line first, at every size. Lower only once no size fits there. */
const LINES = [1060, 1100, 1000];
const LOW_LINES = [1140, 1180];
const SPREADS = [1, 0.9, 1.08];
const FILL_X = [0.5, 0.3, 0.7];

/**
 * A small inset with cut sides can only be hidden by a ledge, and the ledge would rise over a lead whose own body runs off the
 * frame's foot, leaving a head with no shoulders. The inset becomes a print on paper instead: it has no edge to hide. Pure.
 */
function insetsAsPrints(flat, arrangement) {
  if (arrangement !== 'lead_inset') return flat;
  const lead = flat.find((p) => p.kind === 'person' && p.role === 'lead');
  if (!lead?.head || lead.open?.left || lead.open?.right) return flat;
  const cast = flat.filter((p) => p.kind === 'person').length;
  const target = headTarget(Math.max(1, cast - 1)) * LEAD_HEAD;
  const reach = (footOf(lead.open) - (lead.face.y + lead.face.h / 2)) * (target / Math.max(0.02, lead.head.h));
  if (STAGE.subject[1] + reach < STAGE.H) return flat;
  return flat.map((p) => {
    if (p === lead || p.kind !== 'person' || p.belongs || !(p.open?.left || p.open?.right)) return p;
    return { ...preparePiece({ ...p, pts: undefined, kind: 'print', asPrint: 'inset' }), index: p.index };
  });
}

/** Everything a solve needs that doesn't change between attempts. */
function baseOf(moment) {
  let flat = (moment.pieces ?? []).map((p, index) => ({ ...preparePiece(p), index }));
  const notes = [];
  // A whole-frame picture that can't be one is a print, on its own blurred ground (I10).
  flat = flat.map((p) => {
    if (p.kind !== 'fill') return p;
    if (fillPlacement(p, 0.5) || fillPlacement(p, 0.3) || fillPlacement(p, 0.7)) return p;
    notes.push(`fill_print: ${p.id} can't fill the frame without cutting what it shows; it's a print`);
    return { ...preparePiece({ ...p, pts: undefined, fill: false, kind: pieceKind(p.source) === 'card' ? 'card' : 'print' }), index: p.index, backdrop: true };
  });
  flat = insetsAsPrints(flat, moment.arrangement);
  const byId = new Map(flat.map((p) => [p.id, p]));
  const seed = moment.seed ?? hashString(flat.map((p) => p.id).join('|'));
  const style = moment.style ?? 'cutouts';
  const tiltRnd = seeded(seed ^ 0x5bd1e995);
  const arrangement = moment.arrangement && moment.arrangement !== 'auto' ? moment.arrangement : pickArrangement(flat);
  const lean = arrangement === 'facing' ? 2.2 : arrangement === 'turned_away' ? -3.2 : 0;
  const tilts = new Map(flat.map((p) => {
    const r = tiltRnd();
    const range = p.kind === 'fill' || p.onto ? 0 : style === 'paper' ? (p.kind === 'person' ? 2 : p.kind === 'logo' ? 4 : 5) : p.kind === 'print' || p.kind === 'card' ? 1.5 : 0;
    const sign = r < 0.5 ? -1 : 1;
    return [p.id, range ? sign * (range * 0.35 + range * 0.65 * ((r * 2) % 1)) : 0];
  }));
  const jitterOf = (id, axis, amount) => ((hashString(`${seed}:${id}:${axis}`) % 2001) / 1000 - 1) * amount;
  const bounds = moment.bounds ?? { x0: 0, x1: STAGE.W, y0: STAGE.top, y1: STAGE.H };
  const labels = (moment.labels ?? []).map((l, i) => {
    const maxW = l.owner ? 520 : 844;
    const lines = labelLines(l.text, l.sub, maxW, l.kind ?? 'label');
    return { id: l.id ?? `label-${i}`, kind: 'label', at: l.at ?? 0, until: l.until ?? Infinity, ...l, ...lines };
  });
  const arrows = (moment.arrows ?? []).filter((a) => byId.has(a.from) && byId.has(a.to));
  return {
    pieces: flat, flat, byId, seed, style, arrangement, bounds, labels, notes,
    marks: (moment.marks ?? []).filter((m) => byId.has(m.on)).map((m, i) => ({ id: m.id ?? `mark-${i}`, ...m })),
    speech: (moment.speech ?? []).filter((sp) => byId.has(sp.on)).map((sp, i) => ({ id: sp.id ?? `speech-${i}`, ...sp, at: sp.at ?? byId.get(sp.on).at, until: sp.until ?? Infinity })),
    hook: moment.hook?.text ? { ...moment.hook, at: Math.min(moment.hook.at ?? 0, LIMITS.hookBy) } : null,
    arrows,
    arrowLinks: arrows.map((a) => [a.from, a.to]),
    order: moment.order ?? null,
    onBoard: Boolean(moment.bounds),
    tilt: (p) => {
      const t = tilts.get(p.id) ?? 0;
      if (lean && p.kind === 'person') {
        const i = flat.filter((q) => q.kind === 'person').indexOf(p);
        return t + (i % 2 ? -lean : lean);
      }
      return t;
    },
    jitter: jitterOf,
  };
}

/**
 * One arrangement for one set of pieces, each with its own lifetime. `moment`: { pieces, labels?, marks?, speech?, hook?,
 * arrows?, arrangement?, style?, seed?, bounds?, order? }. A label: { id, text, sub, kind, owner (a piece id; none = a frame
 * label) }. A mark: { id, kind, on, side? }. Returns { pieces, labels, marks, speech, hook, arrows, ledge, report }. Always
 * returns a layout (I6).
 */
export function solveStage(moment) {
  let base = baseOf(moment);
  const run = () => {
    const people = base.flat.some((p) => p.kind === 'person');
    const hardFill = people && base.flat.some((p) => p.kind === 'fill' && !p.softKeep);
    const xs = hardFill ? FILL_X : [0.5];
    let best = null;
    let tries = 0;
    const why = new Map();
    const passes = people ? [{ last: false, lines: LINES }, { last: false, lines: LOW_LINES }, { last: true, lines: [...LINES, ...LOW_LINES] }, { last: true, plain: true, lines: [...LINES, ...LOW_LINES] }] : [{ last: false, lines: [LINES[0]] }, { last: true, lines: [LINES[0]] }];
    for (const { last, plain, lines } of passes) {
      for (let level = 0; level < LEVELS.length; level++) {
        for (const s of SHRINK) {
          for (const cy of lines) {
            for (const spread of people ? SPREADS : [1]) {
              for (const fx of xs) {
                tries += 1;
                const got = attempt(base, s, level, { cy, spread, fx, lastResort: last, plain });
                if (!got.fail) return { ...got, s, level, cy, tries };
                why.set(got.fail, (why.get(got.fail) ?? 0) + 1);
                if (!best || best.plan.progress < got.plan.progress || (best.plan.progress === got.plan.progress && best.plan.placed.size < got.plan.placed.size)) best = { ...got, s, level, cy, tries };
              }
            }
          }
        }
      }
    }
    return { ...best, tries, why };
  };
  let best = run();
  if (best.fail && base.flat.some((p) => p.kind === 'fill' && !p.softKeep)) {
    // Nothing can stand clear of what the background shows: it becomes a print of its own, and they stand beside it.
    const before = base;
    const kept = best;
    base = baseOf({ ...moment, pieces: moment.pieces.map((p) => (p.fill || (p.pts && p.kind === 'fill') ? { ...p, pts: undefined, fill: false, kind: undefined, demoted: true } : p)) });
    base.notes.push('fill_print: the frame could not stand clear of what the background shows; it is a print beside them');
    best = run();
    if (best.fail) { base = before; best = kept; }
  }
  return finish(best, base, best.tries);
}

function finish(best, base, tries) {
  const plan = best.plan;
  const report = { arrangement: base.arrangement, style: base.style, shrink: best.s, overlap: best.level, tries, tight: Boolean(best.fail), flags: [], notes: [...base.notes] };
  if (best.fail) {
    report.flags.push('stage_tight');
    report.notes.push(`stage_tight: ${best.fail}`);
    // Whatever didn't get a spot sits as small as allowed in the least bad place: a layout always comes back.
    fallbackRest(plan);
    // A solve that stopped early still has bodies to hide: nobody stops in mid-air (I7).
    if (!Number.isFinite(plan.ledge)) {
      const need = ledgeNeeded(plan);
      if (need < Infinity) {
        plan.ledge = Math.max(need - 14, LIMITS.ledgeTop);
        if (need - 14 < LIMITS.ledgeTop) plan.openEdgeShown = true;
      }
    }
  }
  if (plan.openEdgeShown) { report.flags.push('open_edge'); report.notes.push('open_edge: a cut edge stands above the ledge\'s limit'); }
  if (plan.ledgeOnChin) report.notes.push('ledge_on_chin: no clean answer left a neck over the ledge');
  if (plan.arrowCrossing?.length) report.notes.push(`arrow_crossing: ${plan.arrowCrossing.join(', ')} couldn't be routed clear`);
  if (plan.ontoMissed?.length) report.notes.push(`onto_missing: ${plan.ontoMissed.join(', ')} have no measured spot on their picture`);
  const z = placedDepth(plan.z ?? deriveDepth(plan.flat, plan.placed) ?? new Map(plan.flat.map((p, i) => [p.id, i + 1])), plan.flat);
  const pieces = plan.flat.map((p) => {
    const pl = plan.placed.get(p.id);
    const naturalH = p.media?.height > 0 ? p.media.height : pl.h;
    const visBottom = pl.y + (p.vis.y + p.vis.h) * pl.h;
    return {
      id: p.id, x: pl.x, y: pl.y, w: pl.w, h: pl.h, rot: pl.rot ?? 0, scale: pl.h / naturalH, z: z.get(p.id) ?? 1,
      kind: p.kind,
      at: p.at, until: p.until,
      bleeds: visBottom > STAGE.H,
    };
  });
  const labels = plan.solvedLabels ?? fallbackLabels(plan);
  return {
    pieces,
    labels: labels.map((l) => ({ id: l.id, owner: l.owner ?? null, x: l.x, y: l.y, w: l.w, h: l.h, text: l.text, sub: l.sub ?? null, wrap: l.wrap ?? null, kind: l.kind, at: l.at, until: l.until })),
    marks: plan.solvedMarks ?? fallbackMarks(plan),
    speech: plan.solvedPlates ?? fallbackPlates(plan),
    hook: plan.hookAt ?? null,
    arrows: plan.solvedArrows ?? fallbackArrows(plan),
    ledge: Number.isFinite(plan.ledge) ? plan.ledge : null,
    report,
    plan,
  };
}

function fallbackRest(plan) {
  const b = plan.bounds;
  plan.flat.forEach((p, i) => {
    if (plan.placed.has(p.id)) return;
    if (p.kind === 'fill') {
      const h = Math.max(STAGE.H, STAGE.W / p.aspect), w = h * p.aspect;
      plan.placed.set(p.id, { x: (STAGE.W - w) / 2, y: (STAGE.H - h) / 2, w, h, rot: 0 });
      return;
    }
    if (p.kind === 'person') {
      const h = LIMITS.headMin / Math.max(0.02, p.head?.h ?? 0.3), w = h * p.aspect;
      plan.placed.set(p.id, { x: clamp(b.x0 + 30 + (i % 3) * 320, b.x0, b.x1 - w), y: 900, w, h, rot: 0 });
      return;
    }
    const h = Math.min(220, 220 / Math.max(1, p.aspect));
    const w = h * p.aspect;
    const cols = 3;
    plan.placed.set(p.id, { x: clamp(b.x0 + 30 + (i % cols) * 320, b.x0, b.x1 - w), y: clamp(STAGE.top + 10 + Math.floor(i / cols) * 240, b.y0, STAGE.bottom - h), w, h, rot: 0 });
  });
}
function fallbackLabels(plan) {
  const out = [];
  const taken = [];
  for (const l of plan.labels) {
    const r = labelSpot(l, plan, taken, []) ?? labelSpot({ ...l, owner: null }, plan, taken, []) ?? { ...labelSize(l), x: STAGE.words.x0, y: Math.min(STAGE.bottom - 60, STAGE.top + 4 + taken.length * 80) };
    const box = { x: r.x, y: r.y, w: r.w, h: r.h };
    out.push({ ...l, ...box });
    taken.push({ ...box, at: l.at, until: l.until });
  }
  return out;
}
function fallbackMarks(plan) {
  const out = [];
  for (const m of plan.marks) {
    if (!EXPRESSIONS[m.kind] || !plan.placed.has(m.on)) continue;
    const spot = markSpot(m, plan, []);
    if (spot) out.push(spot);
    else out.push({ id: m.id, on: m.on, kind: m.kind, side: 0, box: null, skipped: true });
  }
  return out;
}
function fallbackPlates(plan) {
  const out = [];
  const taken = [];
  for (const sp of plan.speech) {
    const r = plateSpot(sp, plan, taken);
    const size = plateSize(sp.text, 440);
    const box = r ?? { x: STAGE.words.x0, y: STAGE.top + 4 + out.length * (size.h + 12), w: size.w, h: size.h, tail: null, lines: size.lines, font: size.font };
    out.push({ ...sp, ...box });
    taken.push({ ...sp, ...box });
  }
  return out;
}
function fallbackArrows(plan) {
  return plan.arrows.filter((a) => plan.placed.has(a.from) && plan.placed.has(a.to)).map((a, i) => {
    const fb = boxInFrame(plan.placed.get(a.from), plan.byId.get(a.from).vis), tb = boxInFrame(plan.placed.get(a.to), plan.byId.get(a.to).vis);
    return { ...a, fromBox: fb, toBox: tb, length: arrowBetween(fb, tb, { pad: 18 }).shaft.length, bend: 0.1 * boxGap(fb, tb), id: a.id ?? `arrow-${i}` };
  });
}

/** Every violation of a finished layout, recomputed from nothing. The tests and the fallback use it. */
export function violations(plan) {
  const out = [];
  const { placed, z, flat } = plan;
  for (const a of flat) {
    if (!placed.has(a.id)) { out.push({ rule: 'I1', piece: a.id, why: 'no place' }); continue; }
    for (const b of flat) {
      if (a === b || !placed.has(b.id) || !together(a, b)) continue;
      if ((z?.get(a.id) ?? 0) > (z?.get(b.id) ?? 0) && keepCovered(a, placed.get(a.id), b, placed.get(b.id)) > STAGE.keepMax) out.push({ rule: 'I1', piece: b.id, by: a.id });
    }
  }
  return out;
}

// ── Through time (I5, I8) ────────────────────────────────────────────────────────────────────────────

/** Every moment a piece arrives or leaves, as times from 0. Pure. */
export function stageMoments(pieces, duration = Infinity) {
  const times = new Set([0]);
  for (const p of pieces) {
    if (p.at > 0 && p.at < duration) times.add(p.at);
    if (Number.isFinite(p.until) && p.until < duration) times.add(p.until);
  }
  return [...times].sort((a, b) => a - b).filter((t, i, all) => i === 0 || t - all[i - 1] > 1e-6);
}

/** Whether nothing gets covered as `a` slides to `b` (the shared pieces at 1/4, 1/2 and 3/4 of the slide). */
export function slideClean(prepared, a, b, z) {
  const from = new Map(a.pieces.map((p) => [p.id, p]));
  const to = new Map(b.pieces.map((p) => [p.id, p]));
  const shared = prepared.filter((p) => from.has(p.id) && to.has(p.id));
  for (const u of [0.25, 0.5, 0.75]) {
    const at = new Map(shared.map((p) => {
      const A = from.get(p.id), B = to.get(p.id);
      const L = (k) => A[k] + (B[k] - A[k]) * u;
      return [p.id, { x: L('x'), y: L('y'), w: L('w'), h: L('h'), rot: L('rot') }];
    }));
    for (const q of shared) {
      for (const r of shared) {
        if (q === r || (z.get(q.id) ?? 0) <= (z.get(r.id) ?? 0)) continue;
        if (keepCovered(q, at.get(q.id), r, at.get(r.id)) > STAGE.keepMax) return false;
      }
    }
  }
  return true;
}

/** Code's word on when a label is up (I17): after its owner lands, for a beat, or until the next person arrives. */
function labelLife(l, owner, prepared) {
  const earliest = owner && owner.at > 0 ? owner.at + 0.35 : 0;
  const at = Math.max(l.at ?? 0, earliest);
  const asked = l.until ?? Infinity;
  if (l.kind === 'number') return { at, until: Math.min(asked, owner?.until ?? Infinity), moved: at !== (l.at ?? 0) };
  if (!owner) return { at, until: Math.min(asked, at + LIMITS.dateBeat), moved: at !== (l.at ?? 0) };
  const next = Math.min(Infinity, ...prepared.filter((q) => q !== owner && q.kind === 'person' && q.at > at).map((q) => q.at));
  const beat = Math.min(at + LIMITS.labelBeat, Math.max(next, at + LIMITS.labelRead));
  return { at, until: Math.min(asked, owner.until, beat), moved: at !== (l.at ?? 0) };
}

/**
 * The stage through time: one layout, and the moments it passes through. `spec`: { pieces, labels, marks, speech, hook, arrows,
 * arrangement, style, seed, bounds, duration, camera, peak, in_turn, ground_tone }. A piece's `at` and `until` are seconds.
 * Returns { moments: [{ t, pieces, labels, marks, report }], z, labelTimes, camera, speech, hook, arrows, ledge, groundTone, report }. Pure.
 */
export function solveTimeline(spec) {
  const notes = [];
  // Arrivals spaced in turn are settled before anything is placed.
  const atOf = new Map();
  for (const run of spec.in_turn ?? []) {
    const ids = (run.ids ?? []).filter((id) => (spec.pieces ?? []).some((p) => p.id === id));
    ids.forEach((id, i) => atOf.set(id, ids.length > 1 ? run.from + ((run.to - run.from) * i) / (ids.length - 1) : run.from));
  }
  const pieces = (spec.pieces ?? []).map((p) => (atOf.has(p.id) ? { ...p, at: atOf.get(p.id) } : p));
  const prepared = pieces.map((p, index) => ({ ...preparePiece(p), index }));
  const duration = spec.duration ?? Infinity;
  const byId = new Map(prepared.map((p) => [p.id, p]));
  const labelTimes = {};
  const labels = (spec.labels ?? []).map((l, i) => {
    const id = l.id ?? `label-${i}`;
    const owner = l.owner && byId.has(l.owner) ? byId.get(l.owner) : null;
    const life = labelLife(l, owner, prepared);
    labelTimes[id] = life;
    return { ...l, id, at: life.at, until: life.until };
  });
  const seed = spec.seed ?? hashString(prepared.map((p) => p.id).join('|'));
  const final = solveStage({ arrangement: spec.arrangement, style: spec.style, seed, bounds: spec.bounds, pieces: prepared, labels, marks: spec.marks ?? [], speech: spec.speech ?? [], hook: spec.hook ?? null, arrows: spec.arrows ?? [] });
  const plan = final.plan;
  const prep = plan.flat;
  const times = stageMoments([...prep, ...final.labels], duration);
  const z = new Map(final.pieces.map((p) => [p.id, p.z]));
  const present = (t) => final.pieces.filter((p) => p.at <= t && t < p.until);
  const nextOf = (t) => times.find((x) => x > t) ?? Infinity;
  const moments = times.map((t) => {
    const here = present(t);
    const next = nextOf(t);
    return {
      t,
      pieces: here.map((p) => ({ ...p })),
      labels: final.labels.filter((l) => l.at < Math.min(next, duration) - 1e-6 && l.until > t + 1e-6 && (!l.owner || here.some((p) => p.id === l.owner))),
      marks: final.marks.filter((m) => here.some((p) => p.id === m.on)),
      report: { ...final.report, flags: [...final.report.flags], notes: [...final.report.notes] },
    };
  });
  const report = { ...final.report, flags: [...final.report.flags], notes: [...final.report.notes], held: [] };
  for (const [id, w] of Object.entries(labelTimes)) if (w.moved) report.notes.push(`${id} waits for its owner`);
  const camera = planCamera({ camera: spec.camera, peak: spec.peak, final, plan, labels: final.labels, speech: final.speech, marks: spec.marks ?? [], duration, notes });
  report.notes.push(...notes);
  const groundTone = (spec.ground_tone ?? []).map((g) => ({ at: g.at ?? 0, to: clamp(g.to ?? 0.5, 0, 1) })).sort((a, b) => a.at - b.at);
  // The arrows and the marks of late arrivals wait for what they join.
  const arrows = final.arrows.map((a) => {
    const from = byId.get(a.from), to = byId.get(a.to);
    return { ...a, at: Math.max(a.at ?? 0, (from?.at ?? 0) + 0.3, (to?.at ?? 0) + 0.3) };
  });
  return { moments, z: Object.fromEntries(z), labelTimes, camera, speech: final.speech, hook: final.hook, arrows, ledge: final.ledge, groundTone, report, prepared: prep, duration };
}

// ── The camera (I8, I9, I12, I13, I14, I15) ──────────────────────────────────────────────────────────

/** A pose: s, tx, ty, meaning a frame point p shows at s·p + t. The window never leaves the stage, so nothing off the frame comes on. */
export const applyPose = (pose, box) => ({ x: pose.s * box.x + pose.tx, y: pose.s * box.y + pose.ty, w: pose.s * box.w, h: pose.s * box.h });
const REST = { s: 1, tx: 0, ty: 0 };
/** A pull-back's time, seconds, at the least and the most. */
const PULL_BACK = [0.45, 0.8];
/** How far pieces move over for the last arrival, unasked; under the least it isn't worth a move. */
const AUTO_SLIDE = { most: LIMITS.slideMax, least: 70, wait: 1.2 };
const insideBox = (b, r, slack = 0.5) => b.x >= r.x - slack && b.y >= r.y - slack && b.x + b.w <= r.x + r.w + slack && b.y + b.h <= r.y + r.h + slack;

/** A pose that shows `box` inside `safe`, at scale s if it can. */
function poseOn(box, s0, safe, world) {
  const s = Math.max(1, Math.min(s0, safe.w / Math.max(1, box.w), safe.h / Math.max(1, box.h)));
  const Wx = world.w, Wy = world.h;
  const tx = clamp(safe.x + safe.w / 2 - s * (box.x + box.w / 2), STAGE.W - s * Wx, 0);
  // What's taller than the frame starts from its top.
  const ty = clamp(s * box.h > safe.h ? safe.y - s * box.y : safe.y + safe.h / 2 - s * (box.y + box.h / 2), STAGE.H - s * Wy, 0);
  return { s, tx, ty };
}

/** The camera at time t, from its keys. Straight lines between poses: a box inside the frame at both ends is inside all the way. Pure. */
export function poseAt(keys, t) {
  if (!keys?.length) return REST;
  if (t <= keys[0].t) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    if (t < keys[i].t) {
      const a = keys[i - 1], b = keys[i];
      const raw = (t - a.t) / Math.max(1e-6, b.t - a.t);
      const u = b.ease === 'inOut' ? raw * raw * (3 - 2 * raw) : raw;
      return { s: a.s + (b.s - a.s) * u, tx: a.tx + (b.tx - a.tx) * u, ty: a.ty + (b.ty - a.ty) * u };
    }
  }
  return keys[keys.length - 1];
}

/**
 * The camera's plan: every stop resolved to a measured box and a pose, then keys. `whole` frames what's on at that moment,
 * so a shot opens close on what's there and pulls back as the rest arrives; it never moves a piece. A piece aim frames its
 * keep; `face:<name>` a head; `text:<words>` the phrase's whole line. Zoom is limited by the head's maximum, by sharpness,
 * and by the room for the words.
 */
function planCamera({ camera, peak, final, plan, labels, speech, marks, duration, notes }) {
  const spec = camera ?? { move: 'push', stops: [{ at: 0, aim: 'whole' }] };
  let move = spec.move ?? 'hold';
  if (move === 'slide' && peak) {
    notes.push('slide_on_peak: a peak frame does not slide; it pushes');
    move = 'push';
  }
  const placed = plan.placed;
  const prep = plan.flat;
  const dur = Number.isFinite(duration) ? duration : 6;
  // How far the stage reaches: a long page may run on under the frame.
  let worldH = STAGE.H;
  for (const p of prep) {
    if (p.kind !== 'card' || p.kind === 'fill') continue;
    const pl = placed.get(p.id);
    const b = boxInFrame(pl, p.vis);
    if (b.y + b.h > STAGE.H) worldH = Math.max(worldH, b.y + b.h + 80);
  }
  const hasLedge = final.ledge != null;
  const world = { w: STAGE.W, h: hasLedge ? STAGE.H : worldH };
  const top = (plan.hookAt ? plan.ceiling : STAGE.top);
  const safe = { x: EDGE, y: top, w: STAGE.W - 2 * EDGE, h: STAGE.bottom - top };
  const presentAt = (t) => prep.filter((p) => p.at <= t + 1e-3 && t < p.until - 1e-3);
  // Waiting for a last arrival, what's on stands nearer the middle, and moves over as it lands: the frame isn't half empty until the last second.
  const auto = move === 'slide' || peak ? null : autoSlide({ prep, placed, plan, labels, speech, marks, duration: dur });
  const autoShift = (p, at) => (auto && at < auto.to && auto.ids.includes(p.id) ? auto.dx : 0);
  // A hand-drawn ring belongs to what it rings: the camera keeps its room too.
  const ringed = new Set(marks.filter((m) => m.kind === 'circle').map((m) => m.on));
  const seenBox = (p, at = Infinity) => {
    const b = boxInFrame(placed.get(p.id), p.kind === 'person' ? p.keep : p.vis);
    const shifted = { ...b, x: b.x + autoShift(p, at) };
    return ringed.has(p.id) ? pad(shifted, RING_ROOM) : shifted;
  };
  const wholeBox = (list, at = Infinity) => {
    const parts = list.filter((p) => p.kind !== 'fill').map((p) => seenBox(p, at));
    return parts.length ? unionOf(parts) : { x: 0, y: 0, w: STAGE.W, h: STAGE.H };
  };
  /** The most the camera may zoom with these on screen: head's maximum, sharpness. */
  const limitFor = (list, most) => {
    let s = most;
    for (const p of list) {
      const pl = placed.get(p.id);
      if (p.head && p.measuredHead) s = Math.min(s, LIMITS.headOnScreen / Math.max(1, p.head.h * pl.h));
      if (Number.isFinite(p.maxW)) s = Math.min(s, p.maxW / Math.max(1, pl.w));
    }
    return Math.max(1, s);
  };
  const resolveAim = (aim, at) => {
    const on = presentAt(at);
    const text = /^text\s*:\s*(.+)$/is.exec(String(aim ?? ''));
    if (text) {
      const phrase = text[1].trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
      for (const p of [...on, ...prep]) {
        if (!p.media) continue;
        const lines = phraseLines(p.media, phrase);
        if (!lines.length) continue;
        const pl = placed.get(p.id);
        const line = lineAround(p.media, unionOf(lines));
        return { kind: 'text', piece: p, box: boxInFrame(pl, line), phrase: boxInFrame(pl, unionOf(lines)) };
      }
      notes.push(`aim_missing: no picture on this frame shows the words "${phrase}"`);
      // The camera goes where the mark does: to the piece it lands on.
      const marked = marks.find((m) => String(m.target ?? '').trim() === String(aim).trim() && plan.byId.has(m.on));
      if (marked) { const p = plan.byId.get(marked.on); return { kind: 'piece', piece: p, box: seenBox(p, at) }; }
      return null;
    }
    const face = /^face\s*:\s*(.+)$/is.exec(String(aim ?? ''));
    if (face) {
      const who = face[1].trim();
      const named = (p) => (p.media?.people ?? []).some((n) => norm(n) === norm(who) || surnameOf(n) === surnameOf(who)) || facesOf(p.media ?? {}).some((f) => f.name && (norm(f.name) === norm(who) || surnameOf(f.name) === surnameOf(who)));
      const p = [...on, ...prep].find((q) => q.measuredHead && named(q));
      if (!p) { notes.push(`aim_missing: no measured face for "${who}"`); return null; }
      return { kind: 'face', piece: p, box: boxInFrame(placed.get(p.id), p.head) };
    }
    if (aim && aim !== 'whole' && plan.byId.has(aim)) {
      const p = plan.byId.get(aim);
      return { kind: 'piece', piece: p, box: seenBox(p) };
    }
    if (aim && aim !== 'whole') notes.push(`aim_missing: "${aim}" is not on this frame`);
    return { kind: 'whole', box: wholeBox(on) };
  };
  const stops = (spec.stops?.length ? spec.stops : [{ at: 0, aim: 'whole' }]).map((x) => ({ ...x, at: Math.max(0, x.at ?? 0) })).sort((a, b) => a.at - b.at);
  // Every marked phrase has to be inside the frame while it's marked.
  const markedBoxes = (from, to) => {
    const out = [];
    for (const m of marks) {
      const t = /^text\s*:\s*(.+)$/is.exec(String(m.target ?? ''));
      if (!t || !plan.byId.has(m.on)) continue;
      const when = m.at ?? 0;
      if (when < from - 0.5 || when >= to) continue;
      const p = plan.byId.get(m.on);
      const lines = phraseLines(p.media, t[1].trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''));
      if (lines.length) out.push(boxInFrame(placed.get(p.id), lineAround(p.media, unionOf(lines))));
    }
    return out;
  };
  // The words that ride with the lens, for the zoom's room.
  const wordsAt = (t0, t1) => [...labels, ...speech].filter((l) => l.at < t1 && (l.until ?? Infinity) > t0);
  /** Whether this pose cuts something on screen at a frame edge: a piece stays in, or goes out whole; it isn't left half on. */
  const halfOut = (pose, on, aim) => on.some((p) => {
    if (p.kind === 'fill' || p === aim.piece || p.asGround) return false;
    const b = applyPose(pose, seenBox(p));
    const out = b.x < -1 || b.x + b.w > STAGE.W + 1;
    const gone = b.x + b.w <= 0 || b.x >= STAGE.W;
    return out && !gone;
  });
  const poseFor = (aim, at, next) => {
    // Whoever is on at any point of this hold limits how close it gets.
    const on = prep.filter((p) => p.at < next - 1e-3 && at < p.until - 1e-3);
    const marked = markedBoxes(at, next);
    // An arrow drawn during this hold shows both its ends.
    for (const a of final.arrows ?? []) {
      const when = Math.max(a.at ?? 0, (plan.byId.get(a.from)?.at ?? 0) + 0.3, (plan.byId.get(a.to)?.at ?? 0) + 0.3);
      if (when >= at - 0.5 && when < next) marked.push(unionOf([a.fromBox, a.toBox]));
    }
    const box0 = aim.kind === 'whole' ? aim.box : unionOf([aim.box, ...marked]);
    const box = marked.length && (box0.w > safe.w || box0.h > safe.h) ? aim.box : box0;
    const want = aim.kind === 'whole' ? LIMITS.revealZoom : aim.requested ?? (aim.kind === 'face' ? 440 / Math.max(1, aim.box.h) : aim.kind === 'text' ? (safe.w * 0.86) / Math.max(1, box.w) : Math.min(safe.w / box.w, safe.h / box.h));
    let s = limitFor(on, Math.min(LIMITS.aimZoom, want));
    // A reveal doesn't blow a head past the size it may have at rest.
    if (aim.kind === 'whole') for (const p of on) if (p.head && p.measuredHead && p.kind === 'person') s = Math.min(s, Math.max(1, LIMITS.headMax / Math.max(1, p.head.h * placed.get(p.id).h)));
    if (aim.requested != null) s = limitFor(on, Math.min(LIMITS.aimZoom, aim.requested));
    if (aim.kind === 'whole' && !(box.w * 1.08 < safe.w || box.h * 1.08 < safe.h)) s = 1;
    const words = wordsAt(at, next);
    for (let i = 0; i < 12 && s > 1; i++) {
      const pose = poseOn(box, s, safe, world);
      const okWords = words.every((l) => {
        const cx = pose.s * (l.x + l.w / 2) + pose.tx, cy = pose.s * (l.y + l.h / 2) + pose.ty;
        return cx - l.w / 2 >= 40 && cx + l.w / 2 <= STAGE.W - 40 && cy - l.h / 2 >= top - 2 && cy + l.h / 2 <= STAGE.bottom + 2;
      });
      if (okWords && !halfOut(pose, on, aim)) break;
      s = Math.max(1, s * 0.92);
    }
    return { ...poseOn(box, s, safe, world), box };
  };
  const resolved = [];
  stops.forEach((st, i) => {
    const aim = resolveAim(st.aim, st.at) ?? { kind: 'whole', box: wholeBox(presentAt(st.at)) };
    if (st.zoom != null && Number.isFinite(st.zoom)) aim.requested = st.zoom;
    resolved.push({ at: st.at, aim: st.aim ?? 'whole', zoom: st.zoom ?? null, kind: aim.kind, target: aim, next: stops[i + 1]?.at ?? dur });
  });
  // `whole` stops take a pose at each arrival inside their span: the camera reveals. A tour's stops are the director's alone.
  const poses = [];
  for (const st of resolved) {
    if (move === 'tour' || move === 'slide') {
      poses.push({ at: st.at, aim: st.aim, next: st.next, ...poseFor(st.target, st.at, st.next), kind: st.kind });
      continue;
    }
    // Each hold runs until the next arrival: what lands then is the next pose's to reveal. An aim holds until then too:
    // nothing lands outside the frame.
    const arrivals = [...new Set(prep.map((p) => p.at).filter((t) => t > st.at + 0.05 && t < st.next - 0.05))].sort((a, b) => a - b);
    const held = (i) => arrivals[i] ?? st.next;
    if (st.kind === 'whole') {
      const aim = { kind: 'whole', box: wholeBox(presentAt(st.at), st.at) };
      poses.push({ at: st.at, aim: st.aim, next: held(0), ...poseFor(aim, st.at, held(0)), kind: 'whole' });
    } else {
      poses.push({ at: st.at, aim: st.aim, next: held(0), ...poseFor(st.target, st.at, held(0)), kind: st.kind });
    }
    arrivals.forEach((t, i) => {
      const aim = { kind: 'whole', box: wholeBox(presentAt(t), t) };
      poses.push({ at: t, aim: st.aim, next: held(i + 1), ...poseFor(aim, t, held(i + 1)), kind: 'whole' });
    });
  }
  poses.forEach((p, i) => { p.next = poses[i + 1]?.at ?? dur; });
  // Keys: a slow move during each hold, and one eased move between poses.
  const keys = [];
  const travelFor = (a, b) => {
    const d = Math.hypot(b.tx - a.tx, b.ty - a.ty) + Math.abs(b.s - a.s) * 900;
    const gap = Math.max(0.05, b.at - a.at);
    if (move === 'tour') return Math.min(clamp(d / 1200, 1.1, 1.6), gap * 0.7);
    // A pull-back is over quickly: what's on holds its size for most of its beat, and doesn't shrink while it's still landing.
    if (b.s < a.s - 1e-3) return Math.min(clamp(d / 1400, PULL_BACK[0], PULL_BACK[1]), Math.max(PULL_BACK[0], gap * 0.4));
    return Math.min(clamp(d / 1400, 0.6, 1.1), gap * 0.8);
  };
  const withDrift = (p, t0, t1, i) => {
    if (move === 'hold' || move === 'slide' || t1 - t0 < 0.2) return p;
    const span = Math.min(1, (t1 - t0) / Math.max(1, dur));
    const box = p.box;
    const grow = move === 'push' ? 0.05 : move === 'tour' ? 0.018 : move === 'drift' ? 0.012 : 0;
    const s = Math.max(p.s, Math.min(p.s * (1 + grow * Math.max(0.35, span)), limitFor(prep.filter((q) => q.at <= t1 && t0 < q.until), Infinity)));
    const end = poseOn(box, s, safe, world);
    const dx = move === 'drift' ? (plan.seed + i) % 2 ? -14 : 14 : 0;
    const shifted = { s: end.s, tx: clamp(end.tx + dx, STAGE.W - end.s * world.w, 0), ty: end.ty };
    // What must be seen stays seen at the end of the drift too.
    return insideBox(applyPose(shifted, box), { x: 0, y: top - 2, w: STAGE.W, h: STAGE.H }) ? shifted : insideBox(applyPose(end, box), { x: 0, y: top - 2, w: STAGE.W, h: STAGE.H }) ? end : p;
  };
  poses.forEach((p, i) => {
    const nextP = poses[i + 1];
    const travel = nextP ? travelFor(p, nextP) : 0;
    if (i === 0) keys.push({ t: Math.max(0, p.at), s: p.s, tx: p.tx, ty: p.ty, ease: 'linear', stop: 0 });
    // A pull-back is done by the arrival it makes room for: what lands, lands in the frame at its own size.
    const makesRoom = nextP && nextP.s < p.s - 1e-3;
    const leave = Math.max(keys[keys.length - 1].t, nextP ? nextP.at - (makesRoom ? travel : 0.25 * travel) : dur);
    const held = withDrift(p, keys[keys.length - 1].t, leave, i);
    if (leave > keys[keys.length - 1].t + 1e-3) keys.push({ t: leave, s: held.s, tx: held.tx, ty: held.ty, ease: 'linear' });
    // Never still arriving when the next thing lands: a closer pose can't overlap the arrival that limits it.
    const by = poses[i + 2] ? poses[i + 2].at - 0.02 : dur;
    if (nextP) keys.push({ t: Math.max(leave + 0.01, Math.min(makesRoom ? nextP.at : leave + travel, dur, by)), s: nextP.s, tx: nextP.tx, ty: nextP.ty, ease: 'inOut', stop: i + 1 });
  });
  // One limited slide: what's on before the last arrival stands a little nearer the middle, and moves over as it lands.
  let slide = auto;
  if (move === 'slide') {
    const named = stops.find((x) => x.at > 0)?.at;
    const arrivalsAfter = [...new Set(prep.map((p) => p.at).filter((t) => t > 0))].sort((a, b) => a - b);
    const S = named ?? arrivalsAfter.at(-1);
    if (S) {
      const ids = prep.filter((p) => p.at < S && p.kind !== 'fill' && p.until > S && !isPlaced(p)).map((p) => p.id);
      if (ids.length) {
        const parts = prep.filter((p) => ids.includes(p.id));
        const box = unionOf(parts.map(seenBox));
        let dx = clamp(STAGE.W / 2 - (box.x + box.w / 2), -LIMITS.slideMax, LIMITS.slideMax);
        // A cut edge that's off the frame stays off it.
        for (const p of parts) {
          const pl = placed.get(p.id);
          if (p.open?.left && dx > 0) dx = Math.min(dx, Math.max(0, -pl.x - 3));
          if (p.open?.right && dx < 0) dx = Math.max(dx, Math.min(0, STAGE.W + 3 - (pl.x + pl.w)));
        }
        if (Math.abs(dx) >= 8) slide = { from: Math.max(0, S - SLIDE), to: S, dx, dy: 0, scale: 1, ids };
      }
    }
    if (!slide) notes.push('slide_unused: nothing needed to slide');
  }
  return {
    move, requested: spec.move ?? 'hold',
    stops: resolved.map((r) => ({ at: r.at, aim: r.aim, zoom: r.zoom, kind: r.kind, box: r.target.box })),
    poses: poses.map((p) => ({ at: p.at, s: p.s, tx: p.tx, ty: p.ty, box: p.box, kind: p.kind })),
    keys,
    slide,
    world,
    safe,
  };
}

/**
 * The one move a frame makes unasked, when the last thing to land waits a while and what's on until then stands off to one
 * side: it stands nearer the middle and moves over as the last arrival lands. Null when nothing needs it or a word or mark
 * rides on what would move. Pure.
 */
export function autoSlide({ prep, placed, plan, labels = [], speech = [], marks = [], duration }) {
  const shown = prep.filter((p) => p.kind !== 'fill' && p.kind !== 'note');
  const arrivals = [...new Set(shown.map((p) => p.at).filter((t) => t > 0.05))].sort((a, b) => a - b);
  const S = arrivals.at(-1);
  if (!(S >= AUTO_SLIDE.wait) || !(S < duration)) return null;
  const parts = prep.filter((p) => p.at < S - 0.05 && p.until > S && p.kind !== 'fill');
  if (!parts.length || parts.some((p) => p.kind === 'person' || isPlaced(p))) return null;
  const ids = parts.map((p) => p.id);
  if (labels.some((l) => ids.includes(l.owner)) || speech.some((sp) => ids.includes(sp.on))) return null;
  if (marks.some((m) => ids.includes(m.on) && (m.at ?? 0) < S)) return null;
  const boxes = parts.map((p) => boxInFrame(placed.get(p.id), p.vis));
  const u = unionOf(boxes);
  let dx = clamp(STAGE.W / 2 - (u.x + u.w / 2), -AUTO_SLIDE.most, AUTO_SLIDE.most);
  // It stays inside the room it stands in, and clear of words that stay put.
  const b = plan.bounds;
  dx = clamp(dx, b.x0 + (plan.onBoard ? 0 : EDGE) - u.x, b.x1 - (plan.onBoard ? 0 : EDGE) - (u.x + u.w));
  if (Math.abs(dx) < AUTO_SLIDE.least) return null;
  const moved = { x: u.x + Math.min(dx, 0), y: u.y, w: u.w + Math.abs(dx), h: u.h };
  if (labels.some((l) => l.at < S && !l.owner && boxGap(moved, l) < 0)) return null;
  // What leaves before the last arrival stands where it stood: nothing moves onto it.
  const gone = prep.filter((p) => p.kind !== 'fill' && p.until <= S);
  if (gone.some((p) => boxes.some((q) => boxGap({ ...q, x: q.x + dx }, boxInFrame(placed.get(p.id), p.vis)) < 0))) return null;
  return { from: Math.max(0, S - SLIDE), to: S, dx, dy: 0, scale: 1, ids, auto: true };
}

/** Where a slide has a piece at t: an offset, nothing else. Pure. */
export function slideAt(slide, id, t) {
  if (!slide || !slide.ids.includes(id) || t >= slide.to) return { dx: 0, dy: 0, k: 1 };
  const raw = clamp((t - slide.from) / Math.max(1e-6, slide.to - slide.from), 0, 1);
  const u = 1 - raw * raw * (3 - 2 * raw);
  return { dx: slide.dx * u, dy: slide.dy * u, k: 1 };
}

// ── What the tests and the screen check measure ──────────────────────────────────────────────────────

/** How much of the usable area a moment's pieces show, and how far they span it, under a pose. Pure. */
export function fillOf(pieces, prepared, pose = REST, room = { x: 30, y: STAGE.top, w: STAGE.W - 60, h: STAGE.bottom - STAGE.top }, extra = []) {
  const NX = 24, NY = 20;
  const cells = new Uint8Array(NX * NY);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const by = new Map(prepared.map((p) => [p.id, p]));
  for (const pl of pieces) {
    const p = by.get(pl.id);
    if (!p) continue;
    if (p.kind === 'fill') return { share: 1, spanX: 1, spanY: 1 };
    const base = boxInFrame(pl, p.vis);
    const b = applyPose(pose, base);
    const a0 = Math.max(room.x, b.x), a1 = Math.min(room.x + room.w, b.x + b.w), c0 = Math.max(room.y, b.y), c1 = Math.min(room.y + room.h, b.y + b.h);
    if (a1 <= a0 || c1 <= c0) continue;
    x0 = Math.min(x0, a0); x1 = Math.max(x1, a1); y0 = Math.min(y0, c0); y1 = Math.max(y1, c1);
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const cx = room.x + (room.w * (i + 0.5)) / NX, cy = room.y + (room.h * (j + 0.5)) / NY;
        if (cx >= a0 && cx <= a1 && cy >= c0 && cy <= c1) cells[j * NX + i] = 1;
      }
    }
  }
  // What fills the area without being a piece: the hook's band, the ledge. Fixed to the lens or riding with it, they count.
  for (const b of extra) {
    const a0 = Math.max(room.x, b.x), a1 = Math.min(room.x + room.w, b.x + b.w), c0 = Math.max(room.y, b.y), c1 = Math.min(room.y + room.h, b.y + b.h);
    if (a1 <= a0 || c1 <= c0) continue;
    y0 = Math.min(y0, c0); y1 = Math.max(y1, c1); x0 = Math.min(x0, a0); x1 = Math.max(x1, a1);
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const cx = room.x + (room.w * (i + 0.5)) / NX, cy = room.y + (room.h * (j + 0.5)) / NY;
        if (cx >= a0 && cx <= a1 && cy >= c0 && cy <= c1) cells[j * NX + i] = 1;
      }
    }
  }
  let n = 0;
  for (const c of cells) n += c;
  return { share: n / cells.length, spanX: x1 > x0 ? (x1 - x0) / room.w : 0, spanY: y1 > y0 ? (y1 - y0) / room.h : 0 };
}

/**
 * How bright it is behind a frame-px box, 0–1, from the measured pictures: the topmost piece under each of five points,
 * else the ground (`groundAt(x, y)`). Marks and drawings take their ink from this. Pure.
 */
export function toneBehind(box, placedPieces, groundAt) {
  const pts = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]];
  const stack = [...placedPieces].sort((a, b) => (b.pl.z ?? 0) - (a.pl.z ?? 0));
  let sum = 0;
  for (const [px, py] of pts) {
    const X = box.x + px * box.w, Y = box.y + py * box.h;
    let tone = null;
    for (const { p, pl } of stack) {
      // Line art is ink on what's behind it, not a surface of its own.
      if (p.kind === 'drawing') continue;
      const [u, v] = toImage(pl, X, Y);
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      if (p.shape && !atGrid(p.shape, u, v)) continue;
      const c = p.crop && !p.rebased ? [p.crop.x + u * p.crop.w, p.crop.y + v * p.crop.h] : [u, v];
      const g = gridOf(p.media?.regions?.tone, true);
      const cell = g ? atGrid(g, c[0], c[1]) : 255;
      if (cell === 255) { if (p.shape || !g) continue; tone = 0.9; break; }
      tone = cell / 15;
      break;
    }
    sum += tone ?? groundAt(X, Y);
  }
  return sum / pts.length;
}

/** Whether a mark of an inner state sits on its head: over the top half, near it, never across it. Pure. */
export function markOnHead(box, head) {
  const gapX = Math.max(0, head.x - (box.x + box.w), box.x - (head.x + head.w));
  const gapY = Math.max(0, head.y - (box.y + box.h), box.y - (head.y + head.h));
  return box.y + box.h <= head.y + head.h * 0.62 && gapX <= head.w * 0.55 && gapY <= head.h * 0.55;
}
export { crossesHead };
