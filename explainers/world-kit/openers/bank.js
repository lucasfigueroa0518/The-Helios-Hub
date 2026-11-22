// The opener bank (EX3-102): the animated intros every reel opens on, drawn at random, never one
// of the last HISTORY reels' openers.
//
// The opener is everything before the voice (Lucas, 2026-11-21). It shows "AI 101" with its
// education icon (lesson.js, the opener's own card) in its first frames, holds the whole card for
// at least CARD_HOLD, then its action takes the card away (a tear, a pull, a pop) and lands on frame
// 2, the definition beat, where the voice starts. The opener never lands on "AI 101" a second time.
// The whole hook lasts OPENER_BASE (0.8 s); a few run to OPENER_MAX (1.0 s). It is always silent: no voice line plays over it.
//
// This file is plain data and arithmetic (no imports), so Node (pace, the sound stem, the
// worker's pick) and the browser (the frames) read the same timings. Every time is on frame 1's
// clock, from 0. Each opener's `timing()` gives its moments; three are shared by every opener:
//   cardIn   "AI 101" and its icon are whole on screen
//   exitAt   the action that takes the card away starts (at least CARD_HOLD after cardIn)
//   end      frame 2 is uncovered: frame 1 ends here (at most OPENER_MAX)
// The rest are the opener's own beats, which its drawing and its score share.

/** How many of the latest reels' openers the next reel may not repeat (Lucas, 2026-10-19). */
export const HISTORY = 8;

/**
 * The whole hook before the voice, at most. Lucas, 2026-11-21: 0.8 s; 2026-11-22: the critter, balloon,
 * blocks and paper-plane openers read better 0.2 s longer (STRETCHED), so the cap is 1.0 s for those.
 */
export const OPENER_MAX = 1.0;
/** The usual length of an opener; only the ones Lucas lengthened run past it (2026-11-22). */
export const OPENER_BASE = 0.8;
/** "AI 101" with its icon stays whole on screen at least this long (Lucas, 2026-11-21). */
export const CARD_HOLD = 0.4;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** Beats in a row (the letters of AI 101, the blocks…). */
const beats = (n, first, every) => Array.from({ length: n }, (_, i) => r3(first + i * every));

/** Every moment of `M` played `k` times slower (an opener stretched as a whole, its feel kept). */
const slower = (k, M) => JSON.parse(JSON.stringify(M), (_, v) => (typeof v === 'number' ? r3(v * k) : v));
/** Lucas, 2026-11-22: these play 0.2 s longer than OPENER_BASE (0.8 → 1.0 s), evenly. */
const STRETCHED = 1.25;

export const OPENERS = [
  {
    key: 'paper-rip',
    name: 'Paper Rip',
    // the sheet with AI 101 and the pencil; the pencil taps down, the sheet strains, rips, its halves fly off
    timing: () => ({ cardIn: 0.12, strainAt: 0.34, exitAt: 0.56, end: 0.8 }),
  },
  {
    key: 'typewriter',
    name: 'Typewriter',
    // AI 101 typed on the ruled sheet, the books drop onto it, a ding, the sheet is pulled up
    timing: () => {
      const keys = beats(5, 0.02, 0.03);
      return { keys, books: [0.14, 0.26], cardIn: 0.26, ding: 0.3, exitAt: 0.66, end: 0.8 };
    },
  },
  {
    key: 'knock-knock',
    name: 'Knock Knock',
    // the scholar knocks on the screen while AI 101 and its icon write out at the top; the sheet drops away
    timing: () => slower(STRETCHED, { write: [0, 0.22], knocks: [0.06, 0.24, 0.42], cardIn: 0.24, exitAt: 0.66, end: 0.8 }),
  },
  {
    key: 'big-bang',
    name: 'Big Bang',
    // the card slams in, trembles as the charge builds, and blows apart
    timing: () => ({ slam: [0, 0.12], cardIn: 0.14, exitAt: 0.58, end: 0.8 }),
  },
  {
    key: 'eye-zoom',
    name: 'Eye Zoom',
    // AI 101 writes beside the scholar, who blinks; the camera dives into its eye, frame 2 inside the pupil
    timing: () => slower(STRETCHED, { write: [0, 0.2], cardIn: 0.2, blink: [0.42, 0.52], exitAt: 0.6, end: 0.8 }),
  },
  {
    key: 'balloon-pop',
    name: 'Balloon Pop',
    // a balloon printed with AI 101 and its icon puffs up in three gulps, swells, and pops
    timing: () => slower(STRETCHED, { gulps: [[0, 0.07], [0.08, 0.15], [0.16, 0.24]], cardIn: 0.24, exitAt: 0.64, end: 0.8 }),
  },
  {
    key: 'block-drop',
    name: 'Block Drop',
    // five blocks drop in as AI 101, the apple block last; the floor gives and they tumble out of frame
    timing: () => slower(STRETCHED, { lands: beats(6, 0, 0.04), cardIn: 0.24, exitAt: 0.64, end: 0.8 }),
  },
  {
    key: 'unboxing',
    name: 'Unboxing',
    // a box labelled AI 101 with its icon lands; a knife slits the tape, the flaps open, the camera dives in
    timing: () => ({ land: [0, 0.14], cardIn: 0.16, exitAt: 0.56, open: [0.56, 0.66], dive: [0.66, 0.8], end: 0.8 }),
  },
  {
    key: 'paper-plane',
    name: 'Paper Plane',
    // the sheet with AI 101 and its icon slides in, folds into a plane and flies off; the fold and the
    // flight get 0.2 s more so the plane reads as a plane (Lucas, 2026-11-22)
    timing: () => ({ slide: [0, 0.12], cardIn: 0.14, exitAt: 0.56, fold: [0.56, 0.76], fly: [0.76, 1.0], end: 1.0 }),
  },
  {
    key: 'scissors',
    name: 'Scissors Cut-Out',
    // scissors snip round the printed card, then the cut-out lifts away
    timing: () => ({ cardIn: 0.06, snips: beats(8, 0.08, 0.055), exitAt: 0.56, end: 0.8 }),
  },
];

