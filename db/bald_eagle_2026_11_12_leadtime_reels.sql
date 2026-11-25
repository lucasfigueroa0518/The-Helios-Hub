-- Bald-Eagle 2026-11-12, D4 / D8: Text on Screen is made 2 days ahead.
-- A slate is keyed by its posting date, and the cutover night (one run) makes two slates: day+1 and day+2.
-- reels.score_slates allowed one slate per run (idx_reels_score_slates_run); it becomes one slate per run per date.
-- Idempotent. Not applied by the builder.

CREATE UNIQUE INDEX IF NOT EXISTS idx_reels_score_slates_run_date
    ON reels.score_slates (run_id, ny_date);

DROP INDEX IF EXISTS reels.idx_reels_score_slates_run;
