// Props batch E (hx-6 library tripling, 2026-11-16): tools, measures, street things and everyday
// objects that analogies keep reaching for. Drawn by hand with kit.js and shapes.js; tags in
// tags-more.js. Same conventions as batch-a: origin at the base center, world z up.

// eslint-disable-next-line no-unused-vars
import { T, el, g, line, TONES, P0, box, cbox, cyl, RX, top, face, shape, mark, shade, accent, accentFill, shadow, isoDisc } from './kit.js';
import { f, K, tone, disc, revolve, ink, rounded, lens, rr, rect, circ, rod, sp, frontArc, fitAll, GLASS } from './shapes.js';

const SLATE = tone('slate');
const WOOD = tone('wood');
const BRASS = tone('mustard');

/** A clock-like dial: ticks round a face of radius r at (cx, cy). */
const ticks = (cx, cy, r, n = 12, len = 7) =>
  ink(Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return `M ${f(cx + Math.sin(a) * r)} ${f(cy - Math.cos(a) * r)} L ${f(cx + Math.sin(a) * (r - len))} ${f(cy - Math.cos(a) * (r - len))}`;
  }).join(' '), 3, 0.6);

/** A pip (a die's dot) on a face plane. */
const pip = (u, v, fill = T.ink) => circ(u, v, 7, fill);

