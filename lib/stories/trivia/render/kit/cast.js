// The Explainers world kit, cast (hx-5, visual system 5 "D"): critters, the cast of every reel.
// Every character is a critter: never a person, a figure built from solids, or a body part. When an
// analogy has someone doing something, a critter does it. The critter is critter D (its source of
// truth is reference/critter-d/critter_d.py, variant "d", pupil style "plain"): a flat rounded tile
// on two ink legs, two big eyes with lids, chubby ink arms. No mouth, no brows, no outline (a white
// body keeps a thin ink edge), no gloss, no catch-lights, no outfit. Personality comes from the
// lids, the pupils, the tilt and the arm pose (MOODS), and from motion (motion.js).
//
//   critter(x, y, o)       draw one, feet at (x, y); options below
//   critterShadow(x, y, o) its ground shadow: a separate layer the stage keeps on the floor
//   critterTile(o)         the drawing in its own 200-unit tile (feet at y 192), for sheets and tests
//   critterBox(x, y, o)    its screen box; critterFace(x, y, o) its eyes and face centre on screen
//   handAt(x, y, o)        where its hands are on screen; gripAt / heldBoxes  what a hand holds
//   MOODS, ARM_POSES, STATES, BODIES   the closed lists
//   wear (wear.js)         a role's head piece, hand prop and bow tie: role, head, hand, bowtie
//   FACE_KEEPOUT           the eye zone and the strip under it, where nothing worn may sit
//   heldScale(cm, px)      the scale for a prop of a real size beside a critter

import { TOKENS, CRITTER_CM as CORE_CM, CRITTER_PX as CORE_PX, propScale, mixHex } from './core.js';
import { wear as resolveWear, headSvg, bowtieSvg, heldPropSvg, heldPropBox, HAND_POSE } from './wear.js';

// ── The critter's palette (VISUAL_SYSTEM_5 §2 and §5) ─────────────────────────────────────
// The critter's colours are the reference drawings' own (byte-identical to them; the reference test
// holds that).
/** Ink: lines, legs, arms, pupils. */
export const INK = TOKENS.ink;
/** White: eye whites, the white body. */
export const WHITE = TOKENS.white;
/** The eye whites of a white critter (a light grey, E5E5E5: white mixed with ink), so they read on its body. */
export const GREY = mixHex(TOKENS.white, TOKENS.ink, 0.218);
/** The bodies a critter may have: orange (the hero, one per frame), green, ink, white. */
export const BODY_COLORS = { orange: TOKENS.orange, green: TOKENS.green, ink: INK, white: WHITE };
export const BODIES = Object.keys(BODY_COLORS);
/** A body's colour; an unknown body throws with the list. */
export function bodyOf(body = 'ink') {
  const c = BODY_COLORS[body];
  if (!c) throw new Error(`HX: critter body "${body}" must be one of ${BODIES.join(', ')} (orange is the hero's only)`);
  return c;
}

// ── Scale ─────────────────────────────────────────────────────────────────────────────────
/** A critter's real height in cm: the ruler every world size is measured against. */
export const CRITTER_CM = CORE_CM ?? 72;
/** A critter's drawn height at s = 1 in px, feet to the top of its body. */
export const CRITTER_PX = CORE_PX ?? 152;
/** Pixels per cm next to a scale-1 critter. */
export const PX_PER_CM = CRITTER_PX / CRITTER_CM;
/** The tile: 200 units square; the feet at y 192, the top of the body at y 40. */
export const TILE = { size: 200, feet: 192, top: 40, cx: 100 };
/** Screen px per tile unit at scale s. */
export const tileScale = (s = 1) => (CRITTER_PX / (TILE.feet - TILE.top)) * s;
/**
 * The scale for a held prop of real size `propCm`: apply it to a prop drawing that is `drawnPx`
 * tall at scale 1 (default: a drawing as tall as a critter), then multiply by the critter's own s.
 * `cheat` ('cheat' or a number) draws it bigger so the action reads (core.js propScale).
 * @param {number} propCm
 * @param {number} [drawnPx]
 * @param {'cheat' | number} [cheat]
 */
