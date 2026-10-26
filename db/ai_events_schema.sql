-- db/ai_events_schema.sql — AI Events This Week (planning/AI Events/DECISIONS.md, AE-01). Idempotent, additive.
-- Needs db/networking_schema.sql applied first (pool rows reference networking.events).
-- Apply:
--   node scripts/apply_ai_events_schema.js
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS ai_events;

-- ── Runs (plan M4; the lfd.runs pattern) ────────────────────────────────────
-- One row per run: the Sunday 12:00 clock or a person's Generate ('build': rank the coming
-- week with Jev, pick, draw, render), or a person's "Rebuild post" ('rebuild': the same from
-- the cached scores, no Jev call, the post's hook and look kept). Only the helios-social
-- worker (or scripts/ai_events_once.ts) carries a run out; the hub only queues one.
-- This type makes no Claude calls: claude_usd stays 0 and is kept so the cost ledger reads
-- every type's runs alike.

CREATE TABLE IF NOT EXISTS ai_events.runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger         text NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
    kind            text NOT NULL DEFAULT 'build' CHECK (kind IN ('build', 'rebuild')),
    status          text NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested', 'running', 'ok', 'partial', 'failed', 'skipped')),
    requested_at    timestamptz NOT NULL DEFAULT now(),
    requested_by    text,
    started_at      timestamptz,
    finished_at     timestamptz,
    ny_date         date,
    -- The week the run covers ("2026-W44"): set when queued for a rebuild, else when claimed.
    week_key        text,
    cap_usd         double precision NOT NULL DEFAULT 0.5,
    claude_usd      double precision NOT NULL DEFAULT 0,
    jev_usd         double precision NOT NULL DEFAULT 0,
    total_usd       double precision NOT NULL DEFAULT 0,
    stop_reason     text,
    error           text,
    record          jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_events_runs_single_running ON ai_events.runs ((status)) WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_events_runs_single_requested ON ai_events.runs ((status)) WHERE status = 'requested';

-- ── Settings (read by lib/ai-events/settings.ts; written by lib/content-type/posting.ts) ──
-- Shipped off: no clock run, nothing booked or posted, every post waits for a person.

CREATE TABLE IF NOT EXISTS ai_events.settings (
    key             text PRIMARY KEY,
    value           jsonb NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ai_events.settings (key, value) VALUES ('auto_run', 'false'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO ai_events.settings (key, value) VALUES ('publishing_live', 'false'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO ai_events.settings (key, value) VALUES ('require_approval', 'true'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO ai_events.settings (key, value) VALUES ('days', '[0]'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO ai_events.settings (key, value) VALUES ('run_cap_usd', '0.5'::jsonb) ON CONFLICT (key) DO NOTHING;

-- ── Posts ───────────────────────────────────────────────────────────────────
-- One carousel per city per week (AE-29, Miami and Boston; one that is not rejected: the
-- partial unique index below). ny_date is the Sunday it posts (the day before its week). look is
-- the AE-13 draw and hook reads 'ranked' (the hook bank is retired), both kept on every rebuild;
-- a rebuild re-renders the same row (render_version + 1, new slide objects), so the post keeps
-- its spine item, approval and slot. cities is the builder's input (the picks per city,
-- lib/ai-events/types.ts CityPicks); event_ids are the picked networking.events ids, #1 first.

CREATE TABLE IF NOT EXISTS ai_events.posts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          uuid REFERENCES ai_events.runs (id) ON DELETE SET NULL,
    week_key        text NOT NULL,
    slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
    ny_date         date NOT NULL,
    status          text NOT NULL DEFAULT 'review' CHECK (status IN ('preview', 'review', 'published', 'rejected')),
    hook            text NOT NULL,
    look            text NOT NULL CHECK (look IN ('spotlight', 'glass', 'daylight', 'orb')),
    event_ids       text[] NOT NULL DEFAULT '{}',
    cities          jsonb NOT NULL,
    render          jsonb NOT NULL,
    caption         text NOT NULL,
    render_version  integer NOT NULL DEFAULT 1,
    slide_objects   jsonb,
    -- Render-fit problems. A run that has any throws before uploading, so a stored post has none.
    fit_problems    jsonb NOT NULL DEFAULT '[]'::jsonb,
    render_problems jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    published_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ai_events_posts_ny_date ON ai_events.posts (ny_date DESC);

-- AE-29: one ranked carousel per city per week (Miami, Boston). metro is the post's city
-- (rows written before this read NULL: the four-city post). bar_tier is the history bar the
-- picks cleared (AE-28: top30, top40, top50 or gates). The hook bank is retired for these
-- posts; hook then reads 'ranked'.
ALTER TABLE ai_events.posts ADD COLUMN IF NOT EXISTS metro text CHECK (metro IN ('boston', 'miami', 'nyc', 'sf'));
ALTER TABLE ai_events.posts ADD COLUMN IF NOT EXISTS bar_tier text CHECK (bar_tier IN ('top30', 'top40', 'top50', 'gates'));
DROP INDEX IF EXISTS ai_events.idx_ai_events_posts_one_per_week;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_events_posts_one_per_week_city
    ON ai_events.posts (week_key, coalesce(metro, 'all')) WHERE status <> 'rejected';

-- ── Weekly ranked pool (plan M2 step 6, AE-04) ──────────────────────────────
-- One row per candidate event per week, written by lib/networking/pick/rank.ts: rank within
-- the city (1 = best; NULL once the event drops out of the week's candidates), the score
-- (NULL when a gate failed), the failed gates, and whether it is a pick. pick_rank is the
-- pick's place in the city (1..3, pins first; NULL when not picked), which the carousel and
-- the public calendar both show. pinned_* and excluded_* are set by the hub's pool actions
-- only (lib/ai-events/pool.ts); a ranking run never overwrites them.

CREATE TABLE IF NOT EXISTS ai_events.pool (
    week_key     text NOT NULL,
    event_id     uuid NOT NULL REFERENCES networking.events (id) ON DELETE CASCADE,
    metro        text NOT NULL
                     CHECK (metro IN ('boston', 'miami', 'nyc', 'sf')),
    rank         integer,
    score        numeric,
    gate         text,
    picked       boolean NOT NULL DEFAULT false,
    pick_rank    integer,
    pinned_by    text,
    pinned_at    timestamptz,
    excluded_by  text,
    excluded_at  timestamptz,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (week_key, event_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_events_pool_week_metro_rank
    ON ai_events.pool (week_key, metro, rank);

-- AE-27/28/30: partner is the partner host's name when the event is a partner's (it skips the
-- gates and the bar), else NULL. score_version is the formula behind score ('v2'); the history
-- bar reads only scores of the current version. Rows written before v2 read NULL until
-- scripts/ai_events_rescore_history.ts recomputes them from the cached Jev answers.
ALTER TABLE ai_events.pool ADD COLUMN IF NOT EXISTS partner text;
ALTER TABLE ai_events.pool ADD COLUMN IF NOT EXISTS score_version text;
CREATE INDEX IF NOT EXISTS idx_ai_events_pool_metro_history
    ON ai_events.pool (metro, week_key) WHERE score IS NOT NULL AND gate IS NULL;
