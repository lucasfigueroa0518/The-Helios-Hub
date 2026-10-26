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
-- Types join one at a time (expand → backfill → switch → contract). Every
-- definition of a CHECK below carries the FULL final list, so re-running this
-- file over rows of every type never narrows a constraint mid-file (D45).
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
ALTER TABLE social_hub.content_items ADD CONSTRAINT content_items_vertical_check CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days', 'ai_events'));
CREATE INDEX IF NOT EXISTS idx_social_hub_items_idea ON social_hub.content_items (vertical, idea_ref);

-- A person's Delete (never a row removal): the post leaves the hub's lists and its idea
-- returns to the pool, but the item, its approval and its cost history stay.
ALTER TABLE social_hub.content_items ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE social_hub.content_items ADD COLUMN IF NOT EXISTS deleted_by text;

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
-- Explainers: afternoon 1:00–2:30, late 3:30–5:00; Last Few Days: morning
-- 9:00–10:00 on its days, lfd.settings.days).
ALTER TABLE social_hub.schedule DROP CONSTRAINT IF EXISTS schedule_slot_check;
ALTER TABLE social_hub.schedule ADD CONSTRAINT schedule_slot_check CHECK (
    (vertical = 'carousels' AND slot IN ('morning', 'afternoon'))
    OR (vertical = 'explainers' AND slot IN ('afternoon', 'late'))
    OR (vertical = 'reels' AND slot IN ('morning', 'midday', 'evening'))
    OR (vertical = 'stories' AND slot IN ('morning_download', 'guess_the_number', 'free_vs_paid'))
    OR (vertical = 'last_few_days' AND slot IN ('morning'))
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
    (vertical IN ('carousels', 'explainers', 'last_few_days') AND trigger IN ('approve', 'auto', 'force'))
    OR (vertical = 'reels' AND trigger IN ('approve', 'auto', 'mix_test', 'force'))
    OR (vertical = 'stories' AND trigger IN ('approve', 'auto'))
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

-- ════════════════════════════════════════════════════════════════════════════
-- Trial Reels join the spine (D39)
-- ════════════════════════════════════════════════════════════════════════════
-- A Reels item is the video (native_ref = reels.video_jobs.id, idea_ref =
-- post_idea_id). A Reels slot belongs to the post idea and is booked before
-- any video exists, so a schedule row may carry only its idea (idea_ref) until
-- the video is attached when the slot comes due.
ALTER TABLE social_hub.content_items DROP CONSTRAINT IF EXISTS content_items_vertical_check;
ALTER TABLE social_hub.content_items ADD CONSTRAINT content_items_vertical_check CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days', 'ai_events'));

ALTER TABLE social_hub.schedule ALTER COLUMN content_item_id DROP NOT NULL;
ALTER TABLE social_hub.schedule ADD COLUMN IF NOT EXISTS idea_ref text;
-- Trial Reels' approval of an idea's slot, which can come before the slot has
-- a video (and so before there is an item to approve). It is carried onto the
-- item's approval when the video is attached. Other types approve the item.
ALTER TABLE social_hub.schedule ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE social_hub.schedule DROP CONSTRAINT IF EXISTS schedule_item_or_idea_check;
ALTER TABLE social_hub.schedule ADD CONSTRAINT schedule_item_or_idea_check
    CHECK (content_item_id IS NOT NULL OR idea_ref IS NOT NULL);
ALTER TABLE social_hub.schedule DROP CONSTRAINT IF EXISTS schedule_slot_check;
ALTER TABLE social_hub.schedule ADD CONSTRAINT schedule_slot_check CHECK (
    (vertical = 'carousels' AND slot IN ('morning', 'afternoon'))
    OR (vertical = 'explainers' AND slot IN ('afternoon', 'late'))
    OR (vertical = 'reels' AND slot IN ('morning', 'midday', 'evening'))
    OR (vertical = 'stories' AND slot IN ('morning_download', 'guess_the_number', 'free_vs_paid'))
    OR (vertical = 'last_few_days' AND slot IN ('morning'))
);
-- One active slot per Trial Reels idea (the old idx_reels_posting_schedule_idea).
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_hub_schedule_reels_idea
    ON social_hub.schedule (vertical, idea_ref)
    WHERE vertical = 'reels' AND status IN ('scheduled', 'publishing');

-- Trial Reels' payload: audio_id, song_title, song_artist, audio_volume,
-- video_volume, graduation_strategy, share_to_feed, song_pick_id, post_idea_id.
-- mix_test posts the same reel at another mix on purpose (publish_once skips it).
ALTER TABLE social_hub.publish_attempts DROP CONSTRAINT IF EXISTS publish_attempts_trigger_check;
ALTER TABLE social_hub.publish_attempts ADD CONSTRAINT publish_attempts_trigger_check CHECK (
    (vertical IN ('carousels', 'explainers', 'last_few_days') AND trigger IN ('approve', 'auto', 'force'))
    OR (vertical = 'reels' AND trigger IN ('approve', 'auto', 'mix_test', 'force'))
    OR (vertical = 'stories' AND trigger IN ('approve', 'auto'))
);

-- Whether Instagram reports the reel as shared to the feed (Trial Reels).
ALTER TABLE social_hub.media_insights ADD COLUMN IF NOT EXISTS shared_to_feed boolean;

-- ════════════════════════════════════════════════════════════════════════════
-- IG Stories join the spine as a projection (D44; branch feature/stories-on-spine)
-- ════════════════════════════════════════════════════════════════════════════
-- stories.sets stays the source of truth for the Stories app. Every set
-- transition re-projects the set onto the spine (lib/stories/spine.ts): item
-- (native_ref = set id, idea_ref = 'series:ny_date'), approval, one slot
-- (slot = the series), one attempt per publish (frames as child containers;
-- 'partial' when it stopped with frames live), and per-frame insights (the
-- day's latest capture; Stories' navigation metrics and `final` in `extra`).
ALTER TABLE social_hub.content_items DROP CONSTRAINT IF EXISTS content_items_vertical_check;
ALTER TABLE social_hub.content_items ADD CONSTRAINT content_items_vertical_check CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days', 'ai_events'));
ALTER TABLE social_hub.schedule DROP CONSTRAINT IF EXISTS schedule_slot_check;
ALTER TABLE social_hub.schedule ADD CONSTRAINT schedule_slot_check CHECK (
    (vertical = 'carousels' AND slot IN ('morning', 'afternoon'))
    OR (vertical = 'explainers' AND slot IN ('afternoon', 'late'))
    OR (vertical = 'reels' AND slot IN ('morning', 'midday', 'evening'))
    OR (vertical = 'stories' AND slot IN ('morning_download', 'guess_the_number', 'free_vs_paid'))
    OR (vertical = 'last_few_days' AND slot IN ('morning'))
);
ALTER TABLE social_hub.publish_attempts DROP CONSTRAINT IF EXISTS publish_attempts_trigger_check;
ALTER TABLE social_hub.publish_attempts ADD CONSTRAINT publish_attempts_trigger_check CHECK (
    (vertical IN ('carousels', 'explainers', 'last_few_days') AND trigger IN ('approve', 'auto', 'force'))
    OR (vertical = 'reels' AND trigger IN ('approve', 'auto', 'mix_test', 'force'))
    OR (vertical = 'stories' AND trigger IN ('approve', 'auto'))
);

-- ── Day ranking: Promote / Demote (Lucas, 2026-10-09) ───────────────────────
-- A person's moves on one type's idea ranking for one New York day, applied in
-- order on top of that day's score ranking: promote puts the idea first;
-- demote moves it below the idea right under it. Since Phase B (B8) a move lasts
-- until its idea is made (or its Stories pool entry is used): consumed_at.
-- The day's quota goes to the top of the adjusted ranking.
CREATE TABLE IF NOT EXISTS social_hub.idea_adjustments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vertical    text NOT NULL CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days')),
    idea_id     text NOT NULL CHECK (length(btrim(idea_id)) > 0),
    ny_date     date NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('promote', 'demote')),
    created_by  text,
    created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_social_hub_idea_adjustments_day
    ON social_hub.idea_adjustments (ny_date, vertical, created_at);

