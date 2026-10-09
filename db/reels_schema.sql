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
-- One slate per run. A later run on the same New York date does not delete the
-- earlier slate. The page shows the latest, and can switch back to the one
-- before it.

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
    -- Both calls, all four lines, and the Jev scores. The columns above are the winner.
    variants        jsonb,
    -- Small cue under the on-screen copy. On only when the caption holds a deferred story.
    full_story_below boolean NOT NULL DEFAULT false,
    -- The chosen line, without the hand. Null when the cue is off.
    full_story_cue  text,
    error           text,
    input_tokens    integer NOT NULL DEFAULT 0,
    output_tokens   integer NOT NULL DEFAULT 0,
    usd             numeric(12, 6) NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (slate_id, post_idea_id)
);

ALTER TABLE reels.idea_copy ADD COLUMN IF NOT EXISTS variants jsonb;
ALTER TABLE reels.idea_copy ADD COLUMN IF NOT EXISTS full_story_below boolean NOT NULL DEFAULT false;
ALTER TABLE reels.idea_copy ADD COLUMN IF NOT EXISTS full_story_cue text;
-- D-213. One plain sentence on why the viewer should care, from the winning call.
ALTER TABLE reels.idea_copy ADD COLUMN IF NOT EXISTS viewer_stake text;

