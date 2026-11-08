// The Explainers world kit, shots (Explainers 3.2, EX3-83; a camera only in 3.3, EX3-90; 4.2): the
// same scene from different shots. A frame is a list of shots that hard-cut on voice cues; each shot
// frames its subject with the kit camera (one calm move inside a shot; cuts between shots may
// reframe freely).
//
// A shot is a camera, never an edit of the world (EX3-90): every shot draws the same scene, and
// the camera only chooses what is in view. An insert is a tight camera on one object, so the rest
// falls out of frame; nothing is hidden, and nothing is added.
// The shot's subject is what the voice is naming during it (EX3-91).
//
//   SHOT_KINDS                     what each kind is (its zoom)
//   shotAt(t, shots)               the shot on screen at frame time t, and the time inside it
//   shotCamera(shot, local)        that shot's camera (centering its subject, with its push)
//   shotFrame(t, shots, draw, o)   the whole frame: frame() with the active shot's camera;
//                                  draw(shot, local) returns the scene's parts (in a lens.js
//                                  perspective shot, o.lens, possibly as { bg, mid, fg })
//   validateShots(shots, dur)      the shot list's shape, as error strings (kinds, order, push)
//
// 4.1 camera shots (a shot carries its lens camera; see "Cut grammar" below):
//   shotLensAt(shot, local, len)   its camera with its one eased move
//   cutProblems · labelProblems    breakage: a shot's shape; a label off its entity or the screen
//   jumpCutProblems(shots, o)      4.2: the same subject across a cut goes in or out at least 2×
//   inShot(shot, id) · castItems(shot, items)                   draw only the shot's cast
//
// 4.2 tools (never required):
//   journey(from, to, { by })      a trip between places: a cut to the destination, or a
//                                  travelling shot along a path, with where the traveller is
//   carry(id, { from, to, morph }) an element that keeps its identity and screen spot across a
//                                  cut, optionally morphing world look ↔ mechanism look; its spot
//                                  is declared in the storyboard (parseCarry: <id> box x0 y0 x1 y1)
//
// A crop shot: { at, kind, on: [x, y], zoom?, push? }. `on` is the subject's screen point in the
// scene as drawn at zoom 1; `push` (≤ 1.2) slowly pushes in across the shot.

import { frame, E } from './motion.js';
import { T, el, g, id, ref, groundName } from './draw.js';
import { GROUNDS } from './core.js';
import { lens, cameraAt, worldAt, framedBoxes, framedLabels, SAFE } from './lens.js';

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

/** Above this zoom a 2D crop shot washes the caption band back toward the ground (bandWash). */
export const WASH_ZOOM = 1.25;

/**
 * The caption band (y 250–570) washed back toward the ground, fading out by y 640: in a closer
 * shot the world's nearby objects are enlarged into the band, and light captions on a light
 * sheet (or dark on dark) stop reading. Context dims toward the ground (V-22); this is that dim,
 * on the band only. shotFrame adds it to a 2D crop shot above WASH_ZOOM, and to a lens (camera)
 * shot only when that shot sets `wash: true`; `wash: false` turns it off for any shot.
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
/** A crop shot's slow push-in stays within this (the camera is calm, V-7). */
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

/** The stack a perspective shot's scene may come in (motion.js frame(); only with o.lens). */
const LAYERS = ['bg', 'mid', 'fg'];

/**
 * The frame at time t under its shot list. `draw(shot, local, i)` returns the scene's parts (an SVG
 * string, a list, or, in a lens.js perspective shot, its stack { bg, mid, fg }): the same scene in
 * every shot (EX3-90), framed by the active shot's camera. A shot never adds a layer or hides
 * what is in view. `o` passes through to frame() (pivot, lens); `seam` as frame().
 */
export function shotFrame(t, shots, draw, o = {}, seam = null) {
  const { i, shot, local, length } = shotAt(t, shots);
  // a camera shot (4.1) is framed by its lens alone: draw(shot, local, i, { P, cam, inShot })
  // draws through P, and no 2D crop is stacked on it
  const lensShot = isCameraShot(shot);
  const cam = lensShot ? shotLensAt(shot, local, length) : null;
  const P = lensShot ? lens(cam) : null;
  const camera = lensShot ? { x: 0, y: 0, zoom: 1, rot: 0, tilt: 0 } : shotCamera(shot, local, length, o.pivot ?? [540, 960]);
  const parts = draw(shot, local, i, lensShot ? { P, cam, inShot: (id) => inShot(shot, id) } : undefined);
  // hx-4.1: a perspective shot's scene may come as its stack { bg, mid, fg } (the same in every
  // shot; frame() refuses it on the iso camera, which has no depth). Anything else is a layer the
  // shot added.
  if (typeof parts === 'object' && parts !== null && !Array.isArray(parts) && Object.keys(parts).some((k) => !LAYERS.includes(k))) {
    throw new Error('shotFrame: draw() returns the scene only (an SVG string, an array of parts, or its depth layers { bg, mid, fg }); a shot never adds a foreground layer (EX3-90)');
  }
  // the band wash (4.1): a lens shot frames the set with its real camera, and washing the band
  // hid the set's tells in every medium shot, so a lens shot washes only when it asks
  // (shot.wash: true, e.g. a busy set right behind the caption); a 2D crop shot, which enlarges
  // the drawing into the band, washes above WASH_ZOOM unless it says wash: false
  const tight = lensShot ? 0 : camera.zoom;
  const wash = shot?.wash === true || (shot?.wash !== false && tight > WASH_ZOOM) ? bandWash() : '';
  return frame(t, { ...o, camera, ...(lensShot ? { lens: P } : {}) }, parts, seam) + wash;
}

/**
 * The shot list's shape (EX3-83, EX3-90; 4.2 breakage only) as error strings, [] when good: known
 * kinds, shots in order from 0, a crop push within MAX_PUSH, and each camera shot's shape
 * (cutProblems). Pacing, shot counts and jump cuts are not here: pacing is craft, and the jump
 * cut is jumpCutProblems (call it once, beside this). `duration` is accepted for older callers.
 */
