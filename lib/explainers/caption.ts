import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText } from '@/lib/anthropic-cache';
import { priceAnthropicUsage, usageBucketsFromMessage, type MessageUsageLike } from '@/lib/anthropic-pricing';
import {
  CAPTION_HOOK_PREVIEW,
  CAPTION_MAX_CHARS,
  CAPTION_MIN_BODY_CHARS,
  hookPreviewLimit,
  parseCaption,
} from '@/lib/explainers/caption-format';
import { structuredJson, type StructuredParams } from '@/lib/explainers/ideas/generator';

export {
  CAPTION_HOOK_PREVIEW,
  CAPTION_MAX_CHARS,
  CAPTION_MIN_BODY_CHARS,
  episodeLine,
  hookPreviewLimit,
  parseCaption,
  reviewCaption,
  stampCaption,
  stripEpisodePrefix,
} from '@/lib/explainers/caption-format';

/**
 * The Instagram caption written beside a finished Explainer Reel.
 * Tracks `.cursor/skills/explainer-caption/SKILL.md`. The burned-in
 * `caption_groups.json` is a different artifact (`captions`).
 *
 * The writer returns the body only. Code stamps
 * `AI Brain Break Episode N:` at publish time from the published count.
 * The system prompt is the stable prefix and carries the cache breakpoint.
 */

export const CAPTION_VERSION = 'explainer-caption-v2';

export const CAPTION_INSTRUCTIONS = `You write the Instagram caption for one finished Helios Explainer Reel. This is the post text under the video, the same job a strong social caption does for any Reel: stop the scroll, pay out the idea, and give the viewer a reason to save or send it.

Do not write an episode title or an episode number. Code adds the line "AI Brain Break Episode N:" when the reel publishes.

HARD CONSTRAINTS. Every one is required.
1. Return JSON matching the schema. The caption field is the body of the post, nothing else. No episode line.
2. The first paragraph is the hook, one or two short sentences. After code adds the episode line and a blank line, that opening plus the hook must stay within ${CAPTION_HOOK_PREVIEW} characters. Keep the hook under ${hookPreviewLimit()} characters so episode 999 still fits. The hook makes sense with no video playing. It is not the spoken thesis copied out, and it is not a description of the frames.
3. After the hook, write a real caption. Short paragraphs with a blank line between them. One block is a failed caption. You need a hook, at least two body paragraphs, and a call to action: four blocks minimum. The body before hashtags must be at least ${CAPTION_MIN_BODY_CHARS} characters. A one-sentence caption is a failed caption.
4. The body makes the idea useful in the viewer's world. Use the reel's analogy, example, catch, and the place they will meet this. Do not walk the seven beats in order, and do not stop after one restatement of the thesis.
5. One call to action, specific to this concept: save it for a named situation from the reel, or send it to the person who hits that situation. No "what do you think?", no "double tap", no "comment YES", no offer of Helios services.
6. 3 to 5 hashtags, only at the end. One or two broad, the rest specific to this concept. Each tag needs a reason in the post.
7. No emoji. No URLs. Do not speak as "we", "our", "us", or "I". Address the viewer as "you", or write in the third person. Do not sign off with Helios.
8. Every number, name, and claim comes from the title, scope, script, storyboard, or source in the user message. Do not add one.
9. Plain words. A reader at about a sixth-grade level gets every line on one read. Never talk down. No "not X, but Y". No one-line closer that repeats the paragraph before it. No dash used for drama.
10. The caption, the call to action, and the hashtags together stay within ${CAPTION_MAX_CHARS} characters.

Shape:
Hook that stands alone in the preview.

What this is, in the viewer's world, with the reel's concrete example.

The catch, or the place they will meet it. Enough that the idea sticks after the video ends.

Save this for the next time <the situation this reel is about>, or send it to the person who hits that situation.

#specific #specific #broad`;

const CAPTION_SCHEMA = {
  type: 'object',
  properties: {
    caption: {
      type: 'string',
      description: 'The Instagram caption body only: hook, paragraphs, call to action, and hashtags. No episode line.',
    },
  },
  required: ['caption'],
  additionalProperties: false,
} as const;

export type CaptionFacts = {
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

function clip(value: string | null, max: number): string {
  if (!value) return '';
  return value.length <= max ? value : `${value.slice(0, max)}\n…`;
}

export function captionUserMessage(facts: CaptionFacts): string {
  return [
    'Write the Instagram caption body for this reel. Do not include an episode title or episode number.',
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
    text = parseCaption(body.caption);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CaptionError(detail, priced);
  }
  return { ...priced, text };
}
