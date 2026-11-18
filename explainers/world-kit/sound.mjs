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
import { loadLibrary } from './sfx-library.mjs';
import { motionFor, offBeat, soundShape, syncTime } from './sync.mjs';

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

// ── The library and its reach ─────────────────────────────────────────────────────────────────
// The central library (design/sfx/library.mjs, linked here as sfx-library.mjs; every content type
// reads it): the bank (catalog.json), Lucas's drop-ins (catalog-inbox.json, written by
// design/sfx/tools/ingest-inbox.mjs) and the bank's measured acoustics load as one catalog.

/** The library catalog at `dir`: the bank, the drop-ins and the measured acoustics, merged (the shared library, sfx-library.mjs). */
export function loadCatalog(dir) {
  return loadLibrary(dir);
}

const has = (s, t) => s.tags.includes(t);
const inGroup = (re) => (s) => re.test(s.group);
const ofKind = (kind) => (s) => s.kind === kind;

/**
 * What each event kind can reach. `core` lists the default palette in order of preference (one
 * predicate per rank); `wide` adds sounds that only a matching `what` word reaches (an impact on
 * glass, a click on a metal latch). Drop-ins join the kind their names point to.
 */
export const POOLS = {
  impact: {
    core: [(s) => has(s, 'impact') && (has(s, 'soft') || has(s, 'punch')) && (has(s, 'heavy') || has(s, 'medium')), (s) => has(s, 'impact') && has(s, 'bass'), ofKind('impact')],
    wide: (s) => has(s, 'impact') && !has(s, 'whoosh') && !has(s, 'footstep'),
  },
  whoosh: {
    core: [(s) => has(s, 'whoosh'), ofKind('whoosh'), inGroup(/^rpg-audio\/cloth$/)],
    wide: inGroup(/^interface-sounds\/(maximize|minimize)$/),
  },
  pop: {
    core: [inGroup(/^pixabay\/pop$/), inGroup(/^interface-sounds\/drop$/), ofKind('pop'), inGroup(/^interface-sounds\/(open|pluck)$/)],
    wide: inGroup(/^(ui-audio\/rollover|interface-sounds\/(bong|glass))$/),
  },
  tick: {
    core: [inGroup(/^pixabay\/click-soft$/), inGroup(/^interface-sounds\/tick$/), ofKind('tick'), inGroup(/^(interface-sounds\/select|ui-audio\/mouse(click|release))$/)],
    wide: inGroup(/^(pixabay\/key-press|interface-sounds\/(click|scroll))$/),
  },
  click: {
    core: [inGroup(/^(pixabay\/click|ui-audio\/click)$/), inGroup(/^interface-sounds\/(click|switch|toggle)$/), ofKind('click'), inGroup(/^ui-audio\/switch$/)],
    wide: inGroup(/^rpg-audio\/(metalClick|metalLatch)$/),
  },
  sting: {
    core: [inGroup(/^pixabay\/(chime|sparkle|ping|notification)$/), inGroup(/^music-jingles\/jingles_(PIZZI|STEEL)$/), ofKind('sting'), inGroup(/^interface-sounds\/confirmation$/)],
    wide: (s) => has(s, 'sting') || has(s, 'chime'),
  },
};

// ── Variety (Lucas, 2026-11-17: "really, really repeated") ────────────────────────────────────
// Per reel, no file plays more than CAPS[kind] times (a `motif` up to MOTIF_CAP), never twice in a row
// for the same kind, and never on two consecutive accents (impact, sting, whoosh). The opener's
// own sounds (its stem and the 1→2 hit) never return as an accent, and no other kind plays them in
// frame 2's first OPENER_GAP seconds. A blocked pick is replaced by the nearest sound of the
// same family (same group first, then the kind's palette or the same words), by meaning and by
// measured sound; if none is left the pick plays anyway, slightly re-pitched, and is reported.
// Variety never blocks a reel.

