/**
 * Guess the Number: which links a candidate may be read from (Bald-Eagle D7, D10).
 *
 *   memberLinks   a pool story's other member links, read from its intake story
 *                 (intake.items by story id, after following merges). Read only:
 *                 one story at a time, for the candidate being gated (CLAUDE.md
 *                 rule 2), never a sweep.
 *   sourceOrder   the candidate's own link first, then publisher links, then
 *                 news-aggregator wrapper links last, one per page, capped
 *   badLink       the code side of the picker's link rules: a model idea may not
 *                 cite an aggregator wrapper link or a link a higher-ranked
 *                 candidate already cites
 *
 * Code only, no AI.
 */
import { resolveStoryId } from '@/lib/intake/read';
import type { IntakeQuery } from '@/lib/intake/types';
import { storyKey } from '@/lib/stories/sources/reels';

/** Most links read for one candidate (its own plus member links). Provisional, to calibrate. */
export const MAX_SOURCE_TRIES = 6;
/** Most member rows read for one intake story. */
export const MEMBER_LINKS_READ = 40;

export type MemberLink = { url: string; outlet: string | null };

/** A news-aggregator wrapper link (Google News): it redirects to a publisher page we may not be able to open. */
export function isAggregatorLink(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === 'news.google.com';
  } catch {
    return false;
  }
}

/** A readable outlet name from a page's host, for crediting a page with no outlet on record: "www.example-news.com" → "Example News". */
export function outletFromHost(url: string): string | null {
  try {
    const labels = new URL(url).hostname.toLowerCase().replace(/^www\./, '').split('.');
    // A second-level suffix (example.co.uk) moves the name one label left.
    const sld = labels.length >= 3 && /^(co|com|org|net|ac|gov|edu)$/.test(labels[labels.length - 2]!);
    const name = labels[labels.length - (sld ? 3 : 2)] ?? labels[0]!;
    return name ? name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : null;
  } catch {
    return null;
  }
}

/** An intake story's member links (primary first), read only. Unknown story or a failed read: none. */
export async function intakeMemberLinks(q: IntakeQuery, storyId: string): Promise<MemberLink[]> {
  const id = (await resolveStoryId(q, storyId)) ?? storyId;
  const { rows } = await q.query<{ key: string; url: string; source_name: string | null; feed_source_name: string | null }>(
    `SELECT key, url, source_name, feed_source_name FROM intake.items
      WHERE story_id = $1::uuid
      ORDER BY CASE role WHEN 'primary' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END, joined_at, key
      LIMIT $2`,
    [id, MEMBER_LINKS_READ],
  );
  const out: MemberLink[] = [];
  for (const r of rows) {
    const outlet = r.feed_source_name ?? r.source_name ?? null;
    // The canonical URL (the key, when it is one) and the item's own link, which can be a wrapper.
    if (/^https?:\/\//i.test(r.key)) out.push({ url: r.key, outlet });
    if (r.url && r.url !== r.key) out.push({ url: r.url, outlet });
  }
  return out;
}

/** The links to try, in order: own link, then publisher links, then aggregator wrappers; one per page; at most `max`. */
export function sourceOrder(own: string, others: readonly string[], max = MAX_SOURCE_TRIES): string[] {
  const seen = new Set<string>();
  const keep = (u: string) => {
    if (!/^https?:\/\//i.test(u)) return false;
    const k = storyKey(u);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };
  const head = own && keep(own) ? [own] : [];
  const rest = others.filter(keep);
  return [...head, ...rest.filter((u) => !isAggregatorLink(u)), ...rest.filter(isAggregatorLink)].slice(0, max);
}

/**
 * Why a model idea's link breaks the picker's rules, or null. `higher` = the links the higher-ranked candidates of
 * the same round cite.
 */
export function badLink(sourceUrl: string, higher: readonly string[]): string | null {
  if (isAggregatorLink(sourceUrl)) return 'news aggregator link';
  const k = storyKey(sourceUrl);
  return higher.some((u) => storyKey(u) === k) ? 'link already cited by a higher-ranked candidate' : null;
}
