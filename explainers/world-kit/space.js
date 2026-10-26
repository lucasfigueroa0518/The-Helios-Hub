// The Explainers world kit, space (hx-4, approved stills 01, 02, 04 and 05): one room, one camera,
// true scale. Every world entity has a real size in centimetres; a scene places everything in
// centimetres on one floor plane through the kit's isometric projection, draws it back to front,
// puts what is inside a container behind its frame, and makes tiny things readable with a
// magnifier instead of drawing them huge.
//
//   scene({ ppcm, origin, P })        cm → screen on the iso floor: { at, size, depth, s, critterS, … }
//   sizes(SIZES)                      validate the world's scale ledger; scaleOf(id, px) helpers
//   scaleProblems(SIZES, drawn)       entities drawn off their real size (relative to the critter)
//   depthSort(items)                  [{ at: [x, y, z], svg }] joined back to front
//   container({ clip, back, contents, front })   inside means behind the frame
//   magnifier({ from, at, r, zoom, draw })        a lens inset with its zoom cone (still 02)
//
// The ruler is the critter: CRITTER_CM (72 cm) tall. Story exaggeration is declared per entity in
// SIZES (`exaggerate`, at most 1.5×); anything else is drawn at its real size.

import * as core from './core.js';
import { T, el, g, id, line, isDark, groundName } from './draw.js';
import { blurDef, hashId } from './light.js';

const n2 = (v) => Number(v.toFixed(2));

/** A critter's height in cm: the ruler every size is measured against. */
export const CRITTER_CM = core.CRITTER_CM ?? 72;
/** A critter's height in px at scale 1 (cast.js: feet at y, body top at y − 142). */
export const CRITTER_PX = core.CRITTER_PX ?? 142;
/** Screen px per cm at critter scale 1. */
export const PX_PER_CM = core.PX_PER_CM ?? CRITTER_PX / CRITTER_CM;
/** Story exaggeration is capped here (approved still 01). */
export const MAX_EXAGGERATION = 1.5;
/** An entity with no declared exaggeration may be this far off its real size (drawing slack). */
export const SIZE_TOLERANCE = 1.15;

// ── The scene: centimetres on one floor plane ─────────────────────────────────────────────

/**
 * A scene in centimetres on the kit's iso projection (x right-back, y left-back, z up; the floor
 * is z = 0). `ppcm` is screen px per cm (a 72 cm critter stands 72·ppcm px tall); `origin` the
 * screen point of world (0, 0, 0). Pass `P`, an existing kit projection (core.iso(ox, oy, s)), to
 * share the frame's projection: cm are converted into its units and `origin`, if given, moves it.
 *
 * Returns `at(x, y, z)` (cm → screen; also usable as the `P` of isoBox, isoDisc and props, so
 * their sizes are in cm), `s` (= ppcm, the `s` of onPlane, isoPlane and ring), `size(cm)` (px),
 * `depth(x, y, z)` (larger is nearer), `critterS` (the critter() scale for a true 72 cm critter)
 * and `heldScale(cm, px)` (the scale for art `px` tall at its real size `cm`).
 */
export function scene({ ppcm = PX_PER_CM, origin, P } = {}) {
  if (!(ppcm > 0)) throw new Error(`space.scene: ppcm must be a positive number of px per cm, not ${ppcm}`);
  let at;
  if (P) {
    const o = P(0, 0, 0);
    const s = o[1] - P(0, 0, 1)[1];
    if (!(s > 0)) throw new Error('space.scene: P must be a kit iso projection (z up)');
    const k = ppcm / s;
    const dx = origin ? origin[0] - o[0] : 0;
    const dy = origin ? origin[1] - o[1] : 0;
    at = (x, y, z = 0) => {
      const q = P(x * k, y * k, z * k);
      return [q[0] + dx, q[1] + dy];
    };
  } else {
    const [ox, oy] = origin ?? [540, 1100];
    at = core.iso(ox, oy, ppcm);
  }
  return {
    at,
    P: at,
    s: ppcm,
    ppcm,
    size: (cm) => cm * ppcm,
    depth,
    critterS: ppcm / PX_PER_CM,
    heldScale: (cm, px) => (cm * ppcm) / px,
  };
}

