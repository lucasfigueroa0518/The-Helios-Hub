// Event-timed sound design (Explainers 3.1, EX3-63). Deterministic, no model. Ported from
// Explainer 2.0's resolver (lib/explainers2/build/sound.ts) and mixer (tools/sfx-mix.mjs).
//
// Frame workers declare every moment of motion in assets/frames/<frame id>.events.json:
//   [{ "t": 0.42, "kind": "impact" }, { "t": 1.1, "kind": "foley", "what": "footstep" },
//    { "t": 2.0, "kind": "foley", "what": "pencil writing", "dur": 1.4 }, …]
// in frame time; `dur` makes a continuous action (writing, erasing, rustling) last exactly that
// long. This turns them into reel time (STORYBOARD.md durations), resolves each to a sound in our
// library (assets/sfx-library/catalog.json: Kenney CC0, Pixabay, and the Freesound CC0 paper, pen
// and writing set, whose continuous actions are tagged `sustain`), level-matches
// them, turns effects under speech down 6 dB, and premixes one track, assets/sfx/events.wav,
// placed in audio_meta.json as a host entry on frame 1. Run it after mount and try.
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
 * @type {Record<'impact' | 'whoosh' | 'foley' | 'tick' | 'click' | 'pop' | 'sting', { all: string[], any: string[], not?: string[], gain: number, at: string }>}
 */
export const KINDS = {
  impact: { all: ['impact'], any: ['soft', 'heavy'], not: ['freesound'], gain: 0.8, at: 'start' },
  whoosh: { all: ['whoosh'], any: ['short'], not: ['freesound'], gain: 0.55, at: 'peak' },
  foley: { all: [], any: [], gain: 0.6, at: 'start' },
  tick: { all: ['click'], any: ['soft'], not: ['freesound'], gain: 0.35, at: 'start' },
  click: { all: ['click'], any: ['ui'], not: ['freesound'], gain: 0.45, at: 'start' },
  pop: { all: ['pop'], any: [], not: ['freesound'], gain: 0.5, at: 'start' },
  sting: { all: ['chime'], any: [], not: ['freesound'], gain: 0.4, at: 'start' },
};

/** The longest a sustained foley event may run, in seconds. */
export const MAX_DUR = 8;
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

/** Problems with one frame's events (try.mjs uses this too). */
export function eventProblems(events, duration) {
  if (!Array.isArray(events)) return ['the events file is not a JSON array'];
  return events.flatMap((e, i) => {
    const where = `event ${i}`;
    const out = [];
    if (typeof e?.t !== 'number' || !(e.t >= 0 && e.t <= duration)) out.push(`${where}: t must be a number from 0 to ${duration}`);
    if (!EVENT_KINDS.includes(e?.kind)) out.push(`${where}: kind "${e?.kind}" is not one of ${EVENT_KINDS.join(', ')}`);
    if (e?.kind === 'foley' && !(typeof e.what === 'string' && e.what.trim())) out.push(`${where}: a foley event needs "what" in plain words`);
    if (e?.dur !== undefined && !(e?.kind === 'foley' && typeof e.dur === 'number' && e.dur >= 0.2 && e.dur <= MAX_DUR)) out.push(`${where}: "dur" is only for foley, from 0.2 to ${MAX_DUR} seconds`);
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
  resolved.forEach((r) => args.push('-i', join(root, r.sound.file)));
  const chains = resolved.map((r, i) => {
    const ms = Math.round(r.start * 1000);
    const trim = r.trim ? `atrim=start=${r.trim.from}:duration=${r.trim.len},asetpts=PTS-STARTPTS,afade=t=in:d=0.03,afade=t=out:st=${Math.max(0, r3(r.trim.len - 0.12))}:d=0.12,` : '';
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

/** Design and place the reel's sound effects for the project at `root`. */
export function placeSound(root, { ffmpeg = 'ffmpeg' } = {}) {
  const errors = [];
  const catalogFile = join(root, LIBRARY, 'catalog.json');
  if (!existsSync(catalogFile)) return { ok: false, errors: [`${LIBRARY}/catalog.json is missing`], events: 0, placed: 0, dropped: [] };
  const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
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
  const { cues, dropped } = eventsToCues(frames, eventsById, catalog);
  const { resolved, missing } = resolveCues(catalog, cues, { speech: speechIntervals(frames, meta.voices) });
  for (const m of missing) dropped.push({ frame: '', event: m, why: 'no library sound for this search' });
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
