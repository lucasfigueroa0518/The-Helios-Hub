/**
 * The critter on an "Are you smarter than AI?" slide (planning/AI Trivia/PLAN.md, Visuals: the critter).
 *
 * One recurring host: the Explainers critter D (visual system 5, explainers/world-kit/cast.js) in the
 * green body (orange vanishes on the orange slide). Each question dresses it (a wear.js role or pieces), places it, and directs its
 * mood, motion and gaze; on the answer clip it reacts to the payoff. The direction is plain data (what
 * the critter does, never geometry): code resolves every spot and every look or point target from the
 * slide's own boxes in the browser, so the critter always stands on the UI it names.
 *
 * Critter D has no mouth and no outfit: it acts with its lids, pupils, tilt, arms and body motion
 * (cast.js MOODS, ARM_POSES, STATES; motion.js MOTIONS). Names outside those closed lists throw in the
 * browser with the lists, so a bad direction fails the render loudly.
 *
 * The seam (AT-72): the critter runs on one clock across both clips. Clip 1 shows it from 0 to SEAM_T (its
 * last frame); clip 2 opens at SEAM_T, on that same frame, so its first frame is clip 1's last, and its beats
 * (in clip 2's own seconds) start after that frame.
 *
 * The kit is copied into each clip's project (KIT_FILES from kitDir()) and redrawn on every tick of one
 * clock tween on the clip's main timeline, the same seek-safe pattern as the Explainers frames.
 */
import path from 'node:path';

import { FPS, REVEAL_S, SEAM_T } from './timeline';

/** The room above the sign the critter stands in (px): part of the stack, so nothing else moves into it. */
export const ROOM_H = 250;
/** The critter's scale on the slide (a scale-1 critter D is 152 px, feet to crown). */
export const CRITTER_S = 1.55;

/** Where the critter stands: on the sign's top edge, at its left or right third. */
export const SPOTS = ['sign-left', 'sign-right'] as const;
export type Spot = (typeof SPOTS)[number];

/**
 * What a look or point can aim at: a part of the slide (resolved from its box in the browser), or
 * `viewer` (straight out of the screen).
 */
export const ANCHORS = ['viewer', 'question', 'choices', 'pill-A', 'pill-B', 'pill-C', 'correct', 'timer', 'line'] as const;
export type Anchor = (typeof ANCHORS)[number];

/** One moment of the critter's action. It holds until the next beat. */
export type CritterBeat = {
  /** Seconds into the clip. */
  at: number;
  /** A cast.js MOODS name (lids, pupils, tilt, arms). Default neutral. */
  mood?: string;
  /** A motion.js MOTIONS name, played once from this beat; default the mood's own move (MOOD_MOTION). */
  motion?: string;
  /** A cast.js STATES name (think, work, wait, done): its arms and its motion. */
  state?: string;
  /** A cast.js ARM_POSES name, or [left, right], overriding the mood's arms. */
  arms?: string | [string, string];
  /** Where the eyes look. Without it they glance about on their own. */
  lookAt?: Anchor;
  /** The free hand reaches toward it. */
  point?: Anchor;
  /** Put the role's hand prop down for this beat. */
  propDown?: boolean;
};

export type CritterDirection = {
  spot: Spot;
  /** A cast.js BODIES name (orange, green, ink, white); default green (it reads on the orange slide). */
  body?: string;
  /** A wear.js ROLES name (its head piece, hand prop, bow tie), or the pieces directly. */
  role?: string;
  head?: string;
  hand?: string;
  bowtie?: boolean;
  headTone?: string;
  /**
   * The question clip's beats (0 s to its last frame) and the answer clip's (after 0, up to 5 s; the reveal
   * lands at 0.5 s). The answer clip opens on the question clip's last frame, so no answer beat is at 0.
   */
  question: CritterBeat[];
  answer: CritterBeat[];
};

/** The kit modules the critter needs (cast.js and everything it and motion.js import). */
export const KIT_FILES = ['cast.js', 'wear.js', 'core.js', 'motion.js', 'draw.js', 'seams.js', 'hershey-sans.js'];

/** Where the kit is read from: TRIVIA_KIT_DIR when set, else this checkout's explainers/world-kit. */
export function kitDir(): string {
  return process.env.TRIVIA_KIT_DIR || path.join(process.cwd(), 'explainers', 'world-kit');
}

