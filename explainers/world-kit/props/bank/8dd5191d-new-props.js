// The reel's own new drawings (EX3-114) and the paper art they share with world.js.
// orderArt / resultsArt draw the lab order's and the results sheet's printed faces in mm
// (260 × 340 and 240 × 320): world.js lays them on the world sheets through faceArt (scaled 0.1, so
// cm), and the flat NEW_PROPS below draw the same faces upright for flat or blend frames. One look
// per thing: the yellow-header order with the cholesterol tick and 4471, the lilac-header results
// sheet with its green check.

import { el, T, shadow } from '../../props/kit.js';
import { handwrite } from '../../draw.js';

const FONT = "'Pragmatica Extended', Roboto";
export const ORDER_ROWS = ['cholesterol', 'glucose', 'iron'];
export const PATIENT_NO = '4471';

/** The lab order's printed face in mm (260 × 340): yellow header, three checkbox rows, the
 *  cholesterol tick drawn to `tick` (0..1), the patient number written to `number` (0..1). */
export function orderArt({ tick = 1, number = 1, tickColor = T.orange, numberColor = T['blue-shade'] } = {}) {
  const out = [
    el('rect', { x: 0, y: 0, width: 260, height: 340, rx: 8, fill: T['paper-lit'] }),
    el('path', { d: 'M 8 0 L 252 0 Q 260 0 260 8 L 260 64 L 0 64 L 0 8 Q 0 0 8 0 Z', fill: T.yellow }),
    el('text', { x: 20, y: 44, 'font-family': FONT, 'font-weight': 700, 'font-size': 27, fill: T.ink, 'letter-spacing': '0.03em' }, 'LAB ORDER'),
  ];
  ORDER_ROWS.forEach((name, i) => {
    const y = 112 + i * 58;
    out.push(el('rect', { x: 20, y: y - 26, width: 34, height: 34, rx: 5, fill: T.canvas, stroke: T['ink-lit'], 'stroke-width': 4 }));
    out.push(el('text', { x: 72, y: y + 2, 'font-family': 'Roboto', 'font-weight': 500, 'font-size': 28, fill: T['ink-lit'] }, name));
  });
  if (tick > 0) out.push(el('path', { d: 'M 25 96 L 37 110 L 64 72', pathLength: 1, fill: 'none', stroke: tickColor, 'stroke-width': 9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': `${Math.min(1, tick).toFixed(3)} 2` }));
  out.push(el('text', { x: 20, y: 300, 'font-family': 'Roboto', 'font-weight': 500, 'font-size': 26, fill: T['text-secondary'] }, 'patient'));
  out.push(el('path', { d: 'M 136 308 L 244 308', stroke: T['paper-dark'], 'stroke-width': 3, fill: 'none' }));
  if (number > 0) out.push(handwrite(PATIENT_NO, 142, 300, 34, Math.min(1, number), { color: numberColor, weight: 1.3 }));
  return out.join('');
}

/** The results sheet's printed face in mm (240 × 320): lilac header, the cholesterol row with a
 *  green check, two more rows with value bars. */
export function resultsArt() {
  const out = [
    el('rect', { x: 0, y: 0, width: 240, height: 320, rx: 8, fill: T['paper-lit'] }),
    el('path', { d: 'M 8 0 L 232 0 Q 240 0 240 8 L 240 60 L 0 60 L 0 8 Q 0 0 8 0 Z', fill: T.lilac }),
    el('text', { x: 18, y: 42, 'font-family': FONT, 'font-weight': 700, 'font-size': 26, fill: T.canvas, 'letter-spacing': '0.03em' }, 'RESULTS'),
  ];
  ORDER_ROWS.forEach((name, i) => {
    const y = 112 + i * 62;
    out.push(el('text', { x: 18, y, 'font-family': 'Roboto', 'font-weight': 500, 'font-size': 26, fill: T['ink-lit'] }, name));
    out.push(el('rect', { x: 18, y: y + 14, width: i === 0 ? 150 : 90 - i * 20, height: 9, rx: 4, fill: i === 0 ? T['lilac-shade'] : T['paper-dark'] }));
  });
  out.push(el('circle', { cx: 204, cy: 102, r: 20, fill: T.green }));
  out.push(el('path', { d: 'M 194 102 L 201 110 L 215 93', fill: 'none', stroke: T.canvas, 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return out.join('');
}

const BOARD = T['yellow-dark'];
const BOARD_LIT = T.yellow;

export const NEW_PROPS = {
  'lab order form on clipboard': {
    tags: {
      is: 'a paper lab order form on a brown clipboard: a yellow header reading LAB ORDER, three checkbox rows (cholesterol, glucose, iron), the cholesterol box ticked and patient 4471 handwritten in blue',
      setting: ['doctor consulting room desk', 'ordering a blood test', 'clinic paperwork'],
      material: 'printed paper, hardboard clipboard, steel clip',
      parts: ['brown clipboard', 'steel clip', 'yellow header', 'three checkbox rows', 'tick in the cholesterol box', 'handwritten patient number'],
      not: ['prescription pad', 'invoice', 'checklist app', 'survey', 'menu', 'certificate', 'chart folder'],
    },
    size: [246, 330],
    states: ['blank', 'ticked', 'filled'],
    draw: ({ state, focal }) => {
      const tick = state === 'blank' ? 0 : 1;
      const number = state === 'filled' ? 1 : 0;
      return [
        shadow(0, 2, 104, 14),
        el('rect', { x: -110, y: -290, width: 220, height: 290, rx: 12, fill: BOARD }),
        el('rect', { x: -110, y: -290, width: 220, height: 284, rx: 12, fill: BOARD_LIT, opacity: 0.35 }),
        el('g', { transform: 'translate(-98 -266) scale(0.754)' }, orderArt({ tick, number, tickColor: focal ? T.orange : T['ink-lit'] })),
        el('rect', { x: -40, y: -300, width: 80, height: 26, rx: 8, fill: T['paper-dark'] }),
        el('rect', { x: -32, y: -296, width: 64, height: 8, rx: 4, fill: T['paper-lit'], opacity: 0.7 }),
      ];
    },
  },
  'blood test results sheet with lilac header': {
    tags: {
      is: 'a printed blood test results sheet: a lilac header reading RESULTS, three result rows (cholesterol, glucose, iron) with value bars, a green check beside cholesterol',
      setting: ['clinical lab output tray', 'patient chart', 'getting test results back'],
      material: 'printed paper',
      parts: ['white sheet', 'lilac header', 'three result rows', 'value bars', 'green check badge'],
      not: ['lab order form', 'receipt', 'invoice', 'report card', 'envelope', 'screen', 'chat bubble'],
    },
    size: [226, 297],
    states: ['default'],
    draw: () => [
      shadow(0, 2, 96, 12),
      el('g', { transform: 'translate(-100 -267) scale(0.834)' }, resultsArt()),
    ],
  },
};
