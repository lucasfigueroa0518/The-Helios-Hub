-- Settings standard: explicit stored keys for every content type's state (planning/settings-standard/CONTRACT.md §3).
--
-- What it writes (decisions D6, D7, D14, D16 in planning/settings-standard/PLAN.md):
--   1. require_approval = true for every type (D16: every post needs a person; no Auto-publish). Stories: the
--      engine-wide row and each type's `types[<type>].requireApproval`.
--   2. An explicit Generate and publishing_live row wherever one is missing (D6: a missing row means off), each
--      keeping today's behavior: Text on Screen's auto_run is written TRUE only when absent (absent read as on until
--      now); every other missing key is written false (absent already read as off). Stored values are never changed,
--      so Carousels stays as it is today (auto_run false, publishing_live false = Paused).
--   3. pool_refill_cap_usd where absent, at REFILL_CAP_DEFAULT_USD (lib/content-type/state.ts, D14): $0.25 for
--      Text on Screen, Carousels, Last Few Days, AI Events and the Stories types; $0.50 for Explainers, AI Drama and
--      Field Notes. Stories: `types[<type>].refill_cap_usd`.
--
-- Idempotent: inserts are ON CONFLICT DO NOTHING, require_approval is set only where it isn't already true, and the
-- JSON edits add only missing keys. A schema that isn't on this database (e.g. explainers / reel_ai_drama on their
-- own EXPLAINERS_DATABASE_URL) is skipped with a NOTICE; run the file there too in that case.
--
-- Tables and keys, from the code: social.settings (Carousels; auto_run, publishing_live), reels.settings (Text on
-- Screen; auto_run), explainers.settings (auto_render), reel_ai_drama.settings (auto), lfd.settings,
-- ai_events.settings, field_notes.settings (auto_run), stories.settings (`series` row: series[s].auto; `types`
-- row: types[v].publishingLive; engine-wide fallbacks publishing_live, daily_cap_usd; lib/stories/settings.ts).
--
-- ── Verify read-only (never a session-level SET through DATABASE_URL: it is the transaction pooler; CLAUDE.md) ──
-- Before and after applying, one read-only transaction:
--
--   psql "$DATABASE_URL" -X -c "BEGIN READ ONLY;
--     SELECT 'carousels' AS type, key, value FROM social.settings      WHERE key IN ('auto_run','publishing_live','require_approval','pool_refill_cap_usd')
--     UNION ALL SELECT 'reels',          key, value FROM reels.settings       WHERE key IN ('auto_run','publishing_live','require_approval','pool_refill_cap_usd')
--     UNION ALL SELECT 'explainers',     key, value FROM explainers.settings  WHERE key IN ('auto_render','publishing_live','require_approval','pool_refill_cap_usd')
--     UNION ALL SELECT 'reel_ai_drama',  key, value FROM reel_ai_drama.settings WHERE key IN ('auto','publishing_live','require_approval','pool_refill_cap_usd')
--     UNION ALL SELECT 'last_few_days',  key, value FROM lfd.settings         WHERE key IN ('auto_run','publishing_live','require_approval','pool_refill_cap_usd')
--     UNION ALL SELECT 'ai_events',      key, value FROM ai_events.settings   WHERE key IN ('auto_run','publishing_live','require_approval','pool_refill_cap_usd')
--     UNION ALL SELECT 'field_notes',    key, value FROM field_notes.settings WHERE key IN ('auto_run','publishing_live','require_approval','pool_refill_cap_usd')
--     UNION ALL SELECT 'stories',        key, value FROM stories.settings     WHERE key IN ('series','types','require_approval','publishing_live')
--     ORDER BY 1, 2; ROLLBACK;"
--
-- Expected after: every type has its Generate key, publishing_live, require_approval = true and pool_refill_cap_usd;
-- Carousels auto_run false and publishing_live false; Text on Screen auto_run unchanged if it was stored, else true;
-- stories `types` has requireApproval true and refill_cap_usd for stories, ai_trivia and real_or_ai.
-- Before applying, the same query shows which types had require_approval = false (the one behavior change: their
-- posts now wait for a person) and whether any type has Generate off with publishing_live on (read as Paused,
-- logged state_mismatch; none expected, Carousels' Live was switched off on 2026-11-18).
-- If explainers / reel_ai_drama live on EXPLAINERS_DATABASE_URL, run their two lines there instead.

BEGIN;

-- 1–3 for the key/value settings tables.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- table,                    Generate key,  Generate if absent, refill cap
      ('social.settings',          'auto_run',    'false', 0.25),  -- Carousels: stays Paused
      ('reels.settings',           'auto_run',    'true',  0.25),  -- Text on Screen: absent meant on (D6)
      ('explainers.settings',      'auto_render', 'false', 0.50),
      ('reel_ai_drama.settings',   'auto',        'false', 0.50),
      ('lfd.settings',             'auto_run',    'false', 0.25),
      ('ai_events.settings',       'auto_run',    'false', 0.25),
      ('field_notes.settings',     'auto_run',    'false', 0.50)
    ) AS t(tbl, gen_key, gen_if_absent, refill_cap)
  LOOP
    IF to_regclass(r.tbl) IS NULL THEN
      RAISE NOTICE 'settings standard: % is not on this database, skipped', r.tbl;
      CONTINUE;
    END IF;
    -- Explicit Generate and Live rows (D6), today's values: only where missing.
    EXECUTE format('INSERT INTO %s (key, value, updated_at) VALUES (%L, %L::jsonb, now()) ON CONFLICT (key) DO NOTHING', r.tbl, r.gen_key, r.gen_if_absent);
    EXECUTE format('INSERT INTO %s (key, value, updated_at) VALUES (''publishing_live'', ''false''::jsonb, now()) ON CONFLICT (key) DO NOTHING', r.tbl);
    -- Approval is always required (D16).
    EXECUTE format(
      'INSERT INTO %1$s AS s (key, value, updated_at) VALUES (''require_approval'', ''true''::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = ''true''::jsonb, updated_at = now() WHERE s.value IS DISTINCT FROM ''true''::jsonb',
      r.tbl);
    -- The refill cap (D14), where absent.
    EXECUTE format('INSERT INTO %s (key, value, updated_at) VALUES (''pool_refill_cap_usd'', to_jsonb(%s::numeric), now()) ON CONFLICT (key) DO NOTHING', r.tbl, r.refill_cap);
  END LOOP;
