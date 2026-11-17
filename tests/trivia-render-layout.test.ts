/**
 * "Are you smarter than AI?" layout (CONTRACT-2 §2, §5 A): the sign, the question and the choices sit on the
 * same pixels in both clips, for 2, 3 and 4 options, and the fit rule picks one question size for both.
 * Content sizes come from a rough text estimate (the preflight measures the real page); every subprocess and
 * the browser are stubbed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { RunResult, Runner } from '@/lib/reel-ai-drama/render/runner';
import { renderTriviaClips, type TriviaCopy } from '@/lib/stories/trivia/render/clip';
import { fitQuestionPx, FOOT_H, QUESTION_PX, SAFE, slideLayout, stackHeight, type Measured, type SlideRole } from '@/lib/stories/trivia/render/layout';
import type { Preflight } from '@/lib/stories/trivia/render/preflight';

const L = ['A', 'B', 'C', 'D'] as const;
const copyOf = (n: number, question: string): TriviaCopy => ({
  question,
  options: Array.from({ length: n }, (_, i) => ({ letter: L[i]!, text: `Option ${L[i]}` })),
  correct: L[n - 1]!,
  answerLine: 'The answer, and why it matters to you.',
});
const FIXTURES: Record<2 | 3 | 4, TriviaCopy> = {
  2: copyOf(2, 'Was the first chatbot built before or after the moon landing?'),
  3: copyOf(3, 'Which company built the first AI to beat a world champion at Go?'),
  4: copyOf(4, 'Which year did ChatGPT launch?'),
};
const PILL_H = 118;
const PILL_GAP = 20;

/** A rough stand-in for the page: Pragmatica Extended sign on two lines, Roboto 700 question at ~0.56 em per character, 118 px pills. */
function estimate(copy: TriviaCopy, px: number): Measured {
  const perLine = Math.floor(SAFE.w / (0.56 * px));
  const lines = Math.ceil(copy.question.length / perLine);
  const longest = Math.max(...copy.question.split(' ').map((w) => w.length));
  const n = copy.options.length;
  return {
    sign: { w: SAFE.w, h: 2 * 94 * 1.04 + 78 + 70 + 16 },
    question: { w: Math.min(SAFE.w, copy.question.length * 0.56 * px), h: lines * px * 1.2 },
    choices: { w: SAFE.w, h: n * PILL_H + (n - 1) * PILL_GAP },
    questionWide: longest * 0.56 * px > SAFE.w,
  };
}
const measuresOf = (copy: TriviaCopy) => Object.fromEntries(QUESTION_PX.map((px) => [px, estimate(copy, px)]));

test('slideLayout: the sign, question and choices boxes are identical in both clips for 2, 3 and 4 options; the footer slot is a fixed 210 px', () => {
  for (const n of [2, 3, 4] as const) {
    const fit = fitQuestionPx(measuresOf(FIXTURES[n]));
    assert.ok(fit, `${n} options fit`);
    const q = slideLayout('question', fit.content);
    const a = slideLayout('answer', fit.content);
    for (const k of ['sign', 'question', 'choices', 'foot'] as const) assert.deepEqual(q.boxes[k], a.boxes[k], `${n} options: ${k}`);
    assert.equal(q.boxes.foot.h, FOOT_H);
    assert.equal(q.height, a.height);
    // Centred in the safe area: equal room above the sign and below the footer slot.
    const above = q.boxes.sign.y - SAFE.y;
    const below = SAFE.y + SAFE.h - (q.boxes.foot.y + q.boxes.foot.h);
    assert.ok(Math.abs(above - below) < 1e-9 && above >= 0, `${n} options centred`);
    // The blocks stack in order, 50 px apart.
    assert.equal(q.boxes.question.y - (q.boxes.sign.y + q.boxes.sign.h), 50);
    assert.equal(q.boxes.choices.y - (q.boxes.question.y + q.boxes.question.h), 50);
    assert.equal(q.boxes.choices.x, SAFE.x);
    assert.equal(q.boxes.sign.w, SAFE.w);
  }
});

