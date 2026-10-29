import type Anthropic from '@anthropic-ai/sdk';

import { ephemeralCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages, type MessageUsageLike } from '@/lib/anthropic-pricing';
import type { Queryable } from '@/lib/explainers/db';
import { recordCost } from '@/lib/reel-ai-drama/cost';
import { BLUE_CHIP_PLAYERS, bluePlayer } from '@/lib/social-hub/blue-chip-players';
import {
  ERAS,
  STORY_TYPES,
  VISUAL_KINDS,
  type CastMember,
  type Era,
  type ExpectedVisual,
  type Pitch,
  type SourceRef,
  type StoryType,
  type VisualKind,
} from '@/lib/reel-ai-drama/types';
import type { CellRow, NewsItem } from '@/lib/reel-ai-drama/development/ledger';
import { appendJsonl } from '@/lib/reel-ai-drama/development/log';
import { isPlayerId, norm, playerIdForName } from '@/lib/reel-ai-drama/development/util';

/**
 * The development producer (PROCESS.md D2, MD-21): one cell per call, Sonnet with web search and fetch,
 * a strict `submit_pitches` tool. Diversity is engineered (research 05 §9): the cell fixes the niche,
 * only the nearest past pitches for the cell are shown, and the model returns more candidates than we
 * keep, each with an estimated typicality; we keep the least typical that pass validation.
 */

export const MAX_SEARCHES = 6;
export const MAX_FETCHES = 6;
export const MAX_TOKENS = 32_000;
export const MAX_CONTINUATIONS = 4;
/** Nearest past pitches shown for a cell (research 05: never the whole ledger). */
export const MAX_NEAREST = 12;

/** Candidates asked for per kept pitch: the tail is where the less typical ideas are. */
export const CANDIDATE_FACTOR = 2;

export type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

export type ProducerDeps = {
  db: Queryable;
  /** `client.messages.stream(params).finalMessage()` (see `anthropicCreate`), or a stub. */
  create: CreateMessage;
  /** B3's `loadPrompt`; tests pass a stub string. */
  loadPrompt: (name: 'producer') => string;
  model: string;
  pitchesPerCell: number;
  sessionId?: string | null;
};

export type ProducerContext = { nearest: Pitch[]; news: NewsItem[]; today: string };

export type ProduceResult = {
  pitches: Pitch[];
  usd: number;
  queries: string[];
  webSearches: number;
  /** Candidates dropped by validation, with why (for the searches row and the lab). */
  dropped: { title: string; why: string }[];
};

// ── The submit tool (strict; its schema is the Pitch type plus `typicality`) ──

const str = { type: 'string' } as const;
const nullableStr = { type: ['string', 'null'] } as const;

export const SUBMIT_PITCHES_TOOL = {
  name: 'submit_pitches',
  description:
    'Submit the candidate pitches for this cell. Call it exactly once, at the end. An empty list means the cell holds no story that meets the bar.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['candidates'],
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'title', 'logline', 'pitch', 'story_type', 'era', 'event_date', 'date_precision', 'cast', 'central_figure',
            'scene', 'turn', 'implication', 'why_now', 'engine', 'expected_visuals', 'sources', 'typicality',
          ],
          properties: {
            title: str,
            logline: str,
            pitch: str,
            story_type: { type: 'string', enum: Object.keys(STORY_TYPES) },
            era: { type: 'string', enum: Object.keys(ERAS) },
            event_date: str,
            date_precision: { type: 'string', enum: ['day', 'month', 'year'] },
            cast: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'role', 'kind', 'player_id', 'want'],
                properties: { name: str, role: str, kind: { type: 'string', enum: ['person', 'company'] }, player_id: nullableStr, want: str },
              },
            },
            central_figure: str,
            scene: str,
            turn: str,
            implication: str,
            why_now: nullableStr,
            engine: str,
            expected_visuals: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['kind', 'what', 'hint'],
                properties: { kind: { type: 'string', enum: [...VISUAL_KINDS] }, what: str, hint: str },
              },
            },
            sources: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['url', 'title', 'publisher', 'date'],
                properties: { url: str, title: str, publisher: str, date: nullableStr },
              },
            },
            typicality: { type: 'number' },
          },
        },
      },
    },
  },
} as const;

