// The Explainers world kit, cast (hx-6, VISUAL_SYSTEM_6 §3): critter D behind main's critter API.
// Every character is a critter: never a person, a figure built from solids, or a body part. The
// drawing is critter D (reference/critter-d/critter_d.py: a flat tile on ink legs, two big eyes with
// lids, ink stub arms with mitten ends; no mouth, brows, gloss or garment). main's API is unchanged:
// moods by main's names (each its nearest D mood), the rig's arms, views, held props, act/actAt.
//
//   critter(x, y, o)       draw one (x, y = the feet); options below
//   handAt(x, y, o)        where its hands are on screen, so it can hold a prop (pen, card, key…)
//   heldScale(cm, px, cheat) the scale for a held prop of that real size (CRITTER_CM)
//   walk(t, o)             a walk cycle: { legs, bob, arms } to pass back into critter()
//   MOODS, ARM_POSES       main's names; D (critter D's tile, moods, poses, wear translation)
//   role / head / hand     wear.js pieces (§4); main's outfit and WEAR become one or nothing
//   FACE_KEEPOUT           the eye and mouth zones nothing worn may enter (EX3-103)

import * as CORE from './core.js';
import { T, el, g, id, isDark } from './draw.js';
import {
  BY,
  FACE_KEEPOUT,
  ON_EYES,
  defsBag,
  drawArmItems,
  drawHeld,
  drawLeg,
  drawSleeve,
  isNoOutfit,
  normalizeOutfit,
  outfitColors as colorsOf,
  outfitKey,
  outfitBack,
  outfitLayers,
  ramp,
  softLine,
  softShape,
} from './outfits.js';

import { wear as resolveWear, headSvg, bowtieSvg, heldPropSvg, heldPropBox, handPoint, HAND_POSE } from './wear.js';
import { MOODS_X, ARMS_X, STATES_X, ACCENTS, ACTING_LIMITS, FACE_VEC, lifeOf, actingSystem } from './acting.js';

export { FACE_KEEPOUT, normalizeOutfit, outfitKey, isNoOutfit };
export { TOP_KINDS, NECKS, HEAD_KINDS, ITEMS, PALETTE, TOP_READS, ROLE_GUIDE, SCRUB_COLORS, outfitReads } from './outfits.js';

const r2 = (v) => Math.round(v * 100) / 100;
// Every color is a palette token (V-T1). The hx-4 tokens are read by name, with their own values
// as the fallback while an older core.js is loaded.
const FALLBACK = { canvas: '#FFFFFF', paper: '#F3F0EA', 'paper-lit': '#FBFAF6', 'paper-shade': '#E2DACB', 'paper-dark': '#CFC5B3', ink: '#171717', 'ink-lit': '#2B2926', 'ink-shade': '#101010', 'ink-dark': '#0A0A0A', 'text-secondary': '#525252', 'text-tertiary': '#737373', orange: '#FF5E1A', 'orange-lit': '#FF9462', 'orange-shade': '#E24213', 'orange-dark': '#A02B02', green: '#138510', 'shadow-warm': '#3B2A16', 'sun-bottom': '#EA3C3A', 'teal-lit': '#5DB5AE', 'yellow-lit': '#F3C65E' };
const K = (name) => T?.[name] ?? FALLBACK[name];

// ── Scale (still 01/02) ───────────────────────────────────────────────────────────────────
/** A critter's real height in cm: the ruler every world size is measured against. */
export const CRITTER_CM = CORE.CRITTER_CM ?? 72;
/** A critter's drawn height at scale 1, feet to crown (px). */
export const CRITTER_PX = 142;
/** Pixels per cm next to a scale-1 critter. */
export const PX_PER_CM = CRITTER_PX / CRITTER_CM;
/**
 * The scale for a held prop of real size `propCm`: apply it to a prop drawing that is `drawnPx`
 * tall at scale 1 (default: a drawing as tall as a critter), then multiply by the critter's own s.
 * Tweezers (12 cm) beside a critter read as tweezers, never as a sword (still 02); `cheat` ('cheat'
 * or a number, 4.2) draws them bigger so the action reads (core.js propScale).
 * @param {number} propCm
 * @param {number} [drawnPx]
 * @param {'cheat' | number} [cheat]
 */
export function heldScale(propCm, drawnPx = CRITTER_PX, cheat = undefined) {
  if (!(propCm > 0) || !(drawnPx > 0)) throw new Error('HX: heldScale(propCm, drawnPx) needs positive sizes');
  return ((propCm * PX_PER_CM) / drawnPx) * CORE.propScale(cheat, propCm);
}

// ── Critter D (hx-6, VISUAL_SYSTEM_6 §3) ───────────────────────────────────────────────────
// The drawing is critter D (reference/critter-d/critter_d.py, variant d, pupils plain): a flat
// rounded tile on two ink legs, two big eyes with lids, ink stub arms with mitten ends. No mouth,
// no brows, no gloss, no catch-lights, no outline (a white body keeps a thin ink edge), no garment.
// critterTile() is the reference drawing byte for byte (tests/explainers-kit-cast.test.ts holds
// that); critter() draws the same tile in main's local frame (feet at 0, CRITTER_PX tall), with
// the arms main's rig solves (stub arms in D's ink and mitten, at the solved angles and hands).

/** Ink: lines, legs, arms, pupils (the reference's own hex). */
const INK = '#171717';
/** White: eye whites and the white body. */
const WHITE = '#FFFFFF';
/** The eye whites of a white critter (E5E5E5: white mixed with ink), so they read on its body. */
const GREY = CORE.mixHex(WHITE, INK, 0.218);
/** The bodies critter D has: orange (the hero, one per frame), green, ink, white. */
const BODY_COLORS = { orange: K('orange'), green: K('green'), ink: INK, white: WHITE };
/** main's other bodies, drawn as a D body so old scenes still render: paper is white (§3); the
 *  retired light palette bodies draw white too (D has no coloured cast bodies but green). */
const BODY_ALIASES = { paper: 'white', yellow: 'white', blue: 'white', teal: 'white', lilac: 'white' };
/** The bodies: orange (the hero), green, ink, white; then main's names, drawn white. */
export const BODIES = [...Object.keys(BODY_COLORS), ...Object.keys(BODY_ALIASES)];
/** The D body a body name draws as ('paper' → 'white'); an unknown body throws with the list. */
function bodyName(body = 'ink') {
  if (BODY_COLORS[body]) return body;
  if (BODY_ALIASES[body]) return BODY_ALIASES[body];
  throw new Error(`HX: critter body "${body}" must be one of ${BODIES.join(', ')} (orange is the hero's only)`);
}
/** A body's flat colour, as main's ramp keys; an unknown body throws. */
export function bodyOf(body = 'ink') {
  const c = BODY_COLORS[bodyName(body)];
  return { base: c, lit: c, shade: c, dark: c, bounce: c, color: c };
}

/** The tile: 200 units square, feet at y 192, the top of the body at y 40. */
const TILE = { size: 200, feet: 192, top: 40, cx: 100 };
/** Local px per tile unit at s 1 (the body top lands at −CRITTER_PX). */
const DK = CRITTER_PX / (TILE.feet - TILE.top);
/** Screen px per tile unit at scale s. */
const tileScale = (s = 1) => DK * s;
/** A tile point → main's local frame (feet at 0, s 1). */
const tl = ([x, y]) => [(x - TILE.cx) * DK, (y - TILE.feet) * DK];
/** A local point → the tile. */
const lt = ([x, y]) => [x / DK + TILE.cx, y / DK + TILE.feet];
/** The tile drawn in the local frame. */
const TILE_TF = `scale(${DK.toFixed(4)}) translate(-100 -192)`;

/** A number as the reference writes it: Python's f"{x:.1f}" (round half to even on the exact
 *  value), trailing zeros and point dropped. */
