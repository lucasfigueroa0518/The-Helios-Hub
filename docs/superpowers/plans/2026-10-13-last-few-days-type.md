# Last Few Days: the fifth content type (Plan 2 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Last Few Days a real fifth Helios Social spine vertical (`last_few_days`). Its posts become spine content
items, are approved, rejected, placed, moved and deleted from the hub like every other type, are booked into a 9:00–10:00 AM
window on Tuesdays and Fridays, publish as Instagram feed carousels through the shared code, run at 3:00 AM on its days in
place of the carousel run, and show up as their own type in every hub view (type page, Today, calendar, costs, health).

**Architecture:**
- The engine (Plan 1, `lib/lfd/*`) is unchanged except for one seam: `runLastFewDays` can **adopt a run the worker already
  claimed** (`LfdRunDeps.runId`) instead of inserting a new `lfd.runs` row.
- New engine-side modules under `lib/lfd/` own everything that writes `lfd.*`: settings reads (`settings.ts`), the run queue
  (`store.ts`), the spine item (`items.ts`), publishing (`publish.ts`), scheduling and the person's decisions
  (`schedule.ts`), the 3:00 decision (`clock.ts`), the worker step (`worker.ts`) and the live dependency factory (`live.ts`).
- Shared code moves into helpers instead of being copied: the feed-carousel publish (`carryFeedAttempt`), the due-slot release
  (`releaseDueFor`) and the item-level reject / unschedule / force-approve helpers live in `lib/social/overnight/*`, with
  Carousels' functions kept as thin wrappers so their behavior and tests are unchanged.
- The hub reads `lfd.posts`, `lfd.runs` and `lfd.settings` with SELECT only (`lib/social-hub/queries/last-few-days.ts`), maps
  them in an adapter (`lib/social-hub/adapters/last-few-days.ts`), and acts through the user-action layer
  (`lib/publishing/actions/last-few-days.ts`), exactly like the other four types.
- `scripts/social_worker.ts` (one process, `helios-social`) gains the Tue/Fri branch at 3:00, claims and carries out LFD runs in
  the same loop as carousel runs (so they never overlap), and publishes LFD posts while the single publisher does not drive the
  type. `scripts/publisher_worker.ts` registers an LFD driver for when it does.

**Tech Stack:** TypeScript (strict), Node `node:test` through `tsx --test`, PGlite (`@electric-sql/pglite`) for SQL tests,
Next.js App Router (pages and route handlers), React client components.

**Spec:** `docs/superpowers/specs/2026-10-13-last-few-days-design.md` (this plan covers §7.2, §7.3, §7.4, §8, the §9 run cap
for the worker, the §10 tests for these parts, and §11 rollout). Plan 1: `docs/superpowers/plans/2026-10-13-last-few-days-engine.md`.

## Global Constraints

- **No live model calls in tests or agent runs** (CLAUDE.md Rule 1). No live Claude, Jev, `web_search` or Instagram in any test.
  Every model and Graph step is stubbed. Agents never start a run: never run `scripts/lfd_run.ts`, never insert a `requested`
  row into the real `lfd.runs`, never click "Make Last Few Days now". The first live run is Tommy's click (spec §11 step 2).
- **No new Claude call is added by this plan.** The engine's one structured call already caches its prefix (Plan 1). If a step
  ever seems to need a new `messages.create`, stop: it needs `cache_control` on the stable prefix (CLAUDE.md "Prompt caching").
- **Human steps are STOP steps.** Two steps in this plan change shared infrastructure and are never run by an agent:
  1. applying the spine schema: `node scripts/apply_social_hub_schema.js --apply` (Task 1);
  2. redeploying the social worker VM: `./scripts/gcp/deploy-social-worker.sh` (Task 8, required by CLAUDE.md "Worker sync"
     because this plan changes `scripts/social_worker.ts` and `scripts/publisher_worker.ts`).
  At each, the agent stops, tells Tommy what changed and the exact command, and waits.
- **No new dependencies and no `package.json` edits** (`tests/social-hub-scope.test.ts`).
- **Hub scope guard stays green without changing the guard.** Hub code (`lib/social-hub/**`, `app/api/social-hub/**`,
  `app/social/(hub)/**`, `components/social-hub/**`) only SELECTs from `lfd.*`, and may import only `lib/lfd/config.ts`,
  `lib/lfd/days.ts`, `lib/lfd/settings.ts` (SELECT only, no network) and type-only imports from `lib/lfd/*`. Everything that
  writes `lfd.*` or `social.used_photos` lives in `lib/lfd/*` and `lib/publishing/*`, reached only from the flagged action
  routes (exempt) and the workers. Action flags are unchanged. The guard needs **no** LFD-specific handling.
- **Typecheck baseline.** Other sessions' in-flight files may already carry type errors (on 2026-10-14:
  `tests/seo-gsc-auth.test.ts` and `tests/lfd-vision.test.ts`). Before Task 1, save the baseline:
  `npx tsc --noEmit -p tsconfig.json 2>&1 | grep 'error TS' | sed 's/([0-9,]*)//' | sort -u > /tmp/lfd-tsc-baseline.txt`.
  Every task's **typecheck line** is
  `npx tsc --noEmit -p tsconfig.json 2>&1 | grep 'error TS' | sed 's/([0-9,]*)//' | sort -u | comm -13 /tmp/lfd-tsc-baseline.txt -`,
  and it must print nothing (no error this plan introduced).
- **Test baseline.** Likewise, before Task 1 run `npm test 2>&1 | grep '^✖' | sort -u > /tmp/lfd-test-baseline.txt`. On
  2026-10-14 `tests/stories-pool.test.ts` ("pool refresh: …") already failed in the working tree because of another session's
  uncommitted `lib/stories/*` edits. "PASS" in a task means no failure outside that baseline.
- **Concurrency.** Other sessions are committing to this branch while this plan runs, notably a Social Hub Health tab under
  `lib/social-hub/health/*` (+ `lib/social-hub/cost-page/*`, their tests and fixtures) and edits under `lib/stories/*`. Every task
  **re-reads each file right before editing it** (line numbers in this plan drift; match the quoted text, and if the text moved
  or changed, apply the same change to the current text), commits **only its own paths** with explicit `git add <paths>`, and
  **never amends, rebases, resets, stashes or switches branches**. Branch: `unify-social-hub`. If a commit fails because a
  shared file changed under you, re-read, re-apply, re-run the task's tests, and commit again.
- **Commits** end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **Exact constants:**

| Constant | Value |
|---|---|
| Vertical id | `last_few_days` |
| Label / short | `Last Few Days` / `LFD` |
| Format | `feed` (an Instagram multi-image feed post) |
| Type page | `/last-few-days` (`VERTICALS` `href`; `typeHref` follows `href`) |
| Hub color | `--sh-v-last_few_days: #e0529c` (the app's `--chart-5` pink; distinct from teal, royal blue, green and lilac) |
| Days | `lfd.settings.days`, default `[2, 5]` (Tue, Fri; 0 = Sunday) |
| Window | slot `morning`, 9:00–10:00 AM New York (`startMinute` 540, `endMinute` 600) |
| Feed spacing | 30 minutes (`FEED_GAP_MINUTES`), new `FeedSchema` `'lfd'` |
| Run cap | `lfd.settings.run_cap_usd`, default `1`; a value that is not a positive number refuses the run |
| Run clock | 3:00 AM New York, in the carousel run's slot, only with `lfd.settings.auto_run` on |
| Post ref key | `lfdPostId` (hub refs and action bodies) |
| Hub post id | `last_few_days:<lfd.posts.id>` |
| Content item | `vertical 'last_few_days'`, `format 'feed'`, `native_ref = lfd.posts.id`, `idea_ref NULL` |
| Used photos | `social.used_photos` rows at publish: `story_id 'lfd:<postId>'`, `slide` = story index + 2, `source 'lfd'`, `post_id NULL`, logos skipped |
| Slide images | `/api/last-few-days/slides/<postId>/<n>` → signed URL from bucket `social-slides` |

## Decisions this plan makes (with rationale)

1. **URL `/last-few-days`** (`app/last-few-days/page.tsx`). Readable and hyphenated like the rest of the app's URLs; `typeHref`
   now returns `verticalInfo(v).href` (equal to `/${v}` for the other four, so nothing else moves). Nav crumbs and `safeFrom`
   learn the hyphenated path.
2. **VERTICALS entry** `{ id: 'last_few_days', label: 'Last Few Days', short: 'LFD', format: 'feed', colorVar: '--sh-v-last_few_days', href: '/last-few-days', reviewHref: '/last-few-days' }`,
   appended last so the fixed type order of the four existing types does not change. Icon: lucide `Newspaper`.
3. **Spine identity.** A post becomes a content item the moment the worker's run returns (`carryOutLfdRun` → `lfdItemId`), and
   again idempotently whenever any lifecycle step touches it (queue, schedule, place). `idea_ref` stays NULL (spec §7.2): a post
   is a bundle of stories, not one idea. The hub gives each post the idea `lfd:<ny_date>` (not stored) so "today's post" can be
   found by its day.
4. **The worker claims; the engine adopts.** The contract's queue is `requested → running`. Plan 1's `startRun` inserts a
   `running` row, which would collide with the claimed row on `idx_lfd_runs_single_running`. `runLastFewDays` therefore takes an
   optional `runId` and adopts it (`adoptRun`), setting `cap_usd` and `ny_date` on it.
5. **The run cap is read and validated at run time** from `lfd.settings.run_cap_usd` (`readLfdSettings`, same rule as
   `scripts/lfd_run.ts`): a non-positive or non-numeric value fails the run before any spend; the 3:00 clock queues nothing on
   such a day.
6. **Live dependencies are built in one place** (`lib/lfd/live.ts`), used by both the worker and the human CLI, so the worker
   wires them "exactly as `scripts/lfd_run.ts` does" by construction. The run executes in the worker process (spec §7.3: one
   process, no new unit); a run that throws is failed in `lfd.runs` and the loop goes on.
7. **3:00 AM rule** (`threeAmQueue`): on an LFD day with LFD `auto_run` on, queue an LFD run and **not** the carousel run; any
   other day, the carousel rule as before. With LFD `auto_run` off, Tuesday and Friday are ordinary carousel days (LFD-02 applies
   only "while Last Few Days is on").
8. **Daily fill (§7.4).** A **scheduled** LFD run on a day a person already placed an LFD post is skipped (`stop_reason`
   `quota-filled: …`). A **manual** run is never skipped.
9. **Booking.** After a successful run, while `lfd.settings.publishing_live` is on, the post is booked into **its own day's**
   window (`throughDate` = that day); nothing is booked on a day that is not an LFD day (a manual Wednesday run waits in Content
   ready). Approving a post books the earliest open LFD window (its day if still open, else the next Tue/Fri), like Carousels.
10. **Carousels give up Tue/Fri while LFD `auto_run` is on**, in four places that all read `lfd.settings`: the 3:00 clock, the
    carousel scheduler (`schedulePost` treats those days' windows as taken), hub placement (`placementRules` gives carousel
    windows `days` without them) and the hub plan (`DayQuotas.lfdDays` → `windowsOn`).
11. **Publishing.** The IG feed-carousel steps move into `carryFeedAttempt` (account gate, child containers, poll, publish,
    schedule mark) with a per-type `onPublished` hook. LFD's hook marks `lfd.posts` published and records its photos in
    `social.used_photos`. Because `publisher_mode` is `off` in production (the single publisher is installed but disabled), the
    **social worker also releases and publishes LFD posts** while `publisherOwnsPublishing(query, 'last_few_days')` is false, exactly
    as it does for Carousels; the publisher driver takes over when it goes live.
12. **Insights.** There is no shared spine insights sweep in the code (spec §7.3 assumes one). `pollCarouselInsights` gains a
    `vertical` parameter; the social worker reads LFD insights on the carousel cadence (30 minutes, 5:30 sweep) and the driver's
    `pollInsights` uses the same reader.
13. **Ideas view** = the latest finished run's record: its picks (`content_ready`), its drops with the reason (`retired`) and the
    rest of each lane's queue (`idea_only`), in post order, with the window in each row's detail. The pool for the *next* post
    needs Jev judgments, so it is not computed on a page view.
14. **Health tab.** It requires a reporter per type (`REPORTERS` is a `Record<Vertical, …>`), so LFD gets a small one reading
    `lfd.runs`; its quota is 1 on its days and 0 otherwise (`PostingState.days`).
15. **Run button.** "Make Last Few Days now" on the type page goes through `run-today` (`runType(email, 'last_few_days')`), which
    on that button counts any day as due; Content's Run now includes LFD only on its days. Both insert a `requested`
    `lfd.runs` row; only the worker executes it.
16. **Rejecting** a post sets `lfd.posts.status = 'rejected'` as well as the spine rejection, so its stories are free for the
    next post's repeat check (`previousPosts` skips rejected posts) and the hub stops listing it as ready.
17. **`tests/social-hub-scope.test.ts` is not changed.** See Global Constraints; the guard already covers the new files.

## Review Focus

1. **Tuesday 3:00 AM queues both a carousel run and an LFD run (two feed posts, double spend), or LFD runs on a Wednesday.**
   Pinned by `tests/lfd-worker.test.ts` "the 3:00 slot…" (Task 7).
2. **A claimed run collides with the engine's own insert** (`idx_lfd_runs_single_running`) and every worker-started run fails.
   Pinned by `tests/lfd-run.test.ts` "a run the worker claimed is adopted…" (Task 2).
3. **Carousels still get booked into Tuesday/Friday windows while LFD is on** (three feed posts that day, or two in one window).
   Pinned by `tests/lfd-placement.test.ts` "a carousel approved on a Tuesday…" (Task 3) and `tests/lfd-plan.test.ts` (Task 11).
4. **The shared publish refactor regresses Carousels or marks the wrong table** (an LFD post marked in `social.posts`, a carousel
   never marked). Pinned by `tests/lfd-publish.test.ts` "publishing marks the lfd post…" plus the unchanged
   `tests/social-overnight.test.ts` and `tests/social-publisher.test.ts` (Task 4).
5. **One LFD post shows as two hub posts** (the ready card and the booked slot don't fold), or hub code starts importing an
   `lfd.*` writer. Pinned by `tests/lfd-hub.test.ts` "a post in review reads as one ready post…" and the unchanged
   `tests/social-hub-scope.test.ts` (Task 9).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `db/social_hub_schema.sql` | `last_few_days` in every vertical CHECK; its `morning` slot; its triggers | 1 |
| `lib/lfd/config.ts` | Days, window, cap and photo-prefix constants | 2 |
| `lib/lfd/days.ts` | Weekday helpers over New York dates (pure) | 2 |
| `lib/lfd/settings.ts` | `lfd.settings` read and checked; Carousels' days off (SELECT only) | 2 |
| `lib/lfd/store.ts` | + `requestRun`, `claimRun`, `adoptRun`, `failRun` | 2 |
| `lib/lfd/run.ts` | + `LfdRunDeps.runId` (adopt a claimed run) | 2 |
| `lib/social-hub/spine.ts`, `lib/social-hub/fill.ts` | `last_few_days` in `SpineVertical` / `FillVertical` | 3 |
| `lib/instagram/feed-spacing.ts` | LFD bookings count as feed posts (`'lfd'`) | 3 |
| `lib/social-hub/placement.ts` | LFD window rules; carousel windows without LFD days | 3 |
| `lib/social/overnight/schedule.ts` | Carousel booking skips LFD days; shared release and item helpers | 3, 5 |
| `lib/social/overnight/publish.ts` | Shared feed-carousel queue and carry | 4 |
| `lib/lfd/items.ts` | The post's spine item | 4 |
| `lib/lfd/publish.ts` | Queue, carry, mark published, record photos | 4 |
| `tests/fixtures/lfd/seed.ts` | + `seedLfdPost` | 4 |
| `lib/lfd/schedule.ts` | Book, approve, reject, unschedule, hard publish, release | 5 |
| `lib/social/overnight/insights.ts` | `vertical` parameter | 6 |
| `lib/publishing/drivers/last-few-days.ts` | The publisher's LFD driver | 6 |
| `scripts/publisher_worker.ts` | Registers the driver | 6 |
| `lib/lfd/clock.ts` | The 3:00 decision (pure) | 7 |
| `lib/lfd/live.ts` | Live engine dependencies (worker and CLI) | 7 |
| `lib/lfd/worker.ts` | Carry out a claimed run; item; schedule | 7 |
| `scripts/lfd_run.ts` | Uses `liveLfdDeps` | 7 |
| `scripts/social_worker.ts` | 3:00 branch, LFD claim, LFD publish and insights | 8 |
| `scripts/gcp/deploy-social-worker.sh` | In-flight guard covers `lfd.runs` | 8 |
| `docs/social-overnight.md` | Clock row, Daily fill row, process note | 8 |
| `lib/social-hub/types.ts`, `verticals.ts`, `ids.ts`, `lifecycle.ts`, `factors.ts`, `cost.ts`, `house.ts` | The fifth vertical | 9 |
| `lib/social-hub/queries/last-few-days.ts` | Hub read (SELECT only) | 9 |
| `lib/social-hub/adapters/last-few-days.ts` | Hub posts and ideas | 9 |
| `lib/social-hub/queries/spine.ts`, `dataset.ts`, `load.ts` | Read path | 9 |
| `lib/social-hub/views/plan.ts`, `day-rank.ts`, `pools.ts`, `run-for.ts`, `queries/day.ts` | Plan window, quota, cards | 9 |
| `lib/social-hub/health/{brief,night}.ts`, `health/reporters/{shared,last-few-days}.ts` | Health reporter | 9 |
| `lib/social-hub/cost-page/{model,load}.ts` | Color, interactions, monthly watch | 9 |
| `lib/content-type/posting.ts` | LFD posting switches | 9 |
| `lib/publishing/actions/live.ts` | LFD entry (verbs in Task 10) | 9, 10 |
| `components/social-hub/ui/marks.tsx`, `content/PoolScreen.tsx`, `content/ContentScreen.tsx`, `app/social-hub.css` | Icon, pool copy, color | 9 |
| `components/content-type/ContentTypePage.tsx` | Narrowed in 9, LFD page in 12 | 9, 12 |
| `app/api/last-few-days/slides/[postId]/[n]/route.ts` | Signed slide JPEGs | 9 |
| `lib/publishing/actions/last-few-days.ts` | approve / reject / publishNow / unschedule / delete / place / reschedule | 10 |
| `app/api/social-hub/actions/{content-action.ts,approve-content/handler.ts,hard-publish/handler.ts}` | Accept `last_few_days` | 10 |
| `lib/social-hub/views/actions.ts` | "Approve and schedule" label | 10 |
| `lib/social-hub/views/{plan,today,calendar,offer}.ts`, `lib/content-type/model.ts`, `lib/content-type/run-today-live.ts`, `components/social-hub/calendar/CalendarScreen.tsx` | Carousel windows off on LFD days | 11 |
| `app/last-few-days/page.tsx`, `app/api/last-few-days/run/route.ts` | Type page and its Run button | 12 |
| `components/content-type/{TypeControls,run-progress}.tsx`, `lib/content-type/progress.ts`, `lib/social-hub/run-today.ts`, `lib/social-hub/views/{run-for,nav}.ts`, `components/social-hub/content/{RunsRefresh,HubControls}.tsx`, `components/hub-shell/nav.ts`, `middleware.ts` | Run button, progress, Run now, nav | 12 |
| `lib/social-hub/queries/costs.ts` | LFD runs in the cost ledger | 13 |
| `tests/lfd-*.test.ts` | Tests | all |

---

### Task 1: The spine accepts `last_few_days`

**Files:**
- Modify: `db/social_hub_schema.sql`
- Test: `tests/lfd-spine-schema.test.ts` (create)

**Interfaces:**
- Consumes: the PGlite fixture `openHubTestDb()` (loads `db/social_hub_schema.sql` as is).
- Produces: `social_hub.content_items`, `schedule`, `publish_attempts` and `idea_adjustments` accept `vertical = 'last_few_days'`;
  `schedule_slot_check` allows only slot `morning` for it; `publish_attempts_trigger_check` allows `approve | auto | force`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lfd-spine-schema.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { HubQuery } from '@/lib/social-hub/db';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const hubSql = () =>
  readFileSync(path.join(process.cwd(), 'db/social_hub_schema.sql'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');

async function lfdItem(query: HubQuery, ref = 'post-1'): Promise<string> {
  return (await query<{ id: string }>(
    `INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('last_few_days', 'feed', $1) RETURNING id`,
    [ref],
  )).rows[0]!.id;
}

test('the spine takes a last_few_days item, its morning slot only, and approve/auto/force attempts', async () => {
  const { query } = await openHubTestDb();
  const id = await lfdItem(query);
  const slot = (slot: string, day: string) =>
    query(
      `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source)
       VALUES ($1, 'last_few_days', $2::date, $3, $4::timestamptz, 'cancelled', 'auto')`,
      [id, day, slot, `${day}T13:30:00Z`],
    );
  await slot('morning', '2026-10-13');
  await assert.rejects(slot('afternoon', '2026-10-16'), /schedule_slot_check/);
  for (const trigger of ['approve', 'auto', 'force']) {
    await query(
      `INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'last_few_days', $2, 'failed', 'c')`,
      [id, trigger],
    );
  }
  await assert.rejects(
    query(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'last_few_days', 'mix_test', 'failed', 'c')`, [id]),
    /publish_attempts_trigger_check/,
  );
  await query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('last_few_days', 'x', '2026-10-13', 'promote')`);
});

test('re-applying the schema widens an existing idea_adjustments check (D45)', async () => {
  const { pg, query } = await openHubTestDb();
  // The table as it stood before this change: the four-type inline check.
  await pg.exec(`ALTER TABLE social_hub.idea_adjustments DROP CONSTRAINT idea_adjustments_vertical_check;
                 ALTER TABLE social_hub.idea_adjustments ADD CONSTRAINT idea_adjustments_vertical_check CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories'));`);
  await assert.rejects(query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('last_few_days', 'x', '2026-10-13', 'promote')`));
  await pg.exec(hubSql());
  await query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('last_few_days', 'x', '2026-10-13', 'promote')`);
  await lfdItem(query, 'post-2');
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx --test tests/lfd-spine-schema.test.ts`
Expected: FAIL. The first test with `violates check constraint "content_items_vertical_check"`; the second at its last insert
the same way.

- [ ] **Step 3: Edit `db/social_hub_schema.sql`**

Re-read the file first. Make these edits (each "replace all" changes every definition, per D45):

(a) Replace **all 4 occurrences** of

```sql
vertical IN ('carousels', 'explainers', 'reels', 'stories')
```

with

```sql
vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days')
```

(three `content_items_vertical_check` definitions and the inline check in `CREATE TABLE IF NOT EXISTS social_hub.idea_adjustments`).

(b) Replace **all 3 occurrences** of

```sql
    OR (vertical = 'stories' AND slot IN ('morning_download', 'guess_the_number', 'free_vs_paid'))
);
```

with

```sql
    OR (vertical = 'stories' AND slot IN ('morning_download', 'guess_the_number', 'free_vs_paid'))
    OR (vertical = 'last_few_days' AND slot IN ('morning'))
);
```

(c) Replace **all 3 occurrences** of

```sql
    (vertical IN ('carousels', 'explainers') AND trigger IN ('approve', 'auto', 'force'))
```

with

```sql
    (vertical IN ('carousels', 'explainers', 'last_few_days') AND trigger IN ('approve', 'auto', 'force'))
```

(d) In the comment above the first `schedule_slot_check`, replace

```sql
-- Each type's windows (Carousels: morning 9:00–10:00, afternoon 2:30–3:30;
-- Explainers: afternoon 1:00–2:30, late 3:30–5:00).
```

with

```sql
-- Each type's windows (Carousels: morning 9:00–10:00, afternoon 2:30–3:30;
-- Explainers: afternoon 1:00–2:30, late 3:30–5:00; Last Few Days: morning
-- 9:00–10:00 on its days, lfd.settings.days).
```

(e) Directly after

```sql
CREATE INDEX IF NOT EXISTS idx_social_hub_idea_adjustments_day
    ON social_hub.idea_adjustments (ny_date, vertical, created_at);
```

add

```sql

-- Last Few Days joins the spine (spec 2026-10-13-last-few-days-design §7.2). The
-- inline CHECK above only shapes a new table; an existing one is widened here (D45).
ALTER TABLE social_hub.idea_adjustments DROP CONSTRAINT IF EXISTS idea_adjustments_vertical_check;
ALTER TABLE social_hub.idea_adjustments ADD CONSTRAINT idea_adjustments_vertical_check
    CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days'));
```

Check: `grep -c "'stories', 'last_few_days')" db/social_hub_schema.sql` prints `5`;
`grep -c "vertical = 'last_few_days' AND slot" db/social_hub_schema.sql` prints `3`;
`grep -c "'explainers', 'last_few_days') AND trigger" db/social_hub_schema.sql` prints `3`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx tsx --test tests/lfd-spine-schema.test.ts tests/social-spine-backfill.test.ts tests/social-hub-account.test.ts tests/social-fill.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add db/social_hub_schema.sql tests/lfd-spine-schema.test.ts
git commit -m "feat(lfd): last_few_days on the social_hub spine (CHECK lists, morning slot, triggers)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: STOP — schema apply is Tommy's**

Do not run the apply. Tell Tommy: "The spine schema now accepts `last_few_days`. To apply it to the shared database run
`node scripts/apply_social_hub_schema.js --apply` (additive and idempotent; every CHECK carries the full list, D45). Nothing in
production writes `last_few_days` rows until the worker is redeployed (Task 8)." Continue with Task 2 (offline work does not
need the apply).

---

### Task 2: Settings, the run queue, and adopting a claimed run

**Files:**
- Create: `lib/lfd/config.ts`, `lib/lfd/days.ts`, `lib/lfd/settings.ts`
- Modify: `lib/lfd/store.ts`, `lib/lfd/run.ts`
- Test: `tests/lfd-queue.test.ts` (create); `tests/lfd-run.test.ts` (append one test)

**Interfaces:**
- Consumes: `lfd.runs`, `lfd.settings` (Plan 1 schema); `addCalendarDays`, `PostingWindow` (`lib/instagram/window.ts`).
- Produces:
  - `DEFAULT_LFD_DAYS: readonly number[]`, `DEFAULT_LFD_RUN_CAP_USD = 1`, `LFD_SLOT = 'morning'`, `LFD_WINDOW: PostingWindow`,
    `LFD_PHOTO_STORY_PREFIX = 'lfd:'`;
  - `weekdayOfDate(nyDate): number`, `datesByWeekday(start, count, days, on): string[]`;
  - `type LfdQuery`, `type LfdSettings`, `parseLfdSettings(rows)`, `readLfdSettings(q)`, `carouselOffDays(q): Promise<number[]>`;
  - `type ClaimedRun = { id; trigger }`, `requestRun(q, trigger, capUsd): Promise<string | null>`,
    `claimRun(q, now?): Promise<ClaimedRun | null>`, `adoptRun(q, id, capUsd, nyDate): Promise<string>`, `failRun(q, id, error)`;
  - `LfdRunDeps.runId?: string`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lfd-queue.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { datesByWeekday, weekdayOfDate } from '@/lib/lfd/days';
import { carouselOffDays, parseLfdSettings, readLfdSettings } from '@/lib/lfd/settings';
import { adoptRun, claimRun, failRun, requestRun } from '@/lib/lfd/store';

import { openHubTestDb } from './fixtures/social-hub/pglite';

test('settings: defaults ship off, days fall back to Tue/Fri, a bad cap reads as null', () => {
  assert.deepEqual(parseLfdSettings([]), { autoRun: false, publishingLive: false, requireApproval: true, days: [2, 5], runCapUsd: 1, runCapRaw: 1 });
  const s = parseLfdSettings([
    { key: 'auto_run', value: true },
    { key: 'days', value: [5, 2, 2] },
    { key: 'run_cap_usd', value: '0.75' },
    { key: 'require_approval', value: false },
  ]);
  assert.deepEqual([s.autoRun, s.days, s.runCapUsd, s.requireApproval], [true, [2, 5], 0.75, false]);
  assert.deepEqual(parseLfdSettings([{ key: 'days', value: [9] }]).days, [2, 5]);
  assert.deepEqual(parseLfdSettings([{ key: 'days', value: [] }]).days, [2, 5]);
  for (const bad of ['abc', 0, -1, null, true]) assert.equal(parseLfdSettings([{ key: 'run_cap_usd', value: bad }]).runCapUsd, null, String(bad));
});

test('settings: read from lfd.settings; carousels give up its days only while auto_run is on', async () => {
  const { query } = await openHubTestDb();
  const s = await readLfdSettings(query);
  assert.deepEqual([s.autoRun, s.publishingLive, s.requireApproval, s.days, s.runCapUsd], [false, false, true, [2, 5], 1]);
  assert.deepEqual(await carouselOffDays(query), []);
  await query(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'auto_run'`);
  assert.deepEqual(await carouselOffDays(query), [2, 5]);
  assert.deepEqual(await carouselOffDays(async () => { throw new Error('relation "lfd.settings" does not exist'); }), []);
});

test('days: weekdays by New York date', () => {
  assert.equal(weekdayOfDate('2026-10-13'), 2);
  assert.deepEqual(datesByWeekday('2026-10-13', 7, [2, 5], true), ['2026-10-13', '2026-10-16']);
  assert.deepEqual(datesByWeekday('2026-10-13', 4, [2, 5], false), ['2026-10-14', '2026-10-15']);
});

test('runs: one queued at a time; the worker claims it when none is running', async () => {
  const { query } = await openHubTestDb();
  const id = await requestRun(query, 'scheduled', 1.5);
  assert.ok(id);
  assert.equal(await requestRun(query, 'manual', 1), null);
  assert.deepEqual(await claimRun(query), { id, trigger: 'scheduled' });
  assert.equal(await claimRun(query), null);
  const second = await requestRun(query, 'manual', 1);
  assert.equal(await claimRun(query), null, 'a run is still running');
  await failRun(query, id!, 'boom');
  assert.deepEqual(await claimRun(query), { id: second, trigger: 'manual' });
  const row = (await query<{ status: string; error: string; cap_usd: number }>(`SELECT status, error, cap_usd FROM lfd.runs WHERE id = $1`, [id])).rows[0]!;
  assert.deepEqual([row.status, row.error, row.cap_usd], ['failed', 'boom', 1.5]);
});

test('runs: an abandoned running run is failed so a queued one can start; adopting needs a running run', async () => {
  const { query } = await openHubTestDb();
  await query(`INSERT INTO lfd.runs (trigger, status, started_at) VALUES ('manual', 'running', now() - interval '3 hours')`);
  const id = await requestRun(query, 'scheduled', 1);
  assert.deepEqual(await claimRun(query), { id, trigger: 'scheduled' });
  assert.equal(await adoptRun(query, id!, 0.8, '2026-10-13'), id);
  const row = (await query<{ cap_usd: number; ny_date: string }>(`SELECT cap_usd, ny_date::text AS ny_date FROM lfd.runs WHERE id = $1`, [id])).rows[0]!;
  assert.deepEqual([row.cap_usd, row.ny_date], [0.8, '2026-10-13']);
  const abandoned = (await query<{ status: string; stop_reason: string }>(`SELECT status, stop_reason FROM lfd.runs WHERE id <> $1`, [id])).rows[0]!;
  assert.deepEqual([abandoned.status, abandoned.stop_reason], ['failed', 'abandoned']);
  await failRun(query, id!, 'x');
  await assert.rejects(adoptRun(query, id!, 1, '2026-10-13'), /is not running/);
});
```

Append to `tests/lfd-run.test.ts` (after the last test; it reuses that file's `deps()` helper):

```ts
test('a run the worker claimed is adopted, never inserted twice', async () => {
  const d = await deps();
  const { claimRun, requestRun } = await import('@/lib/lfd/store');
  await requestRun(d.query, 'manual', 1);
  const claimed = (await claimRun(d.query))!;
  const res = await runLastFewDays({ ...d, runId: claimed.id });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.runId, claimed.id);
  const runs = (await d.query<{ n: number; status: string }>(`SELECT count(*)::int AS n, max(status) AS status FROM lfd.runs`)).rows[0]!;
  assert.deepEqual([runs.n, runs.status], [1, 'ok']);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx tsx --test tests/lfd-queue.test.ts tests/lfd-run.test.ts`
Expected: FAIL with `Cannot find module '@/lib/lfd/days'`. The new `lfd-run` test fails too: `requestRun` does not exist yet,
and once it does, `runLastFewDays` ignores `runId` and `startRun` throws `a Last Few Days run is already in progress` (the
claimed row holds the single-running index).

- [ ] **Step 3: Write the code**

```ts
// lib/lfd/config.ts
/** Last Few Days constants shared by the worker, the scheduler and the hub (spec §7.3, §7.4). Imports types only. */
import type { PostingWindow } from '@/lib/instagram/window';

/** Tuesday and Friday (0 = Sunday), used when lfd.settings has no usable `days` row (LFD-01). */
export const DEFAULT_LFD_DAYS: readonly number[] = [2, 5];

/** The run cap when lfd.settings has no `run_cap_usd` row (spec §9). */
export const DEFAULT_LFD_RUN_CAP_USD = 1;

/** The one posting window, on its days: 9:00–10:00 AM New York (LFD-01; schedule_slot_check allows only this slot). */
export const LFD_SLOT = 'morning';
export const LFD_WINDOW: PostingWindow = { id: LFD_SLOT, label: '9:00–10:00 AM', startMinute: 9 * 60, endMinute: 10 * 60 };

/** social.used_photos `story_id` prefix for a published post's photos (spec §5, the shared 7-day rule). */
export const LFD_PHOTO_STORY_PREFIX = 'lfd:';
```

```ts
// lib/lfd/days.ts
/** Weekdays over New York calendar dates (pure). */
import { addCalendarDays } from '@/lib/instagram/window';

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD New York date. */
export function weekdayOfDate(nyDate: string): number {
  return new Date(`${nyDate}T12:00:00Z`).getUTCDay();
}

/** The `count` dates from `start` whose weekday is in `days` (`on`), or is not (`!on`). */
export function datesByWeekday(start: string, count: number, days: readonly number[], on: boolean): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const day = addCalendarDays(start, i);
    if (days.includes(weekdayOfDate(day)) === on) out.push(day);
  }
  return out;
}
```

```ts
// lib/lfd/settings.ts
/**
 * lfd.settings, read and checked (spec §7.1). SELECT only and no network, so
 * hub read code may use it (tests/social-hub-scope.test.ts). Writes live in
 * lib/content-type/posting.ts.
 */
import { DEFAULT_LFD_DAYS, DEFAULT_LFD_RUN_CAP_USD } from './config';

