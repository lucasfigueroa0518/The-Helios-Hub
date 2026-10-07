/**
 * Shared editorial rules block (spec §4: the single source of shared rules).
 *
 * Built per Tommy's instruction (2026-10-04): the tested Writer rules
 * (prompts file §2, unchanged) + the old Context policy + the old Glossing
 * rule, with his review decisions applied
 * (docs/superpowers/specs/2026-10-04-helios-social-shared-blocks.md §3):
 *   (a) Context policy's background-slide count trimmed (the tested
 *       "Max 2 background slides." carries it); its definition kept;
 *   (b) "and Caption" → "and the caption";
 *   (c) em dashes swapped for periods.
 * Static string: embedding it keeps the cached prompt prefix stable.
 */

/** Tested Writer rules, word for word from the prompts file §2 (the shared rules use WRITER_RULES). */
export const TESTED_WRITER_RULES = `- Every fact from the brief. Describe people/roles only with the brief's words.
- Keep hedges. Claims marked [CLAIM: X says] must keep that attribution on the slide ("X says…").
- Quotation marks only for QUOTES entries, by ID or exact excerpt with "…" (max 140 chars on quote slides). Avoid ⚠ single-source quotes on quote slides unless nothing else works; never use a quote marked as cut off.
- Stat numbers by ID (N1…). Don't compute new numbers.
- Where sources disagree, don't pick a side silently: either show the disagreement or leave it out.
- COVER (≤90 chars): must say who did what on its own. If the main person isn't widely known, lead with role/country, not their name.
- Headlines may be punchy, but never false. Body states the precise version.
- 5–8 story slides. Stop when the story is told; never pad to 8. Headline ≤60, body ≤220 chars.
- Slide kinds: text, stat / split stat (by ID), quote, landing, image. Variety where material supports it.
- Max 2 background slides.
- EVERY slide has an IMAGE line: \`subject: <name>\`, \`article: <photo>\` (from ARTICLE PHOTOS), or \`stock: <plain 2–3 word scene>\`. Stat slides get a symbolic stock scene.
- Write 3 cover options; choose one.`;

/** The tested IMAGE line, replaced (Tommy, 2026-10-06): no symbolic stock scenes; then (handoff, same day) the default flips to a photo. */
export const TESTED_IMAGE_RULE = "- EVERY slide has an IMAGE line: `subject: <name>`, `article: <photo>` (from ARTICLE PHOTOS), or `stock: <plain 2–3 word scene>`. Stat slides get a symbolic stock scene.";
export const IMAGE_RULE = `- IMAGE on every story slide: request a photo unless nothing physical fits. In order: subject: <name> (a SUBJECTS entry the slide is about, with photo_available true; each subject at most once per post), article: <photo> (from ARTICLE PHOTOS), stock: <plain 2–3 word literal scene> that names a physical thing the slide itself mentions. Use none only when the slide is about an idea with nothing physical to show, and add one EDIT NOTES line per none saying why. An ARTICLE PHOTOS entry marked official_image_of is that company's own image: prefer it for a slide about that company. On a quote slide, IMAGE is the speaker (subject: <the quote's speaker>) or none. article: goes only on text, landing and image slides; stock: on those and on stat slides (a darkened background). Never change a slide's words to fit a photo; change the request. The chosen cover always has an IMAGE.`;

/** The Writer rules as used: the tested lines with the IMAGE line replaced. */
export const WRITER_RULES = TESTED_WRITER_RULES.replace(TESTED_IMAGE_RULE, IMAGE_RULE);

export const RULES_BLOCK = `## Rules

${WRITER_RULES}

## Context policy

Stay on this one event. Earlier events, other companies or other people appear in TWO shapes:

1. **One sourced clause**, embedded in a slide that is otherwise about the main event (e.g. "the bill would make a voluntary process mandatory").
2. **Background slides** on "why now" (an earlier event that triggered this news), "what stands in the way" (an earlier action by another party that constrains this one), or a relevant earlier event that a reader needs to grasp the significance of the main event. Each background slide must tell the reader something new and relevant (not restatement, not filler), must name the outside event, and must cite a source. The post is still about the main event, not a history lesson.

Not allowed: repeating a competitor's prior announcement as coverage of this story; recycling the same subject's earlier statements as if they're new; a market-context paragraph. The Fact-checker and the caption follow the same policy. A slide or caption clause that fits (1) or (2) is not a flag; anything beyond that is.

## Glossing (advisory, not required)

A term needs a gloss only if the slide doesn't make sense without it. If a gloss would eat more than about a fifth of a slide's body, move the definition to the caption or a dedicated slide instead of shrinking the fact. Glosses always come from the TERMS list in the brief; never invent a definition. TERMS explanations count as sourced by the Fact-checker.`;

export type RuleStage = 'reporter' | 'writer' | 'editor' | 'fact-checker';

/**
 * Rules the automated checks enforce, per stage (decision (f)), from the
 * M7 checks that actually run (lib/social/mechanical/checks.ts C1–C5;
 * approved by Tommy 2026-10-06). The Writer and the Editor are told them;
 * the other stages aren't checked on these, so they get nothing.
 */
export const CHECKED_RULES = `### Checked by code

Code checks the finished draft. A failure comes back to you once, with the exact problem:
- Length: cover ≤90 characters, headline ≤60, body ≤220, a quote on a quote slide ≤140, caption ≤2,200. Never over.
- Quotation marks only around words that are a QUOTES entry, word for word, or an exact excerpt of one.
- None of the voice list's banned words or phrases, no sentence opening with "Meanwhile," "Additionally," "Furthermore" or "That said," no exclamation marks, no emoji. Quoted speech is exempt.
- No hashtags in the caption.
- At most 2 background slides (slides resting only on BACKGROUND entries).`;

/** C8, the Editor's alone (Tommy, 2026-10-06): a repeat sends the draft back to it once. */
export const EDITOR_CHECKED_RULE = '- No repetition on a slide: the same number, or a phrase of four or more words, never appears in two of its headline, body, quote, big number and label.';

export function renderRulesFor(stage: RuleStage): string {
  if (stage === 'editor') return `${CHECKED_RULES}\n${EDITOR_CHECKED_RULE}`;
  return stage === 'writer' ? CHECKED_RULES : '';
}
