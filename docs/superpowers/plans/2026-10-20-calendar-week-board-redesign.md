# Calendar Week Board Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Calendar's window-based week grid with a drag-and-drop week board where every slot has a free time, reels show Trial/Main on the card, and the overnight runs book at slot times under per-type daily caps.

**Architecture:** Slots stop being `(vertical, window_id)` and become `(vertical, start_minute, series?)`. One pure rules module, `lib/social-hub/slots/rules.ts`, decides every placement: drag, Move to, Ready to place, gap fixes and Reset. Schedulers in template mode book a random minute in `[start, start+15]`, push it later for the 30-minute feed gap, and stop at the cap. The UI is a new `WeekBoard` (timeline columns, cards, details panel, drag with ghost and snap) that replaces `WeekGrid`/`SlotEditor`. Legacy mode (`slot_source = 'legacy'`) is untouched throughout.

**Tech Stack:** Next.js App Router, React client components, TypeScript, Postgres/Supabase (PGlite in tests), `node:test` via `npx tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-20-calendar-week-board-redesign.md` (builds on `docs/superpowers/specs/2026-10-14-weekly-slot-calendar-design.md`). Reference prototype: `docs/superpowers/specs/assets/2026-10-20-week-board-prototype.html`; its bug list is `…-prototype-bugs.md` in the same folder.

## Global Constraints

- No Claude API, `web_search`, Instagram/Meta or live-DB calls in tests or development. Tests run offline on PGlite (`tests/fixtures/social-hub/pglite.ts`). The app pool goes through `globalThis.__outreachHubPool`, restored after each test.
- Never run `scripts/apply_*_schema.js` or deploy scripts. `db/social_hub_schema.sql` and `db/stories_schema.sql` must apply twice cleanly (idempotent).
- Stay on `unify-social-hub`. No branch/worktree changes, no push. Other sessions commit here too: `git add` only your own files/hunks. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Hub code writes SQL only to `social_hub.*`. `tests/social-hub-scope.test.ts` stays green, and new client fetch targets are registered there.
- Legacy mode behaves exactly as today. Every template path is gated on `slotPlan(...)` being non-null, and slot-read errors in hub read code fall back to legacy.
- Known failing tests on this branch (not ours): "the workspace holds the project…", "the text engine keeps a short break…", 6 in `tests/shared-queue-explainers.test.ts`. Known tsc errors: only in `tests/seo-gsc-auth.test.ts` and `tests/shared-queue-explainers.test.ts`.
- All times are America/New_York. Weekday 0 = Sunday. Minutes are minutes of the day (0–1439).
- Values from the spec, used verbatim:
  - **Timeline:** 8 AM–9 PM. Grid 15 minutes. Magnetic snap within 20 minutes of a usual start, with every 15-minute mark still reachable.
  - **Default times:** Text on Screen 525/675/1080. Explainer 780/930. Carousel 540/870. LFD 540 on Tue/Fri. Stories 510 (Morning Download daily; Guess the Number Mon/Thu; Free vs. Paid Tue/Sat).
  - **Usual windows:** Text 525–600, 675–750, 1080–1260. Explainer 780–870, 930–1020. Carousel 540–600, 870–930. LFD 540–600. Stories 510–600.
  - **Drift:** a post goes out at a random minute in `[slot, slot+15]`.
  - **Feed gap:** 30 minutes between feed posts. Main-feed reels, Carousels and LFD count. Stories and Trial reels are exempt.
  - **Caps per day:** Text on Screen 5, Explainers 3, Carousels 3, LFD 1, Stories 2 per series.
  - **Run hours:** Text on Screen 1 AM, Explainers 2 AM, Carousels/LFD 3 AM, Stories 4 AM.
- Copy, verbatim from the spec:
  - "Empty for now. The {run} run makes it on {Day Mon D}."
  - "Made, waiting for your approval." · "Ready and approved." · "Posted" · "Already started."
  - "Just this date." · "Make it every {Weekday}" · "Undo"
  - "At the daily limit for {Type} ({cap})"
  - "{Day} has {n} {Type}s; only {cap} will be made."
  - "Over today's limit, so nothing is made for this slot."
  - `LFD_CAROUSEL_CONFLICT` (existing constant).

