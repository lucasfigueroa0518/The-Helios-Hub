/**
 * Stage 2 of the hook sound plan (review gate 1). For every hook, both
 * candidate sources, all three timings: draft the gated SFX, stamp the hook on
 * a real reel clip, add the SFX, upload the MP4 for the review page, and write
 * lib/reels/sfx/review.json. Local ffmpeg only; no Claude, Jev, or Kling calls.
 *
 *   npx tsx --env-file=.env.local scripts/reels_sfx_review.ts
 *   npx tsx --env-file=.env.local scripts/reels_sfx_review.ts --no-upload
 *
 * The base clip is a stored finished reel cut from 1.0s, past its baked-in
 * hook (D-119). Pass --clip <path> to use a local reel instead.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { SFX_CANDIDATES } from '@/lib/reels/sfx/candidates';
import { CHART_FRAMES, CHART_WINDOWS_PER_FRAME, DRAFT_SETTINGS } from '@/lib/reels/sfx/draft';
import { frameMap, SFX_FPS, SFX_SAMPLE_RATE, SFX_TIMINGS } from '@/lib/reels/sfx/frame-map';
import type { SfxReview, SfxReviewCandidate } from '@/lib/reels/sfx/review';
import { draftSource, sourceSlug as slug } from '@/lib/reels/sfx/source';
import { writeWav16 } from '@/lib/reels/sfx/wav';
import { HOOKS, type Hook, type HookTiming } from '@/lib/reels/visual/hook';
import { muxHookSfx, overlayPlate, probeVideo } from '@/lib/reels/visual/overlay';

const WORK = path.join('tmp', 'sfx-review');
const OUT_JSON = path.join('lib', 'reels', 'sfx', 'review.json');
const CLIP_START_SECONDS = 1.0;
const CLIP_SECONDS = 3.0;

const args = process.argv.slice(2);
const UPLOAD = !args.includes('--no-upload');
const clipArg = args.includes('--clip') ? args[args.indexOf('--clip') + 1] : null;

function ffmpeg(argv: string[]): void {
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...argv], { stdio: ['ignore', 'ignore', 'inherit'] });
}

async function storedReel(): Promise<string> {
  const target = path.join(WORK, 'reel.mp4');
  if (fs.existsSync(target)) return target;
  const { dbQuery } = await import('@/lib/db');
  const { downloadFrameObject } = await import('@/lib/reels/visual/storage');
  const { rows } = await dbQuery<{ video_storage_path: string }>(
    `SELECT video_storage_path FROM reels.video_jobs
      WHERE status = 'ok' AND video_storage_path IS NOT NULL
      ORDER BY finished_at DESC LIMIT 1`,
  );
  const row = rows[0];
  if (!row) throw new Error('No finished reel in storage to use as the review clip.');
  fs.writeFileSync(target, await downloadFrameObject(row.video_storage_path));
  console.log(`Review clip: ${row.video_storage_path}`);
  return target;
}

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  const reel = clipArg ?? (await storedReel());

  const base = path.join(WORK, 'base.mp4');
  ffmpeg([
    '-ss', String(CLIP_START_SECONDS), '-i', reel, '-t', String(CLIP_SECONDS), '-an',
    '-r', String(SFX_FPS), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', base,
  ]);
  const clip = await probeVideo(base);
  if (clip.fps !== SFX_FPS) throw new Error(`Review clip is ${clip.fps} fps; the SFX are built for ${SFX_FPS}.`);

  const plate = path.join(WORK, 'plate.png');
  ffmpeg(['-f', 'lavfi', '-i', `color=c=black@0.0:s=${clip.width}x${clip.height},format=rgba`, '-frames:v', '1', plate]);

  const { uploadFrameObject } = UPLOAD ? await import('@/lib/reels/visual/storage') : { uploadFrameObject: null };
  const hooked = new Map<string, string>();
  const review: SfxReview = {
    generatedAt: new Date().toISOString(),
    fps: SFX_FPS,
    sampleRate: SFX_SAMPLE_RATE,
    settings: DRAFT_SETTINGS,
    chart: { frames: CHART_FRAMES, windowsPerFrame: CHART_WINDOWS_PER_FRAME },
    clip: { startSeconds: CLIP_START_SECONDS, seconds: CLIP_SECONDS },
    hooks: [],
  };

  for (const hook of HOOKS) {
    const candidates: SfxReviewCandidate[] = [];
    for (const candidate of SFX_CANDIDATES[hook as Hook]) {
      const entry: SfxReviewCandidate = { ...candidate, slug: slug(candidate.source), timings: {} as SfxReviewCandidate['timings'] };

      for (const timing of SFX_TIMINGS as HookTiming[]) {
        const map = frameMap(timing, SFX_FPS);
        const { draft, tempo, offsetMs } = draftSource(candidate.source, timing, WORK);

        const dir = path.join(WORK, 'drafts', hook, entry.slug);
        fs.mkdirSync(dir, { recursive: true });
        const wavPath = path.join(dir, `${timing}.wav`);
        fs.writeFileSync(wavPath, writeWav16(draft.channels, SFX_SAMPLE_RATE));

        const hookKey = `${hook}-${timing}`;
        if (!hooked.has(hookKey)) {
          const out = path.join(WORK, 'hooked', `${hookKey}.mp4`);
          fs.mkdirSync(path.dirname(out), { recursive: true });
          await overlayPlate(base, plate, out, { hook: hook as Hook, clip, timing });
          hooked.set(hookKey, out);
        }
        const mp4 = path.join(dir, `${timing}.mp4`);
        await muxHookSfx(hooked.get(hookKey)!, wavPath, mp4);

        const objectPath = `sfx-review/${hook}/${entry.slug}/${timing}.mp4`;
        if (uploadFrameObject) await uploadFrameObject(objectPath, fs.readFileSync(mp4), 'video/mp4');

        entry.timings[timing] = {
          objectPath,
          tempo,
          offsetMs,
          metrics: draft.metrics,
          envelopeDb: draft.envelopeDb,
          map: { on: map.on, off: map.off, lastOnFrame: map.lastOnFrame, cushionEndFrame: map.cushionEndFrame },
        };
        const m = draft.metrics;
        console.log(
          `${hook.padEnd(12)}${entry.slug.padEnd(22)}${timing.padEnd(8)}` +
            `tempo ${tempo.toFixed(3)}  start ${entry.timings[timing].offsetMs}ms  gain ${m.gainDb}dB${m.ceilingBound ? ' (ceiling)' : ''}  ` +
            `on ${m.onRmsDb}dB  spans [${m.spanRmsDb.join(', ')}]  peak ${m.peakDb}`,
        );
      }
      candidates.push(entry);
    }
    review.hooks.push({ hook: hook as Hook, candidates });
  }

  fs.writeFileSync(OUT_JSON, `${JSON.stringify(review)}\n`);
  console.log(`\nWrote ${OUT_JSON}${UPLOAD ? ' and uploaded 36 review MP4s' : ' (no upload)'}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
