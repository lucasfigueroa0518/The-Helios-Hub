-- Bald-Eagle 2026-11-12, D4 / D8 (Tommy: "For evergreen content, we will have a 2-day cushion"): lead time.
-- Idempotent. Apply to the database that holds the `explainers` schema (Supabase when EXPLAINERS_DB=supabase; the
-- local and test PGlite databases add it themselves, lib/explainers/local-db.ts).
--
-- Explainers (T4b): a render the night requests carries the New York date it is made FOR (its target date, two days
-- ahead). NULL: a person's render (Make it, Regenerate, Run now), which counts as the day it was requested. The code
-- reads it through to_jsonb(j)->>'target_date', so it runs (as "no target") until this is applied.
-- AI Drama needs no change: its night jobs already carry their date in reel_ai_drama.jobs.night_date, which now holds
-- the target date; reel_ai_drama.nights.ny_date and explainers.idea_cycles.ny_date now hold the date a night FILLED.
ALTER TABLE explainers.jobs ADD COLUMN IF NOT EXISTS target_date date;
