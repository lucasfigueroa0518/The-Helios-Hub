/** AI Trivia motion and layout rules (M1–M7, AT-30, AT-31, AT-33–AT-38, PLAN timing), checked on the timeline data and the slide markup. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { STING_FILE } from '@/lib/stories/trivia/render/audio';
import { compositionHtml } from '@/lib/stories/trivia/render/clip';
import { CONFETTI_COLORS, CONFETTI_SEED, confettiPieces } from '@/lib/stories/trivia/render/confetti';
import { arrowPaths, seedOf } from '@/lib/stories/trivia/render/pen';
import { ANSWER_ELEMENTS, HEADLINE, QUESTION_ELEMENTS, TAP_LINE, type SlideInput } from '@/lib/stories/trivia/render/TriviaSlide';
import {
  ambientAt, ambientEase, ambientTweens, answerTimeline, CLIP_S, DIM_OPACITY, DIM_SCALE, FPS, GREEN, HIT_S, lastMotion, ORANGE, POSTER_AT, PUNCH_S, PUNCH_SCALE, punchEase,
  questionTimeline, REVEAL_AT, REVEAL_FRAME, SETTLED_S, SOUND_CUES, STING_RISE_S, timelineScript, wipeClip, WIPE_S, type Tween,
} from '@/lib/stories/trivia/render/timeline';

const all = (n: number) => [...ambientTweens(0), ...questionTimeline(n), ...ambientTweens(1), ...answerTimeline(n, 1)];

test('M4: nothing moves linearly', () => {
  for (const n of [2, 3, 4]) for (const t of all(n)) assert.ok(!/^(none|linear)/.test(t.ease), `${t.target} is linear`);
});

const FRAME = 1 / FPS;
const clips = (n: number, c: number) => [
  { role: 'question' as const, tweens: [...ambientTweens(0), ...questionTimeline(n)] },
  { role: 'answer' as const, tweens: [...ambientTweens(1), ...answerTimeline(n, c)] },
];

/** Glow layers inside a card: lighting, never part of what must be visible. */
const GLOW_LAYER = /\.tv-(bloom|sheen)$/;
/** Frame-0 values that leave an element fully visible and in place. */
const NEUTRAL: Record<string, number> = { opacity: 1, x: 0, y: 0, xPercent: 0, yPercent: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, rotateX: 0, rotateY: 0 };

/**
 * The frame-0 state of everything under `ids`: timelineScript makes each (target, property)'s first
 * tween a fromTo, so its `from` shows on frame 0 wherever the tween starts. Returns what is not neutral.
 */
function hiddenAtZero(tweens: Tween[], ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...tweens].sort((x, y) => x.at - y.at)) {
    const [id, ...rest] = t.target.split(' ');
    for (const k of Object.keys(t.from ?? t.to)) {
      const key = `${t.target}|${k}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!ids.includes(id!) || GLOW_LAYER.test(rest.join(' ')) || !(k in NEUTRAL)) continue;
      const v = t.from?.[k];
      if (v !== undefined && v !== NEUTRAL[k]) out.push(`${t.target} ${k}=${v} at frame 0`);
    }
  }
  return out;
}

test('AT-30: slide 1 has header, question, every option and the tap line fully visible and still from frame 0', () => {
  for (const n of [2, 3, 4]) {
    const opts = Array.from({ length: n }, (_, i) => `#tv-opt-${i}`);
    const q = [...ambientTweens(0), ...questionTimeline(n)];
    assert.deepEqual(hiddenAtZero(q, ['#tv-head', '#tv-q', '#tv-opts', ...opts, '#tv-tap', '#tv-arrow']), []);
    // Nothing on slide 1 moves except light and the photo drift: no entrance at any time.
    assert.deepEqual(q.filter((t) => !t.light && t.target !== '#tv-photo').map((t) => t.target), []);
  }
});

test('AT-30: slide 2 has the options visible from frame 0; the answer line arrives on the hit with the orange wipe', () => {
  for (const [n, c] of [[2, 0], [3, 2], [4, 1]] as const) {
    const opts = Array.from({ length: n }, (_, i) => `#tv-opt-${i}`);
    const a = [...ambientTweens(1), ...answerTimeline(n, c)];
    assert.deepEqual(hiddenAtZero(a, ['#tv-head', '#tv-q', '#tv-opts', ...opts]), []);
    for (const id of ['#tv-ans']) {
      const first = a.filter((t) => t.target === id).sort((x, y) => x.at - y.at)[0]!;
      assert.ok(Math.abs(first.at - HIT_S) <= FRAME + 1e-9, `${id} starts at ${first.at}`);
    }
    const wipe = a.find((t) => t.target === `#tv-opt-${c} .tv-fill`)!;
    assert.ok(Math.abs(wipe.at - HIT_S) <= FRAME + 1e-9, 'the row fills orange on the hit');
  }
});

