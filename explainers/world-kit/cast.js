// The Explainers world kit (from Explainer 2.0), cast (hx-3, expanded in Explainers 3.2, EX3-77): critters,
// the cast of every reel. Every character is a critter: never a person, a figure built from
// solids, or a body part. When an analogy has someone doing something, a critter does it.
// Personality comes from body language and expressions: anticipation, squash, gaze, brows, blinks.
// On dark grounds an ink critter becomes a paper one, so it never disappears (V-3).
//
//   critter(x, y, o)       draw one (x, y = the feet); options below
//   handAt(x, y, o)        where its hands are on screen, so it can hold a prop (pen, card, key…)
//   walk(t, o)             a walk cycle: { legs, bob, arms } to pass back into critter()
//   MOODS                  named expressions (confident, confused, panicked, proud, sly…)
//   ARM_POSES, WEAR        the arm presets and the role accessories
//   FACE_KEEPOUT           the eye and mouth zones nothing worn may enter (EX3-103)

import { T, el, g, ref, isDark, line, stippleShade } from './draw.js';

/** Two eyes with pupils looking toward look = [x, y] in -1..1; lid 0 open … 1 closed (a blink
 *  draws a lash line in `lash`). The lid fills with currentColor (the body). */
export function eyes(cx, cy, { gap = 34, r = 15, look = [0, 0], lid = 0, lidTilt = 0, pupil = T.ink, pr = 0.5, lash = null, rim = null } = {}) {
  const out = [];
  [-1, 1].forEach((side) => {
    const ex = cx + side * gap * 0.5;
    if (lid >= 0.92) {
      if (lash) out.push(el('path', { d: `M ${ex - r * 0.85} ${cy + 1} Q ${ex} ${cy + r * 0.6} ${ex + r * 0.85} ${cy + 1}`, fill: 'none', stroke: lash, 'stroke-width': 4.5, 'stroke-linecap': 'round' }));
      return;
    }
    out.push(el('circle', { cx: ex, cy, r, fill: T.canvas, stroke: rim ?? undefined, 'stroke-width': rim ? 3 : undefined }));
    out.push(el('circle', { cx: ex + look[0] * r * 0.42, cy: cy + look[1] * r * 0.42, r: r * pr, fill: pupil }));
    if (lid > 0) {
      const ly = cy - r + 2 * r * lid;
      const tilt = side * lidTilt;
      out.push(el('path', { d: `M ${ex - r - 3} ${ly - tilt} L ${ex + r + 3} ${ly + tilt} L ${ex + r + 3} ${cy - r - 5} L ${ex - r - 3} ${cy - r - 5} Z`, fill: 'currentColor' }));
    }
  });
  return out.join('');
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
  /** both hands in front of the belly, holding a thing (see handAt) */
  hold: { arms: [[-58, -86, -24, -62], [58, -86, 24, -62]], front: ['l', 'r'] },
  /** holding one thing out to the right, at chest height */
  offer: { arms: [[-62, -86, -80, -54], [60, -90, 124, -76]] },
  /** the right hand down in front, writing on a sheet or desk */
  write: { arms: [[-62, -86, -80, -54], [52, -84, 54, -36]], front: ['r'] },
  /** waving hello with the right arm */
  wave: { arms: [[-62, -86, -80, -54], [62, -104, 112, -182]] },
  /** a shrug: forearms out, palms up */
  shrug: { arms: [[-62, -94, -118, -116], [62, -94, 118, -116]] },
  /** a hand on the chin, thinking */
  think: { arms: [[-62, -86, -80, -54], [56, -78, 22, -60]], front: ['r'] },
  /** both hands up to the face, peeking or shocked */
  cover: { arms: [[-58, -88, -26, -96], [58, -88, 26, -96]], front: ['l', 'r'] },
  /** cheering, both arms high */
  cheer: { arms: [[-60, -112, -104, -196], [60, -112, 104, -196]] },
  /** hands on hips, proud */
  hips: { arms: [[-62, -92, -96, -70], [62, -92, 96, -70]] },
};

