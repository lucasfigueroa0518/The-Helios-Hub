// The Explainers world kit, right first time by construction (2026-11-17): the model states intent
// (a shot's kind and subject), code does the geometry. prepareScene wraps a frame module's default
// export, and mount.mjs (the render) and try.mjs (the checks) draw the same wrapped frame:
//
//   unblocked   a camera shot whose subject is hidden behind a nearer thing is orbited around its
//               camera target (15°, 30°, 45° either side, or raised) to the nearest angle where
//               nothing stands between the lens and the subject (subjectOcclusionProblems' measure)
//   framed      the subject is fitted to its shot kind inside the safe area (x 96–940, y 570–1600):
//               moved in by the lens centre (cx, cy: the picture slides, the angle stays), dollied
//               back when it is bigger than the safe area, dollied in when it is under its kind's
//               share (wide 0.6%, medium 3%, close or insert 10%)
//   no pop-in   a thing that would appear within 0.3 s after a cut is there at the cut: the shot
//               opens that much later in its own action (a cut may skip time) and catches up to the
//               voice within a second
//   dressing    the place's DRESSING is drawn in every camera shot (lens.js render, setlock.js)
//
// Each fix is computed once per shot from probe draws (pure: the same frame in, the same frame out,
// whatever order times are drawn in). Opt-outs on a shot: `fit: false` (no orbit, no resizing: the
// builder's angle and size, but a subject over the safe area's edge is still backed off or slid
// whole inside it), `fit: { orbit: false }` or `fit: { frame: false }` (that containment only), `popIn: false`; `undress: [ids]` for a piece of
// dressing. Plumbing only: builders follow frame.md, not this file.

import { snapCuts, isCameraShot, shotAt } from './shots.js';
import { faceEdgeCut, framedBoxes, lens, SAFE } from './lens.js';
import { setShotCamera, setProbeCamera } from './continuity.js';
import { useWorld } from './setlock.js';

const W = 1080;
const H = 1920;
const AREA = W * H;
/** A subject's least share of the frame by shot kind (layout-checks.mjs SUBJECT_MIN_SHARE). */
export const SHARE_MIN = { wide: 0.006, medium: 0.03, close: 0.1, insert: 0.1, reaction: 0.1 };
/** The fit aims under the occlusion check's 40%: at most this much of the subject hidden. */
export const OCCLUDED_OK = 0.3;
/** Nothing new within this long after a cut (layout-checks.mjs POP_IN). */
export const POP_IN = 0.3;
/** The angles tried, nearest first: [yaw, raise] degrees around the camera's target. */
export const ORBITS = [[15, 0], [-15, 0], [30, 0], [-30, 0], [0, 15], [0, 25], [45, 0], [-45, 0]];
/** How far the lens centre may slide the picture (px). */
export const MAX_SHIFT = 300;
/** The latest a pop-in may be pulled to its cut (s); later ones are left to the check. */
export const MAX_POP_SHIFT = 0.6;

const PREPARED = Symbol.for('hx.preparedScene');
const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const clip = (b) => [Math.max(b[0], 0), Math.max(b[1], 0), Math.min(b[2], W), Math.min(b[3], H)];
const rad = (d) => (d * Math.PI) / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const subjectOf = (shot) => shot?.subject ?? (Array.isArray(shot?.cast) ? shot.cast[0] : null);

/** The union of the boxes (lens.js framedBoxes) of thing `id`, or null. */
export function subjectBox(boxes, id) {
  const mine = (boxes ?? []).filter((b) => b.who === id);
  if (!mine.length) return null;
  return [Math.min(...mine.map((b) => b.box[0])), Math.min(...mine.map((b) => b.box[1])), Math.max(...mine.map((b) => b.box[2])), Math.max(...mine.map((b) => b.box[3]))];
}

/** How many probes show a critter's face cut by the frame's edge (lens.js faceEdgeCut, the check's own measure). */
export function cutCritters(rows) {
  return (rows ?? []).filter((r) => (r ?? []).some((x) => x.kind === 'critter' && faceEdgeCut(x, W, H))).length;
}

