/**
 * AI Trivia motion (AT-18, AT-27, AT-30–AT-32, AT-36–AT-38, M1–M7, PLAN "Timing"), as plain data so tests can read it.
 * Motion is limited to what Instagram's own story editor and quiz sticker do (AT-36): no glows, no light
 * sweeps, and nothing tilted (AT-37: every element sits level; only confetti spins).
 *
 *   Question clip  the five elements are on screen, still, from frame 0 (AT-30); only the photo drifts.
 *                  The tension builds in the sound (the music swells, M1).
 *   Answer clip    everything but the answer line is on screen from frame 0. On the sting's hit (AT-38,
 *                  every layer starts at REVEAL_AT, one frame ahead of the hit so the hit frame already
 *                  shows it; sight may lead sound a little, never trail it):
 *                    the correct row fills orange in a fast left-to-right wipe and punches (scale 1.08,
 *                    then a soft spring back by 0.5 s); its letter gives way to a drawn white check mark;
 *                    a short seeded confetti burst comes off the row (confetti.ts, over by ~1.2 s);
 *                    the wrong rows shrink slightly and fade to 40 %; the answer line pops in.
 *                  Then a still, complete frame (M5).
 *   Both           the photo drifts on one slow curve that spans both clips and never stops (M6); nothing
 *                  is linear (M4).
 *
 * AT-31: every tween is either lighting (`light`: a colour lighting up; no sound needed) or motion, and
 * every motion names the sound cue (SOUND_CUES) it starts on, within a frame. The photo drift's cue is
 * the ambient bed (AT-32), which runs under both clips like the music; every reveal layer is the hit's.
 *
 * The ambient ease is a slice of one sine curve over AMBIENT_S, so clip 2 picks up the drift at the
 * speed clip 1 left it.
 */
import { confettiPieces, CONFETTI_SEED } from './confetti';

export const FPS = 30;
export const CLIP_S = 5;
export const CLIP_MS = CLIP_S * 1000;
/** The sting's hit, from clip 2's first frame (AT-27). */
export const HIT_S = 0.6;
export const HIT_MS = HIT_S * 1000;
/** Clip 2's frame that lands on the sting hit. */
export const REVEAL_FRAME = Math.round(HIT_S * FPS);
/** Every reveal layer starts one frame before the hit, so the hit's own frame shows it under way. */
export const REVEAL_AT = (REVEAL_FRAME - 1) / FPS;
/** The correct row's wipe (s): fast, ease-out. */
export const WIPE_S = 0.18;
/** The row's punch: peak scale, and the time from the hit until it has sprung back. */
export const PUNCH_SCALE = 1.08;
export const PUNCH_S = 0.5;
/** The wrong rows: shrink to this and fade to this. */
export const DIM_SCALE = 0.96;
export const DIM_OPACITY = 0.4;
/** The answer clip holds still (only the ambient drift moves) from here. */
export const SETTLED_S = 2.5;
/** Contrast is checked on these instants of each clip. */
export const SAMPLE_TIMES = [0, 1, 2.5, 4.9];
/** Posters for the review: clip 1 at 4.5 s, clip 2 at 0.9 s (mid-confetti, so the still shows the reveal). */
export const POSTER_AT = { question: 4.5, answer: 0.9 } as const;
/** The ambient curve's length: longer than both clips, so it is still moving at clip 2's end. */
export const AMBIENT_S = 13;

export const ORANGE = '#FF5E1A';
export const GREEN = '#138510';
export const OFF_BLACK = '#171717';

/**
 * The punch (AT-38): 0 → 1 (the overshoot peak) in the first fifth with an ease-out, then a soft,
 * damped spring back to 0 that starts at rest, dips once just under, and lands exactly on 0 at the end.
 * A tween from scale 1 to PUNCH_SCALE on this ease peaks at PUNCH_SCALE and ends back at 1. One source
 * string, so the page (timelineScript) and the tests run the same curve.
 */
export const PUNCH_EASE_SRC =
  '(p) => { if (p <= 0 || p >= 1) return 0; if (p < 0.2) { const q = p / 0.2; return 1 - (1 - q) * (1 - q); } const u = (p - 0.2) / 0.8, w = 2 * Math.PI; return Math.exp(-3.5 * u) * (Math.cos(w * u) + (3.5 / w) * Math.sin(w * u)) * (1 - u * u * u); }';
export const punchEase = new Function(`return (${PUNCH_EASE_SRC});`)() as (p: number) => number;
/** Eases the page defines itself (timelineScript), by name. */
const CUSTOM_EASE = /^(ambient[01]|punch)$/;

