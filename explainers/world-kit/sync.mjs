// Sound sync (Lucas 2026-11-17: "the whoosh that is supposed to align with the orange trim going
// around the whiteboard does not align ... That needs to be checked and aligned for every single
// one, and it can never be wrong"). Deterministic, no model.
//
// Two things used to be guessed, and both were off by up to a second:
//   - when the picture moves: a frame worker writes each event's `t` by hand, and a whoosh's `t`
//     was often the start of a move, not its fastest moment;
//   - where a sound's hit is inside its file: a whoosh was assumed to peak 45% of the way in, and
//     every other sound to start on its first sample (drop-in files peak anywhere, and some open
//     on silence).
// Now both are measured. motionCurves() draws every frame (as mount.mjs draws it) FPS times a
// second in headless Chrome, at a small size, and counts the pixels that change between samples;
// syncTime() moves an event to the motion it belongs to (a whoosh to the fastest moment of the move,
// an impact to where the move lands, a pop, click or tick to where the change appears). soundShape()
// measures a sound's onset and peak with ffmpeg; sound.mjs then starts each file so that its onset
// (or a whoosh's peak) falls exactly on the synced time.
//
//   node assets/kit/sync.mjs      measures every frame and writes .hyperframes/motion.json
//
// Frames whose module did not change keep their cached curve. Without a browser it prints
// { ok: true, skipped } and sound.mjs falls back to the written times (the sound side is still
// measured).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isBankOpener, projectFrames } from './frames.mjs';

/** Samples per second of picture. */
export const FPS = 30;
/** The measuring size (the 1080x1920 frame, scaled down 8x). */
export const MW = 135;
export const MH = 240;
/** A pixel counts as changed when its R+G+B moves by more than this. */
export const PIXEL_DELTA = 36;
export const MOTION_FILE = '.hyperframes/motion.json';
/** How far an event may be moved to its motion, before (EARLY) and after (LATE) its written time. */
export const EARLY = 0.6;
export const LATE = 0.9;

const r3 = (n) => Math.round(n * 1000) / 1000;
const W = 1080;
const H = 1920;

// ── The picture ──────────────────────────────────────────────────────────────────────────────

/** How far an event may be moved: a whoosh may move further later (written at a move's start, its swoosh peaks mid-move). */
export const WINDOW = { whoosh: [EARLY, 1.2], other: [EARLY, LATE] };

/**
 * One frame's motion, read from its curve (changed pixels per sample):
 *   spikes: instant changes (something appears, lands or cuts in), { t, size };
 *   moves:  continuous motion, { a, peak, b, h } (start, fastest moment, end, height), from the
 *           curve with spikes removed and smoothed over 5 samples.
 */
export function features(curve, fps = FPS) {
  const n = curve?.length ?? 0;
  const med = (arr) => {
    const x = [...arr].sort((p, q) => p - q);
    return x[Math.floor(x.length / 2)] ?? 0;
  };
  const clean = [...(curve ?? [])];
  const spikes = [];
  for (let i = 1; i < n; i++) {
    const around = [];
    for (let k = i - 3; k <= i + 3; k++) if (k !== i && k >= 0 && k < n) around.push(curve[k]);
    const base = med(around);
    if (curve[i] >= 30 && curve[i] > base * 4 + 10) {
      spikes.push({ t: r3(i / fps), size: curve[i] });
      clean[i] = base;
    }
  }
  // neighbouring spike samples are one change
  const merged = [];
  for (const sp of spikes) {
    const last = merged.at(-1);
    if (last && sp.t - last.t <= 2.01 / fps) last.size = Math.max(last.size, sp.size);
    else merged.push({ ...sp });
  }
  const sm = clean.map((_, i) => {
    let sum = 0;
    let c = 0;
    for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < n) (sum += clean[k]), c++;
    return sum / c;
  });
  const moves = [];
  const span = Math.round(1.5 * fps);
  for (let i = 1; i < n - 1; i++) {
    if (!(sm[i] > sm[i - 1] && sm[i] >= sm[i + 1]) || sm[i] < 12) continue;
    let l = i;
    let lv = sm[i];
    while (l > 0 && i - l < span && sm[l - 1] <= sm[i]) lv = Math.min(lv, sm[--l]);
    let r = i;
    let rv = sm[i];
    while (r < n - 1 && r - i < span && sm[r + 1] <= sm[i]) rv = Math.min(rv, sm[++r]);
    if (sm[i] - Math.max(lv, rv) < 0.4 * sm[i]) continue;
    let a = i;
    while (a > 0 && sm[a - 1] < sm[a] + 1 && sm[a - 1] > 0.15 * sm[i]) a--;
    let b = i;
    while (b < n - 1 && sm[b + 1] < sm[b] + 1 && sm[b + 1] > 0.15 * sm[i]) b++;
    // a sample counts the change between i-1 and i: the move began one sample earlier
    moves.push({ a: r3(Math.max(0, (a - 1) / fps)), peak: r3((i - 0.5) / fps), b: r3(b / fps), h: Math.round(sm[i]) });
  }
  return { spikes: merged, moves };
}

