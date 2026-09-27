import { toDb } from '@/lib/reels/sfx/analyze';
import { frameStartSample, samplesPerFrame, type FrameMap } from '@/lib/reels/sfx/frame-map';
import { limitToCeiling, type LimiterSettings, type LimiterStats } from '@/lib/reels/sfx/limiter';
import { truePeak } from '@/lib/reels/sfx/true-peak';

/**
 * Stage 2 drafts. One source, one timing: trim to the best start, gate it to
 * the on-frames (SFX-01), let the last flicker ring into the cushion (SFX-05),
 * and set one gain (SFX-04). Every value here is a draft setting that Lucas
 * confirms or replaces at the review gates (SFX-V2, SFX-V3).
 */
export type DraftSettings = {
  /** Raised-cosine fade at each gate edge, inside the on-span. Finals use 3 ms (D-132). */
  edgeFadeMs: number;
  /** How far into the cushion the last flicker rings before reaching zero. At most 2 frames. */
  cushionFrames: number;
  /** RMS over the on-frames only (D-126). Finals use -20 (D-131). */
  targetRmsDb: number;
  /** True-peak ceiling (D-126). Stage 2 drafts used sample peak here. */
  peakCeilingDb: number;
  /** Step between trim offsets the search tries. */
  offsetStepMs: number;
  /** Stage 3 limits peaks so every file can reach the target (D-130). Null is gain only (Stage 2). */
  limiter?: LimiterSettings | null;
};

export const DRAFT_SETTINGS: DraftSettings = {
  edgeFadeMs: 3,
  cushionFrames: 2,
  targetRmsDb: -18,
  peakCeilingDb: -1,
  offsetStepMs: 5,
};

/** Chart windows are an eighth of a frame, so the frame grid lines up exactly. */
export const CHART_WINDOWS_PER_FRAME = 8;
export const CHART_FRAMES = 18;

export type DraftMetrics = {
  gainDb: number;
  /** The peak ceiling, not the RMS target, set the gain. */
  ceilingBound: boolean;
  onRmsDb: number;
  /** RMS of each on-span after gain. */
  spanRmsDb: number[];
  /** Largest sample in each off-span after gain. Gating makes these digital silence. */
  offPeakDb: number[];
  /** Largest sample in the cushion frames. */
  cushionPeakDb: number;
  peakDb: number;
  truePeakDb: number;
  /** Present when the limiter ran. */
  limiter?: LimiterStats;
};

export type Draft = {
  channels: Float32Array[];
  offsetSamples: number;
  metrics: DraftMetrics;
  /** RMS per chart window from frame 0 to CHART_FRAMES, dBFS. */
  envelopeDb: number[];
};

function mono(channels: Float32Array[]): Float32Array {
  const length = channels[0]?.length ?? 0;
  const out = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i += 1) out[i] += (channel[i] * channel[i]) / channels.length;
  }
  return out;
}

/** Power prefix sums, so any span's mean square is O(1). */
function powerPrefix(channels: Float32Array[]): Float64Array {
  const power = mono(channels);
  const prefix = new Float64Array(power.length + 1);
  for (let i = 0; i < power.length; i += 1) prefix[i + 1] = prefix[i] + power[i];
  return prefix;
}

function spanSamples(map: FrameMap, [start, end]: [number, number], sampleRate: number): [number, number] {
  return [frameStartSample(start, sampleRate, map.fps), frameStartSample(end + 1, sampleRate, map.fps)];
}

/** Samples the draft needs: frame 0 through the end of the cushion. */
export function draftLength(map: FrameMap, sampleRate: number): number {
  return frameStartSample(map.silentFromFrame, sampleRate, map.fps);
}

/**
 * The trim offset whose quietest on-span is loudest, so no flicker lands in a
 * gap between the source's bursts. Ties go to the earliest start.
 */
export function pickOffset(
  channels: Float32Array[],
  map: FrameMap,
  sampleRate: number,
  range: { fromSample: number; toSample: number },
  stepMs = DRAFT_SETTINGS.offsetStepMs,
): number {
  const prefix = powerPrefix(channels);
  const length = channels[0]?.length ?? 0;
  const need = draftLength(map, sampleRate);
  const step = Math.max(1, Math.round((sampleRate * stepMs) / 1000));
  const spans = map.on.map((span) => spanSamples(map, span, sampleRate));
  const last = Math.max(range.fromSample, Math.min(range.toSample, length - need));
  let best = range.fromSample;
  let bestScore = -Infinity;
  for (let offset = range.fromSample; offset <= last; offset += step) {
    let quietest = Infinity;
    for (const [start, end] of spans) {
      const a = Math.min(length, offset + start);
      const b = Math.min(length, offset + end);
      quietest = Math.min(quietest, b > a ? (prefix[b] - prefix[a]) / (end - start) : 0);
    }
    if (quietest > bestScore) {
      bestScore = quietest;
      best = offset;
    }
  }
  return best;
}

function raisedCosine(x: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x)));
}

/** Gate weight for every output sample, before gain. */
export function gateCurve(map: FrameMap, sampleRate: number, settings: DraftSettings): Float32Array {
  const curve = new Float32Array(draftLength(map, sampleRate));
  const fade = Math.max(1, Math.round((sampleRate * settings.edgeFadeMs) / 1000));
  map.on.forEach((span, index) => {
    const [start, end] = spanSamples(map, span, sampleRate);
    const isLast = index === map.on.length - 1;
    for (let i = start; i < end; i += 1) {
      const fadeIn = raisedCosine((i - start + 1) / fade);
      const fadeOut = isLast ? 1 : raisedCosine((end - i) / fade);
      curve[i] = Math.min(fadeIn, fadeOut);
    }
    if (isLast) {
      const cushion = Math.round(Math.min(2, Math.max(0, settings.cushionFrames)) * samplesPerFrame(sampleRate, map.fps));
      for (let i = 0; i < cushion && end + i < curve.length; i += 1) curve[end + i] = raisedCosine(1 - (i + 1) / cushion);
    }
  });
  return curve;
}

