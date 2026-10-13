# Content page: show what was made, act on it from the card (2026-10-13)

**Status:** design approved in conversation with Tommy, 2026-10-13. Awaiting spec review.
**Branch:** `unify-social-hub` (no new branches; the 8 uncommitted files already here, the "to approve today" header work, are folded in).

## Goal

Content (`/social`) is the morning check. A person opens it, sees exactly what the night made for today, and approves, schedules, fixes or rejects each piece **from its card** without opening each post. Success: the morning can be cleared without leaving the page, and the page never says "not made" about content that exists.

## Problems this solves

1. **Content that exists is shown as "Not made yet."** The page (`lib/social-hub/views/day-rank.ts`) fills each type's slots from the top of its idea ranking and looks for content attached to *those* ideas. The workers pick their own ideas overnight. When the picks differ, the made content is invisible and Run now offers to pay for another one. On Oct 13, Text on Screen reels and an explainer were made for non-#1 ideas. `8036451` (explainers) and `31b069e` (reels with a booked slot) patched two cases; carousels, stories, and reels without a booked slot are still exposed.
2. **Promote/Demote don't steer the night.** Moves are keyed to today's `ny_date` and expire at midnight, before the 1–4 AM run. Only the Stories build reads them; the reels, carousels and explainers workers ignore them.
3. **The page lags the backend.** The hub dataset is cached for 60 s (`lib/social-hub/views/cached-dataset.ts`). Actions revalidate it; worker activity doesn't. The run poller (`RunsRefresh`) redraws from the stale cache, so finished content can read "Being made" or "Not made yet" for up to a minute.
4. **Actions are hard to reach.** They live on the post page and in a ranked primary/secondary/More menu. The Content cards have none.
5. **Redundant or misplaced controls.** Reject and Delete end in nearly the same state. Promote/Demote rank tags show on made posts. "Numbers last refreshed" (analytics freshness) shows on Content because the shared hub page renders it everywhere. The "N need you" / "other drafts" dropdowns duplicate what the cards will show.

## Decisions (settled; don't relitigate)