export function validateShots(shots, duration) {
  const errors = [];
  if (!Array.isArray(shots) || !shots.length) return ['no shots'];
  shots.forEach((s, k) => {
    if (REMOVED_KINDS[s.kind]) errors.push(`shot ${k + 1}: ${REMOVED_KINDS[s.kind]}; use ${Object.keys(SHOT_KINDS).join(', ')}`);
    else if (!SHOT_KINDS[s.kind]) errors.push(`shot ${k + 1}: unknown kind "${s.kind}" (${Object.keys(SHOT_KINDS).join(', ')})`);
    if (!(s.at >= 0) || (k > 0 && s.at <= shots[k - 1].at)) errors.push(`shot ${k + 1}: starts at ${s.at}s; shots run in order from 0`);
    if ((s.push ?? 1) > MAX_PUSH) errors.push(`shot ${k + 1}: push ${s.push}× is over ${MAX_PUSH}×`);
  });
  if (shots[0]?.at !== 0) errors.push('the first shot starts at 0s');
  errors.push(...cutProblems(shots, { duration }));
  return errors;
}

// ── Cut grammar (Explainers 4.1; 4.2) ────────────────────────────────────────────────────
//
// A camera shot: { at, kind, camera: { pos, target, fov }, subject: 'id', cast: ['id', …],
// place?: 'id' (a world.js SETS place; 'main' when absent),
// move?: { kind: 'push' | 'pull' | 'pan' | 'follow' | 'track', by? (cm), deg?, at?, dur?, e? },
// focus?: { reason: 'insert' | 'reveal' | 'rack', on: 'id', to?: 'id', at?, dur? },
// subjectAt?: [x, y, z] (the subject's world point; the camera's target when absent) }.
// The camera is the only reframing: no `on`, `zoom` or `push` crop on top of it.

/** Two crop shots whose `on` points are this close frame the same subject. */
export const SAME_VIEW_PX = 40;
/** A cut that stays on the same subject goes in or out by at least this much on screen (4.2,
 *  Lucas: "Twice is fine"): its size at least ×2, or at most ×½. A new subject is always fine. */
export const JUMP_CUT_RATIO = 2;
/** The one motivated move a shot may make. */
export const SHOT_MOVES = {
  push: 'by (cm): toward the subject as tension builds',
  pull: 'by (cm): back from the subject, to reveal',
  pan: 'deg: turn to follow (left is +)',
  follow: 'by (cm): camera and target travel sideways with a walker (right is +)',
  track: 'by (cm): camera and target travel forward with a walker, behind or ahead of it (forward is +)',
};
/** Why a shot may blur anything: without one of these, render() draws everything sharp. */
export const FOCUS_REASONS = {
  insert: 'one small object isolated from the scene',
  reveal: 'the subject sharpens out of a soft scene',
  rack: 'focus pulls from one entity to the next (on → to)',
};

export const isCameraShot = (s) => !!s && typeof s === 'object' && !!s.camera;
const subjectOf = (s) => s?.subject ?? s?.cast?.[0] ?? null;
const DEG = 180 / Math.PI;
const lengthOf = (shots, k, duration) => (shots[k + 1]?.at ?? duration ?? Infinity) - shots[k].at;

/** A camera shot's lens camera { pos, target, fov, roll } at `local` seconds (its one move, eased). */
export function shotLensAt(shot, local = 0, length = 3) {
  const m = shot.move;
  const moves = [];
  if (m && !Array.isArray(m) && SHOT_MOVES[m.kind]) {
    const at = m.at ?? 0;
    const dur = m.dur ?? Math.max(0.5, (Number.isFinite(length) ? length : 3) - at);
    const base = { at, dur, e: m.e ?? 'world' };
    if (m.kind === 'push') moves.push({ ...base, kind: 'push', by: Math.abs(m.by ?? 40) });
    if (m.kind === 'pull') moves.push({ ...base, kind: 'push', by: -Math.abs(m.by ?? 40) });
    if (m.kind === 'pan') moves.push({ ...base, kind: 'pan', deg: m.deg ?? 10 });
    if (m.kind === 'follow') moves.push({ ...base, kind: 'truck', by: m.by ?? 60 });
    if (m.kind === 'track') moves.push({ ...base, kind: 'dolly', by: m.by ?? 60 });
  }
  return cameraAt(local, shot.camera, moves);
}

/** How the camera sits around point p: { az, el } in degrees. */
function bearing(cam, p) {
  const d = [cam.pos[0] - p[0], cam.pos[1] - p[1], cam.pos[2] - p[2]];
  return { az: Math.atan2(d[1], d[0]) * DEG, el: Math.atan2(d[2], Math.hypot(d[0], d[1])) * DEG };
}

/** The angle (deg) and height change (deg) between two cameras around the subject at p (a
 *  measuring helper; 4.2 checks no angle). */
export function cutAngle(a, b, p) {
  const A = bearing(a, p);
  const B = bearing(b, p);
  let az = Math.abs(A.az - B.az) % 360;
  if (az > 180) az = 360 - az;
  return { around: az, height: Math.abs(A.el - B.el) };
}

/**
 * A shot's shape, as error strings (breakage only, 4.2): a camera shot reframes one way only (its
 * lens, never a crop on top), has a camera with pos and target, makes at most one known move, and
 * lists its cast with its subject in it. With `samples` ([{ t, svg }]), a crop shot list whose
 * per-shot lens also changes (render()'s data-cam) is flagged as double reframing. The cut itself
 * (same subject, too little change) is jumpCutProblems'.
 */
