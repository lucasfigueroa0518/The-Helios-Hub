/**
 * "Are you smarter than AI?" motion (CONTRACT-2 §1–§2), copied from the approved mock (marquee-create.html),
 * as plain data so tests can read it. HyperFrames seeks a paused GSAP timeline frame by frame, so every CSS
 * animation of the mock is a tween here, with the mock's own cubic-bezier curves (BEZIER_SRC).
 *
 *   Clip 1 (question, 10 s)  the ring drains linearly over 10 s; the digit shows 10 − floor(t), changing on
 *                            each whole second (the ticks); on 3, 2 and 1 (the beeps, 7, 8, 9 s) it pulses
 *                            1.45 → 1 over 0.35 s. The sign's bulbs chase in 0.5 s steps (on the beat).
 *   Clip 2 (answer, 5 s)     the bulbs flash in 0.25 s steps. On the hit (+0.5 s, crash + ding) the correct
 *                            pill turns green, its letter gives way to a check, and it pops 1 → 1.12 → 1.05;
 *                            the wrong pills fade to 50 %; 30 confetti burst from the pill. The answer line
 *                            rises in at +0.6 s.
 *
 * Bulbs are lighting, so they carry no sound cue. Everything else names the cue it lands on (SOUND).
 */
import { confettiPieces } from './confetti';
import type { SlideRole } from './layout';

export const FPS = 30;
/** Clip lengths (s). */
export const CLIP_S: Record<SlideRole, number> = { question: 10, answer: 5 };
/** Where each clip's sound starts in show-master.flac (s). */
export const MASTER_AT: Record<SlideRole, number> = { question: 0, answer: 10 };
export const MASTER_S = 15;
/**
 * The seam (a hard rule, AT-72): the answer clip's first frame is the question clip's last frame, pixel for
 * pixel. This is that last frame's time on clip 1; clip 2 opens on the same picture.
 */
export const SEAM_T = (Math.round(CLIP_S.question * FPS) - 1) / FPS;
/** Posters for the review: clip 1 at 2.0 s, clip 2 at 0.9 s (mid-reveal). */
export const POSTER_AT: Record<SlideRole, number> = { question: 2, answer: 0.9 };

/** The show sound's grid (scripts/trivia_show_sound.cjs): 120 BPM, a beat every 0.5 s. */
export const BEAT_S = 0.5;
export const SOUND = {
  /** Clip 1: a tick on each whole second, a tock on each half, beeps on 7, 8 and 9. */
  ticks: Array.from({ length: 10 }, (_, i) => i),
  tocks: Array.from({ length: 10 }, (_, i) => i + 0.5),
  beeps: [7, 8, 9],
  /** Clip 2: drumroll 0–0.5 s, then the crash + ding (the hit), applause after. */
  drumroll: [0, 0.5] as const,
  hit: 0.5,
} as const;

/** The reveal (clip 2): the hit, and the answer line. */
export const REVEAL_S = SOUND.hit;
export const LINE_S = 0.6;
/** Bulb steps: chase on the beat on clip 1, flash on the half beat on clip 2. */
export const BULB_STEP_S: Record<SlideRole, number> = { question: 0.5, answer: 0.25 };
export const BULB_ON = 1;
export const BULB_OFF = 0.22;
/** The timer (clip 1). */
export const TIMER_S = 10;
export const PULSE_DIGITS = [3, 2, 1] as const;
export const PULSE_S = 0.35;
export const PULSE_FROM = 1.45;
/** The correct pill's pop: the mock's okpop, 0.55 s, peaking at 45 %. */
export const POP_S = 0.55;
export const POP_PEAK_AT = 0.45;
export const POP_PEAK = 1.12;
export const POP_REST = 1.05;
/** The wrong pills fade to this over 0.4 s. */
export const WRONG_OPACITY = 0.5;
export const WRONG_S = 0.4;
export const LINE_IN_S = 0.35;
/** Clip 2 opens on clip 1's tap row (ring empty, digit 1); it fades out on the hit. */
export const TAP_OUT_S = 0.2;
export const CONFETTI_S = 1.6;
/** Confetti reaches full opacity at 15 % of its flight. */
export const CONFETTI_FADE_IN = 0.15;

export const ORANGE = '#FF5E1A';
export const GREEN = '#138510';
export const SIGN = '#170b04';

/**
 * CSS's cubic-bezier as a function (x1, y1, x2, y2) → (p) → eased p: Newton steps on x(t) with a bisection
 * fallback. One source string, so the page (timelineScript) and the tests run the same curve.
 */
