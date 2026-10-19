// The music bed (Explainers 3.2, EX3-82). Deterministic choice, no model: the search looks for
// what the reels actually want (Lucas, 2026-10-13: groovy funk, driving indie, hip-hop
// instrumental at 105–128 BPM; never calm or business music, and not upbeat electronic).
//
// Run after pace.mjs (it needs the reel's length):
//   node assets/kit/music.mjs
//
// 1. The style rotates per reel (STYLES[n % 3], n = tracks used so far, from music-avoid.json).
// 2. HeyGen's music catalog is searched with that style's query; the top results are filtered:
//    a name or description that reads calm, corporate, ambient, piano, cinematic, meditative,
//    lo-fi or electronic is dropped, and so is any track used in the last three reels. A track
//    as long as the reel wins; the catalog has few, so otherwise the best track of at least
//    MIN_LOOPABLE seconds is looped with a crossfade (its lead-in and fade-out cut first), so
//    there is never a hard seam. If nothing passes, the next style is tried.
// 3. The pick is downloaded, started on its first strong beat (leading quiet trimmed), cut to
//    the reel, faded out across the close, brought to BED_LUFS (EX3-94: masters differ by 5 dB
//    and more; the training reel's bed was that much too loud), and written as
//    assets/bgm/track.mp3 at BED_VOLUME, so assembly never loops it. audio_meta.json's `bgm` points at it; assets/bgm/choice.json
//    records the pick for the worker's history.
//
// Prints JSON { ok, errors[], choice } and exits 1 on any error.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CLOSE } from './close-timing.js';
import { parseFrames } from './frames.mjs';

/** The rotation (EX3-82). Every query asks for high energy at 105–128 BPM. */
export const STYLES = [
  { key: 'funk', query: 'groovy funk, high energy, upbeat bass groove, 105-128 BPM, instrumental' },
  { key: 'indie', query: 'driving indie rock, high energy, upbeat guitars and drums, 105-128 BPM, instrumental' },
  { key: 'hiphop', query: 'hip-hop instrumental, high energy, punchy drums, head-nodding beat, 105-128 BPM' },
];

/** Words that mark the music the reels must never use. */
export const BANNED = /\b(calm|corporate|business|ambient|piano|cinematic|meditat\w*|relax\w*|lo-?fi|chill\w*|soft|gentle|peaceful|sleep\w*|sad|emotional|inspir\w*|motivational|electronic|edm|synth\w*|techno|house|trance|orchestra\w*)\b/i;

/** The bed's level under the voice (EX3-82; the voice is nearly continuous now). */
export const BED_VOLUME = 0.16;
/** Every bed is brought to this loudness before BED_VOLUME (EX3-94): the level of the RAG and
 *  fine-tuning beds Lucas kept (-16.6 and -15.5 LUFS); the training bed was -11.1. */
export const BED_LUFS = -16.5;
/** The most a quiet track is raised (dB), and the most a loud one is lowered. */
export const MAX_GAIN_UP = 6;
export const MAX_GAIN_DOWN = 15;
/** The bed fades out across the close (EX3-95). */
export const FADE_OUT = CLOSE.duration;
/** How many recent tracks never repeat. */
export const NO_REPEAT = 3;
/** The shortest track worth looping. */
export const MIN_LOOPABLE = 20;
/** The crossfade between loops, and the fade-out cut from a short track's end before looping. */
export const LOOP_XFADE = 0.5;
export const TAIL_CUT = 1.0;

const r3 = (n) => Math.round(n * 1000) / 1000;
const trackId = (t) => String(t.id ?? t.audio_id ?? t.name ?? t.audio_url ?? '');

/** The acceptable tracks of `results` (ranked as given), avoiding `avoid` ids. */
const acceptable = (results, avoid) =>
  (results ?? []).filter((t) => {
    const text = `${t.name ?? ''} ${t.description ?? ''} ${(t.tags ?? []).join?.(' ') ?? ''}`;
    return t.audio_url && !BANNED.test(text) && !avoid.includes(trackId(t));
  });

