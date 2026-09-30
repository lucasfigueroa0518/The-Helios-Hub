/**
 * Shared editorial rules block. One canonical source of truth for the
 * priority ladder, context policy, story-slide count, photo tiers, and
 * glossing rule. Imported by every stage prompt (Reporter, Writer,
 * Editor, Caption, Fact-checker) so the rules can't drift across
 * prompts. Referenced from docs/PROJECT-STATUS.md and
 * docs/DESIGN-V1-HANDOFF.md — the docs point here, they don't restate.
 *
 * Motivated by docs/RULE-CONFLICTS-2026-09-29.md.
 */

export const RULES_BLOCK = `## Priority ladder (use this to resolve any conflict)

1. **True.** Only what the sources say. TERMS explanations count as sourced.
2. **Every slide teaches something new.** Not a rewording of the cover; not the same beat as another slide.
3. **Clear to a reader who doesn't follow AI** but is smart and busy.
4. **Fits the layout's hard limits** — field lengths (see each prompt) and 8 story slides maximum.
5. **Design preferences** (photos, slide-kind variety, rhythm, white space) adapt to the content, never the other way round.

## Context policy

Stay on this one event. Earlier events, other companies or other people appear in TWO shapes:

1. **One sourced clause**, embedded in a slide that is otherwise about the main event (e.g. "the bill would make a voluntary process mandatory").
2. **Up to TWO background slides per post** on "why now" (an earlier event that triggered this news), "what stands in the way" (an earlier action by another party that constrains this one), or a relevant earlier event that a reader needs to grasp the significance of the main event. Each background slide must tell the reader something new and relevant (not restatement, not filler), must name the outside event, and must cite a source. Two is the ceiling — the post is still about the main event, not a history lesson.

Not allowed: repeating a competitor's prior announcement as coverage of this story; recycling the same subject's earlier statements as if they're new; more than two background slides; a market-context paragraph. The Fact-checker and Caption follow the same policy — a slide or caption clause that fits (1) or (2) is not a flag; anything beyond that is.

## Story slide count

5 to 8 story slides between the cover and the follow slide. Let the number of distinct facts the brief supports decide the length. Padding to reach the max is worse than shipping fewer slides. This is a hard limit — the total published carousel (cover + story + follow) must fit inside Instagram's 10-item carousel cap.

## Slide kinds (variety is a preference, not a quota)

- **Text (HEADLINE + BODY):** the default.
- **Landing (HEADLINE only, optional NOTE):** only when the headline itself states a new fact — a number in words, a named consequence, a specific decision. Never a label, a setup line, or a punchline without a fact. Never a restatement of the cover.
- **Stat (BIG NUMBER + NUMBER NOTE + HEADLINE):** when the answer to the reader question is a single number.
- **Split stat:** when two numbers only make sense side by side.
- **Quote (QUOTE + QUOTE BY):** only when a verbatim source quote adds something the slides don't already say and fits ≤ 140 chars.
- **Image slide:** when the point is a real photographable subject.

Kinds follow content. Don't pad a slide to justify a different kind. Don't lock a slide into a kind that no longer fits its content — if the Editor needs to change a kind so the substance survives, that is allowed, and the reason goes in EDIT NOTES. Slide-kind variety comes from real content differences and from design (images, layouts), not from padded landings or fake stats.

## Photos (two tiers)

**Real people, places, organizations.** Identity comes only from Wikidata P18 or a Commons P180 link to the exact entity — never from a model looking at a face. Wikimedia (public domain, CC0, CC BY, then CC BY-SA) or U.S. federal images only. A wrong-identity photo is worse than none.

**Concept slides** (no photographable named entity — abstract ideas, mechanisms, "what a kill switch is"). Illustrative images allowed. First try licensed stock (Unsplash / Pexels API, free license, photographer credit in the caption). If nothing fits, an AI-generated image may be used as a last resort, credited "Illustration: AI-generated" in the caption and flagged so the Instagram post applies Meta's AI-content label. Guardrails: no faces or identifiable people, no logos or brand marks, no baked-in text, nothing that could be read as documentary evidence of a real event.

**Placement.** Photos are placed by the image step, not requested by the Writer. The Writer never shortens copy to make room for an image. Photos go on text slides only where the rendered text leaves the bottom half free; on slides where the copy fills the safe area, the slide stays type-only and the image goes on a slide that has room.

## Glossing (advisory, not required)

A term needs a gloss only if the slide doesn't make sense without it. If a gloss would eat more than about a fifth of a slide's body, move the definition to the caption or a dedicated slide instead of shrinking the fact. Glosses always come from the TERMS list in the brief; never invent a definition. TERMS explanations count as sourced by the Fact-checker.`;

/**
 * Phrases that used to appear in one or more prompts and have been
 * replaced by the shared rules block. The consistency test
 * (tests/social-v2-rules-consistency.test.ts) fails if any of these
 * strings appear in any prompt, so a stale copy can't sneak back in.
 * Add to this list when a rule is retired; never remove from it.
 */
export const RETIRED_PHRASES: readonly string[] = Object.freeze([
  'main story only',
  'not even a passing clause',
  '5 to 10 story slides',
  'no stock photos',
  'No AI images',
  'never the same kind twice',
  'no stage may change a slide',
  'Cut a whole clause or sentence rather than rewording',
  // Fact-checker's old, absolutist context wording:
  'Never mention any other story',
  // Cover framework list items retired for click-baity teasing:
  'Provocative question',
  'Frame shift:',
  'Insider reveal',
]);
