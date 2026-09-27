import { toDb } from '@/lib/reels/sfx/analyze';
import { frameStartSample, type FrameMap } from '@/lib/reels/sfx/frame-map';
import type { Wav } from '@/lib/reels/sfx/wav';

/**
 * Stage 4 frame test (SFX-09). Checks one finished SFX against the frame map
 * the renderer uses:
 *   - every on-span has sound, and it arrives within the onset tolerance;
 *   - every off-span stays under the silence threshold;
 *   - nothing after the cushion end is over the silence threshold.
 * The tolerances are SFX-V4, set by Lucas from evidence.
 */
export type FrameTolerances = {
  /** Loudest sample allowed on off-frames and after the cushion, dBFS. */
  silenceDb: number;
  /** How late a flicker's sound may arrive after its first frame starts, ms. */
  onsetMs: number;
  /**
   * Skip this much at each edge of an off-span and at the start of the silence
   * after the cushion. 0 for the WAVs; the MP4's AAC smears a gate edge by a few ms.
   */
  edgeGuardMs?: number;
};

/** A flicker has "arrived" at the first 1 ms window within this many dB of that flicker's own RMS. */
export const ONSET_WITHIN_DB = 20;

export type FrameTestResult = {
  pass: boolean;
  failures: string[];
  onsetsMs: number[];
  spanRmsDb: number[];
  offPeakDb: number;
  afterCushionPeakDb: number;
};

function peak(wav: Wav, start: number, end: number): number {
  let out = 0;
  for (const channel of wav.channels) {
    for (let i = Math.max(0, start); i < end && i < channel.length; i += 1) out = Math.max(out, Math.abs(channel[i]));
  }
  return out;
}

function rms(wav: Wav, start: number, end: number): number {
  let sum = 0;
  let count = 0;
  for (const channel of wav.channels) {
    for (let i = Math.max(0, start); i < end && i < channel.length; i += 1) {
      sum += channel[i] * channel[i];
      count += 1;
    }
  }
  return count ? Math.sqrt(sum / count) : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function frameTest(wav: Wav, map: FrameMap, tolerances: FrameTolerances): FrameTestResult {
  const rate = wav.sampleRate;
  const at = (frame: number) => frameStartSample(frame, rate, map.fps);
  const windowSize = Math.round(rate / 1000);
  const guard = Math.round(((tolerances.edgeGuardMs ?? 0) * rate) / 1000);
  const failures: string[] = [];
  const onsetsMs: number[] = [];
  const spanRmsDb: number[] = [];

  map.on.forEach(([first, last], index) => {
    const start = at(first);
    const end = at(last + 1);
    const level = rms(wav, start, end);
    spanRmsDb.push(round2(toDb(level)));
    let onset = -1;
    for (let w = start; w + windowSize <= end; w += windowSize) {
      if (level > 0 && toDb(rms(wav, w, w + windowSize)) >= toDb(level) - ONSET_WITHIN_DB) {
        onset = w;
        break;
      }
    }
    if (onset < 0 || toDb(level) <= tolerances.silenceDb) {
      failures.push(`Flicker ${index + 1} (frames ${first}–${last}) has no sound.`);
      onsetsMs.push(Number.NaN);
      return;
    }
    const lateMs = ((onset - start) / rate) * 1000;
    onsetsMs.push(round2(lateMs));
    if (lateMs > tolerances.onsetMs) {
      failures.push(`Flicker ${index + 1} starts ${lateMs.toFixed(2)} ms late (allowed ${tolerances.onsetMs} ms).`);
    }
  });

  let offPeak = 0;
  for (const [first, last] of map.off) {
    const value = peak(wav, at(first) + guard, at(last + 1) - guard);
    offPeak = Math.max(offPeak, value);
    if (toDb(value) > tolerances.silenceDb) {
      failures.push(`Off-frames ${first}–${last} peak at ${toDb(value).toFixed(1)} dBFS (allowed ${tolerances.silenceDb}).`);
    }
  }

  const length = wav.channels[0]?.length ?? 0;
  const after = peak(wav, at(map.silentFromFrame) + guard, length);
  if (toDb(after) > tolerances.silenceDb) {
    failures.push(`Sound after the cushion (frame ${map.silentFromFrame} on) peaks at ${toDb(after).toFixed(1)} dBFS.`);
  }

  return {
    pass: failures.length === 0,
    failures,
    onsetsMs,
    spanRmsDb,
    offPeakDb: round2(toDb(offPeak)),
    afterCushionPeakDb: round2(toDb(after)),
  };
}