function f(x) {
  const ax = Math.abs(x);
  let s;
  if (Number.isInteger(ax * 4) && !Number.isInteger(ax * 2)) {
    const fl = Math.floor(ax * 10);
    const n = fl % 2 === 0 ? fl : fl + 1;
    s = (n / 10).toFixed(1);
  } else s = ax.toFixed(1);
  if (x < 0 || Object.is(x, -0)) s = `-${s}`;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * D's thirty moods: critter_d.py M's ten (drawn byte for byte) and acting.js MOODS_X's twenty. The ten: the pupils' offset `p`, the lids `lid` [outer, inner] (0 open …
 * 1 shut), happy crescents `cr`, the eyes' scale `es` [left, right], the body's `tilt` (degrees),
 * the arm pose `arms` [left, right] (critterTile only: critter() takes main's arms) and `small` pupils.
 */
const D_MOODS = {
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
  ...MOODS_X,
};
/** D's arm poses (critter_d.py ARM): the left arm [shoulder, control, hand] in tile units; the
 *  right mirrors it (x → 200 − x). critterTile and wear.js use them. */
const D_ARM_POSES = {
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
  ...ARMS_X,
};
/** The reference's animation states (critterTile only): the arms and the class hooks of its sheet. */
const STATES = {
  idle: { mood: 'neutral', look: 'look', bob: 'bob', arms: null },
  think: { mood: 'neutral', look: 'think', bob: 'bob', arms: ['down', 'chin'] },
  work: { mood: 'focused', look: 'scan', bob: 'bob-fast', arms: ['down', 'down'], steps: true },
  wait: { mood: 'surprised', look: 'waitlook', bob: 'hop', arms: ['down', 'wave'] },
  done: { mood: 'happy', look: '', bob: 'bounce', arms: ['up', 'up'], noBlink: true },
  ...STATES_X,
};
const D_EYES = [[74, 96, -1], [126, 96, 1]];
const cls = (c) => (c ? ` class="${c}"` : '');

/** One D eye (critter_d.py eye(), pupils plain): the white, the pupil, the lids, a crescent. */
function dEye(cx, cy, side, m, color, s, { blink = null, look = '', eyew = WHITE, gaze = null } = {}) {
  const o = [`<g${cls(blink?.cls)}${blink?.tf ? ` transform="${blink.tf(cx, cy)}"` : ''}>`];
  const [px, py] = m.p;
  const rx = 20 * s;
  const ry = 24 * s;
  const r = 11.5 * s * (m.small ? 0.7 : 1);
  o.push(`<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${eyew}"></ellipse>`);
  const gz = gaze ? ` transform="translate(${f(gaze[0])} ${f(gaze[1])})"` : '';
  o.push(`<g${cls(look)}${gz}><circle cx="${f(cx + px * 0.8)}" cy="${f(cy + py * 0.8)}" r="${f(r)}" fill="${INK}"></circle></g>`);
  const [lo, li] = m.lid;
  if (lo > 0 || li > 0) {
    const y0 = cy - ry - 3;
    const H = 2 * ry + 6;
    const [yl, yr] = side < 0 ? [y0 + lo * H, y0 + li * H] : [y0 + li * H, y0 + lo * H];
    const xl = cx - rx - 4;
    const xr = cx + rx + 4;
    o.push(`<polygon points="${f(xl)},${f(y0 - 2)} ${f(xr)},${f(y0 - 2)} ${f(xr)},${f(yr)} ${f(xl)},${f(yl)}" fill="${color}"></polygon>`);
  }
  if (m.cr) o.push(`<ellipse cx="${f(cx)}" cy="${f(cy + ry * 1.05)}" rx="${f(rx * 1.45)}" ry="${f(ry * 0.82)}" fill="${color}"></ellipse>`);
  o.push('</g>');
  return o.join('');
}

/** One D arm (critter_d.py arm()) from a pose, in the tile: side −1 left, +1 right. */
function dArm(pose, side, c = '', extra = '') {
  let pts = D_ARM_POSES[pose];
  if (side > 0) pts = pts.map(([x, y]) => [200 - x, y]);
  const [a0, b0] = pts[0];
  pts = pts.map(([x, y]) => [a0 + (x - a0) * 0.82, b0 + (y - b0) * 0.82]);
  const [[a, b], [cx, cy], [e, gg]] = pts;
  return `<g${cls(c)}${extra}><path d="M${f(a)} ${f(b)} Q${f(cx)} ${f(cy)} ${f(e)} ${f(gg)}" fill="none" stroke="${INK}" stroke-width="20" stroke-linecap="round"></path>`
    + `<circle cx="${f(e)}" cy="${f(gg)}" r="12" fill="${INK}"></circle></g>`;
}

/** The eye shape keys only the added moods and the acting track use (the ten draw as before). */
const isX = (m) => m.low != null || m.curve != null || m.ey != null || m.pr != null || m.lidR != null || typeof m.cr === 'number' || m.sq != null;
const ACT = actingSystem({ moods: D_MOODS, poses: D_ARM_POSES, states: STATES, alias: (m) => dMood(m), known: (m) => !!D_MOODS[m] || !!MOODS[m] });

/** One D eye from a face vector (acting.js FACE_VEC): the white, a pupil kept inside it, curved
 *  upper lids, a lower lid and a crescent, all in the body colour; nothing above or below the eye. */
function dEyeV(cx, cy, side, F, color, eyew, gaze = null, hk = {}) {
  const R = side < 0;
  const s = R ? F.esl : F.esr;
  const rx = 20 * s;
  const ry = 24 * s * F.ey;
  const r = 11.5 * s * F.pr;
  const o = [`<g${cls(hk.blink)}><ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${eyew}"></ellipse>`];
  let dx = F.px * 0.8 + (gaze ? gaze[0] : 0);
  let dy = F.py * 0.8 + (gaze ? gaze[1] : 0);
  const ax = Math.max(0.5, rx - r - 1);
  const ay = Math.max(0.5, ry - r - 1);
  const e = Math.hypot(dx / ax, dy / ay);
  if (e > 1) { dx /= e; dy /= e; }
  o.push(`<g${cls(hk.look)}><circle cx="${f(cx + dx)}" cy="${f(cy + dy)}" r="${f(r)}" fill="${INK}"></circle></g>`);
  const [lo, li] = R ? [F.lo, F.li] : [F.ro, F.ri];
  const xl = cx - rx - 4;
  const xr = cx + rx + 4;
  const H = 2 * ry + 6;
  if (lo > 0.001 || li > 0.001) {
    const y0 = cy - ry - 3;
    const [yl, yr] = R ? [y0 + lo * H, y0 + li * H] : [y0 + li * H, y0 + lo * H];
    const sag = F.curve * 28 * s * Math.min(1, Math.max(lo, li) * 4);
    o.push(`<path d="M${f(xl)} ${f(y0 - 2)} H${f(xr)} V${f(yr)} Q${f(cx)} ${f((yl + yr) / 2 + sag)} ${f(xl)} ${f(yl)} Z" fill="${color}"></path>`);
  }
  if (F.low > 0.001) {
    const y1 = cy + ry + 3;
    const yb = y1 - F.low * H;
    o.push(`<path d="M${f(xl)} ${f(y1 + 2)} H${f(xr)} V${f(yb)} Q${f(cx)} ${f(yb - F.low * 8)} ${f(xl)} ${f(yb)} Z" fill="${color}"></path>`);
  }
  if (F.cr > 0.001) o.push(`<ellipse cx="${f(cx)}" cy="${f(cy + ry * (2.05 - F.cr))}" rx="${f(Math.min(rx * 1.45, 29))}" ry="${f(ry * 0.82)}" fill="${color}"></ellipse>`);
  o.push('</g>');
  return o.join('');
}

/** A hand point kept within D's stub from its shoulder and clear of both eyes (tile units). */
function stubHand(S, H) {
  let [x, y] = H;
  const d = Math.hypot(x - S[0], y - S[1]);
  const max = D_STUB / DK;
  if (d > max) { x = S[0] + ((x - S[0]) * max) / d; y = S[1] + ((y - S[1]) * max) / d; }
  for (const [ex, ey] of D_EYES) {
    const RX = 20 * 1.2 + 13;
    const RY = 24 * 1.2 * 1.12 + 13;
    const k = Math.hypot((x - ex) / RX, (y - ey) / RY);
    if (k < 1) { x = ex + (x - ex) / (k || 1e-3); y = ey + (y - ey) / (k || 1e-3); if (k === 0) y = ey + RY; }
  }
  return [x, y];
}
/** An arm from three points (screen tile units, before D's 0.82 stub scaling): the drawn quad. */
function armQuadTile(pts) {
  const [a0, b0] = pts[0];
  const sc = pts.map(([x, y]) => [a0 + (x - a0) * 0.82, b0 + (y - b0) * 0.82]);
  sc[2] = stubHand(sc[0], sc[2]);
  return sc;
}
function dArmPts(pts) {
  const [[a, b], [cx, cy], [e, gg]] = armQuadTile(pts);
  return `<g><path d="M${f(a)} ${f(b)} Q${f(cx)} ${f(cy)} ${f(e)} ${f(gg)}" fill="none" stroke="${INK}" stroke-width="20" stroke-linecap="round"></path>`
    + `<circle cx="${f(e)}" cy="${f(gg)}" r="12" fill="${INK}"></circle></g>`;
}

/** A face vector with main's explicit lid (a blink) on top. */
function applyLid(F, opts) {
  if (opts.lid == null) return F;
  const lv = Number(opts.lid) || 0;
  return { ...F, lo: Math.max(F.lo, lv), li: Math.max(F.li, lv), ro: Math.max(F.ro, lv), ri: Math.max(F.ri, lv) };
}

/** A face vector for a mood name (actingAt's face for a held mood at full intensity, no life). */
function faceOf(mood) { return ACT.moodVec(mood); }

/** The tile drawn from an acting face vector (critterTile with `face`): body, eyes, arms, wear. */
function tileActing(o, F, hk = {}) {
  const body = bodyName(o.body ?? 'ink');
  const color = BODY_COLORS[body];
  const W = wearOf(o);
  const eyew = color === WHITE ? GREY : WHITE;
  const edge = color === WHITE ? ` stroke="${INK}" stroke-width="3"` : '';
  const lift = F.lift * 8;
  const sx = 1 + F.sq;
  const sy = 1 - F.sq;
  // squash in the body's own frame (inside the tilt), so a tilted squash never shears
  const out = [`<g${cls(hk.bob)} transform="translate(${f(F.dx)} ${f(F.hop ? -F.hop : 0)}) rotate(${f(F.tilt + (Number(o.tilt) || 0))} 100 110)">`];
  out.push(`<g transform="translate(0 ${f(lift ? -lift : 0)}) translate(100 192) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(-100 -192)">`);
  [[68, F.legL], [112, F.legR]].forEach(([lx, rt]) => {
    const rr = `<rect${cls(hk.steps ? (lx < 100 ? 'step-l' : 'step-r') : '')} x="${lx}" y="158" width="20" height="${f(32 + lift)}" rx="10" fill="${INK}"></rect>`;
    out.push(Math.abs(rt) > 0.05 ? `<g transform="rotate(${f(rt)} ${lx + 10} 160)">${rr}</g>` : rr);
  });
  out.push(BODY_TILE(color, edge));
  if (o.view !== 'back') D_EYES.forEach(([cx, cy, side]) => out.push(dEyeV(cx, cy, side, F, color, eyew, null, hk)));
  if (W.bowtie && o.view !== 'back') out.push(bowtieSvg(body));
  out.push(dArmPts(F.aL));
  const held = W.hand ? (o.handPose ?? HAND_POSE[W.hand]) : null;
  out.push(held ? dArm(held, 1) : dArmPts(F.aR));
  if (held) out.push(heldPropSvg(W.hand, body, held));
  if (o._overlay) out.push(o._overlay);
  if (W.head && !(o.view === 'back' && W.head === 'glasses')) out.push(headSvg(W.head, body, W.headTone));
  out.push('</g></g>');
  return out.join('');
}

const LEGS_TILE = (lc = '', rc = '') => `<rect${cls(lc)} x="68" y="158" width="20" height="32" rx="10" fill="${INK}"></rect><rect${cls(rc)} x="112" y="158" width="20" height="32" rx="10" fill="${INK}"></rect>`;
const BODY_TILE = (color, edge = '') => `<rect x="26" y="40" width="148" height="136" rx="46" fill="${color}"${edge}></rect>`;

/**
 * The critter in its own 200-unit tile (feet at y 192, body top at y 40), without its shadow:
 * exactly critter_d.py's drawing for the same D mood and body. Options: body (D's four or an
 * alias), mood (a D_MOODS name, or a main MOODS name mapped to its D mood), arms (a D_ARM_POSES
 * name or [left, right]), state (STATES), role / head / hand / bowtie (wear.js), tilt, `_overlay`
 * (drawn where the reference draws its accessory; sheets and tests only).
 */
function critterTile(o = {}) {
  if (o.face || o.pose) {
    const P = o.pose ?? null;
    return tileActing(o, P ? P.face : o.face);
  }
  const body = bodyName(o.body ?? 'ink');
  const color = BODY_COLORS[body];
  const st = o.state ?? null;
  if (st !== null && !STATES[st]) throw new Error(`HX: critter state "${st}" must be one of ${Object.keys(STATES).join(', ')}`);
  const S = st ? STATES[st] : null;
  const dm = dMood(o.mood ?? S?.mood ?? 'neutral');
  const m = D_MOODS[dm];
  let arms = S?.arms ? [...S.arms] : [...m.arms];
  if (isX(m) || D_MOODS[S?.mood] && isX(D_MOODS[S.mood]) || ARMS_X[arms[0]] || ARMS_X[arms[1]] || [].concat(o.arms ?? []).some((a) => ARMS_X[a])) {
    // the added moods and poses draw through the acting path (the reference ten stay byte for byte)
    const F = faceOf(dm);
    const A = o.arms != null ? (Array.isArray(o.arms) ? o.arms : [o.arms, o.arms]) : arms;
    A.forEach((p) => { if (!D_ARM_POSES[p]) throw new Error(`HX: critter arm pose "${p}" must be one of ${Object.keys(D_ARM_POSES).join(', ')}`); });
    const mir = (n, sd) => D_ARM_POSES[n].map(([x, y]) => [sd > 0 ? 200 - x : x, y]);
    const an = !!S || !!o.anim;
    const hk = { bob: an ? (S ? S.bob : 'bob') : '', look: an ? (S ? S.look : 'look') : '', blink: an && !S?.noBlink ? 'blink' : '', steps: an && S?.steps };
    return tileActing(o, { ...F, aL: mir(A[0], -1), aR: mir(A[1], 1) }, hk);
  }
  if (o.arms != null) {
    const a = Array.isArray(o.arms) ? o.arms : [o.arms, o.arms];
    a.forEach((p) => { if (!D_ARM_POSES[p]) throw new Error(`HX: critter arm pose "${p}" must be one of ${Object.keys(D_ARM_POSES).join(', ')}`); });
    arms = [a[0], a[1]];
  }
  const W = wearOf(o);
  if (W.hand) arms[1] = o.handPose ?? HAND_POSE[W.hand];
  const anim = !!S || !!o.anim;
  const look = anim ? (S ? S.look : 'look') : '';
  const blink = { cls: anim && !S?.noBlink ? 'blink' : '', tf: null };
  const bob = anim ? (S ? S.bob : 'bob') : '';
  const steps = anim && S?.steps;
  const eyew = color === WHITE ? GREY : WHITE;
  const edge = color === WHITE ? ` stroke="${INK}" stroke-width="3"` : '';
  const tilt = m.tilt + (Number(o.tilt) || 0);
  const out = [`<g${cls(bob)}><g transform="rotate(${Number.isInteger(tilt) ? tilt : f(tilt)} 100 110)">`];
  out.push(LEGS_TILE(steps ? 'step-l' : '', steps ? 'step-r' : ''));
  out.push(BODY_TILE(color, edge));
  if (o.view !== 'back') D_EYES.forEach(([cx, cy, side], i) => out.push(dEye(cx, cy, side, m, color, m.es[i], { blink, look, eyew })));
  if (W.bowtie && o.view !== 'back') out.push(bowtieSvg(body));
  out.push(dArm(arms[0], -1));
  const wave = arms[1] === 'wave' && !W.hand;
  out.push(dArm(arms[1], 1, wave ? 'wave' : ''));
  if (W.hand) out.push(heldPropSvg(W.hand, body, arms[1]));
  if (o._overlay) out.push(o._overlay);
  if (W.head && !(o.view === 'back' && W.head === 'glasses')) out.push(headSvg(W.head, body, W.headTone));
  out.push('</g></g>');
  return out.join('');
}

/** The body outline (feet at 0, s 1). */
export const BODY_D = (() => {
  const [x0, y0] = tl([26, 40]);
  const [x1, y1] = tl([174, 176]);
  const r = 46 * DK;
  const n = (v) => r2(v);
  return `M ${n(x0 + r)} ${n(y0)} H ${n(x1 - r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x1)} ${n(y0 + r)} V ${n(y1 - r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x1 - r)} ${n(y1)} H ${n(x0 + r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x0)} ${n(y1 - r)} V ${n(y0 + r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x0 + r)} ${n(y0)} Z`;
})();

// ── Eyes ──────────────────────────────────────────────────────────────────────────────────
/**
 * Two D eyes at (cx, cy). `gap` between their centres,
 * `r` their half width, look [x, y] in −1..1 (the pupils glance), lid 0 open … 1 shut, lidTilt,
 * pr (a pupil size under 0.42 draws D's small pupils), body (its lids take the body colour).
 * The other options of main's soft eyes are accepted and ignored.
 */
export function eyes(cx, cy, { gap = 34, r = 15, look = [0, 0], lid = 0, lidTilt = 0, pr = 0.5, body = 'paper', lidColor = null } = {}) {
  const color = lidColor && lidColor !== 'currentColor' ? lidColor : BODY_COLORS[bodyName(body)];
  const s = r / 20;
  const t = (Number(lidTilt) || 0) * 0.02;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const m = { p: [0, 0], lid: [clamp(lid - t), clamp(lid + t)], cr: false, small: pr < 0.42 };
  const gaze = look && (look[0] || look[1]) ? [look[0] * 6 * s, look[1] * 5 * s] : null;
  const eyew = color === WHITE ? GREY : WHITE;
  return [-1, 1].map((side) => dEye(cx + (side * gap) / 2, cy, side, m, color, s, { eyew, gaze })).join('');
}

// ── Arms (main's rig poses, local units) ──────────────────────────────────────────────────
// Each preset: [[shoulder x, y, hand x, y] left, [...] right], relative to the feet (the body
// spans x ±69, y −142…−15). `front` lists the arms drawn over the body (a hand in front of it).
// The rig (below) solves them; critter D draws each as an ink stub arm with a mitten end.
export const ARM_POSES = {
  down: { arms: [[-62, -86, -78, -52], [62, -86, 78, -52]] },
  up: { arms: [[-60, -110, -92, -168], [60, -110, 92, -168]] },
  flail: { arms: [[-60, -104, -112, -150], [60, -100, 106, -126]] },
  push: { arms: [[-60, -92, -114, -98], [60, -92, 84, -60]] },
  carry: { arms: [[-60, -104, -70, -160], [60, -104, 70, -160]] },
  /** one arm stretched out to the right, feeling or reaching for something */
  reach: { arms: [[-62, -86, -80, -54], [62, -94, 156, -98]] },
  /** both arms out in front, feeling the way (in the dark) */
  feel: { arms: [[-62, -94, 118, -92], [62, -94, 162, -104]] },
  /** pointing up and to the right at something */
  point: { arms: [[-62, -86, -80, -54], [62, -98, 144, -142]] },
  /** both hands in front of the belly, below the mouth, holding a thing (see handAt) */
  hold: { arms: [[-64, -76, -34, -18], [64, -76, 34, -18]], front: ['l', 'r'] },
  /** holding one thing out to the right, at chest height */
  offer: { arms: [[-62, -86, -80, -54], [60, -90, 124, -76]] },
  /** the right hand down in front, writing on a sheet or desk */
  write: { arms: [[-62, -86, -80, -54], [64, -76, 56, -34]], front: ['r'] },
  /** waving hello with the right arm */
  wave: { arms: [[-62, -86, -80, -54], [62, -104, 112, -182]] },
  /** a shrug: forearms out, palms up */
  shrug: { arms: [[-62, -94, -118, -116], [62, -94, 118, -116]] },
  /** a hand under the chin (the base of the body, below the mouth), thinking */
  think: { arms: [[-62, -86, -80, -54], [60, -62, 30, -20]], front: ['r'] },
  /** both hands up to the face, peeking or shocked: the one pose that covers the face, on purpose */
  cover: { arms: [[-58, -88, -26, -96], [58, -88, 26, -96]], front: ['l', 'r'] },
  /** cheering, both arms high */
  cheer: { arms: [[-60, -112, -104, -196], [60, -112, 104, -196]] },
  /** hands on hips, proud */
  hips: { arms: [[-62, -92, -96, -70], [62, -92, 96, -70]] },
};

// ── Faces ─────────────────────────────────────────────────────────────────────────────────
/**
 * Moods: each draws as its nearest D mood (`d`). `mouth` and `brows` are accepted and ignored (critter D has neither); the face keys
 * stay for callers that read them (moodFace). A mood never sets the arms.
 */
export const MOODS = {
  neutral: { mouth: 'calm', brows: 'calm', d: 'neutral' },
  happy: { mouth: 'smile', brows: 'up', d: 'happy' },
  confident: { lid: 0.32, lidTilt: 3, mouth: 'smile', brows: 'flat', d: 'proud' },
  proud: { lid: 0.55, mouth: 'grin', brows: 'up', d: 'proud' },
  sly: { lid: 0.45, lidTilt: -4, mouth: 'smirk', brows: 'raised', look: [0.6, 0], d: 'sly' },
  confused: { mouth: 'wobble', brows: 'raised', look: [0.4, -0.5], d: 'confused' },
  worried: { mouth: 'wobble', brows: 'worried', look: [-0.3, 0.2], d: 'worried' },
  panicked: { mouth: 'o', brows: 'worried', pr: 0.32, d: 'panicked' },
  surprised: { mouth: 'o', brows: 'high', pr: 0.36, d: 'surprised' },
  sad: { mouth: 'frown', brows: 'worried', look: [0, 0.6], lid: 0.25, d: 'disappointed' },
  angry: { mouth: 'grit', brows: 'angry', d: 'angry' },
  focused: { lid: 0.3, mouth: 'flat', brows: 'angry', look: [0.6, 0.3], d: 'focused' },
  pained: { lid: 0.42, lidTilt: -3, mouth: 'grit', brows: 'worried', d: 'worried' },
  relieved: { lid: 0.5, mouth: 'smile', brows: 'up', look: [0, -0.2], d: 'relieved' },
  curious: { mouth: 'calm', brows: 'raised', pr: 0.56, d: 'curious' },
  sleepy: { lid: 0.64, mouth: 'calm', brows: 'calm', look: [0, 0.5], d: 'sleepy' },
};
export const FACE_KEYS = ['look', 'lid', 'lidTilt', 'pr', 'mouth', 'brows'];
export const MOUTHS = ['calm', 'o', 'flat', 'smile', 'grin', 'smirk', 'frown', 'wobble', 'grit'];
export const BROWS = ['calm', 'flat', 'up', 'high', 'worried', 'angry', 'raised'];
/** A mood's face settings only. */
export function moodFace(mood) {
  const m = MOODS[mood] ?? MOODS.neutral;
  return Object.fromEntries(Object.entries(m).filter(([k]) => FACE_KEYS.includes(k)));
}
/** The D mood a mood name draws as (a D_MOODS name stays itself); unknown names draw neutral. */
function dMood(mood = 'neutral') {
  if (D_MOODS[mood]) return mood;
  return MOODS[mood]?.d ?? 'neutral';
}

// ── Wear: main's WEAR and outfits translated to a role (§3, §4) ───────────────────────────
// No garment is ever drawn on a critter D body. main's stock accessories and outfits are accepted
// and translated to wear.js pieces when one obviously matches; the rest is dropped (bare).
export const WEAR = ['cap', 'tophat', 'chef', 'gradcap', 'glasses', 'headset', 'apron', 'backpack', 'bowtie', 'scarf'];
/** The accessories that are allowed over the eyes. */
export const WEAR_ON_EYES = ['glasses'];
/** main's WEAR → the wear.js piece it becomes (tophat, apron, backpack and scarf: none, bare). */
const WEAR_TO_ROLE = { cap: { head: 'cap' }, chef: { head: 'toque' }, gradcap: { head: 'gradcap' }, glasses: { head: 'glasses' }, headset: { head: 'headphones' }, bowtie: { bowtie: true } };
/** An outfit's head kind → the wear.js head piece it becomes (others: none). */
const OUTFIT_HEAD_TO_ROLE = { chef: 'toque', 'hard-hat': 'hardhat', beanie: 'beanie', peaked: 'cap', headphones: 'headphones', 'scrub-cap': 'nursecap' };

/**
 * A critter's resolved wear (wear.js wear()): `role` / head / hand / bowtie / headTone as given,
 * then main's `wear` list and `outfit` translated (WEAR_TO_ROLE, OUTFIT_HEAD_TO_ROLE, the outfit's
 * glasses and bowtie items) for what is still free, at most two signifiers. Unknown names throw.
 * @returns {{ role: string|null, head: string|null, hand: string|null, bowtie: boolean, headTone: string|null }}
 */
function wearOf(o = {}) {
  const W = resolveWear({ role: o.role ?? null, head: o.head, hand: o.hand, bowtie: o.bowtie, headTone: o.headTone });
  const old = {};
  for (const w of [].concat(o.wear ?? [])) {
    const t = WEAR_TO_ROLE[w];
    if (t?.head && !old.head) old.head = t.head;
    if (t?.bowtie) old.bowtie = true;
  }
  if (!isNoOutfit(o.outfit)) {
    let fit = null;
    try { fit = normalizeOutfit(o.outfit); } catch { fit = null; }
    if (fit) {
      const h = OUTFIT_HEAD_TO_ROLE[fit.head.kind];
      if (h && !old.head) old.head = h;
      if (fit.items.includes('glasses') && !old.head) old.head = 'glasses';
      if (fit.items.includes('bowtie') || fit.items.includes('tie')) old.bowtie = true;
    }
  }
  if (o.head === undefined && !W.head && old.head) W.head = old.head;
  if (o.bowtie === undefined && !W.bowtie && old.bowtie) W.bowtie = true;
  if ([W.head, W.hand, W.bowtie].filter(Boolean).length > 2) W.bowtie = false;
  return W;
}

/**
 * Stock wear as drawn: { front, behind } SVG (in the 200-unit tile)
 * of the wear.js pieces they translate to; '' for the ones that draw bare.
 */
export function wearDrawing(wear, { body = 'ink' } = {}) {
  const W = wearOf({ wear, body });
  const b = bodyName(body);
  const front = (W.bowtie ? bowtieSvg(b) : '') + (W.head ? headSvg(W.head, b, W.headTone) : '');
  return { front, behind: '' };
}

/**
 * A critter's look (data-look), the same in every frame:
 * `body|wear+wear|wearColor`, then `|<outfit key>` when it wears an outfit, then
 * `|role=<role>.<head>.<bowtie>.<tone>` when it has a role or a wear.js piece (the hand prop is
 * left out: it is held or put down beat by beat).
 * @param {{ body?: string, wear?: string[] | string, wearColor?: string | null, outfit?: object | null, role?: string, head?: string, bowtie?: boolean, headTone?: string }} [look]
 * @returns {string}
 */
export function lookKey({ body = 'ink', wear = [], wearColor = null, outfit = null, role, head, bowtie, headTone } = {}) {
  const base = `${body}|${[].concat(wear ?? []).map(String).sort().join('+')}|${wearColor ?? ''}`;
  const withFit = isNoOutfit(outfit) ? base : `${base}|${outfitKey(outfit)}`;
  if (role == null && head == null && bowtie == null && headTone == null) return withFit;
  let W;
  try { W = resolveWear({ role: role ?? null, head, bowtie, headTone }); } catch { W = { role, head, bowtie, headTone }; }
  return `${withFit}|role=${W.role ?? ''}.${W.head ?? ''}.${W.bowtie ? 'bowtie' : ''}.${W.headTone ?? ''}`;
}

/** Critter D's internals (tile, 30 moods, 30 arm poses, 15 states, the acting accents and limits, wear translation), for wear.js, sheets and tests. */
export const D = { INK, WHITE, GREY, BODY_COLORS, BODY_ALIASES, TILE, DK, f, MOODS: D_MOODS, ARM_POSES: D_ARM_POSES, STATES, ACCENTS, LIMITS: ACTING_LIMITS, lifeOf, faceOf: (m) => faceOf(m), tile: critterTile, bodyName, dMood, wearOf, WEAR_TO_ROLE, OUTFIT_HEAD_TO_ROLE, tileScale };

// ── Pieces of the critter ─────────────────────────────────────────────────────────────────
const armQuad = ([x0, y0, x1, y1]) => [x0, y0, (x0 + x1) / 2 + (x1 > 0 ? 8 : -8), (y0 + y1) / 2 - 10, x1, y1];
/** D's arm stroke and mitten radius in local units. */
const ARM_W = r2(20 * DK);
const MITTEN_R = r2(12 * DK);
/** How far below the rig's shoulder D's drawn arm starts (local px): D's shoulder is at tile y ~116. */
const SHOULDER_DROP = 15;

/** A D stub arm along a solved quad (local units): an ink stroke, a mitten at the hand. */
function drawArm(quad, shoulder = null) {
  const [x0, y0, cx, cy, x1, y1] = quad;
  const [sx, sy] = shoulder ?? [x0, y0];
  return `<path d="M ${r2(sx)} ${r2(sy)} Q ${r2(cx)} ${r2(cy)} ${r2(x1)} ${r2(y1)}" fill="none" stroke="${INK}" stroke-width="${ARM_W}" stroke-linecap="round"></path>` + drawHand(null, x1, y1);
}

/** The hand: D's ink mitten. (`C` and the options are accepted for main's callers.) */
function drawHand(_C, x1, y1) {
  return `<circle cx="${r2(x1)}" cy="${r2(y1)}" r="${MITTEN_R}" fill="${INK}"></circle>`;
}

function contactShadow(D, dark) {
  const c = dark ? K('ink-dark') : K('shadow-warm');
  return [
    el('ellipse', { cx: -10, cy: 4, rx: 78, ry: 20, fill: c, opacity: dark ? 0.5 : 0.24, filter: D.blur(10) }),
    el('ellipse', { cx: -4, cy: 2, rx: 56, ry: 9, fill: c, opacity: dark ? 0.55 : 0.34, filter: D.blur(4) }),
    el('ellipse', { cx: -26, cy: 2, rx: 15, ry: 4.5, fill: c, opacity: dark ? 0.7 : 0.6, filter: D.blur(2) }),
    el('ellipse', { cx: 26, cy: 2, rx: 15, ry: 4.5, fill: c, opacity: dark ? 0.7 : 0.6, filter: D.blur(2) }),
  ].join('');
}

// ── Views (front or back) ─────────────────────────────────────────────────────────────────
/** The ways a critter can face the lens. front: critter D; back: turned away (over-the-shoulder
 *  shots), D's tile with no eyes (body, arms, legs). `side` stays a flip. */
export const VIEWS = ['front', 'back'];
export const SIDES = ['left', 'right'];
/** Views the kit had and removed, and what to use instead (viewOf names it when one is asked for). */
export const REMOVED_VIEWS = { 'three-quarter': 'the three-quarter view was removed in 4.2: a critter faces front or back (an over-the-shoulder shot uses back)' };
/**
 * A critter's view and the local direction it turns (k = +1 toward local +x, its "forward"):
 * `side` is on SCREEN (so a flipped critter told side 'right' still turns right); with no side it
 * turns forward (right, or left when flipped). Unknown or removed views, and unknown sides, throw.
 * @returns {{ view: string, k: number }}
 */
export function viewOf({ view = 'front', side = null, flip = false } = {}) {
  if (REMOVED_VIEWS[view]) throw new Error(`HX: critter view "${view}": ${REMOVED_VIEWS[view]}`);
  if (!VIEWS.includes(view)) throw new Error(`HX: critter view "${view}" must be one of ${VIEWS.join(', ')}`);
  if (side !== null && side !== undefined && !SIDES.includes(side)) throw new Error(`HX: critter side "${side}" must be left or right`);
  const L = flip ? -1 : 1;
  const k = side ? (side === 'left' ? -1 : 1) * L : 1;
  return { view, k };
}
/** The face keep-outs for a view (local units): the front ones; none in a back view (no face is
 *  seen). `k` is accepted for older callers. */
export function faceKeepoutFor(view = 'front', _k = 1) {
  return view === 'back' ? [] : FACE_KEEPOUT;
}

// ── The critter ───────────────────────────────────────────────────────────────────────────
/**
 * A critter (critter D, VISUAL_SYSTEM_6 §3), feet at (x, y).
 *   body:   orange (hero), green, ink (default), white; paper and old bodies draw white
 *   view:   front | back (no eyes); mood: a MOODS name (lids, pupils, tilt)
 *   arms:   an ARM_POSES name or { l, r } hand targets (rig-solved); legs: preset or { l, r }
 *   role:   a wear.js ROLES name, or head / hand / bowtie / headTone; hand: null puts it down
 *   outfit, wear: translated to a role piece or nothing (never drawn); hold: { l, r, both }
 *   look, lid, pr, tilt, sq, squash, s, flip; who: data-who / data-look for try.mjs
 * @param {number} x
 * @param {number} y
 * @param {Record<string, any>} [opts]
 */
export function critter(x, y, opts = {}) {
  const o = { ...moodFace(opts.mood), ...opts };
  const { body = 'ink', s = 1, tilt = 0, legs = 'stand', flip = false, sq = 0, squash = null, wear = [], wearColor = null, outfit = null, who = null, hold = null } = o;
  const dark = isDark();
  const L = flip ? -1 : 1;
  const D = defsBag();
  const bname = bodyName(body);
  const color = BODY_COLORS[bname];
  const { view } = viewOf(o);
  const back = view === 'back';
  const W = wearOf(opts);
  const C = { D, L, dark, bodyClip: null, fill: color };

  // the D mood, with main's explicit face options on top (a blink, a gaze, a pupil size); an
  // acting pose (actingAt) or an added mood draws from its face vector
  const m = { ...D_MOODS[dMood(opts.mood)] };
  const F = opts.face ?? (isX(m) ? faceOf(dMood(opts.mood)) : null);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  if (opts.lid != null) {
    const lv = Number(opts.lid) || 0;
    const t = (Number(opts.lidTilt) || 0) * 0.02;
    m.lid = [clamp(Math.max(m.lid[0], lv) - t), clamp(Math.max(m.lid[1], lv) + t)];
  }
  if (opts.pr != null) m.small = Number(opts.pr) < 0.42;
  const lk = opts.look;
  const gaze = Array.isArray(lk) && (lk[0] || lk[1]) ? [lk[0] * 6, lk[1] * 5] : null;
  const dTilt = F ? r2(F.tilt) : m.tilt;
  const lift = F ? F.lift * 8 : 0;

  // legs: D's two ink legs, swung about their tops (walk())
  const LEGS = { stand: [0, 0], kick: [-20, 28], hop: [8, -8], sit: [-78, -70], tiptoe: [0, 0] };
  const legRot = typeof legs === 'object' ? [legs.l ?? 0, legs.r ?? 0] : LEGS[legs] ?? LEGS.stand;
  const legH = (legs === 'tiptoe' ? 42 : 32) + lift;
  const legSvg = [[68, legRot[0]], [112, legRot[1]]].map(([lx, rot]) => {
    const r = `<rect x="${lx}" y="158" width="20" height="${legH}" rx="10" fill="${INK}"></rect>`;
    return rot ? `<g transform="rotate(${r2(rot)} ${lx + 10} 160)">${r}</g>` : r;
  }).join('');
  const eyew = color === WHITE ? GREY : WHITE;
  // a white body keeps its thin ink edge; an ink body on the dark stage gets a thin paper one so it
  // never vanishes (D has no rim light or glow)
  const edge = color === WHITE ? ` stroke="${INK}" stroke-width="3"` : dark && bname === 'ink' ? ` stroke="${K('ink-lit')}" stroke-width="4"` : '';
  const tileOpen = `<g transform="${TILE_TF}"><g transform="rotate(${dTilt} 100 110)">`;
  const bodyTile = g({ 'data-part': 'body' }, tileOpen + legSvg + BODY_TILE(color, edge) + '</g></g>');
  const faceTile = [];
  if (!back) {
    D_EYES.forEach(([cx, cy, side], i) => faceTile.push(F ? dEyeV(cx, cy, side, applyLid(F, opts), color, eyew, gaze) : dEye(cx, cy, side, m, color, m.es[i], { eyew, gaze })));
    if (W.bowtie) faceTile.push(bowtieSvg(bname));
  }
  if (W.head && !(back && W.head === 'glasses')) faceTile.push(headSvg(W.head, bname, W.headTone));
  const face = faceTile.length ? g({ 'data-part': 'face' }, tileOpen + faceTile.join('') + '</g></g>') : '';

  // the arms main's rig solves; each shoulder rides the body's D tilt so the arm stays attached
  const sol = solveArms(o);
  const front = sol.front;
  const pivot = tl([100, 110]);
  // D's shoulders sit below the eyes (tile y 110–122): the drawn arm starts SHOULDER_DROP below the
  // rig's shoulder (the rig, the hands and everything they hold are unchanged)
  const shoulderOf = (q) => {
    const p = rot([q[0] - pivot[0], q[1] + SHOULDER_DROP - pivot[1]], dTilt);
    return [p[0] + pivot[0], p[1] + pivot[1]];
  };
  const arm = (side, i) => g({ 'data-part': `arm-${side}` }, drawArm(sol.quads[i], shoulderOf(sol.quads[i])));
  const holdSides = hold ? ['both', 'l', 'r'].filter((sd) => hold[sd]) : [];
  const inside = (i) => Math.abs(sol.hands[i][0]) < 62;
  const hidden = (sd) => back && (sd === 'both' || front.includes(sd) || inside(sd === 'l' ? 0 : 1));
  const holdsOf = (pick) => {
    const hs = holdSides.filter(pick);
    return hs.length ? drawHolds(C, sol, Object.fromEntries(hs.map((sd) => [sd, hold[sd]])), { tilt, L, body }) : '';
  };
  // the wear.js hand prop, in the solved right hand (in the tile's units, GRIP applied)
  const handProp = W.hand ? g({ 'data-held': W.hand, transform: TILE_TF }, heldPropSvg(W.hand, bname, null, lt(sol.hands[1]))) : '';

  const under = [];
  const over = [];
  if (back) {
    ['l', 'r'].forEach((side, i) => { if (front.includes(side)) under.push(arm(side, i)); });
    under.push(holdsOf(hidden));
    if (W.hand) under.push(handProp);
  }
  const bodySvg = bodyTile;
  if (back) {
    ['l', 'r'].forEach((side, i) => { if (!front.includes(side)) over.push(arm(side, i)); });
    over.push(face);
  } else {
    over.push(face);
    ['l', 'r'].forEach((side, i) => over.push(arm(side, i)));
    if (W.hand) over.push(handProp);
  }
  if (hold) over.push(holdsOf((sd) => !hidden(sd)));
  const rims = bodyRims(C, o.light?.rims ?? [], { s, tilt, L, sq, squash });

  const qx = squash?.sx ?? 1;
  const qy = squash?.sy ?? 1;
  const sx = s * (1 + sq) * qx * L;
  const sy = s * (1 - sq) * qy;
  const shadow = g({ transform: `scale(${(Math.abs(sx)).toFixed(4)} ${s.toFixed(4)})` }, contactShadow(D, dark));
  const wrap = typeof o.light?.wrap === 'function' ? o.light.wrap : (v) => v;
  const figure = g({ transform: `scale(${sx.toFixed(4)} ${sy.toFixed(4)})` }, rims ? [wrap(under.join('') + bodySvg), rims, wrap(over.join(''))] : [wrap(under.join('') + bodySvg + over.join(''))]);
  const hopT = F ? `translate(${r2(F.dx * DK)} ${r2(-(F.hop + lift) * DK)}) ` : '';
  const lit = g({ transform: `${hopT}rotate(${tilt.toFixed(2)})` }, figure);
  const tag = who ? { 'data-who': String(who), 'data-look': lookKey({ body, wear: [].concat(wear ?? []), wearColor, outfit, role: opts.role, head: opts.head, bowtie: opts.bowtie, headTone: opts.headTone }) } : {};
  tag['data-critter'] = bname;
  if (view !== 'front') tag['data-view'] = view;
  if (who) {
    // the hands on screen and what they hold, for the checks (try.mjs handProblems)
    const onScreen = toScreen(x, y, o);
    tag['data-hands'] = sol.hands.map((h) => onScreen(h).map(r2).join(' ')).join(' ');
    if (holdSides.length) tag['data-holds'] = holdSides.join(' ');
  }
  if (who) {
    const rig = [...new Set(riggedProblems(opts).map((p) => p.code).filter((c) => RIG_DRAWN_CODES.includes(c)))];
    if (rig.length) tag['data-rig'] = rig.join(' ');
  }
  return g({ ...tag, transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})` }, D.xml() + shadow + lit);
}

/**
 * Light rims on the body: bands just inside its outline on the side
 * each light comes from, drawn right after the body so the face and the arms are painted over them.
 * `rims` [{ side: [x, y] (screen direction toward the light), color (hex), level 0..1, width (screen
 * px) }]. Returns '' when there are none.
 */
export function bodyRims(C, rims, { s = 1, tilt = 0, L = 1, sq = 0, squash = null } = {}) {
  const list = (rims ?? []).filter((r) => r && r.level > 0.005 && r.side);
  if (!list.length) return '';
  const sx = s * (1 + sq) * (squash?.sx ?? 1) * L;
  const sy = s * (1 - sq) * (squash?.sy ?? 1);
  const a = (-tilt * Math.PI) / 180;
  return g({ 'data-k': 'light', 'data-light': 'rim', 'data-part': 'body-light' }, list.map((r) => {
    const l = Math.hypot(r.side[0], r.side[1]) || 1;
    const rx = (r.side[0] / l) * Math.cos(a) - (r.side[1] / l) * Math.sin(a);
    const ry = (r.side[0] / l) * Math.sin(a) + (r.side[1] / l) * Math.cos(a);
    const dx = rx * Math.sign(sx);
    const dy = ry * Math.sign(sy);
    const c = [0, -78];
    const col = r.color ?? K('yellow-lit');
    const lv = Math.max(0, Math.min(1, r.level));
    const key = `${r2(dx)}|${r2(dy)}|${col}|${r2(lv)}`;
    const id = C.D.raw('rimg', key, (n) => el('linearGradient', { id: n, gradientUnits: 'userSpaceOnUse', x1: r2(c[0] - dx * 69), y1: r2(c[1] - dy * 64), x2: r2(c[0] + dx * 69), y2: r2(c[1] + dy * 64) }, [
      el('stop', { offset: 0, 'stop-color': col, 'stop-opacity': 0 }),
      el('stop', { offset: 0.55, 'stop-color': col, 'stop-opacity': 0 }),
      el('stop', { offset: 0.85, 'stop-color': col, 'stop-opacity': r2(lv * 0.55) }),
      el('stop', { offset: 1, 'stop-color': col, 'stop-opacity': r2(lv) }),
    ].join('')));
    return el('path', { d: BODY_D, fill: 'none', stroke: id, 'stroke-width': r2((r.width ?? 6) / Math.abs(s)) });
  }));
}


/**
 * Where a critter's hands are on screen, for the same (x, y, options) as critter(): draw a held
 * prop at a hand after the critter (in front) or before it (behind).
 * @returns {{ l: [number, number], r: [number, number] }}
 */
export function handAt(x, y, opts = {}) {
  const sol = solveArms(opts);
  const at = toScreen(x, y, opts);
  return { l: at(sol.hands[0]), r: at(sol.hands[1]) };
}

/** Screen → local critter coordinates, the inverse of toScreen. */
function toLocal(x, y, o = {}) {
  const { s = 1, tilt = 0, flip = false, sq = 0, squash = null } = o;
  const a = (-tilt * Math.PI) / 180;
  const sx = s * (1 + sq) * (squash?.sx ?? 1) * (flip ? -1 : 1);
  const sy = s * (1 - sq) * (squash?.sy ?? 1);
  return ([px, py]) => {
    const dx = px - x;
    const dy = py - y;
    return [(dx * Math.cos(a) - dy * Math.sin(a)) / sx, (dx * Math.sin(a) + dy * Math.cos(a)) / sy];
  };
}
/** Local critter coordinates → screen, for the same (x, y, options) as critter(). */
function toScreen(x, y, o = {}) {
  const { s = 1, tilt = 0, flip = false, sq = 0, squash = null } = o;
  const a = (tilt * Math.PI) / 180;
  const sx = s * (1 + sq) * (squash?.sx ?? 1) * (flip ? -1 : 1);
  const sy = s * (1 - sq) * (squash?.sy ?? 1);
  return ([hx, hy]) => {
    const px = hx * sx;
    const py = hy * sy;
    return [x + px * Math.cos(a) - py * Math.sin(a), y + px * Math.sin(a) + py * Math.cos(a)];
  };
}

/**
 * A walk cycle at time t: legs swing, the body bobs, arms counter-swing. Pass the result's
 * legs and arms to critter() and draw it at y − bob. Each footfall is a `foley` "footstep" sound
 * event at the times `steps` lists.
 * @param {number} t           seconds since the walk began
 * @param {{ pace?: number, stride?: number, until?: number }} [o]  pace = steps per second
 */
export function walk(t, { pace = 2.4, stride = 26, until = Infinity } = {}) {
  const tt = Math.min(t, until);
  const ph = Math.sin(tt * pace * Math.PI);
  const stepping = t < until;
  const swing = stepping ? stride * ph : 0;
  const steps = [];
  for (let k = 1; k / pace <= Math.min(until, 30); k++) steps.push(+(k / pace).toFixed(3));
  return {
    legs: { l: swing, r: -swing },
    bob: stepping ? Math.abs(ph) * 6 : 0,
    arms: { l: [-78 - swing * 0.5, -54], r: [78 + swing * 0.5, -54] },
    steps,
  };
}

/** Where a point `d` above the feet ends up when the body is tilted (SVG degrees): for things
 *  that ride on a critter's head (a tag, a thought). */
export const above = (x, y, d, tilt) => {
  const a = (tilt * Math.PI) / 180;
  return [x + d * Math.sin(a), y - d * Math.cos(a)];
};

/** For tests and sheets: an outfit's silhouettes on a critter. Critter D draws no garment
 *  (VISUAL_SYSTEM_6 §3: an outfit becomes a role or nothing), so there are none: []. */
export function outfitShapes(_outfit, _o = {}) {
  return [];
}
export { ON_EYES };

/**
 * The palette colors an outfit draws on a critter. Critter D draws no garment (§3): an outfit is
 * translated to wear.js pieces (wearOf), which are ink, white or their job colour and never orange.
 * So: the colours of the pieces it translates to (as palette names), empty for none.
 * @param {object | null | 'none'} outfit
 * @returns {Set<string>}
 */
export function outfitColors(outfit) {
  const out = new Set();
  if (isNoOutfit(outfit)) return out;
  const W = wearOf({ outfit });
  if (W.head === 'hardhat') out.add('mustard');
  if (W.head || W.bowtie) out.add('ink');
  return out;
}

// ── The rig (4.1): pose from intent ───────────────────────────────────────────────────────
// Frame modules say WHAT a critter does (reach for the shelf, hold a mug, recoil from the
// alarm); the rig solves the arms (a two-bone arm from the shoulder, elbow bending down and
// out), the lean (toward effort, away from fear), the weight (feet braced under the lean), the
// gaze (the eyes lead to the target) and draws held things in the hand (principles §2).
//
//   act(intent, frame?)        → critter() options for one moment
//   actAt(t, keys, frame?)     → the same, eased between time-keyed intents
//   blendRig(a, b, u)          → two act() results mixed (u 0..1)
//   solveArms(opts)            → the solved arms for any critter() options
//   clearOfFace([x, y])        → a hand target moved out of the face keep-out
//   PROPS / GESTURES           → the held-prop library and the named whole-body gestures
//   gripAt / heldProp          → a held prop's screen grip, or its SVG alone at the solved hand
//   riggedProblems(state)      → what is wrong with a pose (faceless, prop off the hand…)
//
// Coordinates are local critter units: feet at (0, 0), y up is negative, scale 1, facing right
// (+x is "forward"; a flipped critter mirrors). Pass `frame` { x, y, s, flip } to give targets
// as screen points instead.

/** The arm's build. A rubber arm: bones of `bone` bend at the elbow below 2 × bone, and the
 *  arm stretches straight up to `reach`; targets further away are clamped to it. */
export const RIG = {
  shoulder: [60, -100],
  bone: 27,
  reach: 100,
  minReach: 22,
  hand: 12.5,
  arm: 8.5,
  /** The mouth line: a hand in front of the body stays below it. */
  mouthY: BY + 82,
  /** Where a hand at rest holding a light prop sits (local, right side; the left mirrors): beside
   *  the body, below the mouth line, so the prop never rides up across the face (4.1). */
  restHold: [84, -50],
  /** …and a heavy one (box, parcel, bag), lower, the arm pulled down. */
  restHeavy: [80, -44],
  eyes: [0, BY + 44],
};

const sgn = (side) => (side === 'l' ? -1 : 1);
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const mixN = (a, b, u) => a + (b - a) * u;
const mixP = (a, b, u) => [mixN(a[0], b[0], u), mixN(a[1], b[1], u)];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rot = ([x, y], deg) => {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
};
function rectDist([px, py], z) {
  const dx = Math.max(z.x - px, 0, px - (z.x + z.w));
  const dy = Math.max(z.y - py, 0, py - (z.y + z.h));
  return Math.hypot(dx, dy);
}
const quadAt = ([x0, y0, cx, cy, x1, y1], t) => [(1 - t) ** 2 * x0 + 2 * t * (1 - t) * cx + t * t * x1, (1 - t) ** 2 * y0 + 2 * t * (1 - t) * cy + t * t * y1];
/** Does an arm (a quad, `w/2` wide) pass over a face zone? */
const quadHitsFace = (q, pad = RIG.arm, zones = FACE_KEEPOUT) => zones.some((z) => Array.from({ length: 25 }, (_, k) => quadAt(q, k / 24)).some((p) => rectDist(p, z) < pad));
const handOnFace = (p, pad = RIG.hand, zones = FACE_KEEPOUT) => zones.filter((z) => rectDist(p, z) < pad).map((z) => z.part);
/** A hand inside the body's outline is drawn in front of it. */
const inFront = ([hx, hy]) => Math.abs(hx) < 62 && hy > BY && hy < -30 + RIG.hand;

/**
 * A hand target moved out of the face keep-out (the eye and mouth zones plus the hand's
 * radius) by the smallest move: down below the mouth, out to the side, or up over the brows;
 * never through the face. A clear target comes back unchanged. `zones`: the face keep-outs of
 * the critter's view (faceKeepoutFor), the front ones by default.
 * @param {[number, number]} p
 * @returns {[number, number]}
 */
export function clearOfFace(p, zones = FACE_KEEPOUT) {
  const pad = RIG.hand + 0.5;
  const ok = (q) => zones.every((z) => rectDist(q, z) >= pad);
  if (ok(p)) return [p[0], p[1]];
  const moves = (q) => zones.flatMap((z) => [[q[0], z.y + z.h + pad], [z.x - pad, q[1]], [z.x + z.w + pad, q[1]], ...(z.part === 'eyes' ? [[q[0], z.y - pad]] : [])]);
  const c1 = moves(p);
  const all = [...c1, ...c1.flatMap(moves)].filter(ok).sort((a, b) => dist(a, p) - dist(b, p));
  const m = zones.find((z) => z.part === 'mouth') ?? FACE_KEEPOUT[1];
  return all[0] ?? [p[0], m.y + m.h + pad];
}

/**
 * One arm by two-bone IK: the shoulder, the elbow and the hand for a hand target. The elbow
 * bends down and outward (never up through the face); a target past `reach` is clamped to it.
 * @param {'l'|'r'} side
 * @param {[number, number]} target
 * @param {{ shoulder?: [number, number] }} [o]
 */
export function solveArm(side, target, { shoulder = null, zones = FACE_KEEPOUT } = {}) {
  const k = sgn(side);
  const S = shoulder ?? [k * RIG.shoulder[0], RIG.shoulder[1]];
  let dx = target[0] - S[0];
  let dy = target[1] - S[1];
  let d = Math.hypot(dx, dy);
  if (d < 1e-6) [dx, dy, d] = [k * 0.3, 0.95, 1];
  const ux = dx / d;
  const uy = dy / d;
  const dd = clampN(d, RIG.minReach, RIG.reach);
  const H = [S[0] + ux * dd, S[1] + uy * dd];
  const M = [(S[0] + H[0]) / 2, (S[1] + H[1]) / 2];
  const a = RIG.bone;
  const h = dd / 2 < a ? Math.sqrt(a * a - (dd / 2) ** 2) : 3;
  const n = [-uy, ux];
  const score = (E) => k * (E[0] - M[0]) + 0.8 * (E[1] - M[1]);
  const elbows = [1, -1].map((s) => [M[0] + n[0] * h * s, M[1] + n[1] * h * s]).sort((p, q) => score(q) - score(p));
  const quad = (E) => [S[0], S[1], 2 * E[0] - M[0], 2 * E[1] - M[1], H[0], H[1]];
  const front = inFront(H);
  let E = elbows[0];
  if (front) {
    // An arm in front of the body runs down the body's side under the eyes, then in: try the
    // natural elbow, the other bend, then low elbows beside the body.
    const tries = [...elbows, [k * 64, -56], [k * 66, -48], [k * 70, -40]];
    E = tries.find((e) => !quadHitsFace(quad(e), RIG.arm, zones)) ?? tries[tries.length - 1];
  }
  return { side, shoulder: S, elbow: E, hand: H, quad: quad(E), front, clamped: d > RIG.reach + 0.5 || d < RIG.minReach - 0.5, reach: d };
}

/**
 * The arms for any critter() options. Named ARM_POSES draw exactly as before (approved art);
 * hand targets { l, r } (and `rig: true` with a pose name) go through the rig: the hands are
 * kept out of the face (unless `cover: true`, the deliberate hands-to-face) and the arms solved.
 * @returns {{ rigged: boolean, paths: number[][], quads: number[][], hands: number[][], elbows: number[][], front: string[], requested: number[][], clamped: boolean[] }}
 */
function solveArmsRig(opts = {}) {
  let arms = opts.arms ?? 'down';
  // a held wear.js hand prop (§4) with no arms given: the right hand takes D's pose for that prop
  if (opts.arms == null && (opts.role || opts.hand)) {
    let W = null;
    try { W = wearOf(opts); } catch { W = null; }
    if (W?.hand) arms = { l: ARM_POSES.down.arms[0].slice(2), r: tl(handPoint(HAND_POSE[W.hand], 1)) };
  }
  const pose = typeof arms === 'string' ? ARM_POSES[arms] ?? ARM_POSES.down : null;
  if (pose && !opts.rig) {
    const quads = pose.arms.map(armQuad);
    return { rigged: false, paths: pose.arms, quads, hands: pose.arms.map((p) => p.slice(2)), elbows: quads.map((q) => quadAt(q, 0.5)), front: pose.front ?? [], requested: pose.arms.map((p) => p.slice(2)), clamped: [false, false] };
  }
  const req = pose ? [pose.arms[0].slice(2), pose.arms[1].slice(2)] : [arms.l ?? [-74, -50], arms.r ?? [74, -50]];
  const cover = opts.cover ?? arms === 'cover';
  // the face the hands keep off is the one this view shows (none in a back view)
  let zones = FACE_KEEPOUT;
  try { const vw = viewOf(opts); zones = faceKeepoutFor(vw.view, vw.k); } catch { zones = FACE_KEEPOUT; }
  const sol = ['l', 'r'].map((side, i) => {
    const a = solveArm(side, cover ? req[i] : clearOfFace(req[i], zones), { zones });
    if (cover || !handOnFace(a.hand, RIG.hand, zones).length) return a;
    // clamped to the arm's length the hand landed on the face: swing it round the shoulder at
    // full reach to the nearest clear spot (down first)
    const [sx, sy] = a.shoulder;
    const base = Math.atan2(a.hand[1] - sy, a.hand[0] - sx);
    for (let k = 1; k <= 90; k++) {
      for (const dir of [1, -1]) {
        const ang = base + ((dir * k * 2 * Math.PI) / 180) * sgn(side);
        const p = [sx + Math.cos(ang) * RIG.reach, sy + Math.sin(ang) * RIG.reach];
        if (!handOnFace(p, RIG.hand + 0.5, zones).length) return { ...solveArm(side, p, { zones }), clamped: true };
      }
    }
    return a;
  });
  const front = opts.front ?? ['l', 'r'].filter((_, i) => sol[i].front);
  return {
    rigged: true,
    paths: sol.map((a) => [...a.shoulder, ...a.hand]),
    quads: sol.map((a) => a.quad),
    hands: sol.map((a) => a.hand),
    elbows: sol.map((a) => a.elbow),
    front,
    requested: req,
    clamped: sol.map((a) => a.clamped),
  };
}

/** Critter D's stub: the longest a drawn arm runs from its shoulder to the mitten (local px; D's
 *  longest pose, `up`, is ~37 tile units). The rig decides the direction; D decides the length. */
export const D_STUB = 34;
/**
 * The arms for any critter() options: main's rig solves the intent (named ARM_POSES draw as
 * before, hand targets { l, r } are kept off the face), then each arm is clamped to critter D's
 * stub (D_STUB from the drawn shoulder, SHOULDER_DROP below the rig's) along the solved direction,
 * so the hands, grips and held props are where D's mittens are drawn.
 * @returns {{ rigged: boolean, paths: number[][], quads: number[][], hands: number[][], elbows: number[][], front: string[], requested: number[][], clamped: boolean[] }}
 */
export function solveArms(opts = {}) {
  const sol = solveArmsRig(opts);
  const cover = opts.cover ?? opts.arms === 'cover';
  let zones = FACE_KEEPOUT;
  try { const vw = viewOf(opts); zones = faceKeepoutFor(vw.view, vw.k); } catch { zones = FACE_KEEPOUT; }
  const quads = [];
  const hands = [];
  const elbows = [];
  const paths = [];
  sol.quads.forEach((q, i) => {
    const S = [q[0], q[1] + SHOULDER_DROP];
    let H = [q[4], q[5]];
    const d = dist(S, H);
    // a hand in front of the body (D's chin / hold reach across it) keeps the rig's spot below the mouth
    const across = sol.front.includes(i === 0 ? 'l' : 'r') || Math.abs(H[0]) < 62;
    if (d > D_STUB && !across) {
      H = [S[0] + ((H[0] - S[0]) * D_STUB) / d, S[1] + ((H[1] - S[1]) * D_STUB) / d];
      // shortened onto the face: swing it outward round the drawn shoulder until it is clear
      const side = i === 0 ? 'l' : 'r';
      let def = null;
      try { def = propOf(opts.hold?.[side]); } catch { def = null; }
      const blocked = (P) => handOnFace(P, RIG.hand + 0.5, zones).length > 0
        || (def && propOverFace(propPlacement({ hands: i === 0 ? [P, sol.hands[1]] : [sol.hands[0], P], elbows: [S, S], paths: [[S[0], S[1]], [S[0], S[1]]] }, side, def, { tilt: opts.tilt ?? 0, L: opts.flip ? -1 : 1 }), zones).length > 0);
      if (!cover && blocked(H)) {
        const base = Math.atan2(H[1] - S[1], H[0] - S[0]);
        const away = i === 0 ? -1 : 1;
        for (let a = 3; a <= 180; a += 3) {
          const t = base + (((Math.cos(base) * away >= 0 ? 1 : -1) * a * Math.PI) / 180) * (H[1] < S[1] ? -away : away);
          const P = [S[0] + Math.cos(t) * D_STUB, S[1] + Math.sin(t) * D_STUB];
          if (!blocked(P)) { H = P; break; }
        }
      }
    }
    if (across || d <= D_STUB) {
      // within D's reach (or across the body): the rig's own arm, unchanged
      quads.push(q);
      hands.push([q[4], q[5]]);
      elbows.push(sol.elbows[i]);
      paths.push(sol.paths[i]);
      return;
    }
    const out = i === 0 ? -1 : 1;
    const len = Math.max(1, dist(S, H));
    // a chubby bend outward, like D's own arms
    const n = [-(H[1] - S[1]) / len, (H[0] - S[0]) / len];
    const k = n[0] * out >= 0 ? 1 : -1;
    const C = [(S[0] + H[0]) / 2 + n[0] * k * len * 0.28, (S[1] + H[1]) / 2 + n[1] * k * len * 0.28];
    quads.push([q[0], q[1], C[0], C[1], H[0], H[1]]);
    hands.push(H);
    elbows.push(quadAt([S[0], S[1], C[0], C[1], H[0], H[1]], 0.5));
    paths.push([q[0], q[1], H[0], H[1]]);
  });
  return { ...sol, quads, hands, elbows, paths };
}

// ── Held props ────────────────────────────────────────────────────────────────────────────
// A prop is drawn in its own frame: the origin is the centre of the hand that grips it, +x
// points away from the body (a left hand mirrors it), up is −y, sizes are px at scale 1
// (PX_PER_CM ≈ 2 px per cm next to a critter). `upright` props (cups, cartons, boxes) stay
// level whatever the arm does; the others turn with the forearm (`follow`). A two-handed prop
// (`grips`) is centred between the hands. The hand is drawn over the prop, so it grips it.
const cm = (v) => v * PX_PER_CM;
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const cardboard = () => { const Y = ramp('yellow'); return { lit: Y.base, base: Y.shade, shade: Y.dark, dark: K('shadow-warm') }; };
/** The held-prop library. Add your own: { draw(C, p) → SVG, box: {x,y,w,h}, upright?, follow?, grips? }. */
export const PROPS = {
  mug: {
    upright: true,
    box: { x: 6, y: -11, w: cm(8.5) + 4, h: cm(10) },
    draw: (C, p) => {
      const w = cm(8.5);
      const h = cm(10);
      return softLine(C, [[10, -6], [4, -6], [3, 4], [10, 5]], 4, p.color ?? 'blue', { shadow: false })
        + softShape(C, rect(10, -11, w, h), p.color ?? 'blue', { drop: false, form: 0.3, sheen: 0.5 })
        + softShape(C, rect(10, -4, w, 5), p.trim ?? 'white', { drop: false, form: 0.15, edge: 0.1, sheen: 0 })
        + el('ellipse', { cx: r2(10 + w / 2), cy: -11, rx: r2(w / 2), ry: 2.2, fill: K('ink-lit') });
    },
  },
  cup: {
    upright: true,
    box: { x: -8, y: -14, w: 16, h: 26 },
    draw: (C, p) => softShape(C, [[-8, -10], [8, -10], [6, 12], [-6, 12]], p.color ?? 'white', { drop: false, form: 0.3 })
      + softShape(C, rect(-9, -14, 18, 5), p.trim ?? 'ink', { drop: false, form: 0.1 })
      + softShape(C, rect(-7.5, -2, 15, 7), p.band ?? 'yellow', { drop: false, form: 0.1, edge: 0.1 }),
  },
  carton: {
    upright: true,
    box: { x: -7, y: -30, w: 14, h: cm(20) },
    draw: (C, p) => {
      const h = cm(20);
      const y0 = -30;
      return softShape(C, rect(-7, y0 + 6, 14, h - 6), p.color ?? 'white', { drop: false, form: 0.3, sheen: 0.4 })
        + softShape(C, [[-7, y0 + 6], [0, y0], [7, y0 + 6]], p.color ?? 'white', { drop: false, form: 0.15 })
        + softShape(C, rect(-7, y0 + 14, 14, 9), p.trim ?? 'blue', { drop: false, form: 0.15, edge: 0.1 });
    },
  },
  box: {
    upright: true,
    grips: [[-44, 0], [44, 0]],
    box: { x: -44, y: -20, w: 88, h: 40 },
    draw: (C) => softShape(C, rect(-44, -20, 88, 40), cardboard(), { drop: false, form: 0.35 })
      + softShape(C, rect(-6, -20, 12, 40), 'paper', { drop: false, form: 0.1, edge: 0.05, sheen: 0 })
      + el('path', { d: 'M -44 -12 L 44 -12', stroke: K('text-tertiary'), 'stroke-width': 1.2, opacity: 0.5 }),
  },
  parcel: {
    upright: true,
    grips: [[-34, 0], [34, 0]],
    box: { x: -34, y: -21, w: 68, h: 42 },
    draw: (C) => softShape(C, rect(-34, -21, 68, 42), cardboard(), { drop: false, form: 0.35 })
      + softShape(C, rect(-5, -21, 10, 42), 'paper', { drop: false, form: 0.1, edge: 0.05, sheen: 0 }),
  },
  clipboard: {
    upright: true,
    lean: -10,
    box: { x: 2, y: -44, w: 44, h: 58 },
    draw: (C, p) => softShape(C, rect(2, -44, 44, 58), p.color ?? 'blue', { drop: false, form: 0.3 })
      + el('path', { d: dOfPts(rect(6, -38, 36, 48)), fill: K('canvas') })
      + [0, 1, 2, 3].map((i) => el('path', { d: `M 11 ${-28 + i * 9} L 37 ${-28 + i * 9}`, stroke: K('text-tertiary'), 'stroke-width': 1.6 })).join('')
      + softShape(C, rect(16, -48, 16, 8), 'steel', { drop: false, gloss: 0.8 }),
  },
  card: {
    upright: true,
    box: { x: 4, y: -24, w: 20, h: 28 },
    draw: (C, p) => softShape(C, rect(4, -24, 20, 28), p.color ?? 'yellow', { drop: false, form: 0.2 })
      + softShape(C, rect(8, -18, 12, 4), p.trim ?? 'white', { drop: false, form: 0, edge: 0 })
      + softShape(C, rect(8, -10, 12, 3), p.trim ?? 'white', { drop: false, form: 0, edge: 0 }),
  },
  phone: {
    follow: 0.5,
    box: { x: -8, y: -30, w: 16, h: 32 },
    draw: (C) => softShape(C, rect(-8, -30, 16, 32), 'ink', { drop: false, gloss: 0.6 })
      + el('rect', { x: -6, y: -27, width: 12, height: 22, rx: 2, fill: ramp('blue').lit, opacity: 0.85 }),
  },
  pen: {
    follow: 1,
    box: { x: -2, y: -28, w: 4, h: 34 },
    draw: (C, p) => softLine(C, [[0, 6], [0, -26]], 4, p.color ?? 'blue', { shadow: false }),
  },
  /** a drinking glass (8 × 12 cm): clear walls, a level of `color` liquid at `level` (0..1) */
  glass: {
    upright: true,
    box: { x: -9, y: -cm(12) + 4, w: 18, h: cm(12) },
    draw: (C, p) => {
      const h = cm(12);
      const top = 4 - h;
      const lv = Math.max(0, Math.min(1, p.level ?? 0.7));
      const ly = 4 - (h - 3) * lv;
      return (lv > 0 ? softShape(C, [[-7, ly], [7, ly], [6, 2], [-6, 2]], p.color ?? 'yellow', { drop: false, form: 0.2, sheen: 0.2 }) : '')
        + el('path', { d: `M -8.5 ${r2(top)} L -6.8 4 L 6.8 4 L 8.5 ${r2(top)}`, fill: K('canvas'), 'fill-opacity': 0.25, stroke: K('paper-dark'), 'stroke-width': 1.6, 'stroke-linejoin': 'round' })
        + el('path', { d: `M -5.5 ${r2(top + 4)} L -4.6 -2`, stroke: K('canvas'), 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: 0.85 })
        + el('ellipse', { cx: 0, cy: r2(top), rx: 8.5, ry: 1.6, fill: 'none', stroke: K('paper-dark'), 'stroke-width': 1.2 });
    },
  },
  /** a bottle (7 × 24 cm), `color` glass with a `trim` label band */
  bottle: {
    upright: true,
    box: { x: -7, y: -cm(24) + 6, w: 14, h: cm(24) },
    draw: (C, p) => {
      const h = cm(24);
      const t = 6 - h;
      return softShape(C, [[-7, 6], [7, 6], [7, t + 22], [3, t + 12], [3, t], [-3, t], [-3, t + 12], [-7, t + 22]], p.color ?? 'green', { drop: false, form: 0.3, sheen: 0.5, gloss: 0.6 })
        + softShape(C, rect(-7, t + 26, 14, 12), p.trim ?? 'white', { drop: false, form: 0.1, edge: 0.05, sheen: 0 });
    },
  },
  /** a book (15 × 22 cm), held by its spine: `color` cover, white page edge */
  book: {
    upright: true,
    lean: -6,
    box: { x: 0, y: -cm(22) + 6, w: cm(15) + 2, h: cm(22) },
    draw: (C, p) => {
      const w = cm(15);
      const h = cm(22);
      return softShape(C, rect(0, 6 - h, w, h), p.color ?? 'blue', { drop: false, form: 0.3, sheen: 0.3 })
        + softShape(C, rect(w - 3, 9 - h, 4, h - 6), 'white', { drop: false, form: 0, edge: 0.05, sheen: 0 })
        + softShape(C, rect(0, 6 - h, 5, h), p.trim ?? 'ink', { drop: false, form: 0.15, edge: 0.05 });
    },
  },
  /** an envelope or letter (22 × 11 cm), the flap's V on its face */
  envelope: {
    upright: true,
    box: { x: 2, y: -cm(11) + 6, w: cm(22), h: cm(11) },
    draw: (C, p) => {
      const w = cm(22);
      const h = cm(11);
      return softShape(C, rect(2, 6 - h, w, h), p.color ?? 'white', { drop: false, form: 0.2, sheen: 0.2 })
        + el('path', { d: `M 3 ${r2(7 - h)} L ${r2(2 + w / 2)} ${r2(6 - h * 0.45)} L ${r2(1 + w)} ${r2(7 - h)}`, fill: 'none', stroke: K('paper-dark'), 'stroke-width': 1.6, 'stroke-linejoin': 'round' });
    },
  },
  /** a plate (24 cm across) carried flat, seen a little from above */
  plate: {
    upright: true,
    box: { x: -cm(12), y: -10, w: cm(24), h: 14 },
    draw: (C, p) => el('ellipse', { cx: 0, cy: -3, rx: r2(cm(12)), ry: 6.5, fill: K('paper-dark') })
      + el('ellipse', { cx: 0, cy: -4.5, rx: r2(cm(12) - 1), ry: 5.6, fill: p.color ? ramp(p.color).lit : K('canvas') })
      + el('ellipse', { cx: 0, cy: -4.2, rx: r2(cm(7)), ry: 3.2, fill: 'none', stroke: K('paper-shade'), 'stroke-width': 1.2 }),
  },
  /** a shopping tote (36 × 40 cm) hanging from its handles: `color` cloth */
  tote: {
    upright: true,
    box: { x: -cm(18), y: 2, w: cm(36), h: cm(40) + 8 },
    draw: (C, p) => {
      const w = cm(36);
      const h = cm(40);
      return softLine(C, [[-w * 0.28, 12], [-w * 0.2, 0], [w * 0.2, 0], [w * 0.28, 12]], 3.5, p.trim ?? p.color ?? 'teal', { shadow: false })
        + softShape(C, [[-w / 2, 12], [w / 2, 12], [w / 2 + 2, 12 + h], [-w / 2 - 2, 12 + h]], p.color ?? 'teal', { drop: false, form: 0.35, sheen: 0.2 });
    },
  },
  bag: {
    upright: true,
    box: { x: -14, y: 4, w: 28, h: 32 },
    draw: (C, p) => el('path', { d: 'M -7 10 Q -7 -4 0 -4 Q 7 -4 7 10', fill: 'none', stroke: K('ink-lit'), 'stroke-width': 2.5 })
      + softShape(C, [[-14, 8], [14, 8], [16, 36], [-16, 36]], p.color ?? 'paper', { drop: false, form: 0.35 }),
  },
};
function dOfPts(pts) {
  return `M ${pts.map((p) => `${r2(p[0])} ${r2(p[1])}`).join(' L ')} Z`;
}
/** A prop spec ('mug', { kind: 'mug', color }, or a custom { draw, box, … }) → its definition. A
 *  spec object may give `scale`: 'cheat' (4.2: drawn bigger so the action reads, core.js CHEAT;
 *  from its real size, its box at PX_PER_CM) or a number (that factor). The scaled box (and a
 *  two-handed prop's grips) is what the rig and the face checks use, so a cheated prop still never
 *  covers a face. */
export function propOf(spec) {
  if (!spec) return null;
  if (typeof spec === 'string') {
    if (!PROPS[spec]) throw new Error(`HX: held prop "${spec}" must be one of ${Object.keys(PROPS).join(', ')} or { draw, box }`);
    return { ...PROPS[spec], kind: spec, p: {} };
  }
  if (spec.kind) return scaled({ ...propOf(spec.kind), ...spec, p: spec }, spec.scale);
  if (typeof spec.draw !== 'function') throw new Error('HX: a custom held prop needs draw(C, p) → SVG and a box { x, y, w, h }');
  return scaled({ box: { x: -10, y: -10, w: 20, h: 20 }, ...spec, kind: spec.name ?? 'custom', p: spec }, spec.scale);
}
/** A prop definition drawn at `scale` ('cheat' or a number) about its grip (the hand's centre). */
function scaled(def, scale) {
  if (scale === undefined || scale === null) return def;
  const k = CORE.propScale(scale, [def.box.w / PX_PER_CM, def.box.h / PX_PER_CM]);
  if (k === 1) return def;
  const b = def.box;
  return { ...def, k, box: { x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k }, ...(def.grips ? { grips: def.grips.map(([x, y]) => [x * k, y * k]) } : {}) };
}

/**
 * Where a held prop sits for a solved pose, in local units: its grip point, its rotation
 * (degrees, in the critter's frame), its mirror (+1 / −1) and its box corners.
 */
function propPlacement(sol, side, def, { tilt = 0, L = 1 } = {}) {
  if (side === 'both') {
    const [l, r] = [sol.hands[0], sol.hands[1]];
    const c = mixP(l, r, 0.5);
    const ang = (Math.atan2(r[1] - l[1], r[0] - l[0]) * 180) / Math.PI;
    const rotDeg = def.upright ? clampN(ang, -8, 8) : ang;
    return { at: c, rot: rotDeg, out: 1, def };
  }
  const i = side === 'l' ? 0 : 1;
  const H = sol.hands[i];
  const E = sol.elbows[i];
  const out = Math.sign(H[0] - sol.paths[i][0]) || sgn(side);
  const fa = (Math.atan2(H[1] - E[1], (H[0] - E[0]) * out) * 180) / Math.PI;
  const follow = def.upright ? 0 : def.follow ?? 1;
  // upright: cancel the body's tilt on screen, so a mug never spills when the critter leans
  const level = -tilt * L * out;
  const rotDeg = follow * (fa + 90) + (1 - follow) * level + (def.lean ?? 0);
  return { at: H, rot: rotDeg, out, def };
}
/** A placement's box corners in local units (for checks). */
function placedBox(pl) {
  const b = pl.def.box;
  return rect(b.x, b.y, b.w, b.h).map(([x, y]) => {
    const [rx, ry] = rot([x * pl.out, y], pl.rot * pl.out);
    return [pl.at[0] + rx, pl.at[1] + ry];
  });
}
/** Does a placed prop's box overlap the face keep-out (`zones`, padded by `pad` px)? Returns the
 *  face parts it covers. */
function propOverFace(pl, zones = FACE_KEEPOUT, pad = 0) {
  const b = boxOf4(placedBox(pl));
  return zones.filter((z) => b.x < z.x + z.w + pad && b.x + b.w > z.x - pad && b.y < z.y + z.h + pad && b.y + b.h > z.y - pad).map((z) => z.part);
}
function drawPlaced(C, pl) {
  const art = pl.def.draw({ ...C, L: C.L * pl.out }, pl.def.p ?? {});
  const k = pl.def.k && pl.def.k !== 1 ? ` scale(${r2(pl.def.k)})` : '';
  return g({ transform: `translate(${r2(pl.at[0])} ${r2(pl.at[1])}) scale(${pl.out} 1) rotate(${r2(pl.rot)})${k}`, 'data-held': pl.def.kind, ...(k ? { 'data-held-scale': r2(pl.def.k) } : {}) }, pl.out * (C.L ?? 1) < 0 ? unmirrorText(art) : art);
}
/**
 * A prop in a hand that points it the other way is drawn mirrored (scale(−1 1)), so it points away
 * from the body on that side too; but printed text never mirrors (4.1). Each <text> in the drawing
 * is mirrored back about its own x, with its anchor swapped (start ↔ end), so it reads normally
 * and keeps its place on the mirrored prop. (A flipped critter mirrors everything it holds the
 * same way: a prop whose hand and flip together mirror it gets its text turned back.)
 */
export function unmirrorText(svg) {
  return String(svg).replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/g, (m, attrs, inner) => {
    const x = Number(attrs.match(/\sx="([-\d.]+)"/)?.[1] ?? 0);
    const anchor = attrs.match(/text-anchor="(start|middle|end)"/)?.[1] ?? 'start';
    const swapped = anchor === 'start' ? 'end' : anchor === 'end' ? 'start' : 'middle';
    const a2 = /text-anchor=/.test(attrs) ? attrs.replace(/text-anchor="(start|middle|end)"/, `text-anchor="${swapped}"`) : `${attrs} text-anchor="${swapped}"`;
    return `<g data-unmirror="1" transform="translate(${r2(2 * x)} 0) scale(-1 1)"><text${a2}>${inner}</text></g>`;
  });
}
/** The props in `hold` ({ l, r, both }) at the solved hands, each under its gripping hand. */
function drawHolds(C, sol, hold, { tilt = 0, L = 1, body = 'ink' } = {}) {
  const out = [];
  for (const side of ['both', 'l', 'r']) {
    const def = propOf(hold[side]);
    if (!def) continue;
    out.push(drawPlaced(C, propPlacement(sol, side, def, { tilt, L })));
    const hands = side === 'both' ? [0, 1] : [side === 'l' ? 0 : 1];
    for (const i of hands) out.push(drawHand(C, sol.hands[i][0], sol.hands[i][1], { over: sol.front.includes(i ? 'r' : 'l'), body }));
  }
  return out.join('');
}

/**
 * A held prop's grip on screen, for the same (x, y, options) as critter(): where to draw an
 * overlay prop so it sits in the hand. angle is the screen rotation in degrees, scale the
 * critter's, mirror −1 when the prop faces left.
 * @param {'l'|'r'|'both'} side
 */
export function gripAt(x, y, opts = {}, side = 'r') {
  const sol = solveArms(opts);
  const L = opts.flip ? -1 : 1;
  const def = propOf((opts.hold ?? {})[side]) ?? { upright: true, box: { x: 0, y: 0, w: 0, h: 0 }, kind: 'none' };
  const pl = propPlacement(sol, side, def, { tilt: opts.tilt ?? 0, L });
  const [sx, sy] = toScreen(x, y, opts)(pl.at);
  return { x: sx, y: sy, angle: (opts.tilt ?? 0) + pl.rot * pl.out * L, scale: opts.s ?? 1, mirror: pl.out * L };
}
/**
 * The screen boxes of the props in `opts.hold` (for the same (x, y, options) as critter()):
 * { l?, r?, both?: { box: [x0, y0, x1, y1], at: [x, y] (the box centre), kind } }. A held prop can
 * then be a shot's subject (an insert), take a label or take focus (lens.js critterAt tags it when
 * given `heldIds`).
 */
export function heldBoxes(x, y, opts = {}) {
  const out = {};
  let W = null;
  try { W = wearOf(opts); } catch { W = null; }
  if (W?.hand && !opts.hold?.r) {
    // the wear.js hand prop in the right hand (§4)
    const sol = solveArms(opts);
    const at = toScreen(x, y, opts);
    const [bx0, by0, bx1, by1] = heldPropBox(W.hand, null, lt(sol.hands[1]));
    const pts = [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]].map((p) => at(tl(p)));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    out.r = { box, at: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], kind: W.hand };
  }
  if (!opts.hold) return out;
  const sol = solveArms(opts);
  const L = opts.flip ? -1 : 1;
  const at = toScreen(x, y, opts);
  for (const side of ['both', 'l', 'r']) {
    const def = propOf(opts.hold[side]);
    if (!def) continue;
    const pts = placedBox(propPlacement(sol, side, def, { tilt: opts.tilt ?? 0, L })).map(at);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    out[side] = { box, at: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], kind: def.kind };
  }
  return out;
}

/** Just the held prop(s) in `opts.hold`, drawn at the solved hands on screen (a separate layer). */
export function heldProp(x, y, opts = {}) {
  if (!opts.hold) return '';
  const sol = solveArms(opts);
  const L = opts.flip ? -1 : 1;
  const D = defsBag();
  const C = { D, L, dark: isDark(), bodyClip: null, fill: K('ink') };
  const s = opts.s ?? 1;
  const inner = drawHolds(C, sol, opts.hold, { tilt: opts.tilt ?? 0, L, body: opts.body ?? 'ink' });
  return g({ transform: `translate(${r2(x)} ${r2(y)}) rotate(${r2(opts.tilt ?? 0)}) scale(${(s * L).toFixed(4)} ${s.toFixed(4)})` }, D.xml() + inner);
}

// ── Intents ───────────────────────────────────────────────────────────────────────────────
/**
 * Whole-body gestures: hand targets (local), a lean (degrees toward +x), squash (sq), and the
 * face that usually goes with them (an intent's own mood wins). Chest gestures keep the hands
 * below the mouth line; nothing crosses the eyes.
 */
export const GESTURES = {
  calm: { l: [-72, -50], r: [72, -50] },
  clutch: { l: [-50, -50], r: [-4, -25], lean: 5, sq: 0.07, mood: 'pained', look: [-0.3, 0.5] },
  shrug: { l: [-112, -112], r: [112, -112], sq: -0.03, mood: 'confused' },
  relief: { l: [-86, -38], r: [86, -38], sq: 0.06, mood: 'relieved', look: [0, -0.35] },
  cheer: { l: [-100, -190], r: [100, -190], sq: -0.06, mood: 'happy' },
  hips: { l: [-92, -66], r: [92, -66], lean: -2, mood: 'confident' },
  think: { l: [-72, -50], r: [26, -22], mood: 'curious', look: [0.5, -0.6] },
  wave: { l: [-72, -50], r: [104, -176], mood: 'happy' },
  feel: { l: [100, -92], r: [146, -104], lean: 6, mood: 'worried' },
  cover: { l: [-26, -96], r: [26, -96], cover: true, sq: 0.05, mood: 'surprised' },
  guard: { l: [-70, -62], r: [104, -116], lean: -8, mood: 'surprised' },
};

/**
 * One moment's intent → critter() options. Describe what the critter does; the rig solves it.
 *
 *   {
 *     gesture?: GESTURES name | ARM_POSES name   the starting body (default calm)
 *     reach?:  [x, y]            a hand goes there (the nearer free hand; `hand` to choose)
 *     point?:  [x, y]            a straight arm points at it
 *     hand?:   'l' | 'r'         which hand reaches or points
 *     hands?:  { l?, r? }        explicit hand targets (still solved and kept off the face)
 *     hold?:   { l?, r?, both? } props in the hands: a PROPS name or { kind, color } or custom
 *     carry?:  [x, y]            where a two-handed prop sits (default in front, below the mouth)
 *     inspect?: 'l' | 'r'        raise that hand's prop beside the face and look at it
 *     lookAt?: [x, y]            the eyes (and a little of the body) turn to it
 *     recoil?: [x, y]            lean away from it, the near hand up as a guard
 *     effort?: 0..1              how hard: more lean, braced feet (default 0.4)
 *     lean?:   degrees           an explicit lean (+ = toward +x), added to the solved one
 *     walk?:   { t, pace?, stride? }  walking: legs and bob from walk(), free arms swing
 *     mood?:   MOODS name        the face only
 *   }
 *
 * Returns { arms: { l, r }, rig: true, tilt, look, legs, sq, mood, hold, bob, cover, aim, reaching? }:
 * spread it into critter() (draw at y − bob). aim lists the resolved local targets; reaching the hands sent to a reach or point.
 * @param {Record<string, any>} intent
 * @param {{ x: number, y: number, s?: number, flip?: boolean } | null} [frame]
 */
export function act(intent = {}, frame = null) {
  const I = intent;
  const L = frame?.flip ? -1 : 1;
  const s = frame?.s ?? 1;
  // a screen point → local, for a body tilted by `tilt` (screen degrees)
  const local = (p, tilt) => {
    if (!p) return null;
    if (!frame) return rot(p, -tilt * L);
    const [rx, ry] = rot([p[0] - frame.x, p[1] - frame.y], -tilt);
    return [rx / (s * L), ry / s];
  };
  const AP = I.acting ?? null;
  const G = AP && I.gesture === undefined ? { l: AP.arms.l, r: AP.arms.r, sq: AP.sq } : GESTURES[I.gesture] ?? (ARM_POSES[I.gesture] ? { l: ARM_POSES[I.gesture].arms[0].slice(2), r: ARM_POSES[I.gesture].arms[1].slice(2), cover: I.gesture === 'cover' } : GESTURES.calm);
  const effort = clampN(I.effort ?? 0.4, 0, 1);
  const hold = I.hold ? { ...I.hold } : null;
  const holds = (side) => !!(hold && (hold[side] || hold.both));
  const heavy = (side) => (hold?.[side] && ['box', 'parcel', 'bag', 'tote'].includes(propOf(hold[side]).kind)) ? 1 : 0;

  // 1. lean from the targets (first pass, upright)
  const t0 = { reach: local(I.reach, 0), point: local(I.point, 0), look: local(I.lookAt, 0), recoil: local(I.recoil, 0) };
  let lean = (I.lean ?? 0) + (G.lean ?? 0);
  const aimAt = t0.reach ?? t0.point;
  if (aimAt) {
    const dx = aimAt[0];
    const far = clampN((Math.hypot(aimAt[0] - (dx >= 0 ? 60 : -60), aimAt[1] + 100) - RIG.reach * 0.8) / 60, 0, 1);
    lean += clampN(dx / 140, -1, 1) * (3 + 7 * effort) * (t0.reach ? 1 : 0.5) + Math.sign(dx) * far * 5;
  }
  if (t0.recoil) lean -= (Math.sign(t0.recoil[0]) || 1) * (6 + 8 * effort);
  if (t0.look) lean += clampN(t0.look[0] / 240, -1, 1) * 2;
  // a heavy thing in one hand pulls the body over it; the body leans away to balance
  lean += (heavy('l') - heavy('r')) * 4;
  lean = clampN(lean, -16, 16);
  const tilt = lean * L;

  // 2. the targets in the leaning body's frame
  const T = { reach: local(I.reach, tilt), point: local(I.point, tilt), look: local(I.lookAt, tilt), recoil: local(I.recoil, tilt), carry: local(I.carry, tilt) };
  const hands = { l: [...G.l], r: [...G.r] };
  const busy = { l: false, r: false };
  // the hand on the target's side: reaching across the body puts an arm over the face, and a
  // hand already holding something reaches with it (offering it, setting it down)
  const pick = (target) => I.hand ?? (target[0] >= 0 ? 'r' : 'l');
  // held things rest in the hand beside the body, below the mouth line (a resting hand that
  // carries a prop never lifts it to the face; only a reach, a point or inspect raises it)
  const resting = { l: false, r: false };
  for (const side of ['l', 'r']) {
    if (hold?.[side]) {
      const [rx, ry] = heavy(side) ? RIG.restHeavy : RIG.restHold;
      hands[side] = [sgn(side) * rx, ry];
      busy[side] = true;
      resting[side] = true;
    }
  }
  if (hold?.both) {
    const def = propOf(hold.both);
    const [g0, g1] = def.grips ?? [[-30, 0], [30, 0]];
    const c = T.carry ?? [0, -20];
    // the carried thing stays below the mouth: push it down until its top clears the face
    const top = c[1] + def.box.y;
    const m = FACE_KEEPOUT.find((z) => z.part === 'mouth');
    if (top < m.y + m.h + 1 && Math.abs(c[0]) < m.w / 2 + def.box.w / 2) c[1] += m.y + m.h + 1 - top;
    hands.l = [c[0] + g0[0], c[1] + g0[1]];
    hands.r = [c[0] + g1[0], c[1] + g1[1]];
    busy.l = busy.r = true;
  }
  if (I.hands) for (const side of ['l', 'r']) if (I.hands[side]) { hands[side] = [...I.hands[side]]; busy[side] = true; resting[side] = false; }
  let look = T.look;
  if (I.inspect) {
    const side = I.inspect === true ? (hold?.l ? 'l' : 'r') : I.inspect;
    hands[side] = [sgn(side) * 98, -92];
    busy[side] = true;
    resting[side] = false;
    const def = propOf(hold?.[side]);
    look ??= def ? [hands[side][0] + sgn(side) * (def.box.x + def.box.w / 2), hands[side][1] + def.box.y + def.box.h / 2] : hands[side];
  }
  // the hand on its way to a target (a reach or a point): it may pass in front of the body above
  // the mouth line while it travels (riggedProblems lets that one pass; never over the face)
  const moving = [];
  if (T.reach) {
    const side = pick(T.reach);
    hands[side] = T.reach;
    busy[side] = true;
    resting[side] = false;
    moving.push(side);
    look ??= T.reach;
  }
  if (T.point) {
    const side = pick(T.point);
    const S = [sgn(side) * RIG.shoulder[0], RIG.shoulder[1]];
    const d = Math.hypot(T.point[0] - S[0], T.point[1] - S[1]) || 1;
    const len = Math.min(d, RIG.reach * 0.94);
    hands[side] = [S[0] + ((T.point[0] - S[0]) / d) * len, S[1] + ((T.point[1] - S[1]) / d) * len];
    busy[side] = true;
    resting[side] = false;
    moving.push(side);
    look ??= T.point;
  }
  if (T.recoil) {
    const k = Math.sign(T.recoil[0]) || 1;
    const near = k > 0 ? 'r' : 'l';
    const far = near === 'r' ? 'l' : 'r';
    if (!busy[near]) hands[near] = [k * 104, -118];
    if (!busy[far]) hands[far] = [-k * 78, -64];
    look ??= T.recoil;
  }
  // a resting held prop that would still reach the face (a long one turned by the forearm) is
  // lowered and moved out until it clears the face keep-out
  for (const side of ['l', 'r']) {
    if (!resting[side]) continue;
    const def = propOf(hold[side]);
    for (let n = 0; n < 8; n++) {
      const sol = solveArms({ arms: { ...hands }, rig: true });
      if (!propOverFace(propPlacement(sol, side, def, { tilt, L })).length) break;
      hands[side] = [hands[side][0] + sgn(side) * 3, hands[side][1] + 6];
    }
  }
  // 3. walking: legs from walk(), the free arms swing
  let legs;
  let bob = 0;
  if (I.walk) {
    const w = walk(I.walk.t ?? 0, I.walk);
    legs = w.legs;
    bob = w.bob;
    for (const side of ['l', 'r']) if (!busy[side] && !G.cover && I.gesture === undefined) hands[side] = w.arms[side];
  } else {
    // weight: feet braced apart with effort, legs kept under the leaning body
    const spread = (Math.abs(lean) > 2 || effort > 0.5 ? 2 + 5 * effort : 0) + (T.recoil ? 4 : 0);
    legs = { l: r2(spread - lean * 0.6), r: r2(-spread - lean * 0.6) };
  }
  // 4. gaze: the eyes turn to the target (look −1..1)
  let lookV = G.look ?? null;
  if (look) {
    const v = [look[0] - RIG.eyes[0], look[1] - RIG.eyes[1]];
    const m = Math.max(Math.hypot(v[0], v[1]), 1);
    const k = Math.min(1, m / 40) / m;
    lookV = [r2(v[0] * k), r2(v[1] * k)];
  }
  // stretch up to recoil or to look high; settle under a carried load
  const up = look && lookV ? clampN(-lookV[1] - 0.6, 0, 0.4) * 0.08 : 0;
  const sq = (G.sq ?? 0) + (T.recoil ? -0.04 : 0) - up + (hold?.both ? 0.03 * effort : 0);
  const mood = I.mood ?? AP?.mood ?? G.mood ?? (T.recoil ? 'surprised' : 'neutral');
  const res = {
    arms: { l: hands.l.map(r2), r: hands.r.map(r2) },
    rig: true,
    tilt: r2(tilt),
    legs,
    sq: r2(sq),
    mood,
    hold,
    bob: r2(bob),
    cover: !!G.cover,
    aim: { ...T, look },
  };
  if (moving.length) res.reaching = moving;
  if (lookV) res.look = lookV;
  if (AP && !I.mood) res.face = AP.face;
  return res;
}

/** Two act() results mixed: hands travel on a slight arc, the gaze can lead (`ug`), the face
 *  and the held things switch at the middle of the move. */
export function blendRig(A, B, u, ug = u) {
  u = clampN(u, 0, 1);
  if (u <= 0) return A;
  if (u >= 1) return B;
  const lift = Math.sin(Math.PI * u);
  const hand = (side) => {
    const p = mixP(A.arms[side], B.arms[side], u);
    const d = dist(A.arms[side], B.arms[side]);
    return [r2(p[0]), r2(p[1] - lift * Math.min(14, d * 0.12))];
  };
  const legs = (k) => r2(mixN(A.legs?.[k] ?? 0, B.legs?.[k] ?? 0, u));
  const lookA = A.look ?? [0, 0];
  const lookB = B.look ?? [0, 0];
  return {
    ...(u < 0.5 ? A : B),
    arms: { l: hand('l'), r: hand('r') },
    tilt: r2(mixN(A.tilt ?? 0, B.tilt ?? 0, u)),
    legs: { l: legs('l'), r: legs('r') },
    sq: r2(mixN(A.sq ?? 0, B.sq ?? 0, u)),
    bob: r2(mixN(A.bob ?? 0, B.bob ?? 0, u)),
    look: mixP(lookA, lookB, clampN(ug, 0, 1)).map(r2),
    mood: u < 0.4 ? A.mood : B.mood,
    hold: u < 0.5 ? A.hold : B.hold,
    cover: u < 0.5 ? A.cover : B.cover,
    // mid-move, a hand that travels to or from a reach or a point (a pick-up, a put-down) is
    // reaching: riggedProblems lets it pass the mouth line in front of the body
    reaching: [...new Set([...(A.reaching ?? []), ...(B.reaching ?? [])])],
    ...(A.face && B.face ? { face: mixFace(A.face, B.face, u) } : {}),
  };
}
const mixFace = (A, B, u) => {
  const o = { ...B };
  for (const k of FACE_VEC) o[k] = mixN(A[k], B[k], u);
  o.aL = A.aL.map((p, i) => mixP(p, B.aL[i], u));
  o.aR = A.aR.map((p, i) => mixP(p, B.aR[i], u));
  return o;
};

/**
 * Critter D acting (acting.js): the resolved pose at time t of a performance, beats
 * [{ at, emotion, hold?, intensity?, blend?, look?, pose?, accent?, state? }] (or { beats, seed }).
 * A feeling holds until the next beat; changes blend; accents play once; a seeded life layer runs under it.
 * Returns critter() options (face, arms, rig, legs, sq, mood) plus { face, armPts, accents }; act({ acting }) takes it too.
 * @param {number} t
 * @param {Array<Record<string, any>> | { beats: Array<Record<string, any>>, seed?: string|number }} track
 * @param {{ seed?: string|number, life?: boolean }} [opts]
 */
export function actingAt(t, track, opts = {}) {
  const P = ACT.actingAt(t, track, opts);
  // the rig's hand target: D's stub hand, kept within D_STUB of the rig's drawn shoulder
  const hand = (pts, k) => {
    const H = tl(armQuadTile(pts)[2]);
    const S = [k * RIG.shoulder[0], RIG.shoulder[1] + SHOULDER_DROP];
    const d = dist(S, H);
    return (d > D_STUB ? [S[0] + ((H[0] - S[0]) * D_STUB) / d, S[1] + ((H[1] - S[1]) * D_STUB) / d] : H).map(r2);
  };
  return { ...P, arms: { l: hand(P.face.aL, -1), r: hand(P.face.aR, 1) }, rig: true, legs: { l: r2(P.face.legL), r: r2(P.face.legR) }, sq: r2(P.face.sq) };
}
/** Emote spam in a track (acting.js): [{ code, at, detail }] for short holds, too many feeling changes, accents over the rate cap or cooldown, unknown names. */
export const actingProblems = (track) => ACT.actingProblems(track);

/**
 * The pose at time t from time-keyed intents: [{ at, blend?, ...intent }] (seconds; blend is
 * the move's length, default 0.4). Each move eases in and out; the eyes start toward the next
 * target a beat before the hands (principles §2, "eyes lead").
 * @param {number} t
 * @param {Array<Record<string, any>>} keys
 * @param {{ x: number, y: number, s?: number, flip?: boolean } | null} [frame]
 */
export function actAt(t, keys, frame = null) {
  if (!keys?.length) return act({}, frame);
  const ks = [...keys].sort((a, b) => a.at - b.at);
  const LEAD = 0.15;
  let i = -1;
  for (let k = 0; k < ks.length; k++) if (ks[k].at <= t) i = k;
  const next = ks[i + 1];
  const withIntent = (k) => (k.walk ? { ...k, walk: { ...k.walk, t: t - (k.walk.from ?? k.at) } } : k);
  if (i < 0) {
    const first = act(withIntent(ks[0]), frame);
    return first;
  }
  const B = act(withIntent(ks[i]), frame);
  let out = B;
  if (i > 0) {
    const A = act(withIntent(ks[i - 1]), frame);
    const dur = ks[i].blend ?? 0.4;
    const u = ease((t - ks[i].at) / dur);
    out = blendRig(A, B, u, ease((t - ks[i].at + LEAD) / (dur * 0.6 + LEAD)));
  }
  if (next && t > next.at - LEAD) {
    const N = act(withIntent(next), frame);
    out = { ...out, look: mixP(out.look ?? [0, 0], N.look ?? [0, 0], ease((t - (next.at - LEAD)) / LEAD) * 0.6).map(r2) };
  }
  return out;
}

// ── Hands on things (world cm): reach, place, write ─────────────────────────────────────────
// A thing a critter places travels in its hand and is let go at its spot; marks a critter writes
// grow under its tool's tip. One spec drives both the acting keys and the thing (or the marks),
// so neither ever moves on its own. Coordinates are world cm [x, y, z] (feet on z 0), as a world
// actor's keys take them; "in front" is −y, toward a front camera, and the right hand is on +x.
const r1 = (v) => Math.round(v * 10) / 10;
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp3 = (a, b, u) => [mixN(a[0], b[0], u), mixN(a[1], b[1], u), mixN(a[2], b[2], u)];
const is3 = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
/** D's reach from its feet, world cm. `side` from the centre line, `up` above the floor, `depth` in front or behind. */
export const REACH_CM = Object.freeze({
  side: r1((RIG.shoulder[0] + D_STUB + RIG.hand) / PX_PER_CM),
  up: r1((-RIG.shoulder[1] - SHOULDER_DROP + D_STUB + RIG.hand) / PX_PER_CM),
  depth: 35,
});

/**
 * Why a critter with its feet at `standAt` cannot touch `target` ([] when it can). A hand sent past
 * its reach stops short, and whatever it was meant to touch moves alone.
 * @param {number[]} standAt @param {number[]} target @returns {string[]}
 */
export function reachProblems(standAt, target) {
  if (!is3(standAt) || !is3(target)) return ['reach: standAt and the target are world points [x, y, z] in cm'];
  const out = [];
  const side = Math.abs(target[0] - standAt[0]);
  const depth = Math.abs(target[1] - standAt[1]);
  const up = target[2] - standAt[2];
  const at = `[${target.map(r1).join(', ')}]`;
  if (side > REACH_CM.side) out.push(`${at} is ${r1(side)} cm to the side of the critter's feet; its hand reaches ${REACH_CM.side} cm: stand it at reachSpot(target)`);
  if (depth > REACH_CM.depth) out.push(`${at} is ${r1(depth)} cm in front of or behind the critter; its hand reaches ${REACH_CM.depth} cm: stand it at reachSpot(target)`);
  if (up > REACH_CM.up) out.push(`${at} is ${r1(up)} cm up; the critter's hand reaches ${REACH_CM.up} cm: lower the spot, or stand the critter on something`);
  if (up < 0) out.push(`${at} is below the critter's feet`);
  return out;
}

/** Where a critter's feet go to put its `hand` on `target`. Beside it on the hand's side, `gap` cm in front (−y). */
export function reachSpot(target, { hand = 'r', gap = 12 } = {}) {
  if (!is3(target)) throw new Error('reachSpot: target is a world point [x, y, z] in cm');
  const k = hand === 'l' ? -1 : 1;
  return [r1(target[0] - k * REACH_CM.side * 0.45), r1(target[1] - gap), 0];
}

const needReach = (verb, standAt, target) => {
  if (!is3(standAt)) throw new Error(`${verb}: standAt (the critter's feet, world cm) is required, so the hand can get there`);
  const bad = reachProblems(standAt, target);
  if (bad.length) throw new Error(`${verb}: out of reach: ${bad.join('; ')}`);
};

/** The furthest point toward `target` a critter at `standAt` can reach (world cm). */
export function reachToward(standAt, target) {
  const d = [target[0] - standAt[0], target[1] - standAt[1], target[2] - standAt[2]];
  // shrink the offset until every axis is inside the reach box (side, depth, up)
  const lim = [REACH_CM.side, REACH_CM.depth, REACH_CM.up];
  let k = 1;
  for (let i = 0; i < 3; i++) if (Math.abs(d[i]) > lim[i] * 0.95) k = Math.min(k, (lim[i] * 0.95) / Math.abs(d[i]));
  const p = [standAt[0] + d[0] * k, standAt[1] + d[1] * k, Math.max(0, standAt[2] + d[2] * k)];
  return p.map(r1);
}

/**
 * A critter places what it holds at `to`. Within reach, the arm reaches `to` with the thing in the
 * hand, lets go there at `release`, and comes back. Out of reach (Lucas, 2026-11-17), it tosses:
 * the arm winds back, swings toward `to`, lets go at the end of its reach, and the thing flies the
 * rest of the way on an arc and lands at `to`. Draw the thing only from `thingAt(t)` (null while
 * it is in the hand, where `hold` draws it); never animate it separately.
 * @param {{ hold: any, to: number[], at: number, dur?: number, hand?: 'l'|'r', standAt: number[], grip?: number[], lookAt?: number[], back?: number, arc?: number }} o
 *   `hold` the held drawing (a PROPS name or custom); `to` the thing's resting centre, world cm;
 *   the arm travels for `dur` s from `at`; `grip` the hand's offset from the thing's centre (cm);
 *   `arc` a toss's peak height above the straight line (cm).
 * @returns {{ keys: object[], release: number, lands: number, tossed: boolean, held: (t: number) => boolean, thingAt: (t: number) => number[] | null, hand: string }}
 */
export function handPlace({ hold, to, at, dur = 0.6, hand = 'r', standAt, grip = [0, 0, 0], lookAt = null, back = 0.45, arc = null } = {}) {
  if (!hold) throw new Error('handPlace: hold (what the hand carries) is required');
  if (!is3(to) || !Number.isFinite(at)) throw new Error('handPlace: to (world cm) and at (s) are required');
  if (!is3(standAt)) throw new Error("handPlace: standAt (the critter's feet, world cm) is required, so the hand can get there");
  const reach = add3(to, grip);
  const look = lookAt ?? to;
  const LET = 0.06;
  if (!reachProblems(standAt, reach).length) {
    const release = at + dur + LET / 2;
    const keys = [
      { at, blend: dur, hand, reach, hold: { [hand]: hold }, lookAt: look, effort: 0.6 },
      { at: at + dur, blend: LET, hand, reach, hold: {}, lookAt: look, effort: 0.4 },
      { at: at + dur + LET + 0.2, blend: back, gesture: 'calm', lookAt: look },
    ];
    return { keys, release, lands: release, tossed: false, hand, held: (t) => t < release, thingAt: (t) => (t < release ? null : [...to]) };
  }
  // A toss: wind back (away from the target), swing to the end of the reach, let go, fly, land.
  const tip = reachToward(standAt, reach);
  const away = [standAt[0] - (tip[0] - standAt[0]) * 0.35, standAt[1] - (tip[1] - standAt[1]) * 0.35, Math.max(standAt[2] + REACH_CM.up * 0.55, 0)];
  const wind = Math.max(0.18, dur * 0.4);
  const swing = Math.max(0.14, dur * 0.3);
  const release = at + wind + swing;
  const from = add3(tip, grip.map((g) => -g));
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const flight = clampN(dist / 260, 0.25, 0.8);
  const peak = arc ?? clampN(dist * 0.25, 8, 40);
  const lands = release + flight;
  const keys = [
    { at, blend: wind, hand, reach: away, hold: { [hand]: hold }, lookAt: look, effort: 0.5 },
    { at: at + wind, blend: swing, hand, reach: tip, hold: { [hand]: hold }, lookAt: look, effort: 0.9 },
    { at: release, blend: LET, hand, reach: tip, hold: {}, lookAt: look, effort: 0.5 },
    { at: lands + 0.15, blend: back, gesture: 'calm', lookAt: look },
  ];
  const thingAt = (t) => {
    if (t < release) return null;
    if (t >= lands) return [...to];
    const u = (t - release) / flight;
    const p = lerp3(from, to, u);
    return [p[0], p[1], p[2] + peak * 4 * u * (1 - u)];
  };
  return { keys, release, lands, tossed: true, hand, held: (t) => t < release, thingAt };
}

/**
 * A critter writes (or draws) marks from `from` to `to` with a held tool. `u(t)` is how much of the marks is down (0..1, give it to the drawing of the marks), `tipAt(t)`
 * is the tool's point (a world tool in an insert sits there), and `keys` move the hand with the
 * tool so its point is on the marks' growing end. Marks never grow with no tool on them.
 * @param {{ from: number[], to: number[], at: number, dur: number, tool: any, hand?: 'l'|'r', standAt: number[], grip?: number[], approach?: number, strokes?: number }} o
 *   `tool` the held tool (a PROPS name such as 'pen', or custom); `grip` the hand above the point (cm).
 */
export function handWrite({ from, to, at, dur, tool, hand = 'r', standAt, grip = [0, 0, 5], approach = 0.35, strokes = 6 } = {}) {
  if (!tool) throw new Error('handWrite: tool (the held pen or pencil) is required: marks never appear with no tool');
  if (!is3(from) || !is3(to) || !Number.isFinite(at) || !(dur > 0)) throw new Error('handWrite: from, to (world cm), at and dur (s) are required');
  needReach('handWrite', standAt, add3(from, grip));
  needReach('handWrite', standAt, add3(to, grip));
  const u = (t) => clampN((t - at) / dur, 0, 1);
  // the point runs along the line with a small lift between letters
  const tipAt = (t) => {
    const k = u(t);
    const p = lerp3(from, to, k);
    const bob = k > 0 && k < 1 ? 0.6 * Math.abs(Math.sin(k * Math.PI * strokes)) : 0;
    return [p[0], p[1], p[2] + bob];
  };
  const H = { [hand]: tool };
  const n = Math.max(2, Math.ceil(dur / 0.1));
  const keys = [{ at: at - approach, blend: approach, hand, reach: add3(from, grip), hold: H, lookAt: from, effort: 0.3 }];
  for (let i = 0; i < n; i++) {
    const tk = at + ((i + 1) * dur) / n;
    keys.push({ at: at + (i * dur) / n, blend: dur / n, hand, reach: add3(tipAt(tk), grip), hold: H, lookAt: tipAt(tk), effort: 0.3 });
  }
  keys.push({ at: at + dur, blend: 0.3, hand, reach: add3(to, [grip[0], grip[1], grip[2] + 6]), hold: H, lookAt: to, effort: 0.3 });
  return { keys, u, tipAt, writing: (t) => t >= at && t <= at + dur, hand };
}

// ── Checks ────────────────────────────────────────────────────────────────────────────────
/**
 * What is wrong with a pose, for checks (pure; no drawing). `state` is critter() options, or
 * { x, y, opts, props } where props are overlay props drawn by the frame:
 * [{ at: [x, y] (screen), hand?: 'l' | 'r', name? }].
 * Codes: faceless (no mouth or brows would draw), unknown-mood, unknown-view, hand-over-eyes,
 * hand-on-mouth, arm-across-face, hand-above-mouth (a hand in front of the body above the mouth
 * line), prop-on-face (a held prop's box, or an overlay prop's grip, over the eye or mouth zone),
 * prop-off-hand (an overlay prop more than 4 cm from its hand), overreach. The face zones follow
 * the view (faceKeepoutFor); a back view has no face to cover, and is never faceless.
 * @returns {Array<{ code: string, side?: string, detail: string }>}
 */
/** The riggedProblems codes critter() writes as data-rig on a drawn critter (overreach is clamped, so it draws fine). */
export const RIG_DRAWN_CODES = ['faceless', 'unknown-mood', 'unknown-view', 'hand-over-eyes', 'hand-on-mouth', 'arm-across-face', 'hand-above-mouth', 'prop-on-face'];

export function riggedProblems(state = {}) {
  const { x = 0, y = 0, props = [], opts: inner = null, ...restState } = state;
  const raw = inner ? { ...restState, ...inner } : restState;
  const o = { ...moodFace(raw.mood), ...raw };
  const out = [];
  if (raw.mood && !MOODS[raw.mood] && !D_MOODS[raw.mood]) out.push({ code: 'unknown-mood', detail: `mood "${raw.mood}" is not one of ${Object.keys(MOODS).join(', ')}` });
  if (o.mouth != null && !MOUTHS.includes(o.mouth)) out.push({ code: 'faceless', detail: `mouth "${o.mouth}" is not one of ${MOUTHS.join(', ')}` });
  if (o.brows != null && !BROWS.includes(o.brows)) out.push({ code: 'faceless', detail: `brows "${o.brows}" is not one of ${BROWS.join(', ')}` });
  const sol = solveArms(o);
  // a back view shows no face (the head is turned away: not faceless), so nothing can cover it
  let vw;
  try { vw = viewOf(o); } catch (e) { out.push({ code: 'unknown-view', detail: String(e.message ?? e) }); vw = { view: 'front', k: 1 }; }
  const zones = faceKeepoutFor(vw.view, vw.k);
  const cover = (o.cover ?? o.arms === 'cover') || vw.view === 'back';
  ['l', 'r'].forEach((side, i) => {
    const h = sol.hands[i];
    const front = sol.front.includes(side);
    if (!cover) {
      for (const part of handOnFace(h, RIG.hand, zones)) out.push({ code: part === 'eyes' ? 'hand-over-eyes' : 'hand-on-mouth', side, detail: `the ${side} hand at (${h.map(Math.round)}) is in the ${part} keep-out` });
      if (front && quadHitsFace(sol.quads[i], RIG.arm, zones)) out.push({ code: 'arm-across-face', side, detail: `the ${side} arm crosses the face` });
      // a hand travelling to or from a reach (act()/blendRig `reaching`) may pass above the mouth
      // line in front of the body; a resting or holding hand there is still a problem
      const travelling = Array.isArray(o.reaching) && o.reaching.includes(side);
      if (front && h[1] < RIG.mouthY && !travelling) out.push({ code: 'hand-above-mouth', side, detail: `the ${side} hand is in front of the body above the mouth line (y ${Math.round(h[1])} < ${RIG.mouthY})` });
    }
    if (sol.clamped[i]) out.push({ code: 'overreach', side, detail: `the ${side} hand target is out of reach (${Math.round(dist(sol.requested[i], [sgn(side) * RIG.shoulder[0], RIG.shoulder[1]]))} > ${RIG.reach}); it was clamped` });
  });
  if (o.hold) {
    for (const side of ['both', 'l', 'r']) {
      const def = propOf(o.hold[side]);
      if (!def) continue;
      const pl = propPlacement(sol, side, def, { tilt: o.tilt ?? 0, L: o.flip ? -1 : 1 });
      if (!cover) for (const part of propOverFace(pl, zones)) out.push({ code: 'prop-on-face', side, detail: `the held ${def.kind} covers the ${part}` });
    }
  }
  if (props.length) {
    const hs = handAt(x, y, o);
    const tol = 4 * PX_PER_CM * (o.s ?? 1);
    const local = toLocal(x, y, o);
    for (const p of props) {
      const d = p.hand ? dist(p.at, hs[p.hand]) : Math.min(dist(p.at, hs.l), dist(p.at, hs.r));
      if (d > tol) out.push({ code: 'prop-off-hand', side: p.hand, detail: `${p.name ?? 'a prop'} is ${Math.round(d / (PX_PER_CM * (o.s ?? 1)))} cm from the ${p.hand ?? 'nearest'} hand (max 4 cm): draw it with hold or at gripAt()` });
      // an overlay prop drawn over the face (its grip point in the eye or mouth zone)
      if (!cover) for (const part of handOnFace(local(p.at), 2, zones)) out.push({ code: 'prop-on-face', side: p.hand, detail: `${p.name ?? 'a prop'} is drawn over the ${part}` });
    }
  }
  return out;
}
function boxOf4(pts) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
