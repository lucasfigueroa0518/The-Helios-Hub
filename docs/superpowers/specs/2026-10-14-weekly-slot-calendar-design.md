# Weekly slot calendar: design

**Date:** 2026-10-14 · **Branch:** `unify-social-hub` · **Asked for by:** Lucas (via Tommy)

## What this is

The Social Hub Calendar becomes the place where the posting cadence is set. It
opens on a **week view**. That's where you arrange **slots**, each one a content
type plus one of that type's existing time windows, on a **standing weekly
template**, and where you can **override a single date**. Reel-type slots carry a
**Trial / Main feed** toggle. Each content type's page keeps its *how* settings
(live, generate, autopublish, creative settings) and loses its *when* settings.

This changes two earlier product decisions: SH-11 ("No week view") and SH-13 /
SH-62 (calendar read-only, cadence changes deferred). Record the change in
`planning/Social Hub/DECISIONS_LOG.md` when this ships.

## Decisions (settled in brainstorming)

| # | Decision |
|---|---|
| 1 | Template plus single-date overrides. The template is the rule. An override changes only that date. |
| 2 | Trial / Main is set **per slot**, and only on reel types (`reels` = Text on Screen, `explainers`). Other types have no toggle. |
| 3 | **The calendar owns when, the type page owns how.** `posts_per_day`, LFD days and Stories series days stop being settings and are worked out from slots. |
| 4 | Slots use each type's **existing windows** only. Window times stay in code. No free times and no window editing in v1. |
| 5 | An edit that hits a booked post **asks first**: "Move it back to ready" (default) or "Keep it". |
| 6 | A Stories slot names one series. An LFD slot on a day makes it carousel-off, and the calendar blocks Carousel slots there. |
| 7 | **Slots are literal.** A day with an LFD slot never runs Carousels, even while LFD is paused. That slot just stays empty. |
| 8 | Week layout is a **window grid**: rows are time windows, columns are days. |
| 9 | Feed spacing follows `feed_mode`, not type. A Main-feed reel joins the 30-minute feed spacing (D33), and a Trial reel stays exempt. |
| 10 | Most posts a type can make in a day = its number of windows (Reels 3, Carousels 2, Explainers 2, LFD 1, Stories 1 per series). |

## 1. Data model

A slot is already `(vertical, window_id)`: Stories' window ids are the series
names, and `social_hub.schedule` allows one booking per
`(vertical, ny_date, slot)`. **`schedule_slot_check` does not change.**

### `social_hub.slot_template`, the standing week

| column | type | notes |
|---|---|---|
| `weekday` | smallint | 0–6, New York weekday (0 = Sunday, matching `weekdayOf`) |
| `vertical` | text | |
| `window_id` | text | same allowed `(vertical, window_id)` pairs as `schedule_slot_check` (copy the CHECK) |
| `feed_mode` | text null | `'trial' \| 'main'`. CHECK: not null for `reels` and `explainers`, null for everything else |
| `updated_by` | text | session email |
| `updated_at` | timestamptz | default `now()` |

PK `(weekday, vertical, window_id)`.

### `social_hub.slot_override`, one date's exceptions

| column | type | notes |
|---|---|---|
| `ny_date` | date | |
| `vertical`, `window_id` | text | same CHECK as the template |
| `action` | text | `'add' \| 'remove'` |
| `feed_mode` | text null | same CHECK as the template, applied when `action = 'add'`; null for `remove` |
| `updated_by`, `updated_at` | | |

PK `(ny_date, vertical, window_id)`. An `add` on a key the template already has
**replaces** the template row for that date. That's how a single-date
Trial/Main flip is stored.

### `social_hub.schedule`: add `feed_mode text null`

A booking saves the slot's `feed_mode` at the moment it's placed (same CHECK
shape: required for reel types). The posting path reads the booking, not the
template. That way a later template change can't quietly change a booked post.

