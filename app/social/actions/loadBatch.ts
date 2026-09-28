'use server';

import { dbQuery } from '@/lib/db';
import { HELIOS_SOCIAL_BATCH_CAP, clusterKey } from '@/lib/social/dedup';
import { requireSocialSession } from '@/lib/social/session';
import type {
  Article,
  ComposeStatus,
  IngestStatus,
  PipelineFlagSummary,
  PipelineVersion,
  ReviewStatus,
} from '@/lib/social/types';

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
  has_generated_post: boolean;
  render_slug: string | null;
  review_status: ReviewStatus | null;
  review_note: string | null;
  reviewed_at: Date | string | null;
  reviewed_by: string | null;
  pipeline_version: PipelineVersion | null;
  compose_status: ComposeStatus | null;
  pipeline_v2_debug: unknown;
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
  const v2 = extractV2Summary(r.pipeline_v2_debug);
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
    hasGeneratedPost: Boolean(r.has_generated_post),
    renderSlug: r.render_slug,
    reviewStatus: r.review_status,
    reviewNote: r.review_note,
    reviewedAt: iso(r.reviewed_at),
    reviewedBy: r.reviewed_by,
    pipelineVersion: r.pipeline_version ?? 'legacy',
    composeStatus: r.compose_status,
    needsHumanReviewReason: v2.reason,
    needsHumanReviewFlags: v2.flags,
  };
}

/**
 * Pull a summary out of pipeline_v2_debug for the review UI when a post is
 * in needs_human_review. Reads only outcome.reason + the last round's flags.
 */
function extractV2Summary(debug: unknown): { reason: string | null; flags: PipelineFlagSummary[] } {
  if (!debug || typeof debug !== 'object') return { reason: null, flags: [] };
  const d = debug as {
    outcome?: { reason?: string };
    rounds?: Array<{ factCheck?: { flags?: Array<{ where?: string; text?: string; problem?: string; size?: string }> } }>;
  };
  const reason = d.outcome?.reason ?? null;
  const lastRound = d.rounds?.[d.rounds.length - 1];
  const rawFlags = lastRound?.factCheck?.flags ?? [];
  const flags: PipelineFlagSummary[] = rawFlags.map((f) => ({
    where: String(f.where ?? ''),
    text: String(f.text ?? ''),
    problem: String(f.problem ?? ''),
    size: (String(f.size ?? 'SMALL').toUpperCase() === 'BIG' ? 'BIG' : 'SMALL') as 'SMALL' | 'BIG',
  }));
  return { reason, flags };
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
            notable_number, bullets,
            (copy_json IS NOT NULL OR render_post_json IS NOT NULL) AS has_generated_post,
            render_slug, review_status, review_note,
            reviewed_at, reviewed_by,
            pipeline_version, compose_status, pipeline_v2_debug
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
