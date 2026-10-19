/**
 * The `captioner` stage for runDay (social-captions redesign, 2026-10-19),
 * after the Editor and before the Fact-checker:
 *
 *   recent closings → Jev build fit (only when the ceiling allows) →
 *   include_build_line → captioner → caption + caption_read on the draft →
 *   closing recorded
 *
 * A failed Jev call or closings read never fails the caption: no Jev answer
 * means no build line, an unreadable log reads as empty. The two parts stay
 * separate until the mechanical stage joins them, so the Fact-checker can
 * judge the read on its own rules.
 */
import { BUILD_FIT, buildFitState, ceilingAllows, decideBuildLine, type RecentClosing } from '@/lib/social/captions/build-line';
import type { ClosingsLog } from '@/lib/social/captions/closings-store';
import { runCaptioner, type CaptionParts } from '@/lib/social/captioner/captioner';
import { jevCostUsd, type JevAsk } from '@/lib/social/jev/client';
import type { StageModelConfig } from '@/lib/social/pipeline/models';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import { fillDraft } from '@/lib/social/writer/draft';
import type { StructuredResult } from '@/lib/social/writer/structured-call';

import type { PipelineStages } from './stages';

/** What one captioner run decided and returned, for the run report. */
export type CaptionerRun = StructuredResult<CaptionParts> & { fit: number | null; includeBuildLine: boolean; jevError?: string };

export type CaptionerStageDeps = {
  create: MessagesCreate;
  jev: JevAsk;
  closings: ClosingsLog;
  config?: StageModelConfig;
  onResult?: (storyId: string, r: CaptionerRun) => void;
};

export function createCaptionerStage(deps: CaptionerStageDeps): PipelineStages['caption'] {
  return async (draft, brief) => {
    let recent: RecentClosing[] = [];
    try {
      recent = await deps.closings.recent();
    } catch (err) {
      console.warn(`[captions] could not read carousel closings for ${draft.storyId}; treating the log as empty:`, err);
    }

    let fit: number | null = null;
    let jevUsd = 0;
    let jevError: string | undefined;
    if (ceilingAllows(recent)) {
      const p = brief.parsed;
      const text = [p.the_news.text, ...p.facts.map((f) => f.text)].join('\n');
      try {
        const res = await deps.jev(
          { state: buildFitState({ headline: draft.filled.cover, text }), questions: BUILD_FIT.questions },
          { version: BUILD_FIT.version, subjectId: draft.storyId },
        );
        jevUsd = jevCostUsd(res.usage);
        fit = res.answers.builds?.noul ?? null;
      } catch (err) {
        jevError = err instanceof Error ? err.message : String(err);
      }
    }
    const include = decideBuildLine(fit, recent);

    const r = await runCaptioner(brief.parsed, draft, recent, include, { create: deps.create, config: deps.config });
    deps.onResult?.(draft.storyId, { ...r, fit, includeBuildLine: include, ...(jevError ? { jevError } : {}) });
    const costUsd = r.costUsd + jevUsd;
    if (!r.ok) return { ok: false, reasonCode: r.reason, detail: r.detail, costUsd };

    const submission = { ...draft.submission, caption: r.value.news, caption_read: r.value.read };
    try {
      await deps.closings.record(draft.storyId, r.value.read.text, include);
    } catch (err) {
      console.warn(`[captions] could not record the carousel closing for ${draft.storyId}:`, err);
    }
    return { ok: true, value: { storyId: draft.storyId, submission, filled: fillDraft(submission, brief.parsed) }, costUsd };
  };
}
