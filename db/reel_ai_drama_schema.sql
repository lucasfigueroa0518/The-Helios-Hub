-- db/reel_ai_drama_schema.sql — Reel AI Drama (idempotent).
-- Schema `reel_ai_drama` on the explainers connection (planning/AI Mini Docs/PLAN.md MD-10, CONTRACT.md).
-- Starts fresh: no foreign keys into real_case or explainers. Local only until Lucas approves a reel.
-- No dollar-quoted bodies: the loader ends a statement at a line ending in a semicolon.
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS reel_ai_drama;

-- ── Settings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reel_ai_drama.settings (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── The search ledger (MD-27) ────────────────────────────────────────────────
-- One row per grid cell: a blue-chip player × a story type × an era. A cell is searched when it is
-- new or due; news touching its player can reopen it early.
CREATE TABLE IF NOT EXISTS reel_ai_drama.cells (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id           text NOT NULL,
    story_type          text NOT NULL,
    era                 text NOT NULL,
    searches            integer NOT NULL DEFAULT 0,
    pitches_made        integer NOT NULL DEFAULT 0,
    last_searched_at    timestamptz,
    due_at              timestamptz,
    reopen_reason       text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (player_id, story_type, era)
);

-- One row per development session (weekly or a click).
CREATE TABLE IF NOT EXISTS reel_ai_drama.sessions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    status          text NOT NULL CHECK (status IN ('running', 'ok', 'failed', 'capped')),
    mode            text NOT NULL CHECK (mode IN ('development', 'production')),
    trigger         text NOT NULL CHECK (trigger IN ('auto', 'click', 'calibration')),
    cells_searched  integer NOT NULL DEFAULT 0,
    pitches_made    integer NOT NULL DEFAULT 0,
    pitches_pooled  integer NOT NULL DEFAULT 0,
    error           text,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz
);

-- One row per producer call on one cell.
CREATE TABLE IF NOT EXISTS reel_ai_drama.searches (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      uuid REFERENCES reel_ai_drama.sessions (id) ON DELETE SET NULL,
    cell_id         uuid REFERENCES reel_ai_drama.cells (id) ON DELETE CASCADE,
    queries         jsonb NOT NULL DEFAULT '[]'::jsonb,
    pitches_made    integer NOT NULL DEFAULT 0,
    empty           boolean NOT NULL DEFAULT false,
    error           text,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz
);

-- ── Pitches and the pool (MD-21 to MD-33) ────────────────────────────────────
-- `pitch` is the Pitch JSON (lib/reel-ai-drama/types.ts). `event_key` is the normalized event
-- fingerprint used for the first dedupe pass. Status moves:
--   new → duplicate | rejected | pooled → picked → made | killed ; pooled → retired
CREATE TABLE IF NOT EXISTS reel_ai_drama.pitches (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          uuid REFERENCES reel_ai_drama.sessions (id) ON DELETE SET NULL,
    search_id           uuid REFERENCES reel_ai_drama.searches (id) ON DELETE SET NULL,
    cell_id             uuid REFERENCES reel_ai_drama.cells (id) ON DELETE SET NULL,
    origin              text NOT NULL DEFAULT 'producer' CHECK (origin IN ('producer', 'seed', 'calibration')),
    title               text NOT NULL,
    pitch               jsonb NOT NULL,
    event_key           text NOT NULL,
    event_date          date,
    central_player_id   text,
    status              text NOT NULL DEFAULT 'new'
                          CHECK (status IN ('new', 'duplicate', 'rejected', 'pooled', 'picked', 'made', 'killed', 'retired')),
    duplicate_of        uuid,
    reject_reason       text,
    revive_when         text,
    drama               jsonb,
    drama_score         numeric,
    material            jsonb,
    material_score      numeric,
    visuals_card        jsonb,
    visuals_grade       text CHECK (visuals_grade IN ('green', 'amber', 'red')),
    rank_score          numeric,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    made_at             timestamptz
);

CREATE INDEX IF NOT EXISTS ix_rad_pitches_status ON reel_ai_drama.pitches (status, rank_score DESC);
CREATE INDEX IF NOT EXISTS ix_rad_pitches_event ON reel_ai_drama.pitches (event_key);