export function cutProblems(shots, { duration, samples = null } = {}) {
  const out = [];
  if (!Array.isArray(shots)) return out;
  shots.forEach((s, k) => {
    if (!isCameraShot(s)) return;
    const n = `shot ${k + 1}`;
    if (s.on !== undefined || s.zoom !== undefined || s.push !== undefined) out.push(`${n}: one reframing per shot: it has a lens camera, so drop its 2D crop (on/zoom/push); move the camera instead`);
    if (!s.camera.pos || !s.camera.target) out.push(`${n}: camera needs pos and target (world cm)`);
    if (Array.isArray(s.move) || s.moves) out.push(`${n}: at most one motivated move within a shot (${Object.keys(SHOT_MOVES).join(', ')}); cut for another`);
    else if (s.move && !SHOT_MOVES[s.move.kind]) out.push(`${n}: unknown move "${s.move.kind}" (${Object.keys(SHOT_MOVES).join(', ')})`);
    if (!Array.isArray(s.cast) || !s.cast.length) out.push(`${n}: list its cast (the entities it shows)`);
    else if (s.subject && !s.cast.includes(s.subject)) out.push(`${n}: its subject "${s.subject}" is not in its cast`);
  });
  if (Array.isArray(samples) && samples.length && shots.some((s) => !isCameraShot(s))) {
    const camOf = new Map();
    let stacked = false;
    for (const smp of samples) {
      const svg = String(smp.svg ?? '');
      const cam = svg.match(/data-cam="([^"]+)"/)?.[1];
      const zoom = Number(svg.match(/data-lens="([^ "]+)/)?.[1]);
      if (!cam || typeof smp.t !== 'number') continue;
      const { i, shot } = shotAt(smp.t, shots);
      if (isCameraShot(shot)) continue;
      if (!camOf.has(i)) camOf.set(i, { cam, zoom });
    }
    const ks = [...camOf.keys()].sort((x, y) => x - y);
    for (let j = 1; j < ks.length && !stacked; j++) {
      const A = camOf.get(ks[j - 1]);
      const B = camOf.get(ks[j]);
      if (A.cam !== B.cam && (Math.abs(A.zoom - 1) > 1e-3 || Math.abs(B.zoom - 1) > 1e-3)) {
        stacked = true;
        out.push(`shots ${ks[j - 1] + 1} and ${ks[j] + 1}: double reframing: each shot moves its lens AND crops it (zoom ${A.zoom} → ${B.zoom}); give each shot a camera (shot.camera) and drop the crop`);
      }
    }
  }
  return out;
}

/** A shot's subject's on-screen size from its camera at `local` seconds: a camera shot's px per cm
 *  at the subject (focal / depth, so a ratio of two is the subject's size ratio), a crop shot's
 *  zoom. Null when it cannot be told. */
function cameraSize(shot, local, length) {
  if (isCameraShot(shot)) {
    if (!shot.camera?.pos || !shot.camera?.target) return null;
    try {
      const c = shotLensAt(shot, local, length);
      const P = lens(c);
      const p = shot.subjectAt ?? c.target;
      return P.scaleAt(p[0], p[1], p[2] ?? 0);
    } catch {
      return null;
    }
  }
  return shotCamera(shot, local, length).zoom;
}
/** The subject's box size (√(w·h), screen px, uncropped) in a sample, or null. */
function sampleSize(smp, who) {
  if (!who || !smp) return null;
  const boxes = smp.boxes ?? framedBoxes(String(smp.svg ?? '')) ?? [];
  const b = boxes.find((x) => x.who === who);
  if (!b) return null;
  const w = b.box[2] - b.box[0];
  const h = b.box[3] - b.box[1];
  return w > 0 && h > 0 ? Math.sqrt(w * h) : null;
}

/**
 * Jump cuts (4.2, Lucas: "avoid jump cuts like the plague"), as error strings: two consecutive
 * shots in the same place on the same subject must change its on-screen size by at least
 * JUMP_CUT_RATIO, in (×2 or more) or out (×½ or less). A new subject or a new place is always a
 * clean cut, and the angle is never measured (orbiting the camera is never needed: on the same
 * subject the angle stays put and the size changes). A planned bridge is exempt: a pair where
 * either shot declares a carry (`shot.carry`, the storyboard's `carry:` part, any non-empty value),
 * or where the two shots declare different looks (`shot.look`: 'world' | 'mechanism' | 'blend'). The subject is shot.subject (else its
 * cast's first) for camera shots, and for crop shots a named subject or the same `on` point
 * (within SAME_VIEW_PX). Its size is measured from `samples` ([{ t, svg }] or [{ t, boxes }]:
 * its framed box in the last sample of the outgoing shot and the first of the incoming one) when
 * both carry it, else from the cameras (focal ÷ depth at the subject; a crop shot's zoom). A pair
 * that cannot be measured is skipped (fail open).
 */
export function jumpCutProblems(shots, { samples = null, duration } = {}) {
  const out = [];
  if (!Array.isArray(shots) || shots.length < 2) return out;
  const list = Array.isArray(samples) ? samples.filter((x) => x && typeof x.t === 'number').sort((x, y) => x.t - y.t) : [];
  for (let k = 1; k < shots.length; k++) {
    const a = shots[k - 1];
    const b = shots[k];
    if (!a || !b) continue;
    if ((a.place ?? 'main') !== (b.place ?? 'main')) continue;
    // a planned bridge is never a jump cut: a cut declared as a carry (the element held on its spot
    // on purpose), or a change of look (world ↔ mechanism: the same thing seen as something else)
    if (a.carry || b.carry) continue;
    if (a.look && b.look && a.look !== b.look) continue;
    const ca = isCameraShot(a);
    const cb = isCameraShot(b);
    let who = null;
    if (ca && cb) {
      const sa = subjectOf(a);
      const sb = subjectOf(b);
      if (!sa || !sb || sa !== sb) continue;
      who = sa;
    } else if (!ca && !cb) {
      if (a.subject || b.subject) {
        if (a.subject !== b.subject) continue;
        who = a.subject;
      } else {
        const same = a.on === undefined && b.on === undefined ? true : !!(a.on && b.on && Math.hypot(a.on[0] - b.on[0], a.on[1] - b.on[1]) < SAME_VIEW_PX);
        if (!same) continue;
      }
    } else {
      // a crop shot and a camera shot measure size in different units: only samples can tell
      if (!subjectOf(a) || subjectOf(a) !== subjectOf(b)) continue;
      who = subjectOf(a);
    }
    let ratio = null;
    const before = list.filter((x) => x.t >= a.at && x.t < b.at).at(-1);
    const after = list.find((x) => x.t >= b.at && (shots[k + 1] === undefined || x.t < shots[k + 1].at));
    const s0 = sampleSize(before, who);
    const s1 = sampleSize(after, who);
    if (s0 && s1) ratio = s1 / s0;
    else if (ca === cb) {
      const len = lengthOf(shots, k - 1, duration);
      const z0 = cameraSize(a, Number.isFinite(len) ? len : 3, len);
      const z1 = cameraSize(b, 0, lengthOf(shots, k, duration));
      if (z0 && z1) ratio = z1 / z0;
    }
    if (ratio === null) continue;
    const tol = 1e-3;
    if (ratio < JUMP_CUT_RATIO - tol && ratio > 1 / JUMP_CUT_RATIO + tol) {
      const name = who ? `"${who}"` : 'the same picture';
      out.push(`shots ${k} and ${k + 1}: jump cut: ${who ? `the same subject ${name}` : name} changes only ${ratio.toFixed(2)}× in size across the cut; on the same subject go in to at least ${JUMP_CUT_RATIO}× or out to at most ${1 / JUMP_CUT_RATIO}× (same angle), or cut to a new subject`);
    }
  }
  return out;
}