// ── Faces ─────────────────────────────────────────────────────────────────────────────────
/** Named expressions: any critter option can be overridden after them. */
export const MOODS = {
  neutral: {},
  happy: { mouth: 'smile', brows: 'up' },
  confident: { lid: 0.32, lidTilt: 3, mouth: 'smile', brows: 'flat' },
  proud: { lid: 0.55, mouth: 'grin', brows: 'up', tilt: -3 },
  sly: { lid: 0.45, lidTilt: -4, mouth: 'smirk', brows: 'raised', look: [0.6, 0] },
  confused: { mouth: 'wobble', brows: 'raised', look: [0.4, -0.5] },
  worried: { mouth: 'wobble', brows: 'worried', look: [-0.3, 0.2] },
  panicked: { mouth: 'o', brows: 'worried', pr: 0.32, arms: 'flail' },
  surprised: { mouth: 'o', brows: 'high', pr: 0.36 },
  sad: { mouth: 'frown', brows: 'worried', look: [0, 0.6], lid: 0.25 },
  angry: { mouth: 'grit', brows: 'angry' },
  focused: { lid: 0.3, mouth: 'flat', brows: 'angry', look: [0.6, 0.3] },
};

function mouthPath(kind, mx, my, face) {
  const o = { fill: 'none', stroke: face, 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  switch (kind) {
    case 'o': return el('ellipse', { cx: mx, cy: my + 2, rx: 9, ry: 11, fill: face });
    case 'flat': return el('path', { ...o, d: `M ${mx - 12} ${my} L ${mx + 12} ${my + 2}` });
    case 'smile': return el('path', { ...o, d: `M ${mx - 14} ${my - 4} Q ${mx} ${my + 10} ${mx + 14} ${my - 4}` });
    case 'grin': return el('path', { d: `M ${mx - 20} ${my - 6} Q ${mx} ${my + 18} ${mx + 20} ${my - 6} Z`, fill: face });
    case 'smirk': return el('path', { ...o, d: `M ${mx - 12} ${my + 2} Q ${mx + 4} ${my + 6} ${mx + 16} ${my - 6}` });
    case 'frown': return el('path', { ...o, d: `M ${mx - 14} ${my + 6} Q ${mx} ${my - 6} ${mx + 14} ${my + 6}` });
    case 'wobble': return el('path', { ...o, d: `M ${mx - 16} ${my + 2} Q ${mx - 8} ${my - 5} ${mx} ${my + 2} Q ${mx + 8} ${my + 9} ${mx + 16} ${my + 2}` });
    case 'grit': return el('path', { ...o, d: `M ${mx - 16} ${my + 2} L ${mx - 6} ${my - 3} L ${mx + 4} ${my + 3} L ${mx + 14} ${my - 3}` });
    default: return '';
  }
}

function browPaths(kind, cy, gap, face) {
  if (!kind) return '';
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
    default: return '';
  }
}

// ── Role accessories (WEAR) ───────────────────────────────────────────────────────────────
// What makes one critter "the student" and another "the chef". Drawn in paper on an ink body
// (ink on a paper or orange body) so they always read. `wearColor: 'orange'` makes the
// accessory the focal accent instead of the body.
//
// HARD CONSTRAINT (EX3-103, Lucas): nothing a critter wears covers or crowds its eyes or mouth.
// Every accessory stays outside FACE_KEEPOUT, so there is clear body showing between it and the
// face: hats sit above the brows, the headset mic stops at the cheek, the backpack strap runs
// along the body's edge, and the scarf, bowtie and apron sit at the base, below the mouth.
// Glasses are the one exception: they are worn over the eyes, as glasses are.
// tests/explainers-kit.test.ts measures every accessory against these zones.
export const WEAR = ['cap', 'tophat', 'chef', 'gradcap', 'glasses', 'headset', 'apron', 'backpack', 'bowtie', 'scarf'];
/** The accessories that are allowed over the eyes. */
export const WEAR_ON_EYES = ['glasses'];

// The face, relative to the feet at scale 1 (body top BY): eyes r 16 at (±25, BY + 44), brows
// about BY + 9…19, the mouth within ±24 (with the look shift) and BY + 76…95.
const BY = -142;
/** The keep-outs around the face, relative to the feet at scale 1: the eyes and their brows with
 *  about 10px clear around them, and the mouth (every shape, any look) with 8px. */
