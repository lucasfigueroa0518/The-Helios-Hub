import fs from 'node:fs';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

import { BED_VOLUME, GAIN_RANGE, STYLE_KEYS, styleKey, SWELL_IN, SWELL_MAX, SWELL_RISE } from '@/explainers/reel-ai-drama/kit/music.mjs';
import {
  anchorTime,
  CUES_FILE,
  frameClock,
  HEAVY_KINDS,
  HEAVY_SPACING,
  MUSIC_ACTIONS,
  STINGER_GAIN,
  STINGER_KINDS,
  STINGER_LIBRARY,
  stingerEntry,
} from '@/explainers/reel-ai-drama/kit/sound.mjs';
import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import type { MessageUsageLike } from '@/lib/anthropic-pricing';
import type { Queryable } from '@/lib/explainers/db';
import { recordCost } from '@/lib/reel-ai-drama/cost';
import { messagesUsd, usageTotals, type CreateMessage } from '@/lib/reel-ai-drama/reporting/llm';
import { peakRungId, type DirectorPlan, type HookChoice, type Mode, type WriterDraft } from '@/lib/reel-ai-drama/types';

/**
 * The sound designer (MD-61, research 07): one Sonnet call after the timing is locked (after pace),
 * reading the frames, their word times, the hook, the turn and the landing, and the sound library, and
 * planning the music sections, stingers, silences and ambience. Code validates every cue (times inside
 * the reel, real ids, heavy-hit spacing, density), drops what breaks a rule as a problem, and writes
 * sound_cues.json; the kit's music.mjs and sound.mjs place them. Fails open: any error writes no cues
 * and the kit keeps today's behaviour. Music is the reel's driving force (MD-142): code starts it on the
 * first instant, brings it back after MUSIC_GAP_MAX seconds without it, and keeps it playing into the close.
 */

/** The longest stretch before the close without music, deliberate drops and silences included (MD-142). */
export const MUSIC_GAP_MAX = 8;
/**
 * A stop under the voice (MD-148). Up to `free` seconds it is a dip that needs nothing. Longer, it must read as
 * deliberate: a swell with its full rise, or a riser of at least `riser` seconds, peaking within `peak` of it. Then it
 * still lasts at most `held`.
 */
export const VOICE_STOP = { free: 0.5, peak: 0.25, riser: 1.5, held: 2 };

export type CueAnchor = { frame: number; word: number | null; offset: number };
export type MusicAction = 'start' | 'drop' | 'swell' | 'change' | 'cut' | 'resume';
export type StingerKind = 'hit' | 'riser' | 'whoosh' | 'sub' | 'silence' | 'spot';
export type MusicCue = { t: number; action: MusicAction; style: string | null; gain: number; dur?: number; at?: CueAnchor; why?: string };
export type StingerCue = { t: number; kind: StingerKind; dur: number; gain: number; id?: string | null; at?: CueAnchor; why?: string };
export type AmbienceCue = { start: number; end: number; id: string; gain: number; frames?: [number, number]; why?: string };
/** sound_cues.json (ITERATION-2.md, binding shape; `at`, `id`, `frames` and `why` are additive). */
export type SoundCues = { music: MusicCue[]; stingers: StingerCue[]; ambience: AmbienceCue[]; muffles?: MuffleCue[] };
/** The music is muffled for `dur` seconds and opens on `t`. */
export type MuffleCue = { t: number; dur: number; at?: CueAnchor; why?: string };

export type SoundDesignDeps = {
  create: CreateMessage;
  /** settings.orchestrator_model */
  model: string;
  /** The system prompt; defaults to explainers/reel-ai-drama/prompts/sound-designer.md. */
  loadPrompt?: () => string;
  db?: Queryable;
  jobId?: string | null;
  mode?: Mode;
  log?: (entry: Record<string, unknown>) => void;
};

type ClockFrame = { number: number; id: string; name: string; start: number; duration: number; fields: Record<string, string>; words: { text: string; start: number; end: number }[] };
type Ambience = { id: string; tags: string[]; duration: number };

export const PROMPT_FILE = path.join('explainers', 'reel-ai-drama', 'prompts', 'sound-designer.md');
const REPO_LIBRARY = path.join('explainers', 'design', 'sfx');

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

// ── Library ────────────────────────────────────────────────────────────────

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** The library the designer may pick from: stingers present in the catalog, and the ambience beds. */
export function soundLibrary(projectDir: string, root: string = process.cwd()) {
  const dirs = [path.join(projectDir, 'assets', 'sfx-library'), path.join(root, REPO_LIBRARY)];
  const catalog = dirs.map((d) => readJson<{ id: string }[]>(path.join(d, 'catalog.json'))).find(Boolean) ?? [];
  const ambience = dirs.map((d) => readJson<Ambience[]>(path.join(d, 'ambience-catalog.json'))).find(Boolean) ?? [];
  const have = new Set(catalog.map((s) => s.id));
  const stingers = Object.fromEntries(
    Object.entries(STINGER_LIBRARY as Record<string, { id: string; land: number; about: string }[]>).map(([kind, list]) => [kind, list.filter((e) => have.has(e.id))]),
  ) as Record<string, { id: string; land: number; about: string }[]>;
  return { stingers, ambience: ambience.map((a) => ({ id: a.id, tags: a.tags ?? [], duration: a.duration })) };
}
export type SoundLibrary = ReturnType<typeof soundLibrary>;

