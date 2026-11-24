/**
 * "Are you smarter than AI?" video (CONTRACT-2 §1–§3): the set's two frames → two Story MP4s (clip 1, the
 * question, 10.0 s; clip 2, the answer, 5.0 s; 1080×1920, 30 fps, AAC 192k 48 kHz) and a JPEG poster each
 * (clip 1 at 2.0 s, clip 2 at 0.9 s, for the review).
 *
 *   1. Copy check: no "!" and no emoji anywhere; 2–4 options lettered A–D; the answer is one of them.
 *   2. The fixed sound, show-master.flac, is probed (15.0 s); each clip gets its slice (audio.ts).
 *   3. Each clip is a HyperFrames project (index.html, fonts, gsap) built from TriviaSlide.tsx + trivia.css +
 *      timeline.ts. The preflight (preflight.ts) measures clip 1's stack at every question size; the fit rule
 *      (layout.ts) picks one, and both clips are drawn at it. Both are then measured again: the sign, the
 *      question and the choices must sit on the same pixels in both, and the confetti starts on the correct
 *      pill's centre.
 *   4. HyperFrames records each (the pinned CLI, HYPERFRAMES_ENV), the clip's slice of the master is muxed in,
 *      the poster is taken, and the file is probed (length per role, 1080×1920, 30 fps, audio).
 *
 * Every subprocess goes through `run` and the browser through `preflight`, so tests stub both.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { HYPERFRAMES_BIN, HYPERFRAMES_ENV } from '@/lib/explainers/render/workspace';
import { spawnRunner, tail, type Runner } from '@/lib/reel-ai-drama/render/runner';
import { GSAP_FILE } from '@/lib/reel-ai-drama/render/video';
import { EMOJI_RUN } from '@/lib/stories/render/emoji';
import type { TriviaCopy as RenderTriviaCopy } from '@/lib/stories/render/types';

import { deliveryProblems, masterProblems, MASTER_FILE, muxArgs, parseProbe, posterArgs, probeArgs } from './audio';
import { boxDelta, fitLinePx, fitQuestionPx, LINE_PX, lineSlotH, QUESTION_PX, slideLayout, type LinePx, type QuestionPx, type SlideRole } from './layout';
import { critterModule, critterProblems, KIT_FILES, kitDir } from './critter';
import { openPreflight, type PageBoxes, type Preflight, type SeamShots } from './preflight';
import { answerTimeline, CLIP_S, FPS, POSTER_AT, questionTimeline, SEAM_T, timelineScript } from './timeline';
import { SIGN_COPY, type SlideInput } from './TriviaSlide';

const ASSET_DIR = path.join(process.cwd(), 'lib', 'stories', 'render', 'assets');
/** The fonts the slides use (CONTRACT-2 §1). */
export const FONT_FILES = ['PragmaticaExtended-Bold.otf', 'Roboto-400.woff2', 'Roboto-500.woff2', 'Roboto-700.woff2'];
const RENDER_TIMEOUT_MS = 15 * 60 * 1000;
const LETTERS = ['A', 'B', 'C', 'D'] as const;
/** The same box on both clips, to within this (px). */
const SAME_PX = 0.5;
const ROLES: SlideRole[] = ['question', 'answer'];

/** The renderer lays out two to four options (the writer always gives three, AT-54). */
export type TriviaCopy = RenderTriviaCopy;
type TriviaOption = TriviaCopy['options'][number];
/** One of the set's two frames: its role and the question's copy. No photo, no music. */
export type TriviaFrameInput = { role: SlideRole; copy: TriviaCopy };
export type TriviaClip = { role: SlideRole; mp4: Buffer; poster: Buffer };
export type TriviaClips = { clips: TriviaClip[] };
export type RenderDeps = {
  run?: Runner;
  preflight?: Preflight;
  /** The seam screenshots (AT-72); with a stub preflight and no seam, the seam check is skipped. */
  seam?: SeamShots;
  /** Build in this folder and keep it (a temp folder, removed after, by default). */
  workDir?: string;
  log?: (line: string) => void;
};

