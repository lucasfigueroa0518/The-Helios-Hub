# Calendar look-back: posted posts and their analytics (living plan)

Method: bald-eagle-iteration. Decisions accumulate here; no code until the build stage.
Status: Built and verified offline (Stage 7), 2026-11-14. Waiting on the user's review in the real app.

## The ask (verbatim)
> "If you take a look at the hub, you can see a scrum board. I need to create a feature on the calendar view where you
> can look back and see posts that were posted and see their analytics in a simple click."

## Grounding (read from code; nothing run)
- **The board:** Social Hub Calendar, Week view (the default), `app/social/(hub)/calendar/page.tsx` →
  `components/social-hub/calendar/CalendarScreen.tsx` (WeekScreen) → `WeekBoard.tsx`.
- **The gap:** every past day is folded. `lib/social-hub/views/week.ts:240` sets `folded: past`, and
  `WeekBoard.tsx:686-692` draws only "N posted" for it: no cards, nothing to click. Prev/next week works, but every
  past day in it is folded the same way.
- **Board posts carry no stats:** `slim()` (`CalendarScreen.tsx:96`) sends id, vertical, date, slot, status, name,
  thumb. No metrics, postedAt or permalink.
- **Analytics already exist per post:** `HubPost` has `metrics` (latest), `history` (daily), `permalink`, `postedAt`.
  Source: `social_hub.publish_attempts` + `social_hub.media_insights`, filled by the GCP social worker (no Vercel
  change to fetching is needed).
- **One-click analytics already exist:** `PostLink id=…` opens `PostDrawer` (intercepted route) with `PostView`:
  key metrics vs typical, views per $, all metrics, daily chart, "Open on Instagram".
- **Month view already looks back:** past day → DaySheet → LineupItem → PostDrawer. Two clicks, and Month isn't the
  default view.
- **Cost:** reads only. No Claude API, no `web_search`, no new Instagram calls. Rule 1 and Rule 2 are not touched.

## Decisions (2026-11-14)
- **Scope:** the Social Hub Calendar. User: "two different things completely. Ignore the scrum board bit."
- **Past days:** user: "Think how the week looks now, but those kinda labels for each slotted post become clickable."
  Past days show their posted cards at their times, like the rest of the week. They stay read-only, with no drag,
  edit, select or drop. Slots that went out empty are not drawn.
- **One click:** the existing post drawer (user: "Existing post drawer"). No new analytics UI.
- **Card face:** lead metric vs typical (user: "Lead metric vs typical"): views for reels and feed posts, reach for
  stories, e.g. "3,952 0.8×", or "≈" when about typical. It's the same number and comparison the Month day list
  already uses.
- **Defaults taken (reversible):** posted cards on *today* also open the drawer. A past post whose slot was moved or
  removed (or that has no slot) still shows on its day, at its booked time or else the time it went out (15-minute
  floor). Legend line: "Click a posted post for its analytics · go back a week to look further".

## What was built
- `lib/social-hub/views/week.ts`: past days add posted posts that match no slot (`unslottedPosted`); `BoardPost.postedAt`.
- `lib/social-hub/views/typical.ts`: `leadNumber()` + shared `LEAD_METRIC` (LineupItem now imports it).
- `components/social-hub/calendar/CalendarScreen.tsx`: `slim()` carries `postedAt` and `lead`; published posts without a slot reach the board.
- `components/social-hub/calendar/SlotCard.tsx`: a posted card is a `PostLink` (opens the drawer) showing the lead number.
- `components/social-hub/calendar/WeekBoard.tsx`: past columns render full width with their posted cards; the "N posted" fold is gone.
- `app/social/(hub)/hub-calendar.css`: `.is-past`, `.sh-board__lead`, `.sh-board__vs`, posted hover.

## Verification
- `tsc --noEmit`: 0 errors. `tests/week-board-model.test.ts` + new `tests/social-hub-lead-number.test.ts`: 64/64.
  All social-hub/calendar/week suites: 360/360.
- Full suite: 4 Explainers render tests fail (`explainers-code-frames`, `explainers-render`). They fail the same
  way with this change stashed, so they were already failing.
- Fixture preview (`/social/preview/calendar`): 14 posted cards are links; a click opens the drawer at
  `/social/preview/post/…` with Performance and the daily chart. Screens in `screens/`.
- Cost: reads only. No Claude API, `web_search` or Instagram calls, no DB writes, no worker change (no redeploy needed).

## Mobile pass (2026-11-15)
User: "Is this optimized for mobile?" Checked on an emulated iPhone 14 (fixture preview).
- The post drawer was already fine on a phone: full screen, readable.
- Fixed: the board opened at Monday, so today was off-screen (worse once past days became full columns). It now
  opens scrolled to today when the board overflows; swipe right for past days. A board that fits doesn't scroll.
- Fixed: the hour labels scrolled away sideways. The gutter is now sticky.
- Fixed: cards were 29px tall on touch screens. On `pointer: coarse` the axis is 1250px, so a card is about 44px.
  Desktop is unchanged (29px, no scroll).
- Verified: on the phone the board starts scrolled to today, posted cards are 44px, and a tap opens the drawer.
  Desktop: no scroll, unchanged. `tsc` 0 errors; board + lead tests 64/64.

## Align 2026-11-15: the whole calendar on phones
User: "Seems like the whole calendar isn't optimized for mobile". Audit (iPhone 14, fixture preview):
Week board is the problem (header wraps to 3 rows, drag-in chips fill the first screen and dragging barely works
on touch, 2 of 7 days visible with sideways scrolling, an hour grid that's mostly empty space, 35×19 Trial/Main tags). Slot
panel (already a bottom sheet), Schedules menu, Ready to place, Month, day sheet and post drawer are fine or nearly.

### Decisions (2026-11-15)
- **Phone Week = one day at a time** (user picked "One day at a time"): a Mon–Sun strip (tap or swipe), the
  day's slots as full-width rows (time, type, post name, number when posted). A tap opens details or analytics.
  No hour grid. Desktop unchanged.
- **Editing on phone = look + tap actions** (user picked "Look + tap actions"): no drag-in chips or Select on phones.
  Slot details (move, remove, Trial/Main), Place… and Schedules still work.
- **Default on phone = Week, on today** (user picked "Week, on today").

### Built (2026-11-15)
- `components/social-hub/calendar/DayAgenda.tsx` (new): day strip (Mon–Sun, count per day, today marked, past
  days dashed) + the chosen day's rows in time order. Opens on today. A tap or a sideways swipe changes day. Posted rows
  are `PostLink`s (drawer, with the number). Other rows open the existing `SlotPanel` (bottom sheet). The Trial/Main tag
  is a 36px button.
- `WeekBoard.tsx`: renders `DayAgenda` from the same model (`byDay`), the same `setOpen` and the same `doEdit`, so there's no
  second source of truth. "Ready to place" copy mentions Place….
- `hub-calendar.css`: under 640px the agenda shows, and the grid, drag-in chips, Select and key hide. Above 640px
  (desktop, iPad) nothing changes.
- Verified (iPhone 14 emulation, fixture): no sideways page scroll; opens on Thu (today); swipe → Wed; slot details
  open as a bottom sheet; a posted row opens the drawer; past rows in time order; no page errors. Desktop + iPad Mini:
  agenda hidden, grid as before. `tsc` 0 errors; calendar/social-hub/slots suites 610/610.
- Not changed: Month view (already fits), day sheet and drawer (already good).
