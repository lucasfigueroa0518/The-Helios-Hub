/**
 * "Are you smarter than AI?": render a fixture set locally (opt-in, free: no model, no network; local
 * HyperFrames + ffmpeg only).
 *
 *   npx tsx scripts/trivia_render_fixture.ts [--options 2|3|4] [--out .stories-local/trivia-fixture]
 *
 * Renders both clips with renderTriviaClips (no music, no photos: the fixed show sound), writes
 * 01-question.mp4/.jpg and 02-answer.mp4/.jpg, then prints the acceptance checks (CONTRACT-2 §5 A): length,
 * size, fps, audio, and how closely each clip's sound matches its slice of show-master.flac.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { MASTER_FILE } from '@/lib/stories/trivia/render/audio';
import { renderTriviaClips, type TriviaCopy, type TriviaFrameInput } from '@/lib/stories/trivia/render/clip';
import { CLIP_S, MASTER_AT } from '@/lib/stories/trivia/render/timeline';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** Sample copy by option count (the mock's three questions). 3 is the default fixture. */
const SAMPLES: Record<2 | 3 | 4, TriviaCopy> = {
  2: {
    question: 'Was the first chatbot built before or after the moon landing?',
    options: [{ letter: 'A', text: 'Before' }, { letter: 'B', text: 'After' }],
    correct: 'A',
    answerLine: 'ELIZA chatted in 1966, three years before Apollo 11.',
  },
  3: {
    question: 'Which company built the first AI to beat a world champion at Go?',
    options: [{ letter: 'A', text: 'Google DeepMind' }, { letter: 'B', text: 'OpenAI' }, { letter: 'C', text: 'IBM' }],
    correct: 'A',
    answerLine: 'AlphaGo did it in 2016, about ten years before experts thought it could.',
  },
  4: {
    question: 'Which year did ChatGPT launch?',
    options: [{ letter: 'A', text: '2020' }, { letter: 'B', text: '2021' }, { letter: 'C', text: '2022' }, { letter: 'D', text: '2023' }],
    correct: 'C',
    answerLine: 'It reached 100 million users in about two months.',
  },
};

/** Mono 8 kHz samples of `file` from `ss` for `t` seconds (ffmpeg). */
function pcm(file: string, ss: number, t: number): Float32Array {
  // No -ss at 0: an input seek on AAC drops its first packet (1024 samples) and would misalign the comparison.
  const r = spawnSync('ffmpeg', ['-v', 'error', ...(ss > 0 ? ['-ss', String(ss)] : []), '-t', String(t), '-i', file, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg decode ${file}: ${r.stderr}`);
  const b = r.stdout as Buffer;
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}

/** Normalised correlation of two signals at zero lag (1 = the same sound). */
function correlation(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) {
    ab += a[i]! * b[i]!;
    aa += a[i]! * a[i]!;
    bb += b[i]! * b[i]!;
  }
  return ab / Math.sqrt(aa * bb || 1);
}

async function main() {
  const out = path.resolve(arg('out') ?? '.stories-local/trivia-fixture');
  const n = Number(arg('options') ?? 3);
  if (n !== 2 && n !== 3 && n !== 4) throw new Error('--options must be 2, 3 or 4');
  const copy = SAMPLES[n];
  fs.mkdirSync(out, { recursive: true });
  const log = (l: string) => console.log(l);

  const frames: TriviaFrameInput[] = [
    { role: 'question', copy },
    { role: 'answer', copy },
  ];
  const t0 = Date.now();
  const { clips } = await renderTriviaClips(frames, { workDir: path.join(out, 'work'), log });
  console.log(`rendered in ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const [i, c] of clips.entries()) {
    const base = path.join(out, `${String(i + 1).padStart(2, '0')}-${c.role}`);
    fs.writeFileSync(`${base}.mp4`, c.mp4);
    fs.writeFileSync(`${base}.jpg`, c.poster);
    const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,bit_rate:format=duration', '-of', 'compact=p=0', `${base}.mp4`], { encoding: 'utf8' });
    const r = correlation(pcm(`${base}.mp4`, 0, CLIP_S[c.role]), pcm(MASTER_FILE, MASTER_AT[c.role], CLIP_S[c.role]));
    console.log(`${base}.mp4\n${p.stdout.trim()}\naudio vs show-master.flac ${MASTER_AT[c.role]}–${MASTER_AT[c.role] + CLIP_S[c.role]} s: correlation ${r.toFixed(3)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
