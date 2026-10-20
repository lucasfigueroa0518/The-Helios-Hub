-- The meme lab (planning/Memes/BUILD_PLAN.md M0). Runs on local PGlite until
-- Lucas says to apply it to Supabase. Nothing else writes here, and the lab
-- writes nowhere else.

CREATE SCHEMA IF NOT EXISTS memes;

-- ── The template catalog (ME-50, ME-53) ─────────────────────────────────────
-- Synced from lib/memes/catalog.ts, the approved cards. `family_key` is the
-- Know Your Meme entry that keys the 90-day cooldown (ME-45).
CREATE TABLE IF NOT EXISTS memes.templates (
    id              text PRIMARY KEY,
    imgflip_id      text UNIQUE,
    name            text NOT NULL,
    family_key      text NOT NULL,
    status          text NOT NULL CHECK (status IN ('approved', 'excluded')),
    source          text NOT NULL CHECK (source IN ('classic', 'trending')),
    image_path      text,
    image_hash      text,
    card            jsonb NOT NULL,
    synced_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memes_templates_family ON memes.templates (family_key);

-- ── The 90-day ledger (ME-40 to ME-45) ──────────────────────────────────────
-- One row per use of a template. A row with neither published_at nor
-- released_at is a reservation; published_at starts the 90 days; released_at
-- frees a reservation that never published.
CREATE TABLE IF NOT EXISTS memes.template_uses (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_key      text NOT NULL,
    template_id     text NOT NULL REFERENCES memes.templates (id),
    image_hash      text,
    meme_id         uuid,
    reserved_at     timestamptz NOT NULL DEFAULT now(),
    published_at    timestamptz,
    released_at     timestamptz,
    CHECK (published_at IS NULL OR released_at IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_memes_uses_family ON memes.template_uses (family_key, published_at DESC);

-- ── Audience situations in use (ME-65: a published one rests 3 days) ────────
CREATE TABLE IF NOT EXISTS memes.situation_uses (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    situation_id    text NOT NULL,
    meme_id         uuid,
    published_at    timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memes_situation_uses ON memes.situation_uses (situation_id, published_at DESC);

-- ── The lab's queue (ME-22) ─────────────────────────────────────────────────
-- A Generate click inserts a request; one runner claims it.
CREATE TABLE IF NOT EXISTS memes.requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            text NOT NULL CHECK (kind IN ('single', 'landscape', 'spread')),
    -- single: one LFD story id; spread: ids in detail.storyIds; landscape: Jev picks.
    post_id         text,
    status          text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'running', 'ok', 'failed')),
    requested_at    timestamptz NOT NULL DEFAULT now(),
    requested_by    text,
    started_at      timestamptz,
    finished_at     timestamptz,
    stage           text,
    cost_usd        numeric(10, 6) NOT NULL DEFAULT 0,
    error           text,
    detail          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_memes_requests_status ON memes.requests (status, requested_at);

-- ── Slates and memes ────────────────────────────────────────────────────────
-- A request makes one slate of 3 memes on 3 different templates (ME-61).
-- Candidates the judges dropped are kept too (in_slate false), so a rejected
-- run can be read back.
CREATE TABLE IF NOT EXISTS memes.slates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      uuid NOT NULL REFERENCES memes.requests (id) ON DELETE CASCADE,
    kind            text NOT NULL CHECK (kind IN ('single', 'landscape', 'spread')),
    stories         jsonb NOT NULL,
    shape           jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memes.memes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slate_id        uuid NOT NULL REFERENCES memes.slates (id) ON DELETE CASCADE,
    template_id     text NOT NULL REFERENCES memes.templates (id),
    in_slate        boolean NOT NULL DEFAULT false,
    rank            integer,
    situation_id    text,
    mapping         jsonb NOT NULL,
    judges          jsonb NOT NULL DEFAULT '{}'::jsonb,
    image_path      text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memes_memes_slate ON memes.memes (slate_id, rank);

-- ── Picks: the reinforcement signal (ME-06, ME-60, ME-64) ───────────────────
CREATE TABLE IF NOT EXISTS memes.picks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slate_id        uuid NOT NULL REFERENCES memes.slates (id) ON DELETE CASCADE,
    meme_id         uuid REFERENCES memes.memes (id) ON DELETE CASCADE,
    verdict         text NOT NULL CHECK (verdict IN ('picked', 'rejected')),
    tags            text[] NOT NULL DEFAULT ARRAY[]::text[],
    note            text CHECK (note IS NULL OR length(note) <= 1000),
    rating          smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 4),
    decided_by      text,
    decided_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (meme_id)
);

-- Existing local DBs created before spread: widen the kind checks.
ALTER TABLE memes.requests DROP CONSTRAINT IF EXISTS requests_kind_check;
ALTER TABLE memes.requests ADD CONSTRAINT requests_kind_check CHECK (kind IN ('single', 'landscape', 'spread'));
ALTER TABLE memes.slates DROP CONSTRAINT IF EXISTS slates_kind_check;
ALTER TABLE memes.slates ADD CONSTRAINT slates_kind_check CHECK (kind IN ('single', 'landscape', 'spread'));
ALTER TABLE memes.picks ADD COLUMN IF NOT EXISTS rating smallint;
ALTER TABLE memes.picks DROP CONSTRAINT IF EXISTS picks_rating_check;
ALTER TABLE memes.picks ADD CONSTRAINT picks_rating_check CHECK (rating IS NULL OR rating BETWEEN 1 AND 4);

