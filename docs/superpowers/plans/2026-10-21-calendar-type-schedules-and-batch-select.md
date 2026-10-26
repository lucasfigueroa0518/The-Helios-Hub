# Calendar Type Schedules and Batch Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two Calendar tools:
- a per-type standing schedule (times, plus Trial/Main per time, plus days) that moves only the system's own bookings;
- batch select on the week board for one-off changes to several slots at once.

**Architecture:**
- Every date edit and every booking gains a "set by" mark (`person` | `system`).
- A pure schedule model turns one type's schedule into template rows, validates it, and pairs old and new times.
- One server save replaces that type's template rows and rewrites the person's tied overrides. It moves `system` bookings (Stories sets included) and sends `system` bookings on removed times back to Ready, all in one route.
- Batch select is a pure planner over the existing date-scope `SlotChange`s, split into calls of 20 or fewer.
- The Standard week tab and "Make it every" are removed. "Edited" and Reset now key off person overrides.

**Tech Stack:** Next.js App Router, TypeScript, Postgres (Supabase), PGlite for offline tests, `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-21-calendar-week-tool-and-batch-select-design.md`. It builds on `docs/superpowers/specs/2026-10-20-calendar-week-board-redesign.md`, whose rulings R1–R28 (ledger `.superpowers/sdd/2026-10-20-calendar-week-board-redesign/progress.md`) still hold unless this plan says otherwise.

## Global Constraints

- **Live state:**
  - PR #15 is merged into main.
  - `slot_source` is still `'legacy'`.
  - The slot tables are empty in production (read-only check, 2026-10-21).
  - Everything new is visible only once the switch is on. In legacy mode, both tools are read-only with the board's existing notice.
- **Schema:**
  - Every schema change is additive, idempotent, and safe in either deploy order (R3).
  - Live reads of a new column must tolerate its absence (the R12 pattern `(to_jsonb(t)->>'col')`).
- **Scope guard:**
  - Hub SQL writes only to `social_hub.*`, plus the Stories repo's own functions for `stories.sets`.
  - Every new client fetch target is registered in `tests/social-hub-scope.test.ts` (`HUB_CONTROLS` / `CONTROL_ENDPOINTS`).
- **Project rules:**
  - No native `<select>` in the hub; use the hub's `Menu`.
  - Use hub tokens and `--sh-v-*` type colors.
  - No live Claude API, no web_search, no live DB in tests or agent runs (CLAUDE.md).
- **Times:** 15-minute grid, 8:00 AM (480) to 8:45 PM (1245).
  - Trial/Main exists only for `reels` and `explainers`.
  - Last Few Days takes exactly one time.
- **Schedule entries, in this order, with these labels:** `Text on Screen` (reels), `Explainers`, `Carousels`, `Last Few Days`, `Morning Download`, `Guess the Number`, `Free vs. Paid`. The Stories series are separate entries.
- **Copy, verbatim:**
  - Over limit: `"{Type} can post {cap} a day. Raise the daily limit on the {Type} page to add more."`
  - Feed warning: `"{Other} post at {time} too. One of them will go out around {time+30}."`
  - LFD confirm: `"{Weekday} becomes a Last Few Days day. Carousels come off {Weekday}."` Reverse: `"{Weekday} becomes a Carousels day. Last Few Days comes off {Weekday}."`
  - Hand-set LFD skip line: `"Last Few Days skips {Day Mon D}: you set a Carousel there."`
  - Empty confirm: `"{Type} will stop posting."`
  - Back-to-ready toast part: `"{n} {Type} went back to Ready to place."`
  - Merge notice: `"This schedule had different times on different days. They're merged here; nothing changes until you save."`
  - Duplicate: `"{time} is already in the list."`
  - Batch: `"{n} selected"`. Skipped part: `"{n} skipped: {reason}"`. Locked click: the card's existing lock reason.
  - Toasts for schedule saves: `"{Type} schedule saved. Every week from now on."`, plus any back-to-ready part, plus Undo.

## Review Focus

