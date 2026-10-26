// The Explainers world kit, cast (hx-4, Critter 2.0; from hx-3 / Explainers 3.2, EX3-77): critters,
// the cast of every reel. Every character is a critter: never a person, a figure built from
// solids, or a body part. When an analogy has someone doing something, a critter does it.
// Personality comes from body language and expressions: anticipation, squash, gaze, brows, blinks.
//
// Critter 2.0 (approved still 12, SOFT 3D): the same footprint, eyes, limbs and face kit, drawn as
// a soft volume with no outline, in five layers: a volume gradient lit from the top right, a form
// shadow and edge falloff, a warm floor bounce, a soft and a sharp gloss, and glossy eyes with two
// catchlights; limbs are soft tubes; a soft contact shadow grounds it. On the dark `stage` ground
// a warm key rim lights its top-right edge and a cool counter-rim its left, so an ink critter
// never vanishes (still 09).
//
//   critter(x, y, o)       draw one (x, y = the feet); options below
//   handAt(x, y, o)        where its hands are on screen, so it can hold a prop (pen, card, key…)
//   heldScale(cm)          the scale for a held prop of that real size (CRITTER_CM, still 02)
//   walk(t, o)             a walk cycle: { legs, bob, arms } to pass back into critter()
//   MOODS                  named expressions (confident, confused, panicked, proud, sly…)
//   ARM_POSES              the arm presets
//   outfit                 garments drawn for the role (still 03; outfits.js): top, sleeves,
//                          pants, shoes, head, items, custom
//   WEAR                   the old stock accessories: only on an exact match
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

export { FACE_KEEPOUT, normalizeOutfit, outfitKey, isNoOutfit };
export { TOP_KINDS, NECKS, HEAD_KINDS, ITEMS, PALETTE, TOP_READS, ROLE_GUIDE, SCRUB_COLORS, outfitReads } from './outfits.js';

const r2 = (v) => Math.round(v * 100) / 100;
// Every color is a palette token (V-T1). The hx-4 tokens are read by name, with their own values
// as the fallback while an older core.js is loaded.
const FALLBACK = { canvas: '#FFFFFF', paper: '#F3F0EA', 'paper-lit': '#FBFAF6', 'paper-shade': '#E2DACB', 'paper-dark': '#CFC5B3', ink: '#171717', 'ink-lit': '#2B2926', 'ink-shade': '#0C0C0C', 'ink-dark': '#040404', 'text-secondary': '#525252', 'text-tertiary': '#737373', orange: '#FF5E1A', 'orange-lit': '#FF7A3D', 'orange-shade': '#E8541C', 'orange-dark': '#C8430F', 'shadow-warm': '#3B2A16', 'sun-bottom': '#EA3C3A', 'teal-lit': '#4ACFD2' };
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
 * So tweezers (12 cm) beside a critter read as tweezers, never as a sword (still 02).
 * @param {number} propCm
 * @param {number} [drawnPx]
 */
export function heldScale(propCm, drawnPx = CRITTER_PX) {
  if (!(propCm > 0) || !(drawnPx > 0)) throw new Error('HX: heldScale(propCm, drawnPx) needs positive sizes');
  return (propCm * PX_PER_CM) / drawnPx;
}

// ── The body's material (still 12, SOFT 3D) ───────────────────────────────────────────────
// The light palette bodies (4.1): a cast member in the palette's own light colors, shaded like
// orange (base the color's lit step, lit toward white, shade the color, dark its shade step), so a
// light patient or a blue visitor reads as a soft volume. Orange stays the hero's only.
const lightBody = (n) => ({ base: K(`${n}-lit`), lit: CORE.mixHex(K(`${n}-lit`), K('canvas'), 0.35), shade: K(n), dark: K(`${n}-shade`), bounce: K('paper-lit') });
const BODY = {
  orange: { base: K('orange'), lit: K('orange-lit'), shade: K('orange-shade'), dark: K('orange-dark'), bounce: K('paper-lit') },
  paper: { base: K('paper-lit'), lit: K('canvas'), shade: K('paper'), dark: K('paper-dark'), bounce: K('canvas') },
  ink: { base: K('ink-lit'), lit: K('text-secondary'), shade: K('ink'), dark: K('ink-dark'), bounce: K('text-tertiary') },
  yellow: lightBody('yellow'),
  blue: lightBody('blue'),
  teal: lightBody('teal'),
  lilac: lightBody('lilac'),
  green: lightBody('green'),
};
/** The bodies a critter may have: ink (the default cast), paper, orange (the hero) and the light
 *  palette bodies. Any other body throws: it used to fall back to ink without a word. */
export const BODIES = Object.keys(BODY);
/** The body's ramp { base, lit, shade, dark, bounce }; an unknown body throws with the list. */
export function bodyOf(body = 'ink') {
  const B = BODY[body];
  if (!B) throw new Error(`HX: critter body "${body}" must be one of ${BODIES.join(', ')} (orange is the hero's only)`);
  return B;
}
const LIMB = K('ink-lit');
/** The face's ink: brows, mouth, lashes. */
const faceInk = (body) => (body === 'ink' ? K('paper-lit') : K('ink'));

/** A superellipse (squircle) centred on (cx, cy): the body. */
function squircle(cx, cy, a, b, n = 3.3, N = 96) {
  const pts = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push(`${r2(cx + a * Math.sign(c) * Math.abs(c) ** (2 / n))} ${r2(cy + b * Math.sign(s) * Math.abs(s) ** (2 / n))}`);
  }
  return `M ${pts.join(' L ')} Z`;
}
/** The body: 132 × 112, x ±66, y −142…−30 (the hx-3 footprint). */
export const BODY_D = squircle(0, -86, 66, 56);

// ── Eyes ──────────────────────────────────────────────────────────────────────────────────
/**
 * Two glossy eyes with pupils looking toward look = [x, y] in -1..1; lid 0 open … 1 closed (a
 * blink draws a lash line in `lash`). Soft 3D: an eyeball set into the body with a socket shadow,
 * a pupil with two catchlights, a glassy sheen; the lid is the body's own color (`lidColor`, or
 * currentColor). `L` −1 mirrors the light for a flipped critter. `D` is the defs bag (one is made
 * and returned inline when absent).
 */
