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
                         CHECK (metro IN ('boston', 'miami')),
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
