// The Explainers world kit, glass and gloss (hx-4, approved still 10, EX3-134…146): the real-tech
// beats (frames 2, 3 and 6, and frame 7 when it shows the real thing) drawn as crisp product UI on the
// paper studio ground. Frosted glass cards, glossy tiles, pills, phones, chat bubbles, routes and the
// packets that travel them, with Lucide icons vendored inline (no CDN).
//
//   glassGround()                          the soft studio light for these frames
//   phone(x, y, { w, h, title, … })        a phone, top-left at (x, y), with a chat on its screen
//   chatBubble(text, x, y, { from, … })    a chat bubble that pops in and types its words
//   glassCard(x, y, w, h, { title, … })    a frosted card with a tile, a title, a line, a state
//   glossTile(x, y, size, { icon, … })     a glossy icon tile centred on (x, y)
//   pill(text, x, y, { dot, … })           a glass label chip centred on (x, y)
//   route(points, { progress, … })         a hairline track and its lit part, through points
//   packet(points, u, { color })           a glossy capsule riding the same route at u (0..1)
//   uiIcon(name, x, y, size, { color })    a Lucide icon centred on (x, y)
//   stepTracker(steps, current, x, y, o)   frame 6's numbered rail of the anchor steps
//   glassPanel(x, y, w, h, r, o)           the frosted surface itself (cards.js builds on it)
//   routeAt(points, u, o)                  { x, y, angle } on a route, for placing things on it
//
// Every function is pure: it returns SVG (chatBubble, glassCard, pill and stepTracker return
// { svg, box } that also stringifies to the svg) from its arguments, so an animation is a progress
// argument (a packet's u, a route's progress, a card's lit, a bubble's progress, a stop's lit). Text is measured with cards.js
// textWidth(), set as <text data-k="text">, and every text-bearing component is a
// data-k="textbox" group with a data-k="shape" rect, so bounds.mjs checks it stays inside. Text a
// viewer reads is ≥ MIN_TEXT (30px) and holds 4.5:1 on its surface (frame.md V-T2); the only smaller
// text is a decorative line (data-decor, ≥ MIN_DECOR 24px) that carries no meaning.
// Glass in SVG: layered translucent fills, a top highlight, hairline borders, soft blurred shadows and
// coloured glows from the palette. Colours are read defensively (the hx-4 ramps may not be loaded).

import { T, el, g, id, isDark, W, H } from './draw.js';
import { textWidth } from './cards.js';
import * as CORE from './core.js';

// ── Small helpers ─────────────────────────────────────────────────────────────────────────
const f = (v) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);
const lerp = (a, b, u) => a + (b - a) * u;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The brand ease-out, cubic-bezier(0.16, 1, 0.3, 1): titles, UI and camera, no bounce. */
export function easeUI(x) {
  x = clamp01(x);
  if (x === 0 || x === 1) return x;
  const [x1, y1, x2, y2] = [0.16, 1, 0.3, 1];
  const bx = (t) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const by = (t) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (bx(m) < x) lo = m;
    else hi = m;
  }
  return by((lo + hi) / 2);
}

/** A short stable hash, so identical defs share one id and a frame stays a pure function. */
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** A <linearGradient> def. stops: [[offset, color, opacity?]]; dir: [x1, y1, x2, y2] (bounding box,
 *  or user space with userSpace = true). Returns { ref, def }. */
function linear(stops, dir = [0, 0, 0, 1], userSpace = false) {
  const body = stops.map(([o, c, a = 1]) => el('stop', { offset: f(o), 'stop-color': c, 'stop-opacity': f(a) })).join('');
  const [x1, y1, x2, y2] = dir.map(f);
  const key = `l${hash(`${body}|${x1},${y1},${x2},${y2}|${userSpace}`)}`;
  const gid = id(`gl-${key}`);
  return { ref: `url(#${gid})`, def: el('linearGradient', { id: gid, x1, y1, x2, y2, gradientUnits: userSpace ? 'userSpaceOnUse' : undefined }, body) };
}

/** A user-space <radialGradient> def centred on (cx, cy), radius r (ry for an ellipse). */
function radial(stops, cx, cy, r, ry = r) {
  const body = stops.map(([o, c, a = 1]) => el('stop', { offset: f(o), 'stop-color': c, 'stop-opacity': f(a) })).join('');
  const tf = ry !== r ? `translate(${f(cx)} ${f(cy)}) scale(1 ${f(ry / r)}) translate(${f(-cx)} ${f(-cy)})` : undefined;
  const gid = id(`gl-r${hash(`${body}|${f(cx)},${f(cy)},${f(r)},${f(ry)}`)}`);
  return { ref: `url(#${gid})`, def: el('radialGradient', { id: gid, gradientUnits: 'userSpaceOnUse', cx: f(cx), cy: f(cy), r: f(r), gradientTransform: tf }, body) };
}

/** A Gaussian blur filter whose region covers `box` ([x0, y0, x1, y1], user space) plus the blur. */
function blur(std, box) {
  const p = std * 3 + 2;
  const [x, y, w, h] = [box[0] - p, box[1] - p, box[2] - box[0] + p * 2, box[3] - box[1] + p * 2].map((v) => Math.round(v));
  const fid = id(`gl-b${hash(`${f(std)}|${x},${y},${w},${h}`)}`);
  return {
    ref: `url(#${fid})`,
    def: el('filter', { id: fid, filterUnits: 'userSpaceOnUse', x, y, width: w, height: h, 'color-interpolation-filters': 'sRGB' }, el('feGaussianBlur', { stdDeviation: f(std) })),
  };
}

const defs = (...ds) => el('defs', {}, ds.map((d) => d.def).join(''));

/** A rounded-rect path with per-corner radii [tl, tr, br, bl]. */
export function roundRect(x, y, w, h, r) {
  const [tl, tr, br, bl] = (Array.isArray(r) ? r : [r, r, r, r]).map((v) => clamp(v, 0, Math.min(w, h) / 2));
  return [
    `M ${f(x + tl)} ${f(y)}`,
    `H ${f(x + w - tr)}`,
    tr ? `A ${f(tr)} ${f(tr)} 0 0 1 ${f(x + w)} ${f(y + tr)}` : '',
    `V ${f(y + h - br)}`,
    br ? `A ${f(br)} ${f(br)} 0 0 1 ${f(x + w - br)} ${f(y + h)}` : '',
    `H ${f(x + bl)}`,
    bl ? `A ${f(bl)} ${f(bl)} 0 0 1 ${f(x)} ${f(y + h - bl)}` : '',
    `V ${f(y + tl)}`,
    tl ? `A ${f(tl)} ${f(tl)} 0 0 1 ${f(x + tl)} ${f(y)}` : '',
    'Z',
  ].filter(Boolean).join(' ');
}

const rAdd = (r, d) => (Array.isArray(r) ? r.map((v) => Math.max(0, v + d)) : Math.max(0, r + d));
const rMax = (r) => (Array.isArray(r) ? Math.max(...r) : r);

/** A CSS-style box shadow under a rounded rect: offset, blur (CSS px), spread, colour, opacity. */
export function boxShadow(x, y, w, h, r, { dx = 0, dy = 0, blur: b = 20, spread = 0, color = null, opacity = 0.3 } = {}) {
  if (opacity <= 0) return '';
  color = color ?? pal().shadow;
  const X = x + dx - spread;
  const Y = y + dy - spread;
  const Wd = Math.max(1, w + spread * 2);
  const Hd = Math.max(1, h + spread * 2);
  const flt = blur(b / 2, [X, Y, X + Wd, Y + Hd]);
  return defs(flt) + el('path', { d: roundRect(X, Y, Wd, Hd, Math.max(0, (Array.isArray(r) ? Math.max(...r) : r) + spread)), fill: color, 'fill-opacity': f(opacity), filter: flt.ref });
}

/** A soft coloured glow: a blurred ellipse of light (rx, ry) on (cx, cy). */
export function glowAt(cx, cy, rx, ry, color, opacity = 0.4, softness = 0.45) {
  if (opacity <= 0) return '';
  const flt = blur(Math.max(rx, ry) * softness, [cx - rx, cy - ry, cx + rx, cy + ry]);
  return defs(flt) + el('ellipse', { cx: f(cx), cy: f(cy), rx: f(rx), ry: f(ry), fill: color, 'fill-opacity': f(opacity), filter: flt.ref });
}

