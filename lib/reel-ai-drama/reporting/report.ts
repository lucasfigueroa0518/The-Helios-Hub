import type Anthropic from '@anthropic-ai/sdk';

import { coerceJsonStrings } from '@/lib/reel-ai-drama/tool-input';
import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import type { MessageUsageLike } from '@/lib/anthropic-pricing';
import type { Queryable } from '@/lib/explainers/db';
import { recordCost } from '@/lib/reel-ai-drama/cost';
import { jsonlLog, messagesUsd, usageTotals, type CreateMessage } from '@/lib/reel-ai-drama/reporting/llm';
import { validateFactSheet } from '@/lib/reel-ai-drama/reporting/validate';
import type { FactSheet, Mode, Pitch } from '@/lib/reel-ai-drama/types';

/**
 * P2 Reporting (PROCESS.md; MD-31): Sonnet 5.5 with web search and fetch turns a pitch into a verified
 * fact sheet through a strict `submit_fact_sheet` tool. The code then checks the sheet
 * (validate.ts). `verdict.holds = false` kills the story (`facts_dont_hold`); the caller acts on it.
 */

export const MAX_SEARCHES = 10;
export const MAX_FETCHES = 15;
export const MAX_CONTINUATIONS = 4;
export const MAX_TOKENS = 32000;

const str = { type: 'string' } as const;
const nullableStr = { type: ['string', 'null'] } as const;
const nullableNum = { type: ['number', 'null'] } as const;
const strList = { type: 'array', items: str } as const;
const obj = <P extends Record<string, unknown>>(properties: P) =>
  ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties }) as const;

/** Mirrors `FactSheet` in types.ts field for field. */
export const SUBMIT_FACT_SHEET_TOOL = {
  name: 'submit_fact_sheet',
  description: 'Submit the verified fact sheet. Call it exactly once, at the end.',
  // Not strict: the compiled grammar for this schema is too large for the API (live run, 2026-10-28);
  // validateFactSheet checks every field instead.
  strict: false,
  input_schema: obj({
    summary: str,
    timeline: { type: 'array', items: obj({ date: str, event: str, fact_ids: strList }) },
    facts: {
      type: 'array',
      items: obj({
        id: str,
        text: str,
        source_ids: strList,
        key: { type: 'boolean' },
        core: { type: 'boolean' },
        confidence: { type: 'string', enum: ['confirmed', 'single_source', 'disputed'] },
      }),
    },
    sources: { type: 'array', items: obj({ id: str, url: str, title: str, publisher: str, date: nullableStr, kind: str }) },
    quotes: { type: 'array', items: obj({ id: str, speaker: str, text: str, source_id: str, date: nullableStr, context: str }) },
    artifacts: {
      type: 'array',
      items: obj({
        id: str,
        kind: { type: 'string', enum: ['post', 'statement', 'document', 'headline', 'paper', 'filing', 'other'] },
        text: str,
        source_id: str,
        url: nullableStr,
        date: nullableStr,
      }),
    },
    cast: {
      type: 'array',
      items: obj({
        name: str,
        role: str,
        kind: { type: 'string', enum: ['person', 'company'] },
        player_id: nullableStr,
        want: str,
        qid: nullableStr,
      }),
    },
    places: { type: 'array', items: obj({ name: str, address: nullableStr, lat: nullableNum, lon: nullableNum, role: str }) },
    verdict: obj({ holds: { type: 'boolean' }, reason: str }),
  }),
} as const;

/** Fixed order so the cached prefix (tools → system) never changes between turns. */
export const REPORTING_TOOLS = [
  { type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES },
  { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: MAX_FETCHES },
  withToolCache(SUBMIT_FACT_SHEET_TOOL as unknown as Anthropic.Tool),
] as unknown as Anthropic.Tool[];

export type ReportingDeps = {
  db: Queryable;
  create: CreateMessage;
  /** B3's loader (`lib/reel-ai-drama/prompts.ts`); injected so tests and builders never depend on the file. */
  loadPrompt: (name: 'reporting') => string;
  /** settings.reporting_model. */
  model: string;
  /** JSONL writer for every response; defaults to `.explainers-local/reel-ai-drama/logs/reporting-<job>.jsonl`. */
  log?: (entry: Record<string, unknown>) => void;
  /** Called once per validation problem (B5 may turn these into job flags). */
  onProblem?: (detail: string) => void;
  now?: () => Date;
};

export type ReportingResult = { sheet: FactSheet; problems: string[]; usd: number; model: string; webSearches: number };

export class ReportingError extends Error {
  constructor(message: string, readonly usd: number) {
    super(message);
    this.name = 'ReportingError';
  }
}

export function reportingUserMessage(pitch: Pitch, today: string): string {
  return [`Today: ${today}`, '', '## Pitch', '```json', JSON.stringify(pitch, null, 2), '```'].join('\n');
}

