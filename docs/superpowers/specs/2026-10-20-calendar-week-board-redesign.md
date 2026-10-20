# Calendar week board redesign

**Date:** 2026-10-20 · **Branch:** `unify-social-hub` · **Decided by:** Tommy (for Lucas)
**Builds on:** `docs/superpowers/specs/2026-10-14-weekly-slot-calendar-design.md` (the slot model, the `slot_source` switch, booked-post safety)
**Approved prototype:** `docs/superpowers/specs/assets/2026-10-20-week-board-prototype.html`. Open it in a browser; it's the reference for look and behavior. Sample data only.

## Why

Lucas's ask, in his words via Tommy: the Calendar should let us manage **which content types go out on which days**, and **whether reels post as Trial reels or to the main feed**. It should be a super intuitive scheduling and slot management experience. He wants to **drag** content onto days, **slot it between** other posts, and feel **in control**.

The week view built last week works, but it reads like a timetable. It's a dense grid of identical pills, edited through popups, with each type locked to fixed windows. When Tommy tried to move an Explainer to noon, he couldn't. This redesign changes how the week looks and how you edit it. It also makes slot times free, so a post can go at any time.

## Goals

- Open the Calendar, see the week already filled in, and understand it at a glance.
- Change the week by **dragging**: add a type, add a ready post, move a slot to another day or time, remove a slot.
- **Any slot can go at any time of day**, not only inside a type's usual window.
- Trial / Main feed is visible on every reel slot and flips in one click.
- Every change is easy to undo, and it's clear whether it applies to one date or every week.

## Non-goals

- The **month view** stays as it is. A visual cleanup comes later, separately. Tommy: "the three-month view is actually pretty good."
- No new content types and no changes to how posts are generated.
- No analytics or performance data on the board.
- No approval workflow on the Calendar. Approvals stay on the Content page ("Needs you" was cut).

## Anti-goals (would make this a failure even if it works)

- A wall of text or pills that needs explaining before it makes sense.
- Edits that feel stuck, where the board refuses a move without saying why or offering what's possible.
- Anything that quietly changes a booked post, or posts something nobody approved.
- Drag that feels laggy or slippery, landing somewhere you didn't mean.

## Decisions (made in the conversation)