| # | Decision |
|---|---|
| D1 | **Made content wins** on every type. Content made for today is displayed ahead of the ranking. |
| D2 | **The backend records the decision.** Every worker books its slot (`social_hub.schedule`, `source = 'auto'`) the moment content finishes, as Text on Screen reels already do. The page reads slots first. D1 stays as the fallback beneath it. |
| D3 | **One shared queue for making.** Every worker, Run now and Make it pick the next idea from the same ranking the page shows, Promote/Demote included. |
| D4 | **Promote/Demote last until used:** until the idea they touched is made or rejected, not until midnight. They live in the idea pools only, never on made content. |
| D5 | **Reject** = the post never goes out, leaves today's cards, and frees its slot. It does not auto-make a replacement. **Delete is removed** (merged into Reject). |
| D6 | **Regenerate** = a new version of the same idea. Kept. |
| D7 | **Unschedule is kept:** take a scheduled post off the calendar and withdraw its approval, without killing it (e.g. 9:00, post due 9:15, unsure). |
| D8 | **No failure-reason UI.** Runs are expected to succeed 10/10 (that work is in `docs/superpowers/plans/2026-10-13-overnight-reliability-plan.md`). The one exception: a card whose run ended empty says "Run didn't finish", never "Not made yet". |
| D9 | **Make it**: a per-card individual run for "Not made yet" cards, with a cost estimate and confirmation. |
| D10 | Leftover drafts (made, not on today's cards) are **not shown on Content**. They live on each type's page. |
| D11 | **Guardrail:** nothing posts without a human Approve or Post now, unless a human has explicitly switched that type to auto-publish (none are, today). A worker booking a slot is **not** an approval. |
| D12 | **Today only.** Content timeliness is the value, so the tomorrow look-ahead is removed, and Schedule/Reschedule offer only today's remaining windows. With none left, the picker says so; the choices are Post now or Reject. |
| D13 | **Rank tags only on "Not made yet" cards.** Made cards show type · time; where an idea sat in the queue no longer matters once it's made. |

## Design

### 1. What goes on today's cards (data)

For each type with a quota (reels, carousels, explainers) and each Stories series due today, the cards come from, in order:

1. **Booked slots:** `social_hub.schedule` rows for today in `scheduled | publishing | published`, by `publish_at`. The card shows that content at that time.
2. **Made today, unbooked (fallback, D1):** content of that type with `generatedAt` today (NY time), ready with media, not rejected/deleted, not already in a slot. Newest first, up to the remaining quota. The card reads **"No slot yet"**.
3. **Being made:** a run in flight for that type fills the next card with its progress chip.
4. **The queue (D3):** the top remaining ideas from the shared ranking, as **"Not made yet"** cards, or **"Run didn't finish"** when a run for that card started today and ended with no content.

A type never shows more cards than it has slots. Extra made content stays on the type's page (D10). Stories keep their series-per-slot rule.

`quotaCandidates` in `day-rank.ts` is rewritten to these four steps and loses its explainers-only branch. Run now's plan (`lib/social-hub/run-today.ts`, `planFrom`) reads the same candidates, so it never offers to make a card that has content.

**Shared queue (D3, D4).** One ranking function (today's `dayRanking`: score order, then moves applied in order) becomes the only idea picker:
- The page and Run now/Make it already use it.
- The **reels, carousels and explainers** workers switch their idea pick to it. Stories already read `idea_adjustments`; they switch to the until-used rule.
- `social_hub.idea_adjustments` stops being day-scoped. A move is **active** until its idea is made (a content item exists for it) or rejected. Add `consumed_at timestamptz` and set it when the idea is made or rejected. `ny_date` stays as a record of when the move was made but no longer filters. Active moves apply in `created_at` order.

**Slot booking (D2).** The carousels, explainers and stories workers, on finishing content, register it in `social_hub.content_items` (if not already) and insert a `social_hub.schedule` row for the day's next open window (`source = 'auto'`, `status = 'scheduled'`), the way reels do today. The unique indexes already prevent double-booking a window or an item. If no window is open, the content is still made and shows through the fallback (step 2).

**Guardrail check (D11), before Phase B ships:** confirm and test, for every type's publisher, that a `scheduled` row with no `approvals` row (or a `rejected` one) never posts, unless that type's auto-publish switch is on. Any publisher that doesn't enforce this gets fixed first.

### 2. The cards and the header (UI)

**Header** (`ContentScreen.tsx`, `PageHead`)
- Remove `RefreshNote` from Content. Keep it on Analytics, Calendar and the post page.
- Meta line, plain text: **`2 of 6 slots filled · 4 to approve`**. Remove the `WaitingMenu` "other drafts" dropdown, the "to approve" anchor-button styling, and the tomorrow/later/parked counts from the meta line.
- **Remove the tomorrow look-ahead** (D12): the ◀ ▶ day arrows, the "N for tomorrow" count, the `?look=tomorrow` param and `lib/social-hub/views/look-ahead.ts`. The title is always "Today".
- Settings and Run now are unchanged.

**Today's Content row** (`TodayStrip.tsx`)
- One row that fills the content width: cards share the width equally (CSS grid, `repeat(n, minmax(0, 1fr))`). Below a minimum readable card width (~170 px) the row side-scrolls instead of shrinking.
- Each media keeps its real shape (carousels 4:5, everything else 9:16), so carousel cards are shorter. Each card is a column with the actions pinned to the bottom (`margin-top: auto`), so the button rows line up across the row.
- Order: booked slots by posting time, then "No slot yet", then being made, then "Not made yet" / "Run didn't finish".
- Rank tags (`#1 · Promoted`) come off made cards. They stay on "Not made yet" cards, where the queue order is the information.

**Previews** (a client component per card)
- **Video** (reels, explainers): plays muted on hover; pauses and resets to the start on leave. A speaker icon at the bottom-right toggles sound. On touch screens, tap plays or pauses.
- **Slides/frames** (carousels, stories): left/right arrows and slide dots on hover; arrows change the slide in place and never navigate. Swipe on touch screens. The slide count badge stays.
- Clicking the media itself (not an arrow, speaker or button) opens the post page, as now.
- Videos load `preload="metadata"`. Nothing plays until hovered.

**Buttons by card state** (labels as shown; one row of primary + a labeled 2×2 grid, per the approved mockup "B, fitted into one row")

| Card state | Buttons |
|---|---|
| Needs you | **Approve** · Schedule *or* Reschedule · Post now · Regenerate · Reject |
| Approved / scheduled | Reschedule · Unschedule · Post now · Reject |
| Failed to post | **Try again** · Reschedule · Reject |
| Being made / posting | progress chip only |
| Posted | Published badge + "View on Instagram" link |
| Not made yet / Run didn't finish | **Make it** |

- "Schedule" when the post has no slot, "Reschedule" when it has one; both open the existing slot picker, **limited to today's remaining windows** (D12). With none left, the picker says so.
- **Approve** on a card with a slot approves it for that time. On a "No slot yet" card it books the next open slot and approves it in one click (today's carousel "Approve and schedule" behavior, for every type).
- **Unschedule** frees the slot and withdraws the approval; the card returns to Needs you.
- **Confirm first:** Post now, Reject, Regenerate, Make it (with its cost estimate). One click: Approve, Schedule, Reschedule, Unschedule.
- "Publish now" is labeled **Post now** on cards to fit.

**Action model changes** (`lib/social-hub/views/actions.ts`, `lib/social-hub/house.ts`, `lib/social-hub/flags.ts`)
- `actionMenu` keeps deciding *which* actions a state offers. The primary/secondary/More ranking is replaced, for cards, by the fixed per-state lists above. The post page's `ActionBar` can keep its layout but offers the same set.
- Remove `delete` everywhere: the action, its flag, its route (`app/api/social-hub/actions/delete`), and its button. Reject's handler takes over Delete's "leaves the hub's lists, slot opens" effect where Reject didn't already (`content_items.deleted_at` stays as the hide mechanism).
- Add a **make** action for "Not made yet" cards: `POST /api/content-type/run-today` scoped to one card's step (`stepsFor` already filters a plan). The server re-plans before starting and does nothing if that card has content.

### 3. Keeping the page in sync

- **After a click:** the button shows a spinner, then the card shows the outcome inline ("Approved · 9:00 AM", "Rejected") and the page refreshes. If the route refuses, the card returns to its prior state and shows the route's `note`. The existing `ActionBar` already returns route notes.
- **When a run finishes:** when `RunsRefresh` sees the in-flight set change, it calls a small route that revalidates `HUB_DATA_TAG` **before** `router.refresh()`, so new content appears within one poll (5–8 s), not after the 60 s cache.
- **Idempotency:** Make it and Run now re-plan on the server. Approve on an approved post, and Reject on a rejected one, are no-ops. Double clicks and two tabs never double-spend or double-post.

## Build order

**Phase A: page only** (Vercel; no worker changes)
1. `quotaCandidates` steps 1, 2 and 4 (made today wins for every type; booked slots first).
2. Header changes; `RefreshNote` off Content; `WaitingMenu` removed; tomorrow look-ahead removed; slot picker limited to today.
3. Card row layout, ordering, previews (hover-play, speaker, arrows, dots, touch).
4. Per-state card buttons; Delete removed; Make it.
5. Cache revalidation on run finish; inline action outcomes.

**Phase B: backend records the decision** (GCP VM redeploy via the social worker deploy script; daytime only, never 12:30–5 AM ET)
1. Publisher guardrail check (D11) for every type, with fixes first.
2. Carousels, explainers and stories workers book their slot on finish.
3. Shared queue: reels, carousels and explainers workers pick through the shared ranking; `idea_adjustments.consumed_at` and the until-used rule (stories included).
4. "Run didn't finish" state. Source: each type's run progress rows (`/api/content-type/progress`), which the page already reads but filters `failed` out of. Stop filtering, and match today's failed run to its card (by idea, or by type for Stories series). First check which types' progress rows cover **overnight** runs and not only hub-started ones; add worker-side recording only where missing. Until Phase B, empty cards read "Not made yet".

## Testing

No automated test calls the live Claude API or `web_search`.

- **Offline unit tests (`day-rank`):** booked slot shown at its time; made-today unbooked fills an empty slot; the wrong idea made still shows; nothing made gives "Not made yet" from the queue top; more made than slots shows only the quota; a rejected post leaves and its slot falls back to the queue; Stories series rule; moves apply until consumed and stop after.
- **Unit tests (`actions`):** the button list for every card state; Schedule vs Reschedule naming; Delete absent.
- **Workers:** slot booking and shared-queue picking tested with stubbed model steps; the publisher guardrail tested on fixtures (scheduled + no approval = no post).
- **Manual, by Tommy in the browser:** hover-play and sound, arrows and dots, every button on real cards, and one real Make it clicked by him.

## Out of scope

- Run reliability (retries, Free vs. Paid, alerts, scoreboard): `docs/superpowers/plans/2026-10-13-overnight-reliability-plan.md`. The slot rows from Phase B are the same data that plan's scoreboard reads.
- Turning on auto-publish for any type.
- The idea pools and Libraries sections below the cards (unchanged).
