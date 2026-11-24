// Measured in the browser after mount, before sound and captions (iteration 4). Deterministic, no model.
//
//   caption tone   the caption's colour or backing plate is chosen from what is under the caption band,
//                  sampled every STEP seconds of every frame, not from the frame's treatment (white captions
//                  landed on white articles): `dark` (paper-lit words with a soft shadow), `light` (ink
//                  words) or `plate` (paper-lit words on a dark backing plate, for a busy or mid-tone band).
//                  Written into .hyperframes/caption-skin.html as `var TONES = [[start, end, tone], …]`.
//   kit cues       the sound cues the kit's own treatments carry (`stat`, `lift`: `data-cues` on their
//                  element) merged into the frame's events.json (marked `kit: true`, replaced on every run),
//                  so a frame never writes them by hand.
//
//   node assets/kit/measure.mjs
//
// Prints JSON { ok, tones, cues, skipped? }. Without a browser it is skipped: captions fall back to the
// treatment's ground (mount.mjs DARK windows) and the kit cues are not added. Never a blocker.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { frameTreatment, isClose, LIGHT_TREATMENTS, objectStrokes, projectFrames, projectMedia } from './frames.mjs';

export const STEP = 0.2;
/** The caption band the words are set in (the skin's: x 96–940, y 292–542). */
export const BAND = { x: 96, y: 292, w: 844, h: 250 };
/** Paper-lit words read on a band whose bright end (90th percentile luminance) is at most this. */
export const DARK_MAX = 0.3;
/** Ink words read on a band whose dark end (10th percentile luminance) is at least this. */
export const LIGHT_MIN = 0.42;
/** A tone held for less than this inside a frame becomes `plate` (no flicker between ink and paper-lit). */
export const MIN_RUN = 0.8;
export const TONES = ['dark', 'light', 'plate'];

/** The caption tone for one sample of the band: { p10, p90 } luminance (0–1). Pure. */
export function toneFor(sample) {
  if (!sample) return null;
  if (sample.p90 <= DARK_MAX) return 'dark';
  if (sample.p10 >= LIGHT_MIN) return 'light';
  return 'plate';
}

/** WCAG contrast of two luminances. */
export const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** The caption words' luminance per tone (paper-lit #FEF9F3, ink #1F1915). */
export const WORD_LUM = { dark: 0.95, light: 0.012, plate: 0.95 };

/**
 * The worst contrast of the caption words against a band sample under a tone: paper-lit words against the
 * band's bright end, ink against its dark end; a plate is always legible. Pure.
 */
export function captionContrast(tone, sample) {
  if (tone === 'plate') return 21;
  if (!sample) return null;
  return tone === 'light' ? contrast(WORD_LUM.light, sample.p10) : contrast(WORD_LUM.dark, sample.p90);
}

/**
 * Tone windows for one frame from its samples ([{ t, tone }] in frame seconds, STEP apart): runs of one
 * tone; a run shorter than MIN_RUN becomes `plate`; neighbours that agree merge. Returns [[start, end, tone]]
 * in frame seconds covering [0, duration].
 */
export function frameTones(samples, duration) {
  const list = samples.filter((s) => s.tone).sort((a, b) => a.t - b.t);
  if (!list.length) return [];
  const runs = [];
  for (const s of list) {
    const last = runs.at(-1);
    if (last && last.tone === s.tone) last.end = s.t + STEP;
    else runs.push({ start: s.t, end: s.t + STEP, tone: s.tone });
  }
  runs[0].start = 0;
  runs.at(-1).end = duration;
  for (let i = 1; i < runs.length; i++) runs[i].start = runs[i - 1].end;
  for (const r of runs) if (runs.length > 1 && r.end - r.start < MIN_RUN) r.tone = 'plate';
  const out = [];
  for (const r of runs) {
    const last = out.at(-1);
    if (last && last[2] === r.tone) last[1] = r.end;
    else out.push([r.start, r.end, r.tone]);
  }
  return out.map(([a, b, t]) => [round(a), round(Math.min(b, duration)), t]);
}

const round = (n) => Math.round(n * 1000) / 1000;

/** Frame tone windows → reel windows: offsets each frame by its start, merges neighbours that agree. */
export function reelTones(perFrame) {
  const out = [];
  let at = 0;
  for (const f of perFrame) {
    for (const [a, b, tone] of f.windows) {
      const last = out.at(-1);
      if (last && last[2] === tone && Math.abs(last[1] - (at + a)) < 1e-3) last[1] = round(at + b);
      else out.push([round(at + a), round(at + b), tone]);
    }
    at += f.duration;
  }
  return out;
}

/** The fallback tones from treatments alone (no browser): dark everywhere but the whiteboard's ink. */
export function treatmentTones(frames) {
  return reelTones(frames.map((f) => ({ duration: f.duration > 0 ? f.duration : 0, windows: f.duration > 0 && LIGHT_TREATMENTS.has(frameTreatment(f)) ? [[0, f.duration, 'light']] : [[0, f.duration > 0 ? f.duration : 0, 'dark']] })));
}

