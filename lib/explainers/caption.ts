import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText } from '@/lib/anthropic-cache';
import { priceAnthropicUsage, usageBucketsFromMessage, type MessageUsageLike } from '@/lib/anthropic-pricing';
import {
  CAPTION_BODY_MAX_CHARS,
  CAPTION_HOOK_PREVIEW,
  CAPTION_WRITER_MAX_CHARS,
  LEARN_MORE_SO_I_MAX_CHARS,
  LEARN_MORE_TOPIC_MAX_CHARS,
  LEARN_MORE_TOPICS_MAX,
  LEARN_MORE_TOPICS_MIN,
  captionBody,
  learnMoreBlock,
  parseCaption,
  parseLearnMore,
  withLearnMore,
} from '@/lib/explainers/caption-format';
import { CURRICULUM, syllabusEntry } from '@/lib/explainers/ideas/curriculum';
import { structuredJson, type StructuredParams } from '@/lib/explainers/ideas/generator';
import { HELIOS_NAME } from '@/lib/social/captions/helios-context';
import { readHeliosVoice } from '@/lib/social/voice/voice';

export {
  CAPTION_BODY_MAX_CHARS,
  CAPTION_HOOK_PREVIEW,
  CAPTION_MAX_CHARS,
  CAPTION_MIN_BODY_CHARS,
  parseCaption,
  reviewCaption,
  stripEpisodePrefix,
  withHeliosLine,
} from '@/lib/explainers/caption-format';

/**
 * The Instagram caption written beside a finished Explainer Reel.
 * Tracks `.cursor/skills/explainer-caption/SKILL.md`. The burned-in
 * `caption_groups.json` is a different artifact (`captions`).
 *
 * The writer returns a short text and hashtags, plus the parts of a learn-more prompt; code assembles the
 * prompt after the text (v15), and the render job adds the Helios line before the hashtags
 * (caption-format.ts withHeliosLine). There is no episode line (caption voice, 2026-11-24).
 * The system prompt (shared voice, then these instructions) is the stable prefix and carries the cache breakpoint.
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
// v14 (caption voice, 2026-11-24; planning/Caption Voice/PLAN.md): the shared Helios voice leads the prompt. The caption
// answers the viewer's most likely next question: if the concept may still be unclear, a fresh "still with us?" kind of
// opener and a re-explanation from a new angle; if it is easy, the most surprising of where it gets serious, where it
// breaks, or what it unlocks. No save ask and no episode line (Lucas: "drop the save this"; "AI 101 Episode N" is too
// hard to track). Code adds a generic Helios line before the hashtags.
// v15 (2026-11-24): Lucas, the caption should lead into "want to learn more?" and a prompt the viewer gives their AI:
// "Teach me about [topic]. Dive into [adjacent topics], so that builders can have a real understanding of the world of
// knowledge that surrounds the topic." The explanation stays but shortens: "Less is necessary because we're pointing
// them to a treasure trove of additional knowledge." The writer picks the topics (the syllabus neighbors are offered
// as candidates); code writes the learn-more line and the prompt's frame, so its shape never drifts.
export const CAPTION_VERSION = 'explainer-caption-v15';

export const CAPTION_INSTRUCTIONS = `You write the Instagram caption for one finished AI 101 reel, which teaches one AI or software concept to a broad audience. You get the reel's final script (the words the viewer just heard) and the reel's term. The caption does two jobs: a short answer to the question this script most likely leaves the viewer with, then a prompt the viewer can give their own AI to learn the world around this concept.

Code assembles the caption in this order: your short text, a "want to learn more?" line with the prompt built from your three prompt fields, a line about the page, then your hashtags. Do not write the learn-more line, the prompt or the page line in your caption field, and do not write an episode title or number.

HARD CONSTRAINTS. Every one is required.
1. Return JSON matching the schema. The caption field is your short text, then your hashtags, nothing else.
2. Before you write, decide which question the average viewer is most likely left with after this script, and answer it.
   a. If the concept may still be unclear after one watch, the question is "wait, what is it?". Open by meeting the viewer where they are: one short line that admits they may not have it yet, worded fresh for this concept. Then explain it again from a different angle than the script, in plainer words.
   b. If the script makes the concept easy to get, the question is "so what?". Pick the one this concept has the most surprising answer for: where it gets serious (a high-stakes use where it matters), where it breaks (the common misunderstanding, or its limit), or what it unlocks (the next idea it is a building block of). Open on it and give the one point that matters most.
3. The opening line hooks on its own, in under ${CAPTION_HOOK_PREVIEW} characters: it is all that shows before "more".
4. Keep it short: the hook and one or two short paragraphs of one or two sentences each, a blank line between them, at most ${CAPTION_BODY_MAX_CHARS} characters before the hashtags. Stop as soon as the question is answered; the prompt after it does the deep teaching.
5. No dashes for drama, no "not X, but Y", no lists of three for rhythm, and no closing line that repeats the one before it.
6. What the script says stays as the script says it. What you add beyond it is well established, stated plainly and accurately. Never invent a number, study, quote, product, or anecdote.
7. No ask of your own: no "save this", no question, no other call to action. Code's learn-more line is the caption's only ask.
8. End with 3 to 5 hashtags, only at the end, each with a reason in the post. At most two emoji, none required, none in the hashtags. No URLs. Never "I" in the caption field. Never name Helios or any author. Plain words a reader at about a sixth-grade level gets on one read. Name a character from the reel by its role; never call it a "critter".
9. The prompt, which the viewer screenshots and gives a chatbot. Code writes it as: Teach me about <teach_me_about>. Dive into <dive_into, joined with commas and "and">, so I <so_i>.
   a. teach_me_about: the reel's term as it reads after "Teach me about", made plural only when the sentence needs it.
   b. dive_into: ${LEARN_MORE_TOPICS_MIN} to ${LEARN_MORE_TOPICS_MAX} ideas around this concept that a builder needs for a real understanding of its world: what it rests on, what it works with, what it makes possible, and where it breaks. The nearby syllabus topics you are given are good candidates; any other well-established idea is fine. Use each idea's real name, the words a chatbot knows it by (the sixth-grade rule is for your caption text), at most ${LEARN_MORE_TOPIC_MAX_CHARS} characters each, never the term itself, most foundational first.
   c. so_i: the rest of the sentence after "so I": what the viewer will understand once they learn these, about how the concept fits with them and what it means for what they build. At most ${LEARN_MORE_SO_I_MAX_CHARS} characters, no period at the end.
   d. The prompt speaks as the viewer, so "I", "me" and "my" are fine in its fields. No quote marks, hashtags, emoji or URLs in them.`;

/** The cached system prefix: the shared voice, then this caption's structure. */
export function captionSystem(root?: string): string {
  return `${readHeliosVoice(root)}\n\n# This caption\n\n${CAPTION_INSTRUCTIONS}\n\nVersion: ${CAPTION_VERSION}`;
}

