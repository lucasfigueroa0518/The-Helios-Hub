// AI News Explained news kit, pure helpers (SCENES.md, RC-39 to RC-46).
// No DOM and no imports, so frames use it in the browser and tests use it in Node.
//
//   easing and time windows · edge-to-edge connectors · measured marker shapes (circle, underline,
//   arrow, cross) as point lists with their stroke length · the cord's sag · hand-speed timing ·
//   physical placement (anticipation + settle, never elastic) · camera keys · seeded randomness
//
// Every mark is built from measured boxes (D3), never hand-placed coordinates, and every mark knows
// its own length so render(t) can draw it at hand speed with a dash offset.

export const FRAME = { w: 1080, h: 1920, safe: { x0: 96, x1: 984, y0: 260, y1: 1600 } };

// ── Time ──────────────────────────────────────────────────────────────────────────────────
export const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
/** 0 before a, 1 after b, linear between. */
export const seg = (t, a, b) => (b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
/** Camera moves (brand ease-out). */
export const easeOut = (u) => 1 - Math.pow(1 - clamp(u), 3);
/** World moves (ease-in-out). */
export const easeInOut = (u) => {
  const x = clamp(u);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const lerp = (a, b, u) => a + (b - a) * u;

// ── Hand speed (SCENES.md rule 3) ─────────────────────────────────────────────────────────
export const LETTERS_PER_SECOND = 10;
export const CIRCLE_SECONDS = { min: 0.45, max: 0.7 };
export const FLICK_SECONDS = 0.08;
export const FLICK_GAP = 0.05;

/** Seconds to hand-write a note: letters and digits only, about 10 a second, never under 0.25s. */
export function writeSeconds(text) {
  const letters = String(text).replace(/[^\p{L}\p{N}]/gu, '').length;
  return Math.max(0.25, letters / LETTERS_PER_SECOND);
}

/** A circle's window: it closes on the cue word. Bigger targets take longer, within 0.45–0.7s. */
export function circleWindow(cue, perimeter = 600) {
  const d = clamp(0.45 + (perimeter - 400) / 4000, CIRCLE_SECONDS.min, CIRCLE_SECONDS.max);
  return { start: cue - d, end: cue };
}

/** An arrow: the shaft tail to head over `shaft` seconds, then the head as two quick flicks. */
export function arrowWindows(start, shaft = 0.5) {
  const a = start + shaft + FLICK_GAP;
  const b = a + FLICK_SECONDS + FLICK_GAP;
  return { shaft: [start, start + shaft], flick1: [a, a + FLICK_SECONDS], flick2: [b, b + FLICK_SECONDS], end: b + FLICK_SECONDS };
}

/** A stroke drawn at a steady hand speed in px/s (default ~1400px/s for a felt or dry-erase tip). */
export const strokeSeconds = (length, pxPerSecond = 1400) => Math.max(0.08, length / pxPerSecond);

// ── Points and paths ──────────────────────────────────────────────────────────────────────
export const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];

/** Length of a polyline. */
export function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}
export const toPath = (pts) => 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');

/** Sample a quadratic Bézier into n+1 points. */
export function quad(p0, c, p1, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, v = 1 - u;
    out.push([v * v * p0[0] + 2 * v * u * c[0] + u * u * p1[0], v * v * p0[1] + 2 * v * u * c[1] + u * u * p1[1]]);
  }
  return out;
}

/** Where the line from box b's centre toward (tx, ty) leaves b, padded by pad. */
export function edgePoint(b, tx, ty, pad = 16) {
  const [cx, cy] = center(b);
  const dx = tx - cx, dy = ty - cy;
  const s = Math.min(Math.abs((b.w / 2 + pad) / (dx || 1e-6)), Math.abs((b.h / 2 + pad) / (dy || 1e-6)));
  return [cx + dx * s, cy + dy * s];
}

