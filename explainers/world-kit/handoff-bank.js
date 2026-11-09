// The hand-off bank (Explainers 4.3): frame 3's calm resting point. The voice says "Let's dive into
// this in everyday terms."; the card "today's AI Brain Break: <term>" is the focus, and the reel's
// own analogy world leaks in around it (Lucas approved the nine round-3 directions of
// .explainers-local/4.2-plan/ramps/ramps-r3.mjs). Not a hype ramp: soft sound only, no risers or
// punches.
//
// Every template draws the REEL'S world (handoff.js renders assets/world/world.js), never a fixed
// one: its places, its hero, and, for the gather templates, only the analogy's mapped parts the
// storyboard names on frame 3 (`handoff_parts:`). The sound templates use the storyboard's
// `world_sounds:` (foley words the sfx catalog's tags know), never a fixed sound.
//
// This file is plain data and arithmetic (no imports), so Node (the job's pick, frames.mjs) and the
// browser (the frame) read the same timings. Times are fractions of the hand-off's rest (`HIT`: the
// frame's length less the exit), so they fit any line length.

/** How many of the latest reels' hand-offs the next reel may not repeat. */
export const HANDOFF_HISTORY = 4;
/** Frame 3 is the hand-off. */
export const HANDOFF_FRAME = 3;
/** The fixed hand-off line (story-design.md § 3). */
export const HANDOFF_LINE = "Let's dive into this in everyday terms.";
/** The exit: the card leaves and the world comes forward in the frame's last EXIT seconds. */
export const EXIT = 0.3;
/** The exit lands this many seconds before the frame ends: the last frames are frame 4's own first
 *  picture, pixel for pixel, so the straight cut into frame 4 never jumps. A render samples t < D
 *  only (the last frame is D - 1/fps), so an exit that ended exactly at D always left a ghost card. */
export const EXIT_HOLD = 0.1;
/** At most this many mapped parts gather around the card. */
export const MAX_PARTS = 3;

/**
 * The bank. `needs`: what the reel must have for the template to fit it ('critter': a critter hero;
 * 'parts': at least two mapped parts that the world draws; 'sounds': at least one world sound).
 * `beats`: the moments (fractions of HIT) where the world is heard or something arrives.
 */
export const HANDOFFS = [
  { key: 'glimpse-paper', name: 'Glimpse through paper', needs: [], beats: [0.4, 0.57, 0.73], concept: 'the card is translucent paper; the world shows through it soft and blurred; at the end the card lifts away and the world sharpens' },
  { key: 'glimpse-frosted', name: 'Glimpse through frosted glass', needs: [], beats: [0.47], concept: 'the whole frame is the out-of-focus world, the card a frosted sheet on top; a warm light glows through behind it; at the end the card lifts and focus pulls' },
  { key: 'sound-pair', name: 'Sound from the other side', needs: ['sounds'], beats: [0.37, 0.7], concept: 'the card is still; behind it the world is heard twice and the card trembles slightly on each; the world comes forward at the end' },
  { key: 'sound-steps', name: 'Steps behind the card', needs: ['sounds'], beats: [0.3, 0.42, 0.53, 0.65, 0.8], concept: 'the card is still; soft steps cross behind it, then one sound of the world; the card shivers on each' },
  { key: 'peek-critter', name: 'The hero peeks', needs: ['critter'], beats: [0.4, 0.8], concept: "the hero's head rises over the card's top edge, looks down at the term, blinks and stays" },
  { key: 'gather-slide', name: 'Mapped parts slide in', needs: ['parts'], beats: [0.33, 0.53, 0.73], concept: "the analogy's mapped parts slide in one at a time and settle at the card's corners" },
  { key: 'gather-drop', name: 'Mapped parts drop in', needs: ['parts'], beats: [0.3, 0.5, 0.7], concept: "the analogy's mapped parts drop in one at a time and land softly along the card's bottom edge" },
  { key: 'shine-once', name: 'One soft glint', needs: [], beats: [0.58], concept: 'one slow soft glint crosses the card over a faint warm glow; a gentle dissolve into the world' },
  { key: 'shine-warm', name: 'Warm light', needs: [], beats: [0.67], concept: 'warm window light falls across the card and a glint drifts slowly; the light carries into the world' },
];

export const HANDOFF_KEYS = HANDOFFS.map((h) => h.key);
export const handoffByKey = (key) => HANDOFFS.find((h) => h.key === key) ?? null;
/** The template every reel can take (no needs): the fallback when a pick cannot be drawn. */
export const FALLBACK_HANDOFF = 'shine-once';

/** @typedef {{ critterHero?: boolean, parts?: string[], sounds?: string[] }} HandoffReel */

/**
 * True when the reel (`{ critterHero, parts, sounds }`) has what template `key` needs.
 * @param {string} key
 * @param {HandoffReel} [reel]
 */
