// The Explainers world kit, shots (Explainers 3.2, EX3-83; a camera only in 3.3, EX3-90): the same
// scene from different shots. A frame is a list of shots that hard-cut on voice cues; each shot
// frames its subject with the kit camera (one calm move inside a shot, ≤1.2×; cuts between shots
// may reframe freely). Same scene ≠ same shot (Lucas, 2026-10-13): beats 1, 2, 4 and 5 never
// repeat a picture.
//
// A shot is a camera, never an edit of the world (EX3-90): every shot draws the same scene, and
// the camera only chooses what is in view. An insert is a tight camera on one object, so the rest
// falls out of frame; nothing is hidden, and nothing is added (3.2's over-the-shoulder shot drew
// a second copy of a critter, and an insert that skipped the critters made them vanish).
// The shot's subject is what the voice is naming during it (EX3-91).
//
//   SHOT_KINDS                     what each kind is (its zoom)
//   shotAt(t, shots)               the shot on screen at frame time t, and the time inside it
//   shotCamera(shot, local)        that shot's camera (centering its subject, with its push)
//   shotFrame(t, shots, draw, o)   the whole frame: frame() with the active shot's camera;
//                                  draw(shot, local) returns the scene's parts (or its
//                                  depth layers { bg, mid, fg }, hx-4)
//   validateShots(shots, dur)      the rules, as error strings (try.mjs and lint call it)
//
// A shot: { at, kind, on: [x, y], zoom?, push? }. `on` is the subject's screen point in the
// scene as drawn at zoom 1; `push` (≤ 1.2) slowly pushes in across the shot.

import { frame } from './motion.js';
import { el, id, ref, groundName } from './draw.js';
import { GROUNDS } from './core.js';

/** Shot kinds (EX3-90): cameras on the one scene. */
export const SHOT_KINDS = {
  wide: { zoom: 1, about: 'establishing: the whole scene' },
  medium: { zoom: 1.5, about: 'two or three entities and what passes between them' },
  close: { zoom: 2.4, about: 'one entity and its state' },
  insert: { zoom: 2.6, about: 'a tight camera on one object; the rest of the scene falls out of frame' },
  reaction: { zoom: 2.8, about: "a critter's face" },
};

/** Kinds 3.3 removed, and why (validateShots names the reason). */
export const REMOVED_KINDS = {
  ots: 'over-the-shoulder was removed in 3.3: it draws a second copy of a critter',
  reverse: 'reverse was removed in 3.3: mirroring makes every critter jump sides mid-scene',
};
/** The tightest an insert may be framed: below this it shows the scene, not one object. */
export const INSERT_MIN_ZOOM = 2.2;

/** Above this zoom a shot washes the caption band back toward the ground (bandWash). */
export const WASH_ZOOM = 1.25;

/**
 * The caption band (y 250–570) washed back toward the ground, fading out by y 640: in a closer
 * shot the world's nearby objects are enlarged into the band, and light captions on a light
 * sheet (or dark on dark) stop reading. Context dims toward the ground (V-22); this is that dim,
 * on the band only. shotFrame adds it to every shot above WASH_ZOOM.
 */
export function bandWash() {
  const fill = GROUNDS[groundName()]?.fill ?? GROUNDS.paper.fill;
  const gid = id('bandwash');
  return [
    el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, [
      el('stop', { offset: 0, 'stop-color': fill, 'stop-opacity': 0.92 }),
      el('stop', { offset: 0.78, 'stop-color': fill, 'stop-opacity': 0.92 }),
      el('stop', { offset: 1, 'stop-color': fill, 'stop-opacity': 0 }),
    ].join('')),
    el('rect', { x: 0, y: 0, width: 1080, height: 640, fill: ref('bandwash') }),
  ].join('');
}

/** Where a shot puts its subject: the middle of the safe area. */
export const SUBJECT_AT = [518, 1085];
/** The rules: frames longer than this have at least two shots… */
export const MULTI_SHOT_AFTER = 6;
/** …and no shot runs longer than this, or (except the frame's last) shorter than MIN_SHOT. */
export const MAX_SHOT = 4.5;
export const MIN_SHOT = 1.5;
const MAX_PUSH = 1.2;

/** The shot on screen at frame time t. */
export function shotAt(t, shots) {
  let i = 0;
  for (let k = 0; k < shots.length; k++) if (t >= shots[k].at) i = k;
  const shot = shots[i];
  const end = shots[i + 1]?.at ?? Infinity;
  return { i, shot, local: t - shot.at, length: end - shot.at };
}

/** The camera that frames `shot` at `local` seconds into it (cameraTransform semantics), for a
 *  frame whose camera pivots on `pivot` (frame()'s pivot; the frame centre by default). */
