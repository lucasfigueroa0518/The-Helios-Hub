-- db/field_notes_schema.sql — Field Notes (planning/Field Notes/CONTRACT.md). Idempotent, additive.
-- Needs db/media_library_schema.sql applied first (the pool points at media_library.photos).
-- Apply:
--   node scripts/apply_field_notes_schema.js
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS field_notes;

-- ── Runs (the ai_events.runs pattern) ───────────────────────────────────────
-- One row per run: a person's Generate. Only the helios-social worker carries a run out;
-- the hub only queues one. Auto-run ships off.

CREATE TABLE IF NOT EXISTS field_notes.runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger         text NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
    kind            text NOT NULL DEFAULT 'build' CHECK (kind IN ('build', 'rebuild')),
    status          text NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested', 'running', 'ok', 'partial', 'failed', 'skipped')),
    requested_at    timestamptz NOT NULL DEFAULT now(),
    requested_by    text,
    started_at      timestamptz,
    finished_at     timestamptz,
    ny_date         date,
    cap_usd         double precision NOT NULL DEFAULT 0.5,
    claude_usd      double precision NOT NULL DEFAULT 0,
    jev_usd         double precision NOT NULL DEFAULT 0,
    total_usd       double precision NOT NULL DEFAULT 0,
    stop_reason     text,
    error           text,
    record          jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_notes_runs_single_running ON field_notes.runs ((status)) WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_notes_runs_single_requested ON field_notes.runs ((status)) WHERE status = 'requested';

-- ── Settings ────────────────────────────────────────────────────────────────
-- Shipped off: no auto run, nothing booked or posted, every post waits for a person.