// ── Palette (V-T1: palette tokens and mixes of two tokens only) ───────────────────────────
// Read defensively: each hx-4 token falls back to its nearest hx-3 token, and mixes use core's
// mixHex when it is there. orange's ramp is the Helios premium tile (premium.css --premium-tile:
// orange-lit → orange/stage-red → stage-red); graphite (phone, screen, sent bubble) is the ink ramp.
const mixC = (a, b, t) => (CORE.mixHex && /^#[0-9a-f]{6}$/i.test(a) && /^#[0-9a-f]{6}$/i.test(b) ? CORE.mixHex(a, b, t) : t < 0.5 ? a : b);
const tk = (...names) => names.map((n) => T[n]).find(Boolean);

/** The colour names glass components take. */
export const GLASS_COLORS = ['orange', 'teal', 'blue', 'yellow', 'lilac', 'green', 'ink'];

/** { lit, base, shade, glow, text } for a palette colour name. */
export function ramp(name) {
  if (!GLASS_COLORS.includes(name)) throw new Error(`HX: glass colour "${name}" must be one of ${GLASS_COLORS.join(', ')} (palette only).`);
  if (name === 'orange') {
    const red = tk('stage-red', 'orange-dark');
    return { lit: tk('orange-lit', 'orange'), base: mixC(T.orange, red, 0.3), shade: red, glow: tk('stage-orange', 'orange'), text: tk('orange-text', 'orange-dark') };
  }
  if (name === 'ink') {
    const lit = mixC(tk('ink-lit', 'ink'), tk('text-secondary', 'ink-lit'), 0.35);
    return { lit, base: T.ink, shade: tk('ink-shade', 'ink'), glow: T.ink, text: T.ink };
  }
  const base = tk(name, 'status-info');
  return { lit: tk(`${name}-lit`, name, 'status-info'), base, shade: tk(`${name}-shade`, name, 'status-info'), glow: base, text: tk(`${name}-dark`, `${name}-shade`, name, 'ink') };
}

/** The neutrals the UI uses, all tokens or two-token mixes. */
function pal() {
  const paper = T.paper;
  const lit = T['paper-lit'];
  const shade = T['paper-shade'];
  const darkP = T['paper-dark'];
  const ter = T['text-tertiary'];
  const sec = T['text-secondary'];
  return {
    white: tk('canvas'),
    shadow: tk('shadow-warm', 'ink'),
    black: tk('ink-dark', 'ink-shade', 'ink'),
    screenTop: mixC(T.canvas, lit, 0.4),
    screenBottom: mixC(lit, paper, 0.45),
    reply: mixC(paper, shade, 0.3),
    dots: mixC(darkP, ter, 0.3),
    soft: mixC(sec, ter, 0.35), // ≥ 4.5:1 on the glass
    faint: mixC(ter, darkP, 0.4),
    meta: mixC(ter, darkP, 0.45),
    head: mixC(ter, darkP, 0.2),
    idle: mixC(darkP, ter, 0.15),
    groundTop: mixC(lit, paper, 0.45),
    groundMid: paper,
    groundLow: mixC(tk('paper-sweep', 'paper'), shade, 0.4),
  };
}

const INK = () => T.ink;
const WHITE = T.canvas ?? 'white';
const textMain = () => (isDark() ? T['paper-lit'] : INK());
const textSoft = () => (isDark() ? 'rgba(255,255,255,0.62)' : pal().soft);

// ── Contrast (frame.md: load-bearing text ≥ 4.5:1; large text and UI marks ≥ 3:1) ───────────
const rgbOf = (hex) => (/^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) : null);
const lumOf = (rgb) => rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
/** The WCAG contrast ratio of two hex colours (1 when either is not hex). */
export function contrast(a, b) {
  const A = rgbOf(a);
  const B = rgbOf(b);
  if (!A || !B) return 1;
  const [l1, l2] = [lumOf(A), lumOf(B)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
/** Light text on `bg` when it holds 4.5:1 there, else ink. */
export const onColor = (bg) => (contrast(T['paper-lit'], bg) >= 4.5 ? T['paper-lit'] : contrast(WHITE, bg) >= 4.5 ? WHITE : INK());

// ── Text (measured, so bounds.mjs can check it) ─────────────────────────────────────────────
const FAMILY = { 'roboto-400': 'Roboto', 'roboto-500': 'Roboto', 'roboto-700': 'Roboto', 'pragmatica-700': "'Pragmatica Extended'" };

/** Width of `text` at `size` in `face`, plus letter-spacing in em per character. */
export function measure(text, size, face = 'roboto-500', tracking = 0) {
  const s = String(text);
  return textWidth(s, size, face) + tracking * size * [...s].length;
}

/** The smallest size of text a viewer must read, in px on the 1080-wide frame (frame.md V-T2), and
 *  of a purely decorative label that carries no meaning. Every component keeps its text at or above
 *  these: text that does not fit wraps or grows its shape instead of shrinking past them. */
export const MIN_TEXT = 30;
export const MIN_DECOR = 24;
/** The step tracker's floor: its stop labels and numbers are read at a glance beside the action. */
export const TRACKER_MIN = 34;

/** The largest size ≤ want (and ≥ min, default MIN_TEXT) at which `text` fits `width`. */
export function fitSize(text, want, width, face = 'roboto-500', min = MIN_TEXT, tracking = 0) {
  const w1 = measure(text, 1, face, tracking);
  return w1 > 0 ? clamp(Math.min(want, width / w1), Math.min(min, want), want) : want;
}

/** One measured line of text: <text data-k="text">. anchor: start | middle | end. `decor` marks a
 *  decorative label (data-decor, ≥ MIN_DECOR); everything else is ≥ MIN_TEXT. */
export function label(text, x, y, size, { face = 'roboto-500', color = INK(), anchor = 'start', tracking = 0, opacity = 1, caps = false, decor = false } = {}) {
  const s = caps ? String(text).toUpperCase() : String(text);
  const [, weight] = face.split('-');
  return el(
    'text',
    {
      'data-k': 'text',
      'data-decor': decor ? 1 : undefined,
      x: f(x),
      y: f(y),
      'text-anchor': anchor === 'start' ? undefined : anchor,
      'font-size': f(size),
      'font-family': FAMILY[face],
      'font-weight': weight,
      'letter-spacing': tracking ? `${f(tracking * size)}` : undefined,
      fill: color,
      opacity: opacity < 1 ? f(clamp01(opacity)) : undefined,
    },
    esc(s),
  );
}

/** Greedy wrap by measured width. */
function wrapWords(words, width, size, face) {
  const rows = [];
  let cur = [];
  for (const w of words) {
    const next = [...cur, w];
    if (cur.length && measure(next.join(' '), size, face) > width) {
      rows.push(cur);
      cur = [w];
    } else cur = next;
  }
  if (cur.length) rows.push(cur);
  return rows;
}

/** Rows of `text` at the largest size ≤ want (≥ min) that fits `width` in `maxLines` rows; past
 *  that it stays at `min` and takes more rows. Returns { size, rows: string[] }. */
export function wrapFit(text, want, width, face = 'roboto-500', maxLines = 2, min = MIN_TEXT) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { size: want, rows: [] };
  const fits = (sz, rows) => rows.every((r) => measure(r.join(' '), sz, face) <= width + 0.5);
  for (let sz = want; sz >= min; sz -= 1) {
    const rows = wrapWords(words, width, sz, face);
    if (rows.length <= maxLines && fits(sz, rows)) return { size: sz, rows: rows.map((r) => r.join(' ')) };
  }
  return { size: min, rows: wrapWords(words, width, min, face).map((r) => r.join(' ')) };
}

/** A value that is its svg wherever a string is expected, and carries its box. */
const boxed = (svg, box) => ({ svg, box, toString: () => svg });
const svgOf = (v) => (v == null || v === false ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(svgOf).join('') : v.svg ?? String(v));

/** A pop-in about (cx, cy): scale 0.9 → 1, rise 14px, fade, on the brand ease-out. */
function pop(svg, cx, cy, appear) {
  if (appear >= 1) return svg;
  if (appear <= 0) return '';
  const e = easeUI(appear);
  const k = 0.9 + 0.1 * e;
  return g({ transform: `translate(${f(cx)} ${f(cy + (1 - e) * 14)}) scale(${f(k * 1000) / 1000}) translate(${f(-cx)} ${f(-cy)})`, opacity: f(clamp01(e * 1.4)) }, svg);
}

// ── Glass ───────────────────────────────────────────────────────────────────────────────────
/**
 * The frosted surface: a soft long shadow, a translucent white fill (top 0.74 → 0.46 on paper; the
 * premium dark glass on the stage), a hairline border, a 1px top highlight. `tint` (a colour name)
 * washes the glass with that colour at `tintLevel`; `ring` draws a 2.5px accent ring and a coloured
 * glow at `ringLevel` (a picked card). `fill` replaces the glass with a solid colour (still glossy).
 */
export function glassPanel(x, y, w, h, r = 28, { tint = null, tintLevel = 0, ring = null, ringLevel = 0, shadow = 1, fill = null, dark = isDark(), strength = 1, path = null } = {}) {
  const out = [];
  const d = path ?? roundRect(x, y, w, h, r);
  // Shadows and glows sit outside the glass only (a CSS box-shadow is never painted under its box),
  // so the translucent fill stays clean: they are masked out where the panel is.
  const under = [];
  if (ring && ringLevel > 0) {
    const R = ramp(ring);
    under.push(boxShadow(x, y, w, h, r, { blur: 50, spread: 4, color: R.glow, opacity: 0.5 * ringLevel }));
  }
  if (shadow > 0) {
    const s = clamp(h / 220, 0.25, 1.2);
    under.push(boxShadow(x, y, w, h, r, { dy: 40 * s, blur: 70 * s, spread: -36 * s, color: dark ? pal().black : pal().shadow, opacity: (dark ? 0.8 : 0.42) * shadow }));
    under.push(boxShadow(x, y, w, h, r, { dy: 2, blur: 6, color: dark ? pal().black : pal().shadow, opacity: (dark ? 0.35 : 0.07) * shadow }));
  }
  if (under.length) {
    if (fill) out.push(...under);
    else {
      const m = [x - 160, y - 160, w + 320, h + 360].map(f);
      const mid = id(`gl-k${hash(`${d}|${m}`)}`);
      out.push(
        el('mask', { id: mid, maskUnits: 'userSpaceOnUse', x: m[0], y: m[1], width: m[2], height: m[3] }, el('rect', { x: m[0], y: m[1], width: m[2], height: m[3], fill: 'white' }) + el('path', { d, fill: 'black' })),
        g({ mask: `url(#${mid})` }, under),
      );
    }
  }
  const body = fill
    ? linear([[0, fill, 1], [1, fill, 1]])
    : dark
      ? linear([[0, WHITE, 0.13 * strength], [1, WHITE, 0.05 * strength]])
      : linear([[0, WHITE, 0.76 * strength], [1, WHITE, 0.5 * strength]]);
  const ds = [body];
  out.push(el('path', { d, fill: body.ref }));
  if (tint && tintLevel > 0) {
    const R = ramp(tint);
    const tg = linear([[0, R.lit, 0.12 * tintLevel], [1, R.base, 0.24 * tintLevel]]);
    ds.push(tg);
    out.push(el('path', { d, fill: tg.ref }));
  }
  // The top highlight: a white hairline that fades out down the sides.
  const hl = linear([[0, WHITE, dark ? 0.32 : 1], [Math.min(0.5, 24 / h), WHITE, dark ? 0.12 : 0.85], [1, WHITE, dark ? 0.06 : 0.55]]);
  ds.push(hl);
  out.push(el('path', { d: path ?? roundRect(x + 0.6, y + 0.6, w - 1.2, h - 1.2, rAdd(r, -0.6)), fill: 'none', stroke: hl.ref, 'stroke-width': 1.4 }));
  if (!dark) out.push(el('path', { d, fill: 'none', stroke: INK(), 'stroke-opacity': 0.06, 'stroke-width': 1 }));
  if (ring && ringLevel > 0) {
    const R = ramp(ring);
    out.push(el('path', { d: path ?? roundRect(x - 1.25, y - 1.25, w + 2.5, h + 2.5, rAdd(r, 1.25)), fill: 'none', stroke: R.base, 'stroke-opacity': f(0.95 * ringLevel), 'stroke-width': 2.5 }));
  }
  return defs(...ds) + out.join('');
}

/**
 * A glossy solid panel in a palette colour (a sign, a focal bubble, a dark sent bubble): the colour's
 * gradient at 160°, a soft inner shade low, a specular top half, a 1px top highlight, and a drop
 * glow in the colour (a dark shadow for ink). `path` replaces the rounded rect (a bubble with a tail).
 */
export function glossPanel(x, y, w, h, r = 22, { color = 'orange', path = null, glow = true } = {}) {
  const R = ramp(color);
  const d = path ?? roundRect(x, y, w, h, r);
  const s = clamp(h / 160, 0.3, 1.2);
  const out = [];
  if (color === 'ink') out.push(boxShadow(x, y, w, h, r, { dy: 22 * s, blur: 44 * s, spread: -16 * s, color: pal().black, opacity: 0.45 }));
  else if (glow) out.push(boxShadow(x, y, w, h, r, { dy: 18 * s, blur: 40 * s, spread: -10 * s, color: R.glow, opacity: 0.5 }));
  out.push(boxShadow(x, y, w, h, r, { dy: 4 * s, blur: 10 * s, spread: -2 * s, color: color === 'ink' ? pal().black : R.shade, opacity: 0.25 }));
  const body = linear([[0, R.lit], [0.55, R.base], [1, R.shade]], [0.33, 0.03, 0.67, 0.97]);
  const low = linear([[0, R.shade, 0], [0.72, R.shade, 0], [1, R.shade, 0.35]]);
  const spec = linear([[0, WHITE, color === 'ink' ? 0.1 : 0.3], [0.5, WHITE, color === 'ink' ? 0.03 : 0.08], [1, WHITE, 0]]);
  const hl = linear([[0, WHITE, color === 'ink' ? 0.22 : 0.6], [Math.min(0.5, 20 / h), WHITE, 0.08], [1, WHITE, 0]]);
  out.push(defs(body, low, spec, hl));
  out.push(el('path', { d, fill: body.ref }), el('path', { d, fill: low.ref }));
  out.push(el('path', { d: roundRect(x + w * 0.03, y + Math.min(3, h * 0.03), w * 0.94, h * 0.48, [rMax(r) - 2, rMax(r) - 2, rMax(r) * 0.5, rMax(r) * 0.5].map((v) => Math.max(0, v))), fill: spec.ref }));
  out.push(el('path', { d, fill: 'none', stroke: hl.ref, 'stroke-width': 1.4 }));
  return out.join('');
}

/** The graphite body of a phone or a display, lit from the top left (the ink ramp). */
function graphite() {
  const I = ramp('ink');
  return linear([[0, I.lit], [0.3, I.base], [0.7, I.shade], [1, mixC(I.base, I.lit, 0.6)]], [0.21, 0.09, 0.79, 0.91]);
}

/** A dark display: a graphite bezel with a hairline, the screen inset in it, a glass sheen. */
export function screenPanel(x, y, w, h, r = 22) {
  const b = clamp(Math.min(w, h) * 0.05, 5, 12);
  const out = [];
  const s = clamp(h / 200, 0.3, 1.2);
  out.push(boxShadow(x, y, w, h, r, { dy: 30 * s, blur: 56 * s, spread: -24 * s, color: pal().shadow, opacity: isDark() ? 0.9 : 0.5 }));
  const frame = graphite();
  const rim = linear([[0, WHITE, 0.3], [0.15, WHITE, 0.12], [1, WHITE, 0.1]]);
  const glassG = linear([[0, mixC(T.ink, T['ink-lit'] ?? T.ink, 0.5)], [1, tk('ink-shade', 'ink')]]);
  const sheen = linear([[0, WHITE, 0.12], [0.36, WHITE, 0], [1, WHITE, 0]], [0.06, 0.27, 0.94, 0.73]);
  out.push(defs(frame, rim, glassG, sheen));
  out.push(el('path', { d: roundRect(x, y, w, h, r), fill: frame.ref }));
  out.push(el('path', { d: roundRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5, r - 0.75), fill: 'none', stroke: rim.ref, 'stroke-width': 1.5 }));
  out.push(el('path', { d: roundRect(x + b, y + b, w - b * 2, h - b * 2, Math.max(2, r - b)), fill: glassG.ref }));
  out.push(el('path', { d: roundRect(x + b, y + b, w - b * 2, h - b * 2, Math.max(2, r - b)), fill: sheen.ref }));
  return out.join('');
}

