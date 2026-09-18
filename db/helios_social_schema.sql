-- db/helios_social_schema.sql — Helios Social tables (idempotent).
-- Lives in Outreach Hub's Supabase Postgres under schema `helios_social`.
-- Turns news articles into on-brand Instagram posts (feed carousels + stories)
-- via a two-stage LLM pipeline (Sonnet facts → Opus copy) + HTML/Playwright
-- renderer. Meta Graph publishing scoped for a later sprint.
--
-- Naming:
--   Schema:  helios_social
--   Auth:    no helios_social.users — use outreach.users via Auth.js
--
-- Apply:
--   npm run db:helios-social
--   # or full: npm run db:setup
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS helios_social;

-- ── Article queue ─────────────────────────────────────────────────────────
-- Discovery Lite (v1): team-curated queue of articles waiting to become posts.
-- v2 automated crawler fills the same table via cron; the UI reads from here
-- either way.

CREATE TABLE IF NOT EXISTS helios_social.article_queue (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source            text NOT NULL,
    source_url        text NOT NULL UNIQUE,
    headline          text NOT NULL,
    body              text NOT NULL,
    added_by          uuid NOT NULL REFERENCES outreach.users (id) ON DELETE RESTRICT,
    added_at          timestamptz NOT NULL DEFAULT now(),
    drafted_post_id   uuid   -- FK added below after posts exists (forward ref)
);

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_added_at
    ON helios_social.article_queue (added_at DESC);

-- ── Posts ─────────────────────────────────────────────────────────────────
-- One row per post draft. Approved posts double as few-shot fixtures for the
-- next generation. ig_business_account_id and ig_media_id stay nullable until
-- the publishing sprint wires the Graph API.

CREATE TABLE IF NOT EXISTS helios_social.posts (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    status                   text NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft','approved','exported','published')),
    story_type               text NOT NULL
                                 CHECK (story_type IN ('deal','data_story','photo_led','platform_change')),
    format                   text NOT NULL
                                 CHECK (format IN ('carousel','story')),
    source                   text NOT NULL,
    source_url               text NOT NULL,
    angle                    text NOT NULL,               -- operator's one-sentence intent
    facts_json               jsonb,                       -- Stage 1 output
    caption                  text,                        -- validator enforces ≤2200, first-line ≤125 flag
    validation_errors        jsonb,                       -- last validator run's failures
    ig_business_account_id   text,                        -- NULL until publishing sprint
    ig_media_id              text,                        -- NULL until published
    created_by               uuid NOT NULL REFERENCES outreach.users (id) ON DELETE RESTRICT,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    published_at             timestamptz
);

CREATE INDEX IF NOT EXISTS idx_helios_social_posts_status
    ON helios_social.posts (status);
CREATE INDEX IF NOT EXISTS idx_helios_social_posts_created_by
    ON helios_social.posts (created_by);
CREATE INDEX IF NOT EXISTS idx_helios_social_posts_status_updated
    ON helios_social.posts (status, updated_at DESC);

-- Backfill the article_queue → posts FK now that posts exists. Schema-scoped
-- check so a same-named constraint in another schema doesn't skip this.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class     t ON c.conrelid    = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'helios_social'
          AND t.relname = 'article_queue'
          AND c.conname = 'article_queue_drafted_post_id_fkey'
    ) THEN
        ALTER TABLE helios_social.article_queue
            ADD CONSTRAINT article_queue_drafted_post_id_fkey
            FOREIGN KEY (drafted_post_id)
            REFERENCES helios_social.posts (id) ON DELETE SET NULL;
    END IF;
END $$;

-- ── Post assets ───────────────────────────────────────────────────────────
-- Every stored bitmap tied to a post: rendered slide PNGs (kind='slide_render')
-- and photo-slot bitmaps (kind='photo_slot'). All content lives in Supabase
-- Storage; storage_path is the bucket object key. Unsplash attribution is
-- surfaced in caption + alt text at compose time.

CREATE TABLE IF NOT EXISTS helios_social.post_assets (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id        uuid NOT NULL REFERENCES helios_social.posts (id) ON DELETE CASCADE,
    kind           text NOT NULL CHECK (kind IN ('slide_render','photo_slot')),
    source_kind    text CHECK (source_kind IS NULL OR source_kind IN ('unsplash','ai_generated')),
    storage_path   text NOT NULL,
    attribution    jsonb,                                 -- Unsplash: { photographer, photographer_url, source_url }
    gen_prompt     text,                                  -- populated when source_kind='ai_generated'
    mime_type      text NOT NULL,
    width          integer NOT NULL,
    height         integer NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    -- Cross-column integrity: photo slots need a source_kind, slide renders don't.
    CHECK (
        (kind = 'slide_render' AND source_kind IS NULL) OR
        (kind = 'photo_slot'   AND source_kind IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_helios_social_post_assets_post
    ON helios_social.post_assets (post_id);
CREATE INDEX IF NOT EXISTS idx_helios_social_post_assets_kind
    ON helios_social.post_assets (post_id, kind);

-- ── Post slides ───────────────────────────────────────────────────────────
-- One row per slide in a carousel; exactly one row (position 0) for a story.
-- photo_asset_id is nullable because many layouts have no photo slot.
-- fitter_type_scale is populated by the auto-fitter after render.

CREATE TABLE IF NOT EXISTS helios_social.post_slides (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id              uuid NOT NULL REFERENCES helios_social.posts (id) ON DELETE CASCADE,
    position             integer NOT NULL,                -- 0-based; always 0 for stories
    layout_variant       text NOT NULL,                   -- e.g. 'cover_photo_led','quote','data_change'
    headline             text,
    body                 text,
    key_phrase           text,                            -- brand rule: exactly one accent span per slide
    alt_text             text NOT NULL,                   -- validator hard gate
    photo_asset_id       uuid REFERENCES helios_social.post_assets (id) ON DELETE SET NULL,
    fitter_type_scale    numeric,                         -- auto-fitter's choice; used by calibrate script
    UNIQUE (post_id, position)
);

CREATE INDEX IF NOT EXISTS idx_helios_social_post_slides_post
    ON helios_social.post_slides (post_id, position);
