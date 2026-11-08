// Prepare a sound for the hook bank: trimmed to its onset, peak-normalized to PEAK_DB, so a score's levels mean what they say
// (generated effects come out at -24 to -60 dB and can start late). tests/reel-ai-drama-iter12-hooks.test.ts enforces the result.
//
//   node lib/reel-ai-drama/hooks/normalize-sound.mjs <in> <out.mp3> [seconds]

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PEAK_DB = -1;
/** How far under its own peak a sound counts as started. */
export const ONSET_BELOW_PEAK_DB = 30;

/** The loudest sample of an audio file, in dB. */
export function peakDb(file, ffmpeg = 'ffmpeg') {
  const res = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(res.stderr ?? '');
  if (!m) throw new Error(`no level read from ${file}`);
  return Number(m[1]);
}

/** Seconds before a file first reaches ONSET_BELOW_PEAK_DB under its peak. */
export function onsetSeconds(file, ffmpeg = 'ffmpeg') {
  const peak = peakDb(file, ffmpeg);
  const res = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', `silencedetect=noise=${peak - ONSET_BELOW_PEAK_DB}dB:d=0.001`, '-f', 'null', '-'], { encoding: 'utf8' });
  const first = /silence_start:\s*(-?[\d.]+)[\s\S]*?silence_end:\s*([\d.]+)/.exec(res.stderr ?? '');
  return first && Number(first[1]) <= 0.001 ? Number(first[2]) : 0;
}

export function normalizeSound(input, output, { seconds = null, ffmpeg = 'ffmpeg' } = {}) {
  const peak = peakDb(input, ffmpeg);
  const start = `silenceremove=start_periods=1:start_threshold=${peak - ONSET_BELOW_PEAK_DB}dB:start_silence=0`;
  const cut = seconds ? `,atrim=0:${seconds},afade=t=out:st=${Math.max(0, seconds - 0.08)}:d=0.08` : '';
  const encode = (gain) => {
    const res = spawnSync(ffmpeg, ['-v', 'error', '-y', '-i', input, '-af', `${start}${cut},volume=${gain}dB,aresample=48000`, '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', output], { encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`normalize ${input}: ${String(res.stderr).slice(-300)}`);
  };
  // Twice: going to stereo and the encoder both move the peak, so the second pass corrects what the first measured.
  encode(PEAK_DB - peak);
  encode(PEAK_DB - peak + (PEAK_DB - peakDb(output, ffmpeg)));
  return { peak: peakDb(output, ffmpeg), onset: onsetSeconds(output, ffmpeg) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [input, output, seconds] = process.argv.slice(2);
  console.log(JSON.stringify(normalizeSound(input, output, { seconds: seconds ? Number(seconds) : null })));
}
