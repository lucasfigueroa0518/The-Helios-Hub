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
//                                  draw(shot, local) returns the scene's parts (in a lens.js
//                                  perspective shot, o.lens, possibly as { bg, mid, fg })
//   validateShots(shots, dur)      the rules, as error strings (try.mjs and lint call it)
//
// 4.1 camera shots (a shot carries its lens camera; see "Cut grammar" below):
//   shotLensAt(shot, local, len)   its camera with its one eased move
//   cutProblems · dofProblems · crowdProblems · labelProblems   the checks try.mjs runs
//   inShot(shot, id) · castItems(shot, items)                   draw only the shot's cast
//
// A shot: { at, kind, on: [x, y], zoom?, push? }. `on` is the subject's screen point in the
// scene as drawn at zoom 1; `push` (≤ 1.2) slowly pushes in across the shot.

import { frame } from './motion.js';
import { el, id, ref, groundName } from './draw.js';
import { GROUNDS } from './core.js';
import { lens, cameraAt, framedBoxes, framedLabels, SAFE } from './lens.js';

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
  errors.push(...cutProblems(shots, { duration }));
  return errors;
}

// ── Cut grammar (Explainers 4.1): a shot carries its own lens camera ──────────────────────
//
// A camera shot: { at, kind, camera: { pos, target, fov }, subject: 'id', cast: ['id', …],
// move?: { kind: 'push' | 'pull' | 'pan' | 'follow', by? (cm), deg?, at?, dur?, e? },
// focus?: { reason: 'insert' | 'reveal' | 'rack', on: 'id', to?: 'id', at?, dur? },
// subjectAt?: [x, y, z] (the subject's world point; the camera's target when absent) }.
// The camera is the only reframing: no `on`, `zoom` or `push` crop on top of it.

/** A cut to the same subject must swing the camera at least this far around it… */
export const CUT_MIN_DEG = 30;
/** …or change its height by this much (elevation angle seen from the subject). */
export const CUT_MIN_HEIGHT_DEG = 15;
/** Two crop shots whose `on` points are this close frame the same view. */
export const SAME_VIEW_PX = 40;
/** The one motivated move a shot may make. */
export const SHOT_MOVES = {
  push: 'by (cm): toward the subject as tension builds',
  pull: 'by (cm): back from the subject, to reveal',
  pan: 'deg: turn to follow (left is +)',
  follow: 'by (cm): camera and target travel sideways with a walker (right is +)',
};
/** Why a shot may blur anything: without one of these, everything is sharp. */
export const FOCUS_REASONS = {
  insert: 'one small object isolated from the scene',
  reveal: 'the subject sharpens out of a soft scene',
  rack: 'focus pulls from one entity to the next (on → to)',
};
/** At most this many critters visible in a camera shot (principles §3). */
export const MAX_CAST_CRITTERS = 3;

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
  }
  return cameraAt(local, shot.camera, moves);
}

/** How the camera sits around point p: { az, el } in degrees. */
function bearing(cam, p) {
  const d = [cam.pos[0] - p[0], cam.pos[1] - p[1], cam.pos[2] - p[2]];
  return { az: Math.atan2(d[1], d[0]) * DEG, el: Math.atan2(d[2], Math.hypot(d[0], d[1])) * DEG };
}

/** The angle (deg) and height change (deg) between two cameras around the subject at p. */
export function cutAngle(a, b, p) {
  const A = bearing(a, p);
  const B = bearing(b, p);
  let az = Math.abs(A.az - B.az) % 360;
  if (az > 180) az = 360 - az;
  return { around: az, height: Math.abs(A.el - B.el) };
}

/**
 * The cut grammar as error strings: every cut changes the subject or the camera's angle around
 * it (≥ CUT_MIN_DEG, or ≥ CUT_MIN_HEIGHT_DEG of height); a crop shot to a crop of the same view is
 * a jump cut; a camera shot reframes one way only (its lens, never a crop on top) and makes at most
 * one move. With `samples` ([{ t, svg }]), a crop shot list whose per-shot lens also changes
 * (render()'s data-cam) is flagged as double reframing. A cut between two places (each camera
 * shot's `place`, default 'main') is a new picture and never a jump cut.
 */