-- Last Few Days joins the spine (spec 2026-10-13-last-few-days-design §7.2). The
-- inline CHECK above only shapes a new table; an existing one is widened here (D45).
ALTER TABLE social_hub.idea_adjustments DROP CONSTRAINT IF EXISTS idea_adjustments_vertical_check;
ALTER TABLE social_hub.idea_adjustments ADD CONSTRAINT idea_adjustments_vertical_check
    CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days'));

-- Content page Phase B (B8, 2026-10-14): a move steers until it is used, not until midnight.
-- ny_date stays the day it was made. The hub sets consumed_at when it loads (lib/social-hub/queries/day.ts).
ALTER TABLE social_hub.idea_adjustments ADD COLUMN IF NOT EXISTS consumed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_social_hub_idea_adjustments_active
    ON social_hub.idea_adjustments (vertical, created_at) WHERE consumed_at IS NULL;

-- Shared queue (2026-10-14): why the last night couldn't make a promote, and when.
-- A worker overwrites them on each skip; the move stays active (consumed_at stays NULL).
ALTER TABLE social_hub.idea_adjustments ADD COLUMN IF NOT EXISTS skip_reason text;
ALTER TABLE social_hub.idea_adjustments ADD COLUMN IF NOT EXISTS skipped_at timestamptz;