/** The library as text for the cached system block (stable while the library is). */
export function libraryText(lib: SoundLibrary): string {
  return [
    '## Library',
    '',
    `Music style keys: ${(STYLE_KEYS as string[]).join(', ')} (pulse, piano and percussion are tense documentary tracks; dread is ominous and slow; drive is urgent; reflect is sparse and bittersweet).`,
    '',
    'Stingers (id: what it sounds like; the first of each kind is the default):',
    ...Object.entries(lib.stingers).flatMap(([kind, list]) => [`- ${kind}:`, ...list.map((e) => `  - ${e.id}: ${e.about}`)]),
    '- silence: no sound id (room tone is kept under it).',
    '',
    'Ambience beds (id: places it suits):',
    ...lib.ambience.map((a) => `- ${a.id}: ${a.tags.filter((t) => t !== 'ambience').join(', ')}`),
  ].join('\n');
}

// ── Tool ───────────────────────────────────────────────────────────────────

const obj = <P extends Record<string, unknown>>(properties: P) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties }) as const;
const nullableEnum = (values: string[]) => ({ anyOf: [{ type: 'string', enum: values }, { type: 'null' }] });

export function soundCuesTool(lib: SoundLibrary): Anthropic.Tool {
  const anchor = { frame: { type: 'integer' }, word: { type: ['integer', 'null'] }, offset: { type: 'number' } };
  const stingerIds = [...new Set(Object.values(lib.stingers).flat().map((e) => e.id))];
  return {
    name: 'submit_sound_cues',
    description: 'Submit the reel\'s music cues, stingers and ambience beds. Call it exactly once.',
    strict: true,
    input_schema: obj({
      music: { type: 'array', items: obj({ action: { type: 'string', enum: MUSIC_ACTIONS }, ...anchor, style: nullableEnum(STYLE_KEYS as string[]), gain: { type: ['number', 'null'] }, dur: { type: ['number', 'null'] }, why: { type: 'string' } }) },
      stingers: { type: 'array', items: obj({ kind: { type: 'string', enum: STINGER_KINDS }, ...anchor, dur: { type: 'number' }, id: nullableEnum(stingerIds), gain: { type: ['number', 'null'] }, why: { type: 'string' } }) },
      ambience: { type: 'array', items: obj({ from_frame: { type: 'integer' }, to_frame: { type: 'integer' }, id: { type: 'string', enum: lib.ambience.map((a) => a.id) }, gain: { type: ['number', 'null'] }, why: { type: 'string' } }) },
      muffles: { type: 'array', items: obj({ ...anchor, dur: { type: 'number' }, why: { type: 'string' } }) },
    }) as unknown as Anthropic.Tool.InputSchema,
  } as Anthropic.Tool;
}

// ── The reel, as the model reads it ────────────────────────────────────────

type Reel = { clock: ClockFrame[]; total: number; closeStart: number | null; hookFrame: number | null; peakFrames: number[]; landingFrames: number[]; /** Frame 1 plays a hook, whose score is the opening's arc. */ hooked?: boolean };

const lineIds = (f: ClockFrame) => String(f.fields.lines ?? '').split(/[,\s]+/).filter(Boolean);

function reelOf(clock: ClockFrame[], draft: WriterDraft, plan?: DirectorPlan): Reel {
  const total = r3(clock.reduce((n, f) => n + f.duration, 0));
  const rungLines = (id: string) => new Set((draft.rungs ?? []).find((r) => r.id === id)?.lines.map((l) => l.id) ?? []);
  const framesFor = (ids: Set<string>) => clock.filter((f) => lineIds(f).some((l) => ids.has(l))).map((f) => f.number);
  const close = clock.find((f) => String(f.fields.treatment ?? '').trim().toLowerCase() === 'close');
  return {
    clock,
    total,
    closeStart: close ? close.start : null,
    hookFrame: framesFor(new Set([draft.hook?.line_id].filter(Boolean)))[0] ?? (clock[0]?.number ?? null),
    peakFrames: framesFor(rungLines(peakRungId(draft))),
    landingFrames: framesFor(rungLines(draft.landing_rung_id)),
    hooked: Boolean(plan?.hook),
  };
}

/** Where spoken words land in a frame, in reel seconds; null when they aren't found. */
function wordsAt(f: ClockFrame, on: string): number | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const want = norm(on).split(' ').filter(Boolean);
  if (!want.length) return r3(f.start);
  const said = f.words.map((w) => norm(w.text));
  const at = said.findIndex((_, i) => want.every((w, j) => said[i + j] === w));
  return at < 0 ? null : r3(f.start + f.words[at]!.start);
}