const CAPTION_SCHEMA = {
  type: 'object',
  properties: {
    caption: {
      type: 'string',
      description: 'Your short caption text, then 3 to 5 hashtags. No episode line, no ask, no learn-more prompt, no line about the page.',
    },
    teach_me_about: { type: 'string', description: 'The reel\'s term as it reads after "Teach me about".' },
    dive_into: {
      type: 'array',
      items: { type: 'string' },
      description: `${LEARN_MORE_TOPICS_MIN} to ${LEARN_MORE_TOPICS_MAX} ideas around the concept a builder needs, most foundational first.`,
    },
    so_i: { type: 'string', description: 'The rest of the prompt after "so I", no period at the end.' },
  },
  required: ['caption', 'teach_me_about', 'dive_into', 'so_i'],
  additionalProperties: false,
} as const;

export type CaptionFacts = {
  title: string;
  /** The reel's term (topics.term, else the storyboard's); the prompt teaches it. Null when neither names one. */
  term?: string | null;
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

/** The reel's term and its other names, for the prompt's "Teach me about" check. */
export function termNames(term: string | null | undefined): string[] {
  const clean = term?.trim();
  if (!clean) return [];
  return [...new Set([clean, ...(syllabusEntry(clean)?.aka ?? [])])];
}

/** The term's syllabus neighbors: what it requires, then the topics that require it. Candidates for dive_into. */
export function syllabusNeighbors(term: string | null | undefined): string[] {
  const entry = syllabusEntry(term);
  if (!entry) return [];
  const key = entry.term.toLowerCase();
  const later = CURRICULUM.filter((topic) => topic.requires.some((name) => name.toLowerCase() === key)).map((topic) => topic.term);
  return [...new Set([...entry.requires, ...later])].slice(0, 12);
}

export function captionUserMessage(facts: CaptionFacts, opts: CaptionOptions): string {
  const term = facts.term?.trim() || facts.title;
  const neighbors = syllabusNeighbors(facts.term);
  return [
    'Write the Instagram caption for this reel.',
    '',
    `The reel's term: ${term}`,
    ...(neighbors.length ? [`Nearby syllabus topics: ${neighbors.join('; ')}`] : []),
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
    system: cachedSystemText(captionSystem()),
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
    const body = structuredJson(message as Anthropic.Message, 'explainer caption') as { caption?: unknown; teach_me_about?: unknown; dive_into?: unknown; so_i?: unknown };
    const written = parseCaption(body.caption);
    const short = captionBody(written).length;
    if (short > CAPTION_BODY_MAX_CHARS) {
      throw new Error(`The caption text is ${short} characters before the hashtags; keep it within ${CAPTION_BODY_MAX_CHARS}: the hook and one or two short paragraphs, since the prompt after it does the deep teaching.`);
    }
    const learn = parseLearnMore({ topic: body.teach_me_about, diveInto: body.dive_into, soI: body.so_i }, termNames(facts.term));
    text = parseCaption(withLearnMore(written, learnMoreBlock(learn, facts.term?.trim() || facts.title)));
    if (text.length > CAPTION_WRITER_MAX_CHARS) throw new Error(`The caption is ${text.length} characters; keep it within ${CAPTION_WRITER_MAX_CHARS}.`);
    if (HELIOS_NAME.test(text)) throw new Error('The caption names Helios. Remove it; code adds the line about the page.');
    checkNoCritter(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CaptionError(detail, priced);
  }
  return { ...priced, text };
}