### Seed (behaves like today on day 1)

Template rows are generated from:
- `PLAN` (`lib/social-hub/views/plan.ts`) for every-day windows (Reels, Explainers);
- Carousel windows on every weekday **except** current `lfd.settings.days`;
- the LFD `morning` window on current `lfd.settings.days` (default Tue, Fri);
- Stories series on their current days (`stories.settings` overrides, else `lib/stories/settings.ts` defaults);
- `feed_mode = 'trial'` for every `reels` row and `'main'` for every `explainers` row.

No overrides are seeded. The migration is idempotent (`ON CONFLICT DO NOTHING`).

**Note on carousels:** today, LFD only takes Tue/Fri while LFD `auto_run` is
on. The seed applies decision 7 (literal) only when the flag is turned on (§5).
Until then the legacy adapter keeps the old fallback. If LFD is paused when the
flag is turned on, Tue/Fri will have no Carousels until someone edits the
calendar. The cutover checklist calls this out.

### Obsolete after cutover (kept, not read)

`posts_per_day` in `reels.settings`, `explainers.settings` and `social.settings`;
`lfd.settings.days`; Stories series-day overrides. They stay in the DB so a
rollback is a flag flip. Removing them is a later change that needs its own OK.

## 2. Resolver

`lib/social-hub/slots/resolve.ts`, pure, no DB:

```ts
type FeedMode = 'trial' | 'main';
type TemplateRow = { weekday: number; vertical: Vertical; windowId: string; feedMode: FeedMode | null };
type OverrideRow = { nyDate: string; vertical: Vertical; windowId: string; action: 'add' | 'remove'; feedMode: FeedMode | null };
type ResolvedSlot = { vertical: Vertical; windowId: string; feedMode: FeedMode | null;
                      startMinute: number; endMinute: number; origin: 'template' | 'override' };

resolveDay(template: TemplateRow[], overrides: OverrideRow[], nyDate: string): ResolvedSlot[]
```

1. Take the template rows for `weekdayOf(nyDate)`.
2. Apply that date's overrides: `remove` drops the key, and `add` inserts or replaces it.
3. Attach window times from `PLAN`. `PLAN` stays the only code copy of window times, and `tests/social-hub-plan.test.ts` keeps pinning it to the worker constants. `PLAN.days` stops being read when the flag is on.
4. Sort by `startMinute`, then vertical.

`validateDay(slots: ResolvedSlot[]): string[]`, also pure, returns plain-English errors:
- a day with a `last_few_days` slot has no `carousels` slot: "Last Few Days runs the 3 AM job that day. Carousels are off.";
- `feedMode` is set exactly on reel types.

`lib/social-hub/slots/load.ts`: `loadSlots(fromDate, toDate)` makes two queries
(the template, plus overrides in that range) and returns `Map<nyDate, ResolvedSlot[]>`.

## 3. Calendar UI

Route stays `/social/calendar` (`app/social/(hub)/calendar/page.tsx`).

- **`Week | Month` toggle. Week is the default.** Month keeps its current features (heat, metrics, summary strip).
- **`This week | Template` toggle.** "This week" shows resolved slots for real dates (`‹ Oct 19 – 25 ›`, Monday-first). "Template" shows the standing pattern with weekday headers and no dates.
- **Window grid.** Rows are the time windows in start order:
  8:30 Stories · 8:45 Reel · 9:00 Feed (Carousel *or* LFD) · 11:15 Reel ·
  1:00 Explainer · 2:30 Feed (Carousel) · 3:30 Explainer · 6:00 Reel. Columns are days.
  Stories series for one day sit in a single 8:30 cell, and each series is still its own slot.
