// Smoke fixture, frame 3 (define): the kit's dictionary card in the top half, filling in word by
// word on its voice times and staying (EX3-80); a visual of the definition below it.

import { scope } from '../kit/draw.js';
import { iso } from '../kit/core.js';
import { stamp, sheet as paperSheet } from '../kit/examples.js';
import { twos, frame } from '../kit/motion.js';
import { dictionaryCard } from '../kit/cards.js';

const GROUND = 'paper';
const DEFINITION = 'Prompt caching is when a model provider saves the repeated start of your prompt, so later requests reuse it instead of reading it again.';
/** From assets/timing/03-define.json: word i starts at 0.2 + 0.33 i. */
const WORDS = DEFINITION.split(' ').map((text, i) => ({ text, start: 0.2 + 0.33 * i }));
const SAVES_AT = WORDS[7].start;
const REUSE_AT = WORDS[17].start;

export default {
  ground: GROUND,
  draw(t) {
    scope('f03-', GROUND);
    const tc = twos(t);
    const s = 0.75;
    const P = iso(470, 1260, s);
    const press = (at) => Math.max(0, 1 - Math.abs(tc - at) / 0.35);
    const z = 120 * (1 - Math.max(press(SAVES_AT), press(REUSE_AT)));
    const parts = [
      paperSheet(P, 0, 0, 380, 300),
      stamp(P, s, 40, 30, 5 + z, 300, 160, 60, { squash: 0.25 * Math.max(press(SAVES_AT), press(REUSE_AT)) }),
    ];
    return frame(t, { camera: { zoom: 1 }, pivot: [540, 1250], cell: 84 }, parts)
      + dictionaryCard(t, { headword: 'prompt caching', pos: 'noun', words: WORDS }).svg;
  },
};