## Review Focus

1. A booked post whose slot is moved to another day or time must still post, with the moved booking, and never vanish. Test in Task 3.
2. A drop or Move to aimed at a time that has already passed today must land at the next 15-minute mark, or be refused if today has no time left. Test in Task 2.
3. Two slots of one type at the same minute on the same date must be refused, while one series twice on a day at different times must be allowed. Test in Task 2.
4. More slots than the cap on a day must make posts only for the first `cap` slots by time; the rest stay empty and say why. Test in Task 5.
5. With `slot_source = 'legacy'`, every scheduler, the Stories builder and every hub view must behave exactly as before. Test in Tasks 5, 6, 7.

---

## File structure

**New**
- `lib/social-hub/slots/times.ts`: usual windows, defaults, caps, snap, drift (pure).
- `lib/social-hub/slots/rules.ts`: one placement rule set: `canPlace`, `applyPlace`, `applyMove`, `applyRemove`, `gapsFor` (pure).
- `lib/social-hub/slots/book.ts`: template-mode booking-time chooser for schedulers (pure).
- `components/social-hub/calendar/WeekBoard.tsx`: board shell (client): columns, gutter, drag row, panels.
- `components/social-hub/calendar/SlotCard.tsx`: one-line card plus details panel (client).
- `components/social-hub/calendar/useBoardDrag.ts`: drag state, ghost, snap, drop (client hook).
- `components/social-hub/calendar/history.ts`: command-based undo (pure).
- Tests: `tests/slots-times.test.ts`, `tests/slots-rules.test.ts`, `tests/slots-book.test.ts`, `tests/slots-caps.test.ts`, `tests/stories-multi-slot.test.ts`, `tests/week-board-model.test.ts`.

**Changed**
- `db/social_hub_schema.sql`, `db/stories_schema.sql`.
- `lib/social-hub/slots/{types,resolve,seed,load,index,write}.ts`; `lib/social-hub/views/week.ts`.
- Schedulers: `lib/reels/publish/schedule.ts`, `lib/reels/pipeline/fill.ts`, `lib/explainers/publish/schedule.ts`, `lib/explainers/ideas/cycle.ts`, `lib/social/overnight/schedule.ts`, `lib/lfd/schedule.ts`.
- Stories: `lib/stories/{schedule,worker,repository}.ts`.
- Hub: `lib/social-hub/placement.ts`, `lib/social-hub/views/plan.ts`, `lib/content-type/posting.ts`, `components/content-type/TypeControls.tsx`, `components/social-hub/calendar/CalendarScreen.tsx`, `app/social/(hub)/calendar/page.tsx`, `app/social/(hub)/preview/calendar/page.tsx`, `app/api/social-hub/slots/route.ts`, `app/social/(hub)/hub-calendar.css`, `tests/social-hub-scope.test.ts`.
- **Deleted at the end of Task 9:** `components/social-hub/calendar/WeekGrid.tsx` and `SlotEditor.tsx`. `SourceSwitch` moves into `WeekBoard.tsx`.

---

### Task 1: Schema: free-time slots, Stories slot minute, caps

**Files:**
- Modify: `db/social_hub_schema.sql` (slot tables, schedule slot check, caps setting), `db/stories_schema.sql` (sets slot minute + unique index)
- Test: `tests/slots-schema.test.ts` (extend)

