// Synthesizes the "Are you smarter than AI?" show sound (AT-46/47): the 120 BPM theme, the countdown
// clock (tick on each second, tock on the half, beeps on 3-2-1) for the 10 s question clip, and the drumroll
// reveal for the 5 s answer clip (hit at +0.5 s, beat 21). Usage: node scripts/trivia_show_sound.cjs <outDir>
// writes 24-theme-120bpm-bed and 25-preview-mix-10s-countdown (.wav kept next to this script, .mp3 to outDir).
// lib/stories/trivia/render/assets/show-master.flac is 25 trimmed to 15.0 s and loudnormed to -12.6 LUFS (AT-40).
// Gameshow sound options for "Are you smarter than AI?" — synthesized locally, no samples, no paid calls.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const SR = 48000, OUT = process.argv[2], WORK = __dirname;
const N = (s) => Math.round(s * SR), mk = (s) => new Float32Array(N(s));
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const noise = () => rnd() * 2 - 1;
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
function add(dst, src, at = 0, g = 1) { const o = N(at); for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * g; }
function biquad(x, type, f, q = 0.707) {
  const w = 2 * Math.PI * f / SR, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q); let b0, b1, b2;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
  else { b0 = a; b1 = 0; b2 = -a; }
  const a0 = 1 + a, a1 = -2 * c, a2 = 1 - a, y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
function svfLP(x, fcFn, damp = 0.9) { const y = new Float32Array(x.length); let low = 0, band = 0;
  for (let i = 0; i < x.length; i++) { const fc = Math.min(fcFn(i / SR), 7000), f = 2 * Math.sin(Math.PI * fc / SR); low += f * band; const high = x[i] - low - damp * band; band += f * high; y[i] = low; } return y; }
function tone(dur, freqFn, partials, envFn) {
  const y = mk(dur), ph = partials.map(() => 0);
  for (let i = 0; i < y.length; i++) { const t = i / SR, f = freqFn(t); let v = 0;
    for (let k = 0; k < partials.length; k++) { const p = partials[k]; if (f * p[0] > 18000) continue; ph[k] += 2 * Math.PI * f * p[0] / SR; v += Math.sin(ph[k]) * p[1] * (p[2] ? Math.exp(-t * p[2]) : 1); }
    y[i] = v * envFn(t); }
  return y;
}
const expEnv = (a, d) => (t) => (t < a ? t / a : Math.exp(-(t - a) / d));
const adsr = (a, d, s, r, len) => (t) => t < a ? t / a : t < a + d ? 1 - (1 - s) * (t - a) / d : t < len ? s : Math.max(0, s * (1 - (t - len) / r));
const SAW = Array.from({ length: 30 }, (_, n) => [n + 1, 1 / (n + 1)]);
const SQR = Array.from({ length: 15 }, (_, n) => [2 * n + 1, 1 / (2 * n + 1)]);
const noiseBurst = (dur, decay, a = 0.0005) => { const y = mk(dur); for (let i = 0; i < y.length; i++) { const t = i / SR; y[i] = noise() * (t < a ? t / a : Math.exp(-(t - a) / decay)); } return y; };
function reverb(x, fb = 0.84, damp = 0.3) {
  const make = (off) => { const combs = [1557, 1617, 1491, 1422, 1277, 1356].map((d) => Math.round((d + off) * SR / 44100)); let out = new Float32Array(x.length);
    for (const d of combs) { const buf = new Float32Array(d); let idx = 0, lp = 0; for (let i = 0; i < x.length; i++) { const o = buf[idx]; lp = o * (1 - damp) + lp * damp; buf[idx] = x[i] + lp * fb; idx = (idx + 1) % d; out[i] += o / combs.length; } }
    for (const d0 of [556, 441, 341, 225]) { const d = Math.round((d0 + off) * SR / 44100), buf = new Float32Array(d); let idx = 0; const z = new Float32Array(out.length);
      for (let i = 0; i < out.length; i++) { const b = buf[idx]; z[i] = -out[i] * 0.5 + b; buf[idx] = out[i] + b * 0.5; idx = (idx + 1) % d; } out = z; }
    return out; };
  return [make(0), make(23)];
}
// ---- instruments
const bell = (f, dur = 1.8, g = 1) => { const y = tone(dur, () => f, [[1, 1, 2.0], [2, 0.32, 4], [3, 0.16, 6.5], [4.07, 0.1, 9], [0.5, 0.08, 3]], expEnv(0.002, 30));
  add(y, biquad(noiseBurst(0.01, 0.002), 'hp', 6000), 0, 0.25); return y.map((v) => v * g); };
