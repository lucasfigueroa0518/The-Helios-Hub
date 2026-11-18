// New drawings for this reel (EX3-114): the treat (a bone-shaped dog biscuit, the hero object)
// and the chewed sneaker. Each is soft 3D from palette tokens and two-token mixes only, matte
// (no gloss: baked biscuit and canvas), lit from the top right. The art helpers are shared by
// world.js (lens billboards) and by flat frames (NEW_PROPS through propFrom).
import { el, g, id, ref, shadow, T } from '../../draw.js';
import { mixHex } from '../../core.js';

const r1 = (v) => Math.round(v * 10) / 10;

/** The biscuit's ramp: baked golden brown, clearly darker and redder than the golden puppy. */
export const TREAT_TONES = {
  lit: mixHex(T.yellow, T['red-shade'], 0.32),
  base: mixHex(T['yellow-shade'], T['red-dark'], 0.4),
  shade: mixHex(T['yellow-dark'], T['red-dark'], 0.58),
  dark: mixHex(T['red-dark'], T['shadow-warm'], 0.5),
};

/** A dog-bone outline, 98 units long, 58 tall, centred on (0, 0) (two lobes at each end). */
export const BONE_D = 'M 24.3 -10 L -24.3 -10 A 16 16 0 1 0 -49.3 0 A 16 16 0 1 0 -24.3 10 L 24.3 10 A 16 16 0 1 0 49.3 0 A 16 16 0 1 0 24.3 -10 Z';
const BONE_DOTS = [[-22, -2], [-8, 3], [6, -3], [20, 2], [-38, -14], [38, 14]];

/**
 * The treat as screen art: centred on (cx, cy), `w` px long. `flat` lays it on the floor (seen
 * from above at an angle: foreshortened, its thickness below), else it stands up facing the lens
 * (held up, falling). `rot` turns it in degrees (a tumble while it drops).
 */
export function treatArt(cx, cy, w, { flat = false, rot = 0 } = {}) {
  const k = w / 98;
  const fy = flat ? 0.5 : 1;
  const th = flat ? 11 : 7;
  const C = TREAT_TONES;
  const gT = id('nb-treat-top');
  const gS = id('nb-treat-side');
  const defs = el('defs', {},
    el('linearGradient', { id: gT, x1: 1, y1: 0, x2: 0, y2: 1 },
      el('stop', { offset: 0, 'stop-color': C.lit }) + el('stop', { offset: 0.55, 'stop-color': C.base }) + el('stop', { offset: 1, 'stop-color': C.shade }))
    + el('linearGradient', { id: gS, x1: 0, y1: 0, x2: 0, y2: 1 },
      el('stop', { offset: 0, 'stop-color': C.shade }) + el('stop', { offset: 1, 'stop-color': C.dark })));
  const dots = BONE_DOTS.map(([x, y]) =>
    el('circle', { cx: x, cy: y + 0.8, r: 2.6, fill: C.lit, opacity: 0.55 })
    + el('circle', { cx: x, cy: y, r: 2.4, fill: C.shade, opacity: 0.9 })).join('');
  const body = [
    el('path', { d: BONE_D, transform: `translate(${flat ? 0 : -2.5} ${th})`, fill: ref('nb-treat-side') }),
    el('path', { d: BONE_D, fill: ref('nb-treat-top') }),
    // a lit rim along the top-right edge, a soft form shade low left
    el('path', { d: BONE_D, fill: 'none', stroke: C.lit, 'stroke-width': 2.2, opacity: 0.55, transform: 'translate(0.8 -0.8) scale(0.985)' }),
    dots,
  ].join('');
  return g({ 'data-prop': 'treat' }, defs + g({ transform: `translate(${r1(cx)} ${r1(cy)}) rotate(${r1(rot)}) scale(${(k).toFixed(4)} ${(k * fy).toFixed(4)})` }, body));
}

/** The treat's soft contact shadow on the floor under (cx, cy), `w` px long, fading with height (0 = on it). */
export function treatShadow(cx, cy, w, lift = 0) {
  const o = Math.max(0, 0.2 * (1 - lift));
  return o > 0.01 ? shadow(cx, cy, w * (0.55 + 0.2 * lift), w * 0.13, o) : '';
}

const SHOE_UPPER = 'M -50 -9 C -53 -24 -47 -40 -33 -43 L -18 -42 C -12 -34 -4 -29 8 -26 L 30 -21 C 44 -18 52 -14 52 -9 Z';
const SHOE_TOE = 'M 24 -22 C 40 -19 52 -15 52 -9 L 21 -9 C 19 -14 19 -19 24 -22 Z';
const SHOE_SOLE = 'M -48 -11 L 50 -11 Q 56 -11 56 -5 Q 56 0 50 0 L -48 0 Q -54 0 -54 -5 Q -54 -11 -48 -11 Z';

