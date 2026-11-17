// Shared drawing helpers for props batches D and E (hx-6 library tripling, 2026-11-16). The same
// helpers batch-a.js keeps local (revolve, rounded, disc, lens, ink), plus a few screen-space ones.

import { T, el, g, line, P0, RX, shade, mark } from './kit.js';
import { tonesOf } from '../draw.js';

export const f = (v) => +(+v).toFixed(1);
/** ry / rx of a horizontal circle seen in iso. */
export const K = Math.tan(Math.PI / 6);
export const pts = (list) => list.map((p) => P0(...p).map(f).join(',')).join(' ');

/** Tones from a named T colour family (wood, slate, mustard, leaf ...). */
export const tone = (name) => tonesOf({ base: T[name], lit: T[`${name}-lit`], shade: T[`${name}-shade`], dark: T[`${name}-dark`] });

/** A flat polygon through world points. */
export const quad = (list, fill, sw = 3.5) => el('polygon', { points: pts(list), fill, stroke: line(), 'stroke-width': sw, 'stroke-linejoin': 'round' });

/** A horizontal circle seen in iso: screen center (cx, cy), screen radius rx. */
export const disc = (cx, cy, rx, fill, sw = 3.5) => el('ellipse', { cx: f(cx), cy: f(cy), rx: f(rx), ry: f(rx * K), fill, stroke: line(), 'stroke-width': sw });

/** The front half of a horizontal circle at height z, screen radius rx. */
export const frontArc = (z, rx) => `M ${f(-rx)} ${f(-z)} A ${f(rx)} ${f(rx * K)} 0 0 0 ${f(rx)} ${f(-z)}`;

/** Outline of an upright round body about the origin; profile [[z, r], ...] bottom to top. */
export function revolve(profile, step = 1.5) {
  const rings = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [z0, r0] = profile[i];
    const [z1, r1] = profile[i + 1];
    const n = Math.max(1, Math.ceil(Math.abs(z1 - z0)));
    for (let k = 0; k < n; k++) rings.push([z0 + ((z1 - z0) * k) / n, RX(r0 + ((r1 - r0) * k) / n)]);
  }
  const last = profile[profile.length - 1];
  rings.push([last[0], RX(last[1])]);
  const xm = Math.max(...rings.map((r) => r[1])) - 0.01;
  const topEdge = [];
  const botEdge = [];
  for (let x = -xm; x <= xm + 1e-6; x = x + step > xm && x < xm ? xm : x + step) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const [z, rx] of rings) {
      if (rx <= Math.abs(x)) continue;
      const h = rx * K * Math.sqrt(1 - (x / rx) ** 2);
      lo = Math.min(lo, -z - h);
      hi = Math.max(hi, -z + h);
    }
    if (lo < Infinity) {
      topEdge.push(`${f(x)} ${f(lo)}`);
      botEdge.push(`${f(x)} ${f(hi)}`);
    }
  }
  return `M ${topEdge.join(' L ')} L ${botEdge.reverse().join(' L ')} Z`;
}

/** A detail line in ink, kept a crisp line by soften() (data-hard) so it shows on the stage too. */
export const ink = (d, sw = 3, opacity = 1) => g({ 'data-hard': 1 }, el('path', { d, fill: 'none', stroke: T.ink, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity }));

/** A round body: flat side tone, shading toward the right, soft outline. */
export const rounded = (d, tones, fill = tones[1]) => [el('path', { d, fill }), shade(d, { x1: 0, y1: 0, x2: 1, y2: 0, from: 0, to: 0.34 }), mark(d, 3.5)];

/** The visible part of a surface sitting `drop` px below a rim of screen radius rx at screen y = cy. */
export function lens(cy, rx, drop) {
  const ry = rx * K;
  const yi = cy + drop / 2;
  const xi = rx * Math.sqrt(Math.max(0, 1 - (drop / 2 / ry) ** 2));
  return `M ${f(-xi)} ${f(yi)} A ${f(rx)} ${f(ry)} 0 0 1 ${f(xi)} ${f(yi)} A ${f(rx)} ${f(ry)} 0 0 1 ${f(-xi)} ${f(yi)} Z`;
}

/** A rounded rectangle path (screen space). */
export const rr = (x, y, w, h, r = 0) =>
  `M ${f(x + r)} ${f(y)} L ${f(x + w - r)} ${f(y)} Q ${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)} L ${f(x + w)} ${f(y + h - r)} Q ${f(x + w)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)} L ${f(x + r)} ${f(y + h)} Q ${f(x)} ${f(y + h)} ${f(x)} ${f(y + h - r)} L ${f(x)} ${f(y + r)} Q ${f(x)} ${f(y)} ${f(x + r)} ${f(y)} Z`;

/** A filled rect / circle (screen space, or inside top()/face()). */
export const rect = (x, y, w, h, fill, r = 0, extra = {}) => el('rect', { x: f(x), y: f(y), width: f(w), height: f(h), rx: r, fill, ...extra });
export const circ = (cx, cy, r, fill, extra = {}) => el('circle', { cx: f(cx), cy: f(cy), r: f(r), fill, ...extra });
/** A thick round-capped stroke (a rod, a handle, a wire). */
export const rod = (d, color, w) => g({ 'data-hard': 1 }, el('path', { d, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
/** Clear glass: a fixed white tint (paper-lit turns dark on the stage). */
export const GLASS = '#FFFFFF';
/** Screen point of world (x, y, z) as "x y". */
export const sp = (x, y, z) => P0(x, y, z).map(f).join(' ');

/**
 * Fit a batch to its measured bounds (hx-6): size = [width, height above the +30 line], and a
 * drawing whose nearest edge falls below +40 moves up the screen by `back`, like batch-a's
 * furniture that sits behind its origin. table: name → [w, h, back], measured in a browser.
 */
export function fitAll(batch, table) {
  for (const [name, [w, h, back]] of Object.entries(table)) {
    const p = batch[name];
    if (!p) continue;
    p.size = [w, h];
    if (back > 0) {
      const draw = p.draw;
      p.draw = (o) => [g({ transform: `translate(0 ${-back})` }, [].concat(draw(o)).join(''))];
    }
  }
}
