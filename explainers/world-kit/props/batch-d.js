// Props batch D (hx-6 library tripling, 2026-11-16): kitchen, office and store things, picked by how
// often past scene builders had to draw them new. Drawn by hand with kit.js and shapes.js; tags in
// tags-more.js. Same conventions as batch-a: origin at the base center, world z up.

// eslint-disable-next-line no-unused-vars
import { T, el, g, line, TONES, P0, box, cbox, cyl, RX, top, face, shape, mark, shade, accent, accentFill, shadow, isoDisc } from './kit.js';
import { f, K, tone, disc, revolve, ink, rounded, lens, rr, rect, circ, rod, sp, frontArc, fitAll, GLASS } from './shapes.js';

const SLATE = tone('slate');
const WOOD = tone('wood');
const KRAFT = tone('mustard');

export const BATCH_D = {
  plate: {
    states: ['empty', 'full'],
    size: [210, 130],
    draw: ({ state, focal }) => {
      const parts = [shadow(0, 2, 96, 34)];
      parts.push(...rounded(revolve([[0, 46], [6, 62], [12, 74]]), TONES.paper));
      parts.push(disc(0, -12, RX(74), focal ? T['orange-lit'] : T['paper-lit']));
      parts.push(g({ 'data-hard': 1 }, el('ellipse', { cx: 0, cy: -10, rx: f(RX(52)), ry: f(RX(52) * K), fill: 'none', stroke: T.ink, 'stroke-width': 2, opacity: 0.25 })));
      if (state === 'full') {
        parts.push(shape('M -52 -6 Q -46 -40 -10 -40 Q 26 -42 34 -14 Q 0 6 -52 -6 Z', T['wood-lit']));
        parts.push(shape('M 14 -16 Q 22 -44 50 -36 Q 66 -24 56 -6 Q 34 2 14 -16 Z', T['green-lit']));
        parts.push(circ(-20, -26, 9, T['red-lit']), circ(0, -30, 8, T['red-lit']));
      }
      return parts;
    },
  },

  bowl: {
    states: ['empty', 'full'],
    size: [190, 150],
    draw: ({ state, focal }) => {
      const t = accent(focal, TONES.teal);
      const rim = RX(68);
      const parts = [shadow(0, 2, 70, 24)];
      parts.push(...rounded(revolve([[0, 30], [4, 36], [24, 56], [50, 68]]), t));
      parts.push(disc(0, -50, rim, t[0]));
      parts.push(el('path', { d: lens(-50, rim - 8, 22), fill: state === 'full' ? T['mustard-lit'] : T['paper-shade'] }));
      if (state === 'full') for (const [x, y] of [[-30, -48], [-6, -54], [20, -46], [6, -40], [-18, -40]]) parts.push(circ(x, y, 7, T.mustard));
      return parts;
    },
  },

  toaster: {
    states: ['empty', 'toast'],
    size: [220, 230],
    draw: ({ state, focal }) => {
      const t = accent(focal, TONES.paper);
      const parts = [shadow(0, 14, 110, 40), cbox(0, 0, 0, 130, 80, 96, t, { radius: 18 })];
      parts.push(top(-65, -40, 96, [rect(20, 20, 90, 11, T.ink, 5, { opacity: 0.8 }), rect(20, 48, 90, 11, T.ink, 5, { opacity: 0.8 })]));
      parts.push(face('side', 65, 40, 96, [rect(46, 22, 22, 9, T.ink, 4), rect(48, 70, 16, 4, T['ink-lit'], 2)]));
      parts.push(face('front', -65, 40, 96, [circ(104, 30, 9, T['ink-lit']), ink('M 104 30 L 108 24', 2.5, 0.8)]));
      if (state === 'toast') {
        parts.push(cbox(0, -14.5, 96, 80, 6, 34, tone('wood')));
        parts.push(cbox(0, 13.5, 96, 80, 6, 34, tone('wood')));
      }
      return parts;
    },
  },

  'cutting board': {
    states: ['empty', 'chopped'],
    size: [290, 180],
    draw: ({ state, focal }) => {
      const parts = [shadow(0, 8, 140, 50), cbox(0, 0, 0, 190, 120, 12, focal ? TONES.orange : WOOD, { radius: 12 })];
      parts.push(top(-95, -60, 12, [circ(172, 60, 9, T['wood-dark']), ...[30, 52, 74].map((v) => ink(`M 14 ${v} Q 80 ${v - 6} 150 ${v}`, 2, 0.15))]));
      if (state === 'chopped') {
        parts.push(top(-95, -60, 12, [[40, 40], [64, 34], [52, 62], [84, 50], [76, 76]].map(([u, v]) => circ(u, v, 11, T.orange, { stroke: T['orange-dark'], 'stroke-width': 2 }))));
      }
      return parts;
    },
  },

  'cooking pot': {
    states: ['lid', 'steaming'],
    size: [230, 230],
    draw: ({ state, focal }) => {
      const t = accent(focal, SLATE);
      const rx = RX(62);
      const parts = [shadow(0, 4, 90, 32)];
      parts.push(rect(-rx - 26, -84, 34, 13, T['slate-dark'], 6), rect(rx - 8, -84, 34, 13, T['slate-dark'], 6));
      parts.push(...rounded(revolve([[0, 58], [4, 62], [84, 62]]), t));
      parts.push(mark(frontArc(70, rx), 3, 0.6));
      if (state === 'lid') {
        parts.push(disc(0, -84, RX(64), t[0]));
        parts.push(shape(`M ${f(-RX(50))} -88 Q 0 -128 ${f(RX(50))} -88 Q 0 -70 ${f(-RX(50))} -88 Z`, t[0]));
        parts.push(rect(-14, -124, 28, 12, T.ink, 6));
      } else {
        parts.push(disc(0, -84, rx, t[0]));
        parts.push(el('path', { d: lens(-84, rx - 7, 18), fill: T['orange-lit'] }));
        parts.push(mark('M -30 -110 c -10 -14 10 -22 0 -38 M 0 -114 c -10 -14 10 -22 0 -44 M 30 -110 c -10 -14 10 -22 0 -34', 4, 0.6));
      }
      return parts;
    },
  },

  microwave: {
    states: ['off', 'on'],
    size: [260, 240],
    draw: ({ state, focal }) => {
      const parts = [shadow(0, 30, 130, 44), cbox(0, 0, 0, 170, 100, 100, accent(focal, TONES.paper), { radius: 10 })];
      const win = state === 'on' ? T['yellow-lit'] : T.ink;
      parts.push(face('front', -85, 50, 100, [
        rect(12, 14, 112, 70, win, 6, { opacity: state === 'on' ? 1 : 0.85 }),
        ...(state === 'on' ? [el('ellipse', { cx: 68, cy: 70, rx: 34, ry: 7, fill: T['paper-shade'] })] : []),
        rect(134, 14, 26, 70, T['paper-shade'], 4),
        rect(138, 20, 18, 10, T.ink, 2),
        ...[42, 56, 70].map((y) => circ(147, y, 4, T['ink-lit'])),
      ]));
      return parts;
    },
  },

  stove: {
    states: ['off', 'on'],
    size: [280, 330],
    draw: ({ state, focal }) => {
      const parts = [shadow(0, 34, 130, 46), cbox(0, 0, 0, 150, 130, 150, TONES.paper, { radius: 8 })];
      const burn = state === 'on' ? T.orange : T['ink-lit'];
      parts.push(top(-75, -65, 150, [[40, 34], [110, 34], [40, 96], [110, 96]].flatMap(([u, v]) => [circ(u, v, 22, T.ink, { opacity: 0.85 }), circ(u, v, 13, 'none', { stroke: burn, 'stroke-width': 4 })])));
      parts.push(face('front', -75, 65, 150, [
        ...[22, 50, 78, 106, 130].map((u) => circ(u, 14, 6, T['ink-lit'])),
        rect(14, 32, 122, 8, accentFill(focal, T['ink-lit']), 4),
        rect(18, 50, 114, 84, T.ink, 8, { opacity: 0.82 }),
        rect(30, 60, 90, 20, T['paper-lit'], 4, { opacity: 0.12 }),
      ]));
      return parts;
    },
  },

  apple: {
    states: ['default'],
    size: [170, 160],
    draw: ({ focal }) => [
      shadow(0, 0, 64, 18),
      shape('M 0 -96 C 30 -118 74 -96 70 -56 C 66 -16 34 0 0 -8 C -34 0 -66 -16 -70 -56 C -74 -96 -30 -118 0 -96 Z', focal ? T.orange : T.red),
      el('path', { d: 'M -40 -86 Q -48 -70 -46 -56', fill: 'none', stroke: T.canvas, 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0.55 }),
      rod('M 0 -96 Q 2 -112 10 -124', T['wood-dark'], 6),
      shape('M 8 -112 Q 30 -136 52 -122 Q 30 -102 8 -112 Z', T.leaf),
    ],
  },

  'loaf of bread': {
    states: ['default'],
    size: [230, 130],
    draw: ({ focal }) => [
      shadow(0, 0, 104, 20),
      shape('M -100 -8 L -98 -58 C -92 -96 -40 -106 0 -100 C 50 -106 96 -94 100 -58 L 100 -8 Q 0 6 -100 -8 Z', focal ? T['orange-lit'] : T.mustard),
      el('path', { d: 'M -96 -40 Q 0 -30 96 -40 L 98 -10 Q 0 4 -98 -10 Z', fill: T['mustard-shade'], opacity: 0.45 }),
      ...['M -64 -78 Q -54 -96 -38 -94', 'M -16 -84 Q -6 -102 10 -100', 'M 32 -82 Q 42 -98 58 -94'].map((d) => rod(d, T['mustard-lit'], 7)),
    ],
  },

  egg: {
    states: ['default'],
    size: [110, 120],
    draw: ({ focal }) => [
      shadow(0, 0, 42, 12),
      shape('M 0 -100 C 34 -100 46 -52 46 -32 C 46 -6 24 4 0 4 C -24 4 -46 -6 -46 -32 C -46 -52 -34 -100 0 -100 Z', focal ? T['orange-lit'] : T['paper-lit']),
      el('path', { d: 'M -22 -70 Q -28 -56 -26 -44', fill: 'none', stroke: T.canvas, 'stroke-width': 6, 'stroke-linecap': 'round', opacity: 0.7 }),
    ],
  },

  'drinking glass': {
    states: ['empty', 'full'],
    size: [120, 170],
    draw: ({ state, focal }) => {
      const body = revolve([[0, 32], [120, 40]]);
      const parts = [shadow(0, 2, 44, 16)];
      if (state === 'full') {
        parts.push(el('path', { d: revolve([[3, 31], [82, 37]]), fill: focal ? T['orange-lit'] : T['blue-lit'], opacity: 0.75 }));
        parts.push(disc(0, -82, RX(37), focal ? T.orange : T.blue, 2));
      }
      parts.push(el('path', { d: body, fill: GLASS, opacity: 0.3 }), ink(body, 3, 0.55));
      parts.push(ink(`M ${f(-RX(40))} -120 A ${f(RX(40))} ${f(RX(40) * K)} 0 1 0 ${f(RX(40))} -120 A ${f(RX(40))} ${f(RX(40) * K)} 0 1 0 ${f(-RX(40))} -120`, 3, 0.55));
      parts.push(el('path', { d: 'M -32 -100 L -30 -24', stroke: T.canvas, 'stroke-width': 6, 'stroke-linecap': 'round', opacity: 0.8 }));
      return parts;
    },
  },

  'recipe card': {
    states: ['default'],
    size: [260, 150],
    draw: ({ focal }) => [
      shadow(0, 6, 120, 40),
      cbox(0, 0, 0, 160, 110, 3, TONES.paper, { radius: 4 }),
      top(-80, -55, 3, [
        rect(0, 0, 160, 110, T['paper-lit'], 4),
        rect(14, 12, 70, 12, accentFill(focal, T['red-lit']), 3),
        ...[38, 52, 66].map((v) => ink(`M 16 ${v} L 22 ${v} M 30 ${v} L ${v === 52 ? 110 : 130} ${v}`, 3, 0.45)),
        ...[84, 96].map((v) => ink(`M 16 ${v} L 140 ${v}`, 2, 0.3)),
        ink('M 6 0 L 6 110', 1.5, 0.15),
      ]),
    ],
  },

  'filing cabinet': {
    states: ['closed', 'open'],
    size: [240, 400],
    draw: ({ state, focal }) => {
      const parts = [shadow(0, 40, 100, 40), cbox(0, 0, 0, 110, 110, 260, SLATE, { radius: 8 })];
      parts.push(face('front', -55, 55, 260, [0, 1, 2].flatMap((i) => [
        rect(8, 10 + i * 82, 94, 74, T['slate-lit'], 6),
        rect(37, 32 + i * 82, 36, 8, T.ink, 4),
        rect(42, 16 + i * 82, 26, 10, T['paper-lit'], 2),
      ])));
      if (state === 'open') {
        parts.push(cbox(0, 95, 186, 100, 80, 66, accent(focal, SLATE), { radius: 4 }));
        parts.push(top(-50, 55, 252, [rect(4, 4, 92, 72, T['slate-dark'], 3), ...[14, 30, 46, 62].map((v) => rect(8, v, 84, 6, T['mustard-lit'], 2))]));
        parts.push(face('front', -50, 135, 252, [rect(32, 24, 36, 8, T.ink, 4)]));
      }
      return parts;
    },
  },

  stapler: {
    states: ['default'],
    size: [200, 150],
    draw: ({ focal }) => [
      shadow(0, 6, 96, 30),
      cbox(0, 0, 0, 170, 44, 12, TONES.ink, { radius: 6 }),
      cbox(-74, 0, 12, 22, 34, 12, TONES.ink, { radius: 4 }),
      cbox(4, 0, 22, 162, 38, 22, accent(focal, TONES.red), { radius: 10 }),
      face('side', 85, 19, 44, [rect(8, 6, 22, 6, T.ink, 3, { opacity: 0.6 })]),
    ],
  },

  scissors: {
    states: ['default'],
    size: [230, 150],
    draw: ({ focal }) => {
      const handle = accentFill(focal, T.red);
      return [
        shadow(0, 4, 100, 30),
        top(0, 0, 2, [
          el('path', { d: 'M -6 -12 Q 60 -13 138 0 L 0 4 Z', fill: T['slate-lit'], stroke: T['slate-dark'], 'stroke-width': 2.5 }),
          el('path', { d: 'M -6 12 Q 60 13 138 0 L 0 -4 Z', fill: T['slate'], stroke: T['slate-dark'], 'stroke-width': 2.5 }),
          circ(0, 0, 5, T.ink),
          el('ellipse', { cx: -44, cy: -24, rx: 26, ry: 18, fill: 'none', stroke: handle, 'stroke-width': 12 }),
          el('ellipse', { cx: -44, cy: 26, rx: 26, ry: 18, fill: 'none', stroke: handle, 'stroke-width': 12 }),
          rod('M -18 -14 L 0 -4 M -18 16 L 0 6', handle, 10),
        ]),
      ];
    },
  },

  clipboard: {
    states: ['blank', 'checked'],
    size: [170, 250],
    draw: ({ state, focal }) => {
      const parts = [shadow(0, 0, 70, 14)];
      parts.push(shape(rr(-70, -220, 140, 216, 12), T['wood-lit']));
      parts.push(rect(-58, -196, 116, 176, T['paper-lit'], 3));
      parts.push(shape(rr(-30, -234, 60, 28, 7), T['slate-lit']), rect(-14, -228, 28, 8, T.ink, 4, { opacity: 0.5 }));
      for (let i = 0; i < 5; i++) {
        const y = -170 + i * 30;
        parts.push(ink(rr(-46, y - 9, 16, 16, 3), 2.5, 0.55));
        parts.push(ink(`M -20 ${y} L ${i % 2 ? 30 : 44} ${y}`, 3, 0.4));
        if (state === 'checked' && i < 3) parts.push(ink(`M -44 ${y} L -38 ${y + 5} L -28 ${y - 8}`, 3.5, 1), ...(focal ? [ink(`M -44 ${y} L -38 ${y + 5} L -28 ${y - 8}`, 3.5)] : []));
      }
      if (focal) parts.push(rod('M -20 -110 L 44 -110', T.orange, 5));
      return parts;
    },
  },

  calculator: {
    states: ['default'],
    size: [200, 160],
    draw: ({ focal }) => [
      shadow(0, 8, 94, 34),
      cbox(0, 0, 0, 100, 140, 14, SLATE, { radius: 10 }),
      top(-50, -70, 14, [
        rect(10, 10, 80, 30, T['green-lit'], 4),
        ink('M 50 25 L 80 25', 4, 0.5),
        ...[0, 1, 2, 3].flatMap((i) => [0, 1, 2, 3].map((j) => rect(10 + i * 21, 50 + j * 21, 17, 17, i === 3 && j === 3 ? accentFill(focal, T.orange) : T['paper-lit'], 4))),
      ]),
    ],
  },

  ruler: {
    states: ['default'],
    size: [280, 170],
    draw: ({ focal }) => [
      shadow(0, 6, 130, 40),
      cbox(0, 0, 0, 260, 36, 6, accent(focal, TONES.yellow), { radius: 4 }),
      top(-130, -18, 6, Array.from({ length: 25 }, (_, i) => ink(`M ${10 + i * 10} 0 L ${10 + i * 10} ${i % 5 === 0 ? 14 : 7}`, 2, 0.6))),
    ],
  },

  'manila folder': {
    states: ['closed', 'papers'],
    size: [290, 200],
    draw: ({ state, focal }) => {
      const back = focal ? T['orange-lit'] : T['mustard-lit'];
      const front = focal ? T.orange : T.mustard;
      return [
        shadow(0, 6, 134, 44),
        cbox(0, 0, 0, 180, 130, 3, focal ? TONES.orange : KRAFT, { radius: 3 }),
        top(-90, -65, 3, [
          el('path', { d: 'M 0 0 L 110 0 L 118 -16 L 166 -16 L 174 0 L 180 0 L 180 130 L 0 130 Z', fill: back }),
          ...(state === 'papers' ? [rect(10, 6, 160, 116, T['paper-lit'], 2), ...[24, 36, 48].map((v) => ink(`M 24 ${v} L 150 ${v}`, 2, 0.3))] : []),
          el('path', { d: 'M 0 30 L 180 30 L 180 130 L 0 130 Z', fill: front }),
          ink('M 0 30 L 180 30', 2, 0.25),
        ]),
      ];
    },
  },

  'trash can': {
    states: ['empty', 'full'],
    size: [150, 220],
    draw: ({ state, focal }) => {
      const t = accent(focal, SLATE);
      const rim = RX(54);
      const parts = [shadow(0, 2, 60, 20)];
      parts.push(...rounded(revolve([[0, 40], [120, 52], [126, 54]]), t));
      parts.push(mark(frontArc(40, RX(44)), 3, 0.5), mark(frontArc(80, RX(48)), 3, 0.5));
      parts.push(disc(0, -126, rim, t[0]));
      parts.push(el('path', { d: lens(-126, rim - 6, 20), fill: T['slate-dark'] }));
      if (state === 'full') for (const [x, y, r] of [[-20, -138, 18], [12, -144, 20], [-2, -158, 16], [30, -134, 14]]) parts.push(shape(`M ${x - r} ${y} Q ${x - r} ${y - r} ${x} ${y - r} Q ${x + r} ${y - r + 4} ${x + r} ${y} Q ${x + r - 4} ${y + r} ${x} ${y + r} Q ${x - r + 2} ${y + r - 2} ${x - r} ${y} Z`, T['paper-lit']));
      return parts;
    },
  },

  whiteboard: {
    states: ['blank', 'written'],
    size: [280, 310],
    draw: ({ state, focal }) => {
      const parts = [shadow(0, 0, 120, 16)];
      parts.push(rod('M -100 -120 L -112 0 M 100 -120 L 112 0', T['slate-shade'], 8));
      parts.push(rod('M -126 0 L -98 0 M 98 0 L 126 0', T['slate-shade'], 8));
      parts.push(shape(rr(-124, -290, 248, 160, 8), T['slate-lit']), rect(-114, -280, 228, 140, T.white ?? T['paper-lit'], 4));
      parts.push(rect(-90, -134, 180, 10, T['slate-shade'], 3));
      if (state === 'written') {
        parts.push(ink('M -94 -250 L -10 -250 M -94 -226 L 30 -226 M -94 -202 L -30 -202', 4, 0.6));
        parts.push(rect(20, -262, 76, 56, 'none', 6, { stroke: accentFill(focal, T.blue), 'stroke-width': 4 }));
        parts.push(rod('M -94 -172 L 60 -172', accentFill(focal, T.blue), 4));
      }
      parts.push(rect(30, -142, 30, 6, T.red, 3));
      return parts;
    },
  },

  printer: {
    states: ['idle', 'printing'],
    size: [270, 260],
    draw: ({ state, focal }) => {
      const parts = [shadow(0, 26, 130, 44)];
      parts.push(cbox(0, -44, 70, 110, 10, 64, TONES.paper, { radius: 2 }));
      parts.push(cbox(0, 0, 0, 170, 120, 72, accent(focal, TONES.paper), { radius: 12 }));
      parts.push(top(-85, -60, 72, [rect(110, 14, 46, 22, T.ink, 4, { opacity: 0.85 }), circ(146, 50, 5, T.green)]));
      parts.push(face('front', -85, 60, 72, [rect(30, 24, 110, 10, T.ink, 4, { opacity: 0.8 })]));
      if (state === 'printing') {
        parts.push(top(-50, 60, 40, [rect(0, 0, 100, 52, T['paper-lit'], 2), ...[14, 26, 38].map((v) => ink(`M 12 ${v} L 86 ${v}`, 2, 0.35))]));
      }
      return parts;
    },
  },

  globe: {
    states: ['default'],
    size: [200, 260],
    draw: ({ focal }) => [
      shadow(0, 0, 54, 18),
      isoDisc(0, -10, RX(42), 10, SLATE, { rings: 0 }),
      rect(-5, -48, 10, 40, T['slate-shade'], 3),
      circ(0, -136, 74, focal ? T.orange : T.blue),
      el('circle', { cx: 0, cy: -136, r: 74, fill: 'none', stroke: T['blue-dark'], 'stroke-width': 3, opacity: 0.3 }),
      shape('M -46 -178 Q -20 -196 -2 -176 Q 8 -156 -14 -146 Q -26 -132 -44 -146 Q -60 -160 -46 -178 Z', T.green),
      shape('M 14 -128 Q 40 -140 50 -116 Q 46 -90 26 -84 Q 8 -96 14 -128 Z', T.green),
      shape('M 24 -196 Q 44 -200 52 -184 Q 40 -172 24 -180 Z', T.green),
      el('path', { d: 'M -40 -170 Q -50 -150 -48 -132', fill: 'none', stroke: T.canvas, 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0.45 }),
      rod('M 0 -48 A 92 92 0 0 0 0 -228', T['slate-shade'], 7),
    ],
  },

  'shopping cart': {
    states: ['empty', 'full'],
    size: [270, 230],
    draw: ({ state, focal }) => {
      const wire = T['slate-shade'];
      const parts = [shadow(0, 0, 110, 14)];
      if (state === 'full') {
        parts.push(shape(rr(-70, -206, 50, 40, 6), T.orange), shape(rr(-20, -214, 44, 50, 6), T['paper-lit']), circ(48, -186, 22, T.red));
      }
      parts.push(el('path', { d: 'M -96 -174 L 90 -174 L 70 -86 L -76 -86 Z', fill: T['paper-lit'], opacity: 0.25 }));
      const mesh = [];
      for (let k = 1; k < 8; k++) {
        const x = -96 + (186 / 8) * k;
        mesh.push(`M ${f(x)} -174 L ${f(-76 + (146 / 8) * k)} -86`);
      }
      for (const y of [-152, -130, -108]) {
        const k = (y + 174) / 88;
        mesh.push(`M ${f(-96 + 20 * k)} ${y} L ${f(90 - 20 * k)} ${y}`);
      }
      parts.push(rod(mesh.join(' '), wire, 2.5));
      parts.push(rod('M -96 -174 L 90 -174 L 70 -86 L -76 -86 Z', wire, 5));
      parts.push(rod('M -76 -86 L -84 -30 L 76 -30 L 70 -86', wire, 6));
      parts.push(rod('M 90 -174 L 118 -200', wire, 6), rod('M 112 -206 L 128 -192', accentFill(focal, T.red), 12));
      parts.push(circ(-70, -16, 13, T.ink), circ(60, -16, 13, T.ink), circ(-70, -16, 5, T['slate-lit']), circ(60, -16, 5, T['slate-lit']));
      return parts;
    },
  },

  'shopping bag': {
    states: ['empty', 'full'],
    size: [210, 270],
    draw: ({ state, focal }) => {
      const t = focal ? TONES.orange : KRAFT;
      const parts = [shadow(0, 14, 90, 30)];
      parts.push(rod(`M ${sp(-30, -30, 140)} Q ${sp(0, -30, 200)} ${sp(30, -30, 140)}`, T['wood-dark'], 5));
      parts.push(cbox(0, 0, 0, 110, 60, 140, t, { radius: 4 }));
      // the open mouth: the bag is open at the top, its inside in shadow
      parts.push(top(-55, -30, 140, [rect(4, 4, 102, 52, T['wood-dark'], 2, { opacity: 0.85 })]));
      if (state === 'full') {
        parts.push(shape(`M ${sp(-24, 0, 140)} L ${sp(-38, -10, 226)} L ${sp(-18, -10, 228)} L ${sp(0, 0, 140)} Z`, T.mustard));
        parts.push(shape(`M ${sp(14, 4, 140)} Q ${sp(14, 4, 200)} ${sp(32, 4, 200)} Q ${sp(48, 4, 178)} ${sp(38, 4, 140)} Z`, T.leaf));
      }
      parts.push(rod(`M ${sp(-30, 30, 140)} Q ${sp(0, 30, 200)} ${sp(30, 30, 140)}`, T['wood-dark'], 5));
      parts.push(face('front', -55, 30, 140, [ink('M 0 12 L 110 12', 2, 0.2)]));
      return parts;
    },
  },

  'cash register': {
    states: ['closed', 'open'],
    size: [270, 300],
    draw: ({ state, focal }) => {
      const parts = [shadow(0, 30, 130, 44)];
      parts.push(rect(-8, -196, 16, 60, T['slate-shade'], 3));
      parts.push(shape(rr(-50, -236, 100, 50, 8), T.ink), rect(-40, -226, 80, 28, T['green-lit'], 4), ink('M -10 -212 L 30 -212', 4, 0.6));
      parts.push(cbox(0, 0, 0, 170, 120, 50, SLATE, { radius: 6 }));
      parts.push(cbox(0, -10, 50, 160, 96, 34, accent(focal, TONES.paper), { radius: 8 }));
      parts.push(top(-80, -58, 84, [0, 1, 2, 3, 4].flatMap((i) => [0, 1, 2, 3].map((j) => rect(66 + i * 16, 16 + j * 18, 12, 13, i === 4 && j === 3 ? T.orange : T['ink-lit'], 3)))));
      if (state === 'open') {
        parts.push(cbox(0, 86, 8, 150, 52, 30, TONES.paper, { radius: 3 }));
        parts.push(top(-75, 60, 38, [0, 1, 2, 3].map((i) => rect(6 + i * 36, 6, 30, 40, T['slate-lit'], 3)).concat([circ(24, 26, 8, T.mustard), circ(60, 30, 8, T.mustard), circ(98, 24, 8, T['green-lit'])])));
      } else {
        parts.push(face('front', -85, 60, 50, [rect(60, 20, 50, 7, T.ink, 3, { opacity: 0.6 })]));
      }
      return parts;
    },
  },

  'price tag': {
    states: ['default'],
    size: [180, 160],
    draw: ({ focal }) => [
      // lying flat on a counter, its string curling off the hole
      shadow(0, 4, 84, 30),
      top(-64, -32, 1, [
        el('path', { d: 'M 0 0 L 92 0 L 124 32 L 92 64 L 0 64 Z', fill: focal ? T['orange-lit'] : T['paper-lit'] }),
        circ(100, 32, 7, T['paper-shade']),
        ink('M 14 22 L 70 22', 8, 0.7),
        ink('M 14 44 L 50 44', 5, 0.4),
        rod('M 104 30 Q 150 10 140 -20 Q 132 -40 156 -50', T['ink-lit'], 3),
      ]),
    ],
  },

  receipt: {
    states: ['default'],
    size: [130, 240],
    draw: ({ focal }) => {
      let d = 'M -44 -210 L 44 -210 L 44 -18';
      for (let i = 1; i <= 8; i++) d += ` L ${44 - i * 11} ${i % 2 ? -8 : -18}`;
      return [
        shadow(0, -6, 52, 12),
        shape(`${d} Z`, T['paper-lit']),
        ink('M -28 -190 L 28 -190', 4, 0.55),
        ...[-166, -150, -134, -118, -102].map((y, i) => ink(`M -30 ${y} L ${i % 2 ? 0 : 10} ${y} M 18 ${y} L 30 ${y}`, 2.5, 0.4)),
        ink('M -30 -82 L 30 -82', 2, 0.3),
        rod('M -30 -64 L -4 -64 M 14 -64 L 30 -64', accentFill(focal, T.ink), 5),
      ];
    },
  },

  'credit card': {
    states: ['default'],
    size: [250, 150],
    draw: ({ focal }) => [
      shadow(0, 4, 116, 40),
      cbox(0, 0, 0, 160, 100, 3, focal ? TONES.orange : TONES.blue, { radius: 8 }),
      top(-80, -50, 3, [
        rect(0, 0, 160, 100, focal ? T.orange : T.blue, 9),
        rect(18, 26, 28, 22, T['mustard-lit'], 4),
        ink('M 18 37 L 46 37 M 32 26 L 32 48', 1.5, 0.35),
        ...[0, 1, 2, 3].map((i) => rod(`M ${18 + i * 34} 70 L ${42 + i * 34} 70`, T['paper-lit'], 5)),
        circ(126, 24, 10, T['red-lit'], { opacity: 0.9 }),
        circ(140, 24, 10, T['yellow-lit'], { opacity: 0.85 }),
      ]),
    ],
  },

  wallet: {
    states: ['default'],
    size: [240, 170],
    draw: ({ focal }) => {
      const leather = focal ? TONES.orange : tone('wood');
      return [
        shadow(0, 6, 110, 40),
        cbox(0, 0, 0, 150, 110, 9, leather, { radius: 10 }),
        cbox(38, 0, 9, 130, 84, 4, TONES.blue, { radius: 6 }),
        cbox(0, 0, 13, 150, 110, 9, leather, { radius: 10 }),
        top(-75, -55, 22, [el('rect', { x: 8, y: 8, width: 134, height: 94, rx: 8, fill: 'none', stroke: T['wood-lit'], 'stroke-width': 2, 'stroke-dasharray': '6 5', opacity: 0.8 })]),
      ];
    },
  },
};