// ── Marker shapes (each returns { pts, length } or a list of strokes) ─────────────────────
/** A hand-drawn ellipse around a box: starts upper-left, overshoots its start a little. */
export function ellipseAround(b, pad = 18, seed = 1) {
  const [cx, cy] = center(b);
  const r = rng(seed), wob = 0.03 + r() * 0.02, ph = r() * 3;
  // Low and wide: the height hugs the line box (so the arc never slashes the line above or below in a
  // tight headline), and the width grows until the letters are clear even at the wobble's narrowest
  // point: 85% of the box's width, and the middle 70% of its height (a line box carries leading above
  // the capitals and below the descenders).
  const ry = b.h / 2 + pad * 0.3, inner = (0.7 * b.h) / 2 / (ry * (1 - wob));
  const rx = Math.max(b.w / 2 + pad, (0.85 * b.w) / 2 / Math.sqrt(1 - inner ** 2) / (1 - wob));
  const pts = [];
  for (let i = 0; i <= 44; i++) {
    const a = -2.6 + (i / 44) * (2 * Math.PI + 0.5);
    const k = 1 + wob * Math.sin(i * 0.7 + ph);
    pts.push([cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)]);
  }
  return { pts, length: polyLength(pts) };
}

/** One quick stroke under a box's baseline (a line box ends below its descenders), slightly bowed. */
export function underlineUnder(b, { gap = 2, over = 6, bow = 6 } = {}) {
  const y = b.y + b.h * 0.86 + gap;
  const pts = quad([b.x - over, y], [b.x + b.w / 2, y + bow], [b.x + b.w + over, y - 2], 16);
  return { pts, length: polyLength(pts) };
}

/** A curved marker arrow edge to edge between two boxes; head = two flicks at the tip. */
export function arrowBetween(a, b, { pad = 16, bend = null, head = 34, spread = 0.45 } = {}) {
  const ac = center(a), bc = center(b);
  const p0 = edgePoint(a, bc[0], bc[1], pad), p1 = edgePoint(b, ac[0], ac[1], pad);
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
  const k = bend == null ? 0.18 * len : clamp(bend, -0.6 * len, 0.6 * len);
  const nx = -(p1[1] - p0[1]) / len, ny = (p1[0] - p0[0]) / len;
  const c = [(p0[0] + p1[0]) / 2 + nx * k, (p0[1] + p1[1]) / 2 + ny * k];
  const shaft = quad(p0, c, p1, 28);
  const ang = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
  const flick = (d) => [[p1[0] - head * Math.cos(ang + d), p1[1] - head * Math.sin(ang + d)], p1];
  const f1 = flick(spread), f2 = flick(-spread);
  return {
    shaft: { pts: shaft, length: polyLength(shaft) },
    flick1: { pts: f1, length: polyLength(f1) },
    flick2: { pts: f2, length: polyLength(f2) },
  };
}

/** Two fast diagonal strokes over a box. */
export function crossOver(b, pad = 10) {
  const s1 = [[b.x - pad, b.y - pad], [b.x + b.w + pad, b.y + b.h + pad]];
  const s2 = [[b.x + b.w + pad, b.y - pad], [b.x - pad, b.y + b.h + pad]];
  return [{ pts: s1, length: polyLength(s1) }, { pts: s2, length: polyLength(s2) }];
}

/** A highlighter pass: a wide band across a box, left to right. */
export function highlightBand(b, { over = 6 } = {}) {
  const y = b.y + b.h * 0.55;
  const pts = [[b.x - over, y + 1], [b.x + b.w + over, y - 1]];
  return { pts, length: polyLength(pts), width: b.h * 0.9 };
}

// ── The cord (red, slight sag between pins) ───────────────────────────────────────────────
export const CORD_SAG = 0.06;
/** Cord through pins: each span sags by CORD_SAG of its length (scaled by `taut`, 0 = slack 3×). */
export function cordPoints(pins, taut = 1) {
  const sag = CORD_SAG * (1 + 2 * (1 - clamp(taut)));
  const out = [];
  for (let i = 1; i < pins.length; i++) {
    const [px, py] = pins[i - 1], [x, y] = pins[i];
    const c = [(px + x) / 2, (py + y) / 2 + Math.hypot(x - px, y - py) * sag];
    const s = quad([px, py], c, [x, y], 20);
    out.push(...(i === 1 ? s : s.slice(1)));
  }
  return { pts: out, length: polyLength(out) };
}