/** Server tools in a fixed order so the cached prefix never changes (RC-58 versions). */
export const PRODUCER_SERVER_TOOLS = [
  { type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES },
  { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: MAX_FETCHES },
] as const;

/** The blue-chip roster the cast's player_id must come from: stable, so it sits in the cached system. */
export function rosterBlock(): string {
  return JSON.stringify({ blue_chip_players: BLUE_CHIP_PLAYERS.map((p) => ({ player_id: p.id, name: p.name, kind: p.kind })) });
}

/** The per-call data (the user message): the cell, what is already pitched near it, related news. */
export function producerUserMessage(cell: CellRow, ctx: ProducerContext, pitchesPerCell: number): string {
  const player = bluePlayer(cell.player_id);
  return JSON.stringify(
    {
      today: ctx.today,
      cell: {
        player: { player_id: cell.player_id, name: player?.name ?? cell.player_id, kind: player?.kind ?? null },
        story_type: { key: cell.story_type, label: STORY_TYPES[cell.story_type] },
        era: { key: cell.era, label: ERAS[cell.era] },
        searched_before: cell.searches,
        reopened_by: cell.reopen_reason,
      },
      candidates_wanted: pitchesPerCell * CANDIDATE_FACTOR,
      already_pitched: ctx.nearest.slice(0, MAX_NEAREST).map((p) => ({
        title: p.title,
        event_date: p.event_date,
        central_figure: p.central_figure,
        cast: p.cast.map((c) => c.name),
        story_type: p.story_type,
      })),
      news: ctx.news.slice(0, 10).map((n) => ({ headline: n.headline, url: n.url, published_at: n.publishedAt })),
    },
    null,
    1,
  );
}

export function producerParams(
  deps: Pick<ProducerDeps, 'loadPrompt' | 'model'>,
  messages: Anthropic.MessageParam[],
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: deps.model,
    max_tokens: MAX_TOKENS,
    tools: [...PRODUCER_SERVER_TOOLS, SUBMIT_PITCHES_TOOL] as unknown as Anthropic.Tool[],
    tool_choice: { type: 'auto' },
    // Static prefix: tools → the prompt → the roster, one breakpoint on the last system block.
    system: [
      { type: 'text', text: deps.loadPrompt('producer') },
      { type: 'text', text: rosterBlock(), cache_control: ephemeralCache('1h') },
    ],
    messages,
  };
}

// ── Validation (strict, in code) ────────────────────────────────────────────