END $$;

-- Stories: engine-wide approval row, each series' auto, and each type's own row in `types`.
DO $$
DECLARE
  v text;
  ser text;
  fallback_live jsonb;
  fallback_cap jsonb;
  types_now jsonb;
BEGIN
  IF to_regclass('stories.settings') IS NULL THEN
    RAISE NOTICE 'settings standard: stories.settings is not on this database, skipped';
    RETURN;
  END IF;

  INSERT INTO stories.settings AS s (key, value, updated_by, updated_at)
  VALUES ('require_approval', 'true'::jsonb, 'settings-standard migration', now())
  ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb, updated_by = excluded.updated_by, updated_at = now()
   WHERE s.value IS DISTINCT FROM 'true'::jsonb;

  -- Each live series' auto (its type's Generate), false where missing: the code default is already off.
  INSERT INTO stories.settings (key, value, updated_by, updated_at)
  VALUES ('series', '{}'::jsonb, 'settings-standard migration', now())
  ON CONFLICT (key) DO NOTHING;
  FOREACH ser IN ARRAY ARRAY['morning_download', 'ai_trivia', 'real_or_ai'] LOOP
    UPDATE stories.settings
       SET value = CASE
                     WHEN jsonb_typeof(value -> ser) = 'object' THEN jsonb_set(value, ARRAY[ser, 'auto'], 'false'::jsonb, true)
                     ELSE value || jsonb_build_object(ser, jsonb_build_object('auto', false))
                   END,
           updated_by = 'settings-standard migration', updated_at = now()
     WHERE key = 'series' AND jsonb_typeof(value -> ser -> 'auto') IS DISTINCT FROM 'boolean';
  END LOOP;

  -- The engine-wide fallbacks each type reads while `types` has no row for it (lib/stories/settings.ts loadSettings).
  SELECT CASE WHEN jsonb_typeof(value) = 'boolean' THEN value ELSE 'false'::jsonb END INTO fallback_live FROM stories.settings WHERE key = 'publishing_live';
  SELECT CASE WHEN jsonb_typeof(value) = 'number' AND (value #>> '{}')::numeric > 0 THEN value ELSE '2'::jsonb END INTO fallback_cap FROM stories.settings WHERE key = 'daily_cap_usd';
  fallback_live := coalesce(fallback_live, 'false'::jsonb);
  fallback_cap := coalesce(fallback_cap, '2'::jsonb);

  SELECT value INTO types_now FROM stories.settings WHERE key = 'types';
  types_now := CASE WHEN jsonb_typeof(types_now) = 'object' THEN types_now ELSE '{}'::jsonb END;
  FOREACH v IN ARRAY ARRAY['stories', 'ai_trivia', 'real_or_ai'] LOOP
    types_now := jsonb_set(
      types_now, ARRAY[v],
      -- Today's values first (stored, else the fallbacks), then approval on, then the refill cap only where absent.
      jsonb_build_object('publishingLive', fallback_live, 'dailyCapUsd', fallback_cap, 'refill_cap_usd', 0.25)
        || CASE WHEN jsonb_typeof(types_now -> v) = 'object' THEN types_now -> v ELSE '{}'::jsonb END
        || jsonb_build_object('requireApproval', true),
      true);
  END LOOP;
  INSERT INTO stories.settings AS s (key, value, updated_by, updated_at)
  VALUES ('types', types_now, 'settings-standard migration', now())
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
   WHERE s.value IS DISTINCT FROM excluded.value;
END $$;

COMMIT;