const kick = (dur = 0.6, f0 = 130, f1 = 45, d = 0.2) => tone(dur, (t) => f1 + (f0 - f1) * Math.exp(-t / 0.035), [[1, 1]], expEnv(0.002, d));
function snare(g = 1) { const y = mk(0.14); add(y, biquad(biquad(noiseBurst(0.14, 0.035), 'hp', 900), 'lp', 7000), 0, 0.8 * g); add(y, tone(0.14, () => 190, [[1, 1], [1.5, 0.4]], expEnv(0.001, 0.03)), 0, 0.5 * g); return y; }
const crash = (dur = 2.6) => biquad(biquad(noiseBurst(dur, 0.75, 0.003), 'hp', 3500), 'lp', 12000);
const hat = (d = 0.025) => biquad(noiseBurst(0.12, d), 'hp', 7000);
const clap = () => { const y = mk(0.2); for (const o of [0, 0.011, 0.022]) add(y, biquad(noiseBurst(0.18, o === 0.022 ? 0.05 : 0.006), 'bp', 1400, 1.2), o, 1); return y; };
function brass(f, dur, hold) { const v = (det) => svfLP(tone(dur, (t) => f * det * (1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t / 0.3)), SAW, adsr(0.025, 0.12, 0.8, 0.25, hold)),
  (t) => 900 + 3800 * Math.min(1, t / 0.05) * Math.exp(-t / 0.45) + 900); const y = v(1); add(y, v(1.004), 0, 0.8); return y; }
const woodTick = (f = 1900) => { const y = tone(0.05, () => f, [[1, 1], [2.3, 0.3]], expEnv(0.0004, 0.007)); add(y, biquad(noiseBurst(0.01, 0.0015), 'hp', 3000), 0, 0.5); return y; };
const blip = (f, dur = 0.05) => biquad(tone(dur, () => f, SQR, adsr(0.002, 0.01, 0.7, 0.01, dur - 0.012)), 'lp', 5000);
const organ = (f, dur) => tone(dur, () => f, [[1, 1], [2, 0.6], [3, 0.35], [4, 0.25], [6, 0.12], [8, 0.06]], adsr(0.004, 0.06, 0.6, 0.05, dur - 0.05));
const bass = (f, dur) => tone(dur, () => f, [[1, 1], [2, 0.45], [3, 0.2], [4, 0.08]], adsr(0.004, 0.08, 0.6, 0.05, dur - 0.05));
// ---- output
const done = [];
function out(name, dry, { wet = 0.18, fb = 0.84, peak = 0.89, label = name } = {}) {
  const pad = new Float32Array(dry.length + N(wet ? 1.2 : 0.05)); pad.set(dry);
  let L = pad, R = pad; if (wet) { const [rl, rr] = reverb(pad, fb); L = pad.map((v, i) => v + rl[i] * wet * 3); R = pad.map((v, i) => v + rr[i] * wet * 3); }
  // trim trailing silence
  let end = L.length; while (end > N(0.2) && Math.abs(L[end - 1]) < 2e-4 && Math.abs(R[end - 1]) < 2e-4) end--;
  L = L.subarray(0, end); R = R.subarray(0, end);
  let m = 0; for (let i = 0; i < end; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i]));
  const g = peak / (m || 1), fade = N(0.02); const pcm = Buffer.alloc(end * 4);
  for (let i = 0; i < end; i++) { const f = i > end - fade ? (end - i) / fade : 1;
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g * f)) * 32767), i * 4); pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g * f)) * 32767), i * 4 + 2); }
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  const wav = path.join(WORK, name + '.wav'); fs.writeFileSync(wav, Buffer.concat([h, pcm]));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '160k', path.join(OUT, name + '.mp3')]);
  done.push(`${name}\t${(end / SR).toFixed(2)}s`);
}
// ---- on-beat version: the theme's tempo is set so the reveal hit (clip 2 + 0.6 s = 5.6 s) lands on beat 12, the downbeat of bar 4
const dingUp = () => { const y = mk(2.4); [84, 88, 91].forEach((m, k) => add(y, bell(midi(m)), k * 0.1)); add(y, bell(midi(96), 1.8, 0.5), 0.3); return y; };
const roll = (len, endGain = 1) => { const y = mk(len + 0.2); let t = 0; while (t < len) { const p = t / len; add(y, snare(0.3 + 0.7 * p * endGain), t, 1); t += 0.07 - 0.038 * p; } return y; };
function applause(dur) { const L = mk(dur), R = mk(dur); for (let k = 0; k < 2600; k++) { const t = Math.pow(rnd(), 0.75) * (dur - 0.3);
    const env = Math.min(1, t / 0.35) * (t > dur - 1.6 ? Math.max(0, (dur - 0.3 - t) / 1.3) : 1); if (rnd() > env) continue;
    const c = biquad(noiseBurst(0.03, 0.005 + rnd() * 0.004), 'bp', 900 + rnd() * 1500, 1.4), pan = rnd(); add(L, c, t, 0.6 * (1 - pan) + 0.2); add(R, c, t, 0.6 * pan + 0.2); }
  return [L, R]; }
