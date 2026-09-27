-- db/helios_social_review_migration.sql — Editorial review state.
--
-- Adds review status + note so a person can approve or reject a generated
-- post before it hits the (future) publishing queue. Without this the
-- system just generates in the dark — a reviewer can't say "yes ship it"
-- or "no, this misreads the story."
--
-- Status meaning:
--   unreviewed      — copy_json exists, waiting on a human read
--   approved        — reviewer signed off, ready to publish
--   needs_revision  — reviewer wants changes; review_note carries the critique.
--                     The author regenerates with that critique; on regenerate
--                     the review state resets so we don't ship stale approvals.
--   rejected        — story shouldn't run at all; kill it. Note optional.
--   published       — reserved for when the publish pipeline lands (Phase 3)
--
-- Idempotent. Safe to re-run — the constraint is dropped and recreated so
-- extending the allowed values doesn't require a separate migration.
\set ON_ERROR_STOP on

ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS review_status text,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by text;

ALTER TABLE helios_social.article_queue
  DROP CONSTRAINT IF EXISTS article_queue_review_status_check;
ALTER TABLE helios_social.article_queue
  ADD CONSTRAINT article_queue_review_status_check
  CHECK (review_status IS NULL OR review_status IN (
    'unreviewed', 'approved', 'needs_revision', 'rejected', 'published'
  ));

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_review_status
  ON helios_social.article_queue (review_status)
  WHERE review_status IS NOT NULL;
