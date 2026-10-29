// Event-timed sound design for Reel AI Drama, forked from the news kit's sound.mjs (Explainers 3.1,
// EX3-63). Deterministic, no model. What is new: `ambience` (D-47: a still gets a full sound world, the
// place's bed under it as well as foley on its actions) and the record rule (D-48: no sound may imply
// an event the record doesn't show; a sound that names an event must say which asset shows it).
//
// Frame workers declare every moment of motion in assets/frames/<frame id>.events.json:
//   [{ "t": 0.42, "kind": "impact" }, { "t": 1.1, "kind": "foley", "what": "footstep" },
//    { "t": 2.0, "kind": "foley", "what": "pencil writing", "dur": 1.4 },
//    { "t": 0, "kind": "ambience", "what": "office room tone", "dur": 5.2 }, …]
// in frame time; `dur` makes a continuous action (writing, erasing, rustling) last exactly that
// long. This turns them into reel time (STORYBOARD.md durations), resolves each to a sound in our
// library (assets/sfx-library/catalog.json: Kenney CC0, Pixabay, and the Freesound CC0 paper, pen
// and writing set, whose continuous actions are tagged `sustain`), level-matches
// them, turns effects under speech down 6 dB (ambience is already a low bed and stays), and premixes
// one track, assets/sfx/events.wav,
// placed in audio_meta.json as a host entry on frame 1. Run it after mount and try.
//
// Designed cues (MD-61): when the sound-designer step wrote sound_cues.json, its stingers (hit, sub,
// riser, whoosh, silence) and ambience beds join the frame workers' events, and the design leads: its
// ambience replaces the workers' ambience, a worker impact within HEAVY_GAP of a designed hit goes,
// and nothing but room tone plays inside a designed silence. Cue times: a hit or sub's `t` is the
// impact, a riser's `t` is where it lands (it starts `dur` earlier), a whoosh's `t` is its peak, a
// silence starts at `t` and lasts `dur`. A cue's `at` ({ frame, word, offset }) or an ambience's
// `frames` ([from, to]) re-times it from the current STORYBOARD.md and assets/timing, so a re-pace
// never leaves a cue off its word. Without the file, everything is as before.
//
//   node assets/kit/sound.mjs
//
// Prints JSON { ok, errors[], events, placed, dropped[] } and exits 1 on any error.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { projectFrames } from './frames.mjs';

export const LIBRARY = 'assets/sfx-library';
export const OUT = 'assets/sfx/events.wav';

/**
 * Default searches and levels per event kind (2.0's SOUND A-5 table, plus click).
 * @type {Record<'impact' | 'whoosh' | 'foley' | 'ambience' | 'tick' | 'click' | 'pop' | 'sting', { all: string[], any: string[], not?: string[], gain: number, at: string }>}
 */
export const KINDS = {
  impact: { all: ['impact'], any: ['soft', 'heavy'], not: ['freesound'], gain: 0.8, at: 'start' },
  whoosh: { all: ['whoosh'], any: ['short'], not: ['freesound'], gain: 0.55, at: 'peak' },
  foley: { all: [], any: [], gain: 0.6, at: 'start' },
  ambience: { all: [], any: [], gain: 0.3, at: 'start' },
  tick: { all: ['click'], any: ['soft'], not: ['freesound'], gain: 0.35, at: 'start' },
  click: { all: ['click'], any: ['ui'], not: ['freesound'], gain: 0.45, at: 'start' },
  pop: { all: ['pop'], any: [], not: ['freesound'], gain: 0.5, at: 'start' },
  sting: { all: ['chime'], any: [], not: ['freesound'], gain: 0.4, at: 'start' },
};

/** The longest a sustained foley event may run, in seconds. */
export const MAX_DUR = 8;
/** An ambience bed runs from 0.5s up to this long (it may run on under the next frame: a J/L cut). */
export const MAX_AMBIENCE = 30;
/** Ambience fades in and out over this long, so beds never click on or off. */
export const AMBIENCE_FADE = 0.4;

/**
 * Words that name an event rather than a place's steady sound (D-48). A foley or ambience event whose
 * `what` uses one must carry `shown`: the inventory id of the asset that shows that event.
 */
export const IMPLIES_EVENT = /\b(applause|clapping|cheer\w*|boo\w*|gasp\w*|scream\w*|shout\w*|yell\w*|laugh\w*|crying|sob\w*|gunshot\w*|shots?|explosion\w*|blast|crash\w*|siren\w*|alarm\w*|chant\w*|protest\w*|riot\w*|crowd roar|stampede|ovation|knock\w*|slam\w*|door|phone ring\w*|ringing|camera shutter|shutter|flash\w*|gavel|engine start\w*|car horn|horn)\b/i;

