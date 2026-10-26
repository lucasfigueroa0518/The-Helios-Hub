// The Explainers world kit, light (hx-4, approved still 14 "light as motion"): light is animated, not
// only things. A warm wedge spills across the floor when a door opens, a rim catches the edge of a
// face, a glow blooms round a lamp, a glint sweeps across a glossy carton, a sign hums, and the
// level of all of it moves over time.
//
//   lightWedge({ from, to, level, color })   a soft cast wedge of light on a surface
//   rim(shape, { side, color, width })       a rim light on the lit edge of any shape
//   glow(cx, cy, r, { color, level })        a soft radial bloom
//   glint(clipD, u, { angle, width })        a specular band sweeping across a glossy face, u 0 → 1
//   glowSign(text, x, y, { color })          a lit sign: the words with a halo
//   level(t, keys)                           a light level over time, eased between keys
//
// Every color comes from the palette by name (`warm`, `cool`, `hot`, or any TOKENS key). Every
// function returns an SVG string and is a pure function of its arguments and frame time; filter
// and gradient ids go through id() and are named from their content, so they never collide.

import * as core from './core.js';
import { T, el, g, id, isDark } from './draw.js';

const n2 = (v) => Number(v.toFixed(2));
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** A short stable name for a piece of content (ids are content-addressed, so equal defs share one). */
export function hashId(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** A Gaussian blur filter of `sd` px: `{ defs, url }`. `box` [x, y, w, h] in user space keeps a
 *  wide blur from being cut at the element's bounding box (frame space by default). */
export function blurDef(sd, { box = [-400, -400, 1880, 2720], name = 'blur' } = {}) {
  const key = `${name}-${hashId(`${n2(sd)}|${box.join(',')}`)}`;
  const fid = id(key);
  const defs = el('filter', { id: fid, filterUnits: 'userSpaceOnUse', x: box[0], y: box[1], width: box[2], height: box[3], 'color-interpolation-filters': 'sRGB' },
    el('feGaussianBlur', { stdDeviation: n2(sd) }));
  return { defs, url: `url(#${fid})`, id: fid };
}

/** The named lights: warm (the fridge, a lamp, the sun), hot (the white core of a light), cool
 *  (moonlight, a screen). New ramps when core has them, older tokens otherwise. */
export function lightColor(name) {
  const pick = (...keys) => keys.map((k) => T[k]).find(Boolean);
  if (name === 'warm') return pick('yellow-lit', 'orange-lit');
  if (name === 'hot') return pick('paper-lit', 'canvas');
  if (name === 'cool') return pick('blue-lit', 'status-info');
  if (T[name]) return T[name];
  return name; // a color already resolved from the palette
}

/** The key light: one direction for the kit, toward the top right (core.LIGHT when it lands). */
export const KEY = (core.LIGHT && core.LIGHT.key) || [0.62, -0.78];

/** Lights add on dark grounds (screen); on paper they lay a soft tint over the drawing. */
const blend = () => (isDark() ? { style: 'mix-blend-mode:screen' } : {});

/**
 * A soft wedge of light cast on a surface: from the source edge `from` ([[x, y], [x, y]], e.g. the
 * gap of an opening door on the floor) out to the far edge `to` (same order: to[0] lies on the
 * ray from from[0]). Brightest at the source, fading out at the far edge; `level` 0..1 scales it
 * (animate it with level()). Screen px.
 */
export function lightWedge({ from, to, level: lv = 1, color = 'warm', blur = 8, hot = true } = {}) {
  if (!(lv > 0.002)) return '';
  const c = lightColor(color);
  const core0 = hot ? lightColor('hot') : c;
  const a = [(from[0][0] + from[1][0]) / 2, (from[0][1] + from[1][1]) / 2];
  const b = [(to[0][0] + to[1][0]) / 2, (to[0][1] + to[1][1]) / 2];
  const pts = [from[0], from[1], to[1], to[0]].map((p) => `${n2(p[0])},${n2(p[1])}`).join(' ');
  const k = clamp01(lv) * (isDark() ? 1 : 0.7);
  const gid = id(`wedge-${hashId(pts + c + n2(k))}`);
  const grad = el('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: n2(a[0]), y1: n2(a[1]), x2: n2(b[0]), y2: n2(b[1]) }, [
    el('stop', { offset: 0, 'stop-color': core0, 'stop-opacity': n2(0.95 * k) }),
    el('stop', { offset: 0.22, 'stop-color': c, 'stop-opacity': n2(0.75 * k) }),
    el('stop', { offset: 0.65, 'stop-color': c, 'stop-opacity': n2(0.28 * k) }),
    el('stop', { offset: 1, 'stop-color': c, 'stop-opacity': 0 }),
  ].join(''));
  const f = blurDef(blur, { name: 'wedgeblur' });
  return g({ 'data-k': 'light', 'data-light': 'wedge', ...blend() }, [el('defs', {}, grad + f.defs), el('polygon', { points: pts, fill: `url(#${gid})`, filter: f.url })]);
}

