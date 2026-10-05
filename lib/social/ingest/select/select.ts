/**
 * Daily story selection (spec §5B):
 *
 *   freshness window → code filters → group duplicates (Jev same-event)
 *   → thin-body fetch → Jev scoring (1 call per candidate) → rank
 *   → shortlist ≤ 10 → 2 winners (different stories) → backups in order
 *
 * If fewer than 2 qualify, the window widens to 48h and everything after
 * the window is redone once.
 */
import { mapPool } from '@/lib/async-pool';
import { createJevTally, tallied, type JevAsk, type JevTally } from '@/lib/social/jev/client';
import type { FeedConfig } from '@/lib/social/feeds';

import { applyCodeFilters } from './code-filters';
import type { FetchBody } from './enrich';
import { enrichThinBodies, topUpReadSources } from './enrich';
import { buildFeedHealth, type FeedHealthEntry } from './feed-health';
import { groupArticles } from './group';
import type { PostedStories } from './posted';
import { pickWinners, rankQualified, WINNERS } from './rank';
import { scoreGroups } from './score';
import type { IngestArticle, ScoredGroup, SkipEntry } from './types';
import { inWindow, windowHours } from './window';

export type SelectInput = {
  feeds: FeedConfig[];
  articles: IngestArticle[];
  now: Date;
  jev: JevAsk;
  posted: PostedStories;
  fetchBody: FetchBody;
  /** Pass one in to read the cost even if selection throws part-way. */
  tally?: JevTally;
};

export type Selection = {
  windowHours: number;
  widened: boolean;
  feedHealth: FeedHealthEntry[];
  scored: ScoredGroup[];
  skipped: SkipEntry[];
  shortlist: ScoredGroup[];
  winners: ScoredGroup[];
  backups: ScoredGroup[];
  sameTopicAsFirst: string[];
  jevCalls: number;
  jevInputTokens: number;
  costUsd: number;
};

export async function selectStories(input: SelectInput): Promise<Selection> {
  const tally = input.tally ?? createJevTally();
  const jev = tallied(input.jev, tally);
  const postedHeadlines = await input.posted.recentHeadlines(input.now);

  async function run(widened: boolean) {
    const hours = windowHours(input.now, widened);
    const fresh = input.articles.filter((a) => inWindow(a, input.now, hours));
    const { kept, skipped } = applyCodeFilters(fresh);
    const groups = await enrichThinBodies(await groupArticles(kept, jev), input.fetchBody);
    const scored = await scoreGroups(groups, jev, postedHeadlines);
    for (const g of scored) {
      if (g.status !== 'qualified') skipped.push({ id: g.id, reason: `${g.status}: ${g.reason}`, stage: 'scoring' });
    }
    return { hours, scored, skipped, ranked: rankQualified(scored) };
  }

  let widened = false;
  let pass = await run(false);
  if (pass.ranked.length < WINNERS && pass.hours < windowHours(input.now, true)) {
    widened = true;
    pass = await run(true);
  }

  const picks = await pickWinners(pass.ranked, jev);
  // Shortlist only: read more members so the Reporter gets up to 4 starting sources.
  const topped = new Map(
    (await mapPool(picks.shortlist, 4, (g) => topUpReadSources(g, input.fetchBody))).map((g) => [g.id, g as ScoredGroup]),
  );
  const top = (g: ScoredGroup) => topped.get(g.id) ?? g;
  picks.shortlist = picks.shortlist.map(top);
  picks.winners = picks.winners.map(top);
  picks.backups = picks.backups.map(top);
  return {
    windowHours: pass.hours,
    widened,
    feedHealth: buildFeedHealth(input.feeds, input.articles, input.now, pass.hours),
    scored: pass.scored,
    skipped: pass.skipped,
    ...picks,
    jevCalls: tally.calls,
    jevInputTokens: tally.inputTokens,
    costUsd: tally.costUsd,
  };
}
