// The hand-off (Explainers 4.3): frame 3, built by code like the opener and the close. The card
// "today's AI Brain Break: <term>" is the calm focus while the voice says the hand-off line, and the
// reel's OWN analogy world leaks in around it through one of the bank's templates (handoff-bank.js).
// Code writes assets/frames/03-handoff.js (frames.mjs writeHandoff) as one call to handoffFrame();
// nobody builds frame 3.
//
//   handoffCard(t, o)          the card (round-3 look): paper, ink outline, "today's" and
//                              "AI Brain Break:" handwritten, the term in Pragmatica, orange,
//                              underlined; an optional glint
//   handoffFrame(key, o)       frame 3's scene module: { ground, handoff, draw(t) }; `next` is
//                              frame 4's module: its first shot (draw(0)) is the backdrop, so the
//                              cut into frame 4 is a continuation
//
// The world is drawn from assets/world/world.js the way snap.mjs draws it (its first VIEWS camera,
// every LENS entity at its start state), so every template fits any topic. Mapped parts (the
// storyboard's `handoff_parts:`, LENS ids) are rendered alone through that camera and moved to the
// card. Fail open: a world that cannot be drawn leaves the card on its ground, and a template whose
// needs the world cannot meet (no critter hero, fewer than two parts) draws as FALLBACK_HANDOFF.

import { T, el, g, id, ref, scope, handwrite } from './draw.js';
import { textWidth } from './cards.js';
import { lens, rig, render } from './lens.js';
import { critter } from './cast.js';
import { FALLBACK_HANDOFF, HANDOFF_FRAME, handoffByKey, handoffTiming, MAX_PARTS } from './handoff-bank.js';

export { HANDOFF_KEYS } from './handoff-bank.js';

const f1 = (v) => (+v).toFixed(1);
const cl = (x) => Math.max(0, Math.min(1, x));
const seg = (t, a, b) => (b > a ? cl((t - a) / (b - a)) : t >= b ? 1 : 0);
const eo = (u) => 1 - (1 - u) ** 3;
const ei = (u) => u ** 3;
const lerp = (a, b, u) => a + (b - a) * u;
const rnd = (s) => {
  const x = Math.sin(s * 127.1) * 43758.5453;
  return x - Math.floor(x);
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fade = (svg, o) => (o >= 0.999 ? svg : o <= 0.001 ? '' : g({ opacity: o.toFixed(3) }, svg));

/** A mapped part's height on screen as handoff.js renders it, before placing. */
const PART_PX = 170;

/** The card's box (round 3): centred a little above the middle, inside the safe area. */
export const HANDOFF_CARD = { cx: 540, cy: 880, w: 860, h: 560 };

/** The term's lines and size on the card: one line when it reads at 64px or more, else two. */
function termLayout(term, maxW) {
  const fit = (s) => Math.min(150, maxW / Math.max(1, textWidth(s, 1, 'pragmatica-700')));
  const one = fit(term);
  if (one >= 64 || !term.includes(' ')) return { lines: [term], size: Math.max(34, one) };
  const words = term.split(' ');
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const size = Math.min(fit(pair[0]), fit(pair[1]), 110);
    if (!best || size > best.size) best = { lines: pair, size };
  }
  return { lines: best.lines, size: Math.max(34, best.size) };
}

/**
 * The hand-off card (round-3 look, Lucas-approved): a paper card with an ink outline and a soft
 * shadow; "today's" and "AI Brain Break:" write themselves by hand, then the term lands in
 * Pragmatica, orange, with an ink underline. `write` is [start, end] of the writing; `glint` 0..1
 * sweeps one soft glint across it. Returns the group (data-role="title").
 */