CREATE TABLE IF NOT EXISTS field_notes.settings (
    key             text PRIMARY KEY,
    value           jsonb NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO field_notes.settings (key, value) VALUES ('auto_run', 'false'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO field_notes.settings (key, value) VALUES ('publishing_live', 'false'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO field_notes.settings (key, value) VALUES ('require_approval', 'true'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO field_notes.settings (key, value) VALUES ('run_cap_usd', '0.5'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO field_notes.settings (key, value) VALUES ('photo_rest_posts', '8'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO field_notes.settings (key, value) VALUES ('max_pending_drafts', '3'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO field_notes.settings (key, value) VALUES ('tip_expiry_days', '30'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO field_notes.settings (key, value) VALUES ('darken_cap', '0.45'::jsonb) ON CONFLICT (key) DO NOTHING;

-- ── Tips (the idea) ─────────────────────────────────────────────────────────
-- One subject per tip. Scraped text lives in untrusted_content and is data, never
-- instructions. Seeded tips carry source_kind 'seed'.

CREATE TABLE IF NOT EXISTS field_notes.tips (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    source_kind       text NOT NULL CHECK (source_kind IN ('docs', 'github', 'hn', 'rss', 'seed')),
    source_url        text,
    source_label      text,
    subject           text NOT NULL CHECK (length(btrim(subject)) > 0),
    branch            text CHECK (branch IN ('open_source_skill', 'open_source_repo', 'paid_tool_feature')), -- retired (v4): never written
    use_with_result   text NOT NULL CHECK (length(btrim(use_with_result)) > 0),
    levels            jsonb NOT NULL DEFAULT '{}'::jsonb,
    untrusted_content text,
    score             numeric,
    status            text NOT NULL DEFAULT 'candidate'
                        CHECK (status IN ('candidate', 'selected', 'drafted', 'approved', 'posted', 'expired', 'rejected')),
    seeded_by         text
);
CREATE INDEX IF NOT EXISTS idx_field_notes_tips_status ON field_notes.tips (status, created_at DESC);

-- Audience and content tags (CONTRACT-v4 section 2; lib/field-notes/types.ts section 1 lists). Set by scoring,
-- or by the seeder for leaf and want. NULL means not yet tagged. No backfill: existing rows stay untagged (Rule 2).
-- `branch` is no longer written; `levels` stays in place, unread.
ALTER TABLE field_notes.tips ALTER COLUMN branch DROP NOT NULL;
ALTER TABLE field_notes.tips ADD COLUMN IF NOT EXISTS leaf text;
ALTER TABLE field_notes.tips ADD COLUMN IF NOT EXISTS want text;
ALTER TABLE field_notes.tips ADD COLUMN IF NOT EXISTS tier text;
ALTER TABLE field_notes.tips ADD COLUMN IF NOT EXISTS purposes text[] NOT NULL DEFAULT '{}';
ALTER TABLE field_notes.tips ADD COLUMN IF NOT EXISTS fresh boolean NOT NULL DEFAULT false;
-- The source's own publish date, when the source gives one (found tips; seeds have none). Read by scoring's
-- `fresh` question. Expiry never reads it (it counts from created_at). No backfill (Rule 2): older rows stay NULL.
ALTER TABLE field_notes.tips ADD COLUMN IF NOT EXISTS published_at timestamptz;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_notes_tips_leaf_check' AND conrelid = 'field_notes.tips'::regclass) THEN
        ALTER TABLE field_notes.tips ADD CONSTRAINT field_notes_tips_leaf_check CHECK (leaf IS NULL OR leaf IN (
            'repo_free_alternative', 'repo_data', 'repo_mcp', 'repo_agent_runtime', 'repo_automation', 'repo_memory',
            'skill', 'coding_agent_feature', 'llm_app_feature', 'technique'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_notes_tips_want_check' AND conrelid = 'field_notes.tips'::regclass) THEN
        ALTER TABLE field_notes.tips ADD CONSTRAINT field_notes_tips_want_check CHECK (want IS NULL OR want IN (
            'faster', 'better', 'newly_possible', 'stay_current', 'cheaper'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_notes_tips_tier_check' AND conrelid = 'field_notes.tips'::regclass) THEN
        ALTER TABLE field_notes.tips ADD CONSTRAINT field_notes_tips_tier_check CHECK (tier IS NULL OR tier IN ('middle', 'higher'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_notes_tips_purposes_check' AND conrelid = 'field_notes.tips'::regclass) THEN
        ALTER TABLE field_notes.tips ADD CONSTRAINT field_notes_tips_purposes_check CHECK (purposes <@ ARRAY['professional', 'hobbyist', 'personal', 'builder']::text[]);
    END IF;
END $$;
-- Re-pay guards (2026-11-06). `attempts`: runs that paid the Writer for this tip (it got a slide) and ended without
-- a saved post; at 2 the tip is set aside (rejected) and never selected again. `reject_reason`: why the engine set a
-- tip aside ('writer-skipped: ...', 'attempts: ...'); NULL for a person's rejection and for older rows. Both are
-- written only for the tips of the run in hand. No backfill (Rule 2): older rows read 0 and NULL.
ALTER TABLE field_notes.tips ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE field_notes.tips ADD COLUMN IF NOT EXISTS reject_reason text;
-- The scoring question set that scored a found tip (`FIELD_NOTES_SCORE.version`, e.g. 'field-notes-score@3'),
-- written once by the insert that saves it with its score (2026-11-06). Selection takes only found tips scored by the
-- current version, so a tip scored before the about_ai gate (@2) stops being selectable. No backfill and no re-score
-- (Rule 2): older rows stay NULL and are left as they are. Seeds are never scored and stay NULL.
ALTER TABLE field_notes.tips ADD COLUMN IF NOT EXISTS score_version text;
-- The same source page is one tip.
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_notes_tips_source_url
    ON field_notes.tips (source_url) WHERE source_url IS NOT NULL;

-- ── Photo pool ──────────────────────────────────────────────────────────────
-- The bytes and hashes live in media_library.photos (licence 'own', reuse_ok false). This table
-- is only Field Notes' membership of them: who uploaded, whether the photo is live, resting or
-- retired, and the post sequence number of its last use (the rest rule counts posts).

CREATE TABLE IF NOT EXISTS field_notes.pool (
    photo_id            uuid PRIMARY KEY REFERENCES media_library.photos (id) ON DELETE CASCADE,
    uploaded_by         text NOT NULL,
    uploaded_at         timestamptz NOT NULL DEFAULT now(),
    status              text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'resting', 'retired')),
    last_used_post_seq  integer,
    reject_reason       text,
    exif                jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_field_notes_pool_status ON field_notes.pool (status, uploaded_at DESC);

-- Uploader's tags (no vision model): what the photo shows, and whether it makes a lively first slide.
-- The default exists only so this migration is safe on rows already there; the upload API requires kind.
ALTER TABLE field_notes.pool ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'working';
ALTER TABLE field_notes.pool ADD COLUMN IF NOT EXISTS opener boolean NOT NULL DEFAULT false;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_notes_pool_kind_check' AND conrelid = 'field_notes.pool'::regclass) THEN
        ALTER TABLE field_notes.pool ADD CONSTRAINT field_notes_pool_kind_check CHECK (kind IN ('working', 'scenery', 'people', 'event'));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_field_notes_pool_kind ON field_notes.pool (kind, opener) WHERE status <> 'retired';

-- Face check on the social worker (2026-11-06, Tommy: "Face tagging can run on the worker"). Vercel has no Chromium,
-- so finalize stores a new upload with faces_result 'pending' and faces_checked_at NULL; the helios-social worker
-- (lib/field-notes/photos/faces-worker.ts) claims pending rows, runs the detector and sets both.
--   faces_checked_at  NULL = not checked yet.
--   faces_result      'pending' (queued at upload) | 'faces' | 'none' | 'unavailable: <short reason>'.
--                     NULL = never queued: rows from before this column (no backfill, Rule 2) keep their tags as
--                     they are and are never claimed.
--   faces_attempts    claims so far (the worker gives up after a couple and marks 'unavailable').
--   faces_claimed_at  a worker's lease on the row; a crashed worker's lease runs out and the row is claimed again.
ALTER TABLE field_notes.pool ADD COLUMN IF NOT EXISTS faces_checked_at timestamptz;
ALTER TABLE field_notes.pool ADD COLUMN IF NOT EXISTS faces_result text;
ALTER TABLE field_notes.pool ADD COLUMN IF NOT EXISTS faces_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE field_notes.pool ADD COLUMN IF NOT EXISTS faces_claimed_at timestamptz;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_notes_pool_faces_result_check' AND conrelid = 'field_notes.pool'::regclass) THEN
        ALTER TABLE field_notes.pool ADD CONSTRAINT field_notes_pool_faces_result_check
            CHECK (faces_result IS NULL OR faces_result IN ('pending', 'faces', 'none') OR faces_result LIKE 'unavailable%');
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_field_notes_pool_faces_pending ON field_notes.pool (uploaded_at) WHERE faces_result = 'pending' AND faces_checked_at IS NULL;

-- ── Posts ───────────────────────────────────────────────────────────────────
-- One carousel per row. seq counts posts in creation order (the rest rule reads it).
-- slides is the ordered array of slide records (lib/field-notes/types.ts); a rebuild
-- re-renders the same row (render_version + 1), so it keeps its spine item and slot.

CREATE TABLE IF NOT EXISTS field_notes.posts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seq             integer GENERATED ALWAYS AS IDENTITY,
    run_id          uuid REFERENCES field_notes.runs (id) ON DELETE SET NULL,
    tip_id          uuid REFERENCES field_notes.tips (id) ON DELETE SET NULL,
    slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
    ny_date         date NOT NULL,
    status          text NOT NULL DEFAULT 'review' CHECK (status IN ('preview', 'review', 'published', 'rejected')),
    slides          jsonb NOT NULL,
    photo_ids       uuid[] NOT NULL DEFAULT '{}',
    caption         text NOT NULL,
    render_version  integer NOT NULL DEFAULT 1,
    slide_objects   jsonb,
    fit_problems    jsonb NOT NULL DEFAULT '[]'::jsonb,
    render_problems jsonb NOT NULL DEFAULT '[]'::jsonb,
    soft_notes      jsonb NOT NULL DEFAULT '[]'::jsonb,
    approved_by     text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    published_at    timestamptz
);
-- The Writer's soft guidance for the review screen (never a rejection). Kept apart from fit_problems.
ALTER TABLE field_notes.posts ADD COLUMN IF NOT EXISTS soft_notes jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Every tip on the post, in slide order (one per tip slide); tip_id stays the first. Older rows are backfilled once.
ALTER TABLE field_notes.posts ADD COLUMN IF NOT EXISTS tip_ids uuid[] NOT NULL DEFAULT '{}';
UPDATE field_notes.posts SET tip_ids = ARRAY[tip_id] WHERE tip_id IS NOT NULL AND cardinality(tip_ids) = 0;
CREATE INDEX IF NOT EXISTS idx_field_notes_posts_ny_date ON field_notes.posts (ny_date DESC);
-- A tip makes one post that is not rejected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_notes_posts_one_per_tip
    ON field_notes.posts (tip_id) WHERE tip_id IS NOT NULL AND status <> 'rejected';
