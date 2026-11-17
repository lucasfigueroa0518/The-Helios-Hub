-- db/stories_split.sql — Stories Split (idempotent, one transaction).
-- planning/Stories Split/CONTRACT.md §4. "IG Stories" becomes Morning Download
-- (internal id `stories`, unchanged); "Are you smarter than AI?" (`ai_trivia`) and
-- "Real or AI?" (`real_or_ai`) become hub types of their own, each with exactly one
-- series, its own name (SS-1). This file:
--   1. widens the social_hub vertical CHECKs (content_items, idea_adjustments,
--      schedule, publish_attempts, slot_template / slot_override) and
--      revisions.requests for the two new types;
--   2. moves any row filed under 'stories' for a trivia or Real or AI? set onto its
--      own type (none exist in production on 2026-11-16; the move is for local DBs);
--   3. starts AI Trivia's and Real or AI?'s daily caps at 1 (once a day, SS-24); Morning Download's is left as stored.
-- Hub ids keep the `stories:<setId>` namespace for all three (D46), so nothing else moves.
--
-- Run after db/social_hub_schema.sql, db/stories_ai_trivia.sql and
-- db/stories_real_or_ai.sql. Tests run it on PGlite (lib/stories/local-db.ts,
-- tests/fixtures/social-hub/pglite.ts). Re-applies cleanly: each CHECK is dropped,
-- re-added NOT VALID, rows are moved, then the CHECK is validated.
-- Apply (Lucas's go-ahead first: DATABASE_URL is the shared production DB):
--   psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/stories_split.sql
\set ON_ERROR_STOP on

BEGIN;

-- ── 1. CHECKs, re-added NOT VALID (validated in step 3) ─────────────────────
ALTER TABLE social_hub.content_items DROP CONSTRAINT IF EXISTS content_items_vertical_check;
ALTER TABLE social_hub.content_items ADD CONSTRAINT content_items_vertical_check
    CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days', 'ai_events', 'field_notes', 'reel_ai_drama', 'ai_trivia', 'real_or_ai')) NOT VALID;

ALTER TABLE social_hub.idea_adjustments DROP CONSTRAINT IF EXISTS idea_adjustments_vertical_check;
ALTER TABLE social_hub.idea_adjustments ADD CONSTRAINT idea_adjustments_vertical_check
    CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days', 'ai_events', 'field_notes', 'reel_ai_drama', 'ai_trivia', 'real_or_ai')) NOT VALID;

-- A Stories-format type's slot is its series (or a t-slot `t0510:<series>`); Morning
-- Download keeps the retired Guess the Number / Free vs. Paid series so history loads.
ALTER TABLE social_hub.schedule DROP CONSTRAINT IF EXISTS schedule_slot_check;
ALTER TABLE social_hub.schedule ADD CONSTRAINT schedule_slot_check CHECK (
    (vertical = 'carousels' AND slot IN ('morning', 'afternoon'))
    OR (vertical = 'explainers' AND slot IN ('afternoon', 'late'))
    OR (vertical = 'reels' AND slot IN ('morning', 'midday', 'evening'))
    OR (vertical = 'stories' AND slot IN ('morning_download', 'guess_the_number', 'free_vs_paid'))
    OR (vertical = 'ai_trivia' AND slot = 'ai_trivia')
    OR (vertical = 'real_or_ai' AND slot = 'real_or_ai')
    OR (vertical = 'last_few_days' AND slot IN ('morning'))
    OR (vertical = 'ai_events' AND slot IN ('evening', 'night'))
    OR (vertical = 'reel_ai_drama' AND slot IN ('evening'))
    OR (vertical = 'field_notes' AND slot = 'afternoon')
    OR slot ~ '^t[0-9]{4}(:[a-z_]+)?$'
) NOT VALID;

-- Stories-format types publish on approve or auto only (no force, no mix test).
ALTER TABLE social_hub.publish_attempts DROP CONSTRAINT IF EXISTS publish_attempts_trigger_check;
ALTER TABLE social_hub.publish_attempts ADD CONSTRAINT publish_attempts_trigger_check CHECK (
    (vertical IN ('carousels', 'explainers', 'last_few_days', 'ai_events', 'reel_ai_drama', 'field_notes') AND trigger IN ('approve', 'auto', 'force'))
    OR (vertical = 'reels' AND trigger IN ('approve', 'auto', 'mix_test', 'force'))
    OR (vertical IN ('stories', 'ai_trivia', 'real_or_ai') AND trigger IN ('approve', 'auto'))
) NOT VALID;

-- A Stories-format type's slot carries its one series (SS-1); every other type has none.
ALTER TABLE social_hub.slot_template DROP CONSTRAINT IF EXISTS slot_template_series_check;
ALTER TABLE social_hub.slot_template ADD CONSTRAINT slot_template_series_check CHECK (
    (vertical = 'stories' AND series IS NOT NULL AND series IN ('morning_download', 'guess_the_number', 'free_vs_paid'))
    OR (vertical = 'ai_trivia' AND series IS NOT NULL AND series = 'ai_trivia')
    OR (vertical = 'real_or_ai' AND series IS NOT NULL AND series = 'real_or_ai')
    OR (vertical NOT IN ('stories', 'ai_trivia', 'real_or_ai') AND series IS NULL)
) NOT VALID;
ALTER TABLE social_hub.slot_override DROP CONSTRAINT IF EXISTS slot_override_series_check;
ALTER TABLE social_hub.slot_override ADD CONSTRAINT slot_override_series_check CHECK (
    (vertical = 'stories' AND series IS NOT NULL AND series IN ('morning_download', 'guess_the_number', 'free_vs_paid'))
    OR (vertical = 'ai_trivia' AND series IS NOT NULL AND series = 'ai_trivia')
    OR (vertical = 'real_or_ai' AND series IS NOT NULL AND series = 'real_or_ai')
    OR (vertical NOT IN ('stories', 'ai_trivia', 'real_or_ai') AND series IS NULL)
) NOT VALID;

-- Revisions name the item's type; skipped where db/revisions_schema.sql is not applied.
DO $$
BEGIN
    IF to_regclass('revisions.requests') IS NOT NULL THEN
        ALTER TABLE revisions.requests DROP CONSTRAINT IF EXISTS requests_vertical_check;
        ALTER TABLE revisions.requests ADD CONSTRAINT requests_vertical_check
            CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days', 'ai_events', 'field_notes', 'reel_ai_drama', 'ai_trivia', 'real_or_ai')) NOT VALID;
    END IF;
END $$;

-- ── 2. Rows filed under 'stories' for a trivia or Real or AI? set move to its type ──
-- A content item is that set's when its idea_ref is '<series>:<ny_date>' (lib/stories/spine.ts)
-- or its native_ref is a set of that series. A row whose target already exists is left
-- alone and fails the VALIDATE below, so a clash stops the file instead of merging rows.
DO $$
DECLARE
    s text;
BEGIN
    FOREACH s IN ARRAY ARRAY['ai_trivia', 'real_or_ai'] LOOP
        IF to_regclass('stories.sets') IS NOT NULL THEN
            EXECUTE format($q$
                UPDATE social_hub.content_items ci SET vertical = %1$L
                 WHERE ci.vertical = 'stories'
                   AND (ci.idea_ref LIKE %2$L OR ci.native_ref IN (SELECT id::text FROM stories.sets WHERE series = %1$L))
                   AND NOT EXISTS (SELECT 1 FROM social_hub.content_items o WHERE o.vertical = %1$L AND o.native_ref = ci.native_ref)
            $q$, s, s || ':%');
        ELSE
            UPDATE social_hub.content_items ci SET vertical = s
             WHERE ci.vertical = 'stories' AND ci.idea_ref LIKE s || ':%'
               AND NOT EXISTS (SELECT 1 FROM social_hub.content_items o WHERE o.vertical = s AND o.native_ref = ci.native_ref);
        END IF;

        -- The item's schedule rows, publish attempts and insights follow it.
        UPDATE social_hub.schedule sc SET vertical = s
          FROM social_hub.content_items ci
         WHERE sc.content_item_id = ci.id AND ci.vertical = s AND sc.vertical = 'stories';
        UPDATE social_hub.publish_attempts pa SET vertical = s
          FROM social_hub.content_items ci
         WHERE pa.content_item_id = ci.id AND ci.vertical = s AND pa.vertical = 'stories';
        UPDATE social_hub.media_insights mi SET vertical = s
          FROM social_hub.publish_attempts pa
         WHERE mi.publish_attempt_id = pa.id AND pa.vertical = s AND mi.vertical = 'stories';

        -- Pool ids stay stories:pool:<series>:<key> (D46); only the type moves.
        UPDATE social_hub.idea_adjustments SET vertical = s
         WHERE vertical = 'stories' AND idea_id LIKE 'stories:pool:' || replace(s, '_', '\_') || ':%';

        UPDATE social_hub.slot_template t SET vertical = s
         WHERE t.vertical = 'stories' AND t.series = s
           AND NOT EXISTS (SELECT 1 FROM social_hub.slot_template o
                            WHERE o.weekday = t.weekday AND o.vertical = s AND o.start_minute = t.start_minute AND o.series = s);
        UPDATE social_hub.slot_override t SET vertical = s
         WHERE t.vertical = 'stories' AND t.series = s
           AND NOT EXISTS (SELECT 1 FROM social_hub.slot_override o
                            WHERE o.ny_date = t.ny_date AND o.vertical = s AND o.start_minute = t.start_minute AND o.series = s);

        IF to_regclass('revisions.requests') IS NOT NULL THEN
            EXECUTE format($q$
                UPDATE revisions.requests r SET vertical = %1$L
                  FROM social_hub.content_items ci
                 WHERE r.vertical = 'stories' AND r.item_id = ci.id AND ci.vertical = %1$L
            $q$, s);
        END IF;
    END LOOP;
END $$;

-- ── 3. Validate every CHECK against the moved rows ──────────────────────────
ALTER TABLE social_hub.content_items VALIDATE CONSTRAINT content_items_vertical_check;
ALTER TABLE social_hub.idea_adjustments VALIDATE CONSTRAINT idea_adjustments_vertical_check;
ALTER TABLE social_hub.schedule VALIDATE CONSTRAINT schedule_slot_check;
ALTER TABLE social_hub.publish_attempts VALIDATE CONSTRAINT publish_attempts_trigger_check;
ALTER TABLE social_hub.slot_template VALIDATE CONSTRAINT slot_template_series_check;
ALTER TABLE social_hub.slot_override VALIDATE CONSTRAINT slot_override_series_check;
DO $$
BEGIN
    IF to_regclass('revisions.requests') IS NOT NULL THEN
        ALTER TABLE revisions.requests VALIDATE CONSTRAINT requests_vertical_check;
    END IF;
END $$;

-- ── 4. Daily caps (calendar week board): AI Trivia and Real or AI? post at most once a day (SS-24) and
--    start at 1; Morning Download keeps its stored cap (two a day, R25) ──
UPDATE social_hub.settings
   SET value = value
       || jsonb_build_object('ai_trivia', coalesce(value -> 'ai_trivia', '1'::jsonb))
       || jsonb_build_object('real_or_ai', coalesce(value -> 'real_or_ai', '1'::jsonb))
 WHERE key = 'daily_caps' AND jsonb_typeof(value) = 'object';

COMMIT;
