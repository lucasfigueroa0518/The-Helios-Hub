// Anchored marks, measured pictures and keep-out zones (iteration 4). A mark names WHAT it marks, never
// where: `face:<person or index>`, `text:"<phrase>"`, `photo:<index>` or an element (`el:`). The kit finds
// the box in the harvest's box sidecar (faces, OCR words and photo regions, 0–1 of the image; ctx.media's
// `regions`) or measures the element itself (a drawing's or cutout's ink, not its transparent padding),
// and draws the stroke inside an invisible frame that mirrors the picture's laid-out box and its own
// transform, so the mark follows every move (camera push, collage rotation, a figure sliding in). The
// ring is the target's size. Labels keep clear of faces, the caption band and a page's own text.
//
// Everything here measures lazily, once, on the first render with a laid-out picture (build() runs before
// the pictures load), and is a pure function of t after that.
import { facesOf, mainFace, pieceKind } from '../stage-layout.js';
import { h, svgEl } from './dom.js';
import { COLORS, HELIOS } from './style.js';
import { linkInk, skipMark } from './marks.js';
import { arrowBetween, clamp, clipBox, crossOver, ellipseAround, highlightBand, ringAround, seg, toPath, underlineUnder } from '../geometry.js';
import { markShape, markWindow } from '../treatment-geometry.js';

/** The caption band's keep-out (y 260–560) and the overlay-words zone (FRAME.md § Layout), frame px. */
export const CAPTION_KEEPOUT = { x: 0, y: 260, w: 1080, h: 300 };
export const OVERLAY = { x0: 96, x1: 940, y0: 600, y1: 1500 };
/** Where a subject's visual centre belongs: the centre column, y ≈ 800–1100. */
export const SUBJECT = { x0: 300, x1: 780, y0: 800, y1: 1100, cx: 540, cy: 950 };
/** A mark finishes at least this long before its frame ends, so it is seen whole. */
export const MARK_TAIL = 0.4;

