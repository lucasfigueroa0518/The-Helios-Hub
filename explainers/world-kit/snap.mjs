// Stills of the reel for the builders and the picture check to look at (Explainers 4.1; 4.2: the
// builders' self-review against craft.md).
//
//   node assets/kit/snap.mjs <frame-id> <t1,t2,…>   a frame worker's own frame, at up to 6 times
//                                                   (seconds into the frame); 01-hook is frame 1's hook
//   node assets/kit/snap.mjs world                  the scene builder's places: world.js ROOM and LENS
//                                                   at their start states, through world.js VIEWS (lens
//                                                   cameras; a view's `place` builds that SETS place,
//                                                   room or exterior alike), then one eye-level view of
//                                                   each SETS place no view covers (its brief's `view`
//                                                   when it gives one), or two eye-level views of the
//                                                   main set when there are none; up to 6 stills
//   node assets/kit/snap.mjs sequences              the orchestrator's picture-check stills: every
//                                                   frame 1–7, one still just after each shot starts and
//                                                   one at its last moment, + a manifest with each
//                                                   frame's look and voiceover line (no quota)
//
// A frame or the world writes .hyperframes/snaps/<id>-<t>.png (world: world-<n>.png), 1080x1920,
// drawn over its storyboard ground in the headless Chrome and driver the bounds check uses
// (bounds.mjs), with the reel's fonts. Freehand ink is stubbed as in try.mjs, so strokes look
// plain; everything else is the real drawing. At most MAX_TIMES stills a call and MAX_CALLS calls
// per frame id (.hyperframes/snaps/<id>.count): the self-review is a few looks, never a render loop;
// a call whose frame threw is not counted. Frame 1's sequence starts once the opener uncovers the hook.
// `sequences` writes .hyperframes/sequences/<id>-<t>.png and .hyperframes/sequences/manifest.json:
// { frames: [{ id, number, look, kind, voiceover, stills: [{ t, shot, file }] }] } (look: world,
// mechanism or blend, from the storyboard; kind: the builder's, scene or tech).
//
// Prints JSON { ok, files[], left?, errors?[], skipped? } and exits 1 on a usage or drawing error.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { driver, findChrome } from './bounds.mjs';
import { HOOK_ID, isBankOpener, isClose, projectFrames } from './frames.mjs';
import { HOOK_REVEAL } from './openers/bank.js';
import { chosenOpener } from './openers/sound.mjs';
import { FONTS } from './mount.mjs';
import { frameKind, frameLook } from './try.mjs'; // also registers the hooks that let frame modules load in Node

export const MAX_TIMES = 6;
/** A first look, two revisions and a last look at the second revision (round 2: with 3 the last revision went unseen). */
export const MAX_CALLS = 4;
/** The world's own budget (cost lever L6, Lucas 2026-10-28): the scene builder snaps at most 3 times. */
export const MAX_WORLD_CALLS = 3;
/** The call budget for a snap id: the world's, or a frame's. */
export const callsFor = (id) => (id === 'world' ? MAX_WORLD_CALLS : MAX_CALLS);
/** Stills per frame in the picture-check sequences. */
export const MAX_SEQUENCE_STILLS = 8;
const W = 1080;
const H = 1920;
const USAGE = 'usage: node assets/kit/snap.mjs <frame-id> <t1,t2,…> | node assets/kit/snap.mjs world';

