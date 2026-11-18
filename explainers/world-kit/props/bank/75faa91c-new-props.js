// The reel's new drawings (EX3-114): the cash machine's faces (screen, counter, limit message), the
// street clock's face and the jet ski flyer, as flat art in local units, shared by the world
// (world.js lays them on world faces in cm) and by flat frames (NEW_PROPS, drawn with propFrom).
// One drawing per concept, so the ATM counter and its look are the same in every frame (minimum 6).
import { el, g, T, id, ref, softShape, roundedPath } from '../../draw.js';
import { set } from '../../lens.js';

const PRAG = "'Pragmatica Extended', Roboto";
const ROBO = 'Roboto';

/** One line of text in local units. */
export function txt(s, x, y, size, fill, { face = PRAG, weight = 700, anchor = 'start', ls = 0 } = {}) {
  const a = { x, y, 'font-family': face, 'font-weight': weight, 'font-size': size, fill, 'text-anchor': anchor };
  if (ls) a['letter-spacing'] = ls;
  return el('text', a, s);
}

const rr = (x, y, w, h, r, fill, more = {}) => el('rect', { x, y, width: w, height: h, rx: r, fill, ...more });

/** The counter display (the throughline): a rounded panel, the label, "$0 of $500" and a bar that
 *  fills to a cap line. Local units: w × h (default 64 × 15, cm on the ATM screen). */
export function counterArt(count = 0, cap = 500, { prefix = '$', label = 'today', w = 64, h = 15 } = {}) {
  const u = Math.max(0, Math.min(1, count / cap));
  const bx0 = 3.5, bx1 = w - 6, by = h * 0.64, bh = h * 0.2;
  return set([
    rr(0.4, 0.4, w - 0.8, h - 0.8, h * 0.28, T['blue-dark'], { stroke: T['blue-lit'], 'stroke-width': 0.45, opacity: 0.95 }),
    txt(label, 3.5, h * 0.45, h * 0.24, T['blue-lit'], { face: ROBO, weight: 500 }),
    txt(`${prefix}${count} of ${prefix}${cap}`, bx1 - 1, h * 0.46, h * 0.3, T['paper-lit'], { anchor: 'end' }),
    rr(bx0, by, bx1 - bx0, bh, bh / 2, T['ink-dark'], { opacity: 0.7 }),
    u > 0 ? rr(bx0, by, Math.max(bh, (bx1 - bx0) * u), bh, bh / 2, T.yellow) : '',
    rr(bx1 - 0.3, by - bh * 0.5, 0.8, bh * 2, 0.4, T['paper-lit']),
  ].join(''));
}

/** The ATM screen, 68 × 40: bezel, the lit blue glass, and the upper message band by state
 *  (idle / reset: the daily limit; typing: the amount; dispense: the cash out). The limit
 *  message and the counter are drawn by their own entities on top (limitArt, counterArt). */
export function screenArt(state = 'idle', { typed = '$600', amount = '$200', w = 68, h = 40 } = {}) {
  const gid = id('atm-screen-glass');
  const defs = el('defs', {}, el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0.3, y2: 1 },
    el('stop', { offset: 0, 'stop-color': T['blue-lit'] }) + el('stop', { offset: 0.55, 'stop-color': T.blue })
    + el('stop', { offset: 1, 'stop-color': T['blue-shade'] })));
  const cx = w / 2;
  let band = '';
  if (state === 'idle' || state === 'reset') {
    band = txt('daily limit', cx, 8.6, 4.2, T['paper-lit'], { face: ROBO, weight: 500, anchor: 'middle' })
      + txt('$500', cx, 19.2, 9, T['paper-lit'], { anchor: 'middle' });
  } else if (state === 'typing') {
    band = txt('amount', cx, 8.6, 4.2, T['paper-lit'], { face: ROBO, weight: 500, anchor: 'middle' })
      + txt(typed, cx - 1, 19.2, 9, T['paper-lit'], { anchor: 'middle' })
      + rr(cx + 2 + typed.length * 3.1, 12.2, 0.9, 7.6, 0.3, T['paper-lit']);
  } else if (state === 'dispense') {
    band = txt('cash out', cx, 8.6, 4.2, T['paper-lit'], { face: ROBO, weight: 500, anchor: 'middle' })
      + txt(amount, cx, 19.2, 9, T['paper-lit'], { anchor: 'middle' });
  }
  return defs + rr(0, 0, w, h, 2.6, T['ink-dark'])
    + rr(1.6, 1.6, w - 3.2, h - 3.2, 1.8, ref('atm-screen-glass'))
    + el('path', { d: `M 1.6 1.6 L ${w * 0.55} 1.6 L ${w * 0.3} ${h - 1.6} L 1.6 ${h - 1.6} Z`, fill: T['paper-lit'], opacity: 0.07 })
    + set(band);
}