/** Any handle that runs SQL (HubQuery, SpineQuery, the social store's Query). */
export type LfdQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export type LfdSettings = {
  autoRun: boolean;
  publishingLive: boolean;
  /** On unless set to false (docs/social-overnight.md, Approval). */
  requireApproval: boolean;
  /** Weekdays it posts (0 = Sunday), sorted. */
  days: number[];
  /** The run cap, or null when the stored value is not a positive number: a run then refuses to start. */
  runCapUsd: number | null;
  runCapRaw: unknown;
};

export function parseLfdSettings(rows: ReadonlyArray<{ key: string; value: unknown }>): LfdSettings {
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const rawDays = get('days');
  const days =
    Array.isArray(rawDays) && rawDays.length > 0 && rawDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      ? [...new Set(rawDays as number[])].sort((a, b) => a - b)
      : [...DEFAULT_LFD_DAYS];
  const rawCap = rows.some((r) => r.key === 'run_cap_usd') ? get('run_cap_usd') : DEFAULT_LFD_RUN_CAP_USD;
  const cap = Number(rawCap);
  return {
    autoRun: get('auto_run') === true,
    publishingLive: get('publishing_live') === true,
    requireApproval: get('require_approval') !== false,
    days,
    runCapUsd: typeof rawCap !== 'boolean' && rawCap !== null && Number.isFinite(cap) && cap > 0 ? cap : null,
    runCapRaw: rawCap,
  };
}

export async function readLfdSettings(q: LfdQuery): Promise<LfdSettings> {
  const { rows } = await q(`SELECT key, value FROM lfd.settings`);
  return parseLfdSettings(rows as Array<{ key: string; value: unknown }>);
}

/**
 * The weekdays Carousels give up (LFD-02): Last Few Days' days while its
 * auto_run is on, else none. An unreadable lfd schema means none, so
 * Carousels never stop because of it.
 */
export async function carouselOffDays(q: LfdQuery): Promise<number[]> {
  try {
    const s = await readLfdSettings(q);
    return s.autoRun ? s.days : [];
  } catch {
    return [];
  }
}
```

In `lib/lfd/store.ts`, add at the end of the file:

```ts
export type ClaimedRun = { id: string; trigger: 'scheduled' | 'manual' };

/**
 * Queue a run: the 3:00 clock or the hub's "Make Last Few Days now" (docs/social-overnight.md
 * contract item 1). Null when one is already queued (the single-requested index). Only the worker runs it.
 */
export async function requestRun(q: HubQuery, trigger: 'scheduled' | 'manual', capUsd: number): Promise<string | null> {
  const { rows } = await q<{ id: string }>(
    `INSERT INTO lfd.runs (trigger, status, cap_usd) VALUES ($1, 'requested', $2) ON CONFLICT DO NOTHING RETURNING id::text AS id`,
    [trigger, capUsd],
  );
  return rows[0]?.id ?? null;
}

/** Claim the queued run when none is running. A run left running past ABANDONED_AFTER is failed first, as in startRun. */
export async function claimRun(q: HubQuery, now = new Date()): Promise<ClaimedRun | null> {
  await q(
    `UPDATE lfd.runs SET status = 'failed', finished_at = now(), stop_reason = 'abandoned'
      WHERE status = 'running' AND started_at < now() - interval '${ABANDONED_AFTER}'`,
  );
  try {
    const { rows } = await q<{ id: string; trigger: 'scheduled' | 'manual' }>(
      `UPDATE lfd.runs SET status = 'running', started_at = $1::timestamptz
        WHERE id = (
          SELECT id FROM lfd.runs
           WHERE status = 'requested'
             AND NOT EXISTS (SELECT 1 FROM lfd.runs r WHERE r.status = 'running')
           ORDER BY requested_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1)
        RETURNING id::text AS id, trigger`,
      [now.toISOString()],
    );
    return rows[0] ? { id: rows[0].id, trigger: rows[0].trigger } : null;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return null;
    throw err;
  }
}

/** The claimed run becomes this run: its cap and day are set, nothing new is inserted (spec §7.1 queue). */
export async function adoptRun(q: HubQuery, id: string, capUsd: number, nyDate: string): Promise<string> {
  const { rows } = await q<{ id: string }>(
    `UPDATE lfd.runs SET cap_usd = $2, ny_date = $3::date WHERE id = $1 AND status = 'running' RETURNING id::text AS id`,
    [id, capUsd, nyDate],
  );
  if (!rows[0]) throw new Error(`Last Few Days run ${id} is not running: it was not claimed, or it already finished`);
  return rows[0].id;
}

/** The worker's last word on a claimed run that threw before the engine finished it. */
export async function failRun(q: HubQuery, id: string, error: string): Promise<void> {
  await q(
    `UPDATE lfd.runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1 AND status = 'running'`,
    [id, error.slice(0, 2000)],
  );
}
```

In `lib/lfd/run.ts`:

Before:

```ts
import { finishRun, insertPost, previousPosts, recentPhotoUrls, startRun, usedIdeaIds } from './store';
```

After:

```ts
import { adoptRun, finishRun, insertPost, previousPosts, recentPhotoUrls, startRun, usedIdeaIds } from './store';
```

Before (inside `export type LfdRunDeps = {`):

```ts
  /** Claude and Jev spend so far (the CLI wires the run budget and Jev tally here). */
  spend: () => { claudeUsd: number; jevUsd: number };
};
```

After:

```ts
  /** Claude and Jev spend so far (the CLI wires the run budget and Jev tally here). */
  spend: () => { claudeUsd: number; jevUsd: number };
  /** A run the worker already claimed (lfd.runs status running): it is adopted instead of inserting a new row. */
  runId?: string;
};
```

Before (first line of `runLastFewDays`'s body after `const nyDate = nyDateKey(d.now);`):

```ts
  const runId = await startRun(d.query, d.trigger, d.capUsd, nyDate);
```

After:

```ts
  const runId = d.runId ? await adoptRun(d.query, d.runId, d.capUsd, nyDate) : await startRun(d.query, d.trigger, d.capUsd, nyDate);
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx tsx --test tests/lfd-queue.test.ts tests/lfd-run.test.ts tests/lfd-store.test.ts`
Expected: PASS. Then the typecheck line from Global Constraints prints nothing.

- [ ] **Step 5: Commit**

```bash
git add lib/lfd/config.ts lib/lfd/days.ts lib/lfd/settings.ts lib/lfd/store.ts lib/lfd/run.ts tests/lfd-queue.test.ts tests/lfd-run.test.ts
git commit -m "feat(lfd): settings reader, run queue (request, claim, adopt, fail)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Spine vertical, placement, feed spacing, and Carousels giving up LFD days

**Files:**
- Modify: `lib/social-hub/spine.ts`, `lib/social-hub/fill.ts`, `lib/instagram/feed-spacing.ts`, `lib/social-hub/placement.ts`,
  `lib/social/overnight/schedule.ts`
- Test: `tests/lfd-placement.test.ts` (create)

**Interfaces:**
- Consumes: `LFD_WINDOW`, `DEFAULT_LFD_DAYS` (Task 2), `readLfdSettings`, `carouselOffDays`, `datesByWeekday`.
- Produces:
  - `SpineVertical` and `FillVertical` include `'last_few_days'`;
  - `FeedSchema` includes `'lfd'`; `busyFeedTimes` counts LFD bookings;
  - `placementRules(q, 'last_few_days')` → `{ vertical, spaced: true, windows: [{ ...LFD_WINDOW, name: 'Morning', days }] }`;
    `placementRules(q, 'carousels')` gives each window `days` without LFD's days while LFD `auto_run` is on;
  - `schedulePost` (Carousels) never books an LFD day while LFD `auto_run` is on.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lfd-placement.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { busyFeedTimes } from '@/lib/instagram/feed-spacing';
import { placementRules, planPlacement } from '@/lib/social-hub/placement';
import { bookSlot, ensureContentItem, type SpineQuery } from '@/lib/social-hub/spine';
import { schedulePost } from '@/lib/social/overnight/schedule';
import type { Query } from '@/lib/social/store/pg';

import { openHubTestDb } from './fixtures/social-hub/pglite';

/** Tuesday 2026-10-13, 8:00 AM New York. */
const TUE = new Date('2026-10-13T12:00:00Z');

test('placement: Last Few Days has one morning window on its days, spaced from other feed posts', async () => {
  const { query } = await openHubTestDb();
  const q = query as SpineQuery;
  const rules = await placementRules(q, 'last_few_days');
  assert.deepEqual(rules.windows.map((w) => [w.id, w.startMinute, w.endMinute, w.days]), [['morning', 540, 600, [2, 5]]]);
  assert.equal(rules.spaced, true);
  const wed = await planPlacement(q, { vertical: 'last_few_days', nyDate: '2026-10-14', slot: 'morning', now: TUE, rng: () => 0 });
  assert.equal(wed.ok, false);
  assert.match(wed.ok ? '' : wed.note, /doesn’t post on Wednesdays/);
  assert.equal((await planPlacement(q, { vertical: 'last_few_days', nyDate: '2026-10-13', slot: 'morning', now: TUE, rng: () => 0 })).ok, true);
  assert.equal((await planPlacement(q, { vertical: 'last_few_days', nyDate: '2026-10-13', slot: 'afternoon', now: TUE })).ok, false);
});

test('placement: carousels give up Tuesday and Friday only while Last Few Days auto_run is on', async () => {
  const { query } = await openHubTestDb();
  const q = query as SpineQuery;
  assert.deepEqual((await placementRules(q, 'carousels')).windows.map((w) => w.days), [undefined, undefined]);
  await query(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'auto_run'`);
  assert.deepEqual((await placementRules(q, 'carousels')).windows.map((w) => w.days), [[0, 1, 3, 4, 6], [0, 1, 3, 4, 6]]);
});

test('a carousel approved on a Tuesday is booked Tuesday, or Wednesday while Last Few Days is on', async () => {
  const { query } = await openHubTestDb();
  const insert = async (slug: string) =>
    (await query<{ id: string }>(
      `INSERT INTO social.posts (slug, title, status, render, origin, slide_objects) VALUES ($1, 't', 'review', '{}'::jsonb, 'pipeline', '["a","b"]'::jsonb) RETURNING id::text AS id`,
      [slug],
    )).rows[0]!.id;
  const q = query as unknown as Query;
  const before = await schedulePost(q, await insert('c-1'), 'user', TUE, undefined, () => 0);
  assert.equal(before.scheduled, true);
  await query(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'auto_run'`);
  const after = await schedulePost(q, await insert('c-2'), 'user', TUE, undefined, () => 0);
  assert.equal(after.scheduled, true);
  const days = (await query<{ d: string }>(`SELECT ny_date::text AS d FROM social_hub.schedule ORDER BY created_at`)).rows.map((r) => r.d);
  assert.deepEqual(days, ['2026-10-13', '2026-10-14']);
});

test('feed spacing counts a booked Last Few Days post', async () => {
  const { query } = await openHubTestDb();
  const q = query as SpineQuery;
  const item = await ensureContentItem(q, { vertical: 'last_few_days', format: 'feed', nativeRef: 'p1', ideaRef: null });
  await bookSlot(q, { vertical: 'last_few_days', itemId: item, nyDate: '2026-10-13', slot: 'morning', publishAt: new Date('2026-10-13T13:20:00Z'), source: 'auto' });
  assert.ok((await busyFeedTimes(q, TUE)).some((b) => b.toISOString() === '2026-10-13T13:20:00.000Z'));
  assert.equal((await busyFeedTimes(q, TUE, 'lfd')).length, 0);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx --test tests/lfd-placement.test.ts`
Expected: FAIL: `Cannot read properties of undefined (reading 'windows')` (no `last_few_days` case), the carousel days stay
`[undefined, undefined]`, the second carousel lands on `2026-10-13`, and spacing misses the LFD booking.

- [ ] **Step 3: Write the code**

`lib/social-hub/spine.ts` — before:

```ts
export type SpineVertical = 'carousels' | 'explainers' | 'reels' | 'stories';
```

after:

```ts
export type SpineVertical = 'carousels' | 'explainers' | 'reels' | 'stories' | 'last_few_days';
```

`lib/social-hub/fill.ts` — before:

```ts
export type FillVertical = 'carousels' | 'explainers' | 'reels' | 'stories';
```

after:

```ts
export type FillVertical = 'carousels' | 'explainers' | 'reels' | 'stories' | 'last_few_days';
```

`lib/instagram/feed-spacing.ts` — before:

```ts
export type FeedSchema = 'explainers' | 'social';

const FEED_SCHEMAS: readonly FeedSchema[] = ['explainers', 'social'];
```

after:

```ts
/** Feed-posting types by their schema: `social` is Carousels, `lfd` is Last Few Days. */
export type FeedSchema = 'explainers' | 'social' | 'lfd';

const FEED_SCHEMAS: readonly FeedSchema[] = ['explainers', 'social', 'lfd'];
```

and before:

```ts
  social: `SELECT publish_at FROM social_hub.schedule WHERE vertical = 'carousels' AND ${ACTIVE}`,
};
```

after:

```ts
  social: `SELECT publish_at FROM social_hub.schedule WHERE vertical = 'carousels' AND ${ACTIVE}`,
  lfd: `SELECT publish_at FROM social_hub.schedule WHERE vertical = 'last_few_days' AND ${ACTIVE}`,
};
```

`lib/social-hub/placement.ts` — add imports after `import { CAROUSEL_SLOTS } from '@/lib/social/overnight/config';`:

```ts
import { DEFAULT_LFD_DAYS, LFD_WINDOW } from '@/lib/lfd/config';
import { carouselOffDays, readLfdSettings } from '@/lib/lfd/settings';
```

Before:

```ts
const TYPE_NAME: Record<SpineVertical, string> = {
  carousels: 'Carousels',
  explainers: 'Explainers',
  reels: 'Text on Screen',
  stories: 'Stories',
};
```

After:

```ts
const TYPE_NAME: Record<SpineVertical, string> = {
  carousels: 'Carousels',
  explainers: 'Explainers',
  reels: 'Text on Screen',
  stories: 'Stories',
  last_few_days: 'Last Few Days posts',
};

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
```

Before:

```ts
    case 'carousels':
      return { vertical, spaced: true, windows: named(CAROUSEL_SLOTS, { morning: 'Morning', afternoon: 'Afternoon' }) };
```

After:

```ts
    case 'carousels': {
      // LFD-02: while Last Few Days' auto_run is on, its days have no carousel windows.
      const off = await carouselOffDays(query);
      const windows = named(CAROUSEL_SLOTS, { morning: 'Morning', afternoon: 'Afternoon' });
      return { vertical, spaced: true, windows: off.length ? windows.map((w) => ({ ...w, days: EVERY_DAY.filter((d) => !off.includes(d)) })) : windows };
    }
    case 'last_few_days': {
      // One 9:00–10:00 AM window on its days (spec §7.4); a feed post, so spaced.
      const days = await readLfdSettings(query).then((s) => s.days).catch(() => [...DEFAULT_LFD_DAYS]);
      return { vertical, spaced: true, windows: [{ ...LFD_WINDOW, name: 'Morning', days }] };
    }
```

`lib/social/overnight/schedule.ts` — add imports after `import { approveItem, bookSlot, rejectItem } from '@/lib/social-hub/spine';`:

```ts
import { datesByWeekday } from '@/lib/lfd/days';
import { carouselOffDays } from '@/lib/lfd/settings';
```

and change the config import — before:

```ts
import { DEFAULT_POSTS_PER_DAY, SOCIAL_TIMEZONE } from './config';
```

after:

```ts
import { CAROUSEL_SLOTS, DEFAULT_POSTS_PER_DAY, SOCIAL_TIMEZONE } from './config';
```

In `schedulePost`, before:

```ts
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const busy = [...(await busyFeedTimes(query, now, 'social')), ...(await ownFeedTimes(query, 'social', now))];
    const choice = chooseCarouselSlots(now, await takenSlots(query, calendarDateKey(now, SOCIAL_TIMEZONE)), busy, await postsPerDay(query), rng, throughDate);
```

after:

```ts
  // LFD-02: while Last Few Days' auto_run is on, its days have no carousel windows.
  const off = await carouselOffDays(query);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const busy = [...(await busyFeedTimes(query, now, 'social')), ...(await ownFeedTimes(query, 'social', now))];
    const today = calendarDateKey(now, SOCIAL_TIMEZONE);
    const taken = await takenSlots(query, today);
    for (const day of datesByWeekday(today, 14, off, true)) for (const w of CAROUSEL_SLOTS) taken.add(slotTakenKey(day, w.id));
    const choice = chooseCarouselSlots(now, taken, busy, await postsPerDay(query), rng, throughDate);
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx tsx --test tests/lfd-placement.test.ts tests/social-hub-placement.test.ts tests/social-overnight.test.ts tests/social-fill.test.ts tests/social-hub-scope.test.ts`
Expected: PASS. Typecheck line prints nothing.

- [ ] **Step 5: Commit**

```bash
git add lib/social-hub/spine.ts lib/social-hub/fill.ts lib/instagram/feed-spacing.ts lib/social-hub/placement.ts lib/social/overnight/schedule.ts tests/lfd-placement.test.ts
git commit -m "feat(lfd): placement window on its days, feed spacing, carousels give up LFD days

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shared feed-carousel publishing, and LFD publishing

**Files:**
- Modify: `lib/social/overnight/publish.ts` (full replacement below), `tests/fixtures/lfd/seed.ts`
- Create: `lib/lfd/items.ts`, `lib/lfd/publish.ts`
- Test: `tests/lfd-publish.test.ts` (create)

**Interfaces:**
- Consumes: `checkAccountQuota`, `CarouselMetaClient`, `ensureContentItem`, `insertPost` (Plan 1), `LFD_PHOTO_STORY_PREFIX`.
- Produces:
  - `publish.ts`: `type FeedVertical = 'carousels' | 'last_few_days'`, `checkFeedPayload(objects, caption)`,
    `queueFeedAttempt(query, { vertical, itemId, trigger, caption, imageObjects })`, `failStaleAttempts(query, vertical?)`,
    `claimFeedAttempt(query, vertical?)`, `carryFeedAttempt(deps, id, { vertical, onPublished })`; `queuePublish`,
    `carryAttempt`, `claimAndPublish`, `carouselCaption`, `markScheduleForAttempt` keep their signatures and messages;
  - `lfdItemId(query, postId): Promise<string | null>`;
  - `queueLfdPublish(query, postId, trigger)`, `failStaleLfdAttempts(query)`, `markLfdPublished(query, postId, finishedAt)`,
    `recordLfdPhotos(query, postId, at): Promise<number>`, `carryLfdAttempt(deps, id)`, `claimAndPublishLfd(deps)`;
  - `seedLfdPost(q, opts?)` test fixture.

- [ ] **Step 1: Add the seed helper and write the failing test**

In `tests/fixtures/lfd/seed.ts`, add after `import type { HubQuery } from '@/lib/social-hub/db';`:

```ts
import { insertPost } from '@/lib/lfd/store';
```

and at the end of the file:

```ts
/**
 * A finished Last Few Days post (3 stories; 8 slide objects in Storage) for
 * spine, publish and hub tests. Story 2's photo is a logo (never recorded as used).
 */
export async function seedLfdPost(
  q: HubQuery,
  o: { nyDate?: string; slug?: string; status?: string; slides?: number; short?: boolean; fitProblems?: string[]; renderProblems?: string[] } = {},
): Promise<string> {
  const nyDate = o.nyDate ?? '2026-10-13';
  const slug = o.slug ?? `lfd-${nyDate}`;
  const stories = [
    { lane: 'major', origin: 'carousel', url: 'https://big.com/haiku', outlet: 'The Verge', headline: 'Anthropic Releases Claude Haiku 5.5', body: 'It is out today', photo: { src: 'https://p/haiku.jpg', credit: 'Anthropic', kind: 'scene' } },
    { lane: 'rundown', origin: 'reels', url: 'https://n.com/1', outlet: 'Wired', headline: 'Niche Thing 1 Happens', body: 'It happened', photo: { src: 'https://p/logo.png', credit: 'Logo', kind: 'logo' } },
    { lane: 'rundown', origin: 'reels', url: 'https://n.com/2', outlet: 'Wired', headline: 'Niche Thing 2 Happens', body: 'It happened', photo: { src: 'https://p/person.jpg', credit: 'Jane Doe / CC BY', kind: 'person' } },
  ];
  const render = {
    caption: 'Caption',
    slides: [
      { position: 0, layoutVariant: 'lfd_cover', altText: 'Do you realize what just happened in AI in the last few days? Trending in AI.' },
      ...stories.map((s, i) => ({ position: i + 1, layoutVariant: 'lfd_story', altText: s.headline, lfdStory: { setup: '', headline: s.headline, highlight: '', names: [], body: s.body }, photoUrl: s.photo.src })),
      { position: stories.length + 1, layoutVariant: 'follow', altText: 'Follow Helios' },
    ],
  };
  const id = await insertPost(q, {
    runId: null,
    slug,
    nyDate,
    ideaIds: stories.map((s) => s.url),
    stories,
    render,
    caption: 'Do you realize what just happened in AI in the last few days? Swipe ⬅️ to catch up.',
    slideObjects: Array.from({ length: o.slides ?? 8 }, (_, i) => `lfd/${slug}/slide-${String(i + 1).padStart(2, '0')}.jpg`),
    fitProblems: o.fitProblems ?? [],
    renderProblems: o.renderProblems ?? [],
    short: o.short ?? false,
  });
  if (o.status && o.status !== 'review') await q(`UPDATE lfd.posts SET status = $2 WHERE id = $1`, [id, o.status]);
  return id;
}
```

```ts
// tests/lfd-publish.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { lfdItemId } from '@/lib/lfd/items';
import { claimAndPublishLfd, queueLfdPublish } from '@/lib/lfd/publish';
import { rejectItem } from '@/lib/social-hub/spine';
import type { CarouselMetaClient } from '@/lib/social/overnight/meta';
import type { Query } from '@/lib/social/store/pg';

import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

function stubMeta(overrides: Partial<CarouselMetaClient> = {}) {
  const calls: string[] = [];
  let n = 0;
  const meta: CarouselMetaClient = {
    async createImageItem(url) { calls.push(`item ${url}`); return `child-${++n}`; },
    async createCarousel(children, caption) { calls.push(`carousel ${children.length} ${caption.length}`); return 'parent-1'; },
    async containerStatus() { calls.push('status'); return { statusCode: 'FINISHED', status: null }; },
    async publishContainer(id) { calls.push(`publish ${id}`); return 'media-1'; },
    async permalink() { return 'https://instagram.com/p/lfd'; },
    async publishingLimit() { return { quotaUsage: 3, quotaTotal: 100 }; },
    ...overrides,
  };
  return { meta, calls };
}

const sign = async (objectPath: string) => `https://signed/${objectPath}`;

test('a review post with its slides queues one attempt on the spine; a second is refused', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const id = await seedLfdPost(query);
  assert.equal((await queueLfdPublish(q, id, 'approve')).queued, true);
  const row = (await q(`SELECT a.vertical, a.trigger, a.caption, a.payload, ci.native_ref, ci.idea_ref, ci.format
                           FROM social_hub.publish_attempts a JOIN social_hub.content_items ci ON ci.id = a.content_item_id`)).rows[0];
  assert.deepEqual([row.vertical, row.trigger, row.native_ref, row.idea_ref, row.format], ['last_few_days', 'approve', id, null, 'feed']);
  assert.equal(row.payload.image_objects.length, 8);
  assert.match(row.caption, /^Do you realize/);
  const second = await queueLfdPublish(q, id, 'force');
  assert.deepEqual([second.queued, second.queued ? '' : second.note], [false, 'This Last Few Days post is already publishing or published.']);
});

test('only a review post with 2–10 images queues', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const rejected = await seedLfdPost(query, { slug: 'lfd-a', status: 'rejected' });
  const one = await seedLfdPost(query, { slug: 'lfd-b', slides: 1 });
  const r1 = await queueLfdPublish(q, rejected, 'approve');
  assert.match(r1.queued ? '' : r1.note, /Only posts in review publish \(this one is rejected\)/);
  const r2 = await queueLfdPublish(q, one, 'approve');
  assert.match(r2.queued ? '' : r2.note, /needs 2–10 slide images in Storage \(has 1\)/);
  assert.equal((await q(`SELECT count(*)::int AS n FROM social_hub.publish_attempts`)).rows[0].n, 0);
});

