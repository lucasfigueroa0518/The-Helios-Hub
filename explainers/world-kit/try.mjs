// Try the world and the frames before the reel is assembled, with no browser (EX3-52).
//
//   node assets/kit/try.mjs world          imports assets/world/world.js
//   node assets/kit/try.mjs frame <id>     runs assets/frames/<id>.js draw(t) across the frame's
//                                          STORYBOARD.md duration
//   node assets/kit/try.mjs all            the world (when present) and every frame module
//
// Each frame also needs its sound events (assets/frames/<id>.events.json, EX3-63); frame 1 must
// draw the title card (cards.js titleCard(), data-role="title", EX3-61/79) and frame 3 the
// dictionary card (cards.js dictionaryCard(), data-role="definition", EX3-14/80). Every scene
// frame longer than 6s exports its `shots` (shots.js), and they must pass validateShots (EX3-83).
// The title card is already animating at t = 0.15s (EX3-93). When the job chose an opener from
// the bank (EX3-102), frame 1 is the bank's and the worker's part is the hook, 01-hook.js: it must
// export its critter (`hero`), hide it on `hideHero`, and draw no title card (the opener does).
// Every critter carries its world id
// (critter({ who }), data-who), so the cast is checked (EX3-90): no critter drawn twice at one
// moment, and none that vanishes mid-frame and comes back (a shot is a camera, never an edit).
//
// Prints JSON { ok, errors[] } and exits 1 on any error. Freehand ink is stubbed here (the browser
// loads it from the CDN), so strokes look plain in this check; everything else is the real code.

import * as nodeModule from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { HOOK_ID, isBankOpener, projectFrames } from './frames.mjs';
import { eventProblems } from './sound.mjs';

/** Frames whose pictures are scenes (not the dictionary card or the logo): they cut between shots. */
const SHOT_FRAMES = [1, 2, 4, 5, 6, 7];

const CDN = 'https://cdn.jsdelivr.net/npm/perfect-freehand';
const STUB = 'data:text/javascript,stub-perfect-freehand';
const STUB_SOURCE = 'export const getStroke = (points) => points.map((p) => [p[0], p[1]]);';
// module.registerHooks needs Node 22.15 or later; say so plainly instead of failing on the CDN import.
if (typeof nodeModule.registerHooks !== 'function') {
  console.log(JSON.stringify({ ok: false, errors: [`try.mjs needs Node 22.15 or later (this is ${process.version})`] }, null, 1));
  process.exit(1);
}
nodeModule.registerHooks({
  resolve: (spec, ctx, next) => (spec.startsWith(CDN) ? { url: STUB, format: 'module', shortCircuit: true } : next(spec, ctx)),
  load: (url, ctx, next) => (url === STUB ? { format: 'module', source: STUB_SOURCE, shortCircuit: true } : next(url, ctx)),
});

const BAD_OUTPUT = [['NaN', /NaN/], ['undefined', /\bundefined\b/], ['[object Object]', /\[object Object\]/], ['Infinity', /Infinity/]];

/** Problems with one frame's SVG string. */
export function frameProblems(svg) {
  if (typeof svg !== 'string') return [`draw(t) returned ${svg === null ? 'null' : typeof svg}, not an SVG string`];
  if (!svg.trim()) return ['draw(t) returned an empty string'];
  const out = BAD_OUTPUT.filter(([, re]) => re.test(svg)).map(([name]) => `the SVG contains "${name}" (a value went missing or was not a number)`);
  const opens = (svg.match(/<[a-zA-Z]/g) ?? []).length;
  const closes = (svg.match(/<\/|\/>/g) ?? []).length;
  if (opens !== closes) out.push(`unbalanced tags: ${opens} opened, ${closes} closed`);
  return out;
}

/**
 * The cast problems in a frame's samples ([{ t, svg }], in time order): a critter id drawn more
 * than once at one moment, or one that disappears for VANISH seconds or more and comes back.
 */
export function castProblems(samples) {
  const errors = [];
  const twice = new Set();
  const seen = new Map(); // id → { last: t present, gapFrom: t it went missing }
  const reported = new Set();
  for (const { t, svg } of samples) {
    const counts = new Map();
    for (const m of String(svg).matchAll(/data-who="([^"]+)"/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    for (const [who, n] of counts) {
      if (n > 1 && !twice.has(who)) {
        twice.add(who);
        errors.push(`the critter "${who}" is drawn ${n} times at ${t.toFixed(2)}s: draw each critter once (a shot never adds a copy, EX3-90)`);
      }
    }
    for (const [who, s] of seen) {
      if (!counts.has(who) && s.gapFrom == null) s.gapFrom = t;
    }
    for (const who of counts.keys()) {
      const s = seen.get(who);
      if (s && s.gapFrom != null && t - s.gapFrom >= VANISH && !reported.has(who)) {
        reported.add(who);
        errors.push(`the critter "${who}" vanishes at ${s.gapFrom.toFixed(2)}s and comes back at ${t.toFixed(2)}s: keep drawing it (a shot is a camera, never an edit of the scene, EX3-90)`);
      }
      seen.set(who, { last: t, gapFrom: null });
    }
  }
  return errors;
}

