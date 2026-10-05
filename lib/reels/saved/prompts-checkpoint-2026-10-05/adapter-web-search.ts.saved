import Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withConversationCache, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import {
  B6_MAX_ATTEMPTS,
  B6_MEMORY_NIGHTS,
  B6_MIN_INDEPENDENT_SOURCES,
  B6_MODEL,
  B6_SEARCH_MAX_USES,
  B6_STORIES_PER_NIGHT,
} from '@/lib/reels/config';
import {
  REPORT_STORY_TOOL,
  WEB_SEARCH_SYSTEM,
  buildWebSearchUserPrompt,
} from '@/lib/reels/prompts/web-search';
import { listRunSources, recentB6Headlines, recordCost } from '@/lib/reels/repository';
import type { Adapter, AdapterItem } from '@/lib/reels/types';

/**
 * R6 gate. The B6 prompt (P-01) is drafted but not approved, so this source
 * produces nothing until Lucas signs off on the wording and the flag is set.
 */
export function b6PromptApproved(): boolean {
  return process.env.REELS_B6_PROMPT_APPROVED === 'true';
}

export class B6NotApprovedError extends Error {
  constructor() {
    super(
      'B6 web-search prompt (P-01) is not approved. Set REELS_B6_PROMPT_APPROVED=true only after Lucas approves the wording in lib/reels/prompts/web-search.ts.',
    );
    this.name = 'B6NotApprovedError';
  }
}

export type StoryReport = {
  headline: string;
  story: string;
  subject: string;
  claims: Array<{ claim: string; source_url: string }>;
  citation_urls: string[];
};

export type GroundingResult = { ok: true } | { ok: false; reason: string };

/**
 * Tool input is model output, so its shape is a claim rather than a guarantee.
 * A single URL can come back as a bare string where an array was asked for,
 * which must read as a grounding failure and a retry, never a crash mid-run.
 */
const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/gi;

function httpUrls(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    for (const match of value.matchAll(URL_IN_TEXT)) {
      found.push(match[0].replace(/[.,;]+$/, ''));
    }
    return found;
  }
  if (Array.isArray(value)) {
    for (const entry of value) httpUrls(entry, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) httpUrls(entry, found);
  }
  return found;
}

function urlFromUnknown(entry: unknown): string {
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return httpUrls(trimmed)[0] ?? '';
  }
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const url = urlFromUnknown(item);
      if (url) return url;
    }
    return '';
  }
  if (!entry || typeof entry !== 'object') return '';
  const record = entry as Record<string, unknown>;
  const direct = record.url ?? record.source_url ?? record.href ?? record.link ?? record.uri;
  if (typeof direct === 'string' && direct.trim()) {
    const fromText = urlFromUnknown(direct);
    if (fromText) return fromText;
  }
  if (direct && typeof direct === 'object') {
    const nested = urlFromUnknown(direct);
    if (nested) return nested;
  }
  return httpUrls(record)[0] ?? '';
}

export function asUrlList(value: unknown): string[] {
  if (typeof value === 'string') {
    const url = urlFromUnknown(value);
    return url ? [url] : [];
  }
  if (!Array.isArray(value)) return [];
  return value.map(urlFromUnknown).filter((entry) => entry.length > 0);
}

/**
 * Citations the story can be checked against. An empty or unreadable
 * `citation_urls` falls back to the URLs already paired with claims. The
 * two-publication rule still applies to whichever list we use.
 */
export function citationUrlsFor(report: StoryReport): string[] {
  const listed = asUrlList(report.citation_urls);
  if (listed.length > 0) return listed;
  return [
    ...new Set(
      asClaimList(report.claims)
        .map((claim) => claim.source_url.trim())
        .filter((url) => url.length > 0),
    ),
  ];
}

export function asClaimList(value: unknown): Array<{ claim: string; source_url: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const claim = record.claim ?? record.text ?? record.statement;
    if (typeof claim !== 'string' || claim.trim().length === 0) return [];
    const source_url = urlFromUnknown(record.source_url ?? record.url ?? record.source ?? record.citation);
    if (!source_url) return [];
    return [{ claim, source_url }];
  });
}

/**
 * Compact picture of a rejected tool payload, so a grounding miss shows which
 * fields arrived without pasting the story into the run note.
 */