test('publishing marks the lfd post, the attempt and the photos, never a carousel row', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const id = await seedLfdPost(query);
  await queueLfdPublish(q, id, 'approve');
  const { meta, calls } = stubMeta();
  const out = await claimAndPublishLfd({ query: q, meta, signImage: sign, sleep: async () => undefined, now: () => Date.parse('2026-10-13T13:40:00Z') });
  assert.equal(out?.status, 'published');
  assert.equal(calls.filter((c) => c.startsWith('item ')).length, 8);
  assert.equal(calls[0], 'item https://signed/lfd/lfd-2026-10-13/slide-01.jpg');
  const post = (await q(`SELECT status, published_at FROM lfd.posts WHERE id = $1`, [id])).rows[0];
  assert.equal(post.status, 'published');
  assert.equal(new Date(post.published_at).toISOString(), '2026-10-13T13:40:00.000Z');
  const attempt = (await q(`SELECT status, media_id, permalink FROM social_hub.publish_attempts`)).rows[0];
  assert.deepEqual([attempt.status, attempt.media_id, attempt.permalink], ['published', 'media-1', 'https://instagram.com/p/lfd']);
  const photos = (await q(`SELECT url, story_id, slide, source, post_id FROM social.used_photos ORDER BY slide`)).rows;
  assert.deepEqual(photos.map((p) => [p.url, p.story_id, p.slide, p.source, p.post_id]), [
    ['https://p/haiku.jpg', `lfd:${id}`, 2, 'lfd', null],
    ['https://p/person.jpg', `lfd:${id}`, 4, 'lfd', null],
  ]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM social.posts`)).rows[0].n, 0);
});

test('a rejected item fails at carry without making containers', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const id = await seedLfdPost(query);
  await queueLfdPublish(q, id, 'approve');
  await rejectItem(q, (await lfdItemId(q, id))!);
  const { meta, calls } = stubMeta();
  const out = await claimAndPublishLfd({ query: q, meta, signImage: sign, sleep: async () => undefined });
  assert.equal(out?.status, 'failed');
  assert.deepEqual(calls, []);
  assert.match((await q(`SELECT error FROM social_hub.publish_attempts`)).rows[0].error, /This Last Few Days post was rejected after its slot opened/);
  assert.equal((await q(`SELECT status FROM lfd.posts WHERE id = $1`, [id])).rows[0].status, 'review');
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx --test tests/lfd-publish.test.ts`
Expected: FAIL with `Cannot find module '@/lib/lfd/items'`.

- [ ] **Step 3: Write the code**

Replace the whole of `lib/social/overnight/publish.ts` with (re-read it first; if another session changed it since
`e0e4c1a`, fold their change into this text):

```ts
import type { Query } from '@/lib/social/store/pg';
import type { Post as RenderPost } from '@/lib/social/render/types';

import {
  CAPTION_MAX_CHARS,
  CAROUSEL_MAX_ITEMS,
  CAROUSEL_MIN_ITEMS,
  PUBLISH_IMAGE_URL_SECONDS,
  PUBLISH_POLL_SECONDS,
  PUBLISH_POLL_TIMEOUT_MINUTES,
  PUBLISH_STALE_MINUTES,
} from './config';
import { checkAccountQuota } from '@/lib/instagram/account-gate';

import { carouselItemId } from './items';
import type { CarouselMetaClient } from './meta';

/**
 * Feed-carousel publish attempts on the lifecycle spine (social_hub.publish_attempts):
 * requested → creating (item + parent containers) → processing (status poll) →
 * publishing (media_publish) → published | failed. Carousels and Last Few Days
 * post the same way (an image set as one CAROUSEL container); each type keeps
 * its own queue rule and its own "mark published" step (`onPublished`). A post
 * posts once. One publish at a time across every type already on the spine:
 * they share one Instagram account (D36).
 */

export type PublishTrigger = 'approve' | 'auto' | 'force';

/** The spine verticals that post an image set as a feed carousel. */
export type FeedVertical = 'carousels' | 'last_few_days';

const NOUN: Record<FeedVertical, string> = { carousels: 'carousel', last_few_days: 'Last Few Days post' };

export type Queued =
  | { queued: true; id: string }
  | { queued: false; note: string; terminal: boolean; alreadyPublished?: true };

/** The caption Instagram gets: the post's caption, then its photo credits. */
export function carouselCaption(render: Pick<RenderPost, 'caption' | 'attributionBlock'>): string {
  return [render.caption?.trim(), render.attributionBlock?.trim()].filter(Boolean).join('\n\n');
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

/** Why an image set can't go to Instagram, or null: 2–10 images in Storage and a caption within the limit. */
export function checkFeedPayload(imageObjects: readonly string[], caption: string): string | null {
  if (imageObjects.length < CAROUSEL_MIN_ITEMS || imageObjects.length > CAROUSEL_MAX_ITEMS) {
    return `The post needs ${CAROUSEL_MIN_ITEMS}–${CAROUSEL_MAX_ITEMS} slide images in Storage (has ${imageObjects.length}).`;
  }
  if (!caption) return 'The post has no caption.';
  if (caption.length > CAPTION_MAX_CHARS) return `The caption with credits is ${caption.length} characters; Instagram takes ${CAPTION_MAX_CHARS}.`;
  return null;
}

/** One requested attempt for an item. A second attempt in flight or published is refused by the spine's indexes. */
export async function queueFeedAttempt(
  query: Query,
  a: { vertical: FeedVertical; itemId: string; trigger: PublishTrigger; caption: string; imageObjects: readonly string[] },
): Promise<Queued> {
  try {
    const inserted = await query(
      `INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption, payload)
       VALUES ($1, $2, $3, 'requested', $4, $5::jsonb) RETURNING id`,
      [a.itemId, a.vertical, a.trigger, a.caption, JSON.stringify({ image_objects: a.imageObjects })],
    );
    return { queued: true, id: inserted.rows[0].id as string };
  } catch (error) {
    if (isUniqueViolation(error)) return { queued: false, note: `This ${NOUN[a.vertical]} is already publishing or published.`, terminal: false };
    throw error;
  }
}

/** Queue one post for Instagram. Only a finished pipeline post in review, with its slides in Storage, can go. */
export async function queuePublish(query: Query, postId: string, trigger: PublishTrigger): Promise<Queued> {
  const { rows } = await query(
    `SELECT id, status, origin, render, slide_objects FROM social.posts WHERE id = $1`,
    [postId],
  );
  const post = rows[0];
  if (!post) return { queued: false, note: 'The post is gone.', terminal: true };
  if (post.status === 'published') return { queued: false, note: 'This carousel is already published.', terminal: true, alreadyPublished: true };
  if (post.status !== 'review') return { queued: false, note: `Only posts in review publish (this one is ${post.status}).`, terminal: true };
  if (post.origin !== 'pipeline') return { queued: false, note: 'Development posts never publish.', terminal: true };
  const objects = (post.slide_objects ?? []) as string[];
  const caption = carouselCaption(post.render as RenderPost);
  const problem = checkFeedPayload(objects, caption);
  if (problem) return { queued: false, note: problem, terminal: true };
  const itemId = await carouselItemId(query, postId);
  if (!itemId) return { queued: false, note: 'The post is gone.', terminal: true };
  return queueFeedAttempt(query, { vertical: 'carousels', itemId, trigger, caption, imageObjects: objects });
}

/** Fail this type's attempts a dead worker left mid-publish. */
export async function failStaleAttempts(query: Query, vertical: FeedVertical = 'carousels'): Promise<void> {
  await query(
    `UPDATE social_hub.publish_attempts
        SET status = 'failed', finished_at = now(), error = $3
      WHERE vertical = $2 AND status IN ('creating', 'processing', 'publishing')
        AND started_at < now() - make_interval(mins => $1)`,
    [PUBLISH_STALE_MINUTES, vertical, `The worker stopped while this ${NOUN[vertical]} was publishing. Check Instagram before trying again.`],
  );
}

/** Claim this type's oldest queued attempt while nothing is in flight on the account. */
export async function claimFeedAttempt(query: Query, vertical: FeedVertical = 'carousels'): Promise<string | null> {
  await failStaleAttempts(query, vertical);
  const { rows } = await query(
    `UPDATE social_hub.publish_attempts SET status = 'creating', started_at = now()
      WHERE id = (
        SELECT id FROM social_hub.publish_attempts
         WHERE vertical = $1 AND status = 'requested'
           AND NOT EXISTS (SELECT 1 FROM social_hub.publish_attempts a WHERE a.status IN ('creating', 'processing', 'publishing') AND a.started_at > now() - interval '30 minutes')
         ORDER BY requested_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING id`,
    [vertical],
  );
  return (rows[0]?.id as string | undefined) ?? null;
}

async function update(query: Query, id: string, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields);
  const sets = keys.map((key, index) => `${key} = $${index + 2}`);
  await query(`UPDATE social_hub.publish_attempts SET ${sets.join(', ')} WHERE id = $1`, [id, ...keys.map((key) => fields[key])]);
}

export async function markScheduleForAttempt(query: Query, attemptId: string, status: 'published' | 'failed', error: string | null): Promise<void> {
  await query(
    `UPDATE social_hub.schedule SET status = $2, error = $3 WHERE publish_attempt_id = $1 AND status = 'publishing'`,
    [attemptId, status, error],
  );
}

export type PublishDeps = {
  query: Query;
  meta: CarouselMetaClient;
  signImage: (objectPath: string, expiresIn: number) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** A type's own step once Instagram has the post: mark its content row published (`nativeRef` = content_items.native_ref). */
export type FeedPublishHooks = {
  vertical: FeedVertical;
  onPublished: (query: Query, nativeRef: string, finishedAt: string) => Promise<void>;
};

/**
 * Carry one claimed attempt (status `creating`) to Instagram: the rejection
 * check (D41), the account gate, one image container per slide, the CAROUSEL
 * parent with the caption, the status poll, the publish, then the type's hook
 * and the slot. Any failure fails the attempt and its slot, with the reason.
 */
export async function carryFeedAttempt(deps: PublishDeps, id: string, hooks: FeedPublishHooks): Promise<{ id: string; status: 'published' | 'failed' }> {
  const { query, meta } = deps;
  const noun = NOUN[hooks.vertical];
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const statusLog: Array<{ at: string; statusCode: string; status: string | null }> = [];
  try {
    const { rows } = await query(
      `SELECT ci.native_ref, a.caption, a.payload->'image_objects' AS image_objects
         FROM social_hub.publish_attempts a JOIN social_hub.content_items ci ON ci.id = a.content_item_id
        WHERE a.id = $1`,
      [id],
    );
    const attempt = rows[0] as { native_ref: string; caption: string; image_objects: string[] };

    // Rejected after its slot opened: never posts (D41).
    const { rows: rejected } = await query(
      `SELECT 1 FROM social_hub.publish_attempts a JOIN social_hub.approvals ap ON ap.content_item_id = a.content_item_id
        WHERE a.id = $1 AND ap.decision = 'rejected'`,
      [id],
    );
    if (rejected[0]) throw new Error(`This ${noun} was rejected after its slot opened; nothing was posted.`);

    // The account is shared by every content type (lib/instagram/account-gate.ts).
    const gate = await checkAccountQuota({ ops: meta, query });
    if (!gate.ok) throw new Error(gate.message);

    const children: string[] = [];
    for (const objectPath of attempt.image_objects) {
      children.push(await meta.createImageItem(await deps.signImage(objectPath, PUBLISH_IMAGE_URL_SECONDS)));
    }
    await update(query, id, { child_container_ids: JSON.stringify(children) });
    const containerId = await meta.createCarousel(children, attempt.caption);
    await update(query, id, { status: 'processing', container_id: containerId });

    const deadline = now() + PUBLISH_POLL_TIMEOUT_MINUTES * 60_000;
    for (;;) {
      const status = await meta.containerStatus(containerId);
      statusLog.push({ at: new Date(now()).toISOString(), ...status });
      if (status.statusCode === 'FINISHED') break;
      if (status.statusCode === 'ERROR' || status.statusCode === 'EXPIRED') {
        throw new Error(`Instagram could not process the ${noun} (${status.statusCode}): ${status.status ?? 'no detail'}`);
      }
      if (now() >= deadline) throw new Error(`The container was still ${status.statusCode} after ${PUBLISH_POLL_TIMEOUT_MINUTES} minutes.`);
      await sleep(PUBLISH_POLL_SECONDS * 1000);
    }

    await update(query, id, { status: 'publishing', status_log: JSON.stringify(statusLog) });
    const mediaId = await meta.publishContainer(containerId);
    const permalink = await meta.permalink(mediaId).catch(() => null);
    const finishedAt = new Date(now()).toISOString();
    await update(query, id, { status: 'published', media_id: mediaId, permalink, finished_at: finishedAt, status_log: JSON.stringify(statusLog) });
    await hooks.onPublished(query, attempt.native_ref, finishedAt);
    await markScheduleForAttempt(query, id, 'published', null).catch(() => undefined);
    return { id, status: 'published' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await update(query, id, { status: 'failed', error: message, finished_at: new Date(now()).toISOString(), status_log: JSON.stringify(statusLog) }).catch(() => undefined);
    await markScheduleForAttempt(query, id, 'failed', message).catch(() => undefined);
    return { id, status: 'failed' };
  }
}

/** Carry one claimed carousel attempt; on success the social.posts row is marked published. */
export async function carryAttempt(deps: PublishDeps, id: string): Promise<{ id: string; status: 'published' | 'failed' }> {
  return carryFeedAttempt(deps, id, {
    vertical: 'carousels',
    onPublished: async (query, postId, finishedAt) => {
      await query(`UPDATE social.posts SET status = 'published', published_at = $2::timestamptz WHERE id = $1`, [postId, finishedAt]);
    },
  });
}

/** Claim one queued carousel and carry it to Instagram. */
export async function claimAndPublish(deps: PublishDeps): Promise<{ id: string; status: 'published' | 'failed' } | null> {
  const id = await claimFeedAttempt(deps.query, 'carousels');
  if (!id) return null;
  return carryAttempt(deps, id);
}
```

```ts
// lib/lfd/items.ts
/**
 * A Last Few Days post on the lifecycle spine (spec §7.2): the content item is
 * the lfd.posts row (native_ref), format 'feed', no post idea (idea_ref NULL:
 * a post is a bundle of stories, not one idea).
 */
import { ensureContentItem, type SpineQuery } from '@/lib/social-hub/spine';

export async function lfdItemId(query: SpineQuery, postId: string): Promise<string | null> {
  // native_ref is the database's own id text, never the caller's spelling of it (D41).
  const { rows } = await query(`SELECT id::text AS id FROM lfd.posts WHERE id = $1`, [postId]);
  if (!rows[0]) return null;
  return ensureContentItem(query, { vertical: 'last_few_days', format: 'feed', nativeRef: rows[0].id as string, ideaRef: null });
}
```

```ts
// lib/lfd/publish.ts
/**
 * Publishing a Last Few Days post (spec §7.4): the same Instagram feed-carousel
 * calls and account gate as Carousels (lib/social/overnight/publish.ts
 * carryFeedAttempt). Its own steps: the queue rule (an lfd.posts row in review
 * with 2–10 slides), marking lfd.posts published, and recording its photos in
 * social.used_photos for the shared 7-day no-repeat rule (spec §5).
 */
import {
  carryFeedAttempt,
  checkFeedPayload,
  claimFeedAttempt,
  failStaleAttempts,
  queueFeedAttempt,
  type PublishDeps,
  type PublishTrigger,
  type Queued,
} from '@/lib/social/overnight/publish';
import type { Query } from '@/lib/social/store/pg';

import { LFD_PHOTO_STORY_PREFIX } from './config';
import { lfdItemId } from './items';

export async function queueLfdPublish(query: Query, postId: string, trigger: PublishTrigger): Promise<Queued> {
  const { rows } = await query(`SELECT id::text AS id, status, caption, slide_objects FROM lfd.posts WHERE id = $1`, [postId]);
  const post = rows[0];
  if (!post) return { queued: false, note: 'The post is gone.', terminal: true };
  if (post.status === 'published') return { queued: false, note: 'This Last Few Days post is already published.', terminal: true, alreadyPublished: true };
  if (post.status !== 'review') return { queued: false, note: `Only posts in review publish (this one is ${post.status}).`, terminal: true };
  const objects = (Array.isArray(post.slide_objects) ? post.slide_objects : []) as string[];
  // The engine's caption already ends with the credits block (lib/lfd/post.ts captionFor).
  const caption = String(post.caption ?? '').trim();
  const problem = checkFeedPayload(objects, caption);
  if (problem) return { queued: false, note: problem, terminal: true };
  const itemId = await lfdItemId(query, postId);
  if (!itemId) return { queued: false, note: 'The post is gone.', terminal: true };
  return queueFeedAttempt(query, { vertical: 'last_few_days', itemId, trigger, caption, imageObjects: objects });
}

export function failStaleLfdAttempts(query: Query): Promise<void> {
  return failStaleAttempts(query, 'last_few_days');
}

type StoryPhoto = { src?: unknown; credit?: unknown; kind?: unknown };

/**
 * The post's photos into social.used_photos (one row per story slide; the
 * cover reuses them). Logos are exempt from the 7-day rule, so they are not
 * recorded. post_id stays NULL: it points at social.posts, and this is not one.
 */
export async function recordLfdPhotos(query: Query, postId: string, at: Date): Promise<number> {
  const { rows } = await query(`SELECT stories FROM lfd.posts WHERE id = $1`, [postId]);
  const stories = (Array.isArray(rows[0]?.stories) ? rows[0].stories : []) as Array<{ photo?: StoryPhoto }>;
  let recorded = 0;
  for (const [i, story] of stories.entries()) {
    const photo = story.photo;
    if (!photo || typeof photo.src !== 'string' || !photo.src || photo.kind === 'logo') continue;
    await query(
      `INSERT INTO social.used_photos (url, used_at, story_id, slide, source, credit, scene)
       VALUES ($1, $2::timestamptz, $3, $4, 'lfd', $5, $6) ON CONFLICT DO NOTHING`,
      [photo.src, at.toISOString(), `${LFD_PHOTO_STORY_PREFIX}${postId}`, i + 2, typeof photo.credit === 'string' ? photo.credit : null, typeof photo.kind === 'string' ? photo.kind : null],
    );
    recorded += 1;
  }
  return recorded;
}

/** The type's step once Instagram has the post. A photo-record failure never fails a post that went out. */
export async function markLfdPublished(query: Query, postId: string, finishedAt: string): Promise<void> {
  await query(`UPDATE lfd.posts SET status = 'published', published_at = $2::timestamptz WHERE id = $1`, [postId, finishedAt]);
  await recordLfdPhotos(query, postId, new Date(finishedAt)).catch(() => undefined);
}

export function carryLfdAttempt(deps: PublishDeps, id: string): Promise<{ id: string; status: 'published' | 'failed' }> {
  return carryFeedAttempt(deps, id, { vertical: 'last_few_days', onPublished: markLfdPublished });
}

/** Claim one queued Last Few Days post and carry it to Instagram. */
export async function claimAndPublishLfd(deps: PublishDeps): Promise<{ id: string; status: 'published' | 'failed' } | null> {
  const id = await claimFeedAttempt(deps.query, 'last_few_days');
  if (!id) return null;
  return carryLfdAttempt(deps, id);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx tsx --test tests/lfd-publish.test.ts tests/social-overnight.test.ts tests/social-publisher.test.ts tests/instagram-payloads.test.ts tests/social-hub-scope.test.ts`
Expected: PASS (the carousel tests are unchanged and still pass: same messages, same SQL effects). Typecheck line prints nothing.

- [ ] **Step 5: Commit**

```bash
git add lib/social/overnight/publish.ts lib/lfd/items.ts lib/lfd/publish.ts tests/fixtures/lfd/seed.ts tests/lfd-publish.test.ts
git commit -m "feat(lfd): shared feed-carousel publish; LFD queue, carry, mark published, used photos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: LFD on the calendar: book, approve, reject, unschedule, hard publish, release

**Files:**
- Modify: `lib/social/overnight/schedule.ts`
- Create: `lib/lfd/schedule.ts`
- Test: `tests/lfd-schedule.test.ts` (create)

**Interfaces:**
- Consumes: `lfdItemId`, `queueLfdPublish` (Task 4), `LFD_WINDOW`, `LFD_SLOT`, `readLfdSettings`, `datesByWeekday`,
  `busyFeedTimes` / `ownFeedTimes` with `'lfd'` (Task 3), `chooseFromWindows`, `bookSlot`, `approveItem`.
- Produces:
  - in `lib/social/overnight/schedule.ts`: `type ReleaseRules`, `releaseDueFor(query, rules)`,
    `rejectItemAndSlot(query, itemId, by, note)`, `forceApproveItem(query, itemId, note)`, `unscheduleItem(query, itemId)`;
    `releaseDueSchedules`, `rejectPost`, `hardPublishPost`, `unschedulePost` become wrappers (same behavior);
  - `lib/lfd/schedule.ts`: `LFD_NOT_APPROVED_NOTE`, `LFD_REJECTED_NOTE`, `LFD_HARD_PUBLISH_NOTE`,
    `scheduleLfdPost(query, postId, source, now?, throughDate?, rng?)`, `approveLfdPost(query, postId, now?)`,
    `rejectLfdPost(query, postId, by)`, `unscheduleLfdPost(query, postId)`, `hardPublishLfdPost(query, postId)`,
    `releaseDueLfd(query, { requireApproval })`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lfd-schedule.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { lfdItemId } from '@/lib/lfd/items';
import {
  approveLfdPost,
  hardPublishLfdPost,
  LFD_HARD_PUBLISH_NOTE,
  LFD_NOT_APPROVED_NOTE,
  LFD_REJECTED_NOTE,
  rejectLfdPost,
  releaseDueLfd,
  scheduleLfdPost,
  unscheduleLfdPost,
} from '@/lib/lfd/schedule';
import { approveItem, bookSlot, ensureContentItem } from '@/lib/social-hub/spine';
import type { Query } from '@/lib/social/store/pg';

import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

/** Tuesday 2026-10-13, 3:30 AM New York (after the 3:00 run). */
const TUE_330 = new Date('2026-10-13T07:30:00Z');
/** Wednesday 2026-10-14, 8:00 AM New York. */
const WED_8 = new Date('2026-10-14T12:00:00Z');

async function db() {
  const { query } = await openHubTestDb();
  return { query, q: query as unknown as Query };
}

test('the run books its own day: Tuesday 9–10 AM, 30 minutes from a carousel', async () => {
  const { query, q } = await db();
  const carousel = await ensureContentItem(q, { vertical: 'carousels', format: 'feed', nativeRef: 'c1', ideaRef: null });
  await bookSlot(q, { vertical: 'carousels', itemId: carousel, nyDate: '2026-10-13', slot: 'morning', publishAt: new Date('2026-10-13T13:10:00Z'), source: 'auto' });
  const id = await seedLfdPost(query);
  const out = await scheduleLfdPost(q, id, 'auto', TUE_330, '2026-10-13', () => 0);
  assert.equal(out.scheduled, true);
  assert.equal(out.scheduled ? out.publishAt : '', '2026-10-13T13:40:00.000Z', 'the first minute 30 minutes after 9:10');
  const row = (await q(`SELECT vertical, slot, ny_date::text AS d, source FROM social_hub.schedule WHERE vertical = 'last_few_days'`)).rows[0];
  assert.deepEqual([row.vertical, row.slot, row.d, row.source], ['last_few_days', 'morning', '2026-10-13', 'auto']);
  assert.equal((await q(`SELECT count(*)::int AS n FROM social_hub.approvals`)).rows[0].n, 0, 'an auto slot is not approved');
});

test('auto-booking on a day that is not a Last Few Days day books nothing', async () => {
  const { query, q } = await db();
  const id = await seedLfdPost(query, { nyDate: '2026-10-14' });
  const out = await scheduleLfdPost(q, id, 'auto', WED_8, '2026-10-14', () => 0);
  assert.deepEqual(out, { scheduled: false, note: 'No Last Few Days window is open on that day (it posts on its days only, 9:00–10:00 AM).' });
});

test('approving on a Wednesday approves the post and books Friday', async () => {
  const { query, q } = await db();
  const id = await seedLfdPost(query, { nyDate: '2026-10-14' });
  const out = await approveLfdPost(q, id, WED_8);
  assert.equal(out.scheduled, true);
  assert.equal((await q(`SELECT ny_date::text AS d FROM social_hub.schedule`)).rows[0].d, '2026-10-16');
  const ap = (await q(`SELECT decision, via FROM social_hub.approvals`)).rows[0];
  assert.deepEqual([ap.decision, ap.via], ['approved', 'user']);
  const again = await approveLfdPost(q, id, WED_8);
  assert.equal(again.scheduled ? again.id : '', out.scheduled ? out.id : 'x', 'a post already booked keeps its slot');
});

test('a due slot: approved goes out, unapproved is cancelled with the reason', async () => {
  const { query, q } = await db();
  const a = await seedLfdPost(query, { slug: 'lfd-a' });
  const b = await seedLfdPost(query, { slug: 'lfd-b' });
  await scheduleLfdPost(q, a, 'auto', TUE_330, undefined, () => 0);
  await scheduleLfdPost(q, b, 'auto', TUE_330, undefined, () => 0);
  await approveItem(q, (await lfdItemId(q, a))!, 'user');
  await q(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute'`);
  assert.equal(await releaseDueLfd(q, { requireApproval: true }), 1);
  const attempt = (await q(`SELECT vertical, trigger, status FROM social_hub.publish_attempts`)).rows;
  assert.deepEqual(attempt.map((r) => [r.vertical, r.trigger, r.status]), [['last_few_days', 'auto', 'requested']]);
  const cancelled = (await q(`SELECT status, error FROM social_hub.schedule WHERE status = 'cancelled'`)).rows[0];
  assert.equal(cancelled.error, LFD_NOT_APPROVED_NOTE);
});

