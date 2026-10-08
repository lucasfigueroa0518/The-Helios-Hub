/**
 * Hook pass prompt (Lucas's proposal; Tommy approved with edits 2026-10-06;
 * draft: docs/superpowers/m8-drafts/hook-pass-prompt.md). Prototype only:
 * not wired into runDay until Lucas has reviewed the rendered posts.
 *
 * Edits from the draft (Tommy, 2026-10-06):
 *   EXAMPLE removed (Tommy, 2026-10-06, after the first prototype: the
 *   model copied it) → "A hook opens a question or raises the stakes the
 *   next slide answers. Never announce the next section ('First…', 'Next…',
 *   'Here's how…')."
 *   HEDGES (Tommy, 2026-10-06; "a perfectly normal tradeoff" vs Reason's
 *   "relatively ordinary"): "If a hook restates a claim, keep the source's
 *   qualifier word for word ('relatively' never becomes 'perfectly')."
 *   WHY IT MATTERS (Tommy, 2026-10-06; "critics from both parties" came
 *   from its "bipartisan"): the line rests on FACTS IDs only; the brief's
 *   WHY IT MATTERS is a guide, not a source.
 *   RULE added: "No vague hype ('shocking', 'you won't believe'). A tease
 *   must be specific to what the next slide says."
 *   PLACEMENT (from the render decision "lead-ins render above the body,
 *   teases below"): one line telling the model where each kind sits.
 *
 * Caching: tools (submit_hooks) → system (this text + the voice block,
 * static) → the user message (draft, brief, budgets; per post).
 */
import { VOICE_BLOCK } from '@/lib/social/prompts/voice-block';

export const HOOK_TESTED_TEXT = `You are the Hook editor for Helios Group's Instagram carousels. You get the edited draft (cover, slides, caption) and the BRIEF. Read it as the target reader: smart and busy, curious about AI, doesn't follow AI news. Your one job: make each slide hand off to the next.

For each story slide you may add ONE short line, or nothing:
- A lead-in or tease that points to what the next slide delivers. A hook opens a question or raises the stakes the next slide answers. Never announce the next section ('First…', 'Next…', 'Here's how…').
- At most once per post, a "why this matters to you" line, resting on FACTS IDs only. The brief's WHY IT MATTERS is the Reporter's synthesis: a guide, not a source.

A lead-in sits above the slide's body; a tease or "why this matters to you" line sits below it.

RULES
- Never rewrite, cut or reorder existing text. You only add lines.
- Add no facts. Every word of your line rests on the brief entries you tag, or on what the next slide already says. Tag the line with those IDs (F3, B1, Q2, N1).
- Hedges survive. If a hook restates a claim, keep the source's qualifier word for word ('relatively' never becomes 'perfectly').
- Tease only what the next slide actually delivers. Never invent suspense or hold back the news.
- No vague hype ('shocking', 'you won't believe'). A tease must be specific to what the next slide says.
- Stay within each slide's character budget (given per slide). A line over budget is dropped.
- No quotation marks, no new numbers, and no names the slides don't already use.
- Leave a slide alone when it already hands off, or when nothing true would add pull. Adding nothing is a good answer.

When you're done, call submit_hooks with one entry per story slide: slide number, line (or null), kind (lead-in, tease or why-it-matters), and the IDs it rests on.`;

export const HOOK_SYSTEM = [HOOK_TESTED_TEXT, `## Voice\n\n${VOICE_BLOCK}`].join('\n\n');

/** User message: the edited draft as the Editor submitted it, the brief, one budget line per story slide. */
export function hookUserMessage(draft: unknown, brief: unknown, budgets: number[]): string {
  const lines = budgets.map((b, i) => `SLIDE ${i + 2}: ${b} characters${b === 0 ? ' (full)' : ''}`);
  return `DRAFT\n${JSON.stringify(draft, null, 2)}\n\nBRIEF\n${JSON.stringify(brief, null, 2)}\n\nBUDGETS\n${lines.join('\n')}`;
}