**Interfaces:**
- Produces:
  - `social_hub.slot_template(weekday, vertical, start_minute smallint, series text null, feed_mode, updated_by, updated_at)`. Unique on `(weekday, vertical, start_minute, coalesce(series,''))`.
  - `social_hub.slot_override(ny_date, vertical, start_minute, series, action, feed_mode, …)`, with the same unique key per `ny_date`.
  - Checks:
    - `start_minute` is between 0 and 1439, a multiple of 15;
    - `series` is non-null exactly for stories and in the three series;
    - the existing feed_mode rules.
  - `social_hub.schedule.slot` additionally accepts free-time ids matching `^t[0-9]{4}(:[a-z_]+)?$` (e.g. `t0780`, `t0510:morning_download`), alongside today's window ids.
  - `stories.sets.slot_minute smallint null`. The live-day unique index becomes `(series, ny_date, coalesce(slot_minute, -1))`.
  - The settings row `daily_caps` = `{"reels":5,"explainers":3,"carousels":3,"last_few_days":1,"stories":2}`, inserted with ON CONFLICT DO NOTHING.

- [ ] **Step 1: Failing tests** in `tests/slots-schema.test.ts`. The old window-id assertions in this file are replaced by these:
  - `slot_template` accepts `(2,'explainers',720,null,'main')` and `(2,'stories',510,'morning_download',null)`, plus a second `(2,'stories',900,'morning_download',null)`.
  - It rejects:
    - a duplicate `(2,'explainers',720)`;
    - `start_minute` 725;
    - stories with a null series;
    - a non-stories row with a series.
  - `schedule` accepts `slot='t0720'` for explainers and `slot='t0510:morning_download'` for stories, and still accepts `'afternoon'`.
  - `stories.sets` allows two `morning_download` rows on one `ny_date` with `slot_minute` 510 and 900, and rejects a second 510.
  - The `daily_caps` row equals the JSON above.
  - Applying both schema files twice succeeds.
- [ ] **Step 2:** `npx tsx --test tests/slots-schema.test.ts` → FAIL.
- [ ] **Step 3: Write the migration blocks.** The slot tables are empty in production and `slot_source` is `'legacy'`, so the block can move to the new shape directly. Wrap it in a `DO $$ … $$` that runs only while `window_id` still exists: `DELETE` the rows, drop the PK, the window checks and `window_id`, then add `start_minute`, `series`, the new unique index and the checks. Use `CREATE TABLE IF NOT EXISTS` with the new shape for fresh databases. Stories: `ADD COLUMN IF NOT EXISTS slot_minute`, then `DROP INDEX IF EXISTS uq_stories_sets_live_day` and recreate it with the new key.
- [ ] **Step 4:** Run the test plus `tests/lfd-spine-schema.test.ts tests/stories-repository.test.ts tests/social-hub-foundations.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(slots): free-time slot schema, Stories slot minute, daily caps`.

---

### Task 2: Times and the shared placement rules (pure)

**Files:**
- Create: `lib/social-hub/slots/times.ts`, `lib/social-hub/slots/rules.ts`
- Modify: `lib/social-hub/slots/types.ts`, `resolve.ts`, `seed.ts`
- Test: `tests/slots-times.test.ts`, `tests/slots-rules.test.ts`; update `tests/slots-resolve.test.ts` for the new key

**Interfaces:**
- `types.ts`:
  - `TemplateRow = { weekday; vertical; startMinute: number; series: StorySeries | null; feedMode }`
  - `OverrideRow = { nyDate; vertical; startMinute; series; action; feedMode }`
  - `ResolvedSlot = { vertical; startMinute; series; feedMode; origin }`
  - `slotId(startMinute, series): string` → `t0780` / `t0510:morning_download`, plus `parseSlotId(id)`.
  - `windowId` is removed everywhere.
- `times.ts`:
  - `USUAL: Record<Vertical, ReadonlyArray<{ start: number; end: number; name: string }>>`
  - `DEFAULT_TIMES`
  - `DEFAULT_CAPS: Record<Vertical, number>`
  - `RUN_HOUR_LABEL: Record<Vertical, string>`
  - `GRID = 15`, `MAGNET = 20`, `DRIFT = 15`, `FEED_GAP = 30`
  - `snapMinute(raw: number, vertical: Vertical): { minute: number; snappedTo: string | null }`
  - `isUsual(vertical, minute): boolean`
  - `nextOpenMinute(nowMinute: number): number`
  - `isFeedSlot(s: Pick<ResolvedSlot,'vertical'|'feedMode'>): boolean`