test('reject, unschedule and hard publish use the shared spine helpers', async () => {
  const { query, q } = await db();
  const rejected = await seedLfdPost(query, { slug: 'lfd-r' });
  await approveLfdPost(q, rejected, TUE_330);
  assert.equal(await rejectLfdPost(q, rejected, 'tommy'), true);
  assert.equal((await q(`SELECT status FROM lfd.posts WHERE id = $1`, [rejected])).rows[0].status, 'rejected');
  const slot = (await q(`SELECT status, error FROM social_hub.schedule`)).rows[0];
  assert.deepEqual([slot.status, slot.error], ['cancelled', LFD_REJECTED_NOTE]);

  const moved = await seedLfdPost(query, { slug: 'lfd-u' });
  await approveLfdPost(q, moved, TUE_330);
  const out = await unscheduleLfdPost(q, moved);
  assert.equal(out.ok, true);
  const item = (await lfdItemId(q, moved))!;
  assert.equal((await q(`SELECT count(*)::int AS n FROM social_hub.approvals WHERE content_item_id = $1`, [item])).rows[0].n, 0);

  const forced = await seedLfdPost(query, { slug: 'lfd-f' });
  await approveLfdPost(q, forced, TUE_330);
  assert.equal((await hardPublishLfdPost(q, forced)).queued, true);
  const fItem = (await lfdItemId(q, forced))!;
  assert.equal((await q(`SELECT via FROM social_hub.approvals WHERE content_item_id = $1`, [fItem])).rows[0].via, 'user', 'a first approval keeps how it came');
  assert.equal((await q(`SELECT trigger FROM social_hub.publish_attempts WHERE content_item_id = $1`, [fItem])).rows[0].trigger, 'force');
  assert.equal((await q(`SELECT error FROM social_hub.schedule WHERE content_item_id = $1`, [fItem])).rows[0].error, LFD_HARD_PUBLISH_NOTE);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx --test tests/lfd-schedule.test.ts`
Expected: FAIL with `Cannot find module '@/lib/lfd/schedule'`.

- [ ] **Step 3: Write the code**

In `lib/social/overnight/schedule.ts`, change the publish import — before:

```ts
import { queuePublish } from './publish';
```

after:

```ts
import { queuePublish, type FeedVertical, type PublishTrigger, type Queued } from './publish';
```

Replace the whole `releaseDueSchedules` function (from its doc comment `/**\n * Due slots become publish attempts.` through its closing `}`) with:

```ts
/** What a due feed slot turns into: the type's queue rule, and the notes a refused slot keeps. */
export type ReleaseRules = {
  vertical: FeedVertical;
  requireApproval: boolean;
  queue: (nativeRef: string, trigger: PublishTrigger) => Promise<Queued>;
  notApprovedNote: string;
  rejectedNote: string;
};

/**
 * Due slots become publish attempts. With require_approval on (the default),
 * an unapproved slot is cancelled instead. A failing queue check fails the
 * slot, with the reason. Carousels and Last Few Days share this rule.
 */
export async function releaseDueFor(query: Query, rules: ReleaseRules): Promise<number> {
  const { rows } = await query(
    `SELECT s.id, ci.native_ref, s.source, a.decision
       FROM social_hub.schedule s
       JOIN social_hub.content_items ci ON ci.id = s.content_item_id
       LEFT JOIN social_hub.approvals a ON a.content_item_id = s.content_item_id
      WHERE s.vertical = $1 AND s.status = 'scheduled' AND s.publish_at <= now()
      ORDER BY s.publish_at`,
    [rules.vertical],
  );
  const cancel = (id: string, note: string) =>
    query(`UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE id = $1 AND status = 'scheduled'`, [id, note]);
  let released = 0;
  for (const row of rows) {
    if (row.decision === 'rejected') {
      await cancel(row.id, rules.rejectedNote);
      continue;
    }
    if (rules.requireApproval && row.decision !== 'approved') {
      await cancel(row.id, rules.notApprovedNote);
      continue;
    }
    const claimed = await query(
      `UPDATE social_hub.schedule SET status = 'publishing' WHERE id = $1 AND status = 'scheduled' RETURNING id`,
      [row.id],
    );
    if (!claimed.rows[0]) continue;
    const result = await rules.queue(row.native_ref, row.source === 'user' ? 'approve' : 'auto');
    if (result.queued) {
      await query(`UPDATE social_hub.schedule SET publish_attempt_id = $2 WHERE id = $1`, [row.id, result.id]);
      released += 1;
    } else if (result.alreadyPublished) {
      await query(`UPDATE social_hub.schedule SET status = 'published', error = NULL WHERE id = $1`, [row.id]);
    } else if (result.terminal) {
      await query(`UPDATE social_hub.schedule SET status = 'failed', error = $2 WHERE id = $1`, [row.id, result.note]);
    } else {
      await query(`UPDATE social_hub.schedule SET status = 'scheduled', error = $2 WHERE id = $1`, [row.id, result.note]);
    }
  }
  return released;
}

/** Carousels' due slots (the carousel queue rule and notes). */
export async function releaseDueSchedules(query: Query, opts: { requireApproval: boolean } = { requireApproval: true }): Promise<number> {
  return releaseDueFor(query, {
    vertical: 'carousels',
    requireApproval: opts.requireApproval,
    queue: (postId, trigger) => queuePublish(query, postId, trigger),
    notApprovedNote: NOT_APPROVED_NOTE,
    rejectedNote: REJECTED_NOTE,
  });
}

/** Reject an item (it never posts, D47) and cancel its waiting slot with `note`. */
export async function rejectItemAndSlot(query: Query, itemId: string, by: string | null, note: string): Promise<void> {
  await rejectItem(query, itemId, by);
  await query(
    `UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE content_item_id = $1 AND status = 'scheduled'`,
    [itemId, note],
  );
}

/** Hard publish's first half (SH-17): the click approves the item, and its waiting slot is closed so it can't post twice. */
export async function forceApproveItem(query: Query, itemId: string, note: string): Promise<void> {
  await approveItem(query, itemId, 'force');
  await query(
    `UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE content_item_id = $1 AND status = 'scheduled'`,
    [itemId, note],
  );
}
```

Replace the body of `rejectPost` — before:

```ts
  const itemId = await carouselItemId(query, postId);
  if (!itemId) return false;
  await rejectItem(query, itemId, by);
  await query(
    `UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE content_item_id = $1 AND status = 'scheduled'`,
    [itemId, REJECTED_NOTE],
  );
  return true;
```

after:

```ts
  const itemId = await carouselItemId(query, postId);
  if (!itemId) return false;
  await rejectItemAndSlot(query, itemId, by, REJECTED_NOTE);
  return true;
```

Replace the body of `hardPublishPost` — before:

```ts
  const itemId = await carouselItemId(query, postId);
  if (itemId) {
    await approveItem(query, itemId, 'force');
    await query(
      `UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE content_item_id = $1 AND status = 'scheduled'`,
      [itemId, HARD_PUBLISH_NOTE],
    );
  }
  return queuePublish(query, postId, 'force');
```

after:

```ts
  const itemId = await carouselItemId(query, postId);
  if (itemId) await forceApproveItem(query, itemId, HARD_PUBLISH_NOTE);
  return queuePublish(query, postId, 'force');
```

Replace the whole `unschedulePost` function with:

```ts
/**
 * Take an item off the calendar (the hub's Unschedule): its waiting slot is
 * cancelled and its approval withdrawn, so it is made and waiting again. A
 * rejection stays; content that is posting or has posted can't be unscheduled.
 */
export async function unscheduleItem(query: Query, itemId: string): Promise<{ ok: boolean; note: string }> {
  const { rows: busy } = await query(
    `SELECT (SELECT count(*) FROM social_hub.schedule WHERE content_item_id = $1 AND status = 'publishing')
          + (SELECT count(*) FROM social_hub.publish_attempts WHERE content_item_id = $1 AND status IN ('requested', 'creating', 'processing', 'publishing', 'published')) AS n`,
    [itemId],
  );
  if (Number(busy[0]?.n ?? 0) > 0) return { ok: false, note: 'It is posting, or has already posted, so it can’t be unscheduled.' };
  const cancelled = await query(
    `UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE content_item_id = $1 AND status = 'scheduled' RETURNING id`,
    [itemId, UNSCHEDULED_NOTE],
  );
  await query(`DELETE FROM social_hub.approvals WHERE content_item_id = $1 AND decision = 'approved'`, [itemId]);
  return cancelled.rows.length
    ? { ok: true, note: 'Unscheduled. It is not approved any more; approve and schedule it again when you want it to post.' }
    : { ok: true, note: 'It had no slot. Its approval is withdrawn.' };
}

/** Take a carousel off the calendar (the hub's Unschedule). */
export async function unschedulePost(query: Query, postId: string): Promise<{ ok: boolean; note: string }> {
  const itemId = await carouselItemId(query, postId);
  if (!itemId) return { ok: false, note: 'The post is gone.' };
  return unscheduleItem(query, itemId);
}
```

```ts
// lib/lfd/schedule.ts
/**
 * Last Few Days on the calendar (spec §7.4): one 9:00–10:00 AM window on its
 * days (lfd.settings.days, Tue/Fri), at least 30 minutes from every other feed
 * post. Approve, reject, unschedule, Hard publish and the due-slot release use
 * the same spine helpers as Carousels (lib/social/overnight/schedule.ts).
 */
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import { busyFeedTimes, ownFeedTimes } from '@/lib/instagram/feed-spacing';
import { chooseFromWindows, slotTakenKey, uniformIndex } from '@/lib/instagram/window';
import { approveItem, bookSlot } from '@/lib/social-hub/spine';
import type { Queued } from '@/lib/social/overnight/publish';
import { forceApproveItem, rejectItemAndSlot, releaseDueFor, unscheduleItem, type ScheduleOutcome } from '@/lib/social/overnight/schedule';
import type { Query } from '@/lib/social/store/pg';

import { DEFAULT_LFD_DAYS, LFD_SLOT, LFD_WINDOW } from './config';
import { datesByWeekday } from './days';
import { lfdItemId } from './items';
import { queueLfdPublish } from './publish';
import { readLfdSettings } from './settings';

export const LFD_NOT_APPROVED_NOTE = 'Nobody approved this Last Few Days post before its slot, so it was not posted.';
export const LFD_REJECTED_NOTE = 'This Last Few Days post was rejected, so it was not posted.';
export const LFD_HARD_PUBLISH_NOTE = 'Hard published from the Social Hub (posted now, outside its slot).';

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === '23505';

/** Booked LFD windows from `fromDate`, plus every day that is not an LFD day (no window there, LFD-01). */
async function takenSlots(query: Query, fromDate: string, days: readonly number[]): Promise<Set<string>> {
  const { rows } = await query(
    `SELECT ny_date::text AS ny_date, slot FROM social_hub.schedule
      WHERE vertical = 'last_few_days' AND status IN ('scheduled', 'publishing', 'published') AND ny_date >= $1::date`,
    [fromDate],
  );
  const taken = new Set(rows.map((r) => slotTakenKey(r.ny_date as string, r.slot as string)));
  for (const day of datesByWeekday(fromDate, 14, days, false)) taken.add(slotTakenKey(day, LFD_SLOT));
  return taken;
}

/**
 * Put a post into the earliest open LFD window (through `throughDate` when
 * given: the worker passes the post's own day). A post already on the clock
 * keeps its slot. A person scheduling (`user`) approves it.
 */
export async function scheduleLfdPost(
  query: Query,
  postId: string,
  source: 'auto' | 'user',
  now = new Date(),
  throughDate?: string,
  rng: (count: number) => number = uniformIndex,
): Promise<ScheduleOutcome> {
  const itemId = await lfdItemId(query, postId);
  if (!itemId) return { scheduled: false, note: 'The post is gone.' };
  if (source === 'user') await approveItem(query, itemId, 'user');
  const active = async () =>
    (await query(
      `SELECT id, publish_at FROM social_hub.schedule WHERE content_item_id = $1 AND status IN ('scheduled', 'publishing') LIMIT 1`,
      [itemId],
    )).rows[0];
  const existing = await active();
  if (existing) return { scheduled: true, id: existing.id, publishAt: new Date(existing.publish_at).toISOString() };

  const days = await readLfdSettings(query).then((s) => s.days).catch(() => [...DEFAULT_LFD_DAYS]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const today = calendarDateKey(now, SOCIAL_TIMEZONE);
    const busy = [...(await busyFeedTimes(query, now, 'lfd')), ...(await ownFeedTimes(query, 'lfd', now))];
    const choice = chooseFromWindows([LFD_WINDOW], now, await takenSlots(query, today, days), busy, rng, throughDate);
    if (!choice) {
      return {
        scheduled: false,
        note: throughDate ? 'No Last Few Days window is open on that day (it posts on its days only, 9:00–10:00 AM).' : 'No Last Few Days window is open in the next two weeks.',
      };
    }
    try {
      const booked = await bookSlot(query, { vertical: 'last_few_days', itemId, nyDate: choice.nyDate, slot: choice.slot, publishAt: choice.publishAt, source });
      return { scheduled: true, id: booked.id, publishAt: booked.publishAt };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await active();
      if (raced) return { scheduled: true, id: raced.id, publishAt: new Date(raced.publish_at).toISOString() };
    }
  }
  return { scheduled: false, note: 'That window was just taken.' };
}

/** A person approves a post: approved, and booked in its day's window or the next open one (like Carousels, P2-M4). */
export function approveLfdPost(query: Query, postId: string, now = new Date()): Promise<ScheduleOutcome> {
  return scheduleLfdPost(query, postId, 'user', now);
}

/**
 * A person rejects a post (D47): it never posts, its waiting slot is cancelled,
 * and lfd.posts is marked rejected so its stories are free for the next post's
 * repeat check (lib/lfd/store.ts previousPosts skips rejected posts).
 */
export async function rejectLfdPost(query: Query, postId: string, by: string | null = null): Promise<boolean> {
  const itemId = await lfdItemId(query, postId);
  if (!itemId) return false;
  await rejectItemAndSlot(query, itemId, by, LFD_REJECTED_NOTE);
  await query(`UPDATE lfd.posts SET status = 'rejected' WHERE id = $1 AND status = 'review'`, [postId]);
  return true;
}

export async function unscheduleLfdPost(query: Query, postId: string): Promise<{ ok: boolean; note: string }> {
  const itemId = await lfdItemId(query, postId);
  if (!itemId) return { ok: false, note: 'The post is gone.' };
  return unscheduleItem(query, itemId);
}

/** Hard publish (SH-15/SH-17): approved by the click, its waiting slot closed, a force attempt queued. */
export async function hardPublishLfdPost(query: Query, postId: string): Promise<Queued> {
  const itemId = await lfdItemId(query, postId);
  if (itemId) await forceApproveItem(query, itemId, LFD_HARD_PUBLISH_NOTE);
  return queueLfdPublish(query, postId, 'force');
}

/** Due LFD slots become publish attempts (Carousels' rule, LFD's queue and notes). */
export function releaseDueLfd(query: Query, opts: { requireApproval: boolean } = { requireApproval: true }): Promise<number> {
  return releaseDueFor(query, {
    vertical: 'last_few_days',
    requireApproval: opts.requireApproval,
    queue: (postId, trigger) => queueLfdPublish(query, postId, trigger),
    notApprovedNote: LFD_NOT_APPROVED_NOTE,
    rejectedNote: LFD_REJECTED_NOTE,
  });
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx tsx --test tests/lfd-schedule.test.ts tests/social-overnight.test.ts tests/social-hub-placement.test.ts tests/social-hub-actions.test.ts tests/social-hub-delete.test.ts tests/social-hub-scope.test.ts`
Expected: PASS. Typecheck line prints nothing.

- [ ] **Step 5: Commit**

```bash
git add lib/social/overnight/schedule.ts lib/lfd/schedule.ts tests/lfd-schedule.test.ts
git commit -m "feat(lfd): book its day's window, approve, reject, unschedule, hard publish, release (shared helpers)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Insights by vertical, the publisher's LFD driver

**Files:**
- Modify: `lib/social/overnight/insights.ts`, `scripts/publisher_worker.ts`
- Create: `lib/publishing/drivers/last-few-days.ts`
- Test: `tests/lfd-driver.test.ts` (create)

**Interfaces:**
- Consumes: `readLfdSettings`, `failStaleLfdAttempts`, `carryLfdAttempt`, `releaseDueLfd`, `PublishDriver`, `publisherTick`.
- Produces: `pollCarouselInsights(query, client, now?, limit?, vertical: FeedVertical = 'carousels')`;
  `lastFewDaysDriver({ query, meta, signImage, token }): PublishDriver`; the publisher worker drives `last_few_days`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lfd-driver.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { approveLfdPost } from '@/lib/lfd/schedule';
import { lastFewDaysDriver } from '@/lib/publishing/drivers/last-few-days';
import { publisherTick } from '@/lib/publishing/publisher';
import { ensureContentItem } from '@/lib/social-hub/spine';
import { pollCarouselInsights, type CarouselInsightsClient } from '@/lib/social/overnight/insights';
import type { CarouselMetaClient } from '@/lib/social/overnight/meta';
import type { Query } from '@/lib/social/store/pg';

import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

const meta: CarouselMetaClient = {
  async createImageItem() { return 'child'; },
  async createCarousel() { return 'parent'; },
  async containerStatus() { return { statusCode: 'FINISHED', status: null }; },
  async publishContainer() { return 'media-lfd'; },
  async permalink() { return 'https://instagram.com/p/lfd'; },
  async publishingLimit() { return { quotaUsage: 3, quotaTotal: 100 }; },
};

const driverFor = (q: Query) => lastFewDaysDriver({ query: q, meta: () => meta, signImage: async (p) => `https://signed/${p}`, token: () => 't' });

test('the publisher releases an approved due Last Few Days post and carries it', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  await q(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'publishing_live'`);
  await q(`INSERT INTO social_hub.settings (key, value) VALUES ('publisher_mode', '"live"'::jsonb) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  const id = await seedLfdPost(query);
  assert.equal((await approveLfdPost(q, id, new Date('2026-10-13T07:30:00Z'))).scheduled, true);
  await q(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute'`);
  const tick = await publisherTick(q, [driverFor(q)]);
  assert.deepEqual(tick.mode === 'live' ? [tick.released, tick.published?.vertical, tick.published?.status] : [tick.mode], [1, 'last_few_days', 'published']);
  assert.equal((await q(`SELECT status FROM lfd.posts WHERE id = $1`, [id])).rows[0].status, 'published');
  assert.equal((await q(`SELECT status FROM social_hub.schedule`)).rows[0].status, 'published');
});

test('the driver is off while lfd publishing_live is off, and when the lfd schema is missing', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  assert.equal(await driverFor(q).live(), false);
  assert.equal(await driverFor(q).requireApproval(), true);
  const broken: Query = async (text) => {
    if (/lfd\./.test(text)) throw new Error('relation "lfd.settings" does not exist');
    return { rows: [] };
  };
  assert.equal(await driverFor(broken).live(), false);
  assert.equal(await driverFor(broken).requireApproval(), true);
});

test('Last Few Days insights are read into the spine under their own vertical only', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const lfdItem = await ensureContentItem(q, { vertical: 'last_few_days', format: 'feed', nativeRef: 'p1', ideaRef: null });
  const carItem = await ensureContentItem(q, { vertical: 'carousels', format: 'feed', nativeRef: 'c1', ideaRef: null });
  for (const [item, vertical, media] of [[lfdItem, 'last_few_days', 'm-lfd'], [carItem, 'carousels', 'm-car']]) {
    await q(
      `INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption, media_id, finished_at) VALUES ($1, $2, 'auto', 'published', 'c', $3, '2026-10-13T14:00:00Z')`,
      [item, vertical, media],
    );
  }
  const seen: string[] = [];
  const client: CarouselInsightsClient = {
    async insights(mediaId) { seen.push(mediaId); return { views: 300, reach: 120, likes: 10, comments: 1, saved: 4, shares: 2, total_interactions: 17, follows: 3, profile_visits: 9, raw: {} }; },
  };
  const r = await pollCarouselInsights(q, client, new Date('2026-10-13T15:00:00Z'), 200, 'last_few_days');
  assert.deepEqual([r.considered, r.written, seen], [1, 1, ['m-lfd']]);
  const row = (await q(`SELECT vertical, views FROM social_hub.media_insights WHERE media_id = 'm-lfd'`)).rows[0];
  assert.deepEqual([row.vertical, row.views], ['last_few_days', 300]);
});

test('the publisher worker registers the Last Few Days driver', () => {
  const text = readFileSync(path.join(process.cwd(), 'scripts/publisher_worker.ts'), 'utf8');
  assert.match(text, /lastFewDaysDriver\(\{ query, meta: createLiveCarouselClient/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx --test tests/lfd-driver.test.ts`
Expected: FAIL with `Cannot find module '@/lib/publishing/drivers/last-few-days'`.

- [ ] **Step 3: Write the code**

`lib/social/overnight/insights.ts` — add after `import type { Query } from '@/lib/social/store/pg';`:

```ts
import type { FeedVertical } from './publish';
```

Before:

```ts
/** Ask Instagram about every published carousel that is due. */
export async function pollCarouselInsights(query: Query, client: CarouselInsightsClient, now = new Date(), limit = 200): Promise<CarouselInsightsResult> {
  const { rows: open } = await query(
    `SELECT id, media_id, finished_at, insights_checked_at FROM social_hub.publish_attempts
      WHERE vertical = 'carousels' AND status = 'published' AND media_id IS NOT NULL AND finished_at IS NOT NULL
        AND finished_at <= $1::timestamptz AND insights_settled_at IS NULL
      ORDER BY (insights_checked_at IS NULL) DESC, finished_at DESC`,
    [now.toISOString()],
  );
```

After:

```ts
/** Ask Instagram about every published feed carousel of `vertical` (Carousels, or Last Few Days) that is due. */
export async function pollCarouselInsights(
  query: Query,
  client: CarouselInsightsClient,
  now = new Date(),
  limit = 200,
  vertical: FeedVertical = 'carousels',
): Promise<CarouselInsightsResult> {
  const { rows: open } = await query(
    `SELECT id, media_id, finished_at, insights_checked_at FROM social_hub.publish_attempts
      WHERE vertical = $2 AND status = 'published' AND media_id IS NOT NULL AND finished_at IS NOT NULL
        AND finished_at <= $1::timestamptz AND insights_settled_at IS NULL
      ORDER BY (insights_checked_at IS NULL) DESC, finished_at DESC`,
    [now.toISOString(), vertical],
  );
```

Before:

```ts
        `INSERT INTO social_hub.media_insights (media_id, ny_date, vertical, publish_attempt_id, views, reach, likes, comments, saved, shares, total_interactions, follows, profile_visits, raw)
         VALUES ($1, $2::date, 'carousels', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
```

After:

```ts
        `INSERT INTO social_hub.media_insights (media_id, ny_date, vertical, publish_attempt_id, views, reach, likes, comments, saved, shares, total_interactions, follows, profile_visits, raw)
         VALUES ($1, $2::date, $14, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
```

and before (the parameter list of that INSERT):

```ts
        [row.media_id, nyDate, row.id, reading.views, reading.reach, reading.likes, reading.comments, reading.saved, reading.shares, reading.total_interactions, reading.follows, reading.profile_visits, JSON.stringify(reading.raw ?? {})],
```

after:

```ts
        [row.media_id, nyDate, row.id, reading.views, reading.reach, reading.likes, reading.comments, reading.saved, reading.shares, reading.total_interactions, reading.follows, reading.profile_visits, JSON.stringify(reading.raw ?? {}), vertical],
```

```ts
// lib/publishing/drivers/last-few-days.ts
import { failStaleLfdAttempts, carryLfdAttempt } from '@/lib/lfd/publish';
import { releaseDueLfd } from '@/lib/lfd/schedule';
import { readLfdSettings } from '@/lib/lfd/settings';
import { createCarouselInsightsClient, pollCarouselInsights } from '@/lib/social/overnight/insights';
import type { CarouselMetaClient } from '@/lib/social/overnight/meta';
import type { Query } from '@/lib/social/store/pg';

import type { PublishDriver } from './types';

/**
 * Last Few Days for the publisher: lfd.settings' own switches, its queue rule
 * and the shared feed-carousel publish (lib/lfd). An unreadable lfd schema
 * reads as "not live", so it can never stop the other types' tick.
 */
export function lastFewDaysDriver(deps: {
  query: Query;
  meta: () => CarouselMetaClient;
  signImage: (objectPath: string, expiresIn: number) => Promise<string>;
  token: () => string;
}): PublishDriver {
  const settings = () => readLfdSettings(deps.query).catch(() => null);
  const driver: PublishDriver = {
    vertical: 'last_few_days',
    refusesAtRelease: 'cancel',
    live: async () => (await settings())?.publishingLive === true,
    requireApproval: async () => (await settings())?.requireApproval !== false,
    failStale: () => failStaleLfdAttempts(deps.query),
    releaseDue: async () => releaseDueLfd(deps.query, { requireApproval: await driver.requireApproval() }),
    carry: (id) => carryLfdAttempt({ query: deps.query, meta: deps.meta(), signImage: deps.signImage }, id),
    pollInsights: () => pollCarouselInsights(deps.query, createCarouselInsightsClient({ token: deps.token() }), new Date(), 200, 'last_few_days'),
  };
  return driver;
}
```

`scripts/publisher_worker.ts` — before:

```ts
  const { carouselsDriver } = await import('@/lib/publishing/drivers/carousels');
```

after:

```ts
  const { carouselsDriver } = await import('@/lib/publishing/drivers/carousels');
  const { lastFewDaysDriver } = await import('@/lib/publishing/drivers/last-few-days');
```

Before:

```ts
    carouselsDriver({ query, meta: createLiveCarouselClient, signImage: (p, s) => slideBucket.sign(p, s), token }),
```

after:

```ts
    carouselsDriver({ query, meta: createLiveCarouselClient, signImage: (p, s) => slideBucket.sign(p, s), token }),
    lastFewDaysDriver({ query, meta: createLiveCarouselClient, signImage: (p, s) => slideBucket.sign(p, s), token }),
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx tsx --test tests/lfd-driver.test.ts tests/social-publisher.test.ts tests/social-overnight.test.ts tests/social-hub-scope.test.ts`
Expected: PASS. Typecheck line prints nothing.

- [ ] **Step 5: Commit**

```bash
git add lib/social/overnight/insights.ts lib/publishing/drivers/last-few-days.ts scripts/publisher_worker.ts tests/lfd-driver.test.ts
git commit -m "feat(lfd): publisher driver and insights reads for last_few_days

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(The publisher runs on the VM; its redeploy is the Task 8 STOP step.)

---
### Task 7: The worker's Last Few Days step (3:00 decision, carry out a claimed run)

**Files:**
- Create: `lib/lfd/clock.ts`, `lib/lfd/live.ts`, `lib/lfd/worker.ts`
- Modify: `scripts/lfd_run.ts`
- Test: `tests/lfd-worker.test.ts` (create)

**Interfaces:**
- Consumes: `LfdSettings`, `readLfdSettings`, `weekdayOfDate`, `ClaimedRun`, `finishRun`, `failRun`, `runLastFewDays`,
  `LfdRunDeps`, `lfdItemId`, `scheduleLfdPost`, `dailyFill`, `quotaFilledNote`.
- Produces:
  - `threeAmQueue(nyDate, lfd: LfdSettings | null, carouselAutoRun): { queue: 'last_few_days' | 'carousels' | 'none'; reason }`;
  - `liveLfdDeps(query, { capUsd, trigger, runId?, now? }): Promise<{ deps: LfdRunDeps; spentUsd: () => number }>`;
  - `carryOutLfdRun(w: CarryOutDeps, claimed: ClaimedRun): Promise<CarryOutResult>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lfd-worker.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { threeAmQueue } from '@/lib/lfd/clock';
import type { LfdRunDeps } from '@/lib/lfd/run';
import { parseLfdSettings } from '@/lib/lfd/settings';
import { claimRun, finishRun, requestRun, type ClaimedRun } from '@/lib/lfd/store';
import { carryOutLfdRun, type CarryOutDeps } from '@/lib/lfd/worker';
import { bookSlot, ensureContentItem, type SpineQuery } from '@/lib/social-hub/spine';
import type { HubQuery } from '@/lib/social-hub/db';

import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

/** Tuesday 2026-10-13, 3:00 AM New York. */
const TUE_3 = new Date('2026-10-13T07:00:00Z');

test('the 3:00 slot: Last Few Days on its days while its auto_run is on, else the carousel rule', () => {
  const on = parseLfdSettings([{ key: 'auto_run', value: true }]);
  const off = parseLfdSettings([]);
  assert.equal(threeAmQueue('2026-10-13', on, true).queue, 'last_few_days', 'Tuesday: LFD, and no carousel run');
  assert.equal(threeAmQueue('2026-10-16', on, false).queue, 'last_few_days', 'Friday');
  assert.equal(threeAmQueue('2026-10-14', on, true).queue, 'carousels', 'Wednesday is a carousel day');
  assert.equal(threeAmQueue('2026-10-14', on, false).queue, 'none');
  assert.equal(threeAmQueue('2026-10-13', off, true).queue, 'carousels', 'LFD off: Tuesday is a carousel day');
  assert.equal(threeAmQueue('2026-10-13', null, true).queue, 'carousels', 'unreadable lfd settings change nothing');
  const badCap = threeAmQueue('2026-10-13', parseLfdSettings([{ key: 'auto_run', value: true }, { key: 'run_cap_usd', value: 'abc' }]), true);
  assert.equal(badCap.queue, 'none', 'its day stays its own: no carousel run either');
  assert.match(badCap.reason, /run_cap_usd/);
});

async function claimed(query: HubQuery, trigger: 'scheduled' | 'manual'): Promise<ClaimedRun> {
  await requestRun(query, trigger, 1);
  return (await claimRun(query, TUE_3))!;
}

function worker(query: HubQuery, over: Partial<CarryOutDeps> = {}) {
  const logs: string[] = [];
  const ran: Array<{ runId?: string; capUsd: number; trigger: string }> = [];
  const w: CarryOutDeps = {
    query,
    now: () => TUE_3,
    log: (message) => { logs.push(message); },
    engine: async () => ({ query }) as unknown as LfdRunDeps,
    run: async (d) => {
      ran.push({ runId: d.runId, capUsd: d.capUsd, trigger: d.trigger });
      const postId = await seedLfdPost(query, { nyDate: '2026-10-13' });
      await finishRun(query, d.runId!, { status: 'ok', claudeUsd: 0.2, jevUsd: 0.05, record: {} });
      return { ok: true as const, runId: d.runId!, postId, stories: 6, short: false };
    },
    ...over,
  };
  return { w, logs, ran };
}

test('a claimed run is carried out with the settings cap; its post joins the spine and, when live, takes today’s window', async () => {
  const { query } = await openHubTestDb();
  await query(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'publishing_live'`);
  await query(`UPDATE lfd.settings SET value = '0.8'::jsonb WHERE key = 'run_cap_usd'`);
  const run = await claimed(query, 'manual');
  const { w, ran } = worker(query);
  const out = await carryOutLfdRun(w, run);
  assert.equal(out.status, 'ok');
  assert.deepEqual(ran, [{ runId: run.id, capUsd: 0.8, trigger: 'manual' }]);
  const item = (await query<{ native_ref: string; format: string; idea_ref: string | null }>(`SELECT native_ref, format, idea_ref FROM social_hub.content_items WHERE vertical = 'last_few_days'`)).rows[0]!;
  assert.deepEqual([item.native_ref, item.format, item.idea_ref], [out.postId, 'feed', null]);
  const slot = (await query<{ d: string; slot: string; source: string }>(`SELECT ny_date::text AS d, slot, source FROM social_hub.schedule`)).rows[0]!;
  assert.deepEqual([slot.d, slot.slot, slot.source], ['2026-10-13', 'morning', 'auto']);
});

test('publishing off: the post joins the spine but books nothing', async () => {
  const { query } = await openHubTestDb();
  const { w } = worker(query);
  const out = await carryOutLfdRun(w, await claimed(query, 'manual'));
  assert.equal(out.status, 'ok');
  assert.equal((await query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.content_items WHERE vertical = 'last_few_days'`)).rows[0]!.n, 1);
  assert.equal((await query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.schedule`)).rows[0]!.n, 0);
});

test('daily fill: a scheduled run on a day a person already placed a post is skipped; a manual run is not', async () => {
  const { query } = await openHubTestDb();
  const placed = await seedLfdPost(query, { slug: 'lfd-placed' });
  const item = await ensureContentItem(query as SpineQuery, { vertical: 'last_few_days', format: 'feed', nativeRef: placed, ideaRef: null });
  await bookSlot(query as SpineQuery, { vertical: 'last_few_days', itemId: item, nyDate: '2026-10-13', slot: 'morning', publishAt: new Date('2026-10-13T13:30:00Z'), source: 'user' });
  const scheduled = await claimed(query, 'scheduled');
  const a = worker(query);
  const out = await carryOutLfdRun(a.w, scheduled);
  assert.equal(out.status, 'skipped');
  assert.deepEqual(a.ran, []);
  const row = (await query<{ status: string; stop_reason: string }>(`SELECT status, stop_reason FROM lfd.runs WHERE id = $1`, [scheduled.id])).rows[0]!;
  assert.equal(row.status, 'skipped');
  assert.match(row.stop_reason, /^quota-filled: Daily fill: people placed 1 Last Few Days post for 2026-10-13/);
  const b = worker(query, { run: async (d) => { await finishRun(query, d.runId!, { status: 'ok', claudeUsd: 0, jevUsd: 0, record: {} }); return { ok: true as const, runId: d.runId!, postId: placed, stories: 6, short: false }; } });
  assert.equal((await carryOutLfdRun(b.w, await claimed(query, 'manual'))).status, 'ok');
});

test('a bad cap or a throwing engine fails the run before any spend, and the worker goes on', async () => {
  const { query } = await openHubTestDb();
  await query(`UPDATE lfd.settings SET value = '"abc"'::jsonb WHERE key = 'run_cap_usd'`);
  const bad = worker(query);
  const run = await claimed(query, 'manual');
  const out = await carryOutLfdRun(bad.w, run);
  assert.equal(out.status, 'failed');
  assert.deepEqual(bad.ran, []);
  assert.match((await query<{ error: string }>(`SELECT error FROM lfd.runs WHERE id = $1`, [run.id])).rows[0]!.error, /run_cap_usd is not a positive number/);

  await query(`UPDATE lfd.settings SET value = '1'::jsonb WHERE key = 'run_cap_usd'`);
  const boom = worker(query, { engine: async () => { throw new Error('ANTHROPIC_API_KEY is not set'); } });
  const second = await claimed(query, 'manual');
  assert.equal((await carryOutLfdRun(boom.w, second)).status, 'failed');
  const row = (await query<{ status: string; error: string }>(`SELECT status, error FROM lfd.runs WHERE id = $1`, [second.id])).rows[0]!;
  assert.deepEqual([row.status, row.error], ['failed', 'ANTHROPIC_API_KEY is not set']);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx --test tests/lfd-worker.test.ts`
Expected: FAIL with `Cannot find module '@/lib/lfd/clock'`.

- [ ] **Step 3: Write the code**

The engine is still moving (as of 2026-10-14 another session added `LfdRunDeps.readPage` and a vision check that uses
`create`). Before writing `lib/lfd/live.ts`, re-read `export type LfdRunDeps` in `lib/lfd/run.ts` and the live branch of
`scripts/lfd_run.ts`: `liveLfdDeps` must wire **every** dependency the CLI wires, the same way (the code below matches the
engine at `aa65dc1`). If a dependency was added since, add it here exactly as the CLI builds it; the typecheck fails until
every required `LfdRunDeps` field is set. The quoted `scripts/lfd_run.ts` text below is likewise the text at `aa65dc1`; if it
has moved, replace the current block from the first `await import('@/lib/anthropic-client')` through the
`console.log(JSON.stringify({ ...res, spentUsd: … }))` line.

```ts
// lib/lfd/clock.ts
/** The 3:00 AM slot (spec §7.3, LFD-02), decided from plain inputs so the worker's clock is tested offline. */
import { weekdayOfDate } from './days';
import type { LfdSettings } from './settings';

export type ThreeAm = { queue: 'last_few_days' | 'carousels' | 'none'; reason: string };

/**
 * On a Last Few Days day with its auto_run on, Last Few Days runs and the
 * carousel run does not (one type per hour). Any other day belongs to the
 * carousel run, as before. With LFD's auto_run off, Tuesday and Friday are
 * ordinary carousel days. A bad run cap on an LFD day queues nothing at all.
 */
export function threeAmQueue(nyDate: string, lfd: LfdSettings | null, carouselAutoRun: boolean): ThreeAm {
  if (lfd?.autoRun && lfd.days.includes(weekdayOfDate(nyDate))) {
    return lfd.runCapUsd == null
      ? { queue: 'none', reason: `lfd.settings.run_cap_usd is not a positive number (${JSON.stringify(lfd.runCapRaw)}); no Last Few Days run, and no carousel run on its day` }
      : { queue: 'last_few_days', reason: 'a Last Few Days day' };
  }
  return carouselAutoRun ? { queue: 'carousels', reason: 'auto_run is on' } : { queue: 'none', reason: 'auto_run is off' };
}
```

```ts
// lib/lfd/live.ts
/**
 * The engine's live dependencies (Claude, Jev, photos, feeds, render check,
 * Storage), wired one way for both the worker (scripts/social_worker.ts) and
 * the human CLI (scripts/lfd_run.ts). Spend is capped at `capUsd` (spec §9):
 * the run budget refuses a Claude call that would cross it, and Jev is capped
 * by the same figure. Network modules load only when this is called; tests
 * never call it (CLAUDE.md Rule 1).
 */
import type { HubQuery } from '@/lib/social-hub/db';

import type { LfdRunDeps } from './run';

export async function liveLfdDeps(
  query: HubQuery,
  o: { capUsd: number; trigger: 'scheduled' | 'manual'; runId?: string; now?: Date },
): Promise<{ deps: LfdRunDeps; spentUsd: () => number }> {
  const { mediaBucket } = await import('@/lib/media-bucket');
  const { SLIDE_BUCKET } = await import('@/lib/social/overnight/config');
  const { newAnthropic } = await import('@/lib/anthropic-client');
  const { liveMessagesCreate } = await import('@/lib/social/reporter/reporter');
  const { capped, createJevAsk, createJevTally, tallied } = await import('@/lib/social/jev/client');
  const { createRunBudget } = await import('@/lib/social/pipeline/live-stages');
  const { createLivePhotoFinder } = await import('@/lib/stories/photos');
  const { fetchAllFeeds } = await import('@/lib/social/ingest/fetch-feeds');
  const { HELIOS_SOCIAL_FEEDS } = await import('@/lib/social/feeds');
  const { fetchBodyLive } = await import('@/lib/social/ingest/select/enrich');
  const { checkRenderFit } = await import('@/lib/social/render/fit-check');
  const { readPage } = await import('@/lib/social/reporter/read-page');

  const now = o.now ?? new Date();
  const tally = createJevTally();
  const jev = capped(tallied(createJevAsk(), tally), tally, o.capUsd);
  const budget = createRunBudget({ capUsd: o.capUsd, otherSpendUsd: () => tally.costUsd });
  const create = budget.guard(liveMessagesCreate(newAnthropic()));
  const bucket = mediaBucket(SLIDE_BUCKET);
  return {
    deps: {
      query,
      jev,
      create,
      photos: createLivePhotoFinder({ jev, create, runRef: `lfd:${o.runId ?? now.toISOString()}` }),
      fetchFeeds: () => fetchAllFeeds(HELIOS_SOCIAL_FEEDS),
      fetchBody: fetchBodyLive,
      readPage: (url) => readPage(url),
      fitCheck: checkRenderFit,
      upload: (p, b) => bucket.upload(p, b, 'image/jpeg'),
      now,
      trigger: o.trigger,
      capUsd: o.capUsd,
      spend: () => ({ claudeUsd: budget.claudeUsd(), jevUsd: tally.costUsd }),
      ...(o.runId ? { runId: o.runId } : {}),
    },
    spentUsd: () => budget.spent(),
  };
}
```

```ts
// lib/lfd/worker.ts
/**
 * The helios-social worker's Last Few Days step (spec §7.3): carry out a
 * claimed run, then put its post on the spine and, while lfd publishing_live
 * is on, into its own day's 9:00–10:00 AM window. The worker runs this in the
 * same loop as the carousel run, so the two never overlap.
 */
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import type { HubQuery } from '@/lib/social-hub/db';
import { dailyFill, quotaFilledNote } from '@/lib/social-hub/fill';

import { lfdItemId } from './items';
import { runLastFewDays, type LfdRunDeps } from './run';
import { scheduleLfdPost } from './schedule';
import { readLfdSettings } from './settings';
import { failRun, finishRun, type ClaimedRun } from './store';

export type LfdLog = (message: string, fields?: Record<string, unknown>) => void;

export type CarryOutDeps = {
  query: HubQuery;
  now: () => Date;
  log: LfdLog;
  /** The engine's dependencies for this run (live: lib/lfd/live.ts; tests: stubs). */
  engine: (run: ClaimedRun, capUsd: number) => Promise<LfdRunDeps>;
  /** The engine itself (tests pass a stub). */
  run?: (deps: LfdRunDeps) => ReturnType<typeof runLastFewDays>;
};

export type CarryOutResult = { runId: string; status: 'ok' | 'partial' | 'failed' | 'skipped'; postId?: string; scheduled?: string | null; note?: string };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function carryOutLfdRun(w: CarryOutDeps, claimed: ClaimedRun): Promise<CarryOutResult> {
  const now = w.now();
  const nyDate = calendarDateKey(now, SOCIAL_TIMEZONE);
  try {
    const settings = await readLfdSettings(w.query);
    const cap = settings.runCapUsd;
    if (cap == null) {
      const error = `lfd.settings.run_cap_usd is not a positive number (got ${JSON.stringify(settings.runCapRaw)}); refusing to run`;
      await finishRun(w.query, claimed.id, { status: 'failed', error, claudeUsd: 0, jevUsd: 0, record: {} });
      w.log('lfd_run_failed', { runId: claimed.id, error });
      return { runId: claimed.id, status: 'failed', note: error };
    }
    if (claimed.trigger === 'scheduled') {
      // Daily fill (§7.4, D54): a post a person already placed for today is today's post. A manual run is never skipped.
      const fill = await dailyFill(w.query, 'last_few_days', nyDate, 1);
      if (fill.making < 1) {
        const note = quotaFilledNote(fill, 'Last Few Days post');
        await finishRun(w.query, claimed.id, { status: 'skipped', stopReason: `quota-filled: ${note}`, claudeUsd: 0, jevUsd: 0, record: { fill } });
        w.log('lfd_run_skipped', { runId: claimed.id, reason: 'quota_filled', note });
        return { runId: claimed.id, status: 'skipped', note };
      }
    }
    w.log('lfd_run_started', { runId: claimed.id, trigger: claimed.trigger, capUsd: cap });
    const deps = await w.engine(claimed, cap);
    const res = await (w.run ?? runLastFewDays)({ ...deps, runId: claimed.id, trigger: claimed.trigger, capUsd: cap, now });
    if (!res.ok) {
      w.log('lfd_run_failed', { runId: claimed.id, error: res.error });
      return { runId: claimed.id, status: 'failed', note: res.error };
    }
    await lfdItemId(w.query, res.postId);
    let scheduled: string | null = null;
    if (settings.publishingLive) {
      const out = await scheduleLfdPost(w.query, res.postId, 'auto', now, nyDate);
      scheduled = out.scheduled ? out.publishAt : null;
      w.log('lfd_schedule', out.scheduled ? { runId: claimed.id, publishAt: out.publishAt } : { runId: claimed.id, note: out.note });
    }
    w.log('lfd_run_complete', { runId: claimed.id, postId: res.postId, stories: res.stories, short: res.short });
    return { runId: claimed.id, status: res.short ? 'partial' : 'ok', postId: res.postId, scheduled };
  } catch (error) {
    // Anything that threw before the engine finished the run: fail it now, so it never waits for the 2-hour sweep.
    const message = errorText(error);
    await failRun(w.query, claimed.id, message).catch(() => undefined);
    w.log('lfd_run_failed', { runId: claimed.id, error: message });
    return { runId: claimed.id, status: 'failed', note: message };
  }
}
```

`scripts/lfd_run.ts` — before (from the first dynamic import after the dry-run return to the result print):

```ts
  const { newAnthropic } = await import('@/lib/anthropic-client');
  const { liveMessagesCreate } = await import('@/lib/social/reporter/reporter');
  const { capped, createJevAsk, createJevTally, tallied } = await import('@/lib/social/jev/client');
  const { createRunBudget } = await import('@/lib/social/pipeline/live-stages');
  const { createLivePhotoFinder } = await import('@/lib/stories/photos');
  const { fetchAllFeeds } = await import('@/lib/social/ingest/fetch-feeds');
  const { HELIOS_SOCIAL_FEEDS } = await import('@/lib/social/feeds');
  const { fetchBodyLive } = await import('@/lib/social/ingest/select/enrich');
  const { checkRenderFit } = await import('@/lib/social/render/fit-check');
  const { readPage } = await import('@/lib/social/reporter/read-page');
  const { runLastFewDays } = await import('@/lib/lfd/run');

  const tally = createJevTally();
  const jev = capped(tallied(createJevAsk(), tally), tally, cap);
  const budget = createRunBudget({ capUsd: cap, otherSpendUsd: () => tally.costUsd });
  const create = budget.guard(liveMessagesCreate(newAnthropic()));
  const bucket = mediaBucket(SLIDE_BUCKET);

  const res = await runLastFewDays({
    query,
    jev,
    create,
    photos: createLivePhotoFinder({ jev, create, runRef: `lfd:${new Date().toISOString()}` }),
    fetchFeeds: () => fetchAllFeeds(HELIOS_SOCIAL_FEEDS),
    fetchBody: fetchBodyLive,
    readPage: (url) => readPage(url),
    fitCheck: checkRenderFit,
    upload: (p, b) => bucket.upload(p, b, 'image/jpeg'),
    now: new Date(),
    trigger: 'manual',
    capUsd: cap,
    spend: () => ({ claudeUsd: budget.claudeUsd(), jevUsd: tally.costUsd }),
  });
  console.log(JSON.stringify({ ...res, spentUsd: budget.spent() }, null, 2));
```

after:

```ts
  const { liveLfdDeps } = await import('@/lib/lfd/live');
  const { runLastFewDays } = await import('@/lib/lfd/run');
  const { deps, spentUsd } = await liveLfdDeps(query, { capUsd: cap, trigger: 'manual' });
  const res = await runLastFewDays(deps);
  console.log(JSON.stringify({ ...res, spentUsd: spentUsd() }, null, 2));
```

and remove the two now-unused lines near the top of `main()`:

```ts
  const { mediaBucket } = await import('@/lib/media-bucket');
  const { SLIDE_BUCKET } = await import('@/lib/social/overnight/config');
```

Do **not** run `scripts/lfd_run.ts` (with or without `--live`); the typecheck is its check.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx tsx --test tests/lfd-worker.test.ts tests/lfd-run.test.ts tests/lfd-schedule.test.ts`
Expected: PASS. Typecheck line prints nothing (this compiles `lib/lfd/live.ts` and `scripts/lfd_run.ts`).

- [ ] **Step 5: Commit**

```bash
git add lib/lfd/clock.ts lib/lfd/live.ts lib/lfd/worker.ts scripts/lfd_run.ts tests/lfd-worker.test.ts
git commit -m "feat(lfd): 3:00 decision, carry out a claimed run, one live-deps factory for worker and CLI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Wire the social worker; the clock doc; the deploy guard; STOP for the redeploy

**Files:**
- Modify: `scripts/social_worker.ts`, `scripts/gcp/deploy-social-worker.sh`, `docs/social-overnight.md`
- Test: `tests/lfd-worker-wiring.test.ts` (create)

**Interfaces:**
- Consumes: `readLfdSettings`, `requestRun`, `claimRun`, `carryOutLfdRun`, `threeAmQueue`, `liveLfdDeps`, `claimAndPublishLfd`,
  `releaseDueLfd`, `pollCarouselInsights(…, 'last_few_days')`, `publisherOwnsPublishing(query, 'last_few_days')`.
- Produces: the `helios-social` loop runs Last Few Days (3:00 Tue/Fri, manual runs, publishing, insights); the deploy script's
  in-flight check sees a running LFD run; the overnight doc has LFD's clock row.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lfd-worker-wiring.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

test('the social worker runs Last Few Days in its own loop: the 3:00 slot, claims, publishing, insights', () => {
  const text = read('scripts/social_worker.ts');
  assert.match(text, /threeAmQueue\(calendarDateKey\(new Date\(\)\), lfd, await autoRunOn\(\)/);
  assert.match(text, /lfdStore\.requestRun\(lfdQuery, 'scheduled'/);
  assert.match(text, /lfdStore\.claimRun\(lfdQuery\)/);
  assert.match(text, /carryOutLfdRun\(/);
  assert.match(text, /liveLfdDeps\(lfdQuery, \{ capUsd, trigger: run\.trigger, runId: run\.id \}\)/);
  assert.match(text, /publisherOwnsPublishing\(query, 'last_few_days'\)/);
  assert.match(text, /claimAndPublishLfd\(/);
  assert.match(text, /pollCarouselInsights\(query, client, new Date\(\), 200, 'last_few_days'\)/);
  // The carousel run is queued only when the slot belongs to it.
  assert.match(text, /else if \(slot\.queue === 'carousels'\)/);
});

test('a deploy waits for a running Last Few Days run', () => {
  assert.match(read('scripts/gcp/deploy-social-worker.sh'), /UNION ALL SELECT 'last few days run ' \|\| id FROM lfd\.runs WHERE status = 'running'/);
});

test('the overnight doc has the Last Few Days clock row', () => {
  const doc = read('docs/social-overnight.md');
  assert.match(doc, /^\| Last Few Days \| `lfd` \| `helios-social`/m);
  assert.match(doc, /not on Last Few Days days while its `auto_run` is on/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx --test tests/lfd-worker-wiring.test.ts`
Expected: FAIL on the first `assert.match` of each test.

- [ ] **Step 3: Edit `scripts/social_worker.ts`**

Re-read the file first.

(a) Header comment — before:

```ts
 * Nothing is scheduled or published unless social.settings.publishing_live is
```

after:

```ts
 * Last Few Days (docs/superpowers/specs/2026-10-13-last-few-days-design.md
 * §7.3) shares this process instead of a unit of its own: at 3:00 on its days
 * (lfd.settings.days, Tue/Fri) with its auto_run on, a Last Few Days run is
 * queued instead of the carousel run. Its runs (3:00, or the hub's "Make Last
 * Few Days now") are claimed in this loop, so they never overlap a carousel
 * run; a finished post joins the spine and, while lfd publishing_live is on,
 * takes its day's 9:00–10:00 AM window. Its posts publish and its insights are
 * read here like carousels until the single publisher drives the type.
 *
 * Nothing is scheduled or published unless social.settings.publishing_live is
```

(b) Add a type import after `import path from 'node:path';`:

```ts
import type { HubQuery } from '@/lib/social-hub/db';
```

(c) Before:

```ts
  const { nextRunAt } = await import('@/lib/instagram/clock');
```

after:

```ts
  const { calendarDateKey, nextRunAt } = await import('@/lib/instagram/clock');
```

(d) Before:

```ts
  const { publisherOwnsPublishing } = await import('@/lib/publishing/publisher');
  const query = await socialQuery();
```

after:

```ts
  const { publisherOwnsPublishing } = await import('@/lib/publishing/publisher');
  const lfdSettings = await import('@/lib/lfd/settings');
  const lfdStore = await import('@/lib/lfd/store');
  const { carryOutLfdRun } = await import('@/lib/lfd/worker');
  const { threeAmQueue } = await import('@/lib/lfd/clock');
  const { liveLfdDeps } = await import('@/lib/lfd/live');
  const { claimAndPublishLfd } = await import('@/lib/lfd/publish');
  const { releaseDueLfd } = await import('@/lib/lfd/schedule');
  const query = await socialQuery();
  /** The same connection, typed for lib/lfd (it takes the hub's query shape). */
  const lfdQuery = query as unknown as HubQuery;
```

(e) In `insights`, before:

```ts
    const result = await pollCarouselInsights(query, createCarouselInsightsClient({ token: process.env.META_USER_ACCESS_TOKEN! }));
    if (force || result.considered > 0) log('insights_complete', { ...result });
```

after:

```ts
    const client = createCarouselInsightsClient({ token: process.env.META_USER_ACCESS_TOKEN! });
    const result = await pollCarouselInsights(query, client);
    if (force || result.considered > 0) log('insights_complete', { ...result });
    // Last Few Days posts are feed carousels too: the same reads on the same cadence (spec §7.3).
    const lfd = await pollCarouselInsights(query, client, new Date(), 200, 'last_few_days');
    if (force || lfd.considered > 0) log('lfd_insights_complete', { ...lfd });
```

(f) Before:

```ts
    let lastRerunError: string | null = null;
```

after:

```ts
    let lastRerunError: string | null = null;
    let lastLfdError: string | null = null;
```

(g) The 3:00 block — before:

```ts
      if (Date.now() >= runAt.getTime()) {
        if (await autoRunOn().catch(() => false)) {
          const capUsd = (await getSocialSetting<number>('run_cap_usd')) ?? cfg.DEFAULT_RUN_CAP_USD;
          const id = await runs.requestRun(query, 'scheduled', { capUsd, hookPass: true }).catch((error) => {
            log('request_failed', { error: errorText(error) });
            return null;
          });
          log('run_requested', { runId: id, trigger: 'scheduled' });
        } else {
          log('run_skipped', { reason: 'auto_run is off' });
        }
        runAt = nextRun();
        continue;
      }
```

after:

```ts
      if (Date.now() >= runAt.getTime()) {
        // 3:00 AM: on a Last Few Days day with its auto_run on, its run takes the carousel run's slot (LFD-02).
        const lfd = await lfdSettings.readLfdSettings(lfdQuery).catch((error) => {
          log('lfd_settings_failed', { error: errorText(error) });
          return null;
        });
        const slot = threeAmQueue(calendarDateKey(new Date()), lfd, await autoRunOn().catch(() => false));
        if (slot.queue === 'last_few_days' && lfd?.runCapUsd != null) {
          const id = await lfdStore.requestRun(lfdQuery, 'scheduled', lfd.runCapUsd).catch((error) => {
            log('lfd_request_failed', { error: errorText(error) });
            return null;
          });
          log('lfd_run_requested', { runId: id, trigger: 'scheduled' });
        } else if (slot.queue === 'carousels') {
          const capUsd = (await getSocialSetting<number>('run_cap_usd')) ?? cfg.DEFAULT_RUN_CAP_USD;
          const id = await runs.requestRun(query, 'scheduled', { capUsd, hookPass: true }).catch((error) => {
            log('request_failed', { error: errorText(error) });
            return null;
          });
          log('run_requested', { runId: id, trigger: 'scheduled' });
        } else {
          log('run_skipped', { reason: slot.reason });
        }
        runAt = nextRun();
        continue;
      }
```

(h) After the carousel claim block — before:

```ts
      if (claimed) {
        await carryOutRun(claimed).catch((error) => log('run_failed', { runId: claimed.id, error: errorText(error) }));
        continue;
      }
```

after:

```ts
      if (claimed) {
        await carryOutRun(claimed).catch((error) => log('run_failed', { runId: claimed.id, error: errorText(error) }));
        continue;
      }

      // Last Few Days runs (3:00 Tue/Fri, or the hub's button), in this same process: never beside a carousel run.
      const lfdClaimed = await lfdStore.claimRun(lfdQuery).catch((error) => {
        // Logged once per distinct error (e.g. before the lfd schema is applied), not every poll.
        const text = errorText(error);
        if (text !== lastLfdError) log('lfd_claim_failed', { error: text });
        lastLfdError = text;
        return null;
      });
      if (lfdClaimed) {
        const out = await carryOutLfdRun(
          { query: lfdQuery, now: () => new Date(), log, engine: async (run, capUsd) => (await liveLfdDeps(lfdQuery, { capUsd, trigger: run.trigger, runId: run.id })).deps },
          lfdClaimed,
        );
        log('lfd_run_result', { ...out });
        continue;
      }
```

(i) LFD publishing, after the carousel publishing block — before:

```ts
      if (Date.now() - lastInsights >= INSIGHTS_EVERY_MS && !(await standDown())) {
```

after:

```ts
      // Last Few Days posts the same way while the single publisher doesn't drive it (D40, D41).
      const lfdNow = await lfdSettings.readLfdSettings(lfdQuery).catch(() => null);
      if (lfdNow?.publishingLive && !(await publisherOwnsPublishing(query, 'last_few_days'))) {
        const due = await releaseDueLfd(query, { requireApproval: lfdNow.requireApproval }).catch((error) => {
          log('lfd_schedule_release_failed', { error: errorText(error) });
          return 0;
        });
        if (due > 0) log('lfd_schedule_due', { released: due });
        if (metaConfigured()) {
          const published = await claimAndPublishLfd({ query, meta: createLiveCarouselClient(), signImage: (p: string, secs: number) => slideBucket.sign(p, secs) }).catch((error) => {
            log('lfd_publish_failed', { error: errorText(error) });
            return null;
          });
          if (published) {
            log('lfd_publish_complete', { ...published });
            continue;
          }
        }
      }

      if (Date.now() - lastInsights >= INSIGHTS_EVERY_MS && !(await standDown())) {
```

- [ ] **Step 4: Edit `scripts/gcp/deploy-social-worker.sh`**

Before:

```bash
      UNION ALL SELECT 'story set ' || id FROM stories.sets WHERE status = 'building'
```

after:

```bash
      UNION ALL SELECT 'story set ' || id FROM stories.sets WHERE status = 'building'
      UNION ALL SELECT 'last few days run ' || id FROM lfd.runs WHERE status = 'running'
```

- [ ] **Step 5: Edit `docs/social-overnight.md`**

(a) Clock table — before:

```markdown
| Carousels | `social` | `helios-social` | 3:00 daily run (only with `auto_run` on); the run's top `posts_per_day` = 2 posts, less what people placed for the day, are scheduled (see Daily fill) | 9:00–10:00 AM and 2:30–3:30 PM | 5:30 | built |
```

after:

```markdown
| Carousels | `social` | `helios-social` | 3:00 daily run (only with `auto_run` on; not on Last Few Days days while its `auto_run` is on, LFD-02); the run's top `posts_per_day` = 2 posts, less what people placed for the day, are scheduled (see Daily fill) | 9:00–10:00 AM and 2:30–3:30 PM (none on Last Few Days days while its `auto_run` is on) | 5:30 | built |
| Last Few Days | `lfd` | `helios-social` (the same process as Carousels; no unit of its own) | 3:00 on its days (`lfd.settings.days`, Tue/Fri), only with `lfd.settings.auto_run` on, in the carousel run's place; a manual run from the hub's "Make Last Few Days now" on any day | 9:00–10:00 AM on its days | read with Carousels: every 30 minutes while fresh and the 5:30 sweep | built |
```

(b) Before:

```markdown
Last Few Days (spec `docs/superpowers/specs/2026-10-13-last-few-days-design.md`): engine built (`lib/lfd`, schema `lfd`); runs by hand only (`npx tsx scripts/lfd_run.ts --live`, Tommy). Its clock row (3:00 Tue/Fri in the carousel run's place) lands with Plan 2.
```

after:

```markdown
Last Few Days (spec `docs/superpowers/specs/2026-10-13-last-few-days-design.md`) runs inside the `helios-social` worker
instead of a systemd unit of its own (step 3 of "Adding a content type" does not apply): one process carries out one run at a
time, so its 3:00 run can never overlap a carousel run, and "one type per hour" holds because it takes the carousel run's
slot on its days. Engine `lib/lfd`, schema `lfd`; its posts are spine items (`vertical 'last_few_days'`). A human-only CLI
run stays available (`npx tsx scripts/lfd_run.ts --live`, Tommy).
```

(c) Daily fill table — after the `| Carousels | The 3 AM run makes …` row add:

```markdown
| Last Few Days | One post on each of its days. A post a person placed for that day means the 3:00 run is skipped (`stop_reason` `quota-filled: …`). A manual run from the hub is never skipped. |
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx tsx --test tests/lfd-worker-wiring.test.ts tests/explainers-render.test.ts && bash -n scripts/gcp/deploy-social-worker.sh`
Expected: PASS, and `bash -n` prints nothing. Typecheck line prints nothing (it compiles `scripts/social_worker.ts`).

- [ ] **Step 7: Commit**

```bash
git add scripts/social_worker.ts scripts/gcp/deploy-social-worker.sh docs/social-overnight.md tests/lfd-worker-wiring.test.ts
git commit -m "feat(lfd): social worker runs Last Few Days at 3:00 Tue/Fri, claims, publishes, reads insights

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: STOP — the VM redeploy is Tommy's**

CLAUDE.md "Worker sync" requires redeploying `helios-social-worker` in the same session, but a deploy restarts every social
worker and ships to production, so the agent does not run it. Tell Tommy:

"Tasks 6–8 change `scripts/social_worker.ts` and `scripts/publisher_worker.ts` (Last Few Days at 3:00 Tue/Fri in the carousel
run's place, LFD runs claimed in the same loop, LFD publishing and insights). Nothing runs live until you turn LFD's switches
on (`auto_run` and `publishing_live` both ship off). Before deploying, apply the spine schema if you haven't
(`node scripts/apply_social_hub_schema.js --apply`, Task 1). Then deploy with `./scripts/gcp/deploy-social-worker.sh` (it
refuses while a run or publish is in flight). Want me to wait while you run it?"

Wait for Tommy. Continue with Task 9 only after he answers (the hub tasks do not depend on the deploy, but the redeploy must
not be forgotten).

---
### Task 9: Register the fifth vertical across the hub, with its read path

This task is large but mostly mechanical: adding `'last_few_days'` to `Vertical` makes TypeScript require an entry in every
exhaustive map and switch, so all of them land in one commit to keep the typecheck green. Several files here are being edited
by the Health-tab session (`lib/social-hub/health/*`, `lib/social-hub/cost-page/*`, `tests/social-health-*.test.ts`,
`tests/fixtures/social-hub/{health,cost}-fixture.ts`): re-read each immediately before editing and apply the same change to
whatever the current text is.

**Files:**
- Modify: `lib/social-hub/types.ts`, `lib/social-hub/verticals.ts`, `app/social-hub.css`, `lib/social-hub/ids.ts`,
  `lib/social-hub/lifecycle.ts`, `lib/social-hub/queries/spine.ts`, `lib/social-hub/dataset.ts`, `lib/social-hub/load.ts`,
  `lib/social-hub/factors.ts`, `lib/social-hub/cost.ts`, `lib/social-hub/house.ts`, `lib/social-hub/views/plan.ts`,
  `lib/social-hub/views/day-rank.ts`, `lib/social-hub/views/today.ts`, `lib/social-hub/queries/day.ts`,
  `lib/social-hub/views/run-for.ts`, `lib/social-hub/views/pools.ts`, `lib/social-hub/health/brief.ts`,
  `lib/social-hub/health/night.ts`, `lib/social-hub/health/reporters/shared.ts`, `lib/social-hub/cost-page/model.ts`,
  `lib/social-hub/cost-page/load.ts`, `lib/content-type/posting.ts`, `lib/publishing/actions/live.ts`,
  `components/social-hub/ui/marks.tsx`, `components/social-hub/content/PoolScreen.tsx`,
  `components/social-hub/content/ContentScreen.tsx`, `components/content-type/ContentTypePage.tsx`
- Create: `lib/social-hub/queries/last-few-days.ts`, `lib/social-hub/adapters/last-few-days.ts`,
  `lib/social-hub/health/reporters/last-few-days.ts`, `app/api/last-few-days/slides/[postId]/[n]/route.ts`
- Modify tests that pin the four-type lists: `tests/social-hub-actions.test.ts`, `tests/social-hub-viewmodels.test.ts`,
  `tests/social-health-view.test.ts`, `tests/social-health-report-job.test.ts`, `tests/social-cost-model.test.ts`,
  `tests/fixtures/social-hub/cost-fixture.ts`, `tests/fixtures/social-hub/health-fixture.ts`
- Test: `tests/lfd-hub.test.ts` (create)

**Interfaces:**
- Consumes: spine reads (`readSpine`, `forVertical`, `insightRows`), `settingIsOn`, adapter helpers
  (`lib/social-hub/adapters/common.ts`), `foldLifecycle`, `hubId`, `readLfdSettings`, `LFD_WINDOW`, `DEFAULT_LFD_DAYS`,
  `DEFAULT_LFD_RUN_CAP_USD`, `seedLfdPost`.
- Produces:
  - `Vertical` includes `'last_few_days'`; `VERTICALS`/`TYPE_PAGE_IDS` entries; `typeHref(v)` = `verticalInfo(v).href` outside
    the preview;
  - `readLastFewDays(q, spine): Promise<LfdRead>`; `lfdPosts(read): HubPost[]`, `lfdIdeas(run): HubIdea[]`, `lfdTitle`,
    `lfdReviewNotes`, `lfdSources`, `lfdSlides`;
  - `VerticalReads.last_few_days?: LfdRead | Error` (optional: a caller that reads only the first four types shows none);
  - `DayQuotas.last_few_days?: number` (default 1); `PLAN.last_few_days`; `quotaCandidates(…, 'last_few_days')` = one card on its
    days holding today's post;
  - `PostingState.days?: number[] | null`; `readPosting('last_few_days')`, `writePosting('last_few_days', …)`;
  - `reportLastFewDays: Reporter`; `poolStale(lastRefill, now, vertical?)`;
  - `GET /api/last-few-days/slides/<postId>/<n>` → redirect to a 10-minute signed URL.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lfd-hub.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isPostingType, writePosting, type PostingState } from '@/lib/content-type/posting';
import { DEFAULT_LFD_DAYS, LFD_WINDOW } from '@/lib/lfd/config';
import { buildDataset } from '@/lib/social-hub/dataset';
import { reportLastFewDays } from '@/lib/social-hub/health/reporters/last-few-days';
import { parseHubId } from '@/lib/social-hub/ids';
import { readAll } from '@/lib/social-hub/load';
import { DEFAULT_DAY_QUOTAS } from '@/lib/social-hub/queries/day';
import { bookSlot, ensureContentItem, type SpineQuery } from '@/lib/social-hub/spine';
import { isVertical, TYPE_PAGE_IDS, typeHref, verticalInfo } from '@/lib/social-hub/verticals';
import { quotaCandidates } from '@/lib/social-hub/views/day-rank';
import { PLAN } from '@/lib/social-hub/views/plan';
import { poolStale } from '@/lib/social-hub/views/pools';

import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

/** Tuesday 2026-10-13, 8:00 AM New York. */
const TUE_8 = new Date('2026-10-13T12:00:00Z');

test('Last Few Days is the fifth type: its page, color, ids and plan window', () => {
  assert.ok(isVertical('last_few_days'));
  const info = verticalInfo('last_few_days');
  assert.deepEqual([info.label, info.short, info.format, info.colorVar, info.href], ['Last Few Days', 'LFD', 'feed', '--sh-v-last_few_days', '/last-few-days']);
  assert.ok(TYPE_PAGE_IDS.includes('last_few_days'));
  assert.equal(typeHref('last_few_days'), '/last-few-days');
  assert.equal(typeHref('last_few_days', '/social/preview'), '/social/preview/type/last_few_days');
  assert.equal(typeHref('carousels'), '/carousels');
  assert.match(readFileSync(path.join(process.cwd(), 'app/social-hub.css'), 'utf8'), /--sh-v-last_few_days: #e0529c;/);
  const id = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(parseHubId(`last_few_days:${id}`), { vertical: 'last_few_days', kind: 'content', ref: id });
  assert.deepEqual(PLAN.last_few_days.map((w) => [w.id, w.startMinute, w.endMinute, w.days]), [[LFD_WINDOW.id, LFD_WINDOW.startMinute, LFD_WINDOW.endMinute, [...DEFAULT_LFD_DAYS]]]);
});

test('a post in review reads as one ready post with its slides, caption, sources and review notes; once booked it is the same post', async () => {
  const { query } = await openHubTestDb();
  const id = await seedLfdPost(query, { short: true, fitProblems: ['slide 3 text fit: body 140px > 126px'], renderProblems: ['slide 5 image failed to load'] });
  let d = buildDataset(await readAll(query), null, TUE_8);
  assert.deepEqual(d.errors, []);
  let mine = d.posts.filter((p) => p.vertical === 'last_few_days');
  assert.equal(mine.length, 1);
  const post = mine[0]!;
  assert.equal(post.id, `last_few_days:${id}`);
  assert.equal(post.status, 'ready');
  assert.equal(post.format, 'feed');
  assert.match(post.name, /^Last Few Days · Tue, Oct 13$/);
  assert.equal(post.media.kind, 'slides');
  const slides = post.media.kind === 'slides' ? post.media.slides : [];
  assert.equal(slides.length, 8);
  assert.equal(slides[0]!.src, `/api/last-few-days/slides/${id}/0`);
  assert.equal(slides[1]!.headline, 'Anthropic Releases Claude Haiku 5.5');
  assert.match(post.description ?? '', /^Do you realize/);
  assert.deepEqual(post.sources.map((s) => [s.url, s.title]), [
    ['https://big.com/haiku', 'The Verge: Anthropic Releases Claude Haiku 5.5'],
    ['https://n.com/1', 'Wired: Niche Thing 1 Happens'],
    ['https://n.com/2', 'Wired: Niche Thing 2 Happens'],
  ]);
  assert.deepEqual(post.reviewNotes, ['Short post: only 3 stories.', 'Text fit: slide 3 text fit: body 140px > 126px', 'Render: slide 5 image failed to load']);
  assert.deepEqual(post.idea, { id: 'lfd:2026-10-13', label: 'Last Few Days for 2026-10-13' });
  assert.equal(post.costItemKey, `last_few_days:${id}`);
  assert.deepEqual(post.refs, { lfdPostId: id });

  const item = await ensureContentItem(query as SpineQuery, { vertical: 'last_few_days', format: 'feed', nativeRef: id, ideaRef: null });
  await bookSlot(query as SpineQuery, { vertical: 'last_few_days', itemId: item, nyDate: '2026-10-13', slot: 'morning', publishAt: new Date('2026-10-13T13:30:00Z'), source: 'auto' });
  d = buildDataset(await readAll(query), null, TUE_8);
  mine = d.posts.filter((p) => p.vertical === 'last_few_days');
  assert.deepEqual(mine.map((p) => [p.id, p.status, p.nyDate, p.slot?.id]), [[`last_few_days:${id}`, 'scheduled', '2026-10-13', 'morning']]);
  assert.equal(mine[0]!.approval.required, true, 'require_approval is on and the slot was booked automatically');
});

test('the latest run gives the Ideas view its picks, drops and queue, in post order', async () => {
  const { query } = await openHubTestDb();
  await query(`INSERT INTO lfd.runs (trigger, status, started_at, record) VALUES ('manual', 'ok', '2026-10-13T07:00:00Z', $1::jsonb)`, [JSON.stringify({
    window: { after: '2026-10-09', through: '2026-10-13' },
    picks: [{ key: 'k1', lane: 'major', headline: 'Pick One', major: 0.8, net: null }],
    drops: [{ key: 'k2', lane: 'rundown', headline: 'Dropped Two', reason: 'not-grounded' }],
    queues: { major: [{ key: 'k1', headline: 'Pick One', major: 0.8, net: null }], rundown: [{ key: 'k3', headline: 'Next Three', major: null, net: 0.7 }] },
  })]);
  const ideas = buildDataset(await readAll(query), null, TUE_8).ideas.filter((i) => i.vertical === 'last_few_days');
  assert.deepEqual(ideas.map((i) => [i.id, i.state]), [['last_few_days:story:k1', 'content_ready'], ['last_few_days:story:k2', 'retired'], ['last_few_days:story:k3', 'idea_only']]);
  assert.match(ideas[0]!.detail ?? '', /window 2026-10-09 → 2026-10-13/);
  assert.match(ideas[1]!.detail ?? '', /dropped: it failed the fact check twice/);
  assert.ok(ideas[0]!.score! > ideas[2]!.score!, 'post order is score order');
});

test('today’s Last Few Days card is today’s post on its days, and nothing on other days', async () => {
  const { query } = await openHubTestDb();
  const id = await seedLfdPost(query);
  const data = { ...buildDataset(await readAll(query), null, TUE_8), dayQuotas: DEFAULT_DAY_QUOTAS };
  assert.deepEqual(quotaCandidates(data, 'last_few_days', TUE_8).map((c) => [c.post?.id ?? null, c.idea, c.locked]), [[`last_few_days:${id}`, null, false]]);
  assert.deepEqual(quotaCandidates(data, 'last_few_days', new Date('2026-10-14T12:00:00Z')), []);
});

test('the health report counts its scheduled runs; its quota is one on its days only', async () => {
  const { query } = await openHubTestDb();
  await query(`INSERT INTO lfd.runs (trigger, status, requested_at, started_at, finished_at, total_usd, cap_usd, error)
               VALUES ('scheduled', 'failed', '2026-10-13T07:00:00Z', '2026-10-13T07:00:05Z', '2026-10-13T07:10:00Z', 0.3, 1, 'writing failed: refusal')`);
  const posting: PostingState = { type: 'last_few_days', live: false, generate: true, autoPublish: false, perDay: null, maxPerDay: null, series: null, days: [2, 5] };
  const tue = await reportLastFewDays(query, { night: '2026-10-13', posting, now: TUE_8 });
  assert.deepEqual([tue.vertical, tue.due, tue.ran, tue.made, tue.needed, tue.failures.length, tue.failures[0]!.stage], ['last_few_days', true, true, 0, 1, 1, 'run']);
  const wed = await reportLastFewDays(query, { night: '2026-10-14', posting, now: new Date('2026-10-14T12:00:00Z') });
  assert.deepEqual([wed.due, wed.needed], [false, 0]);
});

test('posting: Last Few Days is a posting type with no daily quota; its pool goes stale after five days, not three', async () => {
  assert.equal(isPostingType('last_few_days'), true);
  await assert.rejects(() => writePosting('last_few_days', { perDay: 1 }, 't'), /no daily quota/);
  const fourDaysAgo = new Date(TUE_8.getTime() - 4 * 86_400_000).toISOString();
  assert.equal(poolStale(fourDaysAgo, TUE_8), true);
  assert.equal(poolStale(fourDaysAgo, TUE_8, 'last_few_days'), false);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx --test tests/lfd-hub.test.ts`
Expected: FAIL: `Cannot find module '@/lib/social-hub/health/reporters/last-few-days'`.

- [ ] **Step 3: Types, ids, lifecycle, spine metrics, color**

`lib/social-hub/types.ts` — before:

```ts
export type Vertical = 'reels' | 'explainers' | 'carousels' | 'stories';
```

after:

```ts
export type Vertical = 'reels' | 'explainers' | 'carousels' | 'stories' | 'last_few_days';
```

`lib/social-hub/verticals.ts` — before:

```ts
  { id: 'stories', label: 'IG Stories', short: 'Story', format: 'story', colorVar: '--sh-v-stories', href: '/stories', reviewHref: '/stories' },
];
```

after:

```ts
  { id: 'stories', label: 'IG Stories', short: 'Story', format: 'story', colorVar: '--sh-v-stories', href: '/stories', reviewHref: '/stories' },
  { id: 'last_few_days', label: 'Last Few Days', short: 'LFD', format: 'feed', colorVar: '--sh-v-last_few_days', href: '/last-few-days', reviewHref: '/last-few-days' },
];
```

Before:

```ts
export const TYPE_PAGE_IDS: readonly Vertical[] = ['reels', 'explainers', 'carousels', 'stories'];

/** A content type's own page: Text on Screen at /reels, the others at /carousels, /stories and /explainers. */
export function typeHref(vertical: Vertical, base = '/social'): string {
  // The fixture preview has its own mirror of the three hub-hosted pages; Text on Screen is a separate app page.
  return base === '/social/preview' && vertical !== 'reels' ? `${base}/type/${vertical}` : `/${vertical}`;
}
```

after:

```ts
export const TYPE_PAGE_IDS: readonly Vertical[] = ['reels', 'explainers', 'carousels', 'stories', 'last_few_days'];

/** A content type's own page (its `href`): /reels, /carousels, /stories, /explainers and /last-few-days. */
export function typeHref(vertical: Vertical, base = '/social'): string {
  // The fixture preview has its own mirror of the hub-hosted pages; Text on Screen is a separate app page.
  return base === '/social/preview' && vertical !== 'reels' ? `${base}/type/${vertical}` : verticalInfo(vertical).href;
}
```

`app/social-hub.css` — before:

```css
  --sh-v-stories: #c377e0;
```

after:

```css
  --sh-v-stories: #c377e0;
  --sh-v-last_few_days: #e0529c;
```

`lib/social-hub/ids.ts` — before:

```ts
  stories: ['content', 'set'],
};
```

after:

```ts
  stories: ['content', 'set'],
  last_few_days: ['content', 'attempt', 'schedule', 'post'],
};
```

`lib/social-hub/lifecycle.ts` — before:

```ts
    case 'stories':
      return r.setId ? { kind: 'content', ref: r.setId } : null;
  }
}
```

after:

```ts
    case 'stories':
      return r.setId ? { kind: 'content', ref: r.setId } : null;
    case 'last_few_days':
      return r.lfdPostId ? { kind: 'content', ref: r.lfdPostId } : null;
  }
}
```

`lib/social-hub/queries/spine.ts` — before:

```ts
  stories: ['views', 'reach', 'shares', 'follows', 'profile_visits', 'total_interactions'],
};
```

after:

```ts
  stories: ['views', 'reach', 'shares', 'follows', 'profile_visits', 'total_interactions'],
  last_few_days: ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'follows', 'profile_visits'],
};
```

- [ ] **Step 4: The hub read and adapter**

```ts
// lib/social-hub/queries/last-few-days.ts
import type { HubQuery } from '@/lib/social-hub/db';
import { settingIsOn, type InsightRow } from '@/lib/social-hub/queries/reels';
import { forVertical, insightRows, type SpineRead } from '@/lib/social-hub/queries/spine';

