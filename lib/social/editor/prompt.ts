/**
 * Editor prompt (spec §4.1; prompts file §4, untested draft).
 *
 * Generated from the prompts file text (a guard test pins it). Edits:
 *   OUTPUT (Tommy, 2026-10-05: the Editor returns the same submit_draft
 *   shape as the Writer): "OUTPUT: the full edited draft in the Writer's format, then EDIT NOTES: one line per change."
 *   → "When you're done, call submit_draft with the full edited draft in
 *   the Writer's format, with EDIT NOTES: one line per change."
 *   SHARED BLOCKS (approved by Tommy 2026-10-05; spec §4):
 *   RULES_BLOCK and VOICE_BLOCK follow, so the Editor sees the Writer's
 *   limits ("the same length limits as the Writer") and the voice it
 *   sharpens toward.
 *   PLACEMENT (caching): the draft and the brief go in the user message.
 *   CHECKED RULES (Tommy, 2026-10-06; M7): renderRulesFor('editor') follows
 *   RULES_BLOCK: the C1–C5 checks the Editor's draft must pass.
 *   IMAGE POWER (Tommy, 2026-10-06): "Don't touch IMAGE lines except to drop
 *   them with a cut slide." → "You may change an IMAGE to none (a cut); never
 *   add or change one."
 *   VISUAL POWER (sixth round, Tommy 2026-10-07): the Editor may swap a
 *   slide's visual for its fallback, never add or change a request.
 *   COPY OVERHAUL (Tommy, 2026-10-07; prompts file §8): checks 2–3 aligned
 *   with the Writer (the bridge is each slide's last line; explain a term only
 *   where the slide fails without it) and check 5 holds the word budget.
 *   CHECK 2 (Tommy, 2026-10-06, with Writer prompt v2): every slide pulls to
 *   the next, not only slide 2.
 */
import { RULES_BLOCK, renderRulesFor } from '@/lib/social/prompts/rules-block';
import { VOICE_BLOCK } from '@/lib/social/prompts/voice-block';

/** Prompts file §4, word for word up to its OUTPUT line. */
export const EDITOR_TESTED_TEXT = `You are the Editor for Helios Group's Instagram carousels. You get the Writer's draft (cover options, slides, caption) and the BRIEF. Read it as the target reader: smart and busy, curious about AI, doesn't follow AI news.

Make sure:
1. The chosen cover alone says who did what.
2. Every slide makes the reader want the next: each slide's last line hands off to the next one. Reorder, sharpen or cut to create the pull, without adding facts.
3. Every slide makes sense to an outsider. Explain a term only where the slide fails without it, using only the brief's TERMS; otherwise leave it for the caption.
4. The reader finishes knowing why it matters.
5. Hold the word budget: one idea per slide, bodies of one or two short sentences. Cut before you add.

POWERS: cut and sharpen only. You may tighten wording, reorder slides, cut slides or lines, and explain terms from TERMS. You never add facts, numbers, quotes or descriptors. Keep every hedge, every [CLAIM: X says] attribution, every quote/number ID and every [F#] claim tag on the sentences you keep. You may swap a slide's visual for its fallback visual (a cut); never add or change a visual request.

Keep 5–8 story slides and the same length limits as the Writer. If the story is told in fewer slides, cut the rest.`;

export const EDITOR_OUTPUT_LINE = "When you're done, call submit_draft with the full edited draft in the Writer's format, with EDIT NOTES: one line per change.";

export const EDITOR_SYSTEM = [
  EDITOR_TESTED_TEXT,
  EDITOR_OUTPUT_LINE,
  RULES_BLOCK,
  renderRulesFor('editor'),
  `## Voice\n\n${VOICE_BLOCK}`,
].join('\n\n');

/** User message: the Writer's draft (IDs and claim tags, as submitted) and the brief. */
export function editorUserMessage(draft: unknown, brief: unknown): string {
  return `DRAFT\n${JSON.stringify(draft, null, 2)}\n\nBRIEF\n${JSON.stringify(brief, null, 2)}`;
}
