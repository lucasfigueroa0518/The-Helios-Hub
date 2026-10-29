// Typewriter: huge keys strike "AI BRAIN BREAK" letter by letter in rhythm; a carriage-return
// DING, then the page zips up and the hook is underneath. The voice runs over the typing.
import { T, g, el, defs, seg, E, scene, title, fill } from './common.js';
import { textWidth } from '../cards.js';

const LINES = ['AI BRAIN', 'BREAK'];
const SIZE = 168;
const FACE = 'pragmatica-700';
// every letter in order, with its line and x (the strike times come from the bank)
const LETTERS = [];
LINES.forEach((ln, li) => {
  let x = 540 - textWidth(ln, SIZE, FACE) / 2;
  for (const ch of ln) {
    if (ch !== ' ') LETTERS.push({ ch, x, li });
    x += textWidth(ch, SIZE, FACE);
  }
});

function page(t, keys) {
  const out = [fill(T['paper-lit'])];
  // faint ruled guide lines, like a typewriter sheet
  for (let y = 240; y < 1920; y += 64) out.push(el('line', { x1: 0, y1: y, x2: 1080, y2: y, stroke: T['paper-shade'], 'stroke-width': 2 }));
  LETTERS.forEach((k, i) => {
    const at = keys[i] ?? keys[keys.length - 1];
    if (t < at) return;
    const hit = seg(t, at, at + 0.06, E.out);
    const y = (k.li === 0 ? 900 : 1100) + (1 - hit) * 18;
    out.push(el('text', { x: k.x.toFixed(1), y: y.toFixed(1), 'font-family': "'Pragmatica Extended'", 'font-weight': 700, 'font-size': SIZE, fill: T.ink, opacity: (0.75 + 0.25 * hit).toFixed(3) }, k.ch));
  });
  return out.join('');
}

export default function draw(t, ctx) {
  const { keys, dropAt, zipEnd } = ctx.M;
  // each strike jolts the page a little, as the type bar hits it
  const k = keys.findLast((x) => t >= x);
  const jolt = k !== undefined ? 6 * (1 - seg(t, k, k + 0.05, (x) => x)) : 0;
  if (t < dropAt) return defs() + g({ transform: `translate(0 ${jolt.toFixed(1)})` }, page(t, keys));
  const u = seg(t, dropAt, zipEnd, E.in);
  return scene(ctx, t) + defs() + g({ transform: `translate(0 ${(-2100 * u).toFixed(1)})` }, page(t, keys)) + title(ctx, t, ctx.M.titleAt);
}
