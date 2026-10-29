// The blocking (4.3 continuity, 2026-10-28). The scene builder writes assets/world/blocking.json
// from the storyboard: per place, per frame id, where each cast member and story object stands and
// what state it is in when that frame starts showing the place:
//
//   {
//     "<place id>": {
//       "<frame id>": {
//         "<cast or object id>": { "at": [x, y, z], "state": { … }, "view": "front" | "back", "flip": false, "note": "…" }
//       }
//     }
//   }
//
// `at` is in world cm (the place's own coordinates, as LAYOUT); `state` is the entity's LENS
// state (open, lit, holding …); `view`, `flip` and `note` are optional. Frame builders take their
// frame's slice and draw from it; they depart from it only where their storyboard shot says
// something moves or changes. The set dressing stays in world.js DRESSING (setlock.js).

/** One frame's blocking: { <place>: { <id>: entry } }, only the places the frame has an entry for. */
export function blockingFor(blocking, frameId) {
  const out = {};
  if (!blocking || typeof blocking !== 'object') return out;
  for (const [place, frames] of Object.entries(blocking)) {
    const here = frames && typeof frames === 'object' ? frames[frameId] : null;
    if (here && typeof here === 'object' && Object.keys(here).length) out[place] = here;
  }
  return out;
}

/** One entity's blocking in one frame and place, or null. */
export function blockAt(blocking, place, frameId, id) {
  return blocking?.[place]?.[frameId]?.[id] ?? null;
}

/** The file's shape, as error strings ([] when good). `frameIds` (optional) lists the frames that exist. */
export function blockingProblems(blocking, frameIds = null) {
  const errs = [];
  if (!blocking || typeof blocking !== 'object' || Array.isArray(blocking)) return ['blocking.json: must be an object of places'];
  const known = frameIds ? new Set(frameIds) : null;
  for (const [place, frames] of Object.entries(blocking)) {
    if (!frames || typeof frames !== 'object' || Array.isArray(frames)) { errs.push(`blocking.${place}: must be an object of frame ids`); continue; }
    for (const [fid, ents] of Object.entries(frames)) {
      if (known && !known.has(fid)) errs.push(`blocking.${place}.${fid}: no such frame`);
      if (!ents || typeof ents !== 'object' || Array.isArray(ents)) { errs.push(`blocking.${place}.${fid}: must be an object of entity ids`); continue; }
      for (const [id, e] of Object.entries(ents)) {
        const at = e?.at;
        if (!Array.isArray(at) || at.length !== 3 || !at.every((n) => Number.isFinite(n))) errs.push(`blocking.${place}.${fid}.${id}: "at" must be [x, y, z] in world cm`);
        if (e?.state !== undefined && (typeof e.state !== 'object' || Array.isArray(e.state) || e.state === null)) errs.push(`blocking.${place}.${fid}.${id}: "state" must be an object`);
        if (e?.view !== undefined && e.view !== 'front' && e.view !== 'back') errs.push(`blocking.${place}.${fid}.${id}: "view" is front or back`);
      }
    }
  }
  return errs;
}
