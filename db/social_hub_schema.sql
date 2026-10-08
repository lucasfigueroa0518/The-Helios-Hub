-- db/social_hub_schema.sql — Social Hub account insights, refresh queue, and the
-- lifecycle spine every content type shares (idempotent).
-- Schema `social_hub` inside the existing Helios Supabase Postgres.
-- Spec: planning/Social Hub/PRODUCT_SPEC.md §5.1, §8 (SH-23, SH-24); metric names: META_API_CHECK.md;
-- the spine: DECISIONS_LOG D36.
-- Additive only: nothing here reads or alters another schema.
--
-- Apply (a human decision):
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

-- ── Account settings (unification Move 5–6, D40) ────────────────────────────
-- Settings that belong to the one Instagram account, not to a content type.
-- Each type keeps its own settings table for its own switches.
CREATE TABLE IF NOT EXISTS social_hub.settings (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Fail a publish when fewer than this many posts are left in the account's 24 h quota.
INSERT INTO social_hub.settings (key, value) VALUES ('quota_reserve', '5'::jsonb) ON CONFLICT (key) DO NOTHING;
-- Who posts: 'off' (each type's worker, as before), 'shadow' (the publisher only
-- logs what it would do), 'live' (the publisher posts; the type workers stand down).
INSERT INTO social_hub.settings (key, value) VALUES ('publisher_mode', '"off"'::jsonb) ON CONFLICT (key) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- The lifecycle spine (backend unification Move 3; plan in
-- planning/Social Hub/DECISIONS_LOG.md D36). Every content type is made its own
-- way (social.posts, reels.video_jobs, explainers.jobs, stories.sets), but after
-- that it lives the same life: approved → placed on the calendar → posted →
-- measured. These tables hold that life for every type.
--
-- Types join one at a time (expand → backfill → switch → contract). The CHECKs
-- that list a type's values say which types have joined: Carousels, Explainers.
-- No foreign key points into a type's content tables: content can be deleted
-- (Trial Reels retention) while its publishing record must outlive it.
-- ════════════════════════════════════════════════════════════════════════════

-- One postable unit, created once and never deleted: its id is the stable
-- identity the hub follows from "content ready" through "published".
CREATE TABLE IF NOT EXISTS social_hub.content_items (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vertical        text NOT NULL,
    format          text NOT NULL CHECK (format IN ('feed', 'reel', 'story')),
    -- The type's own id for the content (Carousels: social.posts.id; Explainers: explainers.jobs.id).
    native_ref      text NOT NULL,
    -- The post idea it was made for (Carousels: the news story_id; Explainers: the topic id).
    idea_ref        text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (vertical, native_ref)
);
ALTER TABLE social_hub.content_items DROP CONSTRAINT IF EXISTS content_items_vertical_check;
ALTER TABLE social_hub.content_items ADD CONSTRAINT content_items_vertical_check CHECK (vertical IN ('carousels', 'explainers'));
CREATE INDEX IF NOT EXISTS idx_social_hub_items_idea ON social_hub.content_items (vertical, idea_ref);

-- A person's (or a setting's) decision on one item. One current decision per
-- item: approving content approves it wherever it lands on the calendar.
CREATE TABLE IF NOT EXISTS social_hub.approvals (
    content_item_id uuid PRIMARY KEY REFERENCES social_hub.content_items (id),
    decision        text NOT NULL CHECK (decision IN ('approved', 'rejected')),
    decided_at      timestamptz NOT NULL DEFAULT now(),
    decided_by      text,
    -- user: a click in the hub or a review page; force: Hard publish (SH-17);
    -- auto: the type's own rule; setting: require_approval was off.
    via             text NOT NULL CHECK (via IN ('user', 'force', 'auto', 'setting'))
);

-- One placement on the calendar.
CREATE TABLE IF NOT EXISTS social_hub.schedule (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content_item_id     uuid NOT NULL REFERENCES social_hub.content_items (id),
    vertical            text NOT NULL,
    ny_date             date NOT NULL,
    slot                text NOT NULL,
    publish_at          timestamptz NOT NULL,
    status              text NOT NULL CHECK (status IN ('scheduled', 'publishing', 'published', 'cancelled', 'failed')),
    source              text NOT NULL CHECK (source IN ('auto', 'user')),
    publish_attempt_id  uuid,
    error               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    -- The row's id in the type's old posting_schedule, when it was copied over.
    legacy_id           uuid UNIQUE
);
-- Each type's windows (Carousels: morning 9:00–10:00, afternoon 2:30–3:30;
-- Explainers: afternoon 1:00–2:30, late 3:30–5:00).
ALTER TABLE social_hub.schedule DROP CONSTRAINT IF EXISTS schedule_slot_check;
ALTER TABLE social_hub.schedule ADD CONSTRAINT schedule_slot_check CHECK (
    (vertical = 'carousels' AND slot IN ('morning', 'afternoon'))
    OR (vertical = 'explainers' AND slot IN ('afternoon', 'late'))
);
CREATE INDEX IF NOT EXISTS idx_social_hub_schedule_due
    ON social_hub.schedule (publish_at) WHERE status = 'scheduled';