/** The hook's score as the designer reads it: the frame's own sounds don't exist on disk until compile, which runs after this step. */
function hookScoreLine(f: ClockFrame, hook: HookChoice): string {
  const at = (on: string) => {
    const t = wordsAt(f, on);
    return `"${on}"${t == null ? '' : ` @${t}`}`;
  };
  return `  opening hook ${hook.id}: its own score plays through this whole frame, a sound on every visible step, on ${hook.beats.map((b) => at(b.on)).join(', ')}, its main hit on ${at(hook.charged)}. It stays; add to it, never remove it, and the voice stays on top.`;
}

export function soundUserText(reel: Reel, draft: WriterDraft, plan: DirectorPlan, ownSounds: ReadonlyMap<number, string> = new Map()): string {
  const one = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const planFrames = new Map((plan.frames ?? []).map((f) => [one(f.name), f]));
  return [
    `Reel: ${one(draft.title)} (${reel.total}s, ${reel.clock.length} frames; the last is the brand close${reel.closeStart != null ? ` from ${reel.closeStart}s` : ''})`,
    `Opening line: "${one(draft.rungs?.flatMap((r) => r.lines).find((l) => l.id === draft.hook?.line_id)?.text)}" (line ${draft.hook?.line_id}, frame ${reel.hookFrame ?? '?'})`,
    `Peak: frames ${reel.peakFrames.join(', ') || 'unknown'}. Landing: frames ${reel.landingFrames.join(', ') || 'unknown'}.`,
    '',
    'Frames (reel seconds; words as [index] word @start):',
    ...reel.clock.flatMap((f) => {
      const fl = f.fields;
      const planned = planFrames.get(one(f.name));
      // A blueprint's fields as the storyboard writes them; a saved plan's free text otherwise.
      const sound = one(fl.sounds) || one(fl.sound) || one(planned?.sound);
      const motion = one(fl.camera) || one(fl.motion) || one(planned?.motion);
      const shots = planned?.shots ?? [];
      return [
        `Frame ${f.number} "${one(f.name)}" ${f.start}–${r3(f.start + f.duration)}s · ${one(fl.treatment) || 'photo'} · music mark: ${one(fl.music) || 'hold'}`,
        ...(one(fl.purpose) ? [`  purpose: ${one(fl.purpose)}`] : []),
        ...(one(fl.on_screen) ? [`  on screen: ${one(fl.on_screen)}`] : []),
        ...(motion ? [`  motion: ${motion}`] : []),
        ...(sound ? [`  director's sound note: ${sound}`] : []),
        ...(plan.hook && f.number === reel.hookFrame ? [hookScoreLine(f, plan.hook)] : []),
        ...(ownSounds.get(f.number) ? [`  its own sounds (reel seconds): ${ownSounds.get(f.number)}`] : []),
        ...shots.map((s) => `  shot from "${one(s.at)}": ${one(s.shows)}${s.introduces ? ` (introduces ${one(s.introduces)})` : ''}`),
        `  words: ${f.words.length ? f.words.map((w, i) => `[${i}] ${w.text} @${r3(f.start + w.start)}`).join(' ') : '(no voice)'}`,
      ];
    }),
  ].join('\n');
}

// ── Validation ─────────────────────────────────────────────────────────────

type RawAnchor = { frame?: unknown; word?: unknown; offset?: unknown };
type RawCues = {
  music?: (RawAnchor & { action?: unknown; style?: unknown; gain?: unknown; dur?: unknown; why?: unknown })[];
  stingers?: (RawAnchor & { kind?: unknown; dur?: unknown; id?: unknown; gain?: unknown; why?: unknown })[];
  ambience?: { from_frame?: unknown; to_frame?: unknown; id?: unknown; gain?: unknown; why?: unknown }[];
  muffles?: (RawAnchor & { dur?: unknown; why?: unknown })[];
};

/** A muffle's length in seconds, and how many one reel may use. */
const MUFFLE_DUR: [number, number] = [1, 12];
const MUFFLE_MAX = 2;
/** Room for every cue: a full plan runs about 6,000 tokens, and a cut-off plan loses all its cues. */
const SOUND_MAX_TOKENS = 16000;
/** A plan this small means the call failed; music alone is not a design. */
const NEARLY_EMPTY = 2;
const DUR: Record<string, [number, number]> = { riser: [1, 4.4], whoosh: [0.2, 2.5], silence: [0.3, 1], hit: [0, 0], sub: [0, 0], spot: [0, 0] };
const GAIN: Record<string, [number, number]> = { hit: [0.3, 1.2], sub: [0.3, 1.2], riser: [0.2, 1], whoosh: [0.2, 0.8], spot: [0.2, 0.9], silence: [0, 0] };
/** Research 07 §7, per 60 s (scaled to the reel, never below the floor). */
const PER_MIN = { sections: 4, stops: 2, silences: 2, whooshes: 12, spot: 25 };
const cap = (perMin: number, total: number) => Math.max(perMin, Math.round((perMin * total) / 60));