/**
 * Procedural ambience beds (ffmpeg lavfi sources), used when the library has no recording for an
 * ambience (it has none yet: research 03 §11; importing CC0 room tones and city beds is a library
 * gap to raise with Lucas). Each is a steady bed that implies no event. Keys are matched by word.
 */
export const BEDS = {
  room: { words: ['room', 'interior', 'indoor', 'house', 'home', 'apartment', 'night', 'garage', 'studio'], src: 'anoisesrc=c=brown:a=0.10:r=48000,lowpass=f=320,highpass=f=35' },
  office: { words: ['office', 'workplace', 'boardroom', 'meeting', 'lab', 'laboratory', 'courtroom', 'court', 'hearing', 'library', 'classroom'], src: 'anoisesrc=c=pink:a=0.035:r=48000,lowpass=f=900,highpass=f=60' },
  machines: { words: ['server', 'servers', 'datacenter', 'data', 'center', 'computer', 'machine', 'machines', 'fan', 'hum', 'factory', 'chip', 'fab'], src: 'anoisesrc=c=brown:a=0.08:r=48000,lowpass=f=1100,highpass=f=50' },
  street: { words: ['street', 'city', 'traffic', 'road', 'downtown', 'outside', 'outdoor', 'sidewalk', 'town'], src: 'anoisesrc=c=pink:a=0.07:r=48000,lowpass=f=700,highpass=f=55,tremolo=f=0.13:d=0.45' },
  wind: { words: ['wind', 'field', 'desert', 'coast', 'beach', 'mountain', 'rooftop', 'open'], src: 'anoisesrc=c=pink:a=0.08:r=48000,bandpass=f=420:w=360,tremolo=f=0.19:d=0.6' },
  rain: { words: ['rain', 'storm', 'drizzle', 'wet'], src: 'anoisesrc=c=white:a=0.03:r=48000,highpass=f=1400,lowpass=f=7500' },
  hall: { words: ['hall', 'conference', 'auditorium', 'stage', 'keynote', 'crowd', 'restaurant', 'dinner', 'cafe', 'bar', 'party', 'event', 'convention', 'arena'], src: 'anoisesrc=c=pink:a=0.045:r=48000,bandpass=f=850:w=1300,tremolo=f=0.35:d=0.25' },
};

/** The procedural bed for an ambience description: the bed whose words it uses most, else room tone. */
export function bedFor(what) {
  const words = String(what ?? '').toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
  let best = 'room';
  let score = 0;
  for (const [key, bed] of Object.entries(BEDS)) {
    const n = words.filter((w) => bed.words.includes(w)).length;
    if (n > score) { best = key; score = n; }
  }
  return best;
}
/** Quiet recordings are raised at most this much (dB), so their noise floor stays down. */
export const MAX_BOOST_DB = 18;
/** Words that never pick a sound (the catalog's descriptions contain some of them). */
const STOP = new Set(['a', 'an', 'the', 'of', 'on', 'in', 'to', 'into', 'onto', 'at', 'and', 'or', 'with', 'it', 'its', 'is', 'as', 'that', 'this', 'then', 'so', 'one', 'two', 'three', 's', 'j', 'sound', 'sounds']);
export const EVENT_KINDS = Object.keys(KINDS);

/** Every sound is brought to this peak before its gain, so gains mean the same thing. */
export const REF_PEAK_DB = -6;
/** Effects that land during speech sit 6 dB lower, so they stay under the voice. */
export const UNDER_SPEECH = 0.5;
/** The effects track's level in the final mix (audio_meta volume). */
export const TRACK_VOLUME = 0.9;

