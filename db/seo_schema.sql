-- db/seo_schema.sql — Search Console warehouse (idempotent).
-- Apply:
--   npm run db:seo
--   # or full: npm run db:setup
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS seo;

CREATE TABLE IF NOT EXISTS seo.properties (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_url           text NOT NULL UNIQUE,
    permission_level   text,
    last_synced_at     timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seo.daily_totals (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id   uuid NOT NULL REFERENCES seo.properties (id) ON DELETE CASCADE,
    date          date NOT NULL,
    search_type   text NOT NULL DEFAULT 'web',
    clicks        double precision NOT NULL DEFAULT 0,
    impressions   double precision NOT NULL DEFAULT 0,
    ctr           double precision NOT NULL DEFAULT 0,
    position      double precision NOT NULL DEFAULT 0,
    UNIQUE (property_id, date, search_type)
);

CREATE INDEX IF NOT EXISTS idx_seo_daily_totals_property_date
    ON seo.daily_totals (property_id, date, search_type);

CREATE TABLE IF NOT EXISTS seo.dimension_rows (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id     uuid NOT NULL REFERENCES seo.properties (id) ON DELETE CASCADE,
    date            date NOT NULL,
    search_type     text NOT NULL DEFAULT 'web',
    dimension       text NOT NULL
                    CHECK (dimension IN ('query', 'page', 'country', 'device', 'search_appearance')),
    dimension_key   text NOT NULL,
    clicks          double precision NOT NULL DEFAULT 0,
    impressions     double precision NOT NULL DEFAULT 0,
    ctr             double precision NOT NULL DEFAULT 0,
    position        double precision NOT NULL DEFAULT 0,
    UNIQUE (property_id, date, search_type, dimension, dimension_key)
);

CREATE INDEX IF NOT EXISTS idx_seo_dimension_rows_lookup
    ON seo.dimension_rows (property_id, date, search_type, dimension);

CREATE TABLE IF NOT EXISTS seo.sitemaps (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id          uuid NOT NULL REFERENCES seo.properties (id) ON DELETE CASCADE,
    path                 text NOT NULL,
    last_submitted_at    timestamptz,
    last_downloaded_at   timestamptz,
    is_pending           boolean NOT NULL DEFAULT false,
    is_sitemaps_index    boolean NOT NULL DEFAULT false,
    errors               integer NOT NULL DEFAULT 0,
    warnings             integer NOT NULL DEFAULT 0,
    contents             jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (property_id, path)
);

CREATE TABLE IF NOT EXISTS seo.sync_runs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at          timestamptz NOT NULL DEFAULT now(),
    finished_at         timestamptz,
    status              text NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running', 'succeeded', 'failed')),
    newest_date         date,
    properties_synced   integer NOT NULL DEFAULT 0,
    days_pulled         integer NOT NULL DEFAULT 0,
    error               text
);

CREATE INDEX IF NOT EXISTS idx_seo_sync_runs_started
    ON seo.sync_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS seo.url_inspections (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id      uuid NOT NULL REFERENCES seo.properties (id) ON DELETE CASCADE,
    inspection_url   text NOT NULL,
    inspected_at     timestamptz NOT NULL DEFAULT now(),
    payload          jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_seo_url_inspections_property
    ON seo.url_inspections (property_id, inspected_at DESC);