const okBox = (b) => Boolean(b) && [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0;
const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9$%.]+/g, ' ').replace(/(?<!\d)\.|\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter(Boolean);
const surname = (s) => norm(s).split(' ').at(-1) ?? '';
/** Two ways of writing one person's name (the full name, or the same surname). */
export const sameName = (a, b) => Boolean(norm(a) && norm(b)) && (norm(a) === norm(b) || surname(a) === surname(b));
const area = (b) => b.w * b.h;
const union = (list) => {
  const x0 = Math.min(...list.map((b) => b.x)), y0 = Math.min(...list.map((b) => b.y));
  const x1 = Math.max(...list.map((b) => b.x + b.w)), y1 = Math.max(...list.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
/** Overlap area of two { x, y, w, h } boxes. */
export const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * What the harvest measured on a picture, 0–1 of the image: { faces, words: [{ text, box }], photos, lift, lift_from }.
 * From the box sidecar (`media.regions`), else the inventory's main `face` and its pixel text `boxes`.
 */
export function regionsOf(media) {
  const r = media?.regions ?? {};
  const W = media?.width, H = media?.height;
  const named = (media?.people ?? []).filter(Boolean).length > 0;
  // A face the detector barely believes, on a picture of nobody named, is a false alarm (a phone's screen, a logo).
  // Only a trusted face is a head (I16): what the harvest graded false never reaches a camera, a mark or a plate.
  const listed = (Array.isArray(r.faces) && r.faces.length ? r.faces : media?.face ? [media.face] : []).filter((f) => okBox(f) && (named || f.name || !(f.score < 0.6)));
  const faces = listed.some((f) => 'trusted' in f) ? listed.filter((f) => f.trusted) : facesOf(media).filter((f) => listed.includes(f));
  let words = (Array.isArray(r.words) ? r.words : []).filter((w) => okBox(w?.box)).map((w) => ({ text: String(w.text ?? ''), box: w.box }));
  if (!words.length && Array.isArray(media?.boxes) && W > 0 && H > 0) {
    words = media.boxes.filter(okBox).map((b) => ({ text: String(b.text ?? ''), box: { x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H } }));
  }
  return { faces, words, photos: (Array.isArray(r.photos) ? r.photos : []).filter(okBox), lift: r.lift ?? null, lift_from: okBox(r.lift_from) ? r.lift_from : null };
}

/** The largest of some boxes. */
export const largest = (boxes) => [...boxes].sort((a, b) => area(b) - area(a))[0] ?? null;

/**
 * A face on a picture, by index (`0` = the first listed) or by person. A face box may carry its person
 * (`name`); unnamed faces resolve a name only when the picture shows that one person (its `people` or
 * `anchor_for`), so a mark never lands on the wrong person. Null when it can't be told.
 * @param {any} media
 * @param {number | string} [which]
 */
export function findFace(media, which = 0) {
  const { faces } = regionsOf(media);
  if (!faces.length) return null;
  const v = String(which ?? '').trim();
  if (v === '' || /^\d+$/.test(v)) return faces[Number(v || 0)] ?? null;
  const named = faces.find((f) => sameName(f.name ?? f.person ?? '', v));
  if (named) return named;
  if (faces.some((f) => f.name || f.person)) return null;
  const people = (media?.people ?? []).filter(Boolean);
  if (people.length > 1) return null;
  if (people.length === 1 && !sameName(people[0], v)) return null;
  if (!people.length && media?.anchor_for && !sameName(media.anchor_for, v)) return null;
  return mainFace(faces, media);
}

/**
 * Boxes on one line (their centres within half a line's height of each other) merged into one box each,
 * top to bottom. A stroke that follows words is drawn line by line: one stroke across two lines runs
 * through the words instead of under them.
 */
function intoLines(boxes) {
  const out = [];
  for (const b of [...boxes].sort((a, c) => a.y - c.y || a.x - c.x)) {
    const hit = out.find((l) => Math.abs((l.y + l.h / 2) - (b.y + b.h / 2)) < 0.5 * Math.max(l.h, b.h));
    if (!hit) { out.push({ ...b }); continue; }
    Object.assign(hit, union([hit, b]));
  }
  return out;
}

/**
 * A phrase on a picture's OCR words, line by line: one box per line it runs over, top to bottom (the last
 * word may be cut short: "regul" finds "regulators"). Where the phrase is part of a longer box, its share of
 * that box is estimated from the letters, so a mark stays the phrase's size. Empty when absent.
 */
const looseWord = (t) => String(t).replace(/[il1|]/g, 'l').replace(/0/g, 'o');
export function phraseLines(media, phrase) {
  const { words } = regionsOf(media);
  const want = tokens(phrase);
  if (!want.length || !words.length) return [];
  const toks = [];
  words.forEach((w, i) => tokens(w.text).forEach((t, j) => toks.push({ t, i, j })));
  for (let s = 0; s < toks.length; s++) {
    let k = 0;
    while (k < want.length && s + k < toks.length) {
      const tk = toks[s + k].t;
      // What OCR confuses reads as one: AI and Al, O and 0.
      const x = looseWord(tk), y = looseWord(want[k]);
      const ok = x === y || (k === want.length - 1 && x.startsWith(y)) || (k === 0 && want.length > 1 && x.endsWith(y));
      if (!ok) break;
      k += 1;
    }
    if (k < want.length) continue;
    const hit = toks.slice(s, s + k);
    // A share of one box, by letters.
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

/** A phrase on a picture's OCR words as one box (see phraseLines). Null when absent. */
export function findPhrase(media, phrase) {
  const lines = phraseLines(media, phrase);
  return lines.length ? union(lines) : null;
}

/** The photo region holding the picture's main face, else the largest one (a page's picture, for `lift`). */
export function mainPhoto(media) {
  const { faces, photos } = regionsOf(media);
  if (!photos.length) return null;
  const face = largest(faces);
  if (face) {
    const holding = photos.filter((p) => overlapArea(p, face) >= 0.5 * area(face));
    if (holding.length) return largest(holding);
  }
  return largest(photos);
}

/** A target spec: { kind: face | text | photo | el, value?, el? }. Throws on anything else. */
export function parseTarget(target) {
  if (target && typeof target === 'object') {
    if (target.nodeType === 1) return { kind: 'el', el: target };
    if (target.el?.nodeType === 1) return { kind: 'el', el: target.el };
  }
  const m = /^\s*(face|text|photo|el)\s*:\s*([\s\S]*)$/i.exec(String(target ?? ''));
  if (!m) throw new Error(`[mark_on_nothing] the mark target "${target ?? ''}" must be face:<person or index>, text:"<phrase>", photo:<index> or an element (el:); never coordinates`);
  return { kind: m[1].toLowerCase(), value: m[2].trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '') };
}

// ── Pictures ───────────────────────────────────────────────────────────────────────────────────────

/** The ink bounds of an element, 0–1 of its box: a drawing's or a cutout's non-transparent pixels. */
export function inkBounds(el) {
  if (el.__ink !== undefined) return el.__ink;
  const img = el.tagName === 'IMG' ? el : null;
  if (!img) return null;
  if (!img.complete || !img.naturalWidth) return null; // not loaded yet: measured later
  const doc = img.ownerDocument;
  let out = null;
  try {
    const c = doc.createElement('canvas');
    const n = 96;
    c.width = n; c.height = n;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, n, n);
    const d = g.getImageData(0, 0, n, n).data;
    let x0 = n, y0 = n, x1 = -1, y1 = -1, clear = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const a = d[(y * n + x) * 4 + 3];
        if (a < 24) { clear += 1; continue; }
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      }
    }
    // An opaque picture (no transparency to speak of) has no ink bounds: its box is the picture.
    out = clear > n * n * 0.02 && x1 >= x0 ? { x: x0 / n, y: y0 / n, w: (x1 - x0 + 1) / n, h: (y1 - y0 + 1) / n } : null;
  } catch {
    out = null; // a tainted canvas: fall back to the element's box
  }
  el.__ink = out;
  return out;
}

const styleOf = (el) => el.ownerDocument?.defaultView?.getComputedStyle?.(el) ?? null;

// ── Ink against what is behind it ──────────────────────────────────────────────────────────────────

const channels = (c) => {
  const s = String(c ?? '').trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
  const nums = s.match(/[\d.]+/g);
  return /^rgb/i.test(s) && nums?.length >= 3 ? nums.slice(0, 3).map(Number) : null;
};
export const luma = ([r, g, b]) => {
  const c = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
/** WCAG contrast of two colours [r, g, b]. */
export const contrastOf = (a, b) => ratio(luma(a), luma(b));
/** WCAG contrast of two luminances. */
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/**
 * Ink is lost when it is both close in brightness and close in colour to what is behind it (orange on a
 * mid green still reads, on hue). Slightly wider than the screen check's limits, so the kit acts first.
 */
export const INK_LOST = { contrast: 1.8, distance: 130 };
const lost = (c, behind) => ratio(luma(c), luma(behind)) < INK_LOST.contrast && Math.hypot(c[0] - behind[0], c[1] - behind[1], c[2] - behind[2]) < INK_LOST.distance;

/**
 * The ink for a stroke, given the colour behind it ([r, g, b], null when it can't be told): the colour asked
 * for while it reads there, else whichever of paper-lit and dark ink reads best. Pure.
 */
export function pickInk(wanted, behind) {
  const c = channels(wanted);
  if (!behind || !c || !lost(c, behind)) return wanted;
  const b = luma(behind);
  const paper = ratio(luma(channels(HELIOS.paperLit)), b), dark = ratio(luma(channels(HELIOS.ink)), b);
  return paper >= dark ? HELIOS.paperLit : HELIOS.ink;
}

/**
 * The screen box a stroke's ink is judged in: the strokes themselves, because what is behind an underline is the patch it runs
 * on, not the whole picture it belongs to. The fallback where they have no size yet. Pure on the rects it's given.
 */
export function strokeRect(rects, fallback) {
  const real = rects.filter((r) => r && r.width + r.height > 0);
  if (!real.length) return fallback;
  const left = Math.min(...real.map((r) => r.left)), top = Math.min(...real.map((r) => r.top));
  const right = Math.max(...real.map((r) => r.right)), bottom = Math.max(...real.map((r) => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** The mean colour of a picture under a screen box, through its brightness filter; null when unreadable. */
function pictureColour(img, r) {
  const ir = img.getBoundingClientRect();
  if (!img.naturalWidth || !(ir.width > 1 && ir.height > 1)) return null;
  const x0 = Math.max(r.left, ir.left), y0 = Math.max(r.top, ir.top), x1 = Math.min(r.right, ir.right), y1 = Math.min(r.bottom, ir.bottom);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  try {
    const c = img.ownerDocument.createElement('canvas');
    c.width = 16; c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true });
    const kx = img.naturalWidth / ir.width, ky = img.naturalHeight / ir.height;
    g.drawImage(img, (x0 - ir.left) * kx, (y0 - ir.top) * ky, (x1 - x0) * kx, (y1 - y0) * ky, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    const sum = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; n += 1; }
    if (!n) return null;
    const bright = /brightness\(([\d.]+)\)/.exec(styleOf(img)?.filter ?? '');
    return sum.map((v) => (v / n) * (bright ? Number(bright[1]) : 1));
  } catch {
    return null; // a tainted canvas: not judged here (the screen check still measures the pixels)
  }
}

/** What one element paints under a screen box: a colour, or null when it paints nothing solid there. */
function paintedColour(el, r) {
  const cs = styleOf(el);
  if (!cs || cs.visibility === 'hidden' || Number(cs.opacity) < 0.5 || (cs.mixBlendMode && cs.mixBlendMode !== 'normal')) return null;
  if (el.tagName === 'IMG') return pictureColour(el, r);
  const bg = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor ?? '');
  if (bg) {
    const v = bg[1].split(',').map(Number);
    if ((v[3] ?? 1) >= 0.5) return v.slice(0, 3);
  }
  if (/gradient/.test(cs.backgroundImage ?? '')) {
    const stops = [...cs.backgroundImage.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => m[1].split(',').map(Number));
    if (stops.length && stops.every((v) => (v[3] ?? 1) >= 0.5)) return [0, 1, 2].map((k) => stops.reduce((n, v) => n + v[k], 0) / stops.length);
  }
  return null;
}

/**
 * The colour painted behind a screen box, from the element stack at five points; skip (the ink itself)
 * is left out. Null where it can't be told (no layout yet, an unreadable picture): the ink keeps its colour
 * and the screen check, which reads the real pixels, has the last word.
 */
export function behindColour(doc, r, skip = null) {
  if (typeof doc.elementsFromPoint !== 'function' || !(r.width > 0 && r.height > 0)) return null;
  const pts = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]];
  const vals = [];
  for (const [u, v] of pts) {
    for (const el of doc.elementsFromPoint(r.left + u * r.width, r.top + v * r.height)) {
      if (skip && (el === skip || skip.contains(el))) continue;
      if (el.closest?.('svg')) continue;
      const c = paintedColour(el, r);
      if (c) { vals.push(c); break; }
    }
  }
  if (!vals.length) return null;
  return [0, 1, 2].map((k) => vals.reduce((n, v) => n + v[k], 0) / vals.length);
}