- `rules.ts`:
  - `type DayCtx = { nyDate: string | null; weekday: number; slots: ResolvedSlot[]; today: string; nowMinute: number }`
  - `canPlace(ctx: DayCtx, s: { vertical; startMinute; series; ignore?: SlotKey }): { ok: true; minute: number } | { ok: false; reason: string }`. This is the only place that applies the LFD rule, duplicate keys, past/now locking and the 8 AM–9 PM bounds.
  - `applyPlace / applyMove / applyRemove`: return the next day slots or a refusal. A move across days is two DayCtx results.
  - `gapsFor(ctx: DayCtx, standard: ResolvedSlot[], caps: Record<Vertical, number>): Gap[]` with `Gap = { kind: 'no-explainer'|'no-stories'|'fewer-than-standard'|'outside-usual'|'feed-gap'|'over-cap'; text: string; fix?: SlotChangeIntent }`.
- `resolve.ts`: `resolveDay` keys on `(vertical, startMinute, series)`. `validateDay` drops the per-window checks and keeps LFD/Carousel plus feed_mode-on-reels.
- `seed.ts`: `seedTemplate` emits the default times above.

- [ ] **Step 1: Failing tests** with these exact cases.
  - `snapMinute(785,'explainers')` → `{minute:780, snappedTo:'Afternoon'}`.
  - `snapMinute(720,'explainers')` → `{minute:720, snappedTo:null}`.
  - `snapMinute(510,'reels')` → 510, which proves the magnet doesn't make 8:30 unreachable.
  - `snapMinute(805,'explainers')` → 810: past the magnet, the 15-minute grid applies.
  - `canPlace` refuses a Carousel on a day with LFD (reason `LFD_CAROUSEL_CONFLICT`), and refuses `explainers@720` when one already exists at 720.
  - `canPlace` allows `stories morning_download@900` alongside `@510`.
  - On today at nowMinute 600, `canPlace` of 540 returns `{ok:true, minute:615}`. Review Focus 2.
  - At nowMinute 1250, 540 is refused: "No time left today."
  - `applyMove` of LFD onto a Carousel day is refused. Moving a slot onto its own key is a no-op.
  - `gapsFor` emits `feed-gap` for Main explainer@780 plus carousel@795, and none for Trial reel@780 plus carousel@795.
  - `gapsFor` emits `over-cap` text "Wed has 4 Explainers; only 3 will be made." when there are 4 explainer slots.
  - `gapsFor` emits `outside-usual` for explainer@720.
  - Seed parity: `seedTemplate(DEFAULT_SEED_INPUTS)` resolved on Mon 2026-10-19 gives exactly the default times list.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Snapping order:
  1. round to the 15-minute grid;
  2. if a usual start is within 20 minutes and the raw value is within 7 minutes of that start, or the grid value equals it, take the start;
  3. otherwise keep the grid value.

  This keeps every 15-minute mark reachable. `canPlace` returns the adjusted minute; callers never adjust it themselves.
- [ ] **Step 4:** Run the two new test files plus `tests/slots-resolve.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(slots): free-time keys, usual windows, caps and one shared placement rule set`.

---

### Task 3: Load, write and the slots API on free-time keys

**Files:**
- Modify: `lib/social-hub/slots/load.ts`, `lib/social-hub/slots/write.ts`, `app/api/social-hub/slots/route.ts`
- Test: `tests/slots-write.test.ts`, `tests/slots-load.test.ts` (rewritten for the new keys)

**Interfaces:**
- `SlotChange`:
  - `{ scope:'template'|'date'; op:'put'|'delete'; weekday?|nyDate?; vertical; startMinute; series; feedMode? ; action? }`
  - plus `{ scope:'date'|'template'; op:'move'; from:{weekday?|nyDate?; vertical; startMinute; series}; to:{weekday?|nyDate?; startMinute} }`
