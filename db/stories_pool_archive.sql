-- db/stories_pool_archive.sql — Stories' pool clean-up archives instead of deleting (idempotent).
-- Tommy, 2026-11-16 ("Yes, archive them"; docs/superpowers/specs/2026-11-15-pool-ui-contract.md §7).
--
-- The refresh (lib/stories/pool.ts writePool and capSeries) used to DELETE an unused row that went
-- stale, that a full refresh no longer returned, or that fell past the 30-idea cap. It now stamps
-- archived_at (and why) instead. While archived it is never offered to a build and never counts toward
-- the cap. A row the refresh itself archived (stale, not-returned, over-cap) is reopened when the intake
-- returns it, as a deleted row used to be re-inserted. A person's Archive (social_hub.idea_adjustments)
-- keeps it out for good.
--
-- Safe to apply before or after the code: the code checks for the column and deletes as before until
-- it exists. Apply it first so nothing more is deleted.
\set ON_ERROR_STOP on

ALTER TABLE stories.pool ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE stories.pool ADD COLUMN IF NOT EXISTS archived_reason text;

-- The open pool is now the unused AND unarchived rows.
CREATE INDEX IF NOT EXISTS idx_stories_pool_live
    ON stories.pool (series, score DESC NULLS LAST)
    WHERE used_at IS NULL AND archived_at IS NULL;