export const BEZIER_SRC =
  '(x1, y1, x2, y2) => { const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx; const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by; const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t, dX = (t) => (3 * ax * t + 2 * bx) * t + cx; return (p) => { if (p <= 0) return 0; if (p >= 1) return 1; let t = p; for (let i = 0; i < 8; i++) { const e = X(t) - p, d = dX(t); if (Math.abs(e) < 1e-7 || Math.abs(d) < 1e-6) break; t -= e / d; } if (!(t >= 0 && t <= 1) || Math.abs(X(t) - p) > 1e-6) { let lo = 0, hi = 1; t = p; for (let i = 0; i < 50; i++) { if (X(t) < p) lo = t; else hi = t; t = (lo + hi) / 2; } } return Y(t); }; }';
export const bezier = new Function(`return (${BEZIER_SRC});`)() as (x1: number, y1: number, x2: number, y2: number) => (p: number) => number;

/** The mock's curves, by name. */
export const EASES = {
  /** okpop and the timer pulse: cubic-bezier(.2,1.6,.4,1), an overshoot. */
  pop: [0.2, 1.6, 0.4, 1],
  /** lineIn: cubic-bezier(.2,1.4,.4,1). */
  rise: [0.2, 1.4, 0.4, 1],
  /** conf: cubic-bezier(.1,.7,.3,1). */
  conf: [0.1, 0.7, 0.3, 1],
  /** CSS `ease` (nofade). */
  ease: [0.25, 0.1, 0.25, 1],
} as const;
export type EaseName = keyof typeof EASES | 'none';

export type Props = Record<string, number | string>;
export type CueId = 'tick' | 'beep' | 'hit';
export type Tween = {
  target: string;
  at: number;
  /** 0 = an instant set. */
  dur: number;
  ease: EaseName;
  from?: Props;
  to: Props;
  /** Lighting (bulbs): needs no sound. */
  light?: boolean;
  /** The sound cue it lands on. */
  sound?: CueId;
};

/** The bulbs: two alternating sets (p0, p1), toggled every `step` seconds after the first. */
function bulbTweens(role: SlideRole): Tween[] {
  const step = BULB_STEP_S[role];
  const n = Math.round(CLIP_S[role] / step);
  const t: Tween[] = [];
  for (let k = 1; k < n; k++) {
    const odd = k % 2 === 1;
    t.push(
      { target: '.bulb.p0', at: k * step, dur: 0, ease: 'none', to: { opacity: odd ? BULB_ON : BULB_OFF }, light: true },
      { target: '.bulb.p1', at: k * step, dur: 0, ease: 'none', to: { opacity: odd ? BULB_OFF : BULB_ON }, light: true },
    );
  }
  return t;
}

/**
 * Whether bulb set p0 is lit on clip 1's last frame. The page starts with p0 dim (trivia.css), and clip 1's
 * k-th step lights p0 when k is odd. Clip 2 swaps its sets' classes when p0 ends lit, so it opens on the
 * same bulbs (the seam) and flashes on from there.
 */
export function bulbsSwapOnAnswer(): boolean {
  const k = Math.floor(SEAM_T / BULB_STEP_S.question + 1e-9);
  return k % 2 === 1;
}

/** Clip 1: the ring, the digits, the pulses, the bulbs. */
export function questionTimeline(): Tween[] {
  // The ring drains to empty on the last frame (SEAM_T), so clip 2 can open on it exactly.
  const t: Tween[] = [{ target: '#tv-timer', at: 0, dur: SEAM_T, ease: 'none', from: { '--p': '100%' }, to: { '--p': '0%' }, sound: 'tick' }];
  for (let k = 1; k < TIMER_S; k++) {
    t.push(
      { target: `#tv-d-${TIMER_S - k + 1}`, at: k, dur: 0, ease: 'none', to: { opacity: 0 }, sound: 'tick' },
      { target: `#tv-d-${TIMER_S - k}`, at: k, dur: 0, ease: 'none', to: { opacity: 1 }, sound: 'tick' },
    );
  }
  for (const d of PULSE_DIGITS) {
    t.push({ target: `#tv-d-${d}`, at: TIMER_S - d, dur: PULSE_S, ease: 'pop', from: { scale: PULSE_FROM }, to: { scale: 1 }, sound: 'beep' });
  }
  return [...t, ...bulbTweens('question')];
}

/** The opponent's label swap on the hit (AT-74): the name fades out as the result pill pops in. */
export const OPP_SWAP_S = 0.45;

/**
 * Clip 2: opens on clip 1's last frame; the reveal on the hit, the tap row out, the answer line, the bulbs.
 * `n` options, the correct one at `correct` (0-based); with an opponent, its label turns into its result.
 */
