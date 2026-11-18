// Frame 1 of every reel (EX3-102): the bank's opener, landing on the AI 101 card (hx-6). Code
// writes assets/frames/01-opener.js (frames.mjs writeOpener) as one call to openerFrame(), and the
// card as assets/frames/01-hook.js (lesson.js); nobody builds frame 1.

import { scope } from '../draw.js';
import { openerTiming } from './bank.js';
import paperRip from './paper-rip.js';
import recordScratch from './record-scratch.js';
import typewriter from './typewriter.js';
import bigBang from './big-bang.js';
import knockKnock from './knock-knock.js';
import eyeZoom from './eye-zoom.js';
import balloonPop from './balloon-pop.js';
import blockDrop from './block-drop.js';
import unboxing from './unboxing.js';
import paperPlane from './paper-plane.js';
import scissors from './scissors.js';

export const DRAW = {
  'paper-rip': paperRip,
  'record-scratch': recordScratch,
  typewriter,
  'big-bang': bigBang,
  'knock-knock': knockKnock,
  'eye-zoom': eyeZoom,
  'balloon-pop': balloonPop,
  'block-drop': blockDrop,
  unboxing,
  'paper-plane': paperPlane,
  scissors,
};

/**
 * Frame 1's scene module for opener `key`. `hook` is the worker's hook module (its default export
 * plus its `hero`); `voice` is the opener line's length and `words` its word times (from the
 * line's own start, before the opener's lead); `term` is the storyboard's term. `silent` (D124):
 * frame 1 has no line, and the opener holds its wordmark to the cut (bank.js openerTiming).
 */
export function openerFrame(key, { hook, voice, words = [], term = '', silent = false }) {
  const draw = DRAW[key];
  if (!draw) throw new Error(`no opener "${key}" in the bank`);
  const scene = hook.default ?? hook;
  const ground = scene.ground ?? 'paper';
  const ctx = {
    hook: { ground, lesson: Boolean(scene.lesson ?? hook.LESSON), shots: scene.shots ?? hook.shots ?? [], hero: hook.hero ?? scene.hero ?? null, draw: (t, o) => {
      // the hook scopes its own ids; the opener's ids go back under the frame's prefix after it
      const svg = scene.draw(t, o);
      scope('f01-', ground);
      return svg;
    } },
    M: openerTiming(key, voice, words, { silent }),
    term,
  };
  return {
    ground,
    shots: ctx.hook.shots,
    opener: key,
    draw(t) {
      // one prefix for the frame (the hook scopes itself the same way when it draws)
      scope('f01-', ground);
      return draw(t, ctx);
    },
  };
}
