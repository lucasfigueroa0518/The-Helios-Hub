// The library's own new drawings (EX3-114), for the isometric camera or a flat frame: the rubber
// stamp, the yellow request slip, the floor-map lectern and the hardback with its lilac spine tag.
// Each stands on its base centre like the bank's assets, with full tags. Through the perspective
// camera the same things are drawn in world.js (drawStamp, HOLDS.request_slip, drawFloorMap,
// drawBook), in the same colours: one look per thing.

import { el, T, TONES, box, face, shadow, accent } from '../../props/kit.js';
import { tonesOf } from '../../draw.js';

const HONEY = tonesOf({ mix: ['yellow-dark', 'paper-shade', 0.35] });
const WALNUT = tonesOf({ mix: ['yellow-dark', 'ink-lit', 0.45] });

export const NEW_PROPS = {
  'library rubber stamp with lilac ink pad': {
    tags: {
      is: 'a library code rubber stamp: a lilac rubber pad under a honey-wood block, a short dark-wood neck and a squat rounded dark-wood handle',
      setting: ['library circulation desk', 'library stamping desk', 'cataloguing books'],
      material: 'wood block and handle, rubber pad, lilac ink',
      parts: ['lilac rubber pad', 'honey-wood block', 'dark-wood neck', 'squat rounded handle'],
      not: ['postage stamp', 'wax seal', 'notary seal', 'approve button', 'hammer', 'checkmark stamp', 'office approval stamp'],
    },
    size: [100, 150],
    states: ['default'],
    draw: ({ focal }) => [
      shadow(0, 6, 48, 18),
      box(-22, -16, 0, 44, 32, 5, TONES.lilac, { radius: 3 }),
      box(-22, -16, 5, 44, 32, 22, accent(focal, HONEY), { radius: 5, gloss: true }),
      box(-5, -5, 27, 10, 10, 12, WALNUT, { radius: 3, shadow: false }),
      box(-17, -13, 39, 34, 26, 16, WALNUT, { radius: 7, gloss: true, shadow: false }),
    ],
  },

  'yellow library request slip': {
    tags: {
      is: 'a small yellow paper library request slip with a folded-down corner and three short printed lines',
      setting: ['library desk', 'library request', 'asking for a book'],
      material: 'yellow paper',
      parts: ['yellow paper sheet', 'folded corner', 'three short lines'],
      not: ['sticky note', 'receipt', 'ticket', 'envelope', 'index card', 'search bar', 'form with boxes'],
    },
    size: [90, 120],
    states: ['default'],
    draw: ({ focal }) => [
      shadow(0, 4, 40, 10),
      el('path', { d: 'M -34 -104 L 22 -104 L 34 -92 L 34 0 L -34 0 Z', fill: focal ? T.orange : T['yellow-lit'] }),
      el('path', { d: 'M 22 -104 L 34 -92 L 22 -92 Z', fill: T.yellow }),
      ...[0, 1, 2].map((i) => el('path', { d: `M -22 ${-80 + i * 20} L ${i === 2 ? 2 : 20} ${-80 + i * 20}`, stroke: T['ink-lit'], 'stroke-width': 3, 'stroke-linecap': 'round', fill: 'none', opacity: 0.5 })),
    ],
  },

  'library floor map lectern': {
    tags: {
      is: 'a tall wooden lectern holding a blue printed floor map of a library: ten shelf rows drawn as light strips above the entrance hall, one aisle lit warm white when lit',
      setting: ['library entrance hall', 'head of the library aisles', 'finding a shelf'],
      material: 'honey and dark wood, printed blue map board',
      parts: ['wooden foot', 'column', 'framed map board', 'ten shelf rows', 'entrance-hall outline', 'one lit aisle'],
      not: ['road map', 'treasure map', 'blueprint', 'whiteboard', 'screen', 'museum sign', 'menu board', 'mall directory with text'],
    },
    size: [200, 300],
    states: ['dark', 'lit'],
    draw: ({ state, focal }) => {
      const art = [el('rect', { x: 6, y: 6, width: 168, height: 128, rx: 4, fill: T['blue-shade'] })];
      for (let k = 0; k < 10; k++) art.push(el('rect', { x: 18 + k * 15.2, y: 18, width: 6, height: 82, rx: 2, fill: T['blue-lit'] }));
      art.push(el('rect', { x: 36, y: 108, width: 108, height: 18, rx: 2, fill: 'none', stroke: T['paper-shade'], 'stroke-width': 2 }));
      if (state === 'lit') art.push(el('rect', { x: 18 + 4 * 15.2 + 7, y: 16, width: 7.4, height: 86, rx: 3, fill: focal ? T.orange : T.canvas }));
      return [
        shadow(0, 8, 70, 24),
        box(-50, -30, 0, 100, 60, 8, WALNUT, { radius: 4 }),
        box(-10, -10, 8, 20, 20, 110, HONEY, { radius: 4, shadow: false }),
        box(-90, -6, 118, 180, 12, 140, WALNUT, { radius: 6, shadow: false }),
        face('front', -90, 6, 258, art),
      ];
    },
  },

  'hardback library book with lilac spine tag': {
    tags: {
      is: 'a teal cloth hardback library book standing upright, spine to the viewer, gilt bands and a dark title plate on the spine, and (tagged) a lilac coordinate label with a short printed code',
      setting: ['library shelf', 'library desk', 'book shelved by meaning'],
      material: 'teal cloth cover, paper pages, lilac paper label',
      parts: ['teal cover', 'page block', 'gilt bands', 'title plate', 'lilac spine tag with three code marks'],
      not: ['notebook', 'ledger', 'binder', 'tablet', 'magazine', 'box', 'barcode sticker', 'price tag'],
    },
    size: [90, 200],
    states: ['plain', 'tagged'],
    draw: ({ state, focal }) => {
      const spine = [
        el('rect', { x: 0, y: 8, width: 16, height: 2.5, fill: T['paper-lit'] }),
        el('rect', { x: 0, y: 13, width: 16, height: 1.6, fill: T['paper-lit'] }),
        el('rect', { x: 2.5, y: 22, width: 11, height: 16, rx: 1, fill: T['teal-dark'] }),
        el('rect', { x: 0, y: 132, width: 16, height: 2.2, fill: T['paper-lit'] }),
      ];
      if (state === 'tagged') {
        spine.push(el('rect', { x: 0, y: 77, width: 16, height: 25, rx: 1, fill: focal ? T.orange : T['lilac-lit'] }));
        for (const [x, h] of [[3.2, 11], [7, 7], [10.8, 11]]) spine.push(el('rect', { x, y: 82, width: 2, height: h, rx: 0.5, fill: T['ink-lit'] }));
      }
      return [
        shadow(0, 6, 34, 14),
        box(-8, -30, 0, 16, 60, 140, TONES.teal, { radius: 3 }),
        face('front', -8, 30, 140, spine),
      ];
    },
  },
};
