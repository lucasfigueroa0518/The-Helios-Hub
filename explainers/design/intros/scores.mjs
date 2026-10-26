// The openers' sound (2026-10-19): each score lists clips on the opener's clock. A clip is a slice
// of the voice, the music bed, a library sound (by its path under explainers/design/sfx), or a
// synthesized sound; mixArgs turns a score into one ffmpeg call that writes a WAV.
//
// Library sounds are brought to the same peak first (as sound.mjs does), so gains mean the same
// thing across sounds. The bed sits at BED under the voice, as in a reel; a "loud" bed before a
// break is BED_LOUD.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CATALOG = JSON.parse(readFileSync(join(here, '..', 'sfx', 'catalog.json'), 'utf8'));
const PEAK = new Map(CATALOG.map((s) => [s.file, s.peakDb]));
const REF_PEAK_DB = -6;
const MAX_BOOST_DB = 18;
export const BED = 0.18;
export const BED_LOUD = 0.32;
const SR = 48000;

// ── Synthesized breaks (ffmpeg aevalsrc; commas escaped for the filtergraph) ─────────────────
const esc = (s) => s.replace(/,/g, '\\,');
export const SYNTH = {
  /** a sub-bass swell that rises in pitch and volume over d seconds */
  subSwell: (d) => ({ expr: esc(`0.9*sin(2*PI*(34*t+46*t*t))*pow(t/${d},2)`), dur: d }),
  /** a deep boom with a fast thump on top */
  boom: () => ({ expr: esc('0.95*sin(2*PI*46*t)*exp(-2.8*t)+0.6*sin(2*PI*92*t)*exp(-7*t)+0.35*(random(0)*2-1)*exp(-30*t)'), dur: 1.5 }),
  /** a rapid clatter of flaps that thins out */
  clatter: (d, every = 0.03) => ({ expr: esc(`if(lt(mod(t,${every}),0.006),(random(0)*2-1)*0.55*(1-0.5*t/${d}),0)`), dur: d }),
  /** tape hiss under a rewind */
  hiss: (d) => ({ expr: esc('0.12*(random(0)*2-1)'), dur: d }),
  /** a breath on glass: soft noise that swells and fades (low-passed in the clip) */
  breath: (d) => ({ expr: esc(`0.7*(random(0)*2-1)*pow(sin(PI*t/${d}),1.5)`), dur: d }),
  /** a squeak on glass: a fast rising chirp with a wobble */
  squeak: (d, f0 = 1100, f1 = 1700) => ({ expr: esc(`0.32*sin(2*PI*(${f0}*t+${(f1 - f0) / 2 / d}*t*t+6*sin(2*PI*31*t)))*pow(sin(PI*t/${d}),0.6)`), dur: d }),
  /** rubber stretching as a balloon takes a gulp of air: a buzzy rising tone */
  stretch: (d, f0 = 150, f1 = 260) => ({ expr: esc(`0.28*(sin(2*PI*(${f0}*t+${(f1 - f0) / 2 / d}*t*t+5*sin(2*PI*24*t)))+0.4*sin(4*PI*(${f0}*t+${(f1 - f0) / 2 / d}*t*t)))*pow(sin(PI*t/${d}),0.5)`), dur: d }),
};

/** A clip of the music bed. */
const music = (at, { start = 0, dur = 8, gain = BED, ...o } = {}) => ({ src: 'music', at, start, dur, gain, ...o });
/** A library sound. */
const sfx = (file, at, gain = 0.8, o = {}) => ({ src: file, at, gain, ...o });
/** A synthesized sound. */
const synth = (s, at, gain = 1, o = {}) => ({ synth: s, at, gain, ...o });

/** A tape stop: the bed from `pos` slows to a halt over `len` seconds, in pieces. */
function tapeStop(at, pos, len = 0.45, gain = BED_LOUD) {
  const n = 9;
  const out = [];
  let src = pos;
  for (let i = 0; i < n; i++) {
    const rate = 1 - ((i + 0.5) / n) * 0.88;
    const outDur = len / n;
    out.push(music(at + i * outDur, { start: src, dur: outDur * rate, rate, gain: gain * (1 - i / n) }));
    src += outDur * rate;
  }
  return out;
}

/** A record scratch made from the bed itself: fast forward and back over the same spot. */
function scratch(at, pos, gain = BED_LOUD * 1.6) {
  const moves = [[1.9, false, 0.07], [1.5, true, 0.08], [2.3, false, 0.06], [1.2, true, 0.1], [2.8, false, 0.05], [0.6, true, 0.09]];
  const out = [];
  let t = at;
  for (const [rate, rev, len] of moves) {
    out.push(music(t, { start: pos, dur: len * rate, rate, reverse: rev, gain, highpass: 180 }));
    t += len;
  }
  return out;
}

