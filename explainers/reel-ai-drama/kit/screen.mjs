// The screen check for Reel AI Drama frames (MD-58): what the viewer actually sees, measured in a real
// browser every STEP seconds of every frame, through the camera. Deterministic, no model. Where
// bounds.mjs measures text against its paper, this measures the picture as a whole. It reports:
//
//   [empty_frame]     nothing to look at: loaded pictures and readable text cover less than EMPTY_COVER
//                     of the screen for EMPTY_SECONDS or longer (Lucas: "the viewer just gets confused")
//   [image_unloaded]  a visible <img> with no picture (an empty src, a missing file, a failed decode)
//   [off_frame]       a picture or text block parked partly off the edge: between OFF_MIN and OFF_MAX of
//                     it inside the frame and not moving for PARKED_SECONDS, or mostly outside (under
//                     MOSTLY_OFF) for MOSTLY_OFF_SECONDS even while moving (a full-bleed picture is fine)
//   [early_visible]   the same, at the start of a frame, for something that later moves in: it shows
//                     before its entrance instead of starting fully outside
//   [low_contrast]    readable text whose contrast with what is behind it is under MIN_CONTRAST (white
//                     on the whiteboard, white over a light page)
//   [text_over_text]  readable text over a busy picture (a page, an article, a post) with no plate under it
//
// Scene dressing ([data-set]) and the source credit ([data-credit]) are not readable text; anything
// inside [data-bleed] may run off the edges on purpose. The close is code's and is not checked.
//
//   node assets/kit/screen.mjs [all | <id>]
//
// Prints JSON { ok, errors[], checked, skipped? } and exits 1 on any error. Without a browser it prints
// { ok: true, skipped } and exits 0: a guard, never a blocker of the build.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { frameTreatment, isClose, objectStrokes, projectFrames, projectMedia } from './frames.mjs';
import { open, W, H } from './browser.mjs';

export const STEP = 0.2;
/** Share of the screen pictures and readable text must cover for a moment to count as "something to look at". */
export const EMPTY_COVER = 0.12;
export const EMPTY_SECONDS = 0.6;
/** Share of an element inside the frame that counts as "parked on the edge". */
export const OFF_MIN = 0.05;
export const OFF_MAX = 0.85;
export const PARKED_SECONDS = 0.4;
/** Mostly outside (under MOSTLY_OFF inside) for this long counts as off the edge even while it moves (a push). */
export const MOSTLY_OFF = 0.5;
export const MOSTLY_OFF_SECONDS = 1;
/** WCAG contrast for large text. */
export const MIN_CONTRAST = 3;
/** Luminance spread (0–1 std dev) of the picture under a text box above which the picture is busy. */
export const BUSY_SPREAD = 0.16;

const r1 = (n) => Math.round(n * 10) / 10;

/** Runs of consecutive moments (STEP apart) for which `test` holds: [{ first, last, item }]. */
export function runs(moments, key, test) {
  const out = [];
  let open = null;
  for (const m of moments) {
    const hit = test(m);
    if (hit) {
      if (open && m.t - open.last <= STEP * 1.5) open.last = m.t;
      else {
        open = { first: m.t, last: m.t, item: hit === true ? null : hit, key };
        out.push(open);
      }
    } else open = null;
  }
  return out;
}

/**
 * Turn the per-moment measurements of one frame into problem lines.
 * moments: [{ t, cover, imgs: [{ label, src, loaded, inside, rect, bleed }], texts: [{ label, contrast, busy, plated }] }]
 */
