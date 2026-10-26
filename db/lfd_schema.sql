-- db/lfd_schema.sql
\set ON_ERROR_STOP on
-- Last Few Days, the fifth Helios Social content type
-- (docs/superpowers/specs/2026-10-13-last-few-days-design.md §7.1).
-- Apply: node scripts/apply_lfd_schema.js. Additive and idempotent.
CREATE SCHEMA IF NOT EXISTS lfd;

CREATE TABLE IF NOT EXISTS lfd.runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger         text NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
    status          text NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested', 'running', 'ok', 'partial', 'failed', 'skipped')),
    requested_at    timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    finished_at     timestamptz,
    ny_date         date,
    cap_usd         double precision NOT NULL DEFAULT 1,
    claude_usd      double precision NOT NULL DEFAULT 0,
    jev_usd         double precision NOT NULL DEFAULT 0,
    total_usd       double precision NOT NULL DEFAULT 0,
    stop_reason     text,
    error           text,
    record          jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lfd_runs_single_running ON lfd.runs ((status)) WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS idx_lfd_runs_single_requested ON lfd.runs ((status)) WHERE status = 'requested';

CREATE TABLE IF NOT EXISTS lfd.settings (
    key             text PRIMARY KEY,
    value           jsonb NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO lfd.settings (key, value) VALUES ('auto_run', 'false'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO lfd.settings (key, value) VALUES ('publishing_live', 'false'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO lfd.settings (key, value) VALUES ('require_approval', 'true'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO lfd.settings (key, value) VALUES ('days', '[2, 5]'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO lfd.settings (key, value) VALUES ('run_cap_usd', '1'::jsonb) ON CONFLICT (key) DO NOTHING;
-- Memes in the post (lib/memes/lfd-post.ts, planning/Memes/DECISIONS.md ME-140): on, with their own spend cap.
INSERT INTO lfd.settings (key, value) VALUES ('memes', 'true'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO lfd.settings (key, value) VALUES ('memes_cap_usd', '1'::jsonb) ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS lfd.posts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          uuid REFERENCES lfd.runs (id) ON DELETE SET NULL,
    slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
    ny_date         date NOT NULL,
    status          text NOT NULL DEFAULT 'review' CHECK (status IN ('preview', 'review', 'published', 'rejected')),
    -- Every source id the post used: reels post_idea ids and carousel story ids (the repeat check, spec §3.3).
    idea_ids        text[] NOT NULL DEFAULT '{}',
    stories         jsonb NOT NULL,
    render          jsonb NOT NULL,
    caption         text NOT NULL,
    slide_objects   jsonb,
    -- Render-fit problems (text taller than the template allows). Shown on review; never shrinks text.
    fit_problems    jsonb NOT NULL DEFAULT '[]'::jsonb,
    short           boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    published_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_lfd_posts_ny_date ON lfd.posts (ny_date DESC);
-- Render problems that mean a broken slide (an image that failed to load, a font that did not load, text out of
-- bounds), kept apart from text fit. Shown on review.
ALTER TABLE lfd.posts ADD COLUMN IF NOT EXISTS render_problems jsonb NOT NULL DEFAULT '[]'::jsonb;
