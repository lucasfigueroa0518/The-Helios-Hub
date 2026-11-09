// The text-bounds check for AI News Explained frames, forked from the world kit's bounds.mjs (EX3-92)
// for DOM-built frames. Every piece of readable text, measured in a real browser every STEP seconds of
// every frame, through the camera. Deterministic, no model. It reports text that is:
//
//   cut off      partly outside the frame (wholly outside = out of the camera's view, fine)
//   off its paper  crossing the edge of the clipping, sheet, printout, card or tag it is printed on
//   under captions in the caption band while captions show (not during the sting or the close)
//   too small    rendered smaller than MIN_TEXT_PX on screen (RC-50: text a frame wants read must read
//                on a phone; anything smaller must be filler lines)
//   covering     a pin, magnet or tape over a photo's inner area, or a cord across it (RC-50)
//   off the wall paper, photos, pins, tape or cord on the whiteboard, beyond the artifact and logos (RC-49)
//
// Scene dressing is not readable text: anything inside [data-set] (mastheads, datelines, kickers) is
// skipped. The close is code's and is not checked.
//
//   node assets/kit/bounds.mjs [all | <id>]
//
// Prints JSON { ok, errors[], checked, skipped? } and exits 1 on any error. Without a browser it
// prints { ok: true, skipped } and exits 0: a guard, never a blocker of the build.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { STING_FRAME, frameGround, isClose, projectFrames, objectStrokes, stingAt } from './frames.mjs';
import { open, W, H } from './browser.mjs';

export const STEP = 0.2;
/** The caption band (frame.md's caption skin), in screen px. */
export const CAPTION_BAND = { top: 260, bottom: 560 };
/** Smallest readable glyph size on screen (font px × camera scale), RC-50. */
export const MIN_TEXT_PX = 26;
const SLACK = 3;
const IN_BAND = 0.25;

/** The problems with the text measured at one moment. `items`: [{ label, rect, paper, px }]. */
export function textProblems(items, { captions = true } = {}) {
  const out = [];
  for (const { label, rect, paper, px } of items) {
    const [l, t, r, b] = rect;
    if (r <= 0 || l >= W || b <= 0 || t >= H) continue;
    if (l < -SLACK || t < -SLACK || r > W + SLACK || b > H + SLACK) out.push({ label, why: 'is cut off by the frame edge' });
    if (paper && (l < paper[0] - SLACK || t < paper[1] - SLACK || r > paper[2] + SLACK || b > paper[3] + SLACK)) out.push({ label, why: 'runs off the paper it is printed on' });
    const inBand = Math.max(0, Math.min(b, CAPTION_BAND.bottom) - Math.max(t, CAPTION_BAND.top));
    if (captions && inBand > IN_BAND * (b - t)) out.push({ label, why: `sits under the captions (y ${CAPTION_BAND.top}–${CAPTION_BAND.bottom})` });
    if (px < MIN_TEXT_PX) out.push({ label, why: `is too small to read on a phone (${px.toFixed(0)}px on screen, at least ${MIN_TEXT_PX}px; push in, enlarge, or make it filler)` });
  }
  return out;
}

/** The share of a photo's width/height on each side where a fastener may still sit (its edge). */
export const PHOTO_EDGE = 0.12;

/**
 * Fasteners and cords over a photo (RC-50). `fasteners`: [{ kind, rect }] for pins, magnets and
 * tape; `cords`: [{ points: [[x, y]…] }]; `photos`: [{ rect }]. A fastener fails when its centre is
 * inside a photo's inner area (the photo minus PHOTO_EDGE on each side); a cord fails when any of
 * its points is.
 * @param {{ fasteners?: { kind: string, rect: number[] }[], cords?: { points: number[][] }[], photos?: { rect: number[] }[] }} found
 */
