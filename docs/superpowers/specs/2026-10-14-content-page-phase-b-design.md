# Content page, Phase B: slots, Approve, and honest empty cards (2026-10-14)

**Status:** design approved in conversation with Tommy, 2026-10-14. Awaiting spec review.
**Supersedes:** the "Phase B" section of `docs/superpowers/specs/2026-10-13-content-page-design.md` (D2, D3, D4, and Phase B build order). Phase A of that spec is live (PR #7).
**Branch:** `content-page-phase-b`, from `main` at `ed816d2`, in the worktree `.worktrees/content-page-phase-b` (another session is working on `unify-social-hub` in the main folder).

## Goal

Every card on the Content page tells the truth about its post: when it goes out, whether it still needs you, and why a card is empty. Approve always books a time. Nothing posts without a human Approve or Post now (unchanged).

## What we learned (investigation, 2026-10-14)

- Live settings: `publishing_live = true` and `require_approval = true` for carousels (`social`), reels, explainers and stories; `social_hub.publisher_mode = off` (each type's worker publishes for itself).
- Every publisher already refuses a booked slot with no approval or a rejected one: carousels `lib/social/overnight/schedule.ts:190,194` (cancels), reels `lib/reels/publish/schedule.ts:386-390` (cancels), explainers `lib/explainers/publish/publish.ts:78-82` (**fails** the slot instead of cancelling), stories post only from `stories.sets` status `scheduled`, which a set reaches only from `approved` (`lib/stories/repository.ts` `scheduleSet`, `dueSets`).
- Booking at finish today: reels yes (`scheduleSelectedSlate`, `lib/reels/publish/schedule.ts:252`); carousels yes for scheduled runs (`scheduleRunPosts`, `scripts/social_worker.ts:174-190`; skipped for reruns); explainers only after approval (`scheduleApproved`); stories only after approval (`worker.ts:111-117`).
- Approve today: carousels and reels book a slot; explainers only set the verdict (`lib/publishing/actions/explainers.ts:60-63`); stories only move the set to `approved` (`lib/stories/api.ts:95`).
- No overnight worker except Stories reads Promote/Demote, and each picks ideas with its own rules (reels lane/gate/penalties, carousels fresh-news selection at 3 AM, explainers `POOL_ORDER_BY`). A shared queue is its own project (see Out of scope).

## Decisions (settled)

| # | Decision |
|---|---|
| B1 | Approve books a time immediately on every type. A slot booked by Approve is a **system** booking (`source = 'auto'`), so it never reduces tonight's quota. |
| B2 | Explainers book today's next open window when the 2 AM run finishes a render (`source = 'auto'`, unapproved). It still needs Approve to post. |
| B3 | An explainer slot that reaches its time without approval is **cancelled** (like carousels and reels), not failed. |
| B4 | Stories keep booking at Approve only. A Stories card with no time reads "No slot yet · posts 8:30–10 AM once approved". |
| B5 | Before B2 ships, each type's publisher has tests proving a booked slot with no approval, or a rejected one, never posts (`require_approval` on). |
| B6 | "Run didn't finish" comes from records each type already writes; no worker change for it. |
| B7 | Reschedule works on failed posts (books one of today's remaining windows). |
| B8 | Promote/Demote last until their idea is made or rejected, not until midnight. They steer the pool order, Run now, Make it and the Stories build. They do not steer the overnight reels, carousel or explainer picks (out of scope). |
| B9 | Overnight idea picking for reels, carousels and explainers is unchanged in Phase B. |
| — | Nothing posts without a human Approve or Post now, unless a human has switched a type to auto-publish (Phase A D11, unchanged). |

## Design

### 1. Approve books a time (B1, B4)

- **Explainers** (`lib/publishing/actions/explainers.ts` `approve`): after `setVerdict(…, 'approved')`, book today's next open window via `scheduleJob(db, jobId, 'auto', now, throughDate = today)` (`lib/explainers/publish/schedule.ts:46`). Add the `throughDate` parameter (today it searches two weeks ahead). Wire `scheduleJob` into `liveContentActions` (`lib/publishing/actions/live.ts:65-76`). If no window is left today, approve still succeeds and says "Approved. No window is left today; Post now can still post it." An already-booked job keeps its slot (the slot becomes approved through its `approvals` row).
- **Stories** (`lib/publishing/actions/stories.ts` `approve` → `lib/stories/api.ts:95`): after `approveSet`, if the series window is still open today, `scheduleSet(db, id, pickPublishAt(window, ny_date, now))` in the same transaction (the existing `place` path via `rescheduleSet` already does this). After the window, keep today's message (it won't post; Post now can).
- **Carousels, reels:** unchanged (they already book on approve).
- **Quota:** these bookings use `source = 'auto'` (B1). `lib/social-hub/fill.ts:30-44` counts only `user` slots, so tonight's quota is untouched.

### 2. Explainers book at finish (B2)

- When `runRenderJob` (explainers worker) finishes a render successfully, call `scheduleJob(db, jobId, 'auto', now, throughDate = today)`. Today only; if no window is left, nothing is booked (the Phase A "made today" fallback shows the card as "No slot yet").
- Placement: in `scripts/explainers_worker.ts` / `lib/explainers/ideas/cycle.ts` after a render completes, guarded by `publishing_live` like the other auto bookings. Never call `queuePublish` from this path: booking only.

### 3. Unapproved explainer slots cancel (B3)

- In `releaseDueSchedules` (`lib/explainers/publish/schedule.ts:161-188`), before queueing: if the render's verdict is `rejected`, cancel with the rejected note; if `require_approval` is on and the verdict isn't `approved`, cancel with the not-approved note (same wording as carousels/reels). Only approved (or force) slots reach `queuePublish`. `publishReadiness` keeps its own refusal as a second guard.

### 4. Publisher safety tests (B5)

Offline tests (pglite fixtures, no live calls), one file per type or one combined file:
- carousels `releaseDueSchedules`: scheduled slot + no approval → cancelled, not queued; rejected → cancelled.
- reels `releaseDueSchedules`: same two cases (slot with `approved_at` null and no approval row).
- explainers `releaseDueSchedules` (after §3): same two cases → cancelled.
- stories: a `ready` (unapproved) set with `publish_at` due is never returned by `dueSets`; approve → schedule → due works.
These land before §2 in the build order.

### 5. "Run didn't finish" (B6)

A pure function maps today's run records to cards; the page passes them in. Sources (all existing tables; read-only additions to `lib/content-type/progress.ts` or a sibling read):

| Type | Record | Matches a card by |
|---|---|---|
| Explainers | latest `explainers.jobs` for the topic with status `failed`, requested today | topic → idea |
| Stories | `stories.sets` for today with status `failed` or `skipped` | series |
| Reels | `reels.finish_requests` with status `failed`, today | `post_idea_id` → idea |
| Carousels | `social.runs` `kind = 'daily'` with status `failed` today | type only: every empty carousel card |

Rules: only today's records (NY date) count; a card with content, or a run in flight, never shows it; the line names the reason when the record has one ("Free vs. Paid: skipped, no good pair found"). **Make it** stays on the card. Copy: "Run didn't finish" + reason; carousels: "Tonight's carousel run didn't finish".

### 6. Reschedule on failed posts (B7)

- `lib/social-hub/house.ts` `actionsFor`: offer `place` (labelled "Reschedule" on the card) for a post whose status is `failed`, with the same refs as `place` for `ready`. `placeItem` (`lib/social-hub/placement.ts`) already books a new slot beside the old `failed` row (the item-active unique index ignores `failed`). It books `source = 'user'`, like every other Reschedule: a person moved it. (This differs from B1 on purpose: B1 covers Approve's automatic booking, not a slot a person picks.)
- `lib/social-hub/views/card-actions.ts` failed group: Try again · Reschedule · Regenerate · Reject, with Reschedule now backed by `place`.
- Reject on a failed card: the reject handlers already block re-posting; the card leaves today's row (Phase A rejected-filter).

### 7. Promote/Demote until used (B8)

- Schema (`db/social_hub_schema.sql`, applied with `scripts/apply_social_hub_schema.js`, idempotent): `ALTER TABLE social_hub.idea_adjustments ADD COLUMN IF NOT EXISTS consumed_at timestamptz;` plus an index on `(vertical, created_at) WHERE consumed_at IS NULL`.
- Reads (`lib/social-hub/queries/day.ts readAdjustments`, `lib/social-hub/views/day-rank.ts movesFor`): active moves are those with `consumed_at IS NULL`, any date, oldest first. `nyDate` stays as the record of when the move was made.
- Consuming a move: when its idea is made (a content item exists whose `idea_ref` is the idea's bare ref, via `ideaRef`) or rejected. Done in one place: a small SQL step run when the hub reads moves (mark consumed, then return the rest), so no worker needs to change. Stories: their idea ids are `stories:pool:<series>:<key>`; consumed when `stories.pool.used_at` is set for that key.
- Stories build (`lib/stories/build/index.ts:109-130`) reads active moves instead of today's (its query drops the `ny_date` filter and adds `consumed_at IS NULL`). This is a worker file: it ships with the worker redeploy.
- `recordRankMove` (`lib/content-type/idea-rank.ts:26`) unchanged.

## Build order

1. Publisher safety tests (§4); fix any gap found.
2. Explainers cancel-on-unapproved (§3).
3. Approve books a time (§1).
4. Reschedule on failed posts (§6).
5. "Run didn't finish" (§5).
6. Promote/Demote until used (§7), schema first.
7. Explainers book at finish (§2), last, after 1–2 are proven.

## Deploy

- Database: apply `db/social_hub_schema.sql` (the `consumed_at` column) before either deploy. Idempotent; the Stories build already tolerates the extra column.
- Web: Vercel, via a PR from `content-page-phase-b` to `main`.
- Workers, daytime only (never 12:30–5 AM ET; avoid the 7:30 AM health report window on the social worker):
  - The explainers (§2, §3) and stories (§7 Stories build read) workers run on `helios-social-worker`: redeploy with `./scripts/gcp/deploy-social-worker.sh` (CLAUDE.md, `docs/social-overnight.md`). Confirm whether `scripts/gcp/deploy-explainers-worker.sh` is still the explainers path before deploying.
  - The deploy script refuses a dirty tree; deploy from this worktree, after the branch is merged.
- No new model calls; no spend.

## Testing

All offline (node:test via tsx, pglite fixtures, stubbed model steps): §4 publisher cases; §1 approve books today's window, none left → message, quota untouched (`source = 'auto'`); §3 cancel paths; §5 the run-record → card mapping per type, today-only, never on a card with content or a run in flight; §6 failed card offers a working Reschedule; §7 moves active until consumed, consumed on made/rejected, Stories by pool key. Manual, by Tommy on the live app: one Approve on a no-slot explainer and on a Morning Download set; a failed card's Reschedule if one occurs.

## Out of scope

- **Shared queue** (overnight reels, carousels and explainers picking from the page's ranking, moves steering the night): its own spec. It changes the reels slot-filling rules and the 3 AM carousel selection.
- Booking Stories before approval (B4).
- Overnight reliability (retries, alerts, Free vs. Paid): `docs/superpowers/plans/2026-10-13-overnight-reliability-plan.md`.
- Instagram takedown (dropped 2026-10-13).
