-- db/real_case_schema.sql — Real Case Reels (idempotent).
-- Schema `real_case`, a route alongside Explainer Reels (planning/Real Case Reels/DECISIONS.md RC-01).
-- It reads explainers.topics and never writes to it: no foreign keys into `explainers`, so nothing here
-- can block or change an Explainer topic. Local only until a run validates it (BUILD_PLAN.md).
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS real_case;

-- ── Story cycles (RC-11) ─────────────────────────────────────────────────────
-- One row per search run: the nightly cycle (`auto`, at most one per New York day) or Lucas's
-- Find stories click on one topic (`click`).

CREATE TABLE IF NOT EXISTS real_case.story_cycles (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    status                  text NOT NULL CHECK (status IN ('running', 'ok', 'failed', 'skipped')),
    mode                    text NOT NULL CHECK (mode IN ('development', 'production')),
    trigger                 text NOT NULL CHECK (trigger IN ('auto', 'click')),
    ny_date                 date NOT NULL,
    topics_scouted          integer NOT NULL DEFAULT 0,
    stories_found           integer NOT NULL DEFAULT 0,
    stories_checked         integer NOT NULL DEFAULT 0,
    stories_entering_pool   integer NOT NULL DEFAULT 0,
    error                   text,
    started_at              timestamptz NOT NULL DEFAULT now(),
    finished_at             timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_real_case_cycles_auto_day
    ON real_case.story_cycles (ny_date) WHERE trigger = 'auto';

-- ── Topic scouts (RC-02) ─────────────────────────────────────────────────────
-- One row per search of one Explainer topic. `topic_id` is explainers.topics.id, kept without a
-- foreign key; `topic_title` is a snapshot. `weak`: stories were found, none cleared the bar, so this
-- route ignores the topic until the cooldown passes. `none`: no story was found.

CREATE TABLE IF NOT EXISTS real_case.topic_scouts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id        uuid NOT NULL,
    topic_title     text NOT NULL,
    cycle_id        uuid REFERENCES real_case.story_cycles (id) ON DELETE SET NULL,
    outcome         text NOT NULL CHECK (outcome IN ('running', 'found', 'weak', 'none', 'failed')),
    stories_found   integer NOT NULL DEFAULT 0,
    best_score      numeric(7, 3),
    error           text,
    scouted_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_real_case_scouts_topic
    ON real_case.topic_scouts (topic_id, scouted_at DESC);

-- ── Stories (RC-03, RC-09, RC-13) ────────────────────────────────────────────
-- One row per story the scout found. `term` is the concept the story teaches best, which may be a
-- neighbour of its topic's term (RC-09). `story` holds the beat material; `claims` and `sources` the
-- facts with their checks (each claim: id, text, source_id, excerpt, core, check). `pool` rows compete
-- for the best `pool_size` places; `displaced` fell below the cut or lost a duplicate head-to-head;
-- `rejected` failed the source check, a gate or the bar.

CREATE TABLE IF NOT EXISTS real_case.stories (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id        uuid NOT NULL,
    scout_id        uuid REFERENCES real_case.topic_scouts (id) ON DELETE SET NULL,
    term            text NOT NULL CHECK (length(btrim(term)) > 0),
    title           text NOT NULL CHECK (length(btrim(title)) > 0),
    summary         text NOT NULL,
    polarity        text NOT NULL CHECK (polarity IN ('failure', 'success', 'mystery')),
    story           jsonb NOT NULL DEFAULT '{}'::jsonb,
    claims          jsonb NOT NULL DEFAULT '[]'::jsonb,
    sources         jsonb NOT NULL DEFAULT '[]'::jsonb,
    status          text NOT NULL DEFAULT 'proposed'
                      CHECK (status IN ('proposed', 'pool', 'rejected', 'displaced',
                                        'promoted', 'rendered', 'archived')),
    -- Jev expected scores, 0 to 4, stored raw (never rounded). NULL until scored.
    recognition     numeric(5, 3) CHECK (recognition BETWEEN 0 AND 4),
    tension         numeric(5, 3) CHECK (tension BETWEEN 0 AND 4),
    illumination    numeric(5, 3) CHECK (illumination BETWEEN 0 AND 4),
    mechanism_fit   numeric(5, 3) CHECK (mechanism_fit BETWEEN 0 AND 4),
    tellable        numeric(5, 3) CHECK (tellable BETWEEN 0 AND 4),
    weighted_score  numeric(7, 3) CHECK (weighted_score BETWEEN 0 AND 100),
    reject_reason   text,
    duplicate_of    uuid REFERENCES real_case.stories (id) ON DELETE SET NULL,
    jev_notes       jsonb NOT NULL DEFAULT '{}'::jsonb,
    cycle_id        uuid REFERENCES real_case.story_cycles (id) ON DELETE SET NULL,
    checked_at      timestamptz,
    scored_at       timestamptz,
    rendered_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_real_case_stories_status
    ON real_case.stories (status, weighted_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_real_case_stories_topic
    ON real_case.stories (topic_id);

-- ── Render jobs (M5) ─────────────────────────────────────────────────────────
-- One row per Make reel click on a story (RC-10). The worker claims `requested` rows one at a time.
-- Its own spend cap; its own opener history, so it never changes the Explainer rotation.

CREATE TABLE IF NOT EXISTS real_case.jobs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id            uuid NOT NULL REFERENCES real_case.stories (id) ON DELETE CASCADE,
    status              text NOT NULL CHECK (status IN ('requested', 'running', 'ok', 'failed')),
    trigger             text NOT NULL CHECK (trigger IN ('click', 'auto')),
    mode                text NOT NULL CHECK (mode IN ('development', 'production')),
    stage               text,
    spend_cap_usd       numeric(10, 4) NOT NULL,
    spend_usd           numeric(12, 6) NOT NULL DEFAULT 0,
    capped              boolean NOT NULL DEFAULT false,
    orchestrator_model  text NOT NULL,
    frame_worker_model  text NOT NULL,
    opener              text,
    session_a_id        text,
    session_b_id        text,
    error               text,
    flags               jsonb NOT NULL DEFAULT '[]'::jsonb,
    requested_at        timestamptz NOT NULL DEFAULT now(),
    started_at          timestamptz,
    finished_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_real_case_jobs_status
    ON real_case.jobs (status, requested_at);
-- One live render per story at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_real_case_jobs_live_story
    ON real_case.jobs (story_id) WHERE status IN ('requested', 'running');

-- ── Render artifacts ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS real_case.artifacts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              uuid NOT NULL REFERENCES real_case.jobs (id) ON DELETE CASCADE,
    kind                text NOT NULL CHECK (kind IN ('brief', 'storyboard', 'script', 'audio_meta', 'lint_report', 'fact_check', 'contact_sheet', 'video', 'captions', 'transcript_log')),
    content             text,
    storage_path        text,
    storage_location    text,
    bytes               bigint,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_real_case_artifacts_job
    ON real_case.artifacts (job_id, created_at);

-- ── Cost ledger ──────────────────────────────────────────────────────────────
-- Separate from explainers.cost_events, so this route's spend never counts against Explainer caps.
-- `usd_known = false`: the vendor returned no price; shown as unknown rather than guessed.

CREATE TABLE IF NOT EXISTS real_case.cost_events (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id            uuid REFERENCES real_case.story_cycles (id) ON DELETE SET NULL,
    story_id            uuid REFERENCES real_case.stories (id) ON DELETE SET NULL,
    mode                text NOT NULL CHECK (mode IN ('development', 'production')),
    vendor              text NOT NULL CHECK (vendor IN ('anthropic', 'heygen', 'jev', 'openai')),
    component           text NOT NULL,
    input_tokens        integer NOT NULL DEFAULT 0,
    output_tokens       integer NOT NULL DEFAULT 0,
    cache_read_tokens   integer NOT NULL DEFAULT 0,
    cache_write_tokens  integer NOT NULL DEFAULT 0,
    web_searches        integer NOT NULL DEFAULT 0,
    usd                 numeric(12, 6) NOT NULL DEFAULT 0,
    usd_known           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_real_case_cost_created
    ON real_case.cost_events (created_at DESC);

-- ── Jev call log ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS real_case.jev_logs (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id                uuid REFERENCES real_case.story_cycles (id) ON DELETE SET NULL,
    story_id                uuid REFERENCES real_case.stories (id) ON DELETE SET NULL,
    component               text NOT NULL,
    question_set_id         text NOT NULL,
    question_set_version    text NOT NULL,
    resolved_model          text NOT NULL,
    state                   jsonb,
    answers                 jsonb NOT NULL,
    input_tokens            integer NOT NULL DEFAULT 0,
    created_at              timestamptz NOT NULL DEFAULT now()
);

-- ── Settings (RC-11) ─────────────────────────────────────────────────────────
-- Validated in lib/real-case/settings.ts. `auto_scout` is off until Lucas turns it on.

CREATE TABLE IF NOT EXISTS real_case.settings (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO real_case.settings (key, value) VALUES
    ('mode',                 '"development"'::jsonb),
    ('auto_scout',           'false'::jsonb),
    ('topics_per_night',     '3'::jsonb),
    ('nightly_cap_usd',      '1'::jsonb),
    ('stories_per_topic',    '3'::jsonb),
    ('pool_size',            '25'::jsonb),
    ('scout_cooldown_days',  '30'::jsonb),
    ('dedupe_lookback_days', '45'::jsonb),
    ('scout_model',          '"claude-sonnet-5-5"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── Upgrades for databases created before a column existed ───────────────────

ALTER TABLE real_case.cost_events ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES real_case.jobs (id) ON DELETE SET NULL;

INSERT INTO real_case.settings (key, value) VALUES
    ('per_reel_cap_usd',     '8'::jsonb),
    ('orchestrator_model',   '"claude-sonnet-5-5"'::jsonb),
    ('frame_worker_model',   '"claude-sonnet-5-5"'::jsonb),
    ('fact_check_model',     '"claude-sonnet-5-5"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── AI News Explained (RC-26, RC-27) ─────────────────────────────────────────
-- The scout starts from recent AI news, so a search and a story no longer need an Explainer topic
-- (the topic is a label only). `event_date` drives the 90-day window and freshness; `scores` holds
-- the story scores by key (stakes, turn, scene, reveal, artifacts, players, freshness). The first
-- build's five score columns stay for its rows' history.

ALTER TABLE real_case.stories ALTER COLUMN topic_id DROP NOT NULL;
ALTER TABLE real_case.topic_scouts ALTER COLUMN topic_id DROP NOT NULL;
ALTER TABLE real_case.stories ADD COLUMN IF NOT EXISTS event_date date;
ALTER TABLE real_case.stories ADD COLUMN IF NOT EXISTS scores jsonb;

INSERT INTO real_case.settings (key, value) VALUES
    ('searches_per_night',   '1'::jsonb),
    ('stories_per_search',   '3'::jsonb),
    ('news_window_days',     '90'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── Object prep (RC-52): gpt-image drawings and object photos are OpenAI spend ──

ALTER TABLE real_case.cost_events DROP CONSTRAINT IF EXISTS cost_events_vendor_check;
ALTER TABLE real_case.cost_events ADD CONSTRAINT cost_events_vendor_check CHECK (vendor IN ('anthropic', 'heygen', 'jev', 'openai'));