export const BATCH_E = {
  hammer: {
    states: ['default'],
    size: [240, 150],
    draw: ({ focal }) => [
      shadow(0, 6, 110, 34),
      cbox(-14, 0, 0, 160, 16, 12, WOOD, { radius: 6 }),
      cbox(-64, 0, 0, 60, 19, 14, TONES.red, { radius: 7 }),
      cbox(76, 0, 0, 28, 76, 30, accent(focal, SLATE), { radius: 5 }),
    ],
  },

  wrench: {
    states: ['default'],
    size: [240, 140],
    draw: ({ focal }) => {
      const steel = focal ? T.orange : T['slate-lit'];
      const body = [
        el('path', { d: 'M -86 -10 L 58 -9 L 58 9 L -86 10 Z', fill: steel }),
        el('path', { d: 'M 52 -12 C 60 -32 98 -36 110 -18 L 90 -8 L 90 8 L 110 18 C 98 36 60 32 52 12 Z', fill: steel }),
        circ(-96, 0, 24, steel),
        circ(-96, 0, 11, T['slate-dark']),
        ink('M -60 0 L 30 0', 3, 0.25),
      ];
      return [shadow(0, 6, 110, 30), top(0, 0, 3, body.map((p) => p.replace('<path', '<path stroke="' + T['slate-shade'] + '" stroke-width="2.5"')))];
    },
  },

  screwdriver: {
    states: ['default'],
    size: [230, 140],
    draw: ({ focal }) => [
      shadow(0, 6, 100, 28),
      top(0, 0, 4, [
        rect(-10, -5, 92, 10, T['slate-lit'], 3, { stroke: T['slate-shade'], 'stroke-width': 2 }),
        el('path', { d: 'M 82 -5 L 100 -2 L 100 2 L 82 5 Z', fill: T.slate }),
        rect(-90, -16, 82, 32, accentFill(focal, T.red), 14),
        ...[-70, -54, -38].map((u) => ink(`M ${u} -12 L ${u} 12`, 3, 0.25)),
      ]),
    ],
  },

  toolbox: {
    states: ['default'],
    size: [240, 230],
    draw: ({ focal }) => {
      const t = accent(focal, TONES.red);
      return [
        shadow(0, 14, 110, 36),
        cbox(0, 0, 0, 170, 80, 80, t, { radius: 8 }),
        cbox(0, 0, 80, 176, 86, 14, t, { radius: 6 }),
        rod(`M ${sp(-44, 0, 94)} L ${sp(-44, 0, 128)} L ${sp(44, 0, 128)} L ${sp(44, 0, 94)}`, T['slate-shade'], 10),
        face('front', -85, 40, 80, [rect(70, 4, 30, 16, T['slate-lit'], 3), rect(80, 10, 10, 6, T.ink, 2)]),
      ];
    },
  },

  'balance scale': {
    states: ['level', 'tipped'],
    size: [280, 300],
    draw: ({ state, focal }) => {
      const a = state === 'tipped' ? (14 * Math.PI) / 180 : 0;
      const [cx, cy, L] = [0, -230, 104];
      const lx = cx - L * Math.cos(a);
      const ly = cy + L * Math.sin(a);
      const rx = cx + L * Math.cos(a);
      const ry = cy - L * Math.sin(a);
      const brass = focal ? T.orange : T.mustard;
      const pan = (x, y) => [rod(`M ${f(x)} ${f(y)} L ${f(x - 36)} ${f(y + 70)} M ${f(x)} ${f(y)} L ${f(x + 36)} ${f(y + 70)}`, T['ink-lit'], 2.5), shape(`M ${f(x - 50)} ${f(y + 70)} Q ${f(x)} ${f(y + 104)} ${f(x + 50)} ${f(y + 70)} Z`, brass)];
      const parts = [shadow(0, 0, 70, 16), shape(rr(-64, -22, 128, 22, 8), T['mustard-shade']), rect(-7, -230, 14, 210, T['mustard-shade'], 4)];
      parts.push(...pan(lx, ly), ...pan(rx, ry));
      if (state === 'tipped') parts.push(shape(rr(lx - 20, ly + 44, 40, 30, 4), T.ink));
      else parts.push(shape(rr(lx - 16, ly + 50, 32, 24, 4), T.ink), shape(rr(rx - 16, ry + 50, 32, 24, 4), T.ink));
      parts.push(rod(`M ${f(lx)} ${f(ly)} L ${f(rx)} ${f(ry)}`, T['mustard-shade'], 10), circ(cx, cy, 11, brass), ink(`M 0 ${cy - 10} L 0 ${cy - 34}`, 5, 0.7));
      return parts;
    },
  },

  hourglass: {
    states: ['full', 'running', 'done'],
    size: [140, 230],
    draw: ({ state, focal }) => {
      const sand = focal ? T.orange : T.mustard;
      const glass = 'M -40 -186 C -40 -130 -6 -116 -6 -100 C -6 -84 -40 -70 -40 -14 L 40 -14 C 40 -70 6 -84 6 -100 C 6 -116 40 -130 40 -186 Z';
      const parts = [shadow(0, 0, 60, 12)];
      parts.push(el('path', { d: glass, fill: GLASS, opacity: 0.4 }));
      if (state === 'full') parts.push(el('path', { d: 'M -38 -168 L 38 -168 C 36 -128 8 -118 0 -104 C -8 -118 -36 -128 -38 -168 Z', fill: sand }));
      if (state === 'running') {
        parts.push(el('path', { d: 'M -30 -140 L 30 -140 C 24 -122 6 -114 0 -104 C -6 -114 -24 -122 -30 -140 Z', fill: sand }));
        parts.push(rod('M 0 -104 L 0 -40', sand, 3), el('path', { d: 'M -36 -16 Q 0 -60 36 -16 Z', fill: sand }));
      }
      if (state === 'done') parts.push(el('path', { d: 'M -39 -16 C -38 -50 -22 -64 0 -72 C 22 -64 38 -50 39 -16 Z', fill: sand }));
      parts.push(ink(glass, 3, 0.55));
      parts.push(el('path', { d: 'M -28 -176 Q -30 -150 -20 -132', fill: 'none', stroke: T.canvas, 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0.8 }));
      parts.push(rod('M -46 -190 L -46 -12 M 46 -190 L 46 -12', T['wood-shade'], 7));
      parts.push(shape(rr(-56, -204, 112, 16, 6), T.wood), shape(rr(-56, -16, 112, 16, 6), T.wood));
      return parts;
    },
  },

  stopwatch: {
    states: ['default'],
    size: [170, 200],
    draw: ({ focal }) => [
      shadow(0, 0, 54, 12),
      shape(rr(-12, -182, 24, 22, 4), T['slate-shade']),
      shape(rr(-20, -194, 40, 14, 6), T.slate),
      rod('M 44 -146 L 56 -158', T['slate-shade'], 10),
      circ(0, -90, 72, T.slate),
      circ(0, -90, 60, T['paper-lit']),
      ticks(0, -90, 56, 12, 8),
      rod('M 0 -90 L 30 -126', accentFill(focal, T.red), 5),
      circ(0, -90, 6, T.ink),
    ],
  },

  battery: {
    states: ['full', 'low'],
    size: [120, 190],
    draw: ({ state, focal }) => {
      const t = accent(focal, TONES.ink);
      const parts = [shadow(0, 2, 44, 14)];
      parts.push(...rounded(revolve([[0, 32], [140, 32]]), t));
      parts.push(el('path', { d: revolve([[110, 32.4], [140, 32.4]]), fill: T['mustard'] }));
      parts.push(disc(0, -140, RX(32), T['mustard-lit']));
      parts.push(...rounded(revolve([[140, 12], [152, 12]]), SLATE), disc(0, -152, RX(12), T['slate-lit'], 2));
      const n = state === 'full' ? 4 : 1;
      const col = state === 'full' ? T['green-lit'] : T['red-lit'];
      for (let i = 0; i < 4; i++) parts.push(rect(-16, -36 - i * 18, 32, 13, i < n ? col : T['ink-lit'], 3, { opacity: i < n ? 1 : 0.5 }));
      return parts;
    },
  },

  'light bulb': {
    states: ['off', 'on'],
    size: [180, 240],
    draw: ({ state, focal }) => {
      const on = state === 'on';
      const parts = [shadow(0, 0, 40, 10)];
      if (on) {
        parts.push(circ(0, -140, 100, T['yellow-lit'], { opacity: 0.28 }));
        parts.push(rod('M -86 -210 L -72 -196 M 86 -210 L 72 -196 M 0 -232 L 0 -214 M -100 -140 L -80 -140 M 100 -140 L 80 -140', T.mustard, 5));
      }
      const glass = 'M 0 -206 C 46 -206 64 -172 60 -142 C 56 -114 30 -100 26 -72 L -26 -72 C -30 -100 -56 -114 -60 -142 C -64 -172 -46 -206 0 -206 Z';
      parts.push(shape(glass, on ? (focal ? T['orange-lit'] : T['yellow-lit']) : T['paper-lit']));
      parts.push(ink('M -14 -76 L -14 -118 L -6 -132 L 2 -118 L 10 -132 L 14 -118 L 14 -76', 2.5, on ? 0.8 : 0.45));
      parts.push(el('path', { d: 'M -36 -170 Q -44 -150 -40 -132', fill: 'none', stroke: T.canvas, 'stroke-width': 6, 'stroke-linecap': 'round', opacity: 0.7 }));
      parts.push(shape(rr(-28, -74, 56, 46, 6), T['slate-lit']));
      parts.push(ink('M -26 -62 L 26 -56 M -26 -48 L 26 -42', 3, 0.35));
      parts.push(shape(rr(-12, -30, 24, 14, 6), T.ink));
      return parts;
    },
  },

  suitcase: {
    states: ['default'],
    size: [220, 240],
    draw: ({ focal }) => [
      shadow(0, 10, 100, 30),
      cbox(0, 0, 0, 160, 56, 130, accent(focal, TONES.blue), { radius: 14 }),
      rod(`M ${sp(-26, 0, 130)} L ${sp(-26, 0, 152)} L ${sp(26, 0, 152)} L ${sp(26, 0, 130)}`, T['slate-shade'], 9),
      face('front', -80, 28, 130, [rect(34, 6, 10, 118, T['blue-shade'], 4, { opacity: 0.7 }), rect(116, 6, 10, 118, T['blue-shade'], 4, { opacity: 0.7 }), rect(70, 10, 20, 10, T['slate-lit'], 3)]),
    ],
  },

  'traffic light': {
    states: ['red', 'yellow', 'green'],
    size: [130, 360],
    draw: ({ state }) => {
      const lamps = [['red', -296], ['yellow', -236], ['green', -176]];
      const parts = [shadow(0, 0, 40, 10), rect(-7, -150, 14, 150, T['slate-shade'], 4), shape(rr(-24, -10, 48, 12, 5), T.slate)];
      parts.push(shape(rr(-38, -334, 76, 196, 16), T.ink));
      for (const [c, y] of lamps) {
        const lit = c === state;
        if (lit) parts.push(circ(0, y, 40, T[`${c}-lit`], { opacity: 0.3 }));
        parts.push(circ(0, y, 22, lit ? T[`${c}-lit`] : T['ink-lit'], { opacity: lit ? 1 : 0.6 }));
        parts.push(rod(`M -26 ${y - 14} Q 0 ${y - 34} 26 ${y - 14}`, T.ink, 6));
      }
      return parts;
    },
  },

  'park bench': {
    states: ['default'],
    size: [280, 230],
    draw: ({ focal }) => {
      const wood = accent(focal, WOOD);
      return [
        shadow(0, 10, 130, 40),
        cbox(-84, -27, 40, 10, 6, 70, TONES.ink, { radius: 3 }),
        cbox(84, -27, 40, 10, 6, 70, TONES.ink, { radius: 3 }),
        cbox(0, -24, 70, 210, 5, 14, wood, { radius: 3 }),
        cbox(0, -24, 92, 210, 5, 14, wood, { radius: 3 }),
        cbox(-84, 0, 0, 10, 50, 40, TONES.ink, { radius: 3 }),
        cbox(84, 0, 0, 10, 50, 40, TONES.ink, { radius: 3 }),
        cbox(0, -16, 40, 210, 14, 6, wood, { radius: 3 }),
        cbox(0, 0, 40, 210, 14, 6, wood, { radius: 3 }),
        cbox(0, 16, 40, 210, 14, 6, wood, { radius: 3 }),
      ];
    },
  },

  'street lamp': {
    states: ['off', 'on'],
    size: [200, 380],
    draw: ({ state, focal }) => {
      const on = state === 'on';
      const parts = [shadow(0, 0, 40, 10)];
      if (on) parts.push(el('path', { d: 'M 46 -318 L 6 -10 L 110 -10 L 74 -318 Z', fill: T['yellow-lit'], opacity: 0.25 }));
      parts.push(shape(rr(-20, -24, 40, 24, 6), T['slate-shade']), rect(-6, -340, 12, 320, T['slate-shade'], 4));
      parts.push(rod('M 0 -330 Q 0 -356 30 -356 L 60 -356', T['slate-shade'], 10));
      parts.push(shape('M 36 -360 L 84 -360 L 96 -330 L 24 -330 Z', T['slate-shade']));
      parts.push(shape(rr(32, -332, 56, 14, 6), on ? (focal ? T['orange-lit'] : T['yellow-lit']) : T['paper-shade']));
      return parts;
    },
  },

  umbrella: {
    states: ['default'],
    size: [250, 290],
    draw: ({ focal }) => {
      const c = focal ? T.orange : T.red;
      let edge = '';
      for (let i = 0; i < 6; i++) edge += ` Q ${f(110 - i * 36.7 - 18)} -168 ${f(110 - (i + 1) * 36.7)} -150`;
      return [
        shadow(0, 0, 40, 10),
        rod('M 0 -250 L 0 -30 Q 0 -6 20 -6 Q 36 -6 36 -24', T['slate-shade'], 8),
        shape(`M -110 -150 Q -104 -254 0 -262 Q 104 -254 110 -150${edge} Z`, c),
        ...[-37, 0, 37].map((x) => mark(`M 0 -260 Q ${x * 0.6} -220 ${x} -152`, 3, 0.7)),
        rod('M 0 -262 L 0 -280', T['slate-shade'], 6),
      ];
    },
  },

  'traffic cone': {
    states: ['default'],
    size: [160, 200],
    draw: ({ focal }) => {
      const t = accent(focal, TONES.red);
      // A reflective band wrapping the cone's front: the area between its rims at z0 and z1.
      const band = (z) => {
        const [z0, z1] = [z - 7, z + 7];
        const r = (zz) => RX(34 - (zz - 8) * 0.221) - 1.2;
        const [r0, r1] = [r(z0), r(z1)];
        const d = `${frontArc(z1, r1)} L ${f(r0)} ${f(-z0)} A ${f(r0)} ${f(r0 * K)} 0 0 1 ${f(-r0)} ${f(-z0)} Z`;
        return g({ 'data-hard': 1 }, el('path', { d, fill: GLASS }));
      };
      return [
        shadow(0, 8, 70, 26),
        cbox(0, 0, 0, 96, 96, 8, t, { radius: 8 }),
        ...rounded(revolve([[8, 34], [130, 7]]), t),
        band(50),
        band(86),
        disc(0, -130, RX(7), t[0], 2),
      ];
    },
  },

  trophy: {
    states: ['default'],
    size: [190, 270],
    draw: ({ focal }) => {
      const t = focal ? TONES.orange : BRASS;
      const rim = RX(58);
      return [
        shadow(0, 10, 70, 24),
        cbox(0, 0, 0, 76, 76, 40, WOOD, { radius: 4 }),
        face('front', -38, 38, 40, [rect(14, 12, 48, 14, T['mustard-lit'], 2)]),
        ...rounded(revolve([[40, 26], [48, 22], [56, 9], [110, 9], [118, 16]]), t),
        rod(`M ${f(-rim + 6)} -196 C ${f(-rim - 44)} -196 ${f(-rim - 40)} -140 ${f(-rim + 18)} -144`, t[1], 12),
        rod(`M ${f(rim - 6)} -196 C ${f(rim + 44)} -196 ${f(rim + 40)} -140 ${f(rim - 18)} -144`, t[1], 12),
        ...rounded(revolve([[116, 18], [140, 40], [200, 58]]), t),
        disc(0, -200, rim, t[0]),
        el('path', { d: lens(-200, rim - 7, 20), fill: t[1] }),
      ];
    },
  },

  'gift box': {
    states: ['default'],
    size: [200, 250],
    draw: ({ focal }) => {
      const t = accent(focal, TONES.red);
      const rib = T['yellow-lit'];
      return [
        shadow(0, 14, 90, 34),
        cbox(0, 0, 0, 110, 110, 90, t, { radius: 6 }),
        face('front', -55, 55, 90, [rect(46, 0, 18, 90, rib)]),
        face('side', 55, 55, 90, [rect(46, 0, 18, 90, rib)]),
        cbox(0, 0, 90, 120, 120, 22, t, { radius: 6 }),
        face('front', -60, 60, 112, [rect(51, 0, 18, 22, rib)]),
        face('side', 60, 60, 112, [rect(51, 0, 18, 22, rib)]),
        top(-60, -60, 112, [rect(51, 0, 18, 120, rib), rect(0, 51, 120, 18, rib)]),
        shape('M 0 -116 C -50 -190 -96 -128 -36 -110 Z', T.yellow),
        shape('M 0 -116 C 50 -190 96 -128 36 -110 Z', T.yellow),
        shape('M -4 -114 L -30 -84 L -16 -82 Z', T['yellow-shade']),
        shape('M 4 -114 L 30 -84 L 16 -82 Z', T['yellow-shade']),
        circ(0, -118, 13, T['yellow-shade']),
      ];
    },
  },

  headphones: {
    states: ['default'],
    size: [220, 220],
    draw: ({ focal }) => [
      shadow(0, 0, 80, 14),
      rod('M -72 -80 C -76 -200 76 -200 72 -80', T['slate-shade'], 14),
      rod('M -72 -80 C -76 -200 76 -200 72 -80', T['ink-lit'], 5),
      shape(rr(-98, -110, 30, 90, 14), T.ink),
      shape(rr(68, -110, 30, 90, 14), T.ink),
      shape(rr(-86, -104, 26, 78, 12), accentFill(focal, T.slate)),
      shape(rr(60, -104, 26, 78, 12), accentFill(focal, T.slate)),
    ],
  },

  television: {
    states: ['off', 'on'],
    size: [250, 260],
    draw: ({ state, focal }) => {
      const on = state === 'on';
      return [
        shadow(0, 10, 90, 28),
        cbox(0, 0, 0, 80, 44, 8, TONES.ink, { radius: 4 }),
        cbox(0, 0, 8, 14, 10, 56, TONES.ink, { radius: 3 }),
        cbox(0, 0, 64, 200, 16, 124, TONES.ink, { radius: 6 }),
        face('front', -100, 8, 188, [
          rect(8, 8, 184, 108, on ? (focal ? T['orange-lit'] : T['blue-lit']) : T['ink-lit'], 4),
          ...(on ? [circ(60, 44, 16, T['yellow-lit']), el('path', { d: 'M 8 116 L 70 64 L 110 96 L 140 74 L 192 116 Z', fill: T['green-lit'] })] : [el('path', { d: 'M 120 14 L 150 14 L 60 110 L 30 110 Z', fill: T.canvas, opacity: 0.08 })]),
        ]),
      ];
    },
  },

  'alarm clock': {
    states: ['default'],
    size: [190, 220],
    draw: ({ focal }) => {
      const body = focal ? T.orange : T.red;
      return [
        shadow(0, 0, 60, 12),
        rod('M -40 -36 L -56 -6 M 40 -36 L 56 -6', T['slate-shade'], 8),
        rod('M -46 -154 L 46 -154 M 0 -154 L 0 -168', T.ink, 6),
        circ(-44, -152, 26, T.mustard),
        circ(44, -152, 26, T.mustard),
        circ(0, -96, 66, body),
        circ(0, -96, 52, T['paper-lit']),
        ticks(0, -96, 48, 12, 7),
        rod('M 0 -96 L 0 -132 M 0 -96 L 24 -86', T.ink, 5),
        circ(0, -96, 5, T.ink),
      ];
    },
  },

  funnel: {
    states: ['default'],
    size: [190, 220],
    draw: ({ focal }) => {
      const t = accent(focal, SLATE);
      const rim = RX(70);
      return [
        shadow(0, 2, 30, 10),
        ...rounded(revolve([[0, 8], [70, 11], [150, 70]]), t),
        disc(0, -150, rim, t[0]),
        el('path', { d: lens(-150, rim - 6, 30), fill: T['slate-dark'] }),
      ];
    },
  },

  sieve: {
    states: ['empty', 'full'],
    size: [250, 170],
    draw: ({ state, focal }) => {
      const rim = RX(64);
      const t = accent(focal, SLATE);
      const body = revolve([[0, 22], [20, 50], [52, 64]]);
      // the mesh: rows of holes across the bowl's inside, seen from above
      const dots = [];
      const [ix, iy] = [rim - 12, (rim - 12) * K - 4];
      for (let y = -iy; y <= iy; y += 7) for (let x = -ix; x <= ix; x += 9) {
        const xx = x + (Math.round(y / 7) % 2 ? 4.5 : 0);
        if ((xx / ix) ** 2 + (y / iy) ** 2 < 0.86) dots.push(circ(xx, -43 + y, 2.4, T['slate-dark'], { opacity: 0.75 }));
      }
      return [
        shadow(0, 2, 70, 22),
        rod(`M ${f(rim - 6)} -56 L 132 -90`, T['slate-shade'], 10),
        el('path', { d: body, fill: t[1] }),
        mark(body, 3.5),
        disc(0, -52, rim, 'none', 5),
        el('path', { d: lens(-52, rim - 6, 18), fill: state === 'full' ? T.mustard : T['slate-lit'] }),
        ...(state === 'full' ? [] : dots),
        ...(state === 'full' ? [[-24, -60], [0, -64], [22, -58], [-8, -54], [14, -50]].map(([x, y]) => circ(x, y, 7, T['mustard-lit'])) : []),
      ];
    },
  },

  magnet: {
    states: ['default'],
    size: [170, 200],
    draw: ({ focal }) => [
      shadow(0, 0, 60, 12),
      rod('M -46 -170 L -46 -84 A 46 46 0 0 0 46 -84 L 46 -170', focal ? T.orange : T.red, 38),
      rect(-65, -184, 38, 34, T['slate-lit'], 4),
      rect(27, -184, 38, 34, T['slate-lit'], 4),
      el('path', { d: 'M -56 -120 L -56 -86 A 36 36 0 0 0 -30 -52', fill: 'none', stroke: T.canvas, 'stroke-width': 6, 'stroke-linecap': 'round', opacity: 0.45 }),
    ],
  },

  'puzzle piece': {
    states: ['default'],
    size: [200, 170],
    draw: ({ focal }) => {
      const d = 'M 0 0 L 38 0 C 30 -24 70 -24 62 0 L 100 0 L 100 38 C 124 30 124 70 100 62 L 100 100 L 62 100 C 70 76 30 76 38 100 L 0 100 L 0 62 C 24 70 24 30 0 38 Z';
      const fill = focal ? T.orange : T.blue;
      const side = focal ? T['orange-shade'] : T['blue-shade'];
      return [
        shadow(0, 6, 90, 32),
        ...Array.from({ length: 14 }, (_, z) => top(-50, -50, z, [el('path', { d, fill: side })])),
        top(-50, -50, 14, [el('path', { d, fill })]),
      ];
    },
  },

  megaphone: {
    states: ['quiet', 'loud'],
    size: [250, 200],
    draw: ({ state, focal }) => {
      const c = focal ? T.orange : T.red;
      const parts = [shadow(0, 0, 70, 12)];
      parts.push(rod('M -24 -84 L -36 -30', T['slate-shade'], 14));
      parts.push(shape(rr(-96, -116, 30, 32, 8), T.ink));
      parts.push(shape('M -70 -116 L 46 -158 L 46 -42 L -70 -84 Z', c));
      parts.push(el('ellipse', { cx: 46, cy: -100, rx: 14, ry: 58, fill: T[`${focal ? 'orange' : 'red'}-shade`] }));
      parts.push(el('ellipse', { cx: 50, cy: -100, rx: 8, ry: 46, fill: T.ink, opacity: 0.5 }));
      if (state === 'loud') parts.push(mark('M 76 -130 Q 92 -100 76 -70 M 96 -146 Q 118 -100 96 -54 M 116 -160 Q 144 -100 116 -40', 4, 0.8));
      return parts;
    },
  },

  thermometer: {
    states: ['low', 'high'],
    size: [110, 270],
    draw: ({ state, focal }) => {
      const level = state === 'high' ? -220 : -100;
      const red = focal ? T.orange : T.red;
      return [
        shadow(0, 0, 34, 8),
        shape(rr(-16, -250, 32, 220, 16), T['paper-lit']),
        rect(-5, level, 10, -40 - level, red, 3),
        circ(0, -34, 26, red),
        ...Array.from({ length: 8 }, (_, i) => ink(`M 22 ${-80 - i * 20} L ${i % 2 ? 30 : 36} ${-80 - i * 20}`, 3, 0.55)),
        el('path', { d: 'M -8 -236 L -8 -70', stroke: T.canvas, 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.8 }),
      ];
    },
  },

  safe: {
    states: ['closed', 'open'],
    size: [260, 300],
    draw: ({ state, focal }) => {
      const parts = [shadow(0, 30, 120, 40), cbox(0, 0, 0, 140, 120, 150, SLATE, { radius: 10 })];
      if (state === 'closed') {
        parts.push(face('front', -70, 60, 150, [
          rect(10, 10, 120, 130, T['slate-lit'], 8),
          circ(54, 70, 26, accentFill(focal, T['slate-shade'])), circ(54, 70, 16, T['slate-lit']), ticks(54, 70, 24, 12, 5),
          rect(96, 54, 12, 34, T.ink, 5),
        ]));
      } else {
        parts.push(face('front', -70, 60, 150, [rect(10, 10, 120, 130, T['slate-dark'], 6), rect(14, 80, 112, 6, T.slate, 2)]));
        parts.push(face('front', -70, 60, 150, [rect(24, 62, 40, 18, T.mustard, 2), rect(70, 62, 40, 18, T.mustard, 2), rect(46, 48, 40, 16, T['mustard-lit'], 2)]));
        parts.push(box(-78, 60, 6, 8, 120, 138, accent(focal, SLATE), { radius: 6 }));
      }
      return parts;
    },
  },

  'watering can': {
    states: ['default'],
    size: [260, 210],
    draw: ({ focal }) => {
      const t = accent(focal, TONES.green);
      const rx = RX(48);
      return [
        shadow(0, 2, 80, 24),
        rod(`M ${f(rx - 10)} -40 L 120 -136`, t[1], 16),
        el('ellipse', { cx: 124, cy: -140, rx: 16, ry: 22, fill: t[0], transform: 'rotate(40 124 -140)' }),
        rod(`M ${f(-rx + 4)} -110 Q ${f(-rx - 30)} -150 0 -150 Q 30 -150 30 -112`, t[1], 12),
        ...rounded(revolve([[0, 50], [110, 46]]), t),
        disc(0, -110, RX(46), t[0]),
        el('path', { d: lens(-110, RX(30), 10), fill: T['green-dark'] }),
      ];
    },
  },

  dice: {
    states: ['default'],
    size: [170, 190],
    draw: ({ focal }) => [
      shadow(0, 14, 70, 26),
      cbox(0, 0, 0, 80, 80, 80, TONES.paper, { radius: 14 }),
      top(-40, -40, 80, [pip(40, 40, accentFill(focal, T.red))]),
      face('front', -40, 40, 80, [pip(22, 22), pip(58, 58)]),
      face('side', 40, 40, 80, [pip(20, 20), pip(40, 40), pip(60, 60)]),
    ],
  },

  'frying pan': {
    states: ['empty', 'egg'],
    size: [320, 150],
    draw: ({ state, focal }) => {
      const t = accent(focal, SLATE);
      const rim = RX(66);
      const parts = [shadow(0, 2, 84, 28)];
      parts.push(rod(`M ${f(rim - 10)} -14 L 150 -58`, T['slate-dark'], 16), rod('M 128 -51 L 150 -58', T['wood-dark'], 16));
      parts.push(...rounded(revolve([[0, 54], [16, 66]]), t));
      parts.push(disc(0, -16, rim, t[0]));
      parts.push(el('path', { d: lens(-16, rim - 8, 8), fill: T['slate-dark'] }));
      if (state === 'egg') {
        parts.push(shape('M -40 -14 Q -44 -34 -16 -36 Q 4 -46 26 -34 Q 46 -26 34 -10 Q 10 2 -16 -2 Q -38 2 -40 -14 Z', T['paper-lit']));
        parts.push(circ(-2, -22, 12, T.yellow));
      }
      return parts;
    },
  },

  sofa: {
    states: ['default'],
    size: [300, 230],
    draw: ({ focal }) => {
      const t = accent(focal, TONES.teal);
      return [
        shadow(0, 20, 140, 40),
        cbox(0, -36, 30, 180, 22, 90, t, { radius: 12 }),
        cbox(-100, 0, 0, 22, 94, 78, t, { radius: 10 }),
        cbox(0, 0, 8, 180, 90, 34, t, { radius: 8 }),
        cbox(-44, 10, 42, 86, 70, 18, t, { radius: 9 }),
        cbox(44, 10, 42, 86, 70, 18, t, { radius: 9 }),
        cbox(100, 0, 0, 22, 94, 78, t, { radius: 10 }),
      ];
    },
  },
};

