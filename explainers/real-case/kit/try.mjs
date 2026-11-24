// Check the frames of an AI News Explained reel before mounting and rendering. Deterministic, no model.
// Forked from the world kit's try.mjs, keeping only the checks that apply to this format. What it checks:
//
//   storyboard   eight frames; frame 8 is the voiceless close; every frame 1–7 names a ground that is
//                board, whiteboard or newspaper, and each of the three is used at least once (RC-44)
//   source       each frame 1–7 module exists, has a default export, imports only from ../kit/, and
//                uses no clock, randomness, CSS animation or network (render must be a pure function)
//   events       the events file is a valid list (sound.mjs's rules), with no whoosh or sting kinds:
//                every sound is an action's own (SCENES.md rule 2)
//   sting        frame 1 lasts its voice plus the sting's hold
//   browser      the module builds; its `ground` matches the storyboard; render(t) is deterministic
//                (the same t gives the same DOM, whatever was drawn before); render runs at every
//                0.5s and the last frame without throwing; no request leaves the machine
//
//   node assets/kit/try.mjs            every frame
//   node assets/kit/try.mjs <id>       one frame
//
// Prints JSON { ok, errors[], frames[], browser } and exits 1 on any error.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CLOSE_FRAME, GROUND_NAMES, STING_FRAME, STING_HOLD, frameGround, isClose, projectFrames, objectStrokes, stingAt } from './frames.mjs';
import { eventProblems } from './sound.mjs';
import { open } from './browser.mjs';

/** Kinds a news frame may not use: decorative sounds (SCENES.md rule 2). */
export const BANNED_KINDS = new Set(['whoosh', 'sting']);
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
  if (!/export\s+default\b/.test(src)) out.push('has no default export { ground, build(root, ctx), render(t) }');
  for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1] ?? m[2];
    if (!spec.startsWith('../kit/')) out.push(`imports ${spec} (only ../kit/ may be imported)`);
  }
  for (const [re, why] of IMPURE) if (re.test(src)) out.push(why);
  return out;
}

/** Problems with the storyboard as a whole. */
export function storyboardProblems(frames) {
  const out = [];
  if (frames.length !== 8) out.push(`the storyboard has ${frames.length} frames; it needs 8`);
  const close = frames.find((f) => f.number === CLOSE_FRAME);
  if (!close || !isClose(close)) out.push('frame 8 must be the voiceless close');
  const used = new Set();
  for (const f of frames.filter((x) => x.number >= 1 && x.number < CLOSE_FRAME)) {
    const g = frameGround(f);
    if (!GROUND_NAMES.includes(g)) out.push(`frame ${f.number}: ground "${g}" must be ${GROUND_NAMES.join(', ')}`);
    else used.add(g);
  }
  for (const g of GROUND_NAMES) if (!used.has(g)) out.push(`no frame uses the ${g} scene (each of the three appears at least once, RC-44)`);
  const f1 = frames.find((f) => f.number === STING_FRAME);
  if (f1 && f1.duration > 0 && f1.duration + 1e-3 < stingAt(f1) + STING_HOLD) out.push(`frame 1 (${f1.duration}s) ends before its sting does (voice ${stingAt(f1)}s + ${STING_HOLD}s); run pace.mjs`);
  return out;
}

/** Problems with one frame's events file (`null` when it is missing). */
export function eventsFileProblems(list, duration) {
  if (list == null) return ['has no events file (every visible action has its sound)'];
  const out = eventProblems(list, duration);
  if (Array.isArray(list)) list.forEach((e, i) => { if (BANNED_KINDS.has(e?.kind)) out.push(`event ${i}: kind "${e.kind}" is decorative; use the action's own foley`); });
  return out;
}

export async function tryFrames(root, only = null) {
  const errors = [];
  const all = projectFrames(root);
  if (!only) errors.push(...storyboardProblems(all));
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
    mine.push(...eventsFileProblems(list, f.duration).map((p) => `events: ${p}`));
    report.push({ id: f.id, number: f.number, ground: frameGround(f), problems: mine });
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
        const ctx = { id: f.id, duration: f.duration, ground: r.ground, timing: readTiming(root, f), sting: f.number === STING_FRAME ? { at: stingAt(f) } : null, objects: strokes };
        b.errors.length = 0;
        const res = await b.page.evaluate(async (args) => {
          const out = { problems: [] };
          try {
            const loaded = await window.__load(args.id, args.ctx);
            out.ground = loaded.ground;
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
        if (res.ground && res.ground !== r.ground) r.problems.push(`module ground "${res.ground}" ≠ storyboard ground "${r.ground}"`);
        r.problems.push(...res.problems, ...b.errors.map((e) => `page error: ${e}`));
      }
      if (b.external.length) errors.push(`requests left the machine: ${[...new Set(b.external)].slice(0, 3).join(', ')}`);
    } finally {
      await b.close();
    }
  } else if (b?.skipped) browser = `skipped: ${b.skipped}`;

  for (const r of report) errors.push(...r.problems.map((p) => `${r.id}: ${p}`));
  return { ok: errors.length === 0, errors, frames: report, browser };
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