const WOOD = (i) => `kenney/impact-sounds/Audio/impactWood_heavy_00${i % 5}.ogg`;
const SNIP = ['freesound/scissors/162901-1.mp3', 'freesound/scissors/51164-2.mp3', 'freesound/scissors/108453-2.mp3', 'freesound/scissors/51164-4.mp3', 'freesound/scissors/205103-3.mp3'];
const HIT = (at, gain = 0.9) => [sfx('pixabay/impact-bass-2.mp3', at, gain), synth(SYNTH.boom(), at, 0.45)];

const TYPE_KEYS = ['freesound/typewriter/240839-1.mp3', 'freesound/typewriter/240839-2.mp3', 'freesound/typewriter/240839-3.mp3', 'freesound/typewriter/259498-1.mp3', 'freesound/typewriter/259498-2.mp3', 'freesound/typewriter/259498-3.mp3'];

export const SCORES = {
  '01-rip': (M) => [
    { src: 'voice', at: M.voiceAt, gain: 1 },
    sfx('freesound/paper-crumple/173939-2.mp3', 0.05, 0.25),
    sfx('freesound/paper-tear/272028-1.mp3', M.breakAt - 0.06, 1.1, { dur: 0.8, fadeOut: 0.2 }),
    sfx('freesound/paper-tear/158526-6.mp3', M.breakAt, 0.8),
    sfx('pixabay/impact-bass-2.mp3', M.breakAt, 0.9),
    synth(SYNTH.boom(), M.breakAt, 0.5),
    music(M.breakAt, { gain: BED }),
  ],
  '02-freeze': (M) => [
    music(0, { dur: M.breakAt, gain: BED_LOUD, fadeOut: 0.01 }),
    ...scratch(M.breakAt, M.breakAt - 0.05),
    { src: 'voice', at: M.voiceAt, gain: 1 },
    sfx('freesound/sticky-note/474580-1.mp3', M.voiceAt, 1.0),
    sfx('kenney/impact-sounds/Audio/impactGeneric_light_002.ogg', M.voiceAt, 0.5),
    sfx('freesound/marker-write/' + 'MARKER', M.voiceAt + 0.12, 0.6, { dur: 0.48, fadeOut: 0.1 }),
    sfx('pixabay/whoosh-short.mp3', M.unfreezeAt - 0.18, 0.5),
    sfx('pixabay/impact-bass-1.mp3', M.unfreezeAt, 0.8),
    music(M.unfreezeAt, { start: M.breakAt, gain: BED }),
  ],
  '03-stamp': (M) => [
    sfx('pixabay/whoosh-short.mp3', 0.12, 0.55),
    sfx('freesound/stamp/470710-1.mp3', M.breakAt, 1.2),
    sfx('pixabay/impact-bass-2.mp3', M.breakAt, 1.0),
    synth(SYNTH.boom(), M.breakAt, 0.55),
    music(M.breakAt, { gain: BED }),
    { src: 'voice', at: M.voiceAt, gain: 1 },
    sfx('pixabay/whoosh-cinematic.mp3', 0.9, 0.45, { dur: 0.7, fadeOut: 0.25 }),
  ],
  '04-type': (M) => [
    { src: 'voice', at: M.voiceAt, gain: 1 },
    ...M.keys.map((k, i) => sfx(TYPE_KEYS[i % TYPE_KEYS.length], k, 0.85, { dur: 0.25, fadeOut: 0.05 })),
    sfx('pixabay/ping.mp3', M.breakAt, 0.9),
    sfx('freesound/paper-slide/' + 'SLIDE', M.dropAt, 0.8),
    sfx('pixabay/whoosh.mp3', M.dropAt, 0.5),
    sfx('pixabay/impact-bass-1.mp3', M.dropAt + 0.3, 0.6),
    music(M.dropAt + 0.3, { gain: BED }),
  ],
  '05-glitch': (M) => [
    synth(SYNTH.hiss(M.breakAt), 0, 0.9),
    sfx('pixabay/glitch-1.mp3', 0.0, 0.8),
    sfx('pixabay/glitch-2.mp3', 0.18, 0.8),
    sfx('pixabay/glitch-3.mp3', 0.36, 0.8),
    ...[0.08, 0.22, 0.3, 0.44, 0.5].map((at, i) => music(at, { start: 0.3 + i * 0.01, dur: 0.06, gain: BED_LOUD, fadeOut: 0.005 })),
    sfx('kenney/interface-sounds/Audio/click_001.ogg', M.breakAt, 1.0),
    sfx('pixabay/impact-bass-1.mp3', M.breakAt, 0.9),
    music(M.breakAt, { gain: BED }),
    { src: 'voice', at: M.voiceAt, gain: 1 },
  ],
  '06-bang': (M) => [
    synth(SYNTH.subSwell(M.breakAt), 0, 0.8),
    synth(SYNTH.boom(), M.breakAt, 0.9),
    sfx('pixabay/impact-bass-2.mp3', M.breakAt, 1.0),
    music(M.breakAt, { gain: BED }),
    { src: 'voice', at: M.voiceAt, gain: 1 },
  ],
  '07-knock': (M) => [
    sfx('pixabay/whoosh-short.mp3', 0.0, 0.5),
    sfx('pixabay/pop.mp3', 0.12, 0.6),
    ...M.knocks.map((k, i) => sfx(`kenney/impact-sounds/Audio/impactGlass_light_00${i + 1}.ogg`, k, 1.1)),
    ...M.knocks.map((k) => sfx('kenney/impact-sounds/Audio/impactGeneric_light_001.ogg', k, 0.7)),
    { src: 'voice', at: M.voiceAt, gain: 1 },
    sfx('freesound/marker-write/' + 'MARKER', M.writeAt[0], 0.6, { dur: M.writeAt[1] - M.writeAt[0], fadeOut: 0.08 }),
    sfx('pixabay/whoosh.mp3', M.duckAt, 0.6),
    sfx('pixabay/impact-bass-1.mp3', M.duckAt + 0.22, 0.7),
    music(M.duckAt + 0.22, { gain: BED }),
  ],
  '08-flap': (M) => [
    synth(SYNTH.clatter(M.clatter[1], 0.028), 0, 0.9),
    sfx('kenney/rpg-audio/Audio/bookFlip2.ogg', 0.4, 0.5),
    { src: 'voice', at: M.voiceAt, gain: 1 },
    sfx('pixabay/chime.mp3', M.chimeAt, 0.8),
    synth(SYNTH.clatter(M.flip[1] - M.flip[0], 0.04), M.flip[0], 0.7),
    sfx('pixabay/impact-bass-1.mp3', M.flip[1] - 0.1, 0.7),
    music(M.flip[1] - 0.1, { gain: BED }),
  ],
  '09-rewind': (M) => [
    music(0, { start: 18, dur: M.tapeStop[0], gain: BED_LOUD, fadeOut: 0.01 }),
    ...tapeStop(M.tapeStop[0], 18 + M.tapeStop[0], M.tapeStop[1] - M.tapeStop[0]),
    music(M.rewind[0], { start: 16.5, dur: (M.rewind[1] - M.rewind[0]) * 3.2, rate: 3.2, reverse: true, gain: BED_LOUD * 0.9, highpass: 400 }),
    synth(SYNTH.hiss(M.rewind[1] - M.rewind[0]), M.rewind[0], 1),
    sfx('pixabay/impact-bass-2.mp3', M.slamAt, 1.0),
    synth(SYNTH.boom(), M.slamAt, 0.5),
    music(M.slamAt, { gain: BED }),
    { src: 'voice', at: M.voiceAt, gain: 1 },
  ],
  '10-lights': (M) => [
    music(0, { dur: M.breakAt, gain: BED_LOUD, fadeOut: 0.008 }),
    sfx('kenney/interface-sounds/Audio/switch_002.ogg', M.clickAt, 1.1),
    { src: 'voice', at: M.voiceAt, gain: 1 },
    sfx('freesound/chalk-write/264944-1-bed.mp3', M.chalk[0], 0.7, { dur: M.chalk[1] - M.chalk[0], fadeOut: 0.06 }),
    sfx('kenney/interface-sounds/Audio/switch_003.ogg', M.lightsAt - 0.02, 0.8),
    sfx('pixabay/impact-bass-1.mp3', M.lightsAt, 0.9),
    music(M.lightsAt, { start: M.breakAt, gain: BED }),
  ],
  // ── batch 2 ──
  '11-fog': (M) => [
    synth(SYNTH.breath(0.34), 0, 0.9, { lowpass: 1400 }),
    ...M.wipes.flatMap(([a, b]) => [synth(SYNTH.squeak((b - a) / 2), a), synth(SYNTH.squeak((b - a) / 2, 1500, 1050), a + (b - a) / 2, 0.9)]),
    sfx('pixabay/impact-bass-1.mp3', M.breakAt, 0.85),
    music(M.breakAt, { gain: BED }),
    { src: 'voice', at: M.voiceAt, gain: 1 },
    synth(SYNTH.squeak(M.writeAt[1] - M.writeAt[0], 1900, 2300), M.writeAt[0], 0.22),
    sfx('pixabay/whoosh-short.mp3', M.clearAt[0], 0.55),
  ],
  '12-eye': (M) => [
    ...[0.0, 0.12, 0.26].map((at) => sfx('kenney/interface-sounds/Audio/tick_002.ogg', at, 0.45)),
    sfx('kenney/impact-sounds/Audio/impactSoft_medium_001.ogg', M.blinkAt + 0.05, 0.6),
    sfx('pixabay/whoosh.mp3', M.breakAt - 0.05, 0.9),
    sfx('pixabay/whoosh-short.mp3', M.breakAt + 0.15, 0.6),
    ...HIT(M.landAt, 1.0),
    music(M.landAt, { gain: BED }),
    { src: 'voice', at: M.voiceAt, gain: 1 },
  ],
  '13-sketch': (M) => [
    sfx('freesound/pencil-write/82610-1-bed.mp3', M.drawAt[0], 0.9, { dur: (M.drawAt[1] - M.drawAt[0] + 0.05) * 1.3, rate: 1.3, fadeOut: 0.04 }),
    sfx('freesound/pencil-write/17860-1-bed.mp3', M.drawAt[0], 0.5, { dur: (M.drawAt[1] - M.drawAt[0] + 0.05) * 1.15, rate: 1.15, fadeOut: 0.04 }),
    ...HIT(M.breakAt),
    music(M.breakAt, { gain: BED }),
    { src: 'voice', at: M.voiceAt, gain: 1 },
  ],
  '14-balloon': (M) => [
    synth(SYNTH.stretch(0.2, 140, 210), 0.0, 0.9),
    synth(SYNTH.stretch(0.2, 190, 290), 0.24, 0.95),
    synth(SYNTH.stretch(0.22, 260, 400), 0.46, 1.0),
    sfx('pixabay/pop.mp3', M.breakAt, 1.4),
    ...HIT(M.breakAt, 1.0),
    sfx('freesound/paper-flutter/344370-3.mp3', M.breakAt + 0.04, 0.7),
    music(M.breakAt, { gain: BED }),
    { src: 'voice', at: M.voiceAt, gain: 1 },
  ],
  '15-blocks': (M) => [
    { src: 'voice', at: M.voiceAt, gain: 1 },
    ...M.lands.map((at, i) => sfx(WOOD(i), at, 0.75)),
    sfx('kenney/rpg-audio/Audio/creak2.ogg', M.wobbleAt, 0.7, { dur: M.breakAt - M.wobbleAt + 0.05, fadeOut: 0.05 }),
    ...[0.12, 0.2, 0.3, 0.42].map((d, i) => sfx(`kenney/impact-sounds/Audio/impactWood_medium_00${i}.ogg`, M.breakAt + d, 0.6)),
    sfx('pixabay/impact-bass-1.mp3', M.breakAt, 0.85),
    music(M.breakAt, { gain: BED }),
  ],
  '16-popup': (M) => [
    sfx('kenney/rpg-audio/Audio/bookFlip3.ogg', 0.08, 0.35),
    sfx('kenney/rpg-audio/Audio/bookOpen.ogg', M.breakAt, 1.0),
    sfx('kenney/impact-sounds/Audio/impactSoft_heavy_000.ogg', M.breakAt + 0.04, 0.9),
    ...M.pops.map((at, i) => sfx(['freesound/paper-fold/234886-5.mp3', 'freesound/paper-fold/133975-3.mp3', 'freesound/paper-fold/398896-1.mp3', 'freesound/paper-fold/466350-1.mp3'][i % 4], at, 0.9)),
    sfx('pixabay/pop.mp3', M.pops[M.pops.length - 1] + 0.05, 0.6),
    sfx('pixabay/impact-bass-1.mp3', M.pops[M.pops.length - 1] + 0.05, 0.7),
    music(M.breakAt, { gain: BED }),
    { src: 'voice', at: M.voiceAt, gain: 1 },
  ],
  '17-box': (M) => [
    sfx('kenney/rpg-audio/Audio/knifeSlice.ogg', M.cutAt[0], 0.8),
    sfx('freesound/tape/369915-2.mp3', M.cutAt[0] + 0.08, 0.6, { dur: M.cutAt[1] - M.cutAt[0], fadeOut: 0.05 }),
    sfx('freesound/cardboard/135014-1.mp3', M.breakAt, 1.0),
    sfx('freesound/cardboard/95561-1.mp3', M.breakAt + 0.03, 0.8),
    sfx('freesound/cardboard/364932-1.mp3', M.breakAt + 0.14, 0.6),
    sfx('pixabay/whoosh.mp3', M.diveAt[0], 0.7),
    ...HIT(M.diveAt[1], 0.9),
    music(M.breakAt, { gain: BED }),
    { src: 'voice', at: M.voiceAt, gain: 1 },
  ],
  '18-eraser': (M) => [
    ...M.strokes.map(([a, b]) => sfx('freesound/eraser/271470-1-bed.mp3', a, 0.85, { dur: (b - a) * 1.2, rate: 1.2, fadeOut: 0.04 })),
    ...M.strokes.map(([a, b]) => sfx('freesound/eraser/119143-1-bed.mp3', a, 0.35, { start: 1, dur: b - a, fadeOut: 0.04 })),
    sfx('pixabay/whoosh-short.mp3', M.breakAt - 0.1, 0.5),
    ...HIT(M.breakAt),
    music(M.breakAt, { gain: BED }),
    { src: 'voice', at: M.voiceAt, gain: 1 },
  ],
  '19-plane': (M) => [
    sfx('freesound/paper-throw/445977-1.mp3', 0.0, 0.9),
    sfx('pixabay/whoosh-short.mp3', M.breakAt - 0.22, 0.6),
    sfx('kenney/impact-sounds/Audio/impactSoft_heavy_001.ogg', M.breakAt, 1.1),
    sfx('freesound/paper-crumple/106127-2.mp3', M.breakAt, 0.7, { dur: 0.3, fadeOut: 0.08 }),
    sfx('pixabay/impact-bass-1.mp3', M.breakAt, 0.85),
    sfx('freesound/paper-fold/367683-2.mp3', M.unfoldAt, 0.8, { dur: 0.5, fadeOut: 0.1 }),
    sfx('freesound/tape/369915-3.mp3', M.peelAt, 0.6),
    sfx('freesound/paper-flutter/382654-4.mp3', M.peelAt + 0.1, 0.6),
    music(M.breakAt, { gain: BED }),
    { src: 'voice', at: M.voiceAt, gain: 1 },
  ],
  '20-scissors': (M) => [
    { src: 'voice', at: M.voiceAt, gain: 1 },
    ...M.snips.map((at, i) => sfx(SNIP[i % SNIP.length], at - 0.02, 0.75)),
    sfx('freesound/paper-flutter/320149-2.mp3', M.breakAt, 0.6),
    sfx('freesound/paper-slide/' + 'SLIDE', M.breakAt + 0.08, 0.6),
    sfx('pixabay/whoosh-short.mp3', M.dropAt[0], 0.5),
    sfx('pixabay/pop.mp3', M.dropAt[1], 0.8),
    sfx('pixabay/impact-bass-1.mp3', M.dropAt[1], 0.8),
    music(M.breakAt, { gain: BED }),
  ],
};