- **Chips** show the type and, for reel types, a `Trial` / `Main` pill. An orange outline marks a single-date override. A dark left edge marks a booked post. Clicking a booked chip still links to the post.
- **Empty cell:** `+` opens a picker with only the types and windows valid there, e.g. Carousel is greyed out on an LFD day with the reason shown. A cell that's blank because of LFD reads "LFD day".
- **Slot editor** (popover): Trial/Main (reel types only), **"Just Oct 20 / Every Tuesday"**, Remove, and when a post is booked, "1 post is booked here: **Move it back to ready** · Keep it". In Template mode, "Apply to" is hidden (every edit is "Every <weekday>").
- **Adding LFD to a day that has Carousels** shows "This also removes <day>'s 2 Carousel slots" and saves both changes together.
- **Past days** are read-only. Today is editable only for windows that haven't started.
- **`?type=<vertical>`** dims all other types (the link target from type pages).
- Gated by a new `SOCIAL_HUB_FLAGS.views.calendarWeek`. Editing is gated by `actionEnabled('editSlots')`.

The existing day sheet (`DaySheet.tsx`, `?day=`) and "place here" keep working.
`daySlots()` reads `loadSlots`.

## 4. Content-type pages and API

**`PostingSettings`** (`components/content-type/TypeControls.tsx`):
- Keeps Live, Generate, Autopublish and the type's own settings.
- Removes posts per day, max per day, LFD days and Stories series days.
- Adds a read-only **Schedule** strip: this week's seven days with that type's slot count (series names for Stories), Trial/Main counts for reel types, override markers, and **"Edit in Calendar →"** linking to `/social/calendar?view=week&type=<vertical>`.

**`lib/content-type/posting.ts`:** `writePosting` rejects `perDay` and series
`days` with a 400 (`"cadence moved to the calendar"`). `readPosting` works out
`perDay` from today's resolved slots so existing readers keep working.

**New API `app/api/social-hub/slots/route.ts`** (session required):

| method | body / query | effect |
|---|---|---|
| `GET` | `?from&to` | resolved slots + bookings per date |
| `PUT` | `{ scope: 'template', weekday, vertical, windowId, feedMode, resolveBooked? }` | upsert template row |
| `DELETE` | `{ scope: 'template', weekday, vertical, windowId, resolveBooked? }` | delete template row |
| `PUT` | `{ scope: 'date', nyDate, vertical, windowId, action, feedMode, resolveBooked? }` | upsert override |
| `DELETE` | `{ scope: 'date', nyDate, vertical, windowId }` | delete override (revert to template) |

A request can carry several changes (`changes: [...]`) applied in one
transaction, which the LFD-removes-Carousels case needs.

Each write:
1. runs `validateDay` on the affected template weekday (template alone) and on every date from today on that has an override and falls on an affected weekday or date; it returns 422 with the messages if invalid. Dates without overrides are just the template, so checking the weekday covers them;
2. finds bookings (`status = 'scheduled'`) in removed slots or slots whose `feed_mode` changed. If any exist and `resolveBooked` is missing, it returns `409 { bookedPosts }`;
3. with `resolveBooked: 'unschedule'`, cancels those bookings through the existing unschedule action (`app/api/social-hub/actions/unschedule/handler.ts`), which sends the items back to `ready`; with `'keep'`, leaves them (a kept booking keeps its saved `feed_mode`);
4. writes the rows.

## 5. Worker cutover

The old cadence logic is replaced by a single module,
`lib/social-hub/slots/index.ts`:

```ts
slotsFor(vertical, nyDate): Promise<ResolvedSlot[]>
isLfdDay(nyDate): Promise<boolean>
```

It switches on `social_hub.settings.slot_source`:
- `'legacy'` (seeded default) → a **legacy adapter** that builds the same answers from today's constants and settings (`PLAN`, `posts_per_day`, `carouselOffDays`, Stories series days, LFD auto_run fallback). Behavior is exactly today's.
- `'template'` → `loadSlots`.

Call sites moved onto it:

