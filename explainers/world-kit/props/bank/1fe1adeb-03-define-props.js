// Frame 3's own drawings (EX3-114): an upright smartphone on a desk stand, a small lidded storage crate
// with a document poking out of its slot, and a tall server rack. Each is drawn about its own base
// center (like the bank's assets) so it can join the bank once the picture check names it.

import { T, el, shadow, TONES, box, face, top, mark, accent } from '../../props/kit.js';

const rect = (x, y, w, h, fill, sw = 3, rx = 4) => el('rect', { x, y, width: w, height: h, rx, fill, stroke: T.ink, 'stroke-width': sw });

// ── The smartphone ────────────────────────────────────────────────────────────────────────
// A thin dark slab standing upright on a flat paper stand; its front face is a lit screen with an app:
// a header bar, a picture tile and two text lines, plus a speaker slot and a home bar.
function phoneParts() {
  const W = 84;
  const H = 176;
  const Z = 8;
  return [
    shadow(0, 14, 96, 34),
    box(-46, -30, 0, 92, 60, Z, TONES.paper),
    box(-W / 2, -9, Z, W, 18, H, TONES.ink),
    face('front', -W / 2, 9, Z + H, [
      rect(6, 10, W - 12, H - 20, T['paper-lit'], 2.5, 8),
      el('rect', { x: 12, y: 18, width: W - 24, height: 12, rx: 3, fill: T['paper-dark'] }),
      rect(12, 38, W - 24, 52, T['paper-shade'], 2.5, 4),
      mark('M 16 82 L 32 62 L 44 74 L 52 66 L 68 82', 2.5, 0.8),
      el('circle', { cx: 60, cy: 52, r: 5, fill: 'none', stroke: T.ink, 'stroke-width': 2.2 }),
      mark('M 12 106 L 72 106 M 12 120 L 60 120 M 12 134 L 66 134', 4, 0.5),
      mark('M 28 168 L 56 168', 3, 0.7),
      mark('M 34 5 L 50 5', 3, 0.9),
    ]),
  ];
}

// ── The lidded storage crate ──────────────────────────────────────────────────────────────
// A boxy crate with a lid, a blank tag and corner straps on its front, and a narrow slot cut in the lid.
// 'filled': a sheet of paper (a saved document) stands in the slot, poking out of the top.
function crateParts({ state = 'empty', focal = false }) {
  const parts = [
    shadow(0, 12, 150, 52),
    box(-55, -40, 0, 110, 80, 70, accent(focal)),
    face('front', -55, 40, 70, [
      rect(30, 14, 50, 30, T['paper-lit'], 2.8, 3),
      mark('M 38 24 L 72 24 M 38 34 L 62 34', 2.5, 0.55),
      mark('M 6 0 L 6 70 M 104 0 L 104 70', 3, 0.5),
    ]),
    face('side', 55, 40, 70, [mark('M 12 12 L 68 12 M 12 24 L 68 24 M 12 36 L 68 36', 2.5, 0.4)]),
    box(-59, -44, 70, 118, 88, 12, accent(focal)),
    top(-30, -6, 82, [el('rect', { x: 0, y: 0, width: 60, height: 12, rx: 3, fill: T.ink })]),
  ];
  if (state === 'filled') {
    parts.push(
      box(-26, -4, 82, 52, 5, 44, TONES.paper, { sw: 3 }),
      face('front', -26, 1, 126, [mark('M 8 12 L 44 12 M 8 22 L 44 22 M 8 32 L 34 32', 3, 0.6)]),
    );
  }
  return parts;
}

// ── The server rack ───────────────────────────────────────────────────────────────────────
// A tall cabinet on a dark plinth: three stacked drive units, each with slots and a light, vent
// slits down its side.
function serverParts() {
  const H = 200;
  const Z = 10;
  const bays = [0, 1, 2].map((k) => {
    const y = 14 + k * 60;
    return [
      rect(8, y, 84, 46, T['paper-shade'], 2.8, 4),
      mark(`M 18 ${y + 14} L 56 ${y + 14} M 18 ${y + 24} L 56 ${y + 24} M 18 ${y + 34} L 56 ${y + 34}`, 3, 0.6),
      el('circle', { cx: 76, cy: y + 14, r: 5.5, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 2.4 }),
      el('circle', { cx: 76, cy: y + 33, r: 3.2, fill: T.ink }),
    ];
  });
  const vents = [];
  for (let i = 0; i < 9; i++) vents.push(mark(`M 14 ${20 + i * 20} L 66 ${20 + i * 20}`, 2.6, 0.35));
  return [
    shadow(0, 12, 120, 42),
    box(-54, -44, 0, 108, 88, Z, TONES.ink),
    box(-50, -40, Z, 100, 80, H, TONES.paper),
    face('front', -50, 40, Z + H, bays.flat()),
    face('side', 50, 40, Z + H, vents),
  ];
}

export const NEW_PROPS = {
  'upright smartphone on a small desk stand showing an app screen': {
    tags: {
      is: 'a modern smartphone standing upright on a small flat stand, its lit screen showing an app with a picture tile and text lines',
      setting: ['desk', 'tech explainer', 'software scene'],
      material: 'dark glass-and-metal slab, riso-grained paper tones',
      parts: ['thin dark slab body', 'lit screen', 'header bar', 'picture tile', 'text lines', 'home bar', 'flat stand'],
      not: ['tablet', 'laptop', 'remote control', 'calculator', 'walkie-talkie', 'book'],
    },
    size: [226, 290],
    states: ['default'],
    draw: () => phoneParts(),
  },
  'small lidded storage crate with a document poking out of its lid slot': {
    tags: {
      is: 'a small boxy storage crate with a lid, a blank tag and corner straps on its front, and a slot in the lid where a saved sheet of paper stands up',
      setting: ['office', 'desk', 'storage', 'software scene'],
      material: 'painted wood or board, riso-grained paper tones',
      parts: ['lid', 'lid slot', 'blank front tag', 'corner straps', 'document sheet poking out when filled'],
      not: ['suitcase', 'shoe box', 'treasure chest', 'mailbox', 'toolbox', 'cardboard shipping box'],
    },
    size: [250, 290],
    states: ['empty', 'filled'],
    draw: ({ state, focal }) => crateParts({ state, focal }),
  },
  'tall server rack with three drive units and status lights': {
    tags: {
      is: 'a tall server cabinet on a dark plinth with three stacked drive units, each with slots and a light, and vent slits down its side',
      setting: ['data center', 'server room', 'tech explainer', 'software scene'],
      material: 'painted metal cabinet, riso-grained paper tones',
      parts: ['dark plinth', 'three drive units', 'slot lines', 'status lights', 'side vent slits'],
      not: ['refrigerator', 'wardrobe', 'vending machine', 'safe', 'locker', 'filing cabinet'],
    },
    size: [284, 310],
    states: ['default'],
    draw: () => serverParts(),
  },
};
