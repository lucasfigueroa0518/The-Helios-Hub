import path from 'node:path';

import { DRAFT_SETTINGS, type DraftSettings } from '@/lib/reels/sfx/draft';
import { LIMITER_SETTINGS } from '@/lib/reels/sfx/limiter';
import type { Hook, HookTiming } from '@/lib/reels/visual/hook';

/**
 * The 18 finished hook SFX live in the repo (D-125), so the frame test reads
 * them offline and the worker tarball ships them. Names are <hook>-<timing>.wav.
 */
export const SFX_VERSION = 'hook-sfx-v1';
export const FINAL_DIR = path.join('lib', 'reels', 'sfx', 'final');

/** D-131 (−20 dBFS RMS, limiter, −1 dBTP), D-132 (3 ms fades), D-133 (2-frame cushion). */
export const SFX_FINAL_SETTINGS: DraftSettings = {
  ...DRAFT_SETTINGS,
  targetRmsDb: -20,
  edgeFadeMs: 3,
  cushionFrames: 2,
  peakCeilingDb: -1,
  limiter: LIMITER_SETTINGS,
};

export type SfxManifestEntry = {
  hook: Hook;
  timing: HookTiming;
  source: string;
  manipulations: {
    trimStartMs: number;
    /** 1 means not stretched. */
    tempo: number;
    gainDb: number;
    limiterMaxReductionDb: number;
    edgeFadeMs: number;
    cushionFrames: number;
  };
  measured: { onRmsDb: number; spanRmsDb: number[]; truePeakDb: number };
  samples: number;
  sha256: string;
};

export type SfxManifest = {
  version: string;
  fps: number;
  sampleRate: number;
  settings: DraftSettings;
  files: Record<string, SfxManifestEntry>;
};

export function sfxFileName(hook: Hook, timing: HookTiming): string {
  return `${hook}-${timing}.wav`;
}

/**
 * Which finished SFX a render attaches (SFX-07, D-123). The hook is the one
 * actually stamped: an invert fallback gets invert's sound, no hook gets none,
 * and a clip that is not 24 fps ships silent because the files are frame-exact
 * at 24 only.
 */
export function hookSfxPlan(
  hook: Hook | null,
  fps: number | null,
  timing: HookTiming,
  sfxFps: number,
): { file: string } | { file: null; notice: string | null } {
  if (!hook || fps == null) return { file: null, notice: null };
  if (fps !== sfxFps) {
    return { file: null, notice: `Clip is ${fps} fps and the hook sounds are built for ${sfxFps}, so the reel ships silent.` };
  }
  return { file: sfxFileName(hook, timing) };
}
