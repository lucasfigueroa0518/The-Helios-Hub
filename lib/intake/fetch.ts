/**
 * The intake's own fetch (Phase 1 contract, round 3b "the intake owns its
 * sources"). It reads nothing from `reels.*` or `social.*`: the reels primary
 * adapters and the 19 feeds are fetched here, so LFD and MD get their sources
 * whether Reels or Carousels run or not.
 *
 * Reels adapters follow lib/reels/pipeline/ingest.ts step for step (cap,
 * repeat window, resolveBody, the ingest screen) but store into
 * `intake.items`; `ingestAdapter` itself is never called (it writes reels
 * tables). Feeds follow the carousel selection's window and code filters.
 * A URL on both lists is stored once (key = canonical URL).
 */
import { RANKED_REPEAT_DAYS } from '@/lib/reels/config';
import { parsePage } from '@/lib/reels/net/html';
import { canonicalizeUrl, type FetchedPage } from '@/lib/reels/net/http';
import { applyCap, capNewItems, resolveBody, screen, type IngestDeps } from '@/lib/reels/pipeline/ingest';
import type { Adapter, AdapterItem, DropReason } from '@/lib/reels/types';
import { HELIOS_SOCIAL_FEEDS, type FeedConfig } from '@/lib/social/feeds';
import type { FetchedArticle } from '@/lib/social/ingest/fetch-feeds';
import { codeFilterReason, contentFarmReason } from '@/lib/social/ingest/select/code-filters';
import { fetchBodyLive, THIN_BODY_CHARS, type FetchBody } from '@/lib/social/ingest/select/enrich';
import { inWindow, windowHours } from '@/lib/social/ingest/select/window';

import type { IntakeJev, IntakeOrder, IntakeQuery, IntakeRunRecord } from './types';

export type SourceEntry = IntakeRunRecord['sources'][number];

/** Mirrors ingest.ts VISIBLE_DROPS: these stay in the store with their reason; the rest are only counted. */
const VISIBLE_DROPS: ReadonlySet<string> = new Set<DropReason>([
  'no_full_text',
  'teaser',
  'fetch_failed',
  'not_article',
  'off_topic',
  'junk',
  'non_english',
  'planted_instruction',
]);

/**
 * The intake's item key: reels' canonicalizeUrl (https, no www, tracking
 * params and trailing slash dropped). Every writer (fetch, deposit, seeds)
 * must key items with this so a URL is stored once.
 */
export function intakeItemKey(url: string): string {
  return canonicalizeUrl(url);
}

/* ── which sources the open orders name ───────────────────────────────── */

export type FetchPlan = {
  adapters: Adapter[];
  feeds: FeedConfig[];
  /** Max lookback over the open orders: the first-night window for a reels adapter with no watermark. */
  lookbackDays: number;
};

export function planSources(
  orders: readonly IntakeOrder[],
  adapters: readonly Adapter[],
  feeds: readonly FeedConfig[] = HELIOS_SOCIAL_FEEDS,
): FetchPlan {
  const names = new Set(orders.flatMap((order) => order.sources));
  const allReels = names.has('reels:*');
  const allFeeds = names.has('feeds:*');
  return {
    adapters: adapters.filter((adapter) => allReels || names.has(adapter.id)),
    feeds: feeds.filter((feed) => allFeeds || names.has(`feed:${feed.slug}`)),
    lookbackDays: Math.max(1, ...orders.map((order) => order.lookbackDays)),
  };
}

/* ── store helpers ────────────────────────────────────────────────────── */

type Existing = {
  key: string;
  first_seen_at: Date | string;
  drop_reason: string | null;
  family?: string;
  feed_slug?: string | null;
  reels_source_id?: string | null;
};

async function existingItems(q: IntakeQuery, keys: string[]): Promise<Map<string, Existing>> {
  if (keys.length === 0) return new Map();
  const { rows } = await q.query<Existing>(
    `SELECT key, first_seen_at, drop_reason, family, feed_slug, reels_source_id FROM intake.items WHERE key = ANY($1::text[])`,
    [keys],
  );
  return new Map(rows.map((row) => [row.key, row]));
}

