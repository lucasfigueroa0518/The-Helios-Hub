// The locked set (4.3 visual fixes, 2026-10-28). Each place of the world declares its
// set dressing once, in world.js:
//
//   export const DRESSING = {
//     main: [
//       { id: 'laptop', at: [-20, 162, DESK_Z] },          // an OBJ world object or a LENS item
//       { id: 'speaker_gadget', at: [40, 170, DESK_Z], state: { on: 0 } },
//     ],
//   };
//
// and every camera shot of that place draws it: lens.js render() adds what the frame did not pass
// (completeDressing below); dressedItems(world, place, P, R, { t, states, poses }) changes a state or pose.
// A shot may change a dressing object's STATE (open, lit, plugged: `states[id]`) or pose it
// (`poses[id]`: the LENS pose, or { segments } for an OBJ), never add or drop one. A story object
// that enters or leaves does it as an on-screen action, inside a shot. The frame check
// (layout-checks.mjs setLockProblems) fails a frame where a declared dressing object of its place is missing, or where
// an undeclared object appears or disappears across a cut between shots of the same place.

import { lensObject } from './objects.js';
import { setDresser } from './continuity.js';

const wrap = (id, svg) => `<g data-dressing="${id}">${svg}</g>`;

/** A place's declared dressing (world.DRESSING[place]): [{ id, at, state? }]; [] when none. */
function dressingOf(world, place = 'main') {
  const list = world?.DRESSING?.[place];
  return Array.isArray(list) ? list.filter((d) => d && typeof d.id === 'string') : [];
}

/**
 * A place's dressing as render() items, `set: true` (no cast drops them). Each wrapped in data-dressing="<id>". Options: t (frame time), states (per id: the
 * state a LENS item takes this shot), poses (per id: a LENS pose, or { segments } for an OBJ
 * world object).
 */
export function dressedItems(world, place, P, R, { t = 0, states = {}, poses = {}, only = null } = {}) {
  useWorld(world);
  const out = [];
  for (const d of dressingOf(world, place)) {
    if (only && !only.includes(d.id)) continue;
    let it = null;
    const pose = { ...(d.at ? { at: d.at } : {}), ...(poses[d.id] ?? {}) };
    if (typeof world?.LENS?.[d.id] === 'function') it = world.LENS[d.id](P, R, { ...(d.state ?? {}), ...(states[d.id] ?? {}) }, pose);
    else if (world?.OBJ?.[d.id]) it = lensObject(P, world.OBJ[d.id], { t, segments: poses[d.id]?.segments ?? [], rig: R });
    else throw new Error(`HX: DRESSING.${place}: "${d.id}" is neither a LENS item nor an OBJ world object in world.js.`);
    if (!it) continue;
    out.push({ ...it, id: it.id ?? d.id, set: true, svg: wrap(d.id, it.svg ?? '') });
  }
  return out;
}

// ── The dressing draws itself (2026-11-17) ──────────────────────────────────────────────────────
// A camera shot's render() (lens.js) draws its place's dressing whether or not the frame called
// dressedItems: a declared piece the frame did not draw is added at its DRESSING spot and state, and
// a piece the frame drew by hand (an item with the dressing's id) is marked as the dressing. A shot
// opts a piece out with `undress: ['<id>']` (the set-lock check then skips it there).

/** The world whose DRESSING render() draws: set by dressedItems, or by scene-fit.js prepareScene. */
let WORLD = null;
/** Use `world` (world.js's exports) for the dressing render() draws by itself. */
export function useWorld(world) {
  if (world && typeof world === 'object' && world.DRESSING) WORLD = world;
}

/**
 * The items of a camera shot of `place` with its declared dressing complete: given items keep their
 * order; a hand-drawn dressing piece gets `set: true` and its data-dressing mark; a missing one is
 * drawn by dressedItems (at its DRESSING spot and state). `undress`: ids the shot leaves out.
 */
export function completeDressing(P, R, place, items, undress = []) {
  const list = dressingOf(WORLD, place).filter((d) => !undress.includes(d.id));
  if (!list.length) return items;
  const ids = new Set(list.map((d) => d.id));
  const have = new Set();
  const out = items.map((it) => {
    if (!it || typeof it !== 'object' || !ids.has(it.id)) return it;
    have.add(it.id);
    if (it.set === true && /data-dressing="/.test(String(it.svg ?? ''))) return it;
    return { ...it, set: true, svg: typeof it.svg === 'string' ? wrap(it.id, it.svg) : it.svg };
  });
  const missing = list.filter((d) => !have.has(d.id)).map((d) => d.id);
  if (!missing.length) return out;
  const extra = missing.flatMap((id) => {
    try {
      return dressedItems(WORLD, place, P, R, { only: [id] });
    } catch {
      return []; // a piece that cannot be drawn without the frame's own state: the set-lock check names it
    }
  });
  return [...out, ...extra];
}
setDresser(completeDressing);
