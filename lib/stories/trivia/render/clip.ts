/**
 * AI Trivia video (CONTRACT §4 B): the set's two frames → two 5.0 s Story MP4s (1080×1920, 30 fps,
 * AAC audio) and a JPEG poster each (clip 1 at 4.5 s, clip 2 at 0.9 s mid-reveal, for the review).
 *
 *   1. Copy check (AT-6): no "!" and no emoji anywhere; 2–4 options lettered A–D; the answer is one.
 *      Photo credits are never drawn (AT-35), so they are not checked.
 *   2. Audio: the track is fetched and one 10 s master is made for both clips (audio.ts).
 *   3. Each clip is a HyperFrames project (index.html, fonts, gsap, the photo), built from
 *      TriviaSlide.tsx + trivia.css + timeline.ts. The preflight (preflight.ts) fits the text and
 *      checks contrast on SAMPLE_TIMES; a failure deepens the dim one step (DIM_STEPS) and tries again.
 *   4. HyperFrames records it (the pinned CLI, HYPERFRAMES_ENV, as AI Drama's renderVideo does), the
 *      clip's half of the master is muxed in, the poster is taken, and the file is probed (5.0 s ±0.05,
 *      1080×1920, 30 fps, an audio stream) before it is handed back.
 *
 * Every subprocess goes through `run` and the browser check through `preflight`, so tests stub both.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { HYPERFRAMES_BIN, HYPERFRAMES_ENV } from '@/lib/explainers/render/workspace';
import { spawnRunner, tail, type Runner } from '@/lib/reel-ai-drama/render/runner';
import { GSAP_FILE } from '@/lib/reel-ai-drama/render/video';
import { EMOJI_RUN } from '@/lib/stories/render/emoji';
import type { Photo } from '@/lib/stories/render/types';
import type { TriviaMusic } from '@/lib/stories/trivia/music';
import type { TriviaOption, TriviaQuestion } from '@/lib/stories/trivia/types';

import { deliveryProblems, masterArgs, muxArgs, parseProbe, posterArgs, probeArgs } from './audio';
import { seedOf } from './pen';
import { openPreflight, type Preflight, type PreflightResult } from './preflight';
import { answerTimeline, ambientTweens, CLIP_S, FPS, POSTER_AT, questionTimeline, timelineScript } from './timeline';
import { HEADLINE, TAP_LINE, type SlideInput, type SlideRole } from './TriviaSlide';

const FONT_DIR = path.join(process.cwd(), 'lib', 'stories', 'render', 'assets');
/** Instagram's Classic text: Inter Medium (AT-34). */
const FONT_FILES = ['Inter-Medium.ttf'];
/** The dim over the photo, lightest first; each preflight failure on contrast moves one step darker. */
export const DIM_STEPS = [0.5, 0.58, 0.66, 0.74, 0.82];
const RENDER_TIMEOUT_MS = 15 * 60 * 1000;
const LETTERS = ['A', 'B', 'C', 'D'] as const;

export type TriviaCopy = Pick<TriviaQuestion, 'question' | 'options' | 'correct' | 'answerLine'>;
/** One of the set's frames as the build saved it: `copy` holds the question fields, `photo` the slide's photo. */
export type TriviaFrameInput = { role: SlideRole; copy: TriviaCopy & Partial<TriviaQuestion>; photo?: Photo | null };
export type TriviaClip = { role: SlideRole; mp4: Buffer; poster: Buffer };
export type TriviaClips = { clips: TriviaClip[] };
export type RenderDeps = {
  run?: Runner;
  preflight?: Preflight;
  /** Fetch the music (music.url) to a file. Plain fetch by default. */
  download?: (url: string, dest: string) => Promise<unknown>;
  /** A photo's bytes from its src (an http(s) URL or a repo path). */
  readPhoto?: (src: string) => Promise<Buffer>;
  /** Build in this folder and keep it (a temp folder, removed after, by default). */
  workDir?: string;
  log?: (line: string) => void;
};

