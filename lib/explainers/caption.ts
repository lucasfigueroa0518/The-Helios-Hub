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
import { HELIOS_NAME } from '@/lib/social/captions/helios-context';

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
// the Helios line or hashtags; the Helios line names the context industry that best matches (no fixed list).
// Amended again before it shipped (Tommy, 2026-10-20, after the first live check): the Helios line
// makes one concrete point in Helios's view (what Helios builds only under include_build_line; fix
// round 1), never a generic "how we think about it" tag or a recent closing's opening; a follow clause is rare; paragraphs are one or two sentences; usually one emoji
// leads the hook and one follows the ask.
// v6 (fix round 3, Tommy, 2026-10-20, after the live Reels check; v5 shipped 2026-10-20): the Helios
// line says what a business in that industry should start, stop, or watch because of this concept,
// said in Helios's voice (no "Helios's view" label to echo), never opens on a label or framing phrase;
// a reasonable industry match never stretches to an adjacent one; staged reveal phrases are banned (shared rules).
// v7 (Explainers 3.8, EX3-121): a character is named by its role, never "critter", checked in code.
// v8 (Explainers 3.9, EX3-123): the reel's analogy is a named one, and the caption names it by its name.
// v9 (2026-11-03): the caption is the reel's second half. Lucas: "I want the caption to be another source of
// information"; it bridges from the video and promises the answer is here, then gives what the average viewer
// would want to know next (clarify by zooming out, restate, go a level deeper, tie to other things); "lots of
// line breaks", humanized, "like a social media caption". It reads only the final script: "that will also be what
// the viewer is looking at". v10 (same day): the Helios line grows out of the paragraph before it (Lucas: the real
// estate line was "completely out of place… a symptom of overengineering and contradicting instructions"); its
// restated rules are cut, the shared rules own how it sounds.
// v11-v12 (same day) took the industry and the claims about how Helios works out of the Helios line. v13 (same day)
// removes the line: Lucas, "it may be best to just not do this section of the caption at all. Do that." Common advice
// passed off as a finding looks foolish. So no Helios context, shared Helios rules, closings or build-fit call here.
export const CAPTION_VERSION = 'explainer-caption-v13';

export const CAPTION_INSTRUCTIONS = `You write the Instagram caption for one finished AI Brain Break reel, which teaches one AI or software concept to a broad audience. You get the reel's final script: the words the viewer just heard. The caption is the reel's second half, the place the viewer goes for what the video left them wanting to know.

Do not write an episode title or an episode number. Code adds the line "AI Brain Break Episode N:" when the reel publishes.

HARD CONSTRAINTS. Every one is required.
1. Return JSON matching the schema. The caption field is the body of the post, nothing else.
2. The opening is one or two short sentences that pick up where the video left off and promise the viewer that what they want to know next is right here in the caption. Keep it under ${hookPreviewLimit()} characters.
3. Before you write, decide what the average viewer would most want to know after this script. It is one or two of these, whichever this script leaves most open: a zoom-out that shows where the concept fits among the things around it; a plainer restatement of what the video moved through fast; the next level down, how it works more specifically or technically; or a tie to tools and situations the viewer already knows. The body delivers that. It never re-narrates the script.
4. Write for reading on a phone: one thought per line or per short paragraph of one or two sentences, a blank line between them, plenty of white space. Every line earns its place; cut a secondary detail rather than add a sentence. It reads like a social post from someone who knows the subject well, never like a paper or a textbook.
5. Write like a person: no dashes for drama, no "not X, but Y", no lists of three for rhythm, no hype or filler words, no staged reveal or run-up phrase, no hedging that adds nothing, and no closing line that repeats the one before it.
6. What the script says stays as the script says it. What you add beyond it is well-established, stated plainly and accurately. Never invent a number, study, quote, product, or anecdote.
7. The body ends on one short line that asks for one thing specific to this concept: save it for a named situation, or a short question the viewer can answer from their own work. No "what do you think?", no engagement bait.
8. Then 3 to 5 hashtags, only at the end, each with a reason in the post. At most two emoji, none required, none in the hashtags. No URLs. Never "I". Never name Helios or any author, and give no advice in anyone's voice. Plain words a reader at about a sixth-grade level gets on one read, without talking down. Name a character from the reel by its role; never call it a "critter".
9. The whole caption, the hashtags included, stays within ${CAPTION_MAX_CHARS} characters.`;

const CAPTION_SCHEMA = {
  type: 'object',
  properties: {
    caption: {
      type: 'string',
      description: 'The Instagram caption body only: hook, paragraphs, the save prompt or question, and hashtags. No episode line.',
    },
  },
  required: ['caption'],
  additionalProperties: false,
} as const;

export type CaptionFacts = {
  title: string;
  scope: string | null;
  /** The picked analogy's name (EX3-123); null on a reel without one. */
  analogy?: string | null;
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

/**
 * Per-post caption inputs: they go in the user message, after the cache breakpoint.
 * `retryReason` is why the previous attempt for this reel was rejected, so the retry is not blind.
 */
export type CaptionOptions = { retryReason?: string };

export function captionUserMessage(facts: CaptionFacts, opts: CaptionOptions): string {
  return [
    'Write the Instagram caption body for this reel. Do not include an episode title or episode number.',
    '',
    'The final script (SCRIPT.md):',
    clip(facts.script, 12_000),
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
    usd: Number(priceAnthropicUsage(buckets, { modelId: message.model }).costUsd),
    model: message.model,
    inputTokens: buckets.uncachedInputTokens,
    outputTokens: buckets.outputTokens,
    cacheReadTokens: buckets.cacheReadInputTokens,
    cacheWriteTokens: buckets.cacheCreation5mInputTokens + buckets.cacheCreation1hInputTokens,
  };
}

function squash(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** v7 (EX3-121): "critter" is the drawing style's word, never shown. Throws a reason the retry can use. */
export function checkNoCritter(caption: string): void {
  const said = /\bcritters?\b/i.exec(caption);
  if (said) throw new Error(`The caption says "${said[0]}". Name each character by its role in the reel (the waiter, the searcher); never "critter".`);
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
  try {
    const body = structuredJson(message as Anthropic.Message, 'explainer caption') as { caption?: unknown };
    text = parseCaption(body.caption, { heliosLine: false });
    if (HELIOS_NAME.test(text)) throw new Error('The caption names Helios. Remove it; this caption has no Helios line.');
    checkNoCritter(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CaptionError(detail, priced);
  }
  return { ...priced, text };
}
