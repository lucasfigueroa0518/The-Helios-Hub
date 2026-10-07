import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText } from '@/lib/anthropic-cache';
import { priceAnthropicUsage, usageBucketsFromMessage, type MessageUsageLike } from '@/lib/anthropic-pricing';
import { structuredJson, type StructuredParams } from '@/lib/explainers/ideas/generator';

/**
 * The Instagram caption written beside a finished Explainer Reel.
 * Tracks `.cursor/skills/explainer-caption/SKILL.md`. The burned-in
 * `caption_groups.json` is a different artifact (`captions`).
 *
 * The system prompt is the stable prefix and carries the cache breakpoint.
 * The reel's facts go in the user message.
 */

export const CAPTION_VERSION = 'explainer-caption-v1';

export const CAPTION_INSTRUCTIONS = `You write the Instagram caption for one finished Helios Explainer Reel. The video already taught the concept. The caption does not retell the seven beats.

HARD CONSTRAINTS. Every one is required.
1. Return JSON matching the schema. The caption field is the whole post, nothing else.
2. The first line is exactly "AI BRAIN BREAK - EPISODE N:" using the episode number in the user message. Nothing else goes on that line.
3. The next line, after one blank line, is the hook. The episode line, the blank line, and the hook together stay within 125 characters. The hook makes sense with no video playing. It is not the spoken thesis copied out, and it is not a description of the frames.
4. Then one short paragraph. Add a second sentence only for the catch or the place the viewer meets this. Then stop.
5. One save line: "Save this for the next time " and the situation this reel is about.
6. 3 to 5 hashtags, only at the end. One or two broad, the rest specific to this concept.
7. No emoji. No URLs. Do not speak as "we", "our", "us", or "I". Address the viewer as "you", or write in the third person. Do not sign off with Helios.
8. Every number, name, and claim comes from the title, scope, script, storyboard, or source in the user message. Do not add one.
9. Plain words. No "not X, but Y". No one-line closer that repeats the paragraph before it. No dash used for drama.

Shape:
AI BRAIN BREAK - EPISODE N:

Hook.

One short paragraph.

Save this for the next time <the situation>.

#specific #specific #broad`;

const CAPTION_SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string', description: 'The full Instagram caption, including the episode line and hashtags.' },
  },
  required: ['caption'],
  additionalProperties: false,
} as const;

export type CaptionFacts = {
  episode: number;
  title: string;
  scope: string | null;
  storyboard: string | null;
  script: string | null;
  source: string | null;
};

export type CaptionDraft = {
  text: string;
  usd: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** A billed caption call that did not produce a usable post. `spent` is the call to ledger. */
export class CaptionError extends Error {
  constructor(
    message: string,
    readonly spent?: CaptionDraft,
  ) {
    super(message);
  }
}

export function episodeLine(episode: number): string {
  return `AI BRAIN BREAK - EPISODE ${episode}:`;
}

/** The caption, or a throw that names which rule it broke. */
export function parseCaption(raw: unknown, episode: number): string {
  const text = typeof raw === 'string' ? raw.replace(/\r\n/g, '\n').trim() : '';
  if (!text) throw new Error('caption is empty');
  if (text.length > 2200) throw new Error('caption is over 2,200 characters');
  if (/https?:\/\//i.test(text)) throw new Error('caption contains a URL');
  if (/\p{Extended_Pictographic}/u.test(text)) throw new Error('caption contains an emoji');
  if (/\b(we|our|ours|us)\b/i.test(text) || /\bI\b/.test(text)) throw new Error('caption speaks as Helios');
  const line = episodeLine(episode);
  const parts = text.split('\n');
  if (parts[0] !== line) throw new Error(`caption must open with "${line}"`);
  let index = 1;
  while (parts[index] === '') index += 1;
  const hook = parts[index] ?? '';
  if (!hook.trim()) throw new Error('caption is missing a hook');
  if (`${line}\n\n${hook}`.length > 125) throw new Error('the episode line and the hook are over 125 characters');
  if (!text.includes('Save this for the next time')) throw new Error('caption is missing the save line');
  const tags = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  if (tags.length < 3 || tags.length > 5) throw new Error('caption needs 3 to 5 hashtags');
  const beforeTags = text.slice(0, text.indexOf(tags[0]!));
  if (beforeTags.includes('#')) throw new Error('hashtags belong at the end');
  return text;
}

function clip(value: string | null, max: number): string {
  if (!value) return '';
  return value.length <= max ? value : `${value.slice(0, max)}\n…`;
}

export function captionUserMessage(facts: CaptionFacts): string {
  return [
    `Episode number: ${facts.episode}`,
    `The first line must be exactly: ${episodeLine(facts.episode)}`,
    '',
    `Title: ${facts.title}`,
    `Scope: ${facts.scope ?? ''}`,
    '',
    'SCRIPT.md:',
    clip(facts.script, 12_000),
    '',
    'STORYBOARD.md:',
    clip(facts.storyboard, 12_000),
    '',
    'Source, if any:',
    clip(facts.source, 8_000),
  ].join('\n');
}

export function captionParams(facts: CaptionFacts, model: string): StructuredParams {
  return {
    model,
    max_tokens: 8000,
    system: cachedSystemText(`${CAPTION_INSTRUCTIONS}\n\nVersion: ${CAPTION_VERSION}`),
    messages: [{ role: 'user', content: captionUserMessage(facts) }],
    output_config: { format: { type: 'json_schema', schema: CAPTION_SCHEMA } },
  };
}

function draftFrom(message: Anthropic.Message, text: string): CaptionDraft {
  const usage = message.usage as MessageUsageLike['usage'];
  const buckets = usageBucketsFromMessage({ usage }, '1h');
  return {
    text,
    usd: Number(priceAnthropicUsage(buckets, { modelId: message.model }).costUsd),
    model: message.model,
    inputTokens: buckets.uncachedInputTokens,
    outputTokens: buckets.outputTokens,
    cacheReadTokens: buckets.cacheReadInputTokens,
    cacheWriteTokens: buckets.cacheCreation5mInputTokens + buckets.cacheCreation1hInputTokens,
  };
}

/** Live caption. Tests pass a stub into the render job instead of calling this. */
export async function writeExplainerCaption(facts: CaptionFacts, model: string): Promise<CaptionDraft> {
  const { anthropic } = await import('@/lib/anthropic');
  const message = await anthropic.messages.create(captionParams(facts, model) as never);
  const priced = draftFrom(message, '');
  let text: string;
  try {
    const body = structuredJson(message, 'explainer caption') as { caption?: unknown };
    text = parseCaption(body.caption, facts.episode);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CaptionError(detail, priced);
  }
  return { ...priced, text };
}
