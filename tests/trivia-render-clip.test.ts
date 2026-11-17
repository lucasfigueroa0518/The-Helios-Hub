/** "Are you smarter than AI?" clips: copy rules, the master split, delivery checks, and renderTriviaClips end to end with every subprocess and the browser stubbed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { RunResult, Runner } from '@/lib/reel-ai-drama/render/runner';
import { deliveryProblems, MASTER_FILE, masterProblems, muxArgs, parseProbe, posterArgs } from '@/lib/stories/trivia/render/audio';
import { copyProblems, renderTriviaClips, type TriviaFrameInput } from '@/lib/stories/trivia/render/clip';
import { QUESTION_PX, SAFE, slideLayout, type Measured } from '@/lib/stories/trivia/render/layout';
import type { Preflight, PreflightResult } from '@/lib/stories/trivia/render/preflight';
import { CLIP_S, MASTER_AT, MASTER_S } from '@/lib/stories/trivia/render/timeline';

const COPY = {
  question: 'Which company built the first AI to beat a world champion at Go?',
  options: [
    { letter: 'A' as const, text: 'Google DeepMind' },
    { letter: 'B' as const, text: 'OpenAI' },
    { letter: 'C' as const, text: 'IBM' },
  ],
  correct: 'B' as const,
  answerLine: 'AlphaGo did it in 2016, about ten years before experts thought it could.',
};

test('copyProblems: no exclamation marks or emoji anywhere, 2–4 options lettered A–D, the answer is one of them', () => {
  assert.deepEqual(copyProblems(COPY), []);
  assert.match(copyProblems({ ...COPY, question: 'Guess this one!' }).join(), /exclamation/);
  assert.match(copyProblems({ ...COPY, answerLine: 'Go, of course 🤯' }).join(), /emoji/);
  assert.match(copyProblems({ ...COPY, options: [COPY.options[0]!] }).join(), /1 options/);
  assert.match(copyProblems({ ...COPY, options: [COPY.options[0]!, { letter: 'C', text: 'x' }] }).join(), /lettered C, not B/);
  assert.match(copyProblems({ ...COPY, correct: 'D' }).join(), /D is not an option/);
});

test('the master split: clip 1 gets show-master.flac 0–10 s, clip 2 gets 10–15 s, as AAC 192k 48 kHz', () => {
  assert.equal(path.basename(MASTER_FILE), 'show-master.flac');
  assert.equal(CLIP_S.question + CLIP_S.answer, MASTER_S);
  assert.equal(MASTER_AT.answer, MASTER_AT.question + CLIP_S.question);
  const q = muxArgs({ video: 'v.mp4', master: 'm.flac', role: 'question', out: 'o.mp4' });
  const a = muxArgs({ video: 'v.mp4', master: 'm.flac', role: 'answer', out: 'o.mp4' });
  // -ss / -t sit before the master's -i: they cut the master, not the video.
  assert.deepEqual(q.slice(q.indexOf('-ss'), q.indexOf('m.flac') + 1), ['-ss', '0', '-t', '10', '-i', 'm.flac']);
  assert.deepEqual(a.slice(a.indexOf('-ss'), a.indexOf('m.flac') + 1), ['-ss', '10', '-t', '5', '-i', 'm.flac']);
  for (const m of [q, a]) assert.match(m.join(' '), /-map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -ar 48000 -ac 2/);
  assert.equal(q[q.lastIndexOf('-t') + 1], '10');
  assert.equal(a[a.lastIndexOf('-t') + 1], '5');
  assert.deepEqual(posterArgs({ video: 'o.mp4', at: 2, out: 'p.jpg' }), ['-y', '-v', 'error', '-ss', '2', '-i', 'o.mp4', '-frames:v', '1', '-q:v', '2', 'p.jpg']);
});

const probeJson = (duration: number, { audio = true, video = true } = {}) => JSON.stringify({
  streams: [...(video ? [{ codec_type: 'video', width: 1080, height: 1920, r_frame_rate: '30/1' }] : []), ...(audio ? [{ codec_type: 'audio' }] : [])],
  format: { duration: String(duration) },
});

test('delivery checks: clip 1 10.0 s and clip 2 5.0 s (±0.05), 1080×1920, 30 fps, audio; the master is 15.0 s', () => {
  assert.deepEqual(deliveryProblems(parseProbe(probeJson(10.03)), 'question'), []);
  assert.deepEqual(deliveryProblems(parseProbe(probeJson(4.97)), 'answer'), []);
  assert.match(deliveryProblems(parseProbe(probeJson(5)), 'question').join(), /duration 5\.000 s, not 10 s/);
  assert.match(deliveryProblems(parseProbe(probeJson(10)), 'answer').join(), /duration 10\.000 s, not 5 s/);
  assert.match(deliveryProblems(parseProbe(probeJson(5, { audio: false })), 'answer').join(), /no audio/);
  assert.deepEqual(masterProblems(parseProbe(probeJson(15, { video: false }))), []);
  assert.match(masterProblems(parseProbe(probeJson(10, { video: false }))).join(), /10\.000 s, not 15 s/);
});

/** A runner that "renders": hyperframes writes renders/video.mp4, ffmpeg writes its last argument, ffprobe answers per file. */
function stubRunner(calls: Array<{ cmd: string; args: string[]; cwd: string }>, durations: { master?: number; question?: number; answer?: number } = {}): Runner {
  return (cmd, args, { cwd }) => {
    calls.push({ cmd, args, cwd });
    const ok = (stdout = ''): RunResult => ({ status: 0, stdout, stderr: '' });
    if (cmd.endsWith('hyperframes')) {
      const out = path.join(cwd, args[args.indexOf('--output') + 1]!);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, 'silent-mp4');
      return ok();
    }
    if (cmd === 'ffprobe') {
      const f = args[args.length - 1]!;
      if (f.endsWith('.flac')) return ok(probeJson(durations.master ?? 15, { video: false }));
      return ok(probeJson(f.includes('question') ? (durations.question ?? 10) : (durations.answer ?? 5)));
    }
    fs.writeFileSync(path.resolve(cwd, args[args.length - 1]!), `${cmd}:${path.basename(args[args.length - 1]!)}`);
    return ok();
  };
}

