-- db/intake_stories_split.sql — the central intake for the Stories split (SS-30, SS-31; idempotent).
-- planning/Stories Split/CONTRACT.md §3 C. "Are you smarter than AI?" gets the intake order 'trivia'
-- (lib/intake/orders.ts TRIVIA_ORDER): its writer's cited pages are deposited as family 'search' items under
-- source `search:trivia`, which the existing items_family_check already allows, so no CHECK changes here.
--
-- The consumer switch key `trivia` starts on 'legacy' (Lucas flips it after a real run). Only a missing key is
-- added: an existing value is never overwritten, and no key is removed (retired gtn/fvp keys on a live row stay
-- and read as nothing).
--
-- Run after db/intake_schema.sql (and after db/stories_split.sql, CONTRACT.md §4). Tests run it on PGlite
-- (tests/fixtures/intake/stubs.ts intakeDb).
-- Apply (Lucas's go-ahead first: DATABASE_URL is the shared production DB):
--   psql "$DIRECT_DATABASE_URL" -X -f db/intake_stories_split.sql
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO intake.settings (key, value)
VALUES ('consumers', '{"trivia":"legacy"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

UPDATE intake.settings
   SET value = value || '{"trivia":"legacy"}'::jsonb, updated_at = now()
 WHERE key = 'consumers' AND NOT (value ? 'trivia');

COMMIT;
