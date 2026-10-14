/**
 * Where Last Few Days candidates come from (spec §3.2). Read-only: reels.*,
 * social.runs and the news feeds. Never writes another type's tables.
 */
import type { FetchedArticle } from '@/lib/social/ingest/fetch-feeds';
import { applyCodeFilters } from '@/lib/social/ingest/select/code-filters';
import type { HubQuery } from '@/lib/social-hub/db';
import { storyKey } from '@/lib/stories/sources/reels';

import type { LfdCandidate, LfdWindow } from './types';

type ReelsRow = {
  post_idea_id: string;
  first_timely: string;
  net: number | null;
  blockbuster: number;
  headline: string;
  source_name: string;
  canonical_url: string;
  body: string;
  publish_time: string | null;
};

/**
 * Eligible: the idea's FIRST timely slate falls in the window. Score: its best
 * net across every slate through the window's end, carryover included.
 */
export const REELS_LANE_SQL = `
WITH firsts AS (
  SELECT s.post_idea_id, min(sl.ny_date) AS first_timely
    FROM reels.idea_scores s
    JOIN reels.score_slates sl ON sl.id = s.slate_id
   WHERE s.origin = 'timely' AND sl.ny_date <= $2::date
   GROUP BY s.post_idea_id
), best AS (
  SELECT s.post_idea_id, max(s.net) AS net, max(s.blockbuster) AS blockbuster
    FROM reels.idea_scores s
    JOIN reels.score_slates sl ON sl.id = s.slate_id
   WHERE sl.ny_date <= $2::date
   GROUP BY s.post_idea_id
)
SELECT f.post_idea_id, f.first_timely::text AS first_timely, b.net, b.blockbuster,
       src.headline, src.source_name, src.canonical_url, src.body, src.publish_time::text AS publish_time
  FROM firsts f
  JOIN best b ON b.post_idea_id = f.post_idea_id
  JOIN reels.post_idea_members m ON m.post_idea_id = f.post_idea_id AND m.role = 'primary'
  JOIN reels.sources src ON src.id = m.source_id
 WHERE f.first_timely > $1::date AND f.first_timely <= $2::date
 ORDER BY b.blockbuster DESC, b.net DESC NULLS LAST`;

export async function reelsLane(q: HubQuery, w: LfdWindow): Promise<LfdCandidate[]> {
  const { rows } = await q<ReelsRow>(REELS_LANE_SQL, [w.after, w.through]);
  return rows.map((r) => ({
    key: storyKey(r.canonical_url),
    refs: [r.post_idea_id],
    origin: 'reels' as const,
    headline: r.headline,
    sourceName: r.source_name,
    url: r.canonical_url,
    body: r.body,
    publishedAt: r.publish_time,
    net: r.net,
    blockbuster: Number(r.blockbuster) || 0,
    firstSeen: r.first_timely,
    alsoFrom: [],
    major: null,
  }));
}

export const CAROUSEL_TOP = 10;
export const FEED_TOP = 20;

type ShortlistEntry = {
  id: string;
  outlets?: string[];
  publishedAt?: string;
  body?: string;
  representative?: { sourceUrl?: string; headline?: string; source?: string; body?: string; publishedAt?: string };
};

/** Carousel shortlists (spec §3.2 lane 1): runs finished since the window start, top 10 each, newest run first. */
export async function carouselLane(q: HubQuery, sinceIso: string): Promise<LfdCandidate[]> {
  const { rows } = await q<{ shortlist: ShortlistEntry[] | null }>(
    `SELECT record->'selection'->'shortlist' AS shortlist FROM social.runs
      WHERE kind = 'daily' AND trigger <> 'cli' AND status IN ('ok', 'partial') AND finished_at > $1::timestamptz
        AND jsonb_typeof(record->'selection'->'shortlist') = 'array'
      ORDER BY finished_at DESC`,
    [sinceIso],
  );
  const out: LfdCandidate[] = [];
  for (const row of rows) {
    for (const g of (row.shortlist ?? []).slice(0, CAROUSEL_TOP)) {
      const rep = g.representative ?? {};
      const url = rep.sourceUrl ?? g.id;
      const outlets = g.outlets ?? (rep.source ? [rep.source] : []);
      out.push({
        key: storyKey(url),
        refs: [g.id],
        origin: 'carousel',
        headline: rep.headline ?? '',
        sourceName: outlets[0] ?? rep.source ?? '',
        url,
        body: g.body ?? rep.body ?? '',
        publishedAt: g.publishedAt ?? rep.publishedAt ?? null,
        net: null,
        blockbuster: 0,
        firstSeen: null,
        alsoFrom: outlets.slice(1),
        major: null,
      });
    }
  }
  return out.filter((c) => c.headline);
}

export async function lastCarouselRunAt(q: HubQuery): Promise<string | null> {
  const { rows } = await q<{ at: string | null }>(
    `SELECT max(finished_at)::text AS at FROM social.runs WHERE kind = 'daily' AND trigger <> 'cli' AND status IN ('ok', 'partial')`,
  );
  return rows[0]?.at ?? null;
}

/** The fresh feed never reaches back further than this, however long ago the last carousel run was. */
export const FEED_FLOOR_HOURS = 48;

/**
 * Fresh feed pass (spec §3.2): the carousel feeds since the last carousel run
 * (at most 48 hours back), code filters only (no story-scoring, no writing),
 * newest first.
 */
export async function freshFeedLane(fetch: () => Promise<FetchedArticle[]>, since: Date, now: Date, limit = FEED_TOP): Promise<LfdCandidate[]> {
  const floor = Math.max(since.getTime(), now.getTime() - FEED_FLOOR_HOURS * 3600_000);
  const { kept } = applyCodeFilters(await fetch());
  return kept
    .filter((a) => a.publishedAt.getTime() > floor)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, limit)
    .map((a) => ({
      key: storyKey(a.sourceUrl),
      refs: [a.sourceUrl],
      origin: 'feed' as const,
      headline: a.headline,
      sourceName: a.source,
      url: a.sourceUrl,
      body: a.body,
      publishedAt: a.publishedAt.toISOString(),
      net: null,
      blockbuster: 0,
      firstSeen: null,
      alsoFrom: [],
      major: null,
    }));
}