/** First catalog file of a folder whose name was left as a placeholder (e.g. 'freesound/marker-write/MARKER'). */
function resolveFile(file) {
  if (!/\/[A-Z]+$/.test(file)) return file;
  const dir = file.replace(/\/[A-Z]+$/, '/');
  return CATALOG.find((s) => s.file.startsWith(dir) && !/bed/.test(s.file))?.file ?? CATALOG.find((s) => s.file.startsWith(dir)).file;
}

/** The ffmpeg arguments that mix a score into a stereo WAV of `duration` seconds. */
export function mixArgs(score, duration, out, paths) {
  const args = ['-v', 'error', '-y'];
  const chains = [];
  score.forEach((c, i) => {
    if (c.synth) {
      args.push('-f', 'lavfi', '-t', String(c.synth.dur), '-i', `aevalsrc=exprs=${c.synth.expr}:s=${SR}`);
    } else {
      const file = c.src === 'voice' ? paths.voice : c.src === 'music' ? paths.music : join(paths.sfx, resolveFile(c.src));
      if (c.start) args.push('-ss', String(c.start));
      if (c.dur) args.push('-t', String(c.dur));
      args.push('-i', file);
    }
    let gain = c.gain ?? 1;
    if (!c.synth && c.src !== 'voice' && c.src !== 'music') {
      const peak = PEAK.get(resolveFile(c.src));
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
  const mix = `${score.map((_, i) => `[c${i}]`).join('')}amix=inputs=${score.length}:normalize=0:duration=longest,atrim=0:${duration},apad=whole_dur=${duration},alimiter=limit=0.95[out]`;
  args.push('-filter_complex', `${chains.join(';')};${mix}`, '-map', '[out]', '-ar', String(SR), out);
  return args;
}