/** Whether this frame opens the reel (the harness marks its host): its main picture is on from the first instant. */
export const isOpening = (el) => Boolean(el?.closest?.('[data-opening]'));

/**
 * A measurable picture: the element that shows it (an <img>, a keyed canvas, a wrapper), its inventory
 * entry, and an invisible frame (`.rd-anchor`) that mirrors the element's laid-out box and transform
 * inside the same positioned parent. Face regions (keep-outs for labels, read by the screen check) and
 * marks live in the frame. Call `sync()` from render(t); treatments do it for their own pictures.
 */
export function picture(doc, el, media = null, { faces = true } = {}) {
  if (!el) return null;
  if (el.__picture) {
    if (media && !el.__picture.media) el.__picture.media = media;
    return el.__picture;
  }
  const frame = h(doc, 'div', { class: 'rd-anchor', 'data-anchor': '', style: { position: 'absolute', left: '0px', top: '0px', width: '0px', height: '0px', pointerEvents: 'none', overflow: 'visible' } });
  // A real picture is what the viewer came to see: a label prefers free space off it, at the lowest weight.
  if (media) frame.setAttribute('data-keepout', 'picture');
  // People in it but no measured face: where they stand is unknown, so the screen check guards the picture's middle.
  if (media && (media.people ?? []).filter(Boolean).length && !regionsOf(media).faces.length) frame.setAttribute('data-people-unmeasured', media.id ?? '');
  if (el.parentNode) el.after(frame);
  const pic = { el, img: el.tagName === 'IMG' ? el : el.querySelector?.('img') ?? null, media, frame, faceEls: [], ink: null, expressions: new Set() };
  pic.contentBox = () => {
    const w = el.offsetWidth || parseFloat(el.style.width) || 0;
    const ht = el.offsetHeight || parseFloat(el.style.height) || 0;
    const cs = styleOf(el);
    const fit = cs?.objectFit;
    if (el.tagName === 'IMG' && (fit === 'cover' || fit === 'contain')) {
      const nw = el.naturalWidth || pic.media?.width, nh = el.naturalHeight || pic.media?.height;
      if (nw > 0 && nh > 0 && w > 0 && ht > 0) {
        const s = fit === 'cover' ? Math.max(w / nw, ht / nh) : Math.min(w / nw, ht / nh);
        const dw = nw * s, dh = nh * s;
        const pos = String(cs.objectPosition || '50% 50%').split(/\s+/).map((v) => (/%$/.test(v) ? parseFloat(v) / 100 : 0.5));
        return { x: (w - dw) * (pos[0] ?? 0.5), y: (ht - dh) * (pos[1] ?? 0.5), w: dw, h: dh };
      }
    }
    return { x: 0, y: 0, w, h: ht };
  };
  /** A 0–1 region of the image in the frame's px, clipped to what the element shows. */
  pic.box = (region) => {
    const c = pic.contentBox();
    if (!(c.w > 0 && c.h > 0) || !okBox(region)) return null;
    const b = { x: c.x + region.x * c.w, y: c.y + region.y * c.h, w: region.w * c.w, h: region.h * c.h };
    return clipBox(b, { x: 0, y: 0, w: el.offsetWidth || c.w, h: el.offsetHeight || c.h });
  };
  /** A 0–1 region of the image in the frame's px, unclipped (a head's crown may stand on the box's edge). */
  pic.boxUnclipped = (region) => {
    const c = pic.contentBox();
    if (!(c.w > 0 && c.h > 0) || !okBox(region)) return null;
    return { x: c.x + region.x * c.w, y: c.y + region.y * c.h, w: region.w * c.w, h: region.h * c.h };
  };
  /** The element's ink (non-transparent) box in frame px; the whole box when opaque. */
  pic.inkBox = () => {
    const ink = pic.ink ?? (pic.img ? inkBounds(pic.img) : null);
    const c = pic.contentBox();
    return ink ? { x: c.x + ink.x * c.w, y: c.y + ink.y * c.h, w: ink.w * c.w, h: ink.h * c.h } : { x: 0, y: 0, w: c.w, h: c.h };
  };
  pic.sync = () => {
    if (!frame.parentNode && el.parentNode) el.after(frame);
    const s = frame.style;
    s.left = `${el.offsetLeft || 0}px`;
    s.top = `${el.offsetTop || 0}px`;
    s.width = `${el.offsetWidth || 0}px`;
    s.height = `${el.offsetHeight || 0}px`;
    const cs = styleOf(el);
    const tf = cs?.transform && cs.transform !== 'none' ? cs.transform : el.style.transform || '';
    if (s.transform !== tf) s.transform = tf;
    s.transformOrigin = cs?.transformOrigin || '';
    s.visibility = el.style.visibility || '';
    s.display = cs?.display === 'none' ? 'none' : '';
    for (const f of pic.faceEls) {
      const b = pic.box(f.region);
      Object.assign(f.el.style, b ? { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, display: '' } : { display: 'none' });
    }
    // Marks of an inner state belong in this frame, in its coordinates: one a frame moved out comes home.
    for (const c of frame.children) if (c.hasAttribute?.('data-expression')) pic.expressions.add(c);
    for (const c of pic.expressions) {
      if (c.parentNode !== frame) frame.append(c);
      if (c.__settled !== true) settleExpression(doc, c);
    }
  };
  // A logo's or a cut thing's whole visible box is what the viewer came to see: labels keep off all of it.
  const whole = media ? pieceKind(media) : null;
  if (whole === 'logo' || whole === 'thing') {
    const region = okBox(media.regions?.visible) ? media.regions.visible : { x: 0, y: 0, w: 1, h: 1 };
    const fe = h(doc, 'div', { class: 'rd-face', 'data-keepout': 'keep', ...(media.id ? { 'data-asset': media.id } : {}), style: { position: 'absolute', pointerEvents: 'none' } });
    frame.append(fe);
    pic.faceEls.push({ el: fe, region });
  }
  if (faces && media) {
    const { faces: list } = regionsOf(media);
    const people = (media.people ?? []).filter(Boolean);
    list.forEach((f, i) => {
      const person = f.name ?? f.person ?? (list.length === 1 && people.length === 1 ? people[0] : '');
      const fe = h(doc, 'div', { class: 'rd-face', 'data-face': String(i), 'data-keepout': 'face', ...(person ? { 'data-person': person } : {}), ...(media.id ? { 'data-asset': media.id } : {}), style: { position: 'absolute', pointerEvents: 'none' } });
      frame.append(fe);
      pic.faceEls.push({ el: fe, region: f });
    });
  }
  el.__picture = pic;
  return pic;
}

