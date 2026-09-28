-- db/helios_social_pipeline_v2_migration.sql
--
-- v2 creator pipeline: one JSONB column for the full per-article debug
-- transcript (brief, sources, draft, edited, caption, every fact-check
-- round + repair), plus a `needs_human_review` compose_status value for
-- posts the pipeline stops on (3-round fact-check exhaust, unrecoverable
-- code-check failure, no-fetchable-sources, or per-run cost cap trip).
--
-- Additive only. Idempotent. Safe to re-run.
\set ON_ERROR_STOP on

-- ── 1. article_queue.pipeline_v2_debug ────────────────────────────────
-- Full per-run stage transcript. See lib/social/editorial/v2/log.ts for
-- the PipelineV2Debug shape. Reader-friendly for "which stage caused this
-- to look wrong" debugging without a re-run.

ALTER TABLE helios_social.article_queue
    ADD COLUMN IF NOT EXISTS pipeline_v2_debug jsonb;

-- ── 2. Extend compose_status CHECK with 'needs_human_review' ─────────
-- The v2 pipeline lands here when it can't finish safely. Existing values
-- unchanged; existing legacy rows unaffected.

DO $$
DECLARE
    existing_constraint text;
BEGIN
    SELECT conname INTO existing_constraint
    FROM pg_constraint
    WHERE conrelid = 'helios_social.article_queue'::regclass
      AND conname = 'article_queue_compose_status_check'
    LIMIT 1;

    IF existing_constraint IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE helios_social.article_queue DROP CONSTRAINT %I',
            existing_constraint
        );
    END IF;

    ALTER TABLE helios_social.article_queue
        ADD CONSTRAINT article_queue_compose_status_check
        CHECK (compose_status IS NULL OR compose_status IN (
            'pending_compose','composing','composed','compose_failed',
            'needs_human_review'
        ));
END $$;

-- ── 3. Index for creator-row cron selection ──────────────────────────
-- Used by the updated cron predicate in
-- app/api/social/generate/next/route.ts (feature/helios-social-pipeline-v2
-- branch). Partial so the index stays tiny — legacy rows never match.

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_creator_pending_compose
    ON helios_social.article_queue (added_at ASC)
    WHERE pipeline_version = 'creator'
      AND render_post_json IS NULL
      AND (compose_status = 'pending_compose' OR compose_status IS NULL);