-- Idea pool standard (spec 2026-10-21-idea-pool-standard-design): a person's Pin, drag (place) and
-- Archive are rows here too. `place` carries sort_key, where the drop left the idea in the queue
-- (lib/social-hub/queue.ts); an archive row is permanent (consumed_at stays NULL) and hides its idea.
ALTER TABLE social_hub.idea_adjustments DROP CONSTRAINT IF EXISTS idea_adjustments_kind_check;
ALTER TABLE social_hub.idea_adjustments ADD CONSTRAINT idea_adjustments_kind_check
    CHECK (kind IN ('promote', 'demote', 'pin', 'place', 'archive'));
ALTER TABLE social_hub.idea_adjustments ADD COLUMN IF NOT EXISTS sort_key double precision;

-- Health tab (spec 2026-10-13 §4.3): the 07:30 morning report, one row per night.
CREATE TABLE IF NOT EXISTS social_hub.health_reports (
    night       date PRIMARY KEY,
    built_at    timestamptz NOT NULL,
    verdict     jsonb NOT NULL,
    reports     jsonb NOT NULL,
    failures    jsonb NOT NULL
);

-- ════════════════════════════════════════════════════════════════════════════
-- Weekly slot calendar (docs/superpowers/specs/2026-10-14-weekly-slot-calendar-design.md).
-- The calendar owns when: a standing week of free-time slots (a type at a minute of the
-- New York day) plus single-date overrides. Read only while slot_source = 'template'.
-- ════════════════════════════════════════════════════════════════════════════

