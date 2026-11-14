-- db/bald_eagle_2026_11_12_md.sql — Morning Download remembers what it said
-- (Bald-Eagle 2026-11-12, D2; planning/bald-eagle-2026-11-12/CONTRACT.md T2).
-- Idempotent and additive. Not applied by the builder.
--
-- recordHistory (lib/stories/repository.ts) fills these for a published
-- Morning Download set: the headline its story frame ran and the intake
-- story it came from. lib/stories/md-development.ts reads them (through
-- to_jsonb, so it also runs before this file is applied). No backfill
-- (CLAUDE.md rule 2): older rows stay null and the reader takes the story
-- frame's headline at run time, per story.
--
-- Apply (go-ahead first; DATABASE_URL is the shared production DB):
--   psql "$DIRECT_DATABASE_URL" -X -f db/bald_eagle_2026_11_12_md.sql
\set ON_ERROR_STOP on

ALTER TABLE stories.history ADD COLUMN IF NOT EXISTS headline text;
ALTER TABLE stories.history ADD COLUMN IF NOT EXISTS intake_story_id text;