/**
 * Last Few Days reads (SELECT only; spec §8). Content lives in schema `lfd`:
 * a post is an lfd.posts row; the latest finished run's record feeds the Ideas
 * view. Slots, attempts, approvals and insights come from the shared spine
 * read (queries/spine.ts, D48), mapped to the row shapes below.
 */

export type LfdPostRow = {
  post_id: string;
  run_id: string | null;
  slug: string;
  ny_date: string;
  status: string;
  caption: string | null;
  created_at: string;
  published_at: string | null;
  render: Record<string, unknown> | null;
  stories: unknown;
  slide_count: number | null;
  has_slide_objects: boolean;
  fit_problems: unknown;
  render_problems: unknown;
  short: boolean;
};

export type LfdAttemptRow = {
  attempt_id: string;
  post_id: string;
  status: string;
  trigger: string;
  requested_at: string;
  finished_at: string | null;
  media_id: string | null;
  permalink: string | null;
  error: string | null;
  schedule_id: string | null;
  slot: string | null;
  publish_at: string | null;
  approved_at: string | null;
};

export type LfdScheduleRow = {
  schedule_id: string;
  post_id: string;
  ny_date: string;
  slot: string;
  publish_at: string;
  status: string;
  source: string;
  error: string | null;
  approved_at: string | null;
};

export type LfdRunRow = {
  id: string;
  status: string;
  trigger: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  total_usd: number | null;
  stop_reason: string | null;
  record: Record<string, unknown> | null;
};

export type LfdRead = {
  posts: LfdPostRow[];
  attempts: LfdAttemptRow[];
  schedules: LfdScheduleRow[];
  insights: InsightRow[];
  /** The newest run that made a post (its record is the Ideas view). */
  latestRun: LfdRunRow | null;
  requireApproval: boolean;
};

export const LFD_POSTS_SQL = `
SELECT p.id::text AS post_id, p.run_id::text AS run_id, p.slug, p.ny_date::text AS ny_date, p.status, p.caption,
       p.created_at::text AS created_at, p.published_at::text AS published_at, p.render, p.stories,
       COALESCE(jsonb_array_length(p.slide_objects), jsonb_array_length(p.render->'slides')) AS slide_count,
       (jsonb_typeof(p.slide_objects) = 'array' AND jsonb_array_length(p.slide_objects) > 0) AS has_slide_objects,
       p.fit_problems, p.render_problems, p.short
  FROM lfd.posts p
 ORDER BY p.created_at DESC`;

export const LFD_LATEST_RUN_SQL = `
SELECT id::text AS id, status, trigger, requested_at::text AS requested_at, started_at::text AS started_at,
       finished_at::text AS finished_at, total_usd::float8 AS total_usd, stop_reason, record
  FROM lfd.runs
 WHERE status IN ('ok', 'partial')
 ORDER BY COALESCE(started_at, requested_at) DESC
 LIMIT 1`;

export const LFD_REQUIRE_APPROVAL_SQL = `SELECT value FROM lfd.settings WHERE key = 'require_approval'`;

export async function readLastFewDays(q: HubQuery, spine: SpineRead): Promise<LfdRead> {
  const [posts, run, approval] = await Promise.all([
    q<LfdPostRow>(LFD_POSTS_SQL),
    q<LfdRunRow>(LFD_LATEST_RUN_SQL),
    q<{ value: unknown }>(LFD_REQUIRE_APPROVAL_SQL),
  ]);
  const mine = forVertical(spine, 'last_few_days');
  return {
    posts: posts.rows,
    attempts: mine.attempts.filter((a) => a.content_ref).map((a) => ({
      attempt_id: a.attempt_id, post_id: a.content_ref!, status: a.status, trigger: a.trigger,
      requested_at: a.requested_at, finished_at: a.finished_at, media_id: a.media_id, permalink: a.permalink, error: a.error,
      schedule_id: a.schedule_id, slot: a.slot, publish_at: a.publish_at, approved_at: a.approved_at,
    })),
    schedules: mine.schedules.filter((r) => r.content_ref).map((r) => ({
      schedule_id: r.schedule_id, post_id: r.content_ref!, ny_date: r.ny_date, slot: r.slot, publish_at: r.publish_at,
      status: r.status, source: r.source, error: r.error, approved_at: r.approved_at,
    })),
    insights: insightRows(mine.insights, 'last_few_days'),
    latestRun: run.rows[0] ?? null,
    requireApproval: settingIsOn(approval.rows),
  };
}
```

```ts
// lib/social-hub/adapters/last-few-days.ts
import { attemptStatus, cancelNote, category, historyByMedia, iso, latest, nyDateFor, scheduleStatus, text, yesNo } from '@/lib/social-hub/adapters/common';
import { hubId } from '@/lib/social-hub/ids';
import { foldLifecycle } from '@/lib/social-hub/lifecycle';
import type { LfdPostRow, LfdRead, LfdRunRow } from '@/lib/social-hub/queries/last-few-days';
import type { FactorValue, HubIdea, HubPost, HubStatus, MetricSnapshot, NativeField, SourceRef } from '@/lib/social-hub/types';

/**
 * Last Few Days posts and ideas for the hub (spec §8). A post is one lfd.posts
 * row through its life (ready → scheduled → posting → published), under the id
 * `last_few_days:<post id>`. The review screen shows its slides, its caption,
 * each story's source, and what the pipeline flagged (short post, text fit,
 * broken slides).
 */

const SLOT_LABEL: Record<string, string> = { morning: 'Morning · 9:00–10:00 AM' };

type Story = { lane?: string; url?: string; outlet?: string; headline?: string; body?: string; photo?: { src?: string; kind?: string } };
type Context = { slot: string | null; approvedAt: string | null; requireApproval: boolean };
type RenderSlide = { layoutVariant?: unknown; altText?: unknown; photoUrl?: unknown; lfdStory?: { headline?: unknown; body?: unknown } };

const storiesOf = (row: LfdPostRow): Story[] => (Array.isArray(row.stories) ? (row.stories as Story[]) : []);
const listOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []);
const day = (row: Pick<LfdPostRow, 'ny_date'>) => row.ny_date.slice(0, 10);

