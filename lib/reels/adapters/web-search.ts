import Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withConversationCache, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import {
  B6_MAX_ATTEMPTS,
  B6_MEMORY_NIGHTS,
  B6_MIN_INDEPENDENT_SOURCES,
  B6_MODEL,
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

function reportFromMessage(
  message: Anthropic.Message,
): { report: StoryReport; toolUseId: string } | null {
  for (const block of message.content) {
    if (block.type === 'tool_use' && block.name === REPORT_STORY_TOOL.name) {
      return { report: block.input as StoryReport, toolUseId: block.id };
    }
  }
  return null;
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
 * B6 (D-008, D-064). One story a night, entering the pool as an ordinary source
 * and going through merge and link like everything else.
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
      { type: 'web_search_20250305', name: 'web_search', max_uses: 8 },
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
    let lastFailure = '';
    let lastShape = '';

    try {
      for (let attempt = 1; attempt <= B6_MAX_ATTEMPTS; attempt += 1) {
        let message: Anthropic.Message;
        try {
          message = await client.messages.create(
            {
              model: B6_MODEL,
              max_tokens: 4000,
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
          throw new Error(
            lastFailure
              ? `Retry after "${lastFailure}" failed: ${detail}`
              : `Web-search request failed: ${detail}`,
          );
        }
        billed.push(message);

        const reported = reportFromMessage(message);
        if (reported) {
          const grounding = checkGrounding(reported.report);
          if (grounding.ok) return [toAdapterItem(reported.report)];
          lastFailure = grounding.reason;
          lastShape = reportShape(reported.report);
        } else {
          lastFailure = 'No story was reported.';
          lastShape = reportShape(message.content);
        }

        if (attempt === B6_MAX_ATTEMPTS) break;
        // One retry with the specific failure, then the night goes without a
        // B6 story rather than shipping an ungrounded one (D-064).
        messages.push(
          ...buildRetryTurns(
            message.content,
            `That did not meet the grounding requirement: ${lastFailure}`,
          ),
        );
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
    body: report.story,
    author: null,
    byline: 'Helios research',
    publishTime: now,
    citationUrls: citations,
    textIsComplete: true,
    allowRepeat: true,
    rawPayload: { subject: report.subject, claims: report.claims },
  };
}
