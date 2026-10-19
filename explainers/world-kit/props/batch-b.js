// Props batch B (Explainers 3.2, EX3-78): desk, post and pocket things. Built from the helpers in
// kit.js, plus three solids this batch needs (below): a convex solid from its faces, a 2D profile
// pushed along an axis (a mailbox, a phone), and a lathe, a turned solid along a world axis (a
// pencil, a pen, a push pin, a coin). They tone each face by the kit's one light and outline the
// silhouette in the ground's line color, so they sit with isoBox and isoDisc.

import { T, el, g, line, TONES, P0, box, cyl, top, face, shape, mark, shade, stippleShade, accent, accentFill, shadow } from './kit.js';
import { inkLines } from '../draw.js';

// ── Vector bits ───────────────────────────────────────────────────────────────────────────
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const mean = (ps) => mul(ps.reduce(add, [0, 0, 0]), 1 / ps.length);
const DEG = Math.PI / 180;

/** The viewer looks down the world (1, 1, 1) diagonal: a face is seen when it turns that way. */
const VIEW = unit([1, 1, 1]);
/** The kit's one light: a top lit, a 'front' face mid, a 'side' face dark (as isoBox tones them). */
const LIGHT = unit([0.2, 0.5, 1]);
const tone = (n, tones) => {
  const d = dot(n, LIGHT);
  return d > 0.85 ? tones[0] : d > 0.3 ? tones[1] : tones[2];
};

const scr = (p) => P0(p[0], p[1], p[2]);
const f1 = (v) => v.toFixed(1);
const pts2 = (ps) => ps.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ');
const pathOf = (ps, close = true) => `M ${ps.map(([x, y]) => `${f1(x)} ${f1(y)}`).join(' L ')}${close ? ' Z' : ''}`;
const outline = (ps, sw = 3.5) => el('polygon', { points: pts2(ps), fill: 'none', stroke: line(), 'stroke-width': sw, 'stroke-linejoin': 'round' });

/** A flat polygon through world points, filled and outlined. */
const wpoly = (ps, fill, sw = 3.5) => el('polygon', { points: pts2(ps.map(scr)), fill, stroke: line(), 'stroke-width': sw, 'stroke-linejoin': 'round' });
/** Detail printed or cut into a prop's own surface (seams, writing, bands, roads) stays ink on
 *  every ground; only silhouettes take the ground's line color, so on night nothing washes out. */
const INK = T.ink;
const imark = (d, sw = 3, opacity = 1) => el('path', { d, fill: 'none', stroke: INK, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity });
/** An ink detail line through world points. */
const wline = (ps, sw = 3, opacity = 1) => imark(pathOf(ps.map(scr), false), sw, opacity);
/** Shift a prop's drawing up the screen, so a flat footprint stays inside its size box. */
const lift = (dy, parts) => [g({ transform: `translate(0 ${-dy})` }, parts)];

