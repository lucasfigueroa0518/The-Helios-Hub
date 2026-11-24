// Cables plugged in at both ends (4.3 visual fixes, 2026-10-28). A cable runs from one
// device's named port to another's (objects.js OBJECT_PORTS: a laptop's usb, a router's eth, …),
// leaves each port straight along the port's outward direction, sags between them with gravity
// (slack), rests on the surface it would fall onto, and draws a plug seated in each port. Both ends
// are always in a socket: a cable is never drawn freehand, and never ends in mid-air.
//
//   import { cable, screenCable } from '../kit/connect.js';
//   const lap = lensObject(P, OBJ.laptop, { t, rig: R });
//   const cam = lensObject(P, OBJ.camera, { t, rig: R });
//   render(P, { env, items: [lap, cam, cable(P, lap.ports.usb, cam.ports.usb, { slack: 0.3, color: 'teal', rest: DESK_Z })] });
//
// A screen object (object()) gives its ports with portsAt(obj, t, segments); screenCable() joins them.
// A world-built thing with a socket of its own (a camera made of lens solids) passes a port by hand:
// { at: [x, y, z] (cm, the socket's mouth), dir: [dx, dy, dz] (outward) }.

import { el, g } from './draw.js';
import { ramp } from './core.js';

const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function smooth(pts) {
  if (pts.length < 3) return `M ${pts.map((p) => `${r1(p[0])} ${r1(p[1])}`).join(' L ')}`;
  let d = `M ${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const m = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
    d += ` Q ${r1(pts[i][0])} ${r1(pts[i][1])} ${r1(m[0])} ${r1(m[1])}`;
  }
  const z = pts[pts.length - 1];
  return `${d} L ${r1(z[0])} ${r1(z[1])}`;
}

/** A soft round strand through screen points, width w px, in tone ramp c. */
function strand(d, w, c) {
  return el('g', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
    el('path', { d, stroke: c.shade ?? c.dark, 'stroke-width': r1(w) }),
    el('path', { d, stroke: c.base, 'stroke-width': r1(w * 0.66), transform: `translate(${r1(w * 0.1)} ${r1(-w * 0.12)})` }),
    el('path', { d, stroke: c.lit ?? c.top, 'stroke-width': r1(Math.max(1, w * 0.2)), opacity: 0.85, transform: `translate(${r1(w * 0.2)} ${r1(-w * 0.24)})` }),
  ].join(''));
}

function tones(color) {
  try {
    const c = ramp(color);
    if (c?.base) return c;
  } catch {
    // an unknown tone: ink
  }
  return ramp('ink');
}

function portOf(where, p) {
  if (!p || typeof p !== 'object') throw new Error(`HX: ${where}: each end is a port (item.ports.<name>, from lensObject or portsAt), never a loose point.`);
  return p;
}

/** The plug at a port: its boot from the socket's mouth outward (screen points a → b, width w). */
function plug(a, b, w, c) {
  const d = `M ${r1(a[0])} ${r1(a[1])} L ${r1(b[0])} ${r1(b[1])}`;
  const boot = mixPlug(c);
  return [
    el('path', { d, stroke: boot.dark, 'stroke-width': r1(w * 1.25), 'stroke-linecap': 'butt', fill: 'none' }),
    el('path', { d, stroke: boot.base, 'stroke-width': r1(w * 0.9), 'stroke-linecap': 'butt', fill: 'none', transform: `translate(${r1(w * 0.08)} ${r1(-w * 0.1)})` }),
    el('circle', { cx: r1(a[0]), cy: r1(a[1]), r: r1(w * 0.55), fill: boot.dark, opacity: 0.55 }),
  ].join('');
}
const mixPlug = (c) => ({ dark: c.shade ?? c.dark, base: c.lit ?? c.top });

/**
 * A cable from port to port through the lens P (ports: lensObject(…).ports.<name>, or { at, dir } cm). Options: slack (0 taut … 1 loose, default 0.25), color (a
 * tone name, default 'ink'), r (cable radius cm, default 0.45), rest (the surface z it lies on; by
 * default just under the lower port), id, set (default true: drawn whatever a shot's cast, like the
 * set dressing it joins; false for a story cable the cast names). Returns a render() item { id, at, bounds, svg, ends }
 * whose svg carries data-cable with its two ports, so the frame check can see it is plugged in.
 */
export function cable(P, from, to, opts = {}) {
  if (typeof P !== 'function' || typeof P.scaleAt !== 'function') throw new Error('HX: cable(P, from, to): P is a lens.js lens(); a screen picture uses screenCable(from, to).');
  const a = portOf('cable()', from);
  const b = portOf('cable()', to);
  if (!Array.isArray(a.at) || !Array.isArray(b.at)) throw new Error('HX: cable(): a port through the lens has `at` (cm): pass lensObject(P, obj, …).ports.<name>, or { at, dir } for a socket you built.');
  const { slack = 0.25, color = 'ink', r = 0.45, id = 'cable', rest = null, set = true } = opts;
  const dirOf = (p) => {
    const d = Array.isArray(p.dir) ? p.dir : [0, 0, 0];
    const l = Math.hypot(...d) || 1;
    return d.map((c) => c / l);
  };
  const da = dirOf(a);
  const db = dirOf(b);
  const k = Math.max(a.k ?? 0.3, b.k ?? 0.3);
  const plugL = clamp(14 * k, 1.6, 5); // the plug's boot, cm
  const lead = plugL + clamp(10 * k, 1, 4); // straight out of the socket before it bends
  const out = (p, d, s) => [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
  const a1 = out(a.at, da, plugL);
  const b1 = out(b.at, db, plugL);
  const a2 = out(a.at, da, lead);
  const b2 = out(b.at, db, lead);
  const floorZ = rest ?? Math.min(a.at[2], b.at[2]) - Math.max(1.2, 6 * k);
  const span = Math.hypot(b2[0] - a2[0], b2[1] - a2[1], b2[2] - a2[2]);
  const sag = clamp(slack, 0, 1) * span * 0.5 + 0.5;
  const pts = [a1, a2];
  const N = 22;
  for (let i = 1; i < N; i++) {
    const u = i / N;
    const p = [a2[0] + (b2[0] - a2[0]) * u, a2[1] + (b2[1] - a2[1]) * u, a2[2] + (b2[2] - a2[2]) * u];
    // gravity: a catenary-like dip, and the cable lies on the surface where it would fall through
    p[2] = Math.max(floorZ + r, p[2] - sag * 4 * u * (1 - u));
    pts.push(p);
  }
  pts.push(b2, b1);
  const scr = pts.map((p) => P(...p));
  if (scr.some((p) => !(p[2] > 1))) return { id, at: a.at, bounds: [a.at, a.at], svg: '', ends: [a.at, b.at] };
  const mid = pts[Math.floor(pts.length / 2)];
  const w = Math.max(2.2, 2 * r * P.scaleAt(...mid));
  const c = tones(color);
  const pa = P(...a.at);
  const pb = P(...b.at);
  const wa = Math.max(3, 2 * r * 1.7 * P.scaleAt(...a.at));
  const wb = Math.max(3, 2 * r * 1.7 * P.scaleAt(...b.at));
  const svg = g({ 'data-cable': id, 'data-ends': `${r1(pa[0])},${r1(pa[1])} ${r1(pb[0])},${r1(pb[1])}` }, [
    strand(smooth(scr.map((p) => [p[0], p[1]])), w, c),
    plug([pa[0], pa[1]], [scr[0][0], scr[0][1]], wa, tones('paper')),
    plug([pb[0], pb[1]], [scr[scr.length - 1][0], scr[scr.length - 1][1]], wb, tones('paper')),
  ]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const zs = pts.map((p) => p[2]);
  return { id, set, at: mid, bounds: [[Math.min(...xs), Math.min(...ys), Math.min(...zs)], [Math.max(...xs), Math.max(...ys), Math.max(...zs)]], svg, ends: [a.at, b.at] };
}

/**
 * A cable in a flat picture between two screen ports (portsAt(obj, t).<name>).
 * Each { screen: [x, y], sdir: [dx, dy] }: out of each socket along its direction, a gravity sag (slack 0…1), a plug
 * seated in each. `rest` is the screen y it lies on (a table line), optional. Returns SVG.
 */
export function screenCable(from, to, opts = {}) {
  const a = portOf('screenCable()', from);
  const b = portOf('screenCable()', to);
  if (!Array.isArray(a.screen) || !Array.isArray(b.screen)) throw new Error('HX: screenCable(): a port has `screen` [x, y]: pass portsAt(obj, t).<name>.');
  const { slack = 0.25, color = 'ink', width = 9, rest = null, id = 'cable' } = opts;
  const sd = (p) => {
    const d = Array.isArray(p.sdir) ? p.sdir : [0, 1];
    const l = Math.hypot(...d) || 1;
    return [d[0] / l, d[1] / l];
  };
  const da = sd(a);
  const db = sd(b);
  const plugL = width * 2.4;
  const lead = plugL + width * 2;
  const at = (p, d, s) => [p[0] + d[0] * s, p[1] + d[1] * s];
  const a1 = at(a.screen, da, plugL);
  const b1 = at(b.screen, db, plugL);
  const a2 = at(a.screen, da, lead);
  const b2 = at(b.screen, db, lead);
  const span = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
  const sag = clamp(slack, 0, 1) * span * 0.5;
  const pts = [a1, a2];
  const N = 18;
  for (let i = 1; i < N; i++) {
    const u = i / N;
    let y = a2[1] + (b2[1] - a2[1]) * u + sag * 4 * u * (1 - u);
    if (rest != null) y = Math.min(rest - width / 2, y);
    pts.push([a2[0] + (b2[0] - a2[0]) * u, y]);
  }
  pts.push(b2, b1);
  const c = tones(color);
  return g({ 'data-cable': id, 'data-ends': `${r1(a.screen[0])},${r1(a.screen[1])} ${r1(b.screen[0])},${r1(b.screen[1])}` }, [
    strand(smooth(pts), width, c),
    plug(a.screen, a1, width * 1.7, tones('paper')),
    plug(b.screen, b1, width * 1.7, tones('paper')),
  ]);
}
