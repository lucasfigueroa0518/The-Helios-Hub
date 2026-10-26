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
// Every critter's look (body, wear, wearColor; data-look) matches world.js's CAST in every frame,
// the hook's hero is CAST's one orange critter, and a critter outside CAST (frames 3, 6 and 7) is
// never orange and never copies the hero (EX3-107). The hero shows only in the analogy's frames
// (1, 4, 5 and a frame-7 callback): frames 2, 3 and 6 never draw it (EX3-132). In an object-led reel (assets/opener.json says
// "hero": "object", EX3-111) the hook follows its focal object and exports no critter hero.
// `try.mjs props` checks the scene's own new drawings (assets/world/new-props.js and
// assets/frames/*.props.js, NEW_PROPS, EX3-114): each draws in every state and carries full tags.
//
// Prints JSON { ok, errors[] } and exits 1 on any error. Freehand ink is stubbed here (the browser
// loads it from the CDN), so strokes look plain in this check; everything else is the real code.

import * as nodeModule from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

/** The critters' world ids and looks in an SVG: [{ who, look }]. */
function drawnCritters(svg) {
  const out = [];
  for (const m of String(svg).matchAll(/<g\b[^>]*\bdata-who="([^"]+)"[^>]*>/g)) {
    out.push({ who: m[1], look: /\bdata-look="([^"]*)"/.exec(m[0])?.[1] ?? null });
  }
  return out;
}

/**
 * Look problems (EX3-107; Lucas, 2026-10-21: "Character looks should be locked across frames"):
 * a CAST critter drawn with another body, wear or wear color; or a critter outside CAST that is
 * orange or wears the hero's look. `cast` is world.js's CAST; `keyOf` is cast.js's lookKey.
 */
export function lookProblems(samples, cast, keyOf) {
  const errors = [];
  const reported = new Set();
  const expected = new Map(Object.entries(cast).map(([id, look]) => [id, keyOf(look)]));
  const hero = Object.entries(cast).find(([, look]) => (look?.body ?? 'ink') === 'orange');
  const heroKey = hero ? keyOf(hero[1]) : null;
  for (const { t, svg } of samples) {
    for (const { who, look } of drawnCritters(svg)) {
      if (look === null || reported.has(who)) continue;
      const id = expected.has(who) ? who : who.replace(/-\d+$/, '');
      if (expected.has(id)) {
        if (look !== expected.get(id)) {
          reported.add(who);
          errors.push(`the critter "${who}" is drawn as ${look} at ${t.toFixed(2)}s, but CAST says ${expected.get(id)}: a critter's body and wear never change during the reel (EX3-107)`);
        }
      } else if (look.startsWith('orange|')) {
        reported.add(who);
        errors.push(`the critter "${who}" is orange at ${t.toFixed(2)}s: only the hero is an orange critter (EX3-107)`);
      } else if (heroKey && look === heroKey) {
        reported.add(who);
        errors.push(`the critter "${who}" wears the hero's look (${look}) at ${t.toFixed(2)}s: give it a look of its own (EX3-107)`);
      }
    }
  }
  return errors;
}

/** Frames that never show the hero (EX3-132): the gap, the definition and the example are the real thing. */
export const NO_HERO_FRAMES = [2, 3, 6];

/**
 * The hero in a frame that never shows it (EX3-132; Lucas, 2026-10-25: the hero's orange only in
 * the analogy frames): CAST's orange critter drawn in frames 2, 3 or 6, by its id or by its look.
 */
export function heroFrameProblems(samples, cast, keyOf, frameNumber) {
  if (!NO_HERO_FRAMES.includes(frameNumber)) return [];
  const hero = Object.entries(cast ?? {}).find(([, look]) => look?.body === 'orange');
  if (!hero) return [];
  const [heroId, heroLook] = hero;
  const heroKey = keyOf(heroLook);
  for (const { t, svg } of samples) {
    for (const { who, look } of drawnCritters(svg)) {
      if (who === heroId || who.replace(/-\d+$/, '') === heroId || look === heroKey) {
        return [`the hero "${heroId}" is drawn in frame ${frameNumber} at ${t.toFixed(2)}s (as "${who}"): frames 2, 3 and 6 show the real thing, never the hero; it appears only in frames 1, 4, 5 and a frame-7 callback (EX3-132)`];
      }
    }
  }
  return [];
}