/** AT-6 and the option rules: what is wrong with the copy (empty when it may be drawn). `credits`: any other text that will be drawn. */
export function copyProblems(copy: TriviaCopy, credits: string[] = []): string[] {
  const out: string[] = [];
  const texts = [copy.question, copy.answerLine, ...copy.options.map((o) => o.text), ...credits];
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
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The composition page for one slide. */
export async function compositionHtml(input: SlideInput): Promise<string> {
  // The confetti is seeded by the question, so a set always throws the same burst (AT-38).
  const s: SlideInput = { ...input, confettiSeed: input.confettiSeed ?? seedOf(input.question) };
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { TriviaSlide } = await import('./TriviaSlide');
  const css = fs.readFileSync(path.join(process.cwd(), 'lib', 'stories', 'trivia', 'render', 'trivia.css'), 'utf8');
  const n = s.options.length;
  const correct = s.options.findIndex((o) => o.letter === s.correct);
  const clip = s.role === 'question' ? 0 : 1;
  const tweens = [...ambientTweens(clip), ...(s.role === 'question' ? questionTimeline(n) : answerTimeline(n, correct, s.confettiSeed))];
  const face = (file: string, family: string, weight: number) =>
    `@font-face { font-family: '${family}'; src: url('assets/fonts/${file}'); font-weight: ${weight}; font-style: normal; font-display: block; }`;
  const body = renderToStaticMarkup(React.createElement(TriviaSlide, { s }));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1080, height=1920" />
<title>${esc(HEADLINE)}</title>
<script src="assets/vendor/gsap.min.js"></script>
<style>
${face('Inter-Medium.ttf', 'Inter', 500)}
${css}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${CLIP_S}" data-width="1080" data-height="1920" data-fps="${FPS}">
<div id="tv-slide" class="clip tv-layer" data-start="0" data-duration="${CLIP_S}" data-track-index="0">${body}</div>
</div>
<script>
${timelineScript(tweens)}
</script>
</body>
</html>
`;
}

const PROJECT_FILES: Record<string, string> = {
  'hyperframes.json': `${JSON.stringify({ $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json', paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' }, media: { autoProxy: true } }, null, 2)}\n`,
  'package.json': `${JSON.stringify({ name: 'ai-trivia-clip', private: true, type: 'module' }, null, 2)}\n`,
  'meta.json': `${JSON.stringify({ id: 'ai-trivia-clip', name: 'ai-trivia-clip' }, null, 2)}\n`,
};

async function defaultReadPhoto(src: string): Promise<Buffer> {
  if (/^https?:/.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`photo HTTP ${res.status}: ${src.slice(0, 80)}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const file = path.resolve(process.cwd(), src);
  if (!file.startsWith(process.cwd() + path.sep)) throw new Error(`photo outside the repo: ${src}`);
  return fs.promises.readFile(file);
}