/**
 * The SVG transform that lays flat 2D drawing on any world face: local (u, v) = (1, 0) is the
 * world vector `u` from `origin`, (0, 1) is `v` (cm; e.g. a sign on the wall x = 0:
 * plane(at, [0, 120, 230], [0, 1, 0], [0, 0, -1]), its text then in cm along the wall).
 */
export function plane(at, origin, u, v) {
  const o = at(...origin);
  const a = at(origin[0] + u[0], origin[1] + u[1], origin[2] + u[2]);
  const b = at(origin[0] + v[0], origin[1] + v[1], origin[2] + v[2]);
  const m = [a[0] - o[0], a[1] - o[1], b[0] - o[0], b[1] - o[1], o[0], o[1]];
  return `matrix(${m.map((x) => x.toFixed(4)).join(' ')})`;
}

/** The draw order key of a world point (cm): larger is nearer the viewer, so it is drawn later.
 *  Use the centre of the thing's floor footprint; height breaks ties (what sits on top of
 *  something is drawn after it). */
export function depth(x, y, z = 0) {
  return x + y + z * 1e-3;
}

/** Items [{ at: [x, y, z], svg, depth? }] joined back to front (stable for equal depth). Falsy
 *  items and empty svg are skipped. */
export function depthSort(items) {
  return items
    .filter((it) => it && it.svg)
    .map((it, i) => ({ i, k: it.depth ?? depth(it.at[0], it.at[1], it.at[2] ?? 0), svg: it.svg }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((it) => it.svg)
    .join('');
}

// ── The scale ledger (SIZES) ──────────────────────────────────────────────────────────────

const CM_KEYS = ['w', 'd', 'h'];

/** The problems with a world's SIZES ({ id: { w, d, h } } in cm, `exaggerate?` ≤ 1.5, `far?`). */
export function sizeProblems(SIZES) {
  if (!SIZES || typeof SIZES !== 'object' || Array.isArray(SIZES)) return ['SIZES must be an object { id: { w, d, h } } of real sizes in cm'];
  const out = [];
  for (const [key, s] of Object.entries(SIZES)) {
    if (!s || typeof s !== 'object') {
      out.push(`SIZES.${key} must be { w, d, h } in cm`);
      continue;
    }
    for (const k of CM_KEYS) if (!(typeof s[k] === 'number' && s[k] > 0 && Number.isFinite(s[k]))) out.push(`SIZES.${key}.${k} must be a positive number of cm (got ${JSON.stringify(s[k] ?? null)})`);
    if (s.exaggerate !== undefined) {
      const e = s.exaggerate;
      if (!(typeof e === 'number' && e > 0)) out.push(`SIZES.${key}.exaggerate must be a number`);
      else if (e > MAX_EXAGGERATION + 1e-9 || e < 1 / MAX_EXAGGERATION - 1e-9) out.push(`SIZES.${key}.exaggerate is ${e}×; story exaggeration is capped at ${MAX_EXAGGERATION}× (and ${n2(1 / MAX_EXAGGERATION)}× for a shrink)`);
    }
  }
  return out;
}

/**
 * Validate a world's SIZES and get its helpers: `problems` (error strings), `ok`, `cm(id)` (the
 * real size), `px(id, { ppcm, axis })` (how many px it is drawn at, with its exaggeration) and
 * `scaleOf(id, drawnPxHeight, { ppcm })` (the scale for art drawn `drawnPxHeight` px tall at scale
 * 1, so it comes out at its ledger size next to a critter of that scene; ppcm defaults to the
 * critter at scale 1).
 */
export function sizes(SIZES) {
  const problems = sizeProblems(SIZES);
  const get = (key) => {
    const s = SIZES?.[key];
    if (!s) throw new Error(`space.sizes: "${key}" has no real size in SIZES`);
    return s;
  };
  const px = (key, { ppcm = PX_PER_CM, axis = 'h' } = {}) => get(key)[axis] * (get(key).exaggerate ?? 1) * ppcm;
  return {
    problems,
    ok: problems.length === 0,
    cm: (key) => ({ w: get(key).w, d: get(key).d, h: get(key).h }),
    px,
    scaleOf: (key, drawnPxHeight, o = {}) => px(key, o) / drawnPxHeight,
  };
}

/** How far a drawn entity is from its real size, relative to the critter (1 = true scale). */
function factorOf(real, drawnPx, critterPx, axis) {
  return (drawnPx / critterPx) / (real[axis] / CRITTER_CM);
}

/**
 * The scale check (try.mjs): `drawn` is one sample or a list of samples, each
 * `{ t?, critter: px | critterS: s, <id>: px | { h | w | d: px, far? } }` — a critter's drawn
 * height (or its critter() scale) and each entity's drawn height (or width or depth) in the
 * same picture. An entity more than its allowed exaggeration away from its real size relative to
 * the critter is an error: the allowance is its declared `exaggerate` (≤ 1.5×), else
 * SIZE_TOLERANCE. Entities marked `far` (seen through a window, far away) are skipped.
 */
export function scaleProblems(SIZES, drawn) {
  const out = sizeProblems(SIZES);
  if (out.length) return out;
  const samples = Array.isArray(drawn) ? drawn : [drawn];
  const seen = new Set();
  for (const sample of samples) {
    if (!sample) continue;
    const at = typeof sample.t === 'number' ? ` at ${sample.t.toFixed(2)}s` : '';
    const critterPx = sample.critter ?? (sample.critterS ? sample.critterS * CRITTER_PX : null);
    if (!(critterPx > 0)) {
      out.push(`the scale check needs a critter's drawn height${at} (critter: px or critterS: scale) to measure against`);
      continue;
    }
    for (const [key, v] of Object.entries(sample)) {
      if (key === 't' || key === 'critter' || key === 'critterS') continue;
      const real = SIZES[key];
      if (!real) {
        if (!seen.has(`missing:${key}`)) out.push(`"${key}" is drawn but has no real size in SIZES ({ w, d, h } in cm)`);
        seen.add(`missing:${key}`);
        continue;
      }
      if (real.far || v?.far) continue;
      const axis = typeof v === 'number' ? 'h' : CM_KEYS.find((k) => typeof v?.[k] === 'number');
      const px = typeof v === 'number' ? v : v?.[axis];
      if (!axis || !(px > 0)) continue;
      const f = factorOf(real, px, critterPx, axis);
      const allowed = real.exaggerate !== undefined ? Math.max(real.exaggerate, 1 / real.exaggerate) : SIZE_TOLERANCE;
      if (f > allowed + 1e-6 || f < 1 / allowed - 1e-6) {
        const tag = `${key}:${f > 1 ? 'big' : 'small'}`;
        if (seen.has(tag)) continue;
        seen.add(tag);
        const realPx = real[axis] * (critterPx / CRITTER_CM);
        const hint = real.exaggerate !== undefined
          ? `its SIZES allow ${n2(allowed)}×`
          : `draw it at ${Math.round(realPx)} px, or declare exaggerate (at most ${MAX_EXAGGERATION}×) in SIZES`;
        out.push(`"${key}" is drawn ${n2(f)}× its real size${at} (${real[axis]} cm ${axis === 'h' ? 'tall' : axis === 'w' ? 'wide' : 'deep'} next to a ${CRITTER_CM} cm critter is ${Math.round(realPx)} px, drawn ${Math.round(px)} px): ${hint}`);
      }
    }
  }
  return out;
}

// ── Containers: inside means behind the frame (still 05) ──────────────────────────────────

const toD = (clip) => (Array.isArray(clip) ? `M ${clip.map((p) => `${n2(p[0])} ${n2(p[1])}`).join(' L ')} Z` : clip);

/**
 * A container drawn so its contents sit inside it: `back` (the inner walls and floor seen through
 * the opening) and `contents` are clipped to the opening `clip` (screen points or a path d), a
 * soft occlusion shade darkens the inside along the opening's edge, and `front` (the frame ring,
 * the shell, the door edge) is drawn over them. Pass `ao: 0` for no shade.
 */
export function container({ clip, back = '', contents = '', front = '', ao = 0.16 } = {}) {
  if (!clip) throw new Error('space.container: clip (the opening, screen points or a path d) is required');
  const d = toD(clip);
  const cid = id(`ctr-${hashId(d)}`);
  const inside = [back, contents];
  if (ao > 0) {
    const pts = Array.isArray(clip) ? clip : null;
    const span = pts ? Math.min(Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]))) : 300;
    const w = Math.max(6, span * 0.07);
    const f = blurDef(w * 0.6, { name: 'ctrao' });
    inside.push(el('defs', {}, f.defs) + el('path', { d, fill: 'none', stroke: T.ink, 'stroke-width': n2(w), opacity: n2(isDark() ? ao * 1.6 : ao), filter: f.url }));
  }
  return g({ 'data-k': 'container' }, [
    el('defs', {}, el('clipPath', { id: cid }, el('path', { d }))),
    g({ 'clip-path': `url(#${cid})` }, inside),
    front,
  ]);
}

