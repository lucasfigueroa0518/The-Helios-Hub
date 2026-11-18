// The cache reel's own new drawings (EX3-114): a vacuum flask, a stovetop kettle on a one-ring hob,
// a ceramic mug. Each is drawn about its own base center (0, 0 = where it touches the table), in
// screen px at scale 1, with the kit's isometric look: three flat tones, ink outlines, riso grain on
// the side faces, a flat contact shadow. draw() takes { state, focal } like every asset, plus the
// scene's pose values (level, steam, flame, fill, tilt, lift, pour, squash, phase, ...), all optional.

import { T, el, g, line, shadow, TONES, cbox, face, shape, mark, shade } from '../../props/kit.js';

const RY = 0.577; // the ellipse ratio of a circle on the iso table

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const n1 = (v) => v.toFixed(1);

/** An upright drum: base ellipse center (cx, yb), radius rx, height h. cap = false leaves the top open
 *  (a band around a body). Left lit, right side darker, riso grain, ink outline. */
function drum(cx, yb, rx, h, tones, { sw = 3, cap = true, grain = true } = {}) {
  const ry = rx * RY;
  const yt = yb - h;
  const k = rx * 0.45;
  const e = ry * Math.sqrt(1 - 0.45 * 0.45);
  const side = `M ${n1(cx - rx)} ${n1(yt)} A ${n1(rx)} ${n1(ry)} 0 0 0 ${n1(cx + rx)} ${n1(yt)} L ${n1(cx + rx)} ${n1(yb)} A ${n1(rx)} ${n1(ry)} 0 0 1 ${n1(cx - rx)} ${n1(yb)} Z`;
  const right = `M ${n1(cx + k)} ${n1(yt + e)} L ${n1(cx + k)} ${n1(yb + e)} A ${n1(rx)} ${n1(ry)} 0 0 0 ${n1(cx + rx)} ${n1(yb)} L ${n1(cx + rx)} ${n1(yt)} A ${n1(rx)} ${n1(ry)} 0 0 1 ${n1(cx + k)} ${n1(yt + e)} Z`;
  const out = [el('path', { d: side, fill: tones[1] }), el('path', { d: right, fill: tones[2] })];
  if (grain) out.push(shade(side, { from: 0, to: 0.24 }));
  out.push(el('path', { d: side, fill: 'none', stroke: line(), 'stroke-width': sw, 'stroke-linejoin': 'round' }));
  if (cap) out.push(el('ellipse', { cx: n1(cx), cy: n1(yt), rx: n1(rx), ry: n1(ry), fill: tones[0], stroke: line(), 'stroke-width': sw }));
  return out.join('');
}

/** A seam: the front arc of a ring around a drum, an ink mark. */
const seam = (rx, y, opacity = 0.5, sw = 2.5) => mark(`M ${n1(-rx)} ${n1(y)} A ${n1(rx)} ${n1(rx * RY)} 0 0 0 ${n1(rx)} ${n1(y)}`, sw, opacity);

/** Steam: four ink strands that fade in one by one as `amount` (0..1) grows, from a faint wisp to a
 *  full stream. A pure function of amount and phase. */
function steam(x, y, amount, phase = 0, tall = 100) {
  const a = clamp01(amount);
  if (a <= 0.01) return [];
  const out = [];
  for (let i = 0; i < 4; i++) {
    const vis = clamp01(a * 4 - i * 0.9);
    if (vis <= 0.02) continue;
    const x0 = x + (i - 1.5) * 15;
    const h = tall * (0.5 + 0.5 * a) * (0.7 + 0.3 * vis) * (i % 2 ? 0.85 : 1);
    let d = `M ${n1(x0)} ${n1(y)}`;
    for (let k = 1; k <= 14; k++) {
      const f = k / 14;
      d += ` L ${n1(x0 + 7 * Math.sin(k * 0.45 + phase * 3 + i * 1.9) * (f + 0.3))} ${n1(y - h * f)}`;
    }
    out.push(mark(d, 2.4 + 1.8 * a, (0.12 + 0.5 * vis) * (0.55 + 0.45 * a)));
  }
  return out;
}

