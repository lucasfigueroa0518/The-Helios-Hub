// The opener bank (EX3-102): the animated intros Lucas kept from the two review batches of
// 2026-10-19 (planning/Explainer Reels/intros/INTROS.md). Every reel opens on one of them, drawn
// at random, never one of the last HISTORY reels' openers.
//
// This file is plain data and arithmetic (no imports), so Node (pace, the sound stem, the
// worker's pick) and the browser (the frames) read the same timings. Every time is on the
// opener's own clock (frame 1, from 0). `voiceAt` is when the opener line starts: pace.mjs puts
// that much silence before frame 1's voice. `timing(voice, words)` gives the moments the picture
// and the sound share, for a line of `voice` seconds whose words are `words` ([{ text, start }],
// from the line's own start).

/** How many of the latest reels' openers the next reel may not repeat (Lucas, 2026-10-19). */
export const HISTORY = 8;

/** Frame 1's hold after the line (pace.mjs HOLD). */
const HOLD = 0.15;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** When the opener line's first "this" starts (the template's slot word), from the line's start. */
function thisAt(words, fallback = 1.36) {
  const w = (words ?? []).find((x) => /^this\b/i.test(String(x.text ?? '').trim()));
  return Number.isFinite(w?.start) ? w.start : fallback;
}

/** Twelve beats in a row (the letters of AI BRAIN BREAK, the blocks, the snips…). */
const beats = (n, first, every) => Array.from({ length: n }, (_, i) => r3(first + i * every));

export const OPENERS = [
  {
    key: 'paper-rip',
    name: 'Paper Rip',
    voiceAt: 0.4,
    timing: () => ({ breakAt: 0.4 }),
  },
  {
    key: 'record-scratch',
    name: 'Record Scratch Freeze',
    voiceAt: 1.0,
    timing: (voice, words) => ({ breakAt: 0.7, unfreezeAt: r3(1.0 + thisAt(words)) }),
  },
  {
    key: 'typewriter',
    name: 'Typewriter',
    voiceAt: 0,
    timing: () => {
      const keys = beats(12, 0.06, 0.072);
      const ding = r3(keys[keys.length - 1] + 0.1);
      return { breakAt: ding, keys, dropAt: r3(ding + 0.04), zipEnd: r3(ding + 0.36) };
    },
  },
  {
    key: 'big-bang',
    name: 'Big Bang',
    voiceAt: 0.6,
    timing: () => ({ breakAt: 0.6 }),
  },
  {
    key: 'knock-knock',
    name: 'Knock Knock',
    voiceAt: 0.62,
    timing: () => ({ breakAt: 0.32, knocks: [0.32, 0.52], point: 0.66, writeAt: [0.68, 1.15], duck: [1.18, 1.42] }),
  },
  {
    key: 'eye-zoom',
    name: 'Eye Zoom-Out',
    voiceAt: 0.5,
    timing: () => ({ breakAt: 0.5, blink: [0.34, 0.46], zoom: [0.5, 0.92], landAt: 0.92 }),
  },
  {
    key: 'balloon-pop',
    name: 'Balloon Pop',
    voiceAt: 0.72,
    timing: () => ({ breakAt: 0.72, gulps: [[0, 0.22, 0.45], [0.24, 0.44, 0.75], [0.46, 0.68, 1.12]] }),
  },
  {
    key: 'block-drop',
    name: 'Block Drop',
    voiceAt: 0,
    timing: () => {
      const lands = beats(12, 0.1, 0.085);
      const last = lands[lands.length - 1];
      const wobble = [r3(last + 0.12), r3(last + 0.42)];
      return { breakAt: wobble[1], lands, fall: 0.13, wobble };
    },
  },
  {
    key: 'unboxing',
    name: 'Unboxing',
    voiceAt: 0.48,
    timing: () => ({ breakAt: 0.48, cut: [0.1, 0.42], open: [0.48, 0.66], short: [0.56, 0.76], dive: [0.82, 1.22] }),
  },
  {
    key: 'paper-plane',
    name: 'Paper Plane',
    voiceAt: 0.46,
    timing: () => ({ breakAt: 0.46, unfold: [0.74, 0.98], peel: [1.42, 1.8] }),
  },
  {
    key: 'scissors',
    name: 'Scissors Cut-Out',
    voiceAt: 0.08,
    timing: () => ({ breakAt: 0.86, snips: beats(8, 0.1, 0.095), lift: [0.86, 1.0], fall: [0.92, 1.3], drop: [1.02, 1.42] }),
  },
];

export const OPENER_KEYS = OPENERS.map((o) => o.key);

/** The bank entry for `key`, or null. */
export const openerByKey = (key) => OPENERS.find((o) => o.key === key) ?? null;

/**
 * The full timing of opener `key` for a line of `voice` seconds: every moment from its
 * timing(), plus `voiceAt`, `voice` (the line's length), and `duration` (frame 1's length, as
 * pace.mjs makes it: the lead, the line, the hold).
 */
/** @returns {{ key: string, voiceAt: number, voice: number, duration: number, breakAt: number, [moment: string]: any }} */
export function openerTiming(key, voice, words = []) {
  const o = openerByKey(key);
  if (!o) throw new Error(`no opener "${key}" in the bank (${OPENER_KEYS.join(', ')})`);
  return { key, voiceAt: o.voiceAt, voice: r3(voice), duration: r3(o.voiceAt + voice + HOLD), ...o.timing(voice, words) };
}

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
