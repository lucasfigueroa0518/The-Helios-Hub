import fs from 'node:fs';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

import { STYLE_KEYS } from '@/explainers/reel-ai-drama/kit/music.mjs';
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
import type { DirectorPlan, Mode, WriterDraft } from '@/lib/reel-ai-drama/types';

/**
 * The sound designer (MD-61, research 07): one Sonnet call after the timing is locked (after pace),
 * reading the frames, their word times, the hook, the turn and the landing, and the sound library, and
 * planning the music sections, stingers, silences and ambience. Code validates every cue (times inside
 * the reel, real ids, heavy-hit spacing, density), drops what breaks a rule as a problem, and writes
 * sound_cues.json; the kit's music.mjs and sound.mjs place them. Fails open: any error writes no cues
 * and the kit keeps today's behaviour.
 */

export type CueAnchor = { frame: number; word: number | null; offset: number };
export type MusicAction = 'start' | 'drop' | 'swell' | 'change' | 'cut' | 'resume';
export type StingerKind = 'hit' | 'riser' | 'whoosh' | 'sub' | 'silence';
export type MusicCue = { t: number; action: MusicAction; style: string | null; gain: number; at?: CueAnchor; why?: string };
export type StingerCue = { t: number; kind: StingerKind; dur: number; gain: number; id?: string | null; at?: CueAnchor; why?: string };
export type AmbienceCue = { start: number; end: number; id: string; gain: number; frames?: [number, number]; why?: string };
/** sound_cues.json (ITERATION-2.md, binding shape; `at`, `id`, `frames` and `why` are additive). */
export type SoundCues = { music: MusicCue[]; stingers: StingerCue[]; ambience: AmbienceCue[] };

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
    `Music style keys: ${(STYLE_KEYS as string[]).join(', ')} (pulse, piano and percussion are tense documentary beds; drone is a low tension bed; dread is ominous and slow; drive is urgent; reflect is sparse and bittersweet).`,
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
      music: { type: 'array', items: obj({ action: { type: 'string', enum: MUSIC_ACTIONS }, ...anchor, style: nullableEnum(STYLE_KEYS as string[]), gain: { type: ['number', 'null'] }, why: { type: 'string' } }) },
      stingers: { type: 'array', items: obj({ kind: { type: 'string', enum: STINGER_KINDS }, ...anchor, dur: { type: 'number' }, id: nullableEnum(stingerIds), gain: { type: ['number', 'null'] }, why: { type: 'string' } }) },
      ambience: { type: 'array', items: obj({ from_frame: { type: 'integer' }, to_frame: { type: 'integer' }, id: { type: 'string', enum: lib.ambience.map((a) => a.id) }, gain: { type: ['number', 'null'] }, why: { type: 'string' } }) },
    }) as unknown as Anthropic.Tool.InputSchema,
  } as Anthropic.Tool;
}

// ── The reel, as the model reads it ────────────────────────────────────────

type Reel = { clock: ClockFrame[]; total: number; closeStart: number | null; hookFrame: number | null; turnFrames: number[]; landingFrames: number[] };

const lineIds = (f: ClockFrame) => String(f.fields.lines ?? '').split(/[,\s]+/).filter(Boolean);

function reelOf(clock: ClockFrame[], draft: WriterDraft): Reel {
  const total = r3(clock.reduce((n, f) => n + f.duration, 0));
  const rungLines = (id: string) => new Set((draft.rungs ?? []).find((r) => r.id === id)?.lines.map((l) => l.id) ?? []);
  const framesFor = (ids: Set<string>) => clock.filter((f) => lineIds(f).some((l) => ids.has(l))).map((f) => f.number);
  const close = clock.find((f) => String(f.fields.treatment ?? '').trim().toLowerCase() === 'close');
  return {
    clock,
    total,
    closeStart: close ? close.start : null,
    hookFrame: framesFor(new Set([draft.hook?.line_id].filter(Boolean)))[0] ?? (clock[0]?.number ?? null),
    turnFrames: framesFor(rungLines(draft.turn_rung_id)),
    landingFrames: framesFor(rungLines(draft.landing_rung_id)),
  };
}

export function soundUserText(reel: Reel, draft: WriterDraft, plan: DirectorPlan): string {
  const one = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const planSound = new Map((plan.frames ?? []).map((f) => [one(f.name), one(f.sound)]));
  return [
    `Reel: ${one(draft.title)} (${reel.total}s, ${reel.clock.length} frames; the last is the brand close${reel.closeStart != null ? ` from ${reel.closeStart}s` : ''})`,
    `Hook: "${one(draft.hook?.on_screen)}" (line ${draft.hook?.line_id}, frame ${reel.hookFrame ?? '?'})`,
    `Turn: frames ${reel.turnFrames.join(', ') || 'unknown'}. Landing: frames ${reel.landingFrames.join(', ') || 'unknown'}.`,
    '',
    'Frames (reel seconds; words as [index] word @start):',
    ...reel.clock.flatMap((f) => {
      const fl = f.fields;
      const sound = one(fl.sound) || planSound.get(one(f.name)) || '';
      return [
        `Frame ${f.number} "${one(f.name)}" ${f.start}–${r3(f.start + f.duration)}s · ${one(fl.treatment) || 'photo'} · music mark: ${one(fl.music) || 'hold'}`,
        ...(one(fl.purpose) ? [`  purpose: ${one(fl.purpose)}`] : []),
        ...(one(fl.on_screen) ? [`  on screen: ${one(fl.on_screen)}`] : []),
        ...(sound ? [`  director's sound note: ${sound}`] : []),
        `  words: ${f.words.length ? f.words.map((w, i) => `[${i}] ${w.text} @${r3(f.start + w.start)}`).join(' ') : '(no voice)'}`,
      ];
    }),
  ].join('\n');
}