const r3 = (n) => Math.round(n * 1000) / 1000;
const singular = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** Tag frequencies across the catalog (how specific a tag is). */
export function tagCounts(catalog) {
  const counts = new Map();
  for (const s of catalog) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

/**
 * A foley description → a search: every known word ranks, rarer words weigh more (so "sheet of
 * paper lands" finds a paper drop, not any sound tagged "lands"). At least one word must match.
 * @param {unknown} what
 * @param {Map<string, number>} counts
 * @returns {{ all: string[], any: string[], weights: Record<string, number>, some: boolean } | null}
 */
export function foleyQuery(what, counts) {
  const words = [...new Set(String(what ?? '').toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter((w) => w && !STOP.has(w)))];
  const known = words.flatMap((w) => [w, singular(w)]).filter((w, i, a) => counts.has(w) && a.indexOf(w) === i);
  if (!known.length) return null;
  const total = Math.max(...counts.values(), 1) * 4;
  const weights = Object.fromEntries(known.map((w) => [w, Math.round(Math.log(total / counts.get(w)) * 100) / 100]));
  return { all: [], any: known, weights, some: true };
}

/**
 * Find a sound: every `all` tag must match and no `not` tag; more `any` matches rank higher, then
 * the more specific sound (fewer tags);
 * `seed` rotates variants. `weights` weigh `any` tags (default 1); `some` requires at least one
 * weighted word to match. `minDur` keeps sounds at least that long (a sustained event's beds).
 * @template {{ id: string, tags: string[], duration: number, group: string }} S
 * @param {S[]} catalog
 * @param {{ all?: string[], any?: string[], not?: string[], weights?: Record<string, number>, some?: boolean, maxDur?: number, minDur?: number, seed?: number }} [query]
 * @returns {S | null}
 */
export function findSfx(catalog, { all = [], any = [], not = [], weights = {}, some = false, maxDur = Infinity, minDur = 0, seed = 0 } = {}) {
  const hits = catalog
    .filter((s) => s.duration <= maxDur && s.duration >= minDur && all.every((t) => s.tags.includes(t)) && !not.some((t) => s.tags.includes(t)))
    .map((s) => ({ s, score: any.filter((t) => s.tags.includes(t)).reduce((n, t) => n + (weights[t] ?? 1), 0), words: Object.keys(weights).filter((t) => s.tags.includes(t)).length }))
    .filter((h) => !some || h.words > 0)
    .sort((a, b) => b.score - a.score || a.s.tags.length - b.s.tags.length || a.s.id.localeCompare(b.s.id));
  if (!hits.length) return null;
  const best = hits[0].s.group;
  const variants = hits.filter((h) => h.s.group === best && h.score === hits[0].score).map((h) => h.s);
  return variants[seed % variants.length];
}

/**
 * Problems with one frame's events (try.mjs uses this too). `assets`: the inventory's asset ids (a
 * Set), to check `shown` against; null skips that check.
 * @param {unknown} events
 * @param {number} duration
 * @param {{ assets?: Set<string> | null }} [options]
 */
export function eventProblems(events, duration, { assets = null } = {}) {
  if (!Array.isArray(events)) return ['the events file is not a JSON array'];
  return events.flatMap((e, i) => {
    const where = `event ${i}`;
    const out = [];
    if (typeof e?.t !== 'number' || !(e.t >= 0 && e.t <= duration)) out.push(`${where}: t must be a number from 0 to ${duration}`);
    if (!EVENT_KINDS.includes(e?.kind)) out.push(`${where}: kind "${e?.kind}" is not one of ${EVENT_KINDS.join(', ')}`);
    const described = e?.kind === 'foley' || e?.kind === 'ambience';
    if (described && !(typeof e.what === 'string' && e.what.trim())) out.push(`${where}: a ${e.kind} event needs "what" in plain words`);
    if (e?.kind === 'ambience') {
      if (!(typeof e.dur === 'number' && e.dur >= 0.5 && e.dur <= MAX_AMBIENCE)) out.push(`${where}: an ambience bed needs "dur" from 0.5 to ${MAX_AMBIENCE} seconds`);
    } else if (e?.dur !== undefined && !(e?.kind === 'foley' && typeof e.dur === 'number' && e.dur >= 0.2 && e.dur <= MAX_DUR)) {
      out.push(`${where}: "dur" is only for foley (0.2 to ${MAX_DUR} seconds) and ambience`);
    }
    if (described && IMPLIES_EVENT.test(String(e.what ?? ''))) {
      const shown = typeof e.shown === 'string' ? e.shown.trim() : '';
      if (!shown) out.push(`${where}: "${e.what}" implies an event; add "shown" with the id of the asset that shows it, or drop the sound (D-48)`);
      else if (assets && !assets.has(shown)) out.push(`${where}: "shown" names ${shown}, which is not in the inventory`);
    }
    return out;
  });
}

/**
 * Frame events → a cue sheet in reel time. `frames`: [{ id, start }]. Impacts closer than 0.4s
 * are thinned (the later goes); more than 6 ticks, clicks or pops in one second become the first
 * of the burst. Every dropped event is reported, never fatal.
 */
export function eventsToCues(frames, eventsById, catalog) {
  const counts = tagCounts(catalog);
  const cues = [];
  const dropped = [];
  for (const f of frames) {
    for (const e of eventsById[f.id] ?? []) {
      const t = r3(f.start + e.t);
      const k = KINDS[e.kind];
      if (!k) {
        dropped.push({ frame: f.id, event: e, why: `unknown kind "${e.kind}"` });
        continue;
      }
      if (e.kind === 'ambience') {
        cues.push({ t, kind: 'ambience', what: e.what, dur: e.dur, ...(foleyQuery(e.what, counts) ?? {}), bed: bedFor(e.what) });
        continue;
      }
      if (e.kind === 'foley') {
        const q = foleyQuery(e.what, counts);
        if (!q) {
          dropped.push({ frame: f.id, event: e, why: `no library sound matches "${e.what}"` });
          continue;
        }
        cues.push({ t, kind: 'foley', what: e.what, ...q, ...(e.dur ? { dur: e.dur } : {}) });
        continue;
      }
      cues.push({ t, kind: e.kind });
    }
  }
  cues.sort((a, b) => a.t - b.t || a.kind.localeCompare(b.kind));
  const kept = [];
  let lastImpact = -Infinity;
  const burst = [];
  for (const c of cues) {
    if (c.kind === 'impact') {
      if (c.t - lastImpact < 0.4) {
        dropped.push({ frame: '', event: c, why: 'within 0.4s of another impact' });
        continue;
      }
      lastImpact = c.t;
    }
    if (c.kind === 'tick' || c.kind === 'click' || c.kind === 'pop') {
      while (burst.length && burst[0] <= c.t - 1) burst.shift();
      if (burst.length >= 6) {
        dropped.push({ frame: '', event: c, why: 'more than 6 small sounds in one second' });
        continue;
      }
      burst.push(c.t);
    }
    kept.push(c);
  }
  return { cues: kept, dropped };
}

/**
 * Resolve cues to library sounds: rotating variants, level-matched, quieter under speech.
 * @param {any[]} catalog
 * @param {any[]} cues
 * @param {{ speech?: { start: number, end: number }[] }} [options]
 */
export function resolveCues(catalog, cues, { speech = [] } = {}) {
  const uses = new Map();
  const out = [];
  const missing = [];
  for (const c of cues) {
    const k = KINDS[c.kind];
    const all = c.all ?? k.all;
    const any = c.any ?? k.any;
    const not = k.not ?? [];
    // A sustained event wants a bed at least as long as it; a one-shot wants a short hit.
    const extra = { not, weights: c.weights ?? {}, some: c.some ?? false };
    if (c.kind === 'ambience') {
      // A recorded bed only when the library has one that is really ambience; else the procedural bed.
      const rec = c.any?.length ? findSfx(catalog, { all: ['ambience'], any: c.any, weights: c.weights ?? {}, some: true, minDur: Math.min(c.dur, 4) }) : null;
      const sound = rec ?? { id: `bed:${c.bed}`, procedural: BEDS[c.bed]?.src ?? BEDS.room.src, duration: c.dur, peakDb: REF_PEAK_DB };
      const len = r3(Math.min(c.dur, rec ? rec.duration : c.dur));
      out.push({ ...c, sound, underSpeech: false, trim: { from: 0, len }, start: r3(c.t), volume: r3(k.gain), fade: AMBIENCE_FADE });
      continue;
    }
    const query = c.dur ? { all, any: [...any, 'sustain'], ...extra, minDur: c.dur } : { all, any, ...extra, not: [...not, 'sustain'], maxDur: 3.5 };
    const key = JSON.stringify({ all, any, sustain: Boolean(c.dur) }); // variants rotate per sound, whatever the length
    const seed = uses.get(key) ?? 0;
    uses.set(key, seed + 1);
    let sound = findSfx(catalog, { ...query, seed });
    if (!sound && c.dur) sound = findSfx(catalog, { all, any: [...any, 'sustain'], ...extra, seed }); // shorter bed: it plays once
    if (!sound) {
      missing.push(c);
      continue;
    }
    const offset = k.at === 'peak' ? sound.duration * 0.45 : 0;
    const underSpeech = speech.some((s) => c.t >= s.start && c.t <= s.end);
    const peak = Number.isFinite(sound.peakDb) ? sound.peakDb : REF_PEAK_DB;
    const level = Math.pow(10, Math.min(MAX_BOOST_DB, REF_PEAK_DB - peak) / 20);
    // A sustained event plays `dur` seconds of the bed, from a point that rotates with use.
    const trim = c.dur ? { from: r3(((seed * 1.37) % 1) * Math.max(0, sound.duration - c.dur)), len: r3(Math.min(c.dur, sound.duration)) } : null;
    out.push({ ...c, sound, underSpeech, ...(trim ? { trim } : {}), start: r3(Math.max(0, c.t - offset)), volume: r3(k.gain * (underSpeech ? UNDER_SPEECH : 1) * level) });
  }
  return { resolved: out, missing };
}

/** The ffmpeg arguments that mix resolved cues into one 48 kHz stereo track of `total` seconds. */
export function mixArgs(resolved, total, out, root) {
  const args = ['-y', '-v', 'error'];
  resolved.forEach((r) => {
    if (r.sound.procedural) args.push('-f', 'lavfi', '-t', String(r3((r.trim?.len ?? r.sound.duration) + 0.1)), '-i', r.sound.procedural);
    else args.push('-i', join(root, r.sound.file));
  });
  const chains = resolved.map((r, i) => {
    const ms = Math.round(r.start * 1000);
    const fade = r.fade ?? 0.12;
    const fin = r.fade ?? 0.03;
    const trim = r.trim ? `atrim=start=${r.trim.from}:duration=${r.trim.len},asetpts=PTS-STARTPTS,afade=t=in:d=${fin},afade=t=out:st=${Math.max(0, r3(r.trim.len - fade))}:d=${fade},` : '';
    return `[${i}:a]${trim}aformat=sample_rates=48000:channel_layouts=stereo,volume=${r.volume},adelay=${ms}|${ms}[a${i}]`;
  });
  const mix = `${resolved.map((_, i) => `[a${i}]`).join('')}amix=inputs=${resolved.length}:normalize=0:dropout_transition=0,alimiter=limit=0.89:level=false,apad=whole_dur=${total}[out]`;
  args.push('-filter_complex', [...chains, mix].join(';'), '-map', '[out]', '-t', String(total), '-ar', '48000', '-ac', '2', out);
  return args;
}

/** Speech intervals in reel time, from audio_meta voices (frame-relative words). */
export function speechIntervals(frames, voices) {
  const startOf = new Map(frames.map((f) => [f.number, f.start]));
  const out = [];
  for (const v of voices ?? []) {
    const base = startOf.get(Number(v.frame));
    if (base == null) continue;
    for (const w of v.words ?? []) if (Number.isFinite(w.start) && Number.isFinite(w.end)) out.push({ start: r3(base + w.start), end: r3(base + w.end) });
  }
  return out;
}

/** `meta` with the events track in place of any earlier one. */
export function withEventsTrack(meta, total) {
  const others = (meta?.sfx ?? []).filter((s) => !(s?.source === 'host' && s.role === 'events'));
  return { ...meta, sfx: [...others, { frame: 1, file: OUT, offset_s: 0, duration_s: r3(total), volume: TRACK_VOLUME, source: 'host', role: 'events' }] };
}

// ── Designed cues (MD-61, research 07) ────────────────────────────────────────

/** The sound designer's cue file at the project root. */
export const CUES_FILE = 'sound_cues.json';
export const MUSIC_ACTIONS = ['start', 'drop', 'swell', 'change', 'cut', 'resume'];
export const STINGER_KINDS = ['hit', 'riser', 'whoosh', 'sub', 'silence'];
/** The kinds that count as a big hit (research 07 §3: one per ~10–15s, never two within ~2s). */
export const HEAVY_KINDS = ['hit', 'sub'];
export const HEAVY_GAP = 2;
export const HEAVY_SPACING = 10;

/**
 * The sounds a designed stinger may use, per kind; the first is the default. `land`: seconds into the
 * file where it hits (or a build crests), measured; a riser can build at most `land` seconds.
 */
export const STINGER_LIBRARY = {
  hit: [
    { id: 'pixabay/impact-bass-1', land: 0.03, about: 'deep bass slam with a long tail' },
    { id: 'pixabay/impact-bass-2', land: 1.95, about: 'a short built-in swell, then a deep hit (needs 2s before it)' },
    { id: 'impact-sounds/impactPunch_heavy_000', land: 0, about: 'dry heavy punch, short' },
    { id: 'impact-sounds/impactBell_heavy_001', land: 0, about: 'metallic bell strike with an ominous ring' },
    { id: 'impact-sounds/impactSoft_heavy_000', land: 0, about: 'soft heavy thud, a quieter landing' },
  ],
  sub: [
    { id: 'sci-fi-sounds/lowFrequency_explosion_000', land: 0, about: 'long low boom (2s)' },
    { id: 'sci-fi-sounds/lowFrequency_explosion_001', land: 0, about: 'short low boom (1s)' },
  ],
  riser: [
    { id: 'pixabay/riser', land: 4.4, about: 'cinematic riser, builds up to 4.4s' },
    { id: 'pixabay/whoosh-cinematic', land: 2.9, about: 'airy sweeping build, up to 2.9s' },
  ],
  whoosh: [
    { id: 'pixabay/whoosh-short', land: 0.15, about: 'short whoosh (0.6s)' },
    { id: 'pixabay/whoosh-cinematic', land: 2.9, about: 'long sweeping whoosh, trimmed to the motion' },
  ],
};
/** Phone speakers barely play sub-bass, so every sub carries this mid layer (research 07 §5). */
export const SUB_MID_LAYER = 'impact-sounds/impactSoft_heavy_001';
export const SUB_MID_GAIN = 0.5;
/** Default gains (the same scale as KINDS: after level-matching to REF_PEAK_DB). */
export const STINGER_GAIN = { hit: 0.9, sub: 0.9, riser: 0.6, whoosh: 0.5 };
/** Designed stingers that land on a word sit this much lower (they are meant to be felt under it). */
export const DESIGNED_UNDER_SPEECH = 0.7;
/** The room tone kept under a designed silence (never digital silence, research 07 §4). */
export const SILENCE_ROOM = 0.25;

/**
 * The project's clock: every frame with its reel start, its duration and its word times (from
 * assets/timing/<id>.json, frame seconds).
 */
export function frameClock(root) {
  let at = 0;
  return projectFrames(root).map((f) => {
    const start = r3(at);
    const duration = f.duration > 0 ? f.duration : 0;
    at += duration;
    let words = [];
    try {
      words = JSON.parse(readFileSync(join(root, 'assets', 'timing', `${f.id}.json`), 'utf8')).words ?? [];
    } catch {
      // no timing for this frame (a silent beat, or not paced yet)
    }
    return { number: f.number, id: f.id, name: f.name, start, duration, fields: f.fields, words };
  });
}

/** A cue anchor ({ frame, word, offset }) in reel seconds, or null when the frame or word is gone. */
export function anchorTime(clock, at) {
  const f = clock.find((x) => x.number === Number(at?.frame));
  if (!f) return null;
  let t = f.start;
  if (at.word != null) {
    const w = f.words[Number(at.word)];
    if (!w || !Number.isFinite(w.start)) return null;
    t += w.start;
  }
  return r3(t + (Number.isFinite(at.offset) ? at.offset : 0));
}

/** The library entry a designed stinger plays (its own id when listed for its kind, else the default). */
export function stingerEntry(kind, id) {
  const list = STINGER_LIBRARY[kind] ?? [];
  return list.find((e) => e.id === id) ?? list[0] ?? null;
}

/**
 * The project's designed cues, re-timed from their anchors and lightly sanitised, or null when there is
 * no sound_cues.json (or it does not parse). The production step validated them; this only keeps the
 * kit safe from a hand-edited file.
 */
export function readCues(root, clock = frameClock(root)) {
  const file = join(root, CUES_FILE);
  if (!existsSync(file)) return null;
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const total = r3(clock.reduce((n, f) => n + f.duration, 0));
  const when = (c) => (c?.at ? anchorTime(clock, c.at) : null) ?? (Number.isFinite(c?.t) ? c.t : null);
  const inside = (t) => t != null && t >= 0 && t <= total;
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const music = (Array.isArray(raw.music) ? raw.music : [])
    .map((c) => ({ ...c, t: when(c) }))
    .filter((c) => inside(c.t) && MUSIC_ACTIONS.includes(c.action))
    .sort((a, b) => a.t - b.t);
  const stingers = (Array.isArray(raw.stingers) ? raw.stingers : [])
    .map((c) => ({ ...c, t: when(c), dur: Math.max(0, num(c?.dur, 0)), gain: num(c?.gain, null) }))
    .filter((c) => inside(c.t) && STINGER_KINDS.includes(c.kind))
    .sort((a, b) => a.t - b.t);
  const ambience = (Array.isArray(raw.ambience) ? raw.ambience : [])
    .map((c) => {
      const [a, b] = Array.isArray(c?.frames) ? c.frames.map(Number) : [];
      const fa = clock.find((f) => f.number === a);
      const fb = clock.find((f) => f.number === b);
      const start = fa ? fa.start : num(c?.start, null);
      const end = fb ? r3(fb.start + fb.duration) : num(c?.end, null);
      return { ...c, start, end: end == null ? null : Math.min(total, end) };
    })
    .filter((c) => c.start != null && c.end != null && c.end - c.start >= 0.5 && typeof c.id === 'string')
    .sort((a, b) => a.start - b.start);
  return { music, stingers, ambience };
}

/** The windows of the designed silences: [{ start, end }]. */
export const silenceWindows = (designed) =>
  (designed?.stingers ?? []).filter((s) => s.kind === 'silence' && s.dur > 0).map((s) => ({ start: s.t, end: r3(s.t + s.dur) }));

/**
 * The frame workers' cues once the design leads: their ambience goes when the design has beds, an
 * impact within HEAVY_GAP of a designed hit goes, and nothing plays inside a designed silence.
 */
export function yieldToDesign(cues, designed) {
  const heavy = (designed?.stingers ?? []).filter((s) => HEAVY_KINDS.includes(s.kind)).map((s) => s.t);
  const quiet = silenceWindows(designed);
  const beds = (designed?.ambience ?? []).length > 0;
  const kept = [];
  const dropped = [];
  for (const c of cues) {
    let why = null;
    if (c.kind === 'ambience' && beds) why = 'the sound design sets the ambience';
    else if (c.kind === 'impact' && heavy.some((t) => Math.abs(t - c.t) < HEAVY_GAP)) why = 'within 2s of a designed hit';
    else if (quiet.some((w) => c.t >= w.start - 0.05 && c.t < w.end)) why = 'inside a designed silence';
    if (why) dropped.push({ frame: '', event: c, why });
    else kept.push(c);
  }
  return { cues: kept, dropped };
}

/**
 * Designed stingers and ambience → resolved sounds in resolveCues' shape (mixArgs takes both). Every
 * placement is exact: a hit's land point on `t`, a riser's crest on `t`, a whoosh's peak on `t`.
 * `catalog`: catalog.json plus ambience-catalog.json. Returns { resolved, missing }.
 * @param {any} catalog
 * @param {any} designed
 * @param {{ speech?: { start: number, end: number }[] }} [opts]
 */
export function resolveDesigned(catalog, designed, { speech = [] } = {}) {
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const resolved = [];
  const missing = [];
  const level = (sound) => Math.pow(10, Math.min(MAX_BOOST_DB, REF_PEAK_DB - (Number.isFinite(sound.peakDb) ? sound.peakDb : REF_PEAK_DB)) / 20);
  const spoken = (t) => speech.some((s) => t >= s.start && t <= s.end);
  const push = (c, sound, { start, trim = null, volume, fade }) =>
    resolved.push({ kind: `designed:${c.kind}`, t: c.t, sound, underSpeech: spoken(c.t), ...(trim ? { trim } : {}), start: r3(Math.max(0, start)), volume: r3(volume), ...(fade != null ? { fade } : {}) });
  for (const c of designed?.stingers ?? []) {
    if (c.kind === 'silence') {
      const len = r3(Math.max(0.1, c.dur));
      push(c, { id: 'bed:room', procedural: BEDS.room.src, duration: len, peakDb: REF_PEAK_DB }, { start: c.t, trim: { from: 0, len }, volume: SILENCE_ROOM, fade: 0.05 });
      continue;
    }
    const entry = stingerEntry(c.kind, c.id);
    const sound = entry ? byId.get(entry.id) : null;
    if (!sound) {
      missing.push(c);
      continue;
    }
    const gain = (Number.isFinite(c.gain) ? c.gain : STINGER_GAIN[c.kind]) * (spoken(c.t) ? DESIGNED_UNDER_SPEECH : 1);
    if (c.kind === 'hit' || c.kind === 'sub') {
      // A hit whose land point is later than the reel start loses the part before 0.
      const from = r3(Math.max(0, entry.land - c.t));
      push(c, sound, { start: c.t - entry.land + from, trim: from > 0 ? { from, len: r3(sound.duration - from) } : null, volume: gain * level(sound) });
      if (c.kind === 'sub') {
        const mid = byId.get(SUB_MID_LAYER);
        if (mid) push(c, mid, { start: c.t, volume: gain * SUB_MID_GAIN * level(mid) });
      }
    } else if (c.kind === 'riser') {
      const dur = r3(Math.min(Math.max(0.5, c.dur || 2), entry.land, c.t));
      const from = r3(entry.land - dur);
      // The tail past the crest covers the fade-out, so the crest itself is never faded.
      push(c, sound, { start: c.t - dur, trim: { from, len: r3(Math.min(sound.duration - from, dur + 0.15)) }, volume: gain * level(sound) });
    } else if (c.kind === 'whoosh') {
      const dur = Math.max(0.2, c.dur || 0.6);
      const from = r3(Math.max(0, entry.land - dur * 0.6));
      push(c, sound, { start: c.t - (entry.land - from), trim: { from, len: r3(Math.min(sound.duration - from, dur)) }, volume: gain * level(sound) });
    }
  }
  for (const a of designed?.ambience ?? []) {
    const sound = byId.get(a.id);
    if (!sound) {
      missing.push(a);
      continue;
    }
    const gain = Number.isFinite(a.gain) ? a.gain : KINDS.ambience.gain;
    // A bed longer than its recording plays it again, the pieces overlapping by the fade.
    for (let at = a.start; at < a.end - 0.25; at = r3(at + sound.duration - AMBIENCE_FADE)) {
      const len = r3(Math.min(sound.duration, a.end - at));
      resolved.push({ kind: 'designed:ambience', t: r3(at), what: a.id, sound, underSpeech: false, trim: { from: 0, len }, start: r3(at), volume: r3(gain), fade: AMBIENCE_FADE });
    }
  }
  return { resolved, missing };
}

/** Design and place the reel's sound effects for the project at `root`. */
export function placeSound(root, { ffmpeg = 'ffmpeg' } = {}) {
  const errors = [];
  const catalogFile = join(root, LIBRARY, 'catalog.json');
  if (!existsSync(catalogFile)) return { ok: false, errors: [`${LIBRARY}/catalog.json is missing`], events: 0, placed: 0, dropped: [] };
  // The ambience beds live in their own catalog (ambience-catalog.json) so no Explainer lookup ever sees them.
  const ambienceFile = join(root, LIBRARY, 'ambience-catalog.json');
  const catalog = [
    ...JSON.parse(readFileSync(catalogFile, 'utf8')),
    ...(existsSync(ambienceFile) ? JSON.parse(readFileSync(ambienceFile, 'utf8')) : []),
  ];
  let at = 0;
  const frames = projectFrames(root).map((f) => {
    const start = at;
    at += f.duration > 0 ? f.duration : 0;
    return { ...f, start: r3(start) };
  });
  const total = r3(at);
  const eventsById = {};
  let events = 0;
  for (const f of frames) {
    const file = join(root, 'assets', 'frames', `${f.id}.events.json`);
    if (!existsSync(file)) continue;
    try {
      const list = JSON.parse(readFileSync(file, 'utf8'));
      const problems = eventProblems(list, f.duration);
      if (problems.length) errors.push(...problems.map((p) => `${f.id}: ${p}`));
      eventsById[f.id] = Array.isArray(list) ? list.filter((e) => eventProblems([e], f.duration).length === 0) : [];
      events += eventsById[f.id].length;
    } catch (e) {
      errors.push(`${f.id}.events.json is not valid JSON: ${e?.message ?? e}`);
    }
  }
  const metaFile = join(root, 'audio_meta.json');
  const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : { bgm: null, voices: [], sfx: [] };
  const speech = speechIntervals(frames, meta.voices);
  const designed = readCues(root);
  const listed = eventsToCues(frames, eventsById, catalog);
  const dropped = listed.dropped;
  let cues = listed.cues;
  if (designed) {
    const led = yieldToDesign(cues, designed);
    cues = led.cues;
    dropped.push(...led.dropped);
  }
  const { resolved, missing } = resolveCues(catalog, cues, { speech });
  for (const m of missing) dropped.push({ frame: '', event: m, why: 'no library sound for this search' });
  if (designed) {
    const d = resolveDesigned(catalog, designed, { speech });
    resolved.push(...d.resolved);
    for (const m of d.missing) dropped.push({ frame: '', event: m, why: 'designed cue: no such library sound' });
  }
  if (resolved.length === 0) return { ok: errors.length === 0, errors, events, placed: 0, dropped };

  mkdirSync(join(root, 'assets', 'sfx'), { recursive: true });
  const res = spawnSync(ffmpeg, mixArgs(resolved, total, join(root, OUT), join(root, LIBRARY)), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error || res.status !== 0) {
    errors.push(`ffmpeg failed: ${(res.error?.message ?? res.stderr ?? '').trim().slice(-400)}`);
    return { ok: false, errors, events, placed: 0, dropped };
  }
  writeFileSync(metaFile, `${JSON.stringify(withEventsTrack(meta, total), null, 2)}\n`);
  return { ok: errors.length === 0, errors, events, placed: resolved.length, dropped };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = placeSound(process.cwd());
  console.log(JSON.stringify(result, null, 1));
  process.exit(result.ok ? 0 : 1);
}