/** The soft studio light for the real-tech frames: the warm paper sweep, a white bloom where the
 *  UI sits, a faint warm key light top right. On the stage: the premium lit stage. Draw it first. */
export function glassGround({ bloomY = 0.4, key = true } = {}) {
  if (isDark()) {
    const base = linear([[0, tk('stage-top', 'night', 'ink')], [1, tk('stage-bottom', 'ink')]]);
    const glow = radial([[0, tk('stage-orange', 'orange'), 0.16], [0.72, tk('stage-orange', 'orange'), 0]], W, 0, W * 0.62, H * 0.42);
    const lift = radial([[0, WHITE, 0.05], [0.7, WHITE, 0]], 0, 0, W * 0.55, H * 0.38);
    const bloom = radial([[0, tk('stage-red', 'orange-dark'), 0.1], [0.72, tk('stage-red', 'orange-dark'), 0]], W * 0.15, H, W * 0.7, H * 0.32);
    return g({ 'data-ui': 'ground' }, [
      defs(base, glow, lift, bloom),
      ...[base, glow, lift, bloom].map((p) => el('rect', { x: 0, y: 0, width: W, height: H, fill: p.ref })),
    ]);
  }
  const P = pal();
  const base = radial([[0, P.groundTop], [0.55, P.groundMid], [1, P.groundLow]], W * 0.5, H * 0.3, W * 1.25, H * 0.72);
  const bloom = radial([[0, WHITE, 0.85], [1, WHITE, 0]], W * 0.5, H * bloomY, W * 0.62, H * 0.34);
  const warm = radial([[0, tk('yellow', 'status-warning'), 0.13], [1, tk('yellow', 'status-warning'), 0]], W * 0.82, H * 0.33, W * 0.36, H * 0.15);
  return g({ 'data-ui': 'ground' }, [
    defs(base, bloom, warm),
    el('rect', { x: 0, y: 0, width: W, height: H, fill: base.ref }),
    el('rect', { x: 0, y: 0, width: W, height: H, fill: bloom.ref }),
    key ? el('rect', { x: 0, y: 0, width: W, height: H, fill: warm.ref }) : '',
  ]);
}

// ── Glossy tile ─────────────────────────────────────────────────────────────────────────────
/**
 * A glossy icon tile centred on (x, y), `size` px square: the colour's gradient at 160°, a specular
 * top half, a 1.5px top highlight, a soft inner shade low, a coloured drop glow and a contact shadow.
 * `lit` (0..1) is the glow (a tile lighting up); `appear` pops it in; `icon` a uiIcon name.
 * @param {number} x @param {number} y @param {number} size
 * @param {{ icon?: string, color?: string, lit?: number, glow?: boolean, radius?: number,
 *           iconRotate?: number, iconSize?: number, appear?: number, press?: number }} [o]
 */
