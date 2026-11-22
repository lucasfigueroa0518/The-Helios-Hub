// Knock Knock: the house scholar pops up huge behind the screen glass and knocks on it, while
// "AI 101" and its books write out at the top of the sheet. The scholar points up at them; then the
// sheet drops away, scholar and all, to uncover frame 2, the definition beat.
// Sound: a marker squeak on the writing, a glass knock on each knock, a swish as the sheet drops.
import { T, g, el, defs, seg, lerp, E, fill, shake, shaken, critter, nextBeat } from './common.js';
import { lessonIconAt, lessonLayout, lessonTitle, SCHOLAR } from './lesson.js';

/** The scholar's scale and feet: it fills the lower half of the screen, close to the glass, a
 *  little left so its knocking mitten stays on screen. */
const S = 6.2;
const FEET = [470, 2020];
/** The knocking mitten's hand targets (local units from the feet, cast.js ARM_POSES): raised to the
 *  glass on a knock, drawn back between knocks. */
const KNOCK_HAND = [80, -176];
const BACK_HAND = [98, -146];
const DOWN_HAND = [-78, -52];
/** The lesson row, lifted to the top of the sheet and drawn a little smaller. */
const ROW_Y = 340;
const ROW_K = 0.8;
/** Where each knock lands on the glass: the raised mitten, where the arm's reach puts it. */
const KNOCK_AT = [985, 1150];

/** A small starburst crack where a knock lands, gone well before the sheet drops. */
function crack(x, y, u) {
  if (u <= 0 || u >= 1) return '';
  const r = 80 * Math.min(1, u * 8);
  const rays = Array.from({ length: 7 }, (_, i) => {
    const a = i * 0.9 + 0.3;
    const k = i % 2 ? 0.6 : 1;
    return `M ${x} ${y} l ${(Math.cos(a) * r * k).toFixed(1)} ${(Math.sin(a) * r * k).toFixed(1)}`;
  });
  return el('path', { d: rays.join(' '), stroke: T.ink, 'stroke-width': 5, 'stroke-linecap': 'round', fill: 'none', opacity: (0.6 * (1 - u)).toFixed(3) });
}

/** "AI 101" writes on at the top while the books drop onto the row beside it, whole by write's end. */
function row(ctx, t) {
  const [w0, w1] = ctx.M.write;
  const L = lessonLayout(ctx.key);
  const parts = [lessonTitle(ctx.key, seg(t, w0, w1, (x) => x))];
  const from = w1 - 0.12;
  if (t >= from) {
    const u = seg(t, from, w1, E.out);
    const squash = 1 - 0.1 * Math.sin(Math.PI * seg(t, w1 - 0.03, w1 + 0.06, (x) => x));
    const foot = L.icon.y + L.icon.h;
    parts.push(g({ transform: `translate(0 ${(-460 * (1 - u)).toFixed(1)}) translate(0 ${foot.toFixed(1)}) scale(1 ${squash.toFixed(3)}) translate(0 ${(-foot).toFixed(1)})` }, lessonIconAt(ctx.key)));
  }
  return g({ transform: `translate(540 ${ROW_Y}) scale(${ROW_K}) translate(-540 -880)` }, parts);
}

/** The scholar behind the glass: up from below, a lean in on each knock, then it points at the row. */
function scholar(ctx, t) {
  const { knocks, exitAt } = ctx.M;
  const knock = knocks.find((k) => t >= k - 0.06 && t < k + 0.08);
  const pointing = t >= knocks[knocks.length - 1] + 0.08;
  const y = lerp(2800, FEET[1], seg(t, 0, knocks[0], E.out));
  const lean = knock !== undefined ? 1 + 0.05 * Math.sin(Math.PI * seg(t, knock - 0.06, knock + 0.08, (x) => x)) : 1;
  const pose = t >= exitAt
    ? { mood: 'surprised', arms: { l: DOWN_HAND, r: KNOCK_HAND }, look: [0, -0.6] }
    : pointing
      ? { mood: 'happy', arms: { l: DOWN_HAND, r: KNOCK_HAND }, look: [0.3, -0.9] }
      : { mood: 'curious', arms: { l: DOWN_HAND, r: knock !== undefined ? KNOCK_HAND : BACK_HAND }, look: [0, 0] };
  const x = FEET[0];
  return g({ transform: `translate(${x} ${y.toFixed(1)}) scale(${lean.toFixed(3)}) translate(${-x} 0)` }, critter(x, 0, { ...SCHOLAR, hand: null, s: S, who: null, ...pose }));
}

/** Frame 1's sheet: paper, the row at the top, the scholar and the knocks' cracks. */
function sheet(ctx, t) {
  const { knocks } = ctx.M;
  return [
    fill(T['paper-lit']),
    row(ctx, t),
    scholar(ctx, t),
    ...knocks.map((k) => crack(KNOCK_AT[0], KNOCK_AT[1], seg(t, k, k + 0.2, (x) => x))),
  ].join('');
}

export default function draw(t, ctx) {
  const { knocks, exitAt, end } = ctx.M;
  // each knock jolts the glass
  const offset = knocks.reduce((acc, k) => {
    const [a, b] = shake(t, k, 16, 0.16);
    return [acc[0] + a, acc[1] + b];
  }, [0, 0]);
  if (t < exitAt) return defs() + shaken(offset, sheet(ctx, t));
  // the sheet drops away, tipping a little, and is gone before the cut
  const u = seg(t, exitAt, end - 0.04, E.in);
  const under = nextBeat(ctx);
  if (u >= 1) return under;
  return under + defs() + g({ transform: `translate(0 ${(2400 * u).toFixed(1)}) rotate(${(8 * u).toFixed(2)} 540 960)` }, sheet(ctx, t));
}
