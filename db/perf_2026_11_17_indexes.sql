-- Performance indexes (perf/REPORT.md). Additive only; rollback: db/perf_2026_11_17_indexes_down.sql.
-- CONCURRENTLY builds without blocking writes. It cannot run inside a transaction block,
-- so apply with plain psql (autocommit):
--   psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/perf_2026_11_17_indexes.sql
-- If a CONCURRENTLY build is interrupted it leaves an INVALID index; the down file drops it,
-- then rerun this file.

-- Per-campaign reads of the send queue: the campaign list's sent/forecast counts
-- (lib/campaigns.ts) and the auto-campaign outreach stats (lib/auto-campaigns/repository.ts).
-- Every existing index on this table leads with owner_id, sender, lane or status, so a
-- campaign_id lookup scanned the owner/campaign/date index from the top. Together with the
-- campaign list's bounced-count CTE this keeps that query's plan under Postgres's JIT
-- threshold: 157 ms (37 ms of it JIT compile) -> 56 ms, no JIT (perf/REPORT.md).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_send_queue_campaign_status_date
    ON outreach.email_send_queue (campaign_id, status, schedule_date);
