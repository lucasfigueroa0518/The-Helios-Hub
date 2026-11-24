// The reel's own new drawings (EX3-114): the yellow-rimmed answer bubble, the teal-ruled scratch
// paper and the worn times-table flash cards. Each art function draws in centimetres (1 unit = 1 cm),
// so world.js lays the very same art on its lens solids (faceArt) or as a billboard, and the flat
// frames draw NEW_PROPS from it, scaled up: one look per thing in every frame.

import { el, T } from '../../props/kit.js';
import { handwrite, handwriteWidth } from '../../draw.js';

const PF = "'Pragmatica Extended', Roboto";
const ERR = T['status-error'] ?? T.red;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Pencil or chalk writing in cm units, drawn at 10× and scaled back so the stroke stays thin. */
export function inkCm(text, x, y, size, progress = 1, { color = T['ink-lit'], weight = 1, align = 'left' } = {}) {
  if (progress <= 0) return '';
  const x0 = align === 'right' ? x - handwriteWidth(text, size) : align === 'center' ? x - handwriteWidth(text, size) / 2 : x;
  return `<g transform="scale(0.1)">${handwrite(text, x0 * 10, y * 10, size * 10, progress, { color, weight })}</g>`;
}

// ── The answer bubble ─────────────────────────────────────────────────────────────────────
/** Bubble geometry (cm): the tail tip at (0, 0), the body up and to the right of it. */
export const BUBBLE = { x0: -4, x1: 40, y0: -38, y1: -10, r: 7, w: 44, h: 38 };
const bubbleBody = () => {
  const { x0, x1, y0, y1, r } = BUBBLE;
  return `M ${x0 + r} ${y0} L ${x1 - r} ${y0} Q ${x1} ${y0} ${x1} ${y0 + r} L ${x1} ${y1 - r} Q ${x1} ${y1} ${x1 - r} ${y1} L 13 ${y1} L 0 0 L 3 ${y1} L ${x0 + r} ${y1} Q ${x0} ${y1} ${x0} ${y1 - r} L ${x0} ${y0 + r} Q ${x0} ${y0} ${x0 + r} ${y0} Z`;
};
/**
 * The answer bubble's art in cm, the tail tip at the origin: a white speech bubble with a yellow rim
 * and its answer in big Pragmatica. `text` the answer ('' for empty), `cross` 0..1 a red cross drawn
 * over it (a wrong guess), `focus` 0..1 its rim warming to orange (what to look at now).
 */
export function bubbleArt({ text = '', cross = 0, focus = 0 } = {}) {
  const d = bubbleBody();
  const { x0, x1, y0, y1 } = BUBBLE;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const size = text.length <= 3 ? 17 : text.length <= 5 ? 12 : 9.5;
  const rim = focus > 0.5 ? T.orange : T.yellow;
  const s = [
    el('path', { d, fill: T['shadow-warm'], opacity: 0.16, transform: 'translate(1.2 2)' }),
    el('path', { d, fill: rim, stroke: rim, 'stroke-width': 3.2, 'stroke-linejoin': 'round' }),
    el('path', { d, fill: T.canvas }),
    el('path', { d: `M ${x1 - 4} ${y0 + 9} Q ${x1 - 3.5} ${y0 + 3.5} ${x1 - 10} ${y0 + 3.2}`, fill: 'none', stroke: T['yellow-lit'], 'stroke-width': 1.2, 'stroke-linecap': 'round', opacity: 0.8 }),
  ];
  if (text) s.push(el('text', { x: cx, y: cy + size * 0.36, 'text-anchor': 'middle', 'font-family': PF, 'font-weight': 700, 'font-size': size, fill: T.ink, 'letter-spacing': '-0.02em' }, text));
  if (cross > 0) {
    const a = clamp01(cross * 2);
    const b = clamp01(cross * 2 - 1);
    const l1 = [[x0 + 6, y0 + 5], [x1 - 6, y1 - 4]];
    const l2 = [[x1 - 6, y0 + 5], [x0 + 6, y1 - 4]];
    const seg = ([p, q], u) => (u > 0 ? el('path', { d: `M ${p[0]} ${p[1]} L ${p[0] + (q[0] - p[0]) * u} ${p[1] + (q[1] - p[1]) * u}`, stroke: ERR, 'stroke-width': 3.4, 'stroke-linecap': 'round' }) : '');
    s.push(seg(l1, a), seg(l2, b));
  }
  return s.join('');
}

