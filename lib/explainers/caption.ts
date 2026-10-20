import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText } from '@/lib/anthropic-cache';
import { priceAnthropicUsage, usageBucketsFromMessage, type MessageUsageLike } from '@/lib/anthropic-pricing';
import {
  CAPTION_HOOK_PREVIEW,
  CAPTION_MAX_CHARS,
  CAPTION_MIN_BODY_CHARS,
  heliosLine,
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
// v5 (per-format comps, 2026-10-19): the hook names the viewer's problem; then the why, a save
// prompt or "which would you use first" question, and the Helios line last, before the hashtags.
// Amended before it shipped (Tommy, 2026-10-19): up to two emoji (hook, after the ask), none in
// the Helios line or hashtags; the Helios line prefers a named industry.
export const CAPTION_VERSION = 'explainer-caption-v5';

export const CAPTION_INSTRUCTIONS = `You write the Instagram caption for one finished Helios Explainer Reel, an AI Brain Break episode that teaches one AI concept. This is the post text under the video, the job a strong tips caption does on any AI page: name a problem the viewer already has, make the idea stick, and give them a reason to save it or to say which option they would use first.

Do not write an episode title or an episode number. Code adds the line "AI Brain Break Episode N:" when the reel publishes.

${HELIOS_CONTEXT}

${CAPTION_SHARED_RULES}

An explainer teaches a concept; it does not report news. Read the shared rules that way: the factual part is the concept as the reel taught it, and the Helios line says where that concept shows up in a real business.

HARD CONSTRAINTS. Every one is required.
1. Return JSON matching the schema. The caption field is the body of the post, nothing else. No episode line. The builder_read field repeats the Helios line from the caption, word for word.
2. The first paragraph is the hook, one or two short sentences. It names a problem or situation the viewer has that this concept explains, in their words: a chat that forgets how it started, an answer that sounds sure and is wrong. After code adds the episode line and a blank line, that opening plus the hook must stay within ${CAPTION_HOOK_PREVIEW} characters. Keep the hook under ${hookPreviewLimit()} characters so episode 999 still fits. The hook makes sense with no video playing. It is not the spoken thesis copied out, and it is not a description of the frames.
3. Short paragraphs with a blank line between them, in this order: the hook, two or three short paragraphs on why, the save prompt or question, the Helios line, then the hashtags. One block is a failed caption. The body before the hashtags, the Helios line included, is at least ${CAPTION_MIN_BODY_CHARS} characters. Say the idea once and well. Do not pad to reach a length.
4. The paragraphs on why make the idea useful in the viewer's world. Use the reel's curiosity gap, analogy, example, and the place they will meet this. Do not walk the eight beats in order, and do not stop after one restatement of the thesis.
5. Then one short paragraph that asks for one thing, specific to this concept: save it for a named situation from the reel, or a short question such as which of the reel's options they would use first. It can do both in two short sentences. No "what do you think?", no "double tap", no "comment YES", no "DM us", and no list of services.
6. The Helios line is the last paragraph before the hashtags, one or two sentences. Prefer naming a specific industry from the Helios context, such as a real estate team, a law firm, a med spa, an HVAC company, or a consumer brand, whenever one is a reasonable match, and show where this episode's concept turns up in its marketing, sales or operations, at the moment the concept helps or the moment it gets in the way. Fall back to marketing or sales work in general only when no industry fits, keep the example inside what Helios builds, and pick an industry the recent closings did not use. Name Helios once, here and nowhere else, in words that differ from the recent closings the task shows you. It may say "we" and give an opinion, and it may end by inviting the viewer to follow for the next episode. Everything it says about Helios comes from the Helios context, and it adds no new fact about the concept.
7. 3 to 5 hashtags, only at the end. One or two broad, the rest specific to this concept. Each tag needs a reason in the post.
8. At most two emoji, and none is required: one may lead the hook (code puts the episode line above it), and one may follow the save prompt or question. None in the Helios line or the hashtags. No URLs. Never "I". Outside the Helios line, address the viewer as "you" or write in the third person.
9. Every number, name, and claim about the concept comes from the title, scope, script, storyboard, or source in the user message. Do not add one.
10. Plain words. A reader at about a sixth-grade level gets every line on one read. Never talk down. No "not X, but Y". No one-line closer that repeats the paragraph before it. No dash used for drama.
11. The whole caption, the hashtags included, stays within ${CAPTION_MAX_CHARS} characters.

Shape:
Hook that names the viewer's problem and stands alone in the preview.

Why it happens, in the viewer's world, with the reel's concrete example.

One more short paragraph on why, when the idea needs it.

Save this for the next time <the situation this reel is about>. Or ask which of the reel's options they would try first.

The Helios line: where this concept shows up in one kind of business, with Helios named once.

#specific #specific #broad`;

const CAPTION_SCHEMA = {
  type: 'object',
  properties: {
    caption: {
      type: 'string',
      description: 'The Instagram caption body only: hook, paragraphs, the save prompt or question, the Helios line, and hashtags. No episode line.',
    },
    builder_read: {
      type: 'string',
      description: 'The Helios line, the last paragraph before the hashtags, copied word for word from the caption.',
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
  /** v4. The builder's read; v5 the Helios line, the last paragraph before the hashtags. Recorded as this caption's closing. */
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

/**
 * Per-post caption inputs: they go in the user message, after the cache breakpoint.
 * `retryReason` is why the previous attempt for this reel was rejected, so the retry is not blind.
 */
export type CaptionOptions = { recent: RecentClosing[]; includeBuildLine: boolean; retryReason?: string };

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
    ...(opts.retryReason ? ['', `Your last caption for this reel was rejected: ${opts.retryReason.trim()} Fix that, and keep every other rule.`] : []),
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

/** v5. The read is the Helios line, the caption's last paragraph before the hashtags, and names Helios. Throws a reason the retry can use. */
export function checkBuilderRead(raw: unknown, caption: string): string {
  const read = typeof raw === 'string' ? raw.trim() : '';
  if (!read) throw new Error('builder_read is empty. Return the Helios line word for word.');
  if (squash(read) !== squash(heliosLine(caption))) {
    throw new Error("builder_read is not the caption's last paragraph before the hashtags. End the caption on the Helios line and repeat it word for word.");
  }
  if (!HELIOS.test(read)) throw new Error('builder_read does not name Helios. Name Helios once, lightly, in the Helios line.');
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
 * `subjectId` keys the Jev log; the render job passes its job id.
 */
export function liveExplainerBuildFit(ask: JevAsk = createJevAsk()): (facts: CaptionFacts, subjectId: string) => Promise<number | null> {
  return async (facts, subjectId) => {
    try {
      const res = await ask(
        { state: buildFitState({ headline: facts.title, text: facts.script ?? facts.scope ?? '' }), questions: BUILD_FIT.questions },
        { version: BUILD_FIT.version, subjectId },
      );
      const value = res.answers.builds?.noul;
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };
}
