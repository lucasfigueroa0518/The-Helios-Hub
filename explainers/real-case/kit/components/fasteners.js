// Fasteners: push pins and the red cord (board), flat magnets (whiteboard). A magnet must never read as
// a pin: pins are glossy domes with a long shadow; magnets are flat, matte, flush, with a short hard edge.
import { h, svgEl } from './dom.js';
import { cordPoints, partial, toPath } from '../geometry.js';

const PIN = { red: '', yellow: 'y', white: 'w', blue: 'b' };
/** A push pin centred on (x, y). color: red | yellow | white | blue. */
export function pushPin(doc, { x = 0, y = 0, color = 'red' } = {}) {
  return h(doc, 'div', { class: `nk-pin ${PIN[color] ?? ''}`.trim(), style: { left: `${x}px`, top: `${y}px` } });
}

/**
 * A red cord through pin points, with its shadow on the cork and a twist highlight.
 * Returns { el, length, progress(u, taut) }: progress unspools it from the first pin (u) and pulls it
 * taut (taut 0 = slack, 1 = resting sag).
 */
export function cord(doc, points, { w = 1080, h: ht = 1920 } = {}) {
  const el = svgEl(doc, 'svg', { class: 'nk-cords', width: w, height: ht });
  const sh = svgEl(doc, 'path', { class: 'sh', transform: 'translate(9 13)' });
  const c = svgEl(doc, 'path', { class: 'c' });
  const tw = svgEl(doc, 'path', { class: 'tw' });
  el.append(sh, c, tw);
  const draw = (u = 1, taut = 1) => {
    const { pts } = cordPoints(points, taut);
    const d = u >= 1 ? toPath(pts) : toPath(partial(pts, u));
    for (const p of [sh, c, tw]) p.setAttribute('d', d);
    el.style.opacity = u > 0 ? '1' : '0';
  };
  draw(1, 1);
  return { el, length: cordPoints(points).length, progress: draw, points };
}

const MAGNET_COLORS = ['orange', 'blue', 'teal', 'yellow', 'black', 'red'];

/** A flat magnet centred on (x, y). shape: disc | bar. color: orange | blue | teal | yellow | black | red. */
export function magnet(doc, { x = 0, y = 0, shape = 'disc', color = 'orange', rot = 0 } = {}) {
  const tone = MAGNET_COLORS.includes(color) ? color : 'orange';
  const el = h(doc, 'div', { class: `nk-mag mg-${tone}${shape === 'bar' ? ' bar' : ''}`, style: { left: `${x}px`, top: `${y}px` } });
  el.dataset.rot = String(rot);
  if (rot) el.style.transform = `rotate(${rot}deg)`;
  return el;
}