export function handoffCard(t, { term = '', write = [0.15, 1.3], glint = null, box = HANDOFF_CARD } = {}) {
  const { cx, cy, w, h } = box;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  // 4.3 fix: the card is never blank: it appears with its first words ("today's") already written
  const p1 = 1;
  const p2 = seg(t, lerp(write[0], write[1], 0.3), lerp(write[0], write[1], 0.75));
  const p3 = seg(t, lerp(write[0], write[1], 0.7), write[1]);
  const parts = [
    el('rect', { x: x0 + 10, y: y0 + 22, width: w, height: h, rx: 34, fill: T['shadow-warm'], opacity: 0.18 }),
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 34, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 4 }),
    handwrite("today's", x0 + 70, y0 + 120, 46, p1, { color: T.ink }),
    handwrite('AI Brain Break:', x0 + 70, y0 + 230, 70, p2, { color: T.ink }),
  ];
  if (p3 > 0 && term) {
    const { lines, size } = termLayout(term, w - 140);
    const s = 0.7 + 0.3 * eo(p3);
    const top = lines.length === 1 ? y0 + 420 : y0 + 360;
    lines.forEach((line, i) => {
      const y = top + i * size * 1.08;
      parts.push(
        g({ opacity: cl(p3 * 2).toFixed(3), transform: `translate(${x0 + 70} ${f1(y)}) scale(${s.toFixed(3)})` },
          el('text', { 'data-k': 'text', x: 0, y: 0, 'font-family': "'Pragmatica Extended'", 'font-weight': 700, 'font-size': f1(size), 'letter-spacing': '-0.02em', fill: T.orange }, esc(line))),
      );
    });
    const last = lines[lines.length - 1];
    const uw = textWidth(last, size, 'pragmatica-700') * eo(seg(p3, 0.4, 1));
    const uy = top + (lines.length - 1) * size * 1.08 + 42;
    if (uw > 2) parts.push(el('path', { d: `M${x0 + 72} ${f1(uy)} q${f1(uw / 2)} 14 ${f1(uw)} -4`, stroke: T.ink, 'stroke-width': 7, fill: 'none', 'stroke-linecap': 'round' }));
  }
  if (glint != null) {
    const gx = x0 - 300 + glint * (w + 600);
    parts.push(
      el('defs', {}, el('clipPath', { id: id('hcard') }, el('rect', { x: x0, y: y0, width: w, height: h, rx: 34 }))),
      g({ 'clip-path': ref('hcard') }, el('polygon', { points: `${f1(gx)},${y0} ${f1(gx + 140)},${y0} ${f1(gx - 40)},${y0 + h} ${f1(gx - 180)},${y0 + h}`, fill: '#fff', opacity: 0.55 })),
    );
  }
  return g({ 'data-role': 'title' }, parts);
}

/** A drawing as a backdrop: its object and lens-frame markers renamed, so no check reads it as things. */
export const asBackdrop = (svg) => String(svg).replace(/\bdata-object=/g, 'data-backdrop-object=').replace(/\bdata-frame-kind=/g, 'data-backdrop-kind=');

const blurDefs = (name, sd) => el('defs', {}, el('filter', { id: id(name), x: '-20%', y: '-20%', width: '140%', height: '140%' }, el('feGaussianBlur', { stdDeviation: f1(sd) })));
const blurred = (name, sd, svg) => (sd > 0.3 ? blurDefs(name, sd) + g({ filter: ref(name) }, svg) : svg);

/** The start value of every STATES variable (snap.mjs's reading). */
const startState = (world) => Object.fromEntries(Object.entries(world?.STATES ?? {}).map(([k, v]) => [k, v && typeof v === 'object' && 'start' in v ? v.start : v]));
const isCam = (v) => Array.isArray(v?.pos) && Array.isArray(v?.target);
/** snap.mjs WORLD_VIEWS[0]: eye level from the front. */
const DEFAULT_VIEW = { pos: [0, -600, 110], target: [0, 0, 80], fov: 38 };

/**
 * The reel's world, ready to draw on `ground`: `scene()` is the whole anchor scene (its first
 * VIEWS camera, every LENS entity at its start state), `part(id)` one LENS entity alone with its
 * screen foot and height. Everything is computed once (the scene is still); null parts are skipped.
 */
