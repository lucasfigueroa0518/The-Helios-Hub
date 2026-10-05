/**
 * The `editor` stage for runDay (spec §4.1): returns the same draft shape.
 */
import { runEditor, type EditorDeps } from '@/lib/social/editor/editor';

import type { PipelineStages } from './stages';

export function createEditorStage(deps: EditorDeps): PipelineStages['edit'] {
  return async (draft, brief) => {
    const r = await runEditor(brief.parsed, draft.submission, deps);
    if (!r.ok) return { ok: false, reasonCode: r.reason, detail: r.detail, costUsd: r.costUsd };
    return { ok: true, value: { storyId: draft.storyId, submission: r.draft, filled: r.filled }, costUsd: r.costUsd };
  };
}