/**
 * The track for a reel of `total` seconds: the best one at least as long as the reel, else the
 * best loopable one. Returns { track, loop } or null.
 */
export function pickTrack(results, { total, avoid = [] }) {
  const ok = acceptable(results, avoid);
  const long = ok.find((t) => Number(t.duration) >= total + 1);
  if (long) return { track: long, loop: false };
  const short = ok.find((t) => Number(t.duration) >= MIN_LOOPABLE);
  return short ? { track: short, loop: true } : null;
}

/** The styles in the order this reel tries them: the rotation's style first. */
export function styleOrder(used) {
  const start = used % STYLES.length;
  return STYLES.map((_, i) => STYLES[(start + i) % STYLES.length]);
}

/** The reel's length from the paced storyboard. */
export function reelLength(root) {
  const frames = parseFrames(readFileSync(join(root, 'STORYBOARD.md'), 'utf8'));
  return r3(frames.reduce((n, f) => n + (f.duration > 0 ? f.duration : 0), 0));
}

async function heygen(root) {
  const lib = join(root, 'node_modules', 'hyperframes', 'dist', 'skills', 'media-use', 'audio', 'scripts', 'lib', 'heygen.mjs');
  return import(pathToFileURL(lib).href);
}

/** Where the track's music really starts: after any quiet lead-in (silencedetect at −30 dB). */
function leadIn(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-t', '8', '-af', 'silencedetect=n=-30dB:d=0.15', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /silence_start: (-?[\d.]+)[\s\S]*?silence_end: ([\d.]+)/.exec(String(r.stderr));
  return m && Number(m[1]) <= 0.05 ? Math.min(Number(m[2]), 4) : 0;
}

/** A file's integrated loudness in LUFS (ffmpeg's EBU R128 meter), or null. */
export function loudness(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /Integrated loudness:\s*I:\s*(-?[\d.]+)\s*LUFS/.exec(String(r.stderr));
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) && v > -70 ? v : null;
}

/** The gain (dB) that brings a bed measured at `lufs` to BED_LUFS, within the limits. */
export function bedGain(lufs) {
  if (!Number.isFinite(lufs)) return 0;
  return r3(Math.max(-MAX_GAIN_DOWN, Math.min(MAX_GAIN_UP, BED_LUFS - lufs)));
}

/**
 * Choose, fetch and fit the bed. `search(query)` and `download(url, dest)` are injectable for
 * tests; by default they are HeyGen's catalog search and download.
 */
