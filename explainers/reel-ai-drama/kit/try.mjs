// Check the frames of a Reel AI Drama reel before mounting and rendering. Deterministic, no model.
// Forked from the news kit's try.mjs: the eight-frame and three-ground rules are gone (any number of
// frames, any treatment); the determinism and source checks stay. What it checks:
//
//   storyboard   at least two frames; exactly one close and it is the last frame, carrying the spoken
//                question (MD-13, MD-18); every other frame names a treatment the kit builds
//   source       each frame module exists, has a default export, imports only from ../kit/, and uses no
//                clock, randomness, CSS animation or network (render must be a pure function)
//   events       the events file is a valid list (sound.mjs's rules), with no whoosh or sting kinds
//                (every sound is an action's own or the place's ambience), and no sound that implies
//                an event the record doesn't show without naming the asset that shows it (D-48)
//   browser      the module builds; its `treatment` matches the storyboard; render(t) is deterministic
//                (the same t gives the same DOM, whatever was drawn before); render runs at every 0.5s
//                and the last frame without throwing; no request leaves the machine
//
// Warnings (never errors): the reel's length outside 55–80s; a frame longer than 8s (something new
// must happen inside it, MD-35); a close question too long for the close.
//
//   node assets/kit/try.mjs            every frame
//   node assets/kit/try.mjs <id>       one frame
//
// Prints JSON { ok, errors[], warnings[], frames[], browser } and exits 1 on any error.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CLOSE } from './close-timing.js';
import { TREATMENTS, frameTreatment, isClose, objectStrokes, projectFrames, projectMedia, voiceText } from './frames.mjs';
import { eventProblems } from './sound.mjs';
import { open } from './browser.mjs';

/** Kinds a frame may not use: decorative sounds (SCENES.md rule 2). */
export const BANNED_KINDS = new Set(['whoosh', 'sting']);
/** The reel's length (MD-35: about 60s, up to 75s). Outside this is a warning, not breakage. */
export const LENGTH = { min: 55, max: 80 };
/** Longest a frame should hold before something new happens (MD-35). */
export const MAX_FRAME = 8;

