// Frame 2's own drawings (EX3-114): a smartphone lying flat on a table, and a server tower with a
// status screen. Each is drawn about its base center in the paper-and-ink style: three flat tones,
// ink outlines, riso grain, a contact shadow; detail is ink marks on the faces.

import { T, el, g, line, TONES, shadow, box, top, face } from '../../props/kit.js';

function phoneDraw() {
  const parts = [shadow(6, 10, 144, 64)];
  parts.push(box(-55, -100, 0, 110, 200, 14, TONES.paper, { sw: 3.5 }));
  parts.push(
    top(-55, -100, 14, [
      el('rect', { x: 8, y: 8, width: 94, height: 184, rx: 9, fill: T['ink-lit'], stroke: T.ink, 'stroke-width': 3 }),
      // the card's empty place on the home screen
      el('rect', { x: 18, y: 58, width: 74, height: 62, rx: 7, fill: 'none', stroke: T['paper-lit'], 'stroke-width': 2.5, 'stroke-dasharray': '9 7', opacity: 0.5 }),
      el('path', { d: 'M 22 24 L 58 24 M 22 36 L 44 36', fill: 'none', stroke: T['paper-lit'], 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.35 }),
      el('path', { d: 'M 40 178 L 70 178', fill: 'none', stroke: T['paper-lit'], 'stroke-width': 3.5, 'stroke-linecap': 'round', opacity: 0.55 }),
      el('circle', { cx: 55, cy: 17, r: 3, fill: T.ink }),
    ]),
  );
  return parts;
}

function towerDraw({ state }) {
  const W = 110;
  const D = 90;
  const H = 300;
  const lit = state !== 'idle';
  const parts = [shadow(0, 8, 118, 44)];
  parts.push(box(-55, -45, 0, W, D, H, TONES.paper, { sw: 3.5 }));
  const bays = [0, 1, 2].flatMap((i) => [
    el('rect', { x: 12, y: 96 + i * 50, width: 86, height: 36, rx: 5, fill: T['paper-shade'], stroke: T.ink, 'stroke-width': 2.5 }),
    el('path', { d: `M 20 ${114 + i * 50} L 62 ${114 + i * 50}`, fill: 'none', stroke: T.ink, 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.5 }),
    el('circle', { cx: 83, cy: 114 + i * 50, r: 5, fill: i === 0 && lit ? T['status-success'] : T['paper-dark'], stroke: T.ink, 'stroke-width': 2 }),
  ]);
  const screen = [
    el('rect', { x: 12, y: 16, width: 86, height: 60, rx: 6, fill: state === 'idle' ? T.ink : state === 'flash' ? T.canvas : T['paper-lit'], stroke: T.ink, 'stroke-width': 3 }),
  ];
  if (lit) {
    screen.push(
      el('path', { d: 'M 22 30 L 56 30', fill: 'none', stroke: T.ink, 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.4 }),
      el('rect', { x: 22, y: 42, width: 66, height: 20, rx: 5, fill: 'none', stroke: T.ink, 'stroke-width': 2.5 }),
      el('rect', { x: 25, y: 45, width: 60 * 0.85, height: 14, rx: 3, fill: T.ink }),
    );
  } else {
    screen.push(el('circle', { cx: 28, cy: 32, r: 4, fill: T['paper-lit'], opacity: 0.3 }));
  }
  parts.push(face('front', -55, 45, H, [...screen, ...bays, el('path', { d: 'M 18 266 L 92 266 M 18 278 L 92 278 M 18 290 L 92 290', fill: 'none', stroke: T.ink, 'stroke-width': 2.5, 'stroke-linecap': 'round', opacity: 0.4 })]));
  parts.push(face('side', 55, 45, H, [0, 1, 2, 3, 4, 5].map((i) => el('path', { d: `M 16 ${40 + i * 14} L 74 ${40 + i * 14}`, fill: 'none', stroke: T.ink, 'stroke-width': 2.5, 'stroke-linecap': 'round', opacity: 0.35 }))));
  return [g({}, parts)];
}

export const NEW_PROPS = {
  'a smartphone lying flat on a table, screen up': {
    tags: {
      is: 'a modern smartphone lying flat and face up on a table, a thin slab with rounded dark screen, a camera dot, a home bar, and an empty dashed place where an app card sits',
      setting: ['table', 'desk', 'everyday phone use'],
      material: 'paper-flat body, dark glass screen',
      parts: ['thin rounded slab body', 'dark screen', 'dashed card slot', 'status lines', 'camera dot', 'home bar'],
      not: ['tablet', 'remote control', 'calculator', 'book', 'wallet', 'walkie-talkie'],
    },
    size: [290, 190],
    states: ['default'],
    draw: phoneDraw,
  },
  'a server tower with a status screen and three drive bays': {
    tags: {
      is: 'a tall upright server computer tower with a small status screen at the top showing a level bar, three drive bays with a status light, and vent slits on its side and base',
      setting: ['server room', 'data centre', 'backend of an app'],
      material: 'paper-flat metal case, small lit screen',
      parts: ['tall box case', 'status screen with a level bar', 'three drive bays', 'status light', 'front vents', 'side vents'],
      not: ['refrigerator', 'filing cabinet', 'locker', 'desktop pc', 'speaker', 'wardrobe'],
    },
    size: [190, 400],
    states: ['idle', 'flash', 'new'],
    draw: towerDraw,
  },
};