export function coverProblems({ fasteners = [], cords = [], photos = [] }) {
  const inner = photos.map(({ rect: [l, t, r, b] }) => {
    const dx = (r - l) * PHOTO_EDGE;
    const dy = (b - t) * PHOTO_EDGE;
    return [l + dx, t + dy, r - dx, b - dy];
  });
  const inside = ([x, y]) => inner.some(([l, t, r, b]) => x > l && x < r && y > t && y < b);
  const out = [];
  for (const { kind, rect: [l, t, r, b] } of fasteners) {
    if (inside([(l + r) / 2, (t + b) / 2])) out.push({ label: kind, why: 'covers a photo (fasteners go on an item\'s border or margin, never on a face or photo)' });
  }
  for (const { points } of cords) {
    if (points.some(inside)) out.push({ label: 'cord', why: 'crosses a photo (cords route around photos)' });
  }
  return out;
}

/** What may be paper or a fastener on the whiteboard (RC-48/49): the verbatim artifact and printed logos, held by magnets. */
export const WHITEBOARD_ALLOWED = new Set(['printout', 'logo', 'magnet']);

/** Items a whiteboard frame must not show. `items`: the kinds visible on the page (see measureCover). */
export function wallProblems(ground, items = []) {
  if (ground !== 'whiteboard') return [];
  return [...new Set(items)].filter((k) => !WHITEBOARD_ALLOWED.has(k))
    .map((k) => ({ label: k, why: 'is on the whiteboard (everything there is drawn in marker; only the artifact printout and printed logos are paper, held by magnets)' }));
}

/** Measure fasteners, cords and photos on the page (runs in the browser). */
function measureCover() {
  const host = document.getElementById('w');
  const shown = (el) => {
    let op = 1;
    for (let e = el; e && e !== host; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      op *= Number(cs.opacity);
    }
    return op >= 0.15;
  };
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return [r.left, r.top, r.right, r.bottom];
  };
  const fasteners = [...host.querySelectorAll('.nk-pin,.nk-mag,.nk-tape')].filter(shown)
    .map((el) => ({ kind: el.classList.contains('nk-pin') ? 'push pin' : el.classList.contains('nk-mag') ? 'magnet' : 'tape', rect: box(el) }));
  const photos = [...host.querySelectorAll('.nk-ph,.nk-halftone,.nk-cut')].filter((el) => shown(el) && el.getBoundingClientRect().width > 1).map((el) => ({ rect: box(el) }));
  const cords = [];
  for (const p of host.querySelectorAll('.nk-cords path,.nk-cords line,.nk-cords polyline')) {
    if (!shown(p) || typeof p.getTotalLength !== 'function') continue;
    const len = p.getTotalLength();
    const m = p.getScreenCTM();
    if (!m || !(len > 0)) continue;
    const points = [];
    for (let i = 1; i < 24; i++) {
      const q = p.getPointAtLength((len * i) / 24);
      points.push([m.a * q.x + m.c * q.y + m.e, m.b * q.x + m.d * q.y + m.f]);
    }
    cords.push({ points });
  }
  const KINDS = { 'nk-print': 'printout', 'nk-logo': 'logo', 'nk-mag': 'magnet', 'nk-pin': 'push pin', 'nk-tape': 'tape', 'nk-cut': 'photo cutout', 'nk-polaroid': 'Polaroid', 'nk-clip': 'clipping', 'nk-article': 'newspaper article', 'nk-sheet': 'sheet', 'nk-index': 'index card', 'nk-tag': 'evidence tag', 'nk-folder': 'folder', 'nk-cords': 'cord' };
  const items = [];
  for (const [cls, kind] of Object.entries(KINDS)) if ([...host.querySelectorAll(`.${cls}`)].some(shown)) items.push(kind);
  const hr = host.getBoundingClientRect();
  const shift = ([l, t, r, b]) => [l - hr.left, t - hr.top, r - hr.left, b - hr.top];
  return {
    items,
    fasteners: fasteners.map((f) => ({ ...f, rect: shift(f.rect) })),
    photos: photos.map((f) => ({ rect: shift(f.rect) })),
    cords: cords.map((c) => ({ points: c.points.map(([x, y]) => [x - hr.left, y - hr.top]) })),
  };
}

