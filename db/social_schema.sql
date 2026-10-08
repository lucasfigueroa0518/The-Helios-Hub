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