/** True when entity `id` is in the shot's cast (a crop shot, which has no cast, shows everything). */
export const inShot = (shot, id) => !Array.isArray(shot?.cast) || shot.cast.includes(id);
/** Only the items the shot shows: items with an `id` outside its cast are dropped (set pieces
 *  without an id stay; they are the room). */
export const castItems = (shot, items) => items.filter((it) => !it || typeof it !== 'object' || !it.id || inShot(shot, it.id));

/**
 * Labels belong to things (labelFor in lens.js), as error strings: each label's entity is visible
 * in the sample and in the shot's cast, the label sits in the safe area, and no other entity is
 * nearer to it than its own (a label over the wrong critter; an entity whose box contains its own,
 * like a neighborhood round a pin, is not a rival). A sample drawn without motion.js
 * frame() (no data-lens, so no entity boxes) reports `sample is not wrapped in frame(): no data-lens`.
 */
export function labelProblems(samples, shots = null, { safe = SAFE, slack = 2 } = {}) {
  const out = [];
  const seen = new Set();
  for (const smp of samples ?? []) {
    const svg = String(smp.svg ?? '');
    const labels = framedLabels(svg);
    if (!labels.length) continue;
    const at0 = typeof smp.t === 'number' ? ` at ${smp.t.toFixed(2)}s` : '';
    // without motion.js frame()'s data-lens wrapper no entity box can be read: say so once,
    // instead of reporting every label's entity as not visible
    if (framedBoxes(svg) === null) {
      if (!seen.has('nolens')) out.push(`sample${at0} is not wrapped in frame(): no data-lens`);
      seen.add('nolens');
      continue;
    }
    const boxes = (framedBoxes(svg) ?? []).filter((b) => b.box[2] > 0 && b.box[0] < 1080 && b.box[3] > 0 && b.box[1] < 1920);
    const at = typeof smp.t === 'number' ? ` at ${smp.t.toFixed(2)}s` : '';
    const shot = Array.isArray(shots) && shots.length && typeof smp.t === 'number' ? shotAt(smp.t, shots).shot : null;
    for (const L of labels) {
      const key = (x) => `${x}:${L.who}:${shot ? shots.indexOf(shot) : 0}`;
      const name = `the label "${L.text}" (on "${L.who}")`;
      const own = boxes.find((b) => b.who === L.who);
      if (shot && !inShot(shot, L.who) && !seen.has(key('cast'))) {
        seen.add(key('cast'));
        out.push(`${name}${at}: its entity is not in the shot's cast; a label leaves with its entity`);
        continue;
      }
      if (!own) {
        if (!seen.has(key('vis'))) out.push(`${name}${at}: its entity is not visible; a label leaves with its entity`);
        seen.add(key('vis'));
        continue;
      }
      const [x0, y0, x1, y1] = L.box;
      if ((x0 < safe.x0 - slack || x1 > safe.x1 + slack || y0 < safe.y0 - slack || y1 > safe.y1 + slack) && !seen.has(key('safe'))) {
        seen.add(key('safe'));
        out.push(`${name}${at} leaves the safe area (box ${L.box.map(Math.round).join(' ')}); keep it inside x ${safe.x0}–${safe.x1}, y ${safe.y0}–${safe.y1}`);
      }
      const p = [(x0 + x1) / 2, y1];
      const gap = (b) => Math.hypot((b.box[0] + b.box[2]) / 2 - p[0], Math.max(0, b.box[1] - p[1], p[1] - b.box[3]));
      // an entity that contains this one (a pin inside its neighborhood, a carton in the fridge) is
      // its surroundings, not a rival for its label
      const holds = (b) => b.box[0] <= own.box[0] + 1 && b.box[1] <= own.box[1] + 1 && b.box[2] >= own.box[2] - 1 && b.box[3] >= own.box[3] - 1;
      const other = boxes.filter((b) => b.who !== L.who && (b.kind === 'critter' || b.kind === 'entity') && !holds(b)).sort((a, b) => gap(a) - gap(b))[0];
      if (other && gap(other) + 10 < gap(own) && !seen.has(key('near'))) {
        seen.add(key('near'));
        out.push(`${name}${at} sits nearer "${other.who}" than its own entity; anchor it to "${L.who}" in world space (labelFor)`);
      }
    }
  }
  return out;
}

// ── 4.2 tools: journeys between places, and elements carried across a cut ────────────────

const flat2 = (v) => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
const pt3 = (p) => [p[0], p[1], p[2] ?? 0];
/** Ease in, then a steady walk (a traveller leaving: it never slows before it is out of frame). */
const easeInWalk = (u, a = 0.3) => (u <= 0 ? 0 : u >= 1 ? 1 : u < a ? (u * u) / (2 * a * (1 - a / 2)) : (a / 2 + (u - a)) / (1 - a / 2));
/** A steady walk that eases to a stop (a traveller arriving). */
const walkEaseOut = (u, a = 0.3) => 1 - easeInWalk(1 - u, a);

/**
 * A lens camera side-on to the segment a → b (world points on the floor), so a traveller going
 * from a to b crosses the screen to the `side` given ('right': left to right, the default; 'left'),
 * `dist` cm from the point `focus` (default the segment's middle), its eye `height` cm up looking
 * at `look` cm up. Returns { pos, target, fov } for lens(). CRAFT § 1: hold screen direction.
 */