/** "Last Few Days · Tue, Oct 13" */
export function lfdTitle(row: Pick<LfdPostRow, 'ny_date'>): string {
  const date = new Date(`${day(row)}T12:00:00Z`);
  return `Last Few Days · ${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

/** What the review screen flags: a short post, text taller than the template allows, broken slides. */
export function lfdReviewNotes(row: LfdPostRow): string[] {
  const n = storiesOf(row).length;
  return [
    ...(row.short ? [`Short post: only ${n} ${n === 1 ? 'story' : 'stories'}.`] : []),
    ...listOf(row.fit_problems).map((p) => `Text fit: ${p}`),
    ...listOf(row.render_problems).map((p) => `Render: ${p}`),
  ];
}

/** Each story's article, once, as "Outlet: Headline". */
export function lfdSources(row: LfdPostRow): SourceRef[] {
  const seen = new Set<string>();
  return storiesOf(row).flatMap((s) => {
    if (!s.url || seen.has(s.url)) return [];
    seen.add(s.url);
    return [{ url: s.url, title: [s.outlet, s.headline].filter(Boolean).join(': ') || null }];
  });
}

/** The slides: rendered JPEGs through /api/last-few-days/slides once stored, else the outline from `render`. */
export function lfdSlides(row: LfdPostRow): Array<{ src: string | null; alt: string; photo: string | null; layout: string | null; headline: string | null; body: string | null }> {
  const slides = Array.isArray(row.render?.slides) ? (row.render!.slides as RenderSlide[]) : [];
  const count = Math.max(slides.length, row.slide_count ?? 0);
  const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
  return Array.from({ length: count }, (_, i) => {
    const slide = slides[i] ?? {};
    return {
      src: row.has_slide_objects ? `/api/last-few-days/slides/${row.post_id}/${i}` : null,
      alt: str(slide.altText) ?? `${lfdTitle(row)}, slide ${i + 1}`,
      photo: typeof slide.photoUrl === 'string' && /^https:\/\//.test(slide.photoUrl) ? slide.photoUrl : null,
      layout: str(slide.layoutVariant),
      headline: str(slide.lfdStory?.headline),
      body: str(slide.lfdStory?.body),
    };
  });
}

function nativeFields(row: LfdPostRow, ctx: Context): NativeField[] {
  const stories = storiesOf(row);
  return [
    { group: 'content', label: 'Stories', value: String(stories.length) },
    { group: 'content', label: 'Major headlines', value: String(stories.filter((s) => s.lane === 'major').length) },
    { group: 'content', label: 'Short post', value: row.short ? 'Yes' : 'No' },
    { group: 'production', label: 'Slides', value: row.slide_count == null ? '—' : String(row.slide_count) },
    { group: 'production', label: 'Text fit problems', value: String(listOf(row.fit_problems).length) },
    { group: 'production', label: 'Render problems', value: String(listOf(row.render_problems).length) },
    { group: 'scheduling', label: 'Posting slot', value: ctx.slot ? SLOT_LABEL[ctx.slot] ?? ctx.slot : '—' },
    { group: 'scheduling', label: 'Approval', value: ctx.approvedAt ? 'Approved' : ctx.requireApproval ? 'Needs approval' : 'Not required' },
    { group: 'scheduling', label: 'Slug', value: row.slug },
  ];
}

function factorValues(row: LfdPostRow, ctx: Context): Record<string, FactorValue> {
  const n = storiesOf(row).length;
  return {
    stories: { kind: 'category', key: String(n), label: `${n} stories` },
    short: yesNo(row.short, ['short', 'Short post'], ['full', 'Full post']),
    slot: category(ctx.slot, SLOT_LABEL, 'Outside a slot'),
    approval: ctx.approvedAt ? { kind: 'category', key: 'approved', label: 'Approved' } : { kind: 'category', key: 'not_approved', label: 'Not approved' },
  };
}

function shell(row: LfdPostRow, ctx: Context) {
  return {
    vertical: 'last_few_days' as const,
    format: 'feed' as const,
    name: lfdTitle(row),
    description: text(row.caption),
    slot: ctx.slot ? { id: ctx.slot, label: SLOT_LABEL[ctx.slot] ?? ctx.slot } : null,
    pipelineHref: '/last-few-days',
    media: { kind: 'slides' as const, slides: lfdSlides(row) },
    costMicros: null,
    costNote: null,
    native: nativeFields(row, ctx),
    factorValues: factorValues(row, ctx),
    approval: { required: ctx.requireApproval, approvedAt: ctx.approvedAt, note: ctx.approvedAt ? 'Approved' : null },
    // Not stored (idea_ref is NULL, spec §7.2): the post's own day, so "today's post" can be found.
    idea: { id: `lfd:${day(row)}`, label: `Last Few Days for ${day(row)}` },
    generatedAt: iso(row.created_at),
    versions: [],
    sources: lfdSources(row),
    costItemKey: `last_few_days:${row.post_id}`,
    reviewNotes: lfdReviewNotes(row),
  };
}

export function lfdPosts(read: LfdRead): HubPost[] {
  const history = historyByMedia(read.insights);
  const byId = new Map(read.posts.map((p) => [p.post_id, p]));
  const posts: HubPost[] = [];

  for (const row of read.attempts) {
    const post = byId.get(row.post_id);
    if (!post) continue;
    const status = attemptStatus(row.status);
    const snapshots: MetricSnapshot[] = row.media_id ? history.get(row.media_id) ?? [] : [];
    const finished = iso(row.finished_at);
    // Approve and Force are a person's click (SH-17); an auto slot carries approved_at.
    const approvedAt = row.trigger === 'force' ? iso(row.requested_at) : iso(row.approved_at) ?? (row.trigger === 'approve' ? iso(row.requested_at) : null);
    posts.push({
      ...shell(post, { slot: row.slot, approvedAt, requireApproval: read.requireApproval && row.trigger === 'auto' }),
      id: hubId('last_few_days', 'attempt', row.attempt_id),
      status,
      statusNote: status === 'failed' ? text(row.error) : null,
      postedAt: status === 'published' ? finished : null,
      publishAt: iso(row.publish_at),
      nyDate: nyDateFor(status === 'published' ? finished : null, row.publish_at, row.requested_at),
      permalink: row.permalink,
      metrics: latest(snapshots),
      history: snapshots,
      refs: { attemptId: row.attempt_id, lfdPostId: row.post_id, ...(row.schedule_id ? { scheduleId: row.schedule_id } : {}) },
    });
  }
  for (const row of read.schedules) {
    const post = byId.get(row.post_id);
    if (!post) continue;
    const status: HubStatus = scheduleStatus(row.status);
    posts.push({
      ...shell(post, { slot: row.slot, approvedAt: iso(row.approved_at), requireApproval: read.requireApproval && row.source === 'auto' }),
      id: hubId('last_few_days', 'schedule', row.schedule_id),
      status,
      statusNote: status === 'cancelled' ? cancelNote(row.error) : status === 'failed' ? text(row.error) : null,
      postedAt: null,
      publishAt: iso(row.publish_at),
      nyDate: row.ny_date.slice(0, 10),
      permalink: null,
      metrics: {},
      history: [],
      refs: { scheduleId: row.schedule_id, lfdPostId: row.post_id },
    });
  }
  // Content ready: every post still in review. The lifecycle view keeps it only when nothing live holds it.
  for (const row of read.posts) {
    if (row.status !== 'review') continue;
    posts.push({
      ...shell(row, { slot: null, approvedAt: null, requireApproval: read.requireApproval }),
      id: hubId('last_few_days', 'post', row.post_id),
      status: 'ready',
      statusNote: 'In review, not scheduled',
      postedAt: null,
      publishAt: null,
      nyDate: null,
      permalink: null,
      metrics: {},
      history: [],
      refs: { lfdPostId: row.post_id },
    });
  }
  return foldLifecycle('last_few_days', posts);
}

type QueueEntry = { key?: string; headline?: string; lane?: string; major?: number | null; net?: number | null; reason?: string; detail?: string };

const DROP_REASON: Record<string, string> = {
  'thin-text': 'the article text was too thin',
  'not-grounded': 'it failed the fact check twice',
  'no-photo': 'no usable photo',
  'write-failed': 'the writing call failed for it',
  'image-failed': 'its photo failed to load',
  unfinished: 'still waiting when the rounds ran out',
  'vision-rejected': "the vision check said its photo doesn't show the story",
};

/**
 * The Ideas view (spec §8): the latest run's picks (in the post), its drops
 * with the reason, and the rest of each lane's queue, in post order. The pool
 * for the next post needs Jev judgments, so it is not computed on a page view.
 */
export function lfdIdeas(run: LfdRunRow | null): HubIdea[] {
  if (!run) return [];
  const r = (run.record ?? {}) as { window?: { after?: string; through?: string }; picks?: QueueEntry[]; drops?: QueueEntry[]; queues?: { major?: QueueEntry[]; rundown?: QueueEntry[] } };
  const window = r.window?.after && r.window.through ? `window ${r.window.after} → ${r.window.through}` : null;
  const at = iso(run.started_at ?? run.requested_at);
  const out: HubIdea[] = [];
  const seen = new Set<string>();
  const add = (e: QueueEntry, lane: string, state: HubIdea['state'], note: string | null) => {
    if (!e.key || seen.has(e.key)) return;
    seen.add(e.key);
    const scored = e.major != null ? `major-news ${e.major.toFixed(2)}` : e.net != null ? `net ${e.net.toFixed(2)}` : null;
    const laneLabel = lane === 'major' ? 'Major headline' : 'Rundown';
    out.push({
      id: `last_few_days:story:${e.key}`,
      vertical: 'last_few_days',
      title: text(e.headline) ?? e.key,
      // Post order, highest first: rankIdeas sorts by score.
      score: -out.length,
      scoreLabel: 'Order for the post (major headlines first)',
      breakdown: {
        formula: 'Up to 3 major headlines (major-news@2 at or above 0.55) lead; Text on Screen ideas fill the rest by best net score.',
        parts: [{ label: laneLabel, points: null, detail: scored }],
        note: window,
      },
      state,
      hasContent: state === 'content_ready',
      versionCount: state === 'content_ready' ? 1 : 0,
      generatedAt: state === 'content_ready' ? at : null,
      createdAt: at,
      detail: [laneLabel, note, window].filter(Boolean).join(' · '),
    });
  };
  for (const p of r.picks ?? []) add(p, p.lane ?? 'rundown', 'content_ready', 'in the post');
  for (const d of r.drops ?? []) add(d, d.lane ?? 'rundown', 'retired', `dropped: ${DROP_REASON[d.reason ?? ''] ?? d.reason ?? 'no reason recorded'}${d.detail ? ` (${d.detail})` : ''}`);
  for (const q of r.queues?.major ?? []) add(q, 'major', 'idea_only', null);
  for (const q of r.queues?.rundown ?? []) add(q, 'rundown', 'idea_only', null);
  return out;
}
```

`lib/social-hub/dataset.ts` — add imports after `import { storyIdeas, storyPosts } from '@/lib/social-hub/adapters/stories';`:

```ts
import { lfdIdeas, lfdPosts } from '@/lib/social-hub/adapters/last-few-days';
import type { LfdRead } from '@/lib/social-hub/queries/last-few-days';
```

Before:

```ts
  stories: StoriesRead | Error;
};
```

after:

```ts
  stories: StoriesRead | Error;
  /** Optional: a caller that reads only the first four types (older fixtures) shows no Last Few Days posts. */
  last_few_days?: LfdRead | Error;
};
```

Before:

```ts
    case 'stories': {
      const r = reads.stories;
      return r instanceof Error ? r : { posts: storyPosts(r), ideas: storyIdeas(r.pool) };
    }
  }
}

const ORDER: Vertical[] = ['reels', 'explainers', 'carousels', 'stories'];
```

after:

```ts
    case 'stories': {
      const r = reads.stories;
      return r instanceof Error ? r : { posts: storyPosts(r), ideas: storyIdeas(r.pool) };
    }
    case 'last_few_days': {
      const r = reads.last_few_days;
      if (!r) return { posts: [], ideas: [] };
      return r instanceof Error ? r : { posts: lfdPosts(r), ideas: lfdIdeas(r.latestRun) };
    }
  }
}

const ORDER: Vertical[] = ['reels', 'explainers', 'carousels', 'stories', 'last_few_days'];
```

`lib/social-hub/load.ts` — add after `import { readCarousels } from '@/lib/social-hub/queries/carousels';`:

```ts
import { readLastFewDays } from '@/lib/social-hub/queries/last-few-days';
```

Before:

```ts
  const mainSpine = readSpine(q, shared ? ['carousels', 'reels', 'explainers'] : ['carousels', 'reels']);
```

after:

```ts
  const mainSpine = readSpine(q, shared ? ['carousels', 'reels', 'explainers', 'last_few_days'] : ['carousels', 'reels', 'last_few_days']);
```

Before:

```ts
  const [reels, explainers, carousels, stories] = await Promise.all([
    settle(mainSpine.then((spine) => readReels(q, spine))),
    settle(explainersQ.then(async (eq) => readExplainers(eq, await explainersSpine(eq)))),
    settle(mainSpine.then((spine) => readCarousels(q, spine))),
    settle(readStories(q)),
  ]);
  return { reels, explainers, carousels, stories };
```

after:

```ts
  const [reels, explainers, carousels, stories, lastFewDays] = await Promise.all([
    settle(mainSpine.then((spine) => readReels(q, spine))),
    settle(explainersQ.then(async (eq) => readExplainers(eq, await explainersSpine(eq)))),
    settle(mainSpine.then((spine) => readCarousels(q, spine))),
    settle(readStories(q)),
    settle(mainSpine.then((spine) => readLastFewDays(q, spine))),
  ]);
  return { reels, explainers, carousels, stories, last_few_days: lastFewDays };
```

```ts
// app/api/last-few-days/slides/[postId]/[n]/route.ts
import { NextResponse, type NextRequest } from 'next/server';

import { dbQuery } from '@/lib/db';
import { mediaBucket } from '@/lib/media-bucket';
import { SLIDE_BUCKET } from '@/lib/social/overnight/config';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A Last Few Days slide's rendered JPEG, through a short signed URL (the bucket stays private). */
export async function GET(_request: NextRequest, context: { params: Promise<{ postId: string; n: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { postId, n } = await context.params;
  const index = Number(n);
  if (!/^[0-9a-f-]{36}$/i.test(postId) || !Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const { rows } = await dbQuery<{ slide_objects: unknown }>(`SELECT slide_objects FROM lfd.posts WHERE id = $1`, [postId]);
  const objects = rows[0]?.slide_objects;
  const path = Array.isArray(objects) && typeof objects[index] === 'string' ? (objects[index] as string) : null;
  if (!path) return NextResponse.json({ error: 'Not rendered yet.' }, { status: 404 });
  return NextResponse.redirect(await mediaBucket(SLIDE_BUCKET).sign(path, 600));
}
```

- [ ] **Step 5: Plan window, day quota, today's card, pools, run chips**

`lib/social-hub/views/plan.ts` — before:

```ts
  stories: [
    { id: 'morning_download', label: 'Morning Download', startMinute: 8 * 60 + 30, endMinute: 10 * 60, days: EVERY_DAY },
```

after:

```ts
  // lib/lfd/config.ts LFD_WINDOW on DEFAULT_LFD_DAYS (Tue, Fri); tests/lfd-hub.test.ts pins the copy.
  last_few_days: [{ id: 'morning', label: 'Morning', startMinute: 9 * 60, endMinute: 10 * 60, days: [2, 5] }],
  stories: [
    { id: 'morning_download', label: 'Morning Download', startMinute: 8 * 60 + 30, endMinute: 10 * 60, days: EVERY_DAY },
```

`lib/social-hub/views/day-rank.ts` — before:

```ts
export type DayQuotas = { reels: number; carousels: number; explainers: number };
```

after:

```ts
export type DayQuotas = {
  reels: number;
  carousels: number;
  explainers: number;
  /** One post on each of its days (spec §7.4); missing reads as one. */
  last_few_days?: number;
};
```

Before:

```ts
  const quota = Math.min(data.dayQuotas?.[vertical] ?? windows.length, windows.length);
  if (quota <= 0) return [];
```

after:

```ts
  if (vertical === 'last_few_days') {
    // One card on its days: the post holding today's window, else today's made post (it has no idea pool to rank).
    const quota = Math.min(data.dayQuotas?.last_few_days ?? 1, windows.length);
    if (quota <= 0) return [];
    const mine = data.posts.filter((p) => p.vertical === 'last_few_days' && !isRejected(p));
    const post = mine.find((p) => p.nyDate === today && HOLDS.has(p.status))
      ?? mine.find((p) => p.idea?.id === `lfd:${today}` && (p.status === 'generating' || (p.status === 'ready' && hasMedia(p))))
      ?? null;
    return [{ vertical, idea: null, post, locked: Boolean(post && HOLDS.has(post.status)), rank: null, moved: null }];
  }
  const quota = Math.min(data.dayQuotas?.[vertical] ?? windows.length, windows.length);
  if (quota <= 0) return [];
```

Before:

```ts
export const DAY_TYPES: readonly Vertical[] = ['reels', 'carousels', 'explainers', 'stories'];
```

after:

```ts
export const DAY_TYPES: readonly Vertical[] = ['reels', 'carousels', 'explainers', 'stories', 'last_few_days'];
```

`lib/social-hub/views/today.ts` (in `slotsForDay`) — before:

```ts
    const configured = vertical === 'stories' || !dayQuotas ? windows : dayQuotas[vertical];
```

after:

```ts
    const configured = vertical === 'stories' || !dayQuotas ? windows : dayQuotas[vertical] ?? windows;
```

`lib/social-hub/queries/day.ts` — before:

```ts
export const DEFAULT_DAY_QUOTAS: DayQuotas = { reels: 3, carousels: 2, explainers: 2 };
```

after:

```ts
export const DEFAULT_DAY_QUOTAS: DayQuotas = { reels: 3, carousels: 2, explainers: 2, last_few_days: 1 };
```

Before:

```ts
    explainers: perDay(explainers.rows, DEFAULT_DAY_QUOTAS.explainers, 1),
  };
```

after:

```ts
    explainers: perDay(explainers.rows, DEFAULT_DAY_QUOTAS.explainers, 1),
    last_few_days: DEFAULT_DAY_QUOTAS.last_few_days,
  };
```

`lib/social-hub/views/pools.ts` — before:

```ts
export function poolStale(lastRefill: string | null | undefined, now: Date): boolean {
  return Boolean(lastRefill) && now.getTime() - Date.parse(lastRefill!) > POOL_STALE_MS;
}
```

after:

```ts
/** Last Few Days refills twice a week (Friday to Tuesday is four days), so its pool is stale only after five. */
const LFD_STALE_MS = 5 * 86_400_000;

export function poolStale(lastRefill: string | null | undefined, now: Date, vertical?: Vertical): boolean {
  const limit = vertical === 'last_few_days' ? LFD_STALE_MS : POOL_STALE_MS;
  return Boolean(lastRefill) && now.getTime() - Date.parse(lastRefill!) > limit;
}
```

`components/social-hub/content/PoolScreen.tsx` — before: `  const stale = poolStale(summary.lastRefill, now);` after:
`  const stale = poolStale(summary.lastRefill, now, vertical);`

`components/social-hub/content/ContentScreen.tsx` — before: `      {poolStale(pool.lastRefill, now) ? (` after:
`      {poolStale(pool.lastRefill, now, pool.vertical) ? (`

`lib/social-hub/views/run-for.ts` — before:

```ts
  if (c.vertical === 'reels') return null;
```

after:

```ts
  // Last Few Days runs aren't in AllProgress yet (their progress strip lands with the type page).
  if (c.vertical === 'reels' || c.vertical === 'last_few_days') return null;
```

- [ ] **Step 6: Factors, cost, house, marks, pool copy, actions entry, type page narrowing**

`lib/social-hub/factors.ts` — before (the end of `VERTICAL_FACTORS`):

```ts
    { id: 'trigger', label: 'Trigger' },
  ],
};
```

after:

```ts
    { id: 'trigger', label: 'Trigger' },
  ],
  last_few_days: [
    { id: 'stories', label: 'Story count' },
    { id: 'short', label: 'Short post' },
    { id: 'slot', label: 'Posting slot' },
    { id: 'approval', label: 'Approval' },
  ],
};
```

`lib/social-hub/cost.ts` — before:

```ts
  const byVertical: CostSummary['byVertical'] = { reels: zero(), explainers: zero(), carousels: zero(), stories: zero() };
```

after:

```ts
  const byVertical: CostSummary['byVertical'] = { reels: zero(), explainers: zero(), carousels: zero(), stories: zero(), last_few_days: zero() };
```

`lib/social-hub/house.ts` — before:

```ts
const PUBLISH_CONFIRM: Record<'reels' | 'carousels' | 'explainers' | 'stories', string> = {
```

after:

```ts
const PUBLISH_CONFIRM: Record<Vertical, string> = {
```

and before:

```ts
  stories: 'This set is approved and goes out now, frame by frame.',
};
```

after:

```ts
  stories: 'This set is approved and goes out now, frame by frame.',
  last_few_days: 'This Last Few Days post goes out now instead of in its slot. Publishing counts as your approval, and its waiting slot is released so it can’t post twice.',
};
```

and in `contentRefs`, before:

```ts
    case 'stories':
      return { setId: post.refs.setId };
  }
}
```

after:

```ts
    case 'stories':
      return { setId: post.refs.setId };
    case 'last_few_days':
      return { lfdPostId: post.refs.lfdPostId };
  }
}
```

`components/social-hub/ui/marks.tsx` — add `Newspaper,` to the `lucide-react` import list (alphabetical, after `Loader,`),
then before:

```ts
  stories: Sparkles,
};
```

(the `TYPE_ICON` map) after:

```ts
  stories: Sparkles,
  last_few_days: Newspaper,
};
```

`components/social-hub/content/PoolScreen.tsx` — before:

```ts
  stories: 'Built at 4:00 AM from the other pools, one set per series that is due.',
};
```

after:

```ts
  stories: 'Built at 4:00 AM from the other pools, one set per series that is due.',
  last_few_days: 'Picked at 3:00 AM on Tuesdays and Fridays: up to 3 major headlines, then the best Text on Screen ideas. This is the latest post’s queue, its picks and what it dropped.',
};
```

`lib/publishing/actions/live.ts` — before:

```ts
      rescheduleSet: (id, nyDate, publishAt) => db.transaction((tx) => storiesRepo.rescheduleSet(tx, id, nyDate, publishAt)),
    }),
  };
}
```

after:

```ts
      rescheduleSet: (id, nyDate, publishAt) => db.transaction((tx) => storiesRepo.rescheduleSet(tx, id, nyDate, publishAt)),
    }),
    // Its verbs land with the hub actions (lib/publishing/actions/last-few-days.ts); none is offered until then.
    last_few_days: { vertical: 'last_few_days' },
  };
}
```

`components/content-type/ContentTypePage.tsx` — before:

```ts
const TITLE: Record<Exclude<Vertical, 'reels'>, string> = { carousels: 'Carousels', stories: 'Stories', explainers: 'Explainers' };
const BENCH_NOTE: Record<Exclude<Vertical, 'reels'>, string> = {
```

after:

```ts
/** The types this page draws (Text on Screen has its own app page; Last Few Days joins with its Run button and settings). */
type PageVertical = Exclude<Vertical, 'reels' | 'last_few_days'>;

const TITLE: Record<PageVertical, string> = { carousels: 'Carousels', stories: 'Stories', explainers: 'Explainers' };
const BENCH_NOTE: Record<PageVertical, string> = {
```

and before:

```ts
export async function ContentTypePage({ vertical }: { vertical: Exclude<Vertical, 'reels'> }) {
```

after:

```ts
export async function ContentTypePage({ vertical }: { vertical: PageVertical }) {
```

- [ ] **Step 7: Posting switches, health reporter, cost page**

`lib/content-type/posting.ts` — add imports after `import { PLAN } from '@/lib/social-hub/views/plan';`:

```ts
import { dbQuery } from '@/lib/db';
import { readLfdSettings } from '@/lib/lfd/settings';
```

Before:

```ts
export type ContentType = 'reels' | 'carousels' | 'explainers' | 'stories';

export const POSTING_TYPES: readonly ContentType[] = ['reels', 'carousels', 'explainers', 'stories'];
```

after:

```ts
export type ContentType = 'reels' | 'carousels' | 'explainers' | 'stories' | 'last_few_days';

export const POSTING_TYPES: readonly ContentType[] = ['reels', 'carousels', 'explainers', 'stories', 'last_few_days'];
```

Before:

```ts
  series: SeriesState[] | null;
};
```

(the end of `PostingState`) after:

```ts
  series: SeriesState[] | null;
  /** Last Few Days: the weekdays it posts once (0 = Sunday). Absent for the other types. */
  days?: number[] | null;
};
```

Before:

```ts
  const s = await loadStories(liveStoriesDb);
```

after:

```ts
  if (type === 'last_few_days') {
    const s = await readLfdSettings((text, params) => dbQuery(text, params));
    // One post on each of its days (spec §7.4): no per-day quota to set.
    return { type, live: s.publishingLive, generate: s.autoRun, autoPublish: !s.requireApproval, perDay: null, maxPerDay: null, series: null, days: s.days };
  }
  const s = await loadStories(liveStoriesDb);
```

Before:

```ts
    if (type === 'stories') throw new Error('Stories have no daily quota; each series has its own days.');
```

after:

```ts
    if (type === 'stories') throw new Error('Stories have no daily quota; each series has its own days.');
    if (type === 'last_few_days') throw new Error('Last Few Days has no daily quota; it posts once on each of its days.');
```

Before:

```ts
    const n = quota(patch, windows('reels'), 0);
    if (n != null) await setReelsSetting('posts_per_day', n);
  } else {
```

after:

```ts
    const n = quota(patch, windows('reels'), 0);
    if (n != null) await setReelsSetting('posts_per_day', n);
  } else if (type === 'last_few_days') {
    const set = (key: string, value: unknown) =>
      dbQuery(
        `INSERT INTO lfd.settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
    if (patch.generate !== undefined) await set('auto_run', patch.generate);
    if (patch.autoPublish !== undefined) await set('require_approval', !patch.autoPublish);
    if (patch.live !== undefined) await set('publishing_live', patch.live);
  } else {
```

`lib/social-hub/health/reporters/shared.ts` — before:

```ts
export function quotaFor(posting: PostingState, night: string): number {
  if (posting.series) {
```

after:

```ts
export function quotaFor(posting: PostingState, night: string): number {
  // Last Few Days: one post on each of its days (spec §7.4).
  if (posting.days) return posting.days.includes(weekdayIndex(night)) ? 1 : 0;
  if (posting.series) {
```

```ts
// lib/social-hub/health/reporters/last-few-days.ts
import type { HubQuery } from '@/lib/social-hub/db';
import { reasonFor } from '@/lib/social-hub/health/reasons';
import { emptyReport, funnelFrom, publishingFor, withPublishing, type Reporter } from '@/lib/social-hub/health/reporters/shared';
import { cycleBounds } from '@/lib/social-hub/health/time';
import type { FailureEvent } from '@/lib/social-hub/health/types';

type RunRow = { id: string; status: string; stop_reason: string | null; error: string | null; total_usd: number; cap_usd: number; at: string };

/** Last Few Days' night: its scheduled 3:00 runs (spec §7.3). A manual run is a person's, not the night's. */
export const reportLastFewDays: Reporter = async (q: HubQuery, { night, posting }) => {
  const { start, end } = cycleBounds(night);
  const runs = (await q<RunRow>(
    `SELECT id::text, status, stop_reason, error, total_usd::float8 AS total_usd, cap_usd::float8 AS cap_usd,
            COALESCE(started_at, requested_at)::text AS at
       FROM lfd.runs
      WHERE trigger = 'scheduled'
        AND COALESCE(started_at, requested_at) >= $1 AND COALESCE(started_at, requested_at) < $2
      ORDER BY requested_at`,
    [start.toISOString(), end.toISOString()],
  )).rows;
  const failures: FailureEvent[] = [];
  for (const run of runs) {
    const at = new Date(run.at).toISOString();
    if (run.status === 'failed') {
      failures.push({ vertical: 'last_few_days', night, at, stage: 'run', reason: reasonFor('run', run.error ?? run.stop_reason), severity: 'failed', rawError: run.error ?? run.stop_reason ?? undefined, runId: run.id, spentUsd: run.total_usd });
    } else if (run.status === 'partial') {
      // A short post (fewer than 5 stories) still posts; it is worth a look.
      failures.push({ vertical: 'last_few_days', night, at, stage: 'run', reason: reasonFor('run', run.stop_reason), severity: 'warning', rawError: run.stop_reason ?? undefined, runId: run.id, spentUsd: run.total_usd });
    }
  }
  const made = runs.filter((r) => r.status === 'ok' || r.status === 'partial').length;
  const base = {
    ...emptyReport('last_few_days', night),
    ran: runs.some((r) => ['ok', 'partial', 'failed', 'skipped'].includes(r.status)),
    made,
    funnel: funnelFrom(runs.length, [['run', runs.filter((r) => r.status === 'failed').length]]),
    failures,
    spendUsd: runs.reduce((n, r) => n + r.total_usd, 0),
    nearCap: runs.some((r) => r.cap_usd > 0 && r.total_usd >= 0.9 * r.cap_usd),
  };
  return withPublishing(base, posting, await publishingFor(q, 'last_few_days', night));
};
```

`lib/social-hub/health/night.ts` — add after `import { reportCarousels } from '@/lib/social-hub/health/reporters/carousels';`:

```ts
import { reportLastFewDays } from '@/lib/social-hub/health/reporters/last-few-days';
```

and before:

```ts
  stories: async (h) => ({ q: h.q, run: reportStories }),
```

after:

```ts
  stories: async (h) => ({ q: h.q, run: reportStories }),
  last_few_days: async (h) => ({ q: h.q, run: reportLastFewDays }),
```

`lib/social-hub/health/brief.ts` — before:

```ts
  stories: ['lib/stories/build/'],
};
```

after:

```ts
  stories: ['lib/stories/build/'],
  last_few_days: ['lib/lfd/run.ts', 'lib/lfd/'],
};
```

`lib/social-hub/cost-page/model.ts` — before:

```ts
const TYPE_COLOR: Record<Vertical, string> = { reels: '#14b8c4', explainers: '#4169e1', carousels: '#138510', stories: '#c377e0' };
```

after:

```ts
const TYPE_COLOR: Record<Vertical, string> = { reels: '#14b8c4', explainers: '#4169e1', carousels: '#138510', stories: '#c377e0', last_few_days: '#e0529c' };
```

and before:

```ts
  stories: ['replies', 'shares', 'follows', 'profileVisits'],
};
```

(the `INTERACTIONS` map) after:

```ts
  stories: ['replies', 'shares', 'follows', 'profileVisits'],
  last_few_days: ['totalInteractions'],
};
```

`lib/social-hub/cost-page/load.ts` — add after `import { DEFAULT_RUN_CAP_USD } from '@/lib/social/overnight/config';`:

```ts
import { DEFAULT_LFD_RUN_CAP_USD } from '@/lib/lfd/config';
```

Before:

```ts
  const [stories, explainersCap, runCap] = await Promise.all([
    settingNumber(liveHubQuery, `SELECT value FROM stories.settings WHERE key = 'monthly_watch_usd'`),
    settingNumber(eq, `SELECT value FROM explainers.settings WHERE key = 'daily_spend_cap_usd'`),
    settingNumber(liveHubQuery, `SELECT value FROM social.settings WHERE key = 'run_cap_usd'`),
  ]);
  return {
```

after:

```ts
  const [stories, explainersCap, runCap, lfdCap] = await Promise.all([
    settingNumber(liveHubQuery, `SELECT value FROM stories.settings WHERE key = 'monthly_watch_usd'`),
    settingNumber(eq, `SELECT value FROM explainers.settings WHERE key = 'daily_spend_cap_usd'`),
    settingNumber(liveHubQuery, `SELECT value FROM social.settings WHERE key = 'run_cap_usd'`),
    settingNumber(liveHubQuery, `SELECT value FROM lfd.settings WHERE key = 'run_cap_usd'`),
  ]);
  return {
    // Two posts a week: its cap for each one this month can hold.
    last_few_days: (lfdCap ?? DEFAULT_LFD_RUN_CAP_USD) * Math.ceil((days * 2) / 7),
```

- [ ] **Step 8: Update the tests and fixtures that pin four types**

`tests/social-hub-actions.test.ts` — (a) in the `liveActions` stub, before:

```ts
      plan: pick(o.plan, 'plan'), rescheduleSet: pick(o.rescheduleSet, 'rescheduleSet'), unscheduleSet: pick(o.unscheduleSet, 'unscheduleSet'),
    }),
  });
}
```

after:

```ts
      plan: pick(o.plan, 'plan'), rescheduleSet: pick(o.rescheduleSet, 'rescheduleSet'), unscheduleSet: pick(o.unscheduleSet, 'unscheduleSet'),
    }),
    last_few_days: { vertical: 'last_few_days' },
  });
}
```

(b) before:

```ts
  assert.deepEqual(rows.map((r) => r.vertical), ['reels', 'explainers', 'carousels', 'stories']);
  assert.ok(rows.every((r) => r.posts > 0 && r.costPerPost != null && r.value != null));
```

after:

```ts
  assert.deepEqual(rows.map((r) => r.vertical), ['reels', 'explainers', 'carousels', 'stories', 'last_few_days']);
  // The preview fixture has no Last Few Days posts.
  assert.ok(rows.filter((r) => r.vertical !== 'last_few_days').every((r) => r.posts > 0 && r.costPerPost != null && r.value != null));
```

`tests/social-hub-viewmodels.test.ts` — before:

```ts
  const quotas = { reels: 1, carousels: 0, explainers: 1 };
  // Friday: Morning Download is the only Story series due, so 1 + 0 + 1 + 1.
```

after:

```ts
  const quotas = { reels: 1, carousels: 0, explainers: 1, last_few_days: 0 };
  // Friday: Morning Download is the only Story series due, so 1 + 0 + 1 + 1 (+ 0 Last Few Days).
```

before:

```ts
  // No quotas loaded: each type's windows. Thursday has both Story series; Friday only Morning Download.
  assert.equal(slotsForDay([], '2026-10-08', null).slots, 9);
  assert.equal(slotsForDay([], '2026-10-09', null).slots, 8);
```

after:

```ts
  // No quotas loaded: each type's windows. Thursday has both Story series; Friday only Morning Download, plus Last Few Days.
  assert.equal(slotsForDay([], '2026-10-08', null).slots, 9);
  assert.equal(slotsForDay([], '2026-10-09', null).slots, 9);
```

before:

```ts
  assert.deepEqual(pools.map((p) => p.vertical), ['reels', 'explainers', 'carousels', 'stories']);
```

after:

```ts
  assert.deepEqual(pools.map((p) => p.vertical), ['reels', 'explainers', 'carousels', 'stories', 'last_few_days']);
```

`tests/social-health-view.test.ts` — before:

```ts
  assert.deepEqual(m.rows.map((r) => r.label), ['Text on Screen', 'Explainer Reels', 'Carousels', 'IG Stories', 'Publisher']);
```

after:

```ts
  assert.deepEqual(m.rows.map((r) => r.label), ['Text on Screen', 'Explainer Reels', 'Carousels', 'IG Stories', 'Last Few Days', 'Publisher']);
```

before:

```ts
  assert.equal(m.rows[4]!.blocks.at(-1)!.card.title, 'Publisher · Thu Oct 8');
```

after:

```ts
  assert.equal(m.rows.at(-1)!.blocks.at(-1)!.card.title, 'Publisher · Thu Oct 8');
```

`tests/social-health-report-job.test.ts` — before: `  assert.equal(night.reports.length, 4);` after:
`  assert.equal(night.reports.length, 5);`

`tests/social-cost-model.test.ts` — before:

```ts
  assert.equal(m.series.type.keys.map((k) => k.label).join(','), 'Text on Screen,Explainer Reels,Carousels,IG Stories');
  assert.equal(m.budget.length, 4);
```

after:

```ts
  assert.equal(m.series.type.keys.map((k) => k.label).join(','), 'Text on Screen,Explainer Reels,Carousels,IG Stories,Last Few Days');
  assert.equal(m.budget.length, 5);
