-- Smarter Than AI v2: speed points, the AI's real latency, streak freezes.
-- Safe to run more than once. Run before deploying the v2 API, then run the backfill:
--   npx tsx scripts/stai-v2-backfill.ts

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
