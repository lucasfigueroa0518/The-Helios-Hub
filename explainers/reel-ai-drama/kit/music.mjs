// The music for Reel AI Drama, forked from the news kit's music.mjs (EX3-82, EX3-94): the same tense
// documentary beds from HeyGen's catalog, searched, fitted, looped and levelled the same way. What is
// new (S-74, research 03 §10): the music changes, drops out or starts again at the frames the director
// marks in STORYBOARD.md (`- music: start | change | drop | hold | end`), so acts turn on the music:
//   start   the bed comes in (or comes back) at the frame's start
//   change  a different track takes over at the frame's start (a short crossfade)
//   drop    the music cuts out at the frame's start (a sudden silence before a reveal)
//   end     the music fades out across the frame
//   hold    nothing changes (the default)
// The first frame starts the bed unless it says drop; the bed always fades out across the close.
// The rotation history is this format's own (music-avoid.json, written by the workspace overlay).
//
// Designed music (MD-61): when sound_cues.json has music cues, they drive the sections instead of the
// storyboard marks (start / change / drop / cut / resume at exact times, a `style` per section and a
// `gain` per section, swells that rise into a beat over SWELL_IN and pull back over SWELL_OUT), and
// the bed is shaped by an envelope: ducked under the voice and lifted DUCK_LIFT in its pauses (a
// fast duck, a slow release), muted inside the designed silences. Levels stay sane for Reels: the
// bed is levelled to BED_LUFS, sits at its section gain under the voice (BED_VOLUME by default,
// GAIN_RANGE at most), and the envelope never lifts it past MAX_FACTOR. Without cues, as before.
//
// Run after pace.mjs (it needs the reel's length):
//   node assets/kit/music.mjs
//
// Prints JSON { ok, errors[], choice } and exits 1 on any error.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CLOSE } from './close-timing.js';
import { isClose, musicCue, parseFrames } from './frames.mjs';
import { frameClock, readCues, silenceWindows, speechIntervals } from './sound.mjs';

/** The rotation (RC-54): documentary tension beds, 80–100 BPM, instrumental. */
export const STYLES = [
  { key: 'pulse', query: 'tense documentary underscore, low pulsing bass, suspense, investigative, 80-100 BPM, instrumental' },
  { key: 'piano', query: 'true crime documentary, muted piano and low strings, tense, mysterious, 80-100 BPM, instrumental' },
  { key: 'percussion', query: 'investigative documentary, tense percussion and ticking rhythm, suspense, 80-100 BPM, instrumental' },
];

/** Moods the sound designer may ask for by key (research 07 §2: music by act). Never in the rotation. */
export const MOOD_STYLES = [
  { key: 'drone', query: 'dark ambient drone, low tension bed, suspense, documentary underscore, instrumental' },
  { key: 'dread', query: 'ominous documentary underscore, low strings, slow build, suspense, instrumental' },
  { key: 'drive', query: 'urgent documentary underscore, driving pulse and tense strings, 100-120 BPM, instrumental' },
  { key: 'reflect', query: 'reflective documentary underscore, sparse piano and strings, bittersweet, slow, instrumental' },
];
export const STYLE_KEYS = [...STYLES, ...MOOD_STYLES].map((s) => s.key);

/** Words that mark music this format must never use: bright, happy, hype or relaxing beds. */
export const BANNED = /\b(happy|upbeat|cheerful|funk\w*|groov\w*|party|dance|edm|house|trance|tropical|corporate|business|motivational|inspir\w*|uplifting|relax\w*|chill\w*|lo-?fi|meditat\w*|sleep\w*|lullaby|children|kids|christmas|comedy|funny|quirky|ukulele|whistl\w*)\b/i;

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
/** A change crossfades the two tracks over this long; a drop cuts over DROP_FADE. */
export const XFADE = 0.8;
export const DROP_FADE = 0.12;
/** The cold open hits at once; a restart comes back over RESTART_FADE. */
export const FIRST_FADE = 0.05;
export const RESTART_FADE = 0.15;
/** How many recent tracks never repeat. */
export const NO_REPEAT = 3;
/** The shortest track worth looping. */
export const MIN_LOOPABLE = 20;
/** The crossfade between loops, and the fade-out cut from a short track's end before looping. */
export const LOOP_XFADE = 0.5;
export const TAIL_CUT = 1.0;