/** The most times one file may play in a reel, per kind (sustained beds: `sustain`). */
export const CAPS = { impact: 2, sting: 2, whoosh: 3, pop: 3, tick: 4, click: 4, foley: 3, sustain: 4 };
/** A motif's exact sound plays at most this many times; later events rotate within its family. */
export const MOTIF_CAP = 5;
/** Kinds whose consecutive uses must differ across kinds too (the accents). */
const ACCENTS = new Set(['impact', 'sting', 'whoosh']);
/** After frame 2 starts, the opener's own sounds stay out for this long (seconds). */
export const OPENER_GAP = 3;
/** Re-pitch for a repeat nothing could replace (rate per extra use). */
const REPITCH = [0.94, 1.06, 0.9, 1.1];

/** How different two sounds are (0 = alike), from length, level, brightness and attack. */
export function soundDistance(a, b) {
  const ln = (x, y) => Math.abs(Math.log(Math.max(1e-3, x) / Math.max(1e-3, y)));
  let d = ln(a.duration, b.duration) * 0.5;
  if (Number.isFinite(a.meanDb) && Number.isFinite(b.meanDb)) d += Math.abs(a.meanDb - a.peakDb - (b.meanDb - b.peakDb)) / 12;
  if (a.centroid > 0 && b.centroid > 0) d += ln(a.centroid, b.centroid) * 0.5;
  if (Number.isFinite(a.attack) && Number.isFinite(b.attack)) d += ln(a.attack + 5, b.attack + 5) * 0.2;
  return Math.round(d * 1000) / 1000;
}

/** A fresh per-reel variety state; `opener`: { files: catalog files the opener played, hit, until }. */
export function varietyState({ opener } = {}) {
  const uses = new Map();
  const openerFiles = new Set(opener?.files ?? []);
  for (const f of openerFiles) uses.set(f, (uses.get(f) ?? 0) + 1);
  return { uses, last: new Map(), lastAccent: opener?.hit ?? null, anchors: new Map(), motifs: new Map(), openerFiles, openerUntil: opener?.until ?? -Infinity, substitutions: [], repeats: [] };
}

/** Why `s` may not play for cue `c` now, or null. */
function blockedWhy(s, c, state, cap) {
  if ((state.uses.get(s.file) ?? 0) >= cap) return `already played ${state.uses.get(s.file)} times (cap ${cap})`;
  if (state.last.get(c.kind) === s.file) return `the previous ${c.kind} was the same sound`;
  if (ACCENTS.has(c.kind) && state.lastAccent === s.file) return 'the previous accent was the same sound';
  if (state.openerFiles.has(s.file) && (ACCENTS.has(c.kind) || c.t < state.openerUntil)) return 'the opener played it';
  return null;
}

/**
 * The candidates for a cue, best first: [{ s, score, rank }] where `score` is the meaning match
 * and `rank` the palette preference. `tier` holds the top-scored ones; `family` the wider set a
 * blocked pick may be replaced from.
 */