-- D-220. Every copy attempt, ok or failed, appended in full. reels.idea_copy
-- keeps the current row per slate and idea, and a failed attempt no longer
-- replaces an ok one there.
CREATE TABLE IF NOT EXISTS reels.idea_copy_history (
    id              bigserial PRIMARY KEY,
    slate_id        uuid NOT NULL REFERENCES reels.score_slates (id) ON DELETE CASCADE,
    post_idea_id    uuid NOT NULL REFERENCES reels.post_ideas (id) ON DELETE CASCADE,
    run_id          uuid REFERENCES reels.runs (id) ON DELETE SET NULL,
    prompt_version  text NOT NULL,
    model           text NOT NULL,
    bucket          text NOT NULL,
    framework       text NOT NULL,
    status          text NOT NULL CHECK (status IN ('ok', 'failed')),
    on_screen_copy  text,
    viewer_stake    text,
    caption         text,
    call_to_action  text,
    hashtags        text[] NOT NULL DEFAULT ARRAY[]::text[],
    sources         jsonb NOT NULL DEFAULT '[]'::jsonb,
    checks          jsonb,
    working         jsonb,
    variants        jsonb,
    full_story_below boolean NOT NULL DEFAULT false,
    full_story_cue  text,
    error           text,
    input_tokens    integer NOT NULL DEFAULT 0,
    output_tokens   integer NOT NULL DEFAULT 0,
    usd             numeric(12, 6) NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reels_idea_copy_history_idea
    ON reels.idea_copy_history (slate_id, post_idea_id, created_at DESC);

-- Seed the history once with the rows that already exist, so the next attempt
-- does not leave the only copy of today's copy in a row it may replace.
INSERT INTO reels.idea_copy_history (
    slate_id, post_idea_id, run_id, prompt_version, model, bucket, framework, status,
    on_screen_copy, viewer_stake, caption, call_to_action, hashtags, sources, checks,
    working, variants, full_story_below, full_story_cue, error, input_tokens,
    output_tokens, usd, created_at
)
SELECT c.slate_id, c.post_idea_id, c.run_id, c.prompt_version, c.model, c.bucket, c.framework,
       c.status, c.on_screen_copy, c.viewer_stake, c.caption, c.call_to_action, c.hashtags,
       c.sources, c.checks, c.working, c.variants, c.full_story_below, c.full_story_cue,
       c.error, c.input_tokens, c.output_tokens, c.usd, c.created_at
  FROM reels.idea_copy c
 WHERE NOT EXISTS (
         SELECT 1 FROM reels.idea_copy_history h
          WHERE h.slate_id = c.slate_id AND h.post_idea_id = c.post_idea_id
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
  CHECK (vendor IN ('jev', 'anthropic', 'openai', 'huggingface'));

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
    -- copy rewrites the line. frame and video keep the copy already stored (D-225).
    start_stage   text NOT NULL DEFAULT 'copy' CHECK (start_stage IN ('copy', 'frame', 'video')),
    requested_at  timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reels_finish_active
    ON reels.finish_requests (requested_at)
    WHERE status = 'active';

ALTER TABLE reels.finish_requests
    ADD COLUMN IF NOT EXISTS start_stage text NOT NULL DEFAULT 'copy'
    CHECK (start_stage IN ('copy', 'frame', 'video'));

-- A miss on the copy gate drops an idea for this New York day only (D-224).
-- The idea's net is unchanged, so tomorrow's carryover uses the original score.
CREATE TABLE IF NOT EXISTS reels.copy_day_penalties (
    ny_date       date NOT NULL,
    post_idea_id  uuid NOT NULL REFERENCES reels.post_ideas (id) ON DELETE CASCADE,
    penalty       double precision NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ny_date, post_idea_id)
);

-- A reel Lucas wants left as generated. The slot counts toward that day's
-- passing set, and the pipeline will not rewrite the idea (D-226).
CREATE TABLE IF NOT EXISTS reels.reel_locks (
    ny_date       date NOT NULL,
    slot          integer NOT NULL CHECK (slot >= 1),
    post_idea_id  uuid NOT NULL REFERENCES reels.post_ideas (id) ON DELETE CASCADE,
    slate_id      uuid NOT NULL REFERENCES reels.score_slates (id) ON DELETE CASCADE,
    note          text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ny_date, slot)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_reel_locks_idea
    ON reels.reel_locks (ny_date, post_idea_id);

INSERT INTO reels.reel_locks (ny_date, slot, post_idea_id, slate_id, note)
SELECT v.ny_date, v.slot, v.post_idea_id, v.slate_id, v.note
  FROM (VALUES
    ('2026-09-29'::date, 1, 'be6dcb3a-93e0-4988-b5fa-95594fd481e7'::uuid,
     'c0d86bac-ef23-4293-b04d-f60de37e2879'::uuid,
     'Locked 2026-09-29. Lucas: this reel stays as generated.'),
    ('2026-09-29'::date, 2, '394cd848-ef21-4da4-a787-1fe520a61dc1'::uuid,
     'c0d86bac-ef23-4293-b04d-f60de37e2879'::uuid,
     'Locked 2026-09-29. Lucas: this reel stays as generated.')
  ) AS v(ny_date, slot, post_idea_id, slate_id, note)
 WHERE EXISTS (SELECT 1 FROM reels.post_ideas p WHERE p.id = v.post_idea_id)
   AND EXISTS (SELECT 1 FROM reels.score_slates s WHERE s.id = v.slate_id)
ON CONFLICT (ny_date, slot) DO NOTHING;

-- ── Song pool (music plan, D-136 to D-177) ──────────────────────────────────
-- Trending Instagram sounds, attached to reels by audio_id (D-136). At most 50
-- rows; the oldest unattached song is hard-deleted first (D-141, D-164).
-- Ingest stores a row untagged; tagging fills the tag columns once the
-- vocabularies are approved, and only tagged songs are shortlisted (D-165).

CREATE TABLE IF NOT EXISTS reels.songs (
    audio_id                     text PRIMARY KEY,
    audio_type                   text NOT NULL CHECK (audio_type IN ('music', 'original_sound')),
    title                        text,
    display_artist               text,
    ig_username                  text,
    profile_picture_url          text,
    cover_artwork_thumbnail_uri  text,
    on_platform_audio_preview_link text,
    is_ads_eligible              boolean,
    duration_in_ms               integer,
    -- The list and rank it entered on. Reappearing never resets its age (D-141).
    trending_list                text NOT NULL CHECK (trending_list IN ('music', 'original_sound')),
    trending_rank                integer NOT NULL,
    first_ingested_at            timestamptz NOT NULL DEFAULT now(),
    last_seen_trending_at        timestamptz NOT NULL DEFAULT now(),
    -- Cached before Meta's link expires (about 1.5 days).
    preview_storage_path         text NOT NULL,
    preview_duration_ms          integer,
    -- MUS-09 tags, NULL until tagged (D-165).
    genre                        text,
    bpm                          double precision,
    instruments                  text[],
    vibes                        text[],
    -- Every vocabulary label's CLAP score, so MUS-V1 settings can be compared
    -- without another call.
    tag_scores                   jsonb,
    tag_version                  text,
    clap_model                   text,
    tag_text                     text,
    tag_text_embedding           real[],
    -- Evidence only at gate 2 (D-169).
    audio_embedding              real[],
    tagged_at                    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_reels_songs_age
    ON reels.songs (first_ingested_at);

-- One row per ingest, scheduled at 12:30 AM or run by hand (D-166). Separate
-- from reels.runs so an ingest never blocks or is blocked by the 1 AM night.
CREATE TABLE IF NOT EXISTS reels.song_ingests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger         text NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
    status          text NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'failed')),
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    -- The trending lists as fetched: audio_id, list, rank, whether a preview existed.
    fetched         jsonb NOT NULL DEFAULT '[]'::jsonb,
    added           text[] NOT NULL DEFAULT ARRAY[]::text[],
    skipped         jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- audio_id, title, and artist of every hard-deleted song.
    evicted         jsonb NOT NULL DEFAULT '[]'::jsonb,
    note            text
);

