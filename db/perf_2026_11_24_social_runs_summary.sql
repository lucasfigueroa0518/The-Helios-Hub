-- Social Hub speed: small columns beside social.runs.record (2026-11-24).
-- Rollback: db/perf_2026_11_24_social_runs_summary_down.sql.
--
-- `record` is the whole run.json: about 1 MB compressed per row, up to 3.8 MB.
-- Every `record->...` in a query decompresses all of it, once per reference
-- and per row, so the hub's cost, carousel and idea reads took 3-12 s for 46
-- rows. The hub reads only a few fields. They now live in their own columns,
-- each stored (and TOASTed) on its own, so a read touches only what it needs:
--   jev_usd         record.jev.costUsd
--   cost_by_stage   record.result.costByStage
--   post_summaries  record.result.posts, each cut to {storyId, costUsd, checks}
--   shortlist       record.selection.shortlist (the idea pool, ~300 KB)
-- A trigger fills them from `record` on every write that sets `record`, so no
-- writer (the daily run, finishRun, scripts, test fixtures) can leave them
-- behind. The trigger only copies fields out of the JSON being written.
--
-- Apply (before the web and worker code that reads these columns):
--   psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/perf_2026_11_24_social_runs_summary.sql
-- Locks: ADD COLUMN without a default is metadata only; the backfill rewrites
-- 46 rows. The same block is kept at the end of db/social_schema.sql.

ALTER TABLE social.runs ADD COLUMN IF NOT EXISTS jev_usd numeric;
ALTER TABLE social.runs ADD COLUMN IF NOT EXISTS cost_by_stage jsonb;
ALTER TABLE social.runs ADD COLUMN IF NOT EXISTS post_summaries jsonb;
ALTER TABLE social.runs ADD COLUMN IF NOT EXISTS shortlist jsonb;

-- Never throws on odd JSON: a field of the wrong type is stored as NULL, so a
-- malformed record can never fail the run's write.
CREATE OR REPLACE FUNCTION social.runs_fill_summary() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  posts jsonb := NEW.record->'result'->'posts';
BEGIN
  NEW.jev_usd := CASE WHEN jsonb_typeof(NEW.record->'jev'->'costUsd') = 'number'
                      THEN (NEW.record->'jev'->>'costUsd')::numeric END;
  NEW.cost_by_stage := CASE WHEN jsonb_typeof(NEW.record->'result'->'costByStage') = 'object'
                            THEN NEW.record->'result'->'costByStage' END;
  NEW.shortlist := CASE WHEN jsonb_typeof(NEW.record->'selection'->'shortlist') = 'array'
                        THEN NEW.record->'selection'->'shortlist' END;
  NEW.post_summaries := CASE WHEN jsonb_typeof(posts) = 'array' THEN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'storyId', e->>'storyId',
             'costUsd', CASE WHEN jsonb_typeof(e->'costUsd') = 'number' THEN e->'costUsd' END,
             'checks', e->'checks') ORDER BY n), '[]'::jsonb)
      FROM jsonb_array_elements(posts) WITH ORDINALITY AS x(e, n)) END;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS social_runs_fill_summary ON social.runs;
CREATE TRIGGER social_runs_fill_summary
  BEFORE INSERT OR UPDATE OF record ON social.runs
  FOR EACH ROW EXECUTE FUNCTION social.runs_fill_summary();

-- Backfill: rows written before the trigger. Setting record to itself fires it.
-- Copies fields out of each row's own JSON; nothing is fetched or enriched.
-- Rows already filled are skipped, so rerunning this file is cheap.
UPDATE social.runs SET record = record
 WHERE jev_usd IS NULL AND cost_by_stage IS NULL AND post_summaries IS NULL AND shortlist IS NULL;
