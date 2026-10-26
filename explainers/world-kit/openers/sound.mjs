// The opener's sound (EX3-102). Deterministic, no model. Each opener in the bank has a score: its
// library sounds, a few synthesized breaks (ffmpeg aevalsrc), bits of the reel's own music bed
// (the loud bar before a scratch), and the moment the bed comes in (`bed`). The score is mixed
// into one stem, assets/sfx/opener-stem.wav, hung on frame 1 as a host sound; the bed stays
// silent until the opener's drop (assets/bgm/opened.mp3, the fitted bed with its start muted).
// The voice is not in the stem: pace.mjs already put the opener's lead before frame 1's line.
//
//   node assets/kit/opener-sfx.mjs      (runs placeOpener; after pace.mjs and music.mjs)
//
// Gains: library sounds are brought to one peak first (as sound.mjs does), so a gain means the
// same thing for every sound; music bits are relative to the bed (BED is the bed's own level).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { openerByKey, openerTiming, pickOpener } from './bank.js';

const REF_PEAK_DB = -6;
const MAX_BOOST_DB = 18;
/** The bed's level in a score; a clip of the bed at BED plays as loud as the bed itself. */
export const BED = 0.18;
export const BED_LOUD = 0.32;
const SR = 48000;
const r3 = (n) => Math.round(n * 1000) / 1000;

export const STEM = 'assets/sfx/opener-stem.wav';
export const OPENED_BED = 'assets/bgm/opened.mp3';
export const CHOICE = 'assets/opener.json';

// ── Synthesized breaks (commas escaped for the filtergraph) ──────────────────────────────────
const esc = (s) => s.replace(/,/g, '\\,');
export const SYNTH = {
  /** a sub-bass swell that rises in pitch and volume over d seconds */
  subSwell: (d) => ({ expr: esc(`0.9*sin(2*PI*(34*t+46*t*t))*pow(t/${d},2)`), dur: d }),
  /** a deep boom with a fast thump on top */
  boom: () => ({ expr: esc('0.95*sin(2*PI*46*t)*exp(-2.8*t)+0.6*sin(2*PI*92*t)*exp(-7*t)+0.35*(random(0)*2-1)*exp(-30*t)'), dur: 1.5 }),
  /** rubber stretching as a balloon takes a gulp of air: a buzzy rising tone */
  stretch: (d, f0 = 150, f1 = 260) => ({ expr: esc(`0.28*(sin(2*PI*(${f0}*t+${(f1 - f0) / 2 / d}*t*t+5*sin(2*PI*24*t)))+0.4*sin(4*PI*(${f0}*t+${(f1 - f0) / 2 / d}*t*t)))*pow(sin(PI*t/${d}),0.5)`), dur: d }),
};

const music = (at, { start = 0, dur = 8, gain = BED, ...o } = {}) => ({ src: 'music', at, start, dur, gain, ...o });
const sfx = (file, at, gain = 0.8, o = {}) => ({ src: file, at, gain, ...o });
const synth = (s, at, gain = 1, o = {}) => ({ synth: s, at, gain, ...o });
/** The moment the bed comes in (not a clip: the bed itself is unmuted there). */
const bed = (at) => ({ bed: true, at });
const HIT = (at, gain = 0.9) => [sfx('pixabay/impact-bass-2.mp3', at, gain), synth(SYNTH.boom(), at, 0.45)];

/** A record scratch made from the bed itself: fast forward and back over the same spot. */
function scratch(at, pos, gain = BED_LOUD * 1.6) {
  const moves = [[1.9, false, 0.07], [1.5, true, 0.08], [2.3, false, 0.06], [1.2, true, 0.1], [2.8, false, 0.05], [0.6, true, 0.09]];
  const out = [];
  let t = at;
  for (const [rate, reverse, len] of moves) {
    out.push(music(t, { start: pos, dur: len * rate, rate, reverse, gain, highpass: 180 }));
    t += len;
  }
  return out;
}