- `applySlotChanges(q, changes, opts: { by: string; now: Date; resolveBooked?: 'move' | 'unschedule' })`
  - Every change goes through `rules.canPlace`.
  - A move whose source holds a booking reschedules that booking to the new day/time via `placement.rescheduleItem` in the same transaction. Spec call: the post moves with the slot. Review Focus 1.
  - A remove (delete or `action:'remove'`) of a booked slot returns `409 { booked }` unless `resolveBooked: 'unschedule'`. The client handles "Keep it" by not sending.
- `readCaps(q): Promise<Record<Vertical, number>>` (from `social_hub.settings.daily_caps`, defaults on error) and `writeCaps(q, patch, by)`.
- Route: GET also returns `caps`; POST accepts `op:'move'`.

- [ ] **Step 1: Failing tests.**
  - Template put/delete at free minutes.
  - A date move of `explainers@780 → @720` on Tue with a booked post: the schedule row's `ny_date` is unchanged, `slot` becomes `t0720`, `publish_at` is in `[12:00,12:15]` ET, and there's no 409.
  - A cross-day move of a booked carousel Tue→Thu reschedules it to Thu.
  - Removing a booked slot → 409. With `resolveBooked:'unschedule'` → the booking is cancelled and the item is back to ready.
  - A move onto a passed time today returns minute 615 at 10:00 AM.
  - `readCaps` returns the defaults and `writeCaps({explainers:4})` persists.
  - A "Make it every <weekday>" change (scope template, op put) applies only that slot, not the whole day.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Keep the transaction and the R2 seed-outside-transaction pattern from the existing route.
- [ ] **Step 4:** Run `tests/slots-write.test.ts tests/slots-load.test.ts tests/social-hub-scope.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(slots): free-time slot writes; moving a booked slot moves its post`.

---

### Task 4: Template-mode booking time (pure) and the scheduler seam

**Files:**
- Create: `lib/social-hub/slots/book.ts`
- Modify: `lib/social-hub/slots/index.ts`; remove `choose.ts` (replaced)
- Test: `tests/slots-book.test.ts`; update `tests/slots-schedulers.test.ts` imports

**Interfaces:**
- `index.ts`:
  - `slotsOn(plan, vertical, nyDate)` is kept.
  - `slotsWithinCap(plan, vertical, nyDate, cap): { made: ResolvedSlot[]; over: ResolvedSlot[] }`, ordered by time.
  - `quotaFromSlots(q, vertical, nyDate)` returns `min(count, cap)`.
  - `storiesSlotsOn(q, nyDate): Promise<ResolvedSlot[] | null>` replaces `storiesDueOn`.
  - `nonSlotKeys`, `feedModeKeys` and `feedModeFor` are removed.
- `book.ts`: `chooseSlotTime(slots: ResolvedSlot[], now: Date, taken: ReadonlySet<string> /* slotId */, busy: readonly Date[], rng: (n:number)=>number, throughDate?: string, days = 14): { nyDate: string; slot: string /* slotId */; publishAt: Date; feedMode: FeedMode | null } | null`
  - Earliest untaken slot first.
  - Minute = `slot + rng(16)` within `[slot, slot+15]`, never before `now`.
  - For a feed slot, push later until it is 30 minutes from every busy instant.