test('AT-31: every non-lighting motion starts on a sound cue (within ±1 frame); lighting needs none', () => {
  for (const [n, c] of [[2, 1], [3, 0], [4, 3]] as const) {
    for (const { role, tweens } of clips(n, c)) {
      for (const t of tweens) {
        if (t.light) continue;
        assert.ok(t.sound, `${role}: ${t.target} at ${t.at}s moves with no sound`);
        const cue = SOUND_CUES[role].find((q) => q.id === t.sound);
        assert.ok(cue, `${role}: ${t.target} names ${t.sound}, which this clip does not play`);
        assert.ok(Math.abs(cue.at - t.at) <= FRAME + 1e-9, `${role}: ${t.target} starts at ${t.at}s, its sound at ${cue.at}s`);
        assert.ok(!t.repeat, `${role}: ${t.target} repeats, and its repeats have no sound`);
      }
    }
  }
  // Lighting stays lighting: the only light is the letter ring turning white; it moves nothing.
  for (const { tweens } of clips(4, 2)) {
    for (const t of tweens.filter((x) => x.light)) {
      assert.match(t.target, /\.tv-chip$/);
      assert.deepEqual(Object.keys(t.to), ['borderColor']);
    }
  }
  // The reveal's new movers are motion on the hit, never passed off as lighting: the check mark and every confetti piece.
  for (const [n, c] of [[2, 0], [4, 3]] as const) {
    const a = answerTimeline(n, c);
    const movers = a.filter((t) => /^#tv-check|^#tv-cf-\d+/.test(t.target) || t.target.endsWith('.tv-fill'));
    const pieces = new Set(movers.filter((t) => t.target.startsWith('#tv-cf-')).map((t) => t.target.split(' ')[0]));
    assert.equal(pieces.size, confettiPieces().length, 'every confetti piece moves on the hit');
    assert.ok(movers.some((t) => t.target === '#tv-check') && movers.some((t) => t.target === '#tv-check path'), 'the check mark pops and draws on the hit');
    for (const t of movers) {
      assert.ok(!t.light, `${t.target} is marked as lighting`);
      assert.equal(t.sound, 'sting-hit', `${t.target} has no sound`);
      assert.ok(Math.abs(t.at - HIT_S) <= FRAME + 1e-9, `${t.target} starts at ${t.at}s, off the hit`);
    }
  }
});

/** RMS (dBFS) per video frame of a 16-bit PCM WAV, channels averaged. */
function frameRms(file: string): number[] {
  const b = fs.readFileSync(file);
  let off = 12, ch = 2, rate = 48000, bits = 16, data: Buffer | null = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(off + 10); rate = b.readUInt32LE(off + 12); bits = b.readUInt16LE(off + 22); }
    if (id === 'data') { data = b.subarray(off + 8, off + 8 + size); break; }
    off += 8 + size + (size % 2);
  }
  assert.ok(data && bits === 16, 'reveal-sting.wav is 16-bit PCM');
  const per = Math.round(rate / FPS), frames = Math.floor(data.length / 2 / ch / per);
  return Array.from({ length: frames }, (_, f) => {
    let s = 0;
    for (let i = f * per; i < (f + 1) * per; i++) {
      let v = 0;
      for (let k = 0; k < ch; k++) v += data!.readInt16LE((i * ch + k) * 2) / 32768;
      s += (v / ch) ** 2;
    }
    return 10 * Math.log10(s / per + 1e-12);
  });
}

test('the sting cues match reveal-sting.wav: the whoosh rises on frame 9, the hit lands on frame 18', () => {
  assert.equal(path.basename(STING_FILE), 'reveal-sting.wav');
  const r = frameRms(STING_FILE);
  const rise = r.findIndex((v, i) => i > 0 && v > -30 && v - r[i - 1]! >= 10);
  assert.ok(Math.abs(rise - Math.round(STING_RISE_S * FPS)) <= 1, `whoosh audible from frame ${rise}`);
  let hit = 1;
  for (let i = 1; i < r.length; i++) if (r[i]! - r[i - 1]! > r[hit]! - r[hit - 1]!) hit = i;
  assert.equal(hit, REVEAL_FRAME);
  // Before the rise the sting is far under the music: nothing is cued to it.
  assert.ok(Math.max(...r.slice(0, rise - 1)) < -40);
});