/** An element named in `el:<name>` inside `on`: its `data-name`, else a CSS selector. */
function namedEl(on, name) {
  const root = on?.nodeType === 1 ? on : on?.el?.nodeType === 1 ? on.el : on?.stage?.nodeType === 1 ? on.stage : null;
  if (!root || !name) return null;
  const esc = String(name).replace(/["\\]/g, '\\$&');
  const hit = root.querySelector(`[data-name="${esc}"]`);
  if (hit) return hit;
  try { return root.querySelector(name); } catch { return null; }
}

/** The picture a mark's `on` names: a treatment result (its `picture`), a picture, or an element. */
export function pictureOf(doc, on, media = null) {
  if (!on) return null;
  if (on.frame && on.sync && on.el) return on;
  if (on.picture?.frame) return on.picture;
  const el = on.nodeType === 1 ? on : on.el?.nodeType === 1 ? on.el : null;
  if (!el) return null;
  const img = el.tagName === 'IMG' || el.tagName === 'CANVAS' ? el : el.querySelector?.('img');
  return img ? picture(doc, img, media ?? on.media ?? null) : null;
}

// ── Marks ──────────────────────────────────────────────────────────────────────────────────────────

/** The stroke shapes of a mark kind around a box (frame px). */
export function markShapes(kind, b, { pad, seed = 1, text = false } = {}) {
  if (kind === 'underline') return [underlineUnder(b, { gap: 4, over: 8, bow: 5 })];
  if (kind === 'highlight') return [highlightBand(b, { over: 6 })];
  if (kind === 'box') return [markShape('box', b, { pad: pad ?? 12 })];
  if (kind === 'cross') return crossOver(b, pad ?? 10);
  if (text) return [ellipseAround(b, pad ?? 14, seed)];
  return [ringAround(b, pad ?? Math.max(8, 0.06 * Math.max(b.w, b.h)), seed)];
}

export const ANCHORED_KINDS = ['circle', 'underline', 'highlight', 'box', 'cross', 'arrow'];

/**
 * An anchored mark (FRAME.md § Marks). Options:
 *   on      the picture it is on: a treatment result (`shot`, `tb.figures[0]`, `c.items[2]`, a `lift`), or an element
 *   target  face:<person or index> | text:"<phrase>" | photo:<index> | an element (el:)
 *   kind    circle | underline | highlight | box | cross | arrow (arrow: `from` is where it starts, an element or another target on `on`)
 *   at      the cue: the stroke ends on it (FRAME.md: the cue word's start)
 *   color (Helios orange), width, pad, seed, duration (the frame's: a mark never lands in its last MARK_TAIL s)
 * Returns { el, target, kind, window, render(t), progress(u), box() }. Throws when the target can't be found.
 */
export function mark(doc, o = {}) {
  const kind = o.kind ?? 'circle';
  if (!ANCHORED_KINDS.includes(kind)) return skipMark(doc, kind, `mark kind "${kind}" must be one of ${ANCHORED_KINDS.join(', ')}`);
  let spec;
  try {
    spec = parseTarget(o.target);
  } catch (e) {
    return skipMark(doc, kind, String(e?.message ?? e).replace(/^\[mark_on_nothing\]\s*/, ''));
  }
  if (kind === 'arrow' && o.from == null) return skipMark(doc, kind, 'an arrow needs `from`: the element or target it starts from');
  let pic;
  let region = null;
  let lines = null;
  let elTarget = null;
  if (spec.kind === 'el') {
    elTarget = spec.el ?? namedEl(o.on, spec.value);
    if (!elTarget) return skipMark(doc, kind, `no element "${spec.value ?? ''}" in \`on\`: give the element itself, or one with data-name="${spec.value ?? ''}"`);
    pic = picture(doc, elTarget, null, { faces: false });
    if (o.ink) pic.ink = o.ink;
  } else {
    pic = pictureOf(doc, o.on, o.media);
    if (!pic) return skipMark(doc, kind, `a ${spec.kind}: mark needs \`on\`: the treatment or picture the ${spec.kind} is on`);
    const media = pic.media ?? o.media;
    region = spec.kind === 'face' ? findFace(media, spec.value)
      : spec.kind === 'text' ? findPhrase(media, spec.value)
        : regionsOf(media).photos[Number(spec.value || 0)] ?? null;
    if (!region) {
      const what = spec.kind === 'face' ? `a face for "${spec.value}"` : spec.kind === 'text' ? `the words "${spec.value}"` : `photo region ${spec.value}`;
      return skipMark(doc, kind, `${media?.id ?? 'the picture'} has no ${what} in its measured boxes; mark something the picture shows`);
    }
    // Words over several lines: an underline or highlight follows each line.
    if (spec.kind === 'text' && (kind === 'underline' || kind === 'highlight')) lines = phraseLines(media, spec.value);
    // A page's push aims at the words the first text mark rings, and keeps their whole line in frame.
    if (spec.kind === 'text' && typeof o.on?.aim === 'function') o.on.aim(region);
  }
  const color = o.color ?? COLORS.marker;
  const width = o.width ?? (kind === 'highlight' ? null : 10);
  const svg = svgEl(doc, 'svg', { class: 'rd-ink', width: 1, height: 1 });
  svg.style.overflow = 'visible';
  pic.frame.append(svg);
  const spot = elTarget ? null : h(doc, 'div', { 'data-ink-region': '', 'data-mark-target': `${spec.kind}:${spec.value}`, style: { position: 'absolute', pointerEvents: 'none' } });
  if (spot) pic.frame.append(spot);
  const target = elTarget ?? spot;
  linkInk(target, kind);
  // What a mark marks is the frame's focus: labels keep off it (keepClear).
  target.setAttribute('data-focus', '');
  if (lines?.length > 1) target.setAttribute('data-mark-lines', String(lines.length));
  const state = { strokes: null, window: null, box: null, inked: kind === 'highlight' };
  const fromEl = kind === 'arrow' && typeof o.from !== 'string' ? (o.from?.nodeType === 1 ? o.from : o.from?.el ?? null) : null;
  const arrowShapes = (b) => {
    const from = boxOfFrom(doc, svg, o.from, pic);
    if (!from) return null;
    const a = arrowBetween(from, b, { bend: o.bend ?? null });
    return [a.shaft, a.flick1, a.flick2];
  };
  const measure = () => {
    pic.sync();
    const b = elTarget ? pic.inkBox() : pic.box(region);
    if (!b || b.w < 2 || b.h < 2) return false;
    state.box = b;
    if (spot) Object.assign(spot.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
    let shapes;
    if (kind === 'arrow') {
      shapes = arrowShapes(b);
      if (!shapes) {
        state.dead = true;
        skipMark(doc, kind, 'an arrow needs `from`: an element or a target this picture shows');
        return false;
      }
    } else if (lines?.length > 1) {
      shapes = lines.map((l) => pic.box(l)).filter(Boolean).flatMap((lb) => markShapes(kind, lb, { pad: o.pad, seed: o.seed ?? 1, text: true }));
    } else {
      shapes = markShapes(kind, b, { pad: o.pad, seed: o.seed ?? 1, text: spec.kind === 'text' });
    }
    state.strokes = shapes.map((sh) => {
      const p = svgEl(doc, 'path', { d: toPath(sh.pts), fill: 'none', stroke: color, 'stroke-width': kind === 'highlight' ? sh.width : width, 'stroke-linecap': kind === 'highlight' ? 'butt' : 'round', 'stroke-linejoin': 'round' });
      if (kind === 'highlight') { p.setAttribute('stroke', o.color ?? '#FFB23A'); p.setAttribute('stroke-opacity', '0.45'); p.setAttribute('class', 'hl'); }
      svg.append(p);
      return { el: p, length: sh.length };
    });
    linkInk(target, kind, ...state.strokes.map((s) => s.el));
    const total = state.strokes.reduce((n, s) => n + s.length, 0);
    const w = markWindow(kind === 'arrow' || kind === 'cross' ? 'underline' : kind, total, o.at ?? 1);
    const latest = o.duration > 0 ? Math.max(0.1, o.duration - MARK_TAIL) : Infinity;
    const shift = Math.max(0, w.end - latest);
    state.window = { start: Math.max(0, w.start - shift), end: w.end - shift };
    return true;
  };
  const progress = (u) => {
    if (!state.strokes) return;
    const total = state.strokes.reduce((n, s) => n + s.length, 0) || 1;
    let acc = 0;
    for (const s of state.strokes) {
      const a = acc / total, b = (acc + s.length) / total;
      const x = clamp((u - a) / (b - a || 1));
      s.el.style.strokeDasharray = `${s.length} ${s.length + 10}`;
      s.el.style.strokeDashoffset = String(s.length * (1 - x));
      s.el.style.opacity = x > 0 ? '1' : '0';
      acc += s.length;
    }
  };
  /** Once, with the picture loaded and on the page: the ink takes a colour that reads on what is behind it. */
  const settleInk = () => {
    if (state.inked || !target.isConnected) return;
    const r = strokeRect(state.strokes.map((s) => s.el.getBoundingClientRect?.()), target.getBoundingClientRect());
    if (pic.img && !(pic.img.complete && pic.img.naturalWidth) && !elTarget) return;
    state.inked = true;
    // The marked picture itself, where it can be read: an element stack skips a layer that takes no pointer events.
    const ink = pickInk(color, (pic.img ? pictureColour(pic.img, r) : null) ?? behindColour(doc, r, svg));
    if (ink !== color) for (const s of state.strokes) s.el.setAttribute('stroke', ink);
  };
  const render = (t) => {
    if (state.dead || (!state.strokes && !measure())) return;
    // The strokes are in the frame's coordinates: a mark a frame moved elsewhere comes home.
    if (svg.parentNode !== pic.frame) pic.frame.append(svg);
    pic.sync();
    settleInk();
    // An arrow from an element on another picture follows that element too.
    if (fromEl && state.box) {
      const shapes = arrowShapes(state.box);
      if (shapes) shapes.forEach((sh, i) => { state.strokes[i].el.setAttribute('d', toPath(sh.pts)); state.strokes[i].length = sh.length; });
    }
    progress(seg(t, state.window.start, state.window.end));
  };
  render(0);
  return { el: svg, target, kind, picture: pic, get window() { return state.window; }, box: () => state.box, render, progress };
}

/** Where marks of an inner state may sit: inside the frame and clear of the caption band above. */
export const EXPRESSION_SAFE = { x0: 40, x1: 1040, y0: 580, y1: 1860 };
const EXPRESSION_NUDGE = 70;

/**
 * Marks of an inner state (scenes.js expressionMarks) live in the picture's frame: once drawn and on the
 * page they take the side of the head with room, are nudged inside EXPRESSION_SAFE, and take an
 * ink that reads on what is behind them. Brought back across the head, they would read as a mistake: then they
 * are hidden and reported. Measured once, as they start to draw.
 */
function settleExpression(doc, svg) {
  const paths = [...svg.querySelectorAll('path')];
  // Once its first stroke shows: by then the picture has arrived, so where it stands is where the marks go.
  if (!paths.some((p) => p.style.opacity === '1') || !svg.isConnected) return;
  const root = svg.closest('.rd, .nk') ?? svg.parentElement;
  const R = root?.getBoundingClientRect?.();
  if (!(R?.width > 0)) return;
  svg.__settled = true;
  const k = R.width / 1080;
  // The camera is lifted; the picture's own frame stays, because its transform also places it (a centred cutout).
  const boxNow = () => {
    const restore = atRest(root, [svg.parentElement?.parentElement ?? svg]);
    try {
      const rs = paths.map((p) => p.getBoundingClientRect());
      return { left: (Math.min(...rs.map((r) => r.left)) - R.left) / k, top: (Math.min(...rs.map((r) => r.top)) - R.top) / k, right: (Math.max(...rs.map((r) => r.right)) - R.left) / k, bottom: (Math.max(...rs.map((r) => r.bottom)) - R.top) / k };
    } finally {
      restore();
    }
  };
  const S = EXPRESSION_SAFE;
  const overX = (b) => Math.max(0, S.x0 - b.left) + Math.max(0, b.right - S.x1);
  let box = boxNow();
  const marks = svg.__expression;
  // The stage already chose the side, left the room and read the ink from what's measured behind them.
  if (marks?.fixed) {
    if (marks.inked) return;
    const rs = paths.map((p) => p.getBoundingClientRect());
    const left = Math.min(...rs.map((r) => r.left)), top = Math.min(...rs.map((r) => r.top));
    const right = Math.max(...rs.map((r) => r.right)), bottom = Math.max(...rs.map((r) => r.bottom));
    const wanted = paths[0].getAttribute('stroke');
    const ink = pickInk(wanted, behindColour(doc, { left, top, right, bottom, width: right - left, height: bottom - top }, svg));
    if (ink !== wanted) for (const p of paths) p.setAttribute('stroke', ink);
    if (ink === HELIOS.paperLit) svg.style.filter = 'drop-shadow(0 0 5px rgba(8,6,5,.75))';
    return;
  }
  if (marks && overX(box) > 0) {
    marks.flip();
    const other = boxNow();
    if (overX(other) < overX(box)) box = other;
    else marks.flip();
  }
  const dx = box.left < S.x0 ? S.x0 - box.left : box.right > S.x1 ? S.x1 - box.right : 0;
  const dy = box.top < S.y0 ? S.y0 - box.top : box.bottom > S.y1 ? S.y1 - box.bottom : 0;
  // Marks squeezed away from the head read as a mistake: a small nudge at most, else they go.
  if (marks?.crosses(dx / k, dy / k) || Math.hypot(dx, dy) > EXPRESSION_NUDGE) {
    svg.style.display = 'none';
    (doc.__markSkips ??= []).push(`${marks.kind} marks were skipped: they have no room beside the head; make the picture smaller or move it`);
    return;
  }
  if (dx || dy) svg.style.transform = `translate(${(dx / k).toFixed(1)}px, ${(dy / k).toFixed(1)}px)`;
  const wanted = paths[0].getAttribute('stroke');
  const shifted = { left: R.left + (box.left + dx) * k, top: R.top + (box.top + dy) * k, width: (box.right - box.left) * k, height: (box.bottom - box.top) * k };
  const ink = pickInk(wanted, behindColour(doc, shifted, svg));
  if (ink !== wanted) {
    for (const p of paths) p.setAttribute('stroke', ink);
    // Light ink over a picture keeps a soft dark edge, so it still reads where the picture is bright.
    if (ink === HELIOS.paperLit) svg.style.filter = 'drop-shadow(0 0 5px rgba(8,6,5,.75))';
  }
}

/** The start of an arrow, in the frame's coordinates: another target on the same picture, or an element mapped through the screen. */
function boxOfFrom(doc, svg, from, pic) {
  if (typeof from === 'string') {
    const spec = parseTarget(from);
    const media = pic.media;
    const r = spec.kind === 'face' ? findFace(media, spec.value) : spec.kind === 'text' ? findPhrase(media, spec.value) : regionsOf(media).photos[Number(spec.value || 0)];
    return r ? pic.box(r) : null;
  }
  const el = from?.nodeType === 1 ? from : from?.el;
  if (!el?.getBoundingClientRect || !svg.getScreenCTM) return null;
  const m = svg.getScreenCTM()?.inverse();
  if (!m) return null;
  const r = el.getBoundingClientRect();
  const k = Math.hypot(m.a, m.b) || 1;
  const p = new DOMPoint(r.left + r.width / 2, r.top + r.height / 2).matrixTransform(m);
  return { x: p.x - (r.width * k) / 2, y: p.y - (r.height * k) / 2, w: r.width * k, h: r.height * k };
}

// ── Keep-outs ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The best spot for a box of size (w, h) in the overlay zone, clear of `zones` ([{ x, y, w, h, weight }],
 * frame px): least weighted overlap, then nearest to `prefer` ({ x, y }). Pure.
 */
export function clearSpot(size, zones, prefer, { x0 = OVERLAY.x0, x1 = OVERLAY.x1, y0 = OVERLAY.y0, y1 = OVERLAY.y1, step = 10, moveX = false } = {}) {
  const fitX = (x) => clamp(x, x0, Math.max(x0, x1 - size.w));
  const ys = [];
  for (let y = y0; y <= Math.max(y0, y1 - size.h); y += step) ys.push(y);
  const xs = moveX ? [...new Set([fitX(prefer.x), fitX(x0), fitX((x0 + x1 - size.w) / 2), fitX(x1 - size.w)])] : [fitX(prefer.x)];
  let best = null;
  for (const x of xs) {
    for (const y of ys) {
      const c = { x, y, w: size.w, h: size.h };
      const score = zones.reduce((n, z) => n + (z.weight ?? 1) * overlapArea(c, z), 0);
      const dist = Math.abs(y - prefer.y) + Math.abs(x - prefer.x);
      if (!best || score < best.score - 1 || (Math.abs(score - best.score) <= 1 && dist < best.dist)) best = { x, y, score, dist };
    }
  }
  return best ?? { x: fitX(prefer.x), y: prefer.y, score: 0, dist: 0 };
}

/** Keep-out weights: a face or the caption band costs more than a page's text or another label. */
export const KEEPOUT_WEIGHT = { face: 4, keep: 4, caption: 4, focus: 4, text: 2, label: 2, picture: 0.5 };

/**
 * Put everything between `nodes` and `root` at rest while measuring: entrance and camera transforms are
 * lifted (an entrance ends at the laid-out spot; a push moves a face by a few percent), and an element's
 * `data-rest` styles (a lifted piece's resting box) are applied. Returns a function that restores them.
 * The measure is the same whatever moment it runs at, so a label's spot never depends on render order.
 */
function atRest(root, nodes) {
  const saved = [];
  const seen = new Set();
  for (const n of nodes) {
    for (let e = n; e && e !== root.parentElement; e = e.parentElement) {
      if (seen.has(e) || !e.style) continue;
      seen.add(e);
      if (e.style.transform) { saved.push([e, 'transform', e.style.transform]); e.style.transform = 'none'; }
      const rest = e.getAttribute?.('data-rest');
      if (rest) {
        try {
          for (const [k, v] of Object.entries(JSON.parse(rest))) { saved.push([e, k, e.style[k]]); e.style[k] = v; }
        } catch {
          // a bad rest box is ignored
        }
      }
    }
  }
  return () => { for (const [e, k, v] of saved.reverse()) e.style[k] = v; };
}

/** The space between labels stacked in one block, frame px. */
export const BLOCK_GAP = 14;

/**
 * The labels of one frame as one block: each item { w, h, at, until } gets a place under the last, in the order
 * they land; a label that lands after another has left takes its place. Returns { w, h, tops }. Pure.
 */
export function labelBlock(items, gap = BLOCK_GAP) {
  const order = items.map((_, i) => i).sort((a, b) => (items[a].at ?? 0) - (items[b].at ?? 0) || a - b);
  const slots = [];
  const slotOf = new Map();
  for (const i of order) {
    const it = items[i];
    const free = slots.find((s) => s.until <= (it.at ?? 0));
    const slot = free ?? { h: 0, until: 0 };
    if (!free) slots.push(slot);
    slot.h = Math.max(slot.h, it.h);
    slot.until = it.until ?? Infinity;
    slotOf.set(i, slot);
  }
  let y = 0;
  for (const s of slots) { s.top = y; y += s.h + gap; }
  return { w: Math.max(0, ...items.map((it) => it.w)), h: Math.max(0, y - gap), tops: items.map((_, i) => slotOf.get(i).top) };
}

/** Where a frame's labels know each other: their shot in `cuts`, else the whole frame, past its treatments' own roots. */
function labelScope(el) {
  const shot = el.closest?.('[data-shot]');
  if (shot) return shot;
  let top = null;
  for (let e = el.parentElement; e; e = e.parentElement) if (e.matches?.('.rd, .nk')) top = e;
  if (!top) return el.parentElement;
  const up = top.parentElement;
  return up && up !== el.ownerDocument?.body ? up : top;
}

/**
 * Keep a label clear (FRAME.md § Keep-outs): on its first render in a laid-out frame, it and the frame's other
 * labels move, as one left-aligned block, to the nearest spot in the overlay zone that covers no face, no caption
 * band and no page text, or the least. Faces are measured where they rest (atRest), so a person still sliding in is
 * kept clear of too. `near` ({ on, target: 'face:<name>' }) puts the block just under that face (above when there's
 * no room). `at`, `until`: when the label shows, so one that has left gives up its place. Returns { place() }: call
 * place() from render(t); it measures once.
 */
export function keepClear(el, { near = null, gap = 26, at = 0, until = Infinity } = {}) {
  el.setAttribute('data-clear', '');
  const state = { near, gap, at, until, done: false };
  el.__clear = state;
  const place = () => {
    if (state.done) return true;
    const scope = labelScope(el);
    if (!scope?.getBoundingClientRect) return false;
    const R = scope.getBoundingClientRect();
    if (!(R.width > 0) || !(el.offsetHeight > 0)) return false;
    const k = R.width / 1080;
    const toFrame = (r) => ({ x: (r.left - R.left) / k, y: (r.top - R.top) / k, w: r.width / k, h: r.height / k });
    const shot = el.closest('[data-shot]');
    // Labels form a block only with labels of the same owner: a label for someone else goes by them.
    const members = [...scope.querySelectorAll('[data-clear]')].filter((m) => m.__clear && m.offsetHeight > 0 && m.closest('[data-shot]') === shot && sameOwner(m.__clear.near, near));
    const keep = [...scope.querySelectorAll('[data-keepout], [data-focus]')];
    const nearSpec = members.map((m) => m.__clear.near).find(Boolean) ?? null;
    const nearPic = nearSpec ? pictureOf(el.ownerDocument, nearSpec.on, nearSpec.media) : null;
    const restore = atRest(scope, [...members, ...keep, ...(nearPic ? [nearPic.frame] : [])]);
    try {
      return measureAndPlace(toFrame, members, keep, nearSpec);
    } finally {
      restore();
    }
  };
  const measureAndPlace = (toFrame, members, keep, nearSpec) => {
    const boxes = members.map((m) => toFrame(m.getBoundingClientRect()));
    const block = labelBlock(members.map((m, i) => ({ w: boxes[i].w, h: boxes[i].h, at: m.__clear.at, until: m.__clear.until })));
    const zones = [{ ...CAPTION_KEEPOUT, weight: KEEPOUT_WEIGHT.caption }];
    for (const z of keep) {
      if (members.some((m) => z === m || m.contains(z) || z.contains(m)) || z.closest('[data-anchor]')?.style.display === 'none') continue;
      const b = toFrame(z.getBoundingClientRect());
      if (!(b.w > 0 && b.h > 0)) continue;
      const kind = z.getAttribute('data-keepout') ?? 'focus';
      // A picture counts only where there is space off it: not one that fills the frame, a backdrop, or under a label that belongs on it.
      if (kind === 'picture' && (nearSpec || z.hasAttribute('data-backdrop') || (b.w >= 972 && b.h >= 1400))) continue;
      const pad = kind === 'face' ? 0.12 : 0.02;
      zones.push({ x: b.x - b.w * pad, y: b.y - b.h * pad, w: b.w * (1 + 2 * pad), h: b.h * (1 + 2 * pad), weight: KEEPOUT_WEIGHT[kind] ?? 1 });
    }
    const size = { w: block.w, h: block.h };
    const first = boxes[members.indexOf(el)] ?? boxes[0];
    let prefer = members.length > 1 ? { x: Math.min(...boxes.map((b) => b.x)), y: Math.min(...boxes.map((b) => b.y)) } : { x: first.x, y: first.y };
    let moveX = false;
    if (nearSpec) {
      const m = nearBox(el.ownerDocument, nearSpec);
      if (m) {
        const f = toFrame(m);
        const space = members.find((x) => x.__clear.near === nearSpec)?.__clear.gap ?? 26;
        const below = f.y + f.h + space;
        prefer = { x: f.x + f.w / 2 - size.w / 2, y: below + size.h <= OVERLAY.y1 ? below : f.y - space - size.h };
        moveX = true;
      }
    }
    const here = { ...prefer, ...size };
    const best = clearSpot(size, zones, prefer, { moveX: moveX || zones.some((z) => overlapArea(here, z) > 0) });
    members.forEach((m, i) => {
      const me = boxes[i];
      const s = m.offsetHeight ? me.h / m.offsetHeight : 1;
      const dx = (best.x - me.x) / (s || 1), dy = (best.y + block.tops[i] - me.y) / (s || 1);
      if (Math.abs(dx) > 0.5) m.style.left = `${(parseFloat(m.style.left) || m.offsetLeft || 0) + dx}px`;
      if (Math.abs(dy) > 0.5) m.style.top = `${(parseFloat(m.style.top) || m.offsetTop || 0) + dy}px`;
      m.setAttribute('data-keepout', 'label');
      m.__clear.done = true;
    });
    return true;
  };
  return { place };
}

const sameOwner = (a, b) => (!a && !b) || (Boolean(a) && Boolean(b) && a.on === b.on && a.target === b.target && a.whole === b.whole);

/** The screen box of a `near` target ({ on, target: 'face:<name>' }, or { on, whole: true }: all of it), or null. */
function nearBox(doc, near) {
  const pic = pictureOf(doc, near.on, near.media);
  if (!pic) return null;
  const spec = parseTarget(near.target ?? 'face:0');
  const region = near.whole ? (okBox(pic.media?.regions?.visible) ? pic.media.regions.visible : { x: 0, y: 0, w: 1, h: 1 }) : spec.kind === 'face' ? findFace(pic.media, spec.value) : spec.kind === 'text' ? findPhrase(pic.media, spec.value) : spec.kind === 'el' ? null : regionsOf(pic.media).photos[Number(spec.value || 0)];
  pic.sync();
  if (spec.kind === 'el' && !near.whole) return spec.el.getBoundingClientRect();
  const b = region ? pic.box(region) : null;
  if (!b) return null;
  const tmp = h(doc, 'div', { style: { position: 'absolute', left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` } });
  pic.frame.append(tmp);
  const r = tmp.getBoundingClientRect();
  tmp.remove();
  return r;
}

/**
 * The drawn elements' paper, keyed out (drawings never show paper): an opaque drawing (white paper
 * around the ink) is redrawn once into a canvas whose paper is transparent, so it sits on any ground.
 * A picture that already has transparency is left as it is. Returns true once settled.
 */
export function keyPaper(img, canvas) {
  if (img.__keyed !== undefined) return true;
  if (!img.complete || !img.naturalWidth) return false;
  if (inkBounds(img)) { img.__keyed = false; return true; } // already transparent around its ink
  try {
    const n = Math.min(1600, img.naturalWidth);
    const m = Math.round((img.naturalHeight * n) / img.naturalWidth);
    canvas.width = n; canvas.height = m;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, n, m);
    const data = g.getImageData(0, 0, n, m);
    const d = data.data;
    let x0 = n, y0 = m, x1 = -1, y1 = -1;
    for (let i = 0; i < d.length; i += 4) {
      const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      // Paper (light, unsaturated) goes clear; ink keeps its colour, its edge feathered.
      const a = clamp((0.92 - l) / 0.3);
      d[i + 3] = Math.round(d[i + 3] * a);
      if (a > 0.1) {
        const p = i / 4, x = p % n, y = (p - x) / n;
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      }
    }
    g.putImageData(data, 0, 0);
    img.__ink = x1 >= x0 ? { x: x0 / n, y: y0 / m, w: (x1 - x0 + 1) / n, h: (y1 - y0 + 1) / m } : null;
    img.__keyed = true;
  } catch {
    img.__keyed = false; // a tainted canvas: the picture stays as it is (the screen check reports a white box)
  }
  return true;
}
