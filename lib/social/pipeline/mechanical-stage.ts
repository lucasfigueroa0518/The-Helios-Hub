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
 */
import { applySilentFixes, HARD_CHECKS, textChecks } from '@/lib/social/mechanical/checks';

import type { PipelineStages } from './stages';

export function createMechanicalStage(): PipelineStages['mechanical'] {
  return async (draft, brief) => {
    const { draft: filled, fixes } = applySilentFixes(draft.filled, brief.parsed);
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
