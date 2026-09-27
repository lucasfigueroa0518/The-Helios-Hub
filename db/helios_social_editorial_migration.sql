-- db/helios_social_editorial_migration.sql — Editorial pipeline (Phase 1).
--
-- Adds the columns the editorial skill's stages 1-2 write to:
--   fact_sheet        (stage 1: Sonnet's full fact sheet)
--   hooks             (stage 2: all candidate hooks with per-question scores)
--   chosen_hook       (stage 2: the picked hook)
--   hook_gate_pass    (stage 2: did the story clear the gate?)
--   hook_gate_reason  (stage 2: one-line reason surfaced in UI)
--   hook_scored_at    (stage 2: when Sonnet ran)
--
-- Stages 3-7 (strategy/bucket/story_plan/copy/qa) will add their own columns
-- in later migrations, so a bad output can be traced to the stage that made
-- the bad call — see `~/.claude/skills/helios-social-editorial/SKILL.md`.
--
-- Idempotent. Safe to re-run.
\set ON_ERROR_STOP on

ALTER TABLE helios_social.article_queue
  ADD COLUMN IF NOT EXISTS fact_sheet       jsonb,
  ADD COLUMN IF NOT EXISTS hooks            jsonb,
  ADD COLUMN IF NOT EXISTS chosen_hook      jsonb,
  ADD COLUMN IF NOT EXISTS hook_gate_pass   boolean,
  ADD COLUMN IF NOT EXISTS hook_gate_reason text,
  ADD COLUMN IF NOT EXISTS hook_scored_at   timestamptz;

-- Partial index for the queue query "articles that passed the hook gate but
-- haven't been planned yet". Kept partial because the vast majority of rows
-- won't have hook_gate_pass set, and the ones that fail the gate are terminal.
CREATE INDEX IF NOT EXISTS idx_helios_social_article_queue_hook_gate_pass
  ON helios_social.article_queue (hook_scored_at DESC)
  WHERE hook_gate_pass IS TRUE;
