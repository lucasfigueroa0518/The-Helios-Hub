/**
 * The `reporter` stage for runDay: one picked story → the Reporter's
 * parsed brief (spec §3, §4). Model and effort come from STAGE_MODELS.
 */
import { runReporter, type ReporterDeps } from '@/lib/social/reporter/reporter';

import { DAY_TIME_ZONE } from './set-aside-log';
import type { PipelineStages } from './stages';

/** "October 4, 2026" in the pipeline's day time zone. */
export function readableDate(now: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: DAY_TIME_ZONE, month: 'long', day: 'numeric', year: 'numeric' }).format(now);
}

export function createReporterStage(deps: ReporterDeps & { now: () => Date }): PipelineStages['report'] {
  return async (story) => {
    const result = await runReporter(
      { story: story.title, startingSources: story.members.map((m) => m.url), today: readableDate(deps.now()) },
      deps,
    );
    if (!result.ok) return { ok: false, reasonCode: result.reason, detail: result.detail, costUsd: result.costUsd };
    return { ok: true, value: { storyId: story.id, parsed: result.brief, raw: result.raw, pages: result.pages }, costUsd: result.costUsd };
  };
}
