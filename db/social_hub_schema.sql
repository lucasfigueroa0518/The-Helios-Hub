-- db/social_hub_schema.sql — Social Hub account insights and refresh queue (idempotent).
-- Schema `social_hub` inside the existing Helios Supabase Postgres.
-- Spec: planning/Social Hub/PRODUCT_SPEC.md §5.1, §8 (SH-23, SH-24); metric names: META_API_CHECK.md.
-- Additive only: nothing here reads or alters another schema.
--
-- WRITTEN, NOT APPLIED in Phase 1. Apply (a human decision, Phase 2 P2-M1):
--   node scripts/apply_social_hub_schema.js --apply
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS social_hub;

-- ── Account insights, one row per New York day (SH-24: kept forever) ────────
-- GET /{ig-user-id}/insights, period=day, metric_type=total_value. A blank
-- stays NULL (Meta returns an empty set, not 0, when it has nothing).
CREATE TABLE IF NOT EXISTS social_hub.account_insights_daily (
    ny_date                 date PRIMARY KEY,
    captured_at             timestamptz NOT NULL DEFAULT now(),
    reach                   double precision,
    reach_followers         double precision,
    reach_non_followers     double precision,
    views                   double precision,
    accounts_engaged        double precision,
    total_interactions      double precision,
    likes                   double precision,
    comments                double precision,
    saves                   double precision,
    shares                  double precision,
    replies                 double precision,
    reposts                 double precision,
    profile_links_taps      double precision,
    follows                 double precision,
    unfollows               double precision,
    -- Unverified in Meta's docs (META_API_CHECK D3): stored when returned.
    follower_count          double precision,
    raw                     jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ── Demographics snapshots (follower_demographics, engaged_audience_demographics) ──
-- Top 45 per breakdown only; timeframe this_week | this_month | prev_month.
CREATE TABLE IF NOT EXISTS social_hub.account_demographics_daily (
    ny_date         date NOT NULL,
    metric          text NOT NULL CHECK (metric IN ('follower_demographics', 'engaged_audience_demographics')),
    timeframe       text NOT NULL CHECK (timeframe IN ('this_week', 'this_month', 'prev_month')),
    breakdown       text NOT NULL CHECK (breakdown IN ('age', 'gender', 'country', 'city')),
    key             text NOT NULL,
    value           double precision NOT NULL,
    captured_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ny_date, metric, timeframe, breakdown, key)
);

CREATE INDEX IF NOT EXISTS idx_social_hub_demographics_latest
    ON social_hub.account_demographics_daily (metric, breakdown, ny_date DESC);

-- ── Most active times (online_followers; Meta keeps 30 days) ───────────────
-- One row per New York day per hour (0–23, the hour Meta reports in).
CREATE TABLE IF NOT EXISTS social_hub.online_followers_daily (
    ny_date         date NOT NULL,
    hour            smallint NOT NULL CHECK (hour BETWEEN 0 AND 23),
    value           double precision NOT NULL,
    captured_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ny_date, hour)
);

-- ── Refresh queue (SH-23 refresh-on-visit, overnight hub sweep) ────────────
-- The app inserts `requested`; only the worker runs it (Vercel runs no
-- workers). Same single-row unique indexes as reels.runs: at most one
-- running and one queued. The 30-minute cooldown is the worker's claim rule
-- (lib/reels/media-insights/poll.ts claimInsightsPoll pattern).
CREATE TABLE IF NOT EXISTS social_hub.refreshes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger         text NOT NULL CHECK (trigger IN ('visit', 'overnight', 'manual')),
    status          text NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested', 'running', 'ok', 'partial', 'failed', 'skipped')),
    requested_at    timestamptz NOT NULL DEFAULT now(),
    requested_by    text,
    started_at      timestamptz,
    finished_at     timestamptz,
    error           text,
    stats           jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_social_hub_refreshes_recent
    ON social_hub.refreshes (requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_hub_refreshes_single_running
    ON social_hub.refreshes ((status)) WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_hub_refreshes_single_requested
    ON social_hub.refreshes ((status)) WHERE status = 'requested';

-- ── Publishing quota snapshots (P2-M1; OUT_OF_SCOPE #4) ─────────────────────
-- content_publishing_limit as the hub sweep read it; the Content House header
-- shows the newest one from the last 24 hours.
CREATE TABLE IF NOT EXISTS social_hub.publishing_quota (
    captured_at     timestamptz PRIMARY KEY DEFAULT now(),
    quota_usage     double precision NOT NULL,
    quota_total     double precision
);
