-- db/stories_ai_trivia.sql — AI Trivia Stories (idempotent).
-- planning/AI Trivia/CONTRACT.md §2. Adds the `ai_trivia` series (Guess the
-- Number stays in every CHECK so its history still loads), the `model` pool
-- origin, the content map's cell table (400 cells, t01a01 … t20a20) and its
-- archive, and the video columns on stories.frames.
--
-- Run after db/stories_schema.sql and db/social_hub_schema.sql. Tests run it on
-- PGlite (lib/stories/local-db.ts).
-- Apply (Lucas's go-ahead first: DATABASE_URL is the shared production DB):
--   npm run db:stories   (applies db/stories_schema.sql, then this file)
\set ON_ERROR_STOP on

-- ── Series and origin CHECKs ────────────────────────────────────────────────
-- The inline CHECKs of db/stories_schema.sql carry Postgres' default names; any
-- series CHECK still listing the three old series is dropped and replaced.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT t.relname, c.conname
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'stories' AND c.contype = 'c'
           AND t.relname IN ('sets', 'pool', 'history')
           AND pg_get_constraintdef(c.oid) LIKE '%series%'
           AND pg_get_constraintdef(c.oid) LIKE '%guess_the_number%'
    LOOP
        EXECUTE format('ALTER TABLE stories.%I DROP CONSTRAINT %I', r.relname, r.conname);
    END LOOP;
    FOR r IN
        SELECT c.conname
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'stories' AND c.contype = 'c' AND t.relname = 'pool'
           AND pg_get_constraintdef(c.oid) LIKE '%origin%'
           AND pg_get_constraintdef(c.oid) LIKE '%catalog%'
    LOOP
        EXECUTE format('ALTER TABLE stories.pool DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE stories.sets DROP CONSTRAINT IF EXISTS sets_series_check;
ALTER TABLE stories.sets ADD CONSTRAINT sets_series_check
    CHECK (series IN ('morning_download', 'guess_the_number', 'free_vs_paid', 'ai_trivia'));
ALTER TABLE stories.pool DROP CONSTRAINT IF EXISTS pool_series_check;
ALTER TABLE stories.pool ADD CONSTRAINT pool_series_check
    CHECK (series IN ('morning_download', 'guess_the_number', 'free_vs_paid', 'ai_trivia'));
ALTER TABLE stories.history DROP CONSTRAINT IF EXISTS history_series_check;
ALTER TABLE stories.history ADD CONSTRAINT history_series_check
    CHECK (series IN ('morning_download', 'guess_the_number', 'free_vs_paid', 'ai_trivia'));
-- AI Trivia's pool rows are the writer's own questions: origin `model`.
ALTER TABLE stories.pool DROP CONSTRAINT IF EXISTS pool_origin_check;
ALTER TABLE stories.pool ADD CONSTRAINT pool_origin_check
    CHECK (origin IN ('reels', 'carousel', 'catalog', 'github', 'generated', 'model'));

-- ── Content map cells ───────────────────────────────────────────────────────
-- One row per theme × angle (CONTENT-MAP-DRAFT.md, AT-24). Lifecycle: writer
-- output validated → reserved; its pool row dropped (cap) or archived
-- (fact-check) → open; its set published → closed.
CREATE TABLE IF NOT EXISTS stories.trivia_cells (
    cell_id     text PRIMARY KEY,
    theme       smallint,
    angle       smallint,
    state       text CHECK (state IN ('open', 'reserved', 'closed')) DEFAULT 'open',
    pool_key    text,
    updated_at  timestamptz DEFAULT now()
);

INSERT INTO stories.trivia_cells (cell_id, theme, angle)
SELECT 't' || lpad(t::text, 2, '0') || 'a' || lpad(a::text, 2, '0'), t, a
  FROM generate_series(1, 20) AS t, generate_series(1, 20) AS a
ON CONFLICT (cell_id) DO NOTHING;

-- Questions the fact-check failed (or the cap dropped), kept for calibration.
CREATE TABLE IF NOT EXISTS stories.trivia_archive (
    key          text,
    cell_id      text,
    payload      jsonb,
    reason       text,
    archived_at  timestamptz DEFAULT now()
);

-- ── Video frames ────────────────────────────────────────────────────────────
-- An AI Trivia frame is a 5-second MP4 (storage_path) with a poster JPEG
-- (poster_path, what the review and the hub look at; jpeg_bytes is its size).
ALTER TABLE stories.frames ADD COLUMN IF NOT EXISTS media text NOT NULL DEFAULT 'image';
ALTER TABLE stories.frames DROP CONSTRAINT IF EXISTS frames_media_check;
ALTER TABLE stories.frames ADD CONSTRAINT frames_media_check CHECK (media IN ('image', 'video'));
ALTER TABLE stories.frames ADD COLUMN IF NOT EXISTS poster_path text;
ALTER TABLE stories.frames ADD COLUMN IF NOT EXISTS media_bytes int;

-- ── The hub's Stories slots (db/social_hub_schema.sql carries the same) ─────
-- Skipped where social_hub is not there yet; social_hub_schema.sql adds them then.
DO $$
BEGIN
    IF to_regclass('social_hub.schedule') IS NOT NULL THEN
        ALTER TABLE social_hub.schedule DROP CONSTRAINT IF EXISTS schedule_slot_check;
        ALTER TABLE social_hub.schedule ADD CONSTRAINT schedule_slot_check CHECK (
            (vertical = 'carousels' AND slot IN ('morning', 'afternoon'))
            OR (vertical = 'explainers' AND slot IN ('afternoon', 'late'))
            OR (vertical = 'reels' AND slot IN ('morning', 'midday', 'evening'))
            OR (vertical = 'stories' AND slot IN ('morning_download', 'guess_the_number', 'free_vs_paid', 'ai_trivia'))
            OR (vertical = 'last_few_days' AND slot IN ('morning'))
            OR (vertical = 'ai_events' AND slot IN ('evening', 'night'))
            OR (vertical = 'reel_ai_drama' AND slot IN ('evening'))
            OR (vertical = 'field_notes' AND slot = 'afternoon')
            OR slot ~ '^t[0-9]{4}(:[a-z_]+)?$'
        );
    END IF;
    IF to_regclass('social_hub.slot_template') IS NOT NULL THEN
        ALTER TABLE social_hub.slot_template DROP CONSTRAINT IF EXISTS slot_template_series_check;
        ALTER TABLE social_hub.slot_template ADD CONSTRAINT slot_template_series_check CHECK (
            (vertical = 'stories' AND series IS NOT NULL AND series IN ('morning_download', 'guess_the_number', 'free_vs_paid', 'ai_trivia'))
            OR (vertical <> 'stories' AND series IS NULL)
        );
    END IF;
    IF to_regclass('social_hub.slot_override') IS NOT NULL THEN
        ALTER TABLE social_hub.slot_override DROP CONSTRAINT IF EXISTS slot_override_series_check;
        ALTER TABLE social_hub.slot_override ADD CONSTRAINT slot_override_series_check CHECK (
            (vertical = 'stories' AND series IS NOT NULL AND series IN ('morning_download', 'guess_the_number', 'free_vs_paid', 'ai_trivia'))
            OR (vertical <> 'stories' AND series IS NULL)
        );
    END IF;
END $$;
