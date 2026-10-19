// Props batch C (Explainers 3.2, EX3-78). Built from the helpers in kit.js.
//
//   key, padlock, magnifier, sign, flag, ball, car, bicycle, truck, flashlight, backpack,
//   monitor, keyboard
//
// Boxy things (vehicles, monitor, keyboard, padlock body, sign boards) are iso solids; organic
// things (key, magnifier, flag cloth, ball, backpack body, bicycle frame) are ink contours with
// flat fills. A few local helpers below build the solids the kit has no primitive for: a prism
// (any (x, z) profile extruded along y), a slab (a flat shape given thickness), a horizontal
// cylinder, a vehicle wheel and an ink tube.

import { T, el, g, line, TONES, P0, box, cbox, cyl, top, face, shape, mark, shade, accent, accentFill, shadow, stippleShade } from './kit.js';

// ── Local helpers ─────────────────────────────────────────────────────────────────────────
const f1 = (n) => n.toFixed(1);
/** Screen points of world points [[x, y, z], ...], for a polygon's `points`. */
const pts = (list) => list.map(([x, y, z]) => P0(x, y, z).map(f1).join(',')).join(' ');
/** A path through world points: 'M x y L x y ...' on screen. */
const sp = ([x, y, z]) => P0(x, y, z).map(f1).join(' ');
const wpath = (...list) => 'M ' + list.map(sp).join(' L ');
/** A cubic curve through world points a → b with controls c1, c2, on screen. */
const wcurve = (a, c1, c2, b) => `M ${sp(a)} C ${sp(c1)} ${sp(c2)} ${sp(b)}`;
/** A detail printed or cut into a surface (seams, zippers, text): ink on every ground, unlike
 *  mark(), whose outline color turns light on dark grounds. */
const ink = (d, sw = 3, opacity = 1) => el('path', { d, fill: 'none', stroke: T.ink, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity });
/** A glare stroke on glass: light lines, not ink. */
const glare = (d, sw, opacity) => el('path', { d, fill: 'none', stroke: T['paper-lit'], 'stroke-width': sw, 'stroke-linecap': 'round', opacity });
/** Raise a whole drawing on screen so its nearest corner sits on the base line. */
const lift = (dy, parts, dx = 0) => [g({ transform: `translate(${dx} ${-dy})` }, parts)];
const outline = (sw = 3.5) => ({ fill: 'none', stroke: line(), 'stroke-width': sw, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });

/**
 * A prism: the (x, z) profile `profile` extruded along world y from y0 (back) to y1 (front).
 * Draws the front face (tones[1]) and every side strip that faces the camera: strips facing up
 * take the lit tone, strips facing +x the dark tone. `smooth` hides the seams between strips
 * (for a profile sampled from curves); otherwise every strip is outlined like a box face.
 */
function prism(profile, y0, y1, tones = TONES.paper, { sw = 3.5, smooth = false, grain = true } = {}) {
  const n = profile.length;
  const cx = profile.reduce((a, p) => a + p[0], 0) / n;
  const cz = profile.reduce((a, p) => a + p[1], 0) / n;
  const strips = [];
  for (let i = 0; i < n; i++) {
    const a = profile[i];
    const b = profile[(i + 1) % n];
    let nx = b[1] - a[1];
    let nz = -(b[0] - a[0]);
    if ((a[0] + b[0]) / 2 * nx - cx * nx + ((a[1] + b[1]) / 2 - cz) * nz < 0) [nx, nz] = [-nx, -nz];
    const len = Math.hypot(nx, nz) || 1;
    nx /= len;
    nz /= len;
    if (nx + nz <= 0.02) continue; // faces away from the camera
    const quad = pts([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]]);
    strips.push({ quad, tone: nz >= 0.5 ? tones[0] : tones[2], dark: nz < 0.5 });
  }
  const front = pts(profile.map(([x, z]) => [x, y1, z]));
  const out = [];
  if (smooth) {
    out.push(el('polygon', { ...outline(sw * 2), points: pts(profile.map(([x, z]) => [x, y0, z])) }));
    for (const s of strips) out.push(el('polygon', { ...outline(sw * 2), points: s.quad }));
    for (const s of strips) out.push(el('polygon', { points: s.quad, fill: s.tone, stroke: s.tone, 'stroke-width': 1.2 }));
  } else {
    for (const s of strips) {
      out.push(el('polygon', { points: s.quad, fill: s.tone }));
      if (grain && s.dark) out.push(stippleShade('polygon', { points: s.quad }, T.ink, { x1: 1, y1: 0, x2: 0, y2: 1, from: 0.05, to: 0.32, fine: true }));
      out.push(el('polygon', { ...outline(sw), points: s.quad }));
    }
  }
  out.push(el('polygon', { points: front, fill: tones[1] }));
  if (grain) out.push(stippleShade('polygon', { points: front }, T.ink, { from: 0, to: 0.22, fine: true }));
  out.push(el('polygon', { ...outline(sw), points: front }));
  return out;
}

