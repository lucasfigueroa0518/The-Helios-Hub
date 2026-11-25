-- db/media_library_stories_split.sql — the photo bank for the Stories Split (SS-24; planning/Stories Split/CONTRACT.md §3 D).
-- Re-appliable on live data, one transaction. Apply after db/media_library_schema.sql (and after
-- db/stories_split.sql and db/intake_stories_split.sql, CONTRACT.md §4). Not applied to production in this pass.
--
--   licence 'generated'   Real or AI?'s AI images (made by gpt-image-2, or imported from a dataset or a viral post).
--                         Stored with reuse_ok false; no reader serves one to another type (lib/media-library/reader.ts
--                         serves them only to a caller that asks with allowGenerated, which only Real or AI? does;
--                         lib/media-library/drama.ts never does).
--   truth                 'real' | 'ai' for a photo Real or AI? pooled; NULL for every other photo.
--   gen_model, gen_prompt the model that made an AI image and the prompt sent (NULL for an imported or real one).
--   run_kind              sightings from the two new content types: 'ai_trivia' (Are you smarter than AI?) and
--                         'real_or_ai' (Real or AI?). Morning Download keeps 'story'.
--
-- CHECKs are dropped and re-added NOT VALID, then validated, so re-applying never rewrites the table under a lock
-- and a stray old row is reported rather than silently kept.
\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE media_library.photos ADD COLUMN IF NOT EXISTS truth text;
ALTER TABLE media_library.photos ADD COLUMN IF NOT EXISTS gen_model text;
ALTER TABLE media_library.photos ADD COLUMN IF NOT EXISTS gen_prompt text;

ALTER TABLE media_library.photos DROP CONSTRAINT IF EXISTS photos_truth_check;
ALTER TABLE media_library.photos ADD CONSTRAINT photos_truth_check
    CHECK (truth IS NULL OR truth IN ('real', 'ai')) NOT VALID;
ALTER TABLE media_library.photos VALIDATE CONSTRAINT photos_truth_check;

ALTER TABLE media_library.photos DROP CONSTRAINT IF EXISTS photos_licence_check;
ALTER TABLE media_library.photos ADD CONSTRAINT photos_licence_check
    CHECK (licence IN ('open', 'government', 'company', 'own', 'unknown', 'generated')) NOT VALID;
ALTER TABLE media_library.photos VALIDATE CONSTRAINT photos_licence_check;

-- An AI image is never reusable by another type.
ALTER TABLE media_library.photos DROP CONSTRAINT IF EXISTS photos_generated_not_reusable;
ALTER TABLE media_library.photos ADD CONSTRAINT photos_generated_not_reusable
    CHECK (licence <> 'generated' OR NOT reuse_ok) NOT VALID;
ALTER TABLE media_library.photos VALIDATE CONSTRAINT photos_generated_not_reusable;

ALTER TABLE media_library.photo_sources DROP CONSTRAINT IF EXISTS photo_sources_licence_check;
ALTER TABLE media_library.photo_sources ADD CONSTRAINT photo_sources_licence_check
    CHECK (licence IN ('open', 'government', 'company', 'unknown', 'generated')) NOT VALID;
ALTER TABLE media_library.photo_sources VALIDATE CONSTRAINT photo_sources_licence_check;

ALTER TABLE media_library.sightings DROP CONSTRAINT IF EXISTS sightings_run_kind_check;
ALTER TABLE media_library.sightings ADD CONSTRAINT sightings_run_kind_check
    CHECK (run_kind IN ('carousel', 'story', 'backfill', 'reel_ai_drama', 'ai_trivia', 'real_or_ai')) NOT VALID;
ALTER TABLE media_library.sightings VALIDATE CONSTRAINT sightings_run_kind_check;

CREATE INDEX IF NOT EXISTS idx_media_library_photos_truth ON media_library.photos (truth) WHERE truth IS NOT NULL;

COMMIT;
