import { dbQuery } from '@/lib/db';
import { REEL_SCHEDULE } from '@/lib/reels/spine-tables';
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
 *
 * D-258: an idea is written once a day. When its latest attempt on an earlier
 * day missed widely, it is held out for good: its best line was more than
 * WIDE_MISS_BOTH short on both plain read (payoff on Ball Knowledge) and stake,
 * or WIDE_MISS_ONE or more short on either. A near miss may try again.
 */

export type PublishedStoryKeys = { ideaIds: Set<string>; urls: Set<string> };

export type HeldOutReason = 'already_published' | 'published_url' | 'teaser_only' | 'copy_wide_miss';

/** D-258. The copy bar both scores are measured against. */
export const COPY_BAR = 0.75;
export const WIDE_MISS_BOTH = 0.1;
export const WIDE_MISS_ONE = 0.25;

/** Pure: whether a best line this short of the bar is a wide miss. */
export function isWideMiss(plain: number, stake: number): boolean {
  const plainShort = Math.max(0, COPY_BAR - plain);
  const stakeShort = Math.max(0, COPY_BAR - stake);
  const round = (value: number) => Math.round(value * 10_000);
  const both = round(plainShort) > round(WIDE_MISS_BOTH) && round(stakeShort) > round(WIDE_MISS_BOTH);
  const one = Math.max(round(plainShort), round(stakeShort)) >= round(WIDE_MISS_ONE);
  return both || one;
}

type JudgedLine = { plain?: number | null; payoff?: number | null; stake?: number | null; inRange?: boolean };

/** The line nearest the bar in one attempt: in range first, then the higher weaker score. */
export function bestLineScores(lines: readonly JudgedLine[]): { plain: number; stake: number } | null {
  let best: { plain: number; stake: number; inRange: boolean } | null = null;
  for (const line of lines) {
    const plain = line.payoff ?? line.plain;
    if (plain == null || line.stake == null) continue;
    const candidate = { plain, stake: line.stake, inRange: line.inRange !== false };
    const gate = (row: { plain: number; stake: number }) => Math.min(row.plain, row.stake);
    if (!best || Number(candidate.inRange) > Number(best.inRange) || (candidate.inRange === best.inRange && gate(candidate) > gate(best))) {
      best = candidate;
    }
  }
  return best ? { plain: best.plain, stake: best.stake } : null;
}

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
  wideMisses: ReadonlySet<string> = new Set(),
): Map<string, HeldOutReason> {
  const held = new Map<string, HeldOutReason>();
  for (const target of targets) {
    if (published.ideaIds.has(target.postIdeaId)) {
      held.set(target.postIdeaId, 'already_published');
      continue;
    }
    if (wideMisses.has(target.postIdeaId)) {
      held.set(target.postIdeaId, 'copy_wide_miss');
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
       SELECT DISTINCT post_idea_id FROM ${REEL_SCHEDULE} ps
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

/**
 * D-258. Ideas whose latest copy attempt on a New York date before `nyDate`
 * did not clear the bar and missed widely.
 */
export async function loadWideCopyMisses(nyDate: string): Promise<Set<string>> {
  const { rows } = await dbQuery<{ post_idea_id: string; eligible: string | null; lines: JudgedLine[] | null }>(
    `SELECT DISTINCT ON (h.post_idea_id) h.post_idea_id, h.variants->>'winnerEligible' AS eligible, h.variants->'lines' AS lines
       FROM reels.idea_copy_history h
       JOIN reels.score_slates s ON s.id = h.slate_id
      WHERE s.ny_date < $1::date
        AND h.variants IS NOT NULL
        AND h.variants->>'winnerEligible' IS NOT NULL
      ORDER BY h.post_idea_id, h.created_at DESC`,
    [nyDate],
  );
  const held = new Set<string>();
  for (const row of rows) {
    if (row.eligible === 'true') continue;
    const best = bestLineScores(row.lines ?? []);
    if (best && isWideMiss(best.plain, best.stake)) held.add(row.post_idea_id);
  }
  return held;
}

/** Headlines of reels published in the last `days`, for the web search's do-not-cover list (D-247). */
export async function recentPublishedHeadlines(days = PUBLISHED_STORY_HOLD_DAYS): Promise<string[]> {
  const { rows } = await dbQuery<{ headline: string }>(
    `SELECT DISTINCT ON (p.post_idea_id) src.headline
       FROM ${REEL_SCHEDULE} p
       JOIN reels.post_idea_members m ON m.post_idea_id = p.post_idea_id
       JOIN reels.sources src ON src.id = m.source_id
      WHERE p.status = 'published' AND p.publish_at > now() - ($1 || ' days')::interval
      ORDER BY p.post_idea_id, CASE m.role WHEN 'primary' THEN 0 ELSE 1 END, m.joined_at`,
    [String(days)],
  );
  return rows.map((row) => row.headline);
}
