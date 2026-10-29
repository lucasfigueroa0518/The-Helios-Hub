// UI spacing: neighbours never closer than MIN_GAP (4.3 visual fixes, 2026-10-28). An icon, a number
// and a button side by side never touch: lay them out with row() / column(), which keep at least
// MIN_GAP px between neighbours and shrink nothing silently (a row too wide for its width says so).
//
//   const r = row([{ w: 64 }, { w: measure('3/3', 48, 'roboto-700') }, { w: 180 }], { x: 140, y: 900, width: 800 });
//   r.at[0].x … r.at[2].x   (each item's left edge; y is the row's middle)
//
// The frame check (layout-checks.mjs uiCollisionProblems) fails a frame whose UI texts overlap each
// other or straddle an icon or button edge.

/** The least gap between UI neighbours (px). */
export const MIN_GAP = 24;

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