/** The row already carries a reels membership (older rows: stored by a reels adapter). */
const hasReels = (row: Existing) => row.reels_source_id != null || row.family === 'reels';
/** The row already carries a feed membership (older rows: stored by a feed). */
const hasFeed = (row: Existing) => row.feed_slug != null || row.family === 'feeds';

async function touch(q: IntakeQuery, key: string, now: Date, engagement?: Record<string, number> | null): Promise<boolean> {
  const { rows } = await q.query<{ key: string }>(
    engagement
      ? `UPDATE intake.items SET last_seen_at = $2, engagement = $3::jsonb WHERE key = $1 RETURNING key`
      : `UPDATE intake.items SET last_seen_at = $2 WHERE key = $1 RETURNING key`,
    engagement ? [key, now, JSON.stringify(engagement)] : [key, now],
  );
  return rows.length > 0;
}

/**
 * A list sees a URL another list stored first (review fix 1): record this list's membership and verdict on the one
 * row, without regrouping it. The overall `drop_reason` clears when this list keeps it (the item may now join a
 * story); a story it is already in moves `last_joined_at` and is touched, so this run scores the new member set.
 * The other list's membership is backfilled from `family` on rows from before the columns.
 */
async function addMembership(
  q: IntakeQuery,
  key: string,
  side: { list: 'reels'; sourceId: string; dropReason: string | null; body?: string; engagement?: Record<string, number> | null } | { list: 'feeds'; slug: string; sourceName: string; dropReason: string | null; body?: string },
  ctx: Pick<FetchContext, 'now' | 'touched'>,
): Promise<void> {
  const params: unknown[] = [key, side.list === 'reels' ? side.sourceId : side.slug, side.dropReason, ctx.now, side.body ?? ''];
  const sql =
    side.list === 'reels'
      ? `UPDATE intake.items SET
           reels_source_id = $2, reels_drop_reason = $3, last_seen_at = $4,
           body = CASE WHEN length($5::text) > length(body) THEN $5::text ELSE body END,
           engagement = COALESCE($6::jsonb, engagement),
           feed_slug = COALESCE(feed_slug, CASE WHEN family = 'feeds' THEN regexp_replace(source_id, '^feed:', '') END),
           feed_source_name = COALESCE(feed_source_name, CASE WHEN family = 'feeds' THEN source_name END),
           feed_drop_reason = CASE WHEN feed_slug IS NULL AND family = 'feeds' THEN drop_reason ELSE feed_drop_reason END,
           drop_reason = CASE WHEN $3::text IS NULL THEN NULL ELSE drop_reason END
         WHERE key = $1 RETURNING story_id::text AS story_id`
      : `UPDATE intake.items SET
           feed_slug = $2, feed_drop_reason = $3, last_seen_at = $4, feed_source_name = $6,
           body = CASE WHEN length($5::text) > length(body) THEN $5::text ELSE body END,
           reels_source_id = COALESCE(reels_source_id, CASE WHEN family = 'reels' THEN source_id END),
           reels_drop_reason = CASE WHEN reels_source_id IS NULL AND family = 'reels' THEN drop_reason ELSE reels_drop_reason END,
           drop_reason = CASE WHEN $3::text IS NULL THEN NULL ELSE drop_reason END
         WHERE key = $1 RETURNING story_id::text AS story_id`;
  params.push(side.list === 'reels' ? (side.engagement ? JSON.stringify(side.engagement) : null) : side.sourceName);
  const { rows } = await q.query<{ story_id: string | null }>(sql, params);
  const storyId = rows[0]?.story_id ?? null;
  if (storyId && side.dropReason === null) {
    await q.query(`UPDATE intake.stories SET last_joined_at = $2 WHERE id = $1`, [storyId, ctx.now]);
    ctx.touched?.add(storyId);
  }
}