// ── The scratch paper ─────────────────────────────────────────────────────────────────────
/** One sheet (cm): landscape, 34 × 25 cm (a letter sheet, cheated 1.2× so it reads on a desk). */
export const SHEET = { w: 34, h: 25 };
/** The long multiplication the classmate writes, line by line (right-aligned), and the rules under lines 2 and 4. */
export const WORKING = ['487', 'x 36', '2922', '14610', '17,532'];
const RULE_AFTER = [1, 3];
/**
 * A sheet's art in cm, local (0, 0) its far-left corner, x across, y toward the viewer: paper with
 * teal rules, the working written in graphite to `write` (0..1 over the five lines; 0 a blank
 * sheet). `scrawl` (0..1) fills it with generic working instead (a sheet of the pile).
 */
export function sheetArt({ write = 0, scrawl = 0, seed = 1, focusLast = false } = {}) {
  const { w, h } = SHEET;
  const s = [el('rect', { x: 0, y: 0, width: w, height: h, rx: 0.6, fill: T['paper-lit'] })];
  for (let k = 0; k < 7; k++) s.push(el('path', { d: `M 2 ${3.2 + k * 3.3} L ${w - 2} ${3.2 + k * 3.3}`, stroke: T['teal-lit'], 'stroke-width': 0.28, opacity: 0.95 }));
  s.push(el('path', { d: `M 6 0.8 L 6 ${h - 0.8}`, stroke: T['teal-shade'], 'stroke-width': 0.3, opacity: 0.55 }));
  const right = 24;
  const n = WORKING.length;
  for (let i = 0; i < n; i++) {
    const u = clamp01(write * n - i);
    if (u <= 0) break;
    const last = i === n - 1;
    s.push(inkCm(WORKING[i], right, 2.9 + (i + 1) * 3.3 + 0.1, 2.5, u, { color: last && focusLast ? T['orange-text'] : T['ink-lit'], weight: last ? 1.5 : 1.15, align: 'right' }));
    if (RULE_AFTER.includes(i) && u >= 1) s.push(el('path', { d: `M ${right - 12} ${3.2 + (i + 1) * 3.3 + 0.9} L ${right + 0.6} ${3.2 + (i + 1) * 3.3 + 0.9}`, stroke: T['ink-lit'], 'stroke-width': 0.35, 'stroke-linecap': 'round' }));
  }
  if (scrawl > 0) {
    let r = seed * 9301 + 49297;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    const rows = Math.round(6 * scrawl);
    for (let k = 0; k < rows; k++) {
      const y = 6.2 + k * 3.3;
      let x = 8 + rnd() * 3;
      while (x < w - 6) {
        const len = 2 + rnd() * 4;
        s.push(el('path', { d: `M ${x} ${y} q ${len / 3} -1.2 ${len / 2} 0 t ${len / 2} 0`, fill: 'none', stroke: T['ink-lit'], 'stroke-width': 0.32, 'stroke-linecap': 'round', opacity: 0.75 }));
        x += len + 1.2 + rnd() * 2;
      }
    }
  }
  return s.join('');
}

// ── The flash cards ───────────────────────────────────────────────────────────────────────
/** One card (cm, real 10 × 6, cheated 2.2× so it reads): its face says a times-table sum. */
export const CARD = { w: 22, h: 13 };
export function cardArt({ text = '7 x 8' } = {}) {
  const { w, h } = CARD;
  return el('rect', { x: 0, y: 0, width: w, height: h, rx: 1, fill: T['paper-lit'] })
    + el('path', { d: `M 1.5 2.6 L ${w - 1.5} 2.6`, stroke: T['blue-lit'], 'stroke-width': 0.35 })
    + inkCm(text, w / 2, h * 0.72, 4.6, 1, { color: T['ink-lit'], weight: 1.3, align: 'center' })
    + el('path', { d: `M ${w - 3.2} 0 L ${w} 0 L ${w} 3.2 Z`, fill: T['paper-shade'], opacity: 0.8 });
}

