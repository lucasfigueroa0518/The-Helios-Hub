-- db/stories_multi_slot.sql — let a Stories series post more than once a day (idempotent).
-- Week board redesign, ruling R25. Drops ONLY the one-a-day unique index
-- stories.uq_stories_sets_live_day (series, ny_date); the per-slot index
-- uq_stories_sets_live_slot (series, ny_date, coalesce(slot_minute, -1)) stays and
-- keeps one live set per slot.
--
-- Run it only after db/stories_schema.sql is applied AND the social worker and the
-- hub run the free-time-slot code: pre-redesign code inserts with
-- ON CONFLICT (series, ny_date), which fails (42P10) once this index is gone.
-- Run it before switching on two-a-day Stories (slot_source = 'template').
--
-- Apply (dry run by default):  node scripts/apply_stories_multi_slot.js --apply
\set ON_ERROR_STOP on

DO $$
DECLARE
    day_def text;
BEGIN
    IF to_regclass('stories.sets') IS NULL THEN
        RAISE EXCEPTION 'stories.sets does not exist: apply db/stories_schema.sql first';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'stories' AND table_name = 'sets' AND column_name = 'slot_minute') THEN
        RAISE EXCEPTION 'stories.sets.slot_minute does not exist: apply db/stories_schema.sql first';
    END IF;
    SELECT indexdef INTO day_def FROM pg_indexes
     WHERE schemaname = 'stories' AND indexname = 'uq_stories_sets_live_day';
    -- A database that got an earlier build of stories_schema.sql holds the slot key under the day name.
    IF day_def LIKE '%slot_minute%' THEN
        IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'stories' AND indexname = 'uq_stories_sets_live_slot') THEN
            DROP INDEX stories.uq_stories_sets_live_day;
        ELSE
            ALTER INDEX stories.uq_stories_sets_live_day RENAME TO uq_stories_sets_live_slot;
        END IF;
    ELSIF day_def IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'stories' AND indexname = 'uq_stories_sets_live_slot') THEN
            RAISE EXCEPTION 'uq_stories_sets_live_slot does not exist: apply db/stories_schema.sql first';
        END IF;
        DROP INDEX stories.uq_stories_sets_live_day;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'stories' AND indexname = 'uq_stories_sets_live_slot') THEN
        RAISE EXCEPTION 'uq_stories_sets_live_slot does not exist: apply db/stories_schema.sql first';
    END IF;
    -- The mark db/stories_schema.sql reads so a re-apply never brings the one-a-day index back.
    COMMENT ON INDEX stories.uq_stories_sets_live_slot IS
        'stories_multi_slot: one live set per series, day and slot; the one-a-day index was dropped';
END $$;
