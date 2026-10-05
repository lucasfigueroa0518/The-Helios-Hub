/**
 * The `fact-checker` stage for runDay (spec §4.2, §4.2b): Claude flags,
 * code applies the fixes. A post that free fixes would damage asks for a
 * fresh draft (the orchestrator reruns Writer → Editor → Fact-checker);
 * a false main claim sets the story aside.
 */
import { runFactCheck, type FactCheckDeps } from '@/lib/social/factcheck/factcheck';
import { fillDraft } from '@/lib/social/writer/draft';

import type { PipelineStages } from './stages';

export function createFactCheckStage(deps: FactCheckDeps & { onResult?: (storyId: string, r: Awaited<ReturnType<typeof runFactCheck>>) => void }): PipelineStages['factCheck'] {
  return async (draft, brief) => {
    const r = await runFactCheck(brief.parsed, draft, deps);
    deps.onResult?.(draft.storyId, r);
    if (!r.ok) return { ok: false, reasonCode: r.reason, detail: r.detail, costUsd: r.costUsd };
    const o = r.outcome;
    if (o.kind === 'set-aside') return { ok: false, reasonCode: 'main-claim-false', detail: o.why, costUsd: r.costUsd };
    if (o.kind === 'fresh-draft') return { ok: false, reasonCode: 'needs-fresh-draft', detail: o.why, costUsd: r.costUsd };
    return { ok: true, value: { storyId: draft.storyId, submission: o.draft, filled: fillDraft(o.draft, brief.parsed) }, costUsd: r.costUsd };
  };
}
