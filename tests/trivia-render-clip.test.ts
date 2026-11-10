/** AI Trivia clips: copy rules, audio/mux commands, and renderTriviaClips end to end with every subprocess and the browser stubbed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { RunResult, Runner } from '@/lib/reel-ai-drama/render/runner';
import type { TriviaMusic } from '@/lib/stories/trivia/music';
import { deliveryProblems, masterArgs, muxArgs, parseProbe, posterArgs } from '@/lib/stories/trivia/render/audio';
import { copyProblems, DIM_STEPS, renderTriviaClips, type TriviaFrameInput } from '@/lib/stories/trivia/render/clip';
import type { Preflight } from '@/lib/stories/trivia/render/preflight';
import { cssToHex, judgeContrast } from '@/lib/stories/trivia/render/preflight';

const COPY = {
  question: 'Which lab first showed a neural network beating humans at a board game?',
  options: [
    { letter: 'A' as const, text: 'DeepMind' },
    { letter: 'B' as const, text: 'IBM Research' },
    { letter: 'C' as const, text: 'OpenAI' },
  ],
  correct: 'A' as const,
  answerLine: 'DeepMind did it with Go in 2016, a decade before most experts expected.',
};
const MUSIC: TriviaMusic = { trackId: 't1', url: 'https://cdn.test/t1.mp3', bpm: 96, beatMs: [21250, 21875], startMs: 16275 };
const PHOTO = { src: 'lib/stories/render/fixtures/photos/datacenter.jpg', credit: 'Photo: Test', kind: 'scene' as const };

test('copyProblems: no exclamation marks or emoji anywhere, 2–4 options lettered A–D, the answer is one of them', () => {
  assert.deepEqual(copyProblems(COPY), []);
  assert.match(copyProblems({ ...COPY, question: 'Guess this one!' }).join(), /exclamation/);
  assert.match(copyProblems({ ...COPY, answerLine: 'Go, of course 🤯' }).join(), /emoji/);
  assert.match(copyProblems(COPY, ['Photo: Wow!']).join(), /exclamation/);
  assert.match(copyProblems({ ...COPY, options: [COPY.options[0]!] }).join(), /1 options/);
  assert.match(copyProblems({ ...COPY, options: [COPY.options[0]!, { letter: 'C', text: 'x' }] }).join(), /lettered C, not B/);
  assert.match(copyProblems({ ...COPY, correct: 'D' }).join(), /D is not an option/);
});

test('the audio master: the music window from startMs, the sting at clip 2, the ambient bed under both, AI Drama loudness; each clip gets its half', () => {
  const m = masterArgs({ track: 't.mp3', startMs: 16275, out: 'm.wav' });
  assert.equal(m[m.indexOf('-ss') + 1], '16.275');
  assert.equal(m[m.indexOf('-t') + 1], '10');
  const graph = m[m.indexOf('-filter_complex') + 1]!;
  assert.match(graph, /adelay=5000:all=1/);
  assert.match(graph, /loudnorm=I=-14:TP=-1:LRA=11/);
  assert.match(m.join(' '), /reveal-sting\.wav/);
  // AT-32: the drift's bed, looped with crossfades (no seams), cut to the master, well under the music.
  assert.match(m.join(' '), /ambient-air\.ogg/);
  assert.match(graph, /asplit=3\[b0\]\[b1\]\[b2\]/);
  assert.equal(graph.match(/acrossfade=d=1:c1=qsin:c2=qsin/g)?.length, 2);
  assert.match(graph, /atrim=0:10,asetpts=PTS-STARTPTS,volume='0\.16\*\(0\.7\+0\.3\*sin\(PI\*t\/13\)\)'/);
  assert.match(graph, /\[m\]\[s\]\[b\]amix=inputs=3:normalize=0/);
  const a = muxArgs({ video: 'v.mp4', master: 'm.wav', clip: 1, out: 'o.mp4' });
  assert.equal(a[a.indexOf('-ss') + 1], '5');
  assert.match(a.join(' '), /-c:v copy -c:a aac -b:a 192k -ar 48000/);
  assert.deepEqual(posterArgs({ video: 'o.mp4', at: 3, out: 'p.jpg' }), ['-y', '-v', 'error', '-ss', '3', '-i', 'o.mp4', '-frames:v', '1', '-q:v', '2', 'p.jpg']);
});

const probeJson = (duration: number, audio = true) => JSON.stringify({
  streams: [{ codec_type: 'video', width: 1080, height: 1920, r_frame_rate: '30/1' }, ...(audio ? [{ codec_type: 'audio' }] : [])],
  format: { duration: String(duration) },
});

test('delivery checks: 5.0 s ±0.05, 1080×1920, 30 fps, an audio stream', () => {
  assert.deepEqual(deliveryProblems(parseProbe(probeJson(5.02))), []);
  assert.match(deliveryProblems(parseProbe(probeJson(5.2))).join(), /duration/);
  assert.match(deliveryProblems(parseProbe(probeJson(5, false))).join(), /no audio/);
});

test('contrast judging: white on a dark patch passes, on a light one fails; faded text is not judged', () => {
  const W = 40, H = 40;
  const img = (v: number) => ({ data: new Uint8Array(W * H * 3).fill(v), width: W, height: H, channels: 3 as const });
  const box = { text: 'Q', px: 60, ink: '#FFFFFF', opacity: 1, x: 0, y: 0, w: 40, h: 40 };
  assert.equal(judgeContrast(0, [box], img(30))[0]!.ok, true);
  assert.equal(judgeContrast(0, [box], img(200))[0]!.ok, false);
  assert.equal(judgeContrast(0, [{ ...box, opacity: 0.3 }], img(200)).length, 0);
  assert.equal(cssToHex('rgb(23, 23, 23)'), '#171717');
  assert.equal(cssToHex('rgba(255, 94, 26, 0.5)'), '#FF5E1A');
});

/** A runner that "renders": hyperframes writes renders/video.mp4, ffmpeg writes its last argument, ffprobe answers. */
function stubRunner(calls: Array<{ cmd: string; args: string[]; cwd: string }>, duration = 5): Runner {
  return (cmd, args, { cwd }) => {
    calls.push({ cmd, args, cwd });
    const ok = (stdout = ''): RunResult => ({ status: 0, stdout, stderr: '' });
    if (cmd.endsWith('hyperframes')) {
      const out = path.join(cwd, args[args.indexOf('--output') + 1]!);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, 'silent-mp4');
      return ok();
    }
    if (cmd === 'ffprobe') return ok(probeJson(duration));
    fs.writeFileSync(path.resolve(cwd, args[args.length - 1]!), `${cmd}:${path.basename(args[args.length - 1]!)}`);
    return ok();
  };
}

