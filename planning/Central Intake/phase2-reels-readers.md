# Phase 2: readers of Reels idea content (Owner E's file list)

From a read-only map of main c9589d8 (2026-11-10). Owner E moves each reader below that joins `reels.post_idea_members`
or `reels.sources` for an idea's content onto `reels.idea_sources_v` (PHASE2-CONTRACT.md). Readers of only
`score_slates` / `idea_scores` / `idea_copy` need no change: those tables stay, keyed by the idea id (= intake story id).
Verify each against the code; this list may be incomplete. Anything not listed here and not in Owner B's files: tell the lead.

Owner B owns (not E): `lib/reels/pipeline/**` (claim.ts loadGates/claimNextRankedJob/claimNextSongByRank, fill.ts
reusableVideos, order.ts ideaRankOrderBy, ingest/grouping/scoring), `lib/reels/repository.ts`, `lib/reels/seeds.ts`,
`lib/reels/seed-search.ts`.

Not changed (legacy path readers, used only when a type's switch is 'legacy'): `lib/stories/sources/reels.ts`,
`lib/lfd/sources.ts` reelsLane, `scripts/intake/replay.ts` (Owner A).

## Social hub
- `lib/social-hub/queries/reels.ts` readReels: REEL_IDEAS_SQL, REEL_FACTS_SQL, REEL_SLOT_VIDEO_SQL, REEL_SOURCES_SQL
- `lib/social-hub/queries/costs.ts` (slates/runs only; check)

## Content type and Text on Screen
- `lib/content-type/idea-queue.ts` isUnscoredSeed
- `lib/revisions/descriptions/text-on-screen.ts` checksFor (readReel/lockOf/save use idea_copy/locks only; check)

## Reels app and pages
- `lib/reels/health.ts` loadHealthPage, describeLiveRun
- `lib/reels/analytics/performance-store.ts` loadPublishedReels
- `lib/reels/insights.ts` loadReelsInsights
- `lib/reels/overview.ts` and `lib/reels/scoring/store.ts` (listSlateDays/loadSlate/loadSlates; check for member/source joins)

## Reels writer, frame and publish stages
- `lib/reels/copy/store.ts` loadCopyTargets, loadEarlierLines, loadSlatesCopy
- `lib/reels/copy/held-out.ts` loadPublishedStoryKeys, recentPublishedHeadlines, loadWideCopyMisses
- `lib/reels/visual/run.ts` loadTarget; `lib/reels/visual/video-run.ts` loadVideoTarget
- `lib/reels/music/pick.ts` loadPickTarget, songPickConflict; `lib/reels/music/publish.ts` publishReadiness;
  `lib/reels/music/store.ts` okPicksForAssignments
- `lib/reels/publish/schedule.ts` (check for member/source joins)
- `lib/reels/review.ts` REVIEW_VIDEOS_SQL, loadReviewClips, loadReviewCueTargets

## Meme lab
- `lib/memes/lfd-source.ts` listCandidates (intake lanes when the 'lfd' switch is 'intake')
- `lib/memes/lfd-sim/api.ts` replayDays, `lib/memes/lfd-sim/fill.ts` fillStories, `lib/memes/lfd-sim/run.ts`

## Scripts
- `scripts/reels_copy_preview.ts`, `scripts/reels/probe-sources.ts` (dry tools; move to the view where they read content)