/**
 * Validate the model's cues against the locked timing and the library. Returns the cues to write and
 * every problem (a dropped cue says why; a `warning:` keeps the cues but flags a craft gap). Pure.
 */
export function validateCues(raw: RawCues, reel: Reel, lib: SoundLibrary): { cues: SoundCues; problems: string[] } {
  const problems: string[] = [];
  const { clock, total } = reel;
  const anchorOf = (c: RawAnchor): CueAnchor => ({ frame: Number(c.frame), word: c.word == null ? null : Number(c.word), offset: clamp(c.offset, -6, 6, 0) });
  const timeOf = (a: CueAnchor) => anchorTime(clock, a) as number | null;
  const speech = clock.flatMap((f) => f.words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end)).map((w) => ({ start: f.start + w.start, end: f.start + w.end })));
  const why = (v: unknown) => String(v ?? '').trim().slice(0, 200);

  // Music
  const music: MusicCue[] = [];
  let on = false;
  let played = false;
  let sections = 0;
  let stops = 0;
  const rawMusic = (raw.music ?? []).map((c) => ({ c, at: anchorOf(c) })).map((x) => ({ ...x, t: timeOf(x.at) }));
  // A swell peaking on a stop's own instant comes first: music is still playing when it peaks.
  const swellFirst = (x: { c: RawAnchor & { action?: unknown } }) => (String(x.c.action) === 'swell' ? 0 : 1);
  for (const { c, at, t } of rawMusic.sort((a, b) => (a.t ?? -1) - (b.t ?? -1) || swellFirst(a) - swellFirst(b))) {
    const name = `music ${c.action} at frame ${at.frame}`;
    if (t == null || t < 0 || t >= total) {
      problems.push(`${name}: anchor is not a frame/word of the reel or falls outside it; dropped`);
      continue;
    }
    const action = String(c.action) as MusicAction;
    if (!(MUSIC_ACTIONS as string[]).includes(action)) {
      problems.push(`${name}: unknown action; dropped`);
      continue;
    }
    const style = typeof c.style === 'string' ? (styleKey(c.style) as string | null) : null;
    if (c.style != null && !style) problems.push(`${name}: style "${String(c.style)}" is not in the library; the rotation's style is used`);
    if (action === 'resume' && style) problems.push(`warning: ${name}: a resume brings the same music back; its style "${style}" is ignored (a new mood after a stop is a change)`);
    if ((action === 'drop' || action === 'cut') && !why(c.why)) {
      problems.push(`${name}: stopping the music needs a stated reason; dropped`);
      continue;
    }
    const bad =
      (action === 'start' && on) || (action === 'resume' && (on || !played)) || ((action === 'drop' || action === 'cut' || action === 'swell') && !on);
    if (bad) {
      problems.push(`${name}: out of order (music is ${on ? 'playing' : 'off'}); dropped`);
      continue;
    }
    if (action === 'start' || action === 'change') {
      if (++sections > cap(PER_MIN.sections, total)) {
        problems.push(`${name}: more music sections than the reel can carry; dropped`);
        continue;
      }
    }
    if (action === 'drop' || action === 'cut') {
      if (++stops > cap(PER_MIN.stops, total)) {
        problems.push(`${name}: too many music drops; dropped`);
        continue;
      }
    }
    const gain = action === 'swell' ? clamp(c.gain, BED_VOLUME, SWELL_MAX, SWELL_MAX) : action === 'drop' || action === 'cut' ? 0 : clamp(c.gain, GAIN_RANGE[0], GAIN_RANGE[1], BED_VOLUME);
    if (action === 'start' || action === 'change' || action === 'resume') {
      on = true;
      played = true;
    }
    if (action === 'drop' || action === 'cut') on = false;
    const rise = action === 'swell' ? { dur: r3(clamp(c.dur, SWELL_RISE[0], SWELL_RISE[1], SWELL_IN)) } : {};
    music.push({ t: r3(t), action, style: action === 'start' || action === 'change' ? style : null, gain, ...rise, at, why: why(c.why) });
  }

  // Stingers
  type S = StingerCue & { at: CueAnchor };
  let stingers: S[] = [];
  for (const c of raw.stingers ?? []) {
    const at = anchorOf(c);
    const kind = String(c.kind) as StingerKind;
    const name = `${kind} at frame ${at.frame}${at.word != null ? ` word ${at.word}` : ''}`;
    const t = timeOf(at);
    if (!(STINGER_KINDS as string[]).includes(kind)) {
      problems.push(`${name}: unknown kind; dropped`);
      continue;
    }
    if (t == null || t < 0 || t > total) {
      problems.push(`${name}: anchor is not a frame/word of the reel or falls outside it; dropped`);
      continue;
    }
    let id: string | null = null;
    if (kind !== 'silence') {
      const listed = lib.stingers[kind] ?? [];
      if (c.id != null && !listed.some((e) => e.id === c.id)) {
        problems.push(`${name}: sound "${String(c.id)}" is not a ${kind} in the library; dropped`);
        continue;
      }
      id = (c.id as string | null) ?? listed[0]?.id ?? null;
      if (!id) {
        problems.push(`${name}: the library has no ${kind}; dropped`);
        continue;
      }
    }
    const [lo, hi] = DUR[kind];
    let dur = kind === 'riser' ? Math.min(hi, (stingerEntry(kind, id) as { land: number } | null)?.land ?? hi) : hi;
    dur = kind === 'hit' || kind === 'sub' || kind === 'spot' ? 0 : clamp(c.dur, lo, dur, lo);
    if (kind === 'riser' && t - dur < 0) {
      if (t < lo) {
        problems.push(`${name}: no room for a riser before ${r3(t)}s; dropped`);
        continue;
      }
      dur = r3(t);
    }
    if (kind === 'silence') {
      if (!why(c.why)) {
        problems.push(`${name}: a silence needs a stated reason; dropped`);
        continue;
      }
      if (t + dur > total) {
        problems.push(`${name}: runs past the end of the reel; dropped`);
        continue;
      }
      if (speech.some((w) => w.start < t + dur - 0.05 && w.end > t + 0.05)) {
        problems.push(`${name}: silence over a spoken word; dropped`);
        continue;
      }
    }
    const [glo, ghi] = GAIN[kind];
    const gain = kind === 'silence' ? 0 : clamp(c.gain, glo, ghi, (STINGER_GAIN as Record<string, number>)[kind]);
    stingers.push({ t: r3(t), kind, dur: r3(dur), gain, id, at, why: why(c.why) });
  }
  stingers.sort((a, b) => a.t - b.t);

  // Heavy hits: one per HEAVY_SPACING seconds (never two within ~2 s, research 07 §3).
  let lastHeavy = -Infinity;
  stingers = stingers.filter((s) => {
    if (!(HEAVY_KINDS as string[]).includes(s.kind)) return true;
    if (s.t - lastHeavy < HEAVY_SPACING) {
      problems.push(`${s.kind} at ${s.t}s: within ${HEAVY_SPACING}s of the heavy hit at ${r3(lastHeavy)}s; dropped`);
      return false;
    }
    lastHeavy = s.t;
    return true;
  });
  repairVoiceStops(music, stingers, speech, reel, problems);
  // Every riser resolves into a kept hit/sub, a music entry or a stop it builds to.
  const landings = [...stingers.filter((s) => (HEAVY_KINDS as string[]).includes(s.kind)).map((s) => s.t), ...music.filter((m) => m.action !== 'swell').map((m) => m.t)];
  stingers = stingers.filter((s) => {
    if (s.kind !== 'riser' || landings.some((t) => Math.abs(t - s.t) <= 0.15)) return true;
    problems.push(`riser landing at ${s.t}s: resolves into nothing (no hit, sub or music entry there); dropped`);
    return false;
  });
  // Density.
  const count = { silence: 0, whoosh: 0, spot: 0 };
  stingers = stingers.filter((s) => {
    const over = (n: number, limit: number, what: string) => {
      if (n <= limit) return false;
      problems.push(`${s.kind} at ${s.t}s: more ${what} than the reel can carry; dropped`);
      return true;
    };
    if (s.kind === 'silence' && over(++count.silence, cap(PER_MIN.silences, total), 'silences')) return false;
    if (s.kind === 'whoosh' && over(++count.whoosh, cap(PER_MIN.whooshes, total), 'whooshes')) return false;
    return !over(++count.spot, cap(PER_MIN.spot, total), 'spot cues');
  });

  // Ambience: real frames and ids, one bed at a time.
  const ambIds = new Set(lib.ambience.map((a) => a.id));
  let ambience: AmbienceCue[] = [];
  for (const c of raw.ambience ?? []) {
    const a = clock.find((f) => f.number === Number(c.from_frame));
    const b = clock.find((f) => f.number === Number(c.to_frame));
    const name = `ambience ${String(c.id)} frames ${String(c.from_frame)}–${String(c.to_frame)}`;
    if (!a || !b || b.number < a.number) {
      problems.push(`${name}: not a frame range of the reel; dropped`);
      continue;
    }
    if (typeof c.id !== 'string' || !ambIds.has(c.id)) {
      problems.push(`${name}: not an ambience bed in the library; dropped`);
      continue;
    }
    ambience.push({ start: a.start, end: r3(b.start + b.duration), id: c.id, gain: clamp(c.gain, 0.05, 0.5, 0.3), frames: [a.number, b.number], why: why(c.why) });
  }
  ambience.sort((x, y) => x.start - y.start);
  ambience = ambience.filter((x, i) => {
    const next = ambience[i + 1];
    if (next && next.start < x.end) {
      problems.push(`ambience ${x.id}: overlaps ${next.id}; it ends where the next begins`);
      x.end = next.start;
      if (x.end - x.start < 0.5) return false;
    }
    return true;
  });

  // Craft gaps the code can see (kept as warnings; the cues stay).
  repairMusic(music, stingers, reel, problems);
  const openArc = stingers.some((s) => s.kind === 'riser' && s.t <= 6.5);
  // The riser-to-hit arc is the default opening, not a must: a teased line may hold or swell instead, and a hook brings its own score.
  if (!reel.hooked && !openArc && !music.some((m) => m.action === 'swell' && m.t <= 6.5)) problems.push('warning: no riser-to-hit arc or swell in the cold open');
  const muffles = validMuffles(raw.muffles ?? [], music, stingers, reel, problems, { timeOf: (c) => timeOf(anchorOf(c)), anchorOf, why });
  return { cues: { music, stingers, ambience, muffles }, problems };
}

