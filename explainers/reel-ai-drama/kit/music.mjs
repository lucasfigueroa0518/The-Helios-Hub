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
// Tracks differ (MD-144): each act's candidates are measured free with ffmpeg on the part the reel plays
// (how much sits in the speech band and how busy it is there, how much a phone speaker can play), cached
// per track, and ranked with the catalog's own order. The bed is levelled on that same part. A chosen
// track still dense in the speech band takes SPEECH_CUT. Any measurement failure falls back to the
// catalog's order.
//
// Rotation (MD-144): the format's history file (`ledger` in music-avoid.json) lists each reel's tracks.
// A track from the last HISTORY_REELS reels may not be used again, except that a reel of 3 or more tracks
// may reuse one when it beats the best fresh option. The history is re-read and written under a lock at
// the moment the tracks are chosen, so parallel local runs see each other. If the pool runs out, the least
// recently used track plays; the rotation never fails a reel.
//
// Run after pace.mjs (it needs the reel's length):
//   node assets/kit/music.mjs
//
// Prints JSON { ok, errors[], choice } and exits 1 on any error.

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  { key: 'dread', query: 'ominous documentary underscore, low strings, slow build, suspense, instrumental' },
  { key: 'drive', query: 'urgent documentary underscore, driving pulse and tense strings, 100-120 BPM, instrumental' },
  { key: 'reflect', query: 'reflective documentary underscore, sparse piano and strings, bittersweet, slow, instrumental' },
];
export const STYLE_KEYS = [...STYLES, ...MOOD_STYLES].map((s) => s.key);
/** Styles no longer offered (MD-142: a low drone can't be heard on a phone); old cues play as these. */
export const RETIRED_STYLES = { drone: 'dread' };
/** The style a cue names, in today's keys, or null when it names none. */
export function styleKey(key) {
  const k = RETIRED_STYLES[key] ?? key;
  return STYLE_KEYS.includes(k) ? k : null;
}

/** Words that mark music this format must never use: bright, happy, hype or relaxing beds. */
export const BANNED = /\b(happy|upbeat|cheerful|funk\w*|groov\w*|party|dance|edm|house|trance|tropical|corporate|business|motivational|inspir\w*|uplifting|relax\w*|chill\w*|lo-?fi|meditat\w*|sleep\w*|lullaby|children|kids|christmas|comedy|funny|quirky|ukulele|whistl\w*)\b/i;

/** The bed's level under the voice (MD-144: Lucas's pick by ear). */
export const BED_VOLUME = 0.31;
/** Every bed is brought to this loudness before BED_VOLUME (EX3-94): the level of the RAG and
 *  fine-tuning beds Lucas kept (-16.6 and -15.5 LUFS); the training bed was -11.1. */
export const BED_LUFS = -16.5;
/** The most a quiet track is raised (dB; the limiter catches its peaks), and the most a loud one is lowered. */
export const MAX_GAIN_UP = 10;
export const MAX_GAIN_DOWN = 15;
/** The bed fades out across the close (EX3-95). */
export const FADE_OUT = CLOSE.duration;
/** A change crossfades the two tracks over this long; a drop cuts over DROP_FADE. */
export const XFADE = 0.8;
export const DROP_FADE = 0.12;
/** The cold open hits at once; a restart comes back over RESTART_FADE. */
export const FIRST_FADE = 0.05;
export const RESTART_FADE = 0.15;
/** How many past reels the rotation looks back over, and how many the history file keeps. */
export const HISTORY_REELS = 4;
export const KEEP_REELS = 24;
/** How many songs a reel needs before it may reuse one recent song, and how many it may reuse. */
export const REPEAT_FROM_SONGS = 3;
export const MAX_REPEATS = 1;
/** Results asked of the catalog per style, and how many of them are measured per act. */
export const CATALOG_LIMIT = 20;
export const FRESH_CANDIDATES = 4;
export const REPEAT_CANDIDATES = 2;
/** The shortest track worth looping. */
export const MIN_LOOPABLE = 20;
/** The crossfade between loops, and the fade-out cut from a short track's end before looping. */
export const LOOP_XFADE = 0.5;
export const TAIL_CUT = 1.0;

