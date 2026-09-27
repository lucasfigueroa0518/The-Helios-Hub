-- db/helios_social_editorial_phase4_migration.sql — Archetype router.
--
-- Per Lucas's feedback on the copy pipeline (2026-09-25/26): the universal
-- beat sequence was forcing four different story shapes into one flow.
-- Fix: route to one of three archetypes at strategy time — DEADLINE (a
-- mandate + clock), FIGHT (two named actors publicly disagree), NUMBER
-- (a striking datapoint). GENERIC is the fallback for stories that don't
-- match any archetype and preserves the pre-archetype flow.
--
-- The archetype is derived heuristically from fact_sheet signals (no LLM
-- call at routing time) and stored so we can query "how many DEADLINE
-- stories did we ship this week" and to drive downstream design choices
-- (a DEADLINE cover looks different from a FIGHT cover).
--
-- Idempotent. Safe to re-run.
\set ON_ERROR_STOP on

ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS archetype text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'helios_social.article_queue'::regclass
      AND conname = 'article_queue_archetype_check'
  ) THEN
    ALTER TABLE helios_social.article_queue
      ADD CONSTRAINT article_queue_archetype_check
      CHECK (archetype IS NULL OR archetype IN (
        'DEADLINE',
        'FIGHT',
        'NUMBER',
        'GENERIC'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_archetype
  ON helios_social.article_queue (archetype)
  WHERE archetype IS NOT NULL;
