// UI spacing: neighbours never closer than MIN_GAP (4.3 visual fixes, 2026-10-28). An icon, a number
// and a button side by side never touch: lay them out with row() / column(), which keep at least
// MIN_GAP px between neighbours and shrink nothing silently (a row too wide for its width says so).
//
//   const r = row([{ w: 64 }, { w: measure('3/3', 48, 'roboto-700') }, { w: 180 }], { x: 140, y: 900, width: 800 });
//   r.at[0].x … r.at[2].x   (each item's left edge; y is the row's middle)
//
// The frame check (layout-checks.mjs uiCollisionProblems) fails a frame whose UI texts overlap each
// other or straddle an icon or button edge.
//
// Text placement (2026-11-17, first-try lessons): free text never sits over an object and never
// leaves the safe area, by construction. Inside shotFrame's draw these work in the drawing's
// coordinates under the active crop shot, so what they place lands inside the safe area on screen:
//   viewSafe()                         the safe area in the drawing's coordinates for this shot
//   inSafe(box, { pad })               the box moved (never shrunk) inside it
//   placeText({ w, h }, { near, avoid }) the nearest spot to `near` clear of the `avoid` boxes (the
//                                      scene's objects) by MIN_GAP, inside the safe area

/** The least gap between UI neighbours (px). */
export const MIN_GAP = 24;
/** The safe area on screen (core.js FRAME.safe). */
export const SAFE = Object.freeze({ x0: 96, x1: 940, y0: 570, y1: 1600 });

/** The crop shot being drawn ({ on, zoom, at }: the drawing point `on` sits at screen `at`, ×zoom), or null. */
let VIEW = null;
/** Set by shotFrame (the crop it draws under), not by frames. Returns the previous. */
export function setView(view) {
  const prev = VIEW;
  VIEW = view && Number(view.zoom) > 0 ? view : null;
  return prev;
}

/** The safe area in drawing coordinates under the active crop shot (the screen's outside shotFrame). */
export function viewSafe(safe = SAFE) {
  if (!VIEW) return { ...safe };
  const { on, zoom, at } = VIEW;
  const x = (X) => on[0] + (X - at[0]) / zoom;
  const y = (Y) => on[1] + (Y - at[1]) / zoom;
  return { x0: x(safe.x0), x1: x(safe.x1), y0: y(safe.y0), y1: y(safe.y1) };
}

const asBox = (b) => (Array.isArray(b) ? { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] } : b?.box ? asBox(b.box) : b);

/**
 * `box` moved inside the safe area, never shrunk. The box is { x, y, w, h } or [x0, y0, x1, y1]; the
 * area is the view's, inset by `pad`; a box wider or taller than it is centred on it.
 * Returns { x, y, w, h, dx, dy }.
 */
export function inSafe(box, { pad = 0, safe = viewSafe() } = {}) {
  const b = asBox(box);
  const fit = (v, len, lo, hi) => (len > hi - lo ? lo + (hi - lo - len) / 2 : Math.min(Math.max(v, lo), hi - len));
  const x = fit(b.x, b.w, safe.x0 + pad, safe.x1 - pad);
  const y = fit(b.y, b.h, safe.y0 + pad, safe.y1 - pad);
  return { x, y, w: b.w, h: b.h, dx: x - b.x, dy: y - b.y };
}

/**
 * Where a free text, label, chip or small card of size { w, h } goes: nearest `near`, `gap` clear of
 * the `avoid` boxes, inside the safe area. `near` is its wished centre (default the safe area's
 * middle); `avoid` the objects on screen ([x0, y0, x1, y1], { x, y, w, h } or { box }); when no spot
 * is clear, the one crossing least. Returns { x, y, w, h, cx, cy, clear } (x, y its top-left).
 */