// ── Validation ─────────────────────────────────────────────────────────────

type RawAnchor = { frame?: unknown; word?: unknown; offset?: unknown };
type RawCues = {
  music?: (RawAnchor & { action?: unknown; style?: unknown; gain?: unknown; why?: unknown })[];
  stingers?: (RawAnchor & { kind?: unknown; dur?: unknown; id?: unknown; gain?: unknown; why?: unknown })[];
  ambience?: { from_frame?: unknown; to_frame?: unknown; id?: unknown; gain?: unknown; why?: unknown }[];
};

const DUR: Record<string, [number, number]> = { riser: [1, 4.4], whoosh: [0.2, 2.5], silence: [0.3, 1], hit: [0, 0], sub: [0, 0] };
const GAIN: Record<string, [number, number]> = { hit: [0.3, 1.2], sub: [0.3, 1.2], riser: [0.2, 1], whoosh: [0.2, 0.8], silence: [0, 0] };
/** Research 07 §7, per 60 s (scaled to the reel, never below the floor). */
const PER_MIN = { sections: 3, stops: 2, silences: 2, whooshes: 8, spot: 25 };
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
  for (const { c, at, t } of rawMusic.sort((a, b) => (a.t ?? -1) - (b.t ?? -1))) {
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
    const style = typeof c.style === 'string' && (STYLE_KEYS as string[]).includes(c.style) ? c.style : null;
    if (c.style != null && !style) problems.push(`${name}: style "${String(c.style)}" is not in the library; the rotation's style is used`);
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
    const gain = action === 'swell' ? clamp(c.gain, 0.16, 0.32, 0.32) : action === 'drop' || action === 'cut' ? 0 : clamp(c.gain, 0.06, 0.3, 0.16);
    if (action === 'start' || action === 'change' || action === 'resume') {
      on = true;
      played = true;
    }
    if (action === 'drop' || action === 'cut') on = false;
    music.push({ t: r3(t), action, style: action === 'start' || action === 'change' ? style : null, gain, at, why: why(c.why) });
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
    dur = kind === 'hit' || kind === 'sub' ? 0 : clamp(c.dur, lo, dur, lo);
    if (kind === 'riser' && t - dur < 0) {
      if (t < lo) {
        problems.push(`${name}: no room for a riser before ${r3(t)}s; dropped`);
        continue;
      }
      dur = r3(t);
    }
    if (kind === 'silence') {
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
  // Every riser resolves into a kept hit/sub or a music entry.
  const landings = [...stingers.filter((s) => (HEAVY_KINDS as string[]).includes(s.kind)).map((s) => s.t), ...music.filter((m) => ['start', 'change', 'resume'].includes(m.action)).map((m) => m.t)];
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
  if (!music.some((m) => m.action === 'start' && m.t <= 0.3)) problems.push('warning: the cold open has no music bed from frame 1');
  const openArc = stingers.some((s) => s.kind === 'riser' && s.t <= 6.5);
  if (!openArc) problems.push('warning: no riser-to-hit arc in the cold open');
  return { cues: { music, stingers, ambience }, problems };
}

// ── The step ───────────────────────────────────────────────────────────────

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
    const reel = reelOf(clock, draft);
    const lib = soundLibrary(projectDir);
    const prompt = deps.loadPrompt ? deps.loadPrompt() : fs.readFileSync(path.join(process.cwd(), PROMPT_FILE), 'utf8').trim();
    const tool = soundCuesTool(lib);
    const message = await deps.create({
      model: deps.model,
      max_tokens: 6000,
      tools: [withToolCache(tool)],
      tool_choice: { type: 'tool', name: tool.name },
      system: cachedSystemText(`${prompt}\n\n---\n\n${libraryText(lib)}`),
      messages: [{ role: 'user', content: soundUserText(reel, draft, plan) }],
    });
    const usages = [message as unknown as MessageUsageLike];
    usd = messagesUsd(usages, message.model || deps.model);
    if (deps.db) {
      await recordCost(deps.db, { jobId: deps.jobId ?? null, mode: deps.mode ?? 'production', vendor: 'anthropic', component: 'sound_design', ...usageTotals(usages), usd });
    }
    deps.log?.({ event: 'sound_design', usd, content: message.content });
    const call = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === tool.name);
    if (!call) return { cues: null, usd, problems: [`sound design: no ${tool.name} call (${message.stop_reason}); no cues`] };
    const { cues, problems } = validateCues(call.input as RawCues, reel, lib);
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
