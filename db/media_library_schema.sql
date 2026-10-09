-- db/media_library_schema.sql — the photo bank (idempotent, additive only).
-- Schema `media_library` inside the shared Helios Supabase Postgres, like `social`.
-- Decision: DECISIONS_LOG D49 (Tommy, 2026-10-08: "Store images going forward
-- across ALL photo-finder runs … accumulating our own bank of seeded, tagged
-- images"). Code: lib/media-library/.
--
-- Nothing here touches another schema and nothing references social.*: the
-- bank links to social.used_photos only by URL, in queries.
--
--   photos         one row per unique image content (sha256 of the original bytes)
--   photo_sources  one row per source URL; also the durable ingest outbox
--   sightings      what a finder run learned about a URL (vetted or rejected)
--   settings       SQL-flippable switches; both start OFF
--
-- Apply (a human decision; the script refuses without --apply):
--   node scripts/apply_media_library_schema.js --apply
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS media_library;

-- ── Photos ──────────────────────────────────────────────────────────────────
-- The bank copy lives in the private `photo-bank` Storage bucket:
-- originals/<sha:2>/<sha>.jpg (long side ≤ 2560, JPEG q85) and
-- thumbs/<sha:2>/<sha>.jpg (480 px, q72). `mime` and `bytes` describe the
-- original download; width/height are its true (EXIF-oriented) size.
-- reuse_ok: open or government licence (the finder may offer it again);
-- company/official images are kept for the library only (reuse_ok false).
CREATE TABLE IF NOT EXISTS media_library.photos (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sha256          text NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    dhash           text,
    master_path     text NOT NULL,
    thumb_path      text NOT NULL,
    mime            text NOT NULL,
    bytes           integer NOT NULL,
    width           integer NOT NULL,
    height          integer NOT NULL,
    credit          text NOT NULL,
    licence         text NOT NULL CHECK (licence IN ('open', 'government', 'company', 'unknown')),
    reuse_ok        boolean NOT NULL DEFAULT false,
    qids            text[] NOT NULL DEFAULT '{}',
    subjects        text[] NOT NULL DEFAULT '{}',
    scenes          text[] NOT NULL DEFAULT '{}',
    tags            text[] NOT NULL DEFAULT '{}',
    vision_pass     boolean NOT NULL DEFAULT false,
    status          text NOT NULL DEFAULT 'stored' CHECK (status IN ('stored', 'removed')),
    removed_reason  text,
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_library_photos_qids ON media_library.photos USING gin (qids);
CREATE INDEX IF NOT EXISTS idx_media_library_photos_tags ON media_library.photos USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_media_library_photos_seen ON media_library.photos (status, last_seen_at DESC);

-- ── Photo sources (and the ingest outbox) ───────────────────────────────────
-- One row per URL a vetted photo was found at. `licence`/`reuse_ok` are the
-- policy's verdict on this source's credit (lib/media-library/policy.ts); the
-- photo takes the most permissive of its sources. Outbox: pending → fetching
-- → stored | failed (retried with back-off, at most 5 attempts) | gone (404/410)
-- | skipped (not an image, or over 20 MB). A row stuck in `fetching` for more
-- than 10 minutes is claimed again.
CREATE TABLE IF NOT EXISTS media_library.photo_sources (
    url             text PRIMARY KEY,
    photo_id        uuid REFERENCES media_library.photos (id) ON DELETE SET NULL,
    source          text,
    lane            text,
    title           text,
    date            text,
    credit          text,
    licence         text CHECK (licence IN ('open', 'government', 'company', 'unknown')),
    reuse_ok        boolean NOT NULL DEFAULT false,
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fetching', 'stored', 'failed', 'gone', 'skipped')),
    attempts        integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    claimed_at      timestamptz,
    last_error      text,
    last_ok_at      timestamptz,
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_library_sources_photo ON media_library.photo_sources (photo_id);
CREATE INDEX IF NOT EXISTS idx_media_library_sources_outbox ON media_library.photo_sources (status, next_attempt_at);

-- ── Sightings ───────────────────────────────────────────────────────────────
-- What one finder run learned about one URL for one request on one slide
-- (slide = render position, 1 = cover; Stories: the request's order in the
-- build). Outcomes: picked (the slide's winner), passed (a runner-up that
-- passed every check), verified (an identity-verified headshot, second photo,
-- CEO, headquarters or logo), rejected (failed the tag fit or the close-up
-- check: negative knowledge, never stored), used (imported from
-- social.used_photos). No foreign key: rejected URLs have no source row.
CREATE TABLE IF NOT EXISTS media_library.sightings (
    id              bigserial PRIMARY KEY,
    url             text NOT NULL,
    run_kind        text NOT NULL CHECK (run_kind IN ('carousel', 'story', 'backfill')),
    run_ref         text NOT NULL,
    slide           integer NOT NULL,
    request_query   text NOT NULL,
    request_kind    text,
    request_qid     text,
    qid             text,
    subject         text,
    verified        boolean NOT NULL DEFAULT false,
    outcome         text NOT NULL CHECK (outcome IN ('picked', 'passed', 'verified', 'rejected', 'used')),
    vision          jsonb,
    tile_tags       text[] NOT NULL DEFAULT '{}',
    fit             real,
    faces           jsonb,
    plate           text,
    at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (url, run_kind, run_ref, slide, request_query)
);

CREATE INDEX IF NOT EXISTS idx_media_library_sightings_url ON media_library.sightings (url, at DESC);
CREATE INDEX IF NOT EXISTS idx_media_library_sightings_at ON media_library.sightings (at DESC);

-- ── Settings ────────────────────────────────────────────────────────────────
-- Flip with SQL, e.g.:
--   UPDATE media_library.settings SET value = 'true'::jsonb, updated_at = now() WHERE key = 'capture';
--   UPDATE media_library.settings SET value = '"compete"'::jsonb, updated_at = now() WHERE key = 'finder_source';
-- capture               false | true      store vetted photos from finder runs
-- finder_source         "off" | "compete" | "first"   the bank as a finder source
-- used_photos_after_id  the last social.used_photos id imported (the watermark)
CREATE TABLE IF NOT EXISTS media_library.settings (
    key             text PRIMARY KEY,
    value           jsonb NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO media_library.settings (key, value) VALUES
    ('capture', 'false'::jsonb),
    ('finder_source', '"off"'::jsonb),
    ('used_photos_after_id', '0'::jsonb)
ON CONFLICT (key) DO NOTHING;
