-- db/helios_social_image_cache_migration.sql
--
-- Image cache for the v1 image step (see docs/IMAGES-V1-HANDOFF.md).
--
-- One row per Wikidata entity we've ever picked a photo for. The image
-- step looks up by wikidata_id first — a hit skips the full search →
-- license filter → vision check → Supabase Storage upload chain, so
-- repeat subjects (OpenAI, Sam Altman, Anthropic) cost $0 after the
-- first time.
--
-- The chosen image file itself lives in Supabase Storage under bucket
-- `helios-social-images`. Row stores only the metadata needed to
-- (a) render the slide (storage_url) and (b) prove provenance in the
-- run summary + review UI (subject, wikidata_id, commons_file, license,
-- author, credit).
--
-- Additive only. Idempotent. Safe to re-run.
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS helios_social;

CREATE TABLE IF NOT EXISTS helios_social.image_cache (
    -- Wikidata entity id, e.g. "Q19837" (Gavin Newsom). Primary key —
    -- one row per subject, not per photo. The image step re-resolves
    -- the subject string → Q-id every time, so the same person named
    -- two different ways ("Sam Altman", "Samuel H. Altman") maps to
    -- the same row.
    wikidata_id       TEXT PRIMARY KEY,

    -- The subject string as the Writer wrote it in the IMAGE line
    -- ("Gavin Newsom"). Kept for humans + debugging. Not authoritative
    -- for lookup (wikidata_id is).
    subject           TEXT NOT NULL,

    -- Commons file name in canonical form, e.g. "File:Gavin Newsom
    -- official photo.jpg". Reconstructs the Commons file page URL:
    -- https://commons.wikimedia.org/wiki/<commons_file>
    commons_file      TEXT NOT NULL,

    -- Path within the helios-social-images bucket where the downloaded
    -- image bytes live, e.g. "wikidata/Q19837/abc12345.jpg".
    storage_path      TEXT NOT NULL,

    -- Public URL from Supabase Storage. Renderer reads this into the
    -- <img src>. Written once at cache-insert time so the renderer
    -- doesn't have to re-sign every render.
    storage_url       TEXT NOT NULL,

    -- License short name from Commons extmetadata.LicenseShortName —
    -- always one of: PD, CC0, CC BY, CC BY-SA (variants of each).
    -- Anything else was rejected upstream by the license filter.
    license           TEXT NOT NULL,

    -- Optional link to the license text (Commons extmetadata.LicenseUrl).
    license_url       TEXT,

    -- Author string, HTML-stripped. Required — an image with no known
    -- author never ships, per docs/IMAGES-V1-HANDOFF.md.
    author            TEXT NOT NULL,

    -- Full credit line as it will appear in the caption's "Photos:"
    -- section, e.g. "Photo: John Doe / Wikimedia Commons, CC BY-SA 4.0".
    credit            TEXT NOT NULL,

    -- Native dimensions from Commons imageinfo. Kept for the size
    -- filter and for debugging "why did we pick a small image".
    width             INTEGER NOT NULL,
    height            INTEGER NOT NULL,

    -- Whether the image is a portrait of one person (used by the
    -- adapter to choose cover C1 vs C2 and to decide whether the
    -- quote slide gets a round speaker photo).
    is_portrait       BOOLEAN NOT NULL DEFAULT false,

    chosen_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for TTL sweeps ("show me everything older than 30 days") when
-- we add the eviction sweep later. Not used at read time — reads are
-- primary-key lookups.
CREATE INDEX IF NOT EXISTS image_cache_chosen_at_idx
    ON helios_social.image_cache (chosen_at);

-- Note: the Supabase Storage bucket `helios-social-images` (public
-- read, service-role write) must exist before the image step runs.
-- Bucket creation is not part of this SQL migration; it lives in
-- scripts/apply_helios_social_image_cache_migration.js which creates
-- the bucket idempotently via the Storage REST API after the SQL runs.
