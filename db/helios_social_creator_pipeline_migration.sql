-- db/helios_social_creator_pipeline_migration.sql
--
-- Creator pipeline foundation: adds columns for the hook and outline
-- checkpoints plus a pipeline_version discriminator so legacy and creator
-- rows can coexist during rollout.
--
-- Idempotent. Safe to re-run.
\set ON_ERROR_STOP on

ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS pipeline_version text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS chosen_hook_final text,
  ADD COLUMN IF NOT EXISTS hook_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS hook_approved_by text,
  ADD COLUMN IF NOT EXISTS outline_json jsonb,
  ADD COLUMN IF NOT EXISTS outline_approved_json jsonb,
  ADD COLUMN IF NOT EXISTS outline_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS outline_approved_by text;

ALTER TABLE helios_social.article_queue
  DROP CONSTRAINT IF EXISTS article_queue_pipeline_version_check;
ALTER TABLE helios_social.article_queue
  ADD CONSTRAINT article_queue_pipeline_version_check
  CHECK (pipeline_version IN ('legacy', 'creator'));

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_pipeline_version
  ON helios_social.article_queue (pipeline_version);

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_creator_hook_pending
  ON helios_social.article_queue (added_at DESC)
  WHERE pipeline_version = 'creator' AND chosen_hook_final IS NULL;

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_creator_outline_pending
  ON helios_social.article_queue (added_at DESC)
  WHERE pipeline_version = 'creator'
    AND chosen_hook_final IS NOT NULL
    AND outline_approved_json IS NULL;
