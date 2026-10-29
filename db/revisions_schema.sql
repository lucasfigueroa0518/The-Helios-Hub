-- db/revisions_schema.sql — Targeted Revisions: the queue and the log are one table (idempotent).
-- Schema `revisions` inside the existing Helios Supabase Postgres. Additive:
-- depends on social_hub.content_items (db/social_hub_schema.sql), alters nothing.
-- Tests run this file on PGlite.
--
-- Apply (a human decision: DATABASE_URL is the shared production DB):
--   npm run db:revisions
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS revisions;

CREATE TABLE IF NOT EXISTS revisions.requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vertical        text NOT NULL
                      CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days', 'ai_events')),
    item_id         uuid NOT NULL REFERENCES social_hub.content_items (id),
    -- Which parts of the item the instruction points at: [{ kind, key }].
    refs            jsonb NOT NULL DEFAULT '{}'::jsonb,
    requested_by    text,
    instruction     text NOT NULL,
    -- An ask-back reply points at the request that asked.
    parent_id       uuid REFERENCES revisions.requests (id),
    status          text NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested', 'asking', 'running', 'applied', 'blocked',
                                        'failed', 'paused_at_cap', 'paused_at_ceiling', 'undone')),
    question        text,
    interpretation  jsonb,
    stage_tag       text,
    fix_kind        text,
    part            jsonb,
    cap_usd         numeric(12, 6),
    ceiling_usd     numeric(12, 6),
    override_usd    numeric(12, 6),
    spend_usd       numeric(12, 6) NOT NULL DEFAULT 0,
    before          jsonb,
    after           jsonb,
    note            text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    finished_at     timestamptz,
    undone_at       timestamptz,
    undone_by       text
);

CREATE INDEX IF NOT EXISTS idx_revisions_requests_item
    ON revisions.requests (item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_revisions_requests_queue
    ON revisions.requests (created_at) WHERE status = 'requested';
