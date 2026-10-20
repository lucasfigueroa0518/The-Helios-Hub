/**
 * The `mechanical` stage for runDay (spec §6; plan M7), after the
 * Fact-checker and before design, so the render shows the fixed text:
 *
 *   silent fixes F1–F5 (logged) → text checks C1–C4, C8
 *   C1 over a limit → set aside (over-limit)
 *   C2 quotation marks around non-QUOTES text → set aside (malformed-output)
 *   C3 voice list, C4 hashtags, C8 repetition → warnings for the
 *     review screen; the post goes on
 *
 * The Writer and the Editor already had one retry on all five (their code
 * check), so a hard failure here means the Fact-checker's swaps or cuts
 * broke a rule. No cost: plain code.
 *
 * The captioner's two parts (social-captions redesign, 2026-10-19) are
 * joined first: news, a blank line, the builder's read. The silent fixes
 * then run on the joined caption and add the Source line after the read,
 * and `caption_read` is cleared, so the render and social.posts.caption see
 * one caption as before. This must run after the captioner and the
 * Fact-checker: on a caption still empty, the Source line would stand alone.
 */
import { joinCaption } from '@/lib/social/captioner/captioner';
import { applySilentFixes, HARD_CHECKS, textChecks, type Fix } from '@/lib/social/mechanical/checks';
import type { Brief as ParsedBrief } from '@/lib/social/reporter/brief';
import type { FilledDraft } from '@/lib/social/writer/draft';

import type { PipelineStages } from './stages';

/** The caption as posted (before the Source line): the news, then the builder's read; `caption_read` folded in. */
export function withJoinedCaption(d: FilledDraft): FilledDraft {
  const { caption_read: read, ...rest } = d;
  if (!read) return d;
  return { ...rest, caption: { text: joinCaption({ news: d.caption, read }), facts: [...new Set([...d.caption.facts, ...read.facts])] } };
}

/**
 * The caption join and the silent fixes, exactly as the stage applies them.
 * Scripts that render a stored draft use this so they show the posted caption.
 */
export function joinAndFix(filled: FilledDraft, brief: ParsedBrief): { draft: FilledDraft; fixes: Fix[] } {
  return applySilentFixes(withJoinedCaption(filled), brief);
}

export function createMechanicalStage(): PipelineStages['mechanical'] {
  return async (draft, brief) => {
    const { draft: filled, fixes } = joinAndFix(draft.filled, brief.parsed);
    const failures = textChecks(filled, brief.parsed);
    const hard = failures.filter((f) => HARD_CHECKS.has(f.id));
    if (hard.length > 0) {
      return {
        ok: false,
        reasonCode: hard.some((f) => f.id === 'C1') ? 'over-limit' : 'malformed-output',
        detail: hard.map((f) => `${f.id} ${f.where}: ${f.detail}`).join('; '),
        costUsd: 0,
      };
    }
    return { ok: true, value: { ...draft, filled, mechanical: { fixes, warnings: failures } }, costUsd: 0 };
  };
}
