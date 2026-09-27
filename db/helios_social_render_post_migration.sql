-- db/helios_social_render_post_migration.sql — DB-persist render post.
--
-- Before this migration, the generation pipeline wrote the final render
-- Post JSON to `exports/social/generated/{slug}.json` on the local
-- filesystem. That works in dev but breaks on Vercel serverless where
-- writes made by one function invocation disappear before another can
-- read them. Fix: persist the render JSON + slug in the same row as the
-- editorial output.
--
-- The API routes that serve the preview (`/api/social/generated/[slug]`
-- and `/api/social/generated`) now read from these columns first, with a
-- filesystem fallback for local dev.
--
-- Idempotent. Safe to re-run.
\set ON_ERROR_STOP on

ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS render_post_json jsonb,
  ADD COLUMN IF NOT EXISTS render_slug text;

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_render_slug
  ON helios_social.article_queue (render_slug)
  WHERE render_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_render_ready
  ON helios_social.article_queue (added_at DESC)
  WHERE render_post_json IS NOT NULL;