- [ ] **Step 1: Failing tests.**
  - The rng returns 0 → `publishAt` equals the slot minute.
  - The rng returns 15 → slot + 15.
  - A busy feed post at slot+5 pushes a Main explainer to busy+30.
  - A Trial reel ignores busy.
  - A taken slotId is skipped.
  - A slot already in the past today is skipped, and one that has started within its drift still books in the remaining minutes.
  - `slotsWithinCap` with 4 explainer slots and cap 3 → `made` has the first 3 by time and `over` has 1. Review Focus 4.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(slots): book at slot time with 15-minute drift, 30-minute feed gap and caps`.

---

### Task 5: Schedulers book from slots (template mode), capped

**Files:**
- Modify: `lib/reels/publish/schedule.ts` (`schedulePostIdea`, `windowsStillOpen`, `reelTaken`), `lib/reels/pipeline/fill.ts`, `lib/explainers/publish/schedule.ts` (`scheduleJob`), `lib/explainers/ideas/cycle.ts` (`explainersQuota`), `lib/social/overnight/schedule.ts` (`schedulePost`, `carouselFill`), `lib/lfd/schedule.ts` (`scheduleLfdPost`)
- Test: `tests/slots-schedulers.test.ts`, `tests/slots-caps.test.ts`

**Interfaces:**
- Consumes `slotPlan`, `slotsWithinCap`, `chooseSlotTime`, `readCaps`, `busyFeedTimes`/`ownFeedTimes`, and `bookSlot({ feedMode })`. Template bookings write `slot = slotId(...)`.
- In every scheduler the legacy branch (`plan == null`) stays byte-identical.
- Slots over the cap are never booked or generated.

- [ ] **Step 1: Failing tests.** For each of reels, explainers, carousels and LFD:
  - Template: a booking lands in `[slot, slot+15]` at a free minute like 12:00, with `slot = 't0720'`.
  - Over cap: with 4 explainer slots on Wed, `explainersQuota` gives 3 and the 4th slot is never booked. Review Focus 4.
  - Legacy: a booking is unchanged from today. Reuse the existing legacy assertions. Review Focus 5.
  - Carousel on an LFD day is still blocked.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement, using the existing PGlite fixtures in `tests/slots-schedulers.test.ts`. **Step 4:** Run the scheduler tests plus `tests/explainers-publish.test.ts tests/lfd-schedule.test.ts tests/feed-spacing.test.ts tests/social-hub-placement.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(slots): schedulers book at slot times under daily caps in template mode`.

---

### Task 6: Stories: one set per Stories slot

**Files:**
- Modify: `lib/stories/schedule.ts` (`requestAutoSets`, `seriesDayPlaced`, `pickPublishAt` use), `lib/stories/worker.ts`, `lib/stories/repository.ts` (`requestSet` gains `slotMinute`)
- Test: `tests/stories-multi-slot.test.ts`

**Interfaces:**
- `requestSet(db, { series, nyDate, trigger, style, slotMinute?: number | null })`
- `requestAutoSets(db, settings, now, opts: { log?; slots?: ResolvedSlot[] | null })`. When slots are given, request one set per Stories slot (capped at 2 per series) and skip slots whose time has passed. When they aren't, today's per-series behavior applies.
- Scheduling a set with a `slot_minute` books at that time with the 15-minute drift. Without one, it uses the series window as today.

- [ ] **Step 1: Failing tests.**
  - Template slots `morning_download@510` and `@900` on one date → two sets requested, with `slot_minute` 510 and 900, scheduled in `[8:30,8:45]` and `[15:00,15:15]`.
  - A third Morning Download slot (over the cap of 2) → not requested.
  - Legacy: exactly one set per due series, as today. Review Focus 5.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run with `tests/stories-*.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(stories): a series can post more than once a day in template mode`.

---

### Task 7: Hub placement, views and caps on type pages

**Files:**
- Modify:
  - `lib/social-hub/placement.ts`: `planPlacement` and `openSlots` use `rules.canPlace` and slot times in template mode.
  - `lib/social-hub/views/plan.ts`: `windowsOn`/`capacityWindows`/`dayPlan` read slot times when `slots` is given.
  - `lib/content-type/posting.ts`: `PostingState.cap`, plus the `cap` patch.
  - `components/content-type/TypeControls.tsx`: the cap control.
- Test: `tests/slots-hub-views.test.ts`, `tests/content-type.test.ts`

**Interfaces:**
- `PostingState` gains `cap: number | null` (template mode only) and `costPerPostMicros: number | null`. The cost is the average `HubPost.costMicros` of that type's posts over the last 14 days, null when there are none.
- `PostingPatch` gains `cap?: number` (integer 0–10, via `writeCaps`).
- Type page: the label reads "Daily limit"; −/+ controls; the line "One more a night costs about ${x}." appears when the cost is known.

- [ ] **Step 1: Failing tests.**
  - Template-mode placement at 12:00 for an explainer is allowed (it was refused under windows).
  - A placement at a duplicate minute is refused, with the `canPlace` reason.
  - Legacy placement is unchanged. Review Focus 5.
  - `readPosting('explainers')` in template mode returns `cap: 3`.
  - `writePosting('explainers',{cap:4})` persists, and `{cap:11}` throws.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run with `tests/social-hub-placement.test.ts tests/social-hub-viewmodels.test.ts tests/social-hub-scope.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(slots): hub placement on free times; daily limit on type pages`.

---

### Task 8: Week board model and undo (pure)

**Files:**
- Modify: `lib/social-hub/views/week.ts`, replacing the row/window model. `mondayOf`, `datedWeek`, `templateWeek`, `weekLabel`, `switchOnCopy`, `splitBooked`, `stuckNote`, `canMoveBack` and `chipNames` stay, with `chipNames` now taking `(vertical, series)`.
- Create: `components/social-hub/calendar/history.ts`
- Test: `tests/week-board-model.test.ts` (replaces `tests/slots-week.test.ts` cases tied to rows)

**Interfaces:**
- `boardModel({ mode, days: WeekDayInput[], posts, now, caps }): { columns: Array<{ nyDate; weekday; past; isToday; folded; edited; count }>; cards: Array<BoardCard> }`
- `BoardCard = { key: string; day: number; vertical; series; startMinute; feedMode; origin; booked: HubPost | null; status: 'empty'|'waiting'|'approved'|'posted'|'started'; statusText: string; locked: boolean; overCap: boolean; outsideUsual: boolean }`
- `statusText` uses the exact copy from Global Constraints, including the run hour and the day label.
- `yForMinute(minute, height)` and `minuteForY(y, height)` over 8 AM–9 PM.
- `lanes(cards): Map<key, { lane: number; of: number }>`: cards whose times are within the card height share space side by side instead of cascading. Must handle §5.
- `history.ts`:
  - `type Command = { label: string; changes: SlotChange[]; inverse: SlotChange[]; tab: 'week'|'standard'; undoable: boolean }`
  - `createHistory()` with `push`, `undo(tab)` and `canUndo(tab)`.
  - A command that unscheduled a booking is pushed with `undoable: false`.

- [ ] **Step 1: Failing tests.**
  - `statusText` for an empty Wed explainer is "Empty for now. The 2 AM run makes it on Wed Oct 21."
  - A posted card is `locked` with status `posted`.
  - Today's card at 9:00, with now at 10:00, is `started` and locked.
  - Mon is `folded` when today is Tue.
  - `edited` is true only when the date's resolved slots differ from the standard weekday by key, time or mode.
  - Three cards at 510/525/540 get lanes `{0/3,1/3,2/3}`.
  - `minuteForY(yForMinute(780,H),H) === 780`.
  - An over-cap 4th explainer is `overCap: true`.
  - `history.undo('week')` returns the inverse of the last week command and doesn't touch standard commands. A non-undoable command blocks `canUndo` until a newer command exists.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(calendar): week board model, lanes and command undo`.