function theme(bpm, bars) { const beat = 60 / bpm, y = mk(bars * 4 * beat + 0.4); const chords = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
  for (let b = 0; b < bars; b++) { const t0 = b * 4 * beat, ch = chords[b % 4], root = ch[0] - 24;
    for (let q = 0; q < 4; q++) { if (q % 2 === 0) add(y, kick(0.35, 120, 48, 0.09), t0 + q * beat, 0.9); else add(y, clap(), t0 + q * beat, 0.5);
      add(y, hat(), t0 + q * beat, 0.18); add(y, hat(q === 3 ? 0.09 : 0.025), t0 + (q + 0.5) * beat, 0.28);
      for (const m of ch) add(y, organ(midi(m + 12), 0.16), t0 + (q + 0.5) * beat, 0.11); }
    for (const [pos, m] of [[0, root], [1.5, root], [2, root + 7], [3.5, root + 12]]) add(y, bass(midi(m), beat * 0.9), t0 + pos * beat, 0.5); }
  return y; }
// 10 s question clip + 5 s answer clip. 120 BPM: a beat is 0.5 s, so the countdown's seconds land on the beat.
// Tick on each whole second (digit change), tock on each half. Beeps replace the tick on 3, 2, 1 (t = 7, 8, 9).
// Clip 2 starts at 10.0 (beat 20, a downbeat); the drumroll runs 0.5 s and the hit lands on beat 21 (10.5 s).
const B = 0.5, th = theme(120, 8);
out('24-theme-120bpm-bed', th, { wet: 0.1 });
const beep = (f, d) => tone(d, () => f, [[1, 1], [2, 0.25]], adsr(0.003, 0.02, 0.8, 0.03, d - 0.03));
const mix = mk(15.4);
for (let i = 0; i < mix.length && i < th.length; i++) { const t = i / SR; let g = t < 10 ? 0.55 : t < 10.04 ? 0.55 - 0.2 * (t - 10) / 0.04 : 0.35; if (t > 14.3) g *= Math.max(0, (15 - t) / 0.7); mix[i] += th[i] * g; }
for (let k = 0; k < 20; k++) { const t = k * B, sec = k / 2; if (k % 2 === 0 && sec >= 7) add(mix, beep(sec === 9 ? 1320 : 880, 0.14), t, 0.5); else add(mix, woodTick(k % 2 ? 2300 : 3100), t, 0.7); }
add(mix, roll(0.5, 0.8), 10.0); add(mix, kick(0.9, 140, 42, 0.3), 10.5, 1); add(mix, crash(2.2), 10.5, 0.35); add(mix, dingUp(), 10.5, 0.6); const [, R] = applause(3.2); add(mix, R, 10.65, 0.35);
out('25-preview-mix-10s-countdown', mix, { wet: 0.1 });
console.log(done.join('\n'));