export function handoffFits(key, { critterHero = false, parts = [], sounds = [] } = {}) {
  const h = handoffByKey(key);
  if (!h) return false;
  return h.needs.every((n) => (n === 'critter' ? critterHero : n === 'parts' ? (parts?.length ?? 0) >= 2 : n === 'sounds' ? (sounds?.length ?? 0) >= 1 : true));
}

/**
 * The next reel's hand-off: a random template that fits the reel and that none of the `recent`
 * reels used (newest first; only the first `history`). If every fitting one was used that recently,
 * the one used longest ago (or never). Never throws: a reel that fits nothing gets FALLBACK_HANDOFF.
 * @param {string[] | null | undefined} recent
 * @param {HandoffReel} [reel]
 * @param {{ history?: number, rand?: () => number }} [opts]
 * @returns {string}
 */
export function pickHandoff(recent, reel = {}, { history = HANDOFF_HISTORY, rand = Math.random } = {}) {
  const keys = HANDOFF_KEYS.filter((k) => handoffFits(k, reel));
  if (!keys.length) return FALLBACK_HANDOFF;
  const blocked = new Set((recent ?? []).slice(0, history));
  const free = keys.filter((k) => !blocked.has(k));
  if (free.length) return free[Math.min(free.length - 1, Math.floor(rand() * free.length))];
  const lastUse = (k) => ((recent ?? []).includes(k) ? recent.indexOf(k) : Infinity);
  return keys.reduce((best, k) => (lastUse(k) > lastUse(best) ? k : best));
}

const r3 = (n) => Math.round(n * 1000) / 1000;

/** The hand-off's clock for a frame of `duration` seconds: when the card writes, the rest (HIT) and the exit. */
export function handoffTiming(duration) {
  const D = Number.isFinite(duration) && duration > 0 ? duration : 3.2;
  const HIT = r3(Math.max(1.2, D - EXIT));
  return { duration: r3(D), HIT, settle: r3(Math.max(HIT + 0.05, D - EXIT_HOLD)), write: [0, r3(Math.min(1.1, HIT * 0.4))] };
}

/**
 * The words a storyboard field lists (`a, b; c`), trimmed, at most `max`. Used for `handoff_parts:`
 * (entity ids) and `world_sounds:` (foley words).
 */
export function listField(value, max = 4) {
  return String(value ?? '')
    .replace(/["`]/g, '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(none|n\/a|-)$/i.test(s))
    .slice(0, max);
}

/**
 * Frame 3's sound events for template `key` (frame seconds, soft foley only): the pen writing the
 * card, the template's world sounds on its beats, and a paper slide as the card leaves. `sounds`
 * are the storyboard's world sounds; a template that needs one and has none stays silent there.
 * @param {string} key
 * @param {{ duration?: number, sounds?: string[], parts?: number }} [opts]
 * @returns {{ t: number, kind: string, what: string, dur?: number }[]}
 */
export function handoffEvents(key, { duration, sounds = [], parts = MAX_PARTS } = {}) {
  const h = handoffByKey(key) ?? handoffByKey(FALLBACK_HANDOFF);
  const { HIT, write, duration: D } = handoffTiming(duration);
  const at = (u) => r3(Math.min(D, Math.max(0, u * HIT)));
  const out = [{ t: write[0], kind: 'foley', what: 'pencil writing', dur: r3(Math.max(0.2, Math.min(8, write[1] - write[0]))) }];
  const s0 = sounds[0] ?? null;
  const s1 = sounds[1] ?? s0;
  switch (h.key) {
    case 'glimpse-paper':
    case 'glimpse-frosted':
    case 'sound-pair':
      if (s0) h.beats.forEach((u, i) => out.push({ t: at(u), kind: 'foley', what: h.key === 'sound-pair' && i === 1 ? s1 : s0 }));
      break;
    case 'sound-steps':
      if (s0) h.beats.forEach((u, i) => out.push({ t: at(u), kind: 'foley', what: i === h.beats.length - 1 ? s1 : 'footstep' }));
      break;
    case 'peek-critter':
      out.push({ t: at(h.beats[0]), kind: 'foley', what: 'cloth' });
      break;
    case 'gather-slide':
      h.beats.slice(0, parts).forEach((u) => out.push({ t: at(u), kind: 'foley', what: 'paper slide' }));
      break;
    case 'gather-drop':
      h.beats.slice(0, parts).forEach((u) => out.push({ t: at(u + 0.08), kind: 'foley', what: 'place' }));
      break;
    default:
      out.push({ t: at(h.beats[0]), kind: 'foley', what: 'chime' });
  }
  out.push({ t: r3(Math.min(D, HIT)), kind: 'foley', what: 'paper slide' });
  return out;
}
