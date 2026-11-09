// Frame 6's own drawings (EX3-114): the store's support-chat window, the request-router box and the
// small processor chip. Each is drawn about its base center like the bank's assets, with full tags.
// Text on them (the messages, the "easy" sign, the "small model" note) is textBox() in the frame.

import { el, T, shadow, TONES, box, face, top, accent, accentFill } from '../../props/kit.js';

export const NEW_PROPS = {
  'store support chat window': {
    tags: {
      is: 'an upright chat window for a shop: a striped shop awning across the top, an empty message area, and a message-entry bar with a send dot at the bottom',
      setting: ['online shop', 'customer support', 'phone or laptop screen', 'chat app'],
      material: 'flat paper, ink print',
      parts: ['striped scalloped awning header', 'tall message area', 'message entry bar', 'round send dot'],
      not: ['phone', 'laptop', 'speech bubble', 'email inbox', 'window of a house', 'shop front with door'],
    },
    size: [210, 350],
    states: ['default'],
    // Origin: bottom center of the window; it stands y -330..0, x -98..98.
    draw: ({ focal }) => {
      const stripes = [];
      for (let i = 0; i < 7; i++) {
        const x = -98 + i * 28;
        const fill = i % 2 ? T['paper-lit'] : accentFill(focal, T['paper-shade']);
        stripes.push(el('rect', { x, y: -330, width: 28, height: 32, fill, stroke: T.ink, 'stroke-width': 3 }));
        stripes.push(el('path', { d: `M ${x} -298 A 14 14 0 0 0 ${x + 28} -298 Z`, fill, stroke: T.ink, 'stroke-width': 3, 'stroke-linejoin': 'round' }));
      }
      return [
        shadow(6, 6, 118, 16),
        el('rect', { x: -88, y: -320, width: 196, height: 330, rx: 12, fill: T['paper-dark'] }),
        el('rect', { x: -98, y: -330, width: 196, height: 330, rx: 12, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 4 }),
        ...stripes,
        el('rect', { x: -80, y: -44, width: 130, height: 28, rx: 14, fill: T['paper-shade'], stroke: T.ink, 'stroke-width': 3 }),
        el('circle', { cx: 74, cy: -30, r: 14, fill: T['paper-shade'], stroke: T.ink, 'stroke-width': 3 }),
        el('path', { d: 'M 68 -30 L 80 -30 M 75 -35 L 80 -30 L 75 -25', fill: 'none', stroke: T.ink, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      ];
    },
  },

  'request router box': {
    tags: {
      is: 'a flat network-router box: a low slab with two upright antennas at the back, a row of three round lamps on top and three socket slots on its front face',
      setting: ['network', 'server room', 'AI system diagram', 'home internet'],
      material: 'flat paper slab, ink print',
      parts: ['low rectangular slab', 'two upright antennas', 'three round lamps', 'three socket slots'],
      not: ['wood router tool', 'game console', 'toaster', 'lunch box', 'radio'],
    },
    size: [170, 180],
    states: ['default'],
    draw: ({ focal }) => [
      shadow(0, 10, 112, 38),
      box(-45, -45, 0, 90, 90, 26, accent(focal, TONES.paper)),
      top(-45, -45, 26, [20, 45, 70].map((u) => el('circle', { cx: u, cy: 74, r: 6, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 2.5 }))),
      box(-36, -38, 26, 8, 8, 64, TONES.ink),
      box(24, -38, 26, 8, 8, 64, TONES.ink),
      face('front', -45, 45, 22, [10, 36, 62].map((u) => el('rect', { x: u, y: 2, width: 16, height: 11, rx: 2, fill: T.ink }))),
    ],
  },

  'small processor chip': {
    tags: {
      is: 'a small square computer chip: a flat black-edged body with a die square printed on top and short metal pins along its edges',
      setting: ['electronics', 'AI model diagram', 'circuit board'],
      material: 'flat paper slab, ink print',
      parts: ['square body', 'printed die square', 'notch dot', 'short pins on two sides'],
      not: ['cookie', 'sd card', 'microwave', 'big server', 'brain'],
    },
    size: [150, 80],
    states: ['default'],
    draw: ({ focal }) => {
      const pins = [];
      for (let i = 0; i < 4; i++) {
        pins.push(box(-30 + i * 20, 40, 2, 8, 12, 5, TONES.ink, { sw: 2 }));
        pins.push(box(40, -30 + i * 20, 2, 12, 8, 5, TONES.ink, { sw: 2 }));
      }
      return [
        shadow(0, 8, 92, 30),
        ...pins,
        box(-40, -40, 2, 80, 80, 14, accent(focal, TONES.paper)),
        top(-40, -40, 16, [
          el('rect', { x: 18, y: 18, width: 44, height: 44, rx: 4, fill: T['paper-shade'], stroke: T.ink, 'stroke-width': 2.5 }),
          el('circle', { cx: 10, cy: 70, r: 3.5, fill: T.ink }),
        ]),
      ];
    },
  },
};