test('AT-36: only editor-native motion: no glows, no light sweeps, nothing on slide 1 but the photo drift', () => {
  for (const [n, c] of [[2, 0], [4, 3]] as const) {
    assert.deepEqual(questionTimeline(n), []);
    for (const { tweens } of clips(n, c)) assert.deepEqual(tweens.filter((t) => /glow|sheen|bloom|light|sweep/.test(t.target)).map((t) => t.target), []);
  }
});

/** power3.out progress of a tween at `s`. */
const progress = (t: Tween, s: number) => {
  const p = Math.min(1, Math.max(0, (s - t.at) / t.dur));
  return 1 - (1 - p) ** 3;
};

test('AT-38/M2: every reveal layer starts within a frame of the sting hit; the hit frame already shows it', () => {
  assert.equal(REVEAL_FRAME, Math.round(HIT_S * FPS));
  assert.ok(Math.abs(REVEAL_AT - HIT_S) <= FRAME + 1e-9 && REVEAL_AT <= HIT_S, 'sight may lead the hit by a frame, never trail it');
  for (const [n, c] of [[2, 0], [3, 2], [4, 1]] as const) {
    const a = answerTimeline(n, c);
    for (const t of a) assert.ok(Math.abs(t.at - HIT_S) <= FRAME + 1e-9, `${t.target} starts at ${t.at}s, not on the hit`);
    // The wipe: orange, left to right, ease-out, 150–200 ms; under way on the hit frame, untouched before it.
    const wipe = a.find((t) => t.target === `#tv-opt-${c} .tv-fill`)!;
    assert.match(wipe.ease, /^(power[2-4]|expo|circ)\.out$/);
    assert.ok(WIPE_S >= 0.15 && WIPE_S <= 0.2 && wipe.dur === WIPE_S);
    assert.deepEqual([wipe.from!.clipPath, wipe.to.clipPath], [wipeClip(100), wipeClip(0)], 'covers from the left edge to the right');
    assert.ok(progress(wipe, REVEAL_FRAME / FPS) > 0.3, 'the wipe is under way on the hit frame');
    assert.equal(progress(wipe, (REVEAL_FRAME - 1) / FPS), 0, 'nothing before the frame ahead of the hit');
    assert.equal(a.filter((t) => t.target.endsWith('.tv-fill')).length, 1, 'only the correct row fills');
    // The punch: one tween on the correct row, peak about 1.08, back to 1 by PUNCH_S.
    const punch = a.filter((t) => t.target === `#tv-opt-${c}`);
    assert.equal(punch.length, 1);
    assert.deepEqual([punch[0]!.ease, punch[0]!.from, punch[0]!.to, punch[0]!.dur], ['punch', { scale: 1 }, { scale: PUNCH_SCALE }, PUNCH_S]);
    // The wrong rows shrink slightly and fade; the correct one never does.
    for (let i = 0; i < n; i++) {
      const fades = a.filter((t) => t.target === `#tv-opt-${i}` && t.to.opacity === DIM_OPACITY && t.to.scale === DIM_SCALE);
      assert.equal(fades.length, i === c ? 0 : 1);
    }
    assert.ok(DIM_OPACITY >= 0.35 && DIM_OPACITY <= 0.45 && DIM_SCALE < 1 && DIM_SCALE >= 0.94);
    // The letter gives way to the check mark, which pops (overshoot) and draws on.
    assert.deepEqual(a.find((t) => t.target === `#tv-opt-${c} .tv-chip-l`)!.to, { opacity: 0, scale: 0.4 });
    assert.match(a.find((t) => t.target === '#tv-check')!.ease, /^back\.out/);
    assert.deepEqual(a.find((t) => t.target === '#tv-check path')!.to, { strokeDashoffset: 0 });
  }
});