export function sideCamera(a, b, { side = 'right', dist = 520, height = 120, look = 50, fov = 40, focus = null } = {}) {
  const d = flat2([b[0] - a[0], b[1] - a[1]]);
  const f = side === 'left' ? [d[1], -d[0]] : [-d[1], d[0]];
  const c = focus ?? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ((a[2] ?? 0) + (b[2] ?? 0)) / 2];
  const z0 = c[2] ?? 0;
  return { pos: [c[0] - f[0] * dist, c[1] - f[1] * dist, z0 + height], target: [c[0], c[1], z0 + look], fov };
}

/** A polyline's length and the point / heading at arc length s along it (world cm). */
function along(path) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = pt3(path[i]);
    const b = pt3(path[i + 1]);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    segs.push({ a, b, l, s0: total });
    total += l;
  }
  const at = (s) => {
    const x = Math.max(0, Math.min(total, s));
    const sg = segs.find((q) => x <= q.s0 + q.l + 1e-9) ?? segs[segs.length - 1];
    const k = sg.l > 0 ? (x - sg.s0) / sg.l : 0;
    return { pos: [sg.a[0] + (sg.b[0] - sg.a[0]) * k, sg.a[1] + (sg.b[1] - sg.a[1]) * k, sg.a[2] + (sg.b[2] - sg.a[2]) * k], heading: flat2([sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]]) };
  };
  return { total, at };
}

/**
 * A trip between two places (4.2, a tool): the voice says someone goes somewhere, and the picture
 * shows the going. `from` and `to` are places: a world.js SETS id, or { id, at: [x, y, z] (where
 * the traveller stands in that place), door?: [x, y, z] (where it leaves or arrives), path?: world
 * points (a lane: exterior().lanes.walk), camera?: a lens camera to use instead }.
 *   by 'cut'     two shots: in `from` the traveller walks from `at` out through `door` (or off the
 *                frame's edge); a hard cut to `to`, a wide that re-establishes the new place, where
 *                it walks in from the opposite edge to `at`. Screen direction holds across the cut.
 *   by 'travel'  a travelling shot through `via` (an exterior place; default `to`): the traveller
 *                walks its `path` (default from.at → to.at) while the camera tracks it side-on
 *                (`camera: 'side'`, a follow move, so the place slides past in parallax and the
 *                traveller keeps its spot with looking room ahead) or from behind (`camera:
 *                'behind'`, a track move; the traveller seen from its back). `arrive: true` adds
 *                the cut to `to`.
 * Options: at (s, when the trip starts in the frame), dur (s), traveller (its entity id: the shots'
 * subject), cast (more ids), side ('right' | 'left'), dist, height, look (the height it aims at), fov,
 * split (the share of `dur` before the cut).
 * Returns { by, shots (camera shots with place, subject, cast and why), at(t) → { place, pos,
 * heading, flip, view, walking, u } (where the traveller is at frame time t, for critterAt and
 * walk()), cutAt, end, dir, path }.
 */