-- LFD stories the lab is testing (briefs live here; lfd.posts is never written).
CREATE TABLE IF NOT EXISTS memes.lfd_stories (
    id              text PRIMARY KEY,
    group_kind      text NOT NULL CHECK (group_kind IN ('post', 'candidate')),
    post_ref        text,
    ny_date         text,
    headline        text NOT NULL,
    url             text,
    body            text NOT NULL DEFAULT '',
    origin          text,
    outlet          text,
    published_at    timestamptz,
    original_photo  jsonb,
    brief           jsonb,
    brief_source    text CHECK (brief_source IS NULL OR brief_source IN ('copy', 'from-body', 'reporter')),
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Lab-only placement: which meme sits on which LFD slide or as the cover.
-- The later port into Tommy's pipeline reads this table.
CREATE TABLE IF NOT EXISTS memes.lfd_attachments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_ref        text NOT NULL,
    story_key       text,
    meme_id         uuid REFERENCES memes.memes (id) ON DELETE CASCADE,
    role            text NOT NULL CHECK (role IN ('slide', 'cover')),
    attached_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (post_ref, story_key, role)
);

CREATE INDEX IF NOT EXISTS idx_memes_lfd_attach_post ON memes.lfd_attachments (post_ref);

-- ── The gate, the fault picker and the LFD lab (planning/Memes/PREDICTOR.md, FAULTS.md) ──
-- Jev's story tags, one row per story and tagger version. The odds only use one version at a time.
CREATE TABLE IF NOT EXISTS memes.story_tags (
    story_id        text NOT NULL,
    tagger_version  text NOT NULL,
    tags            jsonb NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (story_id, tagger_version)
);

-- Jev's fault count for a slate meme, one row per meme and fault-set version.
CREATE TABLE IF NOT EXISTS memes.meme_faults (
    meme_id         uuid NOT NULL REFERENCES memes.memes (id) ON DELETE CASCADE,
    version         text NOT NULL,
    faults          jsonb NOT NULL,
    count           integer NOT NULL,
    sum             double precision NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (meme_id, version)
);

-- Lab knobs: the gate threshold and the picker's margins.
CREATE TABLE IF NOT EXISTS memes.lab_settings (
    key             text PRIMARY KEY,
    value           jsonb NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- A simulated Last Few Days post: the real engine on a past or present window, saved here, never published.
CREATE TABLE IF NOT EXISTS memes.lfd_sims (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    as_of           timestamptz NOT NULL,
    replay          boolean NOT NULL DEFAULT false,
    status          text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'running', 'ok', 'failed')),
    stage           text,
    cost_usd        numeric(10, 6) NOT NULL DEFAULT 0,
    error           text,
    record          jsonb NOT NULL DEFAULT '{}'::jsonb,
    original_post   jsonb,
    final_post      jsonb,
    placement       jsonb,
    requested_by    text,
    requested_at    timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz
);

CREATE TABLE IF NOT EXISTS memes.lfd_sim_stories (
    sim_id          uuid NOT NULL REFERENCES memes.lfd_sims (id) ON DELETE CASCADE,
    story_key       text NOT NULL,
    story_id        text,
    orig_index      integer NOT NULL,
    headline        text NOT NULL,
    tags            jsonb,
    tagger_version  text,
    odds            jsonb,
    gated           boolean NOT NULL DEFAULT false,
    request_id      uuid,
    picked_meme_id  uuid,
    picker          jsonb,
    PRIMARY KEY (sim_id, story_key)
);

-- Lucas's grade for a whole simulated post.
CREATE TABLE IF NOT EXISTS memes.lfd_sim_grades (
    sim_id          uuid PRIMARY KEY REFERENCES memes.lfd_sims (id) ON DELETE CASCADE,
    rating          smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 4),
    note            text CHECK (note IS NULL OR length(note) <= 2000),
    decided_by      text,
    decided_at      timestamptz NOT NULL DEFAULT now()
);

-- Stories a simulation sends to the meme pipeline live beside the posts and candidates.
ALTER TABLE memes.lfd_stories DROP CONSTRAINT IF EXISTS lfd_stories_group_kind_check;
ALTER TABLE memes.lfd_stories ADD CONSTRAINT lfd_stories_group_kind_check CHECK (group_kind IN ('post', 'candidate', 'sim'));

-- The LFD lab's live run report: what a simulation is doing, step by step, with the spend so far.
CREATE TABLE IF NOT EXISTS memes.lfd_sim_events (
    id              bigserial PRIMARY KEY,
    sim_id          uuid NOT NULL REFERENCES memes.lfd_sims (id) ON DELETE CASCADE,
    at              timestamptz NOT NULL DEFAULT now(),
    stage           text NOT NULL,
    message         text NOT NULL,
    count           integer NOT NULL DEFAULT 1,
    usd             double precision
);
CREATE INDEX IF NOT EXISTS idx_memes_lfd_sim_events ON memes.lfd_sim_events (sim_id, id);
ALTER TABLE memes.lfd_sims ADD COLUMN IF NOT EXISTS started_at timestamptz;