CREATE INDEX IF NOT EXISTS idx_reels_song_ingests_started
    ON reels.song_ingests (started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_song_ingests_single_running
    ON reels.song_ingests ((status)) WHERE status = 'running';

-- ── Song pick per reel (D-161, D-163, D-170) ────────────────────────────────
-- Queued when a video job finishes ok. The shortlist is a snapshot of what Jev
-- saw, so the record survives the songs' eviction (D-163). A failed pick is
-- retried as a new row; the latest ok row is the reel's song.

CREATE TABLE IF NOT EXISTS reels.song_picks (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    video_job_id          uuid NOT NULL REFERENCES reels.video_jobs (id) ON DELETE CASCADE,
    post_idea_id          uuid NOT NULL,
    status                text NOT NULL CHECK (status IN ('requested', 'running', 'ok', 'failed')),
    requested_at          timestamptz NOT NULL DEFAULT now(),
    started_at            timestamptz,
    finished_at           timestamptz,
    -- On-screen copy plus caption body, as embedded (D-147).
    copy_text             text,
    -- 12 × {audio_id, title, artist, genre, bpm, instruments, vibes, similarity, audio_similarity}.
    shortlist             jsonb,
    picked_audio_id       text,
    picked_title          text,
    picked_artist         text,
    probabilities         jsonb,
    confidence            double precision,
    question_set_version  text,
    resolved_model        text,
    error                 text,
    usd                   numeric(12, 6) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reels_song_picks_video
    ON reels.song_picks (video_job_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_song_picks_single_running
    ON reels.song_picks ((status)) WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_song_picks_inflight_video
    ON reels.song_picks (video_job_id) WHERE status IN ('requested', 'running');

-- ── Publish attempts (D-162, D-167) ─────────────────────────────────────────
-- One row per Approve (or per auto-publish). The worker creates the container,
-- polls it to FINISHED, and publishes. No FK to post_ideas and the video FK
-- nulls out, so the record of what posted outlives retention, like
-- published_status (D-061). A success also upserts published_status.
--
-- Frozen: publish_attempts, posting_schedule and media_insights moved to the
-- lifecycle spine (social_hub, D39). History only; scripts/backfill_spine.ts
-- reads them and nothing writes them. Dropped in unification Phase 7.
-- published_status stays here and is still written.

CREATE TABLE IF NOT EXISTS reels.publish_attempts (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    video_job_id      uuid REFERENCES reels.video_jobs (id) ON DELETE SET NULL,
    post_idea_id      uuid NOT NULL,
    song_pick_id      uuid REFERENCES reels.song_picks (id) ON DELETE SET NULL,
    -- mix_test: the MUS-V2 test publishes, run by hand at chosen volumes.
    trigger           text NOT NULL CHECK (trigger IN ('approve', 'auto', 'mix_test', 'force')),
    status            text NOT NULL CHECK (status IN (
                        'requested', 'creating', 'processing', 'publishing', 'published', 'failed'
                      )),
    requested_at      timestamptz NOT NULL DEFAULT now(),
    started_at        timestamptz,
    finished_at       timestamptz,
    -- What was sent (D-158, D-157, D-159), snapshotted so the reel-to-song link
    -- survives the song's hard-delete (OPEN-4).
    audio_id          text NOT NULL,
    song_title        text,
    song_artist       text,
    audio_volume      integer CHECK (audio_volume BETWEEN 0 AND 100),
    video_volume      integer CHECK (video_volume BETWEEN 0 AND 100),
    caption           text NOT NULL,
    graduation_strategy text NOT NULL,
    share_to_feed     boolean,
    container_id      text,
    media_id          text,
    permalink         text,
    status_log        jsonb NOT NULL DEFAULT '[]'::jsonb,
    error             text,
    -- Last time Instagram was asked, and when the reel aged out of the warm window
    -- and received its closing read. Settled reels are not asked again.
    insights_checked_at timestamptz,
    insights_settled_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_reels_publish_video
    ON reels.publish_attempts (video_job_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_reels_publish_recent
    ON reels.publish_attempts (requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_publish_inflight_video
    ON reels.publish_attempts (video_job_id)
    WHERE status IN ('requested', 'creating', 'processing', 'publishing');
-- A reel posts once. Mix tests post the same reel at 2–3 mixes on purpose (MUS-V2).
DROP INDEX IF EXISTS reels.idx_reels_publish_once;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_publish_once_v2
    ON reels.publish_attempts (video_job_id) WHERE status = 'published' AND trigger <> 'mix_test';

ALTER TABLE reels.publish_attempts ADD COLUMN IF NOT EXISTS insights_checked_at timestamptz;
ALTER TABLE reels.publish_attempts ADD COLUMN IF NOT EXISTS insights_settled_at timestamptz;

-- Open reels are the only ones a refresh reads. Settled history stays in media_insights.
CREATE INDEX IF NOT EXISTS idx_reels_publish_insights_open
    ON reels.publish_attempts (finished_at DESC)
    WHERE status = 'published'
      AND trigger <> 'mix_test'
      AND insights_settled_at IS NULL
      AND media_id IS NOT NULL;

-- Databases created before mix_test existed keep the old trigger check until this runs.
DO $$
DECLARE
  cons text;
BEGIN
  FOR cons IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'reels' AND t.relname = 'publish_attempts' AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%trigger%'
       AND pg_get_constraintdef(c.oid) NOT ILIKE '%mix_test%'
  LOOP
    EXECUTE format('ALTER TABLE reels.publish_attempts DROP CONSTRAINT %I', cons);
    EXECUTE 'ALTER TABLE reels.publish_attempts ADD CONSTRAINT publish_attempts_trigger_check CHECK (trigger IN (''approve'', ''auto'', ''mix_test'', ''force''))';
  END LOOP;
END $$;

-- Databases created before force-post existed keep the old trigger check until this runs.
DO $$
DECLARE
  cons text;
BEGIN
  FOR cons IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'reels' AND t.relname = 'publish_attempts' AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%trigger%'
       AND pg_get_constraintdef(c.oid) NOT ILIKE '%force%'
  LOOP
    EXECUTE format('ALTER TABLE reels.publish_attempts DROP CONSTRAINT %I', cons);
    EXECUTE 'ALTER TABLE reels.publish_attempts ADD CONSTRAINT publish_attempts_trigger_check CHECK (trigger IN (''approve'', ''auto'', ''mix_test'', ''force''))';
  END LOOP;
END $$;

-- ── Settings the page and the worker share (D-173) ──────────────────────────

CREATE TABLE IF NOT EXISTS reels.settings (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Live is the nightly auto-schedule. Off until it is switched on.
INSERT INTO reels.settings (key, value)
VALUES ('publishing_live', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- The private review link stays on the coming-soon line until the hub switch is on.
INSERT INTO reels.settings (key, value)
VALUES ('review_open', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Spend before this instant is development and stays off the monthly watch.
INSERT INTO reels.settings (key, value)
VALUES ('prod_spend_since', '"2026-09-30T04:00:00.000Z"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- One reel per Eastern-time slot per day. Force post does not take a row.
CREATE TABLE IF NOT EXISTS reels.posting_schedule (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_idea_id        uuid NOT NULL,
    video_job_id        uuid,
    ny_date             date NOT NULL,
    slot                text NOT NULL CHECK (slot IN ('morning', 'midday', 'evening')),
    publish_at          timestamptz NOT NULL,
    status              text NOT NULL CHECK (status IN ('scheduled', 'publishing', 'published', 'cancelled', 'failed')),
    source              text NOT NULL CHECK (source IN ('auto', 'user')),
    publish_attempt_id  uuid,
    error               text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- A person's approval of the slot (docs/social-overnight.md). With require_approval on, an
-- auto-scheduled reel posts only once approved; a reel a person scheduled is approved by that act.
ALTER TABLE reels.posting_schedule ADD COLUMN IF NOT EXISTS approved_at timestamptz;

INSERT INTO reels.settings (key, value) VALUES ('require_approval', 'true'::jsonb) ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_reels_posting_schedule_due
    ON reels.posting_schedule (publish_at)
    WHERE status = 'scheduled';
CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_posting_schedule_slot
    ON reels.posting_schedule (ny_date, slot)
    WHERE status IN ('scheduled', 'publishing', 'published');
CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_posting_schedule_idea
    ON reels.posting_schedule (post_idea_id)
    WHERE status IN ('scheduled', 'publishing');

-- ── Original-sound trending observations (D-190) ────────────────────────────
-- Meta returns no engagement or trending metric, so the ingest samples the
-- original_sound list several times a night and ranks by how many nights a
-- sound has stayed on it, then by its average position. One row per sound per
-- sample. Kept 30 days.

CREATE TABLE IF NOT EXISTS reels.sound_observations (
    id            bigserial PRIMARY KEY,
    ingest_id     uuid REFERENCES reels.song_ingests (id) ON DELETE SET NULL,
    observed_at   timestamptz NOT NULL DEFAULT now(),
    ny_date       date NOT NULL,
    audio_type    text NOT NULL CHECK (audio_type IN ('music', 'original_sound')),
    sample_n      integer NOT NULL,
    position      integer NOT NULL,
    audio_id      text NOT NULL,
    has_preview   boolean NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reels_sound_obs_window
    ON reels.sound_observations (audio_type, ny_date DESC, audio_id);

-- ── Instagram performance snapshots ─────────────────────────────────────────
-- Lifetime totals from the media insights edge, one row per published reel per
-- New York day we asked. A reel is asked every 30 minutes for two days, once a
-- day through day 14, then once more. Rows are kept. A later poll the same day
-- keeps a number it already stored when the new response leaves that metric
-- blank. Mix-test publishes are not polled.

CREATE TABLE IF NOT EXISTS reels.media_insights (
    media_id             text NOT NULL,
    ny_date              date NOT NULL,
    publish_attempt_id   uuid REFERENCES reels.publish_attempts (id) ON DELETE CASCADE,
    captured_at          timestamptz NOT NULL DEFAULT now(),
    views                double precision,
    reach                double precision,
    likes                double precision,
    comments             double precision,
    saved                double precision,
    shares               double precision,
    reposts              double precision,
    total_interactions   double precision,
    avg_watch_time_ms    double precision,
    total_watch_time_ms  double precision,
    skip_rate            double precision,
    is_shared_to_feed    boolean,
    raw                  jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (media_id, ny_date)
);

CREATE INDEX IF NOT EXISTS idx_reels_media_insights_attempt
    ON reels.media_insights (publish_attempt_id, ny_date DESC);
