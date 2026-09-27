import { toDb } from '@/lib/reels/sfx/analyze';
import { truePeak } from '@/lib/reels/sfx/true-peak';

/**
 * Offline lookahead peak limiter (D-130). Stereo-linked, so the image does
 * not shift. The gain curve is a moving minimum over the lookahead, box
 * averaged over the same length: that guarantees the gain has fully reached
 * each peak's required reduction by the time the peak arrives, with a smooth
 * ramp instead of a step. Recovery is a one-pole release. Gain never rises
 * above 1, and silence stays silence.
 */
export type LimiterSettings = {
  lookaheadMs: number;
  releaseMs: number;
};

export const LIMITER_SETTINGS: LimiterSettings = { lookaheadMs: 1.5, releaseMs: 40 };

export type LimiterStats = {
  /** Largest gain reduction applied, dB (positive). */
  maxReductionDb: number;
  /** Share of samples reduced by more than 0.1 dB. */
  limitedShare: number;
};

function gainCurve(channels: Float32Array[], threshold: number, sampleRate: number, settings: LimiterSettings): Float64Array {
  const length = channels[0]?.length ?? 0;
  const look = Math.max(1, Math.round((sampleRate * settings.lookaheadMs) / 1000));
  const required = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    let peak = 0;
    for (const channel of channels) peak = Math.max(peak, Math.abs(channel[i]));
    required[i] = peak > threshold ? threshold / peak : 1;
  }
  // Moving minimum over [i, i + look].
  const floor = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    let min = 1;
    for (let k = i; k <= i + look && k < length; k += 1) min = Math.min(min, required[k]);
    floor[i] = min;
  }
  // Box average over [i - look, i]; out-of-range samples count as 1.
  const gain = new Float64Array(length);
  const release = 1 - Math.exp(-1000 / (sampleRate * settings.releaseMs));
  let previous = 1;
  let sum = look + 1;
  for (let i = 0; i < length; i += 1) {
    sum += floor[i] - (i - look - 1 >= 0 ? floor[i - look - 1] : 1);
    const boxed = sum / (look + 1);
    const next = Math.min(boxed, previous + (1 - previous) * release);
    gain[i] = next;
    previous = next;
  }
  return gain;
}

/** Limit `channels` so the true peak is at or under `ceilingDb`. Returns new arrays. */
export function limitToCeiling(
  channels: Float32Array[],
  ceilingDb: number,
  sampleRate: number,
  settings: LimiterSettings = LIMITER_SETTINGS,
): { channels: Float32Array[]; stats: LimiterStats } {
  const ceiling = 10 ** (ceilingDb / 20);
  // Start a little under the ceiling for inter-sample overs, and tighten until the true peak fits.
  let threshold = ceiling * 10 ** (-0.3 / 20);
  let out: Float32Array[] = channels;
  let gain: Float64Array = new Float64Array(channels[0]?.length ?? 0).fill(1);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    gain = gainCurve(channels, threshold, sampleRate, settings);
    out = channels.map((channel) => channel.map((sample, i) => sample * gain[i]));
    const peak = truePeak(out);
    if (peak <= ceiling * 1.0001) break;
    threshold *= ceiling / peak;
  }
  let min = 1;
  let limited = 0;
  for (const value of gain) {
    min = Math.min(min, value);
    if (value < 10 ** (-0.1 / 20)) limited += 1;
  }
  return {
    channels: out,
    stats: {
      maxReductionDb: Math.round(-toDb(min) * 10) / 10,
      limitedShare: gain.length ? limited / gain.length : 0,
    },
  };
}
