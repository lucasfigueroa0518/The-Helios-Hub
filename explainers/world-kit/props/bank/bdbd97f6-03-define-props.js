// Frame 3's own drawings (EX3-114): the far server cabinet, the small saved-copy box, a phone on its
// stand, and the result slip that flies between them. Each is drawn about its base center (0, 0 = where
// it touches the table) in screen px at scale 1, in the kit's paper-and-ink style.
// draw() takes { state, focal } plus optional pose values (squash, fly).

import { T, el, g, shadow, TONES, cbox, face, top, mark, accent } from '../../props/kit.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

const squashed = (parts, squash) => {
  const q = clamp01(squash || 0);
  return q > 0 ? [g({ transform: `scale(${(1 + 0.1 * q).toFixed(4)} ${(1 - 0.14 * q).toFixed(4)})` }, parts)] : parts;
};

const rect = (x, y, w, h, o = {}) => el('rect', { x, y, width: w, height: h, rx: 4, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 2.5, ...o });

const SERVER = 'server cabinet with drive bays';
const SAVED = 'lidded storage box with a copied sheet on top';
const PHONE = 'smartphone upright on a small stand';
const SLIP = 'small paper result slip with a tick';

export const NEW_PROPS = {
  [SERVER]: {
    tags: {
      is: 'a tall server cabinet: a boxy tower whose front is four drive bays, each a slot and a status dot',
      setting: 'a data centre or server room, the far source of data that software fetches from',
      material: 'paper-and-ink solid, paper tones with ink detail',
      parts: ['tall box body', 'four drive bays with slots', 'status dots', 'side vents'],
      not: ['a fridge', 'a wardrobe', 'a filing cabinet', 'a computer tower on a desk'],
    },
    size: [140, 260],
    states: ['default'],
    draw: ({ focal = false } = {}) => {
      const H = 210;
      const bays = [0, 1, 2, 3].map((i) => {
        const y = 14 + i * 46;
        return [
          rect(8, y, 76, 36),
          mark(`M 16 ${y + 18} L 56 ${y + 18}`, 3.5, 0.7),
          el('circle', { cx: 70, cy: y + 18, r: 4.5, fill: T['paper-shade'], stroke: T.ink, 'stroke-width': 2.2 }),
        ].join('');
      });
      return [
        shadow(6, 6, 80, 28),
        cbox(0, 0, 0, 92, 72, H, accent(focal)),
        face('front', -46, 36, H, bays),
        face('side', 46, 36, H, [0, 1, 2].map((i) => mark(`M 12 ${24 + i * 20} L 52 ${24 + i * 20}`, 3, 0.35))),
      ];
    },
  },

  [SAVED]: {
    tags: {
      is: 'a small lidded storage box that keeps a saved copy: a squat box with a lid, a label plate, and two stacked sheets drawn on the lid',
      setting: 'next to the software, the nearby stored copy that is reused instead of fetched again',
      material: 'paper-and-ink solid, orange when it is the focal',
      parts: ['squat box body', 'proud lid', 'label plate on the front', 'two offset sheets on the lid'],
      not: ['a gift box', 'a safe', 'a bin', 'a moving box'],
    },
    size: [210, 130],
    states: ['default'],
    draw: ({ focal = false, squash = 0 } = {}) => {
      const parts = [
        shadow(0, 6, 110, 38),
        cbox(0, 0, 0, 110, 84, 56, accent(focal)),
        cbox(0, 0, 56, 118, 92, 12, accent(focal)),
        face('front', -59, 46, 68, [
          rect(34, 20, 54, 28, { rx: 3 }),
          mark('M 42 30 L 80 30 M 42 40 L 68 40', 2.5, 0.7),
        ]),
        top(-32, -24, 68, [
          rect(10, 6, 50, 40, { rx: 3, fill: T['paper-shade'] }),
          rect(0, 0, 50, 40, { rx: 3 }),
          mark('M 8 12 L 40 12 M 8 21 L 40 21 M 8 30 L 28 30', 2.5, 0.7),
        ]),
      ];
      return squashed(parts, squash);
    },
  },

  [PHONE]: {
    tags: {
      is: 'a smartphone standing upright on a small dock: a dark slab with a lit screen, on a low base',
      setting: 'the user holding or testing software, the thing that asks for the result',
      material: 'paper-and-ink solid, ink body with a paper screen',
      parts: ['dock base', 'dark phone slab', 'screen showing waiting dots or a received result'],
      not: ['a tablet', 'a remote control', 'a book'],
    },
    size: [150, 210],
    states: ['waiting', 'received'],
    draw: ({ state, squash = 0 } = {}) => {
      const H = 128;
      const got = state === 'received';
      const screen = got
        ? [
            mark('M 12 34 L 52 34 M 12 50 L 52 50 M 12 66 L 38 66', 4, 0.6),
            mark('M 16 96 L 26 106 L 46 84', 5, 1),
          ]
        : [0, 1, 2].map((i) => el('circle', { cx: 18 + i * 14, cy: 60, r: 4.5, fill: T.ink, opacity: 0.55 }));
      const parts = [
        shadow(4, 8, 66, 22),
        cbox(0, 6, 0, 90, 50, 8, TONES.paper),
        cbox(0, 0, 8, 64, 12, H, TONES.ink),
        face('front', -32, 6, 8 + H, [rect(5, 6, 54, H - 12, { rx: 6 }), g({ transform: 'translate(0 6)' }, screen)]),
      ];
      return squashed(parts, squash);
    },
  },

  [SLIP]: {
    tags: {
      is: 'a small slip of paper carrying a result: a thin slab with a tick and two lines on its top face',
      setting: 'the result of a request travelling from stored copy to the software',
      material: 'paper-and-ink solid, thin slab',
      parts: ['thin paper slab', 'tick mark', 'two ink lines'],
      not: ['an envelope', 'a ticket', 'a banknote'],
    },
    size: [90, 50],
    states: ['default'],
    draw: ({ fly = false } = {}) => [
      fly ? '' : shadow(0, 4, 40, 14),
      cbox(0, 0, 0, 56, 40, 5, TONES.paper),
      top(-28, -20, 5, [mark('M 8 20 L 14 27 L 26 12', 3.5, 1), mark('M 32 14 L 48 14 M 32 26 L 44 26', 3, 0.6)]),
    ],
  },
};

export const NAMES = { SERVER, SAVED, PHONE, SLIP };