test('AT-38: the punch overshoots to about 1.08 fast, springs back softly, and rests at 1 by 0.5 s after the hit', () => {
  const scale = (p: number) => 1 + (PUNCH_SCALE - 1) * punchEase(p);
  assert.equal(punchEase(0), 0);
  assert.equal(punchEase(1), 0);
  const samples = Array.from({ length: 501 }, (_, i) => scale(i / 500));
  const peak = Math.max(...samples), at = samples.indexOf(peak) / 500;
  assert.ok(Math.abs(peak - 1.08) < 1e-6 && at * PUNCH_S <= 0.12, `peak ${peak} at ${(at * PUNCH_S).toFixed(3)} s`);
  assert.ok(Math.min(...samples) > 0.98, 'a soft spring: at most a small dip under 1');
  // No jumps between frames: every frame-to-frame step is small.
  for (let f = 1; f <= PUNCH_S * FPS; f++) assert.ok(Math.abs(scale(f / (PUNCH_S * FPS)) - scale((f - 1) / (PUNCH_S * FPS))) < 0.05);
  assert.ok(Math.abs(scale(0.9) - 1) < 0.003, 'settled in the last tenth');
});

test('AT-38: the confetti is a seeded 30–50 piece burst in orange, white and green, with spin and gravity, over within 1.2 s', () => {
  const p = confettiPieces();
  assert.ok(p.length >= 30 && p.length <= 50, `${p.length} pieces`);
  assert.deepEqual(confettiPieces(), p, 'the same seed throws the same burst');
  assert.notDeepEqual(confettiPieces(CONFETTI_SEED + 1), p, 'another seed throws another');
  assert.deepEqual(CONFETTI_COLORS.map((c) => c.color), [ORANGE, '#FFFFFF', GREEN]);
  assert.deepEqual(new Set(p.map((x) => x.color)), new Set([ORANGE, '#FFFFFF', GREEN]));
  for (const x of p) {
    assert.ok(x.w <= 20 && x.h <= 34, 'small pieces');
    assert.ok(x.up > 0 && x.fall > 0 && Math.abs(x.spin) >= 180, 'thrown up, pulled down, spinning');
  }
  assert.ok(p.some((x) => x.dx < -150) && p.some((x) => x.dx > 150), 'both ways off the row');
  const a = answerTimeline(4, 1);
  const cf = a.filter((t) => t.target.startsWith('#tv-cf-'));
  assert.equal(cf.length, p.length * 4);
  for (const t of cf) assert.ok(t.at + t.dur - HIT_S <= 1.2 + 1e-9, `${t.target} still flying at ${t.at + t.dur}s`);
  // Gravity: the drop accelerates (ease-in) while the throw decelerates (ease-out); they fade out at the end.
  assert.ok(cf.filter((t) => 'y' in t.to && t.target.endsWith('.tv-cf-in')).every((t) => /\.in$/.test(t.ease)));
  assert.ok(cf.filter((t) => 'x' in t.to).every((t) => /\.out$/.test(t.ease) && 'rotation' in t.to));
  assert.ok(cf.filter((t) => 'opacity' in t.to).every((t) => t.to.opacity === 0));
  // Hidden until the hit: each piece starts at scale 0.
  assert.ok(cf.filter((t) => 'scale' in t.to).every((t) => t.from!.scale === 0));
});

test('M5: the answer clip holds a settled final 1.5 s, with no light sweep (AT-36)', () => {
  const a = answerTimeline(4, 3);
  assert.ok(lastMotion(a) <= SETTLED_S + 1e-9, `last motion at ${lastMotion(a)}`);
  assert.ok(CLIP_S - SETTLED_S >= 1.5);
  assert.equal(a.filter((t) => t.target.endsWith('.tv-sheen')).length, 0);
});

test('M6: the ambient drift spans both clips on one curve, continuous in speed, still moving at the end', () => {
  const e0 = ambientEase(0), e1 = ambientEase(1);
  assert.equal(e0(0), 0);
  assert.ok(Math.abs(e0(1) - 1) < 1e-12 && Math.abs(e1(1) - 1) < 1e-12);
  const h = 1e-4;
  const v = (s: number) => (ambientAt('photo', s + h).x! - ambientAt('photo', s - h).x!) / (2 * h);
  assert.ok(Math.abs(v(CLIP_S - 2 * h) - v(CLIP_S + 2 * h)) < 0.05, 'no jolt at the clip boundary');
  assert.ok(Math.abs(v(2 * CLIP_S - 2 * h)) > 0.5, 'still drifting at the last frame');
  // Clip 2's ambient tweens start where clip 1's end.
  const end0 = ambientTweens(0).find((t) => t.target === '#tv-photo')!.to;
  const start1 = ambientTweens(1).find((t) => t.target === '#tv-photo')!.from;
  assert.deepEqual(start1, end0);
});