export function answerTimeline(n: number, correct: number, opponent = false): Tween[] {
  const c = `#tv-opt-${correct}`;
  const hit = { at: REVEAL_S, sound: 'hit' as const };
  const t: Tween[] = [
    { target: c, ...hit, dur: 0, ease: 'none', to: { backgroundColor: GREEN, color: '#FFFFFF' } },
    { target: `${c} b`, ...hit, dur: 0, ease: 'none', to: { backgroundColor: '#FFFFFF', color: GREEN } },
    { target: `${c} .tv-l`, ...hit, dur: 0, ease: 'none', to: { opacity: 0 } },
    { target: '#tv-check', ...hit, dur: 0, ease: 'none', to: { opacity: 1 } },
    { target: c, ...hit, dur: POP_S * POP_PEAK_AT, ease: 'pop', from: { scale: 1 }, to: { scale: POP_PEAK } },
    { target: c, at: REVEAL_S + POP_S * POP_PEAK_AT, dur: POP_S * (1 - POP_PEAK_AT), ease: 'pop', to: { scale: POP_REST } },
    { target: '#tv-tap', ...hit, dur: TAP_OUT_S, ease: 'ease', from: { opacity: 1 }, to: { opacity: 0 } },
    { target: '#tv-line', at: LINE_S, dur: LINE_IN_S, ease: 'rise', from: { opacity: 0, y: 30, scale: 0.9 }, to: { opacity: 1, y: 0, scale: 1 }, sound: 'hit' },
  ];
  if (opponent) {
    t.push(
      { target: '#tv-opp-pre', ...hit, dur: TAP_OUT_S, ease: 'ease', from: { opacity: 1 }, to: { opacity: 0 } },
      { target: '#tv-opp-post', ...hit, dur: OPP_SWAP_S, ease: 'pop', from: { opacity: 0, scale: 0.6 }, to: { opacity: 1, scale: 1 } },
    );
  }
  for (let i = 0; i < n; i++) {
    if (i !== correct) t.push({ target: `#tv-opt-${i}`, ...hit, dur: WRONG_S, ease: 'ease', from: { opacity: 1 }, to: { opacity: WRONG_OPACITY } });
  }
  confettiPieces().forEach((p, k) => {
    const id = `#tv-cf-${k}`;
    t.push(
      { target: id, ...hit, dur: CONFETTI_S, ease: 'conf', from: { x: 0, y: 0, scale: 0.2, rotation: 0 }, to: { x: p.dx, y: p.dy, scale: 1, rotation: p.rot } },
      { target: id, ...hit, dur: CONFETTI_S * CONFETTI_FADE_IN, ease: 'conf', from: { opacity: 0 }, to: { opacity: 1 } },
    );
  });
  return [...t, ...bulbTweens('answer')];
}

/** What the timer's digit shows at `t` seconds into clip 1, read from the tweens (the last set at or before t wins). */
export function digitAt(tweens: Tween[], t: number): number {
  const shown = new Map<number, number>([[TIMER_S, 1]]);
  for (let d = 1; d < TIMER_S; d++) shown.set(d, 0);
  for (const tw of [...tweens].sort((a, b) => a.at - b.at)) {
    const m = /^#tv-d-(\d+)$/.exec(tw.target);
    if (m && tw.dur === 0 && tw.at <= t + 1e-9 && typeof tw.to.opacity === 'number') shown.set(Number(m[1]), tw.to.opacity);
  }
  const on = [...shown].filter(([, o]) => o > 0).map(([d]) => d);
  if (on.length !== 1) throw new Error(`${on.length} digits shown at ${t}s`);
  return on[0]!;
}

/**
 * The GSAP script for a clip: an instant change is a set; the first tween of each target and property is a
 * fromTo (its start state applies at once), later ones are plain to's, so seeking any frame from a fresh
 * load gives the same picture. The timeline is padded to the clip's length and registered as "main".
 */
export function timelineScript(tweens: Tween[], clipS: number): string {
  const lines: string[] = [];
  lines.push(`const bez = ${BEZIER_SRC};`);
  lines.push(`const EASE = { ${Object.entries(EASES).map(([k, v]) => `${k}: bez(${v.join(', ')})`).join(', ')} };`);
  lines.push('window.__timelines = window.__timelines || {};');
  lines.push('const tl = gsap.timeline({ paused: true });');
  const seen = new Set<string>();
  const sorted = [...tweens].sort((a, b) => a.at - b.at);
  for (const t of sorted) {
    const sel = JSON.stringify(t.target);
    if (t.dur === 0) {
      lines.push(`tl.set(${sel}, ${JSON.stringify(t.to)}, ${t.at});`);
      continue;
    }
    const ease = t.ease === 'none' ? '"none"' : `EASE.${t.ease}`;
    const to = `{ ...${JSON.stringify(t.to)}, duration: ${t.dur}, ease: ${ease} }`;
    const keys = Object.keys(t.from ?? t.to).map((k) => `${t.target}|${k}`);
    const first = keys.some((k) => !seen.has(k));
    keys.forEach((k) => seen.add(k));
    if (t.from && first) lines.push(`tl.fromTo(${sel}, ${JSON.stringify(t.from)}, ${to}, ${t.at});`);
    else lines.push(`tl.to(${sel}, ${to}, ${t.at});`);
  }
  lines.push(`tl.set({}, {}, ${clipS});`);
  lines.push('window.__timelines["main"] = tl;');
  lines.push('tl.seek(0);');
  return lines.join('\n');
}