1. A person's hand edit must never move after a schedule save: a moved slot, a removed slot, a placed post, or a dragged or rescheduled post. **Task 3** tests each one.
2. A schedule save where today's slot has already started leaves it and its post alone. **Task 3** test.
3. Undo of a schedule save after posts moved puts them back. Posts sent back to Ready stay in Ready, and the Undo toast says so. **Task 3** and **Task 4** tests.
4. A batch that includes a booked card, a locked card and an off-rule card does what it can, asks once about the booked ones, and lists the skipped ones. **Task 6** test.
5. A deploy where the hub has the new code but the new columns don't exist yet (or the reverse) keeps working in legacy mode. **Task 1** test.

---

### Task 1: "Set by" marks on date edits and bookings

**Files:**
- Modify: `db/social_hub_schema.sql`, `db/stories_schema.sql`, `lib/social-hub/slots/types.ts`, `lib/social-hub/slots/override.ts`, `lib/social-hub/slots/load.ts`, `lib/social-hub/slots/write.ts`, `lib/social-hub/placement.ts`, `lib/stories/repository.ts`, `lib/publishing/actions/stories.ts`
- Test: `tests/slots-set-by.test.ts` (new); update `tests/slots-write.test.ts` and `tests/social-hub-placement.test.ts` where the row shape changes

**Interfaces:**
- Produces:
  - `type SetBy = 'person' | 'system'` in `types.ts`.
  - `OverrideRow` gains `setBy: SetBy`. A row read with a null mark is `'system'`.
  - `overrideFor(nyDate, key, base, want, setBy: SetBy)`: for `'person'` it keeps a row even when `want` equals `base` (an `'add'` pin), and never returns `delete` for a present `want`.
  - `readOverrides` returns `setBy`.
  - Booking reads in write.ts include `slotBy: SetBy`: `'person'` when `schedule.slot_by = 'person'` or `schedule.source = 'user'`, else `'system'`.
  - Stories: `rescheduleSet(db, id, nyDate, publishAt, slotMinute, slotBy?: SetBy)`, and `StorySet.slotBy: SetBy` (tolerant read).

- [ ] **Step 1: Write the failing tests** in `tests/slots-set-by.test.ts` (PGlite, schema applied):
  - `board date edits are person`: `applySlotChanges` with a date put writes `set_by = 'person'`.
  - `a person edit back to the standard time is kept`: date move 9:30→10:00 then 10:00→9:30 on a template 9:30 leaves an `'add'` row at 9:30 with `set_by='person'`.
  - `started-today pins are system`: a template move that triggers `holdStartedToday` writes `set_by='system'`.
  - `placement writes person`: `placeItem` at a new time writes the override with `set_by='person'` and the schedule row with `slot_by='person'`.
  - `rescheduling an auto booking makes it person`: `rescheduleItem` on a `source='auto'` row sets `slot_by='person'`.
  - `overnight bookings stay system`: the explainers scheduler insert leaves `slot_by` NULL, read as `'system'`.
  - `stories reschedule by a person marks the set`: `rescheduleSet(..., 'person')` sets `slot_by='person'`.
  - `old code still works without the new columns`: with the columns dropped, `readOverrides` and the booking read return rows with `'system'`.
- [ ] **Step 2:** Run `npx tsx --test tests/slots-set-by.test.ts`. Expect FAIL (no columns).
- [ ] **Step 3: Implement.**
  - **Columns:**
    - `ALTER TABLE social_hub.slot_override ADD COLUMN IF NOT EXISTS set_by text CHECK (set_by IN ('person','system'))`
    - `ALTER TABLE social_hub.schedule ADD COLUMN IF NOT EXISTS slot_by text CHECK (slot_by IN ('person','system'))`
    - `ALTER TABLE stories.sets ADD COLUMN IF NOT EXISTS slot_by text CHECK (slot_by IN ('person','system'))`
  - **Writers:**
    - The slots route's date changes, placement, and `rebookSlot` called from reschedule or board drag write `'person'`.
    - `holdStartedToday` and the "Standard move target already passed" branch write `'system'`.
  - **Reads:** go through `to_jsonb(...)->>'set_by'` / `'slot_by'` so they tolerate missing columns.
  - **Writes:** guard with a cached column check, as `SLOT_MINUTE_SQL` does (R12).
- [ ] **Step 4:** Run the new file plus `tests/slots-write.test.ts tests/social-hub-placement.test.ts tests/stories-multi-slot.test.ts tests/stories-index-deploy-order.test.ts`. Expect PASS.
- [ ] **Step 5:** Commit `feat(slots): date edits and bookings carry who set them`.

### Task 2: Pure schedule model