/** The moments of a frame's motion an event of `kind` may sit on. */
export function anchorsFor(f, kind, t, dur = 0) {
  if (kind === 'sting') return [];
  if (kind === 'whoosh') return f.moves.map((m) => m.peak); // the swoosh at the fastest moment of the move
  const appear = f.spikes.map((s) => s.t);
  if (kind === 'impact') return [...appear, ...f.moves.map((m) => m.b)]; // a landing: where it stops
  if (kind === 'pop' || kind === 'click' || kind === 'tick' || dur) return [...appear, ...f.moves.map((m) => m.a)]; // where it appears or starts
  return [...appear, ...f.moves.flatMap((m) => [m.a, m.b])]; // one-shot foley: either end of a move
}

/**
 * An event's time on the picture: the nearest motion moment it may sit on within its window of the
 * written time, or the written time when nothing moves there (an event on a word, or a sting).
 * Returns { t, from, moved } (frame seconds).
 */
export function syncTime(curve, e, fps = FPS) {
  if (!curve?.length) return { t: e.t, from: e.t, moved: false };
  const [early, late] = e.kind === 'whoosh' ? WINDOW.whoosh : WINDOW.other;
  let best = null;
  for (const at of anchorsFor(features(curve, fps), e.kind, e.t, e.dur)) {
    const d = at - e.t;
    if (d < -early || d > late) continue;
    if (!best || Math.abs(d) < Math.abs(best - e.t)) best = at;
  }
  return best == null ? { t: e.t, from: e.t, moved: false } : { t: r3(best), from: e.t, moved: Math.abs(best - e.t) > 1e-3 };
}

/** The key a frame's cached curve is valid for: its module, the world and the kit's fitting. */
function frameKey(root, f) {
  const h = createHash('sha1');
  for (const p of [join('assets', 'frames', `${f.id}.js`), join('assets', 'world', 'world.js'), join('assets', 'kit', 'scene-fit.js')]) {
    const file = join(root, p);
    h.update(p).update(existsSync(file) ? readFileSync(file) : '');
  }
  return h.update(`${f.duration}|${FPS}|${MW}|${PIXEL_DELTA}`).digest('hex');
}

/** In the page: rasterize each SVG at MW x MH and count the pixels that changed since the previous one. */
async function changedPixels({ svgs, size }) {
  const [w, h, delta, reset] = size;
  const c = (window.__syncCanvas ??= new OffscreenCanvas(w, h));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (reset) window.__syncPrev = null;
  const out = [];
  for (const s of svgs) {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
    try {
      await img.decode();
    } catch {
      out.push(-1);
      continue;
    }
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const prev = window.__syncPrev;
    let n = 0;
    if (prev) for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - prev[i]) + Math.abs(px[i + 1] - prev[i + 1]) + Math.abs(px[i + 2] - prev[i + 2]) > delta) n++;
    window.__syncPrev = px;
    out.push(n);
  }
  return out;
}

/** Inline the project images a frame links (an <img> data URI cannot fetch them). */
function inliner(root) {
  const cache = new Map();
  const mime = (f) => (f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.jpg') || f.endsWith('.jpeg') ? 'image/jpeg' : 'image/png');
  return (svg) =>
    svg.replace(/(href)="((?:\.\.\/)*assets\/[^"]+)"/g, (m, attr, p) => {
      const file = join(root, p.replace(/^(\.\.\/)+/, ''));
      if (!cache.has(file)) cache.set(file, existsSync(file) ? `data:${mime(file)};base64,${readFileSync(file).toString('base64')}` : null);
      return cache.get(file) ? `${attr}="${cache.get(file)}"` : m;
    });
}

/**
 * Every frame's motion curve: { frames: { [id]: { key, fps, curve } } }, written to MOTION_FILE.
 * Unchanged frames keep their cached curve.
 */
