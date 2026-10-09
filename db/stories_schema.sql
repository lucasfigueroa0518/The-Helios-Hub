-- db/stories_schema.sql — Instagram Stories version one (idempotent).
-- Schema `stories` inside the existing Helios Supabase Postgres. Additive:
-- nothing here alters the `reels` or `social` schemas
-- (planning/Stories/BUILD_PLAN.md §4). Tests run this file on PGlite.
--
-- Apply (Lucas's go-ahead first: DATABASE_URL is the shared production DB):
--   npm run db:stories
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS stories;

-- ── Sets (plan §4) ─────────────────────────────────────────────────────────
-- One Story set: a series on a New York date. The app inserts `requested`
-- rows (Generate) and approves; the worker builds, renders, schedules and
-- publishes. One live set per series per day; a rejected, failed or skipped
-- set frees the day for a regenerate.

CREATE TABLE IF NOT EXISTS stories.sets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    series          text NOT NULL CHECK (series IN ('morning_download', 'guess_the_number', 'free_vs_paid')),
    ny_date         date NOT NULL,
    status          text NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested', 'building', 'ready', 'approved', 'scheduled',
                                        'publishing', 'published', 'rejected', 'failed', 'skipped')),
    -- `click`: Lucas pressed Generate (the approval boundary for live calls,
    -- rule 0.1). `auto`: the series' auto switch is on (S-05).
    trigger         text NOT NULL CHECK (trigger IN ('click', 'auto')),
    -- polished or homemade (S-54).
    style           text NOT NULL CHECK (style IN ('polished', 'homemade')),
    -- The chosen stories, number or tool pair, with their sources.
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- The minute picked inside the series' window (S-20), and when it posts.
    publish_at      timestamptz,
    -- The render review still fails a frame after one re-render (S-33).
    flagged         boolean NOT NULL DEFAULT false,
    error           text,
    spend_usd       numeric(12, 6) NOT NULL DEFAULT 0,
    requested_by    text,
    claimed_at      timestamptz,
    built_at        timestamptz,
    approved_at     timestamptz,
    published_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stories_sets_live_day
    ON stories.sets (series, ny_date)
    WHERE status NOT IN ('rejected', 'failed', 'skipped');
CREATE INDEX IF NOT EXISTS idx_stories_sets_status
    ON stories.sets (status, created_at);
CREATE INDEX IF NOT EXISTS idx_stories_sets_publish
    ON stories.sets (publish_at) WHERE status IN ('approved', 'scheduled');

-- ── Frames ─────────────────────────────────────────────────────────────────
-- One row per frame, in order. `copy` is the frame data the template renders
-- (lib/stories/render/types.ts FrameData); the review may change the
-- settings columns (backdrop, template, photo focus), never `copy` text.

