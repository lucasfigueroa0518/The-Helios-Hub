-- Rollback for db/perf_2026_11_17_indexes.sql.
--   psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/perf_2026_11_17_indexes_down.sql
DROP INDEX CONCURRENTLY IF EXISTS outreach.idx_email_send_queue_campaign_status_date;
