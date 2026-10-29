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
// hx-4.1, physically motivated light (for lens.js perspective scenes; world in cm, z up):
//   irradiance(light, p, n)                  how much a point light reaches a point (cos, falloff,
//                                            and only through its aperture: a fridge lights
//                                            nothing its own body hides)
//   spill(P, light)                          the pool a light throws on the floor through its
//                                            aperture: fanning out, falling off with distance
//   castShadow(footprint, light, { height }) the shadow polygon on the floor, pointing away
//   veil(svg, { level }) · wash(svg, { color, level })   darken / warm a drawn thing's silhouette
//
// 4.2, moods and the colour script:
//   mood(name, over) · MOOD_NAMES · LIGHT_MOODS   day, evening, night, dark: key, rim, sky, haze
//   hazed(hex, distCm, mood)                 a far colour faded into the mood haze
//   colourScript(spec)                       the reel plan of mood and palette per frame
//
// THE RULE: every light has a visible or stated source. A pool, a rim, a glow or a warm face is
// drawn only where a named light (the open fridge, the window, the lamp) reaches it, in that
// light's color, falling off with distance from it. Nothing is lit by "the scene"; in a dark
// scene everything a light does not reach stays dark (a faint moonlight rim at most, and only
// with a window or moon in the shot).
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
  // box 'bbox': the filter region follows the blurred thing (its box and half again round it),
  // far cheaper than a frame-sized region for a small thing (a shadow, a blurred critter)
  // box 'frame': the frame and a margin (for a shape that runs far off screen: a floor pool, a
  // long shadow; a region the size of its projection would be enormous and slow)
  if (box === 'frame') box = [-120, -120, 1320, 2160];
  const local = box === 'bbox';
  const key = `${name}-${hashId(`${n2(sd)}|${local ? 'bbox' : box.join(',')}`)}`;
  const fid = id(key);
  const region = local
    ? { x: '-50%', y: '-50%', width: '200%', height: '200%' }
    : { filterUnits: 'userSpaceOnUse', x: box[0], y: box[1], width: box[2], height: box[3] };
  const defs = el('filter', { id: fid, ...region, 'color-interpolation-filters': 'sRGB' }, el('feGaussianBlur', { stdDeviation: n2(sd) }));
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

/** No blend modes, ever (hx-4.1): a mix-blend-mode makes HyperFrames fall back to slow
 *  screenshot capture. Light is drawn with plain alpha (a light color over the dark reads as
 *  light), and a lit drawing is lit with one filter (lit()). */