export type NewItem = {
  key: string;
  family: 'reels' | 'feeds' | 'search';
  sourceId: string;
  sourceName: string;
  sourceType: string;
  headline: string;
  body: string;
  url: string;
  author?: string | null;
  byline?: string | null;
  publishTime: Date | null;
  engagement?: Record<string, number> | null;
  mediaUrls?: string[];
  citationUrls?: string[];
  dropReason: string | null;
  runId: string | null;
};

/**
 * Insert one item. Reaching here means it is new, a retry of a failed fetch,
 * or a repeat past the window: in each case the row starts over, ungrouped.
 * The storing list's membership is set from `family`; another list's
 * membership on the row is kept, and keeps the item when it kept it.
 */
export async function upsertItem(q: IntakeQuery, item: NewItem, now: Date): Promise<void> {
  const feedSlug = item.family === 'feeds' ? item.sourceId.replace(/^feed:/, '') : null;
  const reelsSourceId = item.family === 'reels' ? item.sourceId : null;
  await q.query(
    `INSERT INTO intake.items
       (key, family, source_id, source_name, source_type, headline, body, url, author, byline,
        publish_time, first_seen_at, last_seen_at, engagement, media_urls, citation_urls, drop_reason, run_id,
        feed_slug, feed_drop_reason, feed_source_name, reels_source_id, reels_drop_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13::jsonb,$14::text[],$15::text[],$16,$17,
             $18, CASE WHEN $18::text IS NULL THEN NULL ELSE $16 END, CASE WHEN $18::text IS NULL THEN NULL ELSE $4 END,
             $19, CASE WHEN $19::text IS NULL THEN NULL ELSE $16 END)
     ON CONFLICT (key) DO UPDATE SET
       family = EXCLUDED.family, source_id = EXCLUDED.source_id, source_name = EXCLUDED.source_name,
       source_type = EXCLUDED.source_type, headline = EXCLUDED.headline, body = EXCLUDED.body,
       url = EXCLUDED.url, author = EXCLUDED.author, byline = EXCLUDED.byline,
       publish_time = EXCLUDED.publish_time, first_seen_at = EXCLUDED.first_seen_at,
       last_seen_at = EXCLUDED.last_seen_at, engagement = EXCLUDED.engagement,
       media_urls = EXCLUDED.media_urls, citation_urls = EXCLUDED.citation_urls,
       run_id = EXCLUDED.run_id,
       feed_slug = COALESCE(EXCLUDED.feed_slug, intake.items.feed_slug),
       feed_drop_reason = CASE WHEN EXCLUDED.feed_slug IS NOT NULL THEN EXCLUDED.feed_drop_reason ELSE intake.items.feed_drop_reason END,
       feed_source_name = COALESCE(EXCLUDED.feed_source_name, intake.items.feed_source_name),
       reels_source_id = COALESCE(EXCLUDED.reels_source_id, intake.items.reels_source_id),
       reels_drop_reason = CASE WHEN EXCLUDED.reels_source_id IS NOT NULL THEN EXCLUDED.reels_drop_reason ELSE intake.items.reels_drop_reason END,
       drop_reason = CASE
         WHEN EXCLUDED.drop_reason IS NULL THEN NULL
         WHEN EXCLUDED.feed_slug IS NULL AND intake.items.feed_slug IS NOT NULL AND intake.items.feed_drop_reason IS NULL THEN NULL
         WHEN EXCLUDED.reels_source_id IS NULL AND intake.items.reels_source_id IS NOT NULL AND intake.items.reels_drop_reason IS NULL THEN NULL
         ELSE EXCLUDED.drop_reason END,
       story_id = NULL, role = NULL, joined_at = NULL`,
    [
      item.key,
      item.family,
      item.sourceId,
      item.sourceName,
      item.sourceType,
      item.headline,
      item.body,
      item.url,
      item.author ?? null,
      item.byline ?? null,
      item.publishTime,
      now,
      item.engagement ? JSON.stringify(item.engagement) : null,
      item.mediaUrls ?? [],
      item.citationUrls ?? [],
      item.dropReason,
      item.runId,
      feedSlug,
      reelsSourceId,
    ],
  );
}

