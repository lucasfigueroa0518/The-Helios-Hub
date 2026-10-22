# Calendar: type schedules and batch select (design)

Date: 2026-10-21. Owner: Tommy (approves for Lucas). Builds on the week board redesign (`docs/superpowers/specs/2026-10-20-calendar-week-board-redesign.md`, PR #15, merged 2026-10-21; switch still off).

## Why

The week board lets you change one slot on one date. Changing a content type for the whole week means editing every day by hand. Tommy's case: on a Sunday, move every Carousel from 9:30 AM to 11:30 AM, for good, in one step. He also wants one-off changes to several slots at once.

## Two tools, kept separate (Tommy's decision)

1. **Type schedule.** This is the standing routine for one content type, set every week from then on until changed again.
2. **The board.** One-off changes to specific dates. It works as it does today, plus batch select.

The two never blur. The board never changes the standing routine, and the schedule tool never edits single dates.

## 1. Type schedule

**Where:** a "Schedules" settings dropdown in the Calendar header, next to the view controls. The control style is the builder's call, within the hub's Menu and popover patterns. Native `<select>` is banned in the hub.

**Entries:** Text on Screen, Explainers, Carousels, Last Few Days, Morning Download, Guess the Number, Free vs. Paid. Each Stories series is its own entry (Tommy: 4A).

**What a schedule is (Tommy):**
- **Times:** one list of start times, used on every day the type runs. Times sit on the 15-minute grid from 8:00 AM to 8:45 PM.
- **Trial or Main:** set per time, for Text on Screen and Explainers only. Other types don't have this setting.
- **Days:** Mon–Sun checkboxes, for which days the type runs. Weekends post.
- Last Few Days takes exactly one time.

**Rules when saving:**
- **Daily limit:** the list can't be longer than the type's daily limit (Tommy: 1B). The limit stays as a safety cap, set on the type page as today. When the list is too long, the save is refused: "Explainers can post 3 a day. Raise the daily limit on the Explainers page to add more."
- **Same-time feed posts:** a time within 30 minutes of another type's Main-feed time is allowed, with a warning (Tommy: 2B). Example: "Carousels post at 11:30 too. One of them will go out around 12:00." Main-feed types are Main Text on Screen, Main Explainers, Carousels and Last Few Days. Trial reels and Stories don't count.
- **Last Few Days days:** ticking a day for Last Few Days that Carousels also has asks "Wednesday becomes a Last Few Days day. Carousels come off Wednesday." Confirming unticks Carousels on that day (Tommy: 3A). The reverse case, ticking Carousels on a Last Few Days day, asks the same way and takes Last Few Days off. Unticking a day never re-ticks the other type.
- **Duplicates:** the same time twice for one type is refused.

**What changes on save (Tommy):**
- The schedule applies to every week from now on. Today's slots that haven't started yet follow it (my call).
- **Moving booked posts:** posts the system booked by itself (`auto`) on days ahead move to their new times.
  - **Pairing (my call):** times that didn't change stay put, and the remaining old and new times pair up in time order. For example, 9:30 and 12:00 changed to 12:00 and 3:00 PM moves only the 9:30 post, to 3:00 PM.
  - **A Trial/Main change** also applies to the system's own bookings at that time (my call).
- **Removed times and days (Tommy: 2a):** when a time or day goes away, including a day Carousels lose to Last Few Days, posts the system booked there go back to Ready to place automatically. The toast says how many ("2 Carousels went back to Ready to place"). This never blocks the save.
- **Hand-set slots keep their time (Tommy: 1b).** The rest of that date follows the new schedule.
  - **What counts as hand-set:** a slot you changed on a date, a post you placed, and a post you rescheduled or dragged.
  - **Ties to the replaced slot (my call):** a hand edit is tied to the routine slot it replaced, so that slot doesn't come back at its new time on that date.
    - You moved Wednesday's 9:30 to 10:00, and the schedule changes 9:30 → 11:30: Wednesday keeps 10:00 and gets no 11:30.
    - You removed Wednesday's 9:30, and 9:30 → 11:30: Wednesday stays without that Carousel.
  - **System pins** (holding today's started slots) aren't hand-set, and follow the rules above.
- **Clashes with hand-set posts (my call).** A hand-set post is never moved or removed by a schedule save.
  - **Last Few Days days:** if a day becomes a Last Few Days day but has a Carousel you set or placed, your Carousel stays and Last Few Days skips that date. The confirm lists those dates.
  - **Same minute:** if a new time lands on the same minute as a hand-set slot of the same type that day, the hand-set slot wins and the new one isn't added on that date.
- Published posts, and posts already started today, are never touched.
- Booked Stories sets move too. Their time lives in `stories.sets`, so the move goes through the Stories reschedule path.
- **Empty schedules (my call):** a schedule with no times or no days is allowed after a confirm ("Carousels will stop posting."), and turns that type off.

**Undo:** after a save, the toast offers Undo for that save. Undo restores the old schedule, and moves back the posts it moved.

## 2. The board: batch select

- **Select mode:** a **Select** toggle (check mark icon) in the board header turns it on. While on, clicking a card adds it to the selection or removes it, and cards show a check. Dragging is off. Esc, or clicking Select again, leaves select mode and clears the selection.
- **Actions bar:** a small bar appears with the count ("4 selected") and the actions. All actions apply to the selected dates only.
  - **Set time:** one time for all selected cards, using the same 15-minute picker as the details panel. No magnet snap: the picked time is exact.
  - **Trial / Main:** sets the mode on selected reel cards. Cards of other types in the selection are skipped, and the toast says so.
  - **Remove:** removes the selected slots. Booked ones get the "Move it back to ready / Keep it" question once, for all of them.
- **Not included (my call):** "move to another day". With mixed selections it's ambiguous.
- **Same rules as single edits:** locked cards (posted, started, past) can't be selected, and clicking one says why. Rule refusals (Carousel on a Last Few Days day, a duplicate time) skip that card and list it in the toast. They don't fail the batch.
- **Size:** batches of more than 20 changes are split into several saves behind the scenes. That's the API's per-call limit.
- **Undo:** one batch is one undo step.
- Every change in a batch is marked hand-set.

## 3. What goes away (my calls)

- **The Standard week tab.** The type schedules replace it. The standing week still exists underneath (`slot_template`), and the schedule tool is now how it's edited.
- **"Make it every {Weekday}" on the board's toast**, because standing changes now happen only in the schedule tool. "Copy day" goes with it.
- **"Edited" badge and Reset day:** these stay, but are based on hand-set date edits, not on comparing a date to the standard week.

## 4. What the system has to gain (from the audit)

1. **A "set by" mark on every date edit and booking** (`person` or `system`).
   - Board edits, batch edits, placement, reschedule and drags write `person`.
   - System pins (holding today's started slots, a standing move whose target day has passed) write `system`.
   - Bookings made by the overnight run stay `auto`. Rescheduling or dragging a booking marks it as the person's.
   - A date edit that matches the standard week is kept, not deleted, when a person made it.
   - Stories sets need the same signal.
2. **Schedule save as one operation.** It replaces a type's template rows for the checked days, pairs old and new times, moves `auto` bookings (including Stories sets) and skips hand-set ones, all in one transaction. The existing slots API can't do this today: a replace-the-list save returns a 409 on every booked post.
3. **Existing standing weeks** that already have different times on different days for one type get folded into one list when the tool first opens: the union of times, plus the days that have any. The tool tells the user it merged them. Nothing changes until they save. If the merged list breaks a rule (over the daily limit, or one time Trial on some days and Main on others), the tool opens with the problem highlighted and won't save until it's fixed.
   - **No existing marks to backfill:** the slot tables are empty in production (checked read-only 2026-10-21, `slot_source = 'legacy'`), so no hand edits exist yet. New rows get the "set by" mark from the start, and old bookings without a mark count as `system`.
4. **Preview page:** the schedule tool and batch select work in the sandbox, as the board does.
5. **Switch off (`legacy`):** the schedule tool is read-only, with the same notice as the board.

## Non-goals

- Different times on different days for one type.
- Moving slots across days in a batch.
- Changing the overnight run's job hours.
- Anything on the Month view.

## Anti-goals

- **A schedule change moving a post you set yourself.** That's the one thing that would make this feature untrustworthy.
- **Silently making fewer posts than the times listed.** That's why the daily limit refuses the save.
- **Silently making more posts than the limit,** which means more spend.

## Left to the builder

- Exact layout of the dropdown, schedule form and actions bar, within the hub's tokens and components.
- The migration shape for the "set by" mark, as long as it is additive and safe in either deploy order. The 2026-10-20 redesign's rule R3 still applies.
- How the schedule save is exposed: a new route, or a new op on `/api/social-hub/slots`. It must be registered in the scope guard.
