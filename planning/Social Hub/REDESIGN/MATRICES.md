# Social Hub: lifecycle state matrix and action matrix

The source of truth for how every piece of content looks and what a person can do with it (DESIGN.md "The Quiet State Rule"; plan discipline rule 2). Screens render state and actions only from this file's mapping, through `lib/social-hub/views/*` and `actionsFor()`; a test pins the mapping (`tests/social-hub-viewmodels.test.ts`).

Edit this file to change a label, icon, or which action is primary. Anything marked **needs backend** isn't exposed by the hub's data yet.

## 1. State matrix

One row per state a person can see. The badge is an icon plus a word in Muted Ink unless the row says otherwise. Color is reserved for **Needs you** (Signal Orange Ink on Signal Orange Wash) and **Failed** and **Late** (Failed Ink on Failed Wash).

| # | State (badge word) | Icon (Lucide) | When (data) | Secondary line | Color |
|---|---|---|---|---|---|
| S1 | In production | `Loader` | Generation running or queued for an item today (run/job `requested`/`running`, Stories `requested`/`building`) | "Making now · started 3:04 AM" | none | 
| S2 | Ready | `CircleDashed` | `status = ready`, approval not required or already given, no slot yet | "Made 3:40 AM · not scheduled" | none |
| S3 | Needs you | `Hand` | `status = ready` or `scheduled`, `approval.required`, no `approvedAt`, and something here can act on it (an enabled action or a review link) | "Approve within 2 h" (scheduled, under two days off; else "Approve by Sat 9:00 AM") or "Made today 7:00 AM · approve to schedule it" (ready) | Needs you |
| S3b | Approval off | `Hand` | S3, but every action is switched off and the type has no review page of its own (Carousels while `approveCarousel` is off) | "Approving here is turned off · slot tomorrow 7:11 AM" | none (critique 2026-10-08: orange only where a person can act) |
| S4 | Needs you · last try failed | `Hand` | S3 or S2 plus `tries[0]` failed/cancelled | "Last try failed: <note>" | Needs you |
| S5 | Slot booked | `Clock` | Trial Reels `reels:idea:<id>` post: slot exists, no video yet | "Video renders tonight · posts 9:23 AM" | none |
| S6 | Approved | `Check` | Approved, waiting for a slot (Explainers verdict approved, not yet scheduled) | "Waiting for the next open slot" | none |
| S7 | Scheduled | `Clock` | `status = scheduled`, approved (or approval not required), slot still ahead | "Posts in 47 m" (under 12 h) or "Posts tomorrow 9:23 AM" | none |
| S7b | Late | `ClockAlert` | `status = scheduled` and its slot has passed without a post | "Was due 11:59 AM and hasn't posted yet" | Failed (never "Scheduled · slot passed") |
| S8 | Posting | `Upload` | `status = publishing` | "Posting now" | none |
| S9 | Published | `CircleCheck` | `status = published` | metric line: "13.6K views · 211 shares · $1.05" | none (never green) |
| S10 | Failed | `TriangleAlert` | `status = failed` and no newer state | "<reason>" plus "Try again" | Failed |
| S11 | Partly posted | `TriangleAlert` | Stories attempt `partial` (some frames live) | "3 of 5 frames posted · <reason>" | Failed · **needs backend** (not distinct in `HubStatus` today) |
| S12 | Rejected | `Ban` | approval decision `rejected` | "Rejected by Tommy, Oct 8 · won't post" | none · **needs backend** (explainer rejects are dropped from the dataset today; others show as cancelled) |
| S13 | Not approved in time | `CircleSlash` | `status = cancelled` with the not-approved note | "Nobody approved it before its 9:00 AM slot" | none |
| S14 | Skipped | `SkipForward` | `status = skipped` (Stories missed window) | "Missed its window · sets aren't reused" | none |

Rules:
- S1 and S12 need `views/today.ts` and a `rejected`/`partial` state from the lifecycle read (plan A3).
- "Needs you" is a person-facing word for "awaiting approval". Only S3/S4 rows due today or tomorrow, or made and waiting for a slot, count toward the header's orange "N need you"; S3b rows are counted separately ("N can't be approved here yet"), and Later/Older stay in their groups.
- Mid-sentence day words are lowercase ("posts today 3:47 PM"); a line never repeats the clock time its row already shows.
- Times are always New York time, shown as "9:23 AM", never ISO.

## 2. Action matrix

Primary = the one orange button (at most one per item). Secondary = action buttons. Overflow = the "More" menu. A disabled action always shows its reason as visible text under the buttons.

| State | Primary | Secondary | Overflow | Confirm copy (consequence) |
|---|---|---|---|---|
| S1 In production | none | none | none | n/a |
| S2 Ready | Schedule… (place) | none | Publish now, Regenerate, Reject | Publish now: "Post now, skipping the schedule? This counts as approval." |
| S3/S4 Needs you | Approve | Reject | Publish now, Regenerate, Reschedule… | Reject: "Reject? It won't post and its slot opens for something else." Regenerate: "Make a new version? Typical cost $3.52 · $X left in today's cap. The current version is kept in history." |
| S5 Slot booked | Approve slot | Reject | Reschedule… | as above |
| S6 Approved | Schedule… | none | Publish now, Reject | as above |
| S7 Scheduled | none | Reschedule… | Publish now, Regenerate, Reject | Reschedule shows the open slots for that type, with spacing rules applied |
| S8 Posting | none | none | none | n/a |
| S9 Published | none | Open on Instagram | none | n/a |
| S10/S11 Failed | Try again (Publish now) | Regenerate | Reschedule…, Reject | Try again: "Post again now? Quota: 62 of 100 left." |
| S12 Rejected | none | none | Undo reject (if not past its slot) | n/a · **needs backend** (`clearDecision` exists in `lib/social-hub/spine.ts`) |
| S13 Not approved in time | Schedule… | Regenerate | Reject | as above |
| S14 Skipped | none | none | none | n/a |

Per-type availability today vs plan (A1):

| Verb | Carousels | Trial Reels | Explainers | IG Stories |
|---|---|---|---|---|
| Approve | ✓ | ✓ (slot-level) | ✓ | ✓ |
| Reject | ✓ | ✓ | layer ✓, hub links out → **A1: inline with tags** | ✓ |
| Publish now | ✓ | ✓ (force) | ✓ | ✓ |
| Regenerate | **A1: new one-story rerun** | **A1: `requestFinish`, today's video** | ✓ | ✓ |
| Reschedule / place | **A1: `placement.ts`** | **A1** (by `idea_ref`) | **A1** | **A1** (`stories.sets.publish_at`) |

Disabled reasons (visible text, plain language):
- Quota low: "Only 4 posts left in Instagram's 24-hour limit. Publishing pauses below 5."
- Nothing made yet: "Nothing to publish yet. Regenerate first."
- Missed window (Stories): "Story sets that miss their window aren't reused."
- Flag off: "Turned off for now." (no phase names)