export type Props = Record<string, number | string>;
export type Tween = {
  target: string;
  at: number;
  dur: number;
  ease: string;
  from?: Props;
  to: Props;
  repeat?: number;
  yoyo?: boolean;
  /** The ambient drift (exempt from the settle rule). */
  ambient?: boolean;
  /** Lighting (glow, glow pulse, light sweep, light movement): needs no sound (AT-31). */
  light?: boolean;
  /** For motion: the sound cue it starts on (AT-31). */
  sound?: CueId;
};

/**
 * What the viewer hears, by clip, from the clip's first frame (AT-27, AT-31, AT-32). The sting's
 * card-place layer sits about 45 dB under its hit (inaudible under the music), so nothing on screen is
 * cued to it; its reversed whoosh becomes audible on frame 9 and the hit lands on frame 18 (tests read
 * reveal-sting.wav to hold this).
 */
export type CueId = 'ambient-bed' | 'sting-rise' | 'sting-hit';
export type SoundCue = { id: CueId; at: number; what: string };
export const STING_RISE_S = 0.3;
export const SOUND_CUES: Record<'question' | 'answer', SoundCue[]> = {
  question: [{ id: 'ambient-bed', at: 0, what: 'ambient air bed (continuous across both clips)' }],
  answer: [
    { id: 'ambient-bed', at: 0, what: 'ambient air bed (continuing from clip 1)' },
    { id: 'sting-rise', at: STING_RISE_S, what: "the sting's reversed whoosh rising" },
    { id: 'sting-hit', at: HIT_S, what: "the sting's bass hit + sparkle" },
  ],
};

/** The one ambient curve: sine.inOut over AMBIENT_S seconds. */
const S = (s: number) => -(Math.cos((Math.PI * s) / AMBIENT_S) - 1) / 2;

/** The ambient ease for clip `clip` (0 or 1): its slice of sine.inOut over AMBIENT_S, rescaled to 0–1. */
export function ambientEase(clip: 0 | 1): (p: number) => number {
  const a = S(clip * CLIP_S), b = S((clip + 1) * CLIP_S);
  return (p: number) => (S(clip * CLIP_S + p * CLIP_S) - a) / (b - a);
}

/** Where each ambient drift starts (clip 1's first frame) and ends (clip 2's last frame). */
export const AMBIENT_PATH = {
  photo: { from: { scale: 1.05, x: -14, y: 6 }, to: { scale: 1.115, x: 16, y: -9 } },
};

/** An ambient drift's values at `s` seconds into the set (0–10), on the one sine curve. */
export function ambientAt(k: keyof typeof AMBIENT_PATH, s: number): Record<string, number> {
  const { from, to } = AMBIENT_PATH[k];
  const f = (S(s) - S(0)) / (S(2 * CLIP_S) - S(0));
  return Object.fromEntries(Object.entries(from).map(([p, v]) => [p, Math.round((v + ((to as Record<string, number>)[p]! - v) * f) * 10000) / 10000]));
}

export function ambientTweens(clip: 0 | 1): Tween[] {
  const e = `ambient${clip}`;
  const span = (k: keyof typeof AMBIENT_PATH) => ({ from: ambientAt(k, clip * CLIP_S), to: ambientAt(k, (clip + 1) * CLIP_S) });
  return [
    // The photo drift is motion: the ambient bed starts with it and runs under both clips (AT-32).
    { target: '#tv-photo', at: 0, dur: CLIP_S, ease: e, ...span('photo'), ambient: true, sound: 'ambient-bed' },
  ];
}

const optIds = (n: number) => Array.from({ length: n }, (_, i) => `#tv-opt-${i}`);

/** The question clip's tweens for `n` options: none. The five elements stand still from frame 0 (AT-30, AT-33). */
export function questionTimeline(_n: number): Tween[] {
  return [];
}

/** The wipe's clip-path: `pct` of the row still uncovered on the right. */
export const wipeClip = (pct: number) => `inset(0% ${pct}% 0% 0% round 24px)`;