function worldOf(world, ground) {
  if (!world || typeof world.ROOM !== 'function') return null;
  const view = (Array.isArray(world.VIEWS) ? world.VIEWS.find(isCam) : null) ?? DEFAULT_VIEW;
  const place = view.place ?? 'main';
  const P = lens(view);
  const state = startState(world);
  let moodLight = null;
  try {
    moodLight = world.COLOUR_SCRIPT?.at?.(HANDOFF_FRAME)?.light ?? null;
  } catch {
    moodLight = null;
  }
  const lights = { ...(moodLight ? { mood: moodLight } : {}), ...(typeof world.LIGHTS === 'function' ? world.LIGHTS(state, place) ?? {} : {}) };
  const R = rig(P, { ground, ...lights });
  const room = place === 'main' ? world.ROOM(P, R, state) : world.ROOM(P, R, state, place);
  const env = Array.isArray(room) ? room : [...(room?.env ?? [])];
  const setItems = Array.isArray(room) ? [] : [...(room?.items ?? [])];
  const itemOf = (key) => {
    const e = world.LENS?.[key];
    const it = typeof e === 'function' ? e(P, R, state, {}) : null;
    return it && typeof it === 'object' && it.svg ? { ...it, id: it.id ?? key } : null;
  };
  const keyed = Object.keys(world.LENS ?? {}).map((key) => [key, itemOf(key)]).filter(([, it]) => it);
  const sceneCache = new Map();
  const partCache = new Map();
  return {
    /** The world scene; `without` leaves out those LENS ids (a gathered part is on screen as itself). */
    scene(without = []) {
      const k = without.join('|');
      if (!sceneCache.has(k)) sceneCache.set(k, render(P, { env, items: [...setItems, ...keyed.filter(([key]) => !without.includes(key)).map(([, it]) => it)] }));
      return sceneCache.get(k);
    },
    /** Where LENS id `key` stands in the world view: its screen foot (x, y) and height px, or null. */
    spot(key) {
      const it = keyed.find(([k2]) => k2 === key)?.[1];
      if (!it || !Array.isArray(it.at)) return null;
      const [x, y] = P(...it.at);
      const sz = world.SIZES?.[key] ?? {};
      const cm = Number(sz.h) || Math.max(Number(sz.w) || 0, Number(sz.d) || 0) || 40;
      const h = (P.scaleAt?.(...it.at) ?? 0) * cm;
      return Number.isFinite(x) && Number.isFinite(y) && h > 0 ? { x, y, h } : null;
    },
    part(key) {
      if (partCache.has(key)) return partCache.get(key);
      let out = null;
      try {
        const first = itemOf(key);
        if (first && Array.isArray(first.at)) {
          // a close camera of its own, in front and a little above, so the part fills PART_PX
          // whatever the world camera made of it (edge-on, tiny or cropped)
          const [ax, ay, az = 0] = first.at;
          const sz = world.SIZES?.[key] ?? {};
          const cm = Math.max(Number(sz.w) || 0, Number(sz.h) || 0, Number(sz.d) || 0) || 40;
          const aim = [ax, ay, az + Number(sz.h || cm) * 0.45];
          const probe = lens({ pos: [ax, ay - 600, aim[2] + 200], target: aim, fov: 38 });
          const dist = Math.max(60, Math.min(6000, (600 * probe.scaleAt(...aim) * cm) / PART_PX));
          const P2 = lens({ pos: [ax, ay - dist, aim[2] + dist * 0.33], target: aim, fov: 38 });
          const R2 = rig(P2, { ground, ...lights });
          const e = world.LENS[key];
          const it = e(P2, R2, state, {});
          if (it?.svg) {
            const [sx, sy] = P2(...(Array.isArray(it.at) ? it.at : first.at));
            out = { svg: render(P2, { env: [], items: [{ ...it, id: it.id ?? key }] }), at: [sx, sy], hpx: PART_PX };
          }
        }
      } catch {
        out = null;
      }
      partCache.set(key, out);
      return out;
    },
  };
}

/** Part `p` moved so its foot sits at (x, y), `height` px tall, turned `rot` degrees. */
const placed = (p, x, y, height, rot = 0) => {
  const k = Math.max(0.25, Math.min(1.6, height / p.hpx));
  return g({ transform: `translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)}) scale(${k.toFixed(3)}) translate(${f1(-p.at[0])} ${f1(-p.at[1])})` }, p.svg);
};

