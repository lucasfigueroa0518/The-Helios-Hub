// Path helpers for the drawn subjects (subjects/*.js): hand-placed points to smooth cubic paths,
// so every outline is a drawn curve through 6+ points, never a primitive (house-style § Built or
// drawn). Not part of the kit's drawing API.
const r = (v) => Math.round(v * 10) / 10;
const pt = (p) => `${r(p[0])},${r(p[1])}`;
function tang(pts, i, closed, ten) {
  const n = pts.length, p = pts[i];
  if (p[2] === 'c') return [0, 0];
  const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
  const b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
  const k = (typeof p[3] === 'number' ? p[3] : ten) / 6;
  return [(b[0] - a[0]) * k, (b[1] - a[1]) * k];
}
function seg(pts, i, j, closed, ten) {
  const a = pts[i], b = pts[j], ta = tang(pts, i, closed, ten), tb = tang(pts, j, closed, ten);
  return `C${pt([a[0] + ta[0], a[1] + ta[1]])} ${pt([b[0] - tb[0], b[1] - tb[1]])} ${pt(b)}`;
}
/** closed smooth path through the points */
export function loop(pts, ten = 1) {
  let d = `M${pt(pts[0])}`;
  for (let i = 0; i < pts.length; i++) d += ' ' + seg(pts, i, (i + 1) % pts.length, true, ten);
  return d + ' Z';
}
/** open path along the closed loop from index `from` to index `to` (wrapping): the lost-edge ink */
export function arc(pts, from, to, ten = 1) {
  const n = pts.length; let d = `M${pt(pts[from])}`, i = from, guard = 0;
  while (i !== to && guard++ < n) { const j = (i + 1) % n; d += ' ' + seg(pts, i, j, true, ten); i = j; }
  return d;
}
/** open smooth stroke through the points */
export function line(pts, ten = 1) {
  let d = `M${pt(pts[0])}`;
  for (let i = 0; i < pts.length - 1; i++) d += ' ' + seg(pts, i, i + 1, false, ten);
  return d;
}
/** a tapered outline around a centreline: widths per point (number, or [left, right]); returns
 *  the point list (use loop() for d, arc(p, 0, p.length - 1) for ink without the base) */
export function taper(center, widths, { tip = 0.9 } = {}) {
  const n = center.length, L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = center[Math.max(0, i - 1)], b = center[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const m = Math.hypot(tx, ty) || 1; tx /= m; ty /= m;
    const w = widths[i] ?? widths[widths.length - 1];
    const [wl, wr] = Array.isArray(w) ? w : [w, w];
    L.push([center[i][0] - ty * wl, center[i][1] + tx * wl]);
    R.push([center[i][0] + ty * wr, center[i][1] - tx * wr]);
  }
  const e = center[n - 1], p = center[n - 2];
  let dx = e[0] - p[0], dy = e[1] - p[1]; const m = Math.hypot(dx, dy) || 1;
  const w = widths[n - 1] ?? widths[widths.length - 1];
  const we = Array.isArray(w) ? (w[0] + w[1]) / 2 : w;
  const tipP = [e[0] + (dx / m) * we * tip, e[1] + (dy / m) * we * tip];
  return [...L, tipP, ...R.reverse()];
}
export const moved = (pts, dx, dy) => pts.map(([x, y, ...rest]) => [x + dx, y + dy, ...rest]);
/** mirror about x = 0 (a front view's other side), with a small hand jitter so it's not a stamp */
export const mirror = (pts, jit = 0) => pts.map(([x, y, ...rest], i) => [-x + (i % 2 ? jit : -jit), y + (i % 3 === 0 ? jit : 0), ...rest]).reverse();

const rr = (v) => Math.round(v * 10) / 10;

/** Smooth cubic path through points (Catmull-Rom → Bezier). closed → ends with Z. */
export function smooth(pts, closed = false, tension = 1) {
  const n = pts.length;
  const at = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${rr(pts[0][0])},${rr(pts[0][1])}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
    const c2 = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
    d += ` C${rr(c1[0])},${rr(c1[1])} ${rr(c2[0])},${rr(c2[1])} ${rr(p2[0])},${rr(p2[1])}`;
  }
  return closed ? d + ' Z' : d;
}

/** A hand-drawn "round" (a wheel, a soundhole, a rim): n points, radius wobbled by a fixed
 *  pattern, optionally flattened where it bears load (y clamped at `flat`). Never a true circle. */
export function roundish(cx, cy, r, { n = 9, wob = 0.025, seed = 1, flat = null, sx = 1 } = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed * 0.37;
    const k = 1 + wob * Math.sin(seed * 2.1 + i * 2.7);
    let p = [cx + Math.cos(a) * r * k * sx, cy + Math.sin(a) * r * k];
    if (flat != null && p[1] > flat) p = [p[0], flat];
    pts.push(p);
  }
  return smooth(pts, true);
}

/** Points along a cubic Bezier. */
export function bez(p0, p1, p2, p3, n = 8) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
  });
}

/** A tapered ribbon (a stem, a strap) along a centre line: width w0 at the start, w1 at the end.
 *  Returns { d (closed), ink (open: leaves out the start cap, the edge buried in the parent) }. */
export function ribbon(pts, w0, w1) {
  const n = pts.length;
  const L = [], Rr = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1;
    const nx = -dy / m, ny = dx / m;
    const w = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
    L.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
    Rr.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
  }
  const tip = pts[n - 1];
  const a = pts[n - 2];
  const dx = tip[0] - a[0], dy = tip[1] - a[1], m = Math.hypot(dx, dy) || 1;
  const cap = [tip[0] + (dx / m) * w1 * 0.4, tip[1] + (dy / m) * w1 * 0.4];
  const ring = [...L, cap, ...Rr.slice().reverse()];
  const d = smooth(ring, true);
  const ink = smooth([...L, cap, ...Rr.slice().reverse()], false);
  return { d, ink };
}

/** Transform every coordinate pair of an absolute-coordinate path (M/C/L/Z only). */
export function tf(d, { x = 0, y = 0, r = 0, s = 1, sx = 1, flip = false } = {}) {
  const a = (r * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  return d.replace(/(-?\d*\.?\d+),(-?\d*\.?\d+)/g, (_, X, Y) => {
    let px = +X * s * sx * (flip ? -1 : 1), py = +Y * s;
    return `${rr(px * c - py * sn + x)},${rr(px * sn + py * c + y)}`;
  });
}
