import { dbQuery } from '@/lib/db';
import { PUBLISHED_STORY_HOLD_DAYS } from '@/lib/reels/config';
import type { CopyTarget } from '@/lib/reels/copy/store';
import { canonicalizeUrl } from '@/lib/reels/net/http';
import { looksLikeTeaser } from '@/lib/reels/net/teaser';

/**
 * Ideas that never take a generation slot, checked fresh each night.
 *
 * D-247: a story already published cannot ship again. An idea is held out when
 * it is a published idea, or when any of its URLs (member pages and the pages
 * they cite) matches a URL of a reel published in the last
 * PUBLISHED_STORY_HOLD_DAYS. The Microsoft story shipped twice because the
 * second idea came from a different feed but cited the first one's page.
 *
 * D-245: an idea whose every member body is a teaser was pooled before teasers
 * were dropped at ingestion. It is held out rather than written from a teaser.
 */

export type PublishedStoryKeys = { ideaIds: Set<string>; urls: Set<string> };

export type HeldOutReason = 'already_published' | 'published_url' | 'teaser_only';

/**
 * A site root says nothing about which story a page is, so it never counts as
 * a match. Everything else compares in canonical form.
 */
export function storyUrlKey(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const canonical = canonicalizeUrl(trimmed);
    const parsed = new URL(canonical);
    if ((parsed.pathname === '/' || parsed.pathname === '') && !parsed.search) return null;
    return canonical;
  } catch {
    return null;
  }
}

function targetUrls(target: CopyTarget): string[] {
  return target.members.flatMap((member) => [member.url, ...member.citationUrls]);
}

/** Pure: why each target is held out. Targets not in the map can take a slot. */
export function holdOutReasons(
  targets: Iterable<CopyTarget>,
  published: PublishedStoryKeys,
): Map<string, HeldOutReason> {
  const held = new Map<string, HeldOutReason>();
  for (const target of targets) {
    if (published.ideaIds.has(target.postIdeaId)) {
      held.set(target.postIdeaId, 'already_published');
      continue;
    }
    const matches = targetUrls(target).some((url) => {
      const key = storyUrlKey(url);
      return key !== null && published.urls.has(key);
    });
    if (matches) {
      held.set(target.postIdeaId, 'published_url');
      continue;
    }
    if (target.members.length > 0 && target.members.every((member) => looksLikeTeaser(member.body))) {
      held.set(target.postIdeaId, 'teaser_only');
    }
  }
  return held;
}

/**
 * The ideas and URLs of reels published in the last `days`: each published
 * idea's member pages, the pages they cite, and the sources its copy named.
 */
export async function loadPublishedStoryKeys(days = PUBLISHED_STORY_HOLD_DAYS): Promise<PublishedStoryKeys> {
  const { rows } = await dbQuery<{ post_idea_id: string; url: string | null }>(
    `WITH published AS (
       SELECT DISTINCT post_idea_id FROM reels.posting_schedule
        WHERE status = 'published' AND publish_at > now() - ($1 || ' days')::interval
     )
     SELECT p.post_idea_id, u.url
       FROM published p
       LEFT JOIN LATERAL (
         SELECT src.canonical_url AS url
           FROM reels.post_idea_members m JOIN reels.sources src ON src.id = m.source_id
          WHERE m.post_idea_id = p.post_idea_id
         UNION
         SELECT unnest(src.citation_urls)
           FROM reels.post_idea_members m JOIN reels.sources src ON src.id = m.source_id
          WHERE m.post_idea_id = p.post_idea_id
         UNION
         SELECT source->>'url'
           FROM reels.idea_copy c CROSS JOIN LATERAL jsonb_array_elements(c.sources) AS source
          WHERE c.post_idea_id = p.post_idea_id AND c.status = 'ok'
       ) u ON true`,
    [String(days)],
  );
  const keys: PublishedStoryKeys = { ideaIds: new Set(), urls: new Set() };
  for (const row of rows) {
    keys.ideaIds.add(row.post_idea_id);
    const key = row.url ? storyUrlKey(row.url) : null;
    if (key) keys.urls.add(key);
  }
  return keys;
}

/** Headlines of reels published in the last `days`, for the web search's do-not-cover list (D-247). */
export async function recentPublishedHeadlines(days = PUBLISHED_STORY_HOLD_DAYS): Promise<string[]> {
  const { rows } = await dbQuery<{ headline: string }>(
    `SELECT DISTINCT ON (p.post_idea_id) src.headline
       FROM reels.posting_schedule p
       JOIN reels.post_idea_members m ON m.post_idea_id = p.post_idea_id
       JOIN reels.sources src ON src.id = m.source_id
      WHERE p.status = 'published' AND p.publish_at > now() - ($1 || ' days')::interval
      ORDER BY p.post_idea_id, CASE m.role WHEN 'primary' THEN 0 ELSE 1 END, m.joined_at`,
    [String(days)],
  );
  return rows.map((row) => row.headline);
}
