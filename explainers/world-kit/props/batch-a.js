// Props batch A (Explainers 3.2, EX3-78). Built from the helpers in kit.js.
//
// Furniture with a wide footprint (table, shelf, bed, box, house) sits a little behind its origin
// so its nearest corner lands near the size's +30 line, like the other props; the origin is still
// where it stands. Round things (lamp, bucket, cup, bottle, bell, pot) are drawn as solids of
// revolution: revolve() traces the outline a stack of iso circles makes.

// eslint-disable-next-line no-unused-vars
import { T, el, g, line, TONES, P0, box, cbox, cyl, RX, top, face, shape, mark, shade, accent, accentFill, shadow, isoDisc, freehand } from './kit.js';

// ── Local helpers ─────────────────────────────────────────────────────────────────────────
const f = (v) => +v.toFixed(1);
/** ry / rx of a horizontal circle seen in iso. */
const K = Math.tan(Math.PI / 6);
const pts = (list) => list.map((p) => P0(...p).map(f).join(',')).join(' ');

/** A flat polygon through world points, filled and ink-outlined. */
const quad = (list, fill, sw = 3.5) => el('polygon', { points: pts(list), fill, stroke: line(), 'stroke-width': sw, 'stroke-linejoin': 'round' });

/** A horizontal circle seen in iso: screen center (cx, cy), screen radius rx. */
const disc = (cx, cy, rx, fill, sw = 3.5) => el('ellipse', { cx: f(cx), cy: f(cy), rx: f(rx), ry: f(rx * K), fill, stroke: line(), 'stroke-width': sw });

/** The front half of a horizontal circle at height z, screen radius rx (a band, a rim, a ridge). */
const frontArc = (z, rx) => `M ${f(-rx)} ${f(-z)} A ${f(rx)} ${f(rx * K)} 0 0 0 ${f(rx)} ${f(-z)}`;

/** Outline of an upright round body about the origin. profile: [[z, r], ...] bottom to top,
 *  world units, linear between points. The outline is the union of the iso circles. */
function revolve(profile, step = 1.5) {
  const rings = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [z0, r0] = profile[i];
    const [z1, r1] = profile[i + 1];
    const n = Math.max(1, Math.ceil(Math.abs(z1 - z0)));
    for (let k = 0; k < n; k++) rings.push([z0 + ((z1 - z0) * k) / n, RX(r0 + ((r1 - r0) * k) / n)]);
  }
  const last = profile[profile.length - 1];
  rings.push([last[0], RX(last[1])]);
  const xm = Math.max(...rings.map((r) => r[1])) - 0.01;
  const topEdge = [];
  const botEdge = [];
  for (let x = -xm; x <= xm + 1e-6; x = x + step > xm && x < xm ? xm : x + step) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const [z, rx] of rings) {
      if (rx <= Math.abs(x)) continue;
      const h = rx * K * Math.sqrt(1 - (x / rx) ** 2);
      lo = Math.min(lo, -z - h);
      hi = Math.max(hi, -z + h);
    }
    if (lo < Infinity) {
      topEdge.push(`${f(x)} ${f(lo)}`);
      botEdge.push(`${f(x)} ${f(hi)}`);
    }
  }
  return `M ${topEdge.join(' L ')} L ${botEdge.reverse().join(' L ')} Z`;
}

/** A detail mark inside a paper or orange shape: always ink, so it shows on dark grounds too
 *  (line() turns light there and would vanish on a paper fill). */
const ink = (d, sw = 3, opacity = 1) => el('path', { d, fill: 'none', stroke: T.ink, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity });

/** A round body: flat side tone, riso shading toward the dark right, ink outline. */
const rounded = (d, tones, fill = tones[1]) => [el('path', { d, fill }), shade(d, { x1: 0, y1: 0, x2: 1, y2: 0, from: 0, to: 0.34 }), mark(d, 3.5)];

/** The visible part of a surface (water, coffee) sitting `drop` px below a rim of screen radius
 *  rx centered at screen y = cy: the surface's far arc, closed by the rim's near arc. */
function lens(cy, rx, drop) {
  const ry = rx * K;
  const yi = cy + drop / 2;
  const xi = rx * Math.sqrt(Math.max(0, 1 - (drop / 2 / ry) ** 2));
  return `M ${f(-xi)} ${f(yi)} A ${f(rx)} ${f(ry)} 0 0 1 ${f(xi)} ${f(yi)} A ${f(rx)} ${f(ry)} 0 0 1 ${f(-xi)} ${f(yi)} Z`;
}

/** A soft slab (a pillow): a rounded rect on the horizontal plane at z, raised h. Its side is the
 *  hull of the bottom and top outlines; the top sits on it. */
function cushion(x, y, z, w, d, h, tones, r = 14) {
  const ring = [];
  const corners = [[w - r, r, -90], [w - r, d - r, 0], [r, d - r, 90], [r, r, 180]];
  for (const [cu, cv, a0] of corners) for (let a = a0; a <= a0 + 90; a += 15) {
    const t = (a * Math.PI) / 180;
    ring.push([x + cu + r * Math.cos(t), y + cv + r * Math.sin(t)]);
  }
  const lo = ring.map(([u, v]) => P0(u, v, z));
  const hi = ring.map(([u, v]) => P0(u, v, z + h));
  const path = (list) => `M ${list.map((p) => p.map(f).join(' ')).join(' L ')} Z`;
  return [shape(path(hull([...lo, ...hi])), tones[1]), shape(path(hi), tones[0])];
}

