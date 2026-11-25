// The cache reel's own drawings (EX3-114): every object this world draws new, as a bank asset for the
// isometric camera and flat frames (frame 7's small open fridge beside the phone, any flat frame that
// needs the carton, the mug or the coffee maker). Through the camera, world.js draws the same things
// from lens solids in the same colours, so each one keeps one look in both worlds (minimum 6).
// Each is drawn about its base centre like the bank's assets, with full tags.

import { el, T, TONES, shadow, box, cyl, face, top, accent, accentFill, P0 } from '../../props/kit.js';
import { mixHex } from '../../core.js';

/** The fridge's cream body and its warm lit inside. */
const CREAM = mixHex(T['paper-lit'], T['yellow-lit'], 0.3);
const WARM_IN = mixHex(T['yellow-lit'], T['paper-lit'], 0.45);
const poly = (pts) => pts.map((q) => P0(...q)).map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');

/** A milk carton (iso units, ~40 wide, 96 tall) at base centre (x, y, z): white, blue band, gable top, a printed date block. */
function carton(x, y, z, { focal = false, s = 1 } = {}) {
  const w = 40 * s;
  const h = 70 * s;
  const g0 = z + h;
  const gh = 24 * s;
  const x0 = x - w / 2;
  const y0 = y - w / 2;
  return [
    box(x0, y0, z, w, w, h, TONES.paper, { radius: 3 }),
    box(x0 - 1, y0 - 1, z + h * 0.38, w + 2, w + 2, h * 0.2, accent(focal, TONES.blue), { radius: 2, shadow: false }),
    // the gable: its two slopes and the ridge fin
    el('polygon', { points: poly([[x0, y0 + w, g0], [x0 + w, y0 + w, g0], [x0 + w, y, g0 + gh], [x0, y, g0 + gh]]), fill: T['paper-lit'] }),
    el('polygon', { points: poly([[x0 + w, y0, g0], [x0 + w, y0 + w, g0], [x0 + w, y, g0 + gh]]), fill: T['paper-shade'] }),
    box(x0, y - 2 * s, g0 + gh, w, 4 * s, 6 * s, TONES.paper, { radius: 1, shadow: false }),
    // the printed date block above the band
    face('front', x0 + 8 * s, y0 + w, z + h * 0.86, [el('rect', { x: 0, y: 0, width: 24 * s, height: 7 * s, rx: 2, fill: T['ink-lit'], opacity: 0.6 })]),
  ];
}

