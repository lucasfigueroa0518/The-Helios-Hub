-- db/reels_schema.sql — Trial Reels Build 1 (idempotent).
-- Schema `reels` inside the existing Helios Supabase Postgres (D-018).
--
-- Retention (D-044, D-046): source rows are hard-deleted 3 weeks after
-- ingest_time. Fingerprints, published_status, and jev_logs outlive them, so a
-- deleted URL cannot come back as "new" and "why were these grouped?" stays
-- answerable after the bodies are gone.
--
-- Apply:
--   npm run db:reels
--   # or full: npm run db:setup
\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS reels;

-- ── Runs ────────────────────────────────────────────────────────────────────

-- `requested` is how the app asks for a run: the page cannot execute a night
-- itself (Vercel would time out), so it queues and the helios-reels worker
-- claims it (D-017, D-049).
CREATE TABLE IF NOT EXISTS reels.runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger         text NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
    status          text NOT NULL
                      CHECK (status IN ('requested', 'running', 'ok', 'partial', 'failed', 'skipped')),
    requested_at    timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    finished_at     timestamptz,
    note            text,
    source_results  jsonb NOT NULL DEFAULT '[]'::jsonb,
    stats           jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_reels_runs_requested
    ON reels.runs (requested_at DESC);

-- At most one run in flight, and at most one queued behind it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_runs_single_running
    ON reels.runs ((status)) WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_runs_single_requested
    ON reels.runs ((status)) WHERE status = 'requested';

-- ── Normalized source records (REC-01 / D-039) ──────────────────────────────

