// Typewriter: on a ruled sheet, keys strike "AI 101" letter by letter, the stack of books drops onto
// the sheet beside it, a carriage-return DING, and the sheet is pulled up to uncover frame 2, the
// definition beat.
import { T, g, el, defs, seg, E, fill, nextBeat } from './common.js';
import { lessonIcon } from './lesson.js';
import { textWidth } from '../cards.js';

const WORD = 'AI 101';
const SIZE = 150;
const FACE = 'pragmatica-700';
const GAP = 56;
const CY = 900;
const BOOKS = lessonIcon('books');
const WORD_W = textWidth(WORD, SIZE, FACE);
const X0 = 540 - (WORD_W + GAP + BOOKS.w) / 2;
// every letter in order with its x (the strike times come from the bank)
const LETTERS = [];
{
  let x = X0;
  for (const ch of WORD) {
    if (ch !== ' ') LETTERS.push({ ch, x });
    x += textWidth(ch, SIZE, FACE);
  }
}

/** The books drop onto the sheet and settle with a small squash. */
function books(t, [from, to]) {
  if (t < from) return '';
  const u = seg(t, from, to, E.out);
  const squash = 1 - 0.08 * Math.sin(Math.PI * seg(t, to - 0.05, to + 0.04, (x) => x));
  const x = X0 + WORD_W + GAP;
  const y = CY - BOOKS.h / 2 - 20 - 520 * (1 - u);
  return g({ transform: `translate(${x.toFixed(1)} ${(y + BOOKS.h).toFixed(1)}) scale(1 ${squash.toFixed(3)}) translate(0 ${(-BOOKS.h).toFixed(1)})` }, BOOKS.svg);
}

function page(t, M) {
  const out = [fill(T['paper-lit'])];
  // faint ruled guide lines, like a typewriter sheet
  for (let y = 240; y < 1920; y += 64) out.push(el('line', { x1: 0, y1: y, x2: 1080, y2: y, stroke: T['paper-shade'], 'stroke-width': 2 }));
  const typed = [];
  LETTERS.forEach((k, i) => {
    const at = M.keys[i] ?? M.keys[M.keys.length - 1];
    if (t < at) return;
    const hit = seg(t, at, at + 0.04, E.out);
    typed.push(el('text', { x: k.x.toFixed(1), y: (CY + SIZE * 0.36 + (1 - hit) * 14).toFixed(1), 'font-family': "'Pragmatica Extended'", 'font-weight': 700, 'font-size': SIZE, fill: T.ink, opacity: (0.75 + 0.25 * hit).toFixed(3) }, k.ch));
  });
  // once the last key has struck, the letters are the title (bounds.mjs and the checks find it by data-text)
  const done = t >= M.keys[M.keys.length - 1] + 0.04;
  out.push(g(done ? { 'data-role': 'lesson-title', 'data-k': 'text', 'data-text': 'AI 101' } : {}, typed.join('')));
  out.push(books(t, M.books));
  return out.join('');
}

export default function draw(t, ctx) {
  const M = ctx.M;
  // each strike jolts the page a little, as the type bar hits it
  const k = M.keys.findLast((x) => t >= x);
  const jolt = k !== undefined ? 5 * (1 - seg(t, k, k + 0.04, (x) => x)) : 0;
  if (t < M.exitAt) return defs() + g({ transform: `translate(0 ${jolt.toFixed(1)})` }, page(t, M));
  // pulled up and gone by the cut
  const u = seg(t, M.exitAt, M.end - 0.02, E.in);
  return nextBeat(ctx) + defs() + g({ transform: `translate(0 ${(-2100 * u).toFixed(1)})` }, page(t, M));
}
