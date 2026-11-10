/**
 * AI Trivia beat grid (M2, AT-27): where the music's beats fall, so the reveal can land on one.
 * Pure code, no Python: a three-band energy-flux onset envelope, the tempo from its autocorrelation
 * (weighted towards 110 BPM, one octave wide), then period and phase refined together by a comb over
 * the whole envelope. Library music keeps a steady tempo, so one straight grid is enough; the beat the
 * reveal uses is nudged to the onset peak within a frame of it.
 */

export const HOP = 512;
const WIN = 1024;
export const MIN_BPM = 70;
export const MAX_BPM = 170;
const PRIOR_BPM = 110;

export type OnsetEnvelope = { env: Float32Array; fps: number };
export type BeatGrid = { bpm: number; beatsMs: number[]; durationMs: number };

/** One-pole low-pass of `x` at `hz`. */
function lowpass(x: Float32Array, rate: number, hz: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * hz) / rate);
  const out = new Float32Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y = (1 - a) * x[i]! + a * y;
    out[i] = y;
  }
  return out;
}

/** Positive log-energy change per hop, summed over low (<180 Hz), mid and high (>2.5 kHz) bands, with the local mean removed. */
export function onsetEnvelope(pcm: Float32Array, rate: number): OnsetEnvelope {
  const low = lowpass(pcm, rate, 180);
  const belowHigh = lowpass(pcm, rate, 2500);
  const n = Math.max(0, Math.floor((pcm.length - WIN) / HOP) + 1);
  const bands = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  for (let f = 0; f < n; f++) {
    let el = 0, em = 0, eh = 0;
    const s = f * HOP;
    for (let i = s; i < s + WIN; i++) {
      const l = low[i]!, b = belowHigh[i]!, x = pcm[i]!;
      el += l * l;
      em += (b - l) * (b - l);
      eh += (x - b) * (x - b);
    }
    bands[0]![f] = Math.log(1e-10 + el / WIN);
    bands[1]![f] = Math.log(1e-10 + em / WIN);
    bands[2]![f] = Math.log(1e-10 + eh / WIN);
  }
  const flux = new Float64Array(n);
  for (const b of bands) for (let f = 1; f < n; f++) flux[f]! += Math.max(0, b[f]! - b[f - 1]!);
  // Remove the local mean (about half a second) so loud passages don't dominate.
  const fps = rate / HOP;
  const half = Math.max(1, Math.round(fps * 0.25));
  const env = new Float32Array(n);
  const pre = new Float64Array(n + 1);
  for (let f = 0; f < n; f++) pre[f + 1] = pre[f]! + flux[f]!;
  let max = 0;
  for (let f = 0; f < n; f++) {
    const a = Math.max(0, f - half), b = Math.min(n, f + half + 1);
    const mean = (pre[b]! - pre[a]!) / (b - a);
    const v = Math.max(0, flux[f]! - mean);
    env[f] = v;
    if (v > max) max = v;
  }
  if (max > 0) for (let f = 0; f < n; f++) env[f] = env[f]! / max;
  return { env, fps };
}

/** The envelope at a fractional frame (linear interpolation; 0 outside). */
function at(env: Float32Array, x: number): number {
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= env.length) return 0;
  const t = x - i;
  return env[i]! * (1 - t) + env[i + 1]! * t;
}

/** Comb score of a straight grid: the mean envelope on its beats. */
function comb(env: Float32Array, period: number, phase: number): number {
  let s = 0, k = 0;
  for (let x = phase; x < env.length - 1; x += period, k++) s += at(env, x);
  return k ? s / k : 0;
}

/** The tempo period in frames: autocorrelation weighted by a log-normal prior, refined by a parabola. */
export function tempoPeriod(env: Float32Array, fps: number): number {
  const minLag = Math.floor((60 * fps) / MAX_BPM);
  const maxLag = Math.ceil((60 * fps) / MIN_BPM);
  const r: number[] = [];
  for (let lag = 0; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < env.length; i++) s += env[i]! * env[i + lag]!;
    r.push(s / Math.max(1, env.length - lag));
  }
  let best = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const w = Math.exp(-0.5 * Math.log2(bpm / PRIOR_BPM) ** 2);
    const score = r[lag]! * w;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  const y0 = r[best - 1] ?? r[best]!, y1 = r[best]!, y2 = r[best + 1] ?? r[best]!;
  const d = y0 - 2 * y1 + y2;
  return d < 0 ? best + (0.5 * (y0 - y2)) / d : best;
}

/** Period and phase refined together: ±1.5% around the estimate, phase in quarter frames. */
export function refineGrid(env: Float32Array, period: number): { period: number; phase: number } {
  let best = { period, phase: 0, score: -Infinity };
  for (let p = period * 0.985; p <= period * 1.015; p += period * 0.0005) {
    for (let ph = 0; ph < p; ph += 0.25) {
      const s = comb(env, p, ph);
      if (s > best.score) best = { period: p, phase: ph, score: s };
    }
  }
  return { period: best.period, phase: best.phase };
}

/** The beat grid of mono PCM at `rate` Hz: BPM and every beat in ms. */
export function beatGrid(pcm: Float32Array, rate: number): BeatGrid {
  const durationMs = (pcm.length / rate) * 1000;
  const { env, fps } = onsetEnvelope(pcm, rate);
  if (env.length < fps * 4) throw new Error('track too short for a beat grid');
  const { period, phase } = refineGrid(env, tempoPeriod(env, fps));
  const beatsMs: number[] = [];
  // A hop's energy describes the window it starts; its centre is half a window later.
  const offset = (WIN / 2 / rate) * 1000;
  for (let x = phase; x < env.length; x += period) beatsMs.push(Math.round(((x / fps) * 1000 + offset) * 10) / 10);
  return { bpm: Math.round(((60 * fps) / period) * 10) / 10, beatsMs, durationMs };
}

/** The onset peak within ±`maxMs` of `beatMs` (the beat itself when nothing stands out). */
export function snapBeat(pcm: Float32Array, rate: number, beatMs: number, maxMs = 25): number {
  const from = Math.max(0, Math.floor(((beatMs - maxMs - 200) / 1000) * rate));
  const to = Math.min(pcm.length, Math.ceil(((beatMs + maxMs + 200) / 1000) * rate));
  if (to - from < WIN * 4) return beatMs;
  const { env, fps } = onsetEnvelope(pcm.subarray(from, to), rate);
  const offset = (WIN / 2 / rate) * 1000;
  const base = (from / rate) * 1000;
  let best = beatMs, bestV = 0;
  for (let f = 0; f < env.length; f++) {
    const ms = base + (f / fps) * 1000 + offset;
    if (Math.abs(ms - beatMs) > maxMs) continue;
    if (env[f]! > bestV * 1.0001) {
      bestV = env[f]!;
      best = ms;
    }
  }
  return bestV > 0.5 ? Math.round(best * 10) / 10 : beatMs;
}