/* ── reels primary adapters ───────────────────────────────────────────── */

export type FetchContext = {
  runId: string;
  /** The run's start: an item first seen before it is a repeat. */
  runStartedAt: Date;
  now: Date;
  jev: IntakeJev;
  fetchPage?: (url: string, signal?: AbortSignal) => Promise<unknown>;
  log?: (line: string) => void;
  /** Stories an existing item joined as a new list's member this run (fix 1): scored with the run's touched stories. */
  touched?: Set<string>;
};

function bump(entry: SourceEntry, reason: string, by = 1): void {
  entry.dropped[reason] = (entry.dropped[reason] ?? 0) + by;
}

async function sinceFor(q: IntakeQuery, adapterId: string, now: Date, lookbackDays: number): Promise<Date> {
  const { rows } = await q.query<{ last_success_at: Date | string | null }>(
    `SELECT last_success_at FROM intake.watermarks WHERE source_id = $1`,
    [adapterId],
  );
  const mark = rows[0]?.last_success_at;
  return mark ? new Date(mark) : new Date(now.getTime() - lookbackDays * 86_400_000);
}

async function markWatermark(q: IntakeQuery, adapterId: string, now: Date, success: boolean): Promise<void> {
  await q.query(
    success
      ? `INSERT INTO intake.watermarks (source_id, last_success_at, last_attempt_at) VALUES ($1, $2, $2)
         ON CONFLICT (source_id) DO UPDATE SET last_success_at = $2, last_attempt_at = $2`
      : `INSERT INTO intake.watermarks (source_id, last_attempt_at) VALUES ($1, $2)
         ON CONFLICT (source_id) DO UPDATE SET last_attempt_at = $2`,
    [adapterId, now],
  );
}

/**
 * One reels primary adapter into `intake.items`. Mirrors ingestAdapter:
 * dedupe → applyCap → repeat window + capNewItems → resolveBody → screen
 * (the "reels-screen": planted, junk, non-English, off-topic) → store.
 * An IntakeCapReached from the screen propagates: the item that hit it is
 * not stored and the watermark does not move, so the next run retries.
 */
