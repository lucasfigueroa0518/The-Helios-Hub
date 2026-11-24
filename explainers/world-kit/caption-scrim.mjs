// The caption scrim (Lucas 2026-11-17: "only an issue in SOME frames ... where there's clashing
// visuals behind the captions"; he picked the white gradient over a halo or white text). Code, no
// model: every voiced frame is drawn every STEP seconds, and only its caption band is measured.
// Where the picture holds enough pixels the caption ink can't stand out against (dark lines, props,
// screens on a paper frame; light things on a dark frame), or any drawn words lie under the band
// (2026-11-24: a sign's text under a caption), that moment gets a window. The caption
// skin fades a white gradient in over the top of the picture for each window and sets its text in ink.
//
//   node assets/kit/caption-scrim.mjs        (in the project root; build.ts runs it before captions.mjs)
//
// Writes `var SCRIM = [[start, end], …];` (reel seconds) into .hyperframes/caption-skin.html and
// prints JSON { ok, windows, samples, clashing, ms, skipped? }. Without a browser driver or a Chrome
// it writes nothing and prints { ok: true, skipped }: a guard, never a blocker. The band's pixels are
// decoded and counted in the same headless page (no image library needed in the job's project).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { contrastRatio } from './caption-legibility.mjs';
import { projectFrames } from './frames.mjs';
import { darkWindows, quietWindows } from './mount.mjs';

/** The caption band (caption-skin.html .caption-stage): where the words can be. */
export const BAND = { x: 96, y: 292, width: 844, height: 250 };
/** Seconds between measured moments of a frame. */
export const STEP = 0.5;
/** A band pixel clashes with the caption ink under this contrast ratio. */
export const CLASH_CONTRAST = 3;
/** A moment needs the scrim when more than this share of its band clashes. */
export const CLASH_SHARE = 0.03;
/** Clashing moments closer than this (seconds) share one window: no flicker between them. */
export const MERGE_GAP = 0.75;
/** A window lasts at least this long (seconds), inside its frame. */
export const MIN_WINDOW = 1.2;
/** Every SAMPLE_PX-th pixel on each axis is measured (speed; the band is 844x250). */
const SAMPLE_PX = 2;

export const PAPER_INK = [23, 23, 23];
export const DARK_INK = [251, 250, 246];

/**
 * Share of the band's pixels (RGBA, w x h) whose contrast with `ink` is under CLASH_CONTRAST.
 * pageClashShare below is the same count, written to run inside the page.
 */
export function clashShare(rgba, w, h, ink, step = SAMPLE_PX) {
  let low = 0;
  let n = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      n++;
      if (contrastRatio([rgba[i], rgba[i + 1], rgba[i + 2]], ink) < CLASH_CONTRAST) low++;
    }
  }
  return n ? low / n : 0;
}

/** clashShare inside the page, on a PNG screenshot (base64): self-contained, it is serialised. */
async function pageClashShare([b64, ink, minContrast, step]) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const li = lum(ink[0], ink[1], ink[2]);
  // the band's scale in the screenshot (a device scale factor > 1 doubles it)
  const s = Math.max(1, Math.round(step * (bmp.width / 844)));
  let low = 0;
  let n = 0;
  for (let y = 0; y < bmp.height; y += s) {
    for (let x = 0; x < bmp.width; x += s) {
      const i = (y * bmp.width + x) * 4;
      const l = lum(d[i], d[i + 1], d[i + 2]);
      n++;
      if ((Math.max(l, li) + 0.05) / (Math.min(l, li) + 0.05) < minContrast) low++;
    }
  }
  return n ? low / n : 0;
}

/**
 * Whether drawn text (any `[data-k="text"]` or `<text>` showing, set text and signs included; not the
 * title or dictionary cards, which live in the band) lies under the caption band: a caption over
 * other words reads as two lines at once even when their contrast is fine (2026-11-24, job 88's quiz
 * board "4,817 x 263" under the captions). Runs inside the page, where the frame is drawn at 1:1.
 */