export function reportShape(input: unknown): string {
  if (!input || typeof input !== 'object') return typeof input;
  const record = input as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'story' && typeof value === 'string') {
      summary.story = `string(${value.length})`;
      continue;
    }
    if (Array.isArray(value)) {
      summary[key] = value.slice(0, 2).map((entry) => {
        if (!entry || typeof entry !== 'object') return typeof entry === 'string' && entry.startsWith('http') ? entry : typeof entry;
        const shaped: Record<string, unknown> = {};
        for (const [childKey, child] of Object.entries(entry as Record<string, unknown>)) {
          if (typeof child === 'string') shaped[childKey] = /^https?:\/\//i.test(child) ? child : `string(${child.length})`;
          else if (Array.isArray(child)) shaped[childKey] = `array(${child.length})`;
          else if (child && typeof child === 'object') shaped[childKey] = Object.keys(child as object);
          else shaped[childKey] = typeof child;
        }
        return shaped;
      });
      summary[`${key}Count`] = value.length;
      continue;
    }
    if (typeof value === 'string') summary[key] = /^https?:\/\//i.test(value) ? value : `string(${value.length})`;
    else summary[key] = value && typeof value === 'object' ? Object.keys(value as object) : typeof value;
  }
  return JSON.stringify(summary).slice(0, 1500);
}

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Grounding is checked in code, not taken on the model's word (WEB-04 / D-064):
 * every claim has to point at a URL the model also cited, and the citations
 * have to span at least two independent publications.
 */
export function checkGrounding(report: StoryReport): GroundingResult {
  const cited = new Set(citationUrlsFor(report));
  if (cited.size === 0) return { ok: false, reason: 'No citations were provided.' };

  const claims = asClaimList(report.claims);
  if (claims.length === 0) {
    return { ok: false, reason: 'No claims were listed, so nothing can be traced to a source.' };
  }

  const uncited = claims.filter((claim) => !cited.has(claim.source_url.trim()));
  if (uncited.length > 0) {
    return {
      ok: false,
      reason: `${uncited.length} claim(s) cite a URL that is not in citation_urls, starting with: "${uncited[0].claim.slice(0, 120)}".`,
    };
  }

  const hosts = new Set(
    Array.from(cited, hostname).filter((host): host is string => host !== null),
  );
  if (hosts.size < B6_MIN_INDEPENDENT_SOURCES) {
    return {
      ok: false,
      reason: `Only ${hosts.size} independent source(s); at least ${B6_MIN_INDEPENDENT_SOURCES} are required.`,
    };
  }

  return { ok: true };
}

export function reportsFromMessage(
  message: Anthropic.Message,
): Array<{ report: StoryReport; toolUseId: string }> {
  const found: Array<{ report: StoryReport; toolUseId: string }> = [];
  for (const block of message.content) {
    if (block.type === 'tool_use' && block.name === REPORT_STORY_TOOL.name) {
      found.push({ report: block.input as StoryReport, toolUseId: block.id });
    }
  }
  return found;
}