export const FACE_KEEPOUT = [
  { part: 'eyes', x: -51, y: BY + 8, w: 102, h: 62 },
  { part: 'mouth', x: -32, y: BY + 68, w: 64, h: 35 },
];

function wearBehind(items, ctx) {
  const out = [];
  if (items.includes('backpack')) {
    out.push(el('rect', { x: -86, y: -136, width: 70, height: 92, rx: 18, fill: ctx.acc, stroke: ctx.edge, 'stroke-width': 4 }));
    out.push(el('rect', { x: -80, y: -96, width: 44, height: 34, rx: 8, fill: 'none', stroke: ctx.edge, 'stroke-width': 3 }));
  }
  return out;
}

function wearFront(items, ctx, by) {
  const { acc, edge, face } = ctx;
  const sw = { stroke: edge, 'stroke-width': 4, 'stroke-linejoin': 'round' };
  const out = [];
  // The base, below the mouth: a waist apron hanging over the tops of the legs, a scarf wrapped
  // round the bottom of the body with its tail down one side, a small bowtie at the hem.
  if (items.includes('apron')) {
    out.push(el('path', { d: `M -42 ${by + 109} L 42 ${by + 109} L 46 ${by + 136} Q 0 ${by + 142} -46 ${by + 136} Z`, fill: acc, ...sw }));
    out.push(el('rect', { x: -14, y: by + 116, width: 28, height: 12, rx: 3, fill: 'none', ...sw, 'stroke-width': 3 }));
    out.push(el('rect', { x: -52, y: by + 105, width: 104, height: 8, rx: 4, fill: acc, ...sw, 'stroke-width': 3 }));
  }
  if (items.includes('scarf')) {
    out.push(el('path', { d: `M 26 ${by + 114} L 34 ${by + 150} L 52 ${by + 146} L 46 ${by + 110} Z`, fill: acc, ...sw }));
    out.push(el('path', { d: `M 33 ${by + 142} L 51 ${by + 138}`, fill: 'none', ...sw, 'stroke-width': 3 }));
    out.push(el('path', { d: `M -62 ${by + 100} Q 0 ${by + 116} 62 ${by + 100} L 62 ${by + 114} Q 0 ${by + 130} -62 ${by + 114} Z`, fill: acc, ...sw }));
  }
  if (items.includes('bowtie')) {
    out.push(el('path', { d: `M 0 ${by + 112} L -24 ${by + 105} L -24 ${by + 119} Z M 0 ${by + 112} L 24 ${by + 105} L 24 ${by + 119} Z`, fill: acc, ...sw, 'stroke-width': 3 }));
    out.push(el('circle', { cx: 0, cy: by + 112, r: 5.5, fill: acc, ...sw, 'stroke-width': 2.5 }));
  }
  if (items.includes('backpack')) {
    out.push(el('path', { d: `M -57 ${by + 20} Q -64 ${by + 58} -56 ${by + 100}`, fill: 'none', stroke: acc, 'stroke-width': 9, 'stroke-linecap': 'round' }));
  }
  if (items.includes('glasses')) {
    const gy = by + 44;
    out.push(el('circle', { cx: -25, cy: gy, r: 21, fill: 'none', stroke: face === T.canvas ? T['paper-lit'] : T.ink, 'stroke-width': 4.5 }));
    out.push(el('circle', { cx: 25, cy: gy, r: 21, fill: 'none', stroke: face === T.canvas ? T['paper-lit'] : T.ink, 'stroke-width': 4.5 }));
    out.push(el('path', { d: `M -5 ${gy - 2} Q 0 ${gy - 6} 5 ${gy - 2}`, fill: 'none', stroke: face === T.canvas ? T['paper-lit'] : T.ink, 'stroke-width': 4 }));
  }
  if (items.includes('headset')) {
    // the mic sits out at the cheek, clear of the mouth
    out.push(el('path', { d: `M -70 ${by + 40} Q -70 ${by - 26} 0 ${by - 26} Q 70 ${by - 26} 70 ${by + 40}`, fill: 'none', stroke: acc, 'stroke-width': 8, 'stroke-linecap': 'round' }));
    out.push(el('rect', { x: 58, y: by + 28, width: 22, height: 34, rx: 8, fill: acc, ...sw, 'stroke-width': 3 }));
    out.push(el('path', { d: `M 68 ${by + 60} Q 66 ${by + 84} 50 ${by + 86}`, fill: 'none', stroke: acc, 'stroke-width': 5, 'stroke-linecap': 'round' }));
    out.push(el('circle', { cx: 45, cy: by + 86, r: 6, fill: acc, ...sw, 'stroke-width': 2.5 }));
  }
  // Hats sit on the crown, above the brows.
  if (items.includes('cap')) {
    out.push(el('path', { d: `M -56 ${by + 2} Q -54 ${by - 46} 0 ${by - 48} Q 54 ${by - 46} 56 ${by + 2} Z`, fill: acc, ...sw }));
    out.push(el('path', { d: `M 22 ${by - 2} L 104 ${by - 6} Q 108 ${by + 2} 96 ${by + 4} L 22 ${by + 4} Z`, fill: acc, ...sw }));
    out.push(el('circle', { cx: 0, cy: by - 48, r: 6, fill: acc, ...sw, 'stroke-width': 3 }));
  }
  if (items.includes('tophat')) {
    out.push(el('rect', { x: -80, y: by - 14, width: 160, height: 16, rx: 6, fill: acc, ...sw }));
    out.push(el('rect', { x: -48, y: by - 104, width: 96, height: 92, rx: 4, fill: acc, ...sw }));
    out.push(el('rect', { x: -48, y: by - 38, width: 96, height: 14, fill: face === T.canvas ? T.orange : T['paper-shade'], ...sw, 'stroke-width': 3 }));
  }
  if (items.includes('chef')) {
    out.push(el('rect', { x: -46, y: by - 34, width: 92, height: 38, rx: 4, fill: T['paper-lit'], ...sw }));
    out.push(el('path', { d: `M -46 ${by - 30} Q -78 ${by - 64} -40 ${by - 84} Q -30 ${by - 116} 0 ${by - 104} Q 30 ${by - 120} 42 ${by - 86} Q 80 ${by - 66} 46 ${by - 30} Z`, fill: T['paper-lit'], ...sw }));
  }
  if (items.includes('gradcap')) {
    out.push(el('path', { d: `M -40 ${by - 4} L -40 ${by - 28} L 40 ${by - 28} L 40 ${by - 4} Z`, fill: acc, ...sw }));
    out.push(el('path', { d: `M -96 ${by - 40} L 0 ${by - 70} L 96 ${by - 40} L 0 ${by - 12} Z`, fill: acc, ...sw }));
    out.push(el('path', { d: `M 0 ${by - 41} L 70 ${by - 34} L 74 ${by + 10}`, fill: 'none', stroke: face === T.canvas ? T.orange : T.ink, 'stroke-width': 4, 'stroke-linecap': 'round' }));
    out.push(el('circle', { cx: 74, cy: by + 14, r: 7, fill: face === T.canvas ? T.orange : T.ink }));
  }
  return out;
}