export function candidatesFor(catalog, c) {
  const sustained = Boolean(c.dur);
  const fits = (s) => (sustained ? has(s, 'sustain') : !has(s, 'sustain') && s.duration <= 3.5);
  const scoreOf = (s) => Object.entries(c.weights ?? {}).reduce((n, [t, w]) => n + (has(s, t) ? w : 0), 0);
  const byScore = (a, b) => b.score - a.score || a.rank - b.rank || a.s.tags.length - b.s.tags.length || a.s.id.localeCompare(b.s.id);
  if (c.kind === 'foley') {
    // a sustained action prefers a bed (`sustain`), at least as long as it; any sound of the words
    // will do (it plays once)
    let all = catalog
      .filter((s) => sustained || fits(s))
      .map((s) => ({ s, words: scoreOf(s), rank: 0 }))
      .filter((h) => h.words > 0)
      .map((h) => ({ ...h, score: h.words + (sustained && has(h.s, 'sustain') ? 1 : 0) }));
    if (sustained) {
      const long = all.filter((h) => h.s.duration >= c.dur);
      if (long.length) all = long; // a bed at least as long as the action; else a shorter one plays once
    }
    all.sort(byScore);
    if (!all.length) return { tier: [], family: [] };
    const top = all[0].score;
    return { tier: all.filter((h) => h.score >= top - 1e-9), family: all.filter((h) => h.score >= top * 0.5) };
  }
  const pool = POOLS[c.kind];
  const oneShot = (s) => fits(s) && (!has(s, 'freesound') || s.kind === c.kind);
  const rankOf = (s) => pool.core.findIndex((p) => p(s));
  const core = catalog.filter(oneShot).map((s) => ({ s, rank: rankOf(s) })).filter((h) => h.rank >= 0).map((h) => ({ ...h, score: scoreOf(h.s) }));
  const wide = catalog.filter((s) => oneShot(s) && rankOf(s) < 0 && pool.wide(s)).map((s) => ({ s, rank: pool.core.length, score: scoreOf(s) }));
  const all = [...core, ...wide].sort(byScore);
  const top = all[0]?.score ?? 0;
  // `what` words that name a sound in the kind's reach pick among those; otherwise the palette
  const tier = top > 0 ? all.filter((h) => h.score >= top - 1e-9) : core.sort(byScore);
  const family = top > 0 ? [...all.filter((h) => h.score >= top * 0.5), ...core.filter((h) => h.score < top * 0.5)] : core;
  return { tier, family };
}