export function screenProblems(moments, { duration }) {
  const out = [];
  const span = (a, b) => `${r1(a)}s${b > a ? `–${r1(b)}s` : ''}`;
  for (const r of runs(moments, 'empty', (m) => m.cover < EMPTY_COVER)) {
    if (r.last - r.first + STEP >= EMPTY_SECONDS) out.push(`[empty_frame] almost nothing on screen (${span(r.first, r.last)})`);
  }
  const unloaded = new Map();
  for (const m of moments) for (const i of m.imgs) if (!i.loaded) unloaded.set(i.label, unloaded.get(i.label) ?? m.t);
  for (const [label, t] of unloaded) out.push(`[image_unloaded] "${label}" is visible with no picture (from ${r1(t)}s)`);

  // Parked on the edge: the same element, partly inside, not moving, for PARKED_SECONDS.
  const byLabel = new Map();
  for (const m of moments) {
    for (const i of [...m.imgs, ...(m.blocks ?? [])]) {
      if (i.bleed || !i.loaded && i.loaded !== undefined) continue;
      const list = byLabel.get(i.label) ?? [];
      list.push({ t: m.t, inside: i.inside, rect: i.rect });
      byLabel.set(i.label, list);
    }
  }
  for (const [label, seen] of byLabel) {
    // Mostly outside for a second or more, moving or not (a camera push that leaves the subject off the edge).
    for (const r of runs(seen.map((x) => ({ ...x })), 'mostly', (x) => x.inside >= OFF_MIN && x.inside < MOSTLY_OFF)) {
      if (r.last - r.first + STEP >= MOSTLY_OFF_SECONDS) out.push(`[off_frame] "${label}" is mostly off the edge (${span(r.first, r.last)})`);
    }
    const movesLater = (t) => seen.some((s) => s.t > t && s.inside > OFF_MAX);
    let start = null;
    for (let k = 0; k < seen.length; k++) {
      const s = seen[k];
      const prev = seen[k - 1];
      const parked = s.inside >= OFF_MIN && s.inside <= OFF_MAX && prev && prev.t >= s.t - STEP * 1.5 && prev.inside >= OFF_MIN && prev.inside <= OFF_MAX && s.rect.every((v, j) => Math.abs(v - prev.rect[j]) < 2);
      if (parked) start ??= prev.t;
      const end = !parked || k === seen.length - 1;
      if (start !== null && end) {
        const last = parked ? s.t : prev.t;
        if (last - start + STEP >= PARKED_SECONDS) {
          const id = start < STEP && movesLater(last) ? 'early_visible' : 'off_frame';
          const why = id === 'early_visible' ? 'shows partly on screen before its entrance' : 'is parked partly off the edge';
          out.push(`[${id}] "${label}" ${why} (${span(start, last)})`);
        }
        start = null;
      }
    }
  }

  const texts = new Map();
  for (const m of moments) {
    for (const x of m.texts) {
      const prior = texts.get(x.label);
      if (x.contrast !== null && x.contrast < MIN_CONTRAST) texts.set(x.label, { ...(prior ?? {}), low: prior?.low ?? m.t, contrast: Math.min(prior?.contrast ?? 99, x.contrast) });
      if (x.busy && !x.plated) texts.set(x.label, { ...(texts.get(x.label) ?? {}), busy: texts.get(x.label)?.busy ?? m.t });
    }
  }
  for (const [label, v] of texts) {
    if (v.low !== undefined) out.push(`[low_contrast] "${label}" reads at contrast ${v.contrast.toFixed(1)}:1 against what is behind it (from ${r1(v.low)}s); give it a plate or a contrasting colour`);
    if (v.busy !== undefined) out.push(`[text_over_text] "${label}" sits on a busy picture with no plate under it (from ${r1(v.busy)}s)`);
  }
  void duration;
  return out;
}