/** The colors a critter's accessories are drawn in, from its body and wearColor. */
function wearContext(body, wearColor) {
  const fill = body === 'orange' ? T.orange : body === 'paper' || isDark() ? T['paper-lit'] : T.ink;
  const light = fill !== T.ink;
  const acc = wearColor === 'orange' ? T.orange : light ? T.ink : T['paper-lit'];
  // an ink accessory on a dark ground gets a paper edge, so what hangs past the body still reads
  return { acc, edge: acc === T.ink && isDark() ? T['paper-lit'] : T.ink, face: light ? T.ink : T.canvas };
}

/** Just the accessories, as critter() draws them on a critter at the origin at scale 1 (for the
 *  face keep-out test and sheets): { behind, front } SVG strings. */
export function wearDrawing(wear, { body = 'ink', wearColor = null } = {}) {
  const ctx = wearContext(body, wearColor);
  return { behind: wearBehind(wear, ctx).join(''), front: wearFront(wear, ctx, BY).join('') };
}

// ── The critter ───────────────────────────────────────────────────────────────────────────
/**
 * A critter: a soft block body on two stubby legs, a face, arms. (x, y) is the feet.
 *   body:   'ink' (the default cast; paper on dark grounds), 'paper' (a second, light cast
 *           member) or 'orange' (the focal)
 *   mood:   a MOODS name; its settings apply first, then any explicit option
 *   arms:   an ARM_POSES name or { l: [x, y], r: [x, y] } hand positions relative to the feet
 *           (shoulders at ±60, −100); hands inside the body outline are drawn in front of it
 *   legs:   a preset (stand, kick, hop, sit, tiptoe) or { l, r } rotations in degrees (walk())
 *   brows:  flat, up, high, worried, angry, raised (one up)
 *   mouth:  o, flat, smile, grin, smirk, frown, wobble, grit
 *   wear:   role accessories, any of WEAR; wearColor 'orange' makes them the focal accent.
 *           None covers or crowds the eyes or mouth (FACE_KEEPOUT, EX3-103); glasses sit on the eyes
 *   look, lid, lidTilt, pr (pupil size), tilt (degrees, about the feet),
 *   sq (squash > 0, stretch < 0), s (scale), flip (face left)
 *   who:    the critter's world id (world.js entity id; a group's members "<id>-1", "<id>-2"…),
 *           written as data-who so try.mjs can check that no critter is drawn twice at once or
 *           vanishes mid-frame (EX3-90). Its look (body, wear, wearColor) is written as data-look
 *           so try.mjs can check it is the same in every frame, as world.js's CAST says (EX3-107)
 * @param {number} x
 * @param {number} y
 * @param {Record<string, any>} [opts]
 */
