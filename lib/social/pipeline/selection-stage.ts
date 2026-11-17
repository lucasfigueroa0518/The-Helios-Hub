/**
 * The `jev-scoring` stage: wraps story selection (spec §5B) for runDay.
 * All Jev cost (grouping, scoring, different-story) is charged here.
 */
import type { FeedConfig } from '@/lib/social/feeds';
import { createJevTally, type JevAsk } from '@/lib/social/jev/client';
import type { FetchBody } from '@/lib/social/ingest/select/enrich';
import type { FeedHealthLog } from '@/lib/social/ingest/select/feed-health';
import type { PostedStories } from '@/lib/social/ingest/select/posted';
import { startingSources } from '@/lib/social/ingest/select/enrich';
import { selectStories, type Selection } from '@/lib/social/ingest/select/select';
import type { IngestArticle, ScoredGroup } from '@/lib/social/ingest/select/types';
import type { IntakeQuery, IntakeRunRecord, PostedCheck } from '@/lib/intake/types';
import type { ListOrderStories } from '@/lib/social/ingest/select/intake';

import type { PipelineStages } from './stages';
import type { ScoredCandidate } from './types';

export type SelectionStageDeps = {
  feeds: FeedConfig[];
  jev: JevAsk;
  posted: PostedStories;
  fetchBody: FetchBody;
  feedHealthLog: FeedHealthLog;
  /** Receives the full selection (skips, raw answers) for logging; thresholds are calibrated from live run reports (§2.3). */
  onSelection?: (selection: Selection) => void;
  /**
   * Intake mode (Central Intake Phase 2, `readConsumerMode(q, 'carousel', now) === 'intake'`): selection reads the
   * intake's scored stories instead of `articles` (lib/social/ingest/select/intake.ts). Absent: today's path, unchanged.
   */
  intake?: IntakeSelectionDeps;
};

export type IntakeSelectionDeps = {
  query: IntakeQuery;
  listOrderStories: ListOrderStories;
  /** The hub adapters the carousel reads (id → name), for their feed health rows. */
  adapterNames?: ReadonlyMap<string, string>;
  postedCheck?: PostedCheck;
  readRunRecord?: (q: IntakeQuery) => Promise<IntakeRunRecord | null>;
  /** Today's fetch (feeds + hub adapters), run only when the intake read throws; selection then takes today's path. */
  fallback: () => Promise<{ articles: IngestArticle[]; feeds: FeedConfig[] }>;
  onFallback?: (error: unknown) => void;
};

export function toCandidate(group: ScoredGroup, score: number): ScoredCandidate {
  return {
    id: group.id,
    title: group.representative.headline,
    url: group.representative.sourceUrl,
    members: group.members,
    sources: startingSources(group),
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
      selection = deps.intake
        ? await selectFromIntake(deps, deps.intake, now, tally)
        : await selectStories({
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

/** Intake mode: the intake's stories; when reading them throws, today's fetch and selection instead. */
async function selectFromIntake(deps: SelectionStageDeps, intake: IntakeSelectionDeps, now: Date, tally: ReturnType<typeof createJevTally>): Promise<Selection> {
  // Loaded only in intake mode: it pulls in the intake scorecards, which the legacy path and the web app don't need.
  const lib = await import('@/lib/social/ingest/select/intake');
  let pool: Awaited<ReturnType<typeof lib.readIntakePool>>;
  try {
    pool = await lib.readIntakePool(intake, now);
  } catch (error) {
    intake.onFallback?.(error);
    const legacy = await intake.fallback();
    return selectStories({ feeds: legacy.feeds, articles: legacy.articles, now, jev: deps.jev, posted: deps.posted, fetchBody: deps.fetchBody, tally });
  }
  return lib.selectIntakeStories({
    ...pool,
    feeds: deps.feeds,
    ...(intake.adapterNames ? { adapterNames: intake.adapterNames } : {}),
    ...(intake.postedCheck ? { postedCheck: intake.postedCheck } : {}),
    now,
    jev: deps.jev,
    posted: deps.posted,
    fetchBody: deps.fetchBody,
    tally,
  });
}