| today | file(s) | becomes |
|---|---|---|
| `posts_per_day` reads | `lib/social/overnight/schedule.ts`, `lib/explainers/publish/schedule.ts`, `lib/reels/pipeline/fill.ts`, `lib/social-hub/queries/day.ts`, `lib/content-type/posting.ts` | `slotsFor(v, date).length` |
| `carouselOffDays()` | `lib/social/overnight/schedule.ts`, `lib/social-hub/placement.ts`, `lib/social-hub/health/reporters/carousels.ts`, `lib/lfd/clock.ts` | `isLfdDay(date)` |
| `capacityWindows` / `windowsOn` / `PLAN.days` / `dayQuotas.lfdDays` | `lib/social-hub/views/{today,offer,day-rank,calendar}.ts`, `lib/content-type/{model,run-today-live}.ts` | `slotsFor` (loaded into the dataset) |
| earliest-open-window booking | `lib/lfd/schedule.ts`, overnight + explainer schedule, reels slots | books only windows from `slotsFor`; writes `schedule.feed_mode` |
| Stories series days | `lib/stories/settings.ts` → 4 AM set builder | series = Stories slots for the date |

**Posting Trial vs Main.** This applies to both the type workers
(`publisher_mode = off`) and the unified publisher (`live`). Both read
`schedule.feed_mode`:
- `trial` → send `trial_params` (`TRIAL_GRADUATION_STRATEGY`) and leave out `share_to_feed`, which is today's Reels behavior;
- `main` → no `trial_params`, `share_to_feed: true`, which is today's Explainers behavior.
Touch points: `lib/reels/music/publish.ts` / `meta.ts`, `lib/explainers/publish/publish.ts`, `lib/publishing/actions/*`.
A booking without `feed_mode` (made before the migration) falls back to the type's old behavior.

**Feed spacing:** the 30-minute spacing check includes a reel when its booking's
`feed_mode = 'main'` and leaves it out when `'trial'`, so it no longer depends on the type.

**Deploy:** this changes social-worker logic, so run
`./scripts/gcp/deploy-social-worker.sh` in the same session as the merge, and
`./scripts/gcp/deploy-worker-code.sh` if the shared libs reach the
orchestration VM. `slot_source` stays `'legacy'` after deploy.

**Cutover checklist (Tommy flips the switch):**
1. Parity test green; the deploy is done.
2. Read the Switch on confirm: it says whether today's pattern is copied in or a saved calendar from last time comes back, and, if LFD is paused, which days lose their Carousels.
3. Set `slot_source = 'template'` (Switch on, on the Calendar, admin only). The grid is read-only until then.
4. Review the Template view right away, before the next night runs. If LFD is paused, decide whether Tue/Fri should go back to Carousels and edit the template if so (decision 7).
5. Watch one night's run. Rollback: set it back to `'legacy'`.

## 6. Testing

All offline: no Claude API, no `web_search`, no Instagram calls.

1. **Resolver**: add / remove / replace overrides, single-date Trial flip, ordering, Stories series.
2. **Parity**: for each weekday, the legacy adapter output equals `resolveDay(seededTemplate, [], date)` (LFD auto_run on). This is the test that makes the switch safe.
3. **Validation**: Carousel on an LFD day rejected; `feedMode` on a non-reel rejected; LFD add + Carousel remove in one request accepted.
4. **API**: 409 with `bookedPosts` when a booked post is in the way; `unschedule` returns items to `ready`; `keep` leaves the booking and its `feed_mode`.
5. **Posting payload**: a `trial` booking builds `trial_params` with no `share_to_feed`; a `main` booking builds `share_to_feed: true` with no `trial_params` (request builder only, nothing sent).
6. **Spacing**: a Main-feed reel is spaced and a Trial reel isn't.
7. **UI**: the week grid renders from `previewDataset()` at `/social/preview/calendar?view=week`.

## Out of scope (v1)

- Free start times and editing window times.
- Drag-and-drop between cells (click to edit only).
- Removing the obsolete settings rows.