/**
 * A critter's look, the part that never changes during a reel (EX3-107): its body and its role
 * accessories. Pose, mood, scale and gaze change; this does not. `body|wear+wear|wearColor`.
 * @param {{ body?: string, wear?: string[] | string, wearColor?: string | null }} [look]
 * @returns {string}
 */
export function lookKey({ body = 'ink', wear = [], wearColor = null } = {}) {
  return `${body}|${[].concat(wear ?? []).map(String).sort().join('+')}|${wearColor ?? ''}`;
}

export function critter(x, y, opts = {}) {
  const o = { ...(MOODS[opts.mood] ?? {}), ...opts };
  const { body = 'ink', s = 1, look = [0, 0], lid = 0, lidTilt = 0, mouth = null, brows = null, tilt = 0, arms = 'down', legs = 'stand', flip = false, sq = 0, pr = 0.5, wear = [], wearColor = null, who = null } = o;
  const orange = body === 'orange';
  const fill = orange ? T.orange : body === 'paper' || isDark() ? T['paper-lit'] : T.ink;
  const limb = body === 'paper' && !isDark() ? T.ink : line();
  const light = fill !== T.ink;
  const face = light ? T.ink : T.canvas;
  const bw = 132;
  const bh = 112;
  const by = BY;
  const parts = [];
  const LEGS = { stand: [0, 0], kick: [-20, 28], hop: [8, -8], sit: [-78, -70], tiptoe: [0, 0] };
  const legRot = typeof legs === 'object' ? [legs.l, legs.r] : LEGS[legs] ?? LEGS.stand;
  const legLen = legs === 'tiptoe' ? 44 : 34;
  const legPose = [[-26, -32, legRot[0]], [26, -32, legRot[1]]];
  // A light critter on paper (or any paper critter on a dark ground) is cut out with a thin ink
  // edge so it never melts into paper objects behind it.
  const cut = light && !orange;
  const edge = cut ? { stroke: T.ink, 'stroke-width': 3.5 } : {};
  const ctx = wearContext(body, wearColor);
  parts.push(...wearBehind(wear, ctx));
  legPose.forEach(([lx, ly, rot]) => parts.push(el('rect', { x: lx - 10, y: ly, width: 20, height: legLen, rx: 9, fill: limb, ...edge, transform: `rotate(${rot} ${lx} ${ly})` })));
  const pose = typeof arms === 'object' ? null : ARM_POSES[arms] ?? ARM_POSES.down;
  const armPaths = pose ? pose.arms : [[-60, -100, arms.l[0], arms.l[1]], [60, -100, arms.r[0], arms.r[1]]];
  const inside = ([, , hx, hy]) => Math.abs(hx) < bw / 2 - 4 && hy > by && hy < -30;
  const front = pose ? pose.front ?? [] : ['l', 'r'].filter((side, i) => inside(armPaths[i]));
  // An arm over the body gets an outline in the other tone, so ink on ink (or paper on paper)
  // still reads as an arm.
  const drawArm = ([x0, y0, x1, y1], over = false) => {
    const d = `M ${x0} ${y0} Q ${(x0 + x1) / 2 + (x1 > 0 ? 8 : -8)} ${(y0 + y1) / 2 - 10} ${x1} ${y1}`;
    const out = [];
    if (over) {
      const rim = limb === T.ink ? T['paper-lit'] : T.ink;
      out.push(el('path', { d, fill: 'none', stroke: rim, 'stroke-width': 26, 'stroke-linecap': 'round' }));
      out.push(el('circle', { cx: x1, cy: y1, r: 16, fill: rim }));
    } else if (cut) out.push(el('path', { d, fill: 'none', stroke: T.ink, 'stroke-width': 24, 'stroke-linecap': 'round' }));
    out.push(el('path', { d, fill: 'none', stroke: limb, 'stroke-width': 17, 'stroke-linecap': 'round' }));
    // the hand: a round mitten a little wider than the arm, so it can grip a prop
    out.push(el('circle', { cx: x1, cy: y1, r: 12, fill: limb, ...(cut || (light && !orange) ? { stroke: T.ink, 'stroke-width': 3 } : {}) }));
    return out.join('');
  };
  ['l', 'r'].forEach((side, i) => { if (!front.includes(side)) parts.push(drawArm(armPaths[i])); });
  parts.push(el('rect', { x: -bw / 2, y: by, width: bw, height: bh, rx: 40, fill, ...edge }));
  if (orange) parts.push(stippleShade('rect', { x: -bw / 2, y: by, width: bw, height: bh, rx: 40 }, T['orange-dark'], { x1: 0.2, y1: 0, x2: 0.9, y2: 1, from: 0, to: 0.9 }));
  else if (light) parts.push(stippleShade('rect', { x: -bw / 2, y: by, width: bw, height: bh, rx: 40 }, T['paper-dark'], { x1: 0.2, y1: 0, x2: 0.9, y2: 1, from: 0, to: 0.9 }));
  parts.push(g({ color: fill }, eyes(0, by + 44, { gap: 50, r: 16, look, lid, lidTilt, pr, lash: face, rim: light && !orange ? T.ink : null })));
  parts.push(browPaths(brows, by + 44, 50, face));
  parts.push(mouthPath(mouth, look[0] * 4, by + 82, face));
  parts.push(...wearFront(wear, ctx, by));
  ['l', 'r'].forEach((side, i) => { if (front.includes(side)) parts.push(drawArm(armPaths[i], true)); });
  const sx = s * (1 + sq) * (flip ? -1 : 1);
  const sy = s * (1 - sq);
  return g({ ...(who ? { 'data-who': String(who), 'data-look': lookKey({ body, wear, wearColor }) } : {}), transform: `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${tilt.toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)})`, filter: ref('wobble') }, parts);
}