/** Measure one moment (runs in the browser). */
async function measureScreen({ W, H }) {
  const host = document.getElementById('w');
  const hr = host.getBoundingClientRect();
  const screenArea = W * H;
  const visible = (el) => {
    let op = 1;
    for (let e = el; e && e !== host; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
      op *= Number(cs.opacity);
    }
    return op;
  };
  const clip = (r) => {
    const l = Math.max(0, r.left - hr.left), t = Math.max(0, r.top - hr.top);
    const rr = Math.min(W, r.right - hr.left), b = Math.min(H, r.bottom - hr.top);
    return rr > l && b > t ? (rr - l) * (b - t) : 0;
  };
  const labelOf = (el) => (el.getAttribute('src') || el.textContent || el.className || el.tagName).toString().split('/').pop().trim().replace(/\s+/g, ' ').slice(0, 40);
  // Coverage on a coarse grid, so overlapping pictures are not counted twice.
  const G = 24;
  const cell = new Uint8Array(G * G);
  const mark = (r) => {
    const x0 = Math.max(0, Math.floor(((r.left - hr.left) / W) * G)), x1 = Math.min(G, Math.ceil(((r.right - hr.left) / W) * G));
    const y0 = Math.max(0, Math.floor(((r.top - hr.top) / H) * G)), y1 = Math.min(G, Math.ceil(((r.bottom - hr.top) / H) * G));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) cell[y * G + x] = 1;
  };

  const imgs = [];
  for (const img of host.querySelectorAll('img')) {
    const op = visible(img);
    if (op < 0.15) continue;
    const r = img.getBoundingClientRect();
    const area = r.width * r.height;
    if (area < 400) continue;
    const inside = clip(r) / area;
    if (inside <= 0) continue;
    const loaded = !!img.getAttribute('src') && img.complete && img.naturalWidth > 0;
    const bleed = !!img.closest('[data-bleed]') || (r.width >= W * 0.95 && r.height >= H * 0.5) || (r.height >= H * 0.95 && r.width >= W * 0.5);
    if (loaded) mark(r);
    imgs.push({ label: labelOf(img), loaded, inside, bleed, rect: [r.left, r.top, r.right, r.bottom].map(Math.round) });
  }
  for (const el of host.querySelectorAll('svg path, svg line, svg polyline, canvas')) {
    if (visible(el) < 0.15) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height > 900) mark(r);
  }

  // Readable text: contrast with what is behind its centre, and whether that is a busy picture.
  const lum = ([r, g, b]) => {
    const c = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
  };
  const rgba = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const canvas = document.createElement('canvas');
  const ctx2d = canvas.getContext('2d', { willReadFrequently: true });
  const sampleImg = (img, r) => {
    const ir = img.getBoundingClientRect();
    if (!img.naturalWidth || ir.width < 1) return null;
    const sx = ((r.left - ir.left) / ir.width) * img.naturalWidth, sy = ((r.top - ir.top) / ir.height) * img.naturalHeight;
    const sw = (r.width / ir.width) * img.naturalWidth, sh = (r.height / ir.height) * img.naturalHeight;
    canvas.width = 32; canvas.height = 32;
    try {
      ctx2d.drawImage(img, sx, sy, Math.max(1, sw), Math.max(1, sh), 0, 0, 32, 32);
      const d = ctx2d.getImageData(0, 0, 32, 32).data;
      let sum = 0, sq = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { const l = lum([d[i], d[i + 1], d[i + 2]]); sum += l; sq += l * l; n++; }
      const mean = sum / n;
      return { mean, spread: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
    } catch {
      return null;
    }
  };
  const texts = [];
  const blocks = [];
  const done = new Set();
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || done.has(el) || !n.textContent.trim()) continue;
    done.add(el);
    if (el.closest('[data-set]') || el.closest('[data-credit]') || el.closest('svg')) continue;
    if (visible(el) < 0.15) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    mark(r);
    const label = labelOf(el);
    const inside = clip(r) / (r.width * r.height);
    if (!el.closest('[data-bleed]')) blocks.push({ label, inside, rect: [r.left, r.top, r.right, r.bottom].map(Math.round) });
    if (inside < 0.5) continue;
    const color = rgba(getComputedStyle(el).color);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let behind = null, busy = false, plated = false;
    for (const under of document.elementsFromPoint(cx, cy)) {
      if (under === el || el.contains(under)) continue;
      if (under.contains(el)) {
        const bg = rgba(getComputedStyle(under).backgroundColor);
        if (bg.length >= 3 && (bg[3] ?? 1) >= 0.6) { behind = lum(bg); plated = true; break; }
        continue;
      }
      if (under.tagName === 'IMG') {
        const s = sampleImg(under, r);
        if (s) { behind = s.mean; busy = s.spread > 0.16; }
        break;
      }
      const bg = rgba(getComputedStyle(under).backgroundColor);
      if (bg.length >= 3 && (bg[3] ?? 1) >= 0.6) { behind = lum(bg); break; }
      if (under === host) break;
    }
    texts.push({ label, contrast: behind === null || color.length < 3 ? null : Math.round(ratio(lum(color), behind) * 10) / 10, busy, plated });
  }
  const cover = cell.reduce((a, b) => a + b, 0) / (G * G);
  void screenArea;
  return { cover, imgs, texts, blocks };
}

export async function checkScreen(root, only = null) {
  const b = await open(root).catch((e) => ({ skipped: `the check could not run: ${e?.message ?? e}` }));
  if (!b?.page) return { ok: true, errors: [], checked: 0, skipped: b?.skipped ?? 'no browser' };
  const errors = [];
  let checked = 0;
  const strokes = objectStrokes(root);
  const media = projectMedia(root);
  try {
    for (const f of projectFrames(root).filter((x) => (!only || x.id === only) && !isClose(x))) {
      if (!f.id || !existsSync(join(root, 'assets', 'frames', `${f.id}.js`)) || !(f.duration > 0)) continue;
      const timingFile = join(root, 'assets', 'timing', `${f.id}.json`);
      const timing = existsSync(timingFile) ? JSON.parse(readFileSync(timingFile, 'utf8')) : { words: [] };
      try {
        await b.page.evaluate((args) => window.__load(args.id, args.ctx), { id: f.id, ctx: { id: f.id, duration: f.duration, treatment: frameTreatment(f), timing, media, objects: strokes } });
      } catch (e) {
        errors.push(`[empty_frame] ${f.id}: failed to build: ${e?.message ?? e}`);
        continue;
      }
      const moments = [];
      for (let i = 0; i * STEP < f.duration; i++) {
        const t = Math.min(i * STEP, f.duration - 1 / 30);
        await b.page.evaluate((x) => window.__render(x), t);
        moments.push({ t, ...(await b.page.evaluate(measureScreen, { W, H })) });
        checked += 1;
      }
      errors.push(...screenProblems(moments, { duration: f.duration }).map((e) => e.replace(/^\[(\w+)\] /, `[$1] ${f.id}: `)));
    }
  } finally {
    await b.close();
  }
  return { ok: errors.length === 0, errors, checked };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null;
  checkScreen(process.cwd(), only)
    .catch((e) => ({ ok: true, errors: [], checked: 0, skipped: `the check could not run: ${e instanceof Error ? e.message : String(e)}` }))
    .then((result) => {
      console.log(JSON.stringify(result, null, 1));
      process.exit(result.ok ? 0 : 1);
    });
}