/** @type {[RegExp, string][]} */
const IMPURE = [
  [/Date\.now|new Date\(|performance\.now/, 'reads the clock'],
  [/Math\.random/, 'uses Math.random (use the kit\'s seeded rng)'],
  [/@keyframes|\banimation\s*:|\btransition\s*:|\.animate\(/, 'uses CSS or Web animation (render(t) must set every state)'],
  [/requestAnimationFrame|setTimeout|setInterval/, 'schedules work (render(t) must be synchronous)'],
  [/https?:\/\/(?!www\.w3\.org)/, 'loads from the network'],
  [/filter\s*[:=]\s*['"`]?\s*url\(/, 'applies an SVG filter (HyperFrames shows it through hidden frames; use the kit\'s baked textures)'],
  [/visibility\s*[:=]\s*['"`]?visible/, "sets visibility to visible (it shows through the hidden frame after this one ends; set '' to show)"],
];

/** Problems in one frame module's source text. */
export function sourceProblems(src) {
  const out = [];
  if (!/export\s+default\b/.test(src)) out.push('has no default export { treatment, build(root, ctx), render(t) }');
  for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1] ?? m[2];
    if (!spec.startsWith('../kit/')) out.push(`imports ${spec} (only ../kit/ may be imported)`);
  }
  for (const [re, why] of IMPURE) if (re.test(src)) out.push(why);
  return out;
}

/** Problems with the storyboard as a whole (breakage only). */
export function storyboardProblems(frames) {
  const out = [];
  if (frames.length < 2) out.push(`the storyboard has ${frames.length} frame(s); it needs at least one frame and the close`);
  const closes = frames.filter(isClose);
  const last = frames[frames.length - 1];
  if (closes.length !== 1) out.push(`the storyboard has ${closes.length} close frames; it needs exactly one, the last`);
  else if (closes[0] !== last) out.push(`the close is frame ${closes[0].number}; it must be the last frame (frame ${last.number})`);
  if (last && isClose(last) && !voiceText(last)) out.push('the close has no voiceover: the comment question is spoken over it (MD-18)');
  const seen = new Set();
  for (const f of frames) {
    if (seen.has(f.number)) out.push(`frame number ${f.number} is used twice`);
    seen.add(f.number);
    if (isClose(f)) continue;
    const t = frameTreatment(f);
    if (!TREATMENTS.includes(t)) out.push(`frame ${f.number}: treatment "${t}" must be one of ${TREATMENTS.filter((x) => x !== 'close').join(', ')}`);
  }
  return out;
}

/** Warnings about the storyboard (pacing, never breakage). */
export function storyboardWarnings(frames) {
  const out = [];
  const total = frames.reduce((n, f) => n + (f.duration > 0 ? f.duration : 0), 0);
  if (total > 0 && (total < LENGTH.min || total > LENGTH.max)) out.push(`the reel runs ${total.toFixed(1)}s; aim for about 60s, at most 75s`);
  for (const f of frames) {
    if (!isClose(f) && f.duration > MAX_FRAME) out.push(`frame ${f.number} holds ${f.duration}s: something new must happen inside it at least every 8s (a push, a mark, a new layer)`);
    if (isClose(f) && f.duration > CLOSE.duration + 0.05) out.push(`the close runs ${f.duration}s: the question is too long for the ${CLOSE.duration}s close; shorten it`);
  }
  return out;
}

/** Problems with one frame's events file (`null` when it is missing). `assets`: the inventory's ids. */
export function eventsFileProblems(list, duration, assets = null) {
  if (list == null) return ['has no events file (every visible action has its sound; a still has its ambience)'];
  const out = eventProblems(list, duration, { assets });
  if (Array.isArray(list)) list.forEach((e, i) => { if (BANNED_KINDS.has(e?.kind)) out.push(`event ${i}: kind "${e.kind}" is decorative; use the action's own foley or the place's ambience`); });
  return out;
}

export async function tryFrames(root, only = null) {
  const errors = [];
  const all = projectFrames(root);
  const warnings = only ? [] : storyboardWarnings(all);
  if (!only) errors.push(...storyboardProblems(all));
  const media = projectMedia(root);
  const assetIds = Object.keys(media).length ? new Set(Object.keys(media)) : null;
  const frames = all.filter((f) => (!only || f.id === only) && !isClose(f));
  const report = [];
  for (const f of frames) {
    const file = join(root, 'assets', 'frames', `${f.id}.js`);
    const mine = [];
    if (!f.id) mine.push('has no src');
    else if (!existsSync(file)) mine.push(`assets/frames/${f.id}.js is missing`);
    else mine.push(...sourceProblems(readFileSync(file, 'utf8')));
    const ev = join(root, 'assets', 'frames', `${f.id}.events.json`);
    let list = null;
    try {
      list = existsSync(ev) ? JSON.parse(readFileSync(ev, 'utf8')) : null;
    } catch (e) {
      mine.push(`${f.id}.events.json is not valid JSON: ${e?.message ?? e}`);
      list = [];
    }
    mine.push(...eventsFileProblems(list, f.duration, assetIds).map((p) => `events: ${p}`));
    report.push({ id: f.id, number: f.number, treatment: frameTreatment(f), problems: mine });
  }

  let browser = 'skipped';
  const b = await open(root).catch((e) => ({ skipped: `the browser could not start: ${e?.message ?? e}` }));
  if (b?.page) {
    browser = 'ran';
    const strokes = objectStrokes(root);
    try {
      for (const r of report) {
        const f = frames.find((x) => x.id === r.id);
        if (!f?.id || !existsSync(join(root, 'assets', 'frames', `${f.id}.js`)) || !(f.duration > 0)) continue;
        const ctx = { id: f.id, duration: f.duration, treatment: r.treatment, timing: readTiming(root, f), media, objects: strokes };
        b.errors.length = 0;
        const res = await b.page.evaluate(async (args) => {
          const out = { problems: [] };
          try {
            const loaded = await window.__load(args.id, args.ctx);
            out.treatment = loaded.treatment;
          } catch (e) {
            out.problems.push(`build failed: ${e?.message ?? e}`);
            return out;
          }
          const host = document.getElementById('w');
          const snap = (t) => { window.__render(t); return host.innerHTML; };
          const times = [];
          for (let t = 0; t <= args.duration + 1e-6; t += 0.5) times.push(Math.round(t * 1000) / 1000);
          times.push(Math.max(0, args.duration - 1 / 30));
          try {
            for (const t of times) snap(t);
          } catch (e) {
            out.problems.push(`render threw: ${e?.message ?? e}`);
            return out;
          }
          // Deterministic: a moment drawn after jumping from the end equals the same moment drawn fresh.
          for (const t of [0, args.duration / 2, Math.max(0, args.duration - 0.2)]) {
            const a = snap(t);
            snap(args.duration);
            snap(0.05);
            const c = snap(t);
            if (a !== c) { out.problems.push(`render(${t.toFixed(2)}) is not deterministic: it depends on what was drawn before`); break; }
          }
          return out;
        }, { id: f.id, duration: f.duration, ctx });
        if (res.treatment && res.treatment !== r.treatment) r.problems.push(`module treatment "${res.treatment}" ≠ storyboard treatment "${r.treatment}"`);
        else if (!res.treatment && !res.problems.length) r.problems.push('the module exports no `treatment` (it must match the storyboard)');
        r.problems.push(...res.problems, ...b.errors.map((e) => `page error: ${e}`));
      }
      if (b.external.length) errors.push(`requests left the machine: ${[...new Set(b.external)].slice(0, 3).join(', ')}`);
    } finally {
      await b.close();
    }
  } else if (b?.skipped) browser = `skipped: ${b.skipped}`;

  for (const r of report) errors.push(...r.problems.map((p) => `${r.id}: ${p}`));
  return { ok: errors.length === 0, errors, warnings, frames: report, browser };
}

function readTiming(root, f) {
  try {
    return JSON.parse(readFileSync(join(root, 'assets', 'timing', `${f.id}.json`), 'utf8'));
  } catch {
    return { words: [] };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null;
  tryFrames(process.cwd(), only).then((result) => {
    console.log(JSON.stringify(result, null, 1));
    process.exit(result.ok ? 0 : 1);
  });
}