/** The share of `box` the `boxes` cover (a 20 px grid; layout-checks.mjs coveredShare). */
function coveredShare(box, boxes) {
  const cell = 20;
  let all = 0;
  let hit = 0;
  for (let y = box[1] + cell / 2; y < box[3]; y += cell) {
    for (let x = box[0] + cell / 2; x < box[2]; x += cell) {
      all++;
      if (boxes.some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])) hit++;
    }
  }
  return all ? hit / all : 0;
}

/** How much of thing `id` the critters and entities drawn after it, no farther from the lens, hide
 *  (layout-checks.mjs subjectOcclusionProblems' measure): 0..1. */
export function occludedShare(boxes, id) {
  const list = (boxes ?? []).filter((b) => b.kind === 'entity' || b.kind === 'critter');
  const k = list.findIndex((b) => b.who === id);
  if (k < 0) return 0;
  const sub = list[k];
  const sb = clip(sub.box);
  if (!(area(sb) > 0)) return 0;
  const front = list.slice(k + 1).filter((b) => b.who !== id && !(Number.isFinite(b.depth) && Number.isFinite(sub.depth) && b.depth > sub.depth + 1));
  return front.length ? coveredShare(sb, front.map((b) => b.box)) : 0;
}

/**
 * The camera turned `yaw` degrees around the world point `pivot` (the subject; its target by
 * default) and raised `raise` degrees above it, at the same distance: its target turns with it, so
 * the subject keeps its place in the picture while what stood in front of it slides aside.
 */
export function orbitCamera(cam, yaw = 0, raise = 0, pivot = cam.target) {
  const [px, py, pz] = pivot;
  const turn = (p) => {
    const a = rad(yaw);
    const [dx, dy] = [p[0] - px, p[1] - py];
    return [px + dx * Math.cos(a) - dy * Math.sin(a), py + dx * Math.sin(a) + dy * Math.cos(a), p[2]];
  };
  let pos = turn(cam.pos);
  if (raise) {
    const [dx, dy, dz] = [pos[0] - px, pos[1] - py, pos[2] - pz];
    const r = Math.hypot(dx, dy);
    const d = Math.hypot(r, dz);
    const az = Math.atan2(dy, dx);
    const el = clamp(Math.atan2(dz, r) + rad(raise), rad(-60), rad(75));
    pos = [px + d * Math.cos(el) * Math.cos(az), py + d * Math.cos(el) * Math.sin(az), pz + d * Math.sin(el)];
  }
  return { ...cam, pos, target: turn(cam.target) };
}

/** The camera aimed at world point `at`, which lands on screen point `spot` (the lens centre). */
export function aimCamera(cam, at, spot = [518, 1085]) {
  return { ...cam, target: [...at], cx: spot[0], cy: spot[1] };
}

/** The world point at the centre of a framed box seen by camera `cam` `depth` cm from the lens. */
export function worldPoint(cam, [sx, sy], depth) {
  const P = lens(cam);
  const d = [0, 1, 2].map((k) => P.fwd[k] + (P.right[k] * (sx - P.cx)) / P.focal - (P.up[k] * (sy - P.cy)) / P.focal);
  const n = Math.hypot(...d);
  return P.pos.map((v, k) => v + (d[k] * depth) / n);
}

/** The camera moved along its line of sight to `s` times its distance from its target. */
export function dollyCamera(cam, s) {
  const [tx, ty, tz] = cam.target;
  return { ...cam, pos: [tx + (cam.pos[0] - tx) * s, ty + (cam.pos[1] - ty) * s, tz + (cam.pos[2] - tz) * s] };
}

/** The camera with its picture slid (dx, dy) px (the lens centre moved: the angle stays). */
export function shiftCamera(cam, dx, dy) {
  if (!dx && !dy) return cam;
  return { ...cam, cx: (cam.cx ?? (cam.w ?? W) / 2) + dx, cy: (cam.cy ?? (cam.h ?? H) / 2) + dy };
}

/**
 * The framing fix for a shot whose subject has the screen boxes `boxes` (one per probe, null where
 * absent), or null when it is already whole inside the safe area at its kind's share: { zoom, dx,
 * dy }, zoom > 1 to dolly in, < 1 to back off, about `centre` (where the camera's target lands).
 */