```

`tests/fixtures/social-hub/cost-fixture.ts` — before:

```ts
const DAILY: Record<Vertical, number> = { reels: 4.6, explainers: 3.5, carousels: 1.9, stories: 0.7 };
```

after:

```ts
/** The fixture's four original types (its numbers are pinned by the cost tests); Last Few Days has no spend here. */
const DAILY: Record<Exclude<Vertical, 'last_few_days'>, number> = { reels: 4.6, explainers: 3.5, carousels: 1.9, stories: 0.7 };
```

before: `    for (const v of Object.keys(DAILY) as Vertical[]) {` after:
`    for (const v of Object.keys(DAILY) as Array<keyof typeof DAILY>) {`

before: `    watchUsd: { reels: 100, explainers: 310, carousels: 62, stories: 25 },` after:
`    watchUsd: { reels: 100, explainers: 310, carousels: 62, stories: 25, last_few_days: 9 },`

`tests/fixtures/social-hub/health-fixture.ts` — before:

```ts
const QUOTA: Record<Vertical, number> = { reels: 3, explainers: 2, carousels: 1, stories: 1 };

function report(v: Vertical, night: string): NightReport {
```

after:

```ts
/** The fixture's four original types; Last Few Days has no stored nights here (its row reads as "didn't run"). */
const QUOTA: Record<Exclude<Vertical, 'last_few_days'>, number> = { reels: 3, explainers: 2, carousels: 1, stories: 1 };

function report(v: keyof typeof QUOTA, night: string): NightReport {
```

before: `    const reports = (['reels', 'explainers', 'carousels', 'stories'] as Vertical[]).map((v) => report(v, night));` after:
`    const reports = (['reels', 'explainers', 'carousels', 'stories'] as Array<keyof typeof QUOTA>).map((v) => report(v, night));`

(If either fixture no longer imports `Vertical` after the edit, keep the import: both edits still name it.)

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `npx tsx --test tests/lfd-hub.test.ts tests/social-hub-*.test.ts tests/social-health-*.test.ts tests/social-cost-model.test.ts tests/content-type.test.ts tests/stories-pool.test.ts tests/social-spine-backfill.test.ts tests/idea-score-breakdown.test.ts`
Expected: PASS (including `tests/social-hub-scope.test.ts`: the new hub files only SELECT and import `lib/lfd/config`,
`lib/lfd/settings` and types). Then `npm test`: PASS. Typecheck line prints nothing.

If a test outside this list fails only because it pins the four-type list or a fourth row, update that expectation the same
way (append `'last_few_days'` / `'Last Few Days'` at the end); any other failure is a real regression to fix before committing.

- [ ] **Step 10: Commit**

```bash
git add lib/social-hub/types.ts lib/social-hub/verticals.ts app/social-hub.css lib/social-hub/ids.ts lib/social-hub/lifecycle.ts \
  lib/social-hub/queries/spine.ts lib/social-hub/queries/last-few-days.ts lib/social-hub/adapters/last-few-days.ts \
  lib/social-hub/dataset.ts lib/social-hub/load.ts lib/social-hub/factors.ts lib/social-hub/cost.ts lib/social-hub/house.ts \
  lib/social-hub/views/plan.ts lib/social-hub/views/day-rank.ts lib/social-hub/views/today.ts lib/social-hub/queries/day.ts \
  lib/social-hub/views/run-for.ts lib/social-hub/views/pools.ts lib/social-hub/health/brief.ts lib/social-hub/health/night.ts \
  lib/social-hub/health/reporters/shared.ts lib/social-hub/health/reporters/last-few-days.ts \
  lib/social-hub/cost-page/model.ts lib/social-hub/cost-page/load.ts lib/content-type/posting.ts lib/publishing/actions/live.ts \
  components/social-hub/ui/marks.tsx components/social-hub/content/PoolScreen.tsx components/social-hub/content/ContentScreen.tsx \
  components/content-type/ContentTypePage.tsx "app/api/last-few-days/slides/[postId]/[n]/route.ts" \
  tests/lfd-hub.test.ts tests/social-hub-actions.test.ts tests/social-hub-viewmodels.test.ts tests/social-health-view.test.ts \
  tests/social-health-report-job.test.ts tests/social-cost-model.test.ts tests/fixtures/social-hub/cost-fixture.ts \
  tests/fixtures/social-hub/health-fixture.ts
git commit -m "feat(lfd): last_few_days joins the hub: vertical, read path, adapter, quota card, health reporter, posting switches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Hub actions for Last Few Days

**Files:**
- Create: `lib/publishing/actions/last-few-days.ts`
- Modify: `lib/publishing/actions/live.ts`, `app/api/social-hub/actions/content-action.ts`,
  `app/api/social-hub/actions/approve-content/handler.ts`, `app/api/social-hub/actions/hard-publish/handler.ts`,
  `lib/social-hub/house.ts`, `lib/social-hub/views/actions.ts`
- Test: `tests/lfd-actions.test.ts` (create)

**Interfaces:**
- Consumes: `approveLfdPost`, `rejectLfdPost`, `hardPublishLfdPost`, `unscheduleLfdPost` (Task 5), `lfdItemId`, `placeItem`,
  `rescheduleItem`, `deleteVerb`, `need`, `needPlacement`.
- Produces: `lastFewDaysActions(deps): ContentActions` with `approve`, `reject`, `publishNow`, `unschedule`, `delete`, `place`,
  `reschedule` (no `regenerate`); hub plans for LFD posts: Approve (`approve-content`), Reject, Schedule / Move / Unschedule,
  Publish now, all naming `{ lfdPostId }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lfd-actions.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { approveContent } from '@/app/api/social-hub/actions/approve-content/handler';
import { hardPublish } from '@/app/api/social-hub/actions/hard-publish/handler';
import { rejectContent } from '@/app/api/social-hub/actions/reject/handler';
import { lfdItemId } from '@/lib/lfd/items';
import { approveLfdPost, hardPublishLfdPost, rejectLfdPost, scheduleLfdPost, unscheduleLfdPost } from '@/lib/lfd/schedule';
import { lastFewDaysActions } from '@/lib/publishing/actions/last-few-days';
import type { ContentActions } from '@/lib/publishing/actions/types';
import { buildDataset } from '@/lib/social-hub/dataset';
import { actionsFor, type ActionPlan } from '@/lib/social-hub/house';
import { readAll } from '@/lib/social-hub/load';
import { placeItem, rescheduleItem } from '@/lib/social-hub/placement';
import type { Query } from '@/lib/social/store/pg';

import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

type PostPlan = Extract<ActionPlan, { kind: 'post' }>;

/** Tuesday 2026-10-13, 3:30 AM New York. */
const TUE_330 = new Date('2026-10-13T07:30:00Z');
/** Wednesday 2026-10-14, 8:00 AM New York. */
const WED_8 = new Date('2026-10-14T12:00:00Z');
const never = (async () => { throw new Error('must not be called'); }) as never;

async function lfdPost(query: Parameters<typeof readAll>[0]) {
  return buildDataset(await readAll(query), null, TUE_330).posts.find((p) => p.vertical === 'last_few_days')!;
}

test('a post in review offers Approve, Reject, Schedule and Publish now, each naming the post', async () => {
  const { query } = await openHubTestDb();
  const id = await seedLfdPost(query);
  const plans = actionsFor(await lfdPost(query), { quota: null, typicalCostLabel: null }).filter((p): p is PostPlan => p.kind === 'post');
  const plan = (action: PostPlan['action']) => plans.find((p) => p.action === action);
  assert.deepEqual(plan('approveContent')?.body, { vertical: 'last_few_days', refs: { lfdPostId: id } });
  assert.deepEqual(plan('reject')?.body, { vertical: 'last_few_days', refs: { lfdPostId: id } });
  assert.deepEqual(plan('place')?.body, { vertical: 'last_few_days', refs: { lfdPostId: id } });
  assert.deepEqual(plan('hardPublish')?.body, { vertical: 'last_few_days', ref: id });
  assert.equal(plan('hardRegenerate'), undefined, 'a post is not rebuilt from the hub');
  assert.deepEqual(approveContent(never).parse(plan('approveContent')!.body), { vertical: 'last_few_days', target: { lfdPostId: id } });
  assert.deepEqual(rejectContent(never).parse(plan('reject')!.body), { vertical: 'last_few_days', target: { lfdPostId: id } });
  assert.deepEqual(hardPublish(never).parse(plan('hardPublish')!.body), { vertical: 'last_few_days', target: { lfdPostId: id } });
});

test('a booked, unapproved post offers Approve where it is, Move and Unschedule', async () => {
  const { query } = await openHubTestDb();
  const id = await seedLfdPost(query);
  await scheduleLfdPost(query as unknown as Query, id, 'auto', TUE_330, '2026-10-13', () => 0);
  const post = await lfdPost(query);
  assert.equal(post.status, 'scheduled');
  const actions = actionsFor(post, { quota: null, typicalCostLabel: null }).filter((p): p is PostPlan => p.kind === 'post').map((p) => p.action);
  for (const a of ['approveContent', 'reschedule', 'unschedule', 'reject', 'hardPublish'] as const) assert.ok(actions.includes(a), a);
  assert.equal(actions.includes('place'), false);
});

function actionsOn(q: Query, now: Date): ContentActions {
  return lastFewDaysActions({
    query: async () => q,
    approvePost: (qq, id) => approveLfdPost(qq, id, now),
    rejectPost: rejectLfdPost,
    hardPublishPost: hardPublishLfdPost,
    unschedulePost: unscheduleLfdPost,
    itemId: lfdItemId,
    placeItem: (qq, input) => placeItem(qq, { ...input, now, rng: () => 0 }),
    rescheduleItem: (qq, input) => rescheduleItem(qq, { ...input, now, rng: () => 0 }),
  });
}

test('the verbs on the real spine: approve, move, unschedule, place, reject, delete, publish now', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const a = actionsOn(q, WED_8);
  const one = await seedLfdPost(query, { slug: 'lfd-1', nyDate: '2026-10-14' });
  const approved = await a.approve!({ lfdPostId: one }, 'tommy');
  assert.equal(approved.ok, true);
  assert.match(approved.note, /^Approved and scheduled for 2026-10-16T1[34]:/);
  const moved = await a.reschedule!({ lfdPostId: one }, 'tommy', { nyDate: '2026-10-20', slot: 'morning' });
  assert.equal(moved.ok, true, moved.note);
  assert.equal((await q(`SELECT ny_date::text AS d FROM social_hub.schedule WHERE status = 'scheduled'`)).rows[0].d, '2026-10-20');
  assert.equal((await a.unschedule!({ lfdPostId: one }, 'tommy')).ok, true);
  const wed = await a.place!({ lfdPostId: one }, 'tommy', { nyDate: '2026-10-14', slot: 'morning' });
  assert.equal(wed.ok, false);
  assert.match(wed.note, /doesn’t post on Wednesdays/);
  assert.equal((await a.place!({ lfdPostId: one }, 'tommy', { nyDate: '2026-10-16', slot: 'morning' })).ok, true);

  const two = await seedLfdPost(query, { slug: 'lfd-2' });
  assert.deepEqual(await a.reject!({ lfdPostId: two }, 'tommy'), { ok: true, note: 'Rejected. It will not post.' });
  assert.equal((await q(`SELECT status FROM lfd.posts WHERE id = $1`, [two])).rows[0].status, 'rejected');

  const three = await seedLfdPost(query, { slug: 'lfd-3' });
  assert.equal((await a.delete!({ lfdPostId: three }, 'tommy')).ok, true);
  assert.ok((await q(`SELECT deleted_at FROM social_hub.content_items WHERE native_ref = $1`, [three])).rows[0].deleted_at);

  const four = await seedLfdPost(query, { slug: 'lfd-4' });
  assert.deepEqual(await a.publishNow!({ lfdPostId: four }, 'tommy'), { ok: true, note: 'Queued to publish now.' });
  assert.equal(a.regenerate, undefined);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx --test tests/lfd-actions.test.ts`
Expected: FAIL with `Cannot find module '@/lib/publishing/actions/last-few-days'`.

- [ ] **Step 3: Write the code**

```ts
// lib/publishing/actions/last-few-days.ts
import type { Placement, PlacementOutcome, PlacementTarget } from '@/lib/social-hub/placement';
import type { Query } from '@/lib/social/store/pg';

import { deleteVerb } from './delete';
import { need, needPlacement, type ActionInput, type ActionOutcome, type ActionTarget, type ContentActions } from './types';

type Placed = { scheduled: true; id: string; publishAt: string } | { scheduled: false; note: string };
type Queued = { queued: boolean; note?: string };
type Place = (q: Query, input: PlacementTarget & Placement) => Promise<PlacementOutcome>;

/**
 * Last Few Days (lib/lfd/schedule.ts): approve (approved and booked in its
 * day's window or the next one), reject, Publish now, unschedule, delete, and
 * place or move on the calendar (D50). No regenerate: a post is a whole run's
 * work; the type page's "Make Last Few Days now" makes a new one.
 */
export function lastFewDaysActions(deps: {
  query: () => Promise<Query>;
  approvePost: (q: Query, postId: string) => Promise<Placed>;
  rejectPost: (q: Query, postId: string, by: string | null) => Promise<boolean>;
  hardPublishPost: (q: Query, postId: string) => Promise<Queued>;
  unschedulePost: (q: Query, postId: string) => Promise<{ ok: boolean; note: string }>;
  itemId: (q: Query, postId: string) => Promise<string | null>;
  placeItem: Place;
  rescheduleItem: Place;
}): ContentActions {
  async function placement(t: ActionTarget, input: ActionInput | undefined, fn: Place): Promise<ActionOutcome> {
    const at = needPlacement(input);
    const q = await deps.query();
    const itemId = await deps.itemId(q, need(t, 'lfdPostId'));
    if (!itemId) return { ok: false, note: 'The post is gone.' };
    return fn(q, { vertical: 'last_few_days', itemId, ...at });
  }
  return {
    vertical: 'last_few_days',
    async approve(t) {
      const placed = await deps.approvePost(await deps.query(), need(t, 'lfdPostId'));
      return placed.scheduled ? { ok: true, note: `Approved and scheduled for ${placed.publishAt}.` } : { ok: false, note: placed.note };
    },
    async reject(t, by) {
      return (await deps.rejectPost(await deps.query(), need(t, 'lfdPostId'), by)) ? { ok: true, note: 'Rejected. It will not post.' } : { ok: false, note: 'The post is gone.' };
    },
    async publishNow(t) {
      const out = await deps.hardPublishPost(await deps.query(), need(t, 'lfdPostId'));
      return out.queued ? { ok: true, note: 'Queued to publish now.' } : { ok: false, note: out.note ?? 'Not queued.' };
    },
    async unschedule(t) {
      const out = await deps.unschedulePost(await deps.query(), need(t, 'lfdPostId'));
      return out.ok ? { ok: true, note: out.note } : { ok: false, note: out.note, status: 409 };
    },
    delete: deleteVerb({ refKey: 'lfdPostId', query: deps.query as never, itemOf: (q, postId) => deps.itemId(q as Query, postId) }),
    place: (t, _by, input) => placement(t, input, deps.placeItem),
    reschedule: (t, _by, input) => placement(t, input, deps.rescheduleItem),
  };
}
```

`lib/publishing/actions/live.ts` — add after `import { storyActions } from './stories';`:

```ts
import { lastFewDaysActions } from './last-few-days';
```

Before:

```ts
    placement,
    explainersSchedule,
  ] = await Promise.all([
```

after:

```ts
    placement,
    explainersSchedule,
    lfdSchedule,
    lfdItems,
  ] = await Promise.all([
```

Before:

```ts
    import('@/lib/social-hub/placement'),
    import('@/lib/explainers/publish/schedule'),
  ]);
```

after:

```ts
    import('@/lib/social-hub/placement'),
    import('@/lib/explainers/publish/schedule'),
    import('@/lib/lfd/schedule'),
    import('@/lib/lfd/items'),
  ]);
```

Before (the entry Task 9 added):

```ts
    // Its verbs land with the hub actions (lib/publishing/actions/last-few-days.ts); none is offered until then.
    last_few_days: { vertical: 'last_few_days' },
```

after:

```ts
    last_few_days: lastFewDaysActions({
      query: socialQuery,
      approvePost: (q, postId) => lfdSchedule.approveLfdPost(q, postId),
      rejectPost: lfdSchedule.rejectLfdPost,
      hardPublishPost: lfdSchedule.hardPublishLfdPost,
      unschedulePost: lfdSchedule.unscheduleLfdPost,
      itemId: lfdItems.lfdItemId,
      placeItem: placement.placeItem,
      rescheduleItem: placement.rescheduleItem,
    }),
```

`app/api/social-hub/actions/content-action.ts` — before:

```ts
const VERTICALS: readonly Vertical[] = ['carousels', 'explainers', 'reels', 'stories'];
```

after:

```ts
const VERTICALS: readonly Vertical[] = ['carousels', 'explainers', 'reels', 'stories', 'last_few_days'];
```

`app/api/social-hub/actions/approve-content/handler.ts` — before:

```ts
 * Approve an Explainer reel or a Story set from its type page (D47 user-action
 * layer: `explainerActions.approve` sets the review verdict, `storyActions.approve`
 * approves the set). Body: `{ vertical, refs: { jobId } | { setId } }`.
 */
export function approveContent(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({ flag: 'approveContent', verb: 'approve', actions, allowed: ['explainers', 'stories'] });
}
```

after:

```ts
 * Approve an Explainer reel, a Story set or a Last Few Days post from its type
 * page (D47 user-action layer: `explainerActions.approve` sets the review
 * verdict, `storyActions.approve` approves the set, `lastFewDaysActions.approve`
 * approves the post and books its window). Body:
 * `{ vertical, refs: { jobId } | { setId } | { lfdPostId } }`.
 */
export function approveContent(actions: () => Promise<Record<Vertical, ContentActions>>) {
  return contentAction({ flag: 'approveContent', verb: 'approve', actions, allowed: ['explainers', 'stories', 'last_few_days'] });
}
```

`app/api/social-hub/actions/hard-publish/handler.ts` — before:

```ts
    legacy: refBody({ reels: 'videoJobId', carousels: 'postId', explainers: 'jobId', stories: 'setId' }),
```

after:

```ts
    legacy: refBody({ reels: 'videoJobId', carousels: 'postId', explainers: 'jobId', stories: 'setId', last_few_days: 'lfdPostId' }),
```

`lib/social-hub/house.ts` (in `actionsFor`) — (a) before:

```ts
  if (post.status === 'scheduled' && post.approval.required && !post.approval.approvedAt) {
    if (post.vertical === 'carousels' && post.refs.scheduleId) {
```

after:

```ts
  if (post.vertical === 'last_few_days' && !post.approval.approvedAt && (post.status === 'ready' || (post.status === 'scheduled' && post.approval.required))) {
    // A post in review is approved and booked in its day's window (or the next one); a waiting slot is approved where it is.
    plans.push({
      kind: 'post', action: 'approveContent', label: 'Approve', endpoint: '/api/social-hub/actions/approve-content',
      body: { vertical: 'last_few_days', refs: { lfdPostId: post.refs.lfdPostId ?? null } },
      disabled: post.refs.lfdPostId ? null : 'This content can’t be found any more.',
    });
  }
  if (post.status === 'scheduled' && post.approval.required && !post.approval.approvedAt) {
    if (post.vertical === 'carousels' && post.refs.scheduleId) {
```

(b) before:

```ts
        : post.vertical === 'explainers'
          ? { jobId: post.refs.jobId }
          : { setId: post.refs.setId };
```

after:

```ts
        : post.vertical === 'explainers'
          ? { jobId: post.refs.jobId }
          : post.vertical === 'last_few_days'
            ? { lfdPostId: post.refs.lfdPostId }
            : { setId: post.refs.setId };
```

(c) before:

```ts
    const ref = post.vertical === 'reels' ? post.refs.videoJobId : post.vertical === 'carousels' ? post.refs.postId : post.vertical === 'explainers' ? post.refs.jobId : post.refs.setId;
```

after:

```ts
    const ref = post.vertical === 'reels' ? post.refs.videoJobId
      : post.vertical === 'carousels' ? post.refs.postId
        : post.vertical === 'explainers' ? post.refs.jobId
          : post.vertical === 'last_few_days' ? post.refs.lfdPostId
            : post.refs.setId;
```

`lib/social-hub/views/actions.ts` — before:

```ts
      return vertical === 'carousels' && state === 'ready' ? 'Approve and schedule' : 'Approve';
```

after:

```ts
      return (vertical === 'carousels' || vertical === 'last_few_days') && state === 'ready' ? 'Approve and schedule' : 'Approve';
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx tsx --test tests/lfd-actions.test.ts tests/social-hub-actions.test.ts tests/social-hub-card-actions.test.ts tests/social-hub-viewmodels.test.ts tests/social-hub-pipeline-actions.test.ts tests/social-hub-delete.test.ts tests/social-hub-scope.test.ts`
Expected: PASS (the scope test's handler purity check still holds: the two handler edits are a list and a map). Typecheck line
prints nothing.

- [ ] **Step 5: Commit**

```bash
git add lib/publishing/actions/last-few-days.ts lib/publishing/actions/live.ts app/api/social-hub/actions/content-action.ts \
  app/api/social-hub/actions/approve-content/handler.ts app/api/social-hub/actions/hard-publish/handler.ts \
  lib/social-hub/house.ts lib/social-hub/views/actions.ts tests/lfd-actions.test.ts
git commit -m "feat(lfd): hub actions: approve, reject, publish now, place, move, unschedule, delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Carousel windows close on LFD days in every hub view

**Files:**
- Modify: `lib/social-hub/views/day-rank.ts`, `lib/social-hub/queries/day.ts`, `lib/social-hub/views/plan.ts`,
  `lib/social-hub/views/today.ts`, `lib/social-hub/views/calendar.ts`, `components/social-hub/calendar/CalendarScreen.tsx`,
  `lib/social-hub/views/offer.ts`, `lib/content-type/model.ts`, `lib/content-type/run-today-live.ts`
- Test: `tests/lfd-plan.test.ts` (create)

**Interfaces:**
- Consumes: `carouselOffDays` (Task 2).
- Produces: `DayQuotas.lfdDays?: readonly number[]` (filled by `readDayQuotas`); `windowsOn(vertical, nyDate, carouselOff = [])`,
  `dayPlan(posts, nyDate, carouselOff = [])`, `publishingCandidates(posts, today, carouselOff = [])`,
  `monthModel(…, actionable, carouselOff = [])`, `daySlots(…, now, carouselOff = [])`, `windowsFor(vertical, day, carouselOff = [])`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lfd-plan.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { readDayQuotas } from '@/lib/social-hub/queries/day';
import type { Vertical } from '@/lib/social-hub/types';
import { daySlots } from '@/lib/social-hub/views/calendar';
import { quotaCandidates } from '@/lib/social-hub/views/day-rank';
import { windowsOn } from '@/lib/social-hub/views/plan';
import { slotsForDay } from '@/lib/social-hub/views/today';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const TUE_8 = new Date('2026-10-13T12:00:00Z');

test('carousel windows close on Last Few Days days only when asked', () => {
  assert.equal(windowsOn('carousels', '2026-10-13').length, 2);
  assert.equal(windowsOn('carousels', '2026-10-13', [2, 5]).length, 0);
  assert.equal(windowsOn('carousels', '2026-10-14', [2, 5]).length, 2);
  assert.equal(windowsOn('last_few_days', '2026-10-13').length, 1);
  assert.equal(windowsOn('last_few_days', '2026-10-14').length, 0);
});

test('a Tuesday’s slots: one Last Few Days post instead of two carousels while it is on', () => {
  const quotas = { reels: 0, carousels: 2, explainers: 0, last_few_days: 1, lfdDays: [2, 5] };
  // Tuesday: Morning Download (1) + Free vs. Paid (1) + Last Few Days (1); no carousels.
  assert.deepEqual(slotsForDay([], '2026-10-13', quotas), { slots: 3, filled: 0 });
  assert.deepEqual(slotsForDay([], '2026-10-13', { ...quotas, lfdDays: [] }), { slots: 5, filled: 0 });
  assert.deepEqual(quotaCandidates({ posts: [], ideas: [], dayQuotas: quotas }, 'carousels', TUE_8), []);
  assert.equal(quotaCandidates({ posts: [], ideas: [], dayQuotas: { ...quotas, lfdDays: [] } }, 'carousels', TUE_8).length, 2);
});

test('the calendar’s open slots on a Tuesday follow the same rule', () => {
  const types = new Set<Vertical>(['carousels', 'last_few_days']);
  const open = (off: number[]) => daySlots([], '2026-10-13', types, new Date('2026-10-13T11:00:00Z'), off)
    .map((s) => (s.kind === 'open' ? `${s.vertical}:${s.window.id}` : 'post'))
    .sort();
  assert.deepEqual(open([2, 5]), ['last_few_days:morning']);
  assert.deepEqual(open([]), ['carousels:afternoon', 'carousels:morning', 'last_few_days:morning']);
});

test('readDayQuotas carries the carousel days off from lfd.settings', async () => {
  const { query } = await openHubTestDb();
  assert.deepEqual((await readDayQuotas(query, Promise.resolve(query))).lfdDays, []);
  await query(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'auto_run'`);
  const q = await readDayQuotas(query, Promise.resolve(query));
  assert.deepEqual([q.lfdDays, q.last_few_days], [[2, 5], 1]);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx --test tests/lfd-plan.test.ts`
Expected: FAIL: `windowsOn('carousels', '2026-10-13', [2, 5]).length` is 2, and `lfdDays` is `undefined`.

- [ ] **Step 3: Write the code**

`lib/social-hub/views/day-rank.ts` — before:

```ts
  /** One post on each of its days (spec §7.4); missing reads as one. */
  last_few_days?: number;
};
```

after:

```ts
  /** One post on each of its days (spec §7.4); missing reads as one. */
  last_few_days?: number;
  /** The weekdays Carousels give up to Last Few Days while its auto_run is on (LFD-02); none when missing. */
  lfdDays?: readonly number[];
};
```

and before (in `quotaCandidates`):

```ts
  const windows = windowsOn(vertical, today);
```

after:

```ts
  const windows = windowsOn(vertical, today, data.dayQuotas?.lfdDays ?? []);
```

`lib/social-hub/queries/day.ts` — add after `import type { DayQuotas, IdeaAdjustment } from '@/lib/social-hub/views/day-rank';`:

```ts
import { carouselOffDays } from '@/lib/lfd/settings';
```

Before:

```ts
export const DEFAULT_DAY_QUOTAS: DayQuotas = { reels: 3, carousels: 2, explainers: 2, last_few_days: 1 };
```

after:

```ts
export const DEFAULT_DAY_QUOTAS: DayQuotas = { reels: 3, carousels: 2, explainers: 2, last_few_days: 1, lfdDays: [] };
```

Before:

```ts
  const [reels, carousels, explainers] = await Promise.all([
    safe(q<{ value: unknown }>(sql('reels'))),
    safe(q<{ value: unknown }>(sql('social'))),
    safe(explainersQ.then((eq) => eq<{ value: unknown }>(sql('explainers')))),
  ]);
```

after:

```ts
  const [reels, carousels, explainers, lfdDays] = await Promise.all([
    safe(q<{ value: unknown }>(sql('reels'))),
    safe(q<{ value: unknown }>(sql('social'))),
    safe(explainersQ.then((eq) => eq<{ value: unknown }>(sql('explainers')))),
    // Never throws: an unreadable lfd schema means Carousels keep every day.
    carouselOffDays(q),
  ]);
```

and before:

```ts
    last_few_days: DEFAULT_DAY_QUOTAS.last_few_days,
  };
```

after:

```ts
    last_few_days: DEFAULT_DAY_QUOTAS.last_few_days,
    lfdDays,
  };
```

`lib/social-hub/views/plan.ts` — before:

```ts
export function windowsOn(vertical: Vertical, nyDate: string): PlanWindow[] {
  const day = weekdayOf(nyDate);
  return PLAN[vertical].filter((w) => !w.days || w.days.includes(day));
}
```

after:

```ts
/**
 * A type's windows on a day. `carouselOff`: the weekdays Carousels give up to
 * Last Few Days while its auto_run is on (LFD-02; DayQuotas.lfdDays).
 */
