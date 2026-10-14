# Shared queue (lean): the night makes what you promote (2026-10-14)

**Status:** design approved in conversation with Tommy, 2026-10-14 ("lean version"). Awaiting spec review.
**Branch:** `shared-queue`, from `main` at `64b2b8b`, worktree `.worktrees/shared-queue`.
**Follows:** Content page Phase A (PR #7) and Phase B (PR #9, live). Phase B made moves last until used (`social_hub.idea_adjustments.consumed_at`).

## Goal

When you promote an idea, the next overnight run makes it. When you demote one, it doesn't get made ahead of anything else. Fresh ideas found overnight fill every other slot, as today.

## Problem

Only the Stories build reads Promote/Demote today. The reels (1 AM), explainers (2 AM) and carousels (3 AM) workers pick with their own rules and ignore moves, so a promote only changes the page order and Run now/Make it. You rarely promote, so the fix should be small.

## Decisions (settled)

| # | Decision |
|---|---|
| Q1 | Promote = "make this next", still subject to the worker's own checks (reels copy gate, carousel pipeline checks). |
| Q4 | A promoted reel may take the knowledge-lane slot. |
| Q5 | Demote = sinks below every non-demoted idea (not one place down), everywhere: page, Run now/Make it, all four workers. |
| Q6 | The pool tags the promoted idea "Tonight". |
| Q7 | At most **one** promoted idea per type per night; extra promotes wait, **oldest first**. |
| L1 | Lean: no freshness rules or extra checks for promoted ideas beyond what each pipeline already does. If the promoted idea can't be made (gone, held out, already posted/on the calendar), the night skips it and the pool says why. |
| L2 | Cut: pools keep their current score order; mirroring each worker's exact order (penalties, tie-breaks, new/old tiers) is a possible follow-up, not this work. |
| — | No new model calls. Nothing posts without a human Approve or Post now (unchanged). |

## Design

### 1. One shared rule (pure, light module)

New `lib/social-hub/views/moves.ts` (no heavy imports; workers import it):
- `tonightPromote(moves, vertical) → IdeaAdjustment | null`: among active moves for the vertical, the **oldest** idea whose **latest** move is `promote`.
- `demotedIds(moves, vertical) → Set<ideaId>`: ideas whose latest active move is `demote`.
- `applyMoves(ranked, moves)` (replaces today's in `day-rank.ts`): stable order = [tonight's promote] + [everything not demoted, original order] + [demoted, original order]. Other active promotes stay in their score position (they wait their turn).
- `ideaRef(ideaId)` reuse (strip `reels:idea:` / `carousels:story:` / `explainers:topic:` / `stories:pool:<series>:`).

`dayRanking` (page, Run now, Make it) and the Stories build (`lib/stories/build/index.ts` `inDayOrder`) switch to this `applyMoves`. Today's behaviour (latest promote wins #1; demote = swap one place) is replaced; its tests are updated.

### 2. Reels (1 AM)

- `lib/reels/pipeline/slots.ts` `generatePassingReels`: read active moves (`readAdjustments`-style SQL on `social_hub.idea_adjustments`), compute `tonightPromote` and `demotedIds` for `reels`.
- Ordering: in `lib/reels/copy/slots.ts` `orderedForSlots` (the single ordering point for slot fill, fall-through and `rerankSlate`), put the promoted idea first and demoted ideas last; everything else keeps today's `net − penalty` order.
- Lane (Q4): `pool('reserved')` returns the promoted idea first even if it isn't a lane idea, so it takes slot 1. A promoted idea that misses the gate falls through like any general idea (penalized, next idea).
- Not on tonight's slate (an older idea): add it to tonight's slate by copying its latest stored `idea_scores` row (no re-scoring, no Jev call), origin `carryover`. If it no longer exists, is held out (published, teaser, wide-miss) or was placed by a person, skip it and record the reason (see §6).

### 3. Explainers (2 AM)

- `lib/explainers/ideas/cycle.ts` `runIdeaCycle`, after `fillCandidates(...)` (`lib/explainers/publish/schedule.ts`) and before `.slice(0, fill.making)`: reorder with the shared rule (promoted topic first, demoted last).
- `trimPool` must not cut the promoted topic (exempt it).
- A promoted topic that isn't in `fillCandidates` (not `pool`, or a surviving render already handled) is skipped with a reason.

### 4. Carousels (3 AM)

- `scripts/social_worker.ts` (scheduled run only): read tonight's carousel promote; pass it as a new `--promote-id <story id>` to `scripts/social_daily.ts` (distinct from `--story-id` pinning, which stays as it is for Run now/Make it).
- `scripts/social_daily.ts`: keep fresh fetching, selection and the daily-fill check. Load the promoted story with `loadPinnedCandidates` (`lib/social/overnight/pinned.ts`) and put it ahead of the fresh candidates (score above every fresh score, dedupe by id); `targetPosts` stays the usual count, so it takes one of the night's posts. Demoted story ids get scores below every other candidate.
- Existing guards still apply (`storyOnCalendar`/`storedPostFor` in `runDay`). If `loadPinnedCandidates` can't find it (older than its lookback), skip with a reason.

### 5. Stories (4 AM)

Already reads moves (`activeStoryMoves`). Only change: it uses the shared `applyMoves` (one promote first, demoted last). Consumption by pool use is unchanged.

### 6. Marking a promote used, and "can't be made"

- **Used:** when a worker makes the promoted idea, it sets `consumed_at` on that move (same narrow `UPDATE … WHERE id = $1 AND consumed_at IS NULL`). The hub's own consumption (Phase B) stays as a second path.
- **Can't be made:** when a worker skips a promote, it records why on the move itself: two new columns on `social_hub.idea_adjustments`, `skip_reason text` and `skipped_at timestamptz` (overwritten on each skip). The move stays active (you can demote or leave it).

### 7. The page

- The pool and the type page show the promoted idea first with a **"Tonight"** tag (the one `tonightPromote` picks). Other active promotes show "Promoted · waiting".
- If the move's `skipped_at` is from the last night's run, the tag reads "Can't be made: <reason>" instead.
- Demoted ideas sit at the bottom with "Demoted".
- Pool order otherwise unchanged (L2).

## Build order

1. Shared rule module + tests; switch `dayRanking` and the Stories build to it.
2. Schema: `skip_reason`, `skipped_at` on `social_hub.idea_adjustments`; worker helpers to read moves, mark used, record a skip.
3. Explainers ordering.
4. Reels ordering (+ older idea onto tonight's slate).
5. Carousels `--promote-id`.
6. Page tags.

## Deploy

Schema first (`node scripts/apply_social_hub_schema.js --apply`), then the web PR, then `./scripts/gcp/deploy-social-worker.sh`, daytime only (never 12:30–5 AM ET; avoid ~7:30 AM). Every order is safe: workers that can't read moves or the new columns fall back to today's behaviour.

## Testing

Offline only (PGlite, stubs): the shared rule (oldest promote, one per night, demote sinks, latest move wins per idea); each worker's ordering with a promoted and a demoted idea; reels older-idea slate copy with no model call; carousels promote + fresh combined, dedupe, fallback when not found; consumption and skip rows; page tags. No live model calls; Tommy checks one real promote on the live app the next morning.

## Out of scope

- Exact worker order on the pools (L2).
- Freshness or extra safety checks for promoted carousel stories beyond existing guards (L1).
- Changing how many posts a night makes.