**Files:**
- Create: `lib/social-hub/slots/schedule.ts`
- Test: `tests/slots-schedule-model.test.ts`

**Interfaces:**
- Consumes: `TemplateRow`, `FeedMode`, `StorySeries`, `isReelType`, `DAY_START`/`LAST_START`/`GRID` (times.ts), `clockLabel`.
- Produces:
  - `type ScheduleEntry = { vertical: Vertical; series: StorySeries | null; label: string }`
  - `SCHEDULE_ENTRIES: readonly ScheduleEntry[]`, in the Global Constraints order.
  - `type ScheduleTime = { minute: number; feedMode: FeedMode | null }`
  - `type TypeSchedule = { entry: ScheduleEntry; times: ScheduleTime[]; days: number[] }`. Days use 0 = Sunday. Times are sorted.
  - `scheduleFromTemplate(template: readonly TemplateRow[], entry: ScheduleEntry): { schedule: TypeSchedule; merged: boolean; problems: string[] }`
    - Takes the union of times. Days are those with any of the entry's rows.
    - A minute that is Trial on some days and Main on others is a problem: `"{time} is Trial on some days and Main on others. Pick one."`
  - `templateRowsFor(s: TypeSchedule): TemplateRow[]`
  - `checkSchedule(s: TypeSchedule, ctx: { cap: number; others: readonly TypeSchedule[] }): { errors: string[]; warnings: string[]; confirm: { kind: 'lfd-carousels' | 'carousels-lfd'; days: number[] } | null; empty: boolean }`
  - `pairTimes(before: readonly number[], after: readonly number[]): Map<number, number | null>`
    - Unchanged minutes map to themselves.
    - The remaining old minutes pair with the remaining new minutes in ascending order.
    - Leftover old minutes map to `null`.