/** A tremble offset at t after the latest of `beats` (a soft shiver, decaying). */
const tremble = (t, beats, amp = 5) => {
  const last = [...beats].reverse().find((a) => t >= a);
  if (last == null) return '';
  const k = amp * Math.exp(-(t - last) * 16);
  return k < 0.05 ? '' : `translate(${f1(k * (rnd(t * 91) - 0.5))} ${f1(k * (rnd(t * 57 + 3) - 0.5))})`;
};

/**
 * Frame 3's scene module for hand-off template `key`. `world` is assets/world/world.js's module;
 * `duration` the frame's length; `term` the storyboard's term; `hero` `{ id, kind }` from the anchor
 * scene; `parts` the LENS ids the storyboard's `handoff_parts:` names (the analogy's mapped parts);
 * `ground` frame 3's storyboard ground.
 * @param {string} key
 * @param {{ world?: any, duration?: number, term?: string, hero?: { id: string, kind: string } | null, parts?: string[], ground?: string }} [o]
 */
export function handoffFrame(key, { world = null, next = null, duration = 3.2, term = '', hero = null, parts = [], ground = 'paper' } = {}) {
  const prefix = `f0${HANDOFF_FRAME}-`;
  const { HIT, write, duration: D, settle } = handoffTiming(duration);
  let W;
  const getWorld = () => {
    if (W !== undefined) return W;
    try {
      W = worldOf(world, ground);
    } catch {
      W = null;
    }
    return W;
  };
  // 4.3 fix: the backdrop is frame 4's FIRST shot, drawn by frame 4 itself at its t = 0 (its camera,
  // its place, its objects' states), so the cut into frame 4 continues the picture instead of
  // jumping from a generic world view. Fail open: no frame 4 (or one that throws) → the world view.
  let NP;
  const nextPic = () => {
    if (NP !== undefined) return NP;
    try {
      const svg = typeof next?.draw === 'function' ? String(next.draw(0) ?? '') : '';
      // its defs get their own ids: frame 4's live copy must never resolve url(#…) to this one,
      // which is hidden once frame 3 ends (its filters then fail and the set drops out)
      const own = svg.replace(/\bid="([^"]+)"/g, 'id="h3$1"').replace(/url\(#([^)]+)\)/g, 'url(#h3$1)').replace(/href="#([^"]+)"/g, 'href="#h3$1"');
      NP = svg && !/NaN|undefined/.test(svg.slice(0, 2000)) ? own : null;
    } catch {
      NP = null;
    }
    return NP;
  };
  // the exit lands EXIT_HOLD early over frame 4's picture (its last frames are that picture
  // exactly); with no frame 4 it runs to the end as before
  const endAt = () => (nextPic() ? settle : D);
  const sceneSvg = () => {
    const np = nextPic();
    if (np) return np;
    try {
      return getWorld()?.scene() ?? '';
    } catch {
      return '';
    }
  };
  const heroLook = hero?.kind === 'critter' && hero.id && world?.CAST?.[hero.id] ? world.CAST[hero.id] : null;
  // the mapped parts the world can draw, each with its LENS id
  const usableKeyed = () => parts.slice(0, MAX_PARTS).map((k) => [k, getWorld()?.part(k) ?? null]).filter(([, p]) => p);
  const usable = () => usableKeyed().map(([, p]) => p);
  // the template actually drawn: one whose needs this world meets, else the fallback
  const resolve = () => {
    const h = handoffByKey(key) ?? handoffByKey(FALLBACK_HANDOFF);
    if (h.needs.includes('critter') && !heroLook) return handoffByKey(FALLBACK_HANDOFF);
    if (h.needs.includes('parts') && usable().length < 2) return handoffByKey(FALLBACK_HANDOFF);
    return h;
  };
  const card = (t, o = {}) => handoffCard(t, { term, write, ...o });
  const box = HANDOFF_CARD;
  const X0 = box.cx - box.w / 2;
  const Y0 = box.cy - box.h / 2;
  const beatsAt = (h) => h.beats.map((u) => u * HIT);
  // the exit every template shares unless it lifts: the card fades as the world comes forward
  const dissolve = (t, before) => {
    const u = seg(t, HIT, endAt());
    return fade(sceneSvg(), eo(u)) + fade(before, 1 - u);
  };
  const lift = (t, under, dir = -1) => {
    const u = seg(t, HIT, endAt());
    return under(u) + fade(g({ transform: `translate(0 ${f1(-1300 * ei(u))}) rotate(${f1(dir * 8 * u)} ${box.cx} ${box.cy})` }, card(t)), 1 - u);
  };
  // The gather templates' exit (EX3-90: each critter drawn once). The gathered parts are the world's
  // own things: while they are on screen the world comes forward without them, and each glides from
  // its place on the card to its place in the world; once the card is gone the whole world stands.
  const gatherExit = (t, ends, under) => {
    const u = seg(t, HIT, endAt());
    if (u >= 0.999) return sceneSvg();
    // over frame 4's own first shot the parts cannot glide to world-camera spots: they settle out
    // with the card while frame 4's picture comes forward
    if (nextPic()) return dissolve(t, under + ends.map(({ p, x, y, h: hh, rot }) => placed(p, x, y, hh, rot)).join(''));
    const keys = ends.map((e) => e.key);
    let scene = '';
    try {
      scene = getWorld()?.scene(keys) ?? '';
    } catch {
      scene = '';
    }
    const e = eo(u);
    const moved = ends.map(({ key, p, x, y, h: hh, rot }) => {
      const to = getWorld()?.spot(key);
      return to ? placed(p, lerp(x, to.x, e), lerp(y, to.y, e), lerp(hh, to.h, e), lerp(rot, 0, e)) : fade(placed(p, x, y, hh, rot), 1 - u);
    });
    return fade(scene, e) + fade(under, 1 - u) + moved.join('');
  };
  const glow = (a, color = T['orange-lit']) => blurDefs('hglow', 90) + el('ellipse', { cx: box.cx, cy: box.cy, rx: 560, ry: 460, fill: color, opacity: a.toFixed(3), filter: ref('hglow') });

  const DRAW = {
    'glimpse-paper'(t) {
      const drift = (u) => g({ transform: `translate(${f1(-30 + 60 * seg(t, 0, D))} 0)` }, blurred('hblur', 16 * (1 - eo(u)), sceneSvg()));
      if (t >= HIT) return lift(t, (u) => fade(drift(u), 0.22 + 0.78 * eo(u)));
      const clip = el('defs', {}, el('clipPath', { id: id('hclip') }, el('rect', { x: X0, y: Y0, width: box.w, height: box.h, rx: 34 })));
      return card(t) + clip + g({ 'clip-path': ref('hclip'), opacity: 0.22 }, drift(0));
    },
    'glimpse-frosted'(t, h) {
      const warm = glow(0.18 * seg(t, h.beats[0] * HIT, h.beats[0] * HIT + 0.8 * HIT * 0.3));
      if (t >= HIT) return lift(t, (u) => blurred('hblur', 18 * (1 - eo(u)), sceneSvg()), 1);
      return blurred('hblur', 18, sceneSvg()) + warm + fade(el('rect', { x: -50, y: -50, width: 1180, height: 2020, fill: T['paper-lit'] }), 0.35) + g({ opacity: 0.93 }, card(t));
    },
    'sound-pair'(t, h) {
      const still = g({ transform: tremble(t, beatsAt(h)) }, card(t));
      return t >= HIT ? dissolve(t, still) : still;
    },
    'sound-steps'(t, h) {
      const still = g({ transform: tremble(t, beatsAt(h), 4) }, card(t));
      return t >= HIT ? dissolve(t, still) : still;
    },
    'peek-critter'(t, h) {
      const [up, blink] = beatsAt(h);
      const u = eo(seg(t, up, up + 0.2 * HIT));
      const c = u > 0 ? critter(box.cx + 230, lerp(Y0 + 260, Y0 + 62, u), { ...heroLook, who: hero.id, s: 1.5, mood: 'curious', look: [-0.5, 0.7], lid: t > blink && t < blink + 0.1 ? 1 : 0 }) : '';
      const still = c + card(t);
      return t >= HIT ? dissolve(t, still) : still;
    },
    'gather-slide'(t, h) {
      const kp = usableKeyed();
      const ps = kp.map(([, p]) => p);
      const spots = [
        { from: [X0 - 260, Y0 + box.h + 230], to: [X0 + 110, Y0 + box.h + 230], r: [-20, -6] },
        { from: [1300, Y0 - 60], to: [X0 + box.w - 50, Y0 + 10], r: [40, 12] },
        { from: [1300, Y0 + box.h + 230], to: [X0 + box.w - 120, Y0 + box.h + 230], r: [80, -12] },
      ];
      const items = ps.map((p, i) => {
        const a = h.beats[i] * HIT;
        if (t < a) return '';
        const v = eo(seg(t, a, a + 0.15 * HIT));
        const s = spots[i];
        return placed(p, lerp(s.from[0], s.to[0], v), lerp(s.from[1], s.to[1], v), 170, lerp(s.r[0], s.r[1], v));
      });
      if (t >= HIT) return gatherExit(t, kp.map(([key, p], i) => ({ key, p, x: spots[i].to[0], y: spots[i].to[1], h: 170, rot: spots[i].r[1] })), card(t));
      const still = (items[1] ?? '') + card(t) + (items[0] ?? '') + (items[2] ?? '');
      return still;
    },
    'gather-drop'(t, h) {
      const kp = usableKeyed();
      const ps = kp.map(([, p]) => p);
      const land = Y0 + box.h + 220;
      const xs = [X0 + 130, X0 + box.w - 130, box.cx];
      const items = ps.map((p, i) => {
        const a = h.beats[i] * HIT;
        if (t < a) return '';
        const d = 0.12 * HIT;
        const u = seg(t, a, a + d);
        const b = t > a + d ? 10 * Math.exp(-(t - a - d) * 14) * Math.abs(Math.sin((t - a - d) * 20)) : 0;
        return placed(p, xs[i], lerp(-200, land, u * u) - b, 160);
      });
      if (t >= HIT) return gatherExit(t, kp.map(([key, p], i) => ({ key, p, x: xs[i], y: land, h: 160, rot: 0 })), card(t));
      return card(t) + items.join('');
    },
    'shine-once'(t, h) {
      const a = h.beats[0] * HIT;
      const gl = t > a - 0.15 * HIT && t < a + 0.15 * HIT ? (t - (a - 0.15 * HIT)) / (0.3 * HIT) : null;
      const still = glow(0.16 * seg(t, 0.15 * HIT, 0.65 * HIT)) + card(t, { glint: gl });
      return t >= HIT ? dissolve(t, still) : still;
    },
    'shine-warm'(t) {
      const beam = (a) => g({ opacity: a.toFixed(3) }, [blurDefs('hbeam', 60), el('polygon', { points: '-200,200 300,200 1300,1800 500,1800', fill: T['yellow-lit'], filter: ref('hbeam'), opacity: 0.55 })]);
      const gl = t > 0.4 * HIT && t < 0.93 * HIT ? eo((t - 0.4 * HIT) / (0.53 * HIT)) : null;
      const still = beam(0.6 * seg(t, 0.1 * HIT, 0.5 * HIT)) + card(t, { glint: gl });
      if (t < HIT) return still;
      const u = seg(t, HIT, endAt());
      return fade(sceneSvg() + beam(0.6 * (1 - u) + 0.25), eo(u)) + fade(still, 1 - u);
    },
  };

  return {
    ground,
    handoff: key,
    draw(t) {
      scope(prefix, ground);
      const h = resolve();
      try {
        // the exit has landed: frame 4's first picture exactly (no drift, beam or ghost card left)
        if (nextPic() && t >= settle) return nextPic();
        const svg = DRAW[h.key](t, h);
        // while the card is up (until halfway through its exit) the world behind it is a glimpse
        // under the card's opaque plate, not objects the card covers: its object markers go
        return seg(t, HIT, endAt()) < 0.55 ? asBackdrop(svg) : svg;
      } catch {
        // fail open: the card alone, on the frame's ground
        scope(prefix, ground);
        return card(t);
      }
    },
  };
}
