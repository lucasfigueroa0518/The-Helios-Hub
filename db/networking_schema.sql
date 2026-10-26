-- db/networking_schema.sql — Helios Networking Calendar (idempotent).
-- Apply:
--   npm run db:networking
--   # or full: npm run db:setup
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS networking;

-- ── Canonical kept events ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS networking.events (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fingerprint      text NOT NULL UNIQUE,
    title            text NOT NULL,
    description      text NOT NULL DEFAULT '',
    canonical_url    text NOT NULL,
    listing_urls     text[] NOT NULL DEFAULT '{}',
    start_at         timestamptz NOT NULL,
    end_at           timestamptz,
    timezone         text,
    venue_name       text,
    address          text,
    city             text,
    metro            text NOT NULL
                         CHECK (metro IN ('boston', 'miami', 'nyc', 'sf')),
    lat              double precision,
    lng              double precision,
    attendance       text NOT NULL
                         CHECK (attendance IN ('in_person', 'hybrid')),
    access           text NOT NULL
                         CHECK (access IN ('open', 'paid', 'invite_only')),
    access_evidence  text,
    bucket           text NOT NULL
                         CHECK (bucket IN ('tech', 'vertical', 'both')),
    industries       text[] NOT NULL DEFAULT '{}',
    host_name        text,
    status           text NOT NULL DEFAULT 'scheduled'
                         CHECK (status IN ('scheduled', 'cancelled', 'expired')),
    first_seen_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at     timestamptz NOT NULL DEFAULT now(),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_networking_events_start
    ON networking.events (start_at);
CREATE INDEX IF NOT EXISTS idx_networking_events_metro_start
    ON networking.events (metro, start_at);
CREATE INDEX IF NOT EXISTS idx_networking_events_status
    ON networking.events (status, start_at);

-- ── Per-source listings (dedupe key) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS networking.event_listings (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id         uuid NOT NULL REFERENCES networking.events (id) ON DELETE CASCADE,
    source           text NOT NULL,
    source_event_id  text NOT NULL,
    url              text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_networking_event_listings_event
    ON networking.event_listings (event_id);

-- ── Rejected candidates (debug / re-score) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS networking.event_rejects (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source           text NOT NULL,
    source_event_id  text NOT NULL,
    url              text,
    title            text NOT NULL,
    start_at         timestamptz,
    city             text,
    reason_codes     text[] NOT NULL,
    payload          jsonb NOT NULL DEFAULT '{}',
    ingest_run_id    uuid,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_networking_event_rejects_run
    ON networking.event_rejects (ingest_run_id);

-- ── Ingest runs ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS networking.ingest_runs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    week_key         text NOT NULL,
    status           text NOT NULL DEFAULT 'running'
                         CHECK (status IN ('running', 'done', 'failed')),
    started_at       timestamptz NOT NULL DEFAULT now(),
    finished_at      timestamptz,
    source_results   jsonb NOT NULL DEFAULT '[]',
    kept_count       integer NOT NULL DEFAULT 0,
    rejected_count   integer NOT NULL DEFAULT 0,
    error            text
);

CREATE INDEX IF NOT EXISTS idx_networking_ingest_runs_week
    ON networking.ingest_runs (week_key, started_at DESC);

ALTER TABLE networking.event_rejects
    DROP CONSTRAINT IF EXISTS event_rejects_ingest_run_fk;
ALTER TABLE networking.event_rejects
    ADD CONSTRAINT event_rejects_ingest_run_fk
    FOREIGN KEY (ingest_run_id) REFERENCES networking.ingest_runs (id) ON DELETE SET NULL;

-- ── Ingest v2: four metros and quality signals (AE-02, M1) ─────────────────
-- Additive and idempotent. The inline metro CHECK above only applies to a new
-- table, so an existing one is widened here (DROP + ADD carries the full list).

ALTER TABLE networking.events DROP CONSTRAINT IF EXISTS events_metro_check;
ALTER TABLE networking.events
    ADD CONSTRAINT events_metro_check CHECK (metro IN ('boston', 'miami', 'nyc', 'sf'));

-- Signals read straight from the sources, no LLM (lib/networking/types.ts
-- CandidateSignals). NULL means the source did not say. organizer_kind is one of
-- luma_calendar, luma_person, meetup_group, gdg_chapter, conference.
-- hosts holds at most 8 {name, bioShort, linkedin, isVerified}: public organizer
-- info only, never Luma featured_guests (attendees, AE-21).
ALTER TABLE networking.events
    ADD COLUMN IF NOT EXISTS organizer_name          text,
    ADD COLUMN IF NOT EXISTS organizer_kind          text,
    ADD COLUMN IF NOT EXISTS organizer_url           text,
    ADD COLUMN IF NOT EXISTS hosts                   jsonb NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS guest_count             integer,
    ADD COLUMN IF NOT EXISTS capacity                integer,
    ADD COLUMN IF NOT EXISTS spots_remaining         integer,
    ADD COLUMN IF NOT EXISTS is_sold_out             boolean,
    ADD COLUMN IF NOT EXISTS waitlist_active         boolean,
    ADD COLUMN IF NOT EXISTS requires_approval       boolean,
    ADD COLUMN IF NOT EXISTS is_free                 boolean,
    ADD COLUMN IF NOT EXISTS price_min_cents         integer,
    ADD COLUMN IF NOT EXISTS price_max_cents         integer,
    ADD COLUMN IF NOT EXISTS price_currency          text,
    ADD COLUMN IF NOT EXISTS organizer_event_count   integer,
    ADD COLUMN IF NOT EXISTS organizer_member_count  integer,
    ADD COLUMN IF NOT EXISTS organizer_rating        numeric(3, 2),
    ADD COLUMN IF NOT EXISTS organizer_rating_count  integer,
    ADD COLUMN IF NOT EXISTS series_key              text,
    ADD COLUMN IF NOT EXISTS source_tags             text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS rsvp_offsite            boolean,
    ADD COLUMN IF NOT EXISTS signals                 jsonb NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS description_source      text,
    -- Set once by networking.event_details (AE-05/06); an event is never fetched twice.
    ADD COLUMN IF NOT EXISTS details_fetched_at      timestamptz;

-- networking.event_details picks scheduled events with no details yet, by start.
CREATE INDEX IF NOT EXISTS idx_networking_events_details_pending
    ON networking.events (start_at)
    WHERE details_fetched_at IS NULL AND status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_networking_events_series
    ON networking.events (series_key)
    WHERE series_key IS NOT NULL;

-- Trimmed upstream payload per listing, for re-scoring without a refetch.
-- Built from an allowlist of fields: never attendee lists.
ALTER TABLE networking.event_listings
    ADD COLUMN IF NOT EXISTS raw jsonb;

-- ── Anchors: conferences and tech weeks (M2 satellite term) ─────────────────
-- Filled by the conferences adapter (source 'developers.events') on each ingest.

CREATE TABLE IF NOT EXISTS networking.anchors (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    metro       text NOT NULL
                    CHECK (metro IN ('boston', 'miami', 'nyc', 'sf')),
    starts_on   date NOT NULL,
    ends_on     date,
    url         text,
    source      text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (name, metro, starts_on)
);

CREATE INDEX IF NOT EXISTS idx_networking_anchors_metro_start
    ON networking.anchors (metro, starts_on);

-- ── Jev logs and cost ledger (Stories pattern, db/stories_schema.sql) ────────
-- One jev_logs row per question set per scored event; cost_events is the true
-- ledger (a merged call repeats input_tokens on each set's log row).

CREATE TABLE IF NOT EXISTS networking.jev_logs (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id                uuid REFERENCES networking.events (id) ON DELETE SET NULL,
    week_key                text,
    component               text NOT NULL,
    question_set_id         text NOT NULL,
    question_set_version    text NOT NULL,
    resolved_model          text,
    state                   jsonb NOT NULL,
    answers                 jsonb NOT NULL,
    input_tokens            integer NOT NULL DEFAULT 0,
    expires_at              timestamptz NOT NULL DEFAULT (now() + interval '45 days'),
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_networking_jev_logs_event
    ON networking.jev_logs (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_networking_jev_logs_expires
    ON networking.jev_logs (expires_at);

CREATE TABLE IF NOT EXISTS networking.cost_events (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            uuid REFERENCES networking.events (id) ON DELETE SET NULL,
    week_key            text,
    -- The ai_events run that paid for the call (no FK: that schema is applied separately).
    run_id              uuid,
    vendor              text NOT NULL CHECK (vendor IN ('anthropic', 'jev', 'web_search')),
    component           text NOT NULL,
    model               text,
    input_tokens        integer NOT NULL DEFAULT 0,
    output_tokens       integer NOT NULL DEFAULT 0,
    cache_read_tokens   integer NOT NULL DEFAULT 0,
    cache_write_tokens  integer NOT NULL DEFAULT 0,
    usd                 numeric(12, 6) NOT NULL DEFAULT 0,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_networking_cost_created
    ON networking.cost_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_networking_cost_run
    ON networking.cost_events (run_id) WHERE run_id IS NOT NULL;

-- ── Event scores (M2 event-pick) ─────────────────────────────────────────────
-- Scored once per question-set version and never re-swept (AE-05). gate names
-- the failed gate (score then NULL); parts is the ScoreBreakdown for the hub.

CREATE TABLE IF NOT EXISTS networking.event_scores (
    event_id     uuid NOT NULL REFERENCES networking.events (id) ON DELETE CASCADE,
    set_version  text NOT NULL,
    answers      jsonb NOT NULL DEFAULT '{}',
    gate         text,
    score        numeric,
    parts        jsonb NOT NULL DEFAULT '[]',
    scored_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, set_version)
);

-- ── Public snapshot publish state (M3) ───────────────────────────────────────
-- One row per published feed: last content hash and deploy-hook bookkeeping.

CREATE TABLE IF NOT EXISTS networking.publish_state (
    id                 text PRIMARY KEY,
    last_hash          text,
    last_published_at  timestamptz,
    last_hook_at       timestamptz,
    last_hook_status   text
);
