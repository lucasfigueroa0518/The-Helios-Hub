-- db/intake_schema.sql — the central intake (Phase 1, 2026-11-09; idempotent).
-- Schema `intake` inside the existing Helios Supabase Postgres. Additive:
-- nothing here alters `reels`, `social` or `stories`, and the intake never
-- reads or writes their run tables (lib/intake/types.ts, independence).
-- Tests run this file on PGlite.
--
-- Apply (Lucas's go-ahead first: DATABASE_URL is the shared production DB):
--   psql "$DIRECT_DATABASE_URL" -X -f db/intake_schema.sql
\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS intake;

-- ── Runs ───────────────────────────────────────────────────────────────────
-- One row per intake run (main 12:00, top-up 2:40, or a manual top-up from
-- ensureIntakeFresh). `record` is the IntakeRunRecord. A successful run is
-- `ok` or `partial` (the spend cap stopped it after storing what it had).

CREATE TABLE IF NOT EXISTS intake.runs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind         text NOT NULL CHECK (kind IN ('main', 'topup', 'manual', 'deposit')),
    status       text NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running', 'ok', 'partial', 'skipped', 'failed')),
    stop_reason  text CHECK (stop_reason IN ('cap', 'no-orders', 'error')),
    record       jsonb NOT NULL DEFAULT '{}'::jsonb,
    usd          numeric(12, 6) NOT NULL DEFAULT 0,
    error        text,
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz
);

CREATE INDEX IF NOT EXISTS intake_runs_kind_started_idx ON intake.runs (kind, started_at DESC);
-- Phase 2: 'deposit' = Reels' 1 AM call that groups and scores the finds it deposited (no fetch).
ALTER TABLE intake.runs DROP CONSTRAINT IF EXISTS runs_kind_check;
ALTER TABLE intake.runs ADD CONSTRAINT runs_kind_check CHECK (kind IN ('main', 'topup', 'manual', 'deposit'));

-- ── Stories ────────────────────────────────────────────────────────────────
-- Items about the same event (grouping-v2). `last_joined_at` moves when a
-- member joins: it drives "timely" and re-scoring (only for stories touched
-- in the current run, CLAUDE.md Rule 2). A merged-away story keeps its row
-- with `merged_into` set and is never read.

CREATE TABLE IF NOT EXISTS intake.stories (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    representative_key  text NOT NULL,
    headline            text NOT NULL,
    first_seen_at       timestamptz NOT NULL DEFAULT now(),
    last_joined_at      timestamptz NOT NULL DEFAULT now(),
    merged_into         uuid REFERENCES intake.stories (id),
    created_run_id      uuid
);