/** A critter missing this long and then back has vanished (not a one-sample blink). */
const VANISH = 0.2;

/** Sample times across a frame: every 0.1s, plus the last video frame. */
export const sampleTimes = (duration) => [...Array.from({ length: Math.floor(duration * 10) }, (_, i) => i / 10), Math.max(0, duration - 1 / 30)];

async function tryWorld(root) {
  const file = join(root, 'assets', 'world', 'world.js');
  if (!existsSync(file)) return ['assets/world/world.js does not exist'];
  try {
    const mod = await import(pathToFileURL(file).href);
    return Object.keys(mod).length ? [] : ['world.js exports nothing'];
  } catch (e) {
    return [`world.js failed to load: ${e?.message ?? e}`];
  }
}

/** The hook contract (EX3-102): what the bank's openers need from 01-hook.js. */
async function tryHook(root, duration) {
  const file = join(root, 'assets', 'frames', `${HOOK_ID}.js`);
  if (!existsSync(file)) return [`assets/frames/${HOOK_ID}.js does not exist (frame 1's hook: the frame worker writes it; 01-opener.js is code's)`];
  let mod;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (e) {
    return [`${HOOK_ID}.js failed to load: ${e?.message ?? e}`];
  }
  const scene = mod.default;
  if (typeof scene?.draw !== 'function') return [`${HOOK_ID}.js needs \`export default { ground, shots, draw(t, { hideHero, heroPose }) { … } }\``];
  const errors = [];
  const hero = mod.hero ?? scene.hero;
  const ok = hero && Array.isArray(hero.at) && hero.at.length === 2 && hero.at.every(Number.isFinite) && Number(hero.s) > 0 && typeof hero.who === 'string' && hero.who;
  if (!ok) errors.push(`${HOOK_ID}.js must export \`hero = { at: [x, y], s, who, critter: { wear, body } }\`: the hook's critter, its feet on the 1080x1920 page before any shot's camera (its LAYOUT spot), its scale, its world id`);
  for (const t of [0, duration / 2]) {
    let svg = '';
    let hidden = '';
    try {
      svg = String(scene.draw(t));
      hidden = String(scene.draw(t, { hideHero: true, heroPose: { look: [0.5, 0] } }));
    } catch (e) {
      errors.push(`${HOOK_ID}.js draw(${t.toFixed(2)}) threw: ${e?.message ?? e}`);
      break;
    }
    if (svg.includes('data-role="title"')) errors.push(`${HOOK_ID}.js draws a title card; the opener draws it (draw the hook only)`);
    if (ok && !svg.includes(`data-who="${hero.who}"`)) errors.push(`${HOOK_ID}.js draw(${t.toFixed(2)}) does not draw its hero (data-who="${hero.who}")`);
    if (ok && hidden.includes(`data-who="${hero.who}"`)) errors.push(`${HOOK_ID}.js draw(${t.toFixed(2)}, { hideHero: true }) still draws its hero`);
    if (errors.length) break;
  }
  return errors;
}