export function eyes(cx, cy, { gap = 34, r = 15, look = [0, 0], lid = 0, lidTilt = 0, pupil = K('ink'), pr = 0.5, lash = null, rim = null, body = 'paper', lidColor = 'currentColor', D = null, L = 1, squeeze = null } = {}) {
  const own = !D;
  const bag = D ?? defsBag();
  const all = [];
  const B = BODY[body] ?? BODY.paper;
  const dark = body === 'ink';
  [-1, 1].forEach((side, si) => {
    // `squeeze` [left, right] narrows an eye about its centre (a turned head foreshortens it)
    const out = [];
    const ex = cx + side * gap * 0.5;
    const f = squeeze?.[si] ?? 1;
    const done = () => all.push(f === 1 ? out.join('') : g({ transform: `translate(${r2(ex)} 0) scale(${f} 1) translate(${r2(-ex)} 0)` }, out));
    // the socket: a soft shadow the eyeball sits in
    out.push(el('circle', { cx: ex, cy: r2(cy + 1.8), r: r2(r + 1.2), fill: dark ? K('ink-dark') : B.dark, opacity: dark ? 0.55 : 0.32, filter: bag.blur(1.8) }));
    if (lid >= 0.92) {
      // closed: the lid over the socket, and the lash line
      out.push(el('circle', { cx: ex, cy, r, fill: lidColor }));
      if (lash) out.push(el('path', { d: `M ${r2(ex - r * 0.85)} ${cy + 1} Q ${ex} ${r2(cy + r * 0.6)} ${r2(ex + r * 0.85)} ${cy + 1}`, fill: 'none', stroke: lash, 'stroke-width': 4.5, 'stroke-linecap': 'round' }));
      done();
      return;
    }
    out.push(el('circle', { cx: ex, cy, r, fill: bag.rg([[0, K('canvas')], [0.55, K('paper-lit')], [0.85, K('paper-shade')], [1, K('paper-dark')]], L > 0 ? 0.58 : 0.42, 0.34, 0.72), stroke: rim ?? undefined, 'stroke-width': rim ? 2 : undefined }));
    // the brow of the socket shades the top of the eyeball
    const ec = bag.clip(el('circle', { cx: 0, cy: 0, r }));
    out.push(g({ transform: `translate(${ex} ${cy})`, 'clip-path': ec }, el('ellipse', { cx: 0, cy: r2(-r * 0.95), rx: r, ry: r2(r * 0.42), fill: K('shadow-warm'), opacity: 0.2, filter: bag.blur(2.2) })));
    const px = ex + look[0] * r * 0.42;
    const py = cy + look[1] * r * 0.42;
    const pR = r * pr;
    out.push(el('circle', { cx: r2(px), cy: r2(py), r: r2(pR), fill: pupil === K('ink') ? bag.rg([[0, K('text-secondary')], [0.45, K('ink')], [1, K('ink-dark')]], L > 0 ? 0.62 : 0.38, 0.3, 0.78) : pupil }));
    // two catchlights: the key (top right) and a small fill (bottom left)
    const kx = px + pR * 0.34 * L;
    const ky = py - pR * 0.4;
    out.push(el('ellipse', { cx: r2(kx), cy: r2(ky), rx: r2(pR * 0.4), ry: r2(pR * 0.32), fill: '#FFFFFF', transform: `rotate(${-20 * L} ${r2(kx)} ${r2(ky)})` }));
    out.push(el('circle', { cx: r2(px - pR * 0.36 * L), cy: r2(py + pR * 0.38), r: r2(pR * 0.16), fill: '#FFFFFF', opacity: 0.9 }));
    // a glassy sheen across the eyeball
    const s0 = [ex - r * 0.62 * L, cy - r * 0.35];
    const s1 = [ex + r * 0.1 * L, cy - r * 0.8];
    out.push(el('path', { d: `M ${r2(s0[0])} ${r2(s0[1])} A ${r2(r * 0.78)} ${r2(r * 0.78)} 0 0 ${L > 0 ? 1 : 0} ${r2(s1[0])} ${r2(s1[1])}`, fill: 'none', stroke: '#FFFFFF', 'stroke-width': 2.2, 'stroke-linecap': 'round', opacity: 0.7 }));
    if (lid > 0) {
      const ly = cy - r + 2 * r * lid;
      const tilt = side * lidTilt;
      const lc = bag.clip(el('circle', { cx: ex, cy, r: r + 0.3 }));
      out.push(g({ 'clip-path': lc }, [
        el('path', { d: `M ${ex - r - 3} ${r2(ly - tilt)} L ${ex + r + 3} ${r2(ly + tilt)} L ${ex + r + 3} ${cy - r - 5} L ${ex - r - 3} ${cy - r - 5} Z`, fill: lidColor }),
        el('path', { d: `M ${ex - r - 3} ${r2(ly - tilt + 2)} L ${ex + r + 3} ${r2(ly + tilt + 2)}`, stroke: K('ink-dark'), 'stroke-opacity': 0.22, 'stroke-width': 4, filter: bag.blurU(1.6) }),
      ]));
    }
    done();
  });
  return (own ? bag.xml() : '') + all.join('');
}

// ── Arms ──────────────────────────────────────────────────────────────────────────────────
// Each preset: [[shoulder x, y, hand x, y] left, [...] right], relative to the feet (body spans
// x ±66, y −142…−30). `front` lists the arms drawn over the body (a hand in front of it).
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
 * Named expressions. A mood is the face only (4.1): eyes, lids, pupils, brows, mouth. It never
 * sets the arms, the legs or the body's tilt; a pose comes from `arms` or an intent (act()).
 * Every mood has a mouth and brows: a neutral face is calm, never blank.
 */
export const MOODS = {
  neutral: { mouth: 'calm', brows: 'calm' },
  happy: { mouth: 'smile', brows: 'up' },
  confident: { lid: 0.32, lidTilt: 3, mouth: 'smile', brows: 'flat' },
  proud: { lid: 0.55, mouth: 'grin', brows: 'up' },
  sly: { lid: 0.45, lidTilt: -4, mouth: 'smirk', brows: 'raised', look: [0.6, 0] },
  confused: { mouth: 'wobble', brows: 'raised', look: [0.4, -0.5] },
  worried: { mouth: 'wobble', brows: 'worried', look: [-0.3, 0.2] },
  panicked: { mouth: 'o', brows: 'worried', pr: 0.32 },
  surprised: { mouth: 'o', brows: 'high', pr: 0.36 },
  sad: { mouth: 'frown', brows: 'worried', look: [0, 0.6], lid: 0.25 },
  angry: { mouth: 'grit', brows: 'angry' },
  focused: { lid: 0.3, mouth: 'flat', brows: 'angry', look: [0.6, 0.3] },
  pained: { lid: 0.42, lidTilt: -3, mouth: 'grit', brows: 'worried' },
  relieved: { lid: 0.5, mouth: 'smile', brows: 'up', look: [0, -0.2] },
  curious: { mouth: 'calm', brows: 'raised', pr: 0.56 },
};
/** The face keys a mood may set; anything else in a mood is ignored. */
export const FACE_KEYS = ['look', 'lid', 'lidTilt', 'pr', 'mouth', 'brows'];
export const MOUTHS = ['calm', 'o', 'flat', 'smile', 'grin', 'smirk', 'frown', 'wobble', 'grit'];
export const BROWS = ['calm', 'flat', 'up', 'high', 'worried', 'angry', 'raised'];
/** A mood's face settings only. */
export function moodFace(mood) {
  const m = MOODS[mood] ?? MOODS.neutral;
  return Object.fromEntries(Object.entries(m).filter(([k]) => FACE_KEYS.includes(k)));
}