const frames = (over: Partial<TriviaFrameInput['copy']> = {}): TriviaFrameInput[] => [
  { role: 'answer', copy: { ...COPY, ...over } },
  { role: 'question', copy: { ...COPY, ...over }, photo: PHOTO },
];

test('renderTriviaClips: two clips in order, HyperFrames at 30 fps, fixed copy, contrast deepens the dim, nothing off-box', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-clip-test-'));
  const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const checked: string[] = [];
  // The answer clip fails contrast once, then passes one dim step darker.
  const preflight: Preflight = async (dir) => {
    checked.push(dir);
    const fail = dir.endsWith('answer') && checked.filter((d) => d === dir).length === 1;
    return { sizes: { head: 180, q: 64 }, problems: fail ? ['contrast at 1s: "x" 2.1:1'] : [], contrast: [{ t: 1, text: 'x', px: 60, ink: '#FFFFFF', mean: fail ? 2.1 : 6, worst: 4, required: 3, ok: !fail }] };
  };
  const downloads: string[] = [];
  try {
    const { clips } = await renderTriviaClips(frames(), MUSIC, {
      run: stubRunner(calls), preflight, workDir: work,
      download: async (url, dest) => {
        downloads.push(url);
        fs.writeFileSync(dest, 'mp3');
      },
    });
    assert.deepEqual(clips.map((c) => c.role), ['question', 'answer']);
    for (const c of clips) assert.ok(c.mp4.length > 0 && c.poster.length > 0);
    assert.deepEqual(downloads, [MUSIC.url]);

    const hf = calls.filter((c) => c.cmd.endsWith('hyperframes'));
    assert.equal(hf.length, 2);
    for (const c of hf) assert.equal(c.args[c.args.indexOf('--fps') + 1], '30');
    const master = calls.find((c) => c.cmd === 'ffmpeg' && c.args.includes('-filter_complex'))!;
    assert.equal(master.args[master.args.indexOf('-ss') + 1], '16.275');
    const posters = calls.filter((c) => c.cmd === 'ffmpeg' && c.args.includes('-frames:v'));
    assert.deepEqual(posters.map((c) => c.args[c.args.indexOf('-ss') + 1]), ['4.5', '0.9']);

    const qHtml = fs.readFileSync(path.join(work, 'clip-1-question', 'index.html'), 'utf8');
    const aHtml = fs.readFileSync(path.join(work, 'clip-2-answer', 'index.html'), 'utf8');
    assert.match(qHtml, /AI Trivia/);
    assert.match(qHtml, /Tap to reveal/);
    assert.doesNotMatch(aHtml, /Tap to reveal/);
    assert.match(aHtml, /DeepMind did it with Go/);
    assert.match(qHtml, /data-duration="5"/);
    assert.match(qHtml, /rgba\(6,6,8,0\.5\)/);
    assert.match(aHtml, new RegExp(`rgba\\(6,6,8,${DIM_STEPS[1]}\\)`), 'the answer clip went one dim step darker');
    assert.match(qHtml, /font-size:180px/, 'fitted sizes are baked in');
    // The answer reuses the question's photo when it has none; fonts and gsap ship with the project.
    assert.ok(fs.existsSync(path.join(work, 'clip-2-answer', 'assets', 'photo.jpg')));
    for (const dir of ['clip-1-question', 'clip-2-answer']) {
      for (const f of ['assets/fonts/Inter-Medium.ttf', 'assets/vendor/gsap.min.js', 'hyperframes.json']) assert.ok(fs.existsSync(path.join(work, dir, f)), `${dir}/${f}`);
    }
    for (const html of [qHtml, aHtml]) {
      assert.doesNotMatch(html, /https?:\/\/(?!hyperframes\.heygen\.com)/, 'no network in the composition');
      const drawn = html.slice(html.indexOf('<body>'), html.indexOf('<script>', html.indexOf('<body>'))).replace(/<[^>]+>/g, ' ');
      assert.ok(!drawn.includes('!'), 'no exclamation marks drawn');
      assert.ok(!drawn.includes('Photo: Test'), 'no photo credit drawn (AT-35)');
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('renderTriviaClips refuses bad copy before any work, and a clip off the contract', async () => {
  const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const preflight: Preflight = async () => ({ sizes: {}, problems: [], contrast: [] });
  await assert.rejects(renderTriviaClips(frames({ question: 'Ready!' }), MUSIC, { run: stubRunner(calls), preflight }), /exclamation/);
  assert.equal(calls.length, 0);
  await assert.rejects(
    renderTriviaClips(frames(), MUSIC, { run: stubRunner(calls, 4.6), preflight, download: async (_u, d) => fs.writeFileSync(d, 'x') }),
    /question clip: duration 4\.600 s/,
  );
  await assert.rejects(
    renderTriviaClips(frames(), MUSIC, { run: stubRunner([]), preflight: async () => ({ sizes: {}, problems: ['text fit: p.tv-q "x" (too tall)'], contrast: [] }), download: async (_u, d) => fs.writeFileSync(d, 'x') }),
    /question clip: text fit/,
  );
});
