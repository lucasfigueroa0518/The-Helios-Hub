// New drawings for flat frames (EX3-114): Gerald's cage, for a frame that shows it off the lens.
// Base centre at (0, 0), y up is negative, px at s = 1.
import { el, softShape } from '../../draw.js';
import { TOKENS as T, mixHex } from '../../core.js';

const WIRE = mixHex(T['ink-lit'], T['paper-dark'], 0.45);
const rr = (x, y, w, h, r) => `M ${x + r} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} H ${x + r} Q ${x} ${y + h} ${x} ${y + h - r} V ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;

export const NEW_PROPS = {
  'wire hamster cage with an empty food bowl': {
    tags: {
      is: 'a small-pet wire cage on a dark plastic tray, with an exercise wheel and an empty ceramic food bowl',
      setting: ['classroom', 'home', 'pet shop'],
      material: 'steel wire, plastic tray, ceramic bowl',
      parts: ['wire bars', 'flat wire roof', 'dark tray', 'exercise wheel', 'empty food bowl'],
      not: ['bird cage', 'dog crate', 'aquarium', 'prison cell', 'shopping basket', 'trap', 'lantern'],
    },
    size: [320, 234],
    states: ['lit'], // 'shade' dropped in the bank: it baked in a grey backdrop (hand review 2026-11-16)
    draw: ({ state }) => {
      const out = [];
      out.push(el('ellipse', { cx: 0, cy: 2, rx: 160, ry: 14, fill: T['shadow-warm'], opacity: 0.16 }));
      // back bars and roof
      for (let x = -134; x <= 134; x += 20) out.push(el('line', { x1: x, y1: -24, x2: x, y2: -196, stroke: WIRE, 'stroke-width': 2.4, opacity: 0.7 }));
      out.push(el('path', { d: rr(-140, -204, 280, 12, 6), fill: WIRE }));
      // the wheel and the empty bowl
      out.push(el('circle', { cx: -82, cy: -86, r: 54, fill: mixHex(T['yellow-lit'], T['paper-lit'], 0.5), 'fill-opacity': 0.55, stroke: T['yellow-dark'], 'stroke-width': 6 }));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; out.push(el('line', { x1: -82, y1: -86, x2: (-82 + 54 * Math.cos(a)).toFixed(1), y2: (-86 + 54 * Math.sin(a)).toFixed(1), stroke: T['yellow-dark'], 'stroke-width': 3 })); }
      out.push(el('rect', { x: -88, y: -86, width: 12, height: 62, rx: 3, fill: T['yellow-dark'] }));
      // the tray
      out.push(softShape(rr(-150, -30, 300, 30, 10), T['ink-lit']));
      out.push(softShape(rr(-140, -34, 280, 8, 4), mixHex(T['paper-lit'], T['yellow-lit'], 0.45)));
      out.push(softShape('M 52 -34 L 56 -54 L 116 -54 L 120 -34 Z', T['paper-lit']));
      out.push(el('ellipse', { cx: 86, cy: -54, rx: 30, ry: 6, fill: T['paper-shade'] }));
      // front bars
      for (let x = -140; x <= 140; x += 28) out.push(el('line', { x1: x, y1: -30, x2: x, y2: -198, stroke: WIRE, 'stroke-width': 3.2 }));
      if (state === 'shade') out.push(el('rect', { x: -170, y: -215, width: 340, height: 230, fill: T['blue-dark'], opacity: 0.28 }));
      return out;
    },
  },
};
