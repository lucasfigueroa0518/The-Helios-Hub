-- The nightly idea-pool refresh queues a social.runs row with trigger 'pool' (score and select, make nothing).
-- Run once, with the worker deploy: psql "$DATABASE_URL" -X -f db/social_runs_pool_trigger.sql
BEGIN;
ALTER TABLE social.runs DROP CONSTRAINT IF EXISTS social_runs_trigger_check;
ALTER TABLE social.runs ADD CONSTRAINT social_runs_trigger_check
  CHECK (trigger IN ('scheduled', 'manual', 'cli', 'pool'));
COMMIT;
