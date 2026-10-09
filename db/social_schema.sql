-- db/social_schema.sql — Helios Social carousel storage (idempotent).
-- Schema `social` inside the existing Helios Supabase Postgres, like `reels`.
-- Spec: docs/superpowers/specs/2026-10-08-social-storage.md
-- Additive only: nothing here touches another schema.
--
-- Apply:
--   npm run db:social
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS social;

-- ── Runs ────────────────────────────────────────────────────────────────────
-- One row per daily or preview run. `record` is the full run.json; screenshots
-- and reports stay in `run_dir` on the machine named in `machine`.
CREATE TABLE IF NOT EXISTS social.runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            text NOT NULL CHECK (kind IN ('daily', 'preview')),
    started_at      timestamptz NOT NULL,
    finished_at     timestamptz,
    hook_pass       boolean NOT NULL,
    cap_usd         numeric(10, 4) NOT NULL,
    claude_usd      numeric(10, 4) NOT NULL DEFAULT 0,
    total_usd       numeric(10, 4) NOT NULL DEFAULT 0,
    stop_reason     text,
    run_dir         text,
    machine         text,
    record          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_social_runs_started ON social.runs (started_at DESC);

-- ── Posts ───────────────────────────────────────────────────────────────────
-- `render` is the render Post the /social preview pages draw.
CREATE TABLE IF NOT EXISTS social.posts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          uuid REFERENCES social.runs (id) ON DELETE SET NULL,
    slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
    story_id        text,
    title           text NOT NULL,
    status          text NOT NULL CHECK (status IN ('preview', 'review', 'published', 'rejected')),
    brief           jsonb,
    draft           jsonb,
    render          jsonb NOT NULL,
    caption         text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    published_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_social_posts_created ON social.posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social.posts (status, created_at DESC);

-- ── Used photos (the 7-day rule and the photo bank) ─────────────────────────
CREATE TABLE IF NOT EXISTS social.used_photos (
    id              bigserial PRIMARY KEY,
    url             text NOT NULL,
    used_at         timestamptz NOT NULL,
    story_id        text NOT NULL,
    slide           integer NOT NULL,
    source          text,
    qid             text,
    subject         text,
    credit          text,
    scene           text,
    post_id         uuid REFERENCES social.posts (id) ON DELETE SET NULL,
    UNIQUE (url, used_at, story_id, slide)
);

