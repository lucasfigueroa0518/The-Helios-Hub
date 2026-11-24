-- db/stories_real_or_ai.sql — Real or AI? Stories (idempotent).
-- planning/Real or AI/CONTRACT.md §2. Adds the `real_or_ai` series (Free vs.
-- Paid and Guess the Number stay in every CHECK so their history still loads),
-- the two still frame roles (roa_question, roa_reveal), the candidate archive
-- and the swipe lab's guesses. The pool's `model` origin is already there
-- (db/stories_ai_trivia.sql).
--
-- Run after db/stories_schema.sql, db/social_hub_schema.sql and
-- db/stories_ai_trivia.sql. Tests run it on PGlite (lib/stories/local-db.ts).
-- Apply (Lucas's go-ahead first: DATABASE_URL is the shared production DB):
--   npm run db:stories   (applies db/stories_schema.sql, db/stories_ai_trivia.sql, then this file)
\set ON_ERROR_STOP on

-- ── Series CHECKs ───────────────────────────────────────────────────────────
ALTER TABLE stories.sets DROP CONSTRAINT IF EXISTS sets_series_check;
ALTER TABLE stories.sets ADD CONSTRAINT sets_series_check
    CHECK (series IN ('morning_download', 'guess_the_number', 'free_vs_paid', 'ai_trivia', 'real_or_ai'));
ALTER TABLE stories.pool DROP CONSTRAINT IF EXISTS pool_series_check;
ALTER TABLE stories.pool ADD CONSTRAINT pool_series_check
    CHECK (series IN ('morning_download', 'guess_the_number', 'free_vs_paid', 'ai_trivia', 'real_or_ai'));
ALTER TABLE stories.history DROP CONSTRAINT IF EXISTS history_series_check;
ALTER TABLE stories.history ADD CONSTRAINT history_series_check
    CHECK (series IN ('morning_download', 'guess_the_number', 'free_vs_paid', 'ai_trivia', 'real_or_ai'));

-- ── Frame roles ─────────────────────────────────────────────────────────────
-- db/stories_schema.sql's inline role CHECK carries Postgres' default name
-- (frames_role_check); any role CHECK on stories.frames is dropped and replaced.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT c.conname
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'stories' AND c.contype = 'c' AND t.relname = 'frames'
           AND pg_get_constraintdef(c.oid) LIKE '%role%'
           AND pg_get_constraintdef(c.oid) LIKE '%opener%'
    LOOP
        EXECUTE format('ALTER TABLE stories.frames DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;
ALTER TABLE stories.frames ADD CONSTRAINT frames_role_check
    CHECK (role IN ('opener', 'story', 'closer', 'intro', 'question', 'answer', 'paid', 'free', 'roa_question', 'roa_reveal'));

-- ── Cost vendors ────────────────────────────────────────────────────────────
-- Real or AI?'s AI images (gpt-image-2, cost component roa-image) bill as
-- `openai`. db/stories_schema.sql's inline vendor CHECK carries Postgres'
-- default name; any vendor CHECK on stories.cost_events is dropped and replaced.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT c.conname
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'stories' AND c.contype = 'c' AND t.relname = 'cost_events'
           AND pg_get_constraintdef(c.oid) LIKE '%vendor%'
    LOOP
        EXECUTE format('ALTER TABLE stories.cost_events DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;
ALTER TABLE stories.cost_events ADD CONSTRAINT cost_events_vendor_check
    CHECK (vendor IN ('anthropic', 'jev', 'web_search', 'openai', 'fal'));

-- ── Candidate archive ───────────────────────────────────────────────────────
-- Candidates the pool cap dropped, the screen failed, or the builder's
-- provenance re-check refused; kept for calibration.
CREATE TABLE IF NOT EXISTS stories.roa_archive (
    key          text,
    payload      jsonb,
    reason       text CHECK (reason IN ('cap', 'screen', 'provenance')),
    archived_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roa_archive_key_idx ON stories.roa_archive (key);

-- ── Swipe lab ───────────────────────────────────────────────────────────────
-- One row per blind guess on /stories/roa-lab (RA-4: it grades the engine and
-- never writes to the pool).
CREATE TABLE IF NOT EXISTS stories.roa_lab (
    id          bigserial PRIMARY KEY,
    batch_id    text,
    image_key   text,
    truth       text CHECK (truth IN ('real', 'ai')),
    guess       text CHECK (guess IN ('real', 'ai')),
    ms          int,
    created_at  timestamptz DEFAULT now()
);

-- ── The hub's Stories slots (db/social_hub_schema.sql carries the same) ─────
-- Skipped where social_hub is not there yet; social_hub_schema.sql adds them then.
-- RA-10: Real or AI? takes Free vs. Paid's weekly slots (the template only;
-- dated overrides stay as they were, and a retired series' slots are not read).
DO $$
BEGIN
    IF to_regclass('social_hub.schedule') IS NOT NULL THEN
        ALTER TABLE social_hub.schedule DROP CONSTRAINT IF EXISTS schedule_slot_check;
        ALTER TABLE social_hub.schedule ADD CONSTRAINT schedule_slot_check CHECK (
            (vertical = 'carousels' AND slot IN ('morning', 'afternoon'))
            OR (vertical = 'explainers' AND slot IN ('afternoon', 'late'))
            OR (vertical = 'reels' AND slot IN ('morning', 'midday', 'evening'))
            OR (vertical = 'stories' AND slot IN ('morning_download', 'guess_the_number', 'free_vs_paid', 'ai_trivia', 'real_or_ai'))
            OR (vertical = 'ai_trivia' AND slot = 'ai_trivia')
            OR (vertical = 'real_or_ai' AND slot = 'real_or_ai')
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
            (vertical = 'stories' AND series IS NOT NULL AND series IN ('morning_download', 'guess_the_number', 'free_vs_paid', 'ai_trivia', 'real_or_ai'))
            OR (vertical IN ('ai_trivia', 'real_or_ai') AND series = vertical)
            OR (vertical NOT IN ('stories', 'ai_trivia', 'real_or_ai') AND series IS NULL)
        );
        -- Since the Stories split, Real or AI? is its own type: the slot moves to vertical real_or_ai.
        UPDATE social_hub.slot_template t SET vertical = 'real_or_ai', series = 'real_or_ai'
         WHERE t.vertical = 'stories' AND t.series = 'free_vs_paid'
           AND NOT EXISTS (SELECT 1 FROM social_hub.slot_template o
                            WHERE o.weekday = t.weekday AND o.vertical IN ('stories', 'real_or_ai')
                              AND o.start_minute = t.start_minute AND o.series = 'real_or_ai');
    END IF;
    IF to_regclass('social_hub.slot_override') IS NOT NULL THEN
        ALTER TABLE social_hub.slot_override DROP CONSTRAINT IF EXISTS slot_override_series_check;
        ALTER TABLE social_hub.slot_override ADD CONSTRAINT slot_override_series_check CHECK (
            (vertical = 'stories' AND series IS NOT NULL AND series IN ('morning_download', 'guess_the_number', 'free_vs_paid', 'ai_trivia', 'real_or_ai'))
            OR (vertical IN ('ai_trivia', 'real_or_ai') AND series = vertical)
            OR (vertical NOT IN ('stories', 'ai_trivia', 'real_or_ai') AND series IS NULL)
        );
    END IF;
END $$;