/** The refusal (limit_screen), 64 × 20: one red signal dot and the short red heading, the line
 *  under it in the screen's own light. Drawn over the screen's message band. */
export function limitArt({ w = 64, h = 20, glow = 1 } = {}) {
  return rr(0, 0, w, h, 2, T['blue-shade'], { opacity: 0.96 })
    + el('circle', { cx: 9, cy: 7.4, r: 4.4 * glow, fill: T['status-error'], opacity: 0.25 })
    + el('circle', { cx: 9, cy: 7.4, r: 2.5, fill: T['status-error'] })
    + set(txt('limit reached', 14.5, 9.4, 5.2, T['red-lit'])
      + txt('try again tomorrow', w / 2, 17, 3.9, T['paper-lit'], { face: ROBO, weight: 500, anchor: 'middle' }));
}

/** The street clock's face, 60 × 60 (centre 30, 30): rim, face, ticks, the 12, and the hands at
 *  `minutes` past midnight (23 × 60 + 59 is 11:59). `lit` warms the face (night). */
export function clockArt(minutes = 23 * 60 + 58, { lit = false } = {}) {
  const c = 30;
  const m = ((minutes % 720) + 720) % 720;
  const ma = ((m % 60) / 60) * Math.PI * 2;
  const ha = (m / 720) * Math.PI * 2;
  const hand = (a, len, w, col) => el('line', { x1: c - Math.sin(a) * 3, y1: c + Math.cos(a) * 3, x2: c + Math.sin(a) * len, y2: c - Math.cos(a) * len, stroke: col, 'stroke-width': w, 'stroke-linecap': 'round' });
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    const big = i % 3 === 0;
    const r0 = big ? 18.5 : 20.5, r1 = 23;
    return el('line', { x1: c + Math.sin(a) * r0, y1: c - Math.cos(a) * r0, x2: c + Math.sin(a) * r1, y2: c - Math.cos(a) * r1, stroke: T.ink, 'stroke-width': big ? 1.6 : 0.9, 'stroke-linecap': 'round' });
  }).join('');
  const gid = id('clock-rim');
  return el('defs', {}, el('linearGradient', { id: gid, x1: 1, y1: 0, x2: 0, y2: 1 },
      el('stop', { offset: 0, 'stop-color': T['ink-lit'] }) + el('stop', { offset: 1, 'stop-color': T['ink-dark'] })))
    + el('circle', { cx: c, cy: c, r: 29, fill: ref('clock-rim') })
    + el('circle', { cx: c, cy: c, r: 25.2, fill: lit ? T['yellow-lit'] : T['paper-lit'] })
    + el('path', { d: `M ${c - 18} ${c - 14} A 25 25 0 0 1 ${c + 16} ${c - 19}`, stroke: T.canvas, 'stroke-width': 1.4, fill: 'none', opacity: 0.6 })
    + ticks + set(txt('12', c, 15.6, 5, T.ink, { anchor: 'middle' }))
    + hand(ha, 12.5, 2.6, T.ink) + hand(ma, 19.5, 1.6, T.ink)
    + el('circle', { cx: c, cy: c, r: 1.9, fill: T.ink });
}

/** The jet ski flyer, 22 × 28: "for sale", a jet ski on a wave, its price. */
export function flyerArt({ w = 22, h = 28, bg = true } = {}) {
  const sx = w / 22, sy = h / 28;
  const inner = (bg ? rr(0, 0, 22, 28, 0.9, T['paper-lit'], { stroke: T['paper-shade'], 'stroke-width': 0.4 }) : '')
    + set(txt('for sale', 11, 4.6, 2.8, T['ink-lit'], { face: ROBO, weight: 700, anchor: 'middle' }))
    + set(txt('$600', 11, 11.2, 5.4, T.ink, { anchor: 'middle' }))
    + g({ transform: 'translate(0 -1.5)' },
      el('path', { d: 'M 2.6 21.8 Q 6 20.6 9 21.8 T 15.4 21.8 T 19.6 21.4', stroke: T['teal-lit'], 'stroke-width': 0.9, fill: 'none', 'stroke-linecap': 'round' })
      + el('path', { d: 'M 3.2 17.4 Q 4 20.4 8.6 20.6 L 18.4 20.6 Q 20.2 18.6 18.8 16.4 L 11.6 16.4 L 9.6 13.4 L 6.4 13.4 L 5.8 16.6 Z', fill: T.blue })
      + rr(8.4, 14.7, 5.2, 1.6, 0.6, T.ink)
      + el('line', { x1: 7.2, y1: 13.4, x2: 6.6, y2: 11.2, stroke: T.ink, 'stroke-width': 0.8, 'stroke-linecap': 'round' }));
  return g({ transform: `scale(${sx} ${sy})` }, inner);
}