const blend = () => ({});

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
  const k = clamp01(lv) * (isDark() ? 0.8 : 0.6);
  const gid = id(`wedge-${hashId(pts + c + n2(k))}`);
  const grad = el('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: n2(a[0]), y1: n2(a[1]), x2: n2(b[0]), y2: n2(b[1]) }, [
    el('stop', { offset: 0, 'stop-color': core0, 'stop-opacity': n2(0.8 * k) }),
    el('stop', { offset: 0.25, 'stop-color': c, 'stop-opacity': n2(0.6 * k) }),
    el('stop', { offset: 0.65, 'stop-color': c, 'stop-opacity': n2(0.2 * k) }),
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
  const body = shape.trim().startsWith('<') ? g({ filter: `url(#${fid})` }, untag(shape)) : el('path', { d: shape, fill: T.ink, filter: `url(#${fid})` });
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
  const lean = Math.tan((angle * Math.PI) / 180) * (b.h + 4);
  // The band's centre at mid-height runs from fully off the left edge to fully off the right.
  const reach = bw * 1.6 + Math.abs(lean) / 2;
  const cx = b.x - reach + (b.w + 2 * reach) * u;
  const band = (c, w, o) => el('path', {
    d: `M ${n2(c - w / 2 + lean / 2)} ${n2(b.y - 2)} L ${n2(c + w / 2 + lean / 2)} ${n2(b.y - 2)} L ${n2(c + w / 2 - lean / 2)} ${n2(b.y + b.h + 2)} L ${n2(c - w / 2 - lean / 2)} ${n2(b.y + b.h + 2)} Z`,
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

// ── hx-4.1: physically motivated light ────────────────────────────────────────────────────

/** Small 3D vector helpers (world cm, z up), shared with lens.js. */
export const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u],
};
const { add, sub, mul, dot, cross, norm, len } = V3;

/** Strip cast tags from an overlay copy of a drawing (a rim, a veil, a lens): it is the same
 *  critter, never a second one for try's cast check. */
export const untag = (svg) => String(svg).replace(/ data-(who|look)="[^"]*"/g, '');

/**
 * Does the segment from the light at L to the point p pass through the aperture (four coplanar
 * world points: a fridge's opening, the gap a door leaves, a window)? A point on the light's own
 * side of the aperture plane is never reached through it.
 */
export function throughAperture(L, p, quad) {
  const [a, b, , d] = quad;
  const n = cross(sub(b, a), sub(d, a));
  const den = dot(n, sub(p, L));
  if (Math.abs(den) < 1e-9) return false;
  const t = dot(n, sub(a, L)) / den;
  if (!(t > 0 && t <= 1 + 1e-9)) return false;
  const hit = add(L, mul(sub(p, L), t));
  const inTri = (x, y, z) => {
    const s1 = dot(cross(sub(y, x), sub(hit, x)), n);
    const s2 = dot(cross(sub(z, y), sub(hit, y)), n);
    const s3 = dot(cross(sub(x, z), sub(hit, z)), n);
    return (s1 >= -1e-6 && s2 >= -1e-6 && s3 >= -1e-6) || (s1 <= 1e-6 && s2 <= 1e-6 && s3 <= 1e-6);
  };
  return inTri(quad[0], quad[1], quad[2]) || inTri(quad[0], quad[2], quad[3]);
}

/**
 * How much a point light reaches the point p on a surface with normal n (omit n for a thing that
 * faces the light, like a critter's lit side): level × cos × 1 / (1 + (d / reach)²), and 0 where
 * the light's aperture does not let it through. A light: { pos, level, reach, color, aperture? }.
 */
export function irradiance(light, p, n = null) {
  if (!light || !(light.level > 0)) return 0;
  const v = sub(light.pos, p);
  const d = len(v);
  if (d < 1e-6) return light.level;
  const w = mul(v, 1 / d);
  const cos = n ? dot(norm(n), w) : 1;
  if (cos <= 0) return 0;
  if (light.aperture && !throughAperture(light.pos, p, light.aperture)) return 0;
  return light.level * cos / (1 + (d / (light.reach ?? 300)) ** 2);
}

/** Where the ray from L through q meets the floor z = fz, or null when it never comes down. */
function floorHit(L, q, fz) {
  const dz = q[2] - L[2];
  if (dz >= -1e-6) return null;
  const t = (fz - L[2]) / dz;
  return add(L, mul(sub(q, L), t));
}

/**
 * The shadow a thing casts on the floor (z = 0) from a light, as a world polygon pointing away
 * from it: `footprint` is the thing's floor outline (world points, or { x, y, r } for a round
 * one), `light` a point light { pos } or a direction { dir } (toward the light), `height` the
 * thing's height in cm. The polygon is the hull of the footprint and its top's shadow, never
 * longer than maxLength × height from the thing (a light low behind a thing would otherwise throw
 * a streak across the whole floor).
 */
export function castShadow(footprint, light, { height = 72, reach, maxLength = 2.4, fz = 0 } = {}) {
  // a shadow never runs off across the room: at most maxLength × the thing's height (and reach)
  reach = Math.min(reach ?? Infinity, height * maxLength);
  const pts = Array.isArray(footprint)
    ? footprint.map((p) => [p[0], p[1], p[2] ?? fz])
    : Array.from({ length: 16 }, (_, i) => [footprint.x + footprint.r * Math.cos((i / 16) * 2 * Math.PI), footprint.y + footprint.r * Math.sin((i / 16) * 2 * Math.PI), fz]);
  const tops = pts.map((p) => {
    const top = [p[0], p[1], p[2] + height];
    if (light.dir) {
      const d = norm(light.dir);
      if (d[2] <= 1e-6) return add(p, mul([-d[0], -d[1], 0], reach));
      return add(p, mul([-d[0], -d[1], 0], height / d[2]));
    }
    if (light.pos[2] <= top[2] + 1e-6) {
      // the light is as low as the top: the shadow runs off to the reach
      const h = norm([p[0] - light.pos[0], p[1] - light.pos[1], 0]);
      return add(p, mul(h, reach));
    }
    const hit = floorHit(light.pos, top, fz);
    const off = sub(hit, p);
    return len(off) > reach ? add(p, mul(norm(off), reach)) : hit;
  });
  return hull2([...pts, ...tops]).map((q) => [q[0], q[1], fz]);
}

/** The convex hull of points by x, y (monotone chain), counter-clockwise. */
function hull2(points) {
  const ps = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (ps.length < 3) return ps;
  const crossZ = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of ps) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * The floor pool of a point light shining through its aperture, through the lens P (lens.js):
 * the aperture projected from the light onto the floor (it fans out from the opening), filled
 * with the light's color falling off with distance as the light does (sampled along its centre
 * line, perspective-correct), with soft edges. Returns { svg, poly } (poly: the world polygon).
 * The aperture's lower edge comes first: [bottom a, bottom b, top b, top a].
 */