export async function placeMusic(root, { search, download } = {}) {
  const errors = [];
  const total = reelLength(root);
  if (!(total > 0)) return { ok: false, errors: ['the storyboard has no paced durations (run pace.mjs first)'], choice: null };
  const avoidFile = join(root, 'music-avoid.json');
  const history = existsSync(avoidFile) ? JSON.parse(readFileSync(avoidFile, 'utf8')) : { used: 0, recent: [] };
  const avoid = (history.recent ?? []).slice(-NO_REPEAT);
  if (!search || !download) {
    const h = await heygen(root);
    const headers = h.heygenAuthHeaders();
    search ??= (query) => h.searchSounds(query, 'music', headers, { limit: 10 });
    download ??= (url, dest) => h.downloadTo(url, dest);
  }
  // The rotation's style wins (looped if its catalog has no long track); the next style is
  // tried only when nothing in it passes.
  const found = [];
  for (const s of styleOrder(history.used ?? 0)) {
    let results = [];
    try {
      results = await search(s.query);
    } catch (e) {
      errors.push(`search "${s.key}": ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const p = pickTrack(results, { total, avoid });
    if (p) {
      found.push({ ...p, style: s });
      break;
    }
  }
  const best = found[0] ?? null;
  const pick = best?.track ?? null;
  const style = best?.style ?? null;
  if (!pick) return { ok: false, errors: [...errors, `no track passed for a ${total}s reel in any style`], choice: null };

  const dir = join(root, 'assets', 'bgm');
  mkdirSync(dir, { recursive: true });
  const raw = join(dir, 'source.mp3');
  await download(pick.audio_url, raw);
  const start = leadIn(raw);
  const fadeAt = Math.max(0, total - FADE_OUT);
  const out = join(dir, 'track.mp3');
  const tmp = `${out}.tmp.mp3`;
  let args;
  if (best.loop) {
    // One clean cycle (lead-in and fade-out cut), crossfaded into itself until it covers the reel.
    const cycle = Math.max(MIN_LOOPABLE - TAIL_CUT, Number(pick.duration) - start - TAIL_CUT);
    const n = Math.ceil((total + 1) / (cycle - LOOP_XFADE)) + 1;
    const inputs = Array.from({ length: n }, () => ['-ss', start.toFixed(3), '-t', cycle.toFixed(3), '-i', raw]).flat();
    let chain = '';
    let last = '[0:a]';
    for (let i = 1; i < n; i++) {
      chain += `${last}[${i}:a]acrossfade=d=${LOOP_XFADE}:c1=tri:c2=tri[x${i}];`;
      last = `[x${i}]`;
    }
    args = ['-v', 'error', '-y', ...inputs, '-filter_complex', `${chain}${last}atrim=0:${total},afade=t=in:st=0:d=0.05,afade=t=out:st=${fadeAt.toFixed(3)}:d=${FADE_OUT}[out]`, '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '2', tmp];
  } else {
    args = ['-v', 'error', '-y', '-ss', start.toFixed(3), '-i', raw, '-t', String(total), '-af', `afade=t=in:st=0:d=0.05,afade=t=out:st=${fadeAt.toFixed(3)}:d=${FADE_OUT}`, '-c:a', 'libmp3lame', '-q:a', '2', tmp];
  }
  const ff = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (ff.status !== 0) return { ok: false, errors: [...errors, `ffmpeg: ${String(ff.stderr).trim().slice(0, 300)}`], choice: null };
  // The same loudness every reel (EX3-94), measured on the fitted bed (fades included), with a
  // limiter so a raised track never clips.
  const measured = loudness(tmp);
  const gain = bedGain(measured);
  if (Math.abs(gain) >= 0.1) {
    const leveled = `${out}.lvl.mp3`;
    const lv = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-af', `volume=${gain}dB,alimiter=limit=0.89:level=false`, '-c:a', 'libmp3lame', '-q:a', '2', leveled], { encoding: 'utf8' });
    if (lv.status !== 0) return { ok: false, errors: [...errors, `ffmpeg (level): ${String(lv.stderr).trim().slice(0, 300)}`], choice: null };
    renameSync(leveled, tmp);
  }
  renameSync(tmp, out);

  const choice = { id: trackId(pick), name: pick.name ?? null, description: pick.description ?? null, style: style.key, query: style.query, looped: best.loop, start: r3(start), duration_s: total, source_duration_s: Number(pick.duration) || null, loudness_lufs: measured, gain_db: gain };
  writeFileSync(join(dir, 'choice.json'), `${JSON.stringify(choice, null, 1)}\n`);
  const metaFile = join(root, 'audio_meta.json');
  const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : { voices: [], sfx: [] };
  meta.bgm = { path: 'assets/bgm/track.mp3', volume: BED_VOLUME, query: style.query, mode: 'retrieve', duration_s: total };
  meta.bgm_pending = false;
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 1)}\n`);
  return { ok: true, errors, choice };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await placeMusic(process.cwd()).catch((e) => ({ ok: false, errors: [e instanceof Error ? e.message : String(e)], choice: null }));
  console.log(JSON.stringify(result, null, 1));
  process.exit(result.ok ? 0 : 1);
}