test('timelineScript: fromTo for each first state, to after it, the ambient eases, registered as "main"', () => {
  const s = timelineScript([...ambientTweens(1), ...answerTimeline(3, 1)]);
  assert.match(s, /window\.__timelines\["main"\] = tl;/);
  assert.match(s, /ease: EASE\.ambient1/);
  assert.match(s, /tl\.fromTo\("#tv-opt-1", \{"scale":1\}, \{ \.\.\.\{"scale":1\.08\}, duration: 0\.5, ease: EASE\.punch \}/);
  assert.match(s, /punch: \(p\) => \{/);
  assert.match(s, /tl\.fromTo\("#tv-opt-0", \{"opacity":1,"scale":1\}, \{ \.\.\.\{"opacity":0\.4,"scale":0\.96\}/);
  assert.match(s, /tl\.fromTo\("#tv-cf-0", \{"scale":0\}/);
  assert.match(s, /tl\.fromTo\("#tv-ans", \{"opacity":0,"scale":0\.6\}/);
  assert.match(s, /tl\.set\(\{\}, \{\}, 5\);/);
  assert.doesNotMatch(s, /Math\.random|Date\.now/);
});

const SLIDE: Omit<SlideInput, 'role'> = {
  question: 'Which lab built the first program to beat a Go champion?',
  options: [{ letter: 'A', text: 'OpenAI' }, { letter: 'B', text: 'DeepMind' }, { letter: 'C', text: 'Meta AI' }],
  correct: 'B', answerLine: 'DeepMind did it with Go in 2016.', photo: 'assets/photo.jpg', dim: 0.5,
};
/** The drawn body of a composition: the slide markup only. */
const bodyOf = (html: string) => html.slice(html.indexOf('<body>'), html.indexOf('<script>', html.indexOf('<body>')));
const elementsOf = (html: string) => [...html.matchAll(/data-el="([a-z]+)"/g)].map((m) => m[1]);
const textOf = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('AT-33/AT-35: slide 1 draws exactly five elements (title, question, choices, tap line, arrow right of it) and no credit', async () => {
  const body = bodyOf(await compositionHtml({ ...SLIDE, role: 'question' }));
  assert.deepEqual(elementsOf(body), [...QUESTION_ELEMENTS]);
  // Nothing else carries text: the drawn words are exactly the five elements' words.
  const want = [HEADLINE, SLIDE.question, ...SLIDE.options.flatMap((o) => [o.letter, o.text]), TAP_LINE].join(' ');
  assert.equal(textOf(body), want);
  assert.doesNotMatch(body, /credit|Photo:/i);
  // The arrow follows the tap line inside one row, and its head is at the right end, pointing right.
  assert.match(body, /id="tv-tap"[^>]*>\s*<span[^>]*data-el="tap"[\s\S]*?<\/span>\s*<\/span>\s*<svg id="tv-arrow"/);
  const svg = /<svg id="tv-arrow"[^>]*width="(\d+)"[\s\S]*?<\/svg>/.exec(body)!;
  const head = [...svg[0].matchAll(/<path d="([^"]+)"/g)][1]![1]!;
  const xs = [...head.matchAll(/[ML]([\d.]+) /g)].map((m) => Number(m[1]));
  assert.ok(xs[1]! === Math.max(...xs) && xs[1]! > Number(svg[1]) * 0.85, `arrow head tip at x ${xs[1]} of ${svg[1]}`);
});

test('AT-33/AT-34/AT-35: slide 2 draws title, question, choices and the answer line, no credit; Classic text only', async () => {
  const q = await compositionHtml({ ...SLIDE, role: 'question' });
  const a = await compositionHtml({ ...SLIDE, role: 'answer' });
  assert.deepEqual(elementsOf(bodyOf(a)), [...ANSWER_ELEMENTS]);
  assert.doesNotMatch(bodyOf(a), /credit|Photo:|Tap to reveal/i);
  for (const html of [q, a]) {
    assert.match(html, /font-family: 'Inter'; src: url\('assets\/fonts\/Inter-Medium\.ttf'\); font-weight: 500/);
    assert.doesNotMatch(html, /Pragmatica|Roboto/);
  }
});

/** The page's CSS and markup (the GSAP script left out). */
const drawnOf = (html: string) => html.slice(0, html.lastIndexOf('<script>'));

test('AT-37: everything is level on both slides: no rotation or skew in the styles, the markup or the timeline (only confetti spins)', async () => {
  for (const role of ['question', 'answer'] as const) {
    const html = await compositionHtml({ ...SLIDE, role });
    const drawn = drawnOf(html);
    assert.doesNotMatch(drawn, /rotate|skew|matrix\(|tilt/i, `${role}: something is turned in the styles or markup`);
  }
  const ROT = /^(rotation|rotate|rotationZ|rotateZ|rotationX|rotationY|rotateX|rotateY|skewX|skewY|skew|transform)$/;
  for (const [n, c] of [[2, 0], [3, 1], [4, 3]] as const) {
    for (const { role, tweens } of clips(n, c)) {
      for (const t of tweens) {
        const turned = [...Object.keys(t.from ?? {}), ...Object.keys(t.to)].filter((k) => ROT.test(k));
        if (/^#tv-cf-\d+$/.test(t.target)) continue; // confetti pieces spin (AT-38)
        assert.deepEqual(turned, [], `${role}: ${t.target} turns`);
      }
    }
  }
  // The pen arrow is level: its shaft starts and ends on one line, its head strokes mirror each other.
  const { shaft, head } = arrowPaths(190, 100, seedOf(TAP_LINE));
  const ys = [...shaft.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => Number(m[2]));
  assert.equal(ys[0], ys.at(-1));
  const hp = [...head.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(hp[0]![0], hp[2]![0]);
  assert.ok(Math.abs(hp[0]![1] + hp[2]![1] - 2 * hp[1]![1]) < 0.11, 'head strokes mirror about the shaft');
});

test('AT-38: the reveal parts live only in the answer slide\'s correct row; the check is a drawn stroke; slide 1 is untouched', async () => {
  const q = bodyOf(await compositionHtml({ ...SLIDE, role: 'question' }));
  assert.doesNotMatch(q, /tv-fill|tv-check|tv-confetti|tv-cf/);
  const a = bodyOf(await compositionHtml({ ...SLIDE, role: 'answer' }));
  const rows = a.split(/(?=<div id="tv-opt-\d")/).slice(1);
  rows.forEach((row, i) => {
    const right = SLIDE.options[i]!.letter === SLIDE.correct;
    assert.equal(/class="tv-fill"/.test(row), right, `row ${i} fill`);
    assert.equal(/id="tv-check"/.test(row), right, `row ${i} check`);
    assert.equal(/id="tv-confetti"/.test(row), right, `row ${i} confetti`);
  });
  // A white stroked path, not a glyph or an emoji.
  const check = /<svg id="tv-check"[\s\S]*?<\/svg>/.exec(a)![0];
  assert.match(check, /<path d="M[\d. ]+L[\d. ]+L[\d. ]+" pathLength="1"/);
  assert.doesNotMatch(check.replace(/<[^>]+>/g, ''), /\S/, 'no text inside the check');
  const html = await compositionHtml({ ...SLIDE, role: 'answer' });
  assert.match(html, /\.tv-check path \{ fill: none; stroke: #FFFFFF;/);
  assert.match(html, /\.tv-fill \{[^}]*background: #FF5E1A;[^}]*clip-path: inset\(0% 100% 0% 0% round 24px\)/);
  // The markup and the timeline throw the same seeded burst.
  const pieces = [...a.matchAll(/id="tv-cf-(\d+)"/g)].length;
  const seed = seedOf(SLIDE.question);
  assert.equal(pieces, confettiPieces(seed).length);
  assert.match(html, new RegExp(`tl\\.fromTo\\("#tv-cf-0", \\{"x":0,"y":0,"rotation":${confettiPieces(seed)[0]!.rot0}\\}`));
  assert.equal(await compositionHtml({ ...SLIDE, role: 'answer' }), html, 'renders repeat exactly');
});

test('AT-38: clip 2\'s poster lands mid-confetti, so the still shows the reveal', () => {
  const flights = answerTimeline(4, 1).filter((t) => t.target.startsWith('#tv-cf-') && 'opacity' in t.to);
  assert.ok(POSTER_AT.answer > REVEAL_AT + 0.2 && flights.every((t) => t.at + t.dur > POSTER_AT.answer + 0.2), `poster at ${POSTER_AT.answer}s`);
});
