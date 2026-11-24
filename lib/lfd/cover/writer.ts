/**
 * The LFD cover prompt writer: one Opus call that turns the post's stories, the direction and the numbered
 * reference images into one GPT Image 2.6 prompt (COVER-PROMPT-WRITER.md).
 *
 * Prompt caching (CLAUDE.md): the tool and the system prompt are the stable prefix, with the breakpoint on
 * the system block (tools → system); the stories and references go in the user turn, uncached.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages, type MessageUsageLike } from '@/lib/anthropic-pricing';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';

import { LFD_COVER_MODEL, LFD_COVER_SYSTEM, WRITE_COVER_PROMPT_TOOL, type LfdCoverDirection } from './prompts';

export type CoverStory = { headline: string; body: string };
/** A numbered reference image (1-based `n`), with what it shows. */
export type CoverReference = { n: number; headline: string; kind: string };

const BODY_CHARS = 400;

/** The per-post user turn: the direction, the stories and the numbered references. */
export function coverUserTurn(direction: LfdCoverDirection, stories: CoverStory[], refs: CoverReference[]): string {
  const storyLines = stories.map((s, i) => `${i + 1}. ${s.headline}\n${s.body.trim().slice(0, BODY_CHARS)}`.trim());
  const refLines = refs.map((r) => `${r.n}. ${r.headline} (${r.kind})`);
  return [`Direction: ${direction}`, `Stories:\n${storyLines.join('\n\n')}`, `Reference images:\n${refLines.join('\n')}`].join('\n\n');
}

export function coverWriterRequest(direction: LfdCoverDirection, stories: CoverStory[], refs: CoverReference[]): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: LFD_COVER_MODEL,
    max_tokens: 2000,
    tools: [withToolCache(WRITE_COVER_PROMPT_TOOL)],
    tool_choice: { type: 'tool', name: WRITE_COVER_PROMPT_TOOL.name },
    system: cachedSystemText(LFD_COVER_SYSTEM),
    messages: [{ role: 'user', content: coverUserTurn(direction, stories, refs) }],
  };
}

function priced(message: Anthropic.Message): number {
  try {
    const usd = Number(priceAnthropicMessages([message as unknown as MessageUsageLike], { modelId: LFD_COVER_MODEL }).costUsd);
    return Number.isFinite(usd) ? usd : 0;
  } catch {
    return 0;
  }
}

/** Thrown with the call's cost, so a bad reply still counts toward spend. */
export class CoverWriterError extends Error {
  constructor(message: string, readonly costUsd: number) {
    super(message);
  }
}

/**
 * One writer call. Returns the prompt and the reference numbers it used (only numbers that exist, deduplicated,
 * at most 6). Throws CoverWriterError on a missing or invalid tool call.
 */
export async function writeCoverPrompt(
  create: MessagesCreate,
  direction: LfdCoverDirection,
  stories: CoverStory[],
  refs: CoverReference[],
): Promise<{ prompt: string; references: number[]; costUsd: number }> {
  const message = await create(coverWriterRequest(direction, stories, refs));
  const costUsd = priced(message);
  const call = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === WRITE_COVER_PROMPT_TOOL.name);
  if (!call) throw new CoverWriterError(`no write_cover_prompt call (stop: ${message.stop_reason ?? 'unknown'})`, costUsd);
  const input = call.input as { prompt?: unknown; references?: unknown };
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) throw new CoverWriterError('write_cover_prompt returned an empty prompt', costUsd);
  const known = new Set(refs.map((r) => r.n));
  const references = [...new Set(Array.isArray(input.references) ? input.references.map(Number) : [])].filter((n) => known.has(n)).slice(0, 6);
  if (!references.length) throw new CoverWriterError('write_cover_prompt named no known reference image', costUsd);
  return { prompt, references, costUsd };
}