/** Keep the muffles music plays through whole, with a reason, at most MUFFLE_MAX, and none that reach the close. */
function validMuffles(
  raw: NonNullable<RawCues['muffles']>,
  music: readonly MusicCue[],
  stingers: readonly StingerCue[],
  reel: Reel,
  problems: string[],
  { timeOf, anchorOf, why }: { timeOf: (c: RawAnchor) => number | null; anchorOf: (c: RawAnchor) => CueAnchor; why: (v: unknown) => string },
): MuffleCue[] {
  const end = reel.closeStart ?? reel.total;
  const off = musicGaps(music, stingers.filter((s) => s.kind === 'silence'), end);
  const out: MuffleCue[] = [];
  const sorted = raw.map((c) => ({ c, t: timeOf(c) })).sort((a, b) => (a.t ?? -1) - (b.t ?? -1));
  for (const { c, t } of sorted) {
    const name = `muffle at ${String(t)}`;
    if (t == null || t > end) {
      problems.push(`${name}: not a moment before the close; dropped`);
      continue;
    }
    const dur = r3(Math.min(t, clamp(c.dur, MUFFLE_DUR[0], MUFFLE_DUR[1], MUFFLE_DUR[0])));
    const from = t - dur;
    const last = out[out.length - 1];
    if (!why(c.why) || dur < MUFFLE_DUR[0] || out.length >= MUFFLE_MAX || (last && from < last.t) || off.some((g) => g.start < t && g.end > from)) {
      problems.push(`${name}: needs a reason, room, and music playing through it, at most ${MUFFLE_MAX} a reel; dropped`);
      continue;
    }
    out.push({ t: r3(t), dur, at: anchorOf(c), why: why(c.why) });
  }
  return out;
}

