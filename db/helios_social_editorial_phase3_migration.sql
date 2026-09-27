-- db/helios_social_editorial_phase3_migration.sql — Editorial pipeline (Phase 3).
--
-- Adds columns for stages 5-7 of the editorial pipeline:
--   copy_json         (stage 5 output — semantic copy per slide + caption)
--   voice_passed_at   (stage 6 completion — humanizer + polish pass)
--   qa_result         (stage 7 output — check results + issues)
--   qa_pass           (stage 7 verdict — cheap boolean gate for UI queries)
--   qa_passed_at      (stage 7 completion timestamp)
--
-- Idempotent. Safe to re-run.
\set ON_ERROR_STOP on

ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS copy_json       jsonb,
  ADD COLUMN IF NOT EXISTS voice_passed_at timestamptz,
  ADD COLUMN IF NOT EXISTS qa_result       jsonb,
  ADD COLUMN IF NOT EXISTS qa_pass         boolean,
  ADD COLUMN IF NOT EXISTS qa_passed_at    timestamptz;

-- Partial index for the "articles ready to hand to design" query.
CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_qa_pass
  ON helios_social.article_queue (qa_passed_at DESC)
  WHERE qa_pass IS TRUE;