- [ ] **Step 1: Write the failing tests.**
  - **Template round trip:** `scheduleFromTemplate` on a uniform 7-day Carousels template (540, 870) gives times [540, 870], days [0..6], `merged:false`, and `templateRowsFor` gives the same 14 rows.
  - **Merging:** a template with Mon 570 and Tue 600 for Carousels gives times [570, 600], days [1, 2], `merged:true`.
  - **Trial/Main conflict:** Explainers 780 Trial on Mon and Main on Tue gives the exact problem string for 1:00 PM.
  - **Over the daily limit:** 4 Explainer times with cap 3 gives the exact over-limit error.
  - **Duplicates:** a duplicate 690 gives `"11:30 AM is already in the list."`.
  - **Grid and bounds:** off-grid 695, 1260 and 465 are refused with the existing `OFF_GRID` / `OUTSIDE_DAY` strings.
  - **Last Few Days:** two times give `LFD_ONCE`.
  - **Feed warning:** Carousels at 690 with `others` holding Explainers Main at 690 gives the feed warning text `"Explainers post at 11:30 AM too. One of them will go out around 12:00 PM."`. With Explainers Trial at 690 there is no warning.
  - **LFD/Carousels confirm:** LFD days [2, 3, 5] with Carousels on [0, 1, 3, 4, 6] gives `confirm {kind:'lfd-carousels', days:[3]}`.
  - **Empty:** zero times or zero days gives `empty:true` and no error.
  - **Pairing:**
    - `pairTimes([570, 1080], [690, 1080])` → {570→690, 1080→1080}
    - `pairTimes([570, 720], [720, 900])` → {720→720, 570→900}
    - `pairTimes([570, 720], [720])` → {720→720, 570→null}
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement in `schedule.ts`. Pure; no DB imports, so client components can use it.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(slots): type schedule model, checks and time pairing`.

### Task 3: Schedule save on the server

**Files:**
- Create: `lib/social-hub/slots/schedule-write.ts`, `app/api/social-hub/slots/schedule/route.ts`
- Modify: `tests/social-hub-scope.test.ts` (register the route)
- Test: `tests/slots-schedule-save.test.ts`

**Interfaces:**
- Consumes:
  - Task 1's marks.
  - Task 2's `TypeSchedule`, `checkSchedule`, `pairTimes`, `templateRowsFor`.
  - `readTemplate`, `readOverrides`, `readCaps`; `rebookSlot` and `driftMinute` (placement / book.ts).
  - The Stories repo `rescheduleSet`.
  - The per-type unschedule deps in `lib/publishing/actions/live.ts`.
- Produces:
  - `planScheduleSave(q, s: TypeSchedule, opts: { now: Date; confirm?: boolean }): Promise<SavePlan>` where `SavePlan = { ok: true; templateRows; overrideOps; moves: Array<{ booking; to: { nyDate; startMinute; feedMode } }>; toReady: BookedPost[]; lfdSkips: string[]; inverse: TypeSchedule } | { ok: false; status: 400 | 422; errors: string[]; confirm?: {...} }`
  - `applyScheduleSave(q, plan, opts: { by: string; now: Date; rng? }): Promise<{ ok: true; moved: number; toReady: number; inverse: TypeSchedule } | { ok: false; status: 409; error: string }>`
  - `POST /api/social-hub/slots/schedule` with body `{ schedule: TypeSchedule, confirm?: boolean }`. It returns `{ ok, moved, toReady, inverse }`, 422 with `{ errors, confirm }`, or 409. `GET` returns `{ schedules: Array<{ schedule, merged, problems }>, caps }`.
  - The route sends `toReady` posts back first, through the same unschedule deps the `actions/unschedule` route uses. Then it calls `applyScheduleSave` in one transaction, which re-plans and verifies inside the transaction.

- [ ] **Step 1: Write the failing tests** (PGlite, schema applied, template in place, `now` = Sun Oct 25 2026 10:00 NY):
  - **Moves system bookings:** `moves system bookings to the paired time`. Carousels 570→690 moves Wed Oct 28's `system` booking to slot 690, with `publish_at` in [690, 705].
  - **Keeps person bookings:** `keeps a person booking`. A `slot_by='person'` booking at 570 stays.
  - **Moved hand edit stays tied:** `a hand-moved slot stays and its routine slot doesn't come back`. A Wed person move 570→600, then the schedule 570→690, gives Wed slots {600} and no 690.
  - **Removed hand edit stays tied:** `a hand-removed slot stays removed at the new time`. A person remove of 570 on Wed, then 570→690, gives no 690 on Wed. The override is rewritten to `remove 690`, `person`.
  - **Same minute:** `a new time on a hand-set minute keeps the hand-set slot`.
  - **Removed time:** `a removed time sends system bookings back to ready`. With [570, 1080]→[1080], `toReady` lists the 570 bookings.
  - **Started today:** `a started slot today is untouched`. `now` = Wed 10:00, a 570 slot today: no move, a `system` pin is written.
  - **Unstarted today:** `today's unstarted slot follows`. `now` = Wed 08:00, today's 570 booking moves to 690.
  - **Trial/Main:** `trial/main change reaches system bookings`. Explainers 780 trial→main updates the `system` booking's `feed_mode`.
  - **LFD needs a confirm:** LFD add Wed without `confirm` gives 422 with `confirm {kind:'lfd-carousels', days:[3]}`.
  - **LFD with the confirm:** the template drops Carousels on Wed, and a person-placed Carousel on Wed Oct 28 stays. `lfdSkips` = ["Wed Oct 28"], and a `system` `remove` override for LFD is written on Oct 28.
  - **Stories:** `stories system sets move with their series`. Morning Download 510→600 calls `rescheduleSet` with `slotMinute 600`, `'system'`.
  - **Undo:** `undo restores`. Applying `inverse` moves the bookings back.
  - **Over the limit:** `over cap is refused`, 422 with the exact over-limit copy.
  - **Legacy:** `legacy refuses`. With `slot_source='legacy'`, POST gives 409 `"Turn on the calendar first."`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
  - **Horizon:** bookings from today through today+14 (the existing `bookedDates` horizon).
  - **Template rows:** replace only this entry's rows (vertical plus series) for all weekdays.
  - **Person overrides on paired minutes:** rewrite `remove` rows from old to new minute. Leave `add` rows as they are.
  - **System overrides** on this entry's keys for future dates: delete them, except today's started pins.
  - **Re-validate** every affected date with `validateDay`.
- [ ] **Step 4:** Run → PASS, plus `tests/slots-write.test.ts tests/social-hub-scope.test.ts`.
- [ ] **Step 5:** Commit `feat(slots): save a type's schedule; system bookings follow, hand-set ones stay`.

### Task 4: The Schedules dropdown and form