// ── The props for flat frames ─────────────────────────────────────────────────────────────
const shadowE = (rx, ry, y = 4) => el('ellipse', { cx: 0, cy: y, rx, ry, fill: T['shadow-warm'], opacity: 0.12 });

export const NEW_PROPS = {
  'yellow-rimmed answer speech bubble': {
    tags: {
      is: 'a white speech bubble with a thick yellow rim and a short tail at its lower left, holding one short answer in big bold type',
      setting: ['a student answering out loud', 'an instant answer', 'a chat reply'],
      material: 'flat white graphic with a yellow rim',
      parts: ['rounded white body', 'yellow rim', 'tail at lower left', 'the answer in bold type'],
      not: ['thought cloud', 'chat app bubble', 'sticky note', 'sign', 'button', 'tooltip'],
    },
    size: [240, 220],
    states: ['empty', '56', 'guess', 'crossed'],
    draw: ({ state, focal }) => {
      const text = state === '56' ? '56' : state === 'guess' || state === 'crossed' ? '16,000' : '';
      return [shadowE(60, 10), `<g transform="translate(-90 0) scale(5)">${bubbleArt({ text, cross: state === 'crossed' ? 1 : 0, focus: focal ? 1 : 0 })}</g>`];
    },
  },

  'teal-ruled scratch paper sheet': {
    tags: {
      is: 'a sheet of scratch paper ruled in pale teal, filling with a long multiplication in pencil, 487 times 36 worked out to 17,532',
      setting: ['a classroom desk', 'working a sum out by hand', 'step-by-step working'],
      material: 'paper, pencil graphite',
      parts: ['white sheet', 'teal rules', 'teal margin line', 'pencil working', 'underlines'],
      not: ['printed document', 'receipt', 'spreadsheet', 'notebook cover', 'sticky note', 'form'],
    },
    size: [300, 240],
    states: ['blank', 'working', 'filled', 'scrawl'],
    draw: ({ state, focal }) => {
      const write = state === 'filled' ? 1 : state === 'working' ? 0.55 : 0;
      return [shadowE(140, 14, 2), `<g transform="translate(-136 -200) scale(8)">${sheetArt({ write, scrawl: state === 'scrawl' ? 1 : 0, focusLast: focal })}</g>`];
    },
  },

  'worn times-table flash card stack': {
    tags: {
      is: 'a small worn stack of white times-table flash cards held with a red rubber band, the top card reading 7 x 8',
      setting: ['a student desk', 'practising times tables', 'drilled memory'],
      material: 'card stock, rubber band',
      parts: ['stack of cards', 'top card with 7 x 8', 'red rubber band', 'worn offset edges'],
      not: ['playing cards', 'business cards', 'credit card', 'book', 'envelope', 'index box'],
    },
    size: [220, 206],
    states: ['default'],
    draw: () => {
      const out = [shadowE(110, 16, 2)];
      for (let k = 0; k < 6; k++) out.push(el('rect', { x: -96 + (k % 2 ? 4 : -3), y: -20 - k * 7, width: 192, height: 22, rx: 6, fill: k % 2 ? T['paper-lit'] : T.paper, stroke: T['paper-shade'], 'stroke-width': 2, transform: `rotate(${k % 2 ? 1.5 : -1.2} 0 ${-10 - k * 7})` }));
      out.push(`<g transform="translate(-99 -175) scale(9)">${cardArt()}</g>`);
      out.push(el('rect', { x: -14, y: -176, width: 12, height: 176, fill: T['red-shade'], opacity: 0.9 }));
      return out;
    },
  },
};