CREATE INDEX IF NOT EXISTS intake_stories_last_joined_idx ON intake.stories (last_joined_at DESC);
CREATE INDEX IF NOT EXISTS intake_stories_first_seen_idx ON intake.stories (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS intake_stories_merged_into_idx ON intake.stories (merged_into) WHERE merged_into IS NOT NULL;

-- ── Items ──────────────────────────────────────────────────────────────────
-- One row per canonical URL, whichever list it came from (a URL on both the
-- reels adapters and the feeds is stored once). A dropped item keeps its
-- reason for review and never joins a story.

CREATE TABLE IF NOT EXISTS intake.items (
    key            text PRIMARY KEY,
    family         text NOT NULL CHECK (family IN ('reels', 'feeds', 'search', 'seed', 'field-notes')),
    source_id      text NOT NULL,
    source_name    text NOT NULL,
    source_type    text NOT NULL,
    headline       text NOT NULL,
    body           text NOT NULL DEFAULT '',
    url            text NOT NULL,
    author         text,
    byline         text,
    publish_time   timestamptz,
    first_seen_at  timestamptz NOT NULL DEFAULT now(),
    last_seen_at   timestamptz NOT NULL DEFAULT now(),
    engagement     jsonb,
    media_urls     text[] NOT NULL DEFAULT '{}',
    citation_urls  text[] NOT NULL DEFAULT '{}',
    drop_reason    text,
    story_id       uuid REFERENCES intake.stories (id),
    role           text CHECK (role IN ('primary', 'supporting', 'merged_duplicate')),
    joined_at      timestamptz,
    run_id         uuid,
    -- Seeds (lib/intake/seed.ts): who seeded it and for which order. A story
    -- with a seed member is `yours`.
    seeded_by      text,
    seed_order     text
);

-- Memberships (review fix 1): a URL on a reels adapter AND a feed is stored
-- once, but each list keeps its own verdict, so story-scoring sees the feed
-- copy and reels-score the reels copy whichever list stored it first. A list
-- is a member when its id is set; it keeps the item when its drop reason is
-- null. `drop_reason` is the overall verdict: null when any list keeps it.
-- Null on older rows: membership then follows `family` + `drop_reason`.
ALTER TABLE intake.items ADD COLUMN IF NOT EXISTS feed_slug text;
ALTER TABLE intake.items ADD COLUMN IF NOT EXISTS feed_drop_reason text;
ALTER TABLE intake.items ADD COLUMN IF NOT EXISTS feed_source_name text;
ALTER TABLE intake.items ADD COLUMN IF NOT EXISTS reels_source_id text;
ALTER TABLE intake.items ADD COLUMN IF NOT EXISTS reels_drop_reason text;

-- Phase 2: Field Notes' own sources (lib/field-notes/sources/registry.ts). A Field Notes item is its own story
-- (never grouped). A URL a reels adapter or a feed stored first gains Field Notes membership here, so it is stored
-- once. `field_notes_meta` = { kind, label, item, enrich }: the TipCandidate's trusted metadata, so the
-- field-notes-score scorecard can rebuild the candidate and enrich only what it scores.
ALTER TABLE intake.items DROP CONSTRAINT IF EXISTS items_family_check;
ALTER TABLE intake.items ADD CONSTRAINT items_family_check CHECK (family IN ('reels', 'feeds', 'search', 'seed', 'field-notes'));
ALTER TABLE intake.items ADD COLUMN IF NOT EXISTS field_notes_source_id text;
ALTER TABLE intake.items ADD COLUMN IF NOT EXISTS field_notes_meta jsonb;
CREATE INDEX IF NOT EXISTS intake_items_last_seen_idx ON intake.items (last_seen_at);
-- Phase 2 review: a Field Notes sighting moves only its own last-seen, never the shared `last_seen_at` (Reels'
-- timeliness and the other orders' windows read that one). Retention keeps an item either list saw recently.
ALTER TABLE intake.items ADD COLUMN IF NOT EXISTS field_notes_last_seen_at timestamptz;
-- Seed lookups (reels order open on a pending seed; seed reads by order).
CREATE INDEX IF NOT EXISTS intake_items_seed_order_idx ON intake.items (seed_order) WHERE seed_order IS NOT NULL;

CREATE INDEX IF NOT EXISTS intake_items_story_idx ON intake.items (story_id);
CREATE INDEX IF NOT EXISTS intake_items_source_seen_idx ON intake.items (source_id, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS intake_items_first_seen_idx ON intake.items (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS intake_items_ungrouped_idx ON intake.items (first_seen_at)
    WHERE story_id IS NULL AND drop_reason IS NULL;

-- ── Pair decisions ─────────────────────────────────────────────────────────
-- grouping-v2's cache: one row per sorted URL pair (left_key < right_key),
-- never re-asked. Idea merges are cached here too, keyed by the two stories'
-- primary items.

CREATE TABLE IF NOT EXISTS intake.pair_decisions (
    left_key      text NOT NULL,
    right_key     text NOT NULL,
    action        text NOT NULL CHECK (action IN ('merge', 'link', 'leave')),
    same_event_p  double precision,
    confidence    double precision,
    decided_at    timestamptz NOT NULL DEFAULT now(),
    run_id        uuid,
    PRIMARY KEY (left_key, right_key),
    CHECK (left_key COLLATE "C" < right_key COLLATE "C")
);
-- Pair keys are ordered in code by character code (lib/intake/group.ts orderPair); compare them the same way,
-- not by the database's locale collation (Supabase en_US sorts differently and rejected pairs, 2026-11-09).
ALTER TABLE intake.pair_decisions DROP CONSTRAINT IF EXISTS pair_decisions_check;
ALTER TABLE intake.pair_decisions ADD CONSTRAINT pair_decisions_check CHECK (left_key COLLATE "C" < right_key COLLATE "C");

-- ── Scores ─────────────────────────────────────────────────────────────────
-- One row per story and scorecard (lib/intake/score.ts). The cache key is
-- (version, member_hash): a different hash re-scores, only for stories
-- touched in the current run.

CREATE TABLE IF NOT EXISTS intake.scores (
    story_id     uuid NOT NULL REFERENCES intake.stories (id),
    scorecard    text NOT NULL,
    version      text NOT NULL,
    member_hash  text NOT NULL,
    answers      jsonb NOT NULL DEFAULT '{}'::jsonb,
    result       jsonb NOT NULL,
    usd          numeric(12, 6) NOT NULL DEFAULT 0,
    scored_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (story_id, scorecard)
);

-- ── Watermarks ─────────────────────────────────────────────────────────────
-- Per reels primary adapter: the intake's own window, independent of reels.

CREATE TABLE IF NOT EXISTS intake.watermarks (
    source_id        text PRIMARY KEY,
    last_success_at  timestamptz,
    last_attempt_at  timestamptz
);

-- ── Cost ───────────────────────────────────────────────────────────────────
-- The intake's own cost bucket (Jev), never reels/stories/social.

CREATE TABLE IF NOT EXISTS intake.cost_events (
    id            bigserial PRIMARY KEY,
    run_id        uuid,
    component     text NOT NULL,
    input_tokens  integer NOT NULL DEFAULT 0,
    usd           numeric(12, 6) NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intake_cost_events_run_idx ON intake.cost_events (run_id);

-- ── Settings ───────────────────────────────────────────────────────────────
-- `consumers`: per order, 'intake' reads intake stories, 'legacy' keeps
-- today's path. Every type starts on 'legacy' until Lucas flips it.

CREATE TABLE IF NOT EXISTS intake.settings (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Phase 2 adds reels, carousel and field-notes; a missing key reads as 'legacy' (lib/intake/read.ts).
INSERT INTO intake.settings (key, value)
VALUES ('consumers', '{"lfd":"legacy","md":"legacy","gtn":"legacy","fvp":"legacy","reels":"legacy","carousel":"legacy","field-notes":"legacy"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