/** What is wrong with a direction (empty when it may be drawn). */
export function critterProblems(d: CritterDirection, clipS: { question: number; answer: number }, opponent = false): string[] {
  const out: string[] = [];
  if (!SPOTS.includes(d.spot)) out.push(`unknown spot "${d.spot}"`);
  else if (opponent && d.spot !== 'sign-right') out.push(`spot "${d.spot}": the opponent's label owns the left of the room, so the critter stands on sign-right`);
  for (const role of ['question', 'answer'] as const) {
    const beats = d[role];
    if (!beats?.length) out.push(`no ${role} beats`);
    for (const b of beats ?? []) {
      if (!(b.at >= 0 && b.at <= clipS[role])) out.push(`${role} beat at ${b.at}s is outside the clip`);
      else if (role === 'question' && b.at > SEAM_T) out.push(`question beat at ${b.at}s is after the clip's last frame (${SEAM_T.toFixed(3)}s)`);
      else if (role === 'answer' && !(b.at >= 1 / FPS)) out.push(`answer beat at ${b.at}s: the answer clip opens on the question's last frame, so its beats start after its first frame`);
      for (const k of ['lookAt', 'point'] as const) {
        const a = b[k];
        if (a !== undefined && !ANCHORS.includes(a)) out.push(`${role} beat at ${b.at}s: unknown ${k} target "${a}"`);
      }
    }
  }
  return out;
}

/**
 * The page's critter module: reads the direction (#tv-critter-data), finds its spot and its targets from
 * the slide's boxes, adds one clock tween to the main timeline, and redraws the critter on every tick.
 * HyperFrames waits on buildReady until frame 0 is drawn.
 */
export function critterModule(clipS: number): string {
  return `import { critter, critterShadow, tileScale } from './assets/kit/cast.js';
import { MOTIONS, MOOD_MOTION, motionAt, blinkAt, glanceAt } from './assets/kit/motion.js';
import { wear as resolveWear } from './assets/kit/wear.js';
const D = JSON.parse(document.getElementById('tv-critter-data').textContent);
const host = document.getElementById('tv-critter');
const stage = document.getElementById('tv-stage').getBoundingClientRect();
const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - stage.left, y: r.top - stage.top, w: r.width, h: r.height }; };
const centre = (b) => [b.x + b.w / 2, b.y + b.h / 2];
const sign = box(document.getElementById('tv-sign'));
const S = D.s;
const flip = D.spot === 'sign-right';
const feet = [sign.x + sign.w * (flip ? 0.8 : 0.2), sign.y + 4];
const k = tileScale(S);
const face = [feet[0], feet[1] - 96 * k];
const pills = [...document.querySelectorAll('#tv-choices .ch')].map(box);
const byId = (id) => { const el = document.getElementById(id); return el ? centre(box(el)) : null; };
const ANCHOR = {
  viewer: null,
  question: byId('tv-q'),
  choices: byId('tv-choices'),
  'pill-A': pills[0] ? centre(pills[0]) : null,
  'pill-B': pills[1] ? centre(pills[1]) : null,
  'pill-C': pills[2] ? centre(pills[2]) : null,
  correct: D.correct >= 0 && pills[D.correct] ? centre(pills[D.correct]) : null,
  timer: byId('tv-timer'),
  line: byId('tv-line'),
};
const wear = {};
for (const key of ['role', 'head', 'hand', 'bowtie', 'headTone']) if (D[key] != null) wear[key] = D[key];
const heldProp = resolveWear(wear).hand;
// one clock across both clips: clip 2's frame 0 is clip 1's last frame (SEAM_T), on the frame grid
const beats = [...D.beats].sort((a, b) => a.at - b.at);
const clockAt = (t) => Math.round((D.t0 + t) * D.fps) / D.fps;
const beatAt = (t) => { let cur = beats[0]; for (const b of beats) if (b.at <= t) cur = b; return cur; };
// a look target as the pupils' glance [x, y] in -1..1, in the tile's own frame (a flip mirrors x)
const lookAt = (a) => {
  if (a === 'viewer') return [0, 0];
  const p = ANCHOR[a];
  if (!p) return null;
  const dx = p[0] - face[0], dy = p[1] - face[1], n = Math.hypot(dx, dy) || 1;
  return [(flip ? -dx : dx) / n, dy / n];
};
// the hand that reaches for a target: the left one when the right holds a prop
const pointArms = (a) => {
  const p = ANCHOR[a === 'viewer' ? 'choices' : a];
  if (!p) return null;
  const rel = [((flip ? -1 : 1) * (p[0] - feet[0])) / S, (p[1] - feet[1]) / S];
  return heldProp ? { l: rel } : rel[0] >= 0 ? { r: rel } : { l: rel };
};
// the body: the beat's move played once from its 'on' mark, then the idle loop from rest
const poseAt = (b, t) => {
  const name = b.motion ?? b.state ?? MOOD_MOTION[b.mood ?? 'neutral'];
  if (name && !name.startsWith('idle')) {
    const M = MOTIONS[name];
    if (!M) throw new Error('HX: motion "' + name + '" must be one of ' + Object.keys(MOTIONS).join(', '));
    const u = (t - b.at) + (M.marks.on ?? 0);
    if (u < M.total) return motionAt(name, u, { loop: false });
    return motionAt('idle', u - M.total);
  }
  return motionAt(name || 'idle', t - b.at);
};
const svg = (inner) => '<svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">' + inner + '</svg>';
function draw(clipT) {
  const t = clockAt(clipT);
  const b = beatAt(t);
  const pose = poseAt(b, t);
  const o = { body: D.body || 'green', s: S, flip, pose, mood: b.mood ?? 'neutral', blink: blinkAt(t), ...wear };
  if (b.state) o.state = b.state;
  if (b.arms) o.arms = b.arms;
  if (b.point) { const a = pointArms(b.point); if (a) o.arms = a; }
  if (b.propDown) o.hand = null;
  o.look = (b.lookAt && lookAt(b.lookAt)) || glanceAt(t);
  host.innerHTML = svg(critterShadow(feet[0], feet[1], { s: S, pose, flip }) + critter(feet[0], feet[1], o));
}
const clock = { t: 0 };
window.__timelines.main.fromTo(clock, { t: 0 }, { t: ${clipS}, duration: ${clipS}, ease: 'none', onUpdate: () => draw(clock.t) }, 0);
draw(0);
window.__critterReady();
`;
}