---

### Task 9: The week board UI

**Files:**
- Create: `components/social-hub/calendar/WeekBoard.tsx`, `SlotCard.tsx`, `useBoardDrag.ts`
- Modify: `components/social-hub/calendar/CalendarScreen.tsx` (week branch renders `WeekBoard`), `app/social/(hub)/calendar/page.tsx`, `app/social/(hub)/preview/calendar/page.tsx`, `app/social/(hub)/hub-calendar.css`, `tests/social-hub-scope.test.ts` (register `WeekBoard.tsx` in `HUB_CONTROLS` in place of `SlotEditor.tsx`)
- Delete: `WeekGrid.tsx`, `SlotEditor.tsx` (move `SourceSwitch` into `WeekBoard.tsx`)
- Test: `tests/week-board-model.test.ts` (any new pure helpers); browser check by the controller

**Interfaces:**
- Consumes `boardModel`, `lanes`, `yForMinute`/`minuteForY`, `snapMinute`, `canPlace` (client-side preview only; the server stays authoritative), `gapsFor`, `history`, `POST /api/social-hub/slots`, `POST /api/social-hub/actions/unschedule`, `POST /api/social-hub/actions/place` for Ready to place, and `needsGroups(...).unplaced` for the Ready list.
- Behavior, matching the prototype and spec decisions 1–19:
  - **Layout:** timeline columns with an hour gutter. One-line cards: time · dot · short name · booked mark · Trial/Main tag (click to flip). The drag row on top. Ready to place and Gaps and warnings underneath.
  - **Details panel:** floats above everything and flips left for Fri–Sun. Fields per decision 9. Esc and outside click close it, and focus returns to the card.
  - **Drag** with native HTML5 drag-and-drop:
    - a reused ghost element, the size of a card, labeled with the type and a time tag;
    - snap via `snapMinute`;
    - usual-window hint bands;
    - amber when outside a usual window, red when refused (with the reason);
    - "At the daily limit for {Type} ({cap})" when the day is at cap;
    - dropping on the drag row removes;
    - dragover does work only when the snapped minute changes.
  - **After each change**, a toast reads "{what}. Just this date." with "Make it every {Weekday}" (template put of only that change) and "Undo" (`history`).
  - **Keyboard and touch:** every card is a button. The details panel has "Move to" (day select) and "Time" (15-minute select) that do everything a drag does.
  - **Legacy mode:** read-only board plus the `SourceSwitch` notice, as today.
