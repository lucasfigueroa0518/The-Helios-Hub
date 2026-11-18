// The kitchen's own drawings (EX3-114): the household fridge, the gable-top milk carton, the kitchen
// worktop counter, the doorway with its "store 20 min" sign, and the coffee mug the cook holds.
// Each is drawn about its own base center like the bank's assets, in the soft isometric style, with
// full tags, so each can join the bank. (The perspective drawings in world.js rebuild the same
// objects from lens solids: a perspective drawing never uses these.)
// Scale: the kit's px per cm next to a critter is about 1.97, so a 180 cm fridge is about 355 px.

import { el, T, shadow, TONES, box, face, top, cyl, mark, accent, accentFill, P0 } from '../../props/kit.js';
import { handwrite } from '../../draw.js';
import { mixHex } from '../../core.js';

const STEEL = T['paper-dark'];
const SOUR = mixHex(T['text-tertiary'], T.green, 0.28);

export const NEW_PROPS = {
  'household fridge with freezer door and door shelf': {
    tags: {
      is: 'a tall white household fridge: a freezer door above a fridge door, a chrome handle on each, and (open) a plastic milk shelf in the inside of the fridge door',
      setting: ['home kitchen', 'apartment kitchen', 'grocery storage'],
      material: 'white enamel steel, chrome handles, clear plastic shelf',
      parts: ['tall white body', 'freezer door on top', 'fridge door below', 'chrome handle on each door', 'door shelf with a front lip', 'interior light'],
      not: ['wine cooler', 'vending machine', 'locker', 'safe', 'oven', 'washing machine', 'cabinet', 'server rack'],
    },
    size: [480, 500],
    states: ['closed', 'open'],
    // Origin: base center. The body stands x -69..69, y -69..69, z 0..355 (70 x 70 x 180 cm).
    draw: ({ state, focal }) => {
      const parts = [shadow(0, 26, 170, 62), box(-69, -69, 0, 138, 138, 355, TONES.paper)];
      if (state === 'closed') {
        parts.push(face('front', -69, 69, 355, [
          mark('M 5 4 L 133 4 L 133 134 L 5 134 Z', 2.4, 0.8),
          mark('M 5 144 L 133 144 L 133 346 L 5 346 Z', 2.4, 0.8),
          mark('M 4 139 L 134 139', 3, 1),
        ]));
        parts.push(box(-60, 69, 225, 6, 10, 80, accent(focal, STEEL), { gloss: true }));
        parts.push(box(-60, 69, 120, 6, 10, 84, accent(focal, STEEL), { gloss: true }));
        return parts;
      }
      // open: the freezer door stays shut, the fridge door stands out to the room on its left hinge
      parts.push(face('front', -69, 69, 355, [mark('M 5 4 L 133 4 L 133 134 L 5 134 Z', 2.4, 0.8), mark('M 4 139 L 134 139', 3, 1)]));
      parts.push(box(-60, 69, 225, 6, 10, 80, accent(focal, STEEL), { gloss: true }));
      parts.push(face('front', -69, 69, 215, [
        el('rect', { x: 6, y: 3, width: 126, height: 200, rx: 4, fill: T['paper-shade'] }),
        el('rect', { x: 6, y: 3, width: 126, height: 200, rx: 4, fill: T['yellow-lit'], opacity: 0.3 }),
        el('rect', { x: 10, y: 66, width: 118, height: 4, fill: T['paper-lit'] }),
        el('rect', { x: 10, y: 120, width: 118, height: 4, fill: T['paper-lit'] }),
        el('rect', { x: 14, y: 168, width: 110, height: 28, rx: 5, fill: T['paper-lit'] }),
      ]));
      parts.push(box(-69, 70, 8, 8, 138, 200, TONES.paper));
      parts.push(box(-61, 90, 100, 20, 100, 3, TONES.paper));
      parts.push(box(-43, 90, 100, 2, 100, 15, TONES.paper, { gloss: true }));
      parts.push(box(-77, 150, 100, 6, 10, 84, accent(focal, STEEL), { gloss: true }));
      return parts;
    },
  },

  'one-litre gable-top milk carton': {
    tags: {
      is: 'a one-litre gable-top milk carton: a white square-sided box with a blue band, a sloped two-panel roof with a flat fin on top, and a printed use-by date on its side',
      setting: ['home kitchen', 'grocery shelf', 'fridge', 'coffee break'],
      material: 'waxed paperboard, printed ink',
      parts: ['square white body', 'blue band around the middle', 'slanted gable roof', 'flat sealed fin on top', 'MILK word on the front', 'use-by date on the side'],
      not: ['juice box', 'cereal box', 'shoe box', 'tissue box', 'plastic milk jug', 'gift box', 'house'],
    },
    size: [60, 100],
    states: ['fresh', 'sour'],
    // Origin: base center. 7 x 7 x 20 cm, drawn at the kit's px per cm: 14 x 14 x 39 px.
    draw: ({ state, focal }) => {
      const sour = state === 'sour';
      const band = sour ? SOUR : TONES.blue;
      const p = (x, y, z) => P0(x, y, z).map((v) => v.toFixed(1)).join(',');
      const roofFront = `${p(-7, 7, 29)} ${p(7, 7, 29)} ${p(7, 0, 39)} ${p(-7, 0, 39)}`;
      const gable = `${p(7, -7, 29)} ${p(7, 7, 29)} ${p(7, 0, 39)}`;
      return [
        shadow(0, 8, 24, 10),
        box(-7, -7, 0, 14, 14, 29, TONES.paper),
        box(-7.4, -7.4, 9, 14.8, 14.8, 9, band),
        face('front', -7, 7.4, 29, [handwrite('MILK', 7, 8, 5, 1, { align: 'center', color: T.ink, weight: 0.8 })]),
        face('side', 7.4, 7, 29, [
          handwrite('USE BY', 7, 7, 3.2, 1, { align: 'center', color: T.ink, weight: 0.7 }),
          handwrite('12 NOV', 7, 12.5, 3.2, 1, { align: 'center', color: sour ? T.ink : T['text-secondary'], weight: 0.7 }),
        ]),
        el('polygon', { points: gable, fill: T['paper-shade'] }),
        el('polygon', { points: roofFront, fill: T['paper-lit'] }),
        box(-7, -1, 39, 14, 2, 4, accent(focal, TONES.paper)),
      ];
    },
  },

  'kitchen worktop counter with cupboard doors': {
    tags: {
      is: 'a kitchen worktop counter: a white cupboard base with three doors and small knobs under a thick dark worktop, standing against a wall',
      setting: ['home kitchen', 'apartment kitchen'],
      material: 'painted board cupboards, dark laminate worktop',
      parts: ['dark worktop slab', 'three cupboard doors', 'round door knobs', 'recessed kick strip'],
      not: ['reception desk', 'shop counter', 'bar', 'dining table', 'bookshelf', 'sideboard with drawers', 'lab bench'],
    },
    size: [542, 340],
    states: ['default'],
    // Origin: base center. 150 x 58 x 90 cm: x -148..148, y -57..57, z 0..178.
    draw: ({ focal }) => [
      shadow(0, 30, 230, 56),
      box(-148, -57, 0, 296, 114, 170, TONES.paper),
      face('front', -148, 57, 160, [
        ...[0, 1, 2].flatMap((i) => [
          mark(`M ${8 + i * 97} 6 L ${97 + i * 97} 6 L ${97 + i * 97} 148 L ${8 + i * 97} 148 Z`, 2.4, 0.8),
          el('circle', { cx: 18 + i * 97 + (i === 1 ? 70 : 0), cy: 24, r: 4, fill: accentFill(focal && i === 1, STEEL) }),
        ]),
        mark('M 0 160 L 296 160', 3, 0.8),
      ]),
      box(-153, -62, 170, 306, 124, 9, TONES.ink),
    ],
  },

  'kitchen doorway with "store 20 min" sign': {
    tags: {
      is: 'a plain interior doorway without a door leaf, a pale daylight opening framed by white trim, with a yellow board above it reading "store 20 min"',
      setting: ['home kitchen', 'apartment hallway', 'walk to the store'],
      material: 'white painted wooden trim, painted board sign, ink print',
      parts: ['white door frame with two posts and a head', 'bright daylight opening', 'low threshold strip', 'yellow sign board with the words store 20 min'],
      not: ['window', 'garage door', 'archway', 'elevator', 'emergency exit sign', 'road sign', 'picture frame'],
    },
    size: [260, 520],
    states: ['default'],
    // Origin: base center on the floor. Opening 80 x 205 cm: x -79..79, z 0..404.
    draw: () => [
      shadow(0, 8, 130, 22),
      face('front', -71, 0, 396, [el('rect', { x: 0, y: 0, width: 142, height: 396, fill: T['yellow-lit'], opacity: 0.55 })]),
      box(-79, -6, 0, 8, 12, 404, TONES.paper),
      box(71, -6, 0, 8, 12, 404, TONES.paper),
      box(-79, -6, 396, 158, 12, 12, TONES.paper),
      box(-79, -10, 0, 158, 20, 3, TONES.paper),
      box(-104, -4, 426, 208, 7, 60, TONES.yellow),
      face('front', -104, 3, 486, [handwrite('store 20 min', 104, 38, 22, 1, { align: 'center', color: T.ink })]),
    ],
  },

  'ceramic coffee mug': {
    tags: {
      is: 'a white ceramic coffee mug: a short upright cup with a C-shaped handle on one side, dark coffee showing at the rim',
      setting: ['home kitchen', 'breakfast', 'office desk'],
      material: 'glazed ceramic, hot coffee',
      parts: ['short straight-sided cup', 'C-shaped handle', 'dark coffee surface', 'rim'],
      not: ['drinking glass', 'teapot', 'vase', 'paper cup', 'jar', 'bucket', 'pen holder'],
    },
    size: [60, 60],
    states: ['default'],
    // Origin: base center. 8 cm across, 9.5 cm tall: radius 8, height 19 px.
    draw: ({ focal }) => [
      shadow(2, 4, 20, 8),
      cyl(0, 0, 0, 8, 19, accent(focal, TONES.paper), { gloss: true }),
      top(0, 0, 19, [el('circle', { cx: 0, cy: 0, r: 6.4, fill: T['shadow-warm'] })]),
      box(7, -2, 13, 7, 4, 3, TONES.paper),
      box(7, -2, 4, 7, 4, 3, TONES.paper),
      box(11, -2, 4, 3, 4, 12, TONES.paper),
    ],
  },
};
