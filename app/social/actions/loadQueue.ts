'use server';

import { dbQuery } from '@/lib/db';
import { requireSocialSession } from '@/lib/social/session';
import type { Article } from '@/lib/social/types';

/**
 * Reads the team-wide article queue. Everyone in the org sees everyone's adds.
 * Joins to `outreach.users` for the attribution name shown on each card.
 */
export async function loadQueue(): Promise<Article[]> {
  await requireSocialSession();

  const { rows } = await dbQuery<{
    id: string;
    source: string;
    source_url: string;
    headline: string;
    body: string;
    added_by: string;
    added_by_name: string | null;
    added_at: Date;
    drafted_post_id: string | null;
  }>(
    `SELECT aq.id, aq.source, aq.source_url, aq.headline, aq.body,
            aq.added_by, u.display_name AS added_by_name,
            aq.added_at, aq.drafted_post_id
       FROM helios_social.article_queue aq
       LEFT JOIN outreach.users u ON u.id = aq.added_by
      ORDER BY aq.added_at DESC`,
  );

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    sourceUrl: r.source_url,
    headline: r.headline,
    body: r.body,
    addedBy: r.added_by,
    addedByName: r.added_by_name,
    addedAt: r.added_at instanceof Date ? r.added_at.toISOString() : String(r.added_at),
    draftedPostId: r.drafted_post_id,
  }));
}