export function heldScale(propCm, drawnPx = CRITTER_PX, cheat = undefined) {
  if (!(propCm > 0) || !(drawnPx > 0)) throw new Error('HX: heldScale(propCm, drawnPx) needs positive sizes');
  return ((propCm * PX_PER_CM) / drawnPx) * propScale(cheat, propCm);
}

// ── Number format: Python's f"{x:.1f}" with trailing zeros dropped (the reference's f()) ──
/** A number as the reference writes it: one decimal (round half to even on the exact value),
 *  trailing zeros and point dropped. */
export function f(x) {
  const ax = Math.abs(x);
  let s;
  if (Number.isInteger(ax * 4) && !Number.isInteger(ax * 2)) {
    // an exact tie at the second decimal (x.25, x.75): Python rounds half to even
    const fl = Math.floor(ax * 10);
    const n = fl % 2 === 0 ? fl : fl + 1;
    s = (n / 10).toFixed(1);
  } else s = ax.toFixed(1);
  if (x < 0 || Object.is(x, -0)) s = `-${s}`;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

// ── Moods and poses (critter_d.py M and ARM) ──────────────────────────────────────────────
/**
 * The ten moods. Each fixes the pupils' offset `p`, the lids `lid` [outer, inner] (0 open … 1
 * shut), happy crescents `cr`, the eyes' scale `es` [left, right], the body's `tilt` (degrees), the
 * arm pose `arms` [left, right] and `small` pupils.
 */
export const MOODS = {
  neutral: { p: [0, 0], lid: [0.06, 0.06], cr: false, es: [1, 1], tilt: 0, arms: ['down', 'down'] },
  happy: { p: [0, -2], lid: [0, 0], cr: true, es: [1, 1], tilt: 0, arms: ['up', 'up'] },
  curious: { p: [6, -6], lid: [0, 0], cr: false, es: [0.92, 1.14], tilt: -7, arms: ['down', 'point'] },
  focused: { p: [0, 3], lid: [0.38, 0.38], cr: false, es: [1, 1], tilt: 0, arms: ['down', 'chin'], small: true },
  surprised: { p: [0, 0], lid: [0, 0], cr: false, es: [1.16, 1.16], tilt: 0, arms: ['shrug', 'shrug'], small: true },
  sly: { p: [8, 2], lid: [0.5, 0.42], cr: false, es: [1, 1], tilt: 4, arms: ['hips', 'chin'] },
  worried: { p: [-1, 5], lid: [0.42, 0.04], cr: false, es: [1, 1], tilt: 0, arms: ['cheek', 'cheek'] },
  angry: { p: [0, 4], lid: [0.08, 0.55], cr: false, es: [1, 1], tilt: 0, arms: ['fist', 'fist'] },
  proud: { p: [0, -3], lid: [0.34, 0.34], cr: true, es: [1, 1], tilt: -3, arms: ['hips', 'hips'] },
  sleepy: { p: [0, 6], lid: [0.64, 0.64], cr: false, es: [1, 1], tilt: 2, arms: ['droop', 'droop'] },
};
export const MOOD_NAMES = Object.keys(MOODS);
/** The arm poses: the left arm's path [shoulder, control, hand] in tile units; the right arm
 *  mirrors it (x → 200 − x). An `arms` option overrides the mood's pose. */
export const ARM_POSES = {
  down: [[33, 116], [19, 134], [23, 152]],
  up: [[35, 104], [15, 86], [20, 60]],
  hips: [[33, 110], [6, 126], [31, 150]],
  cheek: [[34, 120], [20, 104], [44, 90]],
  point: [[33, 112], [16, 104], [4, 86]],
  fist: [[33, 114], [24, 128], [15, 144]],
  chin: [[34, 122], [50, 166], [80, 148]],
  shrug: [[33, 110], [14, 112], [10, 90]],
  droop: [[33, 120], [28, 142], [31, 160]],
  wave: [[35, 104], [15, 86], [20, 60]],
};
/**
 * The animation states (the reference's state rigs): each sets the arms and the class hooks
 * motion.js drives (`look` on the pupils, `blink` on the eyes, `bob` on the body, `wave` on a
 * waving arm, `step-l`/`step-r` on the legs), and the mood it usually goes with.
 */
export const STATES = {
  idle: { mood: 'neutral', look: 'look', bob: 'bob', arms: null },
  think: { mood: 'neutral', look: 'think', bob: 'bob', arms: ['down', 'chin'] },
  work: { mood: 'focused', look: 'scan', bob: 'bob-fast', arms: ['down', 'down'], steps: true },
  wait: { mood: 'surprised', look: 'waitlook', bob: 'hop', arms: ['down', 'wave'] },
  done: { mood: 'happy', look: '', bob: 'bounce', arms: ['up', 'up'], noBlink: true },
};
const EYES = [[74, 96, -1], [126, 96, 1]];
const RX = 20;
const RY = 24;

const cls = (c) => (c ? ` class="${c}"` : '');

/** One eye (critter_d.py eye(), pupil style plain): the white, the pupil, the lids, a crescent. */
function eye(cx, cy, side, m, color, s, blink, look, eyew, gaze) {
  const o = [`<g${cls(blink?.cls)}${blink?.tf ? ` transform="${blink.tf(cx, cy)}"` : ''}>`];
  const [px, py] = m.p;
  const rx = RX * s;
  const ry = RY * s;
  const k = m.small ? 0.7 : 1;
  const r = 11.5 * s * k;
  const qx = px * 0.8;
  const qy = py * 0.8;
  o.push(`<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${eyew}"></ellipse>`);
  const gz = gaze ? ` transform="translate(${f(gaze[0])} ${f(gaze[1])})"` : '';
  o.push(`<g${cls(look)}${gz}><circle cx="${f(cx + qx)}" cy="${f(cy + qy)}" r="${f(r)}" fill="${INK}"></circle></g>`);
  const [lo, li] = m.lid;
  if (lo > 0 || li > 0) {
    const y0 = cy - ry - 3;
    const H = 2 * ry + 6;
    const yo = y0 + lo * H;
    const yi = y0 + li * H;
    const xl = cx - rx - 4;
    const xr = cx + rx + 4;
    const [yl, yr] = side < 0 ? [yo, yi] : [yi, yo];
    o.push(`<polygon points="${f(xl)},${f(y0 - 2)} ${f(xr)},${f(y0 - 2)} ${f(xr)},${f(yr)} ${f(xl)},${f(yl)}" fill="${color}"></polygon>`);
  }
  if (m.cr) o.push(`<ellipse cx="${f(cx)}" cy="${f(cy + ry * 1.05)}" rx="${f(rx * 1.45)}" ry="${f(ry * 0.82)}" fill="${color}"></ellipse>`);
  o.push('</g>');
  return o.join('');
}

/** One chubby arm (critter_d.py arm(), variant d): side −1 left, +1 right. */
function arm(pose, side, c = '', extra = '') {
  let pts = ARM_POSES[pose];
  if (side > 0) pts = pts.map(([x, y]) => [200 - x, y]);
  const [a0, b0] = pts[0];
  pts = pts.map(([x, y]) => [a0 + (x - a0) * 0.82, b0 + (y - b0) * 0.82]);
  const [[a, b], [cx, cy], [e, gg]] = pts;
  return `<g${cls(c)}${extra}><path d="M${f(a)} ${f(b)} Q${f(cx)} ${f(cy)} ${f(e)} ${f(gg)}" fill="none" stroke="${INK}" stroke-width="20" stroke-linecap="round"></path>`
    + `<circle cx="${f(e)}" cy="${f(gg)}" r="12" fill="${INK}"></circle></g>`;
}

function check(name, value, list) {
  if (!(value in list)) throw new Error(`HX: critter ${name} "${value}" must be one of ${Object.keys(list).join(', ')}`);
}

/** The arm pose whose hand lands nearest a hand target [x, y] relative to the feet at s 1 (older
 *  scenes aimed hands at points); `fallback` when there is no target. */
function nearestPose(target, side, fallback) {
  if (!Array.isArray(target)) return fallback;
  const k = tileScale(1);
  const tx = TILE.cx + target[0] / k;
  const ty = TILE.feet + target[1] / k;
  let best = fallback;
  let bd = Infinity;
  for (const [name, P] of Object.entries(ARM_POSES)) {
    const pts = side > 0 ? P.map(([x, y]) => [200 - x, y]) : P;
    const hx = pts[0][0] + (pts[2][0] - pts[0][0]) * 0.82;
    const hy = pts[0][1] + (pts[2][1] - pts[0][1]) * 0.82;
    const d = Math.hypot(hx - tx, hy - ty);
    if (d < bd) [bd, best] = [d, name];
  }
  return best;
}

/** A mood resolved with the options: { m (the mood's data), mood, arms [l, r], state }. */
function resolvePose(o = {}) {
  const st = o.state ?? null;
  if (st !== null) check('state', st, STATES);
  const S = st ? STATES[st] : null;
  const mood = o.mood ?? S?.mood ?? 'neutral';
  check('mood', mood, MOODS);
  const m = MOODS[mood];
  let arms = [...m.arms];
  if (S?.arms) arms = [...S.arms];
  if (o.arms != null) {
    const a = Array.isArray(o.arms) ? o.arms : typeof o.arms === 'object' ? [nearestPose(o.arms.l, -1, arms[0]), nearestPose(o.arms.r, 1, arms[1])] : [o.arms, o.arms];
    a.forEach((p) => check('arm pose', p, ARM_POSES));
    arms = [a[0], a[1]];
  }
  return { m, mood, arms, state: st, S };
}

/**
 * The critter in its own 200-unit tile (feet at y 192, body top at y 40), without its shadow:
 * exactly critter_d.py's drawing for the same mood and body (empty class attributes left out).
 * Options as critter(); `tilt` adds to the mood's tilt. `_overlay` is drawn where the reference
 * draws its accessory (sheets and tests only).
 */
export function critterTile(o = {}) {
  const body = o.body ?? 'ink';
  const color = bodyOf(body);
  const { m, arms, S } = resolvePose(o);
  const W = resolveWear(o);
  if (W.hand) arms[1] = o.handPose ?? HAND_POSE[W.hand];
  const anim = !!S || !!o.anim;
  const look = anim ? (S ? S.look : 'look') : '';
  const blinkCls = anim && !S?.noBlink ? 'blink' : '';
  const bob = anim ? (S ? S.bob : 'bob') : '';
  const steps = anim && S?.steps;
  // a blink driven by the frame clock: the eye group squashed about its centre (1 open … 0 shut)
  const bk = typeof o.blink === 'number' && o.blink > 0 ? Math.max(0.08, 1 - o.blink) : null;
  const blink = { cls: blinkCls, tf: bk === null ? null : (cx, cy) => `translate(0 ${f(cy)}) scale(1 ${bk.toFixed(3)}) translate(0 ${f(-cy)})` };
  // the gaze: look [x, y] in −1..1 moves the pupils (the reference's glance travels ±6 units)
  const gaze = Array.isArray(o.look) && (o.look[0] || o.look[1]) ? [o.look[0] * 6, o.look[1] * 5] : null;
  const eyew = color === WHITE ? GREY : WHITE;
  const edge = color === WHITE ? ` stroke="${INK}" stroke-width="3"` : '';
  const tilt = m.tilt + (Number(o.tilt) || 0);
  const out = [`<g${cls(bob)}><g transform="rotate(${Number.isInteger(tilt) ? tilt : f(tilt)} 100 110)">`];
  out.push(`<rect${cls(steps ? 'step-l' : '')} x="68" y="158" width="20" height="32" rx="10" fill="${INK}"></rect><rect${cls(steps ? 'step-r' : '')} x="112" y="158" width="20" height="32" rx="10" fill="${INK}"></rect>`);
  out.push(`<rect x="26" y="40" width="148" height="136" rx="46" fill="${color}"${edge}></rect>`);
  EYES.forEach(([cx, cy, side], i) => out.push(eye(cx, cy, side, m, color, m.es[i], blink, look, eyew, gaze)));
  if (W.bowtie) out.push(bowtieSvg(body));
  out.push(arm(arms[0], -1));
  const wave = arms[1] === 'wave' && !W.hand;
  const waveTf = wave && Number(o.wave) ? ` transform="rotate(${f(-Number(o.wave))} 165 104)"` : '';
  out.push(arm(arms[1], 1, wave ? 'wave' : '', waveTf));
  if (W.hand) out.push(heldPropSvg(W.hand, body, arms[1]));
  if (o._overlay) out.push(o._overlay);
  if (W.head) out.push(headSvg(W.head, body, W.headTone));
  out.push('</g></g>');
  return out.join('');
}

/** A motion pose { r, x, y, sx, sy } (motion.js) about the feet, as a tile transform. */
function poseTf(pose) {
  if (!pose) return '';
  const { r = 0, x = 0, y = 0, sx = 1, sy = 1 } = pose;
  if (!r && !x && !y && sx === 1 && sy === 1) return '';
  return `translate(${(100 + x).toFixed(2)} ${(190 + y).toFixed(2)}) rotate(${r.toFixed(2)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(-100 -190)`;
}

/**
 * A critter, feet at (x, y). VISUAL_SYSTEM_5 §5.
 *   body:   'orange' (the hero, one per frame), 'green', 'ink', 'white' (BODIES; default ink)
 *   mood:   a MOODS name (default neutral): lids, pupils, tilt and an arm pose
 *   arms:   an ARM_POSES name (or [left, right]) overriding the mood's pose; { l, r } hand targets
 *           (relative to the feet at s 1) take the pose whose hand lands nearest
 *   role:   a wear.js ROLES name, or head / hand / bowtie / headTone directly (`hand: null` puts the
 *           role's prop down for this beat). A held prop takes the right hand's pose
 *   state:  an animation state (STATES: idle, think, work, wait, done): its arms and the class
 *           hooks motion.js drives
 *   flip:   face left; s: scale (s 1 = CRITTER_PX tall); tilt: extra degrees
 *   pose:   a motion.js pose { r, x, y, sx, sy } about the feet (the body moves; its shadow does not)
 *   look:   [x, y] in −1..1, where the pupils glance; blink: 0..1 (1 = shut); wave: degrees
 *   who:    the critter's world id, written as data-who (and its look as data-look) for the checks
 * The shadow is NOT part of the critter: draw critterShadow() under it, on the floor.
 * Unknown body, mood, arm pose, state, role or piece names throw with the lists.
 * @param {number} x
 * @param {number} y
 * @param {Record<string, any>} [o]
 */
export function critter(x, y, o = {}) {
  const k = tileScale(o.s ?? 1);
  const x0 = x - TILE.cx * k;
  const y0 = y - TILE.feet * k;
  let tile = critterTile(o);
  const ptf = poseTf(o.pose);
  if (ptf) tile = `<g transform="${ptf}">${tile}</g>`;
  const tf = `translate(${x0.toFixed(2)} ${y0.toFixed(2)}) scale(${k.toFixed(4)})${o.flip ? ' translate(200 0) scale(-1 1)' : ''}`;
  const tag = [];
  if (o.who) tag.push(`data-who="${String(o.who).replace(/"/g, '&quot;')}"`, `data-look="${lookKey(o)}"`);
  tag.push(`data-critter="${o.body ?? 'ink'}"`);
  return `<g ${tag.join(' ')} transform="${tf}">${tile}</g>`;
}

/**
 * A critter's ground shadow, centred under its feet at (x, y): one soft ink ellipse (ink at 10%).
 * It stays on the floor: given the critter's motion `pose`, it never tilts, shrinks and fades as the
 * body lifts, spreads on a squash and drifts a little with sideways moves (motion.js shadowAt).
 */
export function critterShadow(x, y, { s = 1, pose = null, flip = false } = {}) {
  const k = tileScale(s);
  let dx = 0;
  let sx = 1;
  let op = 1;
  if (pose) {
    const lift = Math.max(0, -(pose.y ?? 0));
    sx = (1 + ((pose.sx ?? 1) - 1) * 0.9) * (1 - lift / 150);
    op = Math.max(0.35, 1 - lift / 110);
    dx = (pose.x ?? 0) * 0.7 * (flip ? -1 : 1);
  }
  return `<ellipse data-shadow="critter" cx="${(x + dx * k).toFixed(2)}" cy="${y.toFixed(2)}" rx="${(58 * k * sx).toFixed(2)}" ry="${(7 * k).toFixed(2)}" fill="${INK}" fill-opacity="${(0.1 * op).toFixed(3)}"></ellipse>`;
}

/** Tile point → screen, for the same (x, y, options) as critter() (tilt and pose included). */
function tileToScreen(x, y, o = {}) {
  const k = tileScale(o.s ?? 1);
  const { m } = resolvePose(o);
  const tilt = ((m.tilt + (Number(o.tilt) || 0)) * Math.PI) / 180;
  const p = o.pose ?? {};
  const pr = ((p.r ?? 0) * Math.PI) / 180;
  return ([tx, ty]) => {
    // the mood's tilt about (100, 110)
    let u = 100 + (tx - 100) * Math.cos(tilt) - (ty - 110) * Math.sin(tilt);
    let v = 110 + (tx - 100) * Math.sin(tilt) + (ty - 110) * Math.cos(tilt);
    // the motion pose about the feet (100, 190)
    const ax = (u - 100) * (p.sx ?? 1);
    const ay = (v - 190) * (p.sy ?? 1);
    u = 100 + (p.x ?? 0) + ax * Math.cos(pr) - ay * Math.sin(pr);
    v = 190 + (p.y ?? 0) + ax * Math.sin(pr) + ay * Math.cos(pr);
    if (o.flip) u = 200 - u;
    return [x + (u - TILE.cx) * k, y + (v - TILE.feet) * k];
  };
}

/** The critter's hand points on screen, for the same (x, y, options) as critter(): { l, r } (the
 *  tile's left and right arm; a flip swaps their screen sides). */
export function handAt(x, y, o = {}) {
  const { arms } = resolvePose(o);
  const W = resolveWear(o);
  if (W.hand) arms[1] = o.handPose ?? HAND_POSE[W.hand];
  const at = tileToScreen(x, y, o);
  const hand = (pose, side) => {
    let pts = ARM_POSES[pose];
    if (side > 0) pts = pts.map(([px, py]) => [200 - px, py]);
    const [a0, b0] = pts[0];
    const [hx, hy] = pts[2];
    return at([a0 + (hx - a0) * 0.82, b0 + (hy - b0) * 0.82]);
  };
  return { l: hand(arms[0], -1), r: hand(arms[1], 1) };
}

/** The held prop's grip on screen: where the right hand is, the screen angle, the critter's scale
 *  and mirror (−1 when flipped). `side` other than 'r' gives that hand with no prop. */
export function gripAt(x, y, o = {}, side = 'r') {
  const h = handAt(x, y, o);
  const [px, py] = side === 'l' ? h.l : h.r;
  return { x: px, y: py, angle: (MOODS[o.mood ?? 'neutral']?.tilt ?? 0) + (Number(o.tilt) || 0), scale: o.s ?? 1, mirror: o.flip ? -1 : 1 };
}

/** The screen box of the held hand prop, if any: { r?: { box, at, kind } }, so a shot can take it
 *  as a subject or a label can sit on it. */
export function heldBoxes(x, y, o = {}) {
  const W = resolveWear(o);
  if (!W.hand) return {};
  const { arms } = resolvePose(o);
  const pose = o.handPose ?? HAND_POSE[W.hand] ?? arms[1];
  const [bx0, by0, bx1, by1] = heldPropBox(W.hand, pose);
  const at = tileToScreen(x, y, o);
  const pts = [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]].map(at);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  return { r: { box, at: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], kind: W.hand } };
}