/** Problems with world.js's CAST itself: every critter's look, at most one orange (the hero). */
export function castShapeProblems(cast) {
  if (!cast || typeof cast !== 'object' || Array.isArray(cast)) {
    return ['world.js must export CAST = { <critter id>: { body, wear, wearColor } }: every critter\'s look for the whole reel (EX3-107)'];
  }
  const errors = [];
  for (const [id, look] of Object.entries(cast)) {
    if (!['ink', 'paper', 'orange'].includes(look?.body ?? 'ink')) errors.push(`CAST.${id}.body "${look?.body}" must be ink, paper or orange`);
    if (look?.wear !== undefined && !Array.isArray(look.wear)) errors.push(`CAST.${id}.wear must be a list`);
  }
  const orange = Object.entries(cast).filter(([, look]) => look?.body === 'orange').map(([id]) => id);
  if (orange.length > 1) errors.push(`CAST has ${orange.length} orange critters (${orange.join(', ')}): only the hero is orange (EX3-107)`);
  return errors;
}

/** world.js's CAST, or null when the project has no world (a frame with its own picture only). */
async function loadCast(root) {
  const file = join(root, 'assets', 'world', 'world.js');
  if (!existsSync(file)) return null;
  try {
    const cast = (await import(pathToFileURL(file).href)).CAST;
    return castShapeProblems(cast).length ? null : cast;
  } catch {
    return null; // tryWorld reports the load error
  }
}

/** No crowds (EX3-117; Lucas, 2026-10-22: "give the viewer one thing to look at at a time"). */
export const MAX_CRITTERS_AT_ONCE = 4;

/** A crowd on screen: more than MAX_CRITTERS_AT_ONCE critters at one moment (reported once per frame). */
export function crowdProblems(samples) {
  for (const { t, svg } of samples) {
    const n = new Set(drawnCritters(svg).map((c) => c.who)).size;
    if (n > MAX_CRITTERS_AT_ONCE) {
      return [`${n} critters on screen at ${t.toFixed(2)}s: at most ${MAX_CRITTERS_AT_ONCE}, never a crowd; give the viewer one thing to look at (EX3-117)`];
    }
  }
  return [];
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
    if (!Object.keys(mod).length) return ['world.js exports nothing'];
    return castShapeProblems(mod.CAST);
  } catch (e) {
    return [`world.js failed to load: ${e?.message ?? e}`];
  }
}

/** The hook's hero kind from assets/opener.json (EX3-111): 'object' in an object-led reel, else 'critter'. */
export function openerHero(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'assets', 'opener.json'), 'utf8'))?.hero === 'object' ? 'object' : 'critter';
  } catch {
    return 'critter';
  }
}

/** The files a scene's own new drawings live in (EX3-114). */
export function newPropFiles(root) {
  const out = [];
  if (existsSync(join(root, 'assets', 'world', 'new-props.js'))) out.push(join('assets', 'world', 'new-props.js'));
  const frames = join(root, 'assets', 'frames');
  if (existsSync(frames)) for (const f of readdirSync(frames).sort()) if (f.endsWith('.props.js')) out.push(join('assets', 'frames', f));
  return out;
}

/**
 * The scene's own new drawings (EX3-114): every NEW_PROPS entry loads, has states and a size, draws
 * a clean SVG in each state, and carries full tags (props/tags.js TAG_FIELDS). Returns the problems
 * and what was found, for the bank's harvest.
 */