/** The answer clip's tweens for `n` options, the correct one at `correct` (0-based); `seed` picks the confetti. */
export function answerTimeline(n: number, correct: number, seed: number = CONFETTI_SEED): Tween[] {
  const opts = optIds(n);
  const c = opts[correct]!;
  const at = REVEAL_AT;
  const hit = { at, sound: 'sting-hit' as const };
  const t: Tween[] = [
    // The correct row fills orange, left to right, like an answered quiz sticker.
    { target: `${c} .tv-fill`, ...hit, dur: WIPE_S, ease: 'power3.out', from: { clipPath: wipeClip(100) }, to: { clipPath: wipeClip(0) } },
    // ... and punches: up to PUNCH_SCALE, then a soft spring back to 1 by PUNCH_S.
    { target: c, ...hit, dur: PUNCH_S, ease: 'punch', from: { scale: 1 }, to: { scale: PUNCH_SCALE } },
    // Its letter circle: the ring lights white, the letter gives way, a drawn white check pops in.
    { target: `${c} .tv-chip`, at, dur: 0.12, ease: 'power2.out', from: { borderColor: 'rgba(199,199,199,1)' }, to: { borderColor: 'rgba(255,255,255,1)' }, light: true },
    { target: `${c} .tv-chip-l`, ...hit, dur: 0.12, ease: 'power2.out', from: { opacity: 1, scale: 1 }, to: { opacity: 0, scale: 0.4 } },
    { target: '#tv-check', ...hit, dur: 0.36, ease: 'back.out(3)', from: { opacity: 0, scale: 0.3 }, to: { opacity: 1, scale: 1 } },
    { target: '#tv-check path', ...hit, dur: 0.24, ease: 'power2.out', from: { strokeDashoffset: 1 }, to: { strokeDashoffset: 0 } },
    // The answer line pops in like a text box placed in the editor.
    { target: '#tv-ans', ...hit, dur: 0.5, ease: 'back.out(2.2)', from: { opacity: 0, scale: 0.6 }, to: { opacity: 1, scale: 1 } },
  ];
  // The wrong rows step back: a little smaller, faded.
  opts.forEach((id, i) => {
    if (i !== correct) t.push({ target: id, ...hit, dur: 0.35, ease: 'power2.out', from: { opacity: 1, scale: 1 }, to: { opacity: DIM_OPACITY, scale: DIM_SCALE } });
  });
  // The confetti burst off the row (confetti.ts): flung out with drag and spin, pulled down, fading.
  confettiPieces(seed).forEach((p, k) => {
    const id = `#tv-cf-${k}`;
    t.push(
      { target: id, ...hit, dur: p.dur, ease: 'power3.out', from: { x: 0, y: 0, rotation: p.rot0 }, to: { x: p.dx, y: -p.up, rotation: p.rot0 + p.spin } },
      { target: id, ...hit, dur: 0.14, ease: 'back.out(2)', from: { scale: 0 }, to: { scale: 1 } },
      { target: `${id} .tv-cf-in`, ...hit, dur: p.dur, ease: 'power2.in', from: { y: 0 }, to: { y: p.fall } },
      { target: `${id} .tv-cf-in`, ...hit, dur: p.dur, ease: 'power4.in', from: { opacity: 1 }, to: { opacity: 0 } },
    );
  });
  return t;
}

/** The latest instant any non-ambient tween of `tweens` still moves (repeats included). */
export function lastMotion(tweens: Tween[]): number {
  return Math.max(0, ...tweens.filter((t) => !t.ambient).map((t) => t.at + t.dur * (1 + (t.repeat ?? 0))));
}

/**
 * The GSAP script for a clip: the first tween of each target is a fromTo (its start state applies at
 * once), later ones are plain to's, so seeking any frame from a fresh load gives the same picture.
 */
export function timelineScript(tweens: Tween[]): string {
  const lines: string[] = [];
  const S = `(s) => -(Math.cos((Math.PI * s) / ${AMBIENT_S}) - 1) / 2`;
  lines.push(`const S = ${S};`);
  lines.push(`const amb = (c) => { const a = S(c * ${CLIP_S}), b = S((c + 1) * ${CLIP_S}); return (p) => (S(c * ${CLIP_S} + p * ${CLIP_S}) - a) / (b - a); };`);
  lines.push(`const EASE = { ambient0: amb(0), ambient1: amb(1), punch: ${PUNCH_EASE_SRC} };`);
  lines.push(`window.__timelines = window.__timelines || {};`);
  lines.push(`const tl = gsap.timeline({ paused: true });`);
  const seen = new Set<string>();
  const sorted = [...tweens].sort((a, b) => a.at - b.at);
  for (const t of sorted) {
    const ease = CUSTOM_EASE.test(t.ease) ? `EASE.${t.ease}` : JSON.stringify(t.ease);
    const extra = `${t.repeat ? `, repeat: ${t.repeat}` : ''}${t.yoyo ? ', yoyo: true' : ''}`;
    const to = `{ ...${JSON.stringify(t.to)}, duration: ${t.dur}, ease: ${ease}${extra} }`;
    const sel = JSON.stringify(t.target);
    const keys = Object.keys(t.from ?? t.to).map((k) => `${t.target}|${k}`);
    const first = keys.some((k) => !seen.has(k));
    keys.forEach((k) => seen.add(k));
    if (t.from && first) lines.push(`tl.fromTo(${sel}, ${JSON.stringify(t.from)}, ${to}, ${t.at});`);
    else lines.push(`tl.to(${sel}, ${to}, ${t.at});`);
  }
  // Pad the timeline to the clip's full length so seeks past the last tween stay valid.
  lines.push(`tl.set({}, {}, ${CLIP_S});`);
  lines.push(`window.__timelines["main"] = tl;`);
  lines.push(`tl.seek(0);`);
  return lines.join('\n');
}