- Uses the hub's existing tokens and type color variables (`--sh-v-*`), not the prototype's colors.

- [ ] **Step 1:** Add any extracted pure helpers (e.g. `toastFor(change)`, `dropState(...)`) with tests, then make them pass.
- [ ] **Step 2: Build the components.** Wire the page so legacy shows today's pattern read-only and template loads `loadSlots` + `readCaps`. The preview uses `seedTemplate(DEFAULT_SEED_INPUTS)` and `DEFAULT_CAPS`, with no DB imports.
- [ ] **Step 3:** Run `npx tsx --test tests/week-board-model.test.ts tests/social-hub-scope.test.ts tests/social-hub-preview.test.ts tests/social-hub-routes.test.ts` and `npx tsc --noEmit` → PASS / no new errors.
- [ ] **Step 4: Controller browser check** at `/social/preview/calendar?view=week`:
  - drag a type in;
  - move a card to 12:00;
  - flip Trial/Main;
  - open details;
  - check the panel isn't covered by the next column;
  - keyboard Move to;
  - widths of 1440, 1024 and 375 (the board scrolls inside itself).
- [ ] **Step 5: Commit** `feat(calendar): drag-and-drop week board with free times, ghost preview and details panel`.

---

### Task 10: Docs, full suite, hand-off

**Files:**
- Modify: `planning/Social Hub/DECISIONS_LOG.md` (new row after the last D-number: week board, free times, 15-minute drift, caps, Stories multi-set), `docs/social-overnight.md` (template mode books at slot times; caps; Stories per slot)

- [ ] **Step 1:** Add the docs entries.
- [ ] **Step 2:** Run the full `npm test` and `npx tsc --noEmit`. Expected: only the known failures listed in Global Constraints.
- [ ] **Step 3: Commit** `docs(slots): week board redesign, free times, caps`.
- [ ] **Step 4: Hand-off report** (no live actions). For Tommy:
  1. Apply both schema files: `node scripts/apply_social_hub_schema.js --apply` and `node scripts/apply_stories_schema.js --apply`.
  2. Check them read-only: `psql "$DATABASE_URL" -X -c "BEGIN READ ONLY; SELECT value FROM social_hub.settings WHERE key IN ('slot_source','daily_caps'); ROLLBACK;"`.
  3. Deploy the social worker with `./scripts/gcp/deploy-social-worker.sh` when he says.
  4. Switch on from the Calendar.