// ── Music as the driving force (MD-142) ────────────────────────────────────

/** Stretches before `end` longer than MUSIC_GAP_MAX with no music: stopped music and silences joined. Pure. */
export function musicGaps(music: readonly Pick<MusicCue, 't' | 'action'>[], silences: readonly { t: number; dur: number }[], end: number): { start: number; end: number }[] {
  const off: { start: number; end: number }[] = [];
  let from: number | null = 0;
  for (const c of [...music].sort((a, b) => a.t - b.t)) {
    if (c.t >= end) break;
    if (c.action === 'drop' || c.action === 'cut') {
      if (from === null) from = c.t;
    } else if (c.action !== 'swell' && from !== null) {
      off.push({ start: from, end: c.t });
      from = null;
    }
  }
  if (from !== null) off.push({ start: from, end });
  for (const s of silences) if (s.t < end) off.push({ start: s.t, end: Math.min(end, s.t + s.dur) });
  const merged: { start: number; end: number }[] = [];
  for (const g of off.sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && g.start <= last.end + 0.05) last.end = Math.max(last.end, g.end);
    else if (g.end > g.start) merged.push({ ...g });
  }
  return merged.filter((g) => g.end - g.start > MUSIC_GAP_MAX + 0.001).map((g) => ({ start: r3(g.start), end: r3(g.end) }));
}

/** The anchor for a time code chooses: the frame it falls in, as an offset from the frame's start. */
function anchorAtTime(clock: readonly ClockFrame[], t: number): CueAnchor {
  const f = [...clock].reverse().find((x) => x.start <= t) ?? clock[0];
  return { frame: f.number, word: null, offset: r3(t - f.start) };
}

/**
 * Silence under the voice must read as deliberate (MD-148), in place. A stop longer than VOICE_STOP.free under spoken
 * words needs a build peaking on it; without one the music keeps playing (the stop and its resume go). With one, it is
 * brought back by VOICE_STOP.held. The close is repairMusic's.
 */
