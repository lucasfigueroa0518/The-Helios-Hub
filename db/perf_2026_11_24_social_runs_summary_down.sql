-- Rollback for db/perf_2026_11_24_social_runs_summary.sql.
-- Roll the web and worker code back first: it reads these columns.
--   psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/perf_2026_11_24_social_runs_summary_down.sql
-- `record` is untouched by the up file, so nothing is lost.

DROP TRIGGER IF EXISTS social_runs_fill_summary ON social.runs;
DROP FUNCTION IF EXISTS social.runs_fill_summary();
ALTER TABLE social.runs DROP COLUMN IF EXISTS shortlist;
ALTER TABLE social.runs DROP COLUMN IF EXISTS post_summaries;
ALTER TABLE social.runs DROP COLUMN IF EXISTS cost_by_stage;
ALTER TABLE social.runs DROP COLUMN IF EXISTS jev_usd;