function pageTextInBand([band, share]) {
  const host = document.getElementById('w');
  if (!host) return false;
  for (const el of host.querySelectorAll('[data-k="text"], text')) {
    if (el.parentElement?.closest('[data-k="text"]')) continue;
    if (el.closest('[data-role="title"], [data-role="definition"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    let op = 1;
    for (let n = el; n && n !== host; n = n.parentElement) {
      const a = parseFloat(n.getAttribute('opacity') ?? '1');
      if (Number.isFinite(a)) op *= a;
    }
    if (op < 0.15) continue;
    const across = Math.min(r.right, band.x + band.width) - Math.max(r.left, band.x);
    const down = Math.min(r.bottom, band.y + band.height) - Math.max(r.top, band.y);
    if (across > 0 && down / r.height >= share) return true;
  }
  return false;
}

/** The share of a text's height inside the band that puts it under the captions. */
export const TEXT_IN_BAND = 0.25;

/** The moments of a frame that are measured, in seconds into the frame. */
export function sampleTimes(duration) {
  const out = [];
  for (let t = STEP / 2; t < duration; t += STEP) out.push(Math.round(t * 1000) / 1000);
  return out;
}

const round = (n) => Math.round(n * 1000) / 1000;

/**
 * Windows from one frame's clashing moments: each covers STEP around its moment, near ones merge,
 * short ones grow to MIN_WINDOW, all inside the frame [from, from + duration] (reel seconds).
 */
export function frameWindows(clashTimes, from, duration) {
  const end = from + duration;
  const wins = [];
  for (const t of [...clashTimes].sort((a, b) => a - b)) {
    const a = Math.max(from, from + t - STEP / 2);
    const b = Math.min(end, from + t + STEP / 2);
    const last = wins[wins.length - 1];
    if (last && a - last[1] <= MERGE_GAP) last[1] = Math.max(last[1], b);
    else wins.push([a, b]);
  }
  for (const w of wins) {
    const short = MIN_WINDOW - (w[1] - w[0]);
    if (short > 0) {
      w[0] = Math.max(from, w[0] - short / 2);
      w[1] = Math.min(end, w[0] + MIN_WINDOW);
      w[0] = Math.max(from, w[1] - MIN_WINDOW);
    }
  }
  // growing can make neighbours touch
  const out = [];
  for (const w of wins) {
    const last = out[out.length - 1];
    if (last && w[0] - last[1] <= MERGE_GAP) last[1] = Math.max(last[1], w[1]);
    else out.push([...w]);
  }
  return out.map(([a, b]) => [round(a), round(b)]);
}

/** Write `var SCRIM = …;` into the skin's text; unchanged when the skin has no SCRIM hole. */
export function fillScrim(html, windows) {
  return html.replace(/^([ \t]*)var SCRIM = \[[\s\S]*?\];/m, (_, indent) => `${indent}var SCRIM = ${JSON.stringify(windows)};`);
}

/** Measure the project's frames and fill the skin. */
export async function captionScrim(root) {
  const started = Date.now();
  const { groundOf, shoot } = await import('./snap.mjs');

  const frames = projectFrames(root);
  const quiet = quietWindows(frames);
  const isQuiet = (a, b) => quiet.some(([qa, qb]) => a >= qa - 1e-6 && b <= qb + 1e-6);
  const jobs = [];
  const perFrame = [];
  const errors = [];
  let at = 0;
  for (const entry of frames) {
    const dur = entry.duration > 0 ? entry.duration : 0;
    const from = at;
    at += dur;
    if (!dur || isQuiet(from, from + dur)) continue;
    const file = join(root, 'assets', 'frames', `${entry.id}.js`);
    if (!entry.id || !existsSync(file)) continue;
    let scene;
    try {
      scene = (await import(`${pathToFileURL(file).href}?scrim${Date.now()}`)).default;
    } catch (e) {
      errors.push(`${entry.id}.js failed to load: ${e?.message ?? e}`);
      continue;
    }
    if (typeof scene?.draw !== 'function') continue;
    const ink = darkWindows([entry]).length ? DARK_INK : PAPER_INK;
    const rec = { id: entry.id, from, dur, clash: [] };
    perFrame.push(rec);
    const ground = scene.ground ?? groundOf(entry);
    for (const t of sampleTimes(dur)) {
      jobs.push({
        label: `${entry.id} draw(${t})`,
        ground,
        draw: () => scene.draw(t),
        clip: BAND,
        take: async (buf, page) => {
          const share = await page.evaluate(pageClashShare, [Buffer.from(buf).toString('base64'), ink, CLASH_CONTRAST, SAMPLE_PX]);
          const words = share > CLASH_SHARE ? false : await page.evaluate(pageTextInBand, [BAND, TEXT_IN_BAND]);
          if (share > CLASH_SHARE || words) rec.clash.push(t);
        },
      });
    }
  }
  const shot = await shoot(root, jobs);
  if (shot.skipped) return { ok: true, skipped: shot.skipped, windows: [] };
  errors.push(...shot.errors);
  const windows = perFrame.flatMap((f) => frameWindows(f.clash, f.from, f.dur));
  const skin = join(root, '.hyperframes', 'caption-skin.html');
  if (existsSync(skin)) {
    const html = readFileSync(skin, 'utf8');
    const next = fillScrim(html, windows);
    if (next !== html) writeFileSync(skin, next);
  }
  return {
    ok: errors.length === 0,
    windows,
    samples: jobs.length,
    clashing: Object.fromEntries(perFrame.filter((f) => f.clash.length).map((f) => [f.id, f.clash])),
    ms: Date.now() - started,
    ...(errors.length ? { errors } : {}),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // no top-level await: tests load this file through a CommonJS transform
  captionScrim(process.cwd())
    .catch((e) => ({ ok: false, windows: [], errors: [e instanceof Error ? e.message : String(e)] }))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 1)}\n`, () => process.exit(result.ok ? 0 : 1)));
}
