// Frame 6's own drawings (EX3-114): a browser window with a blank news page, and a small open-top
// file box on the device that receives the saved logo. Each is drawn about its base center
// (0, 0 = where it touches the table) in screen px at scale 1, in the kit's paper-and-ink style.
// The page's content is drawn live by the frame module in the window's local coordinates, clipped
// to WINDOW.page.

import { T, el, g, line, shadow, TONES, cbox, face, top } from '../../props/kit.js';

/** The window's geometry in local px at scale 1 (origin = bottom centre). */
export const WINDOW = {
  body: { x0: -150, x1: 150, y0: -260, y1: 0 },
  page: { x0: -142, x1: 142, y0: -220, y1: -8 },
};

export const BROWSER = 'browser window showing a news page';
export const FILE_BOX = 'open-top file box with a dark slot';

const rect = (x, y, w, h, o = {}) => el('rect', { x, y, width: w, height: h, rx: 4, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 2.5, ...o });

export const NEW_PROPS = {
  [BROWSER]: {
    tags: {
      is: 'a browser window standing upright: a tall paper card with a title bar of three dots and an address pill above a blank light page',
      setting: 'a screen where a person opens a news website; the page content is drawn live inside it',
      material: 'paper-and-ink slab, paper tones with ink outline, thickness shown behind to the upper right',
      parts: ['title bar', 'three window dots', 'address pill', 'blank page area', 'slab thickness', 'contact shadow'],
      not: ['a phone', 'a tablet', 'a laptop', 'a poster', 'a book'],
    },
    size: [320, 280],
    states: ['default'],
    draw: () => {
      const b = WINDOW.body;
      const w = b.x1 - b.x0;
      const h = b.y1 - b.y0;
      return [
        shadow(10, 6, 190, 26, 0.14),
        el('rect', { x: b.x0 + 14, y: b.y0 - 10, width: w, height: h, rx: 10, fill: T.ink, stroke: line(), 'stroke-width': 3, 'stroke-linejoin': 'round' }),
        el('rect', { x: b.x0, y: b.y0, width: w, height: h, rx: 10, fill: T['paper-shade'], stroke: line(), 'stroke-width': 3.5, 'stroke-linejoin': 'round' }),
        // title bar: three dots and the address pill
        ...[0, 1, 2].map((i) => el('circle', { cx: b.x0 + 22 + i * 18, cy: b.y0 + 20, r: 5.5, fill: T['paper-dark'], stroke: T.ink, 'stroke-width': 2 })),
        rect(b.x0 + 86, b.y0 + 8, 190, 24, { rx: 12, 'stroke-width': 2 }),
        el('path', { d: `M ${b.x0 + 104} ${b.y0 + 20} L ${b.x0 + 186} ${b.y0 + 20}`, stroke: T.ink, 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.45 }),
        // the blank page
        el('rect', { x: WINDOW.page.x0, y: WINDOW.page.y0, width: WINDOW.page.x1 - WINDOW.page.x0, height: WINDOW.page.y1 - WINDOW.page.y0, rx: 4, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 2.5 }),
      ];
    },
  },

  [FILE_BOX]: {
    tags: {
      is: 'a squat file box with an open top: a dark slot in the lid to drop a file into, a folder sheet standing at the back, and a plate on the front that shows what is saved',
      setting: 'on the device next to the browser, the saved files the browser keeps and reuses',
      material: 'paper-and-ink solid, paper tones with an ink slot and ink detail',
      parts: ['squat box body', 'dark slot opening', 'folder sheet standing at the back', 'front plate with the saved item'],
      not: ['a gift box', 'a safe', 'a bin', 'a moving box', 'a lidded storage box'],
    },
    size: [190, 130],
    states: ['empty', 'saved'],
    draw: ({ state }) => {
      const saved = state === 'saved';
      return [
        shadow(0, 8, 110, 34),
        cbox(0, 0, 0, 120, 90, 60, TONES.paper),
        top(-44, -28, 60, [el('rect', { x: 0, y: 0, width: 88, height: 56, rx: 3, fill: T.ink, stroke: T.ink, 'stroke-width': 2 })]),
        // the folder sheet standing at the back of the slot
        cbox(0, -36, 60, 96, 5, 30, TONES.paper),
        face('front', -60, 45, 60, [
          rect(24, 12, 72, 34, { rx: 3 }),
          saved
            ? g({}, [
                rect(34, 17, 24, 24, { rx: 5, fill: T['ink-lit'], 'stroke-width': 2 }),
                el('circle', { cx: 42, cy: 25, r: 4.5, fill: T['paper-lit'] }),
                el('path', { d: 'M 66 22 L 88 22 M 66 32 L 82 32', stroke: T.ink, 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.7 }),
              ])
            : el('path', { d: 'M 36 24 L 84 24 M 36 34 L 70 34', stroke: T.ink, 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.3 }),
        ]),
      ];
    },
  },
};
