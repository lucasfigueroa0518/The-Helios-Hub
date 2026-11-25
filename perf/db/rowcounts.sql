-- Read-only production row counts for perf/db/volumes.json.
-- One read-only transaction, no session SET (CLAUDE.md standing rule 2026-10-14):
--   psql "$DATABASE_URL" -X -A -F, -f perf/db/rowcounts.sql > rowcounts.csv
BEGIN READ ONLY;
SELECT schemaname || '.' || relname AS table, n_live_tup AS rows
  FROM pg_stat_user_tables
 WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', 'supabase_functions', 'vault', 'extensions', 'graphql', 'pgsodium', 'net', 'cron')
 ORDER BY n_live_tup DESC;
ROLLBACK;