export function journey(from, to, o = {}) {
  const { by = 'cut', at: t0 = 0, dur = 4, traveller = 'traveller', side = 'right', dist = 520, height = 120, look = 60, fov = 40, camera = 'side', arrive = true } = o;
  if (by !== 'cut' && by !== 'travel') throw new Error(`journey: by must be 'cut' or 'travel' (got "${by}")`);
  const A = typeof from === 'string' ? { id: from } : { ...from };
  const B = typeof to === 'string' ? { id: to } : { ...to };
  const cast = [traveller, ...(o.cast ?? []).filter((c) => c !== traveller)];
  const end = t0 + dur;
  const shots = [];
  const legs = [];
  const flipFor = (heading, cam) => {
    // the critter faces the way it walks on screen: flip when it walks to the left
    const P = lens(cam);
    const a = P(0, 0, 0);
    const b = P(heading[0] * 100, heading[1] * 100, 0);
    return b[0] < a[0];
  };
  const arrival = (start, tStart) => {
    const T1 = pt3(B.at ?? [0, 0, 0]);
    const dIn = B.door ? flat2([T1[0] - B.door[0], T1[1] - B.door[1]]) : flat2(B.heading ?? legs[legs.length - 1]?.heading ?? [1, 0]);
    const N1 = B.door ? pt3(B.door) : [T1[0] - dIn[0] * 340, T1[1] - dIn[1] * 340, T1[2]];
    const N0 = [N1[0] - dIn[0] * 160, N1[1] - dIn[1] * 160, N1[2]];
    const cam = B.camera ?? sideCamera(N1, T1, { side, dist: dist * 1.7, height: height * 1.4, look: look * 1.6, fov, focus: [N1[0] * 0.35 + T1[0] * 0.65, N1[1] * 0.35 + T1[1] * 0.65, T1[2]] });
    shots.push({ at: tStart, kind: 'wide', place: B.id ?? 'main', camera: cam, subject: traveller, cast, why: 'arrives: the new place, established' });
    legs.push({ place: B.id ?? 'main', t: [tStart, end], from: N0, to: T1, ease: walkEaseOut, heading: dIn, flip: flipFor(dIn, cam), view: 'front' });
    return start;
  };
  let cutAt = null;
  let path = null;
  if (by === 'cut') {
    const S0 = pt3(A.at ?? [0, 0, 0]);
    const dOut = A.door ? flat2([A.door[0] - S0[0], A.door[1] - S0[1]]) : flat2(A.heading ?? [1, 0]);
    const E0 = A.door ? pt3(A.door) : [S0[0] + dOut[0] * 340, S0[1] + dOut[1] * 340, S0[2]];
    const Eout = [E0[0] + dOut[0] * 180, E0[1] + dOut[1] * 180, E0[2]];
    const cam = A.camera ?? sideCamera(S0, E0, { side, dist, height, look, fov, focus: [S0[0] * 0.6 + E0[0] * 0.4, S0[1] * 0.6 + E0[1] * 0.4, S0[2]] });
    cutAt = t0 + dur * (o.split ?? 0.48);
    shots.push({ at: t0, kind: 'medium', place: A.id ?? 'main', camera: cam, subject: traveller, cast, why: 'leaves' });
    legs.push({ place: A.id ?? 'main', t: [t0, cutAt], from: S0, to: Eout, ease: easeInWalk, heading: dOut, flip: flipFor(dOut, cam), view: 'front' });
    arrival(null, cutAt);
  } else {
    const via = o.via ? (typeof o.via === 'string' ? { id: o.via } : o.via) : B;
    path = (o.path ?? via.path ?? [A.at ?? [0, 0, 0], B.at ?? [400, 0, 0]]).map(pt3);
    const run = along(path);
    const tEnd = arrive && B.id && B.id !== (via.id ?? B.id) ? t0 + dur * (o.split ?? 0.62) : end;
    const d = flat2([path[path.length - 1][0] - path[0][0], path[path.length - 1][1] - path[0][1]]);
    let cam;
    let move;
    if (camera === 'behind') {
      cam = via.camera ?? { pos: [path[0][0] - d[0] * dist, path[0][1] - d[1] * dist, path[0][2] + height * 1.3], target: [path[0][0] + d[0] * 300, path[0][1] + d[1] * 300, path[0][2] + 40], fov };
      move = { kind: 'track', by: run.total, at: 0, dur: tEnd - t0, e: 'world' };
    } else {
      // the traveller a third in from the trailing edge: room to look into ahead of it
      const lead = dist * Math.tan(((fov / 2) * Math.PI) / 180) * (1080 / 1920) * 0.38;
      const focus = [path[0][0] + d[0] * lead, path[0][1] + d[1] * lead, path[0][2]];
      cam = via.camera ?? sideCamera(path[0], path[path.length - 1], { side, dist, height, look, fov, focus });
      const along2 = (path[path.length - 1][0] - path[0][0]) * d[0] + (path[path.length - 1][1] - path[0][1]) * d[1];
      move = { kind: 'follow', by: side === 'left' ? -along2 : along2, at: 0, dur: tEnd - t0, e: 'world' };
    }
    shots.push({ at: t0, kind: camera === 'behind' ? 'medium' : 'wide', place: via.id ?? 'main', camera: cam, move, subject: traveller, cast, why: 'the trip itself: the place slides past' });
    legs.push({ place: via.id ?? 'main', t: [t0, tEnd], path: run, ease: E.world, view: camera === 'behind' ? 'back' : 'front', cam });
    if (tEnd < end) {
      cutAt = tEnd;
      arrival(null, tEnd);
    }
  }
  const atT = (t) => {
    const leg = legs.find((l) => t < l.t[1]) ?? legs[legs.length - 1];
    const u = Math.max(0, Math.min(1, (t - leg.t[0]) / Math.max(1e-6, leg.t[1] - leg.t[0])));
    const k = leg.ease(u);
    if (leg.path) {
      const p = leg.path.at(leg.path.total * k);
      return { place: leg.place, pos: p.pos, heading: p.heading, flip: leg.view === 'back' ? false : flipFor(p.heading, leg.cam), view: leg.view, walking: u > 0 && u < 1, u };
    }
    const pos = [leg.from[0] + (leg.to[0] - leg.from[0]) * k, leg.from[1] + (leg.to[1] - leg.from[1]) * k, leg.from[2] + (leg.to[2] - leg.from[2]) * k];
    return { place: leg.place, pos, heading: leg.heading, flip: leg.flip, view: leg.view, walking: u > 0 && u < 1, u };
  };
  return { by, shots, at: atT, cutAt, end, dir: side === 'left' ? 'right-to-left' : 'left-to-right', path };
}

/**
 * A lens that shows a world box of `size` [w, d, h] cm standing at the origin (its base centre at
 * [0, 0, 0]) landing exactly on the screen `box` [x0, y0, x1, y1]: seen from `deg` around it (0 =
 * looking +y) and `elev` degrees above. So a world-look element can be drawn through a lens inside
 * a flat frame (a mechanism frame), on the very spot it held across a cut. Returns { P, cam }.
 */
export function lensOnto(box, size, { deg = 0, elev = 14, fov = 30 } = {}) {
  const [w, d, h] = size;
  const c = [0, 0, h / 2];
  const a = (deg * Math.PI) / 180;
  const e = (elev * Math.PI) / 180;
  const at = (D) => ({ pos: [c[0] - D * Math.cos(e) * Math.sin(a), c[1] - D * Math.cos(e) * Math.cos(a), c[2] + D * Math.sin(e)], target: c, fov });
  const corners = [];
  for (const x of [-w / 2, w / 2]) for (const y of [-d / 2, d / 2]) for (const z of [0, h]) corners.push([x, y, z]);
  const sb = (P) => {
    const q = corners.map((p) => P(...p));
    return [Math.min(...q.map((v) => v[0])), Math.min(...q.map((v) => v[1])), Math.max(...q.map((v) => v[0])), Math.max(...q.map((v) => v[1]))];
  };
  const want = box[3] - box[1];
  let D = 400;
  for (let k = 0; k < 6; k++) {
    const b = sb(lens(at(D)));
    D *= (b[3] - b[1]) / want;
  }
  const cam0 = at(D);
  const b = sb(lens(cam0));
  const cam = { ...cam0, cx: 540 + ((box[0] + box[2]) / 2 - (b[0] + b[2]) / 2), cy: 960 + ((box[1] + box[3]) / 2 - (b[1] + b[3]) / 2) };
  return { P: lens(cam), cam };
}

/** The elements a drawn frame carries (carry().tag / draw()): [{ id, box }]. */
export function carriedBoxes(svg) {
  return [...String(svg).matchAll(/<g [^>]*data-carry="([^"]+)"[^>]*data-carry-box="([^"]+)"[^>]*>/g)].map((m) => ({ id: m[1], box: m[2].split(' ').map(Number) }));
}

/**
 * The storyboard's carry declaration (4.2, agreed with B in NOTES-B / NOTES-D): the part after
 * `carry:` on a shot line, the element's screen box at the cut (1080 × 1920 px, inside the safe area):
 *   <element id> box <x0> <y0> <x1> <y1>           (the canonical form the docs teach)
 *   <element id> @ <x>,<y> <h>px | <w>x<h>px       (also read: its centre and its on-screen size)
 * The director writes the same declaration on both sides of a planned carry (the outgoing shot and
 * the incoming one, in two frames built in parallel), so both place the element identically without
 * seeing each other. Returns { id, box, spot (its centre), w, h } or null; a bare id (`carry:
 * parcel`) parses with box, spot, w and h null.
 */