**Files:**
- Create: `components/social-hub/calendar/SchedulesMenu.tsx`, `components/social-hub/calendar/ScheduleForm.tsx`
- Modify:
  - `components/social-hub/calendar/CalendarScreen.tsx`: header, next to Week/Month.
  - `app/social/(hub)/calendar/page.tsx`: load the schedules and caps.
  - `app/social/(hub)/preview/calendar/page.tsx`: a sandbox from `seedTemplate(DEFAULT_SEED_INPUTS)` and `DEFAULT_CAPS`, with no DB imports.
  - `app/social/(hub)/hub-calendar.css`.
- Test: `tests/slots-schedule-model.test.ts` (any new pure helpers, e.g. `formErrors`), `tests/social-hub-preview.test.ts`, `tests/social-hub-scope.test.ts`

**Interfaces:**
- Consumes: Task 2 and Task 3.
- Produces: `<SchedulesMenu schedules caps editable sandbox onSaved />`.

- [ ] **Step 1: Tests** for any pure helper you extract. The preview test asserts that the page renders "Schedules" with no DB import.
- [ ] **Step 2: Build the form.**
  - The menu lists `SCHEDULE_ENTRIES`. Picking one opens `ScheduleForm` in the hub's popover/sheet pattern (a bottom sheet at 375px).
  - **Times list:** each row has the time (15-minute `Menu` picker) and Trial/Main (reel types only), plus remove. "Add a time" is disabled at the cap, with a note pointing to the type page.
  - **Days:** Mon–Sun chips, ordered Mon first. LFD gets one time only.
  - Errors show inline and block Save. Warnings show inline and don't block. The merge notice shows when `merged`.
  - The confirm dialog covers LFD/Carousels, with the lfdSkips lines, and the empty schedule.
  - On save: the toast plus Undo, where Undo posts `inverse`. `router.refresh()`.
  - In legacy mode the form is read-only, with the board's notice.
  - In the sandbox, Save updates the on-screen board only.
- [ ] **Step 3:** Run `npx tsx --test tests/slots-schedule-model.test.ts tests/social-hub-preview.test.ts tests/social-hub-scope.test.ts tests/social-hub-routes.test.ts` and `npx tsc --noEmit`. Expect PASS, with only the known tsc errors.
- [ ] **Step 4: Controller browser check** at `/social/preview/calendar?view=week`:
  - set Carousels to 11:30 and 6 PM and save: the board's Carousel cards move;
  - over-cap refusal;
  - feed warning;
  - LFD on Wednesday confirm;
  - Undo;
  - widths 1440 and 375.
- [ ] **Step 5:** Commit `feat(calendar): Schedules dropdown sets a type's standing times and days`.

### Task 5: Remove the Standard week tab and "Make it every"; base Edited and Reset on hand edits

**Files:**
- Modify:
  - `components/social-hub/calendar/CalendarScreen.tsx` (pills, `scope=template`)
  - `components/social-hub/calendar/WeekBoard.tsx` (`runEvery`, Every toast button, Copy day, legend line, `mode==='template'` branches)
  - `components/social-hub/calendar/SlotCard.tsx` ("differs from the standard" copy → `"You changed this slot for this date."`)
  - `lib/social-hub/views/week-edit.ts` (delete `everyFor`, `planCopyDay`, `toastText`'s template branch; `planReset` now deletes the date's `person` overrides only)
  - `lib/social-hub/views/week.ts` (`WeekDayInput` gains `personKeys: SlotKey[]`; `edited` = `personKeys.length > 0`; drop `templateWeek`)
  - `app/social/(hub)/calendar/page.tsx`, `app/social/(hub)/preview/calendar/page.tsx`: `?scope=template` now redirects to the week.
- Test: update `tests/week-board-model.test.ts`, `tests/slots-week.test.ts`, `tests/slots-write.test.ts` (template ops stay valid: the schedule save and switch-on use them), `tests/slots-hub-views.test.ts`

**Interfaces:**
- Consumes: Task 1's `OverrideRow.setBy`.
- Keeps: the slots route's `scope:'template'` ops (switch-on seed and tests). They are no longer reachable from the UI.

- [ ] **Step 1: Failing tests.**
  - **Edited:** true only when a date has a `person` override. A `system` pin doesn't mark it.
  - **Reset:** removes only the `person` overrides. Booked slots still ask first; posted and started ones are never touched.
  - **Toast:** the toast has no "Make it every" for any edit.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Remove dead code. `rg "everyFor|planCopyDay|Standard week|scope: 'template'" components lib app` returns only the server ops kept on purpose.