export function shotCamera(shot, local = 0, length = 3, pivot = [540, 960]) {
  const kind = SHOT_KINDS[shot.kind] ?? SHOT_KINDS.medium; // validateShots names a bad kind
  const base = shot.zoom ?? kind.zoom;
  const push = Math.min(shot.push ?? 1, MAX_PUSH);
  const u = Math.max(0, Math.min(1, local / Math.max(0.5, Number.isFinite(length) ? length : 3)));
  const zoom = base * Math.pow(push, u * (2 - u)); // eased: the push settles
  const [sx, sy] = shot.on ?? SUBJECT_AT;
  const [cx, cy] = pivot;
  return { x: sx - cx - (SUBJECT_AT[0] - cx) / zoom, y: sy - cy - (SUBJECT_AT[1] - cy) / zoom, zoom, rot: 0, tilt: 0 };
}

/** The depth layers a scene may be drawn in (motion.js frame()). */
const LAYERS = ['bg', 'mid', 'fg'];

/**
 * The frame at time t under its shot list. `draw(shot, local, i)` returns the scene's parts (an SVG
 * string, a list, or the depth layers { bg, mid, fg }): the same scene in every shot (EX3-90),
 * framed by the active shot's camera. A shot never adds a layer or hides what is in view.
 * `o` passes through to frame() (pivot, focus); `seam` as frame().
 */
export function shotFrame(t, shots, draw, o = {}, seam = null) {
  const { i, shot, local, length } = shotAt(t, shots);
  const camera = shotCamera(shot, local, length, o.pivot ?? [540, 960]);
  const parts = draw(shot, local, i);
  // 4.0 (hx-4): the scene may come in its depth layers { bg, mid, fg } (the same layers in every
  // shot); frame() moves them with parallax. Anything else is a layer the shot added.
  if (typeof parts === 'object' && parts !== null && !Array.isArray(parts) && Object.keys(parts).some((k) => !LAYERS.includes(k))) {
    throw new Error('shotFrame: draw() returns the scene only (an SVG string, an array of parts, or its depth layers { bg, mid, fg }); a shot never adds a foreground layer (EX3-90)');
  }
  const wash = camera.zoom > WASH_ZOOM ? bandWash() : '';
  return frame(t, { ...o, camera }, parts, seam) + wash;
}

/** The shot rules (EX3-83, EX3-90) as error strings; [] when the list is good. */
export function validateShots(shots, duration) {
  const errors = [];
  if (!Array.isArray(shots) || !shots.length) return ['no shots'];
  shots.forEach((s, k) => {
    if (REMOVED_KINDS[s.kind]) errors.push(`shot ${k + 1}: ${REMOVED_KINDS[s.kind]}; use ${Object.keys(SHOT_KINDS).join(', ')}`);
    else if (!SHOT_KINDS[s.kind]) errors.push(`shot ${k + 1}: unknown kind "${s.kind}" (${Object.keys(SHOT_KINDS).join(', ')})`);
    if (s.kind === 'insert' && (s.zoom ?? SHOT_KINDS.insert.zoom) < INSERT_MIN_ZOOM) errors.push(`shot ${k + 1}: an insert is a tight camera on one object (zoom ${INSERT_MIN_ZOOM} or more, not ${s.zoom}); for more of the scene use medium`);
    if (!(s.at >= 0) || (k > 0 && s.at <= shots[k - 1].at)) errors.push(`shot ${k + 1}: starts at ${s.at}s; shots run in order from 0`);
    if ((s.push ?? 1) > MAX_PUSH) errors.push(`shot ${k + 1}: push ${s.push}× is over ${MAX_PUSH}×`);
  });
  if (shots[0]?.at !== 0) errors.push('the first shot starts at 0s');
  if (duration > MULTI_SHOT_AFTER && shots.length < 2) errors.push(`a ${duration}s frame needs at least 2 shots (a cut every 2.5–4s)`);
  shots.forEach((s, k) => {
    const end = shots[k + 1]?.at ?? duration;
    const len = end - s.at;
    if (len > MAX_SHOT + 1e-6) errors.push(`shot ${k + 1} runs ${len.toFixed(2)}s; cut by ${MAX_SHOT}s`);
    if (k < shots.length - 1 && len < MIN_SHOT - 1e-6) errors.push(`shot ${k + 1} runs ${len.toFixed(2)}s; hold a shot at least ${MIN_SHOT}s`);
  });
  for (let k = 1; k < shots.length; k++) {
    const a = shots[k - 1];
    const b = shots[k];
    if (a.kind === b.kind && JSON.stringify(a.on) === JSON.stringify(b.on)) errors.push(`shots ${k} and ${k + 1} are the same picture (${b.kind} on the same subject)`);
  }
  return errors;
}