export function glossTile(x, y, size, { icon = null, color = 'orange', lit = 1, glow = true, radius = null, iconRotate = 0, iconSize = null, appear = 1, press = 0 } = {}) {
  const R = ramp(color);
  const s = size * (1 - 0.05 * clamp01(press));
  const r = radius ?? s * 0.28;
  const x0 = x - s / 2;
  const y0 = y - s / 2;
  const out = [];
  if (glow && lit > 0 && color !== 'ink') {
    out.push(glowAt(x, y + s * 0.12, s * 0.78, s * 0.62, R.glow, 0.42 * lit, 0.42));
    out.push(boxShadow(x0, y0, s, s, r, { dy: s * 0.16, blur: s * 0.3, spread: -s * 0.07, color: R.glow, opacity: 0.55 * lit }));
  } else if (color === 'ink') out.push(boxShadow(x0, y0, s, s, r, { dy: s * 0.16, blur: s * 0.32, spread: -s * 0.08, color: pal().black, opacity: 0.4 }));
  out.push(boxShadow(x0, y0, s, s, r, { dy: s * 0.06, blur: s * 0.12, spread: -s * 0.04, color: R.shade, opacity: 0.3 }));
  const body = linear([[0, R.lit], [0.55, R.base], [1, R.shade]], [0.33, 0.03, 0.67, 0.97]);
  const spec = linear([[0, WHITE, 0.38], [0.45, WHITE, 0.12], [1, WHITE, 0]]);
  const low = linear([[0, R.shade, 0], [0.7, R.shade, 0], [1, R.shade, 0.45]]);
  const hl = linear([[0, WHITE, 0.65], [0.18, WHITE, 0.12], [1, WHITE, 0]]);
  out.push(defs(body, spec, low, hl));
  out.push(el('path', { d: roundRect(x0, y0, s, s, r), fill: body.ref }));
  out.push(el('path', { d: roundRect(x0, y0, s, s, r), fill: low.ref }));
  out.push(el('path', { d: roundRect(x0 + s * 0.05, y0 + s * 0.025, s * 0.9, s * 0.5, [r * 0.92, r * 0.92, r * 0.5, r * 0.5]), fill: spec.ref }));
  out.push(el('path', { d: roundRect(x0 + 0.75, y0 + 0.75, s - 1.5, s - 1.5, r - 0.75), fill: 'none', stroke: hl.ref, 'stroke-width': 1.5 }));
  // Unlit, the tile sits back: a paper wash over its colour (it lights up as `lit` rises).
  if (lit < 1) out.push(el('path', { d: roundRect(x0, y0, s, s, r), fill: T['paper-lit'], 'fill-opacity': f(0.4 * (1 - clamp01(lit))) }));
  if (icon) {
    const isz = iconSize ?? s * 0.46;
    const ink = color === 'yellow' ? ramp('yellow').text : WHITE;
    out.push(uiIcon(icon, x, y, isz, { color: ink, sw: clamp(2.2 * (24 / isz) * (isz / 40), 1.6, 2.4), rotate: iconRotate }));
  }
  return pop(g({ 'data-ui': 'tile' }, out), x, y, appear);
}

// ── Pill ────────────────────────────────────────────────────────────────────────────────────
/**
 * A label chip centred on (x, y): Roboto 700 (tracked capitals by default) on glass (`tone:
 * 'glass'`), on a tint of `color` (`'tint'`) or on the glossy colour (`'solid'`). `dot` (true or a
 * colour name) leads with a status dot; orange's dot is the sun gradient. `icon` leads with a uiIcon
 * instead. The text is ≥ MIN_TEXT (30px) and holds 4.5:1 on its surface; a label too long for
 * `maxW` widens the chip rather than shrinking past 30px. Returns { svg, box } (also usable as the
 * svg string).
 * @param {string} text @param {number} x @param {number} y
 * @param {{ dot?: boolean | string, color?: string, tone?: 'glass' | 'tint' | 'solid', icon?: string,
 *           size?: number, caps?: boolean, tracking?: number, appear?: number, maxW?: number }} [o]
 */
export function pill(text, x, y, { dot = false, color = 'orange', tone = 'glass', icon = null, size = MIN_TEXT, caps = true, tracking = 0.12, appear = 1, maxW = 640 } = {}) {
  const R = ramp(color);
  size = Math.max(MIN_TEXT, size);
  const str = caps ? String(text).toUpperCase() : String(text);
  const lead = icon ? size * 1.05 + size * 0.38 : dot ? size * 0.42 + size * 0.42 : 0;
  const padX = size * 0.8;
  const sz = fitSize(str, size, maxW - padX * 2 - lead, 'roboto-700', MIN_TEXT, tracking);
  // The tracking after the last letter is not ink: measure without it so the text sits centred.
  const tw = measure(str, sz, 'roboto-700', tracking) - tracking * sz;
  const h = size * 1.9;
  const w = tw + padX * 2 + lead;
  const bx = x - w / 2;
  const by = y - h / 2;
  const out = [];
  let surface = isDark() ? T.ink : T['paper-lit'];
  if (tone === 'glass') out.push(glassPanel(bx, by, w, h, h / 2, { shadow: 0.55 }));
  else if (tone === 'tint') {
    surface = isDark() ? T.ink : mixC(WHITE, R.base, 0.14);
    out.push(el('path', { d: roundRect(bx, by, w, h, h / 2), fill: R.base, 'fill-opacity': 0.14, stroke: R.base, 'stroke-opacity': 0.45, 'stroke-width': 1.2 }));
  } else {
    surface = R.base;
    out.push(boxShadow(bx, by, w, h, h / 2, { dy: 8, blur: 22, spread: -2, color: R.glow, opacity: 0.45 }));
    const body = linear([[0, R.lit], [0.55, R.base], [1, R.shade]], [0.33, 0.03, 0.67, 0.97]);
    const hl = linear([[0, WHITE, 0.55], [0.3, WHITE, 0], [1, WHITE, 0]]);
    out.push(defs(body, hl), el('path', { d: roundRect(bx, by, w, h, h / 2), fill: body.ref }), el('path', { d: roundRect(bx + 0.6, by + 0.6, w - 1.2, h - 1.2, h / 2), fill: 'none', stroke: hl.ref, 'stroke-width': 1.2 }));
  }
  out.push(el('rect', { 'data-k': 'shape', x: f(bx), y: f(by), width: f(w), height: f(h), rx: f(h / 2), fill: 'none' }));
  const color_ = tone === 'solid' ? onColor(surface) : tone === 'tint' ? (isDark() ? R.lit : mixC(R.text, INK(), 0.35)) : textMain();
  let cx = bx + padX;
  if (icon) {
    out.push(uiIcon(icon, cx + size * 0.52, y, size * 1.05, { color: tone === 'solid' ? color_ : tone === 'tint' ? color_ : R.base, sw: 2.6 }));
    cx += lead;
  } else if (dot) {
    const dc = dot === true ? color : dot;
    const r = size * 0.21;
    const dcx = cx + r;
    if (dc === 'orange') {
      const sun = linear([[0, tk('sun-top', 'status-warning')], [0.35, tk('sun-mid', 'orange-lit')], [0.62, tk('sun-bottom', 'orange-dark')], [1, tk('sun-bottom', 'orange-dark')]]);
      out.push(glowAt(dcx, y, r * 2.2, r * 2.2, ramp('orange').glow, 0.55, 0.35), defs(sun), el('circle', { cx: f(dcx), cy: f(y), r: f(r), fill: sun.ref }));
    } else {
      const D = ramp(dc);
      out.push(el('circle', { cx: f(dcx), cy: f(y), r: f(r), fill: dc === 'ink' ? pal().idle : D.base }));
    }
    cx += lead;
  }
  out.push(label(str, cx, y + sz * 0.36, sz, { face: 'roboto-700', color: color_, tracking }));
  return boxed(pop(g({ 'data-k': 'textbox', 'data-ui': 'pill' }, out), x, y, appear), { x: bx, y: by, w, h });
}

// ── Glass card ──────────────────────────────────────────────────────────────────────────────
/**
 * A frosted glass card, top-left (x, y), w × h: a glossy tile with `icon` in `accent` top left, the
 * title in Pragmatica, `sub` beneath in Roboto, and a state: 'picked' (accent ring, coloured glow,
 * tinted glass, a ✓ badge), 'idle' (the glass and tile sit back, a grey dot; the text keeps its
 * contrast) or 'plain'. `badge` adds a word to the badge (a ≥ 30px pill, e.g. 'Picked', 'Idle').
 * `lit` (0..1, default 1 when picked, else 0) animates the lighting up; `appear` pops the card in.
 * Text is ≥ MIN_TEXT (30px): a title or sub too long for the width wraps (two rows each), and the
 * card grows taller when its text needs it; the returned box is the card as drawn. Returns
 * { svg, box } (also usable as the svg string).
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {{ title?: string, sub?: string, icon?: string, state?: 'picked' | 'idle' | 'plain',
 *           accent?: string, lit?: number, badge?: string, appear?: number, radius?: number }} [o]
 */
