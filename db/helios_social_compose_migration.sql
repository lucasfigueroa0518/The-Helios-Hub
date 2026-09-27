-- db/migrations/helios_social_add_compose_columns.sql — Compose integration.
-- Adds the columns the auto-compose pipeline needs:
--   1. helios_social.posts.post_json — full Post JSON (matches render/types.ts)
--   2. helios_social.posts.story_type CHECK — align with render/types.ts StoryType
--   3. helios_social.article_queue.compose_status — track compose lifecycle
--   4. helios_social.article_queue.compose_error — surface the last failure
--
-- Idempotent. Safe to re-run.
\set ON_ERROR_STOP on

-- ── 1. posts.post_json — the full serialized Post ────────────────────────
-- Stage 2 output. The composePost server action writes a validated Post JSON
-- here after Haiku generates it. `facts_json` (Stage 1) stays as-is for
-- extraction packet storage.

ALTER TABLE helios_social.posts
    ADD COLUMN IF NOT EXISTS post_json jsonb;

-- ── 2. posts.story_type CHECK — align to StoryType enum ──────────────────
-- The old constraint allowed only ('deal','data_story','photo_led',
-- 'platform_change') — a v0 vocabulary. render/types.ts is the source of
-- truth for the design system, so we widen the CHECK to match its
-- StoryType union. Old rows keep their values; the new set includes 'deal'
-- so existing 'deal' rows stay valid.

DO $$
DECLARE
    existing_constraint text;
BEGIN
    SELECT conname INTO existing_constraint
    FROM pg_constraint
    WHERE conrelid = 'helios_social.posts'::regclass
      AND conname LIKE 'posts_story_type%'
    LIMIT 1;

    IF existing_constraint IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE helios_social.posts DROP CONSTRAINT %I',
            existing_constraint
        );
    END IF;

    ALTER TABLE helios_social.posts
        ADD CONSTRAINT posts_story_type_check CHECK (story_type IN (
            'ai_funding','model_launch','agents','safety','policy',
            'infrastructure','benchmark','leadership','deal','research','tech'
        ));
END $$;

-- ── 3. article_queue.compose_status — lifecycle tracker ──────────────────
-- NULL              — pending_score or rejected; compose not applicable
-- 'pending_compose' — flipped to approved_for_draft, compose queued
-- 'composing'       — Haiku call in flight
-- 'composed'        — Post JSON written to posts.post_json; drafted_post_id set
-- 'compose_failed'  — retry hit its limit; a human hits "Regenerate" to try again

ALTER TABLE helios_social.article_queue
    ADD COLUMN IF NOT EXISTS compose_status text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'helios_social.article_queue'::regclass
          AND conname = 'article_queue_compose_status_check'
    ) THEN
        ALTER TABLE helios_social.article_queue
            ADD CONSTRAINT article_queue_compose_status_check
            CHECK (compose_status IS NULL OR compose_status IN (
                'pending_compose','composing','composed','compose_failed'
            ));
    END IF;
END $$;

-- ── 4. article_queue.compose_error — last failure reason ─────────────────
-- Populated when compose_status = 'compose_failed'. Shown in the UI so the
-- human can see why (bad JSON, banned verb, all photos used, etc.) before
-- hitting Regenerate.

ALTER TABLE helios_social.article_queue
    ADD COLUMN IF NOT EXISTS compose_error text;

-- ── Index for the compose worker's polling query ─────────────────────────
-- Optional but cheap: helps the "find all articles waiting to compose" query
-- if we later move compose to a background worker instead of firing at
-- approved_for_draft transition time.

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_compose_pending
    ON helios_social.article_queue (compose_status)
    WHERE compose_status IN ('pending_compose','compose_failed');
