// Smoke fixture, frame 2: the anchor scene on the night ground (checks light captions), in two
// shots (EX3-83): wide while the pen and sheet arrive, then a close-up on the coin stack as each
// costly line drops a coin.

import { T, el, scope } from '../kit/draw.js';
import { iso } from '../kit/core.js';
import { E, seg, twos } from '../kit/motion.js';
import { shotFrame } from '../kit/shots.js';
import { LAYOUT, sheet, ink, coins, writer } from '../world/world.js';

const GROUND = 'night';
/** Word times from assets/timing/02-scene.json: "pen" 0.92s, "sheet" 3.8s, "line" 5.24s. */
const PEN_AT = 0.92;
const SHEET_AT = 3.8;
const LINE_AT = 5.24;

/** Wide while the scene assembles; the cut to the coins lands on "sheet". */
export const shots = [
  { at: 0, kind: 'wide', on: [560, 1080] },
  { at: 3.6, kind: 'close', on: [LAYOUT.coins.x, LAYOUT.coins.y - 40], push: 1.08 },
];

export default {
  ground: GROUND,
  shots,
  draw(t) {
    scope('f02-', GROUND);
    const tc = twos(t);
    const s = 1.2;
    const drop = 120 * (1 - seg(tc, SHEET_AT - 0.6, SHEET_AT, E.slam));
    const P = iso(470, 820 - drop, s);
    return shotFrame(t, shots, () => {
      const parts = [];
      if (tc >= SHEET_AT - 0.6) parts.push(sheet(P));
      const written = 3 * seg(tc, LINE_AT - 0.4, LINE_AT + 1.0, E.linear);
      const lines = ink(P, s, written);
      if (written > 0) parts.push(lines.svg);
      parts.push(coins(Math.floor(written)));
      if (tc >= PEN_AT - 0.3) {
        const [px, py] = lines.tip ?? [700, 900];
        parts.push(writer(px, py, { lift: 80 * (1 - seg(tc, PEN_AT - 0.3, PEN_AT, E.spring)) }));
      }
      if (tc >= SHEET_AT + 0.4) {
        parts.push(el('text', { x: 300, y: 690, 'font-family': 'Roboto', 'font-weight': 700, 'font-size': 32, 'letter-spacing': '0.18em', fill: T.green, opacity: seg(t, SHEET_AT + 0.4, SHEET_AT + 0.7).toFixed(3) }, 'THE PROMPT'));
      }
      return parts;
    }, { pivot: [480, 1100], cell: 96 });
  },
};