/** Designed music: a section's gain range, the swell's peak, its rise and its pull-back (seconds). */
export const GAIN_RANGE = [0.19, 0.42];
export const SWELL_MAX = 0.47;
export const SWELL_IN = 3;
export const SWELL_OUT = 1.5;
/** A designed swell's rise may run from a short lift to a build across a whole scene (seconds). */
export const SWELL_RISE = [2, 12];
/** Muffled music: a low-pass this low, lifted so it stays present on a phone; how fast it closes and opens (s). */
export const MUFFLE = { cutoff: 650, lift: 1.5, close: 0.2, open: 0.25 };
/** Ducking: the bed lifts this much in the voice's pauses (+3.5 dB), ducks DUCK_PRE before a word and
 *  releases DUCK_POST after it; pauses shorter than DUCK_MIN_GAP stay ducked. Time constants in s. */
export const DUCK_LIFT = 1.5;
export const DUCK_PRE = 0.12;
export const DUCK_POST = 0.2;
export const DUCK_MIN_GAP = 0.45;
export const DUCK_ATTACK = 0.06;
export const DUCK_RELEASE = 0.5;
/** The envelope never raises the bed past this many times BED_VOLUME (about 0.54 in the mix). */
export const MAX_FACTOR = 1.75;
/** The envelope's sample rate (5 ms steps) and a designed silence's edge ramps. */
export const ENV_RATE = 200;
export const SILENCE_RAMP = 0.04;

const r3 = (n) => Math.round(n * 1000) / 1000;
const trackId = (t) => String(t.id ?? t.audio_id ?? t.name ?? t.audio_url ?? '');

/** The acceptable tracks of `results` (ranked as given), avoiding `avoid` ids. */
const acceptable = (results, avoid = []) =>
  (results ?? []).filter((t) => {
    const text = `${t.name ?? ''} ${t.description ?? ''} ${(t.tags ?? []).join?.(' ') ?? ''}`;
    return t.audio_url && !BANNED.test(text) && !avoid.includes(trackId(t));
  });

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
  const r = spawnSync('ffmpeg', ['-hide_banner', '-t', '8', '-i', file, '-af', 'silencedetect=n=-30dB:d=0.15', '-f', 'null', '-'], { encoding: 'utf8', timeout: 60_000 });
  const m = /silence_start: (-?[\d.]+)[\s\S]*?silence_end: ([\d.]+)/.exec(String(r.stderr));
  return m && Number(m[1]) <= 0.05 ? Math.min(Number(m[2]), 4) : 0;
}

/**
 * A file's integrated loudness in LUFS (ffmpeg's EBU R128 meter), or null; `section` [from, to] measures only that part.
 * @param {string} file
 * @param {readonly number[] | null} [section]
 */