- [ ] **Step 4:** Run the redesign test files and tsc. Expect PASS.
- [ ] **Step 5:** Commit `refactor(calendar): schedules replace the Standard week tab; Edited and Reset follow your own edits`.

### Task 6: Batch select on the board

**Files:**
- Modify:
  - `lib/social-hub/views/week-edit.ts` (pure planner)
  - `components/social-hub/calendar/WeekBoard.tsx` and `SlotCard.tsx` (select mode, checks, actions bar)
  - `components/social-hub/calendar/history.ts` (a command may hold several chunks)
  - `app/social/(hub)/hub-calendar.css`
- Test: `tests/week-board-model.test.ts`

**Interfaces:**
- Produces:
  - `type BatchAction = { op: 'time'; minute: number } | { op: 'mode'; feedMode: FeedMode } | { op: 'remove' }`
  - `planBatch<P>(state: BoardState<P>, keys: Array<{ day: number; key: SlotKey }>, action: BatchAction, clock: Clock): { label: string; chunks: SlotChange[][]; inverse: SlotChange[][]; next: BoardState<P>; skipped: Array<{ key: SlotKey; day: number; reason: string }>; booked: Hit<P>[] }`
    - `chunks` hold at most 20 changes each.
    - Every change is `scope:'date'` and marked person (Task 1).
  - `Command` gains `chunks?: SlotChange[][]`. Undo sends the inverse chunks in reverse order.

- [ ] **Step 1: Failing tests.**
  - **Set time:** `planBatch` 'time' 690 on three Carousel cards (Mon, Tue, Wed) gives 3 date moves and `next` with 690 on each.
  - **Mixed mode flip:** 'mode' main on a mixed selection (Text on Screen plus Carousel) changes the reel card and skips the Carousel with reason `"No Trial / Main for Carousels."`.
  - **Remove:** 'remove' with one booked card returns it in `booked`.
  - **Locked:** a locked card is skipped with `ALREADY_STARTED`.
  - **Off-rule:** a Carousel moved onto an LFD day by time doesn't apply (same day). A duplicate minute is skipped with the `canPlace` reason.
  - **Chunking:** 25 changes → chunks of 20 and 5.
  - **Undo:** the inverse restores the state.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Build.**
  - A **Select** toggle (check icon) in the board header. In select mode a card click toggles `aria-pressed` and shows a check. Drag is off and the details panel doesn't open. Esc or the toggle exits and clears.
  - **Actions bar:** `"{n} selected"`; Set time (15-minute `Menu`); Trial / Main; Remove; Clear.
  - Booked cards get one "Move it back to ready / Keep it" for all of them. The save is serialized as today (busy state). One undo step per batch.
  - The toast reports what was done and the skipped part.
  - It works in the sandbox and is read-only in legacy mode.
- [ ] **Step 4:** Run the tests and tsc. **Controller browser check:**
  - select three Carousels and set 11:30;
  - a mixed Trial/Main;
  - remove with a booked card (live only; note it for the hand-off);
  - Esc;
  - 375 width.
- [ ] **Step 5:** Commit `feat(calendar): select several slots and change them together`.

### Task 7: Docs, full suite, hand-off

**Files:** `planning/Social Hub/DECISIONS_LOG.md` (new D-row after D59), `docs/social-overnight.md` (D59 section: schedules, set-by marks, batch), `docs/superpowers/plans/2026-10-20-week-board-go-live.md` (the new columns arrive with the same schema apply).

- [ ] **Step 1:** Write the docs entries.
- [ ] **Step 2:** Run the full `npm test` and `npx tsc --noEmit`. Only the known failures should remain: `shared-queue-explainers` ×6, "the workspace holds the project…", "the text engine keeps a short break…", and the seo-gsc-auth / shared-queue-explainers tsc errors.
- [ ] **Step 3:** Commit `docs(calendar): type schedules and batch select`.
- [ ] **Step 4: Hand-off** (no live actions). The go-live checklist still applies, and its step 2 schema apply now also adds `set_by` / `slot_by`. Social worker deploy: required, since Stories `rescheduleSet` and the schedulers' rows are read with the new marks.