/**
 * Where a critter's hands are on screen, for the same (x, y, options) as critter(): draw a held
 * prop at a hand after the critter (in front) or before it (behind).
 * @returns {{ l: [number, number], r: [number, number] }}
 */
export function handAt(x, y, opts = {}) {
  const o = { ...(MOODS[opts.mood] ?? {}), ...opts };
  const { s = 1, tilt = 0, flip = false, sq = 0, arms = 'down' } = o;
  const pose = typeof arms === 'object' ? null : ARM_POSES[arms] ?? ARM_POSES.down;
  const hands = pose ? [pose.arms[0].slice(2), pose.arms[1].slice(2)] : [arms.l, arms.r];
  const a = (tilt * Math.PI) / 180;
  const sx = s * (1 + sq) * (flip ? -1 : 1);
  const sy = s * (1 - sq);
  const at = ([hx, hy]) => {
    const px = hx * sx;
    const py = hy * sy;
    return [x + px * Math.cos(a) - py * Math.sin(a), y + px * Math.sin(a) + py * Math.cos(a)];
  };
  return { l: at(hands[0]), r: at(hands[1]) };
}

/**
 * A walk cycle at time t: legs swing, the body bobs, arms counter-swing. Pass the result's
 * legs and arms to critter() and draw it at y − bob. Stepping is on twos with the rest of the
 * cast; each footfall is a `foley` "footstep" sound event at the times `steps` lists.
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
