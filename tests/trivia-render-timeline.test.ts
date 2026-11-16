/** "Are you smarter than AI?" motion (CONTRACT-2 §1–§2): durations, the timer and its ticks, the bulbs, and the reveal on the hit at +0.5 s. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { MASTER_FILE } from '@/lib/stories/trivia/render/audio';
import { CONFETTI_COLORS, CONFETTI_COUNT, confettiPieces } from '@/lib/stories/trivia/render/confetti';
import {
  answerTimeline, BEAT_S, bezier, BULB_OFF, BULB_ON, BULB_STEP_S, CLIP_S, digitAt, EASES, FPS, GREEN, LINE_S, MASTER_S, POP_PEAK, POP_REST, POP_S,
  POSTER_AT, questionTimeline, REVEAL_S, SOUND, timelineScript, type Tween,
} from '@/lib/stories/trivia/render/timeline';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const frames = (s: number) => Array.from({ length: Math.round(s * FPS) }, (_, f) => f / FPS);

test('durations: clip 1 is 10.0 s, clip 2 is 5.0 s, 30 fps; posters at 2.0 s and 0.9 s', () => {
  assert.deepEqual(CLIP_S, { question: 10, answer: 5 });
  assert.equal(FPS, 30);
  assert.equal(MASTER_S, 15);
  assert.deepEqual(POSTER_AT, { question: 2, answer: 0.9 });
});

test('show-master.flac on disk is exactly 15.0 s, 48 kHz', { skip: spawnSync('ffprobe', ['-version']).status !== 0 && 'no ffprobe' }, () => {
  const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=sample_rate', '-of', 'json', MASTER_FILE], { encoding: 'utf8' });
  const j = JSON.parse(p.stdout) as { format: { duration: string }; streams: Array<{ sample_rate: string }> };
  assert.ok(near(Number(j.format.duration), 15, 0.005), `master is ${j.format.duration} s`);
  assert.equal(j.streams[0]!.sample_rate, '48000');
});

test('timer: the digit shows 10 − floor(t) on every frame of clip 1 and changes only on the whole-second ticks', () => {
  const tl = questionTimeline();
  for (const t of frames(CLIP_S.question)) assert.equal(digitAt(tl, t), 10 - Math.floor(t + 1e-9), `frame at ${t.toFixed(3)} s`);
  const changes = [...new Set(tl.filter((t) => t.target.startsWith('#tv-d-') && t.dur === 0).map((t) => t.at))].sort((a, b) => a - b);
  assert.deepEqual(changes, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const c of changes) assert.ok((SOUND.ticks as readonly number[]).includes(c), `digit change at ${c} s lands on a tick`);
});

test('timer: the ring drains linearly over the full 10 s; digits 3, 2, 1 pulse 1.45 → 1 over 0.35 s on the beeps (7, 8, 9 s)', () => {
  const tl = questionTimeline();
  const ring = tl.filter((t) => t.target === '#tv-timer');
  assert.deepEqual(ring, [{ target: '#tv-timer', at: 0, dur: 10, ease: 'none', from: { '--p': '100%' }, to: { '--p': '0%' }, sound: 'tick' }]);
  const pulses = tl.filter((t) => t.target.startsWith('#tv-d-') && t.dur > 0);
  assert.deepEqual(pulses.map((p) => [p.target, p.at]), [['#tv-d-3', 7], ['#tv-d-2', 8], ['#tv-d-1', 9]]);
  assert.deepEqual(pulses.map((p) => p.at), [...SOUND.beeps]);
  for (const p of pulses) {
    assert.deepEqual([p.from, p.to, p.dur, p.ease], [{ scale: 1.45 }, { scale: 1 }, 0.35, 'pop']);
    // Each pulse lands on the second its digit appears.
    assert.equal(digitAt(tl, p.at), Number(p.target.slice('#tv-d-'.length)));
  }
});

function bulbs(tl: Tween[]) {
  return tl.filter((t) => t.target.startsWith('.bulb'));
}

test('bulbs: lighting only (no sound), chasing in 0.5 s steps on clip 1 (the beat) and flashing in 0.25 s steps on clip 2', () => {
  assert.deepEqual(BULB_STEP_S, { question: BEAT_S, answer: BEAT_S / 2 });
  for (const [role, tl] of [['question', questionTimeline()], ['answer', answerTimeline(3, 1)]] as const) {
    const b = bulbs(tl);
    const step = BULB_STEP_S[role];
    const times = [...new Set(b.map((t) => t.at))].sort((x, y) => x - y);
    assert.equal(times.length, CLIP_S[role] / step - 1);
    times.forEach((t, k) => assert.ok(near(t, (k + 1) * step), `${role} step ${k + 1} at ${t}`));
    for (const t of b) {
      assert.equal(t.light, true);
      assert.equal(t.sound, undefined);
      assert.equal(t.dur, 0);
    }
    // At every step the two sets are opposite: one on, one dim.
    for (const at of times) {
      const p0 = b.find((t) => t.at === at && t.target === '.bulb.p0')!.to.opacity;
      const p1 = b.find((t) => t.at === at && t.target === '.bulb.p1')!.to.opacity;
      assert.deepEqual([p0, p1].sort(), [BULB_OFF, BULB_ON].sort());
    }
  }
  // Clip 1's steps all land on the 120 BPM grid (the ticks and tocks).
  const grid = new Set<number>([...SOUND.ticks, ...SOUND.tocks]);
  for (const t of bulbs(questionTimeline())) assert.ok(grid.has(t.at), `bulb step ${t.at} on the grid`);
});

test('reveal: every reveal layer starts on the hit at +0.5 s (frame 15); the answer line rises in at +0.6 s', () => {
  const tl = answerTimeline(4, 2);
  assert.equal(REVEAL_S, SOUND.hit);
  assert.equal(REVEAL_S, 0.5);
  assert.equal(REVEAL_S * FPS, 15, 'the hit is a whole frame');
  const reveal = tl.filter((t) => !t.light);
  const line = reveal.filter((t) => t.target === '#tv-line');
  assert.deepEqual(line.map((t) => [t.at, t.dur, t.ease, t.from, t.to]), [[LINE_S, 0.35, 'rise', { opacity: 0, y: 30, scale: 0.9 }, { opacity: 1, y: 0, scale: 1 }]]);
  assert.equal(LINE_S, 0.6);
  const pop2 = reveal.find((t) => t.target === '#tv-opt-2' && t.to.scale === POP_REST)!;
  for (const t of reveal) if (t !== pop2 && t.target !== '#tv-line') assert.equal(t.at, REVEAL_S, `${t.target} starts on the hit`);
  // The correct pill turns green with a check, and its letter gives way, on the hit.
  assert.deepEqual(reveal.find((t) => t.target === '#tv-opt-2' && t.dur === 0)!.to, { backgroundColor: GREEN, color: '#FFFFFF' });
  assert.deepEqual(reveal.find((t) => t.target === '#tv-opt-2 b')!.to, { backgroundColor: '#FFFFFF', color: GREEN });
  assert.deepEqual(reveal.find((t) => t.target === '#tv-check')!.to, { opacity: 1 });
  assert.deepEqual(reveal.find((t) => t.target === '#tv-opt-2 .tv-l')!.to, { opacity: 0 });
  // The pop: 1 → 1.12 by 45 % of 0.55 s, then → 1.05 at 0.55 s, both on the mock's overshoot curve.
  const pop1 = reveal.find((t) => t.target === '#tv-opt-2' && t.to.scale === POP_PEAK)!;
  assert.deepEqual([pop1.from, POP_PEAK, POP_REST], [{ scale: 1 }, 1.12, 1.05]);
  assert.ok(near(pop1.at + pop1.dur, pop2.at) && near(pop2.at + pop2.dur, REVEAL_S + POP_S));
  assert.ok(near(pop1.dur, 0.2475));
  // The wrong pills fade to 50 % over 0.4 s; the correct one does not fade.
  const fades = reveal.filter((t) => t.to.opacity === 0.5);
  assert.deepEqual(fades.map((t) => t.target).sort(), ['#tv-opt-0', '#tv-opt-1', '#tv-opt-3']);
  for (const f of fades) assert.deepEqual([f.dur, f.ease], [0.4, 'ease']);
});

test('confetti: 30 pieces in white, green and dark, flung from the pill on the hit, as the mock throws them', () => {
  const pieces = confettiPieces();
  assert.equal(pieces.length, CONFETTI_COUNT);
  assert.equal(CONFETTI_COUNT, 30);
  assert.deepEqual([...new Set(pieces.map((p) => p.color))], [...CONFETTI_COLORS]);
  assert.deepEqual([...CONFETTI_COLORS], ['#FFFFFF', '#138510', '#170b04']);
  assert.deepEqual(pieces[0], { color: '#FFFFFF', dx: 240, dy: 160, rot: 0 }, 'every piece also falls, so none rests on the correct pill');
  assert.ok(pieces.every((p) => Math.abs(p.dy) >= 80 || Math.abs(p.dx) >= 470), 'no piece settles inside the pill row');
  assert.deepEqual(confettiPieces(), pieces, 'the same burst every render');
  const tl = answerTimeline(3, 0).filter((t) => t.target.startsWith('#tv-cf-'));
  assert.equal(tl.length, 60);
  for (const t of tl) assert.deepEqual([t.at, t.ease], [REVEAL_S, 'conf']);
  const flights = tl.filter((t) => 'x' in t.to);
  assert.ok(flights.every((t) => t.dur === 1.6 && t.from?.scale === 0.2 && t.to.scale === 1));
});

test("eases: the page's cubic-bezier matches CSS (ease at 0.5 ≈ 0.802); the pop overshoots and lands on 1", () => {
  const ease = bezier(...EASES.ease);
  assert.ok(near(ease(0.5), 0.8024, 0.001), `ease(0.5) = ${ease(0.5)}`);
  const pop = bezier(...EASES.pop);
  const peak = Math.max(...Array.from({ length: 101 }, (_, i) => pop(i / 100)));
  assert.ok(peak > 1.05, `pop overshoots (${peak})`);
  assert.equal(pop(0), 0);
  assert.equal(pop(1), 1);
  for (let i = 0; i <= 100; i++) assert.ok(Number.isFinite(bezier(...EASES.conf)(i / 100)));
});

test('timelineScript: sets for instant changes, fromTo for first states, the mock eases, padded to the clip and registered as "main"', () => {
  const q = timelineScript(questionTimeline(), CLIP_S.question);
  assert.match(q, /tl\.fromTo\("#tv-timer", \{"--p":"100%"\}, \{ \.\.\.\{"--p":"0%"\}, duration: 10, ease: "none" \}, 0\);/);
  assert.match(q, /tl\.set\("#tv-d-9", \{"opacity":1\}, 1\);/);
  assert.match(q, /tl\.fromTo\("#tv-d-3", \{"scale":1\.45\}, \{ \.\.\.\{"scale":1\}, duration: 0\.35, ease: EASE\.pop \}, 7\);/);
  assert.match(q, /tl\.set\(\{\}, \{\}, 10\);/);
  assert.match(q, /window\.__timelines\["main"\] = tl;/);
  const a = timelineScript(answerTimeline(3, 1), CLIP_S.answer);
  assert.match(a, /const EASE = \{ pop: bez\(0\.2, 1\.6, 0\.4, 1\), rise: bez\(0\.2, 1\.4, 0\.4, 1\), conf: bez\(0\.1, 0\.7, 0\.3, 1\), ease: bez\(0\.25, 0\.1, 0\.25, 1\) \};/);
  assert.match(a, /tl\.fromTo\("#tv-opt-1", \{"scale":1\}, \{ \.\.\.\{"scale":1\.12\}, duration: 0\.2475\d*, ease: EASE\.pop \}, 0\.5\);/);
  assert.match(a, /tl\.to\("#tv-opt-1", \{ \.\.\.\{"scale":1\.05\}/);
  assert.match(a, /tl\.set\(\{\}, \{\}, 5\);/);
  // The script runs: the eases evaluate and every tween is handed to a timeline.
  const calls: string[] = [];
  const stub = { fromTo: () => calls.push('fromTo'), to: () => calls.push('to'), set: () => calls.push('set'), seek: () => undefined };
  const win: { __timelines?: Record<string, unknown> } = {};
  new Function('gsap', 'window', a)({ timeline: () => stub }, win);
  assert.equal(win.__timelines?.main, stub);
  assert.equal(calls.length, answerTimeline(3, 1).length + 1);
});
