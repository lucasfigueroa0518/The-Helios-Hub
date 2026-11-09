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
// and every shot of that place draws it with dressedItems(world, place, P, R, { t, states, poses }).
// A shot may change a dressing object's STATE (open, lit, plugged: `states[id]`) or pose it
// (`poses[id]`: the LENS pose, or { segments } for an OBJ), never add or drop one. A story object
// that enters or leaves does it as an on-screen action, inside a shot. The frame check
// (layout-checks.mjs setLockProblems) fails a frame where a declared dressing object of its place is missing, or where
// an undeclared object appears or disappears across a cut between shots of the same place.

import { lensObject } from './objects.js';

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
export function dressedItems(world, place, P, R, { t = 0, states = {}, poses = {} } = {}) {
  const out = [];
  for (const d of dressingOf(world, place)) {
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