function repairVoiceStops(music: MusicCue[], stingers: readonly StingerCue[], speech: readonly { start: number; end: number }[], reel: Reel, problems: string[]): void {
  const offUntil = (i: number) => music.slice(i + 1).find((m) => m.action !== 'swell') ?? null;
  for (let i = 0; i < music.length; i++) {
    const stop = music[i];
    if ((stop.action !== 'drop' && stop.action !== 'cut') || (reel.closeStart != null && stop.t >= reel.closeStart)) continue;
    const back = offUntil(i);
    const end = back?.t ?? reel.total;
    if (end - stop.t <= VOICE_STOP.free + 0.001 || !speech.some((w) => w.start < end - 0.05 && w.end > stop.t + 0.05)) continue;
    const near = (t: number) => Math.abs(t - stop.t) <= VOICE_STOP.peak;
    const roomBefore = (peak: number, rise: number) => peak - rise >= 0 && !music.some((m, k) => (m.action === 'drop' || m.action === 'cut') && k !== i && m.t < peak && (offUntil(k)?.t ?? reel.total) > peak - rise);
    const built =
      music.some((m) => m.action === 'swell' && near(m.t) && roomBefore(m.t, m.dur ?? SWELL_IN)) ||
      stingers.some((s) => s.kind === 'riser' && near(s.t) && s.dur >= VOICE_STOP.riser && s.t - s.dur >= 0);
    if (!built) {
      problems.push(`warning: music ${stop.action} at ${stop.t}s: ${r3(end - stop.t)}s without music under the voice and no build peaking on it; the music keeps playing`);
      music.splice(i, 1);
      if (back?.action === 'resume') music.splice(music.indexOf(back), 1);
      i--;
      continue;
    }
    if (end - stop.t > VOICE_STOP.held + 0.001) {
      const t = r3(stop.t + VOICE_STOP.held);
      problems.push(`warning: music ${stop.action} at ${stop.t}s runs ${r3(end - stop.t)}s under the voice; code brings it back at ${t}s`);
      if (back?.action === 'resume') Object.assign(back, { t, at: anchorAtTime(reel.clock, t) });
      else {
        const before = [...music.slice(0, i)].reverse().find((m) => m.gain > 0 && m.action !== 'swell');
        music.splice(i + 1, 0, { t, action: 'resume', style: null, gain: before?.gain ?? BED_VOLUME, at: anchorAtTime(reel.clock, t), why: 'a stop under the voice stays short' });
      }
    }
  }
}

/** The rules code enforces on the kept cues, in place: music from the first instant, no long gap, playing into the close. */
function repairMusic(music: MusicCue[], stingers: readonly StingerCue[], reel: Reel, problems: string[]): void {
  const { clock, closeStart, total } = reel;
  const end = closeStart ?? total;
  const anchorAt = (t: number): CueAnchor => anchorAtTime(clock, t);
  const sort = () => music.sort((a, b) => a.t - b.t);
  if (closeStart != null) {
    for (let i = music.length - 1; i >= 0; i--) {
      const m = music[i];
      if ((m.action === 'drop' || m.action === 'cut') && m.t >= closeStart) {
        problems.push(`music ${m.action} at ${m.t}s: the score resolves across the close; dropped`);
        music.splice(i, 1);
      }
    }
  }
  if (!music.some((m) => m.action === 'start' && m.t <= 0.3)) {
    problems.push('warning: the cold open has no music bed from frame 1; code starts it on the first instant');
    const first = music.find((m) => m.action === 'start');
    if (first) Object.assign(first, { t: 0, at: anchorAt(0) });
    else music.push({ t: 0, action: 'start', style: null, gain: BED_VOLUME, at: anchorAt(0), why: 'music from the first instant' });
    sort();
  }
  const silences = stingers.filter((s) => s.kind === 'silence');
  for (const gap of musicGaps(music, silences, end)) {
    const limit = r3(gap.start + MUSIC_GAP_MAX);
    // On a cut when one falls in the window, so the return reads as a choice.
    const t = clock.map((f) => f.start).filter((s) => s > gap.start + 2 && s <= limit).pop() ?? limit;
    const back = music.find((m) => Math.abs(m.t - gap.end) < 0.01 && (m.action === 'start' || m.action === 'resume'));
    problems.push(`warning: ${r3(gap.end - gap.start)}s without music from ${gap.start}s; code brings it back at ${t}s`);
    if (back) Object.assign(back, { t, at: anchorAt(t) });
    else {
      const before = [...music].reverse().find((m) => m.t <= t && m.gain > 0 && m.action !== 'swell');
      music.push({ t, action: 'resume', style: null, gain: before?.gain ?? BED_VOLUME, at: anchorAt(t), why: 'music comes back; a stop this long loses the viewer' });
    }
    sort();
  }
  if (closeStart != null) {
    let on = false;
    for (const m of music) {
      if (m.t > closeStart) break;
      if (m.action === 'drop' || m.action === 'cut') on = false;
      else if (m.action !== 'swell') on = true;
    }
    if (!on) {
      const before = [...music].reverse().find((m) => m.gain > 0 && m.action !== 'swell');
      problems.push(`warning: no music playing into the close; code brings it back at ${closeStart}s`);
      music.push({ t: closeStart, action: 'resume', style: null, gain: before?.gain ?? BED_VOLUME, at: anchorAt(closeStart), why: 'the score resolves across the close' });
      sort();
    }
  }
}

