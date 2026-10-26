# Idea Pool Standard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native) to implement task-by-task. Steps use checkbox syntax.

**Goal:** One pool standard (cap 30, pin, drag/placement, always-generatable, archive, top-N queue) across all content types, Explainers first.

**Architecture:** Everything a person does to an idea is a row in `social_hub.idea_adjustments` (new kinds `pin`, `place`, `archive`; `place` carries `sort_key`). One pure module (`lib/social-hub/queue.ts`, type-only imports so workers can use it) turns ideas + rows into the queue order, the cap overflow and the drop key. The hub views, the Content page and every night worker call it; per-type work is wiring and the type's own archive/generate rules.

**Tech Stack:** Next.js (App Router), TypeScript, Postgres (`db/social_hub_schema.sql`), PGlite tests with `tsx --test`, no live model calls.

**Spec:** [docs/superpowers/specs/2026-10-21-idea-pool-standard-design.md](../specs/2026-10-21-idea-pool-standard-design.md)

## Global Constraints

- CLAUDE.md Rule 1 and Rule 2: tests stub the model; no sweeps; Generate and Pin-with-cost show the cost before any spend.
- Cap: `POOL_CAP = 30` open ideas per type (Stories per series); pinned, Yours, Placed and Generated ideas are never dropped.
- Drop key: 0.01 above (drag up) or below (drag down) the neighbour's effective score; midpoint when the gap is under 0.02.
- Placement expires after the type's nightly run completes with auto-render on, or when its idea is made, or after 7 days. Pins last until made/published/unpinned.
- Archive is a soft delete (a permanent `archive` row); a scheduled post is unscheduled first; a published post cannot be archived; no Restore.
- Regenerate on an approved or scheduled post unschedules and unapproves it; the new version is current; older versions are viewable only.
- Worker logic changes redeploy `helios-orch-worker` (`./scripts/gcp/deploy-worker-code.sh`) and `helios-social-worker` (`./scripts/gcp/deploy-social-worker.sh`), daytime only.

## Review Focus

- A drop between two tied scores lands adjacent to the tie, never above both neighbours (test in Task 1).
- A pin or placement on an idea that has left the pool is ignored and does not count toward the cap (Task 1).
- A failed or auto-render-off night leaves placements in force (Task 4).
- Archiving an idea twice, or an idea with no row to archive, is a no-op, not an error (Task 3).
- Generate on an idea whose status is `rendered`, `displaced` or `archived`-adjacent still queues once the human confirms (Task 5).

## Build status (2026-10-21, end of the first build session)

Built and tested offline (no live model calls, nothing deployed, nothing committed):