export function cutProblems(shots, { duration, samples = null } = {}) {
  const out = [];
  if (!Array.isArray(shots)) return out;
  shots.forEach((s, k) => {
    if (!isCameraShot(s)) return;
    const n = `shot ${k + 1}`;
    if (s.on !== undefined || s.zoom !== undefined || s.push !== undefined) out.push(`${n}: one reframing per shot: it has a lens camera, so drop its 2D crop (on/zoom/push); move the camera instead`);
    if (!s.camera.pos || !s.camera.target) out.push(`${n}: camera needs pos and target (world cm)`);
    if (Array.isArray(s.move) || s.moves) out.push(`${n}: at most one motivated move within a shot (push, pull, pan or follow); cut for another`);
    else if (s.move && !SHOT_MOVES[s.move.kind]) out.push(`${n}: unknown move "${s.move.kind}" (${Object.keys(SHOT_MOVES).join(', ')})`);
    if (!Array.isArray(s.cast) || !s.cast.length) out.push(`${n}: list its cast (the entities it shows)`);
    else if (s.subject && !s.cast.includes(s.subject)) out.push(`${n}: its subject "${s.subject}" is not in its cast`);
  });
  for (let k = 1; k < shots.length; k++) {
    const a = shots[k - 1];
    const b = shots[k];
    const pair = `shots ${k} and ${k + 1}`;
    if (isCameraShot(a) && isCameraShot(b)) {
      if (!a.camera.pos || !b.camera.pos) continue;
      // a cut to another place (shot.place, a world.js SETS id; 'main' when absent) is a new
      // picture whatever the cameras' angles: it is never a jump cut
      if ((a.place ?? 'main') !== (b.place ?? 'main')) continue;
      const sa = subjectOf(a);
      const sb = subjectOf(b);
      if (sa && sb && sa !== sb) continue;
      const len = lengthOf(shots, k - 1, duration);
      const end = shotLensAt(a, Number.isFinite(len) ? len : 3, len);
      const p = b.subjectAt ?? b.camera.target;
      const { around, height } = cutAngle(end, b.camera, p);
      if (around < CUT_MIN_DEG && height < CUT_MIN_HEIGHT_DEG) {
        out.push(`${pair}: jump cut: the same subject "${sb ?? '?'}" from ${Math.round(around)}° around it and ${Math.round(height)}° of height: cut to a new subject, or swing the camera ≥${CUT_MIN_DEG}° around it (or ≥${CUT_MIN_HEIGHT_DEG}° up or down); a closer copy of the same view reads as a glitch`);
      }
    } else if (!isCameraShot(a) && !isCameraShot(b)) {
      const same = a.on === undefined && b.on === undefined ? true : a.on && b.on && Math.hypot(a.on[0] - b.on[0], a.on[1] - b.on[1]) < SAME_VIEW_PX;
      if (same) out.push(`${pair}: jump cut: the same picture (${a.kind} → ${b.kind} on the same subject, only the crop changes); cut to a new subject or a new camera angle`);
    }
  }
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

/** True when entity `id` is in the shot's cast (a crop shot, which has no cast, shows everything). */
export const inShot = (shot, id) => !Array.isArray(shot?.cast) || shot.cast.includes(id);
/** Only the items the shot shows: items with an `id` outside its cast are dropped (set pieces
 *  without an id stay; they are the room). */
export const castItems = (shot, items) => items.filter((it) => !it || typeof it !== 'object' || !it.id || inShot(shot, it.id));

/**
 * Depth of field by intent, as error strings: a camera shot blurs only with a declared focus
 * { reason, on } (FOCUS_REASONS), `on` in its cast, never away from its named subject except as a
 * rack; with `samples`, a camera shot drawn with blur but no intent, or with its subject blurred,
 * is flagged. Crop shots are not checked (their frames keep the old render({ focus })).
 */
export function dofProblems(shots, samples = null) {
  const out = [];
  if (!Array.isArray(shots) || !shots.length) return out;
  shots.forEach((s, k) => {
    if (!isCameraShot(s) || !s.focus) return;
    const n = `shot ${k + 1}`;
    const f = s.focus;
    if (!FOCUS_REASONS[f.reason]) out.push(`${n}: focus needs a reason (${Object.keys(FOCUS_REASONS).join(', ')}); without one the shot is sharp`);
    if (!f.on || !inShot(s, f.on)) out.push(`${n}: focus on "${f.on}" is not in the shot's cast`);
    if (f.reason === 'rack' && (!f.to || f.to === f.on || !inShot(s, f.to))) out.push(`${n}: a rack focus pulls from one cast entity to another (focus.to)`);
    if (f.reason !== 'rack' && s.subject && f.on && f.on !== s.subject) out.push(`${n}: focus on "${f.on}" blurs the named subject "${s.subject}"; focus on the subject, or rack to it`);
  });
  const seen = new Set();
  for (const smp of samples ?? []) {
    if (typeof smp.t !== 'number') continue;
    const { i, shot } = shotAt(smp.t, shots);
    if (!isCameraShot(shot)) continue;
    const svg = String(smp.svg ?? '');
    if (!shot.focus && /data-blur="/.test(svg) && !seen.has(`b${i}`)) {
      seen.add(`b${i}`);
      out.push(`shot ${i + 1} at ${smp.t.toFixed(2)}s: blurred without a reason: keep it sharp, or declare focus { reason, on }`);
    }
    const subj = shot.subject;
    if (subj && new RegExp(`data-blur-who="${subj.replace(/[^\w-]/g, '')}"`).test(svg) && !seen.has(`s${i}`)) {
      seen.add(`s${i}`);
      out.push(`shot ${i + 1} at ${smp.t.toFixed(2)}s: the named subject "${subj}" is blurred; never blur what the voice is naming`);
    }
  }
  return out;
}

/** Per-shot cast on screen: a camera shot shows at most MAX_CAST_CRITTERS critters, all from its cast. */
export function crowdProblems(shots, samples = []) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(shots) || !shots.length) return out;
  for (const smp of samples ?? []) {
    if (typeof smp.t !== 'number') continue;
    const { i, shot } = shotAt(smp.t, shots);
    if (!isCameraShot(shot)) continue;
    const boxes = smp.boxes ?? framedBoxes(String(smp.svg ?? '')) ?? [];
    const who = [...new Set(boxes.filter((b) => b.kind === 'critter' && b.box[2] > 0 && b.box[0] < 1080 && b.box[3] > 0 && b.box[1] < 1920).map((b) => b.who))];
    if (who.length > MAX_CAST_CRITTERS && !seen.has(`n${i}`)) {
      seen.add(`n${i}`);
      out.push(`shot ${i + 1} at ${smp.t.toFixed(2)}s shows ${who.length} critters (${who.join(', ')}): at most ${MAX_CAST_CRITTERS}; the rest go off screen, not squeezed in`);
    }
    for (const w of who) {
      if (inShot(shot, w) || seen.has(`c${i}${w}`)) continue;
      seen.add(`c${i}${w}`);
      out.push(`shot ${i + 1} at ${smp.t.toFixed(2)}s draws "${w}", who is not in its cast; draw only the cast (castItems)`);
    }
  }
  return out;
}

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
