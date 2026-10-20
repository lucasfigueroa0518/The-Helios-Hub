// 4 · Typewriter: huge keys strike "AI BRAIN BREAK" letter by letter in rhythm; a carriage-return
// DING, then the page zips up and the room is underneath. The voice runs over the typing.
import { T, g, el, defs, scope, E, seg, lerp, room, title, handwrite, fill, VOICE } from './shared.js';
import { textWidth } from '../kit/cards.js';

const VOICE_AT = 0;
const STRIKE0 = 0.06;
const GAP = 0.072;
const LINES = ['AI BRAIN', 'BREAK'];
const SIZE = 168;
const FACE = 'pragmatica-700';
// every non-space letter in order, with its line and x
const KEYS = [];
LINES.forEach((ln, li) => {
  const w = textWidth(ln, SIZE, FACE);
  let x = 540 - w / 2;
  for (const ch of ln) {
    const cw = textWidth(ch, SIZE, FACE);
    if (ch !== ' ') KEYS.push({ ch, x, li, at: 0 });
    x += cw;
  }
});
KEYS.forEach((k, i) => { k.at = STRIKE0 + i * GAP; });
const LAST = KEYS[KEYS.length - 1].at;
const DING = LAST + 0.1;
const ZIP = [DING + 0.04, DING + 0.36];
export const META = { duration: +(VOICE_AT + VOICE + 0.25).toFixed(3), voiceAt: VOICE_AT, breakAt: DING, keys: KEYS.map((k) => +k.at.toFixed(3)), dropAt: ZIP[0] };

function page(t) {
  const out = [fill(T['paper-lit'])];
  // faint ruled guide lines, like a typewriter sheet
  for (let y = 240; y < 1920; y += 64) out.push(el('line', { x1: 0, y1: y, x2: 1080, y2: y, stroke: T['paper-shade'], 'stroke-width': 2 }));
  for (const k of KEYS) {
    if (t < k.at) continue;
    const hit = seg(t, k.at, k.at + 0.06, E.out);
    const y = (k.li === 0 ? 900 : 1100) + (1 - hit) * 18;
    out.push(el('text', { x: k.x.toFixed(1), y: y.toFixed(1), 'font-family': "'Pragmatica Extended'", 'font-weight': 700, 'font-size': SIZE, fill: T.ink, opacity: (0.75 + 0.25 * hit).toFixed(3) }, k.ch));
  }
  // the term, handwritten in under the type after the ding
  if (t >= DING - 0.05) out.push(handwrite('agent loop', 540, 1280, 72, seg(t, DING - 0.05, DING + 0.35, (x) => x), { color: T.orange, align: 'center', weight: 1.4 }));
  return out.join('');
}

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f04-', 'paper');
    // each strike jolts the page a little, as the type bar hits it
    const k = KEYS.findLast((x) => t >= x.at);
    const jolt = k ? 6 * (1 - seg(t, k.at, k.at + 0.05, (x) => x)) : 0;
    if (t < ZIP[0]) return defs() + g({ transform: `translate(0 ${jolt.toFixed(1)})` }, page(t));
    const u = seg(t, ZIP[0], ZIP[1], E.in);
    return room(t, { local: t - ZIP[0] }) + g({ transform: `translate(0 ${(-2100 * u).toFixed(1)})` }, page(t)) + title(t, ZIP[1], VOICE_AT);
  },
};
