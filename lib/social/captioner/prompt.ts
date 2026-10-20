/**
 * Captioner prompt (social-captions redesign, 2026-10-19; spec
 * docs/superpowers/specs/2026-10-19-social-captions-design.md §Per type →
 * Carousels). The caption is its own stage after the Editor: the take on top
 * of the finished slides, in two parts (the news, then the builder's read),
 * joined by code. Task 8b (per-format comps, 2026-10-19): the news part ends
 * on a specific question and the read is the one-or-two-sentence Helios line,
 * so the posted caption ends news, question, Helios line, Source.
 *
 * Kept from the Writer's old caption section (prompts file §3, in git):
 * the first line carries the news, names plainly for search, glossing from
 * TERMS, the Context policy, every fact from the slides or the BRIEF.
 * Retired: the wire-report framing, "no opinions" (opinion now lives in the
 * read), and the fixed question + follow-Helios ending.
 *
 * Copy fix after the first live check (Tommy, 2026-10-20; the captioner has no
 * version string, so amended in place): about 500 to 900
 * characters, 2 or 3 short paragraphs, secondary facts cut, at most one
 * attribution clause; the read is one concrete point with Helios doing something
 * specific, the stock tags are banned, and a follow invite is rare.
 *
 * Pinned to the prompts file §9 (tests/social-captioner.test.ts).
 * Prompt caching: everything in CAPTIONER_SYSTEM is static; the slides, the
 * BRIEF, the recent closings and include_build_line go in the user message.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { buildLineInstruction, recentClosingsBlock, type RecentClosing } from '@/lib/social/captions/build-line';
import { CAPTION_SHARED_RULES, HELIOS_CONTEXT } from '@/lib/social/captions/helios-context';
import { renderRulesFor } from '@/lib/social/prompts/rules-block';
import { VOICE_BLOCK } from '@/lib/social/prompts/voice-block';
import type { Brief } from '@/lib/social/reporter/brief';
import type { FilledDraft } from '@/lib/social/writer/draft';
import { writerUserMessage } from '@/lib/social/writer/prompt';

export const CAPTIONER_INTRO = `You are the Captioner for Helios Group's Instagram carousels. The slides are finished. You write the caption under them, the way a sharp person who builds with AI would post about this story: hook first, short, with a view. Readers are smart and busy, curious about AI, and don't follow it closely. Work from the slides and the BRIEF only. No tools, no web, no outside knowledge.`;

export const CAPTIONER_CAROUSEL_RULES = `## The carousel caption

The slides tell the story. The caption is the take on top of them: what makes this surprising or what is at stake, and what it changes for a business. Someone who reads only the caption still gets the news, but never as a slide-by-slide retelling, and never in the slides' own lines. Aim for about 500 to 900 characters in all, the Helios line included, before the credits and Source line code adds. Every paragraph is one or two sentences, with a blank line between them. Vary sentence length: three short sentences in a row is too many.

Submit it in two parts. Code joins them, news first, with a blank line between, so read is always the caption's last paragraph.

news: everything before the Helios line, in this order.
- First, one plain, surprising sentence that carries the news on its own, through its tension, its stake or its most surprising fact, in under 125 characters. Instagram hides the rest behind "more," so many people read only that line.
- Then 2 or 3 short paragraphs on what happened, one or two sentences each. Keep only the facts the take needs. Cut secondary facts the slides already carry. The caption is the take, not a recap.
- Then a casual so-what line, the way a person would say why this matters. It adds no facts and does not name Helios.
- Last, one short, specific question a reader can answer from their own work or life. Ask about this story, word it nothing like the recent closings, and never ask "what do you think?"
- Name the people, companies and products plainly, in the words people would search for.
- Every fact comes from the slides or the BRIEF. Nothing new: no dates, numbers, names, mechanisms or descriptors of your own. When the slides left a BRIEF fact out, leave it out unless the caption can't make sense without it.
- Keep a hedge ("says," "reportedly," "up to") wherever dropping it would change what a reader believes. At most one attribution clause naming who reported the story, in the whole caption. Describe people, organizations and products only with words the slides or the BRIEF use.
- Gloss a term a reader who doesn't follow AI wouldn't know, from the BRIEF's TERMS only.
- Background: at most one clause about an earlier event, sourced from the slides or the BRIEF, and only when the hook needs it to land. No background paragraph.
- Third person, no opinion and no "we." The so-what line is the news part's one casual aside; opinion and "we" live in read. No paragraph about who reported what or whose figures they are.
- Put the IDs of every BRIEF entry the news rests on (F3, B1, Q2, N1) in news.facts.

read: the Helios line, one or two plain sentences that close the caption.
- One concrete point about this story for the industry it names: what it changes for someone running marketing, sales or ops there, what they can now do, should stop doing, or should watch. Name the industry from the Helios context that best matches this story, any of them, and not one the recent closings used, with the specific work the story changes there. Fall back to marketing or sales work in general only when none fits.
- Helios is the subject doing something specific it builds for that work: "Helios builds ..." or "At Helios we ..." with a concrete action, kept inside what Helios builds. Never a generic tag such as "the kind of thing we think about at Helios" or "that's how we think about it at Helios".
- This is where you have a view. Interpret, weigh, make a call, the way someone who builds these systems talks about them, never like a product line. "We" is allowed here.
- The read adds no facts. A story fact it leans on is already on the slides or in the BRIEF, and its ID goes in read.facts. Anything about Helios comes only from the Helios context.
- Name Helios once, here, in words that fit this story. Never a pitch.
- It never asks a second question, and it ends on the point. A follow invite is rare: at most a short clause, never the default, and never "we post more takes like this."

Emoji: the voice list bans them on the slides. The caption may use at most two emoji, and none is required. Usually one comes before the hook, at the start of the first line of news, and one right after the closing question. Never in read.

The user message gives you include_build_line and how recent captions ended. Follow include_build_line, and make this ending sound nothing like those.`;

export const CAPTIONER_CLOSING = `No hashtags.

Image credits and the Source line are added automatically after your caption. Don't write them.

When you're done, call submit_caption with news and read.`;

export const CAPTIONER_SYSTEM = [
  CAPTIONER_INTRO,
  HELIOS_CONTEXT,
  CAPTION_SHARED_RULES,
  CAPTIONER_CAROUSEL_RULES,
  `## Voice\n\n${VOICE_BLOCK}`,
  renderRulesFor('captioner'),
  CAPTIONER_CLOSING,
].join('\n\n');

const facts = { type: 'array', items: { type: 'string' }, description: 'IDs of the BRIEF entries this part rests on (F3, B1, Q2, N1). Empty if none.' };
const part = (description: string) => ({
  type: 'object',
  properties: { text: { type: 'string', description }, facts },
  required: ['text', 'facts'],
  additionalProperties: false,
});

export const SUBMIT_CAPTION_TOOL = {
  name: 'submit_caption',
  description: 'Submit the finished caption in its two parts. Call it once, as your final step.',
  input_schema: {
    type: 'object',
    properties: {
      news: part('Everything before the Helios line: the hook, 2 or 3 short paragraphs separated by a blank line, a so-what line, and a closing question; with read, about 500 to 900 characters. Third person, every fact from the slides or the BRIEF.'),
      read: part('The Helios line that closes the caption: one or two sentences making one concrete point about this story for a named industry, with Helios doing something specific it builds; names Helios once.'),
    },
    required: ['news', 'read'],
    additionalProperties: false,
  },
} as unknown as Anthropic.Tool;

const tags = (ids: string[]) => (ids.length ? ` [${ids.join(', ')}]` : '');

/** The final slides as the reader sees them, with the claim tags each line carries. */
function slidesBlock(filled: FilledDraft): string {
  const cover = filled.cover_options[filled.chosen_cover - 1]!;
  const lines = [`Slide 1 (cover)\n${filled.cover}${tags(cover.facts)}`];
  filled.slides.forEach((s, i) => {
    const out = [`Slide ${i + 2} (${s.type})`, `Headline: ${s.headline.text}${tags(s.headline.facts)}`];
    if (s.body) out.push(`Body: ${s.body.text}${tags(s.body.facts)}`);
    if (s.quote) out.push(`Quote (${s.quote.id}, ${s.quote.speaker}): "${s.quote.text}"`);
    for (const n of s.numbers) out.push(`Number (${n.id}): ${n.value}, ${n.counts}`);
    lines.push(out.join('\n'));
  });
  return `SLIDES (final, in order)\n\n${lines.join('\n\n')}`;
}

/** The user message: the final slides, the BRIEF (as the Writer gets it), the recent closings, then include_build_line. */
export function captionerUserMessage(filled: FilledDraft, brief: Brief, recent: RecentClosing[], includeBuildLine: boolean): string {
  return [slidesBlock(filled), writerUserMessage(brief), recentClosingsBlock(recent), buildLineInstruction(includeBuildLine)].filter(Boolean).join('\n\n');
}