async function defaultDownload(url: string, dest: string): Promise<void> {
  if (!/^https?:/.test(url)) {
    fs.copyFileSync(path.resolve(url), dest);
    return;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`music HTTP ${res.status}: ${url.slice(0, 80)}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/** The project folder for one clip, without its index.html. */
async function prepareProject(dir: string, photo: Buffer | null): Promise<void> {
  fs.mkdirSync(path.join(dir, 'assets', 'fonts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'vendor'), { recursive: true });
  for (const [f, body] of Object.entries(PROJECT_FILES)) fs.writeFileSync(path.join(dir, f), body);
  for (const f of FONT_FILES) fs.copyFileSync(path.join(FONT_DIR, f), path.join(dir, 'assets', 'fonts', f));
  fs.copyFileSync(GSAP_FILE, path.join(dir, 'assets', 'vendor', 'gsap.min.js'));
  if (photo) {
    const sharp = (await import('sharp')).default;
    // Big enough for the drift's zoom (≤ 1.12), small enough to keep capture quick.
    await sharp(photo).rotate().resize(1240, 2204, { fit: 'cover' }).jpeg({ quality: 88 }).toFile(path.join(dir, 'assets', 'photo.jpg'));
  }
}

function runOk(run: Runner, cmd: string, args: string[], cwd: string, what: string, timeoutMs = 5 * 60 * 1000): string {
  const res = run(cmd, args, { cwd, env: { ...process.env, ...HYPERFRAMES_ENV }, timeoutMs });
  if (res.status !== 0) throw new Error(`${what} exited ${res.status ?? 'with no status'}: ${tail(res)}`);
  return res.stdout;
}

/** Render the set's two clips. `frames` holds the question and the answer frame (any order). */
export async function renderTriviaClips(frames: TriviaFrameInput[], music: TriviaMusic, deps: RenderDeps = {}): Promise<TriviaClips> {
  const run = deps.run ?? spawnRunner;
  const log = deps.log ?? (() => undefined);
  const q = frames.find((f) => f.role === 'question');
  const a = frames.find((f) => f.role === 'answer');
  if (!q || !a || frames.length !== 2) throw new Error('AI Trivia renders exactly two frames: question and answer');
  const copy: TriviaCopy = { question: q.copy.question, options: q.copy.options, correct: q.copy.correct, answerLine: q.copy.answerLine ?? a.copy.answerLine };
  const qPhoto = q.photo ?? null;
  const aPhoto = a.photo ?? qPhoto;
  const problems = copyProblems(copy);
  if (problems.length) throw new Error(`AI Trivia copy can't be drawn: ${problems.join('; ')}`);

  const own = !deps.workDir;
  const work = deps.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-render-'));
  fs.mkdirSync(work, { recursive: true });
  let browser: { check: Preflight; close: () => Promise<void> } | null = null;
  try {
    // Audio first: cheap, and a bad track fails before any recording.
    const track = path.join(work, 'track.mp3');
    await (deps.download ?? defaultDownload)(music.url, track);
    const master = path.join(work, 'master.wav');
    runOk(run, 'ffmpeg', masterArgs({ track, startMs: music.startMs, out: master }), work, 'audio master');

    const readPhoto = deps.readPhoto ?? defaultReadPhoto;
    const photoBytes = new Map<string, Buffer>();
    const bytesOf = async (p: Photo | null) => {
      if (!p) return null;
      if (!photoBytes.has(p.src)) photoBytes.set(p.src, await readPhoto(p.src));
      return photoBytes.get(p.src)!;
    };
    let preflight = deps.preflight;
    if (!preflight) {
      browser = await openPreflight();
      preflight = browser.check;
    }

    const clips: TriviaClip[] = [];
    for (const [i, role] of (['question', 'answer'] as const).entries()) {
      const photo = role === 'question' ? qPhoto : aPhoto;
      const dir = path.join(work, `clip-${i + 1}-${role}`);
      await prepareProject(dir, await bytesOf(photo));
      const base: Omit<SlideInput, 'dim'> = {
        role, question: copy.question, options: copy.options, correct: copy.correct, answerLine: copy.answerLine,
        photo: photo ? 'assets/photo.jpg' : null, focus: photo?.focus,
      };
      // Fit and contrast, darkening the photo a step at a time until every sampled frame reads.
      let passed: { dim: number; result: PreflightResult } | null = null;
      let last: PreflightResult | null = null;
      for (const dim of DIM_STEPS) {
        fs.writeFileSync(path.join(dir, 'index.html'), await compositionHtml({ ...base, dim }));
        last = await preflight(dir);
        const other = last.problems.filter((p) => !p.startsWith('contrast'));
        if (other.length) throw new Error(`${role} clip: ${other.join('; ')}`);
        if (!last.problems.length) {
          passed = { dim, result: last };
          break;
        }
        log(`${role}: contrast fails at dim ${dim} (${last.problems.length}), darkening`);
      }
      if (!passed) throw new Error(`${role} clip: contrast fails even at dim ${DIM_STEPS.at(-1)}: ${last?.problems.join('; ')}`);
      const worst = Math.min(...passed.result.contrast.map((c) => c.mean));
      log(`${role}: dim ${passed.dim}, ${passed.result.contrast.length} contrast readings, lowest mean ${Number.isFinite(worst) ? worst : 'n/a'}:1`);
      fs.writeFileSync(path.join(dir, 'index.html'), await compositionHtml({ ...base, dim: passed.dim, sizes: passed.result.sizes }));

      // Record, add the clip's half of the master, take the poster, check what came out.
      runOk(run, HYPERFRAMES_BIN, ['render', '--quality', 'high', '--fps', String(FPS), '--workers', 'auto', '--output', 'renders/video.mp4'], dir, `hyperframes render (${role})`, RENDER_TIMEOUT_MS);
      const silent = path.join(dir, 'renders', 'video.mp4');
      if (!fs.existsSync(silent) || fs.statSync(silent).size === 0) throw new Error(`hyperframes render (${role}) left no renders/video.mp4`);
      const out = path.join(dir, 'renders', `${String(i + 1).padStart(2, '0')}-${role}.mp4`);
      runOk(run, 'ffmpeg', muxArgs({ video: silent, master, clip: i as 0 | 1, out }), dir, `audio mux (${role})`);
      const poster = path.join(dir, 'renders', `${String(i + 1).padStart(2, '0')}-${role}.jpg`);
      runOk(run, 'ffmpeg', posterArgs({ video: out, at: POSTER_AT[role], out: poster }), dir, `poster (${role})`);
      const bad = deliveryProblems(parseProbe(runOk(run, 'ffprobe', probeArgs(out), dir, `probe (${role})`)));
      if (bad.length) throw new Error(`${role} clip: ${bad.join('; ')}`);
      clips.push({ role, mp4: fs.readFileSync(out), poster: fs.readFileSync(poster) });
    }
    log(`clips: ${clips.map((c) => `${c.role} ${Math.round(c.mp4.length / 1024)} KB`).join(', ')}; copy: "${HEADLINE}" / "${TAP_LINE}" fixed`);
    return { clips };
  } finally {
    await browser?.close();
    if (own) fs.rmSync(work, { recursive: true, force: true });
  }
}