function peakOf(channels: Float32Array[], start: number, end: number): number {
  let peak = 0;
  for (const channel of channels) {
    for (let i = start; i < end && i < channel.length; i += 1) peak = Math.max(peak, Math.abs(channel[i]));
  }
  return peak;
}

function rmsOf(channels: Float32Array[], spans: Array<[number, number]>): number {
  let sum = 0;
  let count = 0;
  for (const channel of channels) {
    for (const [start, end] of spans) {
      for (let i = start; i < end && i < channel.length; i += 1) sum += channel[i] * channel[i];
      count += end - start;
    }
  }
  return count ? Math.sqrt(sum / count) : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function envelopeDb(channels: Float32Array[], sampleRate: number, fps: number, frames = CHART_FRAMES): number[] {
  const window = samplesPerFrame(sampleRate, fps) / CHART_WINDOWS_PER_FRAME;
  const out: number[] = [];
  for (let index = 0; index < frames * CHART_WINDOWS_PER_FRAME; index += 1) {
    const start = Math.round(index * window);
    const end = Math.round((index + 1) * window);
    out.push(round1(toDb(rmsOf(channels, [[start, end]]))));
  }
  return out;
}

export function buildDraft(
  source: Float32Array[],
  map: FrameMap,
  sampleRate: number,
  offsetSamples: number,
  settings: DraftSettings = DRAFT_SETTINGS,
): Draft {
  const curve = gateCurve(map, sampleRate, settings);
  const gated = source.map((channel) => {
    const out = new Float32Array(curve.length);
    for (let i = 0; i < curve.length; i += 1) {
      const at = offsetSamples + i;
      out[i] = at < channel.length ? channel[at] * curve[i] : 0;
    }
    return out;
  });

  const onSpans = map.on.map((span) => spanSamples(map, span, sampleRate));
  const onRms = rmsOf(gated, onSpans);
  const byTarget = settings.targetRmsDb - toDb(onRms);
  let byCeiling = Infinity;
  let gainDb = 0;
  let out: Float32Array[] = gated;
  let limiterStats: LimiterStats | undefined;
  if (onRms > 0 && settings.limiter) {
    // Gain up to the target, limit, and repeat: the limiter takes some level
    // back, so a few rounds converge on the target with the peaks held.
    gainDb = byTarget;
    for (let round = 0; round < 4; round += 1) {
      const gain = 10 ** (gainDb / 20);
      const limited = limitToCeiling(
        gated.map((channel) => channel.map((sample) => sample * gain)),
        settings.peakCeilingDb,
        sampleRate,
        settings.limiter,
      );
      out = limited.channels;
      limiterStats = limited.stats;
      const miss = settings.targetRmsDb - toDb(rmsOf(out, onSpans));
      if (Math.abs(miss) < 0.05) break;
      gainDb += miss;
    }
  } else if (onRms > 0) {
    byCeiling = settings.peakCeilingDb - toDb(truePeak(gated));
    gainDb = Math.min(byTarget, byCeiling);
    const gain = 10 ** (gainDb / 20);
    out = gated.map((channel) => channel.map((sample) => sample * gain));
  }

  const lastEnd = onSpans[onSpans.length - 1]?.[1] ?? 0;
  return {
    channels: out,
    offsetSamples,
    metrics: {
      gainDb: round1(gainDb),
      ceilingBound: byCeiling < byTarget,
      onRmsDb: round1(toDb(rmsOf(out, onSpans))),
      spanRmsDb: onSpans.map((span) => round1(toDb(rmsOf(out, [span])))),
      offPeakDb: map.off.map((span) => {
        const [start, end] = spanSamples(map, span, sampleRate);
        return round1(toDb(peakOf(out, start, end)));
      }),
      cushionPeakDb: round1(toDb(peakOf(out, lastEnd, curve.length))),
      peakDb: round1(toDb(peakOf(out, 0, curve.length))),
      truePeakDb: round1(toDb(truePeak(out))),
      ...(limiterStats ? { limiter: limiterStats } : {}),
    },
    envelopeDb: envelopeDb(out, sampleRate, map.fps),
  };
}

/**
 * Click evidence for SFX-V3. At each gate edge, the high-frequency energy (RMS
 * of the first difference) in ±1 ms around the edge, relative to the same
 * measure inside the neighboring on-span. Above 0 dB the edge is brighter than
 * the sound itself, which is a click; well below 0 the fade has softened the attack.
 */
export function edgeClickDb(channels: Float32Array[], map: FrameMap, sampleRate: number): number {
  const half = Math.round(sampleRate / 1000);
  const guard = 2 * half;
  const diffRms = (start: number, end: number) => {
    let sum = 0;
    let count = 0;
    for (const channel of channels) {
      for (let i = Math.max(1, start); i < end && i < channel.length; i += 1) {
        const d = channel[i] - channel[i - 1];
        sum += d * d;
        count += 1;
      }
    }
    return count ? Math.sqrt(sum / count) : 0;
  };
  let worst = -Infinity;
  map.on.forEach((span, index) => {
    const [start, end] = spanSamples(map, span, sampleRate);
    const inside = diffRms(start + guard, end - guard);
    if (inside <= 0) return;
    const edges = index === map.on.length - 1 ? [start] : [start, end];
    for (const edge of edges) worst = Math.max(worst, toDb(diffRms(edge - half, edge + half) / inside));
  });
  return Number.isFinite(worst) ? round1(worst) : 0;
}
