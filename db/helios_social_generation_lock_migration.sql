-- db/helios_social_generation_lock_migration.sql — Auto-trigger lock.
--
-- Adds a `generation_started_at` timestamp used as a soft lock by the
-- `GET /api/social/generate/next` cron endpoint. When the cron picks an
-- article to process, it stamps this column. A concurrent cron tick will
-- skip any article with a fresh stamp (less than 15 minutes old). After
-- the pipeline finishes (success or failure), the stamp is cleared so the
-- row is available again — if it's still missing copy_json, the next tick
-- can retry.
--
-- Idempotent. Safe to re-run.
\set ON_ERROR_STOP on

ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS generation_started_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_generation_lock
  ON helios_social.article_queue (added_at ASC)
  WHERE ingest_status = 'approved_for_draft' AND copy_json IS NULL;
