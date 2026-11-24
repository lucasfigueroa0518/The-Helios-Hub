// Acoustic measurements of one sound file, with ffmpeg and plain arithmetic (no model, no network).
// Used by ingest-inbox.mjs (drop-in sounds) and its --library mode (acoustics.json for the bank).
//
//   duration (s), peakDb and meanDb (dBFS, RMS), onset (s of leading silence), attack (ms from
//   onset to the loudest 10 ms), decay (s from the loudest point until 20 dB down), centroid (Hz,
//   spectral brightness), body (share of the sound within 20 dB of its loudest point: high for a
//   continuous bed, low for a one-shot) and fp (an envelope fingerprint for spotting duplicates).

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const SR = 22050;
const N = 1024; // FFT size

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -120);
const r1 = (n) => Math.round(n * 10) / 10;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** Decode `file` to mono float samples at SR, or null if ffmpeg cannot read it. */
export function decode(file, ffmpeg = 'ffmpeg', { timeout = 120_000 } = {}) {
  const r = spawnSync(ffmpeg, ['-nostdin', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 512 * 1024 * 1024, timeout });
  if (r.error || r.status !== 0 || !r.stdout?.length) return null;
  const buf = r.stdout;
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

/** cos/sin of 2πk/N for k < N/2: every stage's twiddles are every (N/len)-th of these. */
const COS = Float64Array.from({ length: N / 2 }, (_, k) => Math.cos((-2 * Math.PI * k) / N));
const SIN = Float64Array.from({ length: N / 2 }, (_, k) => Math.sin((-2 * Math.PI * k) / N));

/** In-place radix-2 FFT magnitude of `frame` (length N, a power of two). */
function magnitudes(frame) {
  const re = Float64Array.from(frame);
  const im = new Float64Array(re.length);
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len / 2;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = COS[k * step];
        const wi = SIN[k * step];
        const xr = re[i + k + half] * wr - im[i + k + half] * wi;
        const xi = re[i + k + half] * wi + im[i + k + half] * wr;
        re[i + k + half] = re[i + k] - xr;
        im[i + k + half] = im[i + k] - xi;
        re[i + k] += xr;
        im[i + k] += xi;
      }
    }
  }
  const out = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) out[k] = Math.hypot(re[k], im[k]);
  return out;
}

/** Measurements of decoded mono samples at `sr` Hz (see the header). */
export function analyze(samples, sr = SR) {
  const HOP = Math.round(sr * 0.01); // 10 ms
  const n = samples.length;
  if (!n) return null;
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    if (a >= 0.999) clipped++;
    sum += samples[i] * samples[i];
  }
  const env = [];
  for (let i = 0; i < n; i += HOP) {
    let s = 0;
    const end = Math.min(n, i + HOP);
    for (let j = i; j < end; j++) s += samples[j] * samples[j];
    env.push(Math.sqrt(s / Math.max(1, end - i)));
  }
  const envDb = env.map(db);
  const maxAt = envDb.indexOf(Math.max(...envDb));
  const top = envDb[maxAt];
  const onsetAt = Math.max(0, envDb.findIndex((v) => v > top - 30));
  let decayAt = maxAt;
  while (decayAt < envDb.length - 1 && envDb[decayAt] > top - 20) decayAt++;
  const body = envDb.filter((v) => v > top - 20).length / envDb.length;

  // Brightness: the spectral centroid over the frames within 20 dB of the loudest.
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  let num = 0;
  let den = 0;
  const frames = [];
  for (let i = 0; i < n; i += N / 2) {
    const frame = new Float64Array(N); // zero-padded past the end
    let e = 0;
    for (let j = 0; j < N && i + j < n; j++) {
      frame[j] = samples[i + j] * win[j];
      e += frame[j] * frame[j];
    }
    frames.push({ frame, e });
  }
  const loudest = Math.max(...frames.map((f) => f.e));
  for (const { frame, e } of frames) {
    if (!(e > 0) || e < loudest / 100) continue; // within 20 dB of the loudest frame
    const mag = magnitudes(frame);
    for (let k = 1; k < mag.length; k++) {
      num += ((k * sr) / N) * mag[k];
      den += mag[k];
    }
  }
  const fp = createHash('sha1')
    .update(`${Math.round(n / HOP)}:${envDb.map((v) => Math.round(Math.max(-60, v - top) / 3)).join(',')}`)
    .digest('hex')
    .slice(0, 16);
  return {
    duration: r3(n / sr),
    peakDb: r1(db(peak)),
    meanDb: r1(db(Math.sqrt(sum / n))),
    onset: r3((onsetAt * HOP) / sr),
    attack: Math.round(((maxAt - onsetAt) * HOP * 1000) / sr),
    decay: r3(((decayAt - maxAt) * HOP) / sr),
    centroid: den > 0 ? Math.round(num / den) : 0,
    body: Math.round(body * 100) / 100,
    clipped: Math.round((clipped / n) * 1000) / 1000,
    fp,
  };
}

/** The drop-in rate: a file is decoded once, to this, for both its measurements and its MP3. */
export const OUT_SR = 48000;

/**
 * Decode `file` once to interleaved stereo float samples at OUT_SR (at most `maxSeconds`: a longer
 * file is rejected anyway, and never fills memory), or null when ffmpeg cannot read it.
 */
export function decodeStereo(file, ffmpeg = 'ffmpeg', { maxSeconds = 61, timeout = 120_000 } = {}) {
  const r = spawnSync(ffmpeg, ['-nostdin', '-v', 'error', '-t', String(maxSeconds), '-i', file, '-vn', '-ac', '2', '-ar', String(OUT_SR), '-f', 'f32le', '-'], { maxBuffer: 1024 * 1024 * 1024, timeout });
  if (r.error || r.status !== 0 || !r.stdout?.length) return null;
  const buf = r.stdout;
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 8) * 2);
}

/** Measurements of interleaved stereo at OUT_SR: mixed to mono and halved to OUT_SR / 2 for the analysis. */
export function analyzeStereo(stereo) {
  const n = Math.floor(stereo.length / 4);
  const mono = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) mono[i] = (stereo[j] + stereo[j + 1] + stereo[j + 2] + stereo[j + 3]) / 4;
  return analyze(mono, OUT_SR / 2);
}

/** Measure one file, or null when it cannot be decoded. */
export function measure(file, ffmpeg = 'ffmpeg') {
  const s = decode(file, ffmpeg);
  return s ? analyze(s) : null;
}