/** Sample a rounded rectangle in (x, z) as a polygon: corner radii [bottom, top]. */
function roundRect(x0, z0, x1, z1, rb, rt, step = 15) {
  const out = [];
  const arc = (cx, cz, r, a0, a1) => {
    if (r <= 0) return out.push([cx, cz]);
    for (let a = a0; a <= a1 + 1e-6; a += step) out.push([cx + r * Math.cos((a * Math.PI) / 180), cz + r * Math.sin((a * Math.PI) / 180)]);
  };
  arc(x1 - rb, z0 + rb, rb, -90, 0);
  arc(x1 - rt, z1 - rt, rt, 0, 90);
  arc(x0 + rt, z1 - rt, rt, 90, 180);
  arc(x0 + rb, z0 + rb, rb, 180, 270);
  return out;
}

/**
 * A flat shape given thickness: copies of path `d` from `depth` behind the front up to the
 * front, so the side wall fills in. at(k, svg) lays svg on the plane k units behind the front.
 */
function slab(at, depth, d, frontFill, sideFill, { sw = 3.5, steps = 6 } = {}) {
  const ks = Array.from({ length: steps + 1 }, (_, i) => depth * (1 - i / steps));
  const rule = { 'fill-rule': 'evenodd' };
  return [
    ...ks.map((k) => at(k, el('path', { d, ...rule, ...outline(sw * 2) }))),
    ...ks.slice(0, -1).map((k) => at(k, el('path', { d, ...rule, fill: sideFill, stroke: sideFill, 'stroke-width': 1 }))),
    at(0, el('path', { d, ...rule, fill: frontFill, stroke: line(), 'stroke-width': sw, 'stroke-linejoin': 'round' })),
  ];
}

/** An ink tube along path d (straps, shackles, bike tubes): an outline stroke, then the fill. */
const tube = (d, w, fill, cap = 'round') => [
  el('path', { d, fill: 'none', stroke: line(), 'stroke-width': w + 7, 'stroke-linecap': cap, 'stroke-linejoin': 'round' }),
  el('path', { d, fill: 'none', stroke: fill, 'stroke-width': w, 'stroke-linecap': cap, 'stroke-linejoin': 'round' }),
];

// A horizontal cylinder along world x lies on screen between two ellipses (circles on 'side'
// planes); its silhouette touches each ellipse where the circle's angle is 135° and -45°.
const K_U = 0.6124; // screen offsets of those tangent points, per unit radius
const K_V = 1.0607;
const ring = (x, z, r, attrs) => face('side', x, 0, z, el('circle', { cx: 0, cy: 0, r, ...attrs }));
/** One segment of a horizontal cylinder (or cone) on the axis y = 0, z = zc, from x0 to x1. */
function hcyl(x0, x1, r0, r1, zc, fill, cap, { sw = 3.5, shading = true } = {}) {
  const [ax, ay] = P0(x0, 0, zc);
  const [bx, by] = P0(x1, 0, zc);
  const up = (X, Y, r) => [X + K_U * r, Y - K_V * r];
  const lo = (X, Y, r) => [X - K_U * r, Y + K_V * r];
  const q = [up(ax, ay, r0), up(bx, by, r1), lo(bx, by, r1), lo(ax, ay, r0)];
  const d = `M ${q.map((p) => p.map(f1).join(' ')).join(' L ')} Z`;
  return [
    ring(x0, zc, r0, { fill, stroke: line(), 'stroke-width': sw }),
    el('path', { d, fill }),
    shading ? shade(d, { x1: 1, y1: 0, x2: 0, y2: 1, from: 0, to: 0.3 }) : '',
    mark(`M ${q[0].map(f1).join(' ')} L ${q[1].map(f1).join(' ')} M ${q[3].map(f1).join(' ')} L ${q[2].map(f1).join(' ')}`, sw),
    ring(x1, zc, r1, { fill: cap, stroke: line(), 'stroke-width': sw }),
  ];
}

/** A vehicle wheel: a tire of width w on the axle x, outer (visible) face at y, radius r. */
function wheel(x, y, r, w = 14) {
  const at = (k, inner) => face('front', x, y - k, r, inner);
  return [
    ...slab(at, w, `M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 Z`, T['ink-lit'], T.ink, { steps: 5 }),
    at(0, el('circle', { cx: 0, cy: 0, r: r * 0.52, fill: T['paper-dark'], stroke: line(), 'stroke-width': 3 })),
    at(0, el('circle', { cx: 0, cy: 0, r: r * 0.16, fill: T.ink })),
  ];
}