/** The unit vector toward the light for a side name, an angle in degrees (0 = right, -90 = up),
 *  or a vector. 'key' is the kit's one light direction. */
function sideVec(side) {
  if (Array.isArray(side)) {
    const l = Math.hypot(side[0], side[1]) || 1;
    return [side[0] / l, side[1] / l];
  }
  if (typeof side === 'number') return [Math.cos((side * Math.PI) / 180), Math.sin((side * Math.PI) / 180)];
  const named = { right: [1, 0], left: [-1, 0], top: [0, -1], bottom: [0, 1], key: KEY };
  const v = named[side] ?? KEY;
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/**
 * A rim light: a bright band just inside the edge of `shape` on the side toward the light.
 * `shape` is a path `d` string, or any SVG element string (its silhouette is used, whatever its
 * fill). Draw it right after the shape, over it. `side`: right | left | top | bottom | key | an
 * angle in degrees | a vector. On stage the default is the warm key; on paper a soft white.
 */
export function rim(shape, { side = 'key', color, width = 6, level: lv = 1, soft = 0.35 } = {}) {
  if (!shape || !(lv > 0.002)) return '';
  const c = lightColor(color ?? (isDark() ? 'warm' : 'hot'));
  const [ux, uy] = sideVec(side);
  const key = hashId(`${c}|${n2(ux)}|${n2(uy)}|${n2(width)}|${n2(soft)}`);
  const fid = id(`rim-${key}`);
  // The shape minus itself moved away from the light: the band on the lit side, `width` deep.
  const filter = el('filter', { id: fid, x: '-10%', y: '-10%', width: '120%', height: '120%', 'color-interpolation-filters': 'sRGB' }, [
    el('feOffset', { in: 'SourceAlpha', dx: n2(-ux * width), dy: n2(-uy * width), result: 'moved' }),
    el('feComposite', { in: 'SourceAlpha', in2: 'moved', operator: 'out', result: 'band' }),
    el('feGaussianBlur', { in: 'band', stdDeviation: n2(width * soft), result: 'soft' }),
    el('feComposite', { in: 'soft', in2: 'SourceAlpha', operator: 'in', result: 'inside' }),
    el('feFlood', { 'flood-color': c, result: 'col' }),
    el('feComposite', { in: 'col', in2: 'inside', operator: 'in' }),
  ].join(''));
  const body = shape.trim().startsWith('<') ? g({ filter: `url(#${fid})` }, shape) : el('path', { d: shape, fill: T.ink, filter: `url(#${fid})` });
  return g({ 'data-k': 'light', 'data-light': 'rim', opacity: n2(clamp01(lv)), ...blend() }, [el('defs', {}, filter), body]);
}

/** A soft radial bloom of light at (cx, cy), radius r (screen px). */
export function glow(cx, cy, r, { color = 'warm', level: lv = 1, core: hotCore = true } = {}) {
  if (!(lv > 0.002) || !(r > 0)) return '';
  const c = lightColor(color);
  const k = clamp01(lv);
  const gid = id(`glow-${hashId(`${c}|${n2(k)}|${hotCore}`)}`);
  const grad = el('radialGradient', { id: gid }, [
    el('stop', { offset: 0, 'stop-color': hotCore ? lightColor('hot') : c, 'stop-opacity': n2(0.9 * k) }),
    el('stop', { offset: 0.3, 'stop-color': c, 'stop-opacity': n2(0.5 * k) }),
    el('stop', { offset: 0.65, 'stop-color': c, 'stop-opacity': n2(0.16 * k) }),
    el('stop', { offset: 1, 'stop-color': c, 'stop-opacity': 0 }),
  ].join(''));
  return g({ 'data-k': 'light', 'data-light': 'glow', ...blend() }, [el('defs', {}, grad), el('circle', { cx: n2(cx), cy: n2(cy), r: n2(r), fill: `url(#${gid})` })]);
}

/** The bounding box of a path made of absolute coordinates (the kit's paths: M L Q C Z), of a
 *  point list, or of { x, y, w, h }. */
export function bboxOf(shape) {
  if (shape && !Array.isArray(shape) && typeof shape === 'object') return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  let pts = shape;
  if (typeof shape === 'string') {
    const nums = (shape.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const dOf = (shape) => (typeof shape === 'string' ? shape : Array.isArray(shape) ? `M ${shape.map((p) => `${n2(p[0])} ${n2(p[1])}`).join(' L ')} Z` : `M ${shape.x} ${shape.y} h ${shape.w} v ${shape.h} h ${-shape.w} Z`);

/**
 * A glint: a specular band sweeping across a glossy face as u goes 0 → 1 (outside it, nothing).
 * `clipD` is the face (a path d of absolute points, a point list or { x, y, w, h }); the band leans
 * `angle` degrees from vertical and is `width` of the face wide (a fraction, or px when > 1), with
 * a thin trailing band. Ease u yourself (a glint takes about 6 frames).
 */
export function glint(clipD, u, { angle = 22, width = 0.18, strength = 0.85, color = 'hot' } = {}) {
  if (!(u > 0 && u < 1) || !clipD) return '';
  const b = bboxOf(clipD);
  if (![b.x, b.y, b.w, b.h].every(Number.isFinite) || b.w <= 0) return '';
  const bw = width > 1 ? width : Math.max(4, b.w * width);
  const lean = Math.tan((angle * Math.PI) / 180) * b.h;
  // From fully off the left edge to fully off the right edge.
  const x0 = b.x - bw - Math.max(0, lean);
  const x1 = b.x + b.w + Math.max(0, -lean) + bw * 0.5;
  const cx = x0 + (x1 - x0) * u;
  const band = (x, w, o) => el('path', {
    d: `M ${n2(x + lean)} ${n2(b.y - 2)} L ${n2(x + lean + w)} ${n2(b.y - 2)} L ${n2(x + w)} ${n2(b.y + b.h + 2)} L ${n2(x)} ${n2(b.y + b.h + 2)} Z`,
    fill: lightColor(color),
    opacity: n2(o * strength),
  });
  const d = dOf(clipD);
  const cid = id(`glint-${hashId(d)}`);
  const fade = Math.sin(Math.PI * u); // in and out at the edges of the sweep
  return g({ 'data-k': 'light', 'data-light': 'glint' }, [
    el('defs', {}, el('clipPath', { id: cid }, el('path', { d }))),
    g({ 'clip-path': `url(#${cid})`, opacity: n2(0.35 + 0.65 * fade) }, [band(cx, bw, 0.85), band(cx + bw * 1.5, bw * 0.28, 0.45), band(cx - bw * 1.1, bw * 0.35, 0.18)]),
  ]);
}

/**
 * A lit sign: `text` centred on (x, y) (the baseline), in the light's color with a soft halo
 * behind it and a hot core. Tagged for bounds.mjs as one piece of text.
 */
export function glowSign(text, x, y, { color = 'warm', size = 40, level: lv = 1, family = "'Pragmatica Extended', Roboto", weight = 700, spacing = '0.06em' } = {}) {
  if (!(lv > 0.002)) return '';
  const c = lightColor(color);
  const k = clamp01(lv);
  const safe = String(text).replace(/[<>&"]/g, '');
  const f = blurDef(size * 0.32, { name: 'signblur' });
  const t = (o) => el('text', { x: n2(x), y: n2(y), 'text-anchor': 'middle', 'font-family': family, 'font-weight': weight, 'font-size': size, 'letter-spacing': spacing, ...o }, safe);
  return g({ 'data-k': 'text', 'data-text': safe, 'data-light': 'sign' }, [
    el('defs', {}, f.defs),
    t({ fill: c, stroke: c, 'stroke-width': n2(size * 0.22), opacity: n2(0.75 * k), filter: f.url, ...blend() }),
    t({ fill: lightColor('hot'), stroke: c, 'stroke-width': n2(Math.max(1, size * 0.04)), opacity: n2(0.35 + 0.65 * k) }),
  ]);
}

/**
 * A light level over time: `keys` are [t, v] pairs (or { at, v, e }) in time order; between two
 * keys the level eases (glide, or the named polarity `e` of the later key). Before the first key
 * it holds the first value, after the last the last.
 */
export function level(t, keys) {
  if (!keys || !keys.length) return 1;
  const ks = keys.map((k) => (Array.isArray(k) ? { at: k[0], v: k[1], e: k[2] } : k));
  if (t <= ks[0].at) return ks[0].v;
  for (let i = 1; i < ks.length; i++) {
    const a = ks[i - 1];
    const b = ks[i];
    if (t < b.at) {
      const curve = core.POLARITY[b.e ?? 'glide'] ?? core.POLARITY.glide;
      return a.v + (b.v - a.v) * curve((t - a.at) / Math.max(1e-9, b.at - a.at));
    }
  }
  return ks[ks.length - 1].v;
}
