// Balloon Pop: an orange balloon with "AI BRAIN BREAK" on it inflates in wobbly gulps until it
// fills the screen, then POPS into paper confetti, and the hook is right there behind it.
import { T, g, el, defs, seg, lerp, E, scene, title, wordmark, fill, shake, shaken, burst, softShape, gloss } from './common.js';

// confetti: paper bits flung out from the middle
const BITS = Array.from({ length: 46 }, (_, i) => {
  const a = i * 2.39996;
  const v = 900 + ((i * 53) % 9) * 140;
  return { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 500, spin: ((i * 97) % 13) * 70 - 420, w: 26 + (i % 4) * 10, h: 14 + (i % 3) * 8, c: [T.orange, T['paper-lit'], T.ink, T['orange-lit']][i % 4] };
});
// shreds of the balloon skin
const SHREDS = Array.from({ length: 9 }, (_, i) => ({ a: i * 0.7 + 0.3, v: 1300 + (i % 3) * 300, spin: (i % 2 ? 1 : -1) * 500 }));

function size(t, gulps) {
  let s = 0.2;
  for (const [a, b, to] of gulps) if (t >= a) s = lerp(s, to, seg(t, a, b, E.spring));
  return s;
}

function balloon(s, wob) {
  const rx = 400 * s * (1 + 0.04 * wob);
  const ry = 470 * s * (1 - 0.04 * wob);
  const cy = 960 - 40 * s;
  const hx = 540 + rx * 0.42;
  const skin = `M ${(540 - rx).toFixed(1)} ${cy.toFixed(1)} A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(540 + rx).toFixed(1)} ${cy.toFixed(1)} A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(540 - rx).toFixed(1)} ${cy.toFixed(1)} Z`;
  const hy = cy - ry * 0.48;
  return [
    el('path', { d: `M 540 ${(cy + ry + 30).toFixed(1)} q -40 140 10 260 t -10 300`, fill: 'none', stroke: T['text-tertiary'], 'stroke-width': 3.5, 'stroke-linecap': 'round' }),
    softShape(`M ${540 - 28 * s} ${(cy + ry + 34 * s).toFixed(1)} L 540 ${(cy + ry - 6).toFixed(1)} L ${540 + 28 * s} ${(cy + ry + 34 * s).toFixed(1)} Z`, T['orange-shade'], { form: 0.5 }),
    // a glossy rubber volume lit from the top right, with its window highlight
    softShape(skin, T.orange),
    gloss(skin, { strength: 0.7 }),
    el('ellipse', { cx: hx.toFixed(1), cy: hy.toFixed(1), rx: (rx * 0.11).toFixed(1), ry: (ry * 0.17).toFixed(1), fill: T.canvas, opacity: 0.6, transform: `rotate(28 ${hx.toFixed(1)} ${hy.toFixed(1)})` }),
    // the print stretches with the rubber
    g({ transform: `translate(540 ${cy.toFixed(1)}) scale(${(s * 0.95).toFixed(3)}) translate(-540 -960)` }, wordmark(540, 960, 118, 1, { color: T['paper-lit'] })),
  ].join('');
}

export default function draw(t, ctx) {
  const POP = ctx.M.breakAt;
  if (t < POP) {
    // it trembles harder the fuller it gets
    const wob = Math.sin(t * 70) * seg(t, 0.4, POP, E.in);
    return defs() + fill(T['paper-lit']) + balloon(size(t, ctx.M.gulps), wob);
  }
  const k = t - POP;
  const parts = [shaken(shake(t, POP, 30, 0.4), scene(ctx, k)), defs()];
  SHREDS.forEach((sh) => {
    if (k > 0.5) return;
    const x = 540 + Math.cos(sh.a) * sh.v * k;
    const y = 960 + Math.sin(sh.a) * sh.v * k + 1400 * k * k;
    parts.push(el('path', { d: 'M -60 -20 Q 0 -60 70 -10 Q 20 30 -50 40 Z', fill: T['orange-shade'], transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(sh.spin * k).toFixed(1)}) scale(${(1.3 - k).toFixed(3)})` }));
  });
  // confetti: out fast, then drifting down
  BITS.forEach((b) => {
    const drag = (1 - Math.exp(-4 * k)) / 4;
    const x = 540 + b.vx * drag;
    const y = 960 + b.vy * drag + 420 * k * k;
    if (y > 2050) return;
    const flip = Math.abs(Math.cos(k * 9 + b.spin));
    parts.push(el('rect', { x: (-b.w / 2).toFixed(1), y: (-b.h / 2).toFixed(1), width: b.w, height: b.h, fill: b.c, stroke: b.c === T['paper-lit'] ? T['paper-shade'] : 'none', 'stroke-width': 2, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(b.spin * k).toFixed(1)}) scale(1 ${flip.toFixed(3)})` }));
  });
  parts.push(fill(T['paper-lit'], 0.85 * (1 - seg(t, POP, POP + 0.08, (x) => x))));
  parts.push(burst(540, 960, seg(t, POP, POP + 0.4, (x) => x), 5));
  parts.push(title(ctx, t, ctx.M.titleAt));
  return parts.join('');
}
