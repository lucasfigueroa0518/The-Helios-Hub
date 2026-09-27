import { HOOK_TIMINGS, timingOnRanges, timingSpanFrames, type HookTiming } from '@/lib/reels/visual/hook';

/** Reel clips are 24 fps (probed from real Kling output). Finished SFX are built for this rate only (D-123). */
export const SFX_FPS = 24;
/** 48 kHz gives exactly 2,000 samples per frame at 24 fps (D-125). */
export const SFX_SAMPLE_RATE = 48_000;
/** The sound may run up to this many frames past the last on-frame (SFX-05). */
export const CUSHION_FRAMES = 2;

export type FrameMap = {
  timing: HookTiming;
  fps: number;
  /** Inclusive frame ranges where the hook is on. */
  on: Array<[number, number]>;
  /** Inclusive frame ranges where the hook is off, between on-spans. */
  off: Array<[number, number]>;
  lastOnFrame: number;
  /** Last frame the cushion may reach, inclusive. */
  cushionEndFrame: number;
  /** First frame that must be silent. */
  silentFromFrame: number;
};

/** Built from the renderer's own rounding, never hardcoded. */
export function frameMap(timing: HookTiming, fps = SFX_FPS): FrameMap {
  const on = timingOnRanges(timing, fps);
  const off: Array<[number, number]> = [];
  let cursor = 0;
  timingSpanFrames(timing, fps).forEach((count, index) => {
    if (index % 2 === 1 && count > 0) off.push([cursor, cursor + count - 1]);
    cursor += count;
  });
  const lastOnFrame = on[on.length - 1]?.[1] ?? 0;
  return {
    timing,
    fps,
    on,
    off,
    lastOnFrame,
    cushionEndFrame: lastOnFrame + CUSHION_FRAMES,
    silentFromFrame: lastOnFrame + CUSHION_FRAMES + 1,
  };
}

export function samplesPerFrame(sampleRate = SFX_SAMPLE_RATE, fps = SFX_FPS): number {
  return sampleRate / fps;
}

/** Sample index where frame `frame` starts. Exact when the rate divides evenly. */
export function frameStartSample(frame: number, sampleRate = SFX_SAMPLE_RATE, fps = SFX_FPS): number {
  return Math.round(frame * samplesPerFrame(sampleRate, fps));
}

export const SFX_TIMINGS = Object.keys(HOOK_TIMINGS) as HookTiming[];