/** A fixed page: the content fits at 60 px (not 66), and the boxes come from the layout model. */
function stubPreflight(over: Partial<PreflightResult> = {}): Preflight {
  const content = (h: number): Measured => ({ sign: { w: 912, h: 360 }, question: { w: 900, h }, choices: { w: 912, h: 394 }, questionWide: false });
  const measures: Record<number, Measured> = { 66: content(500), 60: content(144), 54: content(130), 48: content(116) };
  return async (dir) => {
    const role = dir.endsWith('answer') ? 'answer' : 'question';
    const px = Number(/--qpx:(\d+)px/.exec(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'))![1]);
    const { boxes } = slideLayout(role, measures[px]!);
    const options = [0, 1, 2].map((i) => ({ x: SAFE.x, y: boxes.choices.y + i * 138, w: SAFE.w, h: 118 }));
    const lineHeights: Record<number, number> = role === 'answer' ? { 54: 250, 48: 200, 42: 160, 38: 140 } : {};
    return { problems: [], measures, lineHeights, boxes: { ...boxes, options }, ...over };
  };
}

const frames = (over: Partial<TriviaFrameInput['copy']> = {}): TriviaFrameInput[] => [
  { role: 'answer', copy: { ...COPY, ...over } },
  { role: 'question', copy: { ...COPY, ...over } },
];

test('renderTriviaClips: two clips in order (10 s, 5 s), HyperFrames at 30 fps, the master split, no photo or dim, the fit size on both', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-clip-test-'));
  const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  try {
    const { clips } = await renderTriviaClips(frames(), { run: stubRunner(calls), preflight: stubPreflight(), workDir: work });
    assert.deepEqual(clips.map((c) => c.role), ['question', 'answer']);
    for (const c of clips) assert.ok(c.mp4.length > 0 && c.poster.length > 0);

    assert.equal(calls[0]!.cmd, 'ffprobe', 'the master is probed before anything else');
    assert.ok(calls[0]!.args.at(-1)!.endsWith('show-master.flac'));
    const hf = calls.filter((c) => c.cmd.endsWith('hyperframes'));
    assert.equal(hf.length, 2);
    for (const c of hf) assert.equal(c.args[c.args.indexOf('--fps') + 1], '30');
    const mux = calls.filter((c) => c.cmd === 'ffmpeg' && c.args.includes('-map'));
    assert.deepEqual(mux.map((c) => [c.args[c.args.indexOf('-ss') + 1], c.args[c.args.indexOf('-t') + 1], path.basename(c.args[c.args.indexOf('-t') + 3]!)]), [['0', '10', 'show-master.flac'], ['10', '5', 'show-master.flac']]);
    const posters = calls.filter((c) => c.cmd === 'ffmpeg' && c.args.includes('-frames:v'));
    assert.deepEqual(posters.map((c) => c.args[c.args.indexOf('-ss') + 1]), ['2', '0.9']);
    assert.equal(calls.filter((c) => c.cmd === 'ffprobe').length, 3);

    const qHtml = fs.readFileSync(path.join(work, 'clip-1-question', 'index.html'), 'utf8');
    const aHtml = fs.readFileSync(path.join(work, 'clip-2-answer', 'index.html'), 'utf8');
    assert.match(qHtml, /data-duration="10"/);
    assert.match(aHtml, /data-duration="5"/);
    for (const html of [qHtml, aHtml]) {
      assert.match(html, /Are you smarter than AI\?/);
      assert.match(html, /--qpx:60px/, 'the fit size (60) on both clips');
      assert.doesNotMatch(html, /<img|tv-photo|tv-dim|rgba\(6,6,8/i, 'no photo and no dim layer');
      assert.doesNotMatch(html, /https?:\/\//, 'no network in the composition');
      assert.equal((html.match(/class="bulb p[01]"/g) ?? []).length, 30, '30 bulbs around the sign');
      const drawn = html.slice(html.indexOf('<body>'), html.indexOf('<script>', html.indexOf('<body>'))).replace(/<[^>]+>/g, ' ');
      assert.ok(!drawn.includes('!'), 'no exclamation marks drawn');
    }
    assert.match(qHtml, /Tap to reveal/);
    assert.match(qHtml, /id="tv-timer"/);
    assert.equal((qHtml.match(/id="tv-d-\d+"/g) ?? []).length, 10);
    // The seam: clip 2 opens on clip 1's tap row as it ends (ring empty, digit 1), which leaves on the hit.
    assert.match(aHtml, /Tap to reveal/);
    assert.match(aHtml, /id="tv-timer" class="timer" style="--p:0%"/);
    assert.match(aHtml, /<b id="tv-d-1" class="on">1<\/b>/);
    assert.match(aHtml, /AlphaGo did it in 2016/);
    assert.doesNotMatch(qHtml, /AlphaGo did it in 2016/);
    // The check sits only in the answer's correct pill (B, index 1); the confetti starts on its centre.
    assert.equal((aHtml.match(/id="tv-check"/g) ?? []).length, 1);
    assert.match(aHtml, /id="tv-opt-1" class="ch"><b><span class="tv-l">B<\/span><svg id="tv-check"/);
    assert.doesNotMatch(qHtml, /id="tv-check"|class="conf"/);
    const pill = slideLayout('answer', { sign: { w: 912, h: 360 }, question: { w: 900, h: 144 }, choices: { w: 912, h: 394 } }).boxes.choices.y + 138 + 59;
    const conf = [...aHtml.matchAll(/class="conf" style="left:(\d+)px;top:(\d+)px/g)];
    assert.equal(conf.length, 30);
    for (const m of conf) assert.deepEqual([Number(m[1]), Number(m[2])], [540, Math.round(pill)]);

    for (const dir of ['clip-1-question', 'clip-2-answer']) {
      for (const f of ['assets/fonts/PragmaticaExtended-Bold.otf', 'assets/fonts/Roboto-500.woff2', 'assets/fonts/Roboto-700.woff2', 'assets/vendor/gsap.min.js', 'hyperframes.json']) assert.ok(fs.existsSync(path.join(work, dir, f)), `${dir}/${f}`);
      for (const gone of ['Inter-Medium.ttf', 'Inter-Variable.ttf', 'BowlbyOne-Regular.ttf']) assert.ok(!fs.existsSync(path.join(work, dir, 'assets', 'fonts', gone)), gone);
    }
    assert.ok(!fs.readdirSync(work).some((f) => /track|master\.wav/.test(f)), 'no music track or rebuilt master');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('renderTriviaClips refuses bad copy before any work, a bad master, a stack that never fits, a preflight problem, and a clip off the contract', async () => {
  const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  await assert.rejects(renderTriviaClips(frames({ question: 'Ready!' }), { run: stubRunner(calls), preflight: stubPreflight() }), /exclamation/);
  assert.equal(calls.length, 0);
  await assert.rejects(renderTriviaClips(frames(), { run: stubRunner([], { master: 12 }), preflight: stubPreflight() }), /show master is 12\.000 s/);
  const tooTall: Record<number, Measured> = Object.fromEntries(QUESTION_PX.map((px) => [px, { sign: { w: 912, h: 360 }, question: { w: 900, h: 700 }, choices: { w: 912, h: 394 }, questionWide: false }]));
  await assert.rejects(renderTriviaClips(frames(), { run: stubRunner([]), preflight: stubPreflight({ measures: tooTall }) }), /does not fit the safe area even with the question at 48 px/);
  await assert.rejects(
    renderTriviaClips(frames(), { run: stubRunner([]), preflight: stubPreflight({ problems: ['the answer line is 280 px tall, over the 210 px footer slot'] }) }),
    /question clip: the answer line is 280 px tall/,
  );
  await assert.rejects(renderTriviaClips(frames(), { run: stubRunner([], { question: 9.6 }), preflight: stubPreflight() }), /question clip: duration 9\.600 s, not 10 s/);
  await assert.rejects(renderTriviaClips(frames(), { run: stubRunner([], { answer: 10 }), preflight: stubPreflight() }), /answer clip: duration 10\.000 s, not 5 s/);
});

test('the answer line steps down to the largest size that fits its slot, and fails when none does', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-line-'));
  await renderTriviaClips(frames(), { run: stubRunner([]), preflight: stubPreflight(), workDir: work });
  assert.match(fs.readFileSync(path.join(work, 'clip-2-answer', 'index.html'), 'utf8'), /--lpx:48px/);
  const tooLong = stubPreflight();
  const never: Preflight = async (dir) => ({ ...(await tooLong(dir)), lineHeights: (dir.endsWith('answer') ? { 54: 400, 48: 360, 42: 320, 38: 290 } : {}) as Record<number, number> });
  await assert.rejects(renderTriviaClips(frames(), { run: stubRunner([]), preflight: never }), /answer line does not fit/);
});