// Measured bounds (design/tools, 2026-11-16): [width, height, back].
fitAll(BATCH_E, {
  "hammer": [260, 96, 42],
  "wrench": [260, 108, 37],
  "screwdriver": [236, 87, 24],
  "toolbox": [304, 189, 55],
  "balance scale": [314, 294, 0],
  "hourglass": [142, 237, 0],
  "stopwatch": [144, 227, 0],
  "battery": [104, 193, 0],
  "light bulb": [200, 270, 0],
  "suitcase": [306, 214, 54],
  "traffic light": [94, 367, 0],
  "park bench": [306, 202, 38],
  "street lamp": [220, 393, 0],
  "umbrella": [226, 310, 0],
  "traffic cone": [174, 165, 20],
  "trophy": [200, 271, 19],
  "gift box": [290, 202, 50],
  "headphones": [202, 200, 0],
  "television": [212, 272, 16],
  "alarm clock": [142, 223, 0],
  "funnel": [172, 229, 0],
  "sieve": [264, 127, 0],
  "magnet": [142, 214, 0],
  "puzzle piece": [236, 103, 29],
  "megaphone": [260, 191, 0],
  "thermometer": [80, 283, 0],
  "safe": [446, 245, 65],
  "watering can": [300, 197, 0],
  "dice": [226, 150, 32],
  "sofa": [360, 218, 71],
});