function headlineKey(headline: string): string {
  return headline.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Keep the grounded stories from one turn. A repeat of a headline already
 * kept, or a report that fails grounding, comes back as a tool error so the
 * next turn can replace it.
 */
export function judgeReportedStories(
  incoming: ReadonlyArray<{ report: StoryReport; toolUseId: string }>,
  acceptedHeadlines: readonly string[],
): {
  accepted: StoryReport[];
  feedback: Array<{ toolUseId: string; ok: boolean; message: string }>;
  failure: string | null;
  shape: string | null;
} {
  const accepted: StoryReport[] = [];
  const feedback: Array<{ toolUseId: string; ok: boolean; message: string }> = [];
  const seen = new Set(acceptedHeadlines.map(headlineKey));
  let failure: string | null = null;
  let shape: string | null = null;

  for (const item of incoming) {
    const headline = typeof item.report?.headline === 'string' ? item.report.headline : '';
    const story = typeof item.report?.story === 'string' ? item.report.story : '';
    if (!headline.trim() || !story.trim()) {
      failure = 'A story needs a headline and a write-up.';
      shape = reportShape(item.report);
      feedback.push({ toolUseId: item.toolUseId, ok: false, message: failure });
      continue;
    }
    const key = headlineKey(headline);
    if (seen.has(key)) {
      const message = `Already accepted: "${headline.trim()}". Report a different story.`;
      failure = message;
      feedback.push({ toolUseId: item.toolUseId, ok: false, message });
      continue;
    }
    const grounding = checkGrounding(item.report);
    if (!grounding.ok) {
      failure = grounding.reason;
      shape = reportShape(item.report);
      feedback.push({ toolUseId: item.toolUseId, ok: false, message: grounding.reason });
      continue;
    }
    seen.add(key);
    accepted.push(item.report);
    feedback.push({ toolUseId: item.toolUseId, ok: true, message: 'Accepted.' });
  }

  return { accepted, feedback, failure, shape };
}

/** The stored write-up ends with the URLs that passed grounding. */
export function storyWithSources(report: StoryReport): string {
  const urls = citationUrlsFor(report);
  const list = urls.map((url) => `- ${url}`).join('\n');
  return `${report.story.trim()}\n\nSources:\n${list}`;
}

/**
 * Turns to append when a reported story fails grounding.
 *
 * Echoing the assistant turn is what puts its `tool_use` in history, and the
 * API requires the very next message to open with a matching `tool_result`.
 * Sending plain feedback instead returns 400 and loses a story we already paid
 * for, which is how the second live night failed.
 */
export function buildRetryTurns(
  content: Anthropic.ContentBlock[],
  feedback: string,
): Anthropic.MessageParam[] {
  const toolUseIds = content
    .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
    .map((block) => block.id);

  const followUp: Anthropic.ContentBlockParam[] = toolUseIds.map((id) => ({
    type: 'tool_result',
    tool_use_id: id,
    content: feedback,
    is_error: true,
  }));

  followUp.push({
    type: 'text',
    text: 'Fix it and call report_story again, searching further if you need to.',
  });

  return [
    { role: 'assistant', content },
    { role: 'user', content: followUp },
  ];
}

/**
 * Answers every tool_use on the turn, including a mix of accepted and rejected
 * stories, then asks for whatever is still missing.
 */
export function buildStoryFollowUp(
  content: Anthropic.ContentBlock[],
  results: ReadonlyArray<{ toolUseId: string; ok: boolean; message: string }>,
  instruction: string,
): Anthropic.MessageParam[] {
  const byId = new Map(results.map((result) => [result.toolUseId, result]));
  const followUp: Anthropic.ContentBlockParam[] = content
    .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
    .map((block) => {
      const result = byId.get(block.id);
      if (!result) {
        return { type: 'tool_result' as const, tool_use_id: block.id, content: 'Noted.', is_error: false };
      }
      return {
        type: 'tool_result' as const,
        tool_use_id: block.id,
        content: result.message,
        is_error: !result.ok,
      };
    });

  followUp.push({ type: 'text', text: instruction });

  return [
    { role: 'assistant', content },
    { role: 'user', content: followUp },
  ];
}

function stillNeeded(accepted: readonly StoryReport[]): string {
  const need = B6_STORIES_PER_NIGHT - accepted.length;
  const have =
    accepted.length === 0
      ? 'None accepted yet.'
      : `Accepted so far: ${accepted.map((story) => story.headline.trim()).join('; ')}.`;
  const noun = need === 1 ? 'story' : 'stories';
  return `${have} Report ${need} more ${noun}. At least one of tonight's stories must be about one person and a turn in their work or life. Each story needs at least two independent sources, and every claim needs a source URL. Name the publication in the sentence that uses its fact.`;
}

/**
 * B6 (D-008, D-064, D-236). Two stories a night, each entering the pool as an
 * ordinary source and going through merge and link like everything else.
 *
 * Runs after the other adapters so it can be told what tonight already covers,
 * and before grouping (WEB-07).
 */
export const claudeWebSearch: Adapter = {
  id: 'claude-web-search',
  name: 'Claude web search',
  type: 'B6',
  bucket: 'B',
  kind: 'generated',
  phase: 'derived',

  async fetchItems({ runId, signal }) {
    if (!b6PromptApproved()) throw new B6NotApprovedError();
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');

    const [recent, tonight] = await Promise.all([
      recentB6Headlines(B6_MEMORY_NIGHTS),
      listRunSources(runId),
    ]);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const tools: Anthropic.MessageCreateParams['tools'] = [
      { type: 'web_search_20250305', name: 'web_search', max_uses: B6_SEARCH_MAX_USES },
      withToolCache(REPORT_STORY_TOOL as Anthropic.Tool),
    ];

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: buildWebSearchUserPrompt({
          recentHeadlines: recent,
          tonightHeadlines: tonight
            .filter((source) => source.drop_reason === null)
            .map((source) => source.headline),
        }),
      },
    ];

    const billed: Anthropic.Message[] = [];
    const accepted: StoryReport[] = [];
    let lastFailure = '';
    let lastShape = '';

    try {
      for (let attempt = 1; attempt <= B6_MAX_ATTEMPTS; attempt += 1) {
        let message: Anthropic.Message;
        try {
          message = await client.messages.create(
            {
              model: B6_MODEL,
              max_tokens: 8000,
              system: cachedSystemText(WEB_SEARCH_SYSTEM),
              messages: withConversationCache(messages),
              tools,
              tool_choice: { type: 'auto' },
            },
            { signal },
          );
        } catch (error) {
          // Without this, a failure on the retry turn buries the grounding
          // reason that caused the retry and the run page shows only a
          // transport error.
          const detail = error instanceof Error ? error.message : String(error);
          const wrapped = new Error(
            lastFailure
              ? `Retry after "${lastFailure}" failed: ${detail}`
              : `Web-search request failed: ${detail}`,
          );
          if (accepted.length > 0) {
            lastFailure = wrapped.message;
            break;
          }
          throw wrapped;
        }
        billed.push(message);

        const reported = reportsFromMessage(message);
        const judged = judgeReportedStories(
          reported,
          accepted.map((story) => story.headline),
        );
        accepted.push(...judged.accepted);
        if (reported.length === 0) {
          lastFailure = 'No story was reported.';
          lastShape = reportShape(message.content);
        } else if (judged.failure) {
          lastFailure = judged.failure;
          lastShape = judged.shape ?? '';
        }

        if (accepted.length >= B6_STORIES_PER_NIGHT) {
          return accepted.slice(0, B6_STORIES_PER_NIGHT).map(toAdapterItem);
        }

        if (attempt === B6_MAX_ATTEMPTS) break;
        // A story that fails grounding is not shipped (D-064). A story that
        // passed stays, and the next turn is asked only for the gap.
        messages.push(...buildStoryFollowUp(message.content, judged.feedback, stillNeeded(accepted)));
      }
    } finally {
      if (billed.length > 0) {
        const priced = priceAnthropicMessages(billed, { modelId: B6_MODEL, fallbackCacheTtl: '1h' });
        await recordCost({
          runId,
          vendor: 'anthropic',
          component: 'b6-web-search',
          inputTokens:
            priced.uncached_input_tokens +
            priced.cache_read_input_tokens +
            priced['cache_creation.ephemeral_5m_input_tokens'] +
            priced['cache_creation.ephemeral_1h_input_tokens'],
          outputTokens: priced.output_tokens,
          // The contract formats cost as a string; the ledger stores numeric.
          usd: Number(priced.costUsd),
        });
      }
    }

    if (accepted.length > 0) return accepted.map(toAdapterItem);

    const shape = lastShape ? ` Shape: ${lastShape}` : '';
    throw new Error(`Web-search story failed grounding: ${lastFailure}${shape}`);
  },
};

export function storySlug(headline: string, at: Date): string {
  const day = at.toISOString().slice(0, 10);
  const slug = headline
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${day}-${slug || 'story'}`;
}

function toAdapterItem(report: StoryReport): AdapterItem {
  const citations = citationUrlsFor(report);
  const now = new Date();
  return {
    // Helios wrote this, so it gets its own identity rather than borrowing a
    // cited page's URL. Reusing a citation would auto-merge the story into the
    // article it cites; instead it goes through merge and link like any other
    // source (D-008).
    canonicalUrl: `https://www.heliosgroup.tech/reels/story/${storySlug(report.headline, now)}`,
    headline: report.headline,
    body: storyWithSources(report),
    author: null,
    byline: 'Helios research',
    publishTime: now,
    citationUrls: citations,
    textIsComplete: true,
    allowRepeat: true,
    rawPayload: { subject: report.subject, claims: report.claims },
  };
}