export function placeText(size, { near = null, avoid = [], gap = MIN_GAP, safe = viewSafe(), step = 12 } = {}) {
  const w = Math.max(0, Number(size?.w) || 0);
  const h = Math.max(0, Number(size?.h) || 0);
  const boxes = (avoid ?? []).filter(Boolean).map(asBox).filter((b) => b && b.w > 0 && b.h > 0);
  const [nx, ny] = near ?? [(safe.x0 + safe.x1) / 2, (safe.y0 + safe.y1) / 2];
  const span = (lo, hi, len) => (len > hi - lo ? [lo + (hi - lo - len) / 2, lo + (hi - lo - len) / 2] : [lo, hi - len]);
  const [xa, xb] = span(safe.x0, safe.x1, w);
  const [ya, yb] = span(safe.y0, safe.y1, h);
  const cost = (x, y) => boxes.reduce((s, b) => {
    const ix = Math.min(x + w + gap, b.x + b.w) - Math.max(x - gap, b.x);
    const iy = Math.min(y + h + gap, b.y + b.h) - Math.max(y - gap, b.y);
    return s + (ix > 0 && iy > 0 ? ix * iy : 0);
  }, 0);
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const cands = [[clamp(nx - w / 2, xa, xb), clamp(ny - h / 2, ya, yb)]];
  for (let x = xa; x <= xb + 1e-6; x += step) for (let y = ya; y <= yb + 1e-6; y += step) cands.push([x, y]);
  cands.push([xb, ya], [xa, yb], [xb, yb]);
  let best = null;
  for (const [x, y] of cands) {
    const c = cost(x, y);
    const d = Math.hypot(x + w / 2 - nx, y + h / 2 - ny);
    if (!best || c < best.c - 1e-6 || (Math.abs(c - best.c) <= 1e-6 && d < best.d)) best = { x, y, c, d };
  }
  return { x: best.x, y: best.y, w, h, cx: best.x + w / 2, cy: best.y + h / 2, clear: best.c === 0 };
}

/**
 * Items [{ w, h? }] in a row, at least MIN_GAP apart. From x, centred on y; with
 * `width`, `align` 'start' | 'center' | 'end' | 'spread' places the row inside it. Returns
 * { at: [{ x, y, w, h }], width, fits } (fits: false when the row is wider than `width`).
 */
export function row(items, o = {}) {
  const { x = 0, y = 0, gap = MIN_GAP, width = null, align = 'start' } = o;
  const gp = Math.max(MIN_GAP, gap);
  const ws = items.map((it) => Math.max(0, Number(it?.w) || 0));
  const total = ws.reduce((a, b) => a + b, 0) + gp * Math.max(0, ws.length - 1);
  const fits = width == null || total <= width + 0.5;
  let x0 = x;
  let g = gp;
  if (width != null && fits) {
    if (align === 'center') x0 = x + (width - total) / 2;
    else if (align === 'end') x0 = x + width - total;
    else if (align === 'spread' && ws.length > 1) g = (width - (total - gp * (ws.length - 1))) / (ws.length - 1);
  }
  const at = [];
  let cx = x0;
  ws.forEach((w, i) => {
    const h = Number(items[i]?.h) || 0;
    at.push({ x: cx, y: y - h / 2, w, h });
    cx += w + g;
  });
  return { at, width: total, fits };
}

/** Items [{ h, w? }] in a column, at least MIN_GAP apart. Returns { at, height }. */
export function column(items, { x = 0, y = 0, gap = MIN_GAP } = {}) {
  const gp = Math.max(MIN_GAP, gap);
  const at = [];
  let cy = y;
  for (const it of items) {
    const h = Math.max(0, Number(it?.h) || 0);
    at.push({ x, y: cy, w: Number(it?.w) || 0, h });
    cy += h + gp;
  }
  return { at, height: Math.max(0, cy - y - gp) };
}

/**
 * The y where a card of height h is clear of the things on screen. Boxes are [x0, y0, x1, y1]: the first
 * of the candidate tops (`tops`, default the upper and the lower clear zones of the safe area)
 * whose band [top, top + h] crosses none of them, else the one crossing least. Returns the y.
 */
export function clearZone(boxes, h, o = {}) {
  const { tops = [270, 1600 - 60], x0 = 104, x1 = 976 } = o;
  const cands = tops.map((t) => (t + h > 1700 ? 1700 - h : t));
  const cost = (top) => (boxes ?? []).reduce((a, b) => {
    const ix = Math.max(0, Math.min(x1, b[2]) - Math.max(x0, b[0]));
    const iy = Math.max(0, Math.min(top + h, b[3]) - Math.max(top, b[1]));
    return a + ix * iy;
  }, 0);
  let best = cands[0];
  let bc = Infinity;
  for (const c of cands) {
    const k = cost(c);
    if (k < bc) {
      bc = k;
      best = c;
    }
    if (k === 0) break;
  }
  return best;
}