// ── The magnifier (still 02) ──────────────────────────────────────────────────────────────

/** The flat fill of a ground by name (aliases resolved when core has them). */
function groundFill(name) {
  try {
    if (typeof core.groundOf === 'function') return core.groundOf(name).fill;
  } catch {
    // an unknown name: the paper fill below
  }
  return core.GROUNDS[name]?.fill ?? T.paper;
}

/** The two outer tangents between circles (c1, r1) and (c2, r2): [[p1, p2], [q1, q2]], or null. */
function tangents(c1, r1, c2, r2) {
  const dx = c2[0] - c1[0];
  const dy = c2[1] - c1[1];
  const d = Math.hypot(dx, dy);
  if (d <= Math.abs(r1 - r2) + 1e-6) return null;
  const a = Math.atan2(dy, dx);
  const b = Math.acos((r1 - r2) / d);
  return [1, -1].map((sg) => {
    const t = a + sg * b;
    return [[c1[0] + r1 * Math.cos(t), c1[1] + r1 * Math.sin(t)], [c2[0] + r2 * Math.cos(t), c2[1] + r2 * Math.sin(t)]];
  });
}

/**
 * A lens inset that makes a tiny thing readable without drawing it huge: the scene point `from`
 * is shown magnified `zoom`× in a lens of radius `r` centred on `at`, joined to a ring round
 * `from` by a soft zoom cone. `draw(ctx)` returns the scene's SVG around `from` in scene
 * coordinates; the kit scales it up and clips it to the lens. Line weights are chosen for the
 * lens, not scaled up: `ctx.lw(px)` turns an on-screen width into local units (px / zoom), and
 * `ctx.zoom` lets it add detail only the lens shows. `label` puts the ×N chip on the rim.
 */