export function loudness(file, section = null) {
  const range = section ? ['-ss', String(section[0]), '-t', String(Math.max(0, section[1] - section[0]))] : [];
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...range, '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
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
 * rotation's); swells are { t, gain, rise }. A music still on at the close fades across it, as before.
 * Out-of-order cues (a drop with no music on, a start while on) are skipped. Pure.
 * @param {{ t: number, action: string, style?: string | null, gain?: number, dur?: number }[]} music
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
      if (track < 0) styles[0] = styleKey(c.style);
      open(c.t, k, c.t < 0.05 ? FIRST_FADE : RESTART_FADE, gain ?? segs[segs.length - 1]?.gain);
    } else if (c.action === 'change') {
      const k = track + 1;
      styles[k] = styleKey(c.style);
      const was = Boolean(on);
      const g = gain ?? on?.gain;
      if (was) close(c.t + XFADE / 2, XFADE);
      open(was ? c.t - XFADE / 2 : c.t, k, was ? XFADE : RESTART_FADE, g);
    } else if (c.action === 'drop' || c.action === 'cut') {
      close(c.t, DROP_FADE);
    } else if (c.action === 'swell') {
      if (on) swells.push({ t: r3(c.t), gain: clamp(c.gain, [BED_VOLUME, SWELL_MAX]) ?? SWELL_MAX, rise: clamp(c.dur, SWELL_RISE) ?? SWELL_IN });
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
 * @param {{ segments?: { start: number, end: number, gain?: number, track?: number }[], swells?: { t: number, gain: number, rise?: number }[],
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
      const rise = w.rise ?? SWELL_IN;
      if (x >= w.t - rise && x <= w.t) g = Math.max(g, g + (w.gain - g) * ((x - (w.t - rise)) / rise));
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

/**
 * How muffled the bed is, 0 to 1, per 1/rate seconds: each muffle `{ t, dur }` holds it muffled for `dur` seconds and
 * opens it on `t`. Pure.
 * @param {{ t: number, dur: number }[]} muffles
 */
export function muffleEnvelope(muffles, total, rate = ENV_RATE) {
  const n = Math.ceil(total * rate) + 2;
  const out = new Float32Array(n);
  for (const m of muffles ?? []) {
    const from = m.t - m.dur;
    for (let i = Math.max(0, Math.floor((from - MUFFLE.close) * rate)); i < n && i / rate <= m.t + MUFFLE.open; i++) {
      const x = i / rate;
      const k = x < from ? (from <= 0 ? 1 : 1 - (from - x) / MUFFLE.close) : x <= m.t ? 1 : 1 - (x - m.t) / MUFFLE.open;
      out[i] = Math.max(out[i], Math.min(1, Math.max(0, k)));
    }
  }
  return out;
}

/** The ffmpeg arguments that blend a bed with its muffled self by two gain WAVs (the dry and muffled shares). */
export function applyMuffleArgs(input, dryFile, wetFile, total, out) {
  const gain = (i, name) => `[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[${name}]`;
  return ['-v', 'error', '-y', '-i', input, '-i', dryFile, '-i', wetFile, '-filter_complex',
    `[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,asplit=2[d][w];${gain(1, 'de')};${gain(2, 'we')};[w]lowpass=f=${MUFFLE.cutoff},lowpass=f=${MUFFLE.cutoff},volume=${MUFFLE.lift}[wf];[d][de]amultiply[dm];[wf][we]amultiply[wm];[dm][wm]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.89:level=false,atrim=0:${total}[out]`,
    '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '2', out];
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
function fitTrack(raw, pick, loop, total, out, { section = null, cut = false } = {}) {
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
  // A dense track gives way in the speech band; its level is measured after that.
  if (cut) {
    const carved = `${out}.cut.mp3`;
    const eq = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-af', SPEECH_CUT, '-c:a', 'libmp3lame', '-q:a', '2', carved], { encoding: 'utf8' });
    if (eq.status === 0) renameSync(carved, tmp);
  }
  // Level on the part this reel plays; the whole track when that part is too short to meter.
  const usable = section && section[1] - section[0] >= MIN_LEVEL_SECTION;
  const measured = (usable ? loudness(tmp, section) : null) ?? loudness(tmp);
  const gain = bedGain(measured);
  if (Math.abs(gain) >= 0.1) {
    const leveled = `${out}.lvl.mp3`;
    const lv = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-af', `volume=${gain}dB,alimiter=limit=0.89:level=false`, '-c:a', 'libmp3lame', '-q:a', '2', leveled], { encoding: 'utf8' });
    if (lv.status !== 0) return { error: `ffmpeg (level): ${String(lv.stderr).trim().slice(0, 300)}` };
    renameSync(leveled, tmp);
  }
  renameSync(tmp, out);
  return { start: r3(start), loudness: measured, gain, ...(usable ? { level_section: section } : {}), ...(cut ? { speech_cut: true } : {}) };
}

// ── Rotation ─────────────────────────────────────────────────────────────

const readJsonFile = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** @typedef {{ used: number, recent: string[], reels: { job: string | null, ids: string[] }[] }} History */

/** A history in one shape: `reels` oldest first, each { job, ids }; a flat `recent` from an older file counts as one reel. */
/** @param {any} raw @returns {History} */
export function normalHistory(raw) {
  const flat = Array.isArray(raw?.recent) ? raw.recent.map(String) : [];
  const reels = Array.isArray(raw?.reels) ? raw.reels.filter((r) => Array.isArray(r?.ids)).map((r) => ({ job: r.job ?? null, ids: r.ids.map(String) })) : flat.length ? [{ job: null, ids: flat }] : [];
  return { used: Number(raw?.used) || 0, recent: flat, reels };
}

const readHistory = (file, fallback) => normalHistory(readJsonFile(file) ?? fallback);

/**
 * The tracks of the last HISTORY_REELS other reels, oldest first (this job's own earlier picks don't count).
 * @param {History} history
 * @param {string | null} [job]
 * @returns {string[]}
 */
export function recentIds(history, job = null) {
  return history.reels.filter((r) => !job || r.job !== job).slice(-HISTORY_REELS).flatMap((r) => r.ids);
}

/**
 * The history with `job`'s tracks as its newest reel (a re-placed reel replaces its entry and counts once).
 * @param {History} history
 * @param {string | null} job
 * @param {string[]} ids
 * @returns {History}
 */
export function withReel(history, job, ids) {
  const had = job != null && history.reels.some((r) => r.job === job);
  const reels = [...history.reels.filter((r) => job == null || r.job !== job), { job, ids }].slice(-KEEP_REELS);
  return { used: history.used + (had ? 0 : 1), recent: reels.flatMap((r) => r.ids), reels };
}

function writeHistory(file, history) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(history, null, 1)}\n`);
  renameSync(tmp, file);
}

function writeCache(file, cache) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cache));
    renameSync(tmp, file);
  } catch {
    // a cache that can't be written costs a measurement next time
  }
}

/** Run `fn` holding the history's lock; a lock that can't be had (or a stale one) never stops a reel. */
export function withLedger(file, fn) {
  if (!file) return fn();
  const lock = `${file}.lock`;
  let held = false;
  try {
    mkdirSync(dirname(file), { recursive: true });
    for (let i = 0; i < 100 && !held; i++) {
      try {
        closeSync(openSync(lock, 'wx'));
        held = true;
      } catch {
        try {
          if (Date.now() - statSync(lock).mtimeMs > 10_000) rmSync(lock, { force: true });
        } catch {
          // the holder just let go
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
  } catch {
    // no lock: choose anyway
  }
  try {
    return fn();
  } finally {
    if (held) rmSync(lock, { force: true });
  }
}

/**
 * The reel's tracks, one per act. `acts[k].candidates`: { id, score, ... }. `recent`: ids from the last
 * HISTORY_REELS reels, oldest first. A reel of REPEAT_FROM_SONGS or more songs may reuse MAX_REPEATS recent
 * song: the act where a recent song beats that act's best fresh option by the most gets it. Everything else
 * is fresh; when an act has no fresh track left, the free repeat is used, then the least recently used
 * track. Returns { picks, notes }; never fails while an act has a candidate. Pure.
 * @template {{ id: string, score: number }} C
 * @param {{ candidates: C[] }[]} acts
 * @param {{ recent?: string[] }} [opts]
 * @returns {{ picks: (C & { repeat?: boolean })[], notes: string[] }}
 */
export function chooseTracks(acts, { recent = [] } = {}) {
  const isRecent = new Set(recent);
  const taken = new Set();
  /** @type {any[]} */
  const picks = new Array(acts.length).fill(null);
  /** @type {string[]} */
  const notes = [];
  let repeats = acts.length >= REPEAT_FROM_SONGS ? MAX_REPEATS : 0;
  const best = (list) => list.reduce((a, c) => (!a || c.score > a.score ? c : a), null);
  const take = (k, c, repeat = false) => {
    taken.add(c.id);
    picks[k] = repeat ? { ...c, repeat: true } : c;
  };
  if (repeats) {
    let slot = null;
    acts.forEach((act, k) => {
      const again = best(act.candidates.filter((c) => isRecent.has(c.id)));
      if (!again) return;
      const fresh = best(act.candidates.filter((c) => !isRecent.has(c.id)));
      // Only when the repeat really beats what's fresh; running out of fresh tracks is handled below.
      if (!fresh) return;
      const gain = again.score - fresh.score;
      if (gain > 0 && (!slot || gain > slot.gain)) slot = { k, c: again, gain };
    });
    if (slot) {
      take(slot.k, slot.c, true);
      repeats -= 1;
    }
  }
  acts.forEach((act, k) => {
    if (picks[k]) return;
    const open = act.candidates.filter((c) => !taken.has(c.id));
    const fresh = best(open.filter((c) => !isRecent.has(c.id)));
    if (fresh) return take(k, fresh);
    const again = best(open);
    if (again && repeats > 0) {
      repeats -= 1;
      return take(k, again, true);
    }
    // The pool ran out: the least recently used track, whatever the rule says, so the reel still has music.
    const lru = [...open].sort((a, b) => recent.lastIndexOf(a.id) - recent.lastIndexOf(b.id))[0] ?? best(act.candidates);
    if (lru) {
      notes.push(`music rotation: act ${k + 1} has no fresh track; ${lru.id} (least recently used) plays`);
      take(k, lru, true);
    }
  });
  return { picks, notes };
}

// ── Fit behind speech (MD-144) ───────────────────────────────────────────

/** Sections too short to meter are levelled on the whole track. */
export const MIN_LEVEL_SECTION = 3;
export const BLOCK_S = 5;
const MEASURE_RATE = 16000;
const MEASURE_VERSION = 1;
/** The bands: the speech band's edges and the lowest a phone speaker really plays (Hz). */
export const SPEECH_BAND = [300, 3400];
export const PHONE_FLOOR = 200;
/** A gentle fixed cut in the speech band for a track that stays dense there. */
export const SPEECH_CUT = 'equalizer=f=1200:width_type=o:width=1.6:g=-3';
/**
 * Thresholds and weights, set from the tracks of the Siri and Alexa reels and their neighbours (all
 * measured on the part each reel played). `speech`: the speech band against the whole track, dB.
 * `busy`: how much that band pulses at speech rate. `phone`: what a phone can play against the whole
 * track, dB. `level`: the section's own level, dB; below `quietAt` even MAX_GAIN_UP can't bring it to
 * BED_LUFS. Measured: 2916dfd6 -6.0/0.09/-2.8 (sits well), 3c5e8aa4 -4.4/0.17/-3.4 (well), d1ed3d1e
 * -2.3/0.12/-1.0 (dense, steady), 83a3cc1b -1.3/0.22/-0.5 (dense, moving), 6c19b926 phone -9.1 and
 * f84ef9c5 phone -9.9 (bass-heavy), 1fa1fd24 phone -14.6 (mostly bass), be16dc81 phone -30 (the bass-only
 * bed nobody heard), 70641d55 played at -42 LUFS on its fading tail (-10.7 whole).
 */
export const FIT = { denseAt: -3, busyDenseAt: -6, busyAt: 0.15, busyMovesAt: 0.2, phoneAt: -6, quietAt: -27, relevance: 1, speech: 0.08, busy: 1, phone: 0.08, quiet: 0.05, loop: 0.2, offStyle: 0.3 };

const dbOf = (energy) => (energy > 1e-12 ? 10 * Math.log10(energy) : -120);

/** How much an amplitude envelope pulses in 2 to 8 Hz, against its mean (0 steady, about 1 for syllables). Pure. */
export function modulationDepth(env, rate) {
  const n = env.length;
  if (n < rate) return 0;
  const mean = env.reduce((a, b) => a + b, 0) / n;
  if (!(mean > 1e-6)) return 0;
  let power = 0;
  for (let f = 2; f <= 8; f += 0.5) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const w = (2 * Math.PI * f * i) / rate;
      re += (env[i] - mean) * Math.cos(w);
      im += (env[i] - mean) * Math.sin(w);
    }
    power += (re * re + im * im) / (n * n);
  }
  return r3(Math.sqrt(2 * power) / mean);
}

/** Interleaved [full, speech, phone] samples → one { full, speech, phone, busy } per BLOCK_S seconds (dB; busy 0–1). Pure. */
export function analyseBands(samples, rate = MEASURE_RATE, block = BLOCK_S) {
  const per = rate * block * 3;
  const frame = Math.round(rate * 0.02);
  const blocks = [];
  for (let at = 0; at + per / 2 <= samples.length; at += per) {
    const end = Math.min(samples.length, at + per);
    let full = 0;
    let speech = 0;
    let phone = 0;
    const env = [];
    let e = 0;
    let m = 0;
    for (let i = at; i + 2 < end; i += 3) {
      full += samples[i] ** 2;
      speech += samples[i + 1] ** 2;
      phone += samples[i + 2] ** 2;
      e += samples[i + 1] ** 2;
      if (++m === frame) {
        env.push(Math.sqrt(e / m));
        e = 0;
        m = 0;
      }
    }
    const count = (end - at) / 3;
    blocks.push({ full: r3(dbOf(full / count)), speech: r3(dbOf(speech / count)), phone: r3(dbOf(phone / count)), busy: modulationDepth(env, 50) });
  }
  return blocks;
}

/** Blocks → a section's { speech, phone, busy, level }: band against the whole, by energy. Null when the section is silent. Pure. */
export function sectionFit(blocks) {
  const live = blocks.filter((b) => b && b.full > -60);
  if (!live.length) return null;
  const mean = (key) => dbOf(live.reduce((n, b) => n + 10 ** (b[key] / 10), 0) / live.length);
  const full = mean('full');
  return { speech: r3(mean('speech') - full), phone: r3(mean('phone') - full), busy: r3(live.reduce((n, b) => n + b.busy, 0) / live.length), level: r3(full) };
}

/** Dense in the speech band: nearly all of it sits there, or much of it does and it keeps moving. */
export const isDense = (fit) => Boolean(fit) && (fit.speech > FIT.denseAt || (fit.speech > FIT.busyDenseAt && fit.busy > FIT.busyMovesAt));

/**
 * How well a candidate serves: the catalog's rank, less what fights the voice or a phone can't play. Pure.
 * @param {{ relevance?: number, fit?: { speech: number, busy: number, phone: number, level?: number } | null, loop?: boolean, offStyle?: boolean }} opts
 */
export function trackScore({ relevance = 0, fit = null, loop = false, offStyle = false }) {
  let score = FIT.relevance * relevance - (loop ? FIT.loop : 0) - (offStyle ? FIT.offStyle : 0);
  if (fit) {
    score -= FIT.speech * Math.max(0, fit.speech - FIT.denseAt);
    score -= FIT.busy * Math.max(0, fit.busy - FIT.busyAt);
    score -= FIT.phone * Math.max(0, FIT.phoneAt - fit.phone);
    if (Number.isFinite(fit.level)) score -= FIT.quiet * Math.max(0, FIT.quietAt - fit.level);
  }
  return r3(score);
}

/** Decode `len` seconds from `at` into the three bands (one ffmpeg call; a URL fetches only those bytes). */
function decodeBands(src, at, len) {
  const [lo, hi] = SPEECH_BAND;
  const graph = `[0:a]aformat=sample_fmts=fltp:sample_rates=${MEASURE_RATE}:channel_layouts=mono,asplit=3[a][b][c];[b]highpass=f=${lo},highpass=f=${lo},lowpass=f=${hi},lowpass=f=${hi}[s];[c]highpass=f=${PHONE_FLOOR},highpass=f=${PHONE_FLOOR}[p];[a][s][p]amerge=inputs=3[out]`;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-t', String(len), '-i', src, '-filter_complex', graph, '-map', '[out]', '-f', 'f32le', '-'], { maxBuffer: 256 << 20, timeout: 90_000 });
  if (r.status !== 0 || !r.stdout?.length) return null;
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}

/**
 * A track's fit on the `section` [from, to] of reel time the reel plays it for: { speech, phone, busy, lead }.
 * Five-second blocks are cached per track in `cache`, so a track is only ever decoded once per stretch and any
 * later section reuses them. Null when nothing could be measured (the catalog's order decides). Never throws.
 * @param {string} id
 * @param {string} src
 * @param {readonly number[] | null} section
 * @param {{ cache?: Record<string, any>, decode?: (src: string, at: number, len: number) => Float32Array | null, lead?: (src: string) => number }} [opts]
 */
export function measureTrack(id, src, section, { cache = {}, decode = decodeBands, lead: leadOf = leadIn } = {}) {
  try {
    const entry = cache[id]?.v === MEASURE_VERSION ? cache[id] : { v: MEASURE_VERSION, lead: null, blocks: {} };
    cache[id] = entry;
    if (entry.lead == null) entry.lead = leadOf(src);
    const from = Math.floor(Math.max(0, section?.[0] ?? 0) / BLOCK_S);
    const to = Math.max(from + 1, Math.ceil((section?.[1] ?? BLOCK_S) / BLOCK_S));
    const missing = [];
    for (let i = from; i < to; i++) if (!entry.blocks[i]) missing.push(i);
    if (missing.length) {
      const first = missing[0];
      const last = missing[missing.length - 1];
      const samples = decode(src, entry.lead + first * BLOCK_S, (last - first + 1) * BLOCK_S);
      if (samples) analyseBands(samples).forEach((b, j) => { entry.blocks[first + j] = b; });
    }
    const blocks = [];
    for (let i = from; i < to; i++) if (entry.blocks[i]) blocks.push(entry.blocks[i]);
    const fit = sectionFit(blocks);
    return fit ? { ...fit, lead: entry.lead } : null;
  } catch {
    return null;
  }
}

/** The reel-time span a track plays across its segments, or null. */
export function sectionOf(plan, track) {
  const mine = plan.filter((s) => s.track === track);
  return mine.length ? [Math.min(...mine.map((s) => s.start)), Math.max(...mine.map((s) => s.end))] : null;
}

/**
 * Choose, fetch, fit and lay the music. `search(query)` and `download(url, dest)` are injectable for
 * tests and the smoke run; by default they are HeyGen's catalog search and download. `measure(track,
 * section)` returns a track's fit behind speech (measureTrack by default), or null.
 */
export async function placeMusic(root, { search, download, measure } = {}) {
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
  const noted = readJsonFile(avoidFile) ?? { used: 0, recent: [] };
  const ledger = typeof noted.ledger === 'string' ? noted.ledger : null;
  const job = typeof noted.job === 'string' ? noted.job : null;
  const injected = Boolean(search && download);
  if (!search || !download) {
    const h = await heygen(root);
    const headers = h.heygenAuthHeaders();
    search ??= (query) => h.searchSounds(query, 'music', headers, { limit: CATALOG_LIMIT });
    download ??= (url, dest) => h.downloadTo(url, dest);
  }
  const dir = join(root, 'assets', 'bgm');
  mkdirSync(dir, { recursive: true });
  const history = ledger && existsSync(ledger) ? readHistory(ledger, noted) : normalHistory(noted);
  const cacheFile = ledger ? join(dirname(ledger), 'reel-ai-drama-music-measures.json') : join(dir, 'measures.json');
  const cache = readJsonFile(cacheFile) ?? {};
  // Without injected fetchers the catalog's URLs are measured in place (only the bytes of the section).
  const local = new Map();
  const sourceOf = async (track) => {
    if (!injected) return track.audio_url;
    if (!local.has(trackId(track))) {
      const f = join(dir, `candidate-${local.size}.mp3`);
      await download(track.audio_url, f);
      local.set(trackId(track), f);
    }
    return local.get(trackId(track));
  };
  measure ??= async (track, section) => measureTrack(trackId(track), await sourceOf(track), section, { cache });

  // Each act's candidates: its style's tracks in the catalog's order, fresh ones first to be measured.
  const acts = [];
  for (let k = 0; k < needed; k++) {
    const order = styleOrder((history.used ?? 0) + k);
    const asked = [...STYLES, ...MOOD_STYLES].find((s) => s.key === styles[k]);
    const section = sectionOf(plan, k) ?? [0, total];
    const recent = new Set(recentIds(history, job));
    const candidates = [];
    for (const s of asked ? [asked, ...order.filter((o) => o.key !== asked.key)] : order) {
      let results = [];
      try {
        results = await search(s.query);
      } catch (e) {
        errors.push(`search "${s.key}": ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const ok = acceptable(results).filter((t) => Number(t.duration) >= Math.min(total + 1, MIN_LOOPABLE));
      const fresh = ok.filter((t) => !recent.has(trackId(t))).slice(0, FRESH_CANDIDATES);
      const again = ok.filter((t) => recent.has(trackId(t))).slice(0, REPEAT_CANDIDATES);
      for (const track of [...fresh, ...again]) {
        const loop = Number(track.duration) < total + 1;
        let fit = null;
        try {
          // A looped track plays from its start again: measure what's there.
          const span = section[1] - section[0];
          fit = await measure(track, section[0] >= Number(track.duration) - BLOCK_S ? [0, Math.min(span, Number(track.duration))] : section);
        } catch {
          fit = null; // the catalog's order decides
        }
        const relevance = 1 - ok.indexOf(track) / Math.max(1, ok.length);
        const score = trackScore({ relevance, fit, loop, offStyle: Boolean(asked) && s.key !== asked.key });
        candidates.push({ id: trackId(track), track, style: s, loop, fit, score });
      }
      if (fresh.length) break;
    }
    if (!candidates.length) return { ok: false, errors: [...errors, `no track passed for act ${k + 1} of a ${total}s reel in any style`], choice: null };
    acts.push({ candidates });
  }
  writeCache(cacheFile, cache);

  // The rotation's moment: read the history again (a parallel run may have just chosen), choose, write.
  let choices = [];
  let rotation = [];
  withLedger(ledger, () => {
    const now = ledger && existsSync(ledger) ? readHistory(ledger, noted) : normalHistory(noted);
    const chosen = chooseTracks(acts, { recent: recentIds(now, job) });
    choices = chosen.picks;
    rotation = chosen.notes;
    if (ledger) writeHistory(ledger, withReel(now, job, choices.map((c) => c.id)));
  });
  errors.push(...rotation);

  const picked = [];
  for (let k = 0; k < needed; k++) {
    const c = choices[k];
    const raw = join(dir, `source-${k}.mp3`);
    const have = local.get(c.id);
    if (have) {
      renameSync(have, raw);
      local.delete(c.id);
    } else await download(c.track.audio_url, raw);
    const file = join(dir, `track-${k}.mp3`);
    const fit = fitTrack(raw, c.track, c.loop, total, file, { section: sectionOf(plan, k), cut: isDense(c.fit) });
    if (fit.error) return { ok: false, errors: [...errors, fit.error], choice: null };
    picked.push({ id: c.id, name: c.track.name ?? null, style: c.style.key, query: c.style.query, looped: c.loop, file, ...fit, ...(c.fit ? { measured: { speech: c.fit.speech, busy: c.fit.busy, phone: c.fit.phone, level: c.fit.level } } : {}), score: r3(c.score), ...(c.repeat ? { repeat: true } : {}) });
  }
  for (const f of local.values()) rmSync(f, { force: true });
  const out = join(dir, 'track.mp3');
  const mixed = spawnSync('ffmpeg', mixMusicArgs(plan, picked.map((p) => p.file), total, out), { encoding: 'utf8' });
  if (mixed.status !== 0) return { ok: false, errors: [...errors, `ffmpeg (mix): ${String(mixed.stderr).trim().slice(0, 300)}`], choice: null };
  if (cued) {
    if (designed.muffles?.length) {
      const wet = muffleEnvelope(designed.muffles, total);
      const dryFile = join(dir, 'muffle-dry.wav');
      const wetFile = join(dir, 'muffle-wet.wav');
      writeFileSync(dryFile, envelopeWav(wet.map((k) => 1 - k)));
      writeFileSync(wetFile, envelopeWav(wet));
      const muffled = `${out}.muffle.mp3`;
      const mf = spawnSync('ffmpeg', applyMuffleArgs(out, dryFile, wetFile, total, muffled), { encoding: 'utf8' });
      rmSync(dryFile, { force: true });
      rmSync(wetFile, { force: true });
      if (mf.status !== 0) return { ok: false, errors: [...errors, `ffmpeg (muffle): ${String(mf.stderr).trim().slice(0, 300)}`], choice: null };
      renameSync(muffled, out);
    }
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
