-- "Are you Smarter Than AI?" — the daily web game. Only the site's /api functions (service role) touch these.
CREATE SCHEMA IF NOT EXISTS game;

CREATE TABLE IF NOT EXISTS game.days (
    day_number   integer PRIMARY KEY CHECK (day_number > 0),
    ny_date      date NOT NULL UNIQUE,
    ai_label     text NOT NULL,
    imported_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game.questions (
    id           text PRIMARY KEY,                       -- the hub's question id
    day_number   integer NOT NULL REFERENCES game.days (day_number) ON DELETE CASCADE,
    position     smallint NOT NULL CHECK (position BETWEEN 1 AND 5),
    question     text NOT NULL,
    options      jsonb NOT NULL,                         -- [{"letter":"A","text":"..."}, ...] (3)
    correct      text NOT NULL CHECK (correct IN ('A', 'B', 'C')),
    answer_line  text NOT NULL,
    sources      jsonb NOT NULL DEFAULT '[]'::jsonb,
    ai_model     text NOT NULL,
    ai_label     text NOT NULL,
    ai_picked    text NOT NULL CHECK (ai_picked IN ('A', 'B', 'C')),
    UNIQUE (day_number, position)
);

CREATE TABLE IF NOT EXISTS game.plays (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id    uuid NOT NULL,                          -- anonymous device id (localStorage)
    day_number   integer NOT NULL REFERENCES game.days (day_number),
    mode         text NOT NULL CHECK (mode IN ('daily', 'archive')),
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz,
    score        smallint,                               -- player's correct count, set on finish
    ai_score     smallint,
    device       text,                                   -- hash of IP + user agent, for daily replay lock
    UNIQUE (player_id, day_number)                       -- one play per device per day, daily or archive
);
CREATE INDEX IF NOT EXISTS idx_game_plays_player ON game.plays (player_id, day_number);
ALTER TABLE game.plays ADD COLUMN IF NOT EXISTS device text;
CREATE INDEX IF NOT EXISTS idx_game_plays_device ON game.plays (day_number, device) WHERE mode = 'daily';
CREATE INDEX IF NOT EXISTS idx_game_plays_day_daily ON game.plays (day_number) WHERE mode = 'daily' AND finished_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS game.answers (
    play_id      uuid NOT NULL REFERENCES game.plays (id) ON DELETE CASCADE,
    position     smallint NOT NULL CHECK (position BETWEEN 1 AND 5),
    served_at    timestamptz NOT NULL DEFAULT now(),
    answered_at  timestamptz,
    choice       text CHECK (choice IN ('A', 'B', 'C')), -- null = timeout
    is_correct   boolean,
    PRIMARY KEY (play_id, position)
);

-- Deny everything to anon/authenticated: only the service role (our /api functions) reads and writes.
ALTER TABLE game.days ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.plays ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.answers ENABLE ROW LEVEL SECURITY;

-- v2 (also in game_v2_migration.sql for existing databases)
-- GPT-5 nano's real response time from the hub. Null on days made before the hub sent it.
ALTER TABLE game.questions ADD COLUMN IF NOT EXISTS ai_latency_ms integer CHECK (ai_latency_ms IS NULL OR ai_latency_ms > 0);

-- Speed points (0-5,000), set when a play finishes. Null until backfilled for older plays.
ALTER TABLE game.plays ADD COLUMN IF NOT EXISTS points integer CHECK (points IS NULL OR points BETWEEN 0 AND 5000);
ALTER TABLE game.plays ADD COLUMN IF NOT EXISTS ai_points integer CHECK (ai_points IS NULL OR ai_points BETWEEN 0 AND 5000);

-- Per-player state that can't be worked out from plays: streak freezes.
CREATE TABLE IF NOT EXISTS game.player_meta (
    player_id          uuid PRIMARY KEY,                    -- the same anonymous id as plays.player_id
    freezes            smallint NOT NULL DEFAULT 0 CHECK (freezes BETWEEN 0 AND 2),
    frozen_dates       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ["YYYY-MM-DD", ...] missed days a freeze covered
    last_freeze_award  date,                                -- NY date a freeze was last earned (no double awards)
    updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Only the service role (our /api functions) reads and writes.
ALTER TABLE game.player_meta ENABLE ROW LEVEL SECURITY;

-- An email tied to a player id. The player id stays the identity everywhere else (plays, player_meta).
CREATE TABLE IF NOT EXISTS game.accounts (
    email          text PRIMARY KEY CHECK (email = lower(email) AND length(email) <= 254),
    player_id      uuid NOT NULL UNIQUE,
    created_ms     bigint NOT NULL,
    last_login_ms  bigint NOT NULL
);


-- Only the service role (our /api functions) reads and writes.
ALTER TABLE game.accounts ENABLE ROW LEVEL SECURITY;
