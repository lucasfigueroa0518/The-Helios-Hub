/**
 * The `writer` stage for runDay: one brief → one draft (spec §3, §4).
 * Model and effort come from STAGE_MODELS.
 */
import { runWriter, type WriterDeps } from '@/lib/social/writer/writer';

import type { PipelineStages } from './stages';

export function createWriterStage(deps: WriterDeps): PipelineStages['write'] {
  return async (brief) => {
    const r = await runWriter(brief.parsed, deps);
    if (!r.ok) return { ok: false, reasonCode: r.reason, detail: r.detail, costUsd: r.costUsd };
    return { ok: true, value: { storyId: brief.storyId, submission: r.draft, filled: r.filled }, costUsd: r.costUsd };
  };
}
