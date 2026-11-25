// Frame 1 of every reel (EX3-102): the bank's opener. Code writes assets/frames/01-opener.js
// (frames.mjs writeOpener) as one call to openerFrame(); nobody builds frame 1.
//
// Lucas, 2026-11-21: the opener shows "AI 101" with its icon first (ctx.hook, the card code writes
// as assets/frames/01-hook.js, lesson.js), holds it, then takes it away and lands on frame 2, the
// definition beat: `ctx.next` is frame 2's scene, and what the opener uncovers is frame 2's first
// picture (common.js nextBeat), so the cut into frame 2 doesn't jump.

import { scope } from '../draw.js';
import { openerTiming } from './bank.js';
import paperRip from './paper-rip.js';
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
 * Frame 1's scene module for opener `key`. `hook` is the AI 101 card module (01-hook.js: its default
 * export and its `hero`, the house scholar when the card has one); `next` is frame 2's module (its
 * default export: { ground, shots, draw(t) }), or null, when the opener uncovers plain paper.
 * Earlier callers' `voice`, `words` and `silent` are accepted and ignored: frame 1 never speaks.
 */
export function openerFrame(key, { hook, next = null, term = '' }) {
  const draw = DRAW[key];
  if (!draw) throw new Error(`no opener "${key}" in the bank`);
  const card = hook.default ?? hook;
  const after = next ? next.default ?? next : null;
  const ground = card.ground ?? 'paper';
  const ctx = {
    key,
    hook: {
      ground,
      lesson: true,
      shots: [],
      hero: hook.hero ?? card.hero ?? null,
      draw: (t, o) => {
        const svg = card.draw(t, o);
        scope('f01-', ground);
        return svg;
      },
    },
    next: after
      ? {
          ground: after.ground ?? 'paper',
          // frame 2 draws under its own id prefix; frame 1's goes back after it
          draw: (t = 0) => {
            const svg = after.draw(t);
            scope('f01-', ground);
            return svg;
          },
        }
      : null,
    M: openerTiming(key),
    term,
  };
  return {
    ground,
    shots: [],
    opener: key,
    draw(t) {
      // one prefix for the frame (the card and frame 2 scope themselves the same way when they draw)
      scope('f01-', ground);
      return draw(t, ctx);
    },
  };
}
