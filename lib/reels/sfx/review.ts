import type { SfxCandidate } from '@/lib/reels/sfx/candidates';
import type { DraftMetrics, DraftSettings } from '@/lib/reels/sfx/draft';
import type { Hook, HookTiming } from '@/lib/reels/visual/hook';

/** The Stage 2 review record, written by scripts/reels_sfx_review.ts and read by /reels/sfx. */
export type SfxReviewTiming = {
  objectPath: string;
  /** 1 means the source was not stretched. */
  tempo: number;
  /** Where in the (stretched) source the draft starts. */
  offsetMs: number;
  metrics: DraftMetrics;
  envelopeDb: number[];
  map: { on: Array<[number, number]>; off: Array<[number, number]>; lastOnFrame: number; cushionEndFrame: number };
};

export type SfxReviewCandidate = SfxCandidate & {
  slug: string;
  timings: Record<HookTiming, SfxReviewTiming>;
};

export type SfxReview = {
  generatedAt: string;
  fps: number;
  sampleRate: number;
  settings: DraftSettings;
  chart: { frames: number; windowsPerFrame: number };
  clip: { startSeconds: number; seconds: number };
  hooks: Array<{ hook: Hook; candidates: SfxReviewCandidate[] }>;
};

/** Only paths the review record names can be signed. */
export function reviewObjectPaths(review: SfxReview): Set<string> {
  const out = new Set<string>();
  for (const hook of review.hooks) {
    for (const candidate of hook.candidates) {
      for (const timing of Object.values(candidate.timings)) out.add(timing.objectPath);
    }
  }
  return out;
}

/** Stage 3 review record (review gate 2), written by scripts/reels_sfx_finals.ts. */
export type SfxFinalsReview = {
  generatedAt: string;
  fps: number;
  sampleRate: number;
  settings: DraftSettings;
  chart: { frames: number; windowsPerFrame: number };
  /** Loudness targets rendered for SFX-V2, dBFS RMS on the flickers. */
  targets: number[];
  /** Gate-edge fades rendered for SFX-V3, ms, on one timing at one target. */
  fades: number[];
  fadeTiming: HookTiming;
  fadeTarget: number;
  hooks: Array<{
    hook: Hook;
    source: string;
    byTarget: Record<string, Record<HookTiming, SfxReviewTiming>>;
    byFade: Record<string, SfxReviewTiming & { edgeClickDb: number }>;
  }>;
};

export function finalsObjectPaths(review: SfxFinalsReview): Set<string> {
  const out = new Set<string>();
  for (const hook of review.hooks) {
    for (const timings of Object.values(hook.byTarget)) {
      for (const timing of Object.values(timings)) out.add(timing.objectPath);
    }
    for (const fade of Object.values(hook.byFade)) out.add(fade.objectPath);
  }
  return out;
}