/** When the opponent's result is shown, how long the critter's first reaction holds before it settles (s). */
export const SETTLE_AFTER_S = 1.3;

/**
 * The critter's reaction to the opponent's result (AT-74), from the reveal on, in the answer clip's seconds.
 * It is the AI on screen: it celebrates when the opponent was right and deflates when it was wrong.
 */
export function outcomeBeats(outcome: 'right' | 'wrong'): CritterBeat[] {
  const settle = REVEAL_S + SETTLE_AFTER_S;
  return outcome === 'right'
    ? [{ at: REVEAL_S, state: 'done', lookAt: 'correct' }, { at: settle, mood: 'happy', lookAt: 'viewer' }]
    : [{ at: REVEAL_S, mood: 'worried', lookAt: 'correct' }, { at: settle, mood: 'sleepy', lookAt: 'viewer' }];
}

/** The answer clip's beats: the direction's own, or, with an opponent, its beats before the reveal and the reaction from it. */
export function answerBeats(d: CritterDirection, outcome: 'right' | 'wrong' | null): CritterBeat[] {
  return outcome ? [...d.answer.filter((b) => b.at < REVEAL_S), ...outcomeBeats(outcome)] : d.answer;
}

/** The direction as the page reads it: both clips' beats on the one clock, and where this clip starts on it. */
export function critterData(d: CritterDirection, role: 'question' | 'answer', correctIndex: number, outcome: 'right' | 'wrong' | null = null): string {
  const beats = [...d.question, ...answerBeats(d, outcome).map((b) => ({ ...b, at: SEAM_T + b.at }))];
  const json = JSON.stringify({
    spot: d.spot,
    s: CRITTER_S,
    body: d.body ?? null,
    role: d.role ?? null,
    head: d.head ?? null,
    hand: d.hand ?? null,
    bowtie: d.bowtie ?? null,
    headTone: d.headTone ?? null,
    beats,
    t0: role === 'question' ? 0 : SEAM_T,
    fps: FPS,
    correct: correctIndex,
  });
  return json.replace(/</g, '\\u003c');
}