export function glassCard(x, y, w, h, { title = '', sub = '', icon = null, state = 'plain', accent = 'teal', lit = null, badge = null, appear = 1, radius = null } = {}) {
  if (!['picked', 'idle', 'plain'].includes(state)) throw new Error(`HX: glassCard state "${state}" must be picked, idle or plain.`);
  const R = ramp(accent);
  const L = clamp01(lit ?? (state === 'picked' ? 1 : 0));
  const idle = state === 'idle' ? 1 - L : 0;
  const r = radius ?? clamp(Math.min(w, h) * 0.15, 16, 38);
  const pad = clamp(Math.min(w, h) * 0.13, 22, 36);
  const tile = icon ? clamp(h * 0.28, 52, 96) : 0;
  const inner = w - pad * 2;
  const T1 = wrapFit(title, clamp(h * 0.17, 34, 56), inner, 'pragmatica-700', 2);
  const S1 = sub ? wrapFit(sub, clamp(T1.size * 0.8, MIN_TEXT, 40), inner, 'roboto-500', 2) : { size: 0, rows: [] };
  const gap = clamp(h * 0.08, 12, 28);
  const tLine = T1.size * 1.08;
  const sLine = S1.size * 1.25;
  const need = pad + tile + (tile ? gap : 0) + T1.rows.length * tLine + (S1.rows.length ? S1.size * 0.3 + S1.rows.length * sLine : 0) + pad * 0.8;
  const H_ = Math.max(h, need);
  const out = [];
  out.push(glassPanel(x, y, w, H_, r, { tint: accent, tintLevel: L, ring: accent, ringLevel: L, shadow: 1, strength: 1 - 0.25 * idle }));
  out.push(el('rect', { 'data-k': 'shape', x: f(x), y: f(y), width: f(w), height: f(H_), rx: f(r), fill: 'none' }));
  if (icon) out.push(glossTile(x + pad + tile / 2, y + pad + tile / 2, tile, { icon, color: accent, lit: 0.35 + 0.65 * L, glow: true }));
  // Idle text stays readable (frame.md: 4.5:1); only its weight of colour drops.
  const tColor = idle > 0.5 && !isDark() ? T['text-secondary'] : textMain();
  let base = y + pad + tile + (tile ? gap : 0) + T1.size * 0.8;
  T1.rows.forEach((row, i) => out.push(label(row, x + pad, base + i * tLine, T1.size, { face: 'pragmatica-700', color: tColor })));
  base += (T1.rows.length - 1) * tLine + S1.size * 0.3 + sLine;
  S1.rows.forEach((row, i) => out.push(label(row, x + pad, base + i * sLine - S1.size * 0.15, S1.size, { face: 'roboto-500', color: textSoft() })));
  // The state badge, top right, level with the tile (or the first line).
  const by = y + pad + (tile ? tile / 2 : T1.size * 0.45);
  if (state === 'picked' && L > 0.02) {
    const ap = clamp01((L - 0.3) / 0.7);
    if (badge) {
      const b = pill(badge, 0, 0, { tone: 'tint', icon: 'check', color: accent, appear: 1 });
      out.push(pill(badge, x + w - pad * 0.8 - b.box.w / 2, by, { tone: 'tint', icon: 'check', color: accent, appear: ap }).svg);
    } else {
      const cr = 22;
      const cx = x + w - pad - cr;
      out.push(pop([el('circle', { cx: f(cx), cy: f(by), r: cr, fill: R.base, 'fill-opacity': 0.16, stroke: R.base, 'stroke-opacity': 0.5, 'stroke-width': 1.2 }), uiIcon('check', cx, by, 26, { color: mixC(R.text, INK(), 0.2), sw: 3 })].join(''), cx, by, ap));
    }
  } else if (state === 'idle') {
    if (badge) {
      const b = pill(badge, 0, 0, { dot: 'ink' });
      out.push(pill(badge, x + w - pad * 0.8 - b.box.w / 2, by, { dot: 'ink' }).svg);
    } else out.push(el('circle', { cx: f(x + w - pad - 8), cy: f(by), r: 8, fill: pal().idle }));
  }
  const svg = g({ 'data-k': 'textbox', 'data-ui': 'card', 'data-state': state }, out);
  return boxed(pop(svg, x + w / 2, y + H_ / 2, appear), { x, y, w, h: H_ });
}

// ── Phone and chat ──────────────────────────────────────────────────────────────────────────
/**
 * A chat bubble. `from: 'user'` is the dark sent bubble with its corner at the bottom right, x its
 * RIGHT edge; `from: 'ai'` the light reply, x its LEFT edge; y its top. `progress` (0..1) pops the
 * bubble in over its first quarter, then types the words in. `typing` (true, or a phase in seconds
 * for the dots' pulse) draws the "…" typing bubble instead of text. Wraps to `maxW` (the bubble's
 * outer width) by measured width at ≥ MIN_TEXT (30px; default 34): a long message takes more rows,
 * never a smaller size. `meta` ("Sent") is a decorative 24px line under it. The reply is frosted glass on the ground (`surface: 'glass'`) and a
 * flat light grey on a phone screen (`'flat'`, phone() passes it). Returns { svg, box } (also usable
 * as the svg string).
 * @param {string} text @param {number} x @param {number} y
 * @param {{ from?: 'user' | 'ai', maxW?: number, size?: number, progress?: number,
 *           typing?: boolean | number, meta?: string, surface?: 'glass' | 'flat' }} [o]
 */
export function chatBubble(text, x, y, { from = 'user', maxW = 400, size = 34, progress = 1, typing = false, meta = null, surface = 'glass' } = {}) {
  size = Math.max(MIN_TEXT, size);
  if (from !== 'user' && from !== 'ai') throw new Error(`HX: chatBubble from "${from}" must be user or ai.`);
  const user = from === 'user';
  const out = [];
  const appear = clamp01(progress / 0.25);
  if (typing !== false && typing != null) {
    const d = size * 0.32;
    const gap = size * 0.25;
    const w = d * 3 + gap * 2 + size * 1.3;
    const h = size * 1.4;
    const bx = user ? x - w : x;
    const r = h / 2;
    const corners = user ? [r, r, size * 0.28, r] : [r, r, r, size * 0.28];
    out.push(user ? glossPanel(bx, y, w, h, corners, { color: 'ink' }) : surface === 'flat' ? el('path', { d: roundRect(bx, y, w, h, corners), fill: pal().reply }) : glassPanel(bx, y, w, h, corners, { strength: 1.2, shadow: 0.6 }));
    const phase = typeof typing === 'number' ? typing : 0;
    for (let i = 0; i < 3; i++) {
      const o = typeof typing === 'number' ? 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (phase * 1.4 - i * 0.2))) : [1, 0.7, 0.45][i];
      out.push(el('circle', { cx: f(bx + size * 0.65 + d / 2 + i * (d + gap)), cy: f(y + h / 2), r: f(d / 2), fill: user ? WHITE : pal().dots, opacity: f(o) }));
    }
    return boxed(pop(g({ 'data-ui': 'bubble' }, out), user ? x - w : x, y + h / 2, appear), { x: bx, y, w, h });
  }
  const padX = size * 0.79;
  const padY = size * 0.6;
  const inner = maxW - padX * 2;
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const fit = wrapFit(words.join(' '), size, inner, 'roboto-500', 99);
  const sz = fit.size;
  const rows = fit.rows.map((r) => r.split(' '));
  const lineH = sz * 1.2;
  const tw = Math.max(...rows.map((r) => measure(r.join(' '), sz, 'roboto-500')), sz);
  const w = tw + padX * 2;
  const h = rows.length * lineH + padY * 2;
  const bx = user ? x - w : x;
  const big = size * 0.93;
  const corners = user ? [big, big, size * 0.28, big] : [big, big, big, size * 0.28];
  if (user) {
    out.push(boxShadow(bx, y, w, h, big, { dy: 14, blur: 24, spread: -12, color: pal().black, opacity: 0.45 }));
    const body = linear([[0, T['ink-lit'] ?? T.ink], [1, T.ink]]);
    const hl = linear([[0, WHITE, 0.2], [0.25, WHITE, 0], [1, WHITE, 0]]);
    out.push(defs(body, hl), el('path', { d: roundRect(bx, y, w, h, corners), fill: body.ref }), el('path', { d: roundRect(bx + 0.6, y + 0.6, w - 1.2, h - 1.2, corners), fill: 'none', stroke: hl.ref, 'stroke-width': 1.2 }));
  } else {
    out.push(surface === 'flat' ? el('path', { d: roundRect(bx, y, w, h, corners), fill: pal().reply }) : glassPanel(bx, y, w, h, corners, { strength: 1.2, shadow: 0.7 }));
  }
  out.push(el('rect', { 'data-k': 'shape', x: f(bx), y: f(y), width: f(w), height: f(h), rx: f(big), fill: 'none' }));
  // Words type in over the rest of the progress, one after another.
  const typed = clamp01((progress - 0.2) / 0.8);
  const n = words.length;
  let k = 0;
  rows.forEach((row, i) => {
    const base = y + padY + i * lineH + sz * 0.94;
    const spans = row.map((wd, j) => {
      const o = clamp01((typed * n - k++) * 1.6);
      return el('tspan', { opacity: f(o) }, `${j ? ' ' : ''}${esc(wd)}`);
    });
    out.push(el('text', { 'data-k': 'text', 'data-text': esc(row.join(' ')), x: f(bx + padX), y: f(base), 'font-size': f(sz), 'font-family': 'Roboto', 'font-weight': 500, fill: user ? WHITE : INK() }, spans.join('')));
  });
  // The meta line ("Sent") sits under the bubble, outside its textbox.
  const metaSvg = meta ? label(meta, user ? bx + w - 6 : bx + 6, y + h + MIN_DECOR * 1.15, MIN_DECOR, { color: pal().meta, anchor: user ? 'end' : 'start', decor: true }) : '';
  return boxed(pop(g({ 'data-ui': 'bubble' }, [g({ 'data-k': 'textbox' }, out), metaSvg]), x, y + h, appear), { x: bx, y, w, h });
}

/**
 * A phone, top-left at (x, y), w × h (default 380 × 660): graphite frame with a hairline and a top
 * highlight, the island and status icons, the chat header `title` (≥ 30px; '' for none) over a
 * hairline, then `messages` stacked down the screen ([{ text, from, progress, typing, meta }]) and
 * `children` on top (an SVG string, or a function of the screen rect { x, y, w, h, top, bottom,
 * left, right, next } returning SVG). `fade` (default true) dissolves the lower third into the
 * paper, as in the still, so keep what must be read in the top two thirds. The screen is the
 * phone's data-k="shape", so bounds.mjs keeps its text on the screen.
 * @param {number} x @param {number} y
 * @param {{ w?: number, h?: number, title?: string, messages?: object[], children?: string | Function,
 *           fade?: boolean, bubbleSize?: number, appear?: number }} [o]
 */