export function framePlan(boxes, kind, { centre = [W / 2, H / 2], safe = SAFE, margin = 10, slack = 2, contain = false } = {}) {
  const bs = (boxes ?? []).filter(Boolean);
  if (!bs.length) return null;
  const X0 = safe.x0 + margin;
  const X1 = safe.x1 - margin;
  const Y0 = safe.y0 + margin;
  const Y1 = safe.y1 - margin;
  const min = SHARE_MIN[kind] ?? SHARE_MIN.medium;
  const over = Math.max(...bs.map((b) => Math.max((b[2] - b[0]) / (X1 - X0), (b[3] - b[1]) / (Y1 - Y0))));
  const share = area(bs[0]) / AREA;
  const outside = bs.some((b) => b[0] < safe.x0 - slack || b[2] > safe.x1 + slack || b[1] < safe.y0 - slack || b[3] > safe.y1 + slack);
  // `contain` (a shot that opted out of the fit): only a subject over the safe area's edge is moved
  const small = !contain && share < min;
  if (!outside && !small && over <= 1) return null;
  let zoom = 1;
  if (over > 1) zoom = 0.97 / over;
  else if (small && share > 0) zoom = Math.min(Math.sqrt((min * 1.3) / share), 0.97 / over, 2);
  // the boxes after the dolly (about the target's spot), then the slide that puts them all inside
  const [cx, cy] = centre;
  const scaled = bs.map((b) => [cx + (b[0] - cx) * zoom, cy + (b[1] - cy) * zoom, cx + (b[2] - cx) * zoom, cy + (b[3] - cy) * zoom]);
  const slide = (lo, hi) => (lo <= hi ? clamp(0, lo, hi) : (lo + hi) / 2);
  const dx = clamp(slide(Math.max(...scaled.map((b) => X0 - b[0])), Math.min(...scaled.map((b) => X1 - b[2]))), -MAX_SHIFT, MAX_SHIFT);
  const dy = clamp(slide(Math.max(...scaled.map((b) => Y0 - b[1])), Math.min(...scaled.map((b) => Y1 - b[3]))), -MAX_SHIFT, MAX_SHIFT);
  if (Math.abs(zoom - 1) < 0.01 && Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;
  return { zoom, dx: Math.round(dx), dy: Math.round(dy) };
}

/**
 * The pop-in fix after one cut, from what is on screen (sets of ids) at probe times `xs` (s after the
 * cut, ascending): 0 when nothing appears within POP_IN of the cut, else the least shift δ (≤
 * MAX_POP_SHIFT) such that from δ on nothing new appears within POP_IN, or null when none does.
 */
export function popInShift(xs, seen) {
  const okFrom = (k0) => xs.every((x, k) => x < xs[k0] - 1e-9 || x >= xs[k0] + POP_IN - 1e-9 || [...seen[k]].every((w) => seen[k0].has(w)));
  if (okFrom(0)) return 0;
  for (let k0 = 1; k0 < xs.length && xs[k0] <= MAX_POP_SHIFT + 1e-9; k0++) {
    if (xs[k0] + POP_IN > xs[xs.length - 1] + 0.051) break;
    if (okFrom(k0)) return xs[k0];
  }
  return null;
}

/** The time a warped shot draws at frame time t: held `delta` ahead for POP_IN after the cut, then
 *  easing back onto the voice's clock over `span` seconds. */
export function warpTime(t, w) {
  if (!w) return t;
  const x = t - w.cut;
  if (x < 0) return t;
  if (x < POP_IN) return t + w.delta;
  if (x < POP_IN + w.span) return t + w.delta * (1 - (x - POP_IN) / w.span);
  return t;
}

/** The probe times of a shot [at, end): from 0.2 s in to its end, at most every 0.3 s (≤ 8). */
function probeTimes(at, end) {
  const a = at + Math.min(0.2, (end - at) / 3);
  const b = Math.max(a, end - 0.06);
  const n = clamp(Math.ceil((b - a) / 0.3) + 1, 1, 8);
  return Array.from({ length: n }, (_, k) => (n === 1 ? a : a + ((b - a) * k) / (n - 1)));
}

/**
 * The frame module's default export (`{ ground, shots, draw(t) }`) with the first-try fixes applied
 * (see the top of this file); a scene without a camera shot list comes back as it is. `world`:
 * world.js's exports (its DRESSING is drawn in every camera shot); `duration`: the frame's length.
 * The result's `fits()` says what was changed: { cameras: { shot: camera }, popIn: { shot: s } }.
 */
export function prepareScene(scene, { world = null, duration = null } = {}) {
  if (world) useWorld(world);
  if (!scene || typeof scene.draw !== 'function' || scene[PREPARED]) return scene;
  const shots = Array.isArray(scene.shots) && scene.shots.length ? scene.shots : null;
  if (!shots) return scene;
  const raw = (...a) => scene.draw(...a);
  const endOf = (list, i) => list[i + 1]?.at ?? (duration > (list[i].at ?? 0) ? duration : (list[i].at ?? 0) + 2);
  // a draw while fitting: the paint log (try.mjs) and the tried camera are the probe's only
  const probe = (t, i, camera) => {
    const log = globalThis.__hxPaintLog;
    globalThis.__hxPaintLog = undefined;
    const prev = setProbeCamera(camera ? { shots, i, camera } : null);
    try {
      return String(raw(t));
    } catch {
      return null;
    } finally {
      setProbeCamera(prev);
      globalThis.__hxPaintLog = log;
    }
  };
  const cameras = {};
  const pops = {};
  const fitted = new Set();
  const fitShot = (i) => {
    if (fitted.has(i)) return;
    fitted.add(i);
    const list = snapCuts(shots);
    const shot = list[i];
    const id = subjectOf(shot);
    if (!isCameraShot(shot) || !id) return;
    // an opt-out keeps the builder's angle and size, never a cut subject (2026-11-24, jobs 87/88: three
    // `fit: false` inserts left the calculator and the cheat sheet cut by the frame edge): `fit: false`
    // and `fit: { frame: false }` still back off or slide so the subject is whole in the safe area
    const fit = shot.fit === false ? { orbit: false, frame: false } : typeof shot.fit === 'object' && shot.fit ? shot.fit : {};
    const opts = { ...fit, contain: fit.frame === false };
    const times = probeTimes(shot.at ?? 0, endOf(list, i));
    const look = (cam) => times.map((t) => {
      const svg = probe(t, i, cam);
      return svg ? framedBoxes(svg) : null;
    });
    let cam = shot.camera;
    let rows = look(cam);
    const has = rows.map((b) => !!(b && subjectBox(b, id)));
    if (!has.some(Boolean)) return;
    // the subject's world point, from its box and depth as camera `c` sees it (else c's target)
    const pivotOf = (c, rs) => {
      for (const b of rs) {
        const mine = (b ?? []).filter((x) => x.who === id);
        const box = mine.length ? subjectBox(mine, id) : null;
        const depth = mine.find((x) => Number.isFinite(x.depth))?.depth;
        if (box && depth > 0) return worldPoint(c, [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], depth);
      }
      return c.target;
    };
    // hidden: the worst probe; an angle that loses the subject where it was seen is no answer
    const hidden = (rs) => Math.max(0, ...rs.map((b, k) => (!has[k] ? 0 : b && subjectBox(b, id) && area(clip(subjectBox(b, id))) > 0 ? occludedShare(b, id) : 1)));
    const unblock = (base) => {
      let best = { cam: base, rows, o: hidden(rows) };
      if (best.o <= OCCLUDED_OK) return;
      const pivot = pivotOf(base, rows);
      for (const [yaw, raise] of ORBITS) {
        const c = orbitCamera(base, yaw, raise, pivot);
        const r = look(c);
        const o = hidden(r);
        if (o < best.o - 0.05) best = { cam: c, rows: r, o };
        if (o <= OCCLUDED_OK) break;
      }
      ({ cam, rows } = best);
    };
    const frame = (passes, aim) => {
      for (let pass = 0; pass < passes; pass++) {
        const plan = framePlan(rows.map((b) => (b ? subjectBox(b, id) : null)), shot.kind, { centre: [cam.cx ?? W / 2, cam.cy ?? H / 2], contain: opts.contain });
        if (!plan) return;
        const resize = Math.abs(plan.zoom - 1) >= 0.01;
        if (aim && pass === 0 && (resize || Math.abs(plan.dx) >= MAX_SHIFT || Math.abs(plan.dy) >= MAX_SHIFT)) {
          // a size change or a long slide: aim at the subject, put it mid safe area, dolly about it
          const at = pivotOf(cam, rows);
          cam = aimCamera(cam, at);
          if (resize) cam = dollyCamera(cam, Math.max(1 / plan.zoom, 40 / Math.max(1, Math.hypot(...cam.pos.map((v, k) => v - at[k])))));
        } else cam = shiftCamera(resize ? dollyCamera(cam, 1 / plan.zoom) : cam, plan.dx, plan.dy);
        rows = look(cam);
      }
    };
    // unblock, then frame; a reframe that walks back into a blocker turns once more around the
    // subject and only slides the picture after
    if (opts.orbit !== false) unblock(cam);
    frame(3, !opts.contain);
    if (opts.orbit !== false && hidden(rows) > OCCLUDED_OK) {
      unblock(cam);
      frame(2, false);
    }
    // a fix never cuts a face the builder's camera did not cut: slide on (either way) until the
    // subject stays whole and no face is cut by the frame's edge, else keep the fix as it is
    if (cam !== shot.camera && cutCritters(rows) > cutCritters(look(shot.camera))) {
      const tries = [];
      for (const k of [1, 1.15, 1.3]) for (let s = 60; s <= MAX_SHIFT + 60; s += 60) tries.push([k, s], [k, -s]);
      const fine = (c, r) => !cutCritters(r) && !framePlan(r.map((b) => (b ? subjectBox(b, id) : null)), shot.kind, { centre: [c.cx ?? W / 2, c.cy ?? H / 2], contain: true });
      let found = false;
      for (const [k, s] of tries) {
        const c = shiftCamera(k === 1 ? cam : dollyCamera(cam, 1 / k), s, 0);
        const r = look(c);
        if (!fine(c, r)) continue;
        ({ cam, rows } = { cam: c, rows: r });
        found = true;
        break;
      }
      // no slide does it: turn around the subject (the orbits), contain it again, and look once more
      if (!found) {
        const pivot = pivotOf(cam, rows);
        for (const [yaw, raise] of ORBITS) {
          let c = orbitCamera(cam, yaw, raise, pivot);
          let r = look(c);
          const plan = framePlan(r.map((b) => (b ? subjectBox(b, id) : null)), shot.kind, { centre: [c.cx ?? W / 2, c.cy ?? H / 2], contain: true });
          if (plan) {
            c = shiftCamera(Math.abs(plan.zoom - 1) >= 0.01 ? dollyCamera(c, 1 / plan.zoom) : c, plan.dx, plan.dy);
            r = look(c);
          }
          if (!fine(c, r)) continue;
          ({ cam, rows } = { cam: c, rows: r });
          break;
        }
      }
    }
    if (cam !== shot.camera) {
      setShotCamera(shots, i, cam);
      cameras[i + 1] = cam;
    }
  };
  const whoOf = (svg) => new Set((svg ? framedBoxes(svg) ?? [] : []).filter((b) => (b.kind === 'entity' || b.kind === 'critter') && b.who && area(clip(b.box)) > 0).map((b) => b.who));
  const warps = new Map();
  const warpOf = (i) => {
    if (warps.has(i)) return warps.get(i);
    warps.set(i, null);
    const shot = shots[i];
    const cut = Number(shot?.at);
    if (i < 1 || shot?.popIn === false || !Number.isFinite(cut)) return null;
    const len = endOf(shots, i) - cut;
    // the common case first: nothing new in the first POP_IN
    const quick = [0, 0.1, 0.2, 0.28].filter((x) => x < len);
    const seenQ = quick.map((x) => whoOf(probe(cut + x, i, null)));
    if (popInShift(quick, seenQ) === 0) return null;
    const xs = [];
    for (let x = 0; x <= Math.min(MAX_POP_SHIFT + POP_IN, len - 0.1) + 1e-9; x += 0.05) xs.push(Math.round(x * 100) / 100);
    const delta = popInShift(xs, xs.map((x) => whoOf(probe(cut + x, i, null))));
    const span = Math.min(1, len - POP_IN - 0.05);
    const w = delta > 0 && span >= 2 * delta ? { cut, delta, span } : null;
    if (w) pops[i + 1] = delta;
    warps.set(i, w);
    return w;
  };
  const draw = (t, ...rest) => {
    if (typeof t !== 'number') return raw(t, ...rest);
    const { i } = shotAt(t, shots);
    fitShot(i);
    return raw(warpTime(t, warpOf(i)), ...rest);
  };
  return { ...scene, draw, fits: () => ({ cameras: { ...cameras }, popIn: { ...pops } }), [PREPARED]: true };
}