/** A critter's screen box [x0, y0, x1, y1]: the body and arms (head pieces and held props
 *  included when it wears them), for the same (x, y, options) as critter(). */
export function critterBox(x, y, o = {}) {
  const k = tileScale(o.s ?? 1);
  const W = (() => { try { return resolveWear(o); } catch { return {}; } })();
  const top = W.head ? 6 : 34;
  const h = handAt(x, y, o);
  const xs = [x - 92 * k, x + 92 * k, h.l[0] - 12 * k, h.l[0] + 12 * k, h.r[0] - 12 * k, h.r[0] + 12 * k];
  const ys = [y - (TILE.feet - top) * k, y, h.l[1] - 12 * k, h.r[1] - 12 * k];
  const held = heldBoxes(x, y, o).r;
  if (held) xs.push(held.box[0], held.box[2]), ys.push(held.box[1], held.box[3]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The eyes and the face centre on screen (s and flip applied; tilt ignored). */
export function critterFace(x, y, { s = 1, flip = false } = {}) {
  const k = tileScale(s);
  const L = flip ? -1 : 1;
  return { face: [x, y - (TILE.feet - 96) * k], eyes: [[x - 26 * k * L, y - (TILE.feet - 96) * k], [x + 26 * k * L, y - (TILE.feet - 96) * k]], r: 24 * k };
}

// ── The body and the face zones, relative to the feet at scale 1 (screen px) ───────────────
const K1 = tileScale(1);
const lx = (t) => +((t - TILE.cx) * K1).toFixed(2);
const ly = (t) => +((t - TILE.feet) * K1).toFixed(2);
/** The body outline relative to the feet at s 1 (the tile's rounded rect), as a path. */
export const BODY_D = (() => {
  const [x0, y0, x1, y1, r] = [lx(26), ly(40), lx(174), ly(176), +(46 * K1).toFixed(2)];
  return `M ${x0 + r} ${y0} H ${x1 - r} A ${r} ${r} 0 0 1 ${x1} ${y0 + r} V ${y1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} H ${x0 + r} A ${r} ${r} 0 0 1 ${x0} ${y1 - r} V ${y0 + r} A ${r} ${r} 0 0 1 ${x0 + r} ${y0} Z`;
})();
/**
 * Where nothing worn may sit, relative to the feet at scale 1: `eyes` (the eyes and their lids with
 * a little clearance; glasses are the one piece worn there) and `mouth` (the strip just under the
 * eyes, where any curve, band or pair of marks would read as a mouth: R5).
 */
export const FACE_KEEPOUT = [
  { part: 'eyes', x: lx(48), y: ly(66), w: +(104 * K1).toFixed(2), h: +(60 * K1).toFixed(2) },
  { part: 'mouth', x: lx(70), y: ly(126), w: +(60 * K1).toFixed(2), h: +(24 * K1).toFixed(2) },
];

// ── Looks and checks ──────────────────────────────────────────────────────────────────────
/**
 * A critter's look as one string, the same in every frame it appears in: `body|role|head|bowtie|tone`.
 * The hand prop is left out: it is held or put down beat by beat.
 */
export function lookKey(o = {}) {
  let W;
  try { W = resolveWear(o); } catch { W = { role: o.role ?? null, head: o.head ?? null, bowtie: !!o.bowtie, headTone: o.headTone ?? null }; }
  return `${o.body ?? 'ink'}|${W.role ?? ''}|${W.head ?? ''}|${W.bowtie ? 'bowtie' : ''}|${W.headTone ?? ''}`;
}

/** critter() throws on every unknown name, so nothing is drawn wrong silently: no codes are
 *  written onto a drawn critter. Kept for the checks that read them. */
export const RIG_DRAWN_CODES = [];
/**
 * A critter's options checked without drawing: [{ code, detail }] for an unknown body, mood, arm
 * pose, state, role, head piece or hand prop (the same names critter() throws on).
 */
export function riggedProblems(state = {}) {
  const o = state.opts ? { ...state, ...state.opts } : state;
  const out = [];
  if (o.body != null && !BODY_COLORS[o.body]) out.push({ code: 'unknown-body', detail: `body "${o.body}" is not one of ${BODIES.join(', ')}` });
  if (o.mood != null && !MOODS[o.mood]) out.push({ code: 'unknown-mood', detail: `mood "${o.mood}" is not one of ${MOOD_NAMES.join(', ')}` });
  if (o.state != null && !STATES[o.state]) out.push({ code: 'unknown-state', detail: `state "${o.state}" is not one of ${Object.keys(STATES).join(', ')}` });
  for (const a of typeof o.arms === 'string' || Array.isArray(o.arms) ? [].concat(o.arms) : []) if (!ARM_POSES[a]) out.push({ code: 'unknown-arms', detail: `arm pose "${a}" is not one of ${Object.keys(ARM_POSES).join(', ')}` });
  try { resolveWear(o); } catch (e) { out.push({ code: 'unknown-wear', detail: String(e.message ?? e) }); }
  return out;
}