const TYPE_KEYS = ['freesound/typewriter/240839-1.mp3', 'freesound/typewriter/240839-2.mp3', 'freesound/typewriter/240839-3.mp3', 'freesound/typewriter/259498-1.mp3', 'freesound/typewriter/259498-2.mp3', 'freesound/typewriter/259498-3.mp3'];
const WOOD = (i) => `kenney/impact-sounds/Audio/impactWood_heavy_00${i % 5}.ogg`;
const SNIP = ['freesound/scissors/162901-1.mp3', 'freesound/scissors/51164-2.mp3', 'freesound/scissors/108453-2.mp3', 'freesound/scissors/51164-4.mp3', 'freesound/scissors/205103-3.mp3'];
const MARKER = 'freesound/marker-write/MARKER';
const SLIDE = 'freesound/paper-slide/SLIDE';

/** Each opener's score, from its timing (bank.js openerTiming). */
export const SCORES = {
  'paper-rip': (M) => [
    sfx('freesound/paper-crumple/173939-2.mp3', 0.05, 0.25),
    sfx('freesound/paper-tear/272028-1.mp3', M.breakAt - 0.06, 1.1, { dur: 0.8, fadeOut: 0.2 }),
    sfx('freesound/paper-tear/158526-6.mp3', M.breakAt, 0.8),
    sfx('pixabay/impact-bass-2.mp3', M.breakAt, 0.9),
    synth(SYNTH.boom(), M.breakAt, 0.5),
    bed(M.breakAt),
  ],
  'record-scratch': (M) => [
    music(0, { dur: M.breakAt, gain: BED_LOUD, fadeOut: 0.01 }),
    ...scratch(M.breakAt, M.breakAt - 0.05),
    sfx('freesound/sticky-note/474580-1.mp3', M.voiceAt, 1.0),
    sfx('kenney/impact-sounds/Audio/impactGeneric_light_002.ogg', M.voiceAt, 0.5),
    sfx(MARKER, M.voiceAt + 0.12, 0.6, { dur: 0.48, fadeOut: 0.1 }),
    sfx('pixabay/whoosh-short.mp3', M.unfreezeAt - 0.18, 0.5),
    sfx('pixabay/impact-bass-1.mp3', M.unfreezeAt, 0.8),
    bed(M.unfreezeAt),
  ],
  typewriter: (M) => [
    ...M.keys.map((k, i) => sfx(TYPE_KEYS[i % TYPE_KEYS.length], k, 0.85, { dur: 0.25, fadeOut: 0.05 })),
    sfx('pixabay/ping.mp3', M.breakAt, 0.9),
    sfx(SLIDE, M.dropAt, 0.8),
    sfx('pixabay/whoosh.mp3', M.dropAt, 0.5),
    sfx('pixabay/impact-bass-1.mp3', M.dropAt + 0.3, 0.6),
    bed(M.dropAt + 0.3),
  ],
  'big-bang': (M) => [
    synth(SYNTH.subSwell(M.breakAt), 0, 0.8),
    synth(SYNTH.boom(), M.breakAt, 0.9),
    sfx('pixabay/impact-bass-2.mp3', M.breakAt, 1.0),
    bed(M.breakAt),
  ],
  'knock-knock': (M) => [
    sfx('pixabay/whoosh-short.mp3', 0.0, 0.5),
    sfx('pixabay/pop.mp3', 0.12, 0.6),
    ...M.knocks.map((k, i) => sfx(`kenney/impact-sounds/Audio/impactGlass_light_00${i + 1}.ogg`, k, 1.1)),
    ...M.knocks.map((k) => sfx('kenney/impact-sounds/Audio/impactGeneric_light_001.ogg', k, 0.7)),
    sfx(MARKER, M.writeAt[0], 0.6, { dur: M.writeAt[1] - M.writeAt[0], fadeOut: 0.08 }),
    sfx('pixabay/whoosh.mp3', M.duck[0], 0.6),
    sfx('pixabay/impact-bass-1.mp3', M.duck[0] + 0.22, 0.7),
    bed(M.duck[0] + 0.22),
  ],
  'eye-zoom': (M) => [
    ...[0.0, 0.12, 0.26].map((at) => sfx('kenney/interface-sounds/Audio/tick_002.ogg', at, 0.45)),
    sfx('kenney/impact-sounds/Audio/impactSoft_medium_001.ogg', M.blink[0] + 0.05, 0.6),
    sfx('pixabay/whoosh.mp3', M.zoom[0] - 0.05, 0.9),
    sfx('pixabay/whoosh-short.mp3', M.zoom[0] + 0.15, 0.6),
    ...HIT(M.landAt, 1.0),
    bed(M.landAt),
  ],
  'balloon-pop': (M) => [
    ...M.gulps.map(([a, b], i) => synth(SYNTH.stretch(b - a, [140, 190, 260][i] ?? 260, [210, 290, 400][i] ?? 400), a, 0.9 + 0.05 * i)),
    sfx('pixabay/pop.mp3', M.breakAt, 1.4),
    ...HIT(M.breakAt, 1.0),
    sfx('freesound/paper-flutter/344370-3.mp3', M.breakAt + 0.04, 0.7),
    bed(M.breakAt),
  ],
  'block-drop': (M) => [
    ...M.lands.map((at, i) => sfx(WOOD(i), at, 0.75)),
    sfx('kenney/rpg-audio/Audio/creak2.ogg', M.wobble[0], 0.7, { dur: M.breakAt - M.wobble[0] + 0.05, fadeOut: 0.05 }),
    ...[0.12, 0.2, 0.3, 0.42].map((d, i) => sfx(`kenney/impact-sounds/Audio/impactWood_medium_00${i}.ogg`, M.breakAt + d, 0.6)),
    sfx('pixabay/impact-bass-1.mp3', M.breakAt, 0.85),
    bed(M.breakAt),
  ],
  unboxing: (M) => [
    sfx('kenney/rpg-audio/Audio/knifeSlice.ogg', M.cut[0], 0.8),
    sfx('freesound/tape/369915-2.mp3', M.cut[0] + 0.08, 0.6, { dur: M.cut[1] - M.cut[0], fadeOut: 0.05 }),
    sfx('freesound/cardboard/135014-1.mp3', M.open[0], 1.0),
    sfx('freesound/cardboard/95561-1.mp3', M.open[0] + 0.03, 0.8),
    sfx('freesound/cardboard/364932-1.mp3', M.open[0] + 0.14, 0.6),
    sfx('pixabay/whoosh.mp3', M.dive[0], 0.7),
    ...HIT(M.dive[1], 0.9),
    bed(M.open[0]),
  ],
  'paper-plane': (M) => [
    sfx('freesound/paper-throw/445977-1.mp3', 0.0, 0.9),
    sfx('pixabay/whoosh-short.mp3', M.breakAt - 0.22, 0.6),
    sfx('kenney/impact-sounds/Audio/impactSoft_heavy_001.ogg', M.breakAt, 1.1),
    sfx('freesound/paper-crumple/106127-2.mp3', M.breakAt, 0.7, { dur: 0.3, fadeOut: 0.08 }),
    sfx('pixabay/impact-bass-1.mp3', M.breakAt, 0.85),
    sfx('freesound/paper-fold/367683-2.mp3', M.unfold[0], 0.8, { dur: 0.5, fadeOut: 0.1 }),
    sfx('freesound/tape/369915-3.mp3', M.peel[0], 0.6),
    sfx('freesound/paper-flutter/382654-4.mp3', M.peel[0] + 0.1, 0.6),
    bed(M.breakAt),
  ],
  scissors: (M) => [
    ...M.snips.map((at, i) => sfx(SNIP[i % SNIP.length], at - 0.02, 0.75)),
    sfx('freesound/paper-flutter/320149-2.mp3', M.lift[0], 0.6),
    sfx(SLIDE, M.lift[0] + 0.08, 0.6),
    sfx('pixabay/whoosh-short.mp3', M.drop[0], 0.5),
    sfx('pixabay/pop.mp3', M.drop[1], 0.8),
    sfx('pixabay/impact-bass-1.mp3', M.drop[1], 0.8),
    bed(M.lift[0]),
  ],
};