/** Fill `var TONES = …;` in the project's caption skin. Returns true when written. */
export function fillTones(root, tones) {
  const skin = join(root, '.hyperframes', 'caption-skin.html');
  if (!existsSync(skin)) return false;
  const html = readFileSync(skin, 'utf8');
  const next = html.replace(/^([ \t]*)var TONES = \[[\s\S]*?\];/m, (_, indent) => `${indent}var TONES = ${JSON.stringify(tones)};`);
  if (next !== html) writeFileSync(skin, next);
  return next !== html || html.includes(`var TONES = ${JSON.stringify(tones)};`);
}

/** Merge a frame's kit cues into its events file: earlier kit cues are replaced; cues past the frame are dropped. */
export function mergeKitCues(events, cues, duration) {
  const own = (Array.isArray(events) ? events : []).filter((e) => !e?.kit);
  const kit = cues.filter((c) => typeof c?.t === 'number' && c.t >= 0 && c.t <= duration).map((c) => ({ ...c, kit: true }));
  return [...own, ...kit].sort((a, b) => a.t - b.t);
}

/** The band's luminance percentiles from a PNG of it (runs in the browser). */
async function bandStats(b64) {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 211; c.height = 62;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = [];
  for (let i = 0; i < d.length; i += 4) L.push(0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]));
  L.sort((a, b) => a - b);
  const q = (p) => L[Math.min(L.length - 1, Math.floor(p * L.length))];
  return { p10: q(0.1), p50: q(0.5), p90: q(0.9) };
}

/** Sample the caption band of the frame loaded in `page` at frame time t. */
export async function sampleBand(page, t) {
  await page.evaluate((x) => window.__render(x), t);
  const shot = await page.screenshot({ clip: { x: BAND.x, y: BAND.y, width: BAND.w, height: BAND.h }, type: 'png' });
  const b64 = typeof shot === 'string' ? shot : Buffer.from(shot).toString('base64');
  return page.evaluate(bandStats, b64);
}

/** Load a frame into the harness (browser.mjs). */
export async function loadFrame(page, root, f, media, strokes) {
  const timingFile = join(root, 'assets', 'timing', `${f.id}.json`);
  const timing = existsSync(timingFile) ? JSON.parse(readFileSync(timingFile, 'utf8')) : { words: [], lines: [] };
  await page.evaluate((args) => window.__load(args.id, args.ctx), { id: f.id, ctx: { id: f.id, duration: f.duration, treatment: frameTreatment(f), timing, media, objects: strokes } });
}

/** Run both measurements on the project at `root`. */
export async function measureProject(root, { open = null } = {}) {
  const frames = projectFrames(root);
  const opener = open ?? (await import('./browser.mjs')).open;
  const b = await opener(root).catch((e) => ({ skipped: `the browser could not start: ${e?.message ?? e}` }));
  if (!b?.page) {
    const tones = treatmentTones(frames);
    fillTones(root, tones);
    return { ok: true, tones, cues: 0, skipped: b?.skipped ?? 'no browser' };
  }
  const media = projectMedia(root);
  const strokes = objectStrokes(root);
  const perFrame = [];
  let cues = 0;
  try {
    for (const f of frames) {
      const dur = f.duration > 0 ? f.duration : 0;
      const file = f.id ? join(root, 'assets', 'frames', `${f.id}.js`) : null;
      const fallback = { duration: dur, windows: [[0, dur, LIGHT_TREATMENTS.has(frameTreatment(f)) ? 'light' : 'dark']] };
      if (!dur || !file || !existsSync(file)) { perFrame.push(fallback); continue; }
      try {
        await loadFrame(b.page, root, f, isClose(f) ? {} : media, strokes);
      } catch {
        perFrame.push(fallback);
        continue;
      }
      const samples = [];
      for (let i = 0; i * STEP < dur; i++) {
        const t = Math.min(i * STEP, dur - 1 / 30);
        const s = await sampleBand(b.page, t).catch(() => null);
        samples.push({ t: i * STEP, tone: toneFor(s) });
      }
      perFrame.push({ duration: dur, windows: frameTones(samples, dur).length ? frameTones(samples, dur) : fallback.windows });
      if (isClose(f)) continue;
      const found = await b.page.evaluate(() => [...document.querySelectorAll('#w [data-cues]')].flatMap((el) => { try { return JSON.parse(el.getAttribute('data-cues')); } catch { return []; } }));
      const evFile = join(root, 'assets', 'frames', `${f.id}.events.json`);
      let events = [];
      try { events = existsSync(evFile) ? JSON.parse(readFileSync(evFile, 'utf8')) : []; } catch { events = []; }
      if (found.length || (Array.isArray(events) && events.some((e) => e?.kit))) {
        writeFileSync(evFile, `${JSON.stringify(mergeKitCues(events, found, dur), null, 1)}\n`);
        cues += found.length;
      }
    }
  } finally {
    await b.close();
  }
  const tones = reelTones(perFrame);
  fillTones(root, tones);
  return { ok: true, tones, cues };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  measureProject(process.cwd())
    .catch((e) => ({ ok: true, tones: [], cues: 0, skipped: `the measure could not run: ${e instanceof Error ? e.message : String(e)}` }))
    .then((result) => { console.log(JSON.stringify(result, null, 1)); process.exit(0); });
}