/** One line per problem: its label, why, and when (first–last moment seen). */
export function summarize(moments) {
  const seen = new Map();
  for (const { t, problems } of moments) {
    for (const p of problems) {
      const k = `${p.label}\u0000${p.why}`;
      const s = seen.get(k);
      if (s) s.last = t;
      else seen.set(k, { ...p, first: t, last: t });
    }
  }
  return [...seen.values()].map((s) => `"${s.label}" ${s.why} (${s.first.toFixed(1)}s${s.last > s.first ? `–${s.last.toFixed(1)}s` : ''})`);
}

/** Measure readable text on the page (runs in the browser). */
function measure() {
  const host = document.getElementById('w');
  const PAPER = '.nk-clip,.nk-sheet,.nk-print,.nk-index,.nk-tag,.nk-polaroid,.nk-logo,.nk-folder';
  const items = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const done = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || done.has(el) || !n.textContent.trim()) continue;
    done.add(el);
    if (el.closest('[data-set]') || el.closest('svg')) continue;
    let op = 1;
    let hidden = false;
    for (let e = el; e && e !== host; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none') hidden = true;
      op *= Number(cs.opacity);
    }
    if (hidden || op < 0.15) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const scale = el.offsetHeight > 0 ? el.getBoundingClientRect().height / el.offsetHeight : 1;
    const px = parseFloat(getComputedStyle(el).fontSize) * (Number.isFinite(scale) && scale > 0 ? scale : 1);
    const paperEl = el.closest(PAPER);
    const p = paperEl?.getBoundingClientRect();
    items.push({ label: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40), rect: [r.left, r.top, r.right, r.bottom], paper: p ? [p.left, p.top, p.right, p.bottom] : null, px });
  }
  return items;
}

export async function checkBounds(root, only = null) {
  const b = await open(root).catch((e) => ({ skipped: `the check could not run: ${e?.message ?? e}` }));
  if (!b?.page) return { ok: true, errors: [], checked: 0, skipped: b?.skipped ?? 'no browser' };
  const errors = [];
  let checked = 0;
  const strokes = objectStrokes(root);
  try {
    for (const f of projectFrames(root).filter((x) => (!only || x.id === only) && !isClose(x))) {
      if (!f.id || !existsSync(join(root, 'assets', 'frames', `${f.id}.js`)) || !(f.duration > 0)) continue;
      const sting = f.number === STING_FRAME ? { at: stingAt(f) } : null;
      const timingFile = join(root, 'assets', 'timing', `${f.id}.json`);
      const timing = existsSync(timingFile) ? JSON.parse(readFileSync(timingFile, 'utf8')) : { words: [] };
      try {
        await b.page.evaluate((args) => window.__load(args.id, args.ctx), { id: f.id, ctx: { id: f.id, duration: f.duration, ground: frameGround(f), timing, sting, objects: strokes } });
      } catch (e) {
        errors.push(`${f.id}: failed to build: ${e?.message ?? e}`);
        continue;
      }
      const moments = [];
      for (let i = 0; i * STEP < f.duration; i++) {
        const t = Math.min(i * STEP, f.duration - 1 / 30);
        if (sting && t >= sting.at) break; // the sting covers the frame: code's art
        await b.page.evaluate((x) => window.__render(x), t);
        const items = await b.page.evaluate(measure);
        const cover = await b.page.evaluate(measureCover);
        moments.push({ t, problems: [...textProblems(items), ...coverProblems(cover), ...wallProblems(frameGround(f), cover.items)] });
        checked += 1;
      }
      errors.push(...summarize(moments).map((e) => `${f.id}: ${e}`));
    }
  } finally {
    await b.close();
  }
  return { ok: errors.length === 0, errors, checked };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null;
  checkBounds(process.cwd(), only)
    .catch((e) => ({ ok: true, errors: [], checked: 0, skipped: `the check could not run: ${e instanceof Error ? e.message : String(e)}` }))
    .then((result) => {
      console.log(JSON.stringify(result, null, 1));
      process.exit(result.ok ? 0 : 1);
    });
}