/** Opener `key`'s score for timing M: { clips (the stem), bedAt (when the bed comes in) }. */
export function openerScore(key, M) {
  const score = SCORES[key];
  if (!score) throw new Error(`no score for opener "${key}"`);
  const all = score(M);
  const entry = all.find((c) => c.bed);
  return { clips: all.filter((c) => !c.bed), bedAt: r3(entry ? entry.at : M.breakAt) };
}

/** The library catalog's file for a folder named by a placeholder ('freesound/marker-write/MARKER'). */
export function resolveFile(file, catalog) {
  if (!/\/[A-Z]+$/.test(file)) return file;
  const dir = file.replace(/\/[A-Z]+$/, '/');
  return catalog.find((s) => s.file.startsWith(dir) && !/bed/.test(s.file))?.file ?? catalog.find((s) => s.file.startsWith(dir))?.file ?? file;
}

/**
 * The ffmpeg arguments that mix `clips` into a stereo WAV of `duration` seconds. `paths`: { sfx
 * (the library root), music (the bed) }; `catalog` gives each library sound's peak; `bedScale`
 * turns a music clip's score gain into the reel's (the bed's volume over BED).
 */
export function mixArgs(clips, duration, out, paths, catalog = [], bedScale = 1) {
  const peaks = new Map(catalog.map((s) => [s.file, s.peakDb]));
  const args = ['-v', 'error', '-y'];
  const chains = [];
  clips.forEach((c, i) => {
    if (c.synth) {
      args.push('-f', 'lavfi', '-t', String(c.synth.dur), '-i', `aevalsrc=exprs=${c.synth.expr}:s=${SR}`);
    } else {
      const file = c.src === 'music' ? paths.music : join(paths.sfx, resolveFile(c.src, catalog));
      if (c.start) args.push('-ss', String(c.start));
      if (c.dur) args.push('-t', String(c.dur));
      args.push('-i', file);
    }
    let gain = c.gain ?? 1;
    if (c.src === 'music') gain *= bedScale;
    else if (!c.synth) {
      const peak = peaks.get(resolveFile(c.src, catalog));
      if (Number.isFinite(peak)) gain *= Math.pow(10, Math.min(MAX_BOOST_DB, REF_PEAK_DB - peak) / 20);
    }
    const f = [`aformat=sample_rates=${SR}:channel_layouts=stereo`];
    if (c.reverse) f.push('areverse');
    if (c.rate && c.rate !== 1) f.push(`asetrate=${Math.round(SR * c.rate)}`, `aresample=${SR}`);
    if (c.highpass) f.push(`highpass=f=${c.highpass}`);
    if (c.lowpass) f.push(`lowpass=f=${c.lowpass}`);
    if (c.fadeIn) f.push(`afade=t=in:d=${c.fadeIn}`);
    if (c.fadeOut && c.dur) f.push(`afade=t=out:st=${Math.max(0, c.dur / (c.rate ?? 1) - c.fadeOut).toFixed(3)}:d=${c.fadeOut}`);
    f.push(`volume=${gain.toFixed(4)}`);
    const ms = Math.max(0, Math.round(c.at * 1000));
    f.push(`adelay=${ms}|${ms}`);
    chains.push(`[${i}:a]${f.join(',')}[c${i}]`);
  });
  const mix = `${clips.map((_, i) => `[c${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:duration=longest,atrim=0:${duration},apad=whole_dur=${duration},alimiter=limit=0.95[out]`;
  args.push('-filter_complex', `${chains.join(';')};${mix}`, '-map', '[out]', '-ar', String(SR), out);
  return args;
}

/** The opener chosen for the project at `root` (assets/opener.json), or null. */
export function chosenOpener(root) {
  const file = join(root, CHOICE);
  if (!existsSync(file)) return null;
  try {
    const key = JSON.parse(readFileSync(file, 'utf8'))?.key;
    return openerByKey(key) ? key : null;
  } catch {
    return null;
  }
}

/**
 * The project's opener, drawing one (with no history) when the job did not: a worker started
 * before the bank existed still gets a frame 1 that matches the frame worker's instructions. A
 * project whose frame 1 the worker already built (from before the bank) keeps it: null.
 */
export function ensureOpener(root, rand = Math.random) {
  const key = chosenOpener(root);
  if (key) return key;
  if (existsSync(join(root, 'assets', 'frames', '01-opener.js'))) return null;
  const pick = pickOpener([], { rand });
  writeFileSync(join(root, CHOICE), `${JSON.stringify({ key: pick, name: openerByKey(pick).name, by: 'pace' }, null, 1)}\n`);
  return pick;
}

/** Frame 1's line without the opener's lead: { voice (seconds), words (from the line's start) }. */
export function openerLine(meta) {
  const v = (meta?.voices ?? []).find((x) => Number(x.frame) === 1);
  if (!v) return null;
  const lead = Number(v.lead_s) || 0;
  const words = (v.words ?? []).map((w) => ({ text: w.text, start: r3(w.start - lead), end: r3(w.end - lead) }));
  return { voice: r3((Number(v.duration_s) || 0) - lead), words };
}

/** True when audio_meta.json already carries the opener's stem. */
export const hasOpenerStem = (meta) => (meta?.sfx ?? []).some((s) => s?.source === 'host' && s.role === 'opener-stem');

/** Mix and place the opener's sound for the project at `root`. */
export function placeOpener(root, { ffmpeg = 'ffmpeg' } = {}) {
  const key = chosenOpener(root);
  if (!key) return { ok: false, errors: [`${CHOICE} names no opener in the bank`], sfx: [] };
  const metaFile = join(root, 'audio_meta.json');
  if (!existsSync(metaFile)) return { ok: false, errors: ['audio_meta.json is missing'], sfx: [] };
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  const line = openerLine(meta);
  if (!line || !(line.voice > 0)) return { ok: false, errors: ['frame 1 has no voice in audio_meta.json'], sfx: [] };
  const M = openerTiming(key, line.voice, line.words);
  const { clips, bedAt } = openerScore(key, M);
  const library = join(root, 'assets', 'sfx-library');
  const catalogFile = join(library, 'catalog.json');
  const catalog = existsSync(catalogFile) ? JSON.parse(readFileSync(catalogFile, 'utf8')) : [];
  const errors = [];

  // The bed: the fitted track, silent until the drop (kept beside the original, rebuilt each run).
  const source = meta.bgm?.source_path ?? meta.bgm?.path ?? null;
  const bedFile = source ? join(root, source) : null;
  if (bedFile && existsSync(bedFile)) {
    const tmp = join(root, `${OPENED_BED}.tmp.mp3`);
    const r = spawnSync(ffmpeg, ['-v', 'error', '-y', '-i', bedFile, '-af', `volume=enable='lt(t,${bedAt})':volume=0,afade=t=in:st=${bedAt}:d=0.02`, '-c:a', 'libmp3lame', '-q:a', '2', tmp], { encoding: 'utf8' });
    if (r.status === 0) {
      renameSync(tmp, join(root, OPENED_BED));
      meta.bgm = { ...meta.bgm, source_path: source, path: OPENED_BED, opener_bed_at: bedAt };
    } else errors.push(`the bed's drop failed: ${String(r.stderr).trim().slice(0, 300)}`);
  }

  // The stem: everything but the voice and the bed.
  const bedScale = (Number(meta.bgm?.volume) || BED) / BED;
  const hasMusic = clips.some((c) => c.src === 'music');
  const playable = clips.filter((c) => c.src !== 'music' || (bedFile && existsSync(bedFile)));
  if (hasMusic && playable.length < clips.length) errors.push('the score plays the bed, and the reel has none: its music bits are left out');
  const out = join(root, STEM);
  const tmp = `${out}.tmp.wav`;
  const r = spawnSync(ffmpeg, mixArgs(playable, M.duration, tmp, { sfx: library, music: bedFile }, catalog, bedScale), { encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, errors: [...errors, `the opener stem failed: ${String(r.stderr).trim().slice(0, 400)}`], sfx: [] };
  renameSync(tmp, out);
  const entry = { frame: 1, file: STEM, offset_s: 0, duration_s: M.duration, volume: 1, source: 'host', role: 'opener-stem', opener: key };
  meta.sfx = [entry, ...(meta.sfx ?? []).filter((s) => !(s?.source === 'host' && /^opener-/.test(s.role ?? '')))];
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 1)}\n`);
  return { ok: errors.length === 0, errors, sfx: [entry], opener: key, bedAt };
}

