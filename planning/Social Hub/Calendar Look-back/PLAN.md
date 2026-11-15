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
