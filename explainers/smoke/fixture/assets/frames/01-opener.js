// Smoke fixture, frame 1 (series opener): the hook (a critter races its pen, coins pile up) while
// the title card writes itself in the top band during the line (EX3-61, EX3-79).

import { scope, shock } from '../kit/draw.js';
import { iso } from '../kit/core.js';
import { E, clamp01, seg, arch, twos, frame } from '../kit/motion.js';
import { titleCard } from '../kit/cards.js';
import { STATES, INSTRUCTIONS, LAYOUT, sheet, ink, coins, writer } from '../world/world.js';

const GROUND = 'paper';
/** From assets/timing/01-opener.json: the line ends here (the hold is 0.15s). */
const VOICE_END = 3.346;
const WRITE_END = 3.0;

/** When line c finishes, in frame time (the pen speeds up toward the end of the line). */
function lineDone(c) {
  const k = (c + 1 - STATES.lines.start) / (STATES.lines.end - STATES.lines.start);
  return WRITE_END * Math.cbrt(clamp01(k));
}

export default {
  ground: GROUND,
  draw(t) {
    scope('f01-', GROUND);
    const tc = twos(t);
    const s = 1.25;
    const P = iso(470, 860, s);
    const parts = [sheet(P)];
    const written = STATES.lines.start + (STATES.lines.end - STATES.lines.start) * E['ramp-up'](clamp01(tc / WRITE_END));
    const lines = ink(P, s, written);
    parts.push(lines.svg);
    const due = (c) => (c < STATES.coins.start ? -1 : lineDone(c));
    const n = INSTRUCTIONS.filter((_, c) => tc >= due(c)).length;
    parts.push(coins(n, (i) => (i < STATES.coins.start ? 0 : 170 * (1 - seg(tc, due(i), due(i) + 0.14, E.in)) + 10 * arch(tc, due(i) + 0.14, due(i) + 0.26))));
    if (n > STATES.coins.start) {
      const top = LAYOUT.coins.y - (n - 1) * LAYOUT.coins.h - 30;
      parts.push(shock(LAYOUT.coins.x + 40, top, clamp01((tc - due(n - 1) - 0.14) / 0.3), 0.75, [[0.95, -0.55], [0.35, -1], [-0.35, -1.05]]));
    }
    const [px, py] = lines.tip ?? P(34, 48, 5);
    parts.push(writer(px, py, { lift: 40 * seg(tc, WRITE_END, WRITE_END + 0.25), mood: tc < WRITE_END ? 'focused' : 'proud' }));
    return frame(t, { camera: { zoom: 1 + 0.08 * E['ramp-up'](seg(t, 0, VOICE_END)) }, pivot: [480, 1150], cell: 108, oy: 30 }, parts)
      + titleCard(t, { term: 'prompt caching', to: VOICE_END - 0.1 });
  },
};
