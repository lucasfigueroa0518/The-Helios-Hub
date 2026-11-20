-- Smarter Than AI: optional "save with your email". Safe to run more than once.

-- An email tied to a player id. The player id stays the identity everywhere else (plays, player_meta).
CREATE TABLE IF NOT EXISTS game.accounts (
    email          text PRIMARY KEY CHECK (email = lower(email) AND length(email) <= 254),
    player_id      uuid NOT NULL UNIQUE,
    created_ms     bigint NOT NULL,
    last_login_ms  bigint NOT NULL
);


-- Only the service role (our /api functions) reads and writes.
ALTER TABLE game.accounts ENABLE ROW LEVEL SECURITY;

-- The first version sent sign-in codes; that table is no longer used.
DROP TABLE IF EXISTS game.login_codes;
