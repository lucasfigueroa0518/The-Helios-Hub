// Frame 1 of every reel (EX3-102): the bank's opener over the reel's own hook scene. Code writes
// assets/frames/01-opener.js (frames.mjs writeOpener) as one call to openerFrame(); the frame
// worker writes only the hook, assets/frames/01-hook.js.

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
 * line's own start, before the opener's lead); `term` is the storyboard's term.
 */
export function openerFrame(key, { hook, voice, words = [], term = '' }) {
  const draw = DRAW[key];
  if (!draw) throw new Error(`no opener "${key}" in the bank`);
  const scene = hook.default ?? hook;
  const ground = scene.ground ?? 'paper';
  const ctx = {
    hook: { ground, shots: scene.shots ?? hook.shots ?? [], hero: hook.hero ?? scene.hero ?? null, draw: (t, o) => {
      // the hook scopes its own ids; the opener's ids go back under the frame's prefix after it
      const svg = scene.draw(t, o);
      scope('f01-', ground);
      return svg;
    } },
    M: openerTiming(key, voice, words),
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