/** Openers taken out of the bank, kept in openers/archive/ (Record Scratch: its frozen-critter hook no longer fits, Lucas 2026-11-21). */
export const ARCHIVED_OPENERS = ['record-scratch'];

export const OPENER_KEYS = OPENERS.map((o) => o.key);

/** Every opener now works over any reel (none touches the reel's hero); kept for the sound's pick. */
export const OBJECT_HERO_OPENERS = OPENER_KEYS;

/** The bank entry for `key`, or null. */
export const openerByKey = (key) => OPENERS.find((o) => o.key === key) ?? null;

/**
 * The hero's kind from STORYBOARD.md's `## Anchor scene` (`- hero: <entity id> — critter | object`,
 * EX3-128): 'object' in an object-led reel, else 'critter' (a storyboard without one: critter).
 * The same reading as lib/explainers/render/job.ts storyboardHero.
 */
export function storyboardHeroKind(storyboard) {
  const m = /^\s*-?\s*hero:.*?\b(critter|object)\b[^\n]*$/im.exec(String(storyboard ?? ''));
  return m?.[1]?.toLowerCase() === 'object' ? 'object' : 'critter';
}

/**
 * The full timing of opener `key`: its moments, plus `duration` (frame 1's length: its `end`),
 * `silent` (always) and `voice` 0. The voice arguments of earlier versions are accepted and ignored:
 * frame 1 never speaks.
 */
/** @returns {{ key: string, voice: 0, voiceAt: 0, silent: true, duration: number, cardIn: number, exitAt: number, end: number, [moment: string]: any }} */
export function openerTiming(key, _voice = 0, _words = [], _opts = {}) {
  const o = openerByKey(key);
  if (!o) throw new Error(`no opener "${key}" in the bank (${OPENER_KEYS.join(', ')})`);
  const M = o.timing();
  return { key, voice: 0, voiceAt: 0, silent: true, ...M, duration: r3(M.end) };
}

/** When frame 1's card is whole, from frame 1's start: the picture check's first frame-1 still waits for it (snap.mjs). */
export const hookRevealAt = (key) => openerTiming(key).cardIn;

/**
 * The next reel's opener: a random one of `pool` that none of the `recent` reels used (newest
 * first; only the first HISTORY count). If every opener in the pool was used that recently, the
 * one used longest ago (or never). `rand` is Math.random's shape.
 */
export function pickOpener(recent, { pool = OPENER_KEYS, history = HISTORY, rand = Math.random } = {}) {
  const keys = [...new Set(pool)].filter((k) => OPENER_KEYS.includes(k));
  if (!keys.length) throw new Error('the opener pool is empty');
  const blocked = new Set((recent ?? []).slice(0, history));
  const free = keys.filter((k) => !blocked.has(k));
  if (free.length) return free[Math.min(free.length - 1, Math.floor(rand() * free.length))];
  const lastUse = (k) => ((recent ?? []).includes(k) ? recent.indexOf(k) : Infinity);
  return keys.reduce((best, k) => (lastUse(k) > lastUse(best) ? k : best));
}