CREATE TABLE IF NOT EXISTS stories.frames (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    set_id          uuid NOT NULL REFERENCES stories.sets (id) ON DELETE CASCADE,
    seq             integer NOT NULL CHECK (seq >= 1),
    role            text NOT NULL CHECK (role IN ('opener', 'story', 'closer', 'intro', 'question', 'answer', 'paid', 'free')),
    -- Layout family or variant (photo, marquee, type, ...).
    template        text,
    backdrop        text NOT NULL CHECK (backdrop IN ('black', 'white', 'orange', 'green')),
    copy            jsonb NOT NULL,
    -- url, source, credit, kind, focus, qid (lib/stories/render/types.ts Photo).
    photo           jsonb,
    storage_path    text,
    jpeg_bytes      integer,
    -- The render review's answers and any change it made (S-33).
    review          jsonb,
    flagged         boolean NOT NULL DEFAULT false,
    ig_container_id text,
    ig_media_id     text,
    published_at    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (set_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_stories_frames_media
    ON stories.frames (ig_media_id) WHERE ig_media_id IS NOT NULL;

-- ── Candidates ─────────────────────────────────────────────────────────────
-- Everything a build considered, chosen or not, with its scores, so the Hub
-- can show why a set looks the way it does.

CREATE TABLE IF NOT EXISTS stories.candidates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    set_id          uuid NOT NULL REFERENCES stories.sets (id) ON DELETE CASCADE,
    origin          text NOT NULL CHECK (origin IN ('reels', 'carousel', 'catalog', 'github', 'generated')),
    -- Idea id, post slug, run id + story id, catalog id.
    ref             text NOT NULL,
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
    jev             jsonb,
    score           numeric(8, 4),
    chosen          boolean NOT NULL DEFAULT false,
    reason          text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stories_candidates_set
    ON stories.candidates (set_id, score DESC NULLS LAST);

-- ── Pool ───────────────────────────────────────────────────────────────────
-- The open ideas for each series, refreshed from the other pools (reels,
-- carousels, catalog). A row leaves when it is used or drops out of the
-- latest refresh. Same shape as the other tanks: ranked, open, replaced.

CREATE TABLE IF NOT EXISTS stories.pool (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    series          text NOT NULL CHECK (series IN ('morning_download', 'guess_the_number', 'free_vs_paid')),
    key             text NOT NULL CHECK (length(btrim(key)) > 0),
    origin          text NOT NULL CHECK (origin IN ('reels', 'carousel', 'catalog', 'github', 'generated')),
    ref             text NOT NULL,
    title           text NOT NULL,
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
    score           numeric(8, 4),
    refreshed_at    timestamptz NOT NULL DEFAULT now(),
    used_at         timestamptz,
    UNIQUE (series, key)
);

CREATE INDEX IF NOT EXISTS idx_stories_pool_open
    ON stories.pool (series, score DESC NULLS LAST)
    WHERE used_at IS NULL;

-- ── History (repeat checks) ────────────────────────────────────────────────
-- What has been shown: a story key (3 days, Morning Download), a number's
-- story (30 days, Guess the Number), a tool pair (90 days, Free vs. Paid).

CREATE TABLE IF NOT EXISTS stories.history (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    series          text NOT NULL CHECK (series IN ('morning_download', 'guess_the_number', 'free_vs_paid')),
    key             text NOT NULL CHECK (length(btrim(key)) > 0),
    set_id          uuid REFERENCES stories.sets (id) ON DELETE SET NULL,
    shown_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stories_history_key
    ON stories.history (series, key, shown_at DESC);

-- ── Insights (plan §7, O-6) ────────────────────────────────────────────────
-- One row per capture of a published frame's metrics. Story insights are
-- only readable while the story is live (24 hours), so the poller's last
-- capture lands before expiry and is marked final.

CREATE TABLE IF NOT EXISTS stories.insights (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    frame_id        uuid NOT NULL REFERENCES stories.frames (id) ON DELETE CASCADE,
    captured_at     timestamptz NOT NULL DEFAULT now(),
    final           boolean NOT NULL DEFAULT false,
    reach           integer,
    views           integer,
    replies         integer,
    shares          integer,
    follows         integer,
    profile_visits  integer,
    total_interactions integer,
    taps_forward    integer,
    taps_back       integer,
    exits           integer,
    swipe_forward   integer,
    raw             jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_stories_insights_frame
    ON stories.insights (frame_id, captured_at DESC);

-- ── Jev logs and costs ─────────────────────────────────────────────────────
-- Separate from reels.* so Stories spend never counts toward the Reels watch
-- (the Explainers precedent).

CREATE TABLE IF NOT EXISTS stories.jev_logs (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    set_id                  uuid REFERENCES stories.sets (id) ON DELETE SET NULL,
    component               text NOT NULL,
    question_set_id         text NOT NULL,
    question_set_version    text NOT NULL,
    resolved_model          text,
    state                   jsonb NOT NULL,
    answers                 jsonb NOT NULL,
    input_tokens            integer NOT NULL DEFAULT 0,
    expires_at              timestamptz NOT NULL DEFAULT (now() + interval '45 days'),
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stories_jev_logs_set
    ON stories.jev_logs (set_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_jev_logs_expires
    ON stories.jev_logs (expires_at);

CREATE TABLE IF NOT EXISTS stories.cost_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    set_id          uuid REFERENCES stories.sets (id) ON DELETE SET NULL,
    vendor          text NOT NULL CHECK (vendor IN ('anthropic', 'jev', 'web_search')),
    component       text NOT NULL,
    model           text,
    input_tokens    integer NOT NULL DEFAULT 0,
    output_tokens   integer NOT NULL DEFAULT 0,
    cache_read_tokens   integer NOT NULL DEFAULT 0,
    cache_write_tokens  integer NOT NULL DEFAULT 0,
    usd             numeric(12, 6) NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stories_cost_created
    ON stories.cost_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_cost_set
    ON stories.cost_events (set_id) WHERE set_id IS NOT NULL;

-- ── Settings ───────────────────────────────────────────────────────────────
-- Key/value; defaults live in code (lib/stories/settings.ts), a row overrides.

CREATE TABLE IF NOT EXISTS stories.settings (
    key             text PRIMARY KEY,
    value           jsonb NOT NULL,
    updated_by      text,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Feedback ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stories.feedback (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    set_id          uuid NOT NULL REFERENCES stories.sets (id) ON DELETE CASCADE,
    verdict         text NOT NULL CHECK (verdict IN ('approve', 'reject')),
    tags            text[] NOT NULL DEFAULT '{}'
                      CHECK (tags <@ ARRAY['story_choice', 'copy', 'photo', 'design', 'accuracy']::text[]),
    note            text,
    created_by      text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stories_feedback_set
    ON stories.feedback (set_id, created_at DESC);

-- ── Overnight switches (docs/social-overnight.md) ───────────────────────────
-- Every content type needs a person's approval before it posts, and ships with
-- publishing off. lib/stories/settings.ts reads both; missing rows mean the same.
INSERT INTO stories.settings (key, value) VALUES ('require_approval', 'true'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO stories.settings (key, value) VALUES ('publishing_live', 'false'::jsonb) ON CONFLICT (key) DO NOTHING;