export type Validated = { ok: true; pitch: Pitch; typicality: number } | { ok: false; why: string; title: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function validDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** The cell a pitch must stay in: its player at the center (MD-11), its story type and its era. */
export type PitchCell = { player_id: string; story_type: StoryType; era: Era };

/**
 * One candidate as a Pitch, or why not. Structure is rejected; a cast player_id that is not on the
 * blue-chip list is resolved by name or set to null (MD-11), never invented. With `cell`, a pitch that
 * drifts off it (the player missing from the cast, another story type or era) is rejected.
 */
export function validatePitch(raw: unknown, opts: { today: string; cell?: PitchCell }): Validated {
  const r = (raw ?? {}) as Record<string, unknown>;
  const title = text(r.title) ?? '(untitled)';
  const fail = (why: string): Validated => ({ ok: false, why, title });

  const fields = ['title', 'logline', 'pitch', 'central_figure', 'scene', 'turn', 'implication', 'engine'] as const;
  const s: Record<string, string> = {};
  for (const f of fields) {
    const v = text(r[f]);
    if (!v) return fail(`missing ${f}`);
    s[f] = v;
  }
  if (typeof r.story_type !== 'string' || !(r.story_type in STORY_TYPES)) return fail(`unknown story_type ${String(r.story_type)}`);
  if (typeof r.era !== 'string' || !(r.era in ERAS)) return fail(`unknown era ${String(r.era)}`);
  const precision = r.date_precision;
  if (precision !== 'day' && precision !== 'month' && precision !== 'year') return fail('bad date_precision');
  const date = text(r.event_date);
  if (!date) return fail('no event_date');
  if (!validDate(date)) return fail(`bad event_date ${date}`);
  if (date > opts.today) return fail(`event_date ${date} is in the future`);

  if (!Array.isArray(r.cast) || r.cast.length === 0) return fail('no cast');
  const cast: CastMember[] = [];
  for (const c of r.cast as Record<string, unknown>[]) {
    const name = text(c?.name);
    const role = text(c?.role);
    const want = text(c?.want);
    if (!name || !role || !want) return fail('a cast member lacks a name, role or want');
    if (c.kind !== 'person' && c.kind !== 'company') return fail(`cast ${name}: bad kind`);
    const given = typeof c.player_id === 'string' ? c.player_id.trim() : null;
    const player_id = isPlayerId(given) ? given : playerIdForName(name);
    cast.push({ name, role, kind: c.kind, player_id, want });
  }
  const central = cast.find((c) => norm(c.name) === norm(s.central_figure));
  if (!central) return fail(`central_figure ${s.central_figure} is not in the cast`);
  if (opts.cell) {
    if (r.story_type !== opts.cell.story_type) return fail(`story_type ${String(r.story_type)} is not the cell's (${opts.cell.story_type})`);
    if (r.era !== opts.cell.era) return fail(`era ${String(r.era)} is not the cell's (${opts.cell.era})`);
    if (!cast.some((c) => c.player_id === opts.cell!.player_id)) return fail(`the cell's player (${opts.cell.player_id}) is not in the cast`);
  }

  if (!Array.isArray(r.expected_visuals) || r.expected_visuals.length === 0) return fail('no expected_visuals');
  const expected: ExpectedVisual[] = [];
  for (const v of r.expected_visuals as Record<string, unknown>[]) {
    if (!(VISUAL_KINDS as readonly string[]).includes(v?.kind as string)) return fail(`bad visual kind ${String(v?.kind)}`);
    const what = text(v.what);
    if (!what) return fail('an expected visual has no what');
    expected.push({ kind: v.kind as VisualKind, what, hint: text(v.hint) ?? '' });
  }

  if (!Array.isArray(r.sources) || r.sources.length === 0) return fail('no sources');
  const sources: SourceRef[] = [];
  for (const src of r.sources as Record<string, unknown>[]) {
    const url = text(src?.url);
    if (!url || !/^https?:\/\/\S+$/.test(url)) return fail(`bad source url ${String(src?.url)}`);
    const d = text(src.date);
    sources.push({ url, title: text(src.title) ?? url, publisher: text(src.publisher) ?? '', date: d && validDate(d) ? d : null });
  }

  const typicality = typeof r.typicality === 'number' && Number.isFinite(r.typicality) ? Math.min(1, Math.max(0, r.typicality)) : 0.5;
  return {
    ok: true,
    typicality,
    pitch: {
      title: s.title,
      logline: s.logline,
      pitch: s.pitch,
      story_type: r.story_type as StoryType,
      era: r.era as Era,
      event_date: date,
      date_precision: precision,
      cast,
      central_figure: central.name,
      scene: s.scene,
      turn: s.turn,
      implication: s.implication,
      why_now: text(r.why_now),
      engine: s.engine,
      expected_visuals: expected,
      sources,
    },
  };
}

/** Validate every candidate; keep the `keep` least typical that pass (verbalized sampling, research 05). */
export function selectPitches(
  candidates: unknown,
  keep: number,
  today: string,
  cell?: PitchCell,
): { pitches: Pitch[]; dropped: { title: string; why: string }[] } {
  const list = Array.isArray(candidates) ? candidates : [];
  const passed: { pitch: Pitch; typicality: number; i: number }[] = [];
  const dropped: { title: string; why: string }[] = [];
  list.forEach((c, i) => {
    const v = validatePitch(c, { today, cell });
    if (v.ok) passed.push({ pitch: v.pitch, typicality: v.typicality, i });
    else dropped.push({ title: v.title, why: v.why });
  });
  passed.sort((a, b) => a.typicality - b.typicality || a.i - b.i);
  for (const p of passed.slice(keep)) dropped.push({ title: p.pitch.title, why: `more typical (${p.typicality.toFixed(2)}) than the ones kept` });
  return { pitches: passed.slice(0, keep).map((p) => p.pitch), dropped };
}

// ── The call ────────────────────────────────────────────────────────────────

export class ProducerError extends Error {
  constructor(message: string, readonly spend: { usd: number; webSearches: number; queries: string[] }) {
    super(message);
    this.name = 'ProducerError';
  }
}

function searchQueries(message: Anthropic.Message): string[] {
  const out: string[] = [];
  for (const block of message.content as unknown as { type: string; name?: string; input?: { query?: unknown } }[]) {
    if (block.type === 'server_tool_use' && block.name === 'web_search' && typeof block.input?.query === 'string') out.push(block.input.query);
  }
  return out;
}

/**
 * One producer call on one cell, to its `submit_pitches` call. A `pause_turn` is resumed by resending
 * the turn so far (up to MAX_CONTINUATIONS). Spend is recorded whether the call succeeds or not.
 */
export async function producePitches(deps: ProducerDeps, cell: CellRow, ctx: ProducerContext): Promise<ProduceResult> {
  const first: Anthropic.MessageParam = { role: 'user', content: producerUserMessage(cell, ctx, deps.pitchesPerCell) };
  let messages: Anthropic.MessageParam[] = [first];
  const usages: MessageUsageLike[] = [];
  const queries: string[] = [];
  let model = deps.model;

  const spend = () => {
    const webSearches = usages.reduce((n, u) => n + Number(u.usage.server_tool_use?.web_search_requests ?? 0), 0);
    const usd = usages.length ? Number(priceAnthropicMessages(usages, { modelId: model }).costUsd) : 0;
    return { usd, webSearches, queries };
  };
  const record = async () => {
    const { usd, webSearches } = spend();
    const tokens = usages.reduce(
      (t, u) => ({
        input: t.input + Number(u.usage.input_tokens ?? 0),
        output: t.output + Number(u.usage.output_tokens ?? 0),
        read: t.read + Number(u.usage.cache_read_input_tokens ?? 0),
        write: t.write + Number(u.usage.cache_creation_input_tokens ?? 0),
      }),
      { input: 0, output: 0, read: 0, write: 0 },
    );
    if (!usages.length) return;
    await recordCost(deps.db, {
      sessionId: deps.sessionId ?? null,
      mode: 'development',
      vendor: 'anthropic',
      component: 'producer',
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheReadTokens: tokens.read,
      cacheWriteTokens: tokens.write,
      webSearches,
      usd,
    });
  };
  const failWith = async (msg: string): Promise<never> => {
    await record();
    throw new ProducerError(`producer: ${msg}`, spend());
  };

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn += 1) {
    let message: Anthropic.Message;
    try {
      message = await deps.create(producerParams(deps, messages));
    } catch (error) {
      return failWith(error instanceof Error ? error.message : String(error));
    }
    usages.push(message as unknown as MessageUsageLike);
    model = message.model || model;
    queries.push(...searchQueries(message));
    const call = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SUBMIT_PITCHES_TOOL.name,
    );
    if (call) {
      const { pitches, dropped } = selectPitches((call.input as { candidates?: unknown })?.candidates, deps.pitchesPerCell, ctx.today, cell);
      await record();
      return { pitches, dropped, ...spend() };
    }
    const stop = message.stop_reason as string;
    if (stop === 'pause_turn') {
      messages = [first, { role: 'assistant', content: message.content as unknown as Anthropic.ContentBlockParam[] }];
      continue;
    }
    return failWith(stop === 'refusal' ? 'the model declined the request' : `the turn ended (${stop}) without calling submit_pitches`);
  }
  return failWith(`still paused after ${MAX_CONTINUATIONS} continuations`);
}

/** The live send: streaming (long outputs), every response appended to the JSONL log. */
export function anthropicCreate(client: Anthropic, component: string): CreateMessage {
  return async (params) => {
    const message = await client.messages.stream(params).finalMessage();
    appendJsonl(component, { model: message.model, stop_reason: message.stop_reason, usage: message.usage, content: message.content });
    return message;
  };
}