/** Choose the sound for cue `c` with variety; updates `state`. Returns { sound, rate?, note? }. */
export function pickSound(catalog, c, state) {
  const capKey = c.dur ? 'sustain' : c.kind;
  const cap = CAPS[capKey] ?? 3;
  if (c.motif && state.motifs.has(c.motif) && (state.uses.get(state.motifs.get(c.motif).file) ?? 0) < MOTIF_CAP) {
    const sound = state.motifs.get(c.motif);
    state.uses.set(sound.file, (state.uses.get(sound.file) ?? 0) + 1);
    return { sound };
  }
  let { tier, family } = candidatesFor(catalog, c);
  const named = c.sound ? catalog.find((s) => s.id === c.sound) : null;
  if (named) {
    tier = [{ s: named, score: 1, rank: 0 }];
    family = [...catalog.filter((s) => s.group === named.group && s !== named).map((s) => ({ s, score: 1, rank: 0 })), ...family];
  }
  if (!tier.length) return { sound: null };
  const anchorKey = c.anchor ?? c.kind;
  const anchor = state.anchors.get(anchorKey) ?? null;
  const wanted = anchor && tier.some((h) => h.s === anchor) ? anchor : tier[0].s;
  const cost = (h, ref) => {
    let n = (state.uses.get(h.s.file) ?? 0) * 1.5 + h.rank * 0.4;
    if (ref) n += soundDistance(h.s, ref) + (h.s.group === ref.group ? 0 : 0.6);
    return n;
  };
  const best = (list, ref) => {
    const open = list.filter((h) => !blockedWhy(h.s, c, state, cap));
    open.sort((a, b) => cost(a, ref) - cost(b, ref) || a.s.id.localeCompare(b.s.id));
    return open[0]?.s ?? null;
  };
  // the top tier first (a named sound plays as named), rotating to the least-played variant
  const whyNot = blockedWhy(wanted, c, state, cap);
  let sound = named ? (whyNot ? null : named) : best(tier, anchor ?? tier[0].s);
  // the whole tier is blocked: the nearest open sound of the same family stands in
  if (!sound) sound = best(family.filter((h) => !tier.includes(h)), wanted);
  let note = null;
  let rate;
  if (sound && sound !== wanted && whyNot) {
    note = { t: c.t, kind: c.kind, wanted: wanted.id, used: sound.id, why: whyNot };
    state.substitutions.push(note);
  }
  if (!sound) {
    // nothing left: play the least-played top pick, re-pitched, and say so
    const pool = [...tier].sort((a, b) => (state.uses.get(a.s.file) ?? 0) - (state.uses.get(b.s.file) ?? 0) || (state.last.get(c.kind) === a.s.file) - (state.last.get(c.kind) === b.s.file));
    sound = pool[0].s;
    rate = REPITCH[((state.uses.get(sound.file) ?? 0) + REPITCH.length - 1) % REPITCH.length];
    note = { t: c.t, kind: c.kind, wanted: wanted.id, used: sound.id, why: `${blockedWhy(sound, c, state, cap)}; nothing similar left, re-pitched ×${rate}` };
    state.repeats.push(note);
  }
  state.uses.set(sound.file, (state.uses.get(sound.file) ?? 0) + 1);
  state.last.set(c.kind, sound.file);
  if (ACCENTS.has(c.kind)) state.lastAccent = sound.file;
  if (!state.anchors.has(anchorKey)) state.anchors.set(anchorKey, sound);
  if (c.motif && !state.motifs.has(c.motif)) state.motifs.set(c.motif, sound);
  return { sound, ...(rate ? { rate } : {}), ...(note ? { note } : {}) };
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
    if (e?.sound !== undefined && !(typeof e.sound === 'string' && e.sound.trim())) out.push(`${where}: "sound" is a library id from sfx-find.mjs`);
    if (e?.motif !== undefined && !(typeof e.motif === 'string' && e.motif.trim())) out.push(`${where}: "motif" is a short name shared by the events that must sound the same`);
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
      const extra = { ...(typeof e.sound === 'string' ? { sound: e.sound } : {}), ...(typeof e.motif === 'string' ? { motif: e.motif } : {}) };
      if (e.kind === 'foley') {
        const q = foleyQuery(e.what, counts);
        if (!q && !extra.sound) {
          dropped.push({ frame: f.id, event: e, why: `no library sound matches "${e.what}"` });
          continue;
        }
        const words = q ? q.any.filter((w) => w !== 'sustain') : [];
        cues.push({ t, kind: 'foley', what: e.what, ...(q ?? { all: [], any: [], weights: {}, some: true }), anchor: `foley:${[...words].sort().join(' ')}${e.dur ? ':bed' : ''}`, ...(e.dur ? { dur: e.dur } : {}), ...extra });
        continue;
      }
      // other kinds: `what` words rank the kind's own sounds (the kind's name says nothing more)
      const q = typeof e.what === 'string' ? foleyQuery(e.what.replace(new RegExp(`\\b${e.kind}s?\\b`, 'gi'), ' '), counts) : null;
      cues.push({ t, kind: e.kind, ...(e.what ? { what: e.what } : {}), ...(q ? { weights: q.weights } : {}), ...extra });
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
 * Each sound starts so that its measured hit lands on the cue's time: a whoosh's peak, any other
 * sound's onset (`shapeOf(sound)` -> { onset, peak } seconds into the file; without it, a whoosh is
 * assumed to peak 45% in and anything else to start at once). A pitched sound's hit moves by its rate.
 * @param {{ speech?: { start: number, end: number }[], shapeOf?: (s: any) => ({ onset: number, peak: number } | null) }} [options]
 */