function mouthPath(kind, mx, my, face, D) {
  const o = { fill: 'none', stroke: face, 'stroke-width': 5.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  mx = r2(mx);
  switch (kind) {
    case 'o': return el('ellipse', { cx: mx, cy: my + 2, rx: 9, ry: 11, fill: face }) + el('ellipse', { cx: mx, cy: my + 7, rx: 5, ry: 3.5, fill: K('sun-bottom'), opacity: face === K('paper-lit') ? 0 : 0.75 });
    case 'flat': return el('path', { ...o, d: `M ${mx - 12} ${my} L ${mx + 12} ${my + 2}` });
    case 'smile': return el('path', { ...o, d: `M ${mx - 14} ${my - 4} Q ${mx} ${my + 10} ${mx + 14} ${my - 4}` });
    case 'grin': {
      // a grin with a small tongue, clipped inside the mouth
      const cp = D.clip(el('path', { d: 'M -20 -6 Q 0 18 20 -6 Z' }));
      return g({ transform: `translate(${mx} ${my})` }, el('path', { d: 'M -20 -6 Q 0 18 20 -6 Z', fill: face }) + g({ 'clip-path': cp }, el('ellipse', { cx: 2, cy: 9, rx: 10, ry: 6, fill: K('sun-bottom'), opacity: face === K('paper-lit') ? 0.7 : 0.8 })));
    }
    case 'smirk': return el('path', { ...o, d: `M ${mx - 12} ${my + 2} Q ${mx + 4} ${my + 6} ${mx + 16} ${my - 6}` });
    case 'frown': return el('path', { ...o, d: `M ${mx - 14} ${my + 6} Q ${mx} ${my - 6} ${mx + 14} ${my + 6}` });
    case 'wobble': return el('path', { ...o, d: `M ${mx - 16} ${my + 2} Q ${mx - 8} ${my - 5} ${mx} ${my + 2} Q ${mx + 8} ${my + 9} ${mx + 16} ${my + 2}` });
    case 'grit': return el('path', { ...o, d: `M ${mx - 16} ${my + 2} L ${mx - 6} ${my - 3} L ${mx + 4} ${my + 3} L ${mx + 14} ${my - 3}` });
    // calm: a small relaxed curve, the face at rest (and the fallback: a face always has a mouth)
    default: return el('path', { ...o, d: `M ${mx - 10} ${my - 1} Q ${mx} ${my + 5} ${mx + 10} ${my - 1}` });
  }
}

function browPaths(kind, cy, gap, face) {
  const o = { fill: 'none', stroke: face, 'stroke-width': 5.5, 'stroke-linecap': 'round' };
  const y = cy - 27;
  const L = -gap / 2;
  const R = gap / 2;
  const pair = (l, r) => el('path', { ...o, d: `M ${L - 12} ${y + l[0]} L ${L + 10} ${y + l[1]}` }) + el('path', { ...o, d: `M ${R - 10} ${y + r[0]} L ${R + 12} ${y + r[1]}` });
  switch (kind) {
    case 'flat': return pair([0, 0], [0, 0]);
    case 'up': return pair([-2, -6], [-6, -2]);
    case 'high': return pair([-10, -14], [-14, -10]);
    case 'worried': return pair([-2, -10], [-10, -2]);
    case 'angry': return pair([-8, 2], [2, -8]);
    case 'raised': return pair([0, 0], [-12, -8]);
    // calm: level and a touch soft at the outer ends (the fallback: a face always has brows)
    default: return pair([1, -2], [-2, 1]);
  }
}

// ── Old stock accessories (WEAR): an exact match only ─────────────────────────────────────
// The hx-3 role accessories, kept so old projects still render and so a role that is exactly
// "a chef" or "a graduate" can still use them. New reels draw an `outfit` for the role (still 03:
// "the bank is only used if there's an exact match"). Drawn soft-shaded, no ink outline.
//
// HARD CONSTRAINT (EX3-103, Lucas): nothing a critter wears covers or crowds its eyes or mouth.
// Every accessory stays outside FACE_KEEPOUT: hats sit above the brows, the headset mic stops at
// the cheek, the backpack strap runs along the body's edge, and the scarf, bowtie and apron sit at
// the base, below the mouth. Glasses are the one exception: they are worn over the eyes.
// tests/explainers-kit.test.ts measures every accessory against these zones.
export const WEAR = ['cap', 'tophat', 'chef', 'gradcap', 'glasses', 'headset', 'apron', 'backpack', 'bowtie', 'scarf'];
/** The accessories that are allowed over the eyes. */
export const WEAR_ON_EYES = ['glasses'];

/** The colors a critter's accessories are drawn in, from its body and wearColor. */
function wearContext(body, wearColor, D) {
  const light = body !== 'ink';
  const accName = wearColor === 'orange' ? 'orange' : light ? 'ink' : 'paper';
  const R = ramp(accName);
  return {
    acc: R.base,
    accFill: D.lg([[0, R.lit], [0.5, R.base], [1, R.shade]], 0.85, 0, 0.15, 1),
    dark: R.dark,
    face: light ? K('ink') : K('paper-lit'),
    // a detail in the accent (the tophat band, the tassel): yellow, never orange (EX3-139)
    contrast: accName === 'orange' ? K('ink') : ramp('yellow').base,
  };
}

function wearBehind(items, ctx) {
  const out = [];
  if (items.includes('backpack')) {
    out.push(el('rect', { x: -86, y: -136, width: 70, height: 92, rx: 18, fill: ctx.accFill }));
    out.push(el('rect', { x: -80, y: -96, width: 44, height: 34, rx: 8, fill: 'none', stroke: ctx.dark, 'stroke-width': 2.5, opacity: 0.6 }));
  }
  return out;
}

function wearFront(items, ctx, by) {
  const { acc, accFill, dark, face, contrast } = ctx;
  const detail = { fill: 'none', stroke: dark, 'stroke-width': 2.5, opacity: 0.6 };
  const out = [];
  // The base, below the mouth: a waist apron hanging over the tops of the legs, a scarf wrapped
  // round the bottom of the body with its tail down one side, a small bowtie at the hem.
  if (items.includes('apron')) {
    out.push(el('path', { d: `M -42 ${by + 109} L 42 ${by + 109} L 46 ${by + 136} Q 0 ${by + 142} -46 ${by + 136} Z`, fill: accFill }));
    out.push(el('rect', { x: -14, y: by + 116, width: 28, height: 12, rx: 3, ...detail }));
    out.push(el('rect', { x: -52, y: by + 105, width: 104, height: 8, rx: 4, fill: accFill }));
  }
  if (items.includes('scarf')) {
    out.push(el('path', { d: `M 26 ${by + 114} L 34 ${by + 150} L 52 ${by + 146} L 46 ${by + 110} Z`, fill: accFill }));
    out.push(el('path', { d: `M 33 ${by + 142} L 51 ${by + 138}`, ...detail }));
    out.push(el('path', { d: `M -62 ${by + 100} Q 0 ${by + 116} 62 ${by + 100} L 62 ${by + 114} Q 0 ${by + 130} -62 ${by + 114} Z`, fill: accFill }));
  }
  if (items.includes('bowtie')) {
    out.push(el('path', { d: `M 0 ${by + 112} L -24 ${by + 105} L -24 ${by + 119} Z M 0 ${by + 112} L 24 ${by + 105} L 24 ${by + 119} Z`, fill: accFill }));
    out.push(el('circle', { cx: 0, cy: by + 112, r: 5.5, fill: acc }));
  }
  if (items.includes('backpack')) {
    out.push(el('path', { d: `M -57 ${by + 20} Q -64 ${by + 58} -56 ${by + 100}`, fill: 'none', stroke: acc, 'stroke-width': 9, 'stroke-linecap': 'round' }));
  }
  if (items.includes('glasses')) {
    const gy = by + 44;
    const rim = face === K('paper-lit') ? K('paper-lit') : K('ink');
    out.push(el('circle', { cx: -25, cy: gy, r: 21, fill: 'none', stroke: rim, 'stroke-width': 4.5 }));
    out.push(el('circle', { cx: 25, cy: gy, r: 21, fill: 'none', stroke: rim, 'stroke-width': 4.5 }));
    out.push(el('path', { d: `M -5 ${gy - 2} Q 0 ${gy - 6} 5 ${gy - 2}`, fill: 'none', stroke: rim, 'stroke-width': 4 }));
  }
  if (items.includes('headset')) {
    // the mic sits out at the cheek, clear of the mouth
    out.push(el('path', { d: `M -70 ${by + 40} Q -70 ${by - 26} 0 ${by - 26} Q 70 ${by - 26} 70 ${by + 40}`, fill: 'none', stroke: acc, 'stroke-width': 8, 'stroke-linecap': 'round' }));
    out.push(el('rect', { x: 58, y: by + 28, width: 22, height: 34, rx: 8, fill: accFill }));
    out.push(el('path', { d: `M 68 ${by + 60} Q 66 ${by + 84} 50 ${by + 86}`, fill: 'none', stroke: acc, 'stroke-width': 5, 'stroke-linecap': 'round' }));
    out.push(el('circle', { cx: 45, cy: by + 86, r: 6, fill: acc }));
  }
  // Hats sit on the crown, above the brows.
  if (items.includes('cap')) {
    out.push(el('path', { d: `M -56 ${by + 2} Q -54 ${by - 46} 0 ${by - 48} Q 54 ${by - 46} 56 ${by + 2} Z`, fill: accFill }));
    out.push(el('path', { d: `M 22 ${by - 2} L 104 ${by - 6} Q 108 ${by + 2} 96 ${by + 4} L 22 ${by + 4} Z`, fill: accFill }));
    out.push(el('circle', { cx: 0, cy: by - 48, r: 6, fill: acc }));
  }
  if (items.includes('tophat')) {
    out.push(el('rect', { x: -80, y: by - 14, width: 160, height: 16, rx: 6, fill: accFill }));
    out.push(el('rect', { x: -48, y: by - 104, width: 96, height: 92, rx: 4, fill: accFill }));
    out.push(el('rect', { x: -48, y: by - 38, width: 96, height: 14, fill: contrast }));
  }
  if (items.includes('chef')) {
    const P = ramp('paper');
    const pf = `url(#${id('kchefw')})`;
    out.push(el('linearGradient', { id: id('kchefw'), x1: 0.85, y1: 0, x2: 0.15, y2: 1 }, el('stop', { offset: 0, 'stop-color': K('canvas') }) + el('stop', { offset: 0.6, 'stop-color': P.base }) + el('stop', { offset: 1, 'stop-color': P.shade })));
    out.push(el('rect', { x: -46, y: by - 34, width: 92, height: 38, rx: 4, fill: pf }));
    out.push(el('path', { d: `M -46 ${by - 30} Q -78 ${by - 64} -40 ${by - 84} Q -30 ${by - 116} 0 ${by - 104} Q 30 ${by - 120} 42 ${by - 86} Q 80 ${by - 66} 46 ${by - 30} Z`, fill: pf }));
  }
  if (items.includes('gradcap')) {
    out.push(el('path', { d: `M -40 ${by - 4} L -40 ${by - 28} L 40 ${by - 28} L 40 ${by - 4} Z`, fill: accFill }));
    out.push(el('path', { d: `M -96 ${by - 40} L 0 ${by - 70} L 96 ${by - 40} L 0 ${by - 12} Z`, fill: accFill }));
    out.push(el('path', { d: `M 0 ${by - 41} L 70 ${by - 34} L 74 ${by + 10}`, fill: 'none', stroke: contrast, 'stroke-width': 4, 'stroke-linecap': 'round' }));
    out.push(el('circle', { cx: 74, cy: by + 14, r: 7, fill: contrast }));
  }
  return out;
}

/** Just the accessories, as critter() draws them on a critter at the origin at scale 1 (for the
 *  face keep-out test and sheets): { behind, front, defs } SVG strings. */
export function wearDrawing(wear, { body = 'ink', wearColor = null } = {}) {
  const D = defsBag();
  const ctx = wearContext(body, wearColor, D);
  return { behind: wearBehind(wear, ctx).join(''), front: wearFront(wear, ctx, BY).join(''), defs: D.xml() };
}

// ── The look (EX3-107) ────────────────────────────────────────────────────────────────────
/**
 * A critter's look, the part that never changes during a reel (EX3-107): its body, its outfit and
 * any stock accessories. Pose, mood, scale and gaze change; this does not.
 * `body|wear+wear|wearColor`, then `|<outfit key>` when it wears an outfit.
 * @param {{ body?: string, wear?: string[] | string, wearColor?: string | null, outfit?: object | null }} [look]
 * @returns {string}
 */
export function lookKey({ body = 'ink', wear = [], wearColor = null, outfit = null } = {}) {
  const base = `${body}|${[].concat(wear ?? []).map(String).sort().join('+')}|${wearColor ?? ''}`;
  return isNoOutfit(outfit) ? base : `${base}|${outfitKey(outfit)}`;
}

// ── Pieces of the critter ─────────────────────────────────────────────────────────────────
const armQuad = ([x0, y0, x1, y1]) => [x0, y0, (x0 + x1) / 2 + (x1 > 0 ? 8 : -8), (y0 + y1) / 2 - 10, x1, y1];

function drawArm(C, quad, { over = false, body, sleeve = '', after = '' }) {
  const { D, L } = C;
  const [x0, y0, cx, cy, x1, y1] = quad;
  const d = `M ${x0} ${y0} Q ${r2(cx)} ${r2(cy)} ${x1} ${y1}`;
  const cap = { fill: 'none', 'stroke-linecap': 'round' };
  const out = [];
  if (over) out.push(el('path', { d, ...cap, stroke: body === 'ink' ? K('ink-dark') : K('shadow-warm'), 'stroke-opacity': body === 'ink' ? 0.6 : 0.3, 'stroke-width': body === 'ink' ? 22 : 18, transform: `translate(${-3 * L} ${body === 'ink' ? 4 : 5})`, filter: D.blurU(3) }));
  // on an ink body an arm in front gets a faint lit edge, so ink on ink still reads as an arm
  if (over && body === 'ink') out.push(el('path', { d, ...cap, stroke: K('text-secondary'), 'stroke-width': 20 }));
  out.push(el('path', { d, ...cap, stroke: LIMB, 'stroke-width': 17 }));
  out.push(el('path', { d, ...cap, stroke: K('text-tertiary'), 'stroke-opacity': 0.75, 'stroke-width': 5, transform: `translate(${1.5 * L} -3.5)`, filter: D.blurU(1.6) }));
  out.push(sleeve);
  out.push(after);
  out.push(drawHand(C, x1, y1, { over, body }));
  return out.join('');
}

/** The hand: a round mitten a little wider than the arm, so it can grip a prop. */
function drawHand(C, x1, y1, { over = false, body = 'ink' } = {}) {
  const { D, L } = C;
  x1 = r2(x1);
  y1 = r2(y1);
  const out = [];
  if (over && body === 'ink') out.push(el('circle', { cx: x1, cy: y1, r: 14, fill: K('text-secondary') }));
  out.push(el('circle', { cx: x1, cy: y1, r: 12.5, fill: D.rg([[0, K('text-tertiary')], [0.4, K('ink-lit')], [1, K('ink-shade')]], L > 0 ? 0.66 : 0.34, 0.3, 0.8) }));
  out.push(el('ellipse', { cx: r2(x1 + 4 * L), cy: r2(y1 - 5), rx: 4, ry: 2.6, fill: K('canvas'), opacity: 0.45, transform: `rotate(${-25 * L} ${r2(x1 + 4 * L)} ${r2(y1 - 5)})` }));
  return out.join('');
}

function drawBody(C, body, { view = 'front', k = 1 } = {}) {
  const { D, L, dark } = C;
  const B = bodyOf(body);
  const ink = body === 'ink';
  const paper = body === 'paper';
  const out = [];
  out.push(el('path', { d: BODY_D, fill: D.rg([[0, B.lit], [0.45, B.base], [1, B.shade]], L > 0 ? 0.72 : 0.28, 0.16, 1) }));
  out.push(g({ 'clip-path': C.bodyClip }, [
    // form shadow: the edge falls off, the low side away from the light is in shade
    el('path', { d: BODY_D, fill: 'none', stroke: B.dark, 'stroke-width': 20, opacity: ink ? 0.85 : paper ? 0.34 : 0.32, filter: D.blur(9) }),
    el('ellipse', { cx: -52 * L, cy: -40, rx: 70, ry: 40, fill: B.dark, opacity: ink ? 0.8 : paper ? 0.32 : 0.34, filter: D.blur(16) }),
    // bounce: the floor lights the base (warm on the stage), the key light the crown
    el('ellipse', { cx: 6 * L, cy: -28, rx: 50, ry: 7, fill: dark ? K('orange-lit') : B.bounce, opacity: dark ? (ink ? 0.4 : 0.3) : ink ? 0.55 : body === 'orange' ? 0.42 : 0.6, filter: D.blur(4.5) }),
    el('ellipse', { cx: 16 * L, cy: -134, rx: 52, ry: 18, fill: dark ? K('paper-lit') : K('canvas'), opacity: ink ? (dark ? 0.16 : 0.12) : 0.3, filter: D.blur(10) }),
    // a turned view: the far side of the body is its side plane, turned from the lens and shaded
    view === 'three-quarter' ? el('ellipse', { cx: -62 * k, cy: -86, rx: 28, ry: 64, fill: B.dark, opacity: ink ? 0.6 : 0.4, filter: D.blur(10) }) : '',
  ]));
  // gloss: a soft specular and a sharp one, top right
  out.push(el('ellipse', { cx: 34 * L, cy: -122, rx: 17, ry: 9, transform: `rotate(${-26 * L} ${34 * L} -122)`, fill: K('canvas'), opacity: ink ? 0.42 : paper ? 0.95 : 0.7, filter: D.blur(3.2) }));
  out.push(el('ellipse', { cx: 38 * L, cy: -125, rx: 7, ry: 3.2, transform: `rotate(${-26 * L} ${38 * L} -125)`, fill: K('canvas'), opacity: ink ? 0.55 : 0.85, filter: D.blur(0.8) }));
  return out.join('');
}

function drawLegs(C, legRot, legLen, O) {
  const { D, L } = C;
  const out = [];
  [[-26, legRot[0]], [26, legRot[1]]].forEach(([lx, rot]) => {
    const x = lx - 10.5;
    const fill = D.lg(L > 0 ? [[0, K('ink-shade')], [0.55, K('ink-lit')], [1, K('text-secondary')]] : [[0, K('text-secondary')], [0.45, K('ink-lit')], [1, K('ink-shade')]], 0, 0, 1, 0);
    const inner = [
      el('rect', { x, y: -34, width: 21, height: legLen + 2, rx: 10, fill }),
      el('rect', { x: L > 0 ? x + 11 : x + 5, y: -28, width: 5, height: legLen - 12, rx: 2.5, fill: K('text-tertiary'), opacity: 0.45, filter: D.blur(1.4) }),
      O ? drawLeg(C, O, x, legLen) : '',
    ];
    out.push(g({ transform: `rotate(${rot} ${lx} -32)` }, inner));
  });
  return out.join('');
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

/** The stage's rim light (still 09): a warm key rim on the top-right edge of the silhouette, a
 *  cool counter-rim on the left. A filter on the whole critter, so garments and limbs get it too. */
function rimFilter(D, s, L) {
  const k = r2(Math.max(0.6, 2.4 * s));
  const c = r2(Math.max(0.5, 2 * s));
  const b = r2(Math.max(0.3, 0.7 * s));
  return D.raw('rim', `${k}|${c}|${b}|${L}`, (n) => el('filter', { id: n, x: '-25%', y: '-25%', width: '150%', height: '150%', 'color-interpolation-filters': 'sRGB' }, [
    el('feOffset', { in: 'SourceAlpha', dx: -k * L, dy: k, result: 'ks' }),
    el('feComposite', { in: 'SourceAlpha', in2: 'ks', operator: 'out', result: 'ke' }),
    el('feGaussianBlur', { in: 'ke', stdDeviation: b, result: 'kb' }),
    el('feFlood', { 'flood-color': K('orange-lit'), 'flood-opacity': 0.85, result: 'kc' }),
    el('feComposite', { in: 'kc', in2: 'kb', operator: 'in', result: 'key' }),
    el('feOffset', { in: 'SourceAlpha', dx: c * L, dy: 0, result: 'cs' }),
    el('feComposite', { in: 'SourceAlpha', in2: 'cs', operator: 'out', result: 'ce' }),
    el('feGaussianBlur', { in: 'ce', stdDeviation: b, result: 'cb' }),
    el('feFlood', { 'flood-color': K('teal-lit'), 'flood-opacity': 0.6, result: 'cc' }),
    el('feComposite', { in: 'cc', in2: 'cb', operator: 'in', result: 'cool' }),
    el('feMerge', {}, el('feMergeNode', { in: 'SourceGraphic' }) + el('feMergeNode', { in: 'key' }) + el('feMergeNode', { in: 'cool' })),
  ].join('')));
}

// ── Views (4.1) ───────────────────────────────────────────────────────────────────────────
/** The ways a critter can face the lens. front: the approved Critter 2.0 face; three-quarter:
 *  turned toward `side`, its face foreshortened onto the near side of the body; back: turned
 *  away (over-the-shoulder shots), the back of its body and outfit with the lost profile (the
 *  edge of one eye and brow) on `side`. A back view is not faceless: the head is turned away. */
export const VIEWS = ['front', 'three-quarter', 'back'];
export const SIDES = ['left', 'right'];
/** How far the face slides toward `side` in a three-quarter view, and how much it narrows. */
export const THREE_QUARTER = { shift: 14, squeeze: 0.82, farEye: 0.72 };
/**
 * A critter's view and the local direction it turns (k = +1 toward local +x, its "forward"):
 * `side` is on SCREEN (so a flipped critter told side 'right' still turns right); with no side it
 * turns forward (right, or left when flipped). Unknown views or sides throw.
 * @returns {{ view: string, k: number }}
 */
export function viewOf({ view = 'front', side = null, flip = false } = {}) {
  if (!VIEWS.includes(view)) throw new Error(`HX: critter view "${view}" must be one of ${VIEWS.join(', ')}`);
  if (side !== null && side !== undefined && !SIDES.includes(side)) throw new Error(`HX: critter side "${side}" must be left or right`);
  const L = flip ? -1 : 1;
  const k = side ? (side === 'left' ? -1 : 1) * L : 1;
  return { view, k };
}
/** The face keep-outs for a view (local units): the front ones, moved and narrowed onto the near
 *  side in a three-quarter view; none in a back view (no face is seen). */
export function faceKeepoutFor(view = 'front', k = 1) {
  if (view === 'back') return [];
  if (view !== 'three-quarter') return FACE_KEEPOUT;
  const { shift, squeeze } = THREE_QUARTER;
  return FACE_KEEPOUT.map((z) => {
    const xs = [z.x, z.x + z.w].map((x) => x * squeeze + shift * k);
    return { ...z, x: Math.min(...xs), w: Math.abs(xs[1] - xs[0]) };
  });
}

// ── The critter ───────────────────────────────────────────────────────────────────────────
/**
 * A critter: a soft-3D block body on two stubby legs, a face, arms. (x, y) is the feet.
 *   body:   'ink' (the default cast), 'paper' (a second, light cast member), 'orange' (the hero,
 *           only), or a light palette body: yellow, blue, teal, lilac, green (BODIES; any other
 *           throws). On the stage an ink critter stays ink and is picked out by the rim light
 *   view:   'front' (default), 'three-quarter' or 'back' (VIEWS); side: 'left' | 'right', the
 *           screen side it turns toward (default: forward). A back view shows the back of the
 *           body and outfit and the lost profile on `side`: the head turned away, never faceless
 *   mood:   a MOODS name; its settings apply first, then any explicit option
 *   arms:   an ARM_POSES name or { l: [x, y], r: [x, y] } hand positions relative to the feet
 *           (shoulders at ±60, −100); hands inside the body outline are drawn in front of it
 *           (behind it in a back view)
 *   legs:   a preset (stand, kick, hop, sit, tiptoe) or { l, r } rotations in degrees (walk())
 *   brows:  flat, up, high, worried, angry, raised (one up)
 *   mouth:  o, flat, smile, grin, smirk, frown, wobble, grit
 *   outfit: garments drawn for the role (outfits.js; still 03): { top: { kind, color, trim, neck,
 *           pocket }, sleeves, pants, shoes, head: { kind, color }, items: [...], custom }.
 *           Nothing worn enters FACE_KEEPOUT (EX3-103); glasses sit on the eyes
 *   wear:   the old stock accessories, any of WEAR, for an exact match only; wearColor 'orange'
 *           makes them the focal accent
 *   look, lid, lidTilt, pr (pupil size), tilt (degrees, about the feet),
 *   sq (squash > 0, stretch < 0), squash { sx, sy } (motion.js squash(), about the feet),
 *   s (scale), flip (face left; the light stays top right)
 *   who:    the critter's world id (world.js entity id; a group's members "<id>-1", "<id>-2"…),
 *           written as data-who so try.mjs can check that no critter is drawn twice at once or
 *           vanishes mid-frame (EX3-90). Its look (body, outfit, wear, wearColor; lookKey) is
 *           written as data-look so try.mjs can check it is the same in every frame (EX3-107).
 *           A view other than front is written as data-view, so a face check can skip a back
 * @param {number} x
 * @param {number} y
 * @param {Record<string, any>} [opts]
 */
export function critter(x, y, opts = {}) {
  const o = { ...moodFace(opts.mood), ...opts };
  const { body = 'ink', s = 1, look = [0, 0], lid = 0, lidTilt = 0, mouth = null, brows = null, tilt = 0, legs = 'stand', flip = false, sq = 0, squash = null, pr = 0.5, wear = [], wearColor = null, outfit = null, who = null, hold = null } = o;
  const dark = isDark();
  const L = flip ? -1 : 1;
  const D = defsBag();
  const B = bodyOf(body);
  const { view, k } = viewOf(o);
  const back = view === 'back';
  const face = faceInk(body);
  const C = { D, L, dark, bodyClip: D.clip(el('path', { d: BODY_D })), fill: B.base };
  const fit = isNoOutfit(outfit) ? null : outfitLayers(C, outfit, { face });
  const O = fit?.o ?? null;
  const wearList = [].concat(wear ?? []);
  const wctx = wearList.length ? wearContext(body, wearColor, D) : null;

  const LEGS = { stand: [0, 0], kick: [-20, 28], hop: [8, -8], sit: [-78, -70], tiptoe: [0, 0] };
  const legRot = typeof legs === 'object' ? [legs.l, legs.r] : LEGS[legs] ?? LEGS.stand;
  const legLen = legs === 'tiptoe' ? 44 : 34;
  const sol = solveArms(o);
  const armPaths = sol.paths;
  const front = sol.front;
  const arm = (side, i, over) => {
    const q = sol.quads[i];
    const sl = O ? drawSleeve(C, O, q, { front: over }) : { svg: '' };
    const after = O ? drawArmItems(C, O, side, q) : '';
    return drawArm(C, q, { over, body, sleeve: sl.svg, after });
  };
  // in a back view a hand in front of the belly is hidden behind the body, with what it holds
  const holdSides = hold ? ['both', 'l', 'r'].filter((sd) => hold[sd]) : [];
  // (a thing carried in both hands, or a hand within the body's width, is in front of it)
  const inside = (i) => Math.abs(sol.hands[i][0]) < 62;
  const hidden = (sd) => back && (sd === 'both' || front.includes(sd) || inside(sd === 'l' ? 0 : 1));
  const holdsOf = (pick) => {
    const hs = holdSides.filter(pick);
    return hs.length ? drawHolds(C, sol, Object.fromEntries(hs.map((sd) => [sd, hold[sd]])), { tilt, L, body }) : '';
  };
  const WEAR_HATS = ['cap', 'tophat', 'chef', 'gradcap'];

  const parts = [];
  if (wctx && !back) parts.push(...wearBehind(wearList, wctx));
  if (fit && !back) parts.push(fit.behind);
  if (back) {
    // seen from behind, what is in front of the critter is furthest: before its legs and body
    ['l', 'r'].forEach((side, i) => { if (front.includes(side)) parts.push(arm(side, i, false)); });
    if (O && front.length) parts.push(drawHeld(C, O, { l: armPaths[0].slice(2), r: armPaths[1].slice(2) }));
    parts.push(holdsOf(hidden));
  }
  parts.push(drawLegs(C, legRot, legLen, O));
  ['l', 'r'].forEach((side, i) => { if (!front.includes(side)) parts.push(arm(side, i, false)); });
  parts.push(drawBody(C, body, { view, k }));
  if (back) {
    parts.push(lostProfile(C, body, k, { brows, face, D }));
    if (fit) parts.push(outfitBack(C, O));
    if (wctx) parts.push(...wearBehind(wearList, wctx), ...wearFront(wearList.filter((w) => WEAR_HATS.includes(w)), wctx, BY));
  } else {
    // the face plane: in a three-quarter view it slides toward the near side and narrows, so the
    // far side of the body reads as its turned side (the far eye foreshortens a little more)
    const tq = view === 'three-quarter';
    const fp = [];
    if (fit) fp.push(fit.front, fit.head);
    fp.push(eyes(0, BY + 44, { gap: 50, r: 16, look, lid, lidTilt, pr, lash: face, body, lidColor: B.base, D, L, squeeze: tq ? (k > 0 ? [THREE_QUARTER.farEye, 1] : [1, THREE_QUARTER.farEye]) : null }));
    fp.push(browPaths(brows, BY + 44, 50, face));
    fp.push(mouthPath(mouth, look[0] * 4, BY + 82, face, D));
    if (fit) fp.push(fit.glasses);
    if (wctx) fp.push(...wearFront(wearList, wctx, BY));
    parts.push(tq ? g({ transform: `matrix(${THREE_QUARTER.squeeze} 0 0 1 ${THREE_QUARTER.shift * k} 0)` }, fp) : fp.join(''));
  }
  ['l', 'r'].forEach((side, i) => { if (front.includes(side) && !back) parts.push(arm(side, i, true)); });
  if (O && !(back && front.length)) {
    const hands = { l: armPaths[0].slice(2), r: armPaths[1].slice(2) };
    parts.push(drawHeld(C, O, hands));
  }
  if (hold) parts.push(holdsOf((sd) => !hidden(sd)));

  const qx = squash?.sx ?? 1;
  const qy = squash?.sy ?? 1;
  const sx = s * (1 + sq) * qx * L;
  const sy = s * (1 - sq) * qy;
  const shadow = g({ transform: `scale(${(Math.abs(sx)).toFixed(4)} ${s.toFixed(4)})` }, contactShadow(D, dark));
  const figure = g({ transform: `scale(${sx.toFixed(4)} ${sy.toFixed(4)})` }, parts);
  const lit = g({ transform: `rotate(${tilt.toFixed(2)})`, filter: dark ? rimFilter(D, Math.abs(sx), 1) : undefined }, figure);
  const tag = who ? { 'data-who': String(who), 'data-look': lookKey({ body, wear: wearList, wearColor, outfit }) } : {};
  if (view !== 'front') tag['data-view'] = view;
  // try.mjs reads the pose's rig problems here (the SVG alone cannot say where a hand was aimed).
  if (who) {
    const rig = [...new Set(riggedProblems(opts).map((p) => p.code).filter((c) => RIG_DRAWN_CODES.includes(c)))];
    if (rig.length) tag['data-rig'] = rig.join(' ');
  }
  return g({ ...tag, transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})` }, D.xml() + shadow + lit);
}

/** The lost profile of a critter turned away (a back view): the outer edge of its near eye and
 *  brow just inside the silhouette on side k, as an animator draws a head seen from behind, so
 *  the turn reads as a head turned away and not a blank. */
function lostProfile(C, body, k, { brows = null, face, D }) {
  const B = bodyOf(body);
  const ex = 58 * k;
  const ey = BY + 44;
  const clip = C.bodyClip;
  const eye = g({ 'clip-path': clip }, [
    el('ellipse', { cx: r2(ex + 2 * k), cy: r2(ey + 1.5), rx: 8, ry: 16.5, fill: B.dark, opacity: body === 'ink' ? 0.55 : 0.3, filter: D.blur(1.6) }),
    el('ellipse', { cx: r2(ex + 3 * k), cy: ey, rx: 5.5, ry: 15, fill: K('paper-lit') }),
    el('ellipse', { cx: r2(ex + 5 * k), cy: r2(ey + 1), rx: 2.6, ry: 7, fill: K('ink') }),
  ]);
  const by = ey - 27 + (brows === 'worried' || brows === 'high' ? -6 : brows === 'angry' ? 3 : 0);
  const brow = el('path', { d: `M ${r2(ex - 5 * k)} ${r2(by + 1)} L ${r2(ex + 7 * k)} ${r2(by - 1)}`, fill: 'none', stroke: face, 'stroke-width': 5, 'stroke-linecap': 'round', 'clip-path': clip });
  return g({ 'data-face': 'lost-profile' }, eye + brow);
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

/** For tests and sheets: an outfit's silhouettes on a critter at the origin at scale 1
 *  ({ part, pts } fills, { part, line, w } strokes), sleeves included for the given arms. */
export function outfitShapes(outfit, { arms = 'down' } = {}) {
  if (isNoOutfit(outfit)) return [];
  const D = defsBag();
  const C = { D, L: 1, dark: false, bodyClip: null, fill: BODY.ink.base };
  const fit = outfitLayers(C, outfit);
  const pose = typeof arms === 'object' ? null : ARM_POSES[arms] ?? ARM_POSES.down;
  const armPaths = pose ? pose.arms : [[-60, -100, arms.l[0], arms.l[1]], [60, -100, arms.r[0], arms.r[1]]];
  const front = pose ? pose.front ?? [] : [];
  const shapes = [...fit.shapes];
  ['l', 'r'].forEach((side, i) => {
    const sl = drawSleeve(C, fit.o, armQuad(armPaths[i]), { front: front.includes(side) });
    if (sl.shape && front.includes(side)) shapes.push(sl.shape);
  });
  return shapes;
}
export { ON_EYES };

/**
 * The palette colors an outfit draws on a critter: garments, sleeves, trousers, shoes, head,
 * items (the arm and held ones too) and its custom garment. A Set of palette names (metal is not
 * one); empty for no outfit. try.mjs uses it to keep orange the hero's body alone (EX3-139).
 * @param {object | null | 'none'} outfit
 * @returns {Set<string>}
 */
export function outfitColors(outfit) {
  return colorsOf(outfit, {
    draw: (C, o) => {
      const q = armQuad(ARM_POSES.down.arms[0]);
      drawSleeve(C, o, q);
      drawArmItems(C, o, 'l', q);
      drawLeg(C, o, -36.5, 34);
      drawHeld(C, o, { l: [-78, -52], r: [78, -52] });
    },
  });
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
export function solveArms(opts = {}) {
  const arms = opts.arms ?? 'down';
  const pose = typeof arms === 'string' ? ARM_POSES[arms] ?? ARM_POSES.down : null;
  if (pose && !opts.rig) {
    const quads = pose.arms.map(armQuad);
    return { rigged: false, paths: pose.arms, quads, hands: pose.arms.map((p) => p.slice(2)), elbows: quads.map((q) => quadAt(q, 0.5)), front: pose.front ?? [], requested: pose.arms.map((p) => p.slice(2)), clamped: [false, false] };
  }
  const req = pose ? [pose.arms[0].slice(2), pose.arms[1].slice(2)] : [arms.l ?? [-74, -50], arms.r ?? [74, -50]];
  const cover = opts.cover ?? arms === 'cover';
  // the face the hands keep off is the one this view shows (moved in a three-quarter view)
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
/** A prop spec ('mug', { kind: 'mug', color }, or a custom { draw, box, … }) → its definition. */
export function propOf(spec) {
  if (!spec) return null;
  if (typeof spec === 'string') {
    if (!PROPS[spec]) throw new Error(`HX: held prop "${spec}" must be one of ${Object.keys(PROPS).join(', ')} or { draw, box }`);
    return { ...PROPS[spec], kind: spec, p: {} };
  }
  if (spec.kind) return { ...propOf(spec.kind), ...spec, p: spec };
  if (typeof spec.draw !== 'function') throw new Error('HX: a custom held prop needs draw(C, p) → SVG and a box { x, y, w, h }');
  return { box: { x: -10, y: -10, w: 20, h: 20 }, ...spec, kind: spec.name ?? 'custom', p: spec };
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
  return g({ transform: `translate(${r2(pl.at[0])} ${r2(pl.at[1])}) scale(${pl.out} 1) rotate(${r2(pl.rot)})`, 'data-held': pl.def.kind }, pl.out * (C.L ?? 1) < 0 ? unmirrorText(art) : art);
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
  const G = GESTURES[I.gesture] ?? (ARM_POSES[I.gesture] ? { l: ARM_POSES[I.gesture].arms[0].slice(2), r: ARM_POSES[I.gesture].arms[1].slice(2), cover: I.gesture === 'cover' } : GESTURES.calm);
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
  const mood = I.mood ?? G.mood ?? (T.recoil ? 'surprised' : 'neutral');
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
  };
}

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
  if (raw.mood && !MOODS[raw.mood]) out.push({ code: 'unknown-mood', detail: `mood "${raw.mood}" is not one of ${Object.keys(MOODS).join(', ')}` });
  if (o.mouth != null && !MOUTHS.includes(o.mouth)) out.push({ code: 'faceless', detail: `mouth "${o.mouth}" is not one of ${MOUTHS.join(', ')}` });
  if (o.brows != null && !BROWS.includes(o.brows)) out.push({ code: 'faceless', detail: `brows "${o.brows}" is not one of ${BROWS.join(', ')}` });
  const sol = solveArms(o);
  // a back view shows no face (the head is turned away: not faceless), so nothing can cover it;
  // a three-quarter view's face sits on the near side of the body
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