export function spill(P, light, { fz = 0, reach, soft = 0.035, samples = 7 } = {}) {
  if (!light || !(light.level > 0.002) || !light.aperture) return { svg: '', poly: [] };
  const L = light.pos;
  const far = reach ?? (light.reach ?? 300) * 1.8;
  const [a0, b0, b1, a1] = light.aperture;
  const onFloor = (q) => {
    const hit = floorHit(L, q, fz);
    const base = [L[0], L[1], fz];
    if (hit && len(sub(hit, base)) <= far) return hit;
    const h = norm([q[0] - L[0], q[1] - L[1], 0]);
    return add(base, mul(h, far));
  };
  const poly = [onFloor(a0), onFloor(b0), onFloor(b1), onFloor(a1)];
  const scr = poly.map((q) => P(...q));
  if (scr.some((q) => !Number.isFinite(q[0]) || !Number.isFinite(q[1]))) return { svg: '', poly };
  const near = V3.lerp(poly[0], poly[1], 0.5);
  const farMid = V3.lerp(poly[2], poly[3], 0.5);
  const sn = P(...near);
  const sf = P(...farMid);
  const c = lightColor(light.color ?? 'warm');
  const hot = lightColor('hot');
  const I0 = irradiance({ ...light, aperture: null }, near, [0, 0, 1]) || 1e-6;
  const stops = [];
  for (let i = 0; i < samples; i++) {
    const u = i / (samples - 1);
    const w = V3.lerp(near, farMid, u);
    const s = P(...w);
    const k = Math.hypot(s[0] - sn[0], s[1] - sn[1]) / (Math.hypot(sf[0] - sn[0], sf[1] - sn[1]) || 1);
    const I = Math.min(1, irradiance({ ...light, aperture: null }, w, [0, 0, 1]) / I0) * (1 - u * u);
    stops.push(el('stop', { offset: n2(Math.min(1, k)), 'stop-color': i === 0 ? core.mixHex(c, hot, 0.35) : c, 'stop-opacity': n2(Math.min(1, light.level) * 0.9 * I) }));
  }
  const pts = scr.map((q) => `${n2(q[0])},${n2(q[1])}`).join(' ');
  const gid = id(`spill-${hashId(pts + c + n2(light.level))}`);
  const size = Math.max(...scr.map((q) => q[1])) - Math.min(...scr.map((q) => q[1])) + Math.max(...scr.map((q) => q[0])) - Math.min(...scr.map((q) => q[0]));
  const span = (k) => Math.max(...scr.map((q) => q[k])) - Math.min(...scr.map((q) => q[k]));
  const f = blurDef(Math.min(50, Math.max(3, Math.min(size, 2400) * soft)), { name: 'spillblur', box: span(0) > 1400 || span(1) > 2400 ? 'frame' : 'bbox' });
  const grad = el('linearGradient', { id: gid, gradientUnits: 'userSpaceOnUse', x1: n2(sn[0]), y1: n2(sn[1]), x2: n2(sf[0]), y2: n2(sf[1]) }, stops.join(''));
  const svg = g({ 'data-k': 'light', 'data-light': 'spill', ...blend() }, [el('defs', {}, grad + f.defs), el('polygon', { points: pts, fill: `url(#${gid})`, filter: f.url })]);
  return { svg, poly };
}