export async function motionCurves(root) {
  const file = join(root, MOTION_FILE);
  let cache = { frames: {} };
  try {
    cache = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    /* none yet */
  }
  const frames = projectFrames(root).filter((f) => f.id && f.duration > 0 && existsSync(join(root, 'assets', 'frames', `${f.id}.js`)) && !isBankOpener(root, f));
  const todo = frames.filter((f) => cache.frames?.[f.id]?.key !== frameKey(root, f));
  const result = { frames: Object.fromEntries(frames.filter((f) => !todo.includes(f)).map((f) => [f.id, cache.frames[f.id]])) };
  if (!todo.length) return { ok: true, measured: 0, ...result };
  const { driver, findChrome } = await import(/* webpackIgnore: true */ './bounds.mjs'); // the web app bundles sound.mjs: keep the browser kit out
  const { preparedScene } = await import(/* webpackIgnore: true */ './try.mjs');
  const drv = await driver();
  const exe = drv && findChrome();
  if (!drv || !exe) return { ok: true, measured: 0, skipped: !drv ? 'no browser driver' : 'no headless Chrome', ...result };
  const browser = await drv.launch(exe);
  const inline = inliner(root);
  const errors = [];
  try {
    const page = await browser.page();
    await page.goto('about:blank');
    for (const f of todo) {
      let scene;
      try {
        scene = (await import(/* webpackIgnore: true */ `${pathToFileURL(join(root, 'assets', 'frames', `${f.id}.js`)).href}?sync`)).default;
        if (typeof scene?.draw === 'function') scene = await preparedScene(root, scene, f.duration);
      } catch (e) {
        errors.push(`${f.id}: failed to load (${e?.message ?? e})`);
        continue;
      }
      const n = Math.floor(f.duration * FPS);
      const curve = [];
      for (let i = 0; i <= n; i += 30) {
        const svgs = [];
        for (let k = i; k < Math.min(i + 30, n + 1); k++) {
          let inner = '';
          try {
            inner = scene.draw(Math.min(k / FPS, f.duration - 1 / 120));
          } catch {
            inner = '';
          }
          svgs.push(inline(`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${inner}</svg>`));
        }
        curve.push(...(await page.evaluate(changedPixels, { svgs, size: [MW, MH, PIXEL_DELTA, i === 0] })));
      }
      result.frames[f.id] = { key: frameKey(root, f), fps: FPS, curve: curve.map((x) => Math.max(0, x)) };
    }
  } finally {
    await browser.close();
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(result));
  return { ok: errors.length === 0, measured: todo.length, errors, ...result };
}

/** The cached curves, refreshed first (as a child process, so sync callers can use it). */
export function motionFor(root, { node = process.execPath } = {}) {
  const self = join(root, 'assets', 'kit', 'sync.mjs');
  if (existsSync(self)) spawnSync(node, [self], { cwd: root, encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  try {
    return JSON.parse(readFileSync(join(root, MOTION_FILE), 'utf8')).frames ?? {};
  } catch {
    return {};
  }
}

// ── The sound ────────────────────────────────────────────────────────────────────────────────

const shapes = new Map();

/**
 * A sound file's shape: { onset, peak } in seconds from its start. onset: the first 5 ms window
 * within 18 dB of the loudest; peak: the loudest 30 ms. Measured once per file (ffmpeg).
 */
export function soundShape(file, ffmpeg = 'ffmpeg') {
  if (shapes.has(file)) return shapes.get(file);
  const db = envelope(file, ffmpeg);
  if (!db.length) {
    shapes.set(file, null);
    return null;
  }
  const pk = loudest(db, 0, db.length);
  const max = Math.max(...db);
  const on = db.findIndex((d) => d >= max - 18);
  const shape = { onset: r3(Math.max(0, on) * STEP), peak: r3(pk * STEP + STEP / 2) };
  shapes.set(file, shape);
  return shape;
}

/** Envelope resolution: one RMS level (dB) per STEP seconds. */
export const STEP = 0.005;

/** A file's loudness, one dB value per STEP seconds (ffmpeg). */
export function envelope(file, ffmpeg = 'ffmpeg') {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-af', `aresample=48000,asetnsamples=n=${Math.round(48000 * STEP)},astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return [...String(r.stdout ?? '').matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === '-inf' ? -120 : Math.max(-120, Number(m[1]))));
}

/** The index of the loudest 25 ms in db[from, to). */
export function loudest(db, from, to) {
  const lin = (i) => Math.pow(10, (db[i] ?? -120) / 20);
  let best = from;
  let bestV = -1;
  for (let i = Math.max(0, from); i < Math.min(db.length, to); i++) {
    const v = lin(i - 2) + lin(i - 1) + lin(i) + lin(i + 1) + lin(i + 2);
    if (v > bestV) (bestV = v), (best = i);
  }
  return best;
}

/**
 * Read the mixed events track back and check each whoosh peaks on its time: the loudest moment
 * within 0.3 s of it must sit within TOLERANCE. Returns the ones that do not ({ t, kind, heard }).
 */
export const TOLERANCE = 0.06;
export function offBeat(file, cues, ffmpeg = 'ffmpeg') {
  const db = envelope(file, ffmpeg);
  if (!db.length) return [];
  const out = [];
  for (const c of cues) {
    if (c.kind !== 'whoosh') continue;
    const near = cues.some((o) => o !== c && o.kind !== 'whoosh' && Math.abs(o.hitAt - c.hitAt) < 0.35);
    if (near) continue; // another sound shares the moment: its own hit would mask the peak
    const i = loudest(db, Math.round((c.hitAt - 0.3) / STEP), Math.round((c.hitAt + 0.3) / STEP));
    const heard = r3(i * STEP + STEP / 2);
    if (Math.abs(heard - c.hitAt) > TOLERANCE) out.push({ t: c.hitAt, kind: c.kind, heard });
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  motionCurves(process.cwd())
    .then((r) => {
      const { frames, ...rest } = r;
      process.stdout.write(`${JSON.stringify({ ...rest, frames: Object.keys(frames ?? {}) })}\n`, () => process.exit(0));
    })
    .catch((e) => process.stdout.write(`${JSON.stringify({ ok: true, skipped: String(e?.message ?? e) })}\n`, () => process.exit(0)));
}