/** Designed music: a section's gain range, the swell's peak, its rise and its pull-back (seconds). */
export const GAIN_RANGE = [0.06, 0.3];
export const SWELL_MAX = 0.32;
export const SWELL_IN = 3;
export const SWELL_OUT = 1.5;
/** Ducking: the bed lifts this much in the voice's pauses (+3.5 dB), ducks DUCK_PRE before a word and
 *  releases DUCK_POST after it; pauses shorter than DUCK_MIN_GAP stay ducked. Time constants in s. */
export const DUCK_LIFT = 1.5;
export const DUCK_PRE = 0.12;
export const DUCK_POST = 0.2;
export const DUCK_MIN_GAP = 0.45;
export const DUCK_ATTACK = 0.06;
export const DUCK_RELEASE = 0.5;
/** The envelope never raises the bed past this many times BED_VOLUME (about 0.35 in the mix). */
export const MAX_FACTOR = 2.2;
/** The envelope's sample rate (5 ms steps) and a designed silence's edge ramps. */
export const ENV_RATE = 200;
export const SILENCE_RAMP = 0.04;

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
 * The music plan of a storyboard's frames (S-74): segments { track, start, end, fadeIn, fadeOut } in
 * reel seconds. `track` counts the tracks (0, 1, 2…): each change moves to the next; a start after a
 * drop brings the same track back. Pure.
 */
export function musicPlan(frames) {
  const segs = [];
  let at = 0;
  let on = null; // the open segment
  let track = -1;
  const close = (end, fade) => {
    if (!on) return;
    on.end = r3(Math.max(on.start + 0.05, end));
    on.fadeOut = r3(Math.min(fade, on.end - on.start));
    segs.push(on);
    on = null;
  };
  const open = (start, k, fade) => {
    track = k;
    on = { track: k, start: r3(Math.max(0, start)), end: null, fadeIn: fade, fadeOut: 0 };
  };
  frames.forEach((f, i) => {
    const dur = f.duration > 0 ? f.duration : 0;
    const cue = musicCue(f);
    if (isClose(f)) {
      if (on) close(at + dur, dur || FADE_OUT);
    } else if (i === 0) {
      if (cue !== 'drop') open(0, 0, FIRST_FADE);
    } else if (cue === 'start') {
      if (!on) open(at, Math.max(0, track), RESTART_FADE);
    } else if (cue === 'change') {
      const k = track + 1;
      const was = Boolean(on);
      if (was) close(at + XFADE / 2, XFADE);
      open(was ? at - XFADE / 2 : at, k, was ? XFADE : RESTART_FADE);
    } else if (cue === 'drop') {
      close(at, DROP_FADE);
    } else if (cue === 'end') {
      close(at + dur, Math.max(0.3, dur));
    }
    at += dur;
  });
  close(at, FADE_OUT);
  return segs;
}

/**
 * The music plan of designed cues (MD-61): { segments, styles, swells }. Segments are musicPlan's shape
 * plus `gain` (the section's level under the voice); `styles[k]` is track k's style key or null (the
 * rotation's); swells are { t, gain }. A music still on at the close fades across it, as before.
 * Out-of-order cues (a drop with no music on, a start while on) are skipped. Pure.
 * @param {{ t: number, action: string, style?: string | null, gain?: number }[]} music
 * @param {{ total: number, closeStart?: number | null }} opts
 */
export function cueMusicPlan(music, { total, closeStart = null }) {
  const segs = [];
  const styles = [];
  const swells = [];
  let on = null;
  let track = -1;
  const clamp = (g, [lo, hi]) => (Number.isFinite(g) ? Math.min(hi, Math.max(lo, g)) : null);
  const close = (end, fade) => {
    if (!on) return;
    on.end = r3(Math.max(on.start + 0.05, end));
    on.fadeOut = r3(Math.min(fade, on.end - on.start));
    segs.push(on);
    on = null;
  };
  const open = (start, k, fade, gain) => {
    track = k;
    on = { track: k, start: r3(Math.max(0, start)), end: null, fadeIn: fade, fadeOut: 0, gain: gain ?? BED_VOLUME };
  };
  const end = closeStart != null && closeStart < total ? closeStart : null;
  for (const c of [...(music ?? [])].sort((a, b) => a.t - b.t)) {
    if (!(c.t >= 0 && c.t < total)) continue;
    const gain = clamp(c.gain, GAIN_RANGE);
    if (c.action === 'start' || c.action === 'resume') {
      if (on) continue;
      const k = Math.max(0, track);
      if (track < 0) styles[0] = STYLE_KEYS.includes(c.style) ? c.style : null;
      open(c.t, k, c.t < 0.05 ? FIRST_FADE : RESTART_FADE, gain ?? segs[segs.length - 1]?.gain);
    } else if (c.action === 'change') {
      const k = track + 1;
      styles[k] = STYLE_KEYS.includes(c.style) ? c.style : null;
      const was = Boolean(on);
      const g = gain ?? on?.gain;
      if (was) close(c.t + XFADE / 2, XFADE);
      open(was ? c.t - XFADE / 2 : c.t, k, was ? XFADE : RESTART_FADE, g);
    } else if (c.action === 'drop' || c.action === 'cut') {
      close(c.t, DROP_FADE);
    } else if (c.action === 'swell') {
      if (on) swells.push({ t: r3(c.t), gain: clamp(c.gain, [BED_VOLUME, SWELL_MAX]) ?? SWELL_MAX });
    }
  }
  if (on) close(total, end != null && on.start < end ? total - end : FADE_OUT);
  return { segments: segs, styles, swells };
}