// Measured bounds (design/tools, 2026-11-16): [width, height, back].
fitAll(BATCH_D, {
  "plate": [226, 94, 16],
  "bowl": [166, 128, 0],
  "toaster": [286, 189, 49],
  "cutting board": [330, 119, 51],
  "cooking pot": [212, 188, 15],
  "microwave": [344, 197, 65],
  "stove": [362, 250, 70],
  "apple": [152, 160, 0],
  "loaf of bread": [246, 135, 0],
  "egg": [100, 133, 0],
  "drinking glass": [104, 178, 0],
  "recipe card": [284, 100, 39],
  "filing cabinet": [320, 345, 61],
  "stapler": [226, 122, 27],
  "scissors": [302, 88, 56],
  "clipboard": [166, 267, 0],
  "calculator": [224, 104, 34],
  "ruler": [306, 110, 46],
  "manila folder": [316, 118, 49],
  "trash can": [142, 207, 0],
  "whiteboard": [284, 323, 0],
  "printer": [330, 216, 62],
  "globe": [148, 258, 0],
  "shopping cart": [260, 247, 0],
  "shopping bag": [266, 275, 43],
  "cash register": [324, 269, 57],
  "price tag": [302, 135, 31],
  "receipt": [122, 243, 0],
  "credit card": [274, 98, 36],
  "wallet": [260, 117, 38],
});