async function tryFrame(root, id) {
  const file = join(root, 'assets', 'frames', `${id}.js`);
  if (!existsSync(file)) return [`assets/frames/${id}.js does not exist`];
  const entry = projectFrames(root).find((f) => f.id === id);
  if (!entry) return [`STORYBOARD.md has no frame whose src is compositions/frames/${id}.html`];
  if (!(entry.duration > 0)) return [`STORYBOARD.md gives frame ${id} no duration`];
  // frame 1 over a hook that is not written yet: say so, not the import error (EX3-102)
  if (isBankOpener(root, entry) && !existsSync(join(root, 'assets', 'frames', `${HOOK_ID}.js`))) {
    return [`assets/frames/${HOOK_ID}.js does not exist (frame 1's hook: the frame worker writes it; ${id}.js is code's)`];
  }
  let scene;
  try {
    scene = (await import(pathToFileURL(file).href)).default;
  } catch (e) {
    return [`${id}.js failed to load: ${e?.message ?? e}`];
  }
  if (typeof scene?.draw !== 'function') return [`${id}.js needs \`export default { ground, draw(t) { … } }\``];
  if (scene.ground !== undefined && !['paper', 'night', 'forest', 'white'].includes(scene.ground)) {
    return [`${id}.js: ground "${scene.ground}" must be paper, night, forest, or white`];
  }
  const planned = (entry.fields.ground ?? '').trim().toLowerCase() || 'paper';
  if ((scene.ground ?? 'paper') !== planned) {
    return [`${id}.js: ground "${scene.ground ?? 'paper'}" does not match the storyboard's ground "${planned}"`];
  }
  const errors = [];
  const eventsFile = join(root, 'assets', 'frames', `${id}.events.json`);
  if (!existsSync(eventsFile)) errors.push(`assets/frames/${id}.events.json does not exist (every moment of motion needs a sound event)`);
  else {
    try {
      errors.push(...eventProblems(JSON.parse(readFileSync(eventsFile, 'utf8')), entry.duration));
    } catch (e) {
      errors.push(`${id}.events.json is not valid JSON: ${e?.message ?? e}`);
    }
  }
  const bank = isBankOpener(root, entry);
  if (bank) errors.push(...(await tryHook(root, entry.duration)));
  if (entry.number === 1 && !bank) {
    try {
      if (!String(scene.draw(0.15)).includes('data-role="title"')) errors.push('frame 1: the title card starts animating at 0s (titleCard() with no `from`); at t=0.15 it is not drawn');
    } catch {
      // draw errors are reported by the sampling below
    }
  }
  // The bank's openers place the title card themselves, some after the line (EX3-102).
  const role = entry.number === 1 && !bank ? 'title' : entry.number === 3 ? 'definition' : null;
  if (role) {
    const late = Math.max(0, entry.duration - 0.3);
    try {
      if (!String(scene.draw(late)).includes(`data-role="${role}"`)) {
        errors.push(entry.number === 1
          ? `frame 1 must draw the title card (titleCard() from assets/kit/cards.js, finished by the line's end) at t=${late.toFixed(2)}`
          : `frame 3 must draw the dictionary card (dictionaryCard() from assets/kit/cards.js) at t=${late.toFixed(2)}`);
      }
    } catch {
      // draw errors are reported by the sampling below
    }
  }
  // shots.js imports draw.js (its CDN import needs the hooks above), so it loads here.
  const { MULTI_SHOT_AFTER, validateShots } = await import('./shots.js');
  if (SHOT_FRAMES.includes(entry.number) && entry.duration > MULTI_SHOT_AFTER) {
    if (!Array.isArray(scene.shots)) errors.push(`export \`shots\` (shots.js): a ${entry.duration}s frame cuts between at least 2 shots`);
    else errors.push(...validateShots(scene.shots, entry.duration).map((e) => `shots: ${e}`));
  }
  const samples = [];
  for (const t of sampleTimes(entry.duration)) {
    let svg;
    try {
      svg = scene.draw(t);
    } catch (e) {
      errors.push(`draw(${t.toFixed(2)}) threw: ${e?.message ?? e}`);
      continue;
    }
    samples.push({ t, svg });
    for (const p of frameProblems(svg)) errors.push(`draw(${t.toFixed(2)}): ${p}`);
    if (errors.length >= 8) break;
  }
  errors.push(...castProblems(samples));
  return errors;
}

async function tryAll(root) {
  const errors = [];
  if (existsSync(join(root, 'assets', 'world', 'world.js'))) errors.push(...(await tryWorld(root)).map((e) => `world: ${e}`));
  for (const f of projectFrames(root)) {
    if (!existsSync(join(root, 'assets', 'frames', `${f.id}.js`))) {
      errors.push(`${f.id}: assets/frames/${f.id}.js does not exist`);
      continue;
    }
    errors.push(...(await tryFrame(root, f.id)).map((e) => `${f.id}: ${e}`));
  }
  return errors;
}

/** Run one check from a project root; resolves to { ok, errors }. */
export async function tryPart(root, what, id) {
  const errors =
    what === 'world' ? await tryWorld(root)
    : what === 'frame' && id ? await tryFrame(root, id)
    : what === 'all' ? await tryAll(root)
    : ['usage: try.mjs world | try.mjs frame <id> | try.mjs all'];
  return { ok: errors.length === 0, errors };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [what, id] = process.argv.slice(2);
  const result = await tryPart(process.cwd(), what, id);
  console.log(JSON.stringify(result, null, 1));
  process.exit(result.ok ? 0 : 1);
}