| # | Decision |
|---|---|
| 1 | **Direction A, the week board.** Seven day columns. Direction B, a table of types by days, was rejected ("that looks awful"). |
| 2 | **Each day column is a timeline from 8 AM to 9 PM.** Faint hour lines, a time gutter on the left, and slots placed at their time. Tall columns are filled by the day itself. |
| 3 | **One line per slot**: time · type dot · short name · booked mark · Trial/Main tag. White cards with a clear border, light type tint and a soft shadow. Type color appears only in the dot and the tint. |
| 4 | **Times are shown on every slot.** Tommy: "the times are important." |
| 5 | **Free times.** A slot can sit at any time on any day, snapped to 15 minutes. This replaces the fixed-window model in the 2026-10-14 spec (see §Backend). |
| 6 | **Usual windows are hints, not rules.** While dragging, each type's usual windows show as faint bands. Dropping within about 20 minutes of a usual start snaps to it ("1:00 PM · usual afternoon"). Dropping anywhere else is allowed and marked "outside usual window". |
| 7 | **Ghost preview while dragging.** A dashed card the size of a real slot, labeled with the type, shows exactly where it will land, with the time in a tag above. The dragged card fades out. Movement is smooth, not rebuilt on every mouse move. |
| 8 | **The drag row sits on top**: "Drag in: Text on Screen · Explainer · Carousel · Last Few Days · Morning Download · Guess the Number · Free vs. Paid". Dragging a slot back onto this row removes it. |
| 9 | **Clicking a slot opens a details panel beside it**, floating above everything and never under the next day's cards. It flips to the left for the last days of the week. It shows: what it is and when; status in plain words; the post if one is made (title, preview, Open post); a Trial / Main feed toggle with one line on what each means; where it comes from (the standard week, or changed for this date with Reset day / Make this every <weekday>); Move to another day; Remove. It closes on an outside click or Esc. |
| 10 | **Status copy** for a slot with nothing made yet reads "Empty for now. The 3 AM run makes it on Wed Oct 21.", using each type's real run hour (Text on Screen 1 AM, Explainers 2 AM, Carousels and LFD 3 AM, Stories 4 AM). The old "Fills tonight" wording is gone. Other states: "Made, waiting for your approval", "Ready and approved", "Posted", "Already started". |
| 11 | **Scope after each change:** a toast says "… Just this date." with **Make it every <weekday>** and **Undo**. Days that differ from the standard week show **Edited** with **Reset**. A **Standard week / This week** tab switch edits the pattern directly. |
| 12 | **Past days fold** into a slim "N posted" column. Today's slots that have already started are locked 🔒. Dropping at a time that's already passed today moves to the next 15 minutes. |
| 13 | **The only hard rule is no Carousels on a Last Few Days day.** Adding Last Few Days to a Carousel day asks first and removes that day's Carousels. A Carousel dropped on a Last Few Days day is refused, with the reason. |
| 14 | **Booked posts ask before moving**: "Move it back to ready" or "Keep it", as in the 2026-10-14 spec. |
| 15 | **Two panels under the week: Ready to place and Gaps and warnings.** "Needs you" and "Next week" were cut. |
| 16 | **Ready to place** lists posts that are made but have no slot. Each is draggable onto any day and time and becomes a slot holding that post, still needing approval. |
| 17 | **Gaps and warnings** lists, each with a fix button where one exists: a day with no Explainer; a day with no Stories; a day with fewer slots than its standard weekday; a slot outside its type's usual window; and **feed posts less than 30 minutes apart** (Main-feed reels, Carousels, Last Few Days; Stories and Trial reels are exempt, per D33). |
| 18 | **No per-day limit on the board, a hidden safety cap in the runs.** The old limit of one post per window per type goes away. Each type gets a daily cap the overnight runs never exceed (see §Safety cap). |
| 20 | **Posting drift of up to 15 minutes.** A post goes out at a random minute between its slot time and 15 minutes after it (12:00 slot → 12:00–12:15), as today's windows do. The card shows the slot time. |
| 21 | **The 30-minute gap between feed posts stays as it is.** |
| 22 | **Stories can post more than once a day,** e.g. a second Morning Download in the afternoon. Each Stories slot is its own set. |
| 19 | **Roomy layout.** The board fills the window height, with about 40 px slot rows and 14–15 px names. Every name fits at laptop width (short names: Text, Explainer, Carousel, LFD, Morning Dl, Guess #, Free/Paid; full names in tooltips and the details panel). |

Usual windows (defaults and hint bands):

| Type | Default times | Usual windows |
|---|---|---|
| Text on Screen | 8:45 AM, 11:15 AM, 6:00 PM | 8:45–10:00 · 11:15–12:30 · 6:00–9:00 PM |
| Explainer | 1:00 PM, 3:30 PM | 1:00–2:30 · 3:30–5:00 PM |
| Carousel | 9:00 AM, 2:30 PM | 9:00–10:00 · 2:30–3:30 PM |
| Last Few Days | 9:00 AM (Tue, Fri) | 9:00–10:00 |
| Stories | 8:30 AM (Morning Download daily; Guess the Number Mon, Thu; Free vs. Paid Tue, Sat) | 8:30–10:00 |

## Safety cap

| Type | Default per day | Cap per day |
|---|---|---|
| Text on Screen | 3 | 5 |
| Explainers | 2 | 3 |
| Carousels | 2 | 3 |
| Last Few Days | 1 (Tue/Fri) | 1 |
| Stories, per series | 1 | 2 |

- **On the board:** while dragging, a day at its cap for that type shows "At the daily limit for Explainers (3)" on the drop preview. Dropping is still allowed, and Gaps and warnings flags the extra slot: "Wed has 4 Explainers; only 3 will be made."
- **In the runs:** the nightly run makes posts for that day's slots in time order, up to the cap. Slots over the cap stay empty, and their details say "Over today's limit, so nothing is made for this slot."
- **Changing caps:** a setting on each content type's page, next to its other switches. It shows the cost of one more post per night. Changing it is a person's decision, never automatic.

## Backend: what free times change

The 2026-10-14 build keys a slot by `(vertical, window_id)`, and every scheduler books inside that window at a random spaced minute. Free times mean:

- **A slot has a start minute instead of a window id**, in `slot_template`, `slot_override` and the bookings in `schedule`. `slot_template` and `slot_override` exist in production but are **empty**, and `slot_source` is `'legacy'`, so they can be reshaped without migrating data. Bookings made in legacy mode keep their window `slot` ids.
- **One slot per (type, date, time).** Two slots of the same type at the same minute on the same date aren't allowed. Stories key on series as well.
- **Schedulers book from the slot's time** in template mode: a random minute between the slot time and 15 minutes later, with the 30-minute feed gap applied on top. They no longer pick inside a window.
- **Stories:** the set builder makes one set per Stories slot, not one per series per day. Sets carry their slot's time. `stories.sets` and the 4 AM request logic change so that one series can have two sets on one date.
- **Caps:** the nightly fill counts slots up to the type's cap (`quotaFromSlots` capped), and the caps are stored with each type's settings.
- **Feed spacing:** the board warns (decision 17). At booking time the existing 30-minute rule still holds: a Main-feed post that would land within 30 minutes of another feed post is moved later by the smallest amount that clears it, and the slot's details say so.
- **Legacy mode is unchanged.** Everything stays behind `slot_source`, as before.
- **Seeding:** the first Switch on copies today's pattern at the default times above.

## Constraints

- No Claude API, `web_search` or Instagram calls in tests or development (CLAUDE.md). Tests run offline.
- Hub code writes SQL only to `social_hub.*`. The scope test enforces this, and new client fetches are registered there.
- Worker changes ship with `./scripts/gcp/deploy-social-worker.sh`, which Tommy runs.
- Branch hygiene: stay on `unify-social-hub`. No merges, pushes or branch changes without Tommy's say-so.
- **Concurrency:** other sessions commit caption and Stories work to this branch. Stage only your own files.
- The month view and the existing day sheet keep working.
- Must work with mouse **and** keyboard. HTML5 drag doesn't work on touch, so the details panel's Move to and time controls are the keyboard and touch path.

## Left to the builder

- Component structure, the drag library (or native drag-and-drop), and the CSS, using the hub's existing tokens rather than the prototype's colors.
- Exact animation timings, within "smooth, not slippery".
- How the timeline handles slots that collide in time (stacking is fine) and slots very late in the day.
- How to migrate `schedule.slot` for free-time bookings: a time-based slot id, or a new column.

## Must handle (from the prototype bug pass)

The prototype is throwaway, and a read-through found real bugs. The full list is in `assets/2026-10-20-week-board-prototype-bugs.md`. The production build must get these right:

1. **One shared set of placement rules.** Use the same `canPlace` / `place` / `move` / `remove` logic for every entry point: drag, Move to, Ready to place, gap fix buttons and Reset day. In the prototype, the Last Few Days rule was enforced only for tray drags. Dragging an LFD card, or using Move to, left LFD and Carousels on the same day, and two LFDs on one day were possible.
2. **Booked posts are never lost.** Move it back to ready, Remove and Reset day must put the post back in Ready to place, and say what happened to its approval. Reset day asks first when it would touch booked or posted slots. It never touches past or posted slots.
3. **"Now" applies everywhere.** Move to, gap fixes and Ready to place can't create a slot in the past or inside today's started windows.
4. **Stable ids and a real undo.** History records each change as a command, not a snapshot of the screen. Undo is scoped to the tab where the change happened. "Make it every <weekday>" is its own undoable step. "Edited" compares the date against the standard week, not just the order of slots.
5. **Honest timeline layout.** Slots that collide share space side by side in lanes, rather than cascading down and drifting off their times. Late slots stay inside the column. Snapping must still let you reach every 15-minute mark, including times near a usual start, which the prototype's ±20-minute magnet made unreachable.
6. **Keyboard, touch and screen readers.** The details panel's Move to and time picker do everything a drag does. Focus moves into the panel and back to the slot. Every slot has a full spoken label.

## Calls I made (Tommy, please check)

- **Dragging a booked slot moves its post with it,** to the new time or day, like rescheduling today. Only removing a booked slot asks "Move it back to ready" or "Keep it", and Keep cancels the removal.
- **"Make it every <weekday>" applies only the change just made** to the standard week, not the whole edited day. For a move between days, both halves apply.
- **Undo** reverses the last change while its toast is showing. It isn't offered after a change sent a booked post back to ready.
- **Dropping a Ready post books it right away** at the dropped time, still needing approval, through the existing place action. Ready to place is hidden on the Standard week tab, because a post needs a real date.

- **Snap:** 15-minute steps, with a magnetic snap near a usual start, where every 15-minute mark is still reachable (see Must handle §5).
- **Spacing:** the board warns; the scheduler still nudges feed posts 30 minutes apart rather than refusing.