/**
 * The chewed sneaker as screen art, side view: its sole's centre at (bx, by), `len` px long. `rot`
 * turns it about that point (held in jaws, tossed), `flip` points the toe left. No logo.
 */
export function shoeArt(bx, by, len, { rot = 0, flip = false } = {}) {
  const k = len / 110;
  const gU = id('nb-shoe-upper');
  const defs = el('defs', {}, el('linearGradient', { id: gU, x1: 1, y1: 0, x2: 0, y2: 1 },
    el('stop', { offset: 0, 'stop-color': T['lilac-lit'] }) + el('stop', { offset: 0.5, 'stop-color': T.lilac }) + el('stop', { offset: 1, 'stop-color': T['lilac-shade'] })));
  const laces = [[-8, -31], [2, -28], [12, -25]].map(([x, y]) =>
    el('rect', { x: x - 5, y: y - 2, width: 10, height: 4, rx: 2, fill: T['paper-lit'], transform: `rotate(18 ${x} ${y})` })).join('');
  const bites = [[-42, -36], [-36, -39.5], [-29, -41.5], [-47, -30]].map(([x, y]) =>
    el('circle', { cx: x, cy: y, r: 2.6, fill: T['lilac-dark'] })).join('');
  const body = [
    el('path', { d: SHOE_SOLE, fill: T['paper-shade'] }),
    el('path', { d: SHOE_SOLE, fill: T['paper-lit'], transform: 'translate(0 -1.5) scale(1 0.9)' }),
    el('path', { d: 'M -52 -4.5 L 54 -4.5', stroke: T['paper-dark'], 'stroke-width': 1.6 }),
    el('path', { d: SHOE_UPPER, fill: ref('nb-shoe-upper') }),
    el('path', { d: SHOE_UPPER, fill: 'none', stroke: T['lilac-lit'], 'stroke-width': 2, opacity: 0.6, transform: 'translate(0.8 -0.8)' }),
    el('path', { d: SHOE_TOE, fill: T['paper-lit'] }),
    el('ellipse', { cx: -25, cy: -42, rx: 9, ry: 3, fill: T['lilac-dark'] }),
    el('path', { d: 'M -20 -36 C -12 -24 4 -18 26 -15', fill: 'none', stroke: T['lilac-shade'], 'stroke-width': 2.4, opacity: 0.7 }),
    laces,
    bites,
    el('path', { d: 'M -49 -18 l 4 -2 l -1 4 l 4 -1', fill: 'none', stroke: T['lilac-dark'], 'stroke-width': 1.6 }),
  ].join('');
  const sx = flip ? -k : k;
  return g({ 'data-prop': 'shoe' }, defs + g({ transform: `translate(${r1(bx)} ${r1(by)}) rotate(${r1(rot)}) scale(${sx.toFixed(4)} ${k.toFixed(4)})` }, body));
}

/** The new props for flat and isometric frames (propFrom(NEW_PROPS, name, x, y, { s, state })): base centre at (0, 0). */
export const NEW_PROPS = {
  'dog biscuit treat': {
    tags: {
      is: 'a bone-shaped dog biscuit, the reward a puppy earns for sitting',
      setting: 'a family living room, a trainer\'s treat pouch, the rug where it drops',
      material: 'baked biscuit, matte, warm golden brown with docking dots',
      parts: ['two round lobes at each end', 'a short bar between them', 'docking dots on top'],
      not: ['a real brand', 'a face', 'orange'],
    },
    size: [260, 154],
    states: ['upright', 'flat'],
    draw: ({ state = 'upright' } = {}) => state === 'flat'
      ? [treatShadow(0, -2, 200), treatArt(0, -16, 200, { flat: true })]
      : [treatArt(0, -64, 200)],
  },
  'chewed sneaker': {
    tags: {
      is: 'a lilac canvas sneaker with bite marks at the heel, chewed by a puppy',
      setting: 'lying on a living-room rug',
      material: 'lilac canvas upper, white rubber sole and toe cap',
      parts: ['sole', 'upper', 'toe cap', 'laces', 'collar', 'bite marks'],
      not: ['a logo', 'a brand', 'a face'],
    },
    size: [284, 128],
    states: ['lying'],
    draw: () => [shadow(0, 0, 120, 14, 0.16), shoeArt(0, 0, 240)],
  },
};
