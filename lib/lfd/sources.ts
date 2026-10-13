/**
 * Where Last Few Days candidates come from (spec §3.2). Read-only: reels.*,
 * social.runs and the news feeds. Never writes another type's tables.
 */
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
