import { dbQuery } from '@/lib/db';
import {
  HELIOS_SOCIAL_FEEDS,
  HELIOS_SOCIAL_RELEVANCE_THRESHOLD,
} from '@/lib/social/feeds';
import { extractPacket } from '@/lib/social/ingest/extract-packet';
import { fetchAllFeeds } from '@/lib/social/ingest/fetch-feeds';
import { judgeRelevance } from '@/lib/social/ingest/judge-relevance';

export type IngestSummary = {
  feedsQueried: number;
  articlesFetched: number;
  duplicatesSkipped: number;
  articlesInserted: number;
  articlesJudged: number;
  articlesApproved: number;
  articlesRejected: number;
  articlesExtracted: number;
  approxJevCostUsd: number;
  approxHaikuCostUsd: number;
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
 * Full ingest cycle — cascade of Jev (cheap gate) and Haiku (rich extraction):
 *
 *   1. Fetch every configured RSS feed in parallel.
 *   2. Filter to entries published in the last N hours (freshness gate).
 *   3. INSERT each new article. UNIQUE(source_url) silently no-ops on dupes.
 *   4. For each new article, call Jev to judge relevance (one Noul).
 *      - If noul < threshold: reject. Article marked 'rejected'. No Haiku call.
 *      - If noul >= threshold: continue to step 5.
 *   5. For approved articles only, call Haiku to extract the full packet
 *      (reason, people, companies, products, topics, notable_number, bullets).
 *   6. UPDATE the row with the score + extraction packet + status.
 *
 * Per-article failures do not abort the run — they land in `errors`. The
 * summary tracks Jev cost and Haiku cost separately so cost regressions
 * show up in the diagnostics.
 */
export async function runIngest(): Promise<IngestSummary> {
  const summary: IngestSummary = {
    feedsQueried: HELIOS_SOCIAL_FEEDS.length,
    articlesFetched: 0,
    duplicatesSkipped: 0,
    articlesInserted: 0,
    articlesJudged: 0,
    articlesApproved: 0,
    articlesRejected: 0,
    articlesExtracted: 0,
    approxJevCostUsd: 0,
    approxHaikuCostUsd: 0,
    approxCostUsd: 0,
    errors: [],
  };

  // 1–2. Fetch + freshness filter (both inside fetchAllFeeds).
  console.error(`[helios-social] fetching ${HELIOS_SOCIAL_FEEDS.length} feeds in parallel…`);
  const articles = await fetchAllFeeds(HELIOS_SOCIAL_FEEDS);
  summary.articlesFetched = articles.length;
  console.error(
    `[helios-social] fetch phase done: ${articles.length} fresh articles across all feeds`,
  );

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
  console.error(
    `[helios-social] judging ${inserted.length} new articles with Jev (cheap gate)…`,
  );

  // 4–6. Cascade. Serial keeps prompt caches warm on the Haiku side and
  // stays under the Jev rate limits without extra bookkeeping.
  let idx = 0;
  for (const article of inserted) {
    idx += 1;
    try {
      // 4. Jev gate.
      const judgment = await judgeRelevance({
        headline: article.headline,
        source: article.source,
        byline: article.byline,
        body: article.body,
      });
      summary.approxJevCostUsd += judgment.approxCostUsd;
      summary.articlesJudged += 1;

      const passes = judgment.noul >= HELIOS_SOCIAL_RELEVANCE_THRESHOLD;

      if (!passes) {
        // Rejected — no Haiku call, no packet, just record the score + reason.
        summary.articlesRejected += 1;
        console.error(
          `[helios-social] judge ${idx}/${inserted.length} ✗ ${judgment.noul.toFixed(2)} — ${article.source}: ${article.headline.slice(0, 60)}`,
        );
        await dbQuery(
          `UPDATE helios_social.article_queue
              SET ingest_status    = 'rejected',
                  relevance_score  = $1,
                  rejected_reason  = $2
            WHERE id = $3`,
          [
            judgment.noul,
            `Below Helios relevance threshold (Jev noul: ${judgment.noul.toFixed(2)})`,
            article.id,
          ],
        );
        continue;
      }

      // 5. Approved — escalate to Haiku for the full extraction packet.
      summary.articlesApproved += 1;
      const { packet, usage } = await extractPacket({
        headline: article.headline,
        source: article.source,
        byline: article.byline,
        body: article.body,
      });
      summary.approxHaikuCostUsd += usage.approxCostUsd;
      summary.articlesExtracted += 1;
      console.error(
        `[helios-social] extract ${idx}/${inserted.length} ✓ ${judgment.noul.toFixed(2)} — ${article.source}: ${article.headline.slice(0, 60)}`,
      );

      // 6. Persist the packet.
      await dbQuery(
        `UPDATE helios_social.article_queue
            SET ingest_status    = 'approved_for_draft',
                relevance_score  = $1,
                relevance_reason = $2,
                people           = $3::jsonb,
                companies        = $4::jsonb,
                products         = $5::jsonb,
                topics           = $6::jsonb,
                notable_number   = $7,
                bullets          = $8::jsonb
          WHERE id = $9`,
        [
          judgment.noul,
          packet.reason,
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
      summary.errors.push(`article ${article.source_url}: ${msg}`);
    }
  }

  summary.approxJevCostUsd = Number(summary.approxJevCostUsd.toFixed(6));
  summary.approxHaikuCostUsd = Number(summary.approxHaikuCostUsd.toFixed(6));
  summary.approxCostUsd = Number(
    (summary.approxJevCostUsd + summary.approxHaikuCostUsd).toFixed(6),
  );
  return summary;
}