export async function fetchReelsAdapter(
  q: IntakeQuery,
  adapter: Adapter,
  lookbackDays: number,
  ctx: FetchContext,
  entry: SourceEntry,
): Promise<void> {
  const since = await sinceFor(q, adapter.id, ctx.now, lookbackDays);
  await markWatermark(q, adapter.id, ctx.now, false);

  const runner = ctx.jev.asReelsRunner();
  let items: AdapterItem[];
  try {
    items = await adapter.fetchItems({ since, now: ctx.now, runId: ctx.runId, jev: runner });
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
    return;
  }
  entry.fetched += items.length;

  const seen = new Set<string>();
  const deduped = items.filter((item) => {
    const url = canonicalizeUrl(item.canonicalUrl);
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });

  const { kept, overflow } = applyCap(adapter, deduped);
  if (overflow) bump(entry, 'over_cap', overflow);

  const existing = await existingItems(q, kept.map((item) => canonicalizeUrl(item.canonicalUrl)));
  // A repeat is a URL a reels adapter already saw; a feed-first URL is new to the reels side (fix 1).
  const isRepeat = (item: AdapterItem): boolean => {
    const row = existing.get(canonicalizeUrl(item.canonicalUrl));
    if (!row || !hasReels(row) || row.drop_reason === 'fetch_failed' || item.allowRepeat) return false;
    const firstSeen = new Date(row.first_seen_at);
    return firstSeen < ctx.runStartedAt && ctx.now.getTime() - firstSeen.getTime() < RANKED_REPEAT_DAYS * 86_400_000;
  };
  // A key stored earlier in THIS run (by another adapter) is stored once too.
  const storedThisRun = (key: string) => {
    const row = existing.get(key);
    return row != null && hasReels(row) && new Date(row.first_seen_at) >= ctx.runStartedAt && row.drop_reason !== 'fetch_failed';
  };

  const capped = capNewItems(adapter, kept, isRepeat);
  if (capped.overflow) bump(entry, 'over_cap', capped.overflow);

  const deps: IngestDeps = {
    jev: runner,
    fetchPage: ctx.fetchPage as ((url: string, signal?: AbortSignal) => Promise<FetchedPage>) | undefined,
  };

  for (const item of capped.kept) {
    const url = canonicalizeUrl(item.canonicalUrl);
    if (isRepeat(item) || storedThisRun(url)) {
      if (adapter.kind === 'ranked' && item.engagement) await touch(q, url, ctx.now, item.engagement as Record<string, number>);
      else {
        await touch(q, url, ctx.now);
        bump(entry, 'already_seen');
      }
      continue;
    }

    const resolved = await resolveBody(item, deps);
    const storedUrl = resolved.resolvedUrl ? canonicalizeUrl(resolved.resolvedUrl) : url;
    let held = existing.get(storedUrl) ?? null;
    if (storedUrl !== url) {
      // A tracking link landed on an article we already hold: stored once, no second screen.
      const twin = (await existingItems(q, [storedUrl])).get(storedUrl);
      if (twin && twin.drop_reason !== 'fetch_failed' && hasReels(twin)) {
        await touch(q, storedUrl, ctx.now);
        bump(entry, 'already_seen');
        continue;
      }
      held = twin ?? null;
    }

    const dropReason =
      resolved.dropReason ??
      (await screen(item, resolved.body, deps, { runId: ctx.runId, runStartedAt: ctx.runStartedAt, now: ctx.now }));

    if (dropReason) bump(entry, dropReason);
    else entry.kept += 1;

    if (held && !hasReels(held)) {
      // A feed stored this URL first: the reels side joins it as a member with its own verdict (fix 1).
      await addMembership(
        q,
        storedUrl,
        { list: 'reels', sourceId: adapter.id, dropReason, body: dropReason ? '' : resolved.body, engagement: (item.engagement as Record<string, number> | undefined) ?? null },
        ctx,
      );
      existing.set(storedUrl, { ...held, reels_source_id: adapter.id });
      continue;
    }
    if (dropReason && !VISIBLE_DROPS.has(dropReason)) continue;

    await upsertItem(
      q,
      {
        key: storedUrl,
        family: 'reels',
        sourceId: adapter.id,
        sourceName: adapter.name,
        sourceType: adapter.type,
        headline: item.headline,
        body: resolved.body,
        url: storedUrl,
        author: resolved.author,
        byline: item.byline ?? null,
        publishTime: resolved.publishTime,
        engagement: (item.engagement as Record<string, number> | undefined) ?? null,
        mediaUrls: resolved.mediaUrls,
        citationUrls: item.citationUrls ?? [],
        dropReason,
        runId: ctx.runId,
      },
      ctx.now,
    );
    existing.set(storedUrl, { key: storedUrl, first_seen_at: ctx.now, drop_reason: dropReason, family: 'reels', reels_source_id: adapter.id, feed_slug: held?.feed_slug ?? null });
  }

  await markWatermark(q, adapter.id, ctx.now, true);
}

/* ── feeds ────────────────────────────────────────────────────────────── */

/**
 * The feeds the open orders name, in the carousel selection's window (the
 * widened 48 h, so a widened pick at read time still has its items) and code
 * filters (listicles, deals, content farms). A filtered article is stored
 * with its reason and never joins a story.
 */
