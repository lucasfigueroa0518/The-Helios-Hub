import type { Wav } from '@/lib/reels/sfx/wav';

/**
 * Stage 1 of the hook sound plan: describe each source SFX without changing
 * it. The record drives the candidate proposals and the review page charts.
 *
 * Levels come from an RMS envelope in 10 ms windows, power-averaged across
 * channels. "Audible" is within 30 dB of the loudest window and a "burst" is
 * within 20 dB of it, the same cuts as the plan's first-pass table.
 */
export const ENVELOPE_WINDOW_MS = 10;
export const AUDIBLE_DB = 30;
export const BURST_DB = 20;
/** Digital silence is reported at this floor instead of -Infinity. */
export const FLOOR_DB = -120;

export type Span = { startMs: number; endMs: number };
export type Burst = Span & { peakDb: number };

export type SourceAnalysis = {
  file: string;
  sampleRate: number;
  bitDepth: number;
  channels: number;
  durationMs: number;
  /** Largest absolute sample, dBFS. Not oversampled, so not true peak. */
  samplePeakDb: number;
  /** Loudest 10 ms RMS window, dBFS. The reference for audible and bursts. */
  envelopePeakDb: number;
  /** First to last window within AUDIBLE_DB of the envelope peak. */
  audible: Span | null;
  /** RMS over the audible span, dBFS. */
  audibleRmsDb: number | null;
  /** Runs of consecutive windows within BURST_DB of the envelope peak. */
  bursts: Burst[];
  /** Start of each burst. */
  onsetsMs: number[];
  envelope: { windowMs: number; db: number[] };
};

export function toDb(amplitude: number): number {
  return amplitude > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(amplitude)) : FLOOR_DB;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Mean square per window across all channels. The last window may be short. */
export function meanSquares(wav: Wav, windowMs = ENVELOPE_WINDOW_MS): number[] {
  const length = wav.channels[0]?.length ?? 0;
  const size = Math.max(1, Math.round((wav.sampleRate * windowMs) / 1000));
  const out: number[] = [];
  for (let start = 0; start < length; start += size) {
    const end = Math.min(length, start + size);
    let sum = 0;
    for (const channel of wav.channels) {
      for (let i = start; i < end; i += 1) sum += channel[i] * channel[i];
    }
    out.push(sum / ((end - start) * wav.channels.length));
  }
  return out;
}

function runs(flags: boolean[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  flags.forEach((on, index) => {
    if (on && start < 0) start = index;
    if (!on && start >= 0) {
      out.push([start, index - 1]);
      start = -1;
    }
  });
  if (start >= 0) out.push([start, flags.length - 1]);
  return out;
}

export function analyzeSource(file: string, wav: Wav): SourceAnalysis {
  const length = wav.channels[0]?.length ?? 0;
  const durationMs = (length / wav.sampleRate) * 1000;
  let peak = 0;
  for (const channel of wav.channels) {
    for (let i = 0; i < channel.length; i += 1) peak = Math.max(peak, Math.abs(channel[i]));
  }

  const squares = meanSquares(wav);
  const db = squares.map((square) => toDb(Math.sqrt(square)));
  const envelopePeakDb = db.length ? Math.max(...db) : FLOOR_DB;
  const silent = envelopePeakDb <= FLOOR_DB;
  const windowEnd = (index: number) => Math.min(durationMs, (index + 1) * ENVELOPE_WINDOW_MS);

  const audibleIndexes = db.flatMap((value, index) => (!silent && value >= envelopePeakDb - AUDIBLE_DB ? [index] : []));
  const first = audibleIndexes[0];
  const last = audibleIndexes[audibleIndexes.length - 1];
  const audible = first == null || last == null ? null : { startMs: first * ENVELOPE_WINDOW_MS, endMs: round1(windowEnd(last)) };

  let audibleRmsDb: number | null = null;
  if (first != null && last != null) {
    // Weight each window by its sample count so a short last window counts less.
    const size = Math.round((wav.sampleRate * ENVELOPE_WINDOW_MS) / 1000);
    let sum = 0;
    let count = 0;
    for (let index = first; index <= last; index += 1) {
      const samples = Math.min(size, length - index * size);
      sum += squares[index] * samples;
      count += samples;
    }
    audibleRmsDb = round1(toDb(Math.sqrt(sum / count)));
  }

  const bursts = silent
    ? []
    : runs(db.map((value) => value >= envelopePeakDb - BURST_DB)).map(([start, end]) => ({
        startMs: start * ENVELOPE_WINDOW_MS,
        endMs: round1(windowEnd(end)),
        peakDb: round1(Math.max(...db.slice(start, end + 1))),
      }));

  return {
    file,
    sampleRate: wav.sampleRate,
    bitDepth: wav.bitDepth,
    channels: wav.channels.length,
    durationMs: round1(durationMs),
    samplePeakDb: round1(toDb(peak)),
    envelopePeakDb: round1(envelopePeakDb),
    audible,
    audibleRmsDb,
    bursts,
    onsetsMs: bursts.map((burst) => burst.startMs),
    envelope: { windowMs: ENVELOPE_WINDOW_MS, db: db.map(round1) },
  };
}
