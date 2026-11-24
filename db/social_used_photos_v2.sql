-- CI-32: one used-photo ledger across all content (2026-11-10). Additive and idempotent.
-- A photo published by any post can't be used again for 20 days (lib/photos/used.ts). Rows are written when a post
-- is published (the app's own publish, or the nightly Instagram read in lib/photos/ig-sync.ts).
ALTER TABLE social.used_photos
  ADD COLUMN IF NOT EXISTS vertical text,
  ADD COLUMN IF NOT EXISTS media_id text,
  ADD COLUMN IF NOT EXISTS phash text,
  ADD COLUMN IF NOT EXISTS dhash text;

CREATE INDEX IF NOT EXISTS used_photos_used_at_idx ON social.used_photos (used_at);
CREATE INDEX IF NOT EXISTS used_photos_story_id_idx ON social.used_photos (story_id);

-- The nightly Instagram read: one row per Instagram post it has seen. A matched post is never matched again;
-- an unmatched one is retried while it is newer than 3 days (lib/photos/ig-sync.ts IG_SYNC_RETRY_DAYS).
CREATE TABLE IF NOT EXISTS social.ig_media_matches (
  media_id text PRIMARY KEY,
  media_timestamp timestamptz NOT NULL,
  surface text NOT NULL,              -- 'feed' | 'story'
  vertical text,                      -- null while unmatched
  post_id text,
  how text NOT NULL,                  -- 'media_id' | 'caption' | 'image' | 'none'
  photos_logged int NOT NULL DEFAULT 0,
  checked_at timestamptz NOT NULL DEFAULT now()
);