-- ── Production jobs (PROCESS.md P1–P9) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS reel_ai_drama.jobs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pitch_id            uuid NOT NULL REFERENCES reel_ai_drama.pitches (id) ON DELETE CASCADE,
    status              text NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'running', 'ok', 'failed', 'killed')),
    trigger             text NOT NULL DEFAULT 'auto' CHECK (trigger IN ('auto', 'click')),
    mode                text NOT NULL CHECK (mode IN ('development', 'production')),
    stage               text,
    spend_cap_usd       numeric NOT NULL,
    spend_usd           numeric NOT NULL DEFAULT 0,
    capped              boolean NOT NULL DEFAULT false,
    models              jsonb NOT NULL DEFAULT '{}'::jsonb,
    flags               jsonb NOT NULL DEFAULT '[]'::jsonb,
    kill_reason         text,
    error               text,
    requested_at        timestamptz NOT NULL DEFAULT now(),
    started_at          timestamptz,
    finished_at         timestamptz
);

CREATE INDEX IF NOT EXISTS ix_rad_jobs_status ON reel_ai_drama.jobs (status, requested_at);

-- Text and file outputs of a job (fact sheet, inventory, writer draft, storyboard, reports, video…).
CREATE TABLE IF NOT EXISTS reel_ai_drama.artifacts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              uuid NOT NULL REFERENCES reel_ai_drama.jobs (id) ON DELETE CASCADE,
    kind                text NOT NULL,
    content             text,
    storage_path        text,
    bytes               bigint,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ── Visual assets and their use (MD-41, MD-45, MD-46) ────────────────────────
-- One row per harvested or made visual. `asset_key` identifies the image across reels: the
-- perceptual hash when known, else the source URL.
CREATE TABLE IF NOT EXISTS reel_ai_drama.assets (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              uuid REFERENCES reel_ai_drama.jobs (id) ON DELETE CASCADE,
    asset_key           text NOT NULL,
    ref                 text NOT NULL,
    kind                text NOT NULL,
    status              text NOT NULL CHECK (status IN ('usable', 'rejected')),
    reject_reason       text,
    data                jsonb NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_rad_assets_key ON reel_ai_drama.assets (asset_key);

-- An asset shown in a delivered reel. The 20-day rule reads this (character images exempt).
CREATE TABLE IF NOT EXISTS reel_ai_drama.asset_uses (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_key           text NOT NULL,
    job_id              uuid REFERENCES reel_ai_drama.jobs (id) ON DELETE CASCADE,
    purpose             text NOT NULL,
    character_image     boolean NOT NULL DEFAULT false,
    used_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_rad_asset_uses_key ON reel_ai_drama.asset_uses (asset_key, used_at DESC);

-- ── Cost ledger and Jev log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reel_ai_drama.cost_events (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          uuid,
    pitch_id            uuid,
    job_id              uuid,
    mode                text NOT NULL CHECK (mode IN ('development', 'production')),
    vendor              text NOT NULL CHECK (vendor IN ('anthropic', 'heygen', 'jev', 'openai', 'serper', 'other')),
    component           text NOT NULL,
    input_tokens        integer NOT NULL DEFAULT 0,
    output_tokens       integer NOT NULL DEFAULT 0,
    cache_read_tokens   integer NOT NULL DEFAULT 0,
    cache_write_tokens  integer NOT NULL DEFAULT 0,
    web_searches        integer NOT NULL DEFAULT 0,
    usd                 numeric NOT NULL DEFAULT 0,
    usd_known           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_rad_cost_job ON reel_ai_drama.cost_events (job_id);
CREATE INDEX IF NOT EXISTS ix_rad_cost_session ON reel_ai_drama.cost_events (session_id);

CREATE TABLE IF NOT EXISTS reel_ai_drama.jev_logs (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id              uuid,
    pitch_id                uuid,
    job_id                  uuid,
    component               text NOT NULL,
    question_set_id         text NOT NULL,
    question_set_version    text NOT NULL,
    resolved_model          text,
    state                   jsonb NOT NULL,
    answers                 jsonb NOT NULL,
    input_tokens            integer NOT NULL DEFAULT 0,
    created_at              timestamptz NOT NULL DEFAULT now()
);
