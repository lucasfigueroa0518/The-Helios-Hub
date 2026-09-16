-- db/helios_social_ingest_migration.sql — Adds ingest-pipeline columns to
-- helios_social.article_queue so the daily RSS crawler can store per-article
-- freshness, LLM verdict, and the extraction packet the slide generator
-- eventually consumes. Idempotent.
--
-- Apply:
--   npm run db:setup    (picks up this migration in the ordered chain)
\set ON_ERROR_STOP on

-- Crawler articles have no user; only manual adds attribute a user.
ALTER TABLE helios_social.article_queue
  ALTER COLUMN added_by DROP NOT NULL;

-- Feed origin slug (e.g. 'the-verge-ai', 'gnews-frontier-labs'). Matches feeds.ts.
ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS feed_slug text;

-- When the source outlet published the article (from RSS pubDate/isoDate).
ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Article author name(s), from RSS <author> / <dc:creator>. Null when unknown.
ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS byline text;

-- ── LLM verdict fields ────────────────────────────────────────────────────

-- Haiku's relevance verdict — score in [0, 1]; null before scoring.
ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS relevance_score numeric;

-- One-sentence Helios angle from the relevance filter. Shown in review UI.
ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS relevance_reason text;

-- Human-visible reason if rejected (copy of relevance_reason for filtering).
ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS rejected_reason text;

-- ── Extraction packet — feeds the slide generator downstream ──────────────

-- Names from the watchlist People list that appear in the article.
ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS people jsonb;

-- Companies from the watchlist Companies list that appear.
ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS companies jsonb;

-- Products from the watchlist Products list that appear.
ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS products jsonb;

-- Watchlist Topics this article covers.
ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS topics jsonb;

-- Attention-grabbing number extracted from headline/lede (or null).
ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS notable_number text;

-- 5-8 top-weighted bullets summarizing the article. Ordered by importance.
ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS bullets jsonb;

-- ── Pipeline state ────────────────────────────────────────────────────────

-- pending_score       → freshly ingested, awaiting Haiku
-- rejected            → below relevance threshold or off-watchlist
-- approved_for_draft  → passed relevance, waiting for human review
-- drafted             → a helios_social.posts row has been created from it
ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS ingest_status text NOT NULL DEFAULT 'pending_score';

-- Drop-and-recreate the CHECK so re-runs don't error on the "already exists".
ALTER TABLE helios_social.article_queue
  DROP CONSTRAINT IF EXISTS article_queue_ingest_status_check;
ALTER TABLE helios_social.article_queue
  ADD CONSTRAINT article_queue_ingest_status_check
    CHECK (ingest_status IN ('pending_score','rejected','approved_for_draft','drafted'));

-- ── Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_status_score
  ON helios_social.article_queue (ingest_status, relevance_score DESC);

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_published
  ON helios_social.article_queue (published_at DESC);

-- GIN indexes make future clustering fast — "articles from last 48h that
-- also mention John Ternus" becomes a single indexed query.
CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_people
  ON helios_social.article_queue USING gin (people);

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_companies
  ON helios_social.article_queue USING gin (companies);