-- One item per window per day, per type.
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_hub_schedule_slot
    ON social_hub.schedule (vertical, ny_date, slot) WHERE status IN ('scheduled', 'publishing', 'published');
-- An item waits in one slot at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_hub_schedule_item
    ON social_hub.schedule (content_item_id) WHERE status IN ('scheduled', 'publishing');

-- One try at posting an item: requested → creating → processing → publishing →
-- published | failed (| partial: a Story set that stopped with frames live).
CREATE TABLE IF NOT EXISTS social_hub.publish_attempts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content_item_id     uuid NOT NULL REFERENCES social_hub.content_items (id),
    vertical            text NOT NULL,
    trigger             text NOT NULL,
    status              text NOT NULL CHECK (status IN (
                          'requested', 'creating', 'processing', 'publishing', 'published', 'failed', 'partial'
                        )),
    requested_at        timestamptz NOT NULL DEFAULT now(),
    started_at          timestamptz,
    finished_at         timestamptz,
    caption             text NOT NULL,
    -- What the type posts, in its own shape (Carousels: {"image_objects": [...]};
    -- Explainers: {"video_object": "...", "share_to_feed": true}).
    payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Containers made before the final one (carousel children, story frames).
    child_container_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    container_id        text,
    media_id            text,
    permalink           text,
    status_log          jsonb NOT NULL DEFAULT '[]'::jsonb,
    error               text,
    insights_checked_at timestamptz,
    insights_settled_at timestamptz,
    legacy_id           uuid UNIQUE
);
ALTER TABLE social_hub.publish_attempts DROP CONSTRAINT IF EXISTS publish_attempts_trigger_check;
ALTER TABLE social_hub.publish_attempts ADD CONSTRAINT publish_attempts_trigger_check CHECK (
    (vertical IN ('carousels', 'explainers') AND trigger IN ('approve', 'auto', 'force'))
);
CREATE INDEX IF NOT EXISTS idx_social_hub_publish_recent ON social_hub.publish_attempts (requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_hub_publish_inflight
    ON social_hub.publish_attempts (content_item_id) WHERE status IN ('requested', 'creating', 'processing', 'publishing');
-- An item posts once. Trial Reels' mix_test is the one deliberate repeat.
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_hub_publish_once
    ON social_hub.publish_attempts (content_item_id) WHERE status = 'published' AND trigger <> 'mix_test';
CREATE INDEX IF NOT EXISTS idx_social_hub_publish_insights_open
    ON social_hub.publish_attempts (finished_at DESC)
    WHERE status = 'published' AND insights_settled_at IS NULL AND media_id IS NOT NULL;

-- Lifetime totals per published media, one row per New York day asked
-- (due/settle rules: lib/instagram/insights-rules.ts). A type's own metrics
-- go in `extra`; the shared ones have columns.
CREATE TABLE IF NOT EXISTS social_hub.media_insights (
    media_id             text NOT NULL,
    ny_date              date NOT NULL,
    vertical             text NOT NULL,
    publish_attempt_id   uuid REFERENCES social_hub.publish_attempts (id) ON DELETE CASCADE,
    captured_at          timestamptz NOT NULL DEFAULT now(),
    views                double precision,
    reach                double precision,
    likes                double precision,
    comments             double precision,
    saved                double precision,
    shares               double precision,
    total_interactions   double precision,
    follows              double precision,
    profile_visits       double precision,
    extra                jsonb NOT NULL DEFAULT '{}'::jsonb,
    raw                  jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (media_id, ny_date)
);
CREATE INDEX IF NOT EXISTS idx_social_hub_media_insights_attempt
    ON social_hub.media_insights (publish_attempt_id, ny_date DESC);
-- Reel metrics (Explainers, Trial Reels): watch time in ms, skip rate as a 0–1 share of plays.
ALTER TABLE social_hub.media_insights ADD COLUMN IF NOT EXISTS reposts double precision;
ALTER TABLE social_hub.media_insights ADD COLUMN IF NOT EXISTS avg_watch_time_ms double precision;
ALTER TABLE social_hub.media_insights ADD COLUMN IF NOT EXISTS total_watch_time_ms double precision;
ALTER TABLE social_hub.media_insights ADD COLUMN IF NOT EXISTS skip_rate double precision;