CREATE TABLE IF NOT EXISTS reels.sources (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          uuid REFERENCES reels.runs (id) ON DELETE SET NULL,
    canonical_url   text NOT NULL,
    headline        text NOT NULL,
    body            text NOT NULL DEFAULT '',
    author          text,
    byline          text,
    source_name     text NOT NULL,
    source_type     text NOT NULL,
    adapter_id      text NOT NULL,
    bucket          text NOT NULL CHECK (bucket IN ('A', 'B')),
    publish_time    timestamptz,
    ingest_time     timestamptz NOT NULL DEFAULT now(),
    language        text,
    engagement      jsonb NOT NULL DEFAULT '{}'::jsonb,
    media_urls      text[] NOT NULL DEFAULT ARRAY[]::text[],
    citation_urls   text[] NOT NULL DEFAULT ARRAY[]::text[],
    raw_payload     jsonb,
    -- NULL = kept in the pool. Non-NULL rows stay visible on the raw-pool page
    -- with their reason (D-048) but never become post ideas.
    drop_reason     text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per URL per adapter per run. Two adapters may legitimately surface
-- the same URL in one night (a story on HN and in its outlet's feed); grouping
-- auto-merges that pair rather than ingest silently dropping one of them.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_sources_url_adapter_run
    ON reels.sources (canonical_url, adapter_id, run_id);
CREATE INDEX IF NOT EXISTS idx_reels_sources_ingest
    ON reels.sources (ingest_time DESC);
CREATE INDEX IF NOT EXISTS idx_reels_sources_adapter
    ON reels.sources (adapter_id, ingest_time DESC);
CREATE INDEX IF NOT EXISTS idx_reels_sources_run
    ON reels.sources (run_id);
CREATE INDEX IF NOT EXISTS idx_reels_sources_headline_trgm
    ON reels.sources USING gin (headline gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_reels_sources_kept
    ON reels.sources (ingest_time DESC)
    WHERE drop_reason IS NULL;

-- ── Fingerprints outlive the record they came from (D-046) ──────────────────

CREATE TABLE IF NOT EXISTS reels.fingerprints (
    canonical_url   text PRIMARY KEY,
    adapter_id      text,
    first_seen      timestamptz NOT NULL DEFAULT now(),
    last_seen       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reels_fingerprints_first_seen
    ON reels.fingerprints (first_seen DESC);

-- ── Dated-feed watermarks (D-032) ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reels.watermarks (
    adapter_id      text PRIMARY KEY,
    last_success_at timestamptz,
    last_attempt_at timestamptz
);

-- ── Post ideas (D-059) ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reels.post_ideas (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    first_seen      timestamptz NOT NULL DEFAULT now(),
    -- The 72-hour reference pool runs on this column (D-007).
    last_joined     timestamptz NOT NULL DEFAULT now(),
    -- New tonight, or a member joined tonight. Build 2 scores on this (D-059).
    timely          boolean NOT NULL DEFAULT true,
    version_n       integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reels_ideas_last_joined
    ON reels.post_ideas (last_joined DESC);
CREATE INDEX IF NOT EXISTS idx_reels_ideas_timely
    ON reels.post_ideas (timely) WHERE timely;

-- A source belongs to at most one post idea (D-058): source_id is the PK.
CREATE TABLE IF NOT EXISTS reels.post_idea_members (
    source_id       uuid PRIMARY KEY REFERENCES reels.sources (id) ON DELETE CASCADE,
    post_idea_id    uuid NOT NULL REFERENCES reels.post_ideas (id) ON DELETE CASCADE,
    role            text NOT NULL CHECK (role IN ('primary', 'supporting', 'merged_duplicate')),
    joined_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reels_members_idea
    ON reels.post_idea_members (post_idea_id);

-- Snapshot on every membership change (D-060).
CREATE TABLE IF NOT EXISTS reels.post_idea_versions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_idea_id    uuid NOT NULL REFERENCES reels.post_ideas (id) ON DELETE CASCADE,
    version_n       integer NOT NULL,
    reason          text NOT NULL,
    members         jsonb NOT NULL,
    run_id          uuid REFERENCES reels.runs (id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (post_idea_id, version_n)
);

-- No FK to post_ideas: the row survives the idea it describes (D-045, D-061).
CREATE TABLE IF NOT EXISTS reels.published_status (
    post_idea_id    uuid PRIMARY KEY,
    published       boolean NOT NULL DEFAULT false,
    published_at    timestamptz,
    last_updated    timestamptz NOT NULL DEFAULT now()
);

-- ── Jev call log (D-030) ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reels.jev_logs (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                  uuid REFERENCES reels.runs (id) ON DELETE SET NULL,
    component               text NOT NULL,
    question_set_id         text NOT NULL,
    question_set_version    text NOT NULL,
    -- The versioned ID the alias resolved to, from the response (D-021).
    resolved_model          text,
    state                   jsonb NOT NULL,
    answers                 jsonb NOT NULL,
    input_tokens            integer NOT NULL DEFAULT 0,
    source_id               uuid REFERENCES reels.sources (id) ON DELETE SET NULL,
    post_idea_id            uuid REFERENCES reels.post_ideas (id) ON DELETE SET NULL,
    -- Kept for the post idea's life plus 3 weeks (D-030).
    expires_at              timestamptz NOT NULL DEFAULT (now() + interval '21 days'),
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reels_jev_logs_run
    ON reels.jev_logs (run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reels_jev_logs_idea
    ON reels.jev_logs (post_idea_id);
CREATE INDEX IF NOT EXISTS idx_reels_jev_logs_expires
    ON reels.jev_logs (expires_at);

-- ── Sticky grouping decisions (D-058, GRP-07) ───────────────────────────────
-- Keyed by canonical URL pair, not source id, so a decision survives the
-- 3-week deletion of the rows it was made about.

CREATE TABLE IF NOT EXISTS reels.grouping_decisions (
    left_url        text NOT NULL,
    right_url       text NOT NULL,
    action          text NOT NULL CHECK (action IN ('merge', 'link', 'leave')),
    same_event_p    double precision,
    confidence      double precision,
    override        boolean NOT NULL DEFAULT false,
    run_id          uuid REFERENCES reels.runs (id) ON DELETE SET NULL,
    decided_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (left_url, right_url)
);

-- ── Review flags feed the calibration set (D-054, D-063) ────────────────────

CREATE TABLE IF NOT EXISTS reels.review_flags (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            text NOT NULL CHECK (kind IN ('wrong_merge', 'missed_link', 'junk_source')),
    post_idea_id    uuid REFERENCES reels.post_ideas (id) ON DELETE SET NULL,
    source_id       uuid REFERENCES reels.sources (id) ON DELETE SET NULL,
    source_url      text,
    note            text,
    created_by      text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reels_review_flags_created
    ON reels.review_flags (created_at DESC);

-- ── A4 standing catalog (D-066) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reels.list_catalog (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id         text NOT NULL,
    entry_name      text NOT NULL,
    entry_url       text NOT NULL,
    repo_full_name  text,
    description     text,
    first_seen      timestamptz NOT NULL DEFAULT now(),
    last_considered timestamptz,
    last_ingested   timestamptz,
    UNIQUE (list_id, entry_url)
);

CREATE INDEX IF NOT EXISTS idx_reels_catalog_rotation
    ON reels.list_catalog (last_considered NULLS FIRST);

-- ── Spend watch (D-023) ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reels.cost_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          uuid REFERENCES reels.runs (id) ON DELETE SET NULL,
    vendor          text NOT NULL CHECK (vendor IN ('jev', 'anthropic', 'openai')),
    component       text NOT NULL,
    input_tokens    integer NOT NULL DEFAULT 0,
    output_tokens   integer NOT NULL DEFAULT 0,
    usd             numeric(12, 6) NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reels_cost_created
    ON reels.cost_events (created_at DESC);

-- ── Scoring slates (Build 2, D-079, D-080, D-085) ───────────────────────────
-- One slate per run. A later run on the same New York date replaces it as the
-- slate the page shows, because the page reads the latest scored_at.

CREATE TABLE IF NOT EXISTS reels.score_slates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          uuid NOT NULL REFERENCES reels.runs (id) ON DELETE CASCADE,
    ny_date         date NOT NULL,
    scored_at       timestamptz NOT NULL DEFAULT now(),
    pass1_version   text NOT NULL,
    pass2_version   text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_score_slates_run
    ON reels.score_slates (run_id);
CREATE INDEX IF NOT EXISTS idx_reels_score_slates_ny
    ON reels.score_slates (ny_date DESC, scored_at DESC);

CREATE TABLE IF NOT EXISTS reels.idea_scores (
    slate_id            uuid NOT NULL REFERENCES reels.score_slates (id) ON DELETE CASCADE,
    post_idea_id        uuid NOT NULL REFERENCES reels.post_ideas (id) ON DELETE CASCADE,
    origin              text NOT NULL CHECK (origin IN ('timely', 'carryover')),
    net                 double precision,
    rank                integer,
    selected            boolean NOT NULL DEFAULT false,
    chosen_bucket       text,
    chosen_framework    text,
    psychology          double precision,
    bucket_score        double precision,
    value_score         double precision,
    blockbuster         double precision NOT NULL DEFAULT 0,
    confidence          double precision,
    components          jsonb NOT NULL,
    PRIMARY KEY (slate_id, post_idea_id)
);

CREATE INDEX IF NOT EXISTS idx_reels_idea_scores_idea
    ON reels.idea_scores (post_idea_id);
CREATE INDEX IF NOT EXISTS idx_reels_idea_scores_rank
    ON reels.idea_scores (slate_id, rank);

-- ── On-screen copy and captions (Build 3, D-090 to D-095) ───────────────────
-- One row per selected idea per slate. A same-day rerun writes a new slate, so
-- the page (which reads the latest slate) shows the replacement (D-090).

CREATE TABLE IF NOT EXISTS reels.idea_copy (
    slate_id        uuid NOT NULL REFERENCES reels.score_slates (id) ON DELETE CASCADE,
    post_idea_id    uuid NOT NULL REFERENCES reels.post_ideas (id) ON DELETE CASCADE,
    run_id          uuid REFERENCES reels.runs (id) ON DELETE SET NULL,
    prompt_version  text NOT NULL,
    model           text NOT NULL,
    bucket          text NOT NULL,
    framework       text NOT NULL,
    status          text NOT NULL CHECK (status IN ('ok', 'failed')),
    on_screen_copy  text,
    caption         text,
    call_to_action  text,
    hashtags        text[] NOT NULL DEFAULT ARRAY[]::text[],
    -- Named in the caption; URLs are for review only (D-095).
    sources         jsonb NOT NULL DEFAULT '[]'::jsonb,
    checks          jsonb,
    -- Hook drafts, first drafts, remaining humanizer patterns. Not shown.
    working         jsonb,
    error           text,
    input_tokens    integer NOT NULL DEFAULT 0,
    output_tokens   integer NOT NULL DEFAULT 0,
    usd             numeric(12, 6) NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (slate_id, post_idea_id)
);

-- Existing databases keep the original vendor check until this runs.
DO $$
DECLARE
  cons text;
BEGIN
  FOR cons IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'reels'
       AND t.relname = 'cost_events'
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%vendor%'
  LOOP
    EXECUTE format('ALTER TABLE reels.cost_events DROP CONSTRAINT %I', cons);
  END LOOP;
END $$;
ALTER TABLE reels.cost_events
  ADD CONSTRAINT cost_events_vendor_check
  CHECK (vendor IN ('jev', 'anthropic', 'openai'));

-- ── Reel frames (visual pipeline) ───────────────────────────────────────────
-- One row per click of Generate frame. The page queues; the helios-reels
-- worker claims. The final PNG is the still the image-to-video step will use.

CREATE TABLE IF NOT EXISTS reels.visual_jobs (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_idea_id            uuid NOT NULL REFERENCES reels.post_ideas (id) ON DELETE CASCADE,
    slate_id                uuid REFERENCES reels.score_slates (id) ON DELETE SET NULL,
    status                  text NOT NULL CHECK (status IN (
                              'requested', 'running', 'ok', 'failed',
                              'rejected_background', 'copy_does_not_fit'
                            )),
    requested_at            timestamptz NOT NULL DEFAULT now(),
    started_at              timestamptz,
    finished_at             timestamptz,
    category                text,
    story                   text,
    on_screen_copy          text,
    scene                   text,
    image_prompt            text,
    background_storage_path text,
    frame_storage_path      text,
    background_qa           jsonb,
    render                  jsonb,
    warnings                jsonb NOT NULL DEFAULT '[]'::jsonb,
    error                   text,
    input_tokens            integer NOT NULL DEFAULT 0,
    output_tokens           integer NOT NULL DEFAULT 0,
    usd                     numeric(12, 6) NOT NULL DEFAULT 0,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reels_visual_idea_requested
    ON reels.visual_jobs (post_idea_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_visual_single_running
    ON reels.visual_jobs ((status)) WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_visual_inflight_idea
    ON reels.visual_jobs (post_idea_id) WHERE status IN ('requested', 'running');

-- ── On-demand copy and captions ─────────────────────────────────────────────
-- One row per click of Generate Copy + Captions. The page queues; the
-- helios-reels worker claims and writes reels.idea_copy for that idea.

CREATE TABLE IF NOT EXISTS reels.copy_jobs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_idea_id  uuid NOT NULL REFERENCES reels.post_ideas (id) ON DELETE CASCADE,
    slate_id      uuid NOT NULL REFERENCES reels.score_slates (id) ON DELETE CASCADE,
    status        text NOT NULL CHECK (status IN ('requested', 'running', 'ok', 'failed')),
    requested_at  timestamptz NOT NULL DEFAULT now(),
    started_at    timestamptz,
    finished_at   timestamptz,
    error         text,
    usd           numeric(12, 6) NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reels_copy_jobs_idea_requested
    ON reels.copy_jobs (post_idea_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_copy_jobs_single_running
    ON reels.copy_jobs ((status)) WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_copy_jobs_inflight_idea
    ON reels.copy_jobs (post_idea_id) WHERE status IN ('requested', 'running');

-- ── Reel video (Kling image-to-video) ───────────────────────────────────────
-- One row per click of Generate video. The page queues; the helios-reels
-- worker writes the motion, calls Higgsfield, then overlays the text plate.

CREATE TABLE IF NOT EXISTS reels.video_jobs (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_idea_id         uuid NOT NULL REFERENCES reels.post_ideas (id) ON DELETE CASCADE,
    slate_id             uuid REFERENCES reels.score_slates (id) ON DELETE SET NULL,
    visual_job_id        uuid REFERENCES reels.visual_jobs (id) ON DELETE SET NULL,
    status               text NOT NULL CHECK (status IN ('requested', 'running', 'ok', 'failed')),
    requested_at         timestamptz NOT NULL DEFAULT now(),
    started_at           timestamptz,
    finished_at          timestamptz,
    motion_prompt        text,
    video_storage_path   text,
    higgsfield_job_id    text,
    error                text,
    usd                  numeric(12, 6) NOT NULL DEFAULT 0,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reels_video_idea_requested
    ON reels.video_jobs (post_idea_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_video_single_running
    ON reels.video_jobs ((status)) WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_video_inflight_idea
    ON reels.video_jobs (post_idea_id) WHERE status IN ('requested', 'running');

-- ── Make the reel (copy, then frame, then video) ────────────────────────────
-- One request per post idea. The page queues the first missing stage; the
-- helios-reels worker advances it until a video exists or a stage fails.

CREATE TABLE IF NOT EXISTS reels.finish_requests (
    post_idea_id  uuid PRIMARY KEY REFERENCES reels.post_ideas (id) ON DELETE CASCADE,
    slate_id      uuid NOT NULL REFERENCES reels.score_slates (id) ON DELETE CASCADE,
    status        text NOT NULL CHECK (status IN ('active', 'done', 'failed')),
    error         text,
    requested_at  timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reels_finish_active
    ON reels.finish_requests (requested_at)
    WHERE status = 'active';
