// Frame 3's own drawings (EX3-114): the far server tower, the near crate, the program tile and the
// data card of the definition's visual. Each is drawn about its base center, in the paper style.

import { T, el, line, TONES, shadow, box, cbox, face, mark, accent } from '../../props/kit.js';

const WOOD = [T['paper-shade'], T['paper-dark'], T['text-tertiary']];

/** The inside of a data card, on a front face: a header band, rows of ink and a small table mark. */
const cardInner = (w, h) => [
  el('rect', { x: 0, y: 0, width: w, height: h, rx: 4, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 3 }),
  el('rect', { x: 3, y: 3, width: w - 6, height: 14, rx: 2, fill: T['paper-shade'] }),
  mark(`M 8 10 L ${w * 0.5} 10`, 3),
  mark(`M 8 30 L ${w - 8} 30`, 2.6, 0.7),
  mark(`M 8 42 L ${w - 14} 42`, 2.6, 0.7),
  mark(`M 8 54 L ${w * 0.6} 54`, 2.6, 0.7),
];

export const NEW_PROPS = {
  'a tall server tower with a card slot': {
    tags: {
      is: 'a tall narrow server tower standing on a dark plinth: five stacked rack units with small status lights and one dark slot with a data card poking out, vent lines down its side',
      setting: ['data center', 'server room', 'far away source of data'],
      material: 'painted metal case, paper card',
      parts: ['dark plinth', 'five rack units', 'status lights', 'dark card slot', 'data card in the slot', 'side vents'],
      not: ['filing cabinet', 'wardrobe', 'refrigerator', 'locker', 'skyscraper', 'speaker'],
    },
    size: [90, 290],
    states: ['ready'],
    draw: () => {
      const parts = [shadow(0, 8, 76, 28)];
      parts.push(cbox(0, 0, 0, 92, 92, 14, TONES.ink));
      parts.push(cbox(0, 0, 14, 76, 76, 256, TONES.paper));
      const rows = [];
      for (let i = 0; i < 5; i++) {
        const y = 18 + i * 46;
        if (i === 3) {
          rows.push(el('rect', { x: 8, y, width: 60, height: 34, rx: 4, fill: T.ink, stroke: T.ink, 'stroke-width': 2.5 }));
          rows.push(...cardInner(44, 40).map((p) => el('g', { transform: `translate(16 ${y - 10}) scale(0.9)` }, p)));
        } else {
          rows.push(el('rect', { x: 8, y, width: 60, height: 34, rx: 4, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 2.5 }));
          rows.push(mark(`M 14 ${y + 17} L 38 ${y + 17}`, 3, 0.55));
          rows.push(el('circle', { cx: 56, cy: y + 17, r: 4, fill: T.ink }));
        }
      }
      parts.push(face('front', -38, 38, 270, rows));
      const vents = [];
      for (let i = 0; i < 7; i++) vents.push(mark(`M 12 ${30 + i * 16} L 64 ${30 + i * 16}`, 2.5, 0.45));
      parts.push(face('side', 38, 38, 270, vents));
      return parts;
    },
  },

  'an open slatted wooden crate': {
    tags: {
      is: 'a low open wooden crate made of three slats on each visible side, nailed at the corners, open at the top; kept, a data card stands in it with its top edge above the rim',
      setting: ['near the program', 'warehouse floor', 'local storage'],
      material: 'plain wood slats, nails, paper card',
      parts: ['floor board', 'three slats per side', 'nails', 'standing data card when kept'],
      not: ['cardboard box', 'treasure chest', 'drawer', 'basket', 'bin', 'cage'],
    },
    size: [220, 140],
    states: ['empty', 'kept'],
    draw: ({ state, focal }) => {
      const t = accent(focal, WOOD);
      const parts = [shadow(0, 8, 120, 50)];
      parts.push(box(-60, -60, 0, 120, 120, 6, t));
      parts.push(box(-60, -60, 6, 120, 8, 50, t));
      parts.push(box(-60, -60, 6, 8, 120, 50, t));
      if (state === 'kept') parts.push(face('front', -24, 0, 84, cardInner(48, 64)));
      for (const z of [6, 24, 42]) {
        parts.push(box(52, -60, z, 8, 120, 14, t));
        parts.push(box(-60, 52, z, 120, 8, 14, t));
      }
      parts.push(face('front', -60, 60, 56, [0, 1].map((i) => el('circle', { cx: 10 + i * 100, cy: 8, r: 2.6, fill: T.ink, opacity: 0.7 }))));
      return parts;
    },
  },

  'a program window tile on a stand': {
    tags: {
      is: 'an upright square program window on a small stand: a title bar with three dots and a code mark of two angle brackets with a slash, and a little ledge in front where a card can be set',
      setting: ['software', 'a program asking for data', 'screen'],
      material: 'paper slab, ink marks',
      parts: ['small foot', 'stand post', 'upright slab', 'title bar with three dots', 'angle bracket code mark', 'card ledge'],
      not: ['signboard', 'tablet', 'tv', 'picture frame', 'phone', 'laptop'],
    },
    size: [150, 190],
    states: ['default'],
    draw: () => {
      const parts = [shadow(0, 8, 84, 30)];
      parts.push(box(-34, -24, 0, 68, 48, 10, WOOD));
      parts.push(box(-8, -8, 10, 16, 16, 30, TONES.paper));
      parts.push(box(-45, 8, 32, 90, 32, 8, WOOD));
      parts.push(box(-65, -8, 40, 130, 16, 120, TONES.paper));
      parts.push(
        face('front', -65, 8, 160, [
          el('rect', { x: 8, y: 8, width: 114, height: 104, rx: 6, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 3 }),
          el('rect', { x: 11, y: 11, width: 108, height: 20, rx: 3, fill: T['paper-shade'] }),
          ...[0, 1, 2].map((i) => el('circle', { cx: 24 + i * 16, cy: 21, r: 4, fill: T.ink })),
          mark('M 42 62 L 26 78 L 42 94', 5),
          mark('M 88 62 L 104 78 L 88 94', 5),
          mark('M 74 56 L 58 100', 5),
        ]),
      );
      return parts;
    },
  },

  'a small paper data card': {
    tags: {
      is: 'a small upright paper data card with a shaded header band and three short ink rows, thin like a playing card',
      setting: ['data moving between a server and a program', 'cache copy'],
      material: 'paper, ink',
      parts: ['header band', 'three ink rows'],
      not: ['credit card', 'playing card', 'business card', 'sticky note', 'ticket'],
    },
    size: [60, 80],
    states: ['default'],
    draw: () => [shadow(0, 6, 34, 12, 0.1), box(-24, -3, 0, 48, 6, 64, TONES.paper), face('front', -24, 3, 64, cardInner(48, 64))],
  },
};