/** A filter that floods `color` into a drawing's silhouette at `level` (its id from content). */
function floodFilter(name, color, k) {
  const fid = id(`${name}-${hashId(`${color}|${n2(k)}`)}`);
  return {
    url: `url(#${fid})`,
    defs: el('filter', { id: fid, x: '-5%', y: '-5%', width: '110%', height: '110%', 'color-interpolation-filters': 'sRGB' }, [
      el('feFlood', { 'flood-color': color, 'flood-opacity': n2(k), result: 'c' }),
      el('feComposite', { in: 'c', in2: 'SourceAlpha', operator: 'in' }),
    ].join('')),
  };
}

/** Darken a drawn thing where no light reaches it: its silhouette under the ground's darkness at
 *  `level` 0..1 (a night veil). Draw right after it. */
export function veil(svg, { level: lv = 0.6, color } = {}) {
  if (!(lv > 0.005)) return '';
  const c = color ? lightColor(color) : isDark() ? (T['stage-bottom'] ?? T.ink) : T['shadow-warm'] ?? T.ink;
  const f = floodFilter('veil', c, clamp01(lv));
  return g({ 'data-k': 'light', 'data-light': 'veil' }, [el('defs', {}, f.defs), g({ filter: f.url }, untag(svg))]);
}

/** Warm (or cool) a drawn thing where a light reaches it: its silhouette washed with the light's
 *  color at `level`, as an overlay drawn right after it (and after its veil). Kept for older
 *  callers; to light a drawing, prefer lit(), which costs one drawing and keeps its detail. No
 *  blend mode (the old `mode` option is ignored). */
export function wash(svg, { color = 'warm', level: lv = 0.5 } = {}) {
  if (!(lv > 0.005)) return '';
  const f = floodFilter('wash', lightColor(color), clamp01(lv) * 0.45);
  return g({ 'data-k': 'light', 'data-light': 'wash' }, [el('defs', {}, f.defs), g({ filter: f.url }, untag(svg))]);
}

const rgb01 = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/**
 * Light a drawing with ONE filter on ONE copy of it (hx-4.1; the cheap way to light a critter):
 * `gain` is how much light reaches it (1 = the studio light it was drawn for, below 1 darker,
 * never brighter than `max`), `tint` and `tintLevel` color that light (a warm fridge, a cool
 * moon) the way light colors a surface (a black limb stays black, white goes warm), and `rims` are
 * bright bands on the sides facing lights: [{ side, color, width, level, soft }] (as rim()).
 * Returns the drawing wrapped in the filtered group; its cast tags stay (it is the one critter).
 */
