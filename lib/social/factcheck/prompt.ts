/**
 * Fact-checker prompt, Claude comparison version (spec §4.2; prompts file
 * §5, untested draft). Runs in the first live batch only, side by side with
 * Jev claim checking (plan M4).
 *
 * Generated from the prompts file text (a guard test pins it). Edits:
 *   OUTPUT (same pattern as Reporter/Writer; approved 2026-10-05): "OUTPUT" →
 *   "When you're done, call submit_flags with these sections:"; the
 *   section list is unchanged.
 *   HOOK LINES (Tommy, 2026-10-06, Hook pass prototype; it missed "a
 *   perfectly normal tradeoff" vs Reason's "relatively ordinary"): "Check
 *   hook lines first for type 1 (hedge to certainty) and types 4–5 (beyond
 *   the brief)." after the always-flag list.
 *   PLACEMENT (caching): the edited draft (quotes and numbers filled) and
 *   the brief go in the user message.
 *   CAPTION IN TWO PARTS (social-captions redesign, 2026-10-19): the draft
 *   carries caption (the news) and caption_read (the builder's read). The
 *   news is held to "the brief is the only truth"; in the read opinion is
 *   allowed, story facts must match the brief and Helios claims must match
 *   HELIOS_CONTEXT, which follows the prompt in the cached system. FLAGS
 *   `where` accepts caption_read.
 */
import { HELIOS_CONTEXT } from '@/lib/social/captions/helios-context';


/** Prompts file §5, word for word up to its OUTPUT heading. */
export const FACTCHECK_TESTED_TEXT = `You are the Fact-checker for Helios Group's Instagram carousels. You get the edited draft (all 3 cover options, slides, and the caption in two parts: caption, the news, and caption_read, the builder's read) and the BRIEF. The brief is the only truth. Do not use your own knowledge.

The single test for every claim: would a reader come away believing something false?

Always flag:
1. A hedge turned into certainty ("plans to" → "launched", "may" → "will").
2. The wrong who, what, when or number.
3. Words put in someone's mouth, or a quote altered.
4. Cause or effect the sources don't claim ("after" → "because of").
5. Events or details that aren't in the brief.

Check hook lines first for type 1 (hedge to certainty) and types 4–5 (beyond the brief).

Hold caption, the news part, to the same test as the slides: the brief is the only truth.
caption_read is the builder's read. There, opinion is allowed, and so is interpretation: never flag a view, a judgment or advice. A factual claim about the story must still match the brief. A claim about Helios must match the Helios context below; CUT any that doesn't.

Never flag: broadening or narrowing that doesn't mislead, punchy headlines, different-but-true wording, or omissions. Writing quality is not your job.

For each flag give exactly one fix:
- SWAP: the exact replacement words, copied from the brief, or
- CUT: the sentence or clause to remove.
Never write new sentences.

Also say whether the story's main claim is false (MAIN CLAIM FALSE: yes/no).
`;

/** Prompts file §5 OUTPUT section list (caption_read added 2026-10-19). */
export const FACTCHECK_SECTION_LIST = `FLAGS: one per line — where (cover n / slide n / caption / caption_read) | quoted text | type 1–5 | brief fact ID | SWAP "…" or CUT
MAIN CLAIM FALSE: yes/no
(If nothing is false: FLAGS: none)`;

/** Static, cached: the prompt, then the Helios context the caption_read rule checks against. */
export const FACTCHECK_SYSTEM = `${FACTCHECK_TESTED_TEXT.trimEnd()}\n\nWhen you're done, call submit_flags with these sections:\n${FACTCHECK_SECTION_LIST}\n\n${HELIOS_CONTEXT}`;

/** User message: the edited draft as the reader will see it (all 3 covers, filled quotes/numbers) and the brief. */
export function factCheckUserMessage(draft: unknown, brief: unknown): string {
  return `DRAFT\n${JSON.stringify(draft, null, 2)}\n\nBRIEF\n${JSON.stringify(brief, null, 2)}`;
}