export function phone(x, y, { w = 380, h = 660, title = 'New chat', messages = [], children = '', fade = true, bubbleSize = null, appear = 1 } = {}) {
  const k = w / 336;
  const R = 58 * k;
  const inset = 10 * k;
  const sx = x + inset;
  const sy = y + inset;
  const sw = w - inset * 2;
  const sh = h - inset * 2;
  const sr = R - inset;
  const out = [];
  out.push(boxShadow(x, y, w, h, R, { dy: 50 * k, blur: 80 * k, spread: -40 * k, color: pal().shadow, opacity: 0.55 }));
  out.push(boxShadow(x, y, w, h, R, { dy: 18 * k, blur: 30 * k, spread: -12 * k, color: pal().shadow, opacity: 0.25 }));
  const frame = graphite();
  const rim = linear([[0, WHITE, 0.3], [0.12, WHITE, 0.14], [1, WHITE, 0.12]]);
  const screen = linear([[0, pal().screenTop], [1, pal().screenBottom]]);
  const sheen = linear([[0, WHITE, 0.55], [0.34, WHITE, 0], [1, WHITE, 0]], [0.06, 0.27, 0.94, 0.73]);
  out.push(defs(frame, rim, screen, sheen));
  out.push(el('path', { d: roundRect(x, y, w, h, R), fill: frame.ref }));
  out.push(el('path', { d: roundRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5, R - 0.75), fill: 'none', stroke: rim.ref, 'stroke-width': 1.5 }));
  out.push(el('path', { d: roundRect(sx, sy, sw, sh, sr), fill: screen.ref }));
  out.push(el('rect', { 'data-k': 'shape', x: f(sx), y: f(sy), width: f(sw), height: f(sh), rx: f(sr), fill: 'none' }));
  // Island and status icons (no clock: a label under 24px carries nothing a viewer can read).
  out.push(el('rect', { x: f(x + w / 2 - 48 * k), y: f(sy + 14 * k), width: f(96 * k), height: f(28 * k), rx: f(14 * k), fill: tk('ink-shade', 'ink') }));
  const bx = sx + sw - 28 * k - 54 * k;
  const by = sy + 22 * k;
  [[0, 7, 5], [5, 5, 7], [10, 2.5, 9.5], [15, 0, 12]].forEach(([dx, dy, hh]) => out.push(el('rect', { x: f(bx + dx * k), y: f(by + dy * k), width: f(3 * k), height: f(hh * k), rx: f(k), fill: INK() })));
  const bt = bx + 26 * k;
  out.push(el('rect', { x: f(bt + 0.5 * k), y: f(by), width: f(23 * k), height: f(12 * k), rx: f(3.5 * k), fill: 'none', stroke: INK(), 'stroke-opacity': 0.4, 'stroke-width': f(k) }));
  out.push(el('rect', { x: f(bt + 2.5 * k), y: f(by + 2 * k), width: f(17 * k), height: f(8 * k), rx: f(2 * k), fill: INK() }));
  out.push(el('rect', { x: f(bt + 25 * k), y: f(by + 3.5 * k), width: f(2 * k), height: f(5 * k), rx: f(k), fill: INK(), opacity: 0.4 }));
  // Chat header.
  const cx = x + w / 2;
  let top = sy + 70 * k;
  if (title) {
    const ts = fitSize(title, MIN_TEXT, sw - 44 * k, 'roboto-700');
    out.push(label(title, cx, sy + 62 * k + ts * 0.36, ts, { face: 'roboto-700', color: INK(), anchor: 'middle' }));
    out.push(el('rect', { x: f(sx + 22 * k), y: f(sy + 98 * k), width: f(sw - 44 * k), height: f(Math.max(1, k)), fill: INK(), opacity: 0.08 }));
    top = sy + 122 * k;
  }
  // Messages stacked down the screen.
  const bsz = Math.max(MIN_TEXT, bubbleSize ?? 34);
  const area = { x: sx, y: sy, w: sw, h: sh, top, bottom: sy + sh - 24 * k, left: sx + 18 * k, right: sx + sw - 18 * k };
  let cy = top;
  for (const m of messages) {
    const from = m.from ?? 'user';
    const b = chatBubble(m.text ?? '', from === 'user' ? area.right : area.left, cy, { from, maxW: sw * 0.86, size: m.size ?? bsz, progress: m.progress ?? 1, typing: m.typing ?? false, meta: m.meta ?? null, surface: 'flat' });
    out.push(b.svg);
    cy += b.box.h + (m.meta ? 22 + MIN_DECOR * 1.4 : 22);
  }
  area.next = cy;
  out.push(svgOf(typeof children === 'function' ? children(area) : children));
  // The glass sheen over the screen.
  out.push(el('path', { d: roundRect(sx, sy, sw, sh, sr), fill: sheen.ref, 'pointer-events': 'none' }));
  let body = out.join('');
  if (fade) {
    const fadeG = linear([[0, WHITE, 1], [0.66, WHITE, 1], [1, WHITE, 0]], [0, y, 0, y + h + 2], true);
    const mid = id(`gl-m${hash(`${f(x)},${f(y)},${f(w)},${f(h)}`)}`);
    body = defs(fadeG) + el('mask', { id: mid, maskUnits: 'userSpaceOnUse', x: f(x - w), y: f(y - h * 0.5), width: f(w * 3), height: f(h * 2.2) }, el('rect', { x: f(x - w), y: f(y - h * 0.5), width: f(w * 3), height: f(h * 2.2), fill: fadeG.ref })) + g({ mask: `url(#${mid})` }, body);
  }
  return pop(g({ 'data-k': 'textbox', 'data-ui': 'phone' }, body), x + w / 2, y + h / 2, appear);
}

// ── Routes and packets ──────────────────────────────────────────────────────────────────────
const P2 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];

/** The cubic segments of a route through `points`: bend 'h' / 'v' (S-curves with horizontal or
 *  vertical handles, the UI flow look), 'smooth' (through every point) or 'line'. */
function segments(points, bend = 'smooth', pull = 0.5) {
  if (!Array.isArray(points) || points.length < 2) throw new Error('HX: a route needs at least two points [[x, y], …].');
  const P = points.map(([px, py]) => [Number(px), Number(py)]);
  const segs = [];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i];
    const b = P[i + 1];
    if (bend === 'line') segs.push([a, P2(a, b, 1 / 3), P2(a, b, 2 / 3), b]);
    else if (bend === 'h') {
      const d = (b[0] - a[0]) * pull;
      segs.push([a, [a[0] + d, a[1]], [b[0] - d, b[1]], b]);
    } else if (bend === 'v') {
      const d = (b[1] - a[1]) * pull;
      segs.push([a, [a[0], a[1] + d], [b[0], b[1] - d], b]);
    } else {
      const p0 = P[i - 1] ?? a;
      const p3 = P[i + 2] ?? b;
      segs.push([a, [a[0] + (b[0] - p0[0]) / 6, a[1] + (b[1] - p0[1]) / 6], [b[0] - (p3[0] - a[0]) / 6, b[1] - (p3[1] - a[1]) / 6], b]);
    }
  }
  return segs;
}

const cubic = (Q, t) => {
  const u = 1 - t;
  return [0, 1].map((i) => u * u * u * Q[0][i] + 3 * u * u * t * Q[1][i] + 3 * u * t * t * Q[2][i] + t * t * t * Q[3][i]);
};

/** Arc-length samples of a route: [{ p: [x, y], s }] with s the distance from the start. */
function sampled(points, bend, pull) {
  const segs = segments(points, bend, pull);
  const N = 40;
  const out = [];
  let s = 0;
  let prev = null;
  segs.forEach((Q, si) => {
    for (let i = si ? 1 : 0; i <= N; i++) {
      const p = cubic(Q, i / N);
      if (prev) s += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      out.push({ p, s });
      prev = p;
    }
  });
  return { segs, pts: out, len: s };
}

/** The point at arc-length fraction u (0..1) of a route and its direction. */
function at(S, u) {
  const target = clamp01(u) * S.len;
  const { pts } = S;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (pts[m].s < target) lo = m;
    else hi = m;
  }
  const a = pts[lo];
  const b = pts[hi];
  const span = b.s - a.s || 1;
  const p = P2(a.p, b.p, clamp01((target - a.s) / span));
  return { x: p[0], y: p[1], angle: (Math.atan2(b.p[1] - a.p[1], b.p[0] - a.p[0]) * 180) / Math.PI };
}

/** The part of a route between u0 and u1 as a smooth polyline path. */
function partD(S, u0, u1) {
  const n = Math.max(2, Math.ceil(48 * (u1 - u0)) + 1);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const q = at(S, lerp(u0, u1, i / (n - 1)));
    pts.push(`${f(q.x)} ${f(q.y)}`);
  }
  return `M ${pts.join(' L ')}`;
}

const fullD = (segs) => `M ${f(segs[0][0][0])} ${f(segs[0][0][1])} ${segs.map((Q) => `C ${Q.slice(1).map(([px, py]) => `${f(px)} ${f(py)}`).join(', ')}`).join(' ')}`;