export function resolveCues(catalog, cues, { speech = [], opener, state = varietyState({ opener }), shapeOf = () => null } = {}) {
  const out = [];
  const missing = [];
  for (const c of cues) {
    const k = KINDS[c.kind];
    // A sustained event wants a bed at least as long as it (a shorter one plays once); a one-shot
    // wants a short hit. pickSound enforces the reel's variety (see CAPS).
    const { sound, rate } = pickSound(catalog, c, state);
    if (!sound) {
      missing.push(c);
      continue;
    }
    const seed = (state.uses.get(sound.file) ?? 1) - 1;
    const shape = c.dur ? null : shapeOf(sound);
    const hit = c.dur ? 0 : shape ? (k.at === 'peak' ? shape.peak : shape.onset) : k.at === 'peak' ? sound.duration * 0.45 : 0;
    const offset = hit / (rate || 1);
    // a hit earlier than the file's lead-in allows: cut the head instead of landing late
    const head = offset > c.t ? r3((offset - c.t) * (rate || 1)) : 0;
    const underSpeech = speech.some((s) => c.t >= s.start && c.t <= s.end);
    const peak = Number.isFinite(sound.peakDb) ? sound.peakDb : REF_PEAK_DB;
    const level = Math.pow(10, Math.min(MAX_BOOST_DB, REF_PEAK_DB - peak) / 20);
    // A sustained event plays `dur` seconds of the bed, from a point that rotates with use.
    const trim = c.dur ? { from: r3(((seed * 1.37) % 1) * Math.max(0, sound.duration - c.dur)), len: r3(Math.min(c.dur, sound.duration)) } : null;
    out.push({ ...c, sound, underSpeech, ...(trim ? { trim } : {}), ...(rate ? { rate } : {}), ...(head ? { head } : {}), hitAt: r3(c.t), start: r3(Math.max(0, c.t - offset)), volume: r3(k.gain * (underSpeech ? UNDER_SPEECH : 1) * level) });
  }
  return { resolved: out, missing, variety: varietyReport(out, state) };
}

/** What the reel's effects used: distinct files, the most-played one, substitutions, repeats. */
export function varietyReport(resolved, state) {
  const counts = new Map();
  for (const r of resolved) counts.set(r.sound.file, (counts.get(r.sound.file) ?? 0) + 1);
  const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return { placed: resolved.length, distinct: counts.size, mostPlayed: top ? { file: top, times: n } : null, substituted: state.substitutions.length, repitched: state.repeats.length, notes: [...state.substitutions, ...state.repeats].slice(0, 12) };
}