export function lit(svg, { gain = 1, tint = null, tintLevel = 0, rims = [], max = 1.15 } = {}) {
  const g0 = Math.max(0, Math.min(max, gain));
  const tc = tint ? rgb01(lightColor(tint)) : [1, 1, 1];
  const w = tint ? clamp01(tintLevel) : 0;
  // per channel: the light reaching it, colored by the tint, times the drawing's own color
  const ch = tc.map((c) => n2(Math.min(max, g0 * (1 - w) + g0 * w * c + w * 0.25 * c)));
  const rimList = (rims ?? []).filter((r) => r && r.level > 0.005);
  if (g0 > 0.985 && g0 < 1.015 && !w && !rimList.length) return svg;
  const key = hashId(`${ch.join(',')}|${rimList.map((r) => `${r.color}${n2(r.width ?? 6)}${n2(r.level)}${JSON.stringify(r.side)}`).join(';')}`);
  const fid = id(`lit-${key}`);
  const prims = [el('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: `${ch[0]} 0 0 0 0  0 ${ch[1]} 0 0 0  0 0 ${ch[2]} 0 0  0 0 0 1 0`, result: 'lit' })];
  const merge = ['lit'];
  rimList.forEach((r, i) => {
    const [ux, uy] = sideVec(r.side ?? 'key');
    const width = r.width ?? 6;
    // the band: the silhouette minus itself moved away from the light. No blur: a blur over a
    // whole close-up critter costs tens of ms a frame; two offsets (full and half strength) give
    // the band a soft inner edge for almost nothing.
    prims.push(
      el('feOffset', { in: 'SourceAlpha', dx: n2(-ux * width), dy: n2(-uy * width), result: `m${i}` }),
      el('feComposite', { in: 'SourceAlpha', in2: `m${i}`, operator: 'out', result: `b${i}` }),
      el('feOffset', { in: 'SourceAlpha', dx: n2(-ux * width * 0.5), dy: n2(-uy * width * 0.5), result: `h${i}` }),
      el('feComposite', { in: 'SourceAlpha', in2: `h${i}`, operator: 'out', result: `k${i}` }),
      el('feComposite', { in: `b${i}`, in2: `k${i}`, operator: 'arithmetic', k1: 0, k2: 0.45, k3: 0.55, k4: 0, result: `i${i}` }),
      el('feFlood', { 'flood-color': lightColor(r.color ?? 'warm'), 'flood-opacity': n2(clamp01(r.level)), result: `c${i}` }),
      el('feComposite', { in: `c${i}`, in2: `i${i}`, operator: 'in', result: `r${i}` }),
    );
    merge.push(`r${i}`);
  });
  prims.push(el('feMerge', {}, merge.map((m) => el('feMergeNode', { in: m })).join('')));
  const filter = el('filter', { id: fid, x: '-8%', y: '-8%', width: '116%', height: '116%', 'color-interpolation-filters': 'sRGB' }, prims.join(''));
  return g({ 'data-k': 'lit' }, [el('defs', {}, filter), g({ filter: `url(#${fid})` }, svg)]);
}

// ── 4.2: moods and the colour script ──────────────────────────────────────────────────────
//
// A mood is the light of a time (or of the dark mode): the sun or moon as a WORLD-fixed key (the
// same direction in every shot of a scene, CRAFT § 2), a fill, a rim from behind for separation,
// the sky, the haze far things fade into, and whether lamps and windows are lit. lens.js
// rig(P, { mood }) lights a shot with it, set.js exterior() and the beyond of a window paint its
// sky, and draw.js scope(prefix, mood.ground) sets the ground. Night and dark still read: the
// subject is separated by a rim and by lamp pools brighter than everything round it, never by
// lifting the whole frame.

const mixT = (a, b, k) => core.mixHex(T[a] ?? a, T[b] ?? b, k);
/** The moods a frame can be in (4.2). */
export const MOOD_NAMES = ['day', 'evening', 'night', 'dark'];
/**
 * Each mood's light, as data (token names and directions; mood() resolves them). `key`: the sun,
 * moon or stage key, `dir` toward the light in world cm axes (x right, y away from the usual
 * camera, z up), `level`, `color` (a lightColor name or null for white); `rim`: a colored light from
 * behind that only edges things (critterAt draws it as a rim); `sky`: [top, middle, horizon];
 * `haze`: what far things fade toward; `lamps`/`windows`: practicals on; `stars`; `moon` (the
 * night key's source, drawn in the sky where it is). The day sun and the evening sun stand behind
 * or beside the lens (the key lights what faces it); the sky glows on their side.
 */
export const LIGHT_MOODS = {
  day: {
    ground: 'paper', ambient: 0.42,
    key: { dir: [0.5, -0.55, 0.67], level: 0.62, color: null },
    rim: null,
    sky: [['blue-lit', 'paper-lit', 0.3], ['teal-lit', 'paper-lit', 0.62], ['paper-lit', 'yellow-lit', 0.06]],
    haze: ['paper-lit', 'teal-lit', 0.2], hazeK: 0.38,
    lamps: false, windows: 'glass', stars: false, textOn: 'ink',
  },
  evening: {
    ground: 'paper', ambient: 0.26,
    key: { dir: [0.85, -0.2, 0.3], level: 0.55, color: 'warm' },
    rim: { dir: [0.55, 0.75, 0.35], level: 0.1, color: 'warm' },
    sky: [['blue-dark', 'lilac-dark', 0.35], ['lilac-lit', 'blue-lit', 0.3], ['yellow-lit', 'red-lit', 0.16]],
    haze: ['lilac-lit', 'yellow-lit', 0.55], hazeK: 0.42,
    lamps: true, windows: 'some', stars: false, textOn: 'ink',
  },
  night: {
    ground: 'stage', ambient: 0.08,
    key: { dir: [-0.4, 0.55, 0.73], level: 0.15, color: 'cool' },
    rim: { dir: [-0.55, 0.7, 0.45], level: 0.13, color: 'cool' },
    sky: [['ink-shade', 'blue-dark', 0.35], ['blue-dark', 'ink', 0.25], ['blue-dark', 'lilac-dark', 0.35]],
    haze: ['blue-dark', 'ink', 0.2], hazeK: 0.5,
    lamps: true, windows: 'lit', stars: true, moon: true, textOn: 'paper', critterFill: 0.42,
  },
  dark: {
    ground: 'stage', ambient: 0.05,
    key: { dir: [0.5, -0.4, 0.77], level: 0.06, color: 'warm' },
    rim: { dir: [0.6, 0.65, 0.45], level: 0.12, color: 'warm' },
    sky: [['stage-top', 'ink', 0.2], ['stage-top', 'stage-bottom', 0.5], ['stage-bottom', 'ink-lit', 0.35]],
    haze: ['stage-top', 'ink-lit', 0.3], hazeK: 0.55,
    lamps: true, windows: 'some', stars: false, textOn: 'paper', critterFill: 0.48,
  },
};

const nrm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const hexOfTone = (t) => (Array.isArray(t) ? mixT(t[0], t[1], t[2] ?? 0.5) : T[t] ?? t);

/**
 * A mood, resolved: { name, ground ('paper' | 'stage', for scope() and ground()), dark, ambient,
 * key { dir (unit), level, color }, rim | null, sky: [top, middle, horizon] hexes, haze (hex),
 * hazeK, lamps, windows ('glass' | 'some' | 'lit'), stars, moon (drawn where the key comes from), textOn ('ink' | 'paper':
 * the color that reads over its sky), critterFill (a critter's least light at night: it reads) }. `over` overrides any field (a warmer key, a lower sun).
 * An unknown name throws with the list. A mood object passes through (with `over` applied).
 * @param {string | Record<string, any>} name
 * @param {Record<string, any>} [over]
 */
export function mood(name = 'day', over = {}) {
  if (name && typeof name === 'object' && name.mood === true) return Object.keys(over).length ? { ...name, ...over } : name;
  const m = LIGHT_MOODS[name];
  if (!m) throw new Error(`HX: mood "${name}" must be one of ${MOOD_NAMES.join(', ')}`);
  const o = { ...m, ...over };
  return {
    mood: true,
    name,
    ground: o.ground,
    dark: o.ground === 'stage',
    ambient: o.ambient,
    key: o.key ? { ...o.key, dir: nrm(o.key.dir) } : null,
    rim: o.rim ? { ...o.rim, dir: nrm(o.rim.dir) } : null,
    sky: o.sky.map(hexOfTone),
    haze: hexOfTone(o.haze),
    hazeK: o.hazeK,
    lamps: !!o.lamps,
    windows: o.windows,
    stars: !!o.stars,
    moon: !!o.moon,
    textOn: o.textOn,
    critterFill: o.critterFill ?? 0,
  };
}

/** A far thing's color faded into the mood's haze by its distance (cm): atmospheric perspective
 *  (CRAFT § 2: distant planes lighter or darker toward the sky, lower in contrast). */
export function hazed(hex, distCm, m) {
  const M = mood(m ?? 'day');
  const k = Math.min(0.85, M.hazeK * (1 - Math.exp(-Math.max(0, distCm) / 6000)));
  return core.mixHex(hex, M.haze, k);
}

/**
 * The colour script (4.2, CRAFT § 8): the reel's plan of mood and palette per frame, written once by
 * the scene builder (world.js) and read by every frame. `spec` maps frame numbers to a mood name or
 * { mood, palette?: [2–3 tones, the frame's dominant hue family], accent?: tone, note? }, or is a
 * list of { frame, … }. A frame not named holds the one before it (a colour script changes only
 * where the story turns); frame 1 defaults to day.
 * Returns { frames: [{ frame, mood, palette, accent, note }] for 1–7, at(n) → that frame's entry
 * with `light` (the resolved mood()), problems (names that would not resolve: error strings),
 * strip({ x, y, w, h }) → an SVG strip of colour keys, one per frame (sky, ground, palette, accent) }.
 * Passing a colourScript result back returns it unchanged.
 */
export function colourScript(spec = {}) {
  if (spec && spec.colourScript === true) return spec;
  const entries = Array.isArray(spec) ? spec.map((e) => [e.frame, e]) : Object.entries(spec ?? {});
  const named = new Map();
  const problems = [];
  for (const [k, v] of entries) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1 || n > 8) {
      problems.push(`colour script: frame "${k}" must be a frame number 1–8`);
      continue;
    }
    const e = typeof v === 'string' ? { mood: v } : { ...(v ?? {}) };
    if (e.mood !== undefined && !LIGHT_MOODS[e.mood]) problems.push(`colour script frame ${n}: mood "${e.mood}" must be one of ${MOOD_NAMES.join(', ')}`);
    for (const [i, t] of (e.palette ?? []).entries()) {
      try { core.resolveTone(t); } catch { problems.push(`colour script frame ${n}: palette[${i}] ${JSON.stringify(t)} is not a palette color`); }
    }
    if (e.accent !== undefined) {
      try { core.resolveTone(e.accent); } catch { problems.push(`colour script frame ${n}: accent ${JSON.stringify(e.accent)} is not a palette color`); }
    }
    named.set(n, e);
  }
  const frames = [];
  let cur = { mood: 'day', palette: null, accent: null, note: null };
  for (let n = 1; n <= 8; n++) {
    const e = named.get(n);
    if (e) cur = { mood: LIGHT_MOODS[e.mood] ? e.mood : cur.mood, palette: e.palette ?? cur.palette, accent: e.accent ?? cur.accent, note: e.note ?? null };
    else cur = { ...cur, note: null };
    frames.push({ frame: n, ...cur, named: !!e });
  }
  const at = (n) => {
    const f = frames[Math.min(8, Math.max(1, Math.round(n))) - 1];
    return { ...f, light: mood(f.mood) };
  };
  const strip = ({ x = 60, y = 60, w = 960, h = 220, upTo = 7 } = {}) => {
    const cw = w / upTo;
    const cells = [];
    for (let n = 1; n <= upTo; n++) {
      const f = at(n);
      const L = f.light;
      const x0 = x + (n - 1) * cw;
      const gid = id(`cs-${hashId(`${n}${L.sky.join('')}`)}`);
      const pal = (f.palette ?? []).map((t) => core.toneHex(t));
      cells.push(el('defs', {}, el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, L.sky.map((c, i) => el('stop', { offset: [0, 0.6, 1][i], 'stop-color': c })).join(''))));
      cells.push(el('rect', { x: n2(x0 + 4), y, width: n2(cw - 8), height: n2(h * 0.62), rx: 10, fill: `url(#${gid})` }));
      cells.push(el('rect', { x: n2(x0 + 4), y: n2(y + h * 0.62), width: n2(cw - 8), height: n2(h * 0.2), fill: L.dark ? T['ink-lit'] : T['paper-shade'] }));
      pal.forEach((c, i) => cells.push(el('rect', { x: n2(x0 + 8 + i * ((cw - 16) / Math.max(1, pal.length))), y: n2(y + h * 0.86), width: n2((cw - 16) / Math.max(1, pal.length) - 4), height: n2(h * 0.14), rx: 4, fill: c })));
      if (f.accent) cells.push(el('circle', { cx: n2(x0 + cw / 2), cy: n2(y + h * 0.4), r: n2(Math.min(cw, h) * 0.09), fill: core.toneHex(f.accent) }));
      cells.push(el('text', { x: n2(x0 + 14), y: n2(y + 34), 'font-family': 'Roboto, Helvetica, Arial, sans-serif', 'font-weight': 700, 'font-size': 26, fill: L.textOn === 'paper' ? T['paper-lit'] : T.ink }, String(n)));
    }
    return g({ 'data-k': 'colour-script' }, cells);
  };
  return { colourScript: true, frames: frames.slice(0, 7), at, problems, strip };
}
