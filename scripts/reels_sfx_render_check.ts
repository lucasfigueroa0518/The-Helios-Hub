/**
 * Stage 4 render check (D-127). For every finished SFX: stamp its hook on a
 * 24 fps test clip, add the SFX with the production mux step, and confirm the
 * audio in the MP4 starts at 0 with no offset, then run the frame test on the
 * decoded audio. Self-contained (a generated clip, no database), so it runs
 * the same on a laptop and on the worker.
 *
 *   npx tsx scripts/reels_sfx_render_check.ts
 *   npx tsx scripts/reels_sfx_render_check.ts --silence-db -60 --onset-ms 10 --edge-guard-ms 5
 *
 * Exits non-zero if any file fails.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { frameMap, SFX_FPS, SFX_SAMPLE_RATE } from '@/lib/reels/sfx/frame-map';
import { frameTest } from '@/lib/reels/sfx/frame-test';
import { FINAL_DIR, type SfxManifest } from '@/lib/reels/sfx/manifest';
import { SFX_MP4_TOLERANCES } from '@/lib/reels/sfx/tolerances';
import { readWav, type Wav } from '@/lib/reels/sfx/wav';
import { muxHookSfx, overlayPlate, probeVideo } from '@/lib/reels/visual/overlay';

/** Largest lag, in samples, the cross-correlation search tries each way (10 ms). */
const MAX_LAG = 480;

function arg(name: string): number | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? Number(process.argv[index + 1]) : null;
}

const keepIndex = process.argv.indexOf('--keep');
/** Copy each decoded MP4 track here, for tolerance evidence. */
const KEEP_DIR = keepIndex >= 0 ? process.argv[keepIndex + 1] : null;

const tolerances = {
  silenceDb: arg('--silence-db') ?? SFX_MP4_TOLERANCES.silenceDb,
  onsetMs: arg('--onset-ms') ?? SFX_MP4_TOLERANCES.onsetMs,
  edgeGuardMs: arg('--edge-guard-ms') ?? SFX_MP4_TOLERANCES.edgeGuardMs ?? 0,
};

function ffmpeg(argv: string[]): void {
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...argv], { stdio: ['ignore', 'ignore', 'inherit'] });
}

function streamStarts(file: string): { video: number; audio: number } {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,start_time', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
  });
  const starts: Record<string, number> = {};
  for (const line of out.trim().split('\n')) {
    const [type, start] = line.split(',');
    if (type) starts[type] = Number(start);
  }
  return { video: starts.video ?? Number.NaN, audio: starts.audio ?? Number.NaN };
}

/** Lag (samples) of `decoded` against `reference` with the best normalized correlation. */
function bestLag(reference: Wav, decoded: Wav): number {
  const a = reference.channels[0];
  const b = decoded.channels[0];
  const length = a.length;
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = -MAX_LAG; lag <= MAX_LAG; lag += 1) {
    let dot = 0;
    let energy = 0;
    for (let i = 0; i < length; i += 1) {
      const j = i + lag;
      if (j < 0 || j >= b.length) continue;
      dot += a[i] * b[j];
      energy += b[j] * b[j];
    }
    const score = energy > 0 ? dot / Math.sqrt(energy) : -Infinity;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best;
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(FINAL_DIR, 'manifest.json'), 'utf8')) as SfxManifest;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-sfx-check-'));
  try {
    const clip = path.join(dir, 'clip.mp4');
    ffmpeg(['-f', 'lavfi', '-i', `testsrc2=s=720x1280:r=${SFX_FPS}:d=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
    const plate = path.join(dir, 'plate.png');
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=black@0.0:s=720x1280,format=rgba', '-frames:v', '1', plate]);
    const shape = await probeVideo(clip);

    console.log(`Tolerances: silence ${tolerances.silenceDb} dBFS, onset ${tolerances.onsetMs} ms, edge guard ${tolerances.edgeGuardMs} ms\n`);
    let failed = 0;
    for (const [file, entry] of Object.entries(manifest.files)) {
      const hooked = path.join(dir, `${entry.hook}-${entry.timing}.mp4`);
      await overlayPlate(clip, plate, hooked, { hook: entry.hook, clip: shape, timing: entry.timing });
      const reel = path.join(dir, `${entry.hook}-${entry.timing}-sfx.mp4`);
      await muxHookSfx(hooked, path.join(FINAL_DIR, file), reel);

      const starts = streamStarts(reel);
      const decodedPath = path.join(dir, `${entry.hook}-${entry.timing}.wav`);
      ffmpeg(['-i', reel, '-vn', '-ar', String(SFX_SAMPLE_RATE), '-c:a', 'pcm_f32le', decodedPath]);
      const decoded = readWav(fs.readFileSync(decodedPath));
      if (KEEP_DIR) {
        fs.mkdirSync(KEEP_DIR, { recursive: true });
        fs.copyFileSync(decodedPath, path.join(KEEP_DIR, file));
      }
      const reference = readWav(fs.readFileSync(path.join(FINAL_DIR, file)));
      const lag = bestLag(reference, decoded);
      const test = frameTest(decoded, frameMap(entry.timing, SFX_FPS), tolerances);

      const problems = [...test.failures];
      if (starts.audio !== 0) problems.push(`Audio stream starts at ${starts.audio}s, not 0.`);
      if (starts.video !== 0) problems.push(`Video stream starts at ${starts.video}s, not 0.`);
      if (lag !== 0) problems.push(`Audio is offset by ${lag} samples (${((lag / SFX_SAMPLE_RATE) * 1000).toFixed(2)} ms).`);
      if (problems.length) failed += 1;
      console.log(
        `${problems.length ? 'FAIL' : 'ok  '} ${file.padEnd(24)} start a=${starts.audio} v=${starts.video}  lag ${lag}  ` +
          `onsets [${test.onsetsMs.join(', ')}] ms  off-frames ${test.offPeakDb} dBFS  after cushion ${test.afterCushionPeakDb} dBFS`,
      );
      for (const problem of problems) console.log(`       ${problem}`);
    }
    console.log(`\n${Object.keys(manifest.files).length - failed} of ${Object.keys(manifest.files).length} passed.`);
    process.exit(failed ? 1 : 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