export async function tryProps(root) {
  const { tagProblems } = await import('./props/tags.js');
  const { propFrom } = await import('./props.js');
  const errors = [];
  const props = [];
  for (const file of newPropFiles(root)) {
    let defs;
    try {
      defs = (await import(pathToFileURL(join(root, file)).href)).NEW_PROPS;
    } catch (e) {
      errors.push(`${file} failed to load: ${e?.message ?? e}`);
      continue;
    }
    if (!defs || typeof defs !== 'object') {
      errors.push(`${file} must export NEW_PROPS = { '<specific name>': { tags, size, states, draw } } (EX3-114)`);
      continue;
    }
    for (const [name, def] of Object.entries(defs)) {
      const problems = [...tagProblems(name, def?.tags)];
      if (!Array.isArray(def?.states) || !def.states.length) problems.push(`asset "${name}" needs states (a list, e.g. ['default'])`);
      if (!Array.isArray(def?.size) || def.size.length !== 2 || !def.size.every(Number.isFinite)) problems.push(`asset "${name}" needs size: [w, h]`);
      if (typeof def?.draw !== 'function') problems.push(`asset "${name}" needs draw({ state, focal })`);
      else {
        for (const state of Array.isArray(def.states) ? def.states : []) {
          try {
            for (const p of frameProblems(propFrom(defs, name, 540, 960, { state }))) problems.push(`asset "${name}" (${state}): ${p}`);
          } catch (e) {
            problems.push(`asset "${name}" (${state}) threw: ${e?.message ?? e}`);
          }
        }
      }
      props.push({ file, name, tags: def?.tags ?? null, ok: problems.length === 0 });
      errors.push(...problems.map((p) => `${file}: ${p}`));
    }
  }
  return { errors, props };
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
  // An object-led reel's hook follows its focal object: no critter hero, and its openers never use one (EX3-111).
  if (openerHero(root) === 'object') {
    for (const t of [0, duration / 2]) {
      try {
        if (String(scene.draw(t)).includes('data-role="title"')) errors.push(`${HOOK_ID}.js draws a title card; the opener draws it (draw the hook only)`);
      } catch (e) {
        errors.push(`${HOOK_ID}.js draw(${t.toFixed(2)}) threw: ${e?.message ?? e}`);
        break;
      }
    }
    return errors;
  }
  const hero = mod.hero ?? scene.hero;
  const ok = hero && Array.isArray(hero.at) && hero.at.length === 2 && hero.at.every(Number.isFinite) && Number(hero.s) > 0 && typeof hero.who === 'string' && hero.who;
  if (!ok) errors.push(`${HOOK_ID}.js must export \`hero = { at: [x, y], s, who, critter: { wear, body } }\`: the hook's critter, its feet on the 1080x1920 page before any shot's camera (its LAYOUT spot), its scale, its world id`);
  // The hero is CAST's orange critter, drawn the same way in the opener as everywhere (EX3-107).
  const cast = await loadCast(root);
  const { lookKey } = await import('./cast.js');
  if (ok && cast) {
    const declared = cast[hero.who];
    if (!declared) errors.push(`the hero "${hero.who}" is not in world.js's CAST (EX3-107)`);
    else {
      if (declared.body !== 'orange') errors.push(`the hero "${hero.who}" is ${declared.body ?? 'ink'} in CAST: a critter hero is the one orange critter (EX3-107)`);
      if (lookKey(hero.critter ?? {}) !== lookKey(declared)) errors.push(`${HOOK_ID}.js's hero.critter (${lookKey(hero.critter ?? {})}) differs from CAST.${hero.who} (${lookKey(declared)}) (EX3-107)`);
    }
  }
  const drawn = [];
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
    drawn.push({ t, svg });
    if (svg.includes('data-role="title"')) errors.push(`${HOOK_ID}.js draws a title card; the opener draws it (draw the hook only)`);
    if (ok && !svg.includes(`data-who="${hero.who}"`)) errors.push(`${HOOK_ID}.js draw(${t.toFixed(2)}) does not draw its hero (data-who="${hero.who}")`);
    if (ok && hidden.includes(`data-who="${hero.who}"`)) errors.push(`${HOOK_ID}.js draw(${t.toFixed(2)}, { hideHero: true }) still draws its hero`);
    if (errors.length) break;
  }
  if (cast) errors.push(...lookProblems(drawn, cast, lookKey));
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
  errors.push(...crowdProblems(samples));
  const cast = await loadCast(root);
  if (cast) {
    const { lookKey } = await import('./cast.js');
    errors.push(...lookProblems(samples, cast, lookKey));
    errors.push(...heroFrameProblems(samples, cast, lookKey, entry.number));
  }
  return errors;
}

async function tryAll(root) {
  const errors = [];
  if (existsSync(join(root, 'assets', 'world', 'world.js'))) errors.push(...(await tryWorld(root)).map((e) => `world: ${e}`));
  errors.push(...(await tryProps(root)).errors.map((e) => `props: ${e}`));
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
    : what === 'props' ? null
    : ['usage: try.mjs world | try.mjs frame <id> | try.mjs props | try.mjs all'];
  if (errors === null) {
    const found = await tryProps(root);
    return { ok: found.errors.length === 0, errors: found.errors, props: found.props };
  }
  return { ok: errors.length === 0, errors };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [what, id] = process.argv.slice(2);
  const result = await tryPart(process.cwd(), what, id);
  console.log(JSON.stringify(result, null, 1));
  process.exit(result.ok ? 0 : 1);
}
