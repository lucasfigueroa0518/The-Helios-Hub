-- Reels idea content, legacy and intake alike (central intake Phase 2, option b).
-- Contract: planning/Central Intake/PHASE2-CONTRACT.md § "View reels.idea_sources_v".
--
-- Apply AFTER db/reels_schema.sql and db/intake_schema.sql (it reads both).
-- Idempotent: CREATE OR REPLACE VIEW. Lucas's go-ahead first on the shared DB.
--
-- One row per member of an idea:
--   legacy: reels.post_idea_members ⋈ reels.sources (empties as sources age
--           out after 21 days and as Reels stops writing them in intake mode).
--   intake: intake.items of the story whose id is the idea id. A merged-away
--           story keeps no items (lib/intake/group.ts mergeStories moves
--           them all to the target), so its id reads the items of the story
--           at the END of its merged_into chain (a published reel keeps its
--           members); the surviving id reads its own. Recursive, up to 25
--           hops (lib/intake/read.ts resolveStoryId's MAX_MERGE_CHAIN).
--
-- The first 13 columns are the contract's, in its order. The trailing six are
-- what today's readers also read from reels.sources / post_idea_members
-- (member order, the copy writer's author/byline/citations, the frame
-- stage's source bucket, the seed marker), so a reader moved onto the view
-- returns exactly what it returned before on legacy rows.
--
-- Intake rows are the members the Reels lists keep (CI-26: Reels reads only
-- its own sources): an item kept by a reels adapter (its own verdict when
-- reels_source_id is set, else family 'reels' + the overall drop reason), a
-- 'search' item (A4/B6 deposits), or a person's Reels seed. A URL that only a
-- feed keeps is not a Reels member, and neither is one the reels list
-- dropped: legacy never made a dropped source a member either. drop_reason is
-- therefore null on intake rows; seeds are marked by `seeded`, not by it.
--
-- `bucket` is null on intake rows (the intake does not store it): readers
-- resolve it from the adapter registry (lib/reels/visual/run.ts memberBucket).
--
-- Index use: filtering on post_idea_id pushes into the legacy branch
-- (idx_reels_members_idea) and the live-story branch (the stories PK, then
-- intake_items_story_idx). The merge chain starts from merged-away stories
-- only (intake_stories_merged_into_idx, partial) and follows the PK.

CREATE OR REPLACE VIEW reels.idea_sources_v AS
SELECT m.post_idea_id,
       s.id::text                           AS member_key,
       s.canonical_url                      AS url,
       s.headline,
       s.body,
       s.source_name,
       s.adapter_id,
       CASE WHEN s.adapter_id = 'seed' THEN 'seed'
            WHEN s.source_type IN ('B6', 'A4') THEN 'search'
            ELSE 'reels' END                AS family,
       m.role,
       s.publish_time,
       s.ingest_time,
       s.drop_reason,
       'legacy'::text                       AS origin,
       m.joined_at,
       s.author,
       s.byline,
       s.citation_urls,
       s.bucket,
       (s.adapter_id = 'seed' AND s.drop_reason = 'seed') AS seeded
  FROM reels.post_idea_members m
  JOIN reels.sources s ON s.id = m.source_id
UNION ALL
SELECT r.idea_id                            AS post_idea_id,
       i.key                                AS member_key,
       i.url,
       i.headline,
       i.body,
       i.source_name,
       COALESCE(i.reels_source_id, i.source_id) AS adapter_id,
       i.family,
       i.role,
       i.publish_time,
       i.first_seen_at                      AS ingest_time,
       CASE WHEN i.reels_source_id IS NOT NULL THEN i.reels_drop_reason ELSE i.drop_reason END AS drop_reason,
       'intake'::text                       AS origin,
       i.joined_at,
       i.author,
       i.byline,
       i.citation_urls,
       NULL::text                           AS bucket,
       COALESCE(i.seed_order = 'reels', false) AS seeded
  FROM (
         -- a live story reads its own items
         SELECT s0.id AS idea_id, s0.id AS story_id FROM intake.stories s0 WHERE s0.merged_into IS NULL
         UNION ALL
         -- a merged-away story reads the items of the story at the end of its merged_into chain
         SELECT h.idea_id, h.story_id
           FROM (
                  WITH RECURSIVE hop (idea_id, story_id, depth) AS (
                    SELECT a.id, a.merged_into, 1 FROM intake.stories a WHERE a.merged_into IS NOT NULL
                    UNION ALL
                    SELECT hop.idea_id, n.merged_into, hop.depth + 1
                      FROM hop JOIN intake.stories n ON n.id = hop.story_id
                     WHERE n.merged_into IS NOT NULL AND hop.depth < 25
                  )
                  SELECT hop.idea_id, hop.story_id FROM hop
                ) h
           JOIN intake.stories e ON e.id = h.story_id AND e.merged_into IS NULL
       ) r
  JOIN intake.items i ON i.story_id = r.story_id
 WHERE (i.reels_source_id IS NOT NULL AND i.reels_drop_reason IS NULL)
    OR (i.reels_source_id IS NULL AND i.family = 'reels' AND i.drop_reason IS NULL)
    OR (i.family = 'search' AND i.drop_reason IS NULL)
    OR i.seed_order = 'reels';