/** The flyer as a held prop (cast.js PROPS shape): a sheet in the hand, the art printed on it. */
export const FLYER_PROP = {
  upright: true,
  lean: -6,
  box: { x: 2, y: -58, w: 44, h: 56 },
  draw: () => g({ transform: 'translate(2 -58) scale(2)' }, flyerArt()),
};

// ---- flat drawings for frames off the lens (NEW_PROPS, propFrom) ----

const K = 2.1; // px per cm in the flat ATM

function atmFlat(state = 'idle', focal = false) {
  const w = 112 * K, h = 124 * K, x0 = -w / 2;
  const at = (x, z) => [x * K, -z * K];
  const body = roundedPath([[x0, -h], [x0 + w, -h], [x0 + w, 0], [x0, 0]], 10);
  const hood = roundedPath([[x0 - 8, -h - 18], [x0 + w + 8, -h - 18], [x0 + w + 8, -h + 2], [x0 - 8, -h + 2]], 7);
  const [sx, sy] = at(-40, 108);
  const [cx, cy] = at(-38, 85);
  const [lx, ly] = at(-38, 107);
  const [kx, ky] = at(-34, 60);
  const [px, py] = at(-30, 40);
  const keys = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const fill = c < 3 ? T['paper-lit'] : [T.green, T.yellow, T.red, T['paper-shade']][r];
    keys.push(rr(kx + 2 * K + c * 9.5 * K, ky + 0.8 * K + r * 2.9 * K, 7.5 * K, 2.2 * K, 0.8 * K, fill));
  }
  const scr = state === 'limit' ? 'none' : state;
  return [
    el('ellipse', { cx: 0, cy: 0, rx: w * 0.56, ry: 14, fill: T['shadow-warm'], opacity: 0.18 }),
    softShape(body, T['paper-lit']),
    softShape(hood, T['ink-lit'], { gloss: true }),
    g({ transform: `translate(${sx} ${sy}) scale(${K})` }, screenArt(scr)),
    g({ transform: `translate(${cx} ${cy}) scale(${K})` }, counterArt(0, 500)),
    state === 'limit' ? g({ transform: `translate(${lx} ${ly}) scale(${K})` }, limitArt()) : '',
    rr(kx, ky, 40 * K, 12 * K, 2 * K, T['ink-lit']) + keys.join(''),
    rr(px, py, 60 * K, 12 * K, 2 * K, T['ink-lit']) + rr(px + 4 * K, py + 5 * K, 52 * K, 1.4 * K, 0.6 * K, T['ink-dark']),
    focal ? el('rect', { x: x0 - 12, y: -h - 26, width: w + 24, height: h + 30, rx: 14, fill: 'none', stroke: T.orange, 'stroke-width': 4, opacity: 0.8 }) : '',
  ];
}

function clockFlat(state = 'before') {
  const minutes = state === 'midnight' ? 0 : 23 * 60 + 59;
  const s = 3.4;
  return [
    rr(-4, -260, 8, 60, 3, T.ink),
    g({ transform: `translate(${-30 * s} ${-200 - 0}) scale(${s})` }, clockArt(minutes)),
  ];
}

/** New drawings for flat frames, base centre at (0, 0), px at s = 1. */
export const NEW_PROPS = {
  'cash machine': {
    states: ['idle', 'typing', 'limit', 'reset'],
    size: [252, 300],
    tags: {
      is: ['cash machine', 'atm', 'bank machine'],
      setting: ['bank wall', 'street'],
      material: ['painted metal', 'glass'],
      parts: ['hood', 'screen', 'counter display', 'keypad', 'card slot', 'cash slot'],
      not: ['vending machine', 'phone', 'logo'],
    },
    draw: ({ state = 'idle', focal = false } = {}) => atmFlat(state, focal),
  },
  'street clock': {
    states: ['before', 'midnight'],
    size: [204, 290],
    tags: {
      is: ['street clock', 'wall clock'],
      setting: ['bank front', 'street'],
      material: ['metal', 'enamel'],
      parts: ['bracket', 'rim', 'face', 'hands'],
      not: ['wristwatch', 'timer', 'stopwatch'],
    },
    draw: ({ state = 'before' } = {}) => clockFlat(state),
  },
  'jet ski flyer': {
    states: ['plain'],
    size: [132, 168],
    tags: {
      is: ['flyer', 'for sale notice'],
      setting: ['in a hand', 'taped to a cash machine'],
      material: ['paper'],
      parts: ['heading', 'price', 'jet ski drawing'],
      not: ['poster', 'ticket', 'banknote'],
    },
    draw: () => [g({ transform: 'translate(-66 -168) scale(6)' }, flyerArt())],
  },
};