/** The ffmpeg arguments that mix resolved cues into one 48 kHz stereo track of `total` seconds. */
export function mixArgs(resolved, total, out, root) {
  const args = ['-y', '-v', 'error'];
  resolved.forEach((r) => args.push('-i', join(root, r.sound.file)));
  const chains = resolved.map((r, i) => {
    const ms = Math.round(r.start * 1000);
    const head = r.head && !r.trim ? `atrim=start=${r.head},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,` : '';
    const trim = r.trim ? `atrim=start=${r.trim.from}:duration=${r.trim.len},asetpts=PTS-STARTPTS,afade=t=in:d=0.03,afade=t=out:st=${Math.max(0, r3(r.trim.len - 0.12))}:d=0.12,` : '';
    const pitch = r.rate && r.rate !== 1 ? `asetrate=${Math.round(48000 * r.rate)},aresample=48000,` : '';
    return `[${i}:a]${head}${trim}aformat=sample_rates=48000:channel_layouts=stereo,${pitch}volume=${r.volume},adelay=${ms}|${ms}[a${i}]`;
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
export function placeSound(root, { ffmpeg = 'ffmpeg', motion } = {}) {
  const errors = [];
  const catalogFile = join(root, LIBRARY, 'catalog.json');
  if (!existsSync(catalogFile)) return { ok: false, errors: [`${LIBRARY}/catalog.json is missing`], events: 0, placed: 0, dropped: [] };
  const catalog = loadCatalog(join(root, LIBRARY));
  let at = 0;
  const frames = projectFrames(root).map((f) => {
    const start = at;
    at += f.duration > 0 ? f.duration : 0;
    return { ...f, start: r3(start) };
  });
  const total = r3(at);
  const eventsById = {};
  let events = 0;
  // Every event sits on the motion it belongs to (sync.mjs measures each frame's picture).
  const curves = motion ?? motionFor(root);
  const synced = [];
  for (const f of frames) {
    const file = join(root, 'assets', 'frames', `${f.id}.events.json`);
    if (!existsSync(file)) continue;
    try {
      const list = JSON.parse(readFileSync(file, 'utf8'));
      const problems = eventProblems(list, f.duration);
      if (problems.length) errors.push(...problems.map((p) => `${f.id}: ${p}`));
      eventsById[f.id] = (Array.isArray(list) ? list.filter((e) => eventProblems([e], f.duration).length === 0) : []).map((e) => {
        const s = syncTime(curves[f.id]?.curve, e, curves[f.id]?.fps);
        if (!s.moved) return e;
        const t = r3(Math.min(Math.max(0, s.t), Math.max(0, f.duration - 0.05)));
        synced.push({ frame: f.id, kind: e.kind, ...(e.what ? { what: e.what } : {}), from: e.t, to: t });
        return { ...e, t };
      });
      events += eventsById[f.id].length;
    } catch (e) {
      errors.push(`${f.id}.events.json is not valid JSON: ${e?.message ?? e}`);
    }
  }
  const metaFile = join(root, 'audio_meta.json');
  const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : { bgm: null, voices: [], sfx: [] };
  const { cues, dropped } = eventsToCues(frames, eventsById, catalog);
  const ids = new Set(catalog.map((s) => s.id));
  const unknown = [...new Set(cues.filter((c) => c.sound && !ids.has(c.sound)).map((c) => c.sound))];
  const { resolved, missing, variety } = resolveCues(catalog, cues, { speech: speechIntervals(frames, meta.voices), opener: openerContext(meta, catalog, frames), shapeOf: (s) => soundShape(join(root, LIBRARY, s.file), ffmpeg) });
  for (const m of missing) dropped.push({ frame: '', event: m, why: 'no library sound for this search' });
  if (unknown.length) variety.unknownSounds = unknown; // chosen by kind and words instead
  const sync = { measured: Object.keys(curves).length, moved: synced };
  if (resolved.length === 0) return { ok: errors.length === 0, errors, events, placed: 0, dropped, variety, sync };

  mkdirSync(join(root, 'assets', 'sfx'), { recursive: true });
  const res = spawnSync(ffmpeg, mixArgs(resolved, total, join(root, OUT), join(root, LIBRARY)), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error || res.status !== 0) {
    errors.push(`ffmpeg failed: ${(res.error?.message ?? res.stderr ?? '').trim().slice(-400)}`);
    return { ok: false, errors, events, placed: 0, dropped };
  }
  writeFileSync(metaFile, `${JSON.stringify(withEventsTrack(meta, total), null, 2)}\n`);
  sync.offBeat = offBeat(join(root, OUT), resolved, ffmpeg);
  return { ok: errors.length === 0, errors, events, placed: resolved.length, dropped, variety, sync };
}

/**
 * The opener's sounds as catalog files, for the variety rules: the bank opener's stem lists its
 * own (`sounds`), the 1→2 hit names its library file (`library`; an older entry is matched by
 * file name). They count as played, and stay out of frame 2's first OPENER_GAP seconds.
 */
export function openerContext(meta, catalog, frames) {
  const host = (meta?.sfx ?? []).filter((s) => s?.source === 'host' && /^opener-/.test(s.role ?? ''));
  const byName = (file) => catalog.find((s) => s.file === file)?.file ?? catalog.find((s) => s.file.split('/').pop() === String(file).split('/').pop())?.file ?? null;
  const files = new Set();
  let hit = null;
  for (const e of host) {
    for (const f of e.sounds ?? []) if (byName(f)) files.add(byName(f));
    if (e.role === 'opener-hit') {
      hit = byName(e.library ?? e.file);
      if (hit) files.add(hit);
    }
  }
  const frame2 = frames[1]?.start ?? frames[0]?.duration ?? 0;
  return { files: [...files], hit, until: r3(frame2 + OPENER_GAP) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = placeSound(process.cwd());
  // Write, then exit once stdout has drained: process.exit() right after console.log cut a piped
  // report off at 64 KB, and the job read the cut JSON as "no errors" (2026-11-03).
  process.stdout.write(`${JSON.stringify(result, null, 1)}\n`, () => process.exit(result.ok ? 0 : 1));
}