/** The dark wheel well cut into a body side (the 'front' plane y), behind a wheel. */
const wheelWell = (x, y, r) => face('front', x, y, r, el('path', { d: `M ${-r - 6} 6 A ${r + 6} ${r + 6} 0 0 1 ${r + 6} 6 Z`, fill: T.ink }));

// ── Batch C ───────────────────────────────────────────────────────────────────────────────
export const BATCH_C = {
  // A key standing on its edge in the 'side' plane: round bow with a hole at the lower left,
  // the blade rising to the right with notched teeth under it.
  key: {
    states: ['default'],
    size: [260, 210],
    draw: ({ focal }) => {
      const d =
        'M 36.66 -16 L 50 -16 L 50 -10 L 196 -10 L 206 -1 L 206 10 L 200 34 L 188 34 L 182 24 L 174 34 L 162 34 L 156 22 L 148 22 L 142 34 L 130 34 L 124 10 L 50 10 L 50 16 L 36.66 16 A 40 40 0 1 1 36.66 -16 Z ' +
        'M -21 0 A 15 15 0 1 0 9 0 A 15 15 0 1 0 -21 0 Z';
      const at = (k, inner) => face('side', -k, 82, 40, inner);
      const [front, side] = focal ? [T.orange, T['orange-dark']] : [T['paper-lit'], T['paper-dark']];
      return lift(32, [
        g({ transform: 'translate(17 -10) rotate(-30)' }, shadow(0, 0, 118, 16)),
        ...slab(at, 12, d, front, side),
        at(0, shade(d, { from: 0, to: 0.25 })),
        // the blade's groove and a ring around the bow
        at(0, ink('M 58 0 L 190 0', 3, 0.55)),
        at(0, el('circle', { cx: 0, cy: 0, r: 30, fill: 'none', stroke: line(), 'stroke-width': 2.5, opacity: 0.4 })),
      ]);
    },
  },

  // A padlock: a box body with a keyhole, a U shackle into its top. Unlocked, the shackle has
  // sprung up and its left leg is out of the body.
  padlock: {
    states: ['locked', 'unlocked'],
    size: [190, 250],
    draw: ({ state, focal }) => {
      const H = 92;
      const up = state === 'unlocked' ? 34 : 0;
      const legL = H + up + (up ? 10 : 0);
      const top = H + 52 + up;
      const tubeD = `M -34 ${-legL} L -34 ${-top} A 34 34 0 0 1 34 ${-top} L 34 ${-H}`;
      const parts = [shadow(0, 10, 88, 28)];
      parts.push(cbox(0, 0, 0, 110, 46, H, accent(focal)));
      // the body's top band and the keyhole on its front face
      parts.push(face('front', -55, 23, H, [
        ink('M 8 16 L 102 16', 3, 0.45),
        el('path', { d: 'M 55 36 m -10 0 a 10 10 0 1 0 20 0 a 10 10 0 1 0 -20 0 Z M 51 42 L 47 66 L 63 66 L 59 42 Z', fill: T.ink }),
      ]));
      // the holes the shackle enters, then the shackle (in the plane y = 0)
      parts.push(...[-34, 34].map((x) => cyl(x, 0, H, 11, 0, TONES.ink)));
      parts.push(face('front', 0, 0, 0, [
        ...tube(tubeD, 15, T['paper-dark'], 'butt'),
        ink(`M -38 ${-legL + 4} L -38 ${-top} A 38 38 0 0 1 22 ${-top - 28}`, 3, 0.35),
      ]));
      return lift(14, parts);
    },
  },

  // A magnifying glass: a thick ring around a pale lens with a glint, a collar and a handle
  // running down to the right. The ring is the accent.
  magnifier: {
    states: ['default'],
    size: [220, 230],
    draw: ({ focal }) => {
      const [cx, cy, R, r] = [-40, -150, 60, 45];
      const ringD = `M ${cx - R} ${cy} a ${R} ${R} 0 1 0 ${2 * R} 0 a ${R} ${R} 0 1 0 ${-2 * R} 0 Z M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
      const [rim, rimSide] = focal ? [T.orange, T['orange-dark']] : [T['paper-lit'], T['paper-dark']];
      return [
        shadow(10, 6, 96, 16),
        // the handle and its collar, drawn along +x and turned 45° down to the right
        g({ transform: `translate(${cx} ${cy}) rotate(45)` }, [
          el('rect', { x: 52, y: -13, width: 34, height: 26, rx: 4, fill: T['paper-dark'], stroke: line(), 'stroke-width': 3.5 }),
          ink('M 64 -13 L 64 13 M 74 -13 L 74 13', 2.5, 0.5),
          el('rect', { x: 84, y: -17, width: 108, height: 34, rx: 17, fill: T['ink-lit'], stroke: line(), 'stroke-width': 3.5 }),
          glare('M 100 -8 L 176 -8', 4, 0.3),
        ]),
        // the rim's depth, then the rim and the lens with its glint
        el('path', { d: ringD, transform: 'translate(6 5)', 'fill-rule': 'evenodd', fill: rimSide, stroke: line(), 'stroke-width': 3.5 }),
        el('circle', { cx, cy, r, fill: T['paper-shade'], opacity: 0.55 }),
        el('path', { d: ringD, 'fill-rule': 'evenodd', fill: rim, stroke: line(), 'stroke-width': 3.5 }),
        el('path', { d: `M ${cx - 28} ${cy - 10} A 30 30 0 0 1 ${cx - 8} ${cy - 30}`, fill: 'none', stroke: line(), 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0.55 }),
        el('path', { d: `M ${cx - 30} ${cy + 6} L ${cx - 30} ${cy + 6}`, fill: 'none', stroke: line(), 'stroke-width': 6, 'stroke-linecap': 'round', opacity: 0.55 }),
      ];
    },
  },

  // A signpost: a square post with two arrow boards pointing opposite ways. The upper board is
  // the accent.
  sign: {
    states: ['default'],
    size: [250, 260],
    draw: ({ focal }) => {
      const parts = [shadow(0, 8, 40, 16)];
      parts.push(cbox(0, 0, 0, 16, 16, 232));
      // upper board points +x (down to the right), lower board points -x
      parts.push(...prism([[-58, 150], [92, 150], [122, 173], [92, 196], [-58, 196]], 8, 18, accent(focal)));
      parts.push(face('front', -46, 18, 186, ink('M 0 0 L 96 0 M 0 18 L 70 18', 4, 0.5)));
      parts.push(...prism([[-120, 116], [-90, 93], [58, 93], [58, 139], [-90, 139]], 8, 18));
      parts.push(face('front', -78, 18, 129, ink('M 0 0 L 120 0 M 30 18 L 120 18', 4, 0.5)));
      return lift(4, parts);
    },
  },

  // A flag on a pole: a stone foot, a thin pole with a ball finial, a waving cloth flying up to
  // the right (in the 'side' plane). The cloth is the accent.
  flag: {
    states: ['default'],
    size: [260, 290],
    draw: ({ focal }) => {
      const Z = 196; // top of the cloth
      const [W, Hc, A] = [132, 84, 9]; // cloth length, height, wave amplitude
      const wave = (u) => A * Math.sin((u / W) * 2.2 * Math.PI);
      const edge = (v0, from, to, n = 22) => Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n).map((u) => [u, v0 + wave(u)]);
      const P = (list) => list.map(([u, v]) => `${f1(u)} ${f1(v)}`).join(' L ');
      const cloth = `M ${P(edge(0, 4, W))} L ${P(edge(Hc, W, 4))} Z`;
      // the folds: where the wave turns away from the light
      const fold = (a, b) => `M ${P(edge(0, a, b, 8))} L ${P(edge(Hc, b, a, 8))} Z`;
      const span = W / 2.2;
      const tones = accent(focal);
      return [
        shadow(0, 6, 40, 16),
        cyl(0, 0, 0, 22, 14, TONES.paper),
        face('side', 0, 0, Z, [
          el('path', { d: cloth, fill: tones[0] }),
          el('path', { d: fold(span * 0.25, span * 0.75), fill: tones[2] }),
          el('path', { d: fold(span * 1.25, span * 1.75), fill: tones[2] }),
          shade(cloth, { from: 0, to: 0.18 }),
          el('path', { d: cloth, fill: 'none', stroke: line(), 'stroke-width': 3.5, 'stroke-linejoin': 'round' }),
        ]),
        cyl(0, 0, 14, 5, 196, TONES.paper, { sw: 3 }),
        el('circle', { cx: 0, cy: -218, r: 9, fill: T['paper-dark'], stroke: line(), 'stroke-width': 3 }),
      ];
    },
  },

  // A ball with basketball seams, shaded to the lower right. The whole ball is the accent.
  ball: {
    states: ['default'],
    size: [190, 190],
    draw: ({ focal }) => {
      const R = 70;
      const c = `M ${-R} 0 a ${R} ${R} 0 1 0 ${2 * R} 0 a ${R} ${R} 0 1 0 ${-2 * R} 0 Z`;
      const k = (n) => f1(n * R);
      return [
        shadow(0, 2, 66, 14),
        g({ transform: `translate(0 ${-R - 2})` }, [
          shape(c, accentFill(focal)),
          shade(c, { x1: 0, y1: 0, x2: 1, y2: 1, from: 0, to: 0.38 }),
          g({ transform: 'rotate(-24)' }, ink(`M ${-R} 0 Q 0 18 ${R} 0 M 0 ${-R} Q -12 0 0 ${R} M ${k(-0.6)} ${k(-0.8)} Q ${k(-0.12)} 0 ${k(-0.6)} ${k(0.8)} M ${k(0.6)} ${k(-0.8)} Q ${k(0.12)} 0 ${k(0.6)} ${k(0.8)}`, 3.5)),
          el('path', { d: `M ${-R * 0.62} ${-R * 0.28} A ${R * 0.68} ${R * 0.68} 0 0 1 ${-R * 0.3} ${-R * 0.6}`, fill: 'none', stroke: T['paper-lit'], 'stroke-width': 6, 'stroke-linecap': 'round', opacity: 0.7 }),
          el('path', { d: c, fill: 'none', stroke: line(), 'stroke-width': 4 }),
        ]),
      ];
    },
  },

  // A car driving toward +x (the lower right): body, a cabin with windows, two visible wheels,
  // headlights on the nose. The body is the accent.
  car: {
    states: ['default'],
    size: [340, 240],
    draw: ({ focal }) => {
      const tone = accent(focal);
      const Wb = 54; // half width of the body
      const Wc = 46; // half width of the cabin
      const r = 27;
      const axles = [-72, 72];
      const xf = (z) => 44 - ((z - 64) * 34) / 48; // the cabin's front (windshield) edge
      const xr = (z) => -92 + ((z - 64) * 22) / 48; // the cabin's rear edge
      const glass = { fill: T['ink-lit'], stroke: line(), 'stroke-width': 2.5, 'stroke-linejoin': 'round' };
      const parts = [shadow(0, 14, 170, 62)];
      for (const x of axles) parts.push(...wheel(x, -Wb + 8, r, 12));
      parts.push(...prism([[-120, 22], [116, 22], [124, 42], [116, 64], [-112, 64], [-124, 42]], -Wb, Wb, tone));
      for (const x of axles) parts.push(wheelWell(x, Wb, r));
      // door seams and handles
      parts.push(ink(wpath([-24, Wb, 26], [-24, Wb, 60]) + ' ' + wpath([-14, Wb, 54], [0, Wb, 54]) + ' ' + wpath([50, Wb, 54], [64, Wb, 54]), 2.5, 0.6));
      parts.push(...prism([[-92, 64], [44, 64], [10, 112], [-70, 112]], -Wc, Wc, tone));
      // windshield, side windows (split by the pillar), a glare stroke on each
      parts.push(el('polygon', { ...glass, points: pts([[39, -Wc + 6, 70], [14, -Wc + 6, 106], [14, Wc - 6, 106], [39, Wc - 6, 70]]) }));
      parts.push(el('polygon', { ...glass, points: pts([[-16, Wc, 72], [xf(72) - 9, Wc, 72], [xf(105) - 9, Wc, 105], [-16, Wc, 105]]) }));
      parts.push(el('polygon', { ...glass, points: pts([[xr(72) + 9, Wc, 72], [-26, Wc, 72], [-26, Wc, 105], [xr(105) + 9, Wc, 105]]) }));
      parts.push(face('front', -60, Wc, 100, glare('M 0 0 L 16 -22 M 52 4 L 70 -20', 4, 0.35)));
      // headlights and grille on the nose
      for (const y of [36, -36]) parts.push(face('side', 120, y, 52, el('ellipse', { cx: 0, cy: 0, rx: 11, ry: 7, fill: T['paper-lit'], stroke: line(), 'stroke-width': 2.5 })));
      parts.push(face('side', 121, 18, 32, ink('M 0 0 L 36 0 M 0 7 L 36 7', 2.5, 0.6)));
      for (const x of axles) parts.push(...wheel(x, Wb + 8, r, 14));
      return lift(50, parts);
    },
  },

  // A bicycle in the plane y = 0: two spoked wheels, a diamond frame, a saddle and handlebars
  // across the frame. The frame is the accent.
  bicycle: {
    states: ['default'],
    size: [300, 240],
    draw: ({ focal }) => {
      const r = 48;
      const [rear, front, bb, seat, head0, head1] = [[-80, r], [80, r], [-12, 40], [-32, 112], [56, 100], [62, 120]];
      const v = ([x, z]) => `${x} ${-z}`; // world (x, z) → plane (u, v)
      const wheelArt = (cx, cz) => {
        const spokes = [];
        for (let a = 0; a < 180; a += 30) {
          const [dx, dz] = [Math.cos((a * Math.PI) / 180) * (r - 6), Math.sin((a * Math.PI) / 180) * (r - 6)];
          spokes.push(`M ${f1(cx - dx)} ${f1(-cz + dz)} L ${f1(cx + dx)} ${f1(-cz - dz)}`);
        }
        return [
          mark(spokes.join(' '), 1.8, 0.55),
          el('circle', { cx, cy: -cz, r, fill: 'none', stroke: line(), 'stroke-width': 9 }),
          el('circle', { cx, cy: -cz, r: r - 8, fill: 'none', stroke: line(), 'stroke-width': 2 }),
          el('circle', { cx, cy: -cz, r: 5, fill: T['paper-dark'], stroke: line(), 'stroke-width': 2.5 }),
        ];
      };
      const frame = [
        `M ${v(rear)} L ${v(bb)} L ${v(seat)} Z`, // chain stay, seat tube, seat stay
        `M ${v(seat)} L ${v(head1)} L ${v(head0)} L ${v(bb)}`, // top tube, head tube, down tube
        `M ${v(head0)} L ${v(front)}`, // fork
        `M ${v(seat)} L ${v([-38, 128])}`, // seat post
        `M ${v(head1)} L ${v([66, 134])}`, // stem
      ].join(' ');
      const fill = accentFill(focal, T['paper-shade']);
      const crank = `M ${v([-12, 40])} L ${v([4, 22])}`;
      return lift(36, [
        shadow(0, 10, 150, 30),
        face('front', 0, 0, 0, [
          ...wheelArt(...rear),
          ...wheelArt(...front),
          el('path', { d: frame, fill: 'none', stroke: line(), 'stroke-width': 13, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
          el('path', { d: frame, fill: 'none', stroke: fill, 'stroke-width': 6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
          el('circle', { cx: -12, cy: -40, r: 11, fill: T['paper-dark'], stroke: line(), 'stroke-width': 3 }),
          ...tube(crank, 4, T['paper-dark']),
          el('rect', { x: -2, y: -26, width: 14, height: 6, rx: 2, fill: T.ink }),
        ]),
        // the saddle on top of the seat post, the handlebars across the stem
        top(-38, 0, 130, [
          el('path', { d: 'M -22 -13 C -30 -12 -30 12 -22 13 L 22 4 C 26 3 26 -3 22 -4 Z', fill: T['ink-lit'], stroke: line(), 'stroke-width': 3 }),
        ]),
        ...tube(wpath([66, -28, 134], [66, 28, 134]), 5, T['ink-lit']),
      ]);
    },
  },

  // A delivery truck driving toward +x: a tall cargo box, a cab with a windshield, three
  // visible wheels. The cab is the accent.
  truck: {
    states: ['default'],
    size: [370, 340],
    draw: ({ focal }) => {
      const Wt = 54;
      const r = 27;
      const axles = [-92, -36, 92];
      const glass = { fill: T['ink-lit'], stroke: line(), 'stroke-width': 2.5, 'stroke-linejoin': 'round' };
      const parts = [shadow(0, 16, 180, 66)];
      for (const x of axles) parts.push(...wheel(x, -Wt + 8, r, 12));
      parts.push(box(-130, -Wt + 4, 20, 262, 2 * Wt - 8, 12, TONES.ink));
      // the cargo box, ribbed along its side
      parts.push(box(-130, -Wt, 30, 178, 2 * Wt, 150));
      parts.push(face('front', -130, Wt, 180, ink([30, 60, 90, 120, 150].map((u) => `M ${u} 12 L ${u} 138`).join(' '), 2.5, 0.3)));
      parts.push(face('front', -130, Wt, 180, ink('M 10 12 L 168 12', 3, 0.5)));
      // the cab with a windshield, a side window and a door seam
      parts.push(...prism([[56, 30], [132, 30], [132, 86], [114, 138], [56, 138]], -Wt + 2, Wt - 2, accent(focal)));
      parts.push(el('polygon', { ...glass, points: pts([[129, -Wt + 10, 92], [117, -Wt + 10, 128], [117, Wt - 10, 128], [129, Wt - 10, 92]]) }));
      parts.push(el('polygon', { ...glass, points: pts([[72, Wt - 2, 96], [118, Wt - 2, 96], [108, Wt - 2, 128], [72, Wt - 2, 128]]) }));
      parts.push(face('front', 64, Wt - 2, 92, ink('M 0 0 L 0 52 M 10 12 L 24 12', 2.5, 0.55)));
      for (const x of axles) parts.push(wheelWell(x, Wt, r));
      // headlights and bumper on the nose
      parts.push(box(132, -Wt + 2, 24, 8, 2 * Wt - 4, 16, TONES.ink));
      for (const y of [38, -38]) parts.push(face('side', 132, y, 60, el('rect', { x: -8, y: -6, width: 16, height: 12, rx: 3, fill: T['paper-lit'], stroke: line(), 'stroke-width': 2.5 })));
      for (const x of axles) parts.push(...wheel(x, Wt + 8, r, 14));
      return lift(61, parts);
    },
  },

  // A flashlight lying along x: a grip with a sliding switch on top, a flared head and lens
  // facing the lower right. On, a pale cone of light spreads out of the lens. The grip is the
  // accent.
  flashlight: {
    states: ['off', 'on'],
    size: [330, 250],
    draw: ({ state, focal }) => {
      const zc = 38;
      const grip = accentFill(focal, T['paper-shade']);
      const gripCap = accentFill(focal, T['paper-lit']);
      const parts = [shadow(-40, 12, 124, 28)];
      parts.push(...hcyl(-148, -134, 20, 20, zc, T['ink-lit'], T['ink-lit'], { shading: false }));
      parts.push(...hcyl(-134, -10, 22, 22, zc, grip, gripCap));
      // grip rings, then the switch on top of the grip
      for (const x of [-120, -112, -104]) parts.push(ring(x, zc, 22, { fill: 'none', stroke: T.ink, 'stroke-width': 2, opacity: 0.45, 'stroke-dasharray': '0 34 40 100' }));
      parts.push(cbox(-64, 0, zc + 19, 30, 12, 6, TONES.ink, { sw: 2.5, grain: false }));
      parts.push(...hcyl(-10, 26, 22, 34, zc, T['paper-shade'], T['paper-lit']));
      parts.push(...hcyl(26, 38, 37, 37, zc, T['paper-dark'], T['paper-dark']));
      // the lens: pale with a glint when on, dark when off
      const on = state === 'on';
      parts.push(ring(38, zc, 29, { fill: on ? T['paper-lit'] : T['ink-lit'], stroke: line(), 'stroke-width': 2.5 }));
      parts.push(ring(38, zc, 9, { fill: 'none', stroke: on ? line() : T['paper-dark'], 'stroke-width': 2, opacity: 0.5 }));
      if (on) {
        // the beam: a cone from the lens to a wide end, flat pale fill and dashed ink edges
        const [lx, ly] = P0(38, 0, zc);
        const [ex, ey] = P0(124, 0, zc);
        const [r0, r1] = [29, 54];
        const q = [[lx + K_U * r0, ly - K_V * r0], [ex + K_U * r1, ey - K_V * r1], [ex - K_U * r1, ey + K_V * r1], [lx - K_U * r0, ly + K_V * r0]];
        const d = `M ${q.map((p) => p.map(f1).join(' ')).join(' L ')} Z`;
        const edges = { fill: 'none', stroke: line(), 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-dasharray': '10 9', opacity: 0.7 };
        parts.push(el('path', { d, fill: T['paper-lit'], opacity: 0.85 }));
        parts.push(ring(124, zc, r1, { fill: T['paper-lit'], opacity: 0.85 }));
        parts.push(el('path', { d: `M ${q[0].map(f1).join(' ')} L ${q[1].map(f1).join(' ')} M ${q[3].map(f1).join(' ')} L ${q[2].map(f1).join(' ')}`, ...edges }));
        parts.push(ring(124, zc, r1, edges));
        parts.push(face('side', 80, 0, zc, mark('M -6 -20 L 8 -20 M -4 0 L 12 0 M -6 20 L 8 20', 3, 0.5)));
      }
      return lift(76, parts, -2);
    },
  },

  // A backpack standing up: a pillowy body with a zipped top, a front pocket, a grab handle on
  // top and a shoulder strap looping out behind. The body is the accent.
  backpack: {
    states: ['default'],
    size: [260, 290],
    draw: ({ focal }) => {
      const D = 36; // half depth
      const tones = accent(focal);
      const strapFill = T['ink-lit'];
      const parts = [shadow(0, 12, 110, 40)];
      // the shoulder strap, behind the body, looping out past its right edge
      parts.push(...tube(wcurve([56, -D, 176], [56, -D - 70, 150], [56, -D - 70, 60], [56, -D, 24]), 13, strapFill));
      parts.push(...prism(roundRect(-74, 0, 74, 200, 22, 62), -D, D, tones, { smooth: true }));
      // the grab handle on top, a loop across the body's depth
      parts.push(face('side', 0, 0, 200, tube('M -22 2 C -22 -34 22 -34 22 2', 7, strapFill)));
      // the main zipper following the top, with its pull
      parts.push(face('front', 0, D, 0, [
        ink('M -60 -120 L -60 -142 A 50 50 0 0 1 -10 -186 L 10 -186 A 50 50 0 0 1 60 -142 L 60 -120', 3, 0.6),
        el('rect', { x: 56, y: -122, width: 8, height: 18, rx: 3, fill: T.ink }),
      ]));
      // the front pocket, standing proud of the body
      parts.push(...prism(roundRect(-52, 18, 52, 96, 12, 18), D, D + 16, tones, { smooth: true }));
      parts.push(face('front', 0, D + 16, 0, [
        ink('M -40 -82 L 40 -82', 3, 0.6),
        el('rect', { x: 30, y: -84, width: 8, height: 18, rx: 3, fill: T.ink }),
      ]));
      return lift(36, parts);
    },
  },

  // A desktop monitor: a thin screen slab raised on a neck and a flat foot. On, the screen is
  // lit with lines of content; off, it is dark with a glare. The casing is the accent.
  monitor: {
    states: ['off', 'on'],
    size: [260, 300],
    draw: ({ state, focal }) => {
      const [w, h, z0] = [230, 138, 72];
      const parts = [shadow(0, 2, 120, 44)];
      parts.push(cbox(0, -22, 0, 116, 72, 10));
      parts.push(box(-16, -34, 10, 32, 12, 124));
      parts.push(box(-w / 2, -8, z0, w, 14, h, accent(focal, TONES.ink)));
      const screen = state === 'on'
        ? [
            el('rect', { x: 0, y: 0, width: w - 20, height: h - 24, rx: 3, fill: T['paper-lit'], stroke: line(), 'stroke-width': 2 }),
            ink(`M 0 16 L ${w - 20} 16`, 2, 0.5),
            ink('M 14 34 L 110 34 M 14 52 L 168 52 M 14 70 L 90 70 M 14 88 L 136 88', 4, 0.45),
          ]
        : [
            el('rect', { x: 0, y: 0, width: w - 20, height: h - 24, rx: 3, fill: T['ink-lit'], stroke: line(), 'stroke-width': 2 }),
            glare('M 130 10 L 72 102 M 160 10 L 102 102', 6, 0.18),
          ];
      parts.push(face('front', -w / 2 + 10, 6, z0 + h - 8, screen));
      parts.push(face('front', 0, 6, z0 + 9, el('circle', { cx: 0, cy: 0, r: 2.5, fill: state === 'on' ? T['paper-lit'] : T['paper-dark'] })));
      return lift(14, parts);
    },
  },

  // A keyboard: a low case with five rows of raised keys (a space bar on the near row) and its
  // cable running off the back. The case is the accent.
  keyboard: {
    states: ['default'],
    size: [340, 210],
    draw: ({ focal }) => {
      const [w, d] = [272, 116];
      const parts = [shadow(0, 6, 160, 56)];
      parts.push(...tube(wcurve([-70, -d / 2, 8], [-70, -d / 2 - 40, 8], [-20, -d / 2 - 50, 4], [-10, -d / 2 - 100, 2]), 5, T['ink-lit']));
      parts.push(box(-w / 2, -d / 2, 0, w, d, 14, accent(focal)));
      // the dark deck the keys sit in, so the gaps between them read on any ground
      parts.push(top(-w / 2 + 5, -d / 2 + 5, 14, el('rect', { x: 0, y: 0, width: w - 10, height: d - 10, rx: 3, fill: T['ink-lit'] })));
      // keys carry no outline: the dark deck between them separates them on every ground
      const key = (x, y, kw) => box(x, y, 14, kw, 16, 6, TONES.paper, { grain: false, outline: false });
      const x0 = -w / 2 + 9;
      for (let row = 0; row < 4; row++) {
        const y = -d / 2 + 9 + row * 20;
        for (let c = 0; c < 13; c++) parts.push(key(x0 + c * 20, y, 16));
      }
      // the near row: modifiers and a long space bar
      const y = -d / 2 + 9 + 4 * 20;
      for (const [x, kw] of [[x0, 16], [x0 + 20, 16], [x0 + 40, 36], [x0 + 80, 96], [x0 + 180, 36], [x0 + 220, 16], [x0 + 240, 16]]) parts.push(key(x, y, kw));
      return lift(66, parts);
    },
  },
};