test('fit rule: the question steps 66 → 60 → 54 → 48 until the stack fits, picked from the content (no role in it)', () => {
  assert.deepEqual([...QUESTION_PX], [66, 60, 54, 48]);
  assert.equal(fitQuestionPx(measuresOf(FIXTURES[3]))?.px, 66, 'a short question stays at 66');
  // A long question with four options: too tall at 66 and 60, fits at 54.
  const long = copyOf(4, 'Which lab trained the model that beat the Go world champion?');
  const m = measuresOf(long);
  assert.equal(slideLayout('question', m[66]!).fits, false);
  assert.equal(slideLayout('question', m[60]!).fits, false);
  assert.equal(fitQuestionPx(m)?.px, 54);
  // A word wider than the safe area at 66 also steps down.
  assert.equal(fitQuestionPx({ ...measuresOf(FIXTURES[3]), 66: { ...estimate(FIXTURES[3], 66), questionWide: true } })?.px, 60);
  // Nothing fits: null (the render fails rather than overflow the safe area).
  const huge = Object.fromEntries(QUESTION_PX.map((px) => [px, { ...estimate(FIXTURES[4], px), question: { w: SAFE.w, h: 900 } }]));
  assert.equal(fitQuestionPx(huge), null);
  assert.ok(stackHeight(huge[48]!) > SAFE.h);
});

/** A runner that "renders": hyperframes writes renders/video.mp4, ffmpeg writes its last argument, ffprobe answers per file. */
function stubRunner(): Runner {
  return (cmd, args, { cwd }) => {
    const ok = (stdout = ''): RunResult => ({ status: 0, stdout, stderr: '' });
    if (cmd.endsWith('hyperframes')) {
      const out = path.join(cwd, args[args.indexOf('--output') + 1]!);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, 'silent-mp4');
      return ok();
    }
    if (cmd === 'ffprobe') {
      const f = args[args.length - 1]!;
      const master = f.endsWith('.flac');
      const duration = master ? 15 : f.includes('question') ? 10 : 5;
      return ok(JSON.stringify({ streams: [...(master ? [] : [{ codec_type: 'video', width: 1080, height: 1920, r_frame_rate: '30/1' }]), { codec_type: 'audio' }], format: { duration: String(duration) } }));
    }
    fs.writeFileSync(path.resolve(cwd, args[args.length - 1]!), `${cmd}:${path.basename(args[args.length - 1]!)}`);
    return ok();
  };
}

/** A preflight that reads the page's baked size and option count, and answers with the layout model's boxes for its role. */
function modelPreflight(copy: TriviaCopy): Preflight {
  return async (dir) => {
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const px = Number(/--qpx:(\d+)px/.exec(html)![1]);
    const role: SlideRole = dir.endsWith('answer') ? 'answer' : 'question';
    const n = (html.match(/id="tv-opt-/g) ?? []).length;
    const { boxes } = slideLayout(role, estimate(copy, px));
    const options = Array.from({ length: n }, (_, i) => ({ x: SAFE.x, y: boxes.choices.y + i * (PILL_H + PILL_GAP), w: SAFE.w, h: PILL_H }));
    return { problems: [], measures: measuresOf(copy), boxes: { ...boxes, options } };
  };
}

test('renderTriviaClips draws both clips at the same question size, for 2, 3 and 4 options and a long question', async () => {
  const cases: TriviaCopy[] = [FIXTURES[2], FIXTURES[3], FIXTURES[4], copyOf(4, 'Which lab trained the model that beat the Go world champion?')];
  for (const copy of cases) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-layout-test-'));
    try {
      const logs: string[] = [];
      await renderTriviaClips([{ role: 'question', copy }, { role: 'answer', copy }], { run: stubRunner(), preflight: modelPreflight(copy), workDir: work, log: (l) => logs.push(l) });
      const px = (role: string) => /--qpx:(\d+)px/.exec(fs.readFileSync(path.join(work, role, 'index.html'), 'utf8'))![1];
      const want = String(fitQuestionPx(measuresOf(copy))!.px);
      assert.equal(px('clip-1-question'), want, `${copy.options.length} options: clip 1 at the fit size`);
      assert.equal(px('clip-2-answer'), want, `${copy.options.length} options: clip 2 at the same size`);
      assert.match(logs.join('\n'), new RegExp(`fit: question ${want} px, answer line \\d+ px; .* on both clips \\(layout model within 0\\.0 px\\)`));
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
});

test('renderTriviaClips refuses clips whose stacks would not sit on the same pixels', async () => {
  const copy = FIXTURES[3];
  const model = modelPreflight(copy);
  const shifted: Preflight = async (dir) => {
    const r = await model(dir);
    return dir.endsWith('answer') ? { ...r, boxes: { ...r.boxes, choices: { ...r.boxes.choices, y: r.boxes.choices.y + 4 } } } : r;
  };
  await assert.rejects(renderTriviaClips([{ role: 'question', copy }, { role: 'answer', copy }], { run: stubRunner(), preflight: shifted }), /stacks differ: choices moves 4\.0 px/);
});