/** Merge word intervals into talking spans (gaps under DUCK_MIN_GAP joined). */
function talkingSpans(speech) {
  const out = [];
  for (const s of [...(speech ?? [])].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && s.start - last.end < DUCK_MIN_GAP) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/**
 * The bed's gain envelope as a factor of BED_VOLUME, one value per 1/rate seconds: the section's gain,
 * raised by swells, lifted DUCK_LIFT in the voice's pauses (fast duck, slow release, ducking DUCK_PRE
 * ahead of each word), zero inside designed silences, at most MAX_FACTOR. Pure.
 * @param {{ segments?: { start: number, end: number, gain?: number, track?: number }[], swells?: { t: number, gain: number }[],
 *   silences?: { start: number, end: number }[], speech?: { start: number, end: number }[], total: number, rate?: number }} opts
 */
export function musicEnvelope({ segments = [], swells = [], silences = [], speech = [], total, rate = ENV_RATE }) {
  const n = Math.ceil(total * rate) + 2;
  const out = new Float32Array(n);
  const talk = talkingSpans(speech).map((s) => ({ start: s.start - DUCK_PRE, end: s.end + DUCK_POST }));
  const aAttack = 1 - Math.exp(-1 / (rate * DUCK_ATTACK));
  const aRelease = 1 - Math.exp(-1 / (rate * DUCK_RELEASE));
  let duck = talk.some((s) => 0 >= s.start && 0 < s.end) ? 1 : DUCK_LIFT;
  let ti = 0;
  for (let i = 0; i < n; i++) {
    const x = i / rate;
    const seg = segments.filter((s) => x >= s.start && x < s.end).pop();
    let g = seg?.gain ?? BED_VOLUME;
    for (const w of swells) {
      if (x >= w.t - SWELL_IN && x <= w.t) g = Math.max(g, g + (w.gain - g) * ((x - (w.t - SWELL_IN)) / SWELL_IN));
      else if (x > w.t && x <= w.t + SWELL_OUT) g = Math.max(g, w.gain + (g - w.gain) * ((x - w.t) / SWELL_OUT));
    }
    while (ti < talk.length && talk[ti].end <= x) ti++;
    const talking = ti < talk.length && x >= talk[ti].start;
    const target = talking ? 1 : DUCK_LIFT;
    duck += (target - duck) * (target < duck ? aAttack : aRelease);
    let mute = 1;
    for (const w of silences) {
      if (x >= w.start && x <= w.end) mute = 0;
      else if (x > w.start - SILENCE_RAMP && x < w.start) mute = Math.min(mute, (w.start - x) / SILENCE_RAMP);
      else if (x > w.end && x < w.end + SILENCE_RAMP) mute = Math.min(mute, (x - w.end) / SILENCE_RAMP);
    }
    out[i] = Math.min(MAX_FACTOR, (g / BED_VOLUME) * duck) * mute;
  }
  return out;
}

/** A mono 32-bit float WAV of `samples` at `rate` (the envelope ffmpeg multiplies the bed by). */
export function envelopeWav(samples, rate = ENV_RATE) {
  const data = Buffer.alloc(samples.length * 4);
  samples.forEach((v, i) => data.writeFloatLE(v, i * 4));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20); // IEEE float
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(32, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** The ffmpeg arguments that multiply a bed by its envelope WAV (limited, cut to `total`). */
export function applyEnvelopeArgs(input, envFile, total, out) {
  return ['-v', 'error', '-y', '-i', input, '-i', envFile, '-filter_complex',
    `[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[e];[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[m];[m][e]amultiply,alimiter=limit=0.89:level=false,atrim=0:${total}[out]`,
    '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '2', out];
}

/** The ffmpeg arguments that lay the plan's segments of the fitted tracks into one bed of `total` seconds. */
export function mixMusicArgs(segments, trackFiles, total, out) {
  const args = ['-v', 'error', '-y'];
  segments.forEach((s) => args.push('-i', trackFiles[s.track]));
  const chains = segments.map((s, i) => {
    const len = r3(s.end - s.start);
    const ms = Math.round(s.start * 1000);
    return `[${i}:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo,afade=t=in:st=0:d=${s.fadeIn},afade=t=out:st=${r3(Math.max(0, len - s.fadeOut))}:d=${s.fadeOut},adelay=${ms}|${ms}[m${i}]`;
  });
  const mix = `${segments.map((_, i) => `[m${i}]`).join('')}amix=inputs=${segments.length}:normalize=0:dropout_transition=0,apad=whole_dur=${total},atrim=0:${total}[out]`;
  args.push('-filter_complex', [...chains, mix].join(';'), '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '2', out);
  return args;
}

/** Fit one track to the reel's whole length from where its music starts (looped when short), levelled. */
function fitTrack(raw, pick, loop, total, out) {
  const start = leadIn(raw);
  const tmp = `${out}.tmp.mp3`;
  let args;
  if (loop) {
    const cycle = Math.max(MIN_LOOPABLE - TAIL_CUT, Number(pick.duration) - start - TAIL_CUT);
    const n = Math.ceil((total + 1) / (cycle - LOOP_XFADE)) + 1;
    const inputs = Array.from({ length: n }, () => ['-ss', start.toFixed(3), '-t', cycle.toFixed(3), '-i', raw]).flat();
    let chain = '';
    let last = '[0:a]';
    for (let i = 1; i < n; i++) {
      chain += `${last}[${i}:a]acrossfade=d=${LOOP_XFADE}:c1=tri:c2=tri[x${i}];`;
      last = `[x${i}]`;
    }
    args = ['-v', 'error', '-y', ...inputs, '-filter_complex', `${chain}${last}atrim=0:${total}[out]`, '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '2', tmp];
  } else {
    args = ['-v', 'error', '-y', '-ss', start.toFixed(3), '-i', raw, '-t', String(total), '-c:a', 'libmp3lame', '-q:a', '2', tmp];
  }
  const ff = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (ff.status !== 0) return { error: `ffmpeg: ${String(ff.stderr).trim().slice(0, 300)}` };
  const measured = loudness(tmp);
  const gain = bedGain(measured);
  if (Math.abs(gain) >= 0.1) {
    const leveled = `${out}.lvl.mp3`;
    const lv = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-af', `volume=${gain}dB,alimiter=limit=0.89:level=false`, '-c:a', 'libmp3lame', '-q:a', '2', leveled], { encoding: 'utf8' });
    if (lv.status !== 0) return { error: `ffmpeg (level): ${String(lv.stderr).trim().slice(0, 300)}` };
    renameSync(leveled, tmp);
  }
  renameSync(tmp, out);
  return { start: r3(start), loudness: measured, gain };
}

/**
 * Choose, fetch, fit and lay the music. `search(query)` and `download(url, dest)` are injectable for
 * tests and the smoke run; by default they are HeyGen's catalog search and download.
 */
export async function placeMusic(root, { search, download } = {}) {
  const errors = [];
  const frames = parseFrames(readFileSync(join(root, 'STORYBOARD.md'), 'utf8'));
  const total = r3(frames.reduce((n, f) => n + (f.duration > 0 ? f.duration : 0), 0));
  if (!(total > 0)) return { ok: false, errors: ['the storyboard has no paced durations (run pace.mjs first)'], choice: null };
  const designed = readCues(root);
  const cued = Boolean(designed?.music?.length);
  let plan;
  let styles = [];
  let swells = [];
  if (cued) {
    let at = 0;
    let closeStart = null;
    for (const f of frames) {
      if (isClose(f)) closeStart = r3(at);
      at += f.duration > 0 ? f.duration : 0;
    }
    ({ segments: plan, styles, swells } = cueMusicPlan(designed.music, { total, closeStart }));
  } else plan = musicPlan(frames);
  if (!plan.length) return { ok: true, errors, choice: null };
  const needed = Math.max(...plan.map((s) => s.track)) + 1;
  const avoidFile = join(root, 'music-avoid.json');
  const history = existsSync(avoidFile) ? JSON.parse(readFileSync(avoidFile, 'utf8')) : { used: 0, recent: [] };
  const avoid = (history.recent ?? []).slice(-NO_REPEAT);
  if (!search || !download) {
    const h = await heygen(root);
    const headers = h.heygenAuthHeaders();
    search ??= (query) => h.searchSounds(query, 'music', headers, { limit: 10 });
    download ??= (url, dest) => h.downloadTo(url, dest);
  }
  const dir = join(root, 'assets', 'bgm');
  mkdirSync(dir, { recursive: true });
  const picked = [];
  for (let k = 0; k < needed; k++) {
    // Each act's track leads with the next style in the rotation, so a change is heard as a change.
    let found = null;
    const order = styleOrder((history.used ?? 0) + k);
    const asked = [...STYLES, ...MOOD_STYLES].find((s) => s.key === styles[k]);
    for (const s of asked ? [asked, ...order.filter((o) => o.key !== asked.key)] : order) {
      let results = [];
      try {
        results = await search(s.query);
      } catch (e) {
        errors.push(`search "${s.key}": ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const p = pickTrack(results, { total, avoid: [...avoid, ...picked.map((x) => x.id)] });
      if (p) { found = { ...p, style: s }; break; }
    }
    if (!found) return { ok: false, errors: [...errors, `no track passed for act ${k + 1} of a ${total}s reel in any style`], choice: null };
    const raw = join(dir, `source-${k}.mp3`);
    await download(found.track.audio_url, raw);
    const file = join(dir, `track-${k}.mp3`);
    const fit = fitTrack(raw, found.track, found.loop, total, file);
    if (fit.error) return { ok: false, errors: [...errors, fit.error], choice: null };
    picked.push({ id: trackId(found.track), name: found.track.name ?? null, style: found.style.key, query: found.style.query, looped: found.loop, file, ...fit });
  }
  const out = join(dir, 'track.mp3');
  const mixed = spawnSync('ffmpeg', mixMusicArgs(plan, picked.map((p) => p.file), total, out), { encoding: 'utf8' });
  if (mixed.status !== 0) return { ok: false, errors: [...errors, `ffmpeg (mix): ${String(mixed.stderr).trim().slice(0, 300)}`], choice: null };
  if (cued) {
    // Duck under the voice, lift in its pauses, swell into the beats, mute the designed silences.
    const clock = frameClock(root);
    const metaNow = existsSync(join(root, 'audio_meta.json')) ? JSON.parse(readFileSync(join(root, 'audio_meta.json'), 'utf8')) : {};
    const env = musicEnvelope({ segments: plan, swells, silences: silenceWindows(designed), speech: speechIntervals(clock, metaNow.voices), total });
    const envFile = join(dir, 'envelope.wav');
    writeFileSync(envFile, envelopeWav(env));
    const shaped = `${out}.env.mp3`;
    const sh = spawnSync('ffmpeg', applyEnvelopeArgs(out, envFile, total, shaped), { encoding: 'utf8' });
    if (sh.status !== 0) return { ok: false, errors: [...errors, `ffmpeg (envelope): ${String(sh.stderr).trim().slice(0, 300)}`], choice: null };
    renameSync(shaped, out);
  }

  const choice = {
    id: picked[0].id, ids: picked.map((p) => p.id), duration_s: total,
    tracks: picked.map(({ file, ...p }) => ({ ...p, file: file.slice(root.length + 1) })), segments: plan,
    designed: cued, ...(cued ? { swells } : {}),
  };
  writeFileSync(join(dir, 'choice.json'), `${JSON.stringify(choice, null, 1)}\n`);
  const metaFile = join(root, 'audio_meta.json');
  const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : { voices: [], sfx: [] };
  meta.bgm = { path: 'assets/bgm/track.mp3', volume: BED_VOLUME, query: picked[0].query, mode: 'retrieve', duration_s: total };
  meta.bgm_pending = false;
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 1)}\n`);
  return { ok: true, errors, choice };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  placeMusic(process.cwd())
    .catch((e) => ({ ok: false, errors: [e instanceof Error ? e.message : String(e)], choice: null }))
    .then((result) => {
      console.log(JSON.stringify(result, null, 1));
      process.exit(result.ok ? 0 : 1);
    });
}