/** The prefix of a polyline covering fraction u of its length (for cords unspooling, camera rides). */
export function partial(pts, u) {
  const L = polyLength(pts) * clamp(u);
  if (L <= 0) return [pts[0]];
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + d >= L) {
      const k = (L - acc) / (d || 1);
      out.push([lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)]);
      return out;
    }
    acc += d;
    out.push(pts[i]);
  }
  return out;
}
export const pointAt = (pts, u) => partial(pts, u).at(-1);

// ── Physical placement (SCENES.md rule 4) ─────────────────────────────────────────────────
/**
 * An item arriving: it travels from `from` (offset px), lifts 2–4% before contact, lands at u = 0.85,
 * then settles 1–3px. Never overshoots by more than `settle` px, never oscillates more than once.
 * Returns { x, y, scale, rot } offsets to apply on top of the item's resting transform.
 */
export function arrive(u, { from = [0, -80], lift = 0.03, settle = 2, rot = 0 } = {}) {
  const x = clamp(u);
  if (x <= 0) return { x: from[0], y: from[1], scale: 1 + lift, rot, visible: false };
  const land = 0.85;
  if (x < land) {
    const k = easeInOut(x / land);
    return { x: from[0] * (1 - k), y: from[1] * (1 - k), scale: 1 + lift * (1 - k * k), rot: rot * (1 - k), visible: true };
  }
  const s = (x - land) / (1 - land);
  return { x: 0, y: settle * Math.sin(Math.PI * s) * (1 - s), scale: 1, rot: 0, visible: true };
}

/** A pin pressed in over two frames: scale 1.25 → 1. */
export const pinPress = (u) => ({ scale: 1 + 0.25 * (1 - clamp(u)), visible: u > 0 });
/** A magnet slapped down: no flex, a short drop, then flush. */
export const magnetSlap = (u) => ({ scale: 1 + 0.18 * (1 - easeOut(u)), visible: u > 0 });
/** A tag hung on a pin: one swing that decays, never a second full oscillation. */
export const tagSwing = (u, amp = 9) => amp * Math.cos(clamp(u) * Math.PI * 1.5) * (1 - clamp(u));

// ── Camera ────────────────────────────────────────────────────────────────────────────────
/**
 * Camera keys: [{ t, x, y, scale }]. Between keys it moves with the brand ease-out; before the
 * first key and after the last it holds. x, y = the frame point brought to the centre.
 */
export function cameraAt(t, keys) {
  if (!keys?.length) return { x: FRAME.w / 2, y: FRAME.h / 2, scale: 1 };
  if (t <= keys[0].t) return pick(keys[0]);
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (t <= b.t) {
      const u = (b.ease === 'inOut' ? easeInOut : easeOut)(seg(t, a.t, b.t));
      return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), scale: lerp(a.scale, b.scale, u) };
    }
  }
  return pick(keys.at(-1));
}
const pick = (k) => ({ x: k.x, y: k.y, scale: k.scale });
/** CSS transform that brings (x, y) to the frame centre at the given scale. */
export const cameraTransform = ({ x, y, scale }) =>
  `translate(${(FRAME.w / 2 - x * scale).toFixed(2)}px, ${(FRAME.h / 2 - y * scale).toFixed(2)}px) scale(${scale.toFixed(4)})`;

// ── Seeded randomness (deterministic frames) ──────────────────────────────
export function rng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1e6) / 1e6;
  };
}

/** A torn-edge clip-path polygon, deterministic per seed. */
export function tornPolygon(seed = 1, depth = 1.8) {
  const r = rng(seed), top = [], bottom = [];
  for (let x = 0; x <= 100; x += 4 + r() * 4) top.push(`${x.toFixed(1)}% ${(r() * depth).toFixed(2)}%`);
  for (let x = 100; x >= 0; x -= 4 + r() * 4) bottom.push(`${x.toFixed(1)}% ${(100 - r() * depth).toFixed(2)}%`);
  return `polygon(${top.join(',')},100% 0.6%,99.2% 50%,100% 99%,${bottom.join(',')},0% 99%,0.7% 50%)`;
}
