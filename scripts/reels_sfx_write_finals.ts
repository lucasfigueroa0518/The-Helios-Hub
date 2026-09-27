/**
 * Stage 3 of the hook sound plan: write the 18 finished hook SFX and their
 * manifest into lib/reels/sfx/final/. Six picks (D-129) × three timings, at
 * −20 dBFS RMS on the flickers with the limiter (D-130, D-131), 3 ms gate-edge
 * fades (D-132), and the 2-frame cushion (D-133). Local ffmpeg only.
 *
 *   npx tsx scripts/reels_sfx_write_finals.ts
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { SFX_FPS, SFX_SAMPLE_RATE, SFX_TIMINGS } from '@/lib/reels/sfx/frame-map';
import { LIMITER_SETTINGS } from '@/lib/reels/sfx/limiter';
import { FINAL_DIR, SFX_FINAL_SETTINGS, SFX_VERSION, sfxFileName, type SfxManifest } from '@/lib/reels/sfx/manifest';
import { SFX_PICKS } from '@/lib/reels/sfx/picks';
import { draftSource } from '@/lib/reels/sfx/source';
import { writeWav16 } from '@/lib/reels/sfx/wav';
import { HOOKS } from '@/lib/reels/visual/hook';

const WORK = path.join('tmp', 'sfx-review');

fs.mkdirSync(FINAL_DIR, { recursive: true });
const manifest: SfxManifest = {
  version: SFX_VERSION,
  fps: SFX_FPS,
  sampleRate: SFX_SAMPLE_RATE,
  settings: SFX_FINAL_SETTINGS,
  files: {},
};

for (const hook of HOOKS) {
  for (const timing of SFX_TIMINGS) {
    const source = SFX_PICKS[hook];
    const { draft, tempo, offsetMs } = draftSource(source, timing, WORK, SFX_FINAL_SETTINGS);
    const bytes = writeWav16(draft.channels, SFX_SAMPLE_RATE);
    const file = sfxFileName(hook, timing);
    fs.writeFileSync(path.join(FINAL_DIR, file), bytes);
    const m = draft.metrics;
    manifest.files[file] = {
      hook,
      timing,
      source,
      manipulations: {
        trimStartMs: offsetMs,
        tempo,
        gainDb: m.gainDb,
        limiterMaxReductionDb: m.limiter?.maxReductionDb ?? 0,
        edgeFadeMs: SFX_FINAL_SETTINGS.edgeFadeMs,
        cushionFrames: SFX_FINAL_SETTINGS.cushionFrames,
      },
      measured: { onRmsDb: m.onRmsDb, spanRmsDb: m.spanRmsDb, truePeakDb: m.truePeakDb },
      samples: draft.channels[0].length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    console.log(`${file.padEnd(24)} ${source.padEnd(22)} on ${m.onRmsDb}  tp ${m.truePeakDb}  limiter ${m.limiter?.maxReductionDb ?? 0} dB`);
  }
}

// The settings must be the ones Lucas heard on the review page.
if (SFX_FINAL_SETTINGS.edgeFadeMs !== 3 || SFX_FINAL_SETTINGS.targetRmsDb !== -20 || SFX_FINAL_SETTINGS.limiter !== LIMITER_SETTINGS) {
  throw new Error('Final settings drifted from D-131 to D-133.');
}
fs.writeFileSync(path.join(FINAL_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nWrote 18 files and manifest.json to ${FINAL_DIR}`);