/** Convex hull of screen points (the silhouette of a convex solid). */
function hull(ps) {
  const p = [...ps].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  const hi = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of p.reverse()) {
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop();
    hi.push(q);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/** Newell normal of a planar polygon of world points. */
function newell(ps) {
  let n = [0, 0, 0];
  ps.forEach((a, i) => {
    const b = ps[(i + 1) % ps.length];
    n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  });
  return unit(n);
}

// ── Solids ────────────────────────────────────────────────────────────────────────────────
/** A convex solid from its faces ({ pts: world points, sharp?, fill? }): every face turned to
 *  the viewer, toned by the light, then the silhouette in ink. smooth: the faces are facets of a
 *  curved surface, so only faces marked sharp keep their own outline and one grain lies over all. */
function solid(faces, tones = TONES.paper, { sw = 3.5, smooth = false, grain = true } = {}) {
  const all = faces.flatMap((f) => f.pts);
  const c = mean(all);
  const fills = [];
  const grains = [];
  const lines = [];
  for (const f of faces) {
    let n = newell(f.pts);
    if (dot(n, sub(mean(f.pts), c)) < 0) n = mul(n, -1);
    if (dot(n, VIEW) < 1e-3) continue;
    const s = f.pts.map(scr);
    const fill = f.fill ?? tone(n, tones);
    fills.push(el('polygon', { points: pts2(s), fill, stroke: fill, 'stroke-width': 1, 'stroke-linejoin': 'round' }));
    if (!smooth && grain && fill !== tones[0]) grains.push(stippleShade('polygon', { points: pts2(s) }, T.ink, { from: 0, to: 0.24, fine: true }));
    if (!smooth || f.sharp) lines.push(outline(s, sw));
  }
  const h = hull(all.map(scr));
  if (smooth && grain) grains.push(shade(pathOf(h), { from: 0, to: 0.2 }));
  lines.push(outline(h, sw));
  return [...fills, ...grains, ...lines].join('');
}

/** A 2D profile pushed along a world axis from a to b: axis 'x' takes profile points (y, z), 'y'
 *  takes (x, z), 'z' takes (x, y). The profile must be convex. */
function extrude(profile, axis, a, b, tones = TONES.paper, opts = {}) {
  const at = (p, t) => (axis === 'x' ? [t, p[0], p[1]] : axis === 'y' ? [p[0], t, p[1]] : [p[0], p[1], t]);
  const A = profile.map((p) => at(p, a));
  const B = profile.map((p) => at(p, b));
  const faces = [{ pts: A, sharp: true }, { pts: B, sharp: true }];
  profile.forEach((_, i) => {
    const j = (i + 1) % profile.length;
    faces.push({ pts: [A[i], A[j], B[j], B[i]] });
  });
  return solid(faces, tones, opts);
}

const AXES = {
  x: { a: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  y: { a: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  z: { a: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
};

/**
 * A lathe: a solid turned about a world axis through `at`. secs: [[t, r, tones?, seam?], ...]
 * with t rising along the axis (toward the viewer); a section's tones paint the segment that
 * starts there. Segments are drawn far to near, each toned by the light and outlined; a seam (the
 * visible arc of the ring) marks a change of tones, a ledge, or a section flagged seam.
 * facets: an n-sided prism (a hexagonal pencil), its edges inked.
 */
function lathe(secs, { axis = 'z', at = [0, 0, 0], n = 24, phase = 0, tones = TONES.paper, facets = false, sw = 3.5, grain = true, capFill } = {}) {
  const { a, u, v } = AXES[axis];
  const ang = (i) => phase + (2 * Math.PI * i) / n;
  const rad = (th) => add(mul(u, Math.cos(th)), mul(v, Math.sin(th)));
  const ring = (t, r) => Array.from({ length: n }, (_, i) => add(add(at, mul(a, t)), mul(rad(ang(i)), r)));
  const out = [];
  let prevTones = null;
  let prevDt = 1;
  for (let k = 0; k < secs.length - 1; k++) {
    const [tA, rA, tnA, seamA] = secs[k];
    const [tB, rB] = secs[k + 1];
    const tn = tnA ?? tones;
    const dt = tB - tA;
    const dr = rB - rA;
    if (Math.abs(dt) < 1e-9 && Math.abs(dr) < 1e-9) continue;
    const RA = ring(tA, rA);
    const RB = ring(tB, rB);
    const vis = [];
    const polys = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const nn = unit(sub(mul(rad((ang(i) + ang(i + 1)) / 2), dt), mul(a, dr)));
      vis[i] = dot(nn, VIEW) > 1e-3;
      if (!vis[i]) continue;
      const fill = tone(nn, tn);
      polys.push(el('polygon', { points: pts2([RA[i], RA[j], RB[j], RB[i]].map(scr)), fill, stroke: fill, 'stroke-width': 1, 'stroke-linejoin': 'round' }));
    }
    const seen = polys.length > 0;
    if (seen) {
      const h = hull([...RA, ...RB].map(scr));
      out.push(...polys);
      if (grain) out.push(shade(pathOf(h), { from: 0, to: 0.2 }));
      out.push(outline(h, sw));
      const seam = k > 0 && rA > 0 && (seamA || (prevTones && prevTones !== tn) || Math.abs(prevDt) < 1e-9 || Math.abs(dt) < 1e-9);
      if (seam) {
        const arcs = [];
        for (let i = 0; i < n; i++) if (vis[i]) arcs.push(`M ${pts2([scr(RA[i])])} L ${pts2([scr(RA[(i + 1) % n])])}`);
        out.push(imark(arcs.join(' ').replace(/,/g, ' '), sw * 0.8));
      }
      if (facets) {
        const edges = [];
        for (let i = 0; i < n; i++) if (vis[i] && vis[(i + n - 1) % n]) edges.push([scr(RA[i]), scr(RB[i])]);
        out.push(...edges.map((e) => imark(pathOf(e, false), sw * 0.7)));
      }
    }
    prevTones = tn;
    prevDt = dt;
  }
  // The end cap, when the last section is open and faces the viewer.
  const [tE, rE] = secs[secs.length - 1];
  if (rE > 0 && dot(a, VIEW) > 0) {
    const cap = ring(tE, rE).map(scr);
    const tn = secs[secs.length - 2][2] ?? tones;
    out.push(el('polygon', { points: pts2(cap), fill: capFill ?? tone(a, tn), stroke: line(), 'stroke-width': sw, 'stroke-linejoin': 'round' }));
  }
  return out.join('');
}

/** Points of an arc in a profile plane: center (cx, cz), radius r, from a0 to a1 degrees. */
const arc = (cx, cz, r, a0, a1, steps = 8) =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const th = (a0 + ((a1 - a0) * i) / steps) * DEG;
    return [cx + r * Math.cos(th), cz + r * Math.sin(th)];
  });

/** A rounded rectangle profile (x0..x1, z0..z1) with corner radius r. */
const roundRect = (x0, z0, x1, z1, r) => [
  ...arc(x1 - r, z0 + r, r, -90, 0, 4),
  ...arc(x1 - r, z1 - r, r, 0, 90, 4),
  ...arc(x0 + r, z1 - r, r, 90, 180, 4),
  ...arc(x0 + r, z0 + r, r, 180, 270, 4),
];

/** Lines of handwriting laid on a plane (local units), as inkLines writes them, fully written. */
const writing = (spec, height = 12, size = 3) => inkLines(spec, spec.length, { height, size, color: INK }).svg;

// Tones a few parts share.
const PAGE = [T['paper-lit'], T['paper-lit'], T['paper-shade']];
const METAL = [T['paper-lit'], T['paper-shade'], T['paper-dark']];

// ── Book ──────────────────────────────────────────────────────────────────────────────────
function closedBook(focal) {
  const W = 200;
  const D = 150;
  const H = 44;
  const ct = 6; // cover board
  const sp = 12; // spine bulge
  const x0 = -W / 2;
  const y0 = -D / 2;
  const cover = accent(focal);
  const yS = y0 + D - sp;
  const parts = [shadow(0, 14, 150, 62)];
  parts.push(box(x0, y0, 0, W, D - sp, ct, cover));
  // the page block, set in from the boards, its fore-edge ruled with page lines
  parts.push(box(x0, y0 + 6, ct, W - 8, D - sp - 6, H - 2 * ct, PAGE, { grain: false }));
  const pl = [];
  for (let vv = 5; vv < H - 2 * ct - 2; vv += 5) pl.push(`M 3 ${vv} L ${D - sp - 10} ${vv}`);
  parts.push(face('side', x0 + W - 8, yS, H - ct, imark(pl.join(' '), 1.6, 0.55)));
  parts.push(box(x0, y0, H - ct, W, D - sp, ct, cover));
  // a title panel on the front board
  parts.push(top(x0 + 46, y0 + 30, H, [
    el('rect', { x: 0, y: 0, width: 108, height: 62, rx: 4, fill: 'none', stroke: INK, 'stroke-width': 3 }),
    imark('M 16 22 L 92 22 M 16 40 L 70 40', 4, 0.6),
  ]));
  // the spine: a rounded bulge along the bound edge, with two bands and a label
  const at = (deg) => [yS + sp * Math.cos(deg * DEG), H / 2 + (H / 2) * Math.sin(deg * DEG)];
  parts.push(extrude(Array.from({ length: 11 }, (_, i) => at(-90 + 18 * i)), 'x', x0, x0 + W, cover, { smooth: true }));
  for (const d of [-62, 62]) {
    const [yy, zz] = at(d);
    parts.push(wline([[x0 + 3, yy, zz], [x0 + W - 3, yy, zz]], 3));
  }
  const [ly0, lz0] = at(-24);
  const [ly1, lz1] = at(24);
  parts.push(wpoly([[x0 + 60, ly0, lz0], [x0 + 140, ly0, lz0], [x0 + 140, ly1, lz1], [x0 + 60, ly1, lz1]], T['paper-lit'], 2.5));
  return lift(62, parts);
}

function openBook(focal) {
  const W = 140; // along the gutter (world x)
  const Dp = 96; // one page's width (world y)
  const zc = 5; // cover thickness
  const zf = (t) => zc + 2 + 22 * Math.sin(Math.PI * (1 - t) * 0.84);
  const N = 14;
  const ts = Array.from({ length: N + 1 }, (_, i) => i / N);
  const parts = [shadow(0, 10, 170, 70)];
  parts.push(box(-W / 2 - 7, -Dp - 9, 0, W + 14, 2 * Dp + 18, zc, accent(focal)));
  for (const s of [-1, 1]) {
    // the page surface: a curl rising from the outer edge and dipping into the gutter
    const far = ts.map((t) => [-W / 2, s * t * Dp, zf(t)]);
    const near = ts.map((t) => [W / 2, s * t * Dp, zf(t)]);
    parts.push(wpoly([...far, ...near.reverse()], T['paper-lit']));
    // lines of text following the curl
    const tx = [];
    for (let x = -W / 2 + 16; x <= W / 2 - 14; x += 12) {
      const pts = ts.filter((t) => t > 0.12 && t < 0.9).map((t) => [x, s * t * Dp, zf(t) + 0.5]);
      tx.push(el('path', { d: pathOf(pts.map(scr), false), fill: 'none', stroke: INK, 'stroke-width': 2.4, opacity: 0.45, 'stroke-dasharray': '16 5 9 5 22 5', 'stroke-linecap': 'round' }));
    }
    parts.push(...tx);
    // the fore-edge of the page stack, its pages drawn as curves
    const edge = ts.map((t) => [W / 2, s * t * Dp, zf(t)]);
    parts.push(wpoly([...edge, [W / 2, s * Dp, zc], [W / 2, 0, zc]], T['paper-shade'], 3));
    for (const k of [0.35, 0.65]) parts.push(wline(ts.map((t) => [W / 2, s * t * Dp, zc + (zf(t) - zc) * k]), 1.6, 0.6));
  }
  parts.push(wline([[-W / 2, 0, zf(0)], [W / 2, 0, zf(0)]], 3));
  return lift(52, parts);
}

// ── Spiral notebook ───────────────────────────────────────────────────────────────────────
/** One spiral ring hooked over an edge at world (x, y), top surface at z: a circle in the x-z
 *  plane, drawn from its hole in the cover over the edge and down behind it. */
function coil(x, y, z, r = 12, from = 9, to = 215) {
  const pts = arc(x, z - 2, r, from, to, 14).map(([px, pz]) => [px, y, pz]);
  const d = pathOf(pts.map(scr), false);
  const wire = (stroke, w, opacity = 1) => el('path', { d, fill: 'none', stroke, 'stroke-width': w, 'stroke-linecap': 'round', opacity });
  return [wire(line(), 9), wire(INK, 5.5), wire(T['paper-shade'], 2, 0.75)].join('');
}

function closedNotebook(focal) {
  const W = 140;
  const D = 184;
  const H = 14;
  const x0 = -W / 2;
  const y0 = -D / 2;
  const parts = [shadow(0, 12, 145, 62)];
  parts.push(box(x0, y0, 0, W, D, H, accent(focal)));
  // the sheets' edges on the two visible sides
  const sheetLines = (len) => imark([4.5, 7, 9.5].map((vv) => `M 3 ${vv} L ${len - 3} ${vv}`).join(' '), 1.4, 0.5);
  parts.push(face('front', x0, y0 + D, H, sheetLines(W)));
  parts.push(face('side', x0 + W, y0 + D, H, sheetLines(D)));
  // a label on the cover
  parts.push(top(x0 + 40, y0 + 46, H, [
    el('rect', { x: 0, y: 0, width: 76, height: 50, rx: 4, fill: T['paper-lit'], stroke: INK, 'stroke-width': 3 }),
    imark('M 12 18 L 62 18 M 12 33 L 46 33', 3.5, 0.6),
  ]));
  // the spiral along the bound edge
  for (let y = y0 + 12; y <= y0 + D - 10; y += 14) {
    parts.push(top(x0 + 15, y, H, el('ellipse', { cx: 0, cy: 0, rx: 3.6, ry: 3.6, fill: T.ink })));
    parts.push(coil(x0 + 3, y, H));
  }
  return lift(56, parts);
}

function openNotebook(focal) {
  const W = 108; // one page, across (world x)
  const D = 150; // page height (world y)
  const H = 8;
  const y0 = -D / 2;
  const parts = [shadow(0, 10, 160, 66)];
  // the cover under both pages, then the two page stacks either side of the spiral
  parts.push(box(-W - 14, y0 - 9, 0, 2 * W + 28, D + 18, 4, accent(focal)));
  for (const x0 of [-W - 6, 6]) {
    parts.push(box(x0, y0, 4, W, D, H, PAGE, { grain: false }));
    const ruled = [];
    for (let vv = 30; vv < D - 8; vv += 13) ruled.push(`M 8 ${vv} L ${W - 8} ${vv}`);
    parts.push(top(x0, y0, 4 + H, [
      imark(ruled.join(' '), 1.5, 0.35),
      imark(`M 8 18 L ${W - 8} 18`, 2, 0.55),
      x0 < 0 ? writing([{ u: 10, v: 27, w: W - 30, seed: 3 }, { u: 10, v: 40, w: W - 36, seed: 7 }, { u: 10, v: 53, w: W - 56, seed: 11 }], 6.5, 2) : '',
    ]));
  }
  // holes and rings across the gutter
  for (let y = y0 + 10; y <= y0 + D - 8; y += 13) {
    parts.push(top(-14, y, 4 + H, el('ellipse', { cx: 0, cy: 0, rx: 3, ry: 3, fill: T.ink })));
    parts.push(top(14, y, 4 + H, el('ellipse', { cx: 0, cy: 0, rx: 3, ry: 3, fill: T.ink })));
    parts.push(coil(0, y, 4 + H + 2, 14, -8, 188));
  }
  return lift(50, parts);
}

// ── Pencil, pen, eraser ───────────────────────────────────────────────────────────────────
function pencil(focal) {
  const r = 17; // the hexagon's corner radius; it lies on a flat facet
  const at = [0, 0, r * Math.sin(60 * DEG)];
  const parts = [shadow(-6, 22, 120, 34, 0.1)];
  // eraser and its metal ferrule (ridged), far end
  parts.push(lathe([[-184, 0], [-182, 8], [-178, 12.5], [-172, 14], [-150, 14]], { axis: 'x', at, n: 20, tones: [T['paper-shade'], T['paper-dark'], T['paper-dark']] }));
  parts.push(lathe([[-152, 16, METAL], [-146, 16, METAL, true], [-138, 16, METAL, true], [-130, 16, METAL, true], [-124, 16, METAL, true], [-120, 16]], { axis: 'x', at, n: 20 }));
  // the painted hexagonal body
  parts.push(lathe([[-120, r], [84, r]], { axis: 'x', at, n: 6, facets: true, tones: accent(focal) }));
  // the sharpened wood cone and its graphite point
  parts.push(lathe([[84, r], [132, 5.5]], { axis: 'x', at, n: 6, facets: true, tones: PAGE }));
  parts.push(lathe([[132, 5.5], [150, 0]], { axis: 'x', at, n: 12, tones: TONES.ink, grain: false }));
  // the paint's scalloped edge where the cone was cut
  const sc = [];
  for (const deg of [30, 90, -30]) {
    const a0 = (deg - 30) * DEG;
    const a1 = (deg + 30) * DEG;
    const p = (th, x) => add(at, [x, r * Math.cos(th), r * Math.sin(th)]);
    const m = (deg * DEG);
    sc.push([p(a0, 84), add(at, [100, r * 0.62 * Math.cos(m), r * 0.62 * Math.sin(m)]), p(a1, 84)]);
  }
  for (const [a, b, c] of sc) {
    const [A, B, C] = [a, b, c].map(scr);
    parts.push(el('path', { d: `M ${f1(A[0])} ${f1(A[1])} Q ${f1(B[0])} ${f1(B[1])} ${f1(C[0])} ${f1(C[1])}`, fill: 'none', stroke: INK, 'stroke-width': 2.6, 'stroke-linecap': 'round' }));
  }
  return [g({ transform: 'translate(14 -48)' }, parts)];
}

function pen(focal) {
  const at = [0, 0, 14];
  const parts = [shadow(0, 18, 120, 36, 0.1)];
  // the cap, posted on the back end, and its clip
  parts.push(lathe([[-150, 0], [-148, 8], [-144, 13.5], [-82, 13.5], [-82, 12]], { axis: 'y', at, n: 24, tones: accent(focal, TONES.ink) }));
  const zc = 14 + 13.5;
  parts.push(box(-4, -146, zc - 2, 8, 12, 6, TONES.paper, { sw: 2.5, grain: false }));
  parts.push(box(-5, -140, zc + 3, 10, 56, 4, TONES.paper, { sw: 2.5, grain: false }));
  parts.push(lathe([[-90, 6.5], [-80, 6.5]], { axis: 'y', at: [0, 0, zc + 4], n: 14, tones: TONES.paper, grain: false, sw: 2.5 }));
  // barrel, ridged grip, cone and the metal point
  parts.push(lathe([
    [-82, 12], [66, 12],
    [66, 12.8, METAL], [74, 12.8, METAL, true], [82, 12.8, METAL, true], [90, 12.8, METAL, true], [98, 12.8],
    [98, 12.8, TONES.paper, true], [126, 4], [126, 4, TONES.ink, true], [138, 1.6], [141, 0],
  ], { axis: 'y', at, n: 24 }));
  return [g({ transform: 'translate(0 -46)' }, parts)];
}

function eraser(focal) {
  const L = 170;
  const D = 70;
  const H = 42;
  const x0 = -L / 2;
  const y0 = -D / 2;
  const parts = [shadow(10, 8, 130, 52)];
  // the rubber block in three pieces, far to near: a worn far end, (under the sleeve), a
  // well-worn near end with rounded corners
  parts.push(extrude([[x0, 0], [x0 + 52, 0], [x0 + 52, H], [x0 + 7, H], [x0, H - 7]], 'y', y0, y0 + D, TONES.paper));
  // the paper sleeve round the middle
  parts.push(box(x0 + 52, y0 - 3, 0, 68, D + 6, H + 3, accent(focal, TONES.ink)));
  parts.push(face('front', x0 + 52, y0 + D + 3, H + 3, [
    el('path', { d: 'M 8 12 L 60 12 M 8 33 L 60 33', stroke: focal ? T.ink : T['paper-lit'], 'stroke-width': 2.5, fill: 'none', opacity: 0.8 }),
    el('path', { d: 'M 14 23 L 26 23 M 32 23 L 54 23', stroke: focal ? T.ink : T['paper-lit'], 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round' }),
  ]));
  parts.push(top(x0 + 52, y0 - 3, H + 3, el('path', { d: `M 20 10 L 20 ${D - 4} M 46 10 L 46 ${D - 4}`, stroke: focal ? T.ink : T['paper-lit'], 'stroke-width': 2.5, fill: 'none', opacity: 0.8 })));
  const xe = x0 + 120;
  parts.push(extrude([[xe, 0], [x0 + L - 6, 0], [x0 + L, 8], [x0 + L, H - 16], [x0 + L - 5, H - 6], [x0 + L - 16, H], [xe, H]], 'y', y0, y0 + D, TONES.paper));
  // crumbs rubbed off beside the worn end
  const crumb = (x, y, s) => {
    const [cx, cy] = P0(x, y, 0);
    return shape(`M ${cx - 7 * s} ${cy} q ${3 * s} ${-7 * s} ${9 * s} ${-5 * s} q ${7 * s} ${2 * s} ${5 * s} ${7 * s} q ${-4 * s} ${4 * s} ${-10 * s} ${2 * s} z`, T['paper-shade'], 2.5);
  };
  parts.push(crumb(x0 + L + 30, y0 + D - 6, 1.1), crumb(x0 + L + 52, y0 + 22, 0.8), crumb(x0 + L + 14, y0 + D + 22, 0.7));
  return lift(46, parts);
}

// ── Paper sheet, sticky note ──────────────────────────────────────────────────────────────
function paperSheet(focal) {
  const W = 150;
  const D = 196;
  const f = 38; // the dog-eared corner
  const x0 = -W / 2;
  const y0 = -D / 2;
  const outlineD = `M 0 0 L ${W} 0 L ${W} ${D - f} L ${W - f} ${D} L 0 ${D} Z`;
  const fill = accentFill(focal);
  const parts = [shadow(0, 10, 150, 64, 0.1)];
  // a hair of thickness, then the sheet
  parts.push(top(x0, y0, 0, el('path', { d: outlineD, fill: T['paper-dark'], stroke: line(), 'stroke-width': 3, 'stroke-linejoin': 'round' })));
  parts.push(top(x0, y0, 3, [
    el('path', { d: outlineD, fill, stroke: line(), 'stroke-width': 3.5, 'stroke-linejoin': 'round' }),
    // the handwriting: a heading, then lines of script
    writing([{ u: 16, v: 32, w: 84, seed: 2 }], 10, 3.4),
    imark('M 16 40 L 96 40', 2.5, 0.7),
    writing([
      { u: 16, v: 64, w: W - 32, seed: 5 },
      { u: 16, v: 84, w: W - 36, seed: 9 },
      { u: 16, v: 104, w: W - 28, seed: 13 },
      { u: 16, v: 124, w: W - 46, seed: 17 },
      { u: 16, v: 144, w: W - 60, seed: 21 },
      { u: 16, v: 164, w: W - 90, seed: 25 },
    ], 7, 2.2),
    // the folded-over corner, its back showing
    el('path', { d: `M ${W} ${D - f} L ${W - f} ${D} L ${W - f} ${D - f} Z`, fill: focal ? T['orange-shade'] : T['paper-shade'], stroke: line(), 'stroke-width': 3, 'stroke-linejoin': 'round' }),
  ]));
  return lift(64, parts);
}

function stickyNote(focal) {
  const S = 136;
  const H = 20;
  const c = 62; // the curl
  const x0 = -S / 2;
  const y0 = -S / 2;
  const tones = accent(focal);
  const parts = [shadow(0, 10, 125, 52)];
  parts.push(box(x0, y0, 0, S, S, H, tones));
  // the stack's sheet edges
  const edges = imark([4, 8, 12, 16].map((vv) => `M 2 ${vv} L ${S - 2} ${vv}`).join(' '), 1.4, 0.45);
  parts.push(face('front', x0, y0 + S, H, edges), face('side', x0 + S, y0 + S, H, edges));
  // the top note: its glue strip along the far edge, a line of writing, and its curled corner
  parts.push(top(x0, y0, H, [
    el('path', { d: `M 0 0 L ${S} 0 L ${S} ${S - c} L ${S - c} ${S} L 0 ${S} Z`, fill: tones[0], stroke: line(), 'stroke-width': 3.5, 'stroke-linejoin': 'round' }),
    el('rect', { x: 2, y: 2, width: S - 4, height: 24, fill: T.ink, opacity: 0.06 }),
    writing([{ u: 16, v: 50, w: S - 40, seed: 4 }, { u: 16, v: 72, w: S - 56, seed: 8 }, { u: 16, v: 94, w: S - 90, seed: 12 }], 8, 2.6),
  ]));
  const P = [x0 + S, y0 + S - c, H];
  const Q = [x0 + S - c, y0 + S, H];
  const [p, q, k, cn] = [P, Q, [x0 + S - c * 0.36, y0 + S - c * 0.36, H + 46], [x0 + S, y0 + S, H]].map(scr);
  // the corner of the next note, darkened by the curl's shadow, then the curl rolling up off it
  parts.push(el('path', { d: `M ${f1(p[0])} ${f1(p[1])} L ${f1(cn[0])} ${f1(cn[1])} L ${f1(q[0])} ${f1(q[1])} Z`, fill: tones[1], stroke: line(), 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
  parts.push(el('path', { d: `M ${f1(p[0])} ${f1(p[1])} Q ${f1(k[0])} ${f1(k[1])} ${f1(q[0])} ${f1(q[1])} Z`, fill: tones[0], stroke: INK, 'stroke-width': 3, 'stroke-linejoin': 'round' }));
  parts.push(shade(`M ${f1(p[0])} ${f1(p[1])} Q ${f1(k[0])} ${f1(k[1])} ${f1(q[0])} ${f1(q[1])} Z`, { from: 0.25, to: 0.02, x1: 0, y1: 1, x2: 0, y2: 0 }));
  return lift(46, parts);
}

// ── Envelope ──────────────────────────────────────────────────────────────────────────────
function envelope(state, focal) {
  const W = 210;
  const Hh = 136;
  const x0 = -W / 2;
  const flap = accentFill(focal);
  const parts = [shadow(10, 4, 120, 26)];
  parts.push(box(x0, -7, 0, W, 7, Hh, TONES.paper));
  const seams = imark(`M 0 ${Hh} L ${W * 0.5} ${Hh * 0.5} L ${W} ${Hh}`, 2.5, 0.75);
  const sideSeams = imark(`M 0 0 L ${W * 0.36} ${Hh * 0.62} M ${W} 0 L ${W * 0.64} ${Hh * 0.62}`, 2, 0.5);
  if (state === 'open') {
    parts.push(face('front', x0, 0, Hh, [
      // the flap folded up and back, its inside showing, then the letter peeking out
      el('path', { d: `M 0 0 L ${W / 2} ${-Hh * 0.6} L ${W} 0 Z`, fill: focal ? T['orange-shade'] : T['paper-shade'], stroke: line(), 'stroke-width': 3.5, 'stroke-linejoin': 'round' }),
      el('rect', { x: W * 0.1, y: -Hh * 0.36, width: W * 0.8, height: Hh * 0.7, fill: T['paper-lit'], stroke: line(), 'stroke-width': 3 }),
      writing([{ u: W * 0.16, v: -Hh * 0.2, w: W * 0.62, seed: 6 }, { u: W * 0.16, v: -Hh * 0.08, w: W * 0.5, seed: 10 }, { u: W * 0.16, v: Hh * 0.04, w: W * 0.4, seed: 14 }], 6.5, 2.2),
      // the pocket, cut with a shallow V
      el('path', { d: `M 0 0 L ${W / 2} ${Hh * 0.2} L ${W} 0 L ${W} ${Hh} L 0 ${Hh} Z`, fill: T['paper-lit'], stroke: line(), 'stroke-width': 3.5, 'stroke-linejoin': 'round' }),
      imark(`M 2 1 L ${W / 2} ${Hh * 0.2} L ${W - 2} 1`, 3.5),
      imark(`M 0 ${Hh} L ${W * 0.5} ${Hh * 0.52} L ${W} ${Hh}`, 2.5, 0.75),
    ]));
    return lift(28, parts);
  }
  parts.push(face('front', x0, 0, Hh, [
    el('rect', { x: 0, y: 0, width: W, height: Hh, fill: T['paper-lit'], stroke: line(), 'stroke-width': 3.5 }),
    sideSeams,
    seams,
    // the closed V flap and its round seal
    el('path', { d: `M 0 0 L ${W} 0 L ${W / 2} ${Hh * 0.62} Z`, fill: flap }),
    imark(`M 0 0 L ${W / 2} ${Hh * 0.62} L ${W} 0`, 3.5),
    el('circle', { cx: W / 2, cy: Hh * 0.56, r: 11, fill: T['paper-shade'], stroke: INK, 'stroke-width': 3 }),
  ]));
  return lift(28, parts);
}

// ── Mailbox ───────────────────────────────────────────────────────────────────────────────
function mailbox(state, focal) {
  const hp = 138; // post height
  const zb = hp + 8; // the box's floor
  const R = 38; // half width, and the radius of the rounded top
  const zw = zb + 44; // where the walls turn into the roof
  const yb = -96;
  const yf = 80; // the door end
  const parts = [shadow(0, 8, 70, 26)];
  parts.push(box(-12, -12, 0, 24, 24, hp, TONES.paper));
  parts.push(box(-24, -70, hp, 48, 130, 8, TONES.paper));
  const prof = [[-R, zb], [R, zb], ...arc(0, zw, R, 0, 180, 12)];
  parts.push(extrude(prof, 'y', yb, yf, TONES.paper, { smooth: true }));
  // the door: a slightly proud D-shaped lid with a latch tab at its crown
  const lid = prof.map(([x, z]) => [x * 1.05, zb - 1 + (z - zb) * 1.03]);
  parts.push(extrude(lid, 'y', yf, yf + 5, TONES.paper, { smooth: true }));
  parts.push(face('front', 0, yf + 5, zw + R * 1.03 + zb * 0.0 - 1, [
    el('rect', { x: -6, y: -6, width: 12, height: 16, rx: 3, fill: T['paper-shade'], stroke: INK, 'stroke-width': 3 }),
  ]));
  parts.push(wline([[-R * 0.8, yf + 5, zb + 8], [R * 0.8, yf + 5, zb + 8]], 2.5, 0.6));
  // the flag on the side: down when nothing waits, up when there is mail to collect
  const xf = R + 3;
  const yp = yb + 44;
  const zp = zb + 26;
  const fill = accentFill(focal, T.ink);
  const pl = (ps) => wpoly(ps.map(([y, z]) => [xf, y, z]), fill, 3);
  if (state === 'flag up') {
    parts.push(pl([[yp - 5, zp], [yp + 5, zp], [yp + 5, zp + 98], [yp - 5, zp + 98]]));
    parts.push(pl([[yp + 5, zp + 64], [yp + 48, zp + 64], [yp + 48, zp + 98], [yp + 5, zp + 98]]));
  } else {
    parts.push(pl([[yp, zp - 5], [yp + 96, zp - 5], [yp + 96, zp + 5], [yp, zp + 5]]));
    parts.push(pl([[yp + 64, zp + 5], [yp + 98, zp + 5], [yp + 98, zp - 34], [yp + 64, zp - 34]]));
  }
  const [rx, ry] = scr([xf, yp, zp]);
  parts.push(el('circle', { cx: rx, cy: ry, r: 6, fill: T['paper-shade'], stroke: INK, 'stroke-width': 2.5 }));
  return parts;
}

// ── Rubber stamp ──────────────────────────────────────────────────────────────────────────
function stamp(focal) {
  const parts = [shadow(0, 4, 90, 36)];
  // the print it left on the table, in front of it
  parts.push(top(56, -4, 0, g({ opacity: 0.8 }, [
    el('rect', { x: 0, y: 0, width: 66, height: 52, rx: 7, fill: 'none', stroke: line(), 'stroke-width': 4.5, 'stroke-dasharray': '30 4 18 3 40 5' }),
    mark('M 14 28 L 27 40 L 52 13', 6.5),
  ])));
  // rubber, mount, then the turned wooden handle
  parts.push(box(-42, -32, 0, 84, 64, 7, TONES.ink, { grain: false }));
  parts.push(box(-46, -36, 7, 92, 72, 26, accent(focal)));
  parts.push(lathe([
    [33, 18], [39, 18], [39, 11], [70, 9], [78, 13], [88, 22], [98, 27], [108, 26], [116, 21], [122, 13], [125, 0],
  ], { axis: 'z', n: 28 }));
  return lift(64, parts);
}

// ── Folded map ────────────────────────────────────────────────────────────────────────────
function map(focal) {
  const W = 204; // across the folds (world x)
  const D = 140;
  const N = 4;
  const pw = W / N;
  const zf = (u) => {
    const i = Math.min(N - 1, Math.floor(u / pw));
    const f = (u - i * pw) / pw;
    return 10 * (i % 2 === 0 ? f : 1 - f);
  };
  const mp = (u, v) => [u - W / 2, v - D / 2, zf(u) + 0.6];
  // a polyline in map units, resampled so it follows the folds
  const route = (ps) => {
    const out = [];
    ps.forEach((p, i) => {
      if (i === 0) return out.push(mp(...p));
      const q = ps[i - 1];
      const n = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / 4));
      for (let k = 1; k <= n; k++) out.push(mp(q[0] + ((p[0] - q[0]) * k) / n, q[1] + ((p[1] - q[1]) * k) / n));
    });
    return out.map(scr);
  };
  const stroke = (ps, sw, color, extra = {}) => el('path', { d: pathOf(route(ps), false), fill: 'none', stroke: color, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...extra });
  const parts = [shadow(0, 8, 160, 64)];
  for (let i = 0; i < N; i++) {
    const u0 = i * pw;
    const u1 = u0 + pw;
    parts.push(wpoly([mp(u0, 0), mp(u1, 0), mp(u1, D), mp(u0, D)].map(([x, y, z]) => [x, y, z - 0.6]), i % 2 === 0 ? T['paper-lit'] : T['paper-shade'], 3));
  }
  // a park, a river, roads, then the route and its two ends
  const park = route([[118, 18], [150, 14], [166, 34], [150, 52], [122, 46], [118, 18]]);
  parts.push(el('path', { d: pathOf(park), fill: T['paper-dark'], stroke: INK, 'stroke-width': 2, opacity: 0.9 }));
  parts.push(stroke([[0, 104], [40, 92], [80, 108], [120, 96], [160, 112], [204, 100]], 9, INK, { opacity: 0.35 }));
  parts.push(stroke([[0, 62], [204, 70]], 11, INK), stroke([[0, 62], [204, 70]], 5.5, T['paper-lit']));
  parts.push(stroke([[70, 0], [80, 140]], 11, INK), stroke([[70, 0], [80, 140]], 5.5, T['paper-lit']));
  parts.push(stroke([[20, 0], [24, 62]], 3, INK, { opacity: 0.6 }), stroke([[140, 66], [150, 140]], 3, INK, { opacity: 0.6 }), stroke([[100, 20], [190, 30]], 3, INK, { opacity: 0.6 }), stroke([[24, 62], [30, 130]], 3, INK, { opacity: 0.6 }));
  const path = [[30, 124], [28, 90], [76, 66], [146, 68], [174, 36]];
  parts.push(stroke(path, focal ? 7 : 5, focal ? T.orange : INK, { 'stroke-dasharray': '12 9' }));
  const [sx, sy] = scr(mp(30, 124));
  parts.push(el('circle', { cx: sx, cy: sy, r: 7, fill: INK }));
  const [ex, ey] = scr(mp(174, 36));
  parts.push(imark(`M ${ex - 11} ${ey - 7} L ${ex + 11} ${ey + 7} M ${ex + 11} ${ey - 7} L ${ex - 11} ${ey + 7}`, 6));
  // the fold creases
  for (let i = 1; i < N; i++) parts.push(wline([mp(i * pw, 0), mp(i * pw, D)], 2.5, 0.8));
  parts.push(wline(Array.from({ length: 41 }, (_, k) => mp((k * W) / 40, D / 2)), 1.6, 0.35));
  return lift(66, parts);
}

// ── Push pin ──────────────────────────────────────────────────────────────────────────────
function pin(focal) {
  const k = 1.5;
  const s = (t, r, tn, seam) => [t * k, r * k, tn, seam];
  const plastic = accent(focal);
  return [
    shadow(0, 2, 30, 12, 0.18),
    lathe([s(0, 0, METAL), s(5, 3.4, METAL), s(56, 3.4, METAL), s(56, 30, plastic), s(66, 30), s(72, 22), s(72, 13), s(110, 12), s(110, 30), s(116, 33), s(132, 33), s(138, 29)], { axis: 'z', n: 28, tones: plastic, capFill: focal ? T['orange-lit'] : T['paper-lit'] }),
  ];
}

// ── Coin ──────────────────────────────────────────────────────────────────────────────────
function coin(focal) {
  const R = 92;
  const T2 = 16;
  const tones = accent(focal);
  const parts = [shadow(10, 4, 90, 18)];
  parts.push(lathe([[-T2, R], [0, R]], { axis: 'y', at: [0, 0, R], n: 48, tones, capFill: tones[0] }));
  // reeding on the rim
  const ticks = [];
  for (let d = -110; d <= 60; d += 9) {
    const th = d * DEG;
    const p = [R * Math.cos(th), 0, R + R * Math.sin(th)];
    ticks.push([scr(p), scr(add(p, [0, -T2, 0]))]);
  }
  parts.push(...ticks.map((tk) => imark(pathOf(tk, false), 1.8, 0.55)));
  // the face: a raised rim and the mark
  parts.push(face('front', 0, 0, R, [
    el('circle', { cx: 0, cy: 0, r: R * 0.8, fill: 'none', stroke: INK, 'stroke-width': 3.5 }),
    el('circle', { cx: 0, cy: 0, r: R * 0.8 - 6, fill: 'none', stroke: INK, 'stroke-width': 1.5, opacity: 0.5 }),
    imark('M 24 -24 C 18 -38 -26 -38 -26 -15 C -26 4 26 0 26 22 C 26 44 -20 44 -28 26', 9),
    imark('M 0 -50 L 0 52', 8),
  ]));
  return parts;
}

// ── Piggy bank ────────────────────────────────────────────────────────────────────────────
function piggyBank(focal) {
  const body = accentFill(focal);
  const dark = focal ? T['orange-shade'] : T['paper-shade'];
  const parts = [shadow(0, 6, 120, 46)];
  // legs (far ones first), then the curly tail at the back
  for (const [x, y] of [[-30, -46], [30, -46], [-30, 46], [30, 46]]) parts.push(cyl(x, y, 0, 15, 52, focal ? TONES.orange : TONES.paper, { sw: 3.5 }));
  parts.push(mark('M 112 -160 c 12 -10 30 -8 30 6 c 0 12 -18 12 -18 0 c 0 -12 20 -16 30 -4', 5));
  // the far ear, behind the body: a soft triangle flopping forward
  parts.push(shape('M -64 -164 Q -80 -184 -76 -204 Q -52 -200 -34 -178 Z', dark, 3.5));
  // the body: a fat ellipse along the pig's length (world y), shaded on its underside
  const cx = 6;
  const cy = -112;
  const e = `M ${cx - 122} ${cy} A 122 84 0 1 0 ${cx + 122} ${cy} A 122 84 0 1 0 ${cx - 122} ${cy} Z`;
  parts.push(g({ transform: `rotate(-24 ${cx} ${cy})` }, [shape(e, body, 3.8), shade(e, { from: 0, to: 0.32, x1: 0.3, y1: 0.2, x2: 0.7, y2: 1 })]));
  // the coin slot along the back
  parts.push(g({ transform: `rotate(-24 ${cx + 10} ${cy - 74})` }, el('rect', { x: cx - 22, y: cy - 80, width: 64, height: 12, rx: 6, fill: T.ink })));
  // the near ear, the snout (a short turned nose with two nostrils) and the eye
  parts.push(shape('M -22 -180 Q -38 -200 -32 -222 Q -6 -216 16 -190 Q -2 -176 -22 -180 Z', dark, 3.5));
  parts.push(imark('M -16 -186 Q -26 -200 -24 -212', 2.5, 0.5));
  parts.push(lathe([[100, 30], [126, 29]], { axis: 'y', at: [0, 0, 108], n: 28, tones: focal ? TONES.orange : TONES.paper, capFill: dark }));
  parts.push(face('front', 0, 126, 108, [
    el('ellipse', { cx: -9, cy: 0, rx: 4.5, ry: 8, fill: T.ink }),
    el('ellipse', { cx: 9, cy: 0, rx: 4.5, ry: 8, fill: T.ink }),
  ]));
  parts.push(el('circle', { cx: -38, cy: -138, r: 6.5, fill: T.ink }));
  return lift(14, parts);
}

// ── Phone ─────────────────────────────────────────────────────────────────────────────────
function phone(state, focal) {
  const w = 124;
  const h = 244;
  const d = 13;
  const parts = [shadow(16, 8, 90, 24)];
  parts.push(extrude(roundRect(-w / 2, 0, w / 2, h, 20), 'y', -d, 0, accent(focal), { smooth: true }));
  // a side button
  parts.push(face('side', w / 2, -3, h - 58, el('rect', { x: 0, y: 0, width: 7, height: 34, rx: 3, fill: T['paper-dark'], stroke: INK, 'stroke-width': 2.5 })));
  const sx = 9;
  const sy = 12;
  const sw = w - 18;
  const sh = h - 24;
  const scr2 = [];
  if (state === 'on') {
    // a chat: a header with an avatar, three bubbles, a reply bar
    const bub = (x, y, bw, bh, fill, right) => [
      el('rect', { x, y, width: bw, height: bh, rx: 10, fill, stroke: INK, 'stroke-width': 2.5 }),
      el('path', { d: `M ${x + 12} ${y + bh * 0.42} L ${x + bw - 14} ${y + bh * 0.42}${bh > 34 ? ` M ${x + 12} ${y + bh * 0.72} L ${x + bw * 0.6} ${y + bh * 0.72}` : ''}`, stroke: right ? T['paper-lit'] : INK, 'stroke-width': 3, 'stroke-linecap': 'round', fill: 'none', opacity: 0.75 }),
    ];
    scr2.push(
      el('rect', { x: sx, y: sy, width: sw, height: sh, rx: 12, fill: T['paper-lit'], stroke: INK, 'stroke-width': 3 }),
      el('path', { d: `M ${sx} ${sy + 42} L ${sx + sw} ${sy + 42}`, stroke: INK, 'stroke-width': 2, opacity: 0.4 }),
      el('circle', { cx: sx + 20, cy: sy + 24, r: 9, fill: T['paper-shade'], stroke: INK, 'stroke-width': 2.5 }),
      imark(`M ${sx + 36} ${sy + 24} L ${sx + 76} ${sy + 24}`, 3.5, 0.6),
      ...bub(sx + 8, sy + 56, 70, 44, T['paper-shade'], false),
      ...bub(sx + sw - 76, sy + 110, 68, 30, T.ink, true),
      ...bub(sx + 8, sy + 150, 62, 30, T['paper-shade'], false),
      el('rect', { x: sx + 8, y: sy + sh - 30, width: sw - 16, height: 20, rx: 10, fill: 'none', stroke: INK, 'stroke-width': 2.5 }),
    );
  } else {
    // a dark glass with a glint
    scr2.push(
      el('rect', { x: sx, y: sy, width: sw, height: sh, rx: 12, fill: T.ink, stroke: INK, 'stroke-width': 3 }),
      el('path', { d: `M ${sx + 18} ${sy + 70} L ${sx + 70} ${sy + 18} M ${sx + 18} ${sy + 100} L ${sx + 92} ${sy + 26}`, stroke: T['paper-lit'], 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0.22 }),
    );
  }
  // the camera pill at the top of the glass
  scr2.push(el('rect', { x: w / 2 - 16, y: sy + 5, width: 32, height: 9, rx: 4.5, fill: state === 'on' ? T.ink : T['ink-lit'], stroke: state === 'on' ? 'none' : T['paper-shade'], 'stroke-width': 1 }));
  parts.push(face('front', -w / 2, 0, h, scr2));
  return parts;
}

// ── The batch ─────────────────────────────────────────────────────────────────────────────
export const BATCH_B = {
  book: { states: ['closed', 'open'], size: [310, 210], draw: ({ state, focal }) => (state === 'open' ? openBook(focal) : closedBook(focal)) },
  notebook: { states: ['closed', 'open'], size: [310, 200], draw: ({ state, focal }) => (state === 'open' ? openNotebook(focal) : closedNotebook(focal)) },
  pencil: { states: ['default'], size: [300, 190], draw: ({ focal }) => pencil(focal) },
  pen: { states: ['default'], size: [280, 190], draw: ({ focal }) => pen(focal) },
  eraser: { states: ['default'], size: [250, 160], draw: ({ focal }) => eraser(focal) },
  'paper sheet': { states: ['default'], size: [310, 200], draw: ({ focal }) => paperSheet(focal) },
  'sticky note': { states: ['default'], size: [240, 170], draw: ({ focal }) => stickyNote(focal) },
  envelope: { states: ['closed', 'open'], size: [210, 300], draw: ({ state, focal }) => envelope(state, focal) },
  mailbox: { states: ['flag down', 'flag up'], size: [240, 300], draw: ({ state, focal }) => mailbox(state, focal) },
  stamp: { states: ['default'], size: [240, 200], draw: ({ focal }) => stamp(focal) },
  map: { states: ['default'], size: [300, 200], draw: ({ focal }) => map(focal) },
  pin: { states: ['default'], size: [130, 240], draw: ({ focal }) => pin(focal) },
  coin: { states: ['default'], size: [190, 230], draw: ({ focal }) => coin(focal) },
  'piggy bank': { states: ['default'], size: [290, 250], draw: ({ focal }) => piggyBank(focal) },
  phone: { states: ['off', 'on'], size: [160, 290], draw: ({ state, focal }) => phone(state, focal) },
};