export async function fetchFeedItems(
  q: IntakeQuery,
  feeds: FeedConfig[],
  fetchFeeds: (feeds: FeedConfig[]) => Promise<FetchedArticle[]>,
  ctx: FetchContext,
  entries: Map<string, SourceEntry>,
): Promise<void> {
  if (feeds.length === 0) return;
  let articles: FetchedArticle[];
  try {
    articles = await fetchFeeds(feeds);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    for (const entry of entries.values()) entry.error = text;
    return;
  }

  const hours = windowHours(ctx.now, true);
  const seen = new Set<string>();
  const fresh: Array<{ article: FetchedArticle; key: string; entry: SourceEntry }> = [];
  for (const article of articles) {
    const entry = entries.get(`feed:${article.feedSlug}`);
    if (!entry) continue;
    entry.fetched += 1;
    const key = canonicalizeUrl(article.sourceUrl);
    if (!key || seen.has(key)) {
      bump(entry, 'duplicate');
      continue;
    }
    seen.add(key);
    if (!inWindow(article, ctx.now, hours)) {
      bump(entry, 'out_of_window');
      continue;
    }
    fresh.push({ article, key, entry });
  }

  const existing = await existingItems(q, fresh.map((f) => f.key));
  for (const { article, key, entry } of fresh) {
    const held = existing.get(key);
    if (held && hasFeed(held)) {
      // A feed already carries it (an earlier night): once.
      await touch(q, key, ctx.now);
      bump(entry, 'already_seen');
      continue;
    }
    const reason = codeFilterReason(article.headline) ?? contentFarmReason(article);
    if (reason) bump(entry, reason);
    else entry.kept += 1;
    if (held) {
      // A reels adapter (tonight or earlier) stored it first: the feed joins it as a member with its own verdict (fix 1).
      await addMembership(q, key, { list: 'feeds', slug: article.feedSlug, sourceName: article.source, dropReason: reason, body: reason ? '' : article.body }, ctx);
      existing.set(key, { ...held, feed_slug: article.feedSlug });
      continue;
    }
    await upsertItem(
      q,
      {
        key,
        family: 'feeds',
        sourceId: `feed:${article.feedSlug}`,
        sourceName: article.source,
        sourceType: 'feed',
        headline: article.headline,
        body: article.body,
        url: article.sourceUrl,
        byline: article.byline,
        publishTime: article.publishedAt,
        dropReason: reason,
        runId: ctx.runId,
      },
      ctx.now,
    );
  }
}

/* ── thin feed bodies ─────────────────────────────────────────────────── */

/** A FetchBody from the injected page fetcher (offline in tests), else the carousel's live Readability fetch. */
export function fetchBodyFrom(fetchPage?: (url: string, signal?: AbortSignal) => Promise<unknown>): FetchBody {
  if (!fetchPage) return fetchBodyLive;
  return async (url) => {
    const page = (await fetchPage(url)) as FetchedPage | null;
    return page?.html ? parsePage(page.html).text : null;
  };
}

/**
 * The carousel's enrichGroup, per story: when no feed member has
 * THIN_BODY_CHARS of text, members' pages are read in order until one does.
 * Runs only on stories touched in this run (Rule 2).
 */
export async function enrichThinFeedBodies(q: IntakeQuery, storyIds: readonly string[], fetchBody: FetchBody): Promise<number> {
  if (storyIds.length === 0) return 0;
  const { rows } = await q.query<{ key: string; url: string; body: string; story_id: string }>(
    `SELECT key, url, body, story_id::text AS story_id FROM intake.items
      WHERE story_id = ANY($1::uuid[])
        AND CASE WHEN feed_slug IS NOT NULL THEN feed_drop_reason IS NULL ELSE family = 'feeds' AND drop_reason IS NULL END
      ORDER BY story_id, length(body) DESC`,
    [storyIds],
  );
  const byStory = new Map<string, typeof rows>();
  for (const row of rows) byStory.set(row.story_id, [...(byStory.get(row.story_id) ?? []), row]);

  let enriched = 0;
  for (const members of byStory.values()) {
    if (members.some((m) => m.body.length >= THIN_BODY_CHARS)) continue;
    for (const member of members) {
      let page: string | null = null;
      try {
        page = await fetchBody(member.url);
      } catch {
        page = null;
      }
      if (page && page.length > member.body.length) {
        await q.query(`UPDATE intake.items SET body = $2 WHERE key = $1`, [member.key, page]);
        enriched += 1;
      }
      if (page && page.length >= THIN_BODY_CHARS) break;
    }
  }
  return enriched;
}