/** Convex hull of screen points (monotone chain). */
function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

/** A leaning bar (a ladder rail) from world point a to b, both in the plane x = a[0]: wx wide
 *  along x, tn thick toward the viewer. Draws its front face, outer side and top end. */
function bar(a, b, wx, tn, tones) {
  const [dy, dz] = [b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(dy, dz);
  const n = dz >= 0 ? [dz / len, -dy / len] : [-dz / len, dy / len];
  const off = (p, sx, sn) => [p[0] + sx, p[1] + n[0] * sn, p[2] + n[1] * sn];
  return [
    quad([off(a, 0, tn), off(a, wx, tn), off(b, wx, tn), off(b, 0, tn)], tones[1]),
    quad([off(a, wx, 0), off(a, wx, tn), off(b, wx, tn), off(b, wx, 0)], tones[2]),
    quad([off(b, 0, 0), off(b, wx, 0), off(b, wx, tn), off(b, 0, tn)], tones[0]),
  ];
}

/** Riso grain over a screen polygon given as 'x,y x,y ...' (the open box's inner wall). */
const stipple = (points) => shade(`M ${points.replace(/ /g, ' L ').replace(/,/g, ' ')} Z`, { x1: 0, y1: 0, x2: 0, y2: 1, from: 0.05, to: 0.3 });

/** Tones of a darker paper (a blanket, a book cover). */
const SHADE = [T['paper-shade'], T['paper-dark'], T['paper-dark']];

// ── Batch A ───────────────────────────────────────────────────────────────────────────────
export const BATCH_A = {
  // A table lamp: a drum base, a thin pole and a cone shade. On: the shade's mouth glows and
  // rays and a pool of light fall below it.
  lamp: {
    states: ['off', 'on'],
    size: [210, 270],
    draw: ({ state, focal }) => {
      const on = state === 'on';
      const t = accent(focal);
      const parts = [];
      if (on) parts.push(el('ellipse', { cx: 0, cy: 0, rx: 116, ry: 42, fill: T['paper-lit'], opacity: 0.85 }));
      parts.push(shadow(0, 6, 72, 28));
      parts.push(...rounded(revolve([[0, 54], [12, 54], [16, 44], [18, 44]]), TONES.paper));
      parts.push(disc(0, -18, RX(44), T['paper-lit']));
      parts.push(...rounded(revolve([[18, 6], [140, 6]]), TONES.ink));
      // the shade, then its open top (lit inside when on)
      parts.push(...rounded(revolve([[128, 82], [236, 46]]), t));
      parts.push(disc(0, -236, RX(46), on ? (focal ? T['orange-lit'] : T['paper-lit']) : t[2]));
      parts.push(ink(frontArc(140, RX(78)), 2.5, 0.45));
      if (on) {
        const [rx, ry] = [RX(82), RX(82) * K];
        for (const deg of [12, 48, 132, 168]) {
          const a = (deg * Math.PI) / 180;
          const [px, py] = [rx * Math.cos(a), -128 + ry * Math.sin(a)];
          const [dx, dy] = [Math.cos(a), Math.sin(a) + 0.7];
          const k = Math.hypot(dx, dy);
          parts.push(mark(`M ${f(px + (dx / k) * 14)} ${f(py + (dy / k) * 14)} L ${f(px + (dx / k) * 44)} ${f(py + (dy / k) * 44)}`, 4));
        }
      }
      return parts;
    },
  },

  // A panelled door in its frame. Open: it swings out toward the viewer on its hinges and the
  // doorway behind is dark.
  door: {
    states: ['closed', 'open'],
    size: [240, 280],
    draw: ({ state, focal }) => {
      const W = 112;
      const H = 220;
      const fw = 14;
      const L = -W / 2;
      const R = W / 2;
      const slab = accent(focal);
      // panels, hinges and knob, drawn flat on the slab's face (u across, v down). mirror: the
      // knob is at u small (the open door's free edge is nearest the viewer).
      const art = (mirror) => {
        const u = (v) => (mirror ? W - v : v);
        const knobU = u(W - 16);
        return [
          el('rect', { x: 16, y: 18, width: W - 32, height: 78, rx: 3, fill: 'none', stroke: T.ink, 'stroke-width': 3 }),
          el('rect', { x: 16, y: 112, width: W - 32, height: 88, rx: 3, fill: 'none', stroke: T.ink, 'stroke-width': 3 }),
          el('rect', { x: 22, y: 24, width: W - 44, height: 66, rx: 2, fill: 'none', stroke: T.ink, 'stroke-width': 2, opacity: 0.4 }),
          el('rect', { x: 22, y: 118, width: W - 44, height: 76, rx: 2, fill: 'none', stroke: T.ink, 'stroke-width': 2, opacity: 0.4 }),
          el('rect', { x: u(0) - (mirror ? 6 : 0), y: 26, width: 6, height: 20, fill: T.ink }),
          el('rect', { x: u(0) - (mirror ? 6 : 0), y: 174, width: 6, height: 20, fill: T.ink }),
          el('rect', { x: knobU - 6, y: 96, width: 12, height: 30, rx: 5, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 2.5 }),
          el('circle', { cx: knobU, cy: 106, r: 7, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 3 }),
        ];
      };
      const parts = [shadow(state === 'open' ? -30 : 0, 4, 110, 28)];
      if (state === 'open') {
        parts.push(quad([[L, 0, 0], [R, 0, 0], [R, 0, H], [L, 0, H]], T['ink-lit'], 0));
        parts.push(mark(`M ${pts([[L, 0, 0]]).replace(',', ' ')} L ${pts([[R, 0, 0]]).replace(',', ' ')}`, 3, 0.6));
      }
      parts.push(box(L - fw, -10, 0, fw, 20, H));
      if (state === 'closed') {
        parts.push(box(L, -4, 0, W, 8, H, slab));
        parts.push(face('front', L, 4, H, art(false)));
      } else {
        parts.push(box(L, 4, 0, 8, W, H, slab));
        parts.push(face('side', L + 8, 4 + W, H, art(true)));
      }
      parts.push(box(R, -10, 0, fw, 20, H));
      parts.push(box(L - fw, -10, H, W + 2 * fw, 20, fw));
      return parts;
    },
  },

  // A four-legged table; the top is the accent.
  table: {
    states: ['default'],
    size: [264, 240],
    draw: ({ focal }) => {
      const [w, d, h, o] = [184, 112, 124, 40];
      const [x0, y0] = [-w / 2 - o, -d / 2 - o];
      const [x1, y1] = [x0 + w, y0 + d];
      const leg = (x, y) => box(x, y, 0, 13, 13, h - 14);
      return [
        shadow(0, -36, 132, 62),
        leg(x0 + 10, y0 + 10),
        leg(x1 - 23, y0 + 10),
        // apron under the top, behind the front legs
        box(x0 + 12, y1 - 22, h - 34, w - 24, 8, 20),
        box(x1 - 22, y0 + 12, h - 34, 8, d - 24, 20),
        leg(x0 + 10, y1 - 23),
        leg(x1 - 23, y1 - 23),
        box(x0, y0, h - 14, w, d, 14, accent(focal)),
        top(x0, y0, h, ink(`M 20 30 L ${w - 50} 30 M 40 58 L ${w - 20} 58 M 16 84 L ${w - 80} 84`, 2, 0.25)),
      ];
    },
  },

  // A bookcase: an open-fronted case with books on three shelves.
  shelf: {
    states: ['default'],
    size: [220, 335],
    draw: ({ focal }) => {
      const [W, D, H, t, o] = [172, 50, 252, 10, 22];
      const [x0, y0] = [-W / 2 - o, -D / 2 - o];
      const [x1, y1] = [x0 + W, y0 + D];
      const c = accent(focal);
      const levels = [16, 94, 172];
      // books per shelf: [width, height, tones, lying?]
      const rows = [
        [[16, 58, TONES.paper], [12, 52, SHADE], [18, 62, TONES.ink], [14, 56, TONES.paper], [20, 50, SHADE], [12, 60, TONES.paper], [16, 54, SHADE]],
        [[14, 60, SHADE], [18, 62, TONES.paper], [12, 54, TONES.ink], [16, 58, TONES.paper], [-1], [62, 10, SHADE, 1], [62, 10, TONES.paper, 1], [62, 10, TONES.ink, 1]],
        [[18, 56, SHADE], [14, 62, TONES.paper], [16, 52, TONES.ink], [12, 58, TONES.paper], [18, 60, SHADE], [14, 54, TONES.paper]],
      ];
      const parts = [shadow(0, -20, 110, 50)];
      parts.push(box(x0 + t, y0, 0, W - 2 * t, 6, H - t, c));
      parts.push(box(x0, y0, 0, t, D, H - t, c));
      levels.forEach((z, i) => {
        parts.push(box(x0 + t, y0, z - t, W - 2 * t, D, t, c));
        let x = x0 + t + 4;
        let zs = z;
        for (const [bw, bh, tones, lying] of rows[i]) {
          if (bw < 0) {
            x += 8;
            continue;
          }
          if (lying) {
            parts.push(box(x, y1 - 42, zs, bw, 34, bh, tones));
            zs += bh;
            continue;
          }
          parts.push(box(x, y1 - 42, z, bw, 34, bh, tones));
          parts.push(face('front', x, y1 - 8, z + bh, ink(`M 2 9 L ${bw - 2} 9 M 2 ${bh - 10} L ${bw - 2} ${bh - 10}`, 1.8, tones === TONES.ink ? 0 : 0.5)));
          x += bw;
        }
      });
      parts.push(box(x1 - t, y0, 0, t, D, H - t, c));
      parts.push(box(x0 - 3, y0, H - t, W + 6, D + 3, t, c));
      return parts;
    },
  },

  // A bed: a dark frame and headboard, a mattress, a pillow, and a blanket with a turned-down
  // sheet. The blanket is the accent.
  bed: {
    states: ['default'],
    size: [300, 285],
    draw: ({ focal }) => {
      const [L, Wd, o] = [204, 126, 48];
      const [x0, y0] = [-L / 2 - o, -Wd / 2 - o];
      const [x1, y1] = [x0 + L, y0 + Wd];
      const frame = SHADE;
      const xb = x0 + 96;
      const zt = 74;
      const blanket = accent(focal, SHADE);
      return [
        shadow(0, -40, 150, 66),
        box(x0, y0 - 4, 0, 14, Wd + 8, 150, frame),
        face('side', x0 + 14, y1 + 4, 140, [
          el('rect', { x: 14, y: 0, width: Wd - 20, height: 46, rx: 4, fill: 'none', stroke: T.ink, 'stroke-width': 2.5, opacity: 0.55 }),
        ]),
        box(x1 - 14, y1 - 14, 0, 12, 12, 18, frame),
        box(x0 + 14, y0, 14, L - 16, Wd, 30, frame),
        box(x0 + 18, y0 + 4, 44, L - 24, Wd - 8, zt - 44, TONES.paper),
        ink(`M ${pts([[x0 + 18, y1 - 4, 58]]).replace(',', ' ')} L ${pts([[xb, y1 - 4, 58]]).replace(',', ' ')}`, 2, 0.35),
        ...cushion(x0 + 26, y0 + 14, zt, 56, Wd - 28, 16, TONES.paper),
        top(x0 + 26, y0 + 14, zt + 16, ink(`M 5 5 L 13 13 M 51 5 L 43 13 M 5 ${Wd - 33} L 13 ${Wd - 41} M 51 ${Wd - 33} L 43 ${Wd - 41}`, 2.5, 0.5)),
        // the blanket drapes over the side and foot; its head end is a turned-down sheet
        box(xb, y0 + 1, 34, x1 - 2 - xb, Wd - 2, zt + 4 - 34, blanket),
        top(xb, y0 + 1, zt + 4, el('rect', { x: 0, y: 0, width: 22, height: Wd - 2, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 3 })),
        face('front', xb, y1 - 1, zt + 4, el('rect', { x: 0, y: 0, width: 22, height: zt + 4 - 34, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 3 })),
        top(xb + 22, y0 + 1, zt + 4, ink(`M 36 0 L 36 ${Wd - 2} M 72 0 L 72 ${Wd - 2}`, 2.5, 0.35)),
        face('front', xb + 22, y1 - 1, zt + 4, ink(`M 36 0 L 36 ${zt - 30} M 72 0 L 72 ${zt - 30}`, 2.5, 0.35)),
      ];
    },
  },

  // A cardboard box: taped shut with "this way up" arrows, or open with its flaps folded out.
  box: {
    states: ['closed', 'open'],
    size: [300, 255],
    draw: ({ state, focal }) => {
      const [S, H, o] = [124, 104, 26];
      const [x0, y0] = [-S / 2 - o, -S / 2 - o];
      const [x1, y1] = [x0 + S, y0 + S];
      const c = accent(focal);
      const parts = [shadow(0, -22, 112, 56)];
      if (state === 'closed') {
        const ym = y0 + S / 2;
        parts.push(box(x0, y0, 0, S, S, H, c));
        parts.push(top(x0, ym - 11, H, [el('rect', { x: 0, y: 0, width: S, height: 22, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 2.5 }), ink(`M 0 11 L ${S} 11`, 2, 0.5)]));
        parts.push(face('side', x1, ym + 11, H, el('rect', { x: 0, y: 0, width: 22, height: 34, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 2.5 })));
        parts.push(face('front', x0, y1, H, ink('M 40 52 L 40 26 M 32 34 L 40 24 L 48 34 M 64 52 L 64 26 M 56 34 L 64 24 L 72 34 M 30 62 L 74 62', 3.5)));
        return parts;
      }
      const fl = S * 0.42;
      const up = [Math.cos(Math.PI / 3) * fl, Math.sin(Math.PI / 3) * fl];
      const out = [Math.cos(Math.PI / 9) * fl, Math.sin(Math.PI / 9) * fl];
      // far flaps stand up and back; their inner faces show
      parts.push(quad([[x0, y0, H], [x1, y0, H], [x1, y0 - up[0], H + up[1]], [x0, y0 - up[0], H + up[1]]], c[1]));
      parts.push(quad([[x0, y0, H], [x0, y1, H], [x0 - up[0], y1, H + up[1]], [x0 - up[0], y0, H + up[1]]], c[2]));
      parts.push(box(x0, y0, 0, S, S, H, c));
      // inside: the far walls' inner faces and a glimpse of the floor
      const A = P0(x0, y0, H);
      const B = P0(x1, y0, H);
      const C = P0(x1, y1, H);
      const D = P0(x0, y1, H);
      const A2 = P0(x0, y0, 8);
      const k = Math.max(0, (C[1] - A2[1]) / (C[1] - A[1]));
      const E = [C[0] + (B[0] - C[0]) * k, C[1] + (B[1] - C[1]) * k];
      const F = [C[0] + (D[0] - C[0]) * k, C[1] + (D[1] - C[1]) * k];
      const P = (list) => list.map((p) => p.map(f).join(',')).join(' ');
      parts.push(el('polygon', { points: P([A, B, E, A2]), fill: c[1] }));
      parts.push(el('polygon', { points: P([A, D, F, A2]), fill: c[2] }));
      parts.push(el('polygon', { points: P([A2, E, C, F]), fill: T.ink, opacity: 0.55 }));
      parts.push(stipple(P([A, B, E, A2])));
      parts.push(ink(`M ${f(A[0])} ${f(A[1])} L ${f(A2[0])} ${f(A2[1])} L ${f(E[0])} ${f(E[1])} M ${f(A2[0])} ${f(A2[1])} L ${f(F[0])} ${f(F[1])}`, 2.5, 0.7));
      parts.push(el('polygon', { points: P([A, B, C, D]), fill: 'none', stroke: line(), 'stroke-width': 3.5, 'stroke-linejoin': 'round' }));
      // near flaps fold out and a little up; their tops show
      parts.push(quad([[x1, y0, H], [x1, y1, H], [x1 + out[0], y1, H + out[1]], [x1 + out[0], y0, H + out[1]]], c[0]));
      parts.push(quad([[x0, y1, H], [x1, y1, H], [x1, y1 + out[0], H + out[1]], [x0, y1 + out[0], H + out[1]]], c[0]));
      return parts;
    },
  },

  // A metal pail: tapered sides, a rolled rim, a wire bail handle with a grip. Full: water just
  // under the rim.
  bucket: {
    states: ['empty', 'full'],
    size: [170, 200],
    draw: ({ state, focal }) => {
      const t = accent(focal);
      const [rb, rt, H] = [46, 62, 124];
      const rxt = RX(rt);
      const parts = [shadow(0, 6, 76, 30)];
      parts.push(...rounded(revolve([[0, rb], [H, rt]]), t));
      for (const z of [38, 82]) parts.push(ink(frontArc(z, RX(rb + ((rt - rb) * z) / H)), 2.5, 0.4));
      parts.push(ink(frontArc(H - 9, RX(rt - 1)), 3, 0.8));
      if (state === 'full') {
        parts.push(disc(0, -H, rxt, T['paper-dark']));
        parts.push(el('path', { d: lens(-H, rxt - 5, 14), fill: T['paper-lit'] }));
        parts.push(ink(`M -34 ${-H + 2} q 9 -5 18 0 t 18 0 M 6 ${-H + 14} q 9 -5 18 0 t 18 0`, 2.5, 0.6));
        parts.push(disc(0, -H, rxt, 'none'));
      } else {
        parts.push(disc(0, -H, rxt, t[2]));
        parts.push(el('path', { d: lens(-H, rxt - 6, 60), fill: T.ink, opacity: 0.18 }));
      }
      // the bail: ears on the rim's sides, a wire arc and a grip at its top
      const yh = -H + 12;
      parts.push(el('path', { d: `M ${f(-rxt + 2)} ${yh} A ${f(rxt - 2)} 78 0 0 1 ${f(rxt - 2)} ${yh}`, fill: 'none', stroke: line(), 'stroke-width': 4.5 }));
      parts.push(el('rect', { x: -22, y: yh - 84, width: 44, height: 13, rx: 6, fill: T['paper-lit'], stroke: line(), 'stroke-width': 3 }));
      for (const s of [-1, 1]) parts.push(el('circle', { cx: f(s * (rxt - 2)), cy: yh, r: 6, fill: t[0], stroke: line(), 'stroke-width': 3 }));
      return parts;
    },
  },

  // A mug of coffee on a saucer, steaming. The mug is the accent.
  cup: {
    states: ['default'],
    size: [190, 180],
    draw: ({ focal }) => {
      const t = accent(focal);
      const [r0, r1, z0, z1] = [40, 44, 10, 104];
      const rx = RX(r1);
      const parts = [shadow(0, 4, 88, 30)];
      // saucer
      parts.push(...rounded(revolve([[0, 52], [10, 74]]), TONES.paper));
      parts.push(disc(0, -10, RX(74), T['paper-lit']));
      parts.push(el('ellipse', { cx: 0, cy: -10, rx: f(RX(48)), ry: f(RX(48) * K), fill: 'none', stroke: T.ink, 'stroke-width': 2, opacity: 0.4 }));
      // handle, behind the body so the body covers its ends
      const hd = `M ${f(rx - 6)} ${-z1 + 18} C ${f(rx + 46)} ${-z1 + 8}, ${f(rx + 46)} ${-z0 - 30}, ${f(rx - 8)} ${-z0 - 22}`;
      parts.push(el('path', { d: hd, fill: 'none', stroke: line(), 'stroke-width': 20, 'stroke-linecap': 'round' }));
      parts.push(el('path', { d: hd, fill: 'none', stroke: t[2], 'stroke-width': 12, 'stroke-linecap': 'round' }));
      parts.push(...rounded(revolve([[z0, r0], [z1, r1]]), t));
      parts.push(disc(0, -z1, rx, t[2]));
      parts.push(el('path', { d: lens(-z1, rx - 6, 16), fill: T['ink-lit'] }));
      parts.push(disc(0, -z1, rx, 'none'));
      // steam
      parts.push(mark(`M -20 ${-z1 - 34} c -10 -14 10 -22 0 -38 M 4 ${-z1 - 30} c -10 -14 10 -22 0 -44 M 28 ${-z1 - 34} c -10 -14 10 -22 0 -34`, 4, 0.55));
      return parts;
    },
  },

  // A glass bottle: round body, sloping shoulders, a long neck, a label and a ridged cap.
  bottle: {
    states: ['default'],
    size: [120, 260],
    draw: ({ focal }) => {
      const t = accent(focal);
      const [rb, rn] = [40, 13];
      const parts = [shadow(0, 6, 56, 24)];
      const body = revolve([[0, rb - 2], [3, rb], [128, rb], [146, rb - 6], [160, rn + 10], [176, rn + 1], [186, rn], [222, rn]]);
      parts.push(...rounded(body, t));
      // label band
      const [lx, za, zb] = [RX(rb), 30, 102];
      const label = `M ${f(-lx)} ${-zb} L ${f(-lx)} ${-za} A ${f(lx)} ${f(lx * K)} 0 0 0 ${f(lx)} ${-za} L ${f(lx)} ${-zb} A ${f(lx)} ${f(lx * K)} 0 0 1 ${f(-lx)} ${-zb} Z`;
      parts.push(el('path', { d: label, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 3, 'stroke-linejoin': 'round' }));
      parts.push(ink(`M -26 -60 L 26 -60 M -18 -46 L 18 -46`, 3, 0.55));
      parts.push(mark(body, 3.5));
      // glass highlight
      parts.push(el('path', { d: `M ${f(-lx + 12)} -112 L ${f(-lx + 12)} -134 M ${f(-lx + 12)} -16 L ${f(-lx + 12)} -22`, stroke: T['paper-lit'], 'stroke-width': 6, 'stroke-linecap': 'round', opacity: 0.8 }));
      // neck ring and cap
      parts.push(...rounded(revolve([[214, rn + 3], [222, rn + 3]]), t));
      parts.push(...rounded(revolve([[222, rn + 2], [248, rn + 2]]), TONES.ink));
      parts.push(disc(0, -248, RX(rn + 2), T['ink-lit'], 3));
      const cx = RX(rn + 2);
      parts.push(el('path', { d: [-0.6, -0.2, 0.2, 0.6].map((k) => `M ${f(k * cx)} -228 L ${f(k * cx)} -242`).join(' '), stroke: T['paper-shade'], 'stroke-width': 2, opacity: 0.6 }));
      return parts;
    },
  },

  // A round wall clock (mounted like the light switch: drawn on a wall's front face; origin is
  // the clock's bottom center on the wall). Twelve ticks, hands at ten past ten.
  clock: {
    states: ['default'],
    size: [160, 210],
    draw: ({ focal }) => {
      const R = 80;
      const depth = 14;
      const c = accent(focal, TONES.ink);
      const parts = [];
      for (let y = 0; y < depth; y += 2) parts.push(face('front', -R, y, 2 * R, el('circle', { cx: R, cy: R, r: R, fill: c[2], stroke: line(), 'stroke-width': 3.5 })));
      const at = (deg, r) => {
        const a = (deg * Math.PI) / 180;
        return [f(R + r * Math.sin(a)), f(R - r * Math.cos(a))];
      };
      const dial = [
        el('circle', { cx: R, cy: R, r: R, fill: c[0], stroke: line(), 'stroke-width': 3.5 }),
        el('circle', { cx: R, cy: R, r: R - 13, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 3 }),
      ];
      for (let i = 0; i < 12; i++) {
        const big = i % 3 === 0;
        const [ax, ay] = at(i * 30, R - 20);
        const [bx, by] = at(i * 30, big ? R - 38 : R - 28);
        dial.push(ink(`M ${ax} ${ay} L ${bx} ${by}`, big ? 6 : 3.5));
      }
      const [hx, hy] = at(305, R * 0.42);
      const [mx, my] = at(60, R * 0.62);
      dial.push(ink(`M ${R} ${R} L ${hx} ${hy}`, 8));
      dial.push(ink(`M ${R} ${R} L ${mx} ${my}`, 5));
      dial.push(el('circle', { cx: R, cy: R, r: 6, fill: T.ink }));
      parts.push(face('front', -R, depth, 2 * R, dial));
      return parts;
    },
  },

  // A hand bell: a flared bronze body with a lip, a wooden handle with a round knob.
  bell: {
    states: ['default'],
    size: [180, 280],
    draw: ({ focal }) => {
      const t = accent(focal);
      const body = revolve([[0, 66], [7, 66], [12, 59], [22, 50], [44, 44], [86, 41], [112, 39], [130, 35], [142, 27], [150, 15], [153, 0]]);
      const parts = [shadow(0, 6, 84, 30)];
      parts.push(...rounded(body, t));
      parts.push(ink(frontArc(12, RX(59)), 3, 0.8));
      parts.push(ink(frontArc(30, RX(50)), 2.5, 0.4));
      // highlight on the lit side
      parts.push(el('path', { d: 'M -38 -40 C -38 -76, -34 -110, -20 -138', fill: 'none', stroke: T['paper-lit'], 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0.85 }));
      // handle and knob
      parts.push(...rounded(revolve([[146, 16], [152, 16], [158, 11], [184, 11], [192, 14]]), SHADE));
      parts.push(el('circle', { cx: 0, cy: -208, r: f(RX(19)), fill: T['paper-shade'], stroke: line(), 'stroke-width': 3.5 }));
      parts.push(shade(`M ${f(-RX(19))} -208 A ${f(RX(19))} ${f(RX(19))} 0 1 0 ${f(RX(19))} -208 A ${f(RX(19))} ${f(RX(19))} 0 1 0 ${f(-RX(19))} -208 Z`, { x1: 0, y1: 0, x2: 1, y2: 1, from: 0, to: 0.35 }));
      return parts;
    },
  },

  // A small house: walls, a pitched roof (the accent) with a chimney, a door and windows.
  house: {
    states: ['default'],
    size: [250, 240],
    draw: ({ focal }) => {
      const [a, b, H, rise, o] = [70, 52, 104, 66, 28];
      const [x0, x1, y0, y1] = [-a - o, a - o, -b - o, b - o];
      const yc = (y0 + y1) / 2;
      const Hr = H + rise;
      const [ov, gx] = [12, 10];
      const drop = (ov * rise) / b;
      const roof = accent(focal, TONES.ink);
      const lines = focal ? T.ink : T['paper-shade'];
      const zAt = (y) => Hr - ((y - yc) * rise) / b;
      const parts = [shadow(0, -26, 120, 56)];
      // back slope, walls, gable
      parts.push(quad([[x0 - gx, yc, Hr], [x1 + gx, yc, Hr], [x1 + gx, y0 - ov, H - drop], [x0 - gx, y0 - ov, H - drop]], roof[2]));
      parts.push(box(x0, y0, 0, x1 - x0, y1 - y0, H));
      parts.push(quad([[x1, y0, H], [x1, y1, H], [x1, yc, Hr]], T['paper-dark']));
      parts.push(face('side', x1, yc + 12, Hr - 50, el('circle', { cx: 12, cy: 0, r: 11, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 3 })));
      // the gable's roof edge, then the front slope with shingle rows
      parts.push(quad([[x1 + gx, yc, Hr], [x1 + gx, y0 - ov, H - drop], [x1 + gx, y0 - ov, H - drop - 8], [x1 + gx, yc, Hr - 8]], roof[2]));
      parts.push(quad([[x1 + gx, yc, Hr], [x1 + gx, y1 + ov, H - drop], [x1 + gx, y1 + ov, H - drop - 8], [x1 + gx, yc, Hr - 8]], roof[2]));
      parts.push(quad([[x0 - gx, yc, Hr], [x1 + gx, yc, Hr], [x1 + gx, y1 + ov, H - drop], [x0 - gx, y1 + ov, H - drop]], roof[0]));
      parts.push(quad([[x0 - gx, y1 + ov, H - drop], [x1 + gx, y1 + ov, H - drop], [x1 + gx, y1 + ov, H - drop - 8], [x0 - gx, y1 + ov, H - drop - 8]], roof[1]));
      const rows = [];
      for (const k of [0.3, 0.55, 0.8]) {
        const y = yc + (y1 + ov - yc) * k;
        rows.push(`M ${pts([[x0 - gx + 4, y, zAt(y)]]).replace(',', ' ')} L ${pts([[x1 + gx - 4, y, zAt(y)]]).replace(',', ' ')}`);
      }
      parts.push(el('path', { d: rows.join(' '), stroke: lines, 'stroke-width': 2.5, opacity: 0.45, fill: 'none' }));
      // chimney through the front slope
      const [cx0, cx1, cy0, cy1] = [x0 + 22, x0 + 44, yc + 8, yc + 28];
      const zt = Hr + 18;
      parts.push(quad([[cx0, cy1, zAt(cy1)], [cx1, cy1, zAt(cy1)], [cx1, cy1, zt], [cx0, cy1, zt]], T['paper-shade']));
      parts.push(quad([[cx1, cy1, zAt(cy1)], [cx1, cy0, zAt(cy0)], [cx1, cy0, zt], [cx1, cy1, zt]], T['paper-dark']));
      parts.push(quad([[cx0, cy0, zt], [cx1, cy0, zt], [cx1, cy1, zt], [cx0, cy1, zt]], T['ink-lit']));
      // door and window on the front wall, a window on the gable side
      const win = (w, h) => [
        el('rect', { x: 0, y: 0, width: w, height: h, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 3.5 }),
        ink(`M ${w / 2} 0 L ${w / 2} ${h} M 0 ${h / 2} L ${w} ${h / 2}`, 3),
      ];
      parts.push(face('front', x0 + 22, y1, 66, [
        el('rect', { x: 0, y: 0, width: 34, height: 66, fill: T['paper-dark'], stroke: T.ink, 'stroke-width': 3.5 }),
        el('circle', { cx: 26, cy: 36, r: 3.5, fill: T.ink }),
      ]));
      parts.push(face('front', x0 + 78, y1, 76, win(40, 34)));
      parts.push(face('side', x1, y1 - 30, 76, win(46, 34)));
      return parts;
    },
  },

  // A potted plant: a flower pot with a rim (the accent), dark soil, broad pointed leaves.
  plant: {
    states: ['default'],
    size: [230, 280],
    draw: ({ focal }) => {
      const t = accent(focal);
      const zr = 90;
      const parts = [shadow(0, 6, 70, 28)];
      parts.push(...rounded(revolve([[0, 40], [72, 52], [72, 57], [zr, 57]]), t));
      parts.push(ink(frontArc(72, RX(57)), 3, 0.8));
      parts.push(disc(0, -zr, RX(57), t[0]));
      parts.push(disc(0, -zr + 2, RX(49), T['ink-lit'], 2.5));
      // leaves: [screen angle from up, length, half width, droop, fill]; back to front
      const leaves = [
        [-28, 150, 22, 10, T['paper-shade']],
        [14, 162, 22, 6, T['paper-shade']],
        [44, 140, 21, 26, T['paper-shade']],
        [-58, 128, 21, 34, T['paper-lit']],
        [-6, 172, 23, 0, T['paper-lit']],
        [30, 150, 22, 12, T['paper-lit']],
        [66, 112, 20, 44, T['paper-lit']],
        [-80, 104, 19, 46, T['paper-lit']],
      ];
      for (const [deg, len, w, droop, fill] of leaves) {
        const a = (deg * Math.PI) / 180;
        const [ux, uy] = [Math.sin(a), -Math.cos(a)];
        const [nx, ny] = [-uy, ux];
        const B = [ux * 6, -zr - 6 + uy * 6];
        const at = (s, side, wk) => [f(B[0] + ux * len * s + nx * w * wk * side), f(B[1] + uy * len * s + ny * w * wk * side + droop * s * s)];
        const tip = at(1, 0, 0);
        const d = `M ${B.join(' ')} C ${at(0.25, 1, 1.1).join(' ')}, ${at(0.7, 1, 1).join(' ')}, ${tip.join(' ')} C ${at(0.7, -1, 1).join(' ')}, ${at(0.25, -1, 1.1).join(' ')}, ${B.join(' ')} Z`;
        parts.push(shape(d, fill));
        parts.push(shade(d, { from: 0, to: 0.3 }));
        parts.push(ink(`M ${B.join(' ')} Q ${at(0.5, 0, 0).join(' ')} ${at(0.86, 0, 0).join(' ')}`, 2.5, 0.6));
      }
      return parts;
    },
  },

  // A tree: a trunk flaring at the roots, forking into a round, scalloped crown (the accent).
  tree: {
    states: ['default'],
    size: [210, 305],
    draw: ({ focal }) => {
      const c = accent(focal);
      const [cx, cy, R] = [0, -206, 92];
      const trunk = 'M -28 6 C -16 -4 -13 -24 -13 -56 L -12 -130 L 12 -130 L 13 -56 C 13 -24 16 -4 28 6 C 12 12 -12 12 -28 6 Z';
      const parts = [shadow(0, 6, 90, 28)];
      parts.push(shape(trunk, T['paper-dark']));
      parts.push(shade(trunk, { x1: 0, y1: 0, x2: 1, y2: 0, from: 0, to: 0.35 }));
      parts.push(ink('M -4 -30 L -4 -52 M 5 -70 L 5 -96 M -6 -104 L -6 -120', 2.5, 0.5));
      // branches reaching into the crown
      parts.push(shape('M -10 -120 C -24 -140 -40 -150 -52 -168 L -42 -172 C -32 -158 -20 -150 -6 -138 Z', T['paper-dark']));
      parts.push(shape('M 8 -124 C 22 -140 34 -152 44 -172 L 54 -166 C 42 -148 28 -136 12 -114 Z', T['paper-dark']));
      // the crown: a scalloped round outline
      const bumps = [1, 0.92, 1.05, 0.95, 1.02, 0.9, 1.04, 0.96, 1, 0.93, 1.03];
      const n = bumps.length;
      const p = bumps.map((k, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        return [f(cx + R * k * Math.cos(a)), f(cy + R * k * 0.96 * Math.sin(a))];
      });
      const crown = `M ${p[0].join(' ')} ` + p.map((q, i) => {
        const nq = p[(i + 1) % n];
        const r = f(Math.hypot(nq[0] - q[0], nq[1] - q[1]) * 0.6);
        return `A ${r} ${r} 0 0 1 ${nq.join(' ')}`;
      }).join(' ') + ' Z';
      parts.push(shape(crown, c[0]));
      parts.push(shade(crown, { x1: 0.2, y1: 0.1, x2: 0.9, y2: 1, from: 0, to: 0.38 }));
      // leaf clumps inside the crown
      parts.push(ink('M -44 -236 a 18 18 0 0 1 30 -8 M 10 -262 a 18 18 0 0 1 30 4 M -58 -190 a 18 18 0 0 0 24 14 M 30 -200 a 18 18 0 0 0 28 -6 M -16 -170 a 18 18 0 0 0 28 2', 3, 0.5));
      return parts;
    },
  },

  // A step ladder: two leaning front rails with rungs, rear legs with a brace, a top cap.
  ladder: {
    states: ['default'],
    size: [200, 300],
    draw: ({ focal }) => {
      const c = accent(focal);
      const [xs, ys] = [-22, 20];
      const [xl, xr, w] = [-38 + xs, 30 + xs, 8];
      const [yf, yt, yb, zt] = [34 + ys, -36 + ys, -104 + ys, 236];
      const parts = [shadow(-12, 2, 96, 34)];
      // rear legs and their brace
      parts.push(...bar([xl, yb, 0], [xl, yt - 6, zt], w, 7, c));
      parts.push(box(xl + w, yb + 34, 68, xr - xl - w, 8, 7, c));
      parts.push(...bar([xr, yb, 0], [xr, yt - 6, zt], w, 7, c));
      // front rails with rungs between them
      parts.push(...bar([xl, yf, 0], [xl, yt, zt], w, 8, c));
      for (let i = 1; i <= 5; i++) {
        const z = (i * zt) / 6.1;
        const y = yf + ((yt - yf) * z) / zt;
        parts.push(box(xl + w, y - 6, z - 3, xr - xl - w, 16, 7, c));
      }
      parts.push(...bar([xr, yf, 0], [xr, yt, zt], w, 8, c));
      parts.push(box(xl - 3, yt - 16, zt, xr - xl + w + 6, 26, 10, c));
      return parts;
    },
  },
};

