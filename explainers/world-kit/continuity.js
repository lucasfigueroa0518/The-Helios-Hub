// The Explainers world kit, cast continuity (hx-6): a shot is a camera, never an edit of the scene
// (EX3-90), so a critter (or an object) that is in a place stays there in every later shot of it, seen whole,
// glimpsed behind the set, or hidden by it, until a shot lists it in `away` (it left on screen).
// shots.js shotFrame sets the critters a drawn shot keeps; castItems and lens.js render() read it;
// try.mjs holds a shot list to the same rule. Plumbing only: builders follow frame.md, not this file.

const isCamShot = (s) => !!(s && s.camera && Array.isArray(s.cast));
const placeKey = (s) => s?.place ?? null;

/**
 * The critters still in shot `k`'s place: every id an earlier camera shot of the same place cast,
 * less any `away` since (critters that left the place on screen).
 * @param {any[]} shots @param {number} k @returns {Set<string>}
 */
export function placeCast(shots, k) {
  const out = new Set();
  const shot = shots?.[k];
  if (!isCamShot(shot)) return out;
  for (let j = 0; j < k; j++) {
    if (!isCamShot(shots[j]) || placeKey(shots[j]) !== placeKey(shot)) continue;
    for (const id of shots[j].cast) out.add(id);
    for (const id of [].concat(shots[j].away ?? [])) out.delete(id);
  }
  for (const id of [].concat(shot.away ?? [])) out.delete(id);
  return out;
}

/** The critters the shot being drawn keeps although its cast leaves them out. */
let KEEP = null;
/** Set them (an iterable of ids, or null); returns the previous set. */
export function setPlaceKeep(ids) {
  const prev = KEEP;
  KEEP = ids ? new Set(ids) : null;
  return prev;
}
/** True when `it` (a critter or an object: any item with an id) is still in the drawn shot's place:
 *  an earlier shot of the place cast it and no shot since lists it in `away` (2026-11-17: objects too,
 *  so a thing seen in shot 1 is not dropped by a later shot's shorter cast). */
export const staysInPlace = (it) => !!(KEEP && it && typeof it === 'object' && KEEP.has(it.id));

/**
 * Cast continuity in one frame's shot list: a critter (an id in `critters`) a camera shot of a
 * place casts, left out of a later camera shot of the same place that does not list it in `away`.
 * @param {any[]} shots @param {Iterable<string>} critters @returns {string[]}
 */
export function castContinuityProblems(shots, critters) {
  if (!Array.isArray(shots)) return [];
  const who = new Set(critters);
  const out = [];
  shots.forEach((s, k) => {
    if (!isCamShot(s)) return;
    for (const id of placeCast(shots, k)) {
      if (!who.has(id) || s.cast.includes(id)) continue;
      const place = placeKey(s) ? `"${placeKey(s)}"` : 'the place';
      out.push(`shot ${k + 1} (${s.kind}) leaves "${id}" out of its cast, but ${id} is in ${place} from an earlier shot: a shot is a camera, so keep ${id} in the cast where it stands (the camera shows it whole, a glimpse of its body behind the set or at the frame's edge, or the set hides it), or list it in the shot's \`away\` once it has left ${place} on screen`);
    }
  });
  return out;
}

// ── First-try plumbing (2026-11-17, scene-fit.js and setlock.js): no builder calls these ─────────

/** Fitted cameras: the frame's shot list → Map(shot index → camera). shotFrame draws a camera shot
 *  with its fitted camera when one is set (scene-fit.js prepareScene fits them). */
const CAMERAS = new WeakMap();
/** Set (camera) or clear (null) the fitted camera of shot `i` of the list `shots`. */
export function setShotCamera(shots, i, camera) {
  if (!shots || typeof shots !== 'object') return;
  const m = CAMERAS.get(shots) ?? new Map();
  if (camera) m.set(i, camera);
  else m.delete(i);
  CAMERAS.set(shots, m);
}
/** A camera tried while fitting: { shots, i, camera } or null. It wins over a fitted camera. */
let PROBE = null;
/** Set the camera being tried (or null); returns the previous one. */
export function setProbeCamera(p) {
  const prev = PROBE;
  PROBE = p;
  return prev;
}
/** The camera shot `i` of `shots` is drawn with instead of its own, or null. */
export function shotCameraOverride(shots, i) {
  if (PROBE && PROBE.shots === shots && PROBE.i === i) return PROBE.camera;
  return CAMERAS.get(shots)?.get(i) ?? null;
}

/** The place's dressing drawer (setlock.js registers it when it loads): render() calls it. */
let DRESSER = null;
/** Register the dressing drawer: (P, R, place, items, undress) => items. */
export function setDresser(fn) {
  DRESSER = typeof fn === 'function' ? fn : null;
}
/** The registered dressing drawer, or null. */
export const dresser = () => DRESSER;