// ── The step ───────────────────────────────────────────────────────────────

/** Each frame's own sounds (assets/frames/<id>.events.json) in reel seconds, for the designer to leave alone. */
function frameSounds(projectDir: string, clock: readonly ClockFrame[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const f of clock) {
    const list = readJson<{ t?: number; kind?: string; what?: string; src?: string }[]>(path.join(projectDir, 'assets', 'frames', `${f.id}.events.json`));
    if (!Array.isArray(list)) continue;
    const text = list.filter((e) => e.kind !== 'ambience' && Number.isFinite(e.t)).map((e) => `${e.what ?? (e.src ? path.basename(e.src) : e.kind)} @${r3(f.start + Number(e.t))}`).slice(0, 12).join(', ');
    if (text) out.set(f.number, text);
  }
  return out;
}

/**
 * Plan the reel's sound and write sound_cues.json into the project (MD-61). Run after pace, with the
 * frames and assets/timing final. Fails open: on any error no cues are written and the problem is
 * returned (the kit keeps today's behaviour). When music cues are written, audio_meta.json's `bgm` is
 * cleared so the next assemble lays the designed music.
 */
export async function designSound(
  input: { projectDir: string; draft: WriterDraft; plan: DirectorPlan },
  deps: SoundDesignDeps,
): Promise<{ cues: SoundCues | null; usd: number; problems: string[] }> {
  const { projectDir, draft, plan } = input;
  let usd = 0;
  try {
    const clock = frameClock(projectDir) as ClockFrame[];
    if (!clock.length) return { cues: null, usd, problems: ['sound design: STORYBOARD.md has no frames; no cues'] };
    if (!clock.some((f) => f.words.length)) return { cues: null, usd, problems: ['sound design: no word timing in assets/timing (run pace first); no cues'] };
    const reel = reelOf(clock, draft, plan);
    const lib = soundLibrary(projectDir);
    const prompt = deps.loadPrompt ? deps.loadPrompt() : fs.readFileSync(path.join(process.cwd(), PROMPT_FILE), 'utf8').trim();
    const tool = soundCuesTool(lib);
    const attempt = async () => {
      const message = await deps.create({
        model: deps.model,
        max_tokens: SOUND_MAX_TOKENS,
        tools: [withToolCache(tool)],
        // The 5.5 models reject a forced tool choice (400); the prompt asks for exactly one call.
        tool_choice: { type: 'auto' },
        system: cachedSystemText(`${prompt}\n\n---\n\n${libraryText(lib)}`),
        messages: [{ role: 'user', content: soundUserText(reel, draft, plan, frameSounds(projectDir, clock)) }],
      });
      const usages = [message as unknown as MessageUsageLike];
      const spent = messagesUsd(usages, message.model || deps.model);
      usd += spent;
      if (deps.db) {
        await recordCost(deps.db, { jobId: deps.jobId ?? null, mode: deps.mode ?? 'production', vendor: 'anthropic', component: 'sound_design', ...usageTotals(usages), usd: spent });
      }
      deps.log?.({ event: 'sound_design', usd: spent, content: message.content });
      const call = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === tool.name);
      if (!call) return { failure: `no ${tool.name} call (${message.stop_reason})`, cues: null, problems: [] as string[] };
      const { cues, problems } = validateCues(call.input as RawCues, reel, lib);
      const size = cues.music.length + cues.stingers.length + cues.ambience.length;
      const failure = message.stop_reason === 'max_tokens' ? 'the plan was cut off' : size <= NEARLY_EMPTY ? 'the plan came back nearly empty' : null;
      return { failure, cues, problems };
    };
    // A failed plan means a reel with no sound design, so it gets one more try and is never shipped silently.
    let result = await attempt();
    if (result.failure) result = await attempt();
    const { cues, failure } = result;
    const problems = failure ? [...result.problems, `sound design: ${failure}, after a retry`] : result.problems;
    if (!cues) return { cues: null, usd, problems };
    fs.writeFileSync(path.join(projectDir, CUES_FILE), `${JSON.stringify(cues, null, 1)}\n`);
    if (cues.music.length) {
      const metaFile = path.join(projectDir, 'audio_meta.json');
      const meta = readJson<Record<string, unknown>>(metaFile);
      if (meta?.bgm) fs.writeFileSync(metaFile, `${JSON.stringify({ ...meta, bgm: null }, null, 1)}\n`);
    }
    return { cues, usd, problems };
  } catch (error) {
    return { cues: null, usd, problems: [`sound design failed, no cues (the kit keeps its default sound): ${error instanceof Error ? error.message : String(error)}`] };
  }
}
