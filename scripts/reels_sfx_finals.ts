/**
 * Stage 3 of the hook sound plan (review gate 2). Builds the 18 finished SFX
 * (six picks × three timings, D-129) at every loudness target for SFX-V2, and
 * the strobe files at three gate-edge fades for SFX-V3. Each is muxed onto the
 * Stage 2 review clip with its hook, uploaded, and recorded in
 * lib/reels/sfx/finals-review.json. Local ffmpeg only; nothing paid.
 *
 *   npx tsx --env-file=.env.local scripts/reels_sfx_finals.ts
 *   npx tsx --env-file=.env.local scripts/reels_sfx_finals.ts --no-upload
 *
 * Run scripts/reels_sfx_review.ts first: it makes the review clip and hooked videos.
 */
import fs from 'node:fs';
import path from 'node:path';

import { CHART_FRAMES, CHART_WINDOWS_PER_FRAME, DRAFT_SETTINGS, edgeClickDb, type DraftSettings } from '@/lib/reels/sfx/draft';
import { frameMap, SFX_FPS, SFX_SAMPLE_RATE, SFX_TIMINGS } from '@/lib/reels/sfx/frame-map';
import { LIMITER_SETTINGS } from '@/lib/reels/sfx/limiter';
import { SFX_PICKS } from '@/lib/reels/sfx/picks';
import type { SfxFinalsReview, SfxReviewTiming } from '@/lib/reels/sfx/review';
import { draftSource, sourceSlug } from '@/lib/reels/sfx/source';
import { writeWav16 } from '@/lib/reels/sfx/wav';
import { HOOKS, type Hook, type HookTiming } from '@/lib/reels/visual/hook';
import { muxHookSfx, overlayPlate, probeVideo } from '@/lib/reels/visual/overlay';

const WORK = path.join('tmp', 'sfx-review');
const OUT = path.join(WORK, 'finals');
const OUT_JSON = path.join('lib', 'reels', 'sfx', 'finals-review.json');
const TARGETS = [-22, -20, -18, -16, -14];
const FADES = [1, 3, 8];
const FADE_TIMING: HookTiming = 'strobe';
const FADE_TARGET = -20;
const UPLOAD = !process.argv.includes('--no-upload');

const BASE: DraftSettings = { ...DRAFT_SETTINGS, limiter: LIMITER_SETTINGS };

async function main() {
  const base = path.join(WORK, 'base.mp4');
  const plate = path.join(WORK, 'plate.png');
  if (!fs.existsSync(base) || !fs.existsSync(plate)) throw new Error('Run scripts/reels_sfx_review.ts first.');
  const clip = await probeVideo(base);
  const { uploadFrameObject } = UPLOAD ? await import('@/lib/reels/visual/storage') : { uploadFrameObject: null };

  async function hooked(hook: Hook, timing: HookTiming): Promise<string> {
    const out = path.join(WORK, 'hooked', `${hook}-${timing}.mp4`);
    if (!fs.existsSync(out)) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await overlayPlate(base, plate, out, { hook, clip, timing });
    }
    return out;
  }

  async function render(hook: Hook, file: string, timing: HookTiming, settings: DraftSettings, variant: string) {
    const map = frameMap(timing, SFX_FPS);
    const { draft, tempo, offsetMs } = draftSource(file, timing, WORK, settings);
    const dir = path.join(OUT, variant);
    fs.mkdirSync(dir, { recursive: true });
    const wav = path.join(dir, `${hook}-${timing}.wav`);
    const mp4 = path.join(dir, `${hook}-${timing}.mp4`);
    fs.writeFileSync(wav, writeWav16(draft.channels, SFX_SAMPLE_RATE));
    await muxHookSfx(await hooked(hook, timing), wav, mp4);
    const objectPath = `sfx-final-review/${variant}/${hook}-${timing}.mp4`;
    if (uploadFrameObject) await uploadFrameObject(objectPath, fs.readFileSync(mp4), 'video/mp4');
    const record: SfxReviewTiming = {
      objectPath,
      tempo,
      offsetMs,
      metrics: draft.metrics,
      envelopeDb: draft.envelopeDb,
      map: { on: map.on, off: map.off, lastOnFrame: map.lastOnFrame, cushionEndFrame: map.cushionEndFrame },
    };
    return { record, click: edgeClickDb(draft.channels, map, SFX_SAMPLE_RATE) };
  }

  const review: SfxFinalsReview = {
    generatedAt: new Date().toISOString(),
    fps: SFX_FPS,
    sampleRate: SFX_SAMPLE_RATE,
    settings: BASE,
    chart: { frames: CHART_FRAMES, windowsPerFrame: CHART_WINDOWS_PER_FRAME },
    targets: TARGETS,
    fades: FADES,
    fadeTiming: FADE_TIMING,
    fadeTarget: FADE_TARGET,
    hooks: [],
  };

  for (const hook of HOOKS) {
    const file = SFX_PICKS[hook];
    const entry: SfxFinalsReview['hooks'][number] = { hook, source: file, byTarget: {}, byFade: {} };
    for (const target of TARGETS) {
      const timings = {} as Record<HookTiming, SfxReviewTiming>;
      for (const timing of SFX_TIMINGS) {
        const { record } = await render(hook, file, timing, { ...BASE, targetRmsDb: target }, `t${-target}`);
        timings[timing] = record;
        const m = record.metrics;
        console.log(
          `${hook.padEnd(12)}${sourceSlug(file).padEnd(20)}${String(target).padEnd(5)}${timing.padEnd(8)}on ${m.onRmsDb}  tp ${m.truePeakDb}  limiter ${m.limiter?.maxReductionDb ?? 0} dB`,
        );
      }
      entry.byTarget[String(target)] = timings;
    }
    for (const fade of FADES) {
      const { record, click } = await render(
        hook,
        file,
        FADE_TIMING,
        { ...BASE, targetRmsDb: FADE_TARGET, edgeFadeMs: fade },
        `fade${fade}`,
      );
      entry.byFade[String(fade)] = { ...record, edgeClickDb: click };
      console.log(`${hook.padEnd(12)}fade ${fade} ms  edge click ${click} dB`);
    }
    review.hooks.push(entry);
  }

  fs.writeFileSync(OUT_JSON, `${JSON.stringify(review)}\n`);
  const count = HOOKS.length * (TARGETS.length * SFX_TIMINGS.length + FADES.length);
  console.log(`\nWrote ${OUT_JSON}${UPLOAD ? ` and uploaded ${count} MP4s` : ' (no upload)'}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
