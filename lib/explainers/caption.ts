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
import {
  BUILD_FIT,
  buildFitState,
  buildLineInstruction,
  recentClosingsBlock,
  type RecentClosing,
} from '@/lib/social/captions/build-line';
import { CAPTION_SHARED_RULES, HELIOS_CONTEXT } from '@/lib/social/captions/helios-context';
import { createJevAsk, type JevAsk } from '@/lib/social/jev/client';

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

// v3 (Explainers 3.0): rule 4 and the shape follow the eight-beat reel. Drafted 2026-10-13,
// awaiting Lucas's approval (R6).
// v4 (social captions redesign, 2026-10-19): the caption closes on a builder's read that puts
// the episode's concept in a real business and names Helios once; "we" is allowed only there.
// Carries the shared Helios context and caption rules. The padding gates are loosened.
export const CAPTION_VERSION = 'explainer-caption-v4';

export const CAPTION_INSTRUCTIONS = `You write the Instagram caption for one finished Helios Explainer Reel, an AI Brain Break episode that teaches one AI concept. This is the post text under the video, the same job a strong social caption does for any Reel: stop the scroll, make the idea stick, show where it turns up in a real business, and give the viewer a reason to save or send it.

Do not write an episode title or an episode number. Code adds the line "AI Brain Break Episode N:" when the reel publishes.

${HELIOS_CONTEXT}

${CAPTION_SHARED_RULES}

An explainer teaches a concept; it does not report news. Read the shared rules that way: the factual part is the concept as the reel taught it, and the builder's read says where that concept shows up in a real business.

HARD CONSTRAINTS. Every one is required.
1. Return JSON matching the schema. The caption field is the body of the post, nothing else. No episode line. The builder_read field repeats the builder's read paragraph from the caption, word for word.
2. The first paragraph is the hook, one or two short sentences. After code adds the episode line and a blank line, that opening plus the hook must stay within ${CAPTION_HOOK_PREVIEW} characters. Keep the hook under ${hookPreviewLimit()} characters so episode 999 still fits. The hook makes sense with no video playing. It is not the spoken thesis copied out, and it is not a description of the frames.
3. Short paragraphs with a blank line between them, in this order: the hook, a body paragraph or two when the idea needs them, the builder's read, the call to action, then the hashtags. One block is a failed caption. The body before the hashtags is at least ${CAPTION_MIN_BODY_CHARS} characters. Say the idea once and well. Do not pad to reach a length.
4. The body makes the idea useful in the viewer's world. Use the reel's curiosity gap, analogy, example, and the place they will meet this. Do not walk the eight beats in order, and do not stop after one restatement of the thesis. Then the builder's read, one short paragraph just before the call to action: pick one kind of business from the Helios context and show where this episode's concept turns up in its marketing, sales or operations, at the moment the concept helps or the moment it gets in the way. Name Helios once, lightly, in words that differ from the recent closings the task shows you. The read may say "we" and give an opinion. Everything it says about Helios comes from the Helios context, and it adds no new fact about the concept.
5. One call to action, specific to this concept: save it for a named situation from the reel, or send it to the person who hits that situation. No "what do you think?", no "double tap", no "comment YES", no "DM us", and no list of services.
6. 3 to 5 hashtags, only at the end. One or two broad, the rest specific to this concept. Each tag needs a reason in the post.
7. No emoji. No URLs. Never "I". Outside the builder's read, address the viewer as "you" or write in the third person.
8. Every number, name, and claim about the concept comes from the title, scope, script, storyboard, or source in the user message. Do not add one.
9. Plain words. A reader at about a sixth-grade level gets every line on one read. Never talk down. No "not X, but Y". No one-line closer that repeats the paragraph before it. No dash used for drama.
10. The caption, the call to action, and the hashtags together stay within ${CAPTION_MAX_CHARS} characters.

Shape:
Hook that stands alone in the preview.

What this is, in the viewer's world, with the reel's concrete example. Leave it out when the hook and the read already carry the idea.

The builder's read: where this concept shows up in one kind of business, with Helios named once.

Save this for the next time <the situation this reel is about>, or send it to the person who hits that situation.

#specific #specific #broad`;