export const CARRY_BOX_RE = /^\s*([\w-]+)\s+box\s+(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*$/i;
export const CARRY_RE = /^\s*([\w-]+)\s*(?:@\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s+(?:(\d+(?:\.\d+)?)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*px)?\s*$/i;
export function parseCarry(text) {
  const t = String(text ?? '');
  const bx = CARRY_BOX_RE.exec(t);
  if (bx) {
    const [x0, y0, x1, y1] = bx.slice(2, 6).map(Number);
    if (!(x1 > x0 && y1 > y0)) return null;
    return { id: bx[1], box: [x0, y0, x1, y1], spot: [(x0 + x1) / 2, (y0 + y1) / 2], w: x1 - x0, h: y1 - y0 };
  }
  const m = CARRY_RE.exec(t);
  if (!m) return null;
  if (m[2] === undefined) return { id: m[1], box: null, spot: null, w: null, h: null };
  const [x, y, h] = [Number(m[2]), Number(m[3]), Number(m[5])];
  const w = m[4] !== undefined ? Number(m[4]) : h;
  if (!(h > 0) || !(w > 0)) return null;
  return { id: m[1], box: [x - w / 2, y - h / 2, x + w / 2, y + h / 2], spot: [x, y], w, h };
}

/**
 * An element carried across a cut (4.2, a tool; never required): it keeps its identity and its spot
 * on screen from the end of one shot to the start of the next, for a match cut or a bridge between
 * the world and the mechanism. `from` gives where it sits at the cut: { box: [x0, y0, x1, y1] }
 * (screen px), or { P, at: [x, y, z] (its base centre), size: [w, d, h] (cm) } (a lens shot), or
 * { svg, who } (read from a drawn frame's data-frame-box). `to` (optional): { P, z } (a lens
 * shot: where to build it there so it lands on the same spot) or { box } (a flat frame: the
 * same box by default). `morph`: 'world→mechanism' | 'mechanism→world' (null: no change of
 * look), over `dur` s from `at` s into the incoming shot.
 * Returns { id, box, center, w, h, to (for a lens `to`: { at, scale (px per cm there), cm: { w, h } }),
 * mix(local) → { world, mechanism, wipe } (the two looks' shares and the wipe front, 0..1),
 * draw(local, { world: (box) → svg, mechanism: (box) → svg }) → the element at its spot, mid-morph a
 * light wipe sweeping the mechanism look in over the world look (or back), with a small settle; and
 * tag(svg) → svg marked data-carry / data-carry-box (carriedBoxes reads it) }.
 */
export function carry(name, { from = null, spot = null, size = null, w: wGiven = null, to = null, morph = null, at = 0, dur = 0.7 } = {}) {
  // the storyboard's declaration, given whole as the name or as `from`
  const declared = typeof from === 'string' || /\s(box|@)\s|@/.test(String(name));
  const decl = typeof from === 'string' ? parseCarry(from) : declared ? parseCarry(name) : null;
  if (declared && !decl?.box) throw new Error(`carry: "${typeof from === 'string' ? from : name}" is not a carry declaration (<id> box <x0> <y0> <x1> <y1>, or <id> @ <x>,<y> <h>px)`);
  if (decl) name = decl.id;
  if (!decl && spot) {
    if (!(Array.isArray(spot) && spot.length === 2 && spot.every(Number.isFinite) && size > 0)) throw new Error('carry: a spot is [x, y] (screen px) with a size (its on-screen height, px)');
  }
  const planned = decl ?? (spot ? { spot, h: size, w: wGiven } : null);
  if (!planned && !from) throw new Error('carry: `from` is required (the storyboard declaration "<id> @ <x>,<y> <h>px", { spot, size }, { box }, { P, at, size } or { svg, who })');
  if (morph !== null && morph !== 'world→mechanism' && morph !== 'mechanism→world') throw new Error(`carry: morph is 'world→mechanism', 'mechanism→world' or null (got "${morph}")`);
  let box = null;
  if (planned) {
    // the declared box (a size alone is square): the same box on both sides of the cut
    const pw = planned.w ?? planned.h;
    box = planned.box ? [...planned.box] : [planned.spot[0] - pw / 2, planned.spot[1] - planned.h / 2, planned.spot[0] + pw / 2, planned.spot[1] + planned.h / 2];
  }
  from = from && typeof from === 'object' ? from : {};
  if (!box && from.box) box = [...from.box];
  if (!box && from.P && from.at && from.size) {
    const [w, d, h] = from.size;
    const q = [];
    for (const x of [-w / 2, w / 2]) for (const y of [-d / 2, d / 2]) for (const z of [0, h]) q.push(from.P(from.at[0] + x, from.at[1] + y, (from.at[2] ?? 0) + z));
    box = [Math.min(...q.map((v) => v[0])), Math.min(...q.map((v) => v[1])), Math.max(...q.map((v) => v[0])), Math.max(...q.map((v) => v[1]))];
  }
  if (!box && from.svg) {
    const who = from.who ?? name;
    const fb = framedBoxes(from.svg)?.find((b) => b.who === who);
    const raw = fb?.box ?? String(from.svg).match(new RegExp(`data-frame-who="${who}"[^>]*data-frame-box="([^"]+)"`))?.[1]?.split(' ').map(Number);
    if (raw && raw.length === 4) box = raw;
  }
  if (!box || box.length !== 4 || !box.every(Number.isFinite)) throw new Error(`carry: could not find where "${name}" sits at the cut`);
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0;
  const h = y1 - y0;
  const center = [(x0 + x1) / 2, (y0 + y1) / 2];
  let toRes = null;
  if (to?.P && to.size) {
    // stand the element (to.size, cm) on the plane z so its drawn box is centred on the spot at the
    // spot's height: solve for where it stands and the factor it is drawn at
    const P2 = to.P;
    const z = to.z ?? 0;
    const [sw, sd, shh] = to.size;
    const boxAt = (p, f) => {
      const q = [];
      for (const x of [-sw / 2, sw / 2]) for (const y of [-sd / 2, sd / 2]) for (const zz of [0, shh]) q.push(P2(p[0] + x * f, p[1] + y * f, z + zz * f));
      return [Math.min(...q.map((v) => v[0])), Math.min(...q.map((v) => v[1])), Math.max(...q.map((v) => v[0])), Math.max(...q.map((v) => v[1]))];
    };
    let aim = [center[0], y1];
    let p = worldAt(P2, aim[0], aim[1], z);
    let f = h / Math.max(1e-6, P2.scaleAt(p[0], p[1], z + shh / 2) * shh);
    for (let k = 0; k < 8; k++) {
      const b = boxAt(p, f);
      f *= h / Math.max(1e-6, b[3] - b[1]);
      const b2 = boxAt(p, f);
      aim = [aim[0] + (center[0] - (b2[0] + b2[2]) / 2), aim[1] + (center[1] - (b2[1] + b2[3]) / 2)];
      p = worldAt(P2, aim[0], aim[1], z);
    }
    const sc = P2.scaleAt(p[0], p[1], z + (shh * f) / 2);
    toRes = { at: p, fit: f, scale: sc, cm: { w: sw * f, h: shh * f } };
  } else if (to?.P) {
    const z = to.z ?? 0;
    const p = worldAt(to.P, center[0], y1, z);
    const sc = to.P.scaleAt(p[0], p[1], z + h / 2 / Math.max(1e-6, to.P.scaleAt(...p)));
    toRes = { at: p, scale: sc, cm: { w: w / sc, h: h / sc } };
  } else if (to?.box) toRes = { box: [...to.box] };
  const mix = (local) => {
    if (!morph) return { world: 1, mechanism: 0, wipe: 0 };
    const u = Math.max(0, Math.min(1, (local - at) / Math.max(1e-6, dur)));
    const e = E.world(u);
    return morph === 'world→mechanism' ? { world: 1 - e, mechanism: e, wipe: e } : { world: e, mechanism: 1 - e, wipe: e };
  };
  const tagAttrs = { 'data-carry': name, 'data-carry-box': box.map((v) => Math.round(v * 10) / 10).join(' ') };
  const tag = (svg) => g(tagAttrs, svg);
  const draw = (local, looks = {}) => {
    const m = mix(local);
    const W = looks.world ? looks.world(box) : '';
    const M = looks.mechanism ? looks.mechanism(box) : '';
    if (!morph) return tag(W || M);
    const u = Math.max(0, Math.min(1, (local - at) / Math.max(1e-6, dur)));
    const before = morph === 'world→mechanism' ? W : M;
    const after = morph === 'world→mechanism' ? M : W;
    if (u <= 0) return tag(before);
    // the settle: a small swell at mid-wipe, back to size as it lands (volume, CRAFT § 5)
    const k = 1 + 0.07 * Math.sin(Math.PI * u);
    const sx = `translate(${center[0].toFixed(1)} ${center[1].toFixed(1)}) scale(${k.toFixed(4)}) translate(${(-center[0]).toFixed(1)} ${(-center[1]).toFixed(1)})`;
    if (u >= 1) return tag(after);
    // the wipe: a diagonal front sweeping from the lower left to the upper right of the box; s(p) is
    // a point's distance along that diagonal from L, a corner just outside the box
    const pad = Math.max(w, h) * 0.25;
    const L = [x0 - pad, y1 + pad];
    const r2 = Math.SQRT1_2;
    const sNear = 2 * pad * r2;
    const sFar = (w + h + 2 * pad) * r2;
    const front = sNear + (sFar - sNear) * m.wipe;
    const cid = id(`carry-${String(name).replace(/[^\w-]/g, '')}-${Math.round(m.wipe * 1000)}`);
    // the part of the plane behind the front: the triangle from L out to s(p) = a
    const poly = (a) => {
      const k = a / r2;
      return `M ${L[0].toFixed(1)} ${L[1].toFixed(1)} L ${(L[0] + k).toFixed(1)} ${L[1].toFixed(1)} L ${L[0].toFixed(1)} ${(L[1] - k).toFixed(1)} Z`;
    };
    const span = sFar + pad * 2;
    const behind = poly(Math.max(0, front));
    const band = Math.max(8, Math.min(w, h) * 0.12);
    const glowD = `${poly(Math.max(0, front + band / 2))} ${poly(Math.max(0, front - band / 2))}`;
    const gid = `${cid}-g`;
    // everything stays near the element: the wipe and its light are clipped to its box (a margin
    // for a glow), so the change reads as the element turning, never a shape sweeping the frame
    const m2 = Math.max(w, h) * 0.18;
    const boxD = `M ${(x0 - m2).toFixed(1)} ${(y0 - m2).toFixed(1)} H ${(x1 + m2).toFixed(1)} V ${(y1 + m2).toFixed(1)} H ${(x0 - m2).toFixed(1)} Z`;
    return tag(g({ transform: sx }, [
      el('defs', {}, el('clipPath', { id: cid }, el('path', { d: behind })) + el('clipPath', { id: `${cid}-o` }, el('path', { d: `${poly(span + pad * 4)} ${behind}`, 'clip-rule': 'evenodd' })) + el('clipPath', { id: gid }, el('path', { d: glowD, 'clip-rule': 'evenodd' })) + el('clipPath', { id: `${cid}-b` }, el('path', { d: boxD }))),
      g({ 'clip-path': `url(#${cid}-o)` }, before),
      g({ 'clip-path': `url(#${cid}-b)` }, g({ 'clip-path': `url(#${cid})` }, after) + g({ 'clip-path': `url(#${gid})` }, el('rect', { x: (x0 - pad).toFixed(1), y: (y0 - pad).toFixed(1), width: (w + pad * 2).toFixed(1), height: (h + pad * 2).toFixed(1), fill: T.canvas, opacity: 0.55 }))),
    ].join('')));
  };
  return { id: name, box, center, w, h, planned: !!planned, to: toRes, morph, mix, draw, tag };
}
