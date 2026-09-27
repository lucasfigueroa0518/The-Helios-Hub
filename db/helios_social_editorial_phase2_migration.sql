-- db/helios_social_editorial_phase2_migration.sql — Editorial pipeline (Phase 2).
--
-- Adds the columns for stages 3-4 of the editorial pipeline:
--   strategy           (stage 3: value type + arousal/curiosity/knowledge scores + primary/secondary)
--   bucket             (stage 3: one of the 7 buckets from editorial skill §3)
--   story_plan         (stage 4: beat-per-slide plan, 8-11 slides)
--   plan_generated_at  (stage 4: when the plan was built)
--
-- Idempotent. Safe to re-run.
\set ON_ERROR_STOP on

ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS strategy          jsonb,
  ADD COLUMN IF NOT EXISTS bucket            text,
  ADD COLUMN IF NOT EXISTS story_plan        jsonb,
  ADD COLUMN IF NOT EXISTS plan_generated_at timestamptz;

-- Bucket CHECK — align with the 7 values in the editorial skill §3.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'helios_social.article_queue'::regclass
      AND conname = 'article_queue_bucket_check'
  ) THEN
    ALTER TABLE helios_social.article_queue
      ADD CONSTRAINT article_queue_bucket_check
      CHECK (bucket IS NULL OR bucket IN (
        'what_just_happened',
        'the_bigger_story',
        'power_play',
        'person_profile',
        'what_to_know',
        'the_research_says',
        'use_it'
      ));
  END IF;
END $$;

-- Partial index for the "articles ready to compose" query.
CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_plan_ready
  ON helios_social.article_queue (plan_generated_at DESC)
  WHERE story_plan IS NOT NULL;
