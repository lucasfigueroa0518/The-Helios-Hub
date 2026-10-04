/**
 * The `jev-scoring` stage: wraps story selection (spec §5B) for runDay.
 * All Jev cost (grouping, scoring, different-story) is charged here.
 */
import type { FeedConfig } from '@/lib/social/feeds';
import { createJevTally, type JevAsk } from '@/lib/social/jev/client';
import type { FetchBody } from '@/lib/social/ingest/select/enrich';
import type { FeedHealthLog } from '@/lib/social/ingest/select/feed-health';
import type { PostedStories } from '@/lib/social/ingest/select/posted';
import { selectStories, type Selection } from '@/lib/social/ingest/select/select';
import type { ScoredGroup } from '@/lib/social/ingest/select/types';

import type { PipelineStages } from './stages';
import type { ScoredCandidate } from './types';

export type SelectionStageDeps = {
  feeds: FeedConfig[];
  jev: JevAsk;
  posted: PostedStories;
  fetchBody: FetchBody;
  feedHealthLog: FeedHealthLog;
  /** Receives the full selection (skips, raw answers) for logging and S1 calibration. */
  onSelection?: (selection: Selection) => void;
};

export function toCandidate(group: ScoredGroup, score: number): ScoredCandidate {
  return {
    id: group.id,
    title: group.representative.headline,
    url: group.representative.sourceUrl,
    members: group.members,
    outlets: group.outlets,
    outletCount: group.outletCount,
    publishedAt: group.publishedAt,
    body: group.body,
    score,
  };
}

export function createSelectionStage(deps: SelectionStageDeps): PipelineStages['score'] {
  return async (articles, now) => {
    const tally = createJevTally();
    let selection: Selection;
    try {
      selection = await selectStories({
        feeds: deps.feeds,
        articles,
        now,
        jev: deps.jev,
        posted: deps.posted,
        fetchBody: deps.fetchBody,
        tally,
      });
    } catch (err) {
      return {
        ok: false,
        reasonCode: 'service-error',
        detail: `selection failed: ${err instanceof Error ? err.message : String(err)}`,
        costUsd: tally.costUsd,
      };
    }
    await deps.feedHealthLog.append(selection.feedHealth);
    deps.onSelection?.(selection);
    const ordered = [...selection.winners, ...selection.backups];
    return {
      ok: true,
      value: ordered.map((g, i) => toCandidate(g, ordered.length - i)),
      costUsd: selection.costUsd,
    };
  };
}