CREATE INDEX IF NOT EXISTS idx_social_used_photos_url ON social.used_photos (url, used_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_used_photos_used ON social.used_photos (used_at DESC);

-- ── Posted stories (Jev's "already posted?" question) ───────────────────────
CREATE TABLE IF NOT EXISTS social.posted_stories (
    id              bigserial PRIMARY KEY,
    headline        text NOT NULL,
    posted_at       timestamptz NOT NULL,
    story_id        text,
    post_id         uuid REFERENCES social.posts (id) ON DELETE SET NULL,
    UNIQUE (headline, posted_at)
);

CREATE INDEX IF NOT EXISTS idx_social_posted_at ON social.posted_stories (posted_at DESC);

-- ── Set-aside log (pattern-spotting only) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS social.set_asides (
    id              bigserial PRIMARY KEY,
    day             date NOT NULL,
    story_id        text NOT NULL,
    stage           text NOT NULL,
    reason_code     text NOT NULL,
    kind            text NOT NULL,
    detail          text NOT NULL,
    at              timestamptz NOT NULL,
    UNIQUE (story_id, stage, reason_code, at)
);

CREATE INDEX IF NOT EXISTS idx_social_set_asides_day ON social.set_asides (day);

-- ── Feed health ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social.feed_health (
    id              bigserial PRIMARY KEY,
    day             date NOT NULL,
    slug            text NOT NULL,
    name            text NOT NULL,
    fetched         integer NOT NULL,
    in_window       integer NOT NULL,
    flagged         boolean NOT NULL,
    recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_feed_health_day ON social.feed_health (day, slug);

-- ════════════════════════════════════════════════════════════════════════════
-- Overnight: run queue, schedule, publish, insights (docs/social-overnight.md).
-- Same shapes as Trial Reels (db/reels_schema.sql). The social worker runs the
-- 3:00 AM NY carousel run; nothing posts until publishing_live is on.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Runs as a queue ─────────────────────────────────────────────────────────
-- The CLI (scripts/social_daily.ts) still records a finished run in one insert
-- (status ok, trigger cli). The worker inserts `requested`, claims it, and
-- finishes it, like reels.runs.
ALTER TABLE social.runs ADD COLUMN IF NOT EXISTS trigger text NOT NULL DEFAULT 'cli';
ALTER TABLE social.runs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ok';
ALTER TABLE social.runs ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE social.runs ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE social.runs ALTER COLUMN started_at DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_runs_trigger_check') THEN
    ALTER TABLE social.runs ADD CONSTRAINT social_runs_trigger_check
      CHECK (trigger IN ('scheduled', 'manual', 'cli'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_runs_status_check') THEN
    ALTER TABLE social.runs ADD CONSTRAINT social_runs_status_check
      CHECK (status IN ('requested', 'running', 'ok', 'partial', 'failed', 'skipped'));
  END IF;
END $$;

-- At most one run in flight, and at most one queued behind it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_runs_single_running
    ON social.runs ((status)) WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_runs_single_requested
    ON social.runs ((status)) WHERE status = 'requested';

-- ── Posts: dev rows and slide images ────────────────────────────────────────
-- `dev`: development renders (the one-time file import, re-render scripts).
-- The calendar and analytics read `pipeline` rows only. Like Trial Reels there
-- is no approved-version pointer: the newest `review` post per story wins.
-- `slide_objects`: Storage paths of the 1080x1350 JPEGs, in slide order.
ALTER TABLE social.posts ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'pipeline';
ALTER TABLE social.posts ADD COLUMN IF NOT EXISTS slide_objects jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_origin_check') THEN
    ALTER TABLE social.posts ADD CONSTRAINT social_posts_origin_check CHECK (origin IN ('pipeline', 'dev'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_social_posts_story ON social.posts (story_id, created_at DESC);

-- ── Settings the page and the worker share ──────────────────────────────────
CREATE TABLE IF NOT EXISTS social.settings (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The 3:00 AM run. Off until a human turns it on (a night costs ~$2).
INSERT INTO social.settings (key, value) VALUES ('auto_run', 'false'::jsonb) ON CONFLICT (key) DO NOTHING;
-- Scheduling and auto-publishing. Off until a human turns it on.
INSERT INTO social.settings (key, value) VALUES ('publishing_live', 'false'::jsonb) ON CONFLICT (key) DO NOTHING;
-- A person approves every carousel before it posts (docs/social-overnight.md).
INSERT INTO social.settings (key, value) VALUES ('require_approval', 'true'::jsonb) ON CONFLICT (key) DO NOTHING;

-- ── Frozen: posting_schedule, publish_attempts, media_insights ──────────────
-- Carousels' slots, attempts, approvals and insights moved to the lifecycle
-- spine (social_hub, D36). These three tables are history: only
-- scripts/backfill_spine.ts reads them, and nothing writes them. They are
-- dropped once the backfill has been checked (unification Phase 7).

-- ── Posting schedule ────────────────────────────────────────────────────────
-- One carousel per Eastern-time slot per day.
CREATE TABLE IF NOT EXISTS social.posting_schedule (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id             uuid NOT NULL REFERENCES social.posts (id),
    ny_date             date NOT NULL,
    slot                text NOT NULL CHECK (slot IN ('morning')),
    publish_at          timestamptz NOT NULL,
    status              text NOT NULL CHECK (status IN ('scheduled', 'publishing', 'published', 'cancelled', 'failed')),
    source              text NOT NULL CHECK (source IN ('auto', 'user')),
    publish_attempt_id  uuid,
    error               text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- A person's approval of the slot; with require_approval on, an unapproved slot never posts.
ALTER TABLE social.posting_schedule ADD COLUMN IF NOT EXISTS approved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_social_posting_schedule_due
    ON social.posting_schedule (publish_at) WHERE status = 'scheduled';
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_posting_schedule_slot
    ON social.posting_schedule (ny_date, slot) WHERE status IN ('scheduled', 'publishing', 'published');
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_posting_schedule_post
    ON social.posting_schedule (post_id) WHERE status IN ('scheduled', 'publishing');

-- ── Publish attempts ────────────────────────────────────────────────────────
-- creating (child + parent containers) → processing (status poll) →
-- publishing (media_publish) → published | failed.
CREATE TABLE IF NOT EXISTS social.publish_attempts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id             uuid NOT NULL REFERENCES social.posts (id),
    trigger             text NOT NULL CHECK (trigger IN ('approve', 'auto', 'force')),
    status              text NOT NULL CHECK (status IN (
                          'requested', 'creating', 'processing', 'publishing', 'published', 'failed'
                        )),
    requested_at        timestamptz NOT NULL DEFAULT now(),
    started_at          timestamptz,
    finished_at         timestamptz,
    caption             text NOT NULL,
    image_objects       jsonb NOT NULL,
    child_container_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    container_id        text,
    media_id            text,
    permalink           text,
    status_log          jsonb NOT NULL DEFAULT '[]'::jsonb,
    error               text,
    insights_checked_at timestamptz,
    insights_settled_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_social_publish_recent ON social.publish_attempts (requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_publish_inflight_post
    ON social.publish_attempts (post_id) WHERE status IN ('requested', 'creating', 'processing', 'publishing');
-- A carousel posts once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_publish_once
    ON social.publish_attempts (post_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_social_publish_insights_open
    ON social.publish_attempts (finished_at DESC)
    WHERE status = 'published' AND insights_settled_at IS NULL AND media_id IS NOT NULL;

-- ── Instagram performance snapshots ─────────────────────────────────────────
-- Lifetime totals, one row per published carousel per New York day asked
-- (due/settle rules: lib/reels/media-insights/due.ts).
CREATE TABLE IF NOT EXISTS social.media_insights (
    media_id             text NOT NULL,
    ny_date              date NOT NULL,
    publish_attempt_id   uuid REFERENCES social.publish_attempts (id) ON DELETE CASCADE,
    captured_at          timestamptz NOT NULL DEFAULT now(),
    views                double precision,
    reach                double precision,
    likes                double precision,
    comments             double precision,
    saved                double precision,
    shares               double precision,
    total_interactions   double precision,
    raw                  jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (media_id, ny_date)
);

CREATE INDEX IF NOT EXISTS idx_social_media_insights_attempt
    ON social.media_insights (publish_attempt_id, ny_date DESC);

-- Feed follows and profile visits (Social Hub P2-M1; available for FEED media per META_API_CHECK).
ALTER TABLE social.media_insights ADD COLUMN IF NOT EXISTS follows double precision;
ALTER TABLE social.media_insights ADD COLUMN IF NOT EXISTS profile_visits double precision;

-- Two carousel windows a day (Social Hub P2-M2, SH-46): morning 9:00–10:00, afternoon 2:30–3:30.
ALTER TABLE social.posting_schedule DROP CONSTRAINT IF EXISTS posting_schedule_slot_check;
ALTER TABLE social.posting_schedule ADD CONSTRAINT posting_schedule_slot_check CHECK (slot IN ('morning', 'afternoon'));
-- Carousels posted per day (SH-48). The run schedules its top this-many posts.
INSERT INTO social.settings (key, value) VALUES ('posts_per_day', '2'::jsonb) ON CONFLICT (key) DO NOTHING;

-- The run's ship list (Social Hub P2-M4, SH-60): post ids in rank order, both
-- the posts it made and the stored posts it reused for stories that already
-- had a finished post. The worker schedules from it. NULL: an older run, whose
-- own posts are scheduled by slug order.
ALTER TABLE social.runs ADD COLUMN IF NOT EXISTS ship_post_ids jsonb;

-- ── One-story reruns (Social Hub Regenerate, D51) ──────────────────────────
-- A person asks for one carousel's news story to be made again. The app
-- inserts a `requested` row here; only the helios-social worker runs it
-- (docs/social-overnight.md). The worker claims a request by opening a
-- social.runs row for it (status `running`, trigger `manual`), so the run
-- queue's single-running index keeps a rerun and the nightly run apart, the
-- nightly run's one queued place is never taken by a rerun, and the spend is
-- recorded and capped like any run's (run_cap_usd, default $2). The rerun
-- starts from the post's saved brief (Writer onward), like
-- scripts/social_rewrite_run.ts; its new post is a new `review` post for the
-- same story, so the newest version wins (SH-60).
CREATE TABLE IF NOT EXISTS social.rerun_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id         uuid NOT NULL REFERENCES social.posts (id) ON DELETE CASCADE,
    story_id        text NOT NULL,
    status          text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'running', 'ok', 'failed')),
    requested_at    timestamptz NOT NULL DEFAULT now(),
    requested_by    text,
    started_at      timestamptz,
    finished_at     timestamptz,
    run_id          uuid REFERENCES social.runs (id) ON DELETE SET NULL,
    new_post_id     uuid REFERENCES social.posts (id) ON DELETE SET NULL,
    error           text
);

CREATE INDEX IF NOT EXISTS idx_social_rerun_requests_recent ON social.rerun_requests (requested_at DESC);
-- One open rerun per news story.
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_rerun_requests_open_story
    ON social.rerun_requests (story_id) WHERE status IN ('requested', 'running');