export function magnifier({ from, at, r = 220, zoom = 4, draw, label = true } = {}) {
  if (!from || !at) throw new Error('space.magnifier: from and at are required');
  if (!(zoom > 1)) throw new Error('space.magnifier: zoom must be more than 1');
  const R0 = r / zoom;
  const ink = line();
  const dark = isDark();
  const ground = groundFill(groundName());
  const key = hashId(`${n2(at[0])},${n2(at[1])},${n2(r)}`);
  const lensId = id(`lens-${key}`);
  const out = [];
  const defs = [el('clipPath', { id: lensId }, el('circle', { cx: n2(at[0]), cy: n2(at[1]), r: n2(r) }))];
  // The cone: a faint wedge and two dotted tangents from the source ring to the lens.
  const tg = tangents(from, R0, at, r);
  if (tg) {
    const [[p0, p1], [q0, q1]] = tg;
    out.push(el('path', { d: `M ${n2(p0[0])} ${n2(p0[1])} L ${n2(p1[0])} ${n2(p1[1])} L ${n2(q1[0])} ${n2(q1[1])} L ${n2(q0[0])} ${n2(q0[1])} Z`, fill: ink, opacity: dark ? 0.07 : 0.05 }));
    for (const [a, b] of tg) out.push(el('path', { d: `M ${n2(a[0])} ${n2(a[1])} L ${n2(b[0])} ${n2(b[1])}`, stroke: ink, 'stroke-width': 2.2, 'stroke-dasharray': '1 8', 'stroke-linecap': 'round', opacity: 0.6, fill: 'none' }));
  }
  out.push(el('circle', { cx: n2(from[0]), cy: n2(from[1]), r: n2(R0), fill: 'none', stroke: ink, 'stroke-width': 3, opacity: 0.85 }));
  // The lens: a soft drop shadow, the ground, the scene redrawn at zoom, glass, the rim.
  const sh = blurDef(r * 0.12, { name: 'lensshadow' });
  defs.push(sh.defs);
  out.push(el('circle', { cx: n2(at[0]), cy: n2(at[1] + r * 0.09), r: n2(r), fill: T.ink, opacity: dark ? 0.45 : 0.18, filter: sh.url }));
  const ctx = { zoom, from, at, r, lw: (px) => px / zoom };
  const inner = typeof draw === 'function' ? draw(ctx) : draw ?? '';
  const sheen = id(`lenssheen-${key}`);
  defs.push(el('radialGradient', { id: sheen, cx: 0.3, cy: 0.22, r: 0.75 }, [
    el('stop', { offset: 0, 'stop-color': T.canvas, 'stop-opacity': dark ? 0.16 : 0.5 }),
    el('stop', { offset: 0.5, 'stop-color': T.canvas, 'stop-opacity': 0.06 }),
    el('stop', { offset: 1, 'stop-color': T.canvas, 'stop-opacity': 0 }),
  ].join('')));
  out.push(g({ 'clip-path': `url(#${lensId})` }, [
    el('rect', { x: n2(at[0] - r), y: n2(at[1] - r), width: n2(2 * r), height: n2(2 * r), fill: ground }),
    g({ transform: `translate(${n2(at[0])} ${n2(at[1])}) scale(${n2(zoom)}) translate(${n2(-from[0])} ${n2(-from[1])})` }, inner),
    el('circle', { cx: n2(at[0]), cy: n2(at[1]), r: n2(r), fill: `url(#${sheen})` }),
  ]));
  const rimW = Math.max(4, r * 0.034);
  out.push(el('circle', { cx: n2(at[0]), cy: n2(at[1]), r: n2(r), fill: 'none', stroke: dark ? T['paper-lit'] : T.ink, 'stroke-width': n2(rimW) }));
  out.push(el('circle', { cx: n2(at[0]), cy: n2(at[1]), r: n2(r - rimW * 1.3), fill: 'none', stroke: T.canvas, 'stroke-width': 3, opacity: 0.85 }));
  // A highlight arc on the rim, top left (the key light is top right; the glass reflects it back).
  const arc = (a0, a1, rr) => `M ${n2(at[0] + rr * Math.cos(a0))} ${n2(at[1] + rr * Math.sin(a0))} A ${n2(rr)} ${n2(rr)} 0 0 1 ${n2(at[0] + rr * Math.cos(a1))} ${n2(at[1] + rr * Math.sin(a1))}`;
  out.push(el('path', { d: arc(Math.PI * 1.08, Math.PI * 1.38, r - rimW * 2.6), fill: 'none', stroke: T.canvas, 'stroke-width': n2(rimW * 0.9), 'stroke-linecap': 'round', opacity: 0.7 }));
  if (label) {
    const a = -Math.PI * 0.3;
    const cx = at[0] + r * Math.cos(a);
    const cy = at[1] + r * Math.sin(a);
    const txt = `×${Math.round(zoom * 10) / 10}`;
    const h = Math.max(30, r * 0.18);
    const w = h * (0.9 + 0.45 * txt.length);
    out.push(el('rect', { x: n2(cx - w / 2), y: n2(cy - h / 2), width: n2(w), height: n2(h), rx: n2(h / 2), fill: dark ? T['paper-lit'] : T.ink }));
    out.push(el('text', { 'data-k': 'text', 'data-text': txt, x: n2(cx), y: n2(cy + h * 0.17), 'text-anchor': 'middle', 'font-family': "'Pragmatica Extended', Roboto", 'font-weight': 700, 'font-size': n2(h * 0.48), fill: dark ? T.ink : T.canvas }, txt));
  }
  return g({ 'data-k': 'magnifier' }, [el('defs', {}, defs.join('')), ...out]);
}