const CAPTION_SCHEMA = {
  type: 'object',
  properties: {
    caption: {
      type: 'string',
      description: "The Instagram caption body only: hook, paragraphs, builder's read, call to action, and hashtags. No episode line.",
    },
    builder_read: {
      type: 'string',
      description: "The builder's read paragraph, copied word for word from the caption.",
    },
  },
  required: ['caption', 'builder_read'],
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
  /** v4. The builder's read, one paragraph of `text`. Recorded as this caption's closing. */
  builderRead: string;
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

/** Per-post caption inputs: they go in the user message, after the cache breakpoint. */
export type CaptionOptions = { recent: RecentClosing[]; includeBuildLine: boolean };

export function captionUserMessage(facts: CaptionFacts, opts: CaptionOptions): string {
  const closings = recentClosingsBlock(opts.recent);
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
    '',
    ...(closings ? [closings, ''] : []),
    buildLineInstruction(opts.includeBuildLine),
  ].join('\n');
}

export function captionParams(facts: CaptionFacts, model: string, opts: CaptionOptions): StructuredParams {
  return {
    model,
    max_tokens: 8000,
    system: cachedSystemText(`${CAPTION_INSTRUCTIONS}\n\nVersion: ${CAPTION_VERSION}`),
    messages: [{ role: 'user', content: captionUserMessage(facts, opts) }],
    output_config: { format: { type: 'json_schema', schema: CAPTION_SCHEMA } },
  };
}

function draftFrom(message: Anthropic.Message, text: string): CaptionDraft {
  const usage = message.usage as MessageUsageLike['usage'];
  const buckets = usageBucketsFromMessage({ usage }, '1h');
  return {
    text,
    builderRead: '',
    usd: Number(priceAnthropicUsage(buckets, { modelId: message.model }).costUsd),
    model: message.model,
    inputTokens: buckets.uncachedInputTokens,
    outputTokens: buckets.outputTokens,
    cacheReadTokens: buckets.cacheReadInputTokens,
    cacheWriteTokens: buckets.cacheCreation5mInputTokens + buckets.cacheCreation1hInputTokens,
  };
}

const HELIOS = /\bHelios\b/;

function squash(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** v4. The read is one paragraph of the caption and names Helios. Throws a reason the retry can use. */
export function checkBuilderRead(raw: unknown, caption: string): string {
  const read = typeof raw === 'string' ? raw.trim() : '';
  if (!read) throw new Error("builder_read is empty. Return the builder's read paragraph word for word.");
  const paragraphs = caption.split(/\n[ \t]*\n/).map(squash);
  if (!paragraphs.includes(squash(read))) {
    throw new Error("builder_read is not a paragraph of the caption. Put the read just before the call to action, word for word.");
  }
  if (!HELIOS.test(read)) throw new Error("builder_read does not name Helios. Name Helios once, lightly, in the read.");
  return read;
}

/**
 * Live caption. Tests pass a stub into the render job instead of calling this, or a stub
 * `client` here; nothing reaches the API without the lazy import below.
 */
export async function writeExplainerCaption(
  facts: CaptionFacts,
  model: string,
  opts: CaptionOptions & { client?: Pick<Anthropic, 'messages'> },
): Promise<CaptionDraft> {
  const client = opts.client ?? (await import('@/lib/anthropic')).anthropic;
  const message = await client.messages.create(captionParams(facts, model, opts) as never);
  const priced = draftFrom(message as Anthropic.Message, '');
  let text: string;
  let builderRead: string;
  try {
    const body = structuredJson(message as Anthropic.Message, 'explainer caption') as { caption?: unknown; builder_read?: unknown };
    text = parseCaption(body.caption);
    builderRead = checkBuilderRead(body.builder_read, text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CaptionError(detail, priced);
  }
  return { ...priced, text, builderRead };
}

/**
 * v4. The live build-fit question for one finished reel: Jev reads the title and
 * script against the Helios context. Null on any failure, which means no build line.
 */
export function liveExplainerBuildFit(ask: JevAsk = createJevAsk()): (facts: CaptionFacts) => Promise<number | null> {
  return async (facts) => {
    try {
      const res = await ask(
        { state: buildFitState({ headline: facts.title, text: facts.script ?? facts.scope ?? '' }), questions: BUILD_FIT.questions },
        { version: BUILD_FIT.version, subjectId: facts.title },
      );
      const value = res.answers.builds?.noul;
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };
}