export function reportingParams(system: string, model: string, messages: Anthropic.MessageParam[]): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: MAX_TOKENS,
    tools: REPORTING_TOOLS,
    tool_choice: { type: 'auto' },
    system: cachedSystemText(system),
    messages,
  };
}

/** Text of every page web_fetch returned in a message, by URL (for the verbatim checks). */
export function fetchedPages(content: readonly unknown[], into: Map<string, string> = new Map()): Map<string, string> {
  for (const block of content) {
    const b = block as { type?: string; content?: { type?: string; url?: string; content?: { source?: { type?: string; data?: string } } } };
    if (b.type !== 'web_fetch_tool_result' || b.content?.type !== 'web_fetch_result') continue;
    const url = b.content.url;
    const source = b.content.content?.source;
    if (url && source?.type === 'text' && typeof source.data === 'string') into.set(url, source.data);
  }
  return into;
}

/** Runs the turn (resuming on pause_turn), records its cost, checks the sheet. */
export async function runReporting(deps: ReportingDeps, pitch: Pitch, ctx: { jobId: string | null; mode: Mode }): Promise<ReportingResult> {
  const log = deps.log ?? jsonlLog('reporting', ctx.jobId ?? 'nojob');
  const today = (deps.now?.() ?? new Date()).toISOString().slice(0, 10);
  const system = deps.loadPrompt('reporting');
  const first: Anthropic.MessageParam = { role: 'user', content: reportingUserMessage(pitch, today) };
  let messages: Anthropic.MessageParam[] = [first];
  const usages: MessageUsageLike[] = [];
  const fetched = new Map<string, string>();
  // A continuation returns only the new blocks, so the assistant side of the turn accumulates.
  const assistant: Anthropic.ContentBlockParam[] = [];
  let model = deps.model;

  const settle = async () => {
    const usd = messagesUsd(usages, model);
    if (usages.length) {
      await recordCost(deps.db, { jobId: ctx.jobId, mode: ctx.mode, vendor: 'anthropic', component: 'reporting', ...usageTotals(usages), usd });
    }
    return usd;
  };
  const fail = async (why: string): Promise<never> => {
    const usd = await settle();
    log({ event: 'error', why, usd });
    throw new ReportingError(`reporting: ${why}`, usd);
  };

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn += 1) {
    let message: Anthropic.Message;
    try {
      message = await deps.create(reportingParams(system, deps.model, messages));
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    log({ event: 'response', turn, message });
    usages.push(message as unknown as MessageUsageLike);
    model = message.model || model;
    fetchedPages(message.content, fetched);
    const call = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SUBMIT_FACT_SHEET_TOOL.name);
    if (call) {
      let checked;
      try {
        checked = validateFactSheet(coerceJsonStrings(call.input) as FactSheet, { fetched });
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
      const usd = await settle();
      for (const p of checked.problems) deps.onProblem?.(p);
      log({ event: 'sheet', verdict: checked.sheet.verdict, problems: checked.problems, usd });
      return { sheet: checked.sheet, problems: checked.problems, usd, model, webSearches: usageTotals(usages).webSearches };
    }
    const stop = message.stop_reason as string;
    if (stop === 'pause_turn') {
      assistant.push(...(message.content as unknown as Anthropic.ContentBlockParam[]));
      messages = [first, { role: 'assistant', content: [...assistant] }];
      continue;
    }
    // The model sometimes calls a tool that doesn't exist (a live run called "fetch"). Answer each such
    // call with a correction and let the turn go on, rather than losing the story.
    const stray = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (stop === 'tool_use' && stray.length) {
      const results = stray.map((b) => ({
        type: 'tool_result' as const,
        tool_use_id: b.id,
        is_error: true,
        content: `There is no tool named "${b.name}". Use web_search and web_fetch to research, and submit_fact_sheet once at the end.`,
      }));
      messages = [
        ...messages,
        { role: 'assistant', content: message.content as unknown as Anthropic.ContentBlockParam[] },
        { role: 'user', content: results },
      ];
      continue;
    }
    return fail(stop === 'max_tokens' ? 'the turn hit max_tokens before submitting' : `the turn ended (${stop}) without submit_fact_sheet`);
  }
  return fail(`still paused after ${MAX_CONTINUATIONS} continuations`);
}

/** CONTRACT § B2. `verdict.holds === false` means kill with `facts_dont_hold`. */
export async function reportStory(deps: ReportingDeps, pitch: Pitch, ctx: { jobId: string | null; mode: Mode }): Promise<FactSheet> {
  return (await runReporting(deps, pitch, ctx)).sheet;
}

/** The kill reason for a sheet, or null when the story stands. */
export function reportingKill(sheet: FactSheet): 'facts_dont_hold' | null {
  return sheet.verdict.holds ? null : 'facts_dont_hold';
}