/** Parse "<t1,t2,…>" into seconds inside [0, duration), or an error string. */
export function parseTimes(arg, duration) {
  const parts = String(arg ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return 'give the times: node assets/kit/snap.mjs <frame-id> <t1,t2,…>';
  if (parts.length > MAX_TIMES) return `at most ${MAX_TIMES} times a call`;
  const times = parts.map(Number);
  if (times.some((t) => !Number.isFinite(t) || t < 0)) return `times must be seconds ≥ 0 (got ${arg})`;
  return times.map((t) => Math.min(t, Math.max(0, duration - 1 / 30)));
}

/**
 * The picture-check times of a frame: 0.15s into each shot (or after `from`, when frame 1's opener
 * uncovers the hook: openers/bank.js HOOK_REVEAL), and its last moment (at most MAX_SEQUENCE_STILLS).
 */
export function sequenceTimes(shots, duration, from = 0) {
  const end = Math.max(0, duration - 1 / 30);
  const starts = Array.isArray(shots) && shots.length ? shots.map((s) => Number(s?.at) || 0) : [0, duration / 2];
  // nothing before `from` (frame 1: the hook is under the opener until then); the first still at it
  const times = [...starts.map((at) => Math.min(end, Math.max(at, from) + 0.15)), end];
  const uniq = [...new Set(times.map((t) => Math.round(t * 100) / 100))].sort((a, b) => a - b);
  if (uniq.length <= MAX_SEQUENCE_STILLS) return uniq;
  // keep the first and last, thin the middle evenly
  const step = (uniq.length - 1) / (MAX_SEQUENCE_STILLS - 1);
  return Array.from({ length: MAX_SEQUENCE_STILLS }, (_, i) => uniq[Math.round(i * step)]);
}

/** The shot number (1-based) on screen at t, or null for a frame with no shots. */
function shotNumberAt(shots, t) {
  if (!Array.isArray(shots) || !shots.length) return null;
  let k = 0;
  for (let i = 0; i < shots.length; i++) if ((Number(shots[i]?.at) || 0) <= t + 1e-6) k = i;
  return k + 1;
}

/** The world's default views for the scene builder: eye level from the front, and from the front left. */
export const WORLD_VIEWS = [
  { pos: [0, -600, 110], target: [0, 0, 80], fov: 38 },
  { pos: [-420, -480, 160], target: [0, 0, 80], fov: 38 },
];

const isCam = (v) => Array.isArray(v?.pos) && Array.isArray(v?.target);

/**
 * world.js's views, at most MAX_TIMES: its VIEWS (lens cameras, each in its `place`, 'main' when
 * absent), then one view of each SETS place (an interior or an exterior) that no view covers: its
 * brief's `view` when it gives a camera, else the eye-level WORLD_VIEWS[0] in that place. With no
 * VIEWS, the main set's two WORLD_VIEWS come first.
 */
export function worldViews(mod) {
  const given = Array.isArray(mod?.VIEWS) ? mod.VIEWS.filter(isCam) : [];
  const views = given.length ? [...given] : [...WORLD_VIEWS];
  const covered = new Set(views.map((v) => v.place ?? 'main'));
  const sets = mod?.SETS && typeof mod.SETS === 'object' && !Array.isArray(mod.SETS) ? mod.SETS : {};
  for (const [place, brief] of Object.entries(sets)) {
    if (covered.has(place)) continue;
    covered.add(place);
    views.push({ ...(isCam(brief?.view) ? brief.view : WORLD_VIEWS[0]), place });
  }
  return views.slice(0, MAX_TIMES);
}

/**
 * The ground a world view is drawn on: the view's own `ground`, else its place's mood (the SETS
 * brief's, or SET's for the main set: light.js mood(name).ground, so a night street sits on the
 * stage), else paper.
 */
function groundOfView(view, mod, lightKit) {
  const named = ['paper', 'stage', 'white'];
  if (named.includes(view?.ground)) return view.ground;
  const place = view?.place ?? 'main';
  const brief = place === 'main' ? mod?.SET : mod?.SETS?.[place];
  const m = view?.mood ?? brief?.mood;
  if (m && typeof lightKit?.mood === 'function') {
    try {
      const g = lightKit.mood(m).ground;
      if (named.includes(g)) return g;
    } catch {
      // an unknown mood: the world check names it
    }
  }
  return 'paper';
}

/** world.js's set and entities at their start states, through view k (the scene builder's still). */
async function worldScene(root) {
  const mod = await import(`${pathToFileURL(join(root, 'assets', 'world', 'world.js')).href}?snap${Date.now()}`);
  const lensKit = await import('./lens.js');
  const drawKit = await import('./draw.js');
  const state = Object.fromEntries(Object.entries(mod.STATES ?? {}).map(([k, v]) => [k, v && typeof v === 'object' && 'start' in v ? v.start : v]));
  const views = worldViews(mod);
  const lightKit = await import('./light.js').catch(() => null);
  return {
    views,
    ground: (k) => groundOfView(views[k], mod, lightKit),
    draw(k) {
      const ground = groundOfView(views[k], mod, lightKit);
      drawKit.scope('snapw-', ground);
      const P = lensKit.lens(views[k]);
      const place = views[k].place ?? 'main';
      // LIGHTS(state, place): a place's own lights (a LIGHTS that takes no place lights every view the same)
      const R = lensKit.rig(P, { ground, ...(typeof mod.LIGHTS === 'function' ? mod.LIGHTS(state, place) ?? {} : {}) });
      // 4.1: ROOM(P, R, state, place) = setBuilder(…).done() { env, items, … }; an older world: a list (env)
      const room = typeof mod.ROOM === 'function' ? (place === 'main' ? mod.ROOM(P, R, state) : mod.ROOM(P, R, state, place)) : null;
      const env = Array.isArray(room) ? room : [...(room?.env ?? [])];
      const setItems = Array.isArray(room) ? [] : [...(room?.items ?? [])];
      // every LENS entity, in every view: the places share one world (a back room's tank stands at
      // its own spot in it); LENS items carry their own id (else the key)
      const things = Object.entries(mod.LENS ?? {})
        .map(([id, e]) => {
          const it = typeof e === 'function' ? e(P, R, state, {}) : null;
          return it && typeof it === 'object' && it.svg ? { ...it, id: it.id ?? id } : it;
        })
        .filter(Boolean);
      return lensKit.render(P, { env, items: [...setItems, ...things] });
    },
  };
}

/** The page every still is drawn on: the ground and the world as two stacked SVGs, as mount.mjs does. */
function pageHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS.replaceAll('url("assets/', 'url("../assets/')} html,body{margin:0;background:#fff}#g,#w{position:absolute;left:0;top:0;width:${W}px;height:${H}px}</style></head><body><div id="g"></div><div id="w"></div></body></html>`;
}
const svgOf = (inner) => `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

/**
 * Draw `jobs` ([{ file (project-relative png), ground, draw: () => svg }]) in one browser.
 * Returns { files, errors, skipped? }.
 */
async function shoot(root, jobs) {
  const drv = await driver();
  const chrome = findChrome();
  if (!drv || !chrome) return { files: [], errors: [], skipped: drv ? 'no headless Chrome found (HyperFrames downloads one on first render)' : 'no browser driver (puppeteer-core or playwright-core) is installed' };
  const { underlay } = await import('./motion.js');
  const page_ = join(root, '.hyperframes', 'snap.html');
  mkdirSync(join(root, '.hyperframes'), { recursive: true });
  writeFileSync(page_, pageHtml());
  const browser = await drv.launch(chrome);
  const files = [];
  const errors = [];
  try {
    const page = await browser.page();
    await page.goto(pathToFileURL(page_).href);
    await page.evaluate(() => document.fonts.ready);
    for (const job of jobs) {
      let ground;
      let world;
      try {
        ground = svgOf(underlay('snapg-', job.ground));
        world = svgOf(job.draw());
      } catch (e) {
        errors.push(`${job.label} threw: ${e?.message ?? e}`);
        continue;
      }
      await page.evaluate(([gs, ws]) => {
        document.getElementById('g').innerHTML = gs;
        document.getElementById('w').innerHTML = ws;
      }, [ground, world]);
      mkdirSync(join(root, job.file, '..'), { recursive: true });
      await page.screenshot({ path: join(root, job.file), clip: { x: 0, y: 0, width: W, height: H } });
      files.push(job.file);
    }
  } finally {
    await browser.close();
  }
  return { files, errors };
}

/** The storyboard entry and module file for a frame id (01-hook: frame 1's hook), or an error. */
function frameTarget(root, id) {
  const frames = projectFrames(root);
  if (id === HOOK_ID) {
    const f1 = frames.find((f) => f.number === 1);
    if (!f1) return { error: 'STORYBOARD.md has no frame 1' };
    return { entry: f1, file: join(root, 'assets', 'frames', `${HOOK_ID}.js`) };
  }
  const entry = frames.find((f) => f.id === id);
  if (!entry) return { error: `STORYBOARD.md has no frame ${id} (frame ids are the basenames of the storyboard's src; frame 1's hook is ${HOOK_ID})` };
  return { entry, file: join(root, 'assets', 'frames', `${id}.js`) };
}

/** Give back a call that drew nothing (its frame threw): it does not count against the quota. */
function refundCall(root, id) {
  const counter = join(root, '.hyperframes', 'snaps', `${id}.count`);
  const used = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) || 0 : 0;
  if (used > 0) writeFileSync(counter, String(used - 1));
  return callsFor(id) - (used - 1);
}

/** Count one call against the frame's quota; returns the calls left after it, or an error. */
function takeCall(root, id) {
  const dir = join(root, '.hyperframes', 'snaps');
  mkdirSync(dir, { recursive: true });
  const counter = join(dir, `${id}.count`);
  const used = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) || 0 : 0;
  if (used >= callsFor(id)) return { error: `${id} has used its ${callsFor(id)} snaps: fix what you can from the stills you have, and hand back` };
  writeFileSync(counter, String(used + 1));
  return { left: callsFor(id) - used - 1 };
}

const groundOf = (entry) => (entry?.fields?.ground ?? '').trim().toLowerCase() || 'paper';

export async function snap(root, id, arg) {
  if (id === 'sequences') return sequences(root);
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(String(id ?? ''))) return { ok: false, files: [], errors: [USAGE] };
  if (id === 'world') {
    if (arg !== undefined) return { ok: false, files: [], errors: [USAGE] };
    if (!existsSync(join(root, 'assets', 'world', 'world.js'))) return { ok: false, files: [], errors: ['assets/world/world.js does not exist'] };
    let scene;
    try {
      scene = await worldScene(root);
    } catch (e) {
      return { ok: false, files: [], errors: [`world.js failed to load: ${e?.message ?? e}`] };
    }
    const quota = takeCall(root, 'world');
    if (quota.error) return { ok: false, files: [], errors: [quota.error], left: 0 };
    const jobs = scene.views.map((v, k) => ({ label: `view ${k + 1} (${v.place ?? 'main'})`, file: join('.hyperframes', 'snaps', `world-${k + 1}.png`), ground: scene.ground(k), draw: () => scene.draw(k) }));
    const shot = await shoot(root, jobs);
    // a call where a view threw is not counted: fix the error and snap again
    const left = shot.errors.length || shot.skipped ? refundCall(root, 'world') : quota.left;
    // which place each still shows
    const views = jobs.map((j, k) => ({ file: j.file, place: scene.views[k].place ?? 'main' })).filter((v) => shot.files.includes(v.file));
    return { ok: shot.errors.length === 0, files: shot.files, ...(views.length ? { views } : {}), left, ...(shot.errors.length ? { errors: shot.errors, counted: false } : {}), ...(shot.skipped ? { skipped: shot.skipped } : {}) };
  }
  const target = frameTarget(root, id);
  if (target.error) return { ok: false, files: [], errors: [target.error] };
  if (!existsSync(target.file)) return { ok: false, files: [], errors: [`assets/frames/${id}.js does not exist`] };
  const times = parseTimes(arg, target.entry.duration);
  if (typeof times === 'string') return { ok: false, files: [], errors: [times] };
  let scene;
  try {
    scene = (await import(`${pathToFileURL(target.file).href}?snap${Date.now()}`)).default;
  } catch (e) {
    return { ok: false, files: [], errors: [`${id}.js failed to load: ${e?.message ?? e}`] };
  }
  if (typeof scene?.draw !== 'function') return { ok: false, files: [], errors: [`${id}.js has no default export with draw(t)`] };
  const quota = takeCall(root, id);
  if (quota.error) return { ok: false, files: [], errors: [quota.error], left: 0 };
  const ground = scene.ground ?? groundOf(target.entry);
  const jobs = times.map((t) => ({ label: `draw(${t.toFixed(2)})`, file: join('.hyperframes', 'snaps', `${id}-${t.toFixed(2)}.png`), ground, draw: () => scene.draw(t) }));
  const shot = await shoot(root, jobs);
  // a call where the frame threw (or no browser could draw it) is not counted: fix the error and snap again
  const left = shot.errors.length || shot.skipped ? refundCall(root, id) : quota.left;
  return { ok: shot.errors.length === 0, files: shot.files, left, ...(shot.errors.length ? { errors: shot.errors, counted: false } : {}), ...(shot.skipped ? { skipped: shot.skipped } : {}) };
}

/** The voiceover line of a storyboard frame, without its quotes. */
const voiceOf = (entry) => String(entry?.fields?.voiceover ?? '').trim().replace(/^["“]|["”]$/g, '');

/** The picture-check sequences (the orchestrator's): every voiced frame's stills, in order, and a manifest. */
export async function sequences(root) {
  const frames = projectFrames(root).filter((f) => f.number >= 1 && f.number <= 7 && !isClose(f));
  const jobs = [];
  const manifest = { frames: [] };
  const errors = [];
  for (const entry of frames) {
    const file = join(root, 'assets', 'frames', `${entry.id}.js`);
    if (!entry.id || !existsSync(file)) {
      errors.push(`assets/frames/${entry.id || `<frame ${entry.number}>`}.js does not exist`);
      continue;
    }
    let scene;
    try {
      scene = (await import(`${pathToFileURL(file).href}?seq${Date.now()}`)).default;
    } catch (e) {
      errors.push(`${entry.id}.js failed to load: ${e?.message ?? e}`);
      continue;
    }
    // frame 1 from the bank: the opener as it airs, timed by its hook's shots
    const sourceFile = isBankOpener(root, entry) && existsSync(join(root, 'assets', 'frames', `${HOOK_ID}.js`)) ? join(root, 'assets', 'frames', `${HOOK_ID}.js`) : file;
    const shots = Array.isArray(scene?.shots) ? scene.shots : null;
    // frame 1 from the bank: its first still waits until the opener has uncovered the hook for good
    const reveal = isBankOpener(root, entry) ? HOOK_REVEAL[scene?.opener ?? chosenOpener(root)] ?? 0 : 0;
    const times = sequenceTimes(shots, entry.duration, reveal);
    const ground = scene?.ground ?? groundOf(entry);
    const stills = times.map((t) => ({ t, shot: shotNumberAt(shots, t), file: join('.hyperframes', 'sequences', `${entry.id}-${t.toFixed(2)}.png`) }));
    const source = readFileSync(sourceFile, 'utf8');
    manifest.frames.push({ id: entry.id, number: entry.number, look: frameLook(entry, source), kind: frameKind(entry, source), voiceover: voiceOf(entry), stills });
    for (const s of stills) jobs.push({ label: `${entry.id} draw(${s.t.toFixed(2)})`, file: s.file, ground, draw: () => scene.draw(s.t) });
  }
  mkdirSync(join(root, '.hyperframes', 'sequences'), { recursive: true });
  const shot = await shoot(root, jobs);
  errors.push(...shot.errors);
  const made = new Set(shot.files);
  for (const f of manifest.frames) f.stills = f.stills.filter((s) => made.has(s.file));
  const manifestFile = join('.hyperframes', 'sequences', 'manifest.json');
  writeFileSync(join(root, manifestFile), `${JSON.stringify(manifest, null, 1)}\n`);
  return { ok: errors.length === 0 && !shot.skipped, files: shot.files, manifest: manifestFile, ...(errors.length ? { errors } : {}), ...(shot.skipped ? { skipped: shot.skipped } : {}) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [id, times, extra] = process.argv.slice(2);
  const result = extra !== undefined
    ? { ok: false, files: [], errors: [USAGE] }
    : await snap(process.cwd(), id, times).catch((e) => ({ ok: false, files: [], errors: [e instanceof Error ? e.message : String(e)] }));
  console.log(JSON.stringify(result, null, 1));
  process.exit(result.ok ? 0 : 1);
}