/** The copy rules: what is wrong with the copy (empty when it may be drawn). */
export function copyProblems(copy: TriviaCopy): string[] {
  const out: string[] = [];
  const texts = [copy.question, copy.answerLine, ...copy.options.map((o) => o.text)];
  for (const t of texts) {
    if (typeof t !== 'string' || !t.trim()) out.push('empty text');
    else {
      if (t.includes('!')) out.push(`exclamation mark: "${t}"`);
      if (new RegExp(EMOJI_RUN.source, 'u').test(t)) out.push(`emoji: "${t}"`);
    }
  }
  const n = copy.options.length;
  if (n < 2 || n > 4) out.push(`${n} options (2 to 4)`);
  copy.options.forEach((o: TriviaOption, i) => {
    if (o.letter !== LETTERS[i]) out.push(`option ${i + 1} is lettered ${o.letter}, not ${LETTERS[i]}`);
  });
  if (!copy.options.some((o) => o.letter === copy.correct)) out.push(`the answer ${copy.correct} is not an option`);
  if (copy.opponent && !copy.options.some((o) => o.letter === copy.opponent!.picked)) out.push(`the opponent picked ${copy.opponent.picked}, not an option`);
  if (copy.critter) out.push(...critterProblems(copy.critter, CLIP_S, !!copy.opponent).map((p) => `critter: ${p}`));
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The composition page for one slide. */
export async function compositionHtml(s: SlideInput): Promise<string> {
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { TriviaSlide } = await import('./TriviaSlide');
  const css = fs.readFileSync(path.join(process.cwd(), 'lib', 'stories', 'trivia', 'render', 'trivia.css'), 'utf8');
  const clipS = CLIP_S[s.role];
  const correct = s.options.findIndex((o) => o.letter === s.correct);
  const tweens = s.role === 'question' ? questionTimeline() : answerTimeline(s.options.length, correct, !!s.opponent);
  const body = renderToStaticMarkup(React.createElement(TriviaSlide, { s }));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1080, height=1920" />
<title>${esc(SIGN_COPY)}</title>
<script src="assets/vendor/gsap.min.js"></script>
${s.critter ? `<script>
window.__hf = window.__hf || {};
window.__hf.buildReady = window.__hf.buildReady || {};
window.__hf.buildReady['main'] = new Promise(function (resolve) { window.__critterReady = resolve; });
</script>` : ''}
<style>
@font-face { font-family: 'Pragmatica Extended'; src: url('assets/fonts/PragmaticaExtended-Bold.otf') format('opentype'); font-weight: 700; font-style: normal; font-display: block; }
@font-face { font-family: 'Roboto'; src: url('assets/fonts/Roboto-400.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: block; }
@font-face { font-family: 'Roboto'; src: url('assets/fonts/Roboto-500.woff2') format('woff2'); font-weight: 500; font-style: normal; font-display: block; }
@font-face { font-family: 'Roboto'; src: url('assets/fonts/Roboto-700.woff2') format('woff2'); font-weight: 700; font-style: normal; font-display: block; }
${css}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${clipS}" data-width="1080" data-height="1920" data-fps="${FPS}">
<div id="tv-slide" class="clip tv-layer" data-start="0" data-duration="${clipS}" data-track-index="0">${body}</div>
</div>
<script>
${timelineScript(tweens, clipS)}
</script>${s.critter ? `
<script type="module">
${critterModule(clipS)}</script>` : ''}
</body>
</html>
`;
}

const PROJECT_FILES: Record<string, string> = {
  'hyperframes.json': `${JSON.stringify({ $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json', paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' }, media: { autoProxy: true } }, null, 2)}\n`,
  'package.json': `${JSON.stringify({ name: 'ai-trivia-clip', private: true, type: 'module' }, null, 2)}\n`,
  'meta.json': `${JSON.stringify({ id: 'ai-trivia-clip', name: 'ai-trivia-clip' }, null, 2)}\n`,
};

/** The project folder for one clip, without its index.html (the critter's kit only when it has one). */
function prepareProject(dir: string, withCritter: boolean): void {
  fs.mkdirSync(path.join(dir, 'assets', 'fonts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'vendor'), { recursive: true });
  for (const [f, body] of Object.entries(PROJECT_FILES)) fs.writeFileSync(path.join(dir, f), body);
  for (const f of FONT_FILES) fs.copyFileSync(path.join(ASSET_DIR, f), path.join(dir, 'assets', 'fonts', f));
  fs.copyFileSync(GSAP_FILE, path.join(dir, 'assets', 'vendor', 'gsap.min.js'));
  if (!withCritter) return;
  fs.mkdirSync(path.join(dir, 'assets', 'kit'), { recursive: true });
  for (const f of KIT_FILES) fs.copyFileSync(path.join(kitDir(), f), path.join(dir, 'assets', 'kit', f));
}

function runOk(run: Runner, cmd: string, args: string[], cwd: string, what: string, timeoutMs = 5 * 60 * 1000): string {
  const res = run(cmd, args, { cwd, env: { ...process.env, ...HYPERFRAMES_ENV }, timeoutMs });
  if (res.status !== 0) throw new Error(`${what} exited ${res.status ?? 'with no status'}: ${tail(res)}`);
  return res.stdout;
}

const STACK = ['sign', 'question', 'choices'] as const;

/** Where the sign, the question or the choices differ between the clips (empty when they sit on the same pixels). */
export function stackMismatch(q: PageBoxes, a: PageBoxes): string[] {
  const out: string[] = [];
  for (const k of STACK) {
    const d = boxDelta(q[k], a[k]);
    if (d > SAME_PX) out.push(`${k} moves ${d.toFixed(1)} px between the clips`);
  }
  return out;
}

/** Render the set's two clips. `frames` holds the question and the answer frame (any order). */
export async function renderTriviaClips(frames: TriviaFrameInput[], deps: RenderDeps = {}): Promise<TriviaClips> {
  const run = deps.run ?? spawnRunner;
  const log = deps.log ?? (() => undefined);
  const q = frames.find((f) => f.role === 'question');
  const a = frames.find((f) => f.role === 'answer');
  if (!q || !a || frames.length !== 2) throw new Error('"Are you smarter than AI?" renders exactly two frames: question and answer');
  const copy: TriviaCopy = { question: q.copy.question, options: q.copy.options, correct: q.copy.correct, answerLine: q.copy.answerLine ?? a.copy.answerLine, ...((q.copy.critter ?? a.copy.critter) ? { critter: q.copy.critter ?? a.copy.critter } : {}), ...((q.copy.opponent ?? a.copy.opponent) ? { opponent: q.copy.opponent ?? a.copy.opponent } : {}) };
  const problems = copyProblems(copy);
  if (problems.length) throw new Error(`trivia copy can't be drawn: ${problems.join('; ')}`);

  const own = !deps.workDir;
  const work = deps.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-render-'));
  fs.mkdirSync(work, { recursive: true });
  let browser: { check: Preflight; seam: SeamShots; close: () => Promise<void> } | null = null;
  try {
    // The sound first: cheap, and a bad master fails before any recording.
    const bad = masterProblems(parseProbe(runOk(run, 'ffprobe', probeArgs(MASTER_FILE), work, 'probe (show master)')));
    if (bad.length) throw new Error(bad.join('; '));

    let preflight = deps.preflight;
    if (!preflight) {
      browser = await openPreflight();
      preflight = browser.check;
    }
    const dirs: Record<SlideRole, string> = { question: path.join(work, 'clip-1-question'), answer: path.join(work, 'clip-2-answer') };
    const write = async (role: SlideRole, questionPx: QuestionPx, linePx: LinePx, confettiAt?: { x: number; y: number }) =>
      fs.writeFileSync(path.join(dirs[role], 'index.html'), await compositionHtml({ role, ...copy, questionPx, linePx, ...(confettiAt ? { confettiAt } : {}) }));
    // Measured at the smallest answer-line size, so a long line can't fail the measuring pass itself.
    for (const role of ROLES) {
      prepareProject(dirs[role], !!copy.critter);
      await write(role, QUESTION_PX[0], LINE_PX[LINE_PX.length - 1]!);
    }

    // The fit rule: measured once (the content is the same on both clips), drawn at the same size on both.
    const first = await preflight(dirs.question);
    if (first.problems.length) throw new Error(`question clip: ${first.problems.join('; ')}`);
    const fit = fitQuestionPx(first.measures);
    if (!fit) throw new Error(`the stack does not fit the safe area even with the question at ${QUESTION_PX.at(-1)} px`);
    // The answer line sits in the question's slot, so it is measured at the question's fitted size.
    await write('answer', fit.px, LINE_PX[LINE_PX.length - 1]!);
    const lineRun = await preflight(dirs.answer);
    if (lineRun.problems.length) throw new Error(`answer clip: ${lineRun.problems.join('; ')}`);
    // A preflight that reports no line heights (a stub) keeps the largest size.
    const slotH = lineRun.lineSlot ?? lineSlotH(fit.content.question.h);
    const linePx = lineRun.lineHeights ? fitLinePx(lineRun.lineHeights, slotH) : LINE_PX[0];
    if (!linePx) throw new Error(`the answer line does not fit the question's slot (${Math.round(slotH)} px) even at ${LINE_PX.at(-1)} px`);
    for (const role of ROLES) await write(role, fit.px, linePx);
    const page = {} as Record<SlideRole, PageBoxes>;
    for (const role of ROLES) {
      const r = await preflight(dirs[role]);
      if (r.problems.length) throw new Error(`${role} clip: ${r.problems.join('; ')}`);
      page[role] = r.boxes;
    }
    const moved = stackMismatch(page.question, page.answer);
    if (moved.length) throw new Error(`the clips' stacks differ: ${moved.join('; ')}`);
    const model = slideLayout('question', fit.content).boxes;
    const off = Math.max(...STACK.map((k) => boxDelta(model[k], page.question[k])));
    log(`fit: question ${fit.px} px, answer line ${linePx} px; sign y ${Math.round(page.question.sign.y)}, question y ${Math.round(page.question.question.y)}, choices y ${Math.round(page.question.choices.y)}, foot y ${Math.round(page.question.foot.y)} on both clips (layout model within ${off.toFixed(1)} px)`);

    // The confetti starts on the correct pill's centre.
    const pill = page.answer.options[copy.options.findIndex((o) => o.letter === copy.correct)];
    if (!pill) throw new Error('the correct pill was not measured');
    await write('answer', fit.px, linePx, { x: pill.x + pill.w / 2, y: pill.y + pill.h / 2 });

    // The seam (AT-72, a hard rule): clip 2's first frame is clip 1's last, pixel for pixel.
    const seam = deps.seam ?? browser?.seam;
    if (seam) {
      const shots = await seam({ dir: dirs.question, t: SEAM_T }, { dir: dirs.answer, t: 0 });
      if (!shots.a.equals(shots.b)) {
        // Kept outside the work folder, which a default run removes.
        const keep = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-seam-'));
        fs.writeFileSync(path.join(keep, 'question-last.png'), shots.a);
        fs.writeFileSync(path.join(keep, 'answer-first.png'), shots.b);
        throw new Error(`the seam breaks: the answer clip's first frame is not the question clip's last (both frames in ${keep})`);
      }
      log('seam: the answer clip opens on the question clip\'s last frame, pixel for pixel');
    }

    const clips: TriviaClip[] = [];
    for (const [i, role] of ROLES.entries()) {
      const dir = dirs[role];
      // Record, add the clip's slice of the master, take the poster, check what came out.
      runOk(run, HYPERFRAMES_BIN, ['render', '--quality', 'high', '--fps', String(FPS), '--workers', 'auto', '--output', 'renders/video.mp4'], dir, `hyperframes render (${role})`, RENDER_TIMEOUT_MS);
      const silent = path.join(dir, 'renders', 'video.mp4');
      if (!fs.existsSync(silent) || fs.statSync(silent).size === 0) throw new Error(`hyperframes render (${role}) left no renders/video.mp4`);
      const name = `${String(i + 1).padStart(2, '0')}-${role}`;
      const out = path.join(dir, 'renders', `${name}.mp4`);
      runOk(run, 'ffmpeg', muxArgs({ video: silent, master: MASTER_FILE, role, out }), dir, `audio mux (${role})`);
      const poster = path.join(dir, 'renders', `${name}.jpg`);
      runOk(run, 'ffmpeg', posterArgs({ video: out, at: POSTER_AT[role], out: poster }), dir, `poster (${role})`);
      const wrong = deliveryProblems(parseProbe(runOk(run, 'ffprobe', probeArgs(out), dir, `probe (${role})`)), role);
      if (wrong.length) throw new Error(`${role} clip: ${wrong.join('; ')}`);
      clips.push({ role, mp4: fs.readFileSync(out), poster: fs.readFileSync(poster) });
    }
    log(`clips: ${clips.map((c) => `${c.role} ${Math.round(c.mp4.length / 1024)} KB`).join(', ')}`);
    return { clips };
  } finally {
    await browser?.close();
    if (own) fs.rmSync(work, { recursive: true, force: true });
  }
}
