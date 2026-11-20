-- Production slowness diagnosis. ONE read-only transaction (safe on the 6543 pooler; no
-- session-level SET, per CLAUDE.md). Run it while the site feels slow, then again when idle:
--   psql "$DATABASE_URL" -X -f perf/db/prod-diagnose.sql
-- Reads catalog views only. Query text is cut to 120 characters (statements use $n
-- parameters, so values are not shown).
BEGIN READ ONLY;

\echo '== 1. Settings that change query cost (D6: jit on = compile time in heavy statements)'
SELECT name, setting, unit FROM pg_settings
 WHERE name IN ('jit', 'jit_above_cost', 'max_connections', 'work_mem', 'statement_timeout', 'server_version')
 ORDER BY name;

\echo '== 2. Who holds connections (helios-web = Vercel; helios-* = each GCP worker service)'
SELECT coalesce(nullif(application_name, ''), '(none)') AS app,
       count(*) AS conns,
       count(*) FILTER (WHERE state = 'active') AS active,
       count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_tx,
       count(*) FILTER (WHERE wait_event_type = 'Lock') AS waiting_on_lock,
       round(max(extract(epoch FROM now() - query_start)) FILTER (WHERE state = 'active')::numeric, 1) AS longest_active_s
  FROM pg_stat_activity
 WHERE datname = current_database() AND pid <> pg_backend_pid()
 GROUP BY 1 ORDER BY conns DESC;

\echo '== 3. Connections used vs the server limit'
SELECT count(*) AS in_use, current_setting('max_connections')::int AS max_connections FROM pg_stat_activity;

\echo '== 4. Statements running longer than 1 s right now'
SELECT application_name AS app, state, wait_event_type, wait_event,
       round(extract(epoch FROM now() - query_start)::numeric, 1) AS running_s,
       left(regexp_replace(query, '\s+', ' ', 'g'), 120) AS query
  FROM pg_stat_activity
 WHERE state <> 'idle' AND pid <> pg_backend_pid() AND now() - query_start > interval '1 second'
 ORDER BY running_s DESC LIMIT 20;

\echo '== 5. Row counts of the tables whose size drives page cost (D2; planner estimates, no scans)'
SELECT n.nspname || '.' || c.relname AS table_name, c.reltuples::bigint AS approx_rows,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS size
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r'
   AND n.nspname || '.' || c.relname IN (
     'boards.cards', 'boards.activity', 'boards.comments', 'boards.checklist_items',
     'outreach.email_send_queue', 'outreach.contacts', 'outreach.drafting_items',
     'social_hub.posts', 'reels.post_ideas', 'stories.sets', 'stories.frames')
 ORDER BY c.reltuples DESC;

\echo '== 6. Slowest statements by mean time (needs pg_stat_statements; if this errors, sections 1-5 still printed)'
SELECT round(mean_exec_time::numeric, 1) AS mean_ms, calls,
       round(total_exec_time::numeric / 1000, 1) AS total_s,
       left(regexp_replace(query, '\s+', ' ', 'g'), 120) AS query
  FROM pg_stat_statements
 WHERE calls > 20
 ORDER BY mean_exec_time DESC LIMIT 15;

ROLLBACK;