- **Shared core:** `lib/social-hub/queue.ts` (order, drop key, cap, tags, `orderForNight`, `QUEUE_LIVE`), `queue-store.ts` (pin, unpin, place, archive, expiry), `idea_adjustments` kinds and `sort_key`, `/api/content-type/idea-queue`.
- **Types on the queue (`QUEUE_LIVE`): Explainers, Reels, Carousels, Stories.** Each night worker follows pins, placements and archive; each page shows the new controls and cards (Approve, Regenerate, Archive); Regenerate unschedules and unapproves the version it replaces (Explainers, Carousels, Reels; Stories' set rebuild is unchanged, see below).
- **Explainers extras:** every unpublished topic is generatable; a cap asks "Go over the cap?"; archived topics are history so the proposer does not bring them back; version toggle in the post detail; open-slot tiles on Today.
- **Cap:** Explainers trim and Stories refresh enforce 30 in storage; every queue page shows at most 30 open ideas (Reels and Carousels derive their pools, so the page is where the cap lives).
- **UI:** `PoolQueue` (drag, pin zone), `QueueControls`, `GenerateConfirm`, `PoolList` on `/social/content/pools/<type>`, a link from the Text on Screen page.

Not done, on purpose, each needing a decision or a design pass of its own:

- **Last Few Days** stays on Promote/Demote: its "pool" is the latest post's queue (what it picked and dropped), so a drag has nothing to steer until its selection takes a seed or pin (also deferred in the seeding spec).
- **Stories Regenerate** (rebuild a set) does not yet unschedule the set it replaces.
- **Text on Screen's own page** (`app/reels`) hides archived ideas and links to the queue, but drag and pin live on the pool page.
- **Production:** the schema change (`db/social_hub_schema.sql`: kinds `pin`/`place`/`archive`, `sort_key`) is not applied, and neither worker VM is redeployed. Until both are done the new controls fail safely (the readers fall back) and the night runs as before.
- **Six old tests** in `tests/shared-queue-explainers.test.ts` fail on this branch before and after this work: they test cycle code that lives only on the unmerged `shared-queue` branch.

---

### Task 1: Pure queue module

**Files:** Create `lib/social-hub/queue.ts`, `tests/idea-queue.test.ts`. Modify `lib/social-hub/views/moves.ts` (widen `IdeaAdjustment.kind`, add `sortKey`).

**Interfaces — Produces:**
- `POOL_CAP: 30`
- `type QueueItem = { id: string; score: number | null }`
- `type QueuedIdea<T> = { item: T; rank: number; pinned: boolean; placed: boolean; effective: number | null }`
- `queueOrder<T extends QueueItem>(items: readonly T[], moves: readonly IdeaAdjustment[]): QueuedIdea<T>[]` — drops archived, pins first in pin order (latest `pin`/`promote` row per idea; `demote` ignored), the rest by effective score (latest `place` key, else score; null last), stable.
- `isArchived(moves, ideaId): boolean`
- `dropKey(others: readonly (number | null)[], index: number, up: boolean): number` — `others` = effective scores of the unpinned list without the dragged idea, `index` = insert position.
- `capOverflow<T extends QueueItem>(queued: readonly QueuedIdea<T>[], cap: number, isProtected: (q: QueuedIdea<T>) => boolean): T[]`

- [x] Tests: pins before score; two pins keep pin order; `demote` ignored; place key beats score; archived removed; moves on absent ideas ignored; `dropKey` for 15→5 (above), 5→14 (below), top, bottom, null neighbours, gap < 0.02 midpoint, tie; `capOverflow` drops lowest unprotected only and never protected.
- [x] Implement.

### Task 2: Schema + reading/writing rows

**Files:** Modify `db/social_hub_schema.sql`, `lib/social-hub/queries/day.ts`, `lib/social-hub/moves-store.ts`, `lib/content-type/idea-rank.ts`. Test: extend `tests/social-hub-idea-moves.test.ts`.

**Interfaces — Produces:** kind CHECK widened to `promote|demote|pin|place|archive`; column `sort_key double precision`; `readAdjustments`/`readMoves` return `sortKey`; `recordQueueMove(move, by)` for `pin | unpin | place | archive | reorder` (unpin and a new place consume earlier rows; archive is idempotent); `madeMoveIds` never consumes `archive`; `expirePlacements(q, vertical, {days: 7})` and `markPlacementsDone(q, vertical)` for workers.

- [ ] Tests on PGlite with the real schema file; run `tsx --test tests/social-hub-idea-moves.test.ts`.

### Task 3: Queue API

**Files:** Create `app/api/content-type/idea-queue/route.ts`; test the parser in `tests/idea-queue-api.test.ts`.
Body: `{ vertical, ideaId, action: 'pin'|'unpin'|'place'|'archive'|'reorder-pins', toIndex?, up?, order? }`. Server computes the key from the current queue (never trusts a client key). Archiving a published post refuses; archiving a scheduled one unschedules via the type's existing unschedule action first.

### Task 4: Views and the night read the queue

**Files:** Modify `lib/social-hub/views/pools.ts` (`poolList`), `views/day-rank.ts` (`dayRanking`, `quotaCandidates` no longer prefers made content), `lib/content-type/model.ts`, `lib/explainers/ideas/cycle.ts`, `lib/explainers/publish/schedule.ts` (`fillCandidates`), `scripts/explainers_worker.ts`. Cap enforced in the refill (`trimPool` clamps `pool_size` to 30, exempting pinned/Yours/placed/generated).

### Task 5: Explainers Generate fix + cap override

**Files:** `lib/explainers/repository.ts` (`RENDERABLE`), `app/api/explainers/topics/[id]/generate/route.ts`. Every unpublished status is renderable by click; a cap hit returns `{ ask: 'over_cap', costUsd }` and the confirmed retry carries `overrideCaps: true`, recorded in `cost_events`.

### Task 6: UI

**Files:** `components/content-type/PoolQueue.tsx` (drag rows, pin zone), `GenerateConfirm.tsx`, replace `RankButtons` in `TypeHub.tsx`, chips in `PoolScreen.tsx`; Content-page cards: Approve, Regenerate, Archive (`lib/social-hub/views/card-actions.ts`); Regenerate unschedules and unapproves; version toggle in the post detail.

### Task 7: Other types, one at a time

Reels, Stories, Last Few Days, Carousels: their workers read `queueOrder`, skip archived ideas, expire placements; Stories per series; Carousels attach rows to story ids.

### Task 8: Worker redeploy (daytime) and verification

Typecheck, full `npm test`, then redeploy both VMs per CLAUDE.md.
