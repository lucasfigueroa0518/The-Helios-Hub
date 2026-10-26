// 2 · Record Scratch Freeze: the room in full motion with the music loud; a record scratch, the
// music cuts, the frame freezes ink-only and a red marker circles the critter; the voice starts in
// the silence; "AI BRAIN BREAK" slaps on as a sticker; it unfreezes on "this frosty room".
import { T, g, el, id, ref, defs, scope, E, seg, lerp, room, wordmark, handwrite, burst, toScreen, SUBJECTS, VOICE, WORDS } from './shared.js';

const FREEZE = 0.7;
const VOICE_AT = 1.0;
const UNFREEZE = VOICE_AT + WORDS.this;
export const META = { duration: +(VOICE_AT + VOICE + 0.2).toFixed(3), voiceAt: VOICE_AT, breakAt: FREEZE, unfreezeAt: UNFREEZE };
const RED = T['status-error'];

/** A hand-drawn loop around (cx, cy), revealed by u. */
function loop(cx, cy, rx, ry, u) {
  const n = 40;
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = -1.9 + (i / n) * Math.PI * 2.25;
    const wob = 1 + 0.05 * Math.sin(i * 1.7);
    p.push([cx + rx * wob * Math.cos(a), cy + ry * wob * Math.sin(a)]);
  }
  const d = `M ${p.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')}`;
  return el('path', { d, fill: 'none', stroke: RED, 'stroke-width': 11, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': (1 - u).toFixed(3), filter: ref('wobble') });
}

function sticker(t) {
  const u = seg(t, VOICE_AT, VOICE_AT + 0.16, E.spring);
  if (t < VOICE_AT) return '';
  const sc = lerp(1.6, 1, u);
  return g({ transform: `translate(540 420) rotate(-5) scale(${sc.toFixed(3)})` }, [
    el('rect', { x: -372, y: -150, width: 744, height: 330, rx: 18, fill: T.ink, opacity: 0.18, transform: 'translate(10 12)' }),
    el('rect', { x: -372, y: -150, width: 744, height: 330, rx: 18, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 5 }),
    wordmark(0, -40, 74, 1, { term: false }),
    t >= VOICE_AT + 0.12 ? handwrite('agent loop', 0, 128, 60, seg(t, VOICE_AT + 0.12, VOICE_AT + 0.6, (x) => x), { color: RED, align: 'center', weight: 1.5 }) : '',
  ]);
}

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f02-', 'paper');
    const live = t < FREEZE || t >= UNFREEZE;
    const at = t < FREEZE ? t : t < UNFREEZE ? FREEZE : t - (UNFREEZE - FREEZE);
    const punch = t >= FREEZE && t < UNFREEZE ? 1.07 : 1;
    const scene = room(at, { local: at, camera: { zoom: punch } });
    const parts = [];
    if (live) parts.push(scene);
    else {
      parts.push(el('defs', {}, el('filter', { id: id('desat') }, el('feColorMatrix', { type: 'saturate', values: '0' }) + el('feComponentTransfer', {}, el('feFuncR', { type: 'linear', slope: 1.1, intercept: -0.05 }) + el('feFuncG', { type: 'linear', slope: 1.1, intercept: -0.05 }) + el('feFuncB', { type: 'linear', slope: 1.1, intercept: -0.05 })))));
      parts.push(g({ filter: ref('desat') }, scene));
      const [cx, cy] = toScreen(SUBJECTS.thermostat, FREEZE, { zoom: punch });
      parts.push(loop(cx, cy - 10, 190, 230, seg(t, FREEZE + 0.06, FREEZE + 0.32, E.out)));
      // the arrow, from the empty top right down to the critter
      const a = seg(t, FREEZE + 0.3, FREEZE + 0.45, E.out);
      if (a > 0) {
        const x0 = cx + 360, y0 = cy - 360, x1 = lerp(x0, cx + 175, a), y1 = lerp(y0, cy - 175, a);
        parts.push(el('path', { d: `M ${x0} ${y0} Q ${x0 - 20} ${(y0 + y1) / 2} ${x1.toFixed(1)} ${y1.toFixed(1)}`, fill: 'none', stroke: RED, 'stroke-width': 11, 'stroke-linecap': 'round', filter: ref('wobble') }));
        if (a >= 1) parts.push(el('path', { d: `M ${cx + 160} ${cy - 225} L ${cx + 175} ${cy - 175} L ${cx + 225} ${cy - 190}`, fill: 'none', stroke: RED, 'stroke-width': 11, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      }
    }
    parts.push(sticker(t));
    parts.push(burst(540, 960, seg(t, UNFREEZE, UNFREEZE + 0.35, (x) => x), 3));
    return defs() + parts.join('');
  },
};