const boundsOf = (S, pad) => {
  const xs = S.pts.map((q) => q.p[0]);
  const ys = S.pts.map((q) => q.p[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
};

/** { x, y, angle } at arc-length fraction u of the route through `points` (route's bend). */
export function routeAt(points, u, { bend = 'smooth', pull = 0.5 } = {}) {
  return at(sampled(points, bend, pull), u);
}

/** The SVG path data of the route through `points`. */
export function routePath(points, { bend = 'smooth', pull = 0.5 } = {}) {
  return fullD(segments(points, bend, pull));
}

/**
 * A route through `points` ([[x, y], …]): a quiet hairline track, and the lit part from the start to
 * `progress` (0..1) in `color` with a soft glow, ending in a node dot once it arrives. `dashed` draws
 * the unchosen route instead: a dotted hairline ending in a hollow ring. `trail` (a fraction) lights
 * only that much behind the head, fading out. bend: 'smooth' | 'h' | 'v' | 'line'.
 * @param {number[][]} points
 * @param {{ color?: string, progress?: number, glow?: boolean, dashed?: boolean, width?: number,
 *           bend?: string, pull?: number, track?: boolean, ends?: boolean, trail?: number | null }} [o]
 */
export function route(points, { color = 'teal', progress = 1, glow = true, dashed = false, width = 4, bend = 'smooth', pull = 0.5, track = true, ends = true, trail = null } = {}) {
  const S = sampled(points, bend, pull);
  const d = fullD(S.segs);
  const R = ramp(color);
  const p = clamp01(progress);
  const hair = isDark() ? WHITE : INK();
  const end = at(S, 1);
  const out = [];
  if (dashed) {
    const dd = p >= 1 ? d : p > 0 ? partD(S, 0, p) : '';
    if (dd) out.push(el('path', { d: dd, fill: 'none', stroke: hair, 'stroke-opacity': isDark() ? 0.32 : 0.28, 'stroke-width': 1.8, 'stroke-dasharray': '2 9', 'stroke-linecap': 'round' }));
    if (ends && p >= 1) out.push(el('circle', { cx: f(end.x), cy: f(end.y), r: 5, fill: 'none', stroke: hair, 'stroke-opacity': 0.3, 'stroke-width': 1.6 }));
    return g({ 'data-ui': 'route' }, out);
  }
  if (track) out.push(el('path', { d, fill: 'none', stroke: hair, 'stroke-opacity': isDark() ? 0.2 : 0.16, 'stroke-width': 1.6 }));
  if (p > 0) {
    const u0 = trail == null ? 0 : Math.max(0, p - trail);
    const lit = u0 === 0 && p >= 1 ? d : partD(S, u0, p);
    let stroke = R.base;
    const ds = [];
    if (trail != null) {
      const a = at(S, u0);
      const b = at(S, p);
      const tg = linear([[0, R.lit, 0], [1, R.lit, 0.95]], [a.x, a.y, b.x + 0.01, b.y + 0.01], true);
      ds.push(tg);
      stroke = tg.ref;
    }
    if (glow) {
      const flt = blur(width * 1.5, boundsOf(S, width * 3));
      ds.push(flt);
      out.push(defs(...ds), el('path', { d: lit, fill: 'none', stroke, 'stroke-width': f(width * (trail == null ? 3 : 3.4)), 'stroke-linecap': 'round', opacity: trail == null ? 0.38 : 0.6, filter: flt.ref }));
    } else if (ds.length) out.push(defs(...ds));
    out.push(el('path', { d: lit, fill: 'none', stroke, 'stroke-width': f(width), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    if (ends && p >= 1 && trail == null) {
      out.push(el('circle', { cx: f(end.x), cy: f(end.y), r: f(width * 1.75), fill: R.base }));
      out.push(el('circle', { cx: f(end.x), cy: f(end.y), r: f(width * 3.25), fill: 'none', stroke: R.base, 'stroke-opacity': 0.35, 'stroke-width': 2 }));
    }
  }
  return g({ 'data-ui': 'route' }, out);
}

/**
 * A packet: the glossy capsule (52 × 26 at size 1) riding the route through `points` at u (0..1 of
 * its length), turned along it, glowing, with a fading lit trail behind it. Not drawn at u ≤ 0 or
 * u ≥ 1 (it has arrived); it fades in and out over the ends. Same `bend` as its route.
 * @param {number[][]} points @param {number} u
 * @param {{ color?: string, bend?: string, pull?: number, size?: number, trail?: number, glow?: boolean }} [o]
 */
export function packet(points, u, { color = 'orange', bend = 'smooth', pull = 0.5, size = 1, trail = 0.45, glow = true } = {}) {
  if (!(u > 0 && u < 1)) return '';
  const S = sampled(points, bend, pull);
  const R = ramp(color);
  const q = at(S, u);
  const fade = clamp01(Math.min(u / 0.04, (1 - u) / 0.04));
  const w = 52 * size;
  const h = 26 * size;
  const out = [];
  if (trail > 0) out.push(route(points, { color, bend, pull, progress: u, trail: Math.min(trail, u), track: false, width: 3.2 * size, ends: false, glow }));
  const cap = [];
  if (glow) cap.push(glowAt(0, 0, w * 0.75, h * 1.05, R.glow, 0.5, 0.4));
  cap.push(boxShadow(-w / 2, -h / 2, w, h, h / 2, { dy: 6 * size, blur: 12 * size, spread: -4 * size, color: R.shade, opacity: 0.5 }));
  const body = linear([[0, R.lit], [0.55, R.base], [1, R.shade]], [0.33, 0.03, 0.67, 0.97]);
  const hl = linear([[0, WHITE, 0.7], [0.3, WHITE, 0.1], [1, WHITE, 0]]);
  cap.push(defs(body, hl), el('rect', { x: f(-w / 2), y: f(-h / 2), width: f(w), height: f(h), rx: f(h / 2), fill: body.ref }));
  cap.push(el('rect', { x: f(-w / 2 + 0.75), y: f(-h / 2 + 0.75), width: f(w - 1.5), height: f(h - 1.5), rx: f(h / 2 - 0.75), fill: 'none', stroke: hl.ref, 'stroke-width': 1.5 }));
  out.push(g({ transform: `translate(${f(q.x)} ${f(q.y)}) rotate(${f(q.angle)})` }, cap));
  return g({ 'data-ui': 'packet', opacity: fade < 1 ? f(fade) : undefined }, out);
}

// ── Step tracker (frame 6) ──────────────────────────────────────────────────────────────────
/** The upcoming stops' text and marks: muted but readable (≥ 4.5:1 on the paper and the stage). */
// unlit stops read at ≥ 4.5:1 on their ground and on the glass disc (text-secondary on paper)
const upcomingInk = () => (isDark() ? mixC(T['paper-lit'], T['text-tertiary'], 0.4) : T['text-secondary']);

/**
 * Frame 6's step tracker: a numbered rail along one edge of the safe area, its stops the anchor
 * steps' technical names (`steps`: strings, 4 words or fewer). Stops before `current` are done (a
 * glossy ink disc with a ✓), `current` is lit (a glossy green disc with its number, a halo, its label
 * on a green-tinted pill), the rest are upcoming (a glass disc, number and label in a muted ink that
 * still holds 4.5:1). The rail is a hairline lit green up to the current stop. `lit` (0..1) animates
 * the current stop lighting on its voice cue (the rail reaches it, the disc pops and glows).
 * `axis: 'v'` (default) stacks the stops down from (x, y) with labels to the right; `'h'` runs them
 * along from (x, y) with labels centred below. Labels are Roboto 700 at ≥ MIN_TEXT (default 34),
 * wrapping to two rows within `maxW` (v) or the stop spacing (h). Returns { svg, box, stops } (stops:
 * the discs' centres; also usable as the svg string).
 * @param {string[]} steps @param {number} current @param {number} x @param {number} y
 * @param {{ axis?: 'v' | 'h', gap?: number, size?: number, maxW?: number, lit?: number, appear?: number }} [o]
 */
export function stepTracker(steps, current, x, y, { axis = 'v', gap = null, size = 34, maxW = 440, lit = 1, appear = 1 } = {}) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('HX: stepTracker needs its steps (the anchor steps\' technical names).');
  if (axis !== 'v' && axis !== 'h') throw new Error(`HX: stepTracker axis "${axis}" must be v or h.`);
  size = Math.max(TRACKER_MIN, size);
  const n = steps.length;
  const cur = Math.round(Number.isFinite(current) ? current : -1);
  const L = clamp01(lit);
  const dr = 32;
  const step = gap ?? (axis === 'v' ? 150 : 250);
  const C = steps.map((_, i) => (axis === 'v' ? [x + dr, y + dr + i * step] : [x + dr + i * step, y + dr]));
  const G_ = ramp('green');
  const I = ramp('ink');
  const out = [];
  // The rail.
  if (n > 1) {
    const reach = cur < 0 ? 0 : cur >= n ? 1 : clamp01((cur - 1 + L) / (n - 1));
    out.push(route([C[0], C[n - 1]], { bend: 'line', color: 'green', progress: reach, ends: false, width: 4 }));
  }
  const boxes = [];
  steps.forEach((raw, i) => {
    const text = String(raw?.label ?? raw);
    const state = i < cur ? 'done' : i === cur ? 'current' : 'upcoming';
    const [cx, cy] = C[i];
    const disc = [];
    const k = state === 'current' ? 0.92 + 0.08 * easeUI(L) + 0.06 * Math.sin(Math.PI * clamp01(L)) : 1;
    const r = dr * k;
    const num = String(i + 1);
    let numColor = upcomingInk();
    if (state === 'done') {
      disc.push(glossPanel(cx - r, cy - r, r * 2, r * 2, r, { color: 'ink' }));
      disc.push(uiIcon('check', cx, cy, 30, { color: WHITE, sw: 3 }));
    } else if (state === 'current') {
      if (L > 0) disc.push(glowAt(cx, cy, r * 2.1, r * 2.1, G_.glow, 0.45 * L, 0.4));
      disc.push(glossPanel(cx - r, cy - r, r * 2, r * 2, r, { color: 'green' }));
      if (L < 1) disc.push(el('circle', { cx: f(cx), cy: f(cy), r: f(r), fill: T['paper-lit'], 'fill-opacity': f(0.55 * (1 - L)) }));
      disc.push(el('circle', { cx: f(cx), cy: f(cy), r: f(r + 9), fill: 'none', stroke: G_.base, 'stroke-opacity': f(0.4 * L), 'stroke-width': 2 }));
      // the number reads on the disc as it is NOW (still washed toward paper while it lights up),
      // so it never drops under 4.5:1 mid-light (it was white on a pale disc, 2.2:1)
      numColor = onColor(mixC(G_.base, T['paper-lit'], 0.55 * (1 - L)));
    } else {
      disc.push(glassPanel(cx - r, cy - r, r * 2, r * 2, r, { shadow: 0.5, strength: 1.1 }));
      disc.push(el('circle', { cx: f(cx), cy: f(cy), r: f(r - 0.75), fill: 'none', stroke: upcomingInk(), 'stroke-opacity': 0.55, 'stroke-width': 1.5 }));
    }
    disc.push(el('rect', { 'data-k': 'shape', x: f(cx - r), y: f(cy - r), width: f(r * 2), height: f(r * 2), rx: f(r), fill: 'none' }));
    if (state !== 'done') disc.push(label(num, cx, cy + TRACKER_MIN * 0.36, TRACKER_MIN, { face: 'roboto-700', color: numColor, anchor: 'middle' }));
    out.push(g({ 'data-k': 'textbox', 'data-ui': 'stop', 'data-state': state }, disc));
    // The label.
    const room = axis === 'v' ? maxW : step - 24;
    const fit = wrapFit(text, size, room - (state === 'current' ? size * 1.2 : 0), 'roboto-700', 2, TRACKER_MIN);
    const lh = fit.size * 1.15;
    const tw = Math.max(...fit.rows.map((row) => measure(row, fit.size, 'roboto-700')));
    const padX = fit.size * 0.6;
    const bw = tw + padX * 2;
    const bh = fit.rows.length * lh + fit.size * 0.7;
    const lx = axis === 'v' ? cx + dr + 22 : cx - bw / 2;
    const ly = axis === 'v' ? cy - bh / 2 : cy + dr + 18;
    const lab = [];
    const tColor = state === 'upcoming' ? upcomingInk() : state === 'current' ? (isDark() ? G_.lit : mixC(G_.text, INK(), 0.2)) : textMain();
    if (state === 'current') lab.push(pop(el('path', { d: roundRect(lx, ly, bw, bh, Math.min(bh / 2, fit.size)), fill: G_.base, 'fill-opacity': 0.12, stroke: G_.base, 'stroke-opacity': 0.4, 'stroke-width': 1.2 }), lx + bw / 2, ly + bh / 2, 0.4 + 0.6 * L));
    lab.push(el('rect', { 'data-k': 'shape', x: f(lx), y: f(ly), width: f(bw), height: f(bh), rx: f(Math.min(bh / 2, fit.size)), fill: 'none' }));
    const ax = axis === 'v' ? lx + padX : lx + bw / 2;
    fit.rows.forEach((row, j) => lab.push(label(row, ax, ly + fit.size * 0.35 + j * lh + fit.size * 0.86, fit.size, { face: 'roboto-700', color: tColor, anchor: axis === 'v' ? 'start' : 'middle' })));
    out.push(g({ 'data-k': 'textbox', 'data-ui': 'stop-label' }, lab));
    boxes.push([Math.min(cx - dr, lx), Math.min(cy - dr, ly), Math.max(cx + dr, lx + bw), Math.max(cy + dr, ly + bh)]);
  });
  const bb = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
  const svg = pop(g({ 'data-ui': 'step-tracker' }, out), (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, appear);
  return { ...boxed(svg, { x: bb[0], y: bb[1], w: bb[2] - bb[0], h: bb[3] - bb[1] }), stops: C.map(([sx, sy]) => ({ x: sx, y: sy })) };
}

// ── Icons: a vendored Lucide subset (lucide-react 1.28.0, ISC), 24-unit grid, 2px stroke ──────
const LUCIDE = {
  'cpu': '<path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/><path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/><path d="M7 20v2"/><path d="M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  'microchip': '<path d="M10 12h4"/><path d="M10 17h4"/><path d="M10 7h4"/><path d="M18 12h2"/><path d="M18 18h2"/><path d="M18 6h2"/><path d="M4 12h2"/><path d="M4 18h2"/><path d="M4 6h2"/><rect x="6" y="2" width="12" height="20" rx="2"/>',
  'split': '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>',
  'router': '<rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6.01 18H6"/><path d="M10.01 18H10"/><path d="M15 10v4"/><path d="M17.84 7.17a4 4 0 0 0-5.66 0"/><path d="M20.66 4.34a8 8 0 0 0-11.31 0"/>',
  'network': '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
  'database': '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  'hard-drive': '<path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/>',
  'server': '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  'cloud': '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  'search': '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  'scan-search': '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/><path d="m16 16-1.9-1.9"/>',
  'file': '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/>',
  'file-text': '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'folder': '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  'globe': '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'key': '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  'key-round': '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  'shield': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  'mail': '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/>',
  'send': '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  'message-circle': '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
  'message-square': '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
  'zap': '<path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'circle-x': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  'timer': '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  'hourglass': '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  'user': '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  'bot': '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  'brain': '<path d="M12 18V5"/><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"/><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/><path d="M18 18a4 4 0 0 0 2-7.464"/><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/><path d="M6 18a4 4 0 0 1-2-7.464"/><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/>',
  'code': '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  'braces': '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
  'terminal': '<path d="M12 19h8"/><path d="m4 17 6-6-6-6"/>',
  'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  'image': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  'layers': '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
  'sparkles': '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  'settings': '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
  'sliders-horizontal': '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>',
  'credit-card': '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  'shopping-cart': '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  'store': '<path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>',
  'bell': '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  'calendar': '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>',
  'dollar-sign': '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  'coins': '<path d="M13.744 17.736a6 6 0 1 1-7.48-7.48"/><path d="M15 6h1v4"/><path d="m6.134 14.768.866-.5 2 3.464"/><circle cx="16" cy="8" r="6"/>',
  'wallet': '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  'receipt': '<path d="M12 17V7"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/><path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"/>',
  'package': '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><polyline points="3.29 7 12 12 20.71 7"/><path d="m7.5 4.27 9 5.15"/>',
  'box': '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  'truck': '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  'smartphone': '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  'laptop': '<path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z"/><path d="M20.054 15.987H3.946"/>',
  'monitor': '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  'wifi': '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>',
  'webhook': '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
  'plug': '<path d="M12 22v-5"/><path d="M15 8V2"/><path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z"/><path d="M9 8V2"/>',
  'git-branch': '<path d="M15 6a9 9 0 0 0-9 9V3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>',
  'workflow': '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
  'route': '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  'repeat': '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  'filter': '<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/>',
  'list': '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>',
  'table': '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  'book-open': '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>',
  'lightbulb': '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  'gauge': '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  'activity': '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  'trending-up': '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
  'chart-bar': '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 16h8"/><path d="M7 11h12"/><path d="M7 6h3"/>',
  'eye': '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  'mic': '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
  'camera': '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/>',
  'thumbs-up': '<path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/><path d="M7 10v12"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'star': '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  'heart': '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>',
  'house': '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  'map-pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  'upload': '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  'download': '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  'trash': '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'minus': '<path d="M5 12h14"/>',
  'play': '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
  'pause': '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>',
  'target': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  'rocket': '<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"/><path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"/>',
  'puzzle': '<path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>',
  'scale': '<path d="M12 3v18"/><path d="m19 8 3 8a5 5 0 0 1-6 0zV7"/><path d="M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1"/><path d="m5 8 3 8a5 5 0 0 1-6 0zV7"/><path d="M7 21h10"/>',
  'languages': '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  'type': '<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>',
  'hash': '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  'at-sign': '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  'memory-stick': '<path d="M12 12v-2"/><path d="M12 18v-2"/><path d="M16 12v-2"/><path d="M16 18v-2"/><path d="M2 11h1.5"/><path d="M20 18v-2"/><path d="M20.5 11H22"/><path d="M4 18v-2"/><path d="M8 12v-2"/><path d="M8 18v-2"/><rect x="2" y="6" width="20" height="10" rx="2"/>',
};
/** Short names for the beats' usual words. */
const ALIAS = { chip: 'cpu', model: 'cpu', bolt: 'zap', message: 'message-circle', chat: 'message-circle', doc: 'file-text', document: 'file-text', db: 'database', storage: 'database', tool: 'settings', agent: 'bot', ai: 'sparkles', home: 'house', warning: 'triangle-alert', error: 'circle-x', ok: 'circle-check', card: 'credit-card', cart: 'shopping-cart', branch: 'git-branch', api: 'webhook', web: 'globe', time: 'clock', money: 'dollar-sign', phone: 'smartphone', memory: 'memory-stick', 'arrow': 'arrow-right' };
/** Every icon name uiIcon accepts (aliases included). */
export const UI_ICONS = [...Object.keys(LUCIDE), ...Object.keys(ALIAS)];

/**
 * A Lucide icon centred on (x, y), `size` px square, stroked in `color` (a palette name, a token, or
 * a CSS colour; default the ground's line colour). `sw` is the stroke on the 24-unit grid.
 * @param {string} name @param {number} x @param {number} y @param {number} [size]
 * @param {{ color?: string, sw?: number, rotate?: number, opacity?: number }} [o]
 */
export function uiIcon(name, x, y, size = 32, { color = null, sw = 2, rotate = 0, opacity = 1 } = {}) {
  const key = LUCIDE[name] ? name : ALIAS[name];
  if (!key) throw new Error(`HX: no uiIcon "${name}". Use one of: ${UI_ICONS.join(', ')}.`);
  const c = color == null ? textMain() : GLASS_COLORS.includes(color) ? ramp(color).base : T[color] ?? color;
  const k = size / 24;
  const tf = `translate(${f(x)} ${f(y)})${rotate ? ` rotate(${f(rotate)})` : ''} scale(${f(k * 1000) / 1000}) translate(-12 -12)`;
  return g({ 'data-ui': 'icon', 'data-icon': key, transform: tf, fill: 'none', stroke: c, 'stroke-width': f(sw), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: opacity < 1 ? f(opacity) : undefined }, LUCIDE[key]);
}
