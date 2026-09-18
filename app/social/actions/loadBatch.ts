'use server';

import { dbQuery } from '@/lib/db';
import { HELIOS_SOCIAL_BATCH_CAP, clusterKey } from '@/lib/social/dedup';
import { requireSocialSession } from '@/lib/social/session';
import type { Article, IngestStatus } from '@/lib/social/types';

type BatchRow = {
  id: string;
  source: string;
  source_url: string;
  headline: string;
  byline: string | null;
  body: string;
  feed_slug: string | null;
  published_at: Date | string | null;
  added_at: Date | string;
  ingest_status: IngestStatus;
  relevance_score: string | number | null;
  relevance_reason: string | null;
  rejected_reason: string | null;
  people: string[] | null;
  companies: string[] | null;
  products: string[] | null;
  topics: string[] | null;
  notable_number: string | null;
  bullets: string[] | null;
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function asArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function rowToArticle(r: BatchRow): Article {
  return {
    id: r.id,
    source: r.source,
    sourceUrl: r.source_url,
    headline: r.headline,
    byline: r.byline,
    body: r.body,
    feedSlug: r.feed_slug,
    publishedAt: iso(r.published_at),
    addedAt: iso(r.added_at) ?? new Date().toISOString(),
    ingestStatus: r.ingest_status,
    relevanceScore: r.relevance_score !== null ? Number(r.relevance_score) : null,
    relevanceReason: r.relevance_reason,
    rejectedReason: r.rejected_reason,
    people: asArray(r.people),
    companies: asArray(r.companies),
    products: asArray(r.products),
    topics: asArray(r.topics),
    notableNumber: r.notable_number,
    bullets: asArray(r.bullets),
  };
}

/**
 * Loads the batch board's articles:
 *   1. SELECT approved / drafted rows, ordered by relevance_score DESC.
 *   2. Cluster-dedup — keep highest-scoring representative per primary
 *      entity + topic pair. Same story from 5 outlets becomes 1 card.
 *   3. Cap to HELIOS_SOCIAL_BATCH_CAP (15). Anything past the cap gets
 *      dropped from view — still in the DB, just not surfaced.
 */
export async function loadBatch(): Promise<Article[]> {
  await requireSocialSession();

  const { rows } = await dbQuery<BatchRow>(
    `SELECT id, source, source_url, headline, byline, body,
            feed_slug, published_at, added_at, ingest_status,
            relevance_score, relevance_reason, rejected_reason,
            people, companies, products, topics,
            notable_number, bullets
       FROM helios_social.article_queue
      WHERE ingest_status IN ('approved_for_draft','drafted')
      ORDER BY relevance_score DESC NULLS LAST,
               published_at DESC NULLS LAST`,
  );

  const seen = new Set<string>();
  const result: Article[] = [];
  for (const row of rows) {
    const article = rowToArticle(row);
    const key = clusterKey(article);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(article);
    if (result.length >= HELIOS_SOCIAL_BATCH_CAP) break;
  }
  return result;
}