export function windowsOn(vertical: Vertical, nyDate: string, carouselOff: readonly number[] = []): PlanWindow[] {
  const day = weekdayOf(nyDate);
  if (vertical === 'carousels' && carouselOff.includes(day)) return [];
  return PLAN[vertical].filter((w) => !w.days || w.days.includes(day));
}
```

Before:

```ts
export function dayPlan(posts: readonly HubPost[], nyDate: string): DayPlan {
  const types = VERTICAL_IDS.map((vertical): TypePlan => {
    const windows = windowsOn(vertical, nyDate);
```

after:

```ts
export function dayPlan(posts: readonly HubPost[], nyDate: string, carouselOff: readonly number[] = []): DayPlan {
  const types = VERTICAL_IDS.map((vertical): TypePlan => {
    const windows = windowsOn(vertical, nyDate, carouselOff);
```

`lib/social-hub/views/today.ts` — before:

```ts
    const windows = windowsOn(vertical, nyDate).length;
```

after:

```ts
    const windows = windowsOn(vertical, nyDate, dayQuotas?.lfdDays ?? []).length;
```

Before:

```ts
export function publishingCandidates(posts: readonly HubPost[], today: string): HubPost[] {
```

after:

```ts
export function publishingCandidates(posts: readonly HubPost[], today: string, carouselOff: readonly number[] = []): HubPost[] {
```

Before:

```ts
    out.push(...list.sort(bySoonest).slice(0, windowsOn(vertical, today).length));
```

after:

```ts
    out.push(...list.sort(bySoonest).slice(0, windowsOn(vertical, today, carouselOff).length));
```

Before:

```ts
  const todays = publishingCandidates(dataset.posts, today);
```

after:

```ts
  const carouselOff = dataset.dayQuotas?.lfdDays ?? [];
  const todays = publishingCandidates(dataset.posts, today, carouselOff);
```

Before:

```ts
    plan: { ...dayPlan(dataset.posts, today), ...slotsForDay(dataset.posts, today, dataset.dayQuotas) },
```

after:

```ts
    plan: { ...dayPlan(dataset.posts, today, carouselOff), ...slotsForDay(dataset.posts, today, dataset.dayQuotas) },
```

`lib/social-hub/views/calendar.ts` — before:

```ts
export function monthModel(posts: readonly HubPost[], month: string, now: Date, metric: MetricKey, types: ReadonlySet<Vertical>, actionable: (post: HubPost) => boolean = () => true): MonthModel {
```

after:

```ts
export function monthModel(
  posts: readonly HubPost[],
  month: string,
  now: Date,
  metric: MetricKey,
  types: ReadonlySet<Vertical>,
  actionable: (post: HubPost) => boolean = () => true,
  carouselOff: readonly number[] = [],
): MonthModel {
```

Before:

```ts
      for (const t of dayPlan(shown, day).types) {
```

after:

```ts
      for (const t of dayPlan(shown, day, carouselOff).types) {
```

Before:

```ts
export function daySlots(posts: readonly HubPost[], day: string, types: ReadonlySet<Vertical>, now: Date): DaySlot[] {
```

after:

```ts
export function daySlots(posts: readonly HubPost[], day: string, types: ReadonlySet<Vertical>, now: Date, carouselOff: readonly number[] = []): DaySlot[] {
```

Before:

```ts
  const open: DaySlot[] = day < today ? [] : dayPlan(shown, day).types
```

after:

```ts
  const open: DaySlot[] = day < today ? [] : dayPlan(shown, day, carouselOff).types
```

Before:

```ts
export function windowsFor(vertical: Vertical, day: string): PlanWindow[] {
  return windowsOn(vertical, day);
}
```

after:

```ts
export function windowsFor(vertical: Vertical, day: string, carouselOff: readonly number[] = []): PlanWindow[] {
  return windowsOn(vertical, day, carouselOff);
}
```

`components/social-hub/calendar/CalendarScreen.tsx` — before:

```tsx
  const m = monthModel(dataset.posts, month, now, metric, types, (p) => o.offer(p).state.id === 'needs_you');
```

after:

```tsx
  const m = monthModel(dataset.posts, month, now, metric, types, (p) => o.offer(p).state.id === 'needs_you', dataset.dayQuotas?.lfdDays ?? []);
```

Before:

```tsx
          <DayList posts={dataset.posts} day={day} types={types} now={now} o={o} base={base} />
```

after:

```tsx
          <DayList posts={dataset.posts} day={day} types={types} now={now} o={o} base={base} carouselOff={dataset.dayQuotas?.lfdDays ?? []} />
```

Before:

```tsx
function DayList({ posts, day, types, now, o, base }: { posts: HubDataset['posts']; day: string; types: ReadonlySet<Vertical>; now: Date; o: ReturnType<typeof offerer>; base: string }) {
  const slots = daySlots(posts, day, types, now);
```

after:

```tsx
function DayList({ posts, day, types, now, o, base, carouselOff }: { posts: HubDataset['posts']; day: string; types: ReadonlySet<Vertical>; now: Date; o: ReturnType<typeof offerer>; base: string; carouselOff: readonly number[] }) {
  const slots = daySlots(posts, day, types, now, carouselOff);
```

`lib/social-hub/views/offer.ts` — before:

```ts
    windowsOn(post.vertical, day).forEach((w, index) => {
```

after:

```ts
    windowsOn(post.vertical, day, dataset.dayQuotas?.lfdDays ?? []).forEach((w, index) => {
```

`lib/content-type/model.ts` — before:

```ts
    const slots = windowsOn(vertical, date).length;
```

after:

```ts
    const slots = windowsOn(vertical, date, dataset.dayQuotas?.lfdDays ?? []).length;
```

`lib/content-type/run-today-live.ts` — before:

```ts
  const day = (v: 'reels' | 'carousels' | 'explainers') => typeDay(quotaCandidates(dataset, v, now), Math.min(quotas[v], windowsOn(v, today).length));
```

after:

```ts
  const day = (v: 'reels' | 'carousels' | 'explainers') => typeDay(quotaCandidates(dataset, v, now), Math.min(quotas[v], windowsOn(v, today, dataset.dayQuotas?.lfdDays ?? []).length));
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx tsx --test tests/lfd-plan.test.ts tests/social-hub-viewmodels.test.ts tests/social-hub-run-today.test.ts tests/content-type.test.ts tests/social-hub-actions.test.ts tests/social-hub-scope.test.ts`
Expected: PASS. Typecheck line prints nothing.

- [ ] **Step 5: Commit**

```bash
git add lib/social-hub/views/day-rank.ts lib/social-hub/queries/day.ts lib/social-hub/views/plan.ts lib/social-hub/views/today.ts \
  lib/social-hub/views/calendar.ts components/social-hub/calendar/CalendarScreen.tsx lib/social-hub/views/offer.ts \
  lib/content-type/model.ts lib/content-type/run-today-live.ts tests/lfd-plan.test.ts
git commit -m "feat(lfd): carousel windows close on Last Few Days days in the hub's plan, quota, calendar and offers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: The type page, "Make Last Few Days now", Run now, progress, and navigation

**Files:**
- Create: `app/last-few-days/page.tsx`, `app/api/last-few-days/run/route.ts`
- Modify: `components/content-type/ContentTypePage.tsx`, `components/content-type/TypeControls.tsx`,
  `components/content-type/run-progress.tsx`, `lib/content-type/progress.ts`, `lib/social-hub/views/run-for.ts`,
  `components/social-hub/content/RunsRefresh.tsx`, `components/social-hub/content/ContentScreen.tsx`,
  `components/social-hub/content/HubControls.tsx`, `lib/social-hub/run-today.ts`, `lib/content-type/run-today-live.ts`,
  `lib/social-hub/views/nav.ts`, `components/hub-shell/nav.ts`, `middleware.ts`
- Test: `tests/lfd-run-today.test.ts` (create)

**Interfaces:**
- Consumes: `requestRun` (`lib/lfd/store.ts`), `readLfdSettings`, `DEFAULT_LFD_RUN_CAP_USD`, `runType`, `liveHubQuery`.
- Produces:
  - `/last-few-days` (session required) with "Make Last Few Days now", Settings (Generate on its days, Auto-publish), Live;
  - `POST /api/last-few-days/run` → `runType(email, 'last_few_days')` → one `requested` `lfd.runs` row (manual), any day;
  - `RunInputs.lastFewDays?: { due; made }`, `inFlight.lfdRun?`, `cost.lfdCap?`; `PlanStep.action` gains `'lfd_run'`;
    `parseRunBody` accepts `last_few_days`; `livePlan(now, { lfdAnyDay })`;
  - `AllProgress.last_few_days?` (optional, read as none when missing); `readProgress('last_few_days')`; LFD run chips on its
    card; `canMakeCard` true for its card;
  - crumbs and `safeFrom` know `/last-few-days`; the sidebar highlights Social Hub there; the middleware protects it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lfd-run-today.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import type { AllProgress } from '@/lib/content-type/progress';
import { parseRunBody, planFrom, stepsFor, type RunInputs } from '@/lib/social-hub/run-today';
import type { QuotaCandidate } from '@/lib/social-hub/views/day-rank';
import { crumbsFor, safeFrom } from '@/lib/social-hub/views/nav';
import { canMakeCard, inFlightKey, runForCandidate, runningSummary } from '@/lib/social-hub/views/run-for';

const base: RunInputs = {
  today: '2026-10-13',
  reels: { quota: 0, held: 0, missing: [], slateToday: true },
  carousels: { quota: 0, held: 0, missing: [] },
  explainers: { quota: 0, held: 0, missing: [] },
  series: [],
  inFlight: { reelsRun: false, reelsBuilding: [], carouselRun: false, explainerTopics: [] },
  cost: { reelsNight: 2.5, reelBuild: 1, carouselCap: 2, explainerCap: 5, storySet: 0.45 },
};
const due: RunInputs = { ...base, lastFewDays: { due: true, made: false }, cost: { ...base.cost, lfdCap: 1 } };
const lfdStep = (i: RunInputs) => planFrom(i).steps.find((s) => s.vertical === 'last_few_days');

test('Run now makes today’s Last Few Days post on its days, once', () => {
  const s = lfdStep(due)!;
  assert.deepEqual([s.action, s.quota, s.held, s.needed, s.estimateUsd, s.targets], ['lfd_run', 1, 0, 1, 1, []]);
  assert.equal(planFrom(due).anything, true);
  assert.equal(lfdStep({ ...base, lastFewDays: { due: false, made: false } })!.action, 'none');
  assert.match(lfdStep({ ...base, lastFewDays: { due: false, made: false } })!.note, /on its days/);
  assert.match(lfdStep({ ...due, lastFewDays: { due: true, made: true } })!.note, /Today’s post is made/);
  assert.match(lfdStep({ ...due, inFlight: { ...base.inFlight, lfdRun: true } })!.note, /already queued or running/);
  assert.equal(lfdStep(base), undefined, 'no Last Few Days read: no step, and every older plan is unchanged');
});

test('its own button runs only its step', () => {
  assert.deepEqual(stepsFor(planFrom(due), 'last_few_days').map((s) => s.action), ['lfd_run']);
  assert.deepEqual(parseRunBody({ only: 'last_few_days' }), { only: 'last_few_days' });
});

test('a queued Last Few Days run shows on its card, which can be made on its own', () => {
  const runs: AllProgress = {
    carousels: [], stories: [], explainers: [],
    last_few_days: [{ id: 'r1', label: 'Last Few Days run', state: 'queued', stage: null, error: null, topicId: null, requestedAt: '2026-10-13T07:00:00Z', startedAt: null, typicalSeconds: null }],
  };
  const card: QuotaCandidate = { vertical: 'last_few_days', idea: null, post: null, locked: false, rank: null, moved: null };
  assert.equal(runForCandidate(card, runs)?.id, 'r1');
  assert.equal(canMakeCard(card), true);
  assert.deepEqual(runningSummary(runs), ['Last Few Days queued']);
  assert.equal(inFlightKey(runs), 'last_few_days:r1:queued:');
});

test('crumbs and from-links know the type page', () => {
  assert.deepEqual(crumbsFor('/social', '/last-few-days'), [{ label: 'Content', href: '/social' }, { label: 'Last Few Days', href: null }]);
  assert.equal(safeFrom('/social', '/last-few-days'), '/last-few-days');
  assert.deepEqual(crumbsFor('/social', '/carousels').map((c) => c.label), ['Content', 'Carousels']);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx --test tests/lfd-run-today.test.ts`
Expected: FAIL: `lfdStep(due)` is `undefined`, `parseRunBody` answers `Unknown content type.`, the run chip is `null`, and the
crumbs fall through to `Content` only.

- [ ] **Step 3: Run now and the Run button**

`lib/social-hub/run-today.ts` — before:

```ts
  inFlight: { reelsRun: boolean; reelsBuilding: string[]; carouselRun: boolean; explainerTopics: string[] };
  cost: { reelsNight: number; reelBuild: number; carouselCap: number; explainerCap: number; storySet: number };
};
```

after:

```ts
  /** Last Few Days: due today (its days; any day from its own button) and whether today's post exists. Missing: no step. */
  lastFewDays?: { due: boolean; made: boolean };
  inFlight: { reelsRun: boolean; reelsBuilding: string[]; carouselRun: boolean; explainerTopics: string[]; lfdRun?: boolean };
  cost: { reelsNight: number; reelBuild: number; carouselCap: number; explainerCap: number; storySet: number; lfdCap?: number };
};
```

Before:

```ts
  action: 'none' | 'reels_build' | 'reels_run' | 'carousel_run' | 'explainer_renders' | 'story_sets';
```

after:

```ts
  action: 'none' | 'reels_build' | 'reels_run' | 'carousel_run' | 'explainer_renders' | 'story_sets' | 'lfd_run';
```

Before:

```ts
  const estimateUsd = Number(steps.reduce((s, x) => s + x.estimateUsd, 0).toFixed(2));
```

after:

```ts
  if (i.lastFewDays) {
    const d = i.lastFewDays;
    const base = { vertical: 'last_few_days' as const, label: label('last_few_days'), quota: d.due ? 1 : 0, held: d.made ? 1 : 0, needed: d.due && !d.made ? 1 : 0 };
    if (!d.due) steps.push({ ...base, action: 'none', targets: [], note: 'Last Few Days posts on its days; today isn’t one. Its page’s button makes one anyway.', estimateUsd: 0 });
    else if (d.made) steps.push({ ...base, action: 'none', targets: [], note: 'Today’s post is made.', estimateUsd: 0 });
    else if (i.inFlight.lfdRun) steps.push({ ...base, action: 'none', targets: [], note: 'A Last Few Days run is already queued or running.', estimateUsd: 0 });
    else steps.push({ ...base, action: 'lfd_run', targets: [], note: 'Makes today’s Last Few Days post: 5–6 stories, written, fact-checked and photographed. It waits for your approval.', estimateUsd: i.cost.lfdCap ?? 1 });
  }

  const estimateUsd = Number(steps.reduce((s, x) => s + x.estimateUsd, 0).toFixed(2));
```

Before:

```ts
const RUN_TYPES: readonly Vertical[] = ['reels', 'carousels', 'explainers', 'stories'];
```

after:

```ts
const RUN_TYPES: readonly Vertical[] = ['reels', 'carousels', 'explainers', 'stories', 'last_few_days'];
```

`lib/content-type/run-today-live.ts` — add after `import { liveStoriesDb } from '@/lib/stories/db';`:

```ts
import { DEFAULT_LFD_RUN_CAP_USD } from '@/lib/lfd/config';
import { readLfdSettings } from '@/lib/lfd/settings';
import { requestRun as requestLfdRun } from '@/lib/lfd/store';

/**
 * Last Few Days for Run now: due on its days (any day from its own button),
 * made when today already has a post that wasn't rejected, in flight when a
 * run is queued or running. Unreadable (schema not applied): no step.
 */
async function liveLfd(today: string, anyDay: boolean): Promise<{ day: RunInputs['lastFewDays']; inFlight: boolean; cap: number }> {
  try {
    const [s, made, flight] = await Promise.all([
      readLfdSettings(liveHubQuery),
      dbQuery<{ n: number }>(`SELECT count(*)::int AS n FROM lfd.posts WHERE ny_date = $1::date AND status <> 'rejected'`, [today]),
      dbQuery<{ n: number }>(`SELECT count(*)::int AS n FROM lfd.runs WHERE status IN ('requested', 'running')`),
    ]);
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    return { day: { due: anyDay || s.days.includes(weekday), made: Number(made.rows[0]?.n ?? 0) > 0 }, inFlight: Number(flight.rows[0]?.n ?? 0) > 0, cap: s.runCapUsd ?? DEFAULT_LFD_RUN_CAP_USD };
  } catch {
    return { day: undefined, inFlight: false, cap: DEFAULT_LFD_RUN_CAP_USD };
  }
}
```

and change its run-today import — before:

```ts
import { planFrom, quotaCandidates, stepsFor, typeDay, type PlanStep, type RunPlan } from '@/lib/social-hub/run-today';
```

after:

```ts
import { planFrom, quotaCandidates, stepsFor, typeDay, type PlanStep, type RunInputs, type RunPlan } from '@/lib/social-hub/run-today';
```

Before:

```ts
export async function livePlan(now = new Date()): Promise<RunPlan> {
  const today = nyDateOf(now)!;
```

after:

```ts
/** `lfdAnyDay`: the Last Few Days page's own button may make a post on any day (spec §8 Run button). */
export async function livePlan(now = new Date(), opts: { lfdAnyDay?: boolean } = {}): Promise<RunPlan> {
  const today = nyDateOf(now)!;
  const lfd = await liveLfd(today, opts.lfdAnyDay === true);
```

Before:

```ts
    series,
    inFlight: {
      reelsRun: Boolean(reelsPending),
      reelsBuilding: building.rows.map((r) => r.post_idea_id),
      carouselRun: Number(carouselRuns.rows[0]?.n ?? 0) > 0,
      explainerTopics: jobs.rows.map((r) => r.topic_id),
    },
    cost: { reelsNight: REELS_NIGHT_USD, reelBuild: REEL_BUILD_USD, carouselCap: carouselSettings.runCapUsd, explainerCap: exSettings.per_reel_cap_usd, storySet: STORY_SET_USD },
  });
```

after:

```ts
    series,
    ...(lfd.day ? { lastFewDays: lfd.day } : {}),
    inFlight: {
      reelsRun: Boolean(reelsPending),
      reelsBuilding: building.rows.map((r) => r.post_idea_id),
      carouselRun: Number(carouselRuns.rows[0]?.n ?? 0) > 0,
      explainerTopics: jobs.rows.map((r) => r.topic_id),
      lfdRun: lfd.inFlight,
    },
    cost: { reelsNight: REELS_NIGHT_USD, reelBuild: REEL_BUILD_USD, carouselCap: carouselSettings.runCapUsd, explainerCap: exSettings.per_reel_cap_usd, storySet: STORY_SET_USD, lfdCap: lfd.cap },
  });
```

Before:

```ts
  const plan = await livePlan(now);
  const results: StepResult[] = [];
```

after:

```ts
  const plan = await livePlan(now, { lfdAnyDay: only === 'last_few_days' });
  const results: StepResult[] = [];
```

Before:

```ts
      } else if (step.action === 'story_sets') {
```

after:

```ts
      } else if (step.action === 'lfd_run') {
        // The click approves this run's spend, up to the cap (CLAUDE.md Rule 1); only the social worker runs it.
        const s = await readLfdSettings(liveHubQuery);
        if (s.runCapUsd == null) {
          done(false, `lfd.settings.run_cap_usd is not a positive number (${JSON.stringify(s.runCapRaw)}); fix it in Settings first.`);
        } else {
          const id = await requestLfdRun(liveHubQuery, 'manual', s.runCapUsd);
          done(Boolean(id), id ? 'Run queued. The social worker starts it within a minute; the post waits for your approval.' : 'A Last Few Days run is already queued.');
        }
      } else if (step.action === 'story_sets') {
```

```ts
// app/api/last-few-days/run/route.ts
import { NextResponse } from 'next/server';

import { runType } from '@/lib/content-type/run-today-live';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Make Last Few Days now" (spec §8): queues one manual run (a `requested`
 * lfd.runs row), on any day; the social worker claims it within a poll. The
 * app never executes a run itself. The click is the approval for the run's
 * live model and web spend, capped by lfd.settings.run_cap_usd.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await runType(session.email, 'last_few_days'));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
```

```tsx
// app/last-few-days/page.tsx
import { ContentTypePage } from '@/components/content-type/ContentTypePage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Last Few Days', robots: { index: false, follow: false } };

export default function Page() {
  return <ContentTypePage vertical="last_few_days" />;
}
```

- [ ] **Step 4: The page, its controls, progress, chips and navigation**

`components/content-type/ContentTypePage.tsx` — change the `TypeControls` import (it lists the controls in braces) to also
import `LfdRunButton` (alphabetical, after `CarouselRunButton,`). Then before:

```ts
/** The types this page draws (Text on Screen has its own app page; Last Few Days joins with its Run button and settings). */
type PageVertical = Exclude<Vertical, 'reels' | 'last_few_days'>;

const TITLE: Record<PageVertical, string> = { carousels: 'Carousels', stories: 'Stories', explainers: 'Explainers' };
const BENCH_NOTE: Record<PageVertical, string> = {
```

after:

```ts
/** The types this page draws (Text on Screen has its own app page). */
type PageVertical = Exclude<Vertical, 'reels'>;

const TITLE: Record<PageVertical, string> = { carousels: 'Carousels', stories: 'Stories', explainers: 'Explainers', last_few_days: 'Last Few Days' };
const BENCH_NOTE: Record<PageVertical, string> = {
  last_few_days: 'The latest run’s queue: the stories in its post, the ones it dropped and why, and what was next in line. Major headlines lead; Text on Screen ideas fill the rest.',
```

Before:

```tsx
  } else if (vertical === 'stories') {
    generate = <StoriesGenerate />;
    settings = <PostingSettings type="stories" />;
  } else {
```

after:

```tsx
  } else if (vertical === 'stories') {
    generate = <StoriesGenerate />;
    settings = <PostingSettings type="stories" />;
  } else if (vertical === 'last_few_days') {
    generate = <LfdRunButton />;
    settings = <PostingSettings type="last_few_days" />;
  } else {
```

`components/content-type/TypeControls.tsx` — after the `CarouselRunButton` function (before
`// ── Stories ──…`), add:

```tsx
// ── Last Few Days ───────────────────────────────────────────────────────────

export function LfdRunButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function run() {
    if (!confirm('Make Last Few Days now? It picks 5–6 stories, writes and fact-checks them and finds photos, with live model and web calls, up to the run cap in Settings ($1 by default). The post waits for your approval.')) return;
    setBusy(true);
    try {
      const out = await call<{ queued: boolean; note?: string }>('/api/last-few-days/run', {});
      window.dispatchEvent(new Event(PROGRESS_EVENT));
      setNote(out.queued ? (out.note ?? 'Run queued.') : (out.note ?? 'A run is already queued.'));
      router.refresh();
    } catch (e) {
      setNote(msg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" className="rh-btn rh-btn--primary" disabled={busy} onClick={run}>Make Last Few Days now</button>
      <Note text={note} />
    </div>
  );
}
```

Before:

```tsx
export function LiveToggle({ type, initial }: { type: 'carousels' | 'stories' | 'explainers'; initial: boolean }) {
```

after:

```tsx
export function LiveToggle({ type, initial }: { type: 'carousels' | 'stories' | 'explainers' | 'last_few_days'; initial: boolean }) {
```

Before:

```tsx
  type: 'reels' | 'carousels' | 'explainers' | 'stories';
```

(in `type Posting`) after:

```tsx
  type: 'reels' | 'carousels' | 'explainers' | 'stories' | 'last_few_days';
```

Before:

```tsx
const NOUN: Record<Posting['type'], string> = { reels: 'reels', carousels: 'carousels', explainers: 'explainers', stories: 'story sets' };
```

after:

```tsx
const NOUN: Record<Posting['type'], string> = { reels: 'reels', carousels: 'carousels', explainers: 'explainers', stories: 'story sets', last_few_days: 'Last Few Days posts' };
```

Before:

```tsx
          hint={`Makes ${noun} every morning to fill the day's quota.`}
        >
          Generate every morning
        </Switch>
```

after:

```tsx
          hint={type === 'last_few_days' ? 'Makes a Last Few Days post at 3:00 AM on its days (Tuesday and Friday), in place of that day’s carousel run.' : `Makes ${noun} every morning to fill the day's quota.`}
        >
          {type === 'last_few_days' ? 'Generate on its days' : 'Generate every morning'}
        </Switch>
```

`components/content-type/run-progress.tsx` — before:

```tsx
export function RunProgressProvider({ type, children }: { type: 'carousels' | 'stories' | 'explainers'; children: ReactNode }) {
```

after:

```tsx
export function RunProgressProvider({ type, children }: { type: 'carousels' | 'stories' | 'explainers' | 'last_few_days'; children: ReactNode }) {
```

`lib/content-type/progress.ts` — before:

```ts
  return [];
}

export type AllProgress = Record<'carousels' | 'stories' | 'explainers', ProgressItem[]>;
```

after:

```ts
  if (type === 'last_few_days') {
    const { rows } = await dbQuery(
      `SELECT id::text, status, requested_at::text AS requested_at, started_at::text AS started_at
         FROM lfd.runs WHERE status IN ('requested', 'running') ORDER BY requested_at`,
    );
    if (!rows.length) return [];
    const secs = await typical(
      `SELECT extract(epoch FROM finished_at - started_at) AS secs FROM lfd.runs
        WHERE status IN ('ok', 'partial') AND started_at IS NOT NULL AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 15`,
    );
    return rows.map((r) => ({ id: r.id, label: 'Last Few Days run', state: r.status === 'running' ? 'running' : 'queued', stage: null, error: null, topicId: null, requestedAt: r.requested_at, startedAt: r.started_at, typicalSeconds: secs }) as ProgressItem);
  }
  return [];
}

export type AllProgress = Record<'carousels' | 'stories' | 'explainers', ProgressItem[]> & {
  /** Optional, so a progress map built for the first three types (tests/social-hub-run-for.test.ts) still holds; missing reads as none. */
  last_few_days?: ProgressItem[];
};
```

Before:

```ts
  const [carousels, stories, explainers] = await Promise.all([one('carousels'), one('stories'), one('explainers')]);
  return { carousels, stories, explainers };
```

after:

```ts
  const [carousels, stories, explainers, lastFewDays] = await Promise.all([one('carousels'), one('stories'), one('explainers'), one('last_few_days')]);
  return { carousels, stories, explainers, last_few_days: lastFewDays };
```

`lib/social-hub/views/run-for.ts` — before:

```ts
const TYPES = ['carousels', 'stories', 'explainers'] as const;

const TYPE_LABEL = { carousels: 'Carousels', stories: 'Stories', explainers: 'Explainers' } as const;
```

after:

```ts
const TYPES = ['carousels', 'stories', 'explainers', 'last_few_days'] as const;

const TYPE_LABEL = { carousels: 'Carousels', stories: 'Stories', explainers: 'Explainers', last_few_days: 'Last Few Days' } as const;
```

Before:

```ts
  return TYPES.flatMap((v) => runs[v].map((i) => `${v}:${i.id}:${i.state}:${i.stage ?? ''}`)).sort().join('|');
```

after:

```ts
  return TYPES.flatMap((v) => (runs[v] ?? []).map((i) => `${v}:${i.id}:${i.state}:${i.stage ?? ''}`)).sort().join('|');
```

Before:

```ts
    const items = runs[v];
    if (!items.length) return [];
```

after:

```ts
    const items = runs[v] ?? [];
    if (!items.length) return [];
```

Before (the line Task 9 added):

```ts
  // Last Few Days runs aren't in AllProgress yet (their progress strip lands with the type page).
  if (c.vertical === 'reels' || c.vertical === 'last_few_days') return null;
```

after:

```ts
  if (c.vertical === 'reels') return null;
```

Before:

```ts
  // A run that picks its own stories shows on every card; one asked for particular stories (topicId) only on those.
  if (c.vertical === 'carousels') {
```

after:

```ts
  // A run that picks its own stories shows on every card; one asked for particular stories (topicId) only on those.
  // A Last Few Days run is always the type's own job: it shows on its card.
  if (c.vertical === 'carousels' || c.vertical === 'last_few_days') {
```

Before:

```ts
  return Boolean(c.idea) || c.vertical === 'carousels';
```

after:

```ts
  return Boolean(c.idea) || c.vertical === 'carousels' || c.vertical === 'last_few_days';
```

`components/social-hub/content/RunsRefresh.tsx` — before:

```tsx
const TYPES = ['carousels', 'stories', 'explainers'] as const;
```

after:

```tsx
const TYPES = ['carousels', 'stories', 'explainers', 'last_few_days'] as const;
```

before:

```tsx
        const next = inFlightKey({ carousels: lists[0] ?? [], stories: lists[1] ?? [], explainers: lists[2] ?? [] });
```

after:

```tsx
        const next = inFlightKey({ carousels: lists[0] ?? [], stories: lists[1] ?? [], explainers: lists[2] ?? [], last_few_days: lists[3] ?? [] });
```

`components/social-hub/content/ContentScreen.tsx` — before:

```tsx
  const runs: AllProgress = progress ?? { carousels: [], stories: [], explainers: [] };
```

after:

```tsx
  const runs: AllProgress = progress ?? { carousels: [], stories: [], explainers: [], last_few_days: [] };
```

and before:

```tsx
function PoolPanel({ pool, base, now, running }: { pool: PoolSummary; base: string; now: Date; running: AllProgress[keyof AllProgress] }) {
```

after (`last_few_days` is optional in `AllProgress`; the caller already passes `?? []`):

```tsx
function PoolPanel({ pool, base, now, running }: { pool: PoolSummary; base: string; now: Date; running: NonNullable<AllProgress[keyof AllProgress]> }) {
```

`components/social-hub/content/HubControls.tsx` — before:

```tsx
  { id: 'stories', label: 'IG Stories', min: 0 },
];
```

after:

```tsx
  { id: 'stories', label: 'IG Stories', min: 0 },
  { id: 'last_few_days', label: 'Last Few Days', min: 0 },
];
```

`lib/social-hub/views/nav.ts` — before:

```ts
  const typePage = base === '/social' && /^\/(carousels|stories|explainers)(\?|$)/.test(raw);
```

after:

```ts
  const typePage = base === '/social' && /^\/(carousels|stories|explainers|last-few-days)(\?|$)/.test(raw);
```

Before:

```ts
const isTypePage = (part: string | undefined): part is Exclude<Vertical, 'reels'> => part === 'carousels' || part === 'stories' || part === 'explainers';
```

after:

```ts
/** A content type's own page by its path segment (the hub-hosted ones; Text on Screen is a separate app). */
const TYPE_PAGES: Record<string, Exclude<Vertical, 'reels'>> = { carousels: 'carousels', stories: 'stories', explainers: 'explainers', 'last-few-days': 'last_few_days' };
const typePageOf = (part: string | undefined): Exclude<Vertical, 'reels'> | null => (part && Object.hasOwn(TYPE_PAGES, part) ? TYPE_PAGES[part]! : null);
```

Before:

```ts
  } else if (isTypePage(parts[0])) {
    // A content type's own page lives outside the hub base (/carousels …): Content › its name.
    trail.push({ label: 'Content', href: base }, { label: verticalInfo(parts[0]).label, href: `/${parts[0]}` });
```

after:

```ts
  } else if (typePageOf(parts[0])) {
    // A content type's own page lives outside the hub base (/carousels, /last-few-days …): Content › its name.
    trail.push({ label: 'Content', href: base }, { label: verticalInfo(typePageOf(parts[0])!).label, href: `/${parts[0]}` });
```

`components/hub-shell/nav.ts` — before:

```ts
      path.startsWith('/stories') ||
      path.startsWith('/explainers'),
```

after:

```ts
      path.startsWith('/stories') ||
      path.startsWith('/explainers') ||
      path.startsWith('/last-few-days'),
```

`middleware.ts` (in `isProtectedPage`) — before:

```ts
    || pathname === '/carousels'
    || pathname.startsWith('/carousels/')
```

after:

```ts
    || pathname === '/carousels'
    || pathname.startsWith('/carousels/')
    || pathname === '/last-few-days'
    || pathname.startsWith('/last-few-days/')
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx tsx --test tests/lfd-run-today.test.ts tests/social-hub-run-today.test.ts tests/social-hub-run-for.test.ts tests/social-hub-nav.test.ts tests/content-type.test.ts tests/social-hub-scope.test.ts`
Expected: PASS (`tests/social-hub-scope.test.ts` still finds every `HUB_CONTROLS` endpoint under `/api/content-type/`).
Then `npm test`: PASS. Typecheck line prints nothing. Do **not** click the button or call the route: that queues a live run.

- [ ] **Step 6: Commit**

```bash
git add app/last-few-days/page.tsx app/api/last-few-days/run/route.ts components/content-type/ContentTypePage.tsx \
  components/content-type/TypeControls.tsx components/content-type/run-progress.tsx lib/content-type/progress.ts \
  lib/social-hub/views/run-for.ts components/social-hub/content/RunsRefresh.tsx components/social-hub/content/ContentScreen.tsx \
  components/social-hub/content/HubControls.tsx lib/social-hub/run-today.ts lib/content-type/run-today-live.ts \
  lib/social-hub/views/nav.ts components/hub-shell/nav.ts middleware.ts tests/lfd-run-today.test.ts
git commit -m "feat(lfd): Last Few Days page, Make Last Few Days now, Run now step, progress, navigation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Last Few Days in the cost ledger

**Files:**
- Modify: `lib/social-hub/queries/costs.ts`
- Test: `tests/lfd-cost.test.ts` (create)

**Interfaces:**
- Consumes: `lfd.runs` (`claude_usd`, `jev_usd`), `lfd.posts.run_id`; `toMicros`, `allocate`, `itemTotals`.
- Produces: `CostReads.lfdRuns?: Array<{ id; claude_usd; jev_usd; ny_date; post_id }>`; `COST_SQL.lfdRuns`; ledger rows
  `last_few_days:run:<id>:claude|jev` on item `last_few_days:<postId>` (the adapter's `costItemKey`), or unattributed when the
  run made no post.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lfd-cost.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { allocate, itemTotals } from '@/lib/social-hub/cost';
import type { HubQuery } from '@/lib/social-hub/db';
import { buildLedger, readCosts, type CostReads } from '@/lib/social-hub/queries/costs';

import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

const EMPTY: CostReads = { reelEvents: [], reelKling: [], reelWeights: [], reelProduced: [], explainerEvents: [], explainerRendered: [], carouselRuns: [], storyEvents: [], storySets: [] };

test('a run’s spend lands on its post; a run with no post stays unattributed', () => {
  const { rows, pools } = buildLedger({
    ...EMPTY,
    lfdRuns: [
      { id: 'r1', claude_usd: '0.30', jev_usd: '0.05', ny_date: '2026-10-13', post_id: 'p1' },
      { id: 'r2', claude_usd: '0.10', jev_usd: '0', ny_date: '2026-10-16', post_id: null },
    ],
  });
  const ledger = allocate(rows, pools);
  assert.equal(itemTotals(ledger).get('last_few_days:p1'), 350_000);
  assert.deepEqual(ledger.unattributed.map((u) => [u.vertical, u.micros]), [['last_few_days', 100_000]]);
  assert.deepEqual(rows.map((r) => [r.vendor, r.label]), [
    ['anthropic', 'writing and rewrites'],
    ['jev', 'story picking and fact check (jev)'],
    ['anthropic', 'writing and rewrites'],
  ]);
});

test('readCosts reads lfd.runs with each run’s post; a database without the lfd schema reads as none', async () => {
  const { query } = await openHubTestDb();
  const run = (await query<{ id: string }>(
    `INSERT INTO lfd.runs (trigger, status, started_at, claude_usd, jev_usd, total_usd) VALUES ('manual', 'ok', '2026-10-13T07:00:00Z', 0.3, 0.05, 0.35) RETURNING id::text AS id`,
  )).rows[0]!.id;
  const post = await seedLfdPost(query);
  await query(`UPDATE lfd.posts SET run_id = $1 WHERE id = $2`, [run, post]);
  assert.deepEqual((await readCosts(query)).lfdRuns?.map((r) => [r.id, r.post_id, r.ny_date]), [[run, post, '2026-10-13']]);
  const noLfd = (async (text: string, params?: unknown[]) =>
    (/lfd\./.test(text) ? Promise.reject(new Error('relation "lfd.runs" does not exist')) : query(text, params))) as HubQuery;
  assert.deepEqual((await readCosts(noLfd)).lfdRuns, []);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx --test tests/lfd-cost.test.ts`
Expected: FAIL: no ledger rows for `lfdRuns`, and `readCosts(...).lfdRuns` is `undefined`.

- [ ] **Step 3: Write the code**

In `lib/social-hub/queries/costs.ts`:

Before (header comment):

```ts
 * (social.runs.total_usd split by the run record's per-story costs), and
 * stories.cost_events. Denormalized totals (jobs.spend_usd, sets.spend_usd)
```

after:

```ts
 * (social.runs.total_usd split by the run record's per-story costs),
 * stories.cost_events, and Last Few Days runs (lfd.runs Claude and Jev spend,
 * on the post each run made). Denormalized totals (jobs.spend_usd, sets.spend_usd)
```

Before:

```ts
  storySets: Array<{ set_id: string; ny_date: string; spend_usd: string }>;
};
```

after:

```ts
  storySets: Array<{ set_id: string; ny_date: string; spend_usd: string }>;
  /** Last Few Days runs with the post each made (null: it made none). Optional: older callers build reads without it. */
  lfdRuns?: Array<{ id: string; claude_usd: string; jev_usd: string; ny_date: string; post_id: string | null }>;
};
```

Before:

```ts
  storySets: `SELECT id AS set_id, ny_date::text AS ny_date, spend_usd::text AS spend_usd
                FROM stories.sets WHERE status NOT IN ('requested', 'building')`,
} as const;
```

after:

```ts
  storySets: `SELECT id AS set_id, ny_date::text AS ny_date, spend_usd::text AS spend_usd
                FROM stories.sets WHERE status NOT IN ('requested', 'building')`,
  lfdRuns: `SELECT r.id::text AS id, r.claude_usd::text AS claude_usd, r.jev_usd::text AS jev_usd,
                   ${day('COALESCE(r.started_at, r.requested_at)')} AS ny_date,
                   (SELECT p.id::text FROM lfd.posts p WHERE p.run_id = r.id ORDER BY p.created_at DESC LIMIT 1) AS post_id
              FROM lfd.runs r WHERE r.status IN ('ok', 'partial', 'failed')`,
} as const;
```

Before:

```ts
  const results = await Promise.all(keys.map((key) => {
    if (!EXPLAINER_KEYS.has(key)) return q(COST_SQL[key]);
```

after:

```ts
  const results = await Promise.all(keys.map((key) => {
    // A database without the lfd schema reads as no Last Few Days spend, never as a cost-read failure.
    if (key === 'lfdRuns') return q(COST_SQL[key]).catch(() => ({ rows: [] }));
    if (!EXPLAINER_KEYS.has(key)) return q(COST_SQL[key]);
```

In `buildLedger`, before its final `return { rows, pools };` add:

```ts
  // ── Last Few Days: a run's Claude and Jev spend belongs to the post it made; a run with no post stays unattributed.
  for (const run of r.lfdRuns ?? []) {
    const pool = `last_few_days:run:${run.id}`;
    const target: LedgerRow['target'] = run.post_id ? { kind: 'item', item: `last_few_days:${run.post_id}` } : { kind: 'pool', pool };
    if (!run.post_id) pools.push({ key: pool, items: [] });
    const claude = toMicros(run.claude_usd);
    const jev = toMicros(run.jev_usd);
    if (claude > 0) rows.push({ id: `${pool}:claude`, vertical: 'last_few_days', nyDate: run.ny_date, micros: claude, target, label: 'writing and rewrites', vendor: 'anthropic', mode: 'production' });
    if (jev > 0) rows.push({ id: `${pool}:jev`, vertical: 'last_few_days', nyDate: run.ny_date, micros: jev, target, label: 'story picking and fact check (jev)', vendor: 'jev', mode: 'production' });
  }
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx tsx --test tests/lfd-cost.test.ts tests/social-hub-cost.test.ts tests/social-cost-model.test.ts tests/social-hub-scope.test.ts`
Expected: PASS. Then `npm test`: PASS. Typecheck line prints nothing.

- [ ] **Step 5: Commit**

```bash
git add lib/social-hub/queries/costs.ts tests/lfd-cost.test.ts
git commit -m "feat(lfd): Last Few Days runs in the hub cost ledger

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Rollout (spec §11; every step is Tommy's)

0. **Before anything ships** (from Tasks 1 and 8): apply the spine schema
   (`node scripts/apply_social_hub_schema.js --apply`), confirm the `lfd` schema is applied (it was, 2026-10-13;
   `node scripts/apply_lfd_schema.js` is idempotent), deploy the app the usual way, and redeploy the worker VM
   (`./scripts/gcp/deploy-social-worker.sh`). With LFD's switches off this changes nothing on any day: Carousels still run and
   post Tuesday and Friday.
1. **Ship with `auto_run` and `publishing_live` off** (the `lfd.settings` defaults). On `/last-few-days` → Settings, "Generate
   on its days" and Auto-publish are off, and Live is off.
2. **Tommy makes the first post by hand:** "Make Last Few Days now" on `/last-few-days` (any day; up to the $1 cap). The worker
   claims it within ~15 seconds; the post lands in review with its slides, caption, per-story sources and any short-post, text
   fit or render notes. Tommy judges it and Approves (it books the next Tuesday or Friday 9:00–10:00 AM window; with Live off it
   stays booked and does not post), or Rejects (its stories go back into the pool). Agents may report telemetry from
   `lfd.runs` (cost, drop reasons in `record.drops`, `stop_reason`) and `lfd.posts` (`fit_problems`, `render_problems`), never a
   quality verdict.
3. **Tommy turns on `auto_run`** ("Generate on its days"). From the next Tuesday or Friday, 3:00 AM makes a Last Few Days post
   and Carousels stop on those days: no 3:00 carousel run, no carousel booking, no carousel windows in the hub.
4. **Tommy turns on `publishing_live`** (Live). Each scheduled run books its own day's 9:00–10:00 AM window; with
   `require_approval` on (the default) the slot posts only once Tommy approves it, and an unapproved slot is cancelled with the
   reason when it comes due.

**Known knock-on (spec §11):** Morning Download pools carousel stories from the last 30 hours, so on Wednesday and Saturday
mornings (after a day with no carousel run) its carousel side is thin. Its reels side is unaffected. No change in this plan.

## Notes for Tommy: spec gaps and conflicts found while planning

1. **No shared spine insights sweep exists** (spec §7.3 says Last Few Days needs no insights hour because of one). Insights
   are read per type; this plan adds a `vertical` parameter to the carousel insights reader and reads LFD posts on the carousel
   cadence (decision 12).
2. **The single publisher is installed but off** (`publisher_mode` `off`), so the spec's "publish driver" alone would never
   post. LFD also publishes from the social worker loop, exactly like Carousels, until the publisher goes live (decision 11).
3. **Plan 1's engine inserts its own `running` row**, which collides with the contract's `requested → running` claim. The
   engine now adopts a claimed run (decision 4).
4. **Daily fill vs LFD-05 ("never skipped").** §7.4 asks for daily fill; this plan skips a *scheduled* run only when a person
   already placed an LFD post for that day, and never skips a manual one (decision 8). Say if you'd rather it never skip.
5. **Delete has no hub button for any type.** Every type implements the `delete` verb, but no action route exposes it; LFD gets
   the verb like the others (so it works the same as the other types: not clickable yet).
6. **The Health tab needs a reporter per type** (`REPORTERS` is exhaustive); not in the spec. LFD gets a small one (decision 14).
7. **Ideas view.** The pool for the *next* post needs Jev judgments, so the hub shows the latest run's queue, picks and drops
   (decision 13).
8. **Carousels giving up Tue/Fri in the hub's plan** needed the LFD days threaded through `DayQuotas` (decision 10); the spec
   named only `placement.ts`, `views/plan.ts` and `fill.ts`.
9. **Not changed (follow-ups if wanted):** `scripts/overnight_check.ts` (read-only report) and `scripts/backfill_spine.ts`
   still list four types (LFD has no legacy tables to backfill, and the check is optional); `components/hub-shell/HubSidebar.tsx`
   has no LFD entry (the type page is reached from the hub's Content page and highlights Social Hub).