-- Free-time slots (calendar week board redesign, 2026-10-20): a slot is a vertical at a
-- minute of the New York day (start_minute, a multiple of 15). Stories also carry their
-- series, so one series can run twice a day. The slot tables were empty in production
-- (slot_source = 'legacy'), so the old window_id shape is dropped in place, once.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'social_hub' AND table_name = 'slot_template' AND column_name = 'window_id') THEN
        LOCK TABLE social_hub.slot_template, social_hub.slot_override IN ACCESS EXCLUSIVE MODE;
        DELETE FROM social_hub.slot_template;
        ALTER TABLE social_hub.slot_template DROP CONSTRAINT IF EXISTS slot_template_window_check;
        ALTER TABLE social_hub.slot_template DROP COLUMN window_id;
        ALTER TABLE social_hub.slot_template ADD COLUMN IF NOT EXISTS start_minute smallint NOT NULL;
        ALTER TABLE social_hub.slot_template ADD COLUMN IF NOT EXISTS series text;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'social_hub' AND table_name = 'slot_override' AND column_name = 'window_id') THEN
        DELETE FROM social_hub.slot_override;
        ALTER TABLE social_hub.slot_override DROP CONSTRAINT IF EXISTS slot_override_window_check;
        ALTER TABLE social_hub.slot_override DROP COLUMN window_id;
        ALTER TABLE social_hub.slot_override ADD COLUMN IF NOT EXISTS start_minute smallint NOT NULL;
        ALTER TABLE social_hub.slot_override ADD COLUMN IF NOT EXISTS series text;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS social_hub.slot_template (
    weekday      smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    vertical     text NOT NULL,
    start_minute smallint NOT NULL,
    series       text,
    feed_mode    text,
    updated_by   text,
    updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE social_hub.slot_template DROP CONSTRAINT IF EXISTS slot_template_start_minute_check;
ALTER TABLE social_hub.slot_template ADD CONSTRAINT slot_template_start_minute_check
    CHECK (start_minute BETWEEN 0 AND 1439 AND start_minute % 15 = 0);
ALTER TABLE social_hub.slot_template DROP CONSTRAINT IF EXISTS slot_template_series_check;
ALTER TABLE social_hub.slot_template ADD CONSTRAINT slot_template_series_check CHECK (
    (vertical = 'stories' AND series IS NOT NULL AND series IN ('morning_download', 'guess_the_number', 'free_vs_paid'))
    OR (vertical <> 'stories' AND series IS NULL)
);
-- Trial / Main feed exists only for reel types.
ALTER TABLE social_hub.slot_template DROP CONSTRAINT IF EXISTS slot_template_feed_mode_check;
ALTER TABLE social_hub.slot_template ADD CONSTRAINT slot_template_feed_mode_check CHECK (
    (vertical IN ('reels', 'explainers') AND feed_mode IS NOT NULL AND feed_mode IN ('trial', 'main'))
    OR (vertical NOT IN ('reels', 'explainers') AND feed_mode IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_hub_slot_template_key
    ON social_hub.slot_template (weekday, vertical, start_minute, (coalesce(series, '')));

-- One date's exceptions. An 'add' on a template key replaces it for that date
-- (that is how a single-date Trial/Main flip is stored).
CREATE TABLE IF NOT EXISTS social_hub.slot_override (
    ny_date      date NOT NULL,
    vertical     text NOT NULL,
    start_minute smallint NOT NULL,
    series       text,
    action       text NOT NULL CHECK (action IN ('add', 'remove')),
    feed_mode    text,
    updated_by   text,
    updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE social_hub.slot_override DROP CONSTRAINT IF EXISTS slot_override_start_minute_check;
ALTER TABLE social_hub.slot_override ADD CONSTRAINT slot_override_start_minute_check
    CHECK (start_minute BETWEEN 0 AND 1439 AND start_minute % 15 = 0);
ALTER TABLE social_hub.slot_override DROP CONSTRAINT IF EXISTS slot_override_series_check;
ALTER TABLE social_hub.slot_override ADD CONSTRAINT slot_override_series_check CHECK (
    (vertical = 'stories' AND series IS NOT NULL AND series IN ('morning_download', 'guess_the_number', 'free_vs_paid'))
    OR (vertical <> 'stories' AND series IS NULL)
);
ALTER TABLE social_hub.slot_override DROP CONSTRAINT IF EXISTS slot_override_feed_mode_check;
ALTER TABLE social_hub.slot_override ADD CONSTRAINT slot_override_feed_mode_check CHECK (
    (action = 'remove' AND feed_mode IS NULL)
    OR (action = 'add' AND vertical IN ('reels', 'explainers') AND feed_mode IS NOT NULL AND feed_mode IN ('trial', 'main'))
    OR (action = 'add' AND vertical NOT IN ('reels', 'explainers') AND feed_mode IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_hub_slot_override_key
    ON social_hub.slot_override (ny_date, vertical, start_minute, (coalesce(series, '')));
CREATE INDEX IF NOT EXISTS idx_social_hub_slot_override_date ON social_hub.slot_override (ny_date);

-- Free-time booking ids: t + the start minute (4 digits), Stories add :series. They sit
-- beside the window ids, which legacy mode still books.
ALTER TABLE social_hub.schedule DROP CONSTRAINT IF EXISTS schedule_slot_check;
ALTER TABLE social_hub.schedule ADD CONSTRAINT schedule_slot_check CHECK (
    (vertical = 'carousels' AND slot IN ('morning', 'afternoon'))
    OR (vertical = 'explainers' AND slot IN ('afternoon', 'late'))
    OR (vertical = 'reels' AND slot IN ('morning', 'midday', 'evening'))
    OR (vertical = 'stories' AND slot IN ('morning_download', 'guess_the_number', 'free_vs_paid'))
    OR (vertical = 'last_few_days' AND slot IN ('morning'))
    OR slot ~ '^t[0-9]{4}(:[a-z_]+)?$'
);

-- A booking keeps the slot's Trial/Main as it was when placed; posting reads it.
ALTER TABLE social_hub.schedule ADD COLUMN IF NOT EXISTS feed_mode text;
ALTER TABLE social_hub.schedule DROP CONSTRAINT IF EXISTS schedule_feed_mode_check;
ALTER TABLE social_hub.schedule ADD CONSTRAINT schedule_feed_mode_check CHECK (
    feed_mode IS NULL OR (vertical IN ('reels', 'explainers') AND feed_mode IN ('trial', 'main'))
);

-- Who set a date edit or a booking (calendar type schedules, 2026-10-21): 'person' (board,
-- batch, placement, reschedule, drags) or 'system' (pins the calendar writes itself). A
-- schedule save moves only the system's bookings. NULL reads as 'system'; a booking with
-- source 'user' reads as 'person'. Additive, safe in either deploy order (R3).
ALTER TABLE social_hub.slot_override ADD COLUMN IF NOT EXISTS set_by text CHECK (set_by IN ('person','system'));
ALTER TABLE social_hub.schedule ADD COLUMN IF NOT EXISTS slot_by text CHECK (slot_by IN ('person','system'));

-- Who decides cadence: 'legacy' (each type's settings, as before) or 'template' (the calendar).
INSERT INTO social_hub.settings (key, value) VALUES ('slot_source', '"legacy"'::jsonb) ON CONFLICT (key) DO NOTHING;

-- Daily caps per type (calendar week board): the most a day may book.
INSERT INTO social_hub.settings (key, value) VALUES
    ('daily_caps', '{"reels":5,"explainers":3,"carousels":3,"last_few_days":1,"stories":2}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Every caption type logs its closing paragraph here; it feeds recent-closings and the
-- build-line ceiling (social captions redesign, 2026-10-19).
CREATE TABLE IF NOT EXISTS social_hub.caption_closings (
    id          bigserial PRIMARY KEY,
    type        text NOT NULL CHECK (type IN ('carousel','reel','explainer','lfd')),
    subject_id  text NOT NULL,
    closing     text NOT NULL,
    build_line  boolean NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS caption_closings_type_created
    ON social_hub.caption_closings (type, created_at DESC);
