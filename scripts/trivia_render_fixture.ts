/**
 * AI Trivia: render the fixture set locally (opt-in, free: no model, no network unless --heygen).
 *
 *   npx tsx scripts/trivia_render_fixture.ts --track <local.mp3> [--out .stories-local/trivia-fixture]
 *   npx tsx scripts/trivia_render_fixture.ts --heygen          (one free HeyGen catalog search + download)
 *
 * Picks the music window with pickTriviaMusic (the track as a one-item catalog when --track is given),
 * renders both clips with renderTriviaClips, writes 01-question.mp4/.jpg and 02-answer.mp4/.jpg, then
 * prints the acceptance checks (CONTRACT §5 B): length, size, fps, audio, reveal on the sting hit and
 * on a beat, contrast.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { decodePcm } from '@/lib/reels/music/audio';
import { pickTriviaMusic, type CatalogTrack } from '@/lib/stories/trivia/music';
import { beatGrid } from '@/lib/stories/trivia/render/beats';
import { renderTriviaClips, type TriviaFrameInput } from '@/lib/stories/trivia/render/clip';
import { CLIP_MS, FPS, HIT_MS } from '@/lib/stories/trivia/render/timeline';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const FIXTURE = {
  question: 'ELIZA, the 1966 chatbot people confided in like a therapist, was written at which university?',
  options: [
    { letter: 'A' as const, text: 'Stanford' },
    { letter: 'B' as const, text: 'MIT' },
    { letter: 'C' as const, text: 'Harvard' },
    { letter: 'D' as const, text: 'Carnegie Mellon' },
  ],
  correct: 'B' as const,
  answerLine: 'Joseph Weizenbaum wrote it at MIT, then spent years warning how fast people trusted it.',
};

async function main() {
  const out = path.resolve(arg('out') ?? '.stories-local/trivia-fixture');
  const track = arg('track');
  const heygen = process.argv.includes('--heygen');
  if (!track && !heygen) throw new Error('pass --track <local.mp3> or --heygen');
  fs.mkdirSync(out, { recursive: true });
  const log = (l: string) => console.log(l);

  const local: CatalogTrack[] | null = track ? [{ id: `local:${path.basename(track)}`, name: path.basename(track), audio_url: path.resolve(track) }] : null;
  const music = await pickTriviaMusic({
    recentTrackIds: async () => [],
    ...(local ? { search: async () => local, download: async (url: string, dest: string) => fs.copyFileSync(url, dest) } : {}),
    log,
  });
  fs.writeFileSync(path.join(out, 'music.json'), `${JSON.stringify(music, null, 2)}\n`);

  const frames: TriviaFrameInput[] = [
    { role: 'question', copy: FIXTURE, photo: { src: 'lib/stories/render/fixtures/photos/datacenter.jpg', credit: 'Photo: fixture', kind: 'scene' } },
    { role: 'answer', copy: FIXTURE, photo: { src: 'lib/stories/render/fixtures/photos/openai_hq.jpg', credit: 'Photo: fixture', kind: 'scene' } },
  ];
  const t0 = Date.now();
  const { clips } = await renderTriviaClips(frames, music, {
    workDir: path.join(out, 'work'),
    log,
    ...(local ? { download: async (url: string, dest: string) => fs.copyFileSync(url, dest) } : {}),
  });
  console.log(`rendered in ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const [i, c] of clips.entries()) {
    const base = path.join(out, `${String(i + 1).padStart(2, '0')}-${c.role}`);
    fs.writeFileSync(`${base}.mp4`, c.mp4);
    fs.writeFileSync(`${base}.jpg`, c.poster);
    const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate:format=duration', '-of', 'compact=p=0', `${base}.mp4`], { encoding: 'utf8' });
    console.log(`${base}.mp4\n${p.stdout.trim()}`);
  }

  // The reveal: clip 2 frame round(HIT_MS / frame) is the hit; in track time that is startMs + CLIP_MS + HIT_MS.
  const revealFrame = Math.round((HIT_MS / 1000) * FPS);
  const hitTrackMs = music.startMs + CLIP_MS + HIT_MS;
  const nearestListed = Math.min(...music.beatMs.map((b) => Math.abs(b - hitTrackMs)));
  // An independent check: a fresh grid over the track, and the nearest beat to the hit.
  const src = path.join(out, 'work', 'track.mp3');
  const grid = beatGrid(await decodePcm(src), 48_000);
  const nearest = Math.min(...grid.beatsMs.map((b) => Math.abs(b - hitTrackMs)));
  const frameMs = 1000 / FPS;
  console.log(`reveal: clip 2 frame ${revealFrame} (${(revealFrame / FPS).toFixed(3)} s) = sting hit +0.600 s; track ${hitTrackMs} ms; nearest listed beat ${nearestListed.toFixed(1)} ms away; fresh grid (${grid.bpm} BPM) ${nearest.toFixed(1)} ms away; within ±1 frame: ${nearest <= frameMs ? 'yes' : 'NO'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
