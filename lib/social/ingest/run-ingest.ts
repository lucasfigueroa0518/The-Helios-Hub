import { dbQuery } from '@/lib/db';
import {
  HELIOS_SOCIAL_FEEDS,
  HELIOS_SOCIAL_RELEVANCE_THRESHOLD,
} from '@/lib/social/feeds';
import { fetchAllFeeds } from '@/lib/social/ingest/fetch-feeds';
import { scoreRelevance } from '@/lib/social/ingest/score-relevance';

export type IngestSummary = {
  feedsQueried: number;
  articlesFetched: number;
  duplicatesSkipped: number;
  articlesInserted: number;
  articlesScored: number;
  articlesApproved: number;
  articlesRejected: number;
  approxCostUsd: number;
  errors: string[];
};

type InsertedArticle = {
  id: string;
  source: string;
  source_url: string;
  headline: string;
  byline: string | null;
  body: string;
};

/**
 * Full ingest cycle:
 *   1. Fetch every configured RSS feed in parallel.
 *   2. Filter to entries published in the last N hours (freshness gate).
 *   3. INSERT each new article. UNIQUE(source_url) silently no-ops on dupes.
 *   4. Score + extract every newly-inserted article via one Haiku call.
 *   5. UPDATE each row with the extraction packet + workflow status.
 *
 * Per-article failures do not abort the run — they land in `errors`. Return
 * value is safe to console.log or store in a job telemetry field.
 */
export async function runIngest(): Promise<IngestSummary> {
  const summary: IngestSummary = {
    feedsQueried: HELIOS_SOCIAL_FEEDS.length,
    articlesFetched: 0,
    duplicatesSkipped: 0,
    articlesInserted: 0,
    articlesScored: 0,
    articlesApproved: 0,
    articlesRejected: 0,
    approxCostUsd: 0,
    errors: [],
  };

  // 1–2. Fetch + freshness filter (both inside fetchAllFeeds).
  console.error(`[helios-social] fetching ${HELIOS_SOCIAL_FEEDS.length} feeds in parallel…`);
  const articles = await fetchAllFeeds(HELIOS_SOCIAL_FEEDS);
  summary.articlesFetched = articles.length;
  console.error(`[helios-social] fetch phase done: ${articles.length} fresh articles across all feeds`);

  // 3. Insert. RETURNING gives back only new rows; conflicts return 0 rows.
  const inserted: InsertedArticle[] = [];
  for (const article of articles) {
    if (!article.headline || !article.body) continue;
    const { rows } = await dbQuery<InsertedArticle>(
      `INSERT INTO helios_social.article_queue
         (source, source_url, headline, byline, body,
          feed_slug, published_at, ingest_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_score')
       ON CONFLICT (source_url) DO NOTHING
       RETURNING id, source, source_url, headline, byline, body`,
      [
        article.source,
        article.sourceUrl,
        article.headline,
        article.byline,
        article.body,
        article.feedSlug,
        article.publishedAt,
      ],
    );
    if (rows.length === 0) {
      summary.duplicatesSkipped += 1;
    } else {
      inserted.push(rows[0]!);
      summary.articlesInserted += 1;
    }
  }
  console.error(
    `[helios-social] insert phase done: ${summary.articlesInserted} new / ${summary.duplicatesSkipped} dupes`,
  );
  console.error(`[helios-social] scoring ${inserted.length} new articles with Haiku…`);

  // 4–5. Score + extract + update. Serial keeps the prompt cache warm —
  // parallelizing would burn cache_creation on multiple in-flight requests.
  let idx = 0;
  for (const article of inserted) {
    idx += 1;
    try {
      const { packet, usage } = await scoreRelevance({
        headline: article.headline,
        source: article.source,
        byline: article.byline,
        body: article.body,
      });
      summary.approxCostUsd += usage.approxCostUsd;
      summary.articlesScored += 1;

      const passes = packet.score >= HELIOS_SOCIAL_RELEVANCE_THRESHOLD;
      console.error(
        `[helios-social] score ${idx}/${inserted.length} ${passes ? '✓' : '✗'} ${packet.score.toFixed(2)} — ${article.source}: ${article.headline.slice(0, 60)}`,
      );
      if (passes) summary.articlesApproved += 1;
      else summary.articlesRejected += 1;

      await dbQuery(
        `UPDATE helios_social.article_queue
            SET ingest_status    = $1,
                relevance_score  = $2,
                relevance_reason = $3,
                rejected_reason  = $4,
                people           = $5::jsonb,
                companies        = $6::jsonb,
                products         = $7::jsonb,
                topics           = $8::jsonb,
                notable_number   = $9,
                bullets          = $10::jsonb
          WHERE id = $11`,
        [
          passes ? 'approved_for_draft' : 'rejected',
          packet.score,
          packet.reason,
          passes ? null : packet.reason,
          JSON.stringify(packet.people),
          JSON.stringify(packet.companies),
          JSON.stringify(packet.products),
          JSON.stringify(packet.topics),
          packet.notable_number,
          JSON.stringify(packet.bullets),
          article.id,
        ],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`score failed for ${article.source_url}: ${msg}`);
    }
  }

  summary.approxCostUsd = Number(summary.approxCostUsd.toFixed(6));
  return summary;
}
