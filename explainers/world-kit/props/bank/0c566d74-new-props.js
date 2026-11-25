// The anchor scene's own drawings (EX3-114): the ER's triage desk, its two doors, the minor-care
// nurse's steel tweezers and the splinter. Each is drawn about its base center in soft 3D like the
// bank's assets, with full tags, so it can join the bank. The perspective room (world.js) builds the
// same objects again from lens solids at their real sizes; these are the isometric drawings.

import { el, T, shadow, TONES, box, face, top, shape, shade } from '../../props/kit.js';
import { handwrite, handwriteWidth } from '../../draw.js';

/** Sign text fitted to a plaque `w` px wide: cap height from the text's own width. */
const fit = (text, w, max = 30) => Math.min(max, (10 * (w - 16)) / handwriteWidth(text, 10));

/** A hospital door: a teal leaf with a push bar and kick plate, a lit yellow sign plaque above it. */
function door(label) {
  const W = 176;
  const H = 414;
  return [
    shadow(0, 6, 120, 26),
    box(-W / 2 - 8, -10, 0, W + 16, 14, H + 12, TONES.paper),
    box(-W / 2, -14, 0, W, 10, H, TONES.teal),
    box(-W / 2 + 14, -16, 18, W - 28, 4, 40, TONES.teal),
    box(W / 2 - 54, -18, 190, 36, 6, 8, TONES.paper),
    box(-W / 2 - 14, -14, H + 22, W + 28, 10, 54, TONES.yellow),
    face('front', -W / 2 - 14, -14, H + 76, [
      handwrite(label, (W + 28) / 2, 40, fit(label, W + 28, 24), 1, { color: T.ink, align: 'center', weight: 1.3 }),
    ]),
  ];
}

export const NEW_PROPS = {
  'curved triage reception desk': {
    tags: {
      is: 'an emergency-room triage desk: a low curved reception counter, white front panel bulging toward the entrance, a dark counter top, and a small yellow TRIAGE plate on its front',
      setting: ['hospital emergency room', 'clinic waiting area', 'triage'],
      material: 'painted white panel, dark laminate top, yellow plate',
      parts: ['curved front', 'dark overhanging counter top', 'yellow TRIAGE plate'],
      not: ['dining table', 'kitchen counter', 'bar', 'school desk', 'shop checkout', 'bookshelf'],
    },
    size: [472, 277],
    states: ['default'],
    // Origin: the middle of the desk's floor footprint; it is stepped in three blocks to read as a curve.
    draw: () => [
      shadow(0, 10, 200, 44),
      box(-176, -34, 0, 96, 60, 124, TONES.paper),
      box(-90, -50, 0, 180, 66, 124, TONES.paper),
      box(80, -34, 0, 96, 60, 124, TONES.paper),
      box(-184, -42, 124, 104, 74, 10, TONES.ink),
      box(-98, -58, 124, 196, 82, 10, TONES.ink),
      box(72, -42, 124, 112, 74, 10, TONES.ink),
      box(-56, -54, 36, 112, 4, 56, TONES.yellow),
      face('front', -56, -54, 92, [handwrite('TRIAGE', 56, 38, fit('TRIAGE', 112, 22), 1, { color: T.ink, align: 'center', weight: 1.3 })]),
    ],
  },

  'minor care ward door': {
    tags: {
      is: 'a hospital ward door, closed: a tall teal door leaf with a steel push bar and a kick plate, under a lit yellow sign reading MINOR CARE',
      setting: ['hospital emergency room', 'clinic', 'ward corridor'],
      material: 'painted teal door, steel push bar, yellow sign plate',
      parts: ['tall teal door leaf', 'steel push bar', 'kick plate', 'yellow MINOR CARE sign above'],
      not: ['front door of a house', 'wardrobe', 'fridge', 'garage door', 'cardiac door'],
    },
    size: [220, 500],
    states: ['default'],
    draw: () => door('MINOR CARE'),
  },

  'cardiac ward door': {
    tags: {
      is: 'a hospital ward door, closed: a tall teal door leaf with a steel push bar and a kick plate, under a lit yellow sign reading CARDIAC',
      setting: ['hospital emergency room', 'clinic', 'ward corridor'],
      material: 'painted teal door, steel push bar, yellow sign plate',
      parts: ['tall teal door leaf', 'steel push bar', 'kick plate', 'yellow CARDIAC sign above'],
      not: ['front door of a house', 'wardrobe', 'fridge', 'garage door', 'minor care door'],
    },
    size: [220, 500],
    states: ['default'],
    draw: () => door('CARDIAC'),
  },

  'steel splinter tweezers': {
    tags: {
      is: "a pair of steel splinter tweezers: two thin flat steel arms joined at the grip end and meeting in fine points at the tips, with small grip ridges near the joined end",
      setting: ['first aid', 'minor injury care', 'nurse hand'],
      material: 'polished steel',
      parts: ['two thin steel arms', 'joined grip end', 'fine meeting tips', 'grip ridges'],
      not: ['scissors', 'pliers', 'chopsticks', 'surgical forceps with rings', 'knife', 'pen'],
    },
    size: [26, 126],
    states: ['default'],
    // Origin: the joined grip end; the tips point straight up, 124 px away.
    draw: () => [
      shape('M -2 0 C -6 -40 -13 -80 -2 -124 L 0 -124 L 0 0 Z', T['paper-shade']),
      shape('M 2 0 C 6 -40 13 -80 2 -124 L 0 -124 L 0 0 Z', T['paper-lit']),
      el('path', { d: 'M -3 -6 L 3 -6 M -3.6 -14 L 3.6 -14 M -4.2 -22 L 4.2 -22', fill: 'none', stroke: T['paper-dark'], 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
      el('path', { d: 'M 6 -30 C 9 -60 8 -84 3 -112', fill: 'none', stroke: T.canvas, 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: 0.85 }),
      shade('M -10 0 L 10 0 L 6 -124 L -6 -124 Z', { color: T.ink, from: 0.0, to: 0.12 }),
    ],
  },

  'wood splinter': {
    tags: {
      is: 'a tiny wood splinter: a thin, sharp sliver of amber wood, thicker at one end and tapering to a point',
      setting: ['first aid', 'minor injury care', 'fingertip'],
      material: 'raw wood',
      parts: ['thin tapering sliver', 'pointed tip', 'rough splintered end'],
      not: ['needle', 'pin', 'toothpick', 'hair', 'thorn'],
    },
    size: [10, 28],
    states: ['default'],
    // Origin: the thick end; the point faces up.
    draw: () => [
      shape('M -2.4 0 L 1.8 -1 L 1 -12 L 0 -26 L -1 -12 Z', T['yellow-shade']),
      el('path', { d: 'M -0.2 -2 L 0.2 -22', fill: 'none', stroke: T['yellow-lit'], 'stroke-width': 0.9, 'stroke-linecap': 'round' }),
    ],
  },
};