/** A pour: a falling ribbon of water from (x, y), len px long, with a small splash where it lands. */
function stream(x, y, len, amount) {
  const a = clamp01(amount);
  if (len <= 2 || a <= 0.01) return [];
  const w0 = 2 + 6 * a;
  const yl = y + len;
  return [
    el('path', { d: `M ${n1(x - w0)} ${n1(y)} L ${n1(x - w0 * 0.6)} ${n1(yl)} L ${n1(x + w0 * 0.6)} ${n1(yl)} L ${n1(x + w0)} ${n1(y)} Z`, fill: T['paper-shade'], stroke: line(), 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
    mark(`M ${n1(x)} ${n1(y + 8)} L ${n1(x)} ${n1(yl - 6)}`, 1.8, 0.35),
    mark(`M ${n1(x - 11)} ${n1(yl - 2)} Q ${n1(x - 16)} ${n1(yl - 12)} ${n1(x - 24)} ${n1(yl - 9)}`, 2.2, 0.6),
    mark(`M ${n1(x + 11)} ${n1(yl - 2)} Q ${n1(x + 16)} ${n1(yl - 12)} ${n1(x + 24)} ${n1(yl - 9)}`, 2.2, 0.6),
  ];
}

const squashed = (parts, squash) => {
  const q = clamp01(squash || 0);
  return q > 0 ? [g({ transform: `scale(${(1 + 0.1 * q).toFixed(4)} ${(1 - 0.14 * q).toFixed(4)})` }, parts)] : parts;
};

// ── The vacuum flask ──────────────────────────────────────────────────────────────────────
const FLASK_PIVOT = [52, 0]; // the base's right corner: the flask tips about it
const FLASK_TIP = [66, -260]; // the pour lip on the cup lid

/** Where a point of the flask (local px) lands under a tilt (degrees, toward the right) and a lift (px). */
export function flaskPoint([px, py], tilt = 0, lift = 0) {
  const a = (tilt * Math.PI) / 180;
  const dx = px - FLASK_PIVOT[0];
  const dy = py - FLASK_PIVOT[1];
  return [FLASK_PIVOT[0] + dx * Math.cos(a) - dy * Math.sin(a), FLASK_PIVOT[1] + dx * Math.sin(a) + dy * Math.cos(a) - lift];
}

/** Where the pour leaves the flask, in its local px. */
export const flaskTip = (tilt = 0, lift = 0) => flaskPoint(FLASK_TIP, tilt, lift);

/** How the flask pours in the hook: its tilt and the length of the stream down to the mug's rim. */
export const POUR = { tilt: 38, streamLen: 184 };

function drawFlask({ focal = false, level = 1, steam: steamAmt = 0.6, tilt = 0, lift = 0, pour = 0, streamLen = POUR.streamLen, squash = 0, phase = 0 } = {}) {
  const lid = focal ? TONES.orange : TONES.ink;
  // the water-level window: a slim glass slot between the lid and the band
  const win = { x: -23, y: -158, w: 12, h: 56 };
  const water = clamp01(level) * (win.h - 6);
  const body = [
    drum(0, 0, 52, 200, TONES.paper),
    seam(52, -14),
    drum(0, -70, 52.8, 50, TONES.orange, { cap: false, sw: 3 }),
    el('rect', { x: win.x, y: win.y, width: win.w, height: win.h, rx: 5, fill: T['paper-lit'], stroke: line(), 'stroke-width': 2.5 }),
    water > 1 ? el('rect', { x: win.x + 2.5, y: win.y + win.h - 3 - water, width: win.w - 5, height: water, rx: 2.5, fill: T['paper-dark'] }) : '',
    mark(`M ${win.x + win.w + 5} ${win.y + 12} L ${win.x + win.w + 11} ${win.y + 12} M ${win.x + win.w + 5} ${win.y + 28} L ${win.x + win.w + 11} ${win.y + 28} M ${win.x + win.w + 5} ${win.y + 44} L ${win.x + win.w + 11} ${win.y + 44}`, 2.2, 0.55),
    // the screw-on cup lid, with grip ribs
    drum(0, -196, 47, 54, lid),
    ...[-30, -15, 0, 15, 30].map((x) => {
      const e = 27 * Math.sqrt(1 - (x / 47) * (x / 47));
      return el('path', { d: `M ${x} ${n1(-244 + e)} L ${x} ${n1(-204 + e)}`, fill: 'none', stroke: T['paper-lit'], 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: 0.35 });
    }),
    // the pouring stopper's push button and the pour lip
    shape('M 40 -246 L 66 -260 L 61 -240 Z', T['paper-shade'], 3),
    drum(-4, -250, 13, 7, TONES.ink, { sw: 2.5, grain: false }),
  ];
  const tipAt = flaskTip(tilt, lift);
  const k = clamp01(tilt / 30);
  const [sx, sy] = flaskPoint([66 * k, -266], tilt, lift);
  const parts = [
    shadow(14, 8, 78, 26),
    g({ transform: `translate(0 ${n1(-lift)}) rotate(${n1(tilt)} ${FLASK_PIVOT[0]} ${FLASK_PIVOT[1]})` }, body),
    ...stream(tipAt[0] + 1, tipAt[1] + 3, streamLen * clamp01(pour), pour),
    ...steam(sx, sy, steamAmt, phase, 110),
  ];
  return squashed(parts, squash);
}

// ── The stovetop kettle on a one-ring hob ───────────────────────────────────────────────────
const flame = (x, y, h) =>
  shape(`M ${n1(x - 8)} ${n1(y)} C ${n1(x - 10)} ${n1(y - h * 0.45)} ${n1(x - 3)} ${n1(y - h * 0.6)} ${n1(x)} ${n1(y - h)} C ${n1(x + 3)} ${n1(y - h * 0.6)} ${n1(x + 10)} ${n1(y - h * 0.45)} ${n1(x + 8)} ${n1(y)} Z`, T['paper-lit'], 2.5) +
  mark(`M ${n1(x)} ${n1(y - 2)} L ${n1(x)} ${n1(y - h * 0.45)}`, 2, 0.5);

function drawKettle({ focal = false, steam: steamAmt = 0.12, flame: flameAmt = 0.2, rattle = 0, squash = 0, phase = 0 } = {}) {
  const tones = focal ? TONES.orange : TONES.paper;
  const yb = -22; // the hob's top face
  const rat = Math.max(0, Math.min(8, rattle));
  const fh = 8 + 26 * clamp01(flameAmt);
  const parts = [
    shadow(14, 22, 150, 56),
    // the one-ring hob: a dark slab with its control knob on the front
    cbox(0, 0, 0, 120, 120, 22, TONES.ink),
    face('front', -60, 60, 22, [
      el('circle', { cx: 60, cy: 11, r: 6.5, fill: T['paper-lit'], opacity: 0.9 }),
      el('path', { d: 'M 60 6 L 60 11', fill: 'none', stroke: T.ink, 'stroke-width': 2, 'stroke-linecap': 'round' }),
    ]),
    // the arched handle stands behind the lid
    el('path', { d: 'M -58 -58 C -66 -160 66 -160 58 -58', fill: 'none', stroke: line(), 'stroke-width': 11, 'stroke-linecap': 'round' }),
    el('path', { d: 'M -58 -58 C -66 -160 66 -160 58 -58', fill: 'none', stroke: focal ? T['orange-lit'] : T['paper-lit'], 'stroke-width': 4.5, 'stroke-linecap': 'round' }),
    // the curved spout, drawn first so the body covers its root
    shape('M 56 -70 C 86 -76 104 -90 120 -110 L 132 -100 C 118 -76 96 -44 58 -36 Z', T['paper-shade'], 3.5),
    shade('M 56 -70 C 86 -76 104 -90 120 -110 L 132 -100 C 118 -76 96 -44 58 -36 Z', { from: 0, to: 0.25 }),
    el('ellipse', { cx: 126, cy: -105, rx: 7, ry: 4, fill: T.ink, transform: 'rotate(-50 126 -105)' }),
    // the squat steel body, its seam, the lid and its knob
    drum(0, yb, 62, 58, tones, { sw: 3.5 }),
    seam(62, yb - 14),
    drum(0, yb - 58 - rat, 36, 12, tones, { sw: 3 }),
    drum(0, yb - 70 - rat, 9, 14, TONES.ink, { sw: 2.5, grain: false }),
    // the flame licking out from under the pot
    flame(-36, 18, fh * 0.85),
    flame(0, 28, fh),
    flame(36, 18, fh * 0.85),
    ...steam(126, -108, steamAmt, phase, 120),
  ];
  return squashed(parts, squash);
}

// ── The ceramic mug ───────────────────────────────────────────────────────────────────────
function drawMug({ focal = false, fill = 0, steam: steamAmt = 0, squash = 0, phase = 0 } = {}) {
  const tones = focal ? TONES.orange : TONES.paper;
  const rx = 50;
  const ry = rx * RY;
  const h = 64;
  const f = clamp01(fill);
  const d = 4 + (1 - f) * 40; // how far the water sits below the rim
  const parts = [
    shadow(-4, 8, 74, 26),
    // the ear handle, on the side away from the pour, outlined like a tube
    el('path', { d: 'M -44 -52 C -96 -62 -96 -12 -42 -12', fill: 'none', stroke: line(), 'stroke-width': 11, 'stroke-linecap': 'round' }),
    el('path', { d: 'M -44 -52 C -96 -62 -96 -12 -42 -12', fill: 'none', stroke: focal ? T['orange-lit'] : T['paper-lit'], 'stroke-width': 4.5, 'stroke-linecap': 'round' }),
    // the inside, the water, then the front wall over them
    el('ellipse', { cx: 0, cy: -h, rx, ry, fill: T['paper-shade'] }),
    f > 0.01 ? el('ellipse', { cx: 0, cy: n1(-h + d), rx: rx - 7, ry: ry - 4, fill: T['paper-dark'] }) : '',
    f > 0.01 ? mark(`M -18 ${n1(-h + d + 2)} Q 0 ${n1(-h + d + 8)} 18 ${n1(-h + d + 2)}`, 2, 0.45) : '',
    drum(0, 0, rx, h, tones, { cap: false, sw: 3.5 }),
    seam(rx, -14),
    el('ellipse', { cx: 0, cy: -h, rx, ry, fill: 'none', stroke: line(), 'stroke-width': 3.5 }),
    // the water line: a short ink mark on the inner wall
    mark(`M ${n1(-30)} ${n1(-h - 12)} Q 0 ${n1(-h - 20)} 30 ${n1(-h - 12)}`, 2, 0.4),
    ...steam(0, -h - 4 + (f > 0.01 ? d * 0.2 : 0), steamAmt, phase, 90),
  ];
  return squashed(parts, squash);
}

export const NEW_PROPS = {
  'vacuum flask with a screw-on cup lid': {
    tags: {
      is: 'a thermos vacuum flask: a tall steel cylinder with a screw-on cup lid, a pouring stopper and a band of orange',
      setting: ['kitchen counter', 'table', 'picnic', 'office'],
      material: 'brushed steel body with an orange band, black plastic cup lid, flat tones with ink seams and riso grain',
      parts: ['tall steel cylinder', 'orange band', 'screw-on cup lid with grip ribs', 'pouring stopper button', 'pour lip', 'water-level window'],
      not: ['water bottle', 'drinks can', 'coffee pot', 'beaker', 'candle'],
    },
    size: [212, 384],
    states: ['default'],
    draw: (o) => drawFlask(o),
  },
  'stovetop kettle on a one-ring hob': {
    tags: {
      is: 'a stovetop kettle on a one-ring hob: squat steel body, curved spout, arched handle, knob lid, a small flame under it',
      setting: ['kitchen counter', 'table', 'kitchen'],
      material: 'light steel kettle on a dark hob slab, flat tones with ink seams and riso grain',
      parts: ['squat steel body', 'curved spout', 'arched handle', 'knob lid', 'one-ring hob slab', 'control knob', 'small flame', 'steam'],
      not: ['saucepan', 'teapot', 'electric kettle', 'watering can', 'oil lamp'],
    },
    size: [382, 230],
    states: ['default'],
    draw: (o) => drawKettle(o),
  },
  'ceramic mug with an ear handle': {
    tags: {
      is: 'a plain ceramic mug: a short cylinder with an ear handle, open at the top, with hot water inside it',
      setting: ['kitchen counter', 'table', 'office', 'kitchen'],
      material: 'glazed ceramic, flat paper tones with an ink seam and a water line inside, riso grain',
      parts: ['short cylinder', 'ear handle', 'open rim', 'water surface inside', 'steam'],
      not: ['drinking glass', 'flower pot', 'bucket', 'tin can', 'teacup with saucer'],
    },
    size: [160, 130],
    states: ['default'],
    draw: (o) => drawMug(o),
  },
};