export const NEW_PROPS = {
  'cream retro kitchen fridge': {
    tags: {
      is: 'a tall single-door home kitchen fridge with rounded corners in cream, a vertical blue handle, shown closed or open with its warm lit inside, three bare shelves and a crisper drawer (a milk carton on the middle shelf in the carton state)',
      setting: ['home kitchen', 'apartment kitchen', 'a cache drawn as a fridge beside a phone'],
      material: 'enamelled metal, plastic liner, glass shelves',
      parts: ['rounded cream body', 'vertical blue handle', 'door swung open on its left hinge', 'warm lit inside', 'three glass shelves', 'crisper drawer', 'plinth'],
      not: ['freezer chest', 'vending machine', 'wardrobe', 'oven', 'dishwasher', 'safe', 'server rack', 'shop drinks cooler with glass door', 'mini bar'],
    },
    size: [358, 330],
    states: ['closed', 'open', 'open-carton'],
    // Origin: base centre; the body stands x -60..60, y -45..45, z 0..200; the open door swings to y 135.
    draw: ({ state, focal }) => {
      const parts = [shadow(6, 30, 120, 50)];
      const body = { top: CREAM, left: mixHex(CREAM, T['paper-dark'], 0.45), right: mixHex(CREAM, T['paper-shade'], 0.2), lit: T['paper-lit'], base: CREAM, shade: mixHex(CREAM, T['paper-dark'], 0.5), dark: T['paper-dark'] };
      if (state === 'closed') {
        parts.push(box(-60, -45, 0, 120, 90, 200, body, { radius: 16, gloss: true }));
        parts.push(face('front', -60, 45, 200, [
          el('rect', { x: 6, y: 6, width: 108, height: 182, rx: 12, fill: 'none', stroke: mixHex(CREAM, T['paper-dark'], 0.6), 'stroke-width': 2.5 }),
          el('rect', { x: 92, y: 60, width: 9, height: 70, rx: 4.5, fill: accentFill(focal, T.blue) }),
        ]));
        return parts;
      }
      // open: the cabinet with its lit inside, then the door swung open toward the viewer on its left hinge
      parts.push(box(-60, -45, 0, 120, 90, 200, body, { radius: 16, gloss: true }));
      const inside = [el('rect', { x: 7, y: 8, width: 106, height: 176, rx: 8, fill: WARM_IN })];
      inside.push(el('rect', { x: 7, y: 8, width: 106, height: 30, rx: 8, fill: T.canvas, opacity: 0.45 }));
      for (const y of [58, 98, 138]) inside.push(el('rect', { x: 9, y, width: 102, height: 5, rx: 2, fill: mixHex(T['teal-lit'], T['paper-lit'], 0.7) }));
      inside.push(el('rect', { x: 14, y: 150, width: 92, height: 30, rx: 5, fill: mixHex(T['teal-lit'], T['paper-lit'], 0.75), opacity: 0.9 }));
      parts.push(face('front', -60, 45, 200, inside));
      if (state === 'open-carton') parts.push(...carton(-6, 30, 102, { focal, s: 0.6 }));
      parts.push(box(-66, 45, 4, 6, 90, 192, body, { radius: 6, shadow: false }));
      parts.push(face('side', -60, 52, 150, [el('rect', { x: 18, y: 0, width: 56, height: 14, rx: 4, fill: WARM_IN }), el('rect', { x: 18, y: 70, width: 56, height: 14, rx: 4, fill: WARM_IN })]));
      parts.push(box(-68, 133, 70, 8, 6, 70, accent(focal, TONES.blue), { radius: 2, shadow: false }));
      return parts;
    },
  },

  'drip coffee maker with glass carafe': {
    tags: {
      is: 'a small black drip coffee maker: a base plate, a back tower and an overhanging brew head, with a glass carafe of coffee on the plate (or a teal mug in the mug state)',
      setting: ['home kitchen counter', 'office kitchenette', 'breakfast'],
      material: 'black plastic, glass carafe',
      parts: ['base plate', 'back water tower', 'overhanging brew head', 'small power light', 'glass carafe with coffee', 'carafe handle'],
      not: ['espresso machine with portafilter', 'kettle', 'toaster', 'blender', 'microwave', 'printer', 'server'],
    },
    size: [188, 200],
    states: ['carafe', 'mug'],
    draw: ({ state, focal }) => {
      const parts = [shadow(4, 22, 76, 32), box(-35, -30, 0, 70, 60, 8, TONES.ink, { radius: 4 }), box(-35, -30, 8, 70, 22, 76, TONES.ink, { radius: 6 }), box(-35, -30, 72, 70, 62, 20, TONES.ink, { radius: 6 })];
      if (state === 'mug') {
        parts.push(cyl(0, 12, 8, 14, 26, accent(focal, TONES.teal)));
      } else {
        parts.push(cyl(0, 12, 8, 18, 24, TONES.ink));
        parts.push(cyl(0, 12, 32, 18, 16, { top: T['paper-lit'], left: mixHex(T['paper-shade'], T['blue-lit'], 0.2), right: T['paper-lit'], lit: T.canvas, base: T['paper-lit'], shade: T['paper-shade'], dark: T['paper-dark'] }));
        parts.push(box(18, 8, 16, 8, 6, 26, TONES.ink, { radius: 2, shadow: false }));
      }
      parts.push(face('front', -35, 32, 86, [el('circle', { cx: 58, cy: 8, r: 3.5, fill: T['teal-lit'] })]));
      return parts;
    },
  },

  'white milk carton with blue band': {
    tags: {
      is: 'a white gable-top milk carton with one blue band round its middle and a small printed date block above the band',
      setting: ['home kitchen', 'fridge shelf', 'grocery shelf', 'breakfast table', 'a saved copy drawn as milk'],
      material: 'waxed card',
      parts: ['white box body', 'blue band', 'gable top with ridge fin', 'printed date block'],
      not: ['juice box with straw', 'orange juice carton', 'paint can', 'shipping box', 'milk bottle', 'document', 'book'],
    },
    size: [90, 140],
    states: ['default'],
    draw: ({ focal }) => [shadow(2, 14, 34, 16), ...carton(0, 0, 0, { focal })],
  },

  'teal coffee mug': {
    tags: {
      is: 'a plain teal ceramic coffee mug with a loop handle, empty or filled with milky coffee',
      setting: ['home kitchen', 'breakfast table', 'office desk', 'coffee maker plate'],
      material: 'glazed ceramic',
      parts: ['round body', 'loop handle', 'milky coffee top when full'],
      not: ['teacup on a saucer', 'paper coffee cup', 'glass', 'jar', 'vase', 'pot', 'trophy'],
    },
    size: [90, 90],
    states: ['empty', 'full'],
    draw: ({ state, focal }) => {
      const parts = [shadow(2, 12, 34, 16), box(24, -4, 10, 10, 8, 26, accent(focal, TONES.teal), { radius: 4, shadow: false }), cyl(0, 0, 0, 22, 44, accent(focal, TONES.teal))];
      if (state === 'full') parts.push(top(-19, -19, 44, [el('circle', { cx: 19, cy: 19, r: 17, fill: mixHex(T['yellow-dark'], T['paper-shade'], 0.45) })]));
      return parts;
    },
  },

  'small yellow hatchback car': {
    tags: {
      is: 'a small rounded yellow hatchback car with dark windows, black wheels, white headlights and red tail lights',
      setting: ['country road', 'street', 'driveway', 'a trip to the shops'],
      material: 'glossy painted metal, glass, rubber',
      parts: ['rounded yellow body', 'cabin with dark windows', 'four black wheels', 'white headlights', 'red tail lights'],
      not: ['taxi', 'school bus', 'police car', 'race car', 'van', 'truck', 'toy car', 'self-driving robotaxi'],
    },
    size: [330, 230],
    states: ['default'],
    draw: ({ focal }) => {
      const glass = mixHex(T['ink-lit'], T['blue-lit'], 0.25);
      const body = accent(focal, TONES.yellow);
      return [
        shadow(6, 20, 170, 60),
        box(-60, -140, 16, 120, 280, 52, body, { radius: 16, gloss: true }),
        box(-52, -70, 68, 104, 140, 46, body, { radius: 18, gloss: true }),
        face('side', 52, -66, 110, [el('rect', { x: 8, y: 6, width: 56, height: 32, rx: 8, fill: glass }), el('rect', { x: 72, y: 6, width: 56, height: 32, rx: 8, fill: glass })]),
        face('front', -52, 70, 110, [el('rect', { x: 8, y: 6, width: 88, height: 32, rx: 8, fill: glass })]),
        face('side', 60, -140, 50, [el('circle', { cx: 56, cy: 30, r: 26, fill: T['ink-shade'] }), el('circle', { cx: 56, cy: 30, r: 11, fill: T['paper-dark'] }), el('circle', { cx: 224, cy: 30, r: 26, fill: T['ink-shade'] }), el('circle', { cx: 224, cy: 30, r: 11, fill: T['paper-dark'] })]),
        face('front', -60, 140, 56, [el('rect', { x: 10, y: 4, width: 22, height: 12, rx: 5, fill: T['paper-lit'] }), el('rect', { x: 88, y: 4, width: 22, height: 12, rx: 5, fill: T['paper-lit'] })]),
      ];
    },
  },
};
