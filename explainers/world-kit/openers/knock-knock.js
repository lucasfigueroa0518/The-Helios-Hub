// Knock Knock: the hook's critter pops up huge against the screen, knocks twice on the glass,
// points up as "AI BRAIN BREAK" writes itself, then ducks away to show its scene; the wordmark
// lifts away and the title card with the term lands in its place (EX3-102).
import { T, g, el, defs, seg, lerp, E, scene, heroCritter, title, wordmark, shake, shaken, shock } from './common.js';

const S = 7.4;

/** A small starburst crack where a knock lands on the glass. */
function crack(x, y, u) {
  if (u <= 0 || u >= 1) return '';
  const rays = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + 0.3;
    const r = 60 * Math.min(1, u * 4);
    rays.push(`M ${x} ${y} l ${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`);
  }
  return el('path', { d: rays.join(' '), stroke: T['paper-lit'], 'stroke-width': 6, 'stroke-linecap': 'round', opacity: (1 - u).toFixed(3) });
}

export default function draw(t, ctx) {
  const { knocks, point, writeAt, duck } = ctx.M;
  const knock = knocks.find((k) => t >= k - 0.08 && t < k + 0.12);
  const offset = knocks.reduce((acc, k) => { const [a, b] = shake(t, k, 18, 0.2); return [acc[0] + a, acc[1] + b]; }, [0, 0]);
  // the critter: up from below, a lean in on each knock, then down and away
  const y = lerp(3300, 2120, seg(t, 0, 0.2, E.spring)) + lerp(0, 1400, seg(t, duck[0], duck[1], E.in));
  const lean = knock !== undefined ? 1 + 0.05 * Math.sin(Math.PI * seg(t, knock - 0.08, knock + 0.12, (x) => x)) : 1;
  const parts = [defs()];
  // the scene behind, dimmed until the critter leaves
  parts.push(shaken(offset, scene(ctx, t)));
  parts.push(el('rect', { x: 0, y: 0, width: 1080, height: 1920, fill: T.ink, opacity: (0.55 * (1 - seg(t, duck[0], duck[1] + 0.1, (x) => x))).toFixed(3) }));
  if (t < duck[1]) {
    const pose = { mood: t >= point ? 'happy' : 'surprised', arms: t >= point ? 'point' : knock !== undefined ? 'push' : 'hold', look: t >= point ? [0.2, -0.8] : [0, 0] };
    parts.push(g({ transform: `translate(${(540 + offset[0]).toFixed(1)} ${(y + offset[1]).toFixed(1)}) scale(${lean.toFixed(3)}) translate(-540 0)` }, heroCritter(ctx, 540, 0, S, pose)));
  }
  knocks.forEach((k) => parts.push(crack(830, 1420, seg(t, k, k + 0.35, (x) => x))));
  const { titleAt } = ctx.M;
  if (t >= writeAt[0]) {
    // the wordmark holds over the duck, then lifts away as the title card slides into the band
    const gone = seg(t, titleAt - 0.05, titleAt + 0.2, E.in);
    if (gone < 1) {
      const lift = g({ transform: `translate(540 420) scale(${lerp(1, 0.4, gone).toFixed(3)}) translate(-540 -420)`, opacity: (1 - gone).toFixed(3) }, wordmark(540, 420, 92, seg(t, writeAt[0], writeAt[1], (x) => x), { color: t < duck[1] ? T['paper-lit'] : T.ink, plate: t >= duck[1] }));
      parts.push(lift);
    }
  }
  parts.push(shock(760, 300, seg(t, point, point + 0.3, (x) => x), 2));
  parts.push(title(ctx, t, titleAt));
  return parts.join('');
}
