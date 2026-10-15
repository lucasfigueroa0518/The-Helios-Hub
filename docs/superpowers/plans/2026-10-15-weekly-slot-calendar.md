# Weekly Slot Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Social Hub Calendar the one place that sets posting cadence: a weekly template of slots (content type + existing window, Trial/Main on reel types), with single-date overrides, read by every scheduler behind a `slot_source` switch.

**Architecture:** Two new `social_hub` tables (template, overrides) plus a `feed_mode` column on bookings. A pure resolver (`resolveDay`) turns them into the slots for a date. One select-only module (`lib/social-hub/slots`) answers "which windows are slots on these dates" for every scheduler and hub view, and returns `null` while `slot_source = 'legacy'`. On `null`, every call site keeps its existing code path untouched. That untouched path *is* the legacy adapter the spec describes: legacy mode runs today's code, not a copy of it. Writes go through one API route. Posting reads Trial/Main from the booking.

**Tech Stack:** Next.js App Router (server components + small client components), TypeScript, Postgres (Supabase) / PGlite in tests, `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-14-weekly-slot-calendar-design.md`

## Global Constraints

- No test, agent run, or script in this plan calls the Claude API, `web_search`, or Instagram. Tests are offline: PGlite with the real `db/*.sql` files (`tests/fixtures/social-hub/pglite.ts`).
- All times are America/New_York. Weekday numbering is 0 = Sunday (`weekdayOf` in `lib/social-hub/time.ts`).
- Window times stay in code: `PLAN` (`lib/social-hub/views/plan.ts`) is the hub's copy, and the worker constants stay the source. No free times, no window editing.
- `slot_source` is seeded `'legacy'`. Nothing changes behavior until a person flips it.
- `db/social_hub_schema.sql` stays idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `DROP CONSTRAINT IF EXISTS` before `ADD`). Applying it is Tommy's step (`node scripts/apply_social_hub_schema.js --apply`). Agents don't run it.
- Hub code writes SQL only to `social_hub.*` (`tests/social-hub-scope.test.ts`). The slot read module is SELECT-only.
- Read-only DB checks use `psql "$DATABASE_URL" -X -c "BEGIN READ ONLY; …; ROLLBACK;"`. Never a session `SET`.
- Worker sync: any change under `lib/social`, `lib/lfd`, `lib/stories`, `lib/explainers`, `lib/reels`, `lib/instagram`, or `scripts/*_worker.ts` ships with `./scripts/gcp/deploy-social-worker.sh` (and `./scripts/gcp/deploy-worker-code.sh` when an orchestration-VM import changed) in the same session. Tommy says when to deploy.
- Git: stay on `unify-social-hub`. Never create, switch, or merge branches. Commit per task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Copy rules: plain sentences, no em-dash chains, the hub's existing voice. Type names come from `VERTICALS[].label` ("Text on Screen", "Explainer Reels", …).

## Review Focus

1. **A missing table or unreadable settings row:** `slot_source` must read as `'legacy'` (old behavior) whenever `social_hub.settings`/`slot_template` can't be read, e.g. the Explainers local PGlite DB without the hub schema. Test in Task 3.
2. **A booked post whose slot is removed or flipped** in a template edit far ahead (outside the visible week): the 409 must list it even when it's 13 days out. Test in Task 4.
3. **Force post / Hard publish with no slot:** `feed_mode` lookup finds no booking and must fall back to the type's old behavior (reels Trial, explainers Main), never crash or send `trial_params: null`. Test in Task 5.
4. **Today's window already started:** template mode must still let a started window take a post (the existing `openMinuteRange` rule), and the editor must refuse edits to windows that have begun. Tests in Task 6 and Task 4.
5. **LFD paused on an LFD-slot day:** with `slot_source = 'template'`, the 3 AM run queues neither LFD nor Carousels (decision 7) and logs why. Test in Task 7.

---

## File structure

**Create**
- `lib/social-hub/slots/types.ts`: shared types and the reel-type list.
- `lib/social-hub/slots/resolve.ts`: `resolveDay`, `validateDay` (pure).
- `lib/social-hub/slots/seed.ts`: `seedTemplate` (pure) and `readSeedInputs` (SELECT).
- `lib/social-hub/slots/load.ts`: `readSlotSource`, `readTemplate`, `readOverrides`, `loadSlots` (SELECT).
- `lib/social-hub/slots/index.ts`: the scheduler seam (`slotPlan`, `nonSlotKeys`, `feedModeKeys`, `isLfdDay`, `feedModeFor`, `bookingFeedMode`, `legacyFeedMode`) (SELECT).
- `lib/social-hub/slots/choose.ts`: `chooseByFeedMode` (pure).
- `lib/social-hub/slots/write.ts`: `applySlotChanges`, `setSlotSource`.
- `app/api/social-hub/slots/route.ts`: GET/POST slot changes.
- `app/api/social-hub/slots/source/route.ts`: flip `slot_source` (seeds on first flip).
- `lib/social-hub/views/week.ts`: `weekModel` (pure).
- `components/social-hub/calendar/WeekGrid.tsx`: server-rendered grid.
- `components/social-hub/calendar/SlotEditor.tsx`: client popover / add picker.
- `components/content-type/ScheduleStrip.tsx`: read-only strip on type pages.
- Tests: `tests/slots-schema.test.ts`, `tests/slots-resolve.test.ts`, `tests/slots-load.test.ts`, `tests/slots-write.test.ts`, `tests/slots-feed-mode.test.ts`, `tests/slots-schedulers.test.ts`, `tests/slots-hub-views.test.ts`, `tests/slots-week.test.ts`.

**Modify** (each named in its task): `db/social_hub_schema.sql`, `lib/social-hub/spine.ts`, `lib/instagram/feed-spacing.ts`, `lib/reels/music/publish.ts`, `lib/reels/music/meta.ts`, `lib/explainers/publish/{publish,meta,schedule}.ts`, `lib/explainers/ideas/cycle.ts`, `lib/social/overnight/schedule.ts`, `lib/reels/publish/schedule.ts`, `lib/reels/pipeline/fill.ts`, `lib/lfd/{schedule,clock}.ts`, `scripts/social_worker.ts`, `lib/stories/{schedule,worker}.ts`, `lib/social-hub/placement.ts`, `lib/social-hub/health/reporters/carousels.ts`, `lib/social-hub/views/{plan,calendar,today,offer,day-rank}.ts`, `lib/social-hub/views/day-rank.ts` (DayQuotas), `lib/social-hub/queries/day.ts`, `lib/content-type/{posting,model,run-today-live}.ts`, `components/content-type/TypeControls.tsx`, `components/social-hub/calendar/CalendarScreen.tsx`, `app/social/(hub)/calendar/page.tsx`, `app/social/(hub)/preview/calendar/page.tsx`, `app/social/(hub)/hub-calendar.css`, `lib/social-hub/flags.ts`, `tests/social-hub-scope.test.ts`, `docs/social-overnight.md`, `planning/Social Hub/DECISIONS_LOG.md`.

---

### Task 1: Schema: template, overrides, `feed_mode`, `slot_source`

**Files:**
- Modify: `db/social_hub_schema.sql` (append at the end of the file)
- Test: `tests/slots-schema.test.ts`

**Interfaces:**
- Produces: tables `social_hub.slot_template(weekday, vertical, window_id, feed_mode, updated_by, updated_at)`, `social_hub.slot_override(ny_date, vertical, window_id, action, feed_mode, updated_by, updated_at)`; column `social_hub.schedule.feed_mode text null`; settings row `slot_source = "legacy"`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/slots-schema.test.ts
/** Weekly slot calendar schema (spec §1): CHECKs hold, the switch starts at legacy. Offline PGlite. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { openHubTestDb } from './fixtures/social-hub/pglite';

test('slot_template takes a valid slot and refuses bad ones', async () => {
  const { pg } = await openHubTestDb();
  await pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode) VALUES (2, 'reels', 'morning', 'trial')`);
  await pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode) VALUES (2, 'stories', 'free_vs_paid', NULL)`);
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode) VALUES (2, 'reels', 'midday', NULL)`), /feed_mode/);
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode) VALUES (2, 'carousels', 'morning', 'main')`), /feed_mode/);
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode) VALUES (2, 'carousels', 'evening', NULL)`), /window/);
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode) VALUES (7, 'carousels', 'morning', NULL)`));
});

test('slot_override: remove carries no feed_mode, add on a reel type needs one', async () => {
  const { pg } = await openHubTestDb();
  await pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, window_id, action, feed_mode) VALUES ('2026-10-20', 'reels', 'morning', 'add', 'main')`);
  await pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, window_id, action, feed_mode) VALUES ('2026-10-25', 'carousels', 'morning', 'remove', NULL)`);
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, window_id, action, feed_mode) VALUES ('2026-10-21', 'reels', 'morning', 'remove', 'main')`), /feed_mode/);
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, window_id, action, feed_mode) VALUES ('2026-10-21', 'explainers', 'late', 'add', NULL)`), /feed_mode/);
});

test('schedule has feed_mode, and slot_source starts at legacy', async () => {
  const { pg } = await openHubTestDb();
  const col = await pg.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'social_hub' AND table_name = 'schedule' AND column_name = 'feed_mode'`);
  assert.equal(col.rows.length, 1);
  const src = await pg.query<{ value: unknown }>(`SELECT value FROM social_hub.settings WHERE key = 'slot_source'`);
  assert.equal(src.rows[0]?.value, 'legacy');
});

test('the schema file applies twice (idempotent)', async () => {
  const { pg } = await openHubTestDb();
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync('db/social_hub_schema.sql', 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
  await pg.exec(sql);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx tsx --test tests/slots-schema.test.ts`
Expected: FAIL (`relation "social_hub.slot_template" does not exist`).

- [ ] **Step 3: Append the schema**

Append to the end of `db/social_hub_schema.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- Weekly slot calendar (docs/superpowers/specs/2026-10-14-weekly-slot-calendar-design.md).
-- The calendar owns when: a standing week of slots (a type in one of its own
-- windows) plus single-date overrides. Read only while slot_source = 'template'.
-- ════════════════════════════════════════════════════════════════════════════

-- The same (vertical, window) pairs schedule_slot_check allows.
CREATE TABLE IF NOT EXISTS social_hub.slot_template (
    weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    vertical    text NOT NULL,
    window_id   text NOT NULL,
    feed_mode   text,
    updated_by  text,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (weekday, vertical, window_id),
    CONSTRAINT slot_template_window_check CHECK (
        (vertical = 'carousels' AND window_id IN ('morning', 'afternoon'))
        OR (vertical = 'explainers' AND window_id IN ('afternoon', 'late'))
        OR (vertical = 'reels' AND window_id IN ('morning', 'midday', 'evening'))
        OR (vertical = 'stories' AND window_id IN ('morning_download', 'guess_the_number', 'free_vs_paid'))
        OR (vertical = 'last_few_days' AND window_id IN ('morning'))
    ),
    -- Trial / Main feed exists only for reel types.
    CONSTRAINT slot_template_feed_mode_check CHECK (
        (vertical IN ('reels', 'explainers') AND feed_mode IN ('trial', 'main'))
        OR (vertical NOT IN ('reels', 'explainers') AND feed_mode IS NULL)
    )
);

-- One date's exceptions. An 'add' on a template key replaces it for that date
-- (that is how a single-date Trial/Main flip is stored).
CREATE TABLE IF NOT EXISTS social_hub.slot_override (
    ny_date     date NOT NULL,
    vertical    text NOT NULL,
    window_id   text NOT NULL,
    action      text NOT NULL CHECK (action IN ('add', 'remove')),
    feed_mode   text,
    updated_by  text,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (ny_date, vertical, window_id),
    CONSTRAINT slot_override_window_check CHECK (
        (vertical = 'carousels' AND window_id IN ('morning', 'afternoon'))
        OR (vertical = 'explainers' AND window_id IN ('afternoon', 'late'))
        OR (vertical = 'reels' AND window_id IN ('morning', 'midday', 'evening'))
        OR (vertical = 'stories' AND window_id IN ('morning_download', 'guess_the_number', 'free_vs_paid'))
        OR (vertical = 'last_few_days' AND window_id IN ('morning'))
    ),
    CONSTRAINT slot_override_feed_mode_check CHECK (
        (action = 'remove' AND feed_mode IS NULL)
        OR (action = 'add' AND vertical IN ('reels', 'explainers') AND feed_mode IN ('trial', 'main'))
        OR (action = 'add' AND vertical NOT IN ('reels', 'explainers') AND feed_mode IS NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_social_hub_slot_override_date ON social_hub.slot_override (ny_date);

-- A booking keeps the slot's Trial/Main as it was when placed; posting reads it.
ALTER TABLE social_hub.schedule ADD COLUMN IF NOT EXISTS feed_mode text;
ALTER TABLE social_hub.schedule DROP CONSTRAINT IF EXISTS schedule_feed_mode_check;
ALTER TABLE social_hub.schedule ADD CONSTRAINT schedule_feed_mode_check CHECK (
    feed_mode IS NULL OR (vertical IN ('reels', 'explainers') AND feed_mode IN ('trial', 'main'))
);

-- Who decides cadence: 'legacy' (each type's settings, as before) or 'template' (the calendar).
INSERT INTO social_hub.settings (key, value) VALUES ('slot_source', '"legacy"'::jsonb) ON CONFLICT (key) DO NOTHING;
```

The `schedule` CHECK allows `NULL` on reel types on purpose: bookings made before this column existed have none (spec §5 fallback).

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test tests/slots-schema.test.ts tests/lfd-spine-schema.test.ts tests/social-hub-foundations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add db/social_hub_schema.sql tests/slots-schema.test.ts
git commit -m "feat(slots): schema for the weekly slot template, overrides and booking feed_mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure resolver, validation, seed, and the parity test

**Files:**
- Create: `lib/social-hub/slots/types.ts`, `lib/social-hub/slots/resolve.ts`, `lib/social-hub/slots/seed.ts` (pure part only in this task)
- Test: `tests/slots-resolve.test.ts`

**Interfaces:**
- Consumes: `PLAN`, `windowsOn` (`lib/social-hub/views/plan.ts`), `weekdayOf` (`lib/social-hub/time.ts`), `verticalInfo` (`lib/social-hub/verticals.ts`).
- Produces:
  - `type FeedMode = 'trial' | 'main'`
  - `type TemplateRow = { weekday: number; vertical: Vertical; windowId: string; feedMode: FeedMode | null }`
  - `type OverrideRow = { nyDate: string; vertical: Vertical; windowId: string; action: 'add' | 'remove'; feedMode: FeedMode | null }`
  - `type ResolvedSlot = { vertical: Vertical; windowId: string; feedMode: FeedMode | null; startMinute: number; endMinute: number; origin: 'template' | 'override' }`
  - `type SlotSource = 'legacy' | 'template'`
  - `type SlotQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>`
  - `REEL_TYPES: readonly Vertical[]`, `isReelType(v): boolean`
  - `resolveDay(template: readonly TemplateRow[], overrides: readonly OverrideRow[], nyDate: string): ResolvedSlot[]`
  - `validateDay(slots: readonly ResolvedSlot[]): string[]`
  - `LFD_CAROUSEL_CONFLICT: string`
  - `type SeedInputs = { lfdDays: readonly number[]; storyDays: Record<'morning_download' | 'guess_the_number' | 'free_vs_paid', readonly number[]> }`
  - `seedTemplate(input: SeedInputs): TemplateRow[]`
  - `DEFAULT_SEED_INPUTS: SeedInputs`

- [ ] **Step 1: Write the failing test**

```ts
// tests/slots-resolve.test.ts
/** The weekly slot resolver (spec §2) and the "day 1 = today" parity (spec §6.2). Pure, offline. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDay, validateDay, LFD_CAROUSEL_CONFLICT } from '@/lib/social-hub/slots/resolve';
import { DEFAULT_SEED_INPUTS, seedTemplate } from '@/lib/social-hub/slots/seed';
import type { OverrideRow, TemplateRow } from '@/lib/social-hub/slots/types';
import { windowsOn } from '@/lib/social-hub/views/plan';
import { VERTICAL_IDS } from '@/lib/social-hub/verticals';

// Mon 2026-10-19 … Sun 2026-10-25.
const WEEK = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
const T = (weekday: number, vertical: TemplateRow['vertical'], windowId: string, feedMode: TemplateRow['feedMode'] = null): TemplateRow => ({ weekday, vertical, windowId, feedMode });

test('a template day resolves in start order with window times from PLAN', () => {
  const tpl = [T(2, 'explainers', 'afternoon', 'main'), T(2, 'reels', 'morning', 'trial'), T(3, 'reels', 'evening', 'trial')];
  const day = resolveDay(tpl, [], '2026-10-20'); // Tuesday
  assert.deepEqual(day.map((s) => `${s.vertical}:${s.windowId}`), ['reels:morning', 'explainers:afternoon']);
  assert.equal(day[0]!.startMinute, 8 * 60 + 45);
  assert.equal(day[0]!.origin, 'template');
});

test('overrides: remove drops, add inserts, add on a template key replaces it (single-date flip)', () => {
  const tpl = [T(2, 'reels', 'morning', 'trial'), T(2, 'carousels', 'afternoon')];
  const ov: OverrideRow[] = [
    { nyDate: '2026-10-20', vertical: 'reels', windowId: 'morning', action: 'add', feedMode: 'main' },
    { nyDate: '2026-10-20', vertical: 'carousels', windowId: 'afternoon', action: 'remove', feedMode: null },
    { nyDate: '2026-10-20', vertical: 'explainers', windowId: 'late', action: 'add', feedMode: 'trial' },
    { nyDate: '2026-10-27', vertical: 'reels', windowId: 'morning', action: 'remove', feedMode: null },
  ];
  const day = resolveDay(tpl, ov, '2026-10-20');
  assert.deepEqual(day.map((s) => [s.vertical, s.windowId, s.feedMode, s.origin]), [
    ['reels', 'morning', 'main', 'override'],
    ['explainers', 'late', 'trial', 'override'],
  ]);
  // Another Tuesday is untouched by Oct 20's overrides.
  assert.equal(resolveDay(tpl, ov, '2026-11-03').length, 2);
});

test('an unknown window id is dropped, not crashed on', () => {
  assert.deepEqual(resolveDay([T(1, 'carousels', 'midnight')], [], '2026-10-19'), []);
});

test('validateDay: LFD and Carousels never share a day; feed_mode only on reel types', () => {
  const day = (tpl: TemplateRow[]) => resolveDay(tpl, [], '2026-10-20');
  assert.deepEqual(validateDay(day([T(2, 'last_few_days', 'morning'), T(2, 'carousels', 'afternoon')])), [LFD_CAROUSEL_CONFLICT]);
  assert.deepEqual(validateDay(day([T(2, 'last_few_days', 'morning'), T(2, 'reels', 'morning', 'trial')])), []);
  assert.equal(validateDay(day([T(2, 'reels', 'morning', null)])).length, 1);
  assert.equal(validateDay(day([T(2, 'stories', 'morning_download', 'main')])).length, 1);
});

test('parity: the seeded template gives exactly today\'s windows on every weekday', () => {
  const tpl = seedTemplate(DEFAULT_SEED_INPUTS);
  for (const date of WEEK) {
    for (const v of VERTICAL_IDS) {
      const legacy = windowsOn(v, date, DEFAULT_SEED_INPUTS.lfdDays).map((w) => w.id);
      const now = resolveDay(tpl, [], date).filter((s) => s.vertical === v).map((s) => s.windowId);
      assert.deepEqual(now, legacy, `${v} on ${date}`);
    }
  }
});

test('seed: reels are Trial, explainers Main, everything else has no feed_mode, and every day validates', () => {
  const tpl = seedTemplate(DEFAULT_SEED_INPUTS);
  for (const r of tpl) {
    if (r.vertical === 'reels') assert.equal(r.feedMode, 'trial');
    else if (r.vertical === 'explainers') assert.equal(r.feedMode, 'main');
    else assert.equal(r.feedMode, null);
  }
  for (const date of WEEK) assert.deepEqual(validateDay(resolveDay(tpl, [], date)), [], date);
});

test('seed follows custom LFD and Stories days', () => {
  const tpl = seedTemplate({ lfdDays: [3], storyDays: { morning_download: [1], guess_the_number: [], free_vs_paid: [0] } });
  const wed = resolveDay(tpl, [], '2026-10-21');
  assert.ok(wed.some((s) => s.vertical === 'last_few_days'));
  assert.ok(!wed.some((s) => s.vertical === 'carousels'));
  assert.deepEqual(resolveDay(tpl, [], '2026-10-19').filter((s) => s.vertical === 'stories').map((s) => s.windowId), ['morning_download']);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx tsx --test tests/slots-resolve.test.ts`
Expected: FAIL (cannot find module `@/lib/social-hub/slots/resolve`).

- [ ] **Step 3: Write `types.ts`**

```ts
// lib/social-hub/slots/types.ts
import type { Vertical } from '@/lib/social-hub/types';

/**
 * The weekly slot calendar's shapes (docs/superpowers/specs/2026-10-14-weekly-slot-calendar-design.md).
 * A slot is a content type in one of its own windows (PLAN) on a New York date.
 */

export type FeedMode = 'trial' | 'main';

export type TemplateRow = { weekday: number; vertical: Vertical; windowId: string; feedMode: FeedMode | null };

export type OverrideRow = { nyDate: string; vertical: Vertical; windowId: string; action: 'add' | 'remove'; feedMode: FeedMode | null };

export type ResolvedSlot = {
  vertical: Vertical;
  windowId: string;
  feedMode: FeedMode | null;
  startMinute: number;
  endMinute: number;
  origin: 'template' | 'override';
};

/** Who decides cadence: each type's own settings (as before) or the calendar. */
export type SlotSource = 'legacy' | 'template';

/** Any handle that runs SQL (HubQuery, SpineQuery, the social store's Query, Queryable.query bound). */
export type SlotQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/** Only reels can be trial reels on Instagram: Text on Screen and Explainers. */
export const REEL_TYPES: readonly Vertical[] = ['reels', 'explainers'];

export const isReelType = (v: Vertical): boolean => REEL_TYPES.includes(v);
```

- [ ] **Step 4: Write `resolve.ts`**

```ts
// lib/social-hub/slots/resolve.ts
import { weekdayOf } from '@/lib/social-hub/time';
import { verticalInfo } from '@/lib/social-hub/verticals';
import { PLAN } from '@/lib/social-hub/views/plan';

import { isReelType, type OverrideRow, type ResolvedSlot, type TemplateRow } from './types';

/**
 * What runs on a New York date: that weekday's template rows, then that
 * date's overrides (remove drops a key; add inserts it or replaces it).
 * Window times come from PLAN, the hub's one copy of them. Pure.
 */
export function resolveDay(template: readonly TemplateRow[], overrides: readonly OverrideRow[], nyDate: string): ResolvedSlot[] {
  const weekday = weekdayOf(nyDate);
  const byKey = new Map<string, Omit<ResolvedSlot, 'startMinute' | 'endMinute'>>();
  for (const r of template) {
    if (r.weekday !== weekday) continue;
    byKey.set(`${r.vertical}|${r.windowId}`, { vertical: r.vertical, windowId: r.windowId, feedMode: r.feedMode, origin: 'template' });
  }
  for (const o of overrides) {
    if (o.nyDate !== nyDate) continue;
    const key = `${o.vertical}|${o.windowId}`;
    if (o.action === 'remove') byKey.delete(key);
    else byKey.set(key, { vertical: o.vertical, windowId: o.windowId, feedMode: o.feedMode, origin: 'override' });
  }
  const out: ResolvedSlot[] = [];
  for (const s of byKey.values()) {
    const w = PLAN[s.vertical].find((p) => p.id === s.windowId);
    if (!w) continue; // a window the code no longer has: not a slot
    out.push({ ...s, startMinute: w.startMinute, endMinute: w.endMinute });
  }
  return out.sort((a, b) => a.startMinute - b.startMinute || a.vertical.localeCompare(b.vertical));
}

export const LFD_CAROUSEL_CONFLICT = 'Last Few Days runs the 3 AM job that day. Carousels are off.';

/** Why a day's slots can't stand, in plain sentences; empty when they can. */
export function validateDay(slots: readonly ResolvedSlot[]): string[] {
  const errors: string[] = [];
  if (slots.some((s) => s.vertical === 'last_few_days') && slots.some((s) => s.vertical === 'carousels')) errors.push(LFD_CAROUSEL_CONFLICT);
  for (const s of slots) {
    const label = verticalInfo(s.vertical).label;
    if (isReelType(s.vertical) && !s.feedMode) errors.push(`${label} (${s.windowId}) needs Trial or Main feed.`);
    if (!isReelType(s.vertical) && s.feedMode) errors.push(`${label} posts aren’t reels, so they have no Trial or Main feed.`);
  }
  return errors;
}
```

- [ ] **Step 5: Write the pure part of `seed.ts`**

```ts
// lib/social-hub/slots/seed.ts
import { PLAN } from '@/lib/social-hub/views/plan';

import type { TemplateRow } from './types';

/**
 * The template that behaves exactly like today (spec §1 Seed): every-day
 * windows from PLAN, Carousels on every day but Last Few Days', LFD's one
 * window on its days, each Stories series on its days. Reels Trial,
 * Explainers Main. tests/slots-resolve.test.ts pins it to windowsOn.
 */
export type StorySeries = 'morning_download' | 'guess_the_number' | 'free_vs_paid';
export type SeedInputs = { lfdDays: readonly number[]; storyDays: Record<StorySeries, readonly number[]> };

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;

/** Today's defaults (lib/lfd/config.ts DEFAULT_LFD_DAYS, lib/stories/settings.ts DEFAULT_SETTINGS via PLAN). */
export const DEFAULT_SEED_INPUTS: SeedInputs = {
  lfdDays: PLAN.last_few_days[0]!.days ?? [2, 5],
  storyDays: {
    morning_download: PLAN.stories.find((w) => w.id === 'morning_download')!.days ?? EVERY_DAY,
    guess_the_number: PLAN.stories.find((w) => w.id === 'guess_the_number')!.days ?? EVERY_DAY,
    free_vs_paid: PLAN.stories.find((w) => w.id === 'free_vs_paid')!.days ?? EVERY_DAY,
  },
};

export function seedTemplate(input: SeedInputs): TemplateRow[] {
  const rows: TemplateRow[] = [];
  for (const weekday of EVERY_DAY) {
    for (const w of PLAN.reels) rows.push({ weekday, vertical: 'reels', windowId: w.id, feedMode: 'trial' });
    for (const w of PLAN.explainers) rows.push({ weekday, vertical: 'explainers', windowId: w.id, feedMode: 'main' });
    if (input.lfdDays.includes(weekday)) {
      rows.push({ weekday, vertical: 'last_few_days', windowId: PLAN.last_few_days[0]!.id, feedMode: null });
    } else {
      for (const w of PLAN.carousels) rows.push({ weekday, vertical: 'carousels', windowId: w.id, feedMode: null });
    }
    for (const series of Object.keys(input.storyDays) as StorySeries[]) {
      if (input.storyDays[series].includes(weekday)) rows.push({ weekday, vertical: 'stories', windowId: series, feedMode: null });
    }
  }
  return rows;
}
```

- [ ] **Step 6: Run the tests**

Run: `npx tsx --test tests/slots-resolve.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add lib/social-hub/slots/types.ts lib/social-hub/slots/resolve.ts lib/social-hub/slots/seed.ts tests/slots-resolve.test.ts
git commit -m "feat(slots): pure day resolver, validation and the today-parity seed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Loader and the scheduler seam (SELECT-only)

**Files:**
- Create: `lib/social-hub/slots/load.ts`, `lib/social-hub/slots/index.ts`
- Modify: `lib/social-hub/slots/seed.ts` (add `readSeedInputs`)
- Test: `tests/slots-load.test.ts`

**Interfaces:**
- Consumes: Task 2 types, `resolveDay`, `addCalendarDays` (`lib/instagram/window.ts`), `SERIES` defaults via `PLAN`.
- Produces:
  - `readSlotSource(q: SlotQuery): Promise<SlotSource>` (any error → `'legacy'`)
  - `readTemplate(q): Promise<TemplateRow[]>`
  - `readOverrides(q, from: string, to: string): Promise<OverrideRow[]>`
  - `loadSlots(q, from: string, to: string): Promise<Map<string, ResolvedSlot[]>>` (inclusive)
  - `type SlotPlan = { from: string; to: string; byDate: ReadonlyMap<string, ResolvedSlot[]> }`
  - `slotPlan(q, from: string, days?: number): Promise<SlotPlan | null>` (null while legacy, default 14 days)
  - `slotsOn(plan: SlotPlan, vertical: Vertical, nyDate: string): ResolvedSlot[]`
  - `nonSlotKeys(plan, vertical, windowIds: readonly string[], key: (nyDate: string, windowId: string) => string): Set<string>`
  - `feedModeKeys(plan, vertical, key): { trial: Set<string>; main: Set<string> }`
  - `isLfdDay(plan: SlotPlan, nyDate: string): boolean`
  - `legacyFeedMode(vertical: Vertical): FeedMode | null` (reels → 'trial', explainers → 'main', else null)
  - `feedModeFor(q, vertical, nyDate, windowId): Promise<FeedMode | null>`: template: the slot's (falling back to legacy when no slot); legacy: `legacyFeedMode`
  - `bookingFeedMode(q, itemId: string | null, vertical: Vertical, ideaRef?: string | null): Promise<FeedMode>` (only for reel types): the waiting/posting booking's `feed_mode`, else legacy
  - `readSeedInputs(q): Promise<SeedInputs>` (lfd.settings days, stories.settings series days; defaults on any error)

- [ ] **Step 1: Write the failing test**

```ts
// tests/slots-load.test.ts
/** Loading slots and the scheduler seam (spec §5). Offline PGlite. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { bookingFeedMode, feedModeFor, feedModeKeys, isLfdDay, nonSlotKeys, slotPlan, slotsOn } from '@/lib/social-hub/slots';
import { loadSlots, readSlotSource } from '@/lib/social-hub/slots/load';
import { readSeedInputs, seedTemplate, DEFAULT_SEED_INPUTS } from '@/lib/social-hub/slots/seed';
import { slotTakenKey } from '@/lib/instagram/window';

import { openHubTestDb } from './fixtures/social-hub/pglite';

async function db(source: 'legacy' | 'template') {
  const { pg, query } = await openHubTestDb();
  await pg.query(`UPDATE social_hub.settings SET value = $1::jsonb WHERE key = 'slot_source'`, [JSON.stringify(source)]);
  for (const r of seedTemplate(DEFAULT_SEED_INPUTS)) {
    await pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode) VALUES ($1, $2, $3, $4)`, [r.weekday, r.vertical, r.windowId, r.feedMode]);
  }
  return { pg, q: query as never };
}

test('legacy (the seeded default) gives no plan: callers keep their own code', async () => {
  const { q } = await db('legacy');
  assert.equal(await readSlotSource(q), 'legacy');
  assert.equal(await slotPlan(q, '2026-10-19'), null);
});

test('an unreadable source reads as legacy (Review Focus 1)', async () => {
  const broken = async () => { throw new Error('relation "social_hub.settings" does not exist'); };
  assert.equal(await readSlotSource(broken as never), 'legacy');
  assert.equal(await slotPlan(broken as never, '2026-10-19'), null);
});

test('template: a plan covers 14 days and applies overrides', async () => {
  const { pg, q } = await db('template');
  await pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, window_id, action, feed_mode) VALUES ('2026-10-20', 'reels', 'morning', 'add', 'main')`);
  const plan = (await slotPlan(q, '2026-10-19'))!;
  assert.equal(plan.byDate.size, 14);
  assert.equal(slotsOn(plan, 'reels', '2026-10-20').find((s) => s.windowId === 'morning')!.feedMode, 'main');
  assert.equal(isLfdDay(plan, '2026-10-20'), true);  // Tuesday
  assert.equal(isLfdDay(plan, '2026-10-21'), false);
  const off = nonSlotKeys(plan, 'carousels', ['morning', 'afternoon'], slotTakenKey);
  assert.ok(off.has('2026-10-20|morning') && off.has('2026-10-23|afternoon'));
  assert.ok(!off.has('2026-10-21|morning'));
  const modes = feedModeKeys(plan, 'reels', slotTakenKey);
  assert.ok(modes.main.has('2026-10-20|morning') && modes.trial.has('2026-10-21|morning'));
  const loaded = await loadSlots(q, '2026-10-19', '2026-10-25');
  assert.equal(loaded.size, 7);
});

test('feedModeFor and bookingFeedMode fall back to each type\'s old behavior (Review Focus 3)', async () => {
  const { pg, q } = await db('template');
  assert.equal(await feedModeFor(q, 'reels', '2026-10-21', 'morning'), 'trial');
  assert.equal(await feedModeFor(q, 'carousels', '2026-10-21', 'morning'), null);
  // No booking at all (a force post): legacy.
  assert.equal(await bookingFeedMode(q, null, 'explainers'), 'main');
  assert.equal(await bookingFeedMode(q, null, 'reels', 'idea-1'), 'trial');
  // A booking that says main wins.
  const item = await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('explainers', 'reel', 'job-1') RETURNING id`);
  await pg.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, feed_mode)
     VALUES ($1, 'explainers', '2026-10-21', 'late', '2026-10-21T20:00:00Z', 'scheduled', 'auto', 'trial')`,
    [item.rows[0]!.id],
  );
  assert.equal(await bookingFeedMode(q, item.rows[0]!.id, 'explainers'), 'trial');
});

test('readSeedInputs reads LFD and Stories days, defaults on missing rows', async () => {
  const { pg, q } = await db('legacy');
  assert.deepEqual(await readSeedInputs(q), DEFAULT_SEED_INPUTS);
  await pg.query(`INSERT INTO lfd.settings (key, value) VALUES ('days', '[3]'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  await pg.query(`INSERT INTO stories.settings (key, value) VALUES ('series', '{"free_vs_paid":{"window":{"days":[0]}}}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  const got = await readSeedInputs(q);
  assert.deepEqual(got.lfdDays, [3]);
  assert.deepEqual(got.storyDays.free_vs_paid, [0]);
  assert.deepEqual(got.storyDays.guess_the_number, DEFAULT_SEED_INPUTS.storyDays.guess_the_number);
});
```

Note for the implementer: check `social_hub.content_items`' NOT NULL columns in `db/social_hub_schema.sql` (around line 130) and add whatever the INSERT above is missing. Check how `lfd.settings` and `stories.settings` are keyed (`db/lfd_schema.sql`, `db/stories_schema.sql`) and adjust the two INSERTs to match.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx tsx --test tests/slots-load.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `load.ts`**

```ts
// lib/social-hub/slots/load.ts
import { addCalendarDays } from '@/lib/instagram/window';

import { resolveDay } from './resolve';
import type { OverrideRow, ResolvedSlot, SlotQuery, SlotSource, TemplateRow } from './types';

/** SELECT only (tests/social-hub-scope.test.ts): hub read code and every worker may use it. */

/** 'template' only when the row says so; anything unreadable is 'legacy', the old behavior. */
export async function readSlotSource(q: SlotQuery): Promise<SlotSource> {
  try {
    const { rows } = await q(`SELECT value FROM social_hub.settings WHERE key = 'slot_source'`);
    return rows[0]?.value === 'template' ? 'template' : 'legacy';
  } catch {
    return 'legacy';
  }
}

export async function readTemplate(q: SlotQuery): Promise<TemplateRow[]> {
  const { rows } = await q(`SELECT weekday, vertical, window_id, feed_mode FROM social_hub.slot_template`);
  return rows.map((r) => ({ weekday: Number(r.weekday), vertical: r.vertical, windowId: r.window_id, feedMode: r.feed_mode ?? null }));
}

export async function readOverrides(q: SlotQuery, from: string, to: string): Promise<OverrideRow[]> {
  const { rows } = await q(
    `SELECT ny_date::text AS ny_date, vertical, window_id, action, feed_mode FROM social_hub.slot_override
      WHERE ny_date BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  return rows.map((r) => ({ nyDate: String(r.ny_date).slice(0, 10), vertical: r.vertical, windowId: r.window_id, action: r.action, feedMode: r.feed_mode ?? null }));
}

/** Resolved slots for every date from `from` through `to` (inclusive). */
export async function loadSlots(q: SlotQuery, from: string, to: string): Promise<Map<string, ResolvedSlot[]>> {
  const [template, overrides] = await Promise.all([readTemplate(q), readOverrides(q, from, to)]);
  const out = new Map<string, ResolvedSlot[]>();
  for (let d = from; d <= to; d = addCalendarDays(d, 1)) out.set(d, resolveDay(template, overrides, d));
  return out;
}
```

- [ ] **Step 4: Write `index.ts` (the seam)**

```ts
// lib/social-hub/slots/index.ts
import { addCalendarDays } from '@/lib/instagram/window';
import type { Vertical } from '@/lib/social-hub/types';

import { loadSlots, readSlotSource } from './load';
import type { FeedMode, ResolvedSlot, SlotQuery } from './types';

/**
 * The one question every scheduler and hub view asks (spec §5): which of a
 * type's windows are slots on these dates? Null while slot_source is
 * 'legacy': the caller then runs its own code exactly as before, so legacy
 * mode is today's code, not a copy of it. SELECT only.
 */

export type SlotPlan = { from: string; to: string; byDate: ReadonlyMap<string, ResolvedSlot[]> };

/** The schedulers look two weeks ahead (PLACEMENT_DAYS_AHEAD + 1). */
export const PLAN_DAYS = 14;

export async function slotPlan(q: SlotQuery, from: string, days = PLAN_DAYS): Promise<SlotPlan | null> {
  if ((await readSlotSource(q)) !== 'template') return null;
  const to = addCalendarDays(from, days - 1);
  return { from, to, byDate: await loadSlots(q, from, to) };
}

export function slotsOn(plan: SlotPlan, vertical: Vertical, nyDate: string): ResolvedSlot[] {
  return (plan.byDate.get(nyDate) ?? []).filter((s) => s.vertical === vertical);
}

/** Keys (in the caller's own key format) for every window of `vertical` that is NOT a slot, on every date in the plan. */
export function nonSlotKeys(plan: SlotPlan, vertical: Vertical, windowIds: readonly string[], key: (nyDate: string, windowId: string) => string): Set<string> {
  const out = new Set<string>();
  for (const [date, slots] of plan.byDate) {
    const on = new Set(slots.filter((s) => s.vertical === vertical).map((s) => s.windowId));
    for (const id of windowIds) if (!on.has(id)) out.add(key(date, id));
  }
  return out;
}

/** A reel type's slots split by Trial / Main, in the caller's key format. */
export function feedModeKeys(plan: SlotPlan, vertical: Vertical, key: (nyDate: string, windowId: string) => string): { trial: Set<string>; main: Set<string> } {
  const trial = new Set<string>();
  const main = new Set<string>();
  for (const [date, slots] of plan.byDate) {
    for (const s of slots) if (s.vertical === vertical) (s.feedMode === 'main' ? main : trial).add(key(date, s.windowId));
  }
  return { trial, main };
}

/** Decision 7 (literal): a day with a Last Few Days slot is carousel-off, paused or not. */
export function isLfdDay(plan: SlotPlan, nyDate: string): boolean {
  return (plan.byDate.get(nyDate) ?? []).some((s) => s.vertical === 'last_few_days');
}

/** Before the calendar: Text on Screen posts as trial reels, Explainers to the main feed. */
export function legacyFeedMode(vertical: Vertical): FeedMode | null {
  return vertical === 'reels' ? 'trial' : vertical === 'explainers' ? 'main' : null;
}

/** The feed mode a new booking in (nyDate, windowId) takes. */
export async function feedModeFor(q: SlotQuery, vertical: Vertical, nyDate: string, windowId: string): Promise<FeedMode | null> {
  if (vertical !== 'reels' && vertical !== 'explainers') return null;
  const plan = await slotPlan(q, nyDate, 1);
  const slot = plan ? slotsOn(plan, vertical, nyDate).find((s) => s.windowId === windowId) : null;
  return slot?.feedMode ?? legacyFeedMode(vertical);
}

/**
 * The feed mode an item posts with: its waiting or posting booking's, else
 * the type's old behavior (a force post with no slot, a booking from before
 * the column). Reel types only.
 */
export async function bookingFeedMode(q: SlotQuery, itemId: string | null, vertical: 'reels' | 'explainers', ideaRef: string | null = null): Promise<FeedMode> {
  try {
    const { rows } = await q(
      `SELECT feed_mode FROM social_hub.schedule
        WHERE vertical = $1 AND status IN ('scheduled', 'publishing') AND feed_mode IS NOT NULL
          AND (content_item_id = $2::uuid OR ($3::text IS NOT NULL AND idea_ref = $3::text))
        ORDER BY publish_at LIMIT 1`,
      [vertical, itemId, ideaRef],
    );
    const mode = rows[0]?.feed_mode;
    if (mode === 'trial' || mode === 'main') return mode;
  } catch {
    // No feed_mode column yet: the old behavior.
  }
  return legacyFeedMode(vertical)!;
}
```

- [ ] **Step 5: Add `readSeedInputs` to `seed.ts`**

Append to `lib/social-hub/slots/seed.ts`:

```ts
import type { SlotQuery } from './types';

const isDays = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);

/** Today's LFD days and Stories series days, read the way their own loaders read them; defaults on any error. SELECT only. */
export async function readSeedInputs(q: SlotQuery): Promise<SeedInputs> {
  const out: SeedInputs = { lfdDays: [...DEFAULT_SEED_INPUTS.lfdDays], storyDays: { ...DEFAULT_SEED_INPUTS.storyDays } };
  try {
    const { rows } = await q(`SELECT value FROM lfd.settings WHERE key = 'days'`);
    if (isDays(rows[0]?.value)) out.lfdDays = [...new Set(rows[0].value as number[])].sort((a, b) => a - b);
  } catch { /* no lfd schema on this handle */ }
  try {
    const { rows } = await q(`SELECT value FROM stories.settings WHERE key = 'series'`);
    const series = rows[0]?.value as Partial<Record<StorySeries, { window?: { days?: unknown } }>> | undefined;
    for (const s of Object.keys(out.storyDays) as StorySeries[]) {
      const days = series?.[s]?.window?.days;
      if (isDays(days)) out.storyDays[s] = days;
    }
  } catch { /* no stories schema on this handle */ }
  return out;
}
```

(Move the `import type { SlotQuery }` to the top of the file with the other imports.)

- [ ] **Step 6: Run the tests**

Run: `npx tsx --test tests/slots-load.test.ts tests/slots-resolve.test.ts tests/social-hub-scope.test.ts`
Expected: PASS. The scope test must stay green, since these files only SELECT.

- [ ] **Step 7: Commit**

```bash
git add lib/social-hub/slots tests/slots-load.test.ts
git commit -m "feat(slots): loader and the select-only scheduler seam (null while legacy)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Writes: `applySlotChanges`, the slots API, and the source switch

**Files:**
- Create: `lib/social-hub/slots/write.ts`, `app/api/social-hub/slots/route.ts`, `app/api/social-hub/slots/source/route.ts`
- Modify: `lib/social-hub/flags.ts` (add `editSlots` action flag, `calendarWeek` view flag), `tests/social-hub-scope.test.ts` (INTENDED gets `editSlots: true`)
- Test: `tests/slots-write.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3 (`readTemplate`, `readOverrides`, `resolveDay`, `validateDay`, `seedTemplate`, `readSeedInputs`), `dbTransaction` (`lib/db.ts`), `getSession` (`lib/session.ts`), `nyDateOf` (`lib/social-hub/time.ts`), `PLAN`.
- Produces:
  - `type SlotChange =`
    - `| { scope: 'template'; op: 'put'; weekday: number; vertical: Vertical; windowId: string; feedMode: FeedMode | null }`
    - `| { scope: 'template'; op: 'delete'; weekday: number; vertical: Vertical; windowId: string }`
    - `| { scope: 'date'; op: 'put'; nyDate: string; vertical: Vertical; windowId: string; action: 'add' | 'remove'; feedMode: FeedMode | null }`
    - `| { scope: 'date'; op: 'delete'; nyDate: string; vertical: Vertical; windowId: string }`
  - `type BookedPost = { scheduleId: string; vertical: Vertical; nyDate: string; windowId: string; feedMode: FeedMode | null; publishAt: string; refs: Record<string, string> }`
  - `type ApplyResult = { ok: true } | { ok: false; status: 400 | 422; errors: string[] } | { ok: false; status: 409; booked: BookedPost[] }`
  - `parseChanges(body: unknown): SlotChange[] | string` (string = 400 message)
  - `applySlotChanges(q: SlotQuery, changes: readonly SlotChange[], opts: { by: string; now: Date; keepBooked: boolean }): Promise<ApplyResult>`
  - `setSlotSource(q: SlotQuery, source: SlotSource, by: string): Promise<{ seeded: number }>`
  - Route `GET /api/social-hub/slots?from&to` → `{ source, days: Record<nyDate, ResolvedSlot[]> }`
  - Route `POST /api/social-hub/slots` body `{ changes: SlotChange[], keepBooked?: boolean }` → 200 `{ ok: true }` / 400 / 422 `{ errors }` / 409 `{ booked }`
  - Route `POST /api/social-hub/slots/source` body `{ source: 'legacy' | 'template' }` → `{ source, seeded }`

**How "move back to ready" works (spec §4, simplified):** the server never unschedules. A 409 lists the booked posts *with their action refs*. The client calls the existing unschedule action route (`POST /api/social-hub/actions/unschedule`, body `{ vertical, refs }`) for each, then re-sends the same changes. With nothing booked in the way, the save goes through. "Keep it" re-sends with `keepBooked: true`. This reuses the unschedule path exactly as the spec asks, without a second server-side copy of it.

**Refs per type** (from `lib/publishing/actions/*.ts`, each `unschedule` verb's `need(t, …)`): carousels `{ postId }`, explainers `{ jobId }`, last_few_days `{ lfdPostId }`, stories `{ setId }`, reels `{ postIdeaId }`. The booking's `content_items.native_ref` holds the first four; reels use `schedule.idea_ref`. **Before writing `refsOf`, confirm this** by reading each type's `*ItemId` helper (`lib/social/overnight/items.ts`, `lib/explainers/publish/items.ts`, `lib/lfd/items.ts`, the stories item helper, `lib/reels/publish/items.ts`) and how it calls `ensureContentItem`. If any type stores something else in `native_ref`, map it here and add a case to the test.

- [ ] **Step 1: Write the failing test**

```ts
// tests/slots-write.test.ts
/** Slot writes (spec §4): validation, booked-post 409s, keep, seeding on the first flip. Offline PGlite. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { applySlotChanges, parseChanges, setSlotSource } from '@/lib/social-hub/slots/write';
import { readTemplate } from '@/lib/social-hub/slots/load';
import { LFD_CAROUSEL_CONFLICT } from '@/lib/social-hub/slots/resolve';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const NOW = new Date('2026-10-15T14:00:00Z'); // Thu Oct 15, 10:00 AM New York

async function seeded() {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 'tommy@example.com');
  return { pg, q };
}

async function book(pg: Awaited<ReturnType<typeof openHubTestDb>>['pg'], vertical: string, nyDate: string, slot: string, feedMode: string | null, nativeRef: string) {
  const format = vertical === 'stories' ? 'story' : vertical === 'carousels' || vertical === 'last_few_days' ? 'feed' : 'reel';
  const item = await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ($1, $2, $3) RETURNING id`, [vertical, format, nativeRef]);
  await pg.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, feed_mode)
     VALUES ($1, $2, $3::date, $4, ($3 || 'T14:00:00Z')::timestamptz, 'scheduled', 'auto', $5)`,
    [item.rows[0]!.id, vertical, nyDate, slot, feedMode],
  );
}

test('the first flip to template seeds from current settings; later flips do not reseed', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  const first = await setSlotSource(q, 'template', 'tommy@example.com');
  assert.ok(first.seeded > 0);
  const n = (await readTemplate(q)).length;
  await pg.query(`DELETE FROM social_hub.slot_template WHERE vertical = 'reels' AND weekday = 0`);
  await setSlotSource(q, 'legacy', 'tommy@example.com');
  assert.equal((await setSlotSource(q, 'template', 'tommy@example.com')).seeded, 0);
  assert.equal((await readTemplate(q)).length, n - 3);
});

test('a template put validates the weekday: Carousel on an LFD day is refused', async () => {
  const { q } = await seeded();
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'put', weekday: 2, vertical: 'carousels', windowId: 'morning', feedMode: null }], { by: 't', now: NOW, keepBooked: false });
  assert.deepEqual(out, { ok: false, status: 422, errors: [LFD_CAROUSEL_CONFLICT] });
});

test('LFD on Wednesday plus removing that day\'s Carousels in one request is accepted', async () => {
  const { q } = await seeded();
  const out = await applySlotChanges(q, [
    { scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'last_few_days', windowId: 'morning', action: 'add', feedMode: null },
    { scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'carousels', windowId: 'morning', action: 'remove', feedMode: null },
    { scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'carousels', windowId: 'afternoon', action: 'remove', feedMode: null },
  ], { by: 't', now: NOW, keepBooked: false });
  assert.deepEqual(out, { ok: true });
});

test('a template edit that breaks a future override date is refused', async () => {
  const { q } = await seeded();
  await applySlotChanges(q, [
    { scope: 'date', op: 'put', nyDate: '2026-10-28', vertical: 'last_few_days', windowId: 'morning', action: 'add', feedMode: null },
    { scope: 'date', op: 'put', nyDate: '2026-10-28', vertical: 'carousels', windowId: 'morning', action: 'remove', feedMode: null },
    { scope: 'date', op: 'put', nyDate: '2026-10-28', vertical: 'carousels', windowId: 'afternoon', action: 'remove', feedMode: null },
  ], { by: 't', now: NOW, keepBooked: false });
  // Deleting the override that removed Oct 28's morning Carousel brings it back on an LFD day: refused.
  const out = await applySlotChanges(q, [{ scope: 'date', op: 'delete', nyDate: '2026-10-28', vertical: 'carousels', windowId: 'morning' }], { by: 't', now: NOW, keepBooked: false });
  assert.equal(out.ok, false);
});

test('removing a slot with a booked post 13 days out returns 409 with its refs (Review Focus 2)', async () => {
  const { pg, q } = await seeded();
  await book(pg, 'carousels', '2026-10-28', 'afternoon', null, '11111111-1111-1111-1111-111111111111');
  const change = [{ scope: 'template' as const, op: 'delete' as const, weekday: 3, vertical: 'carousels' as const, windowId: 'afternoon' }];
  const out = await applySlotChanges(q, change, { by: 't', now: NOW, keepBooked: false });
  assert.equal(out.ok, false);
  assert.equal((out as { status: number }).status, 409);
  const booked = (out as { booked: Array<{ nyDate: string; refs: Record<string, string> }> }).booked;
  assert.deepEqual(booked.map((b) => [b.nyDate, b.refs]), [['2026-10-28', { postId: '11111111-1111-1111-1111-111111111111' }]]);
  // Keep it: the template changes, the booking stays.
  assert.deepEqual(await applySlotChanges(q, change, { by: 't', now: NOW, keepBooked: true }), { ok: true });
  const left = await pg.query(`SELECT status FROM social_hub.schedule WHERE vertical = 'carousels'`);
  assert.equal(left.rows[0]!.status, 'scheduled');
});

test('flipping Trial to Main asks about a booked reel; a carousel edit elsewhere does not', async () => {
  const { pg, q } = await seeded();
  await book(pg, 'explainers', '2026-10-20', 'afternoon', 'main', '22222222-2222-2222-2222-222222222222');
  const flip = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'explainers', windowId: 'afternoon', action: 'add', feedMode: 'trial' }], { by: 't', now: NOW, keepBooked: false });
  assert.equal((flip as { status: number }).status, 409);
  const other = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'explainers', windowId: 'late', action: 'add', feedMode: 'trial' }], { by: 't', now: NOW, keepBooked: false });
  assert.deepEqual(other, { ok: true });
});

test('past dates and windows already started today are read-only (Review Focus 4)', async () => {
  const { q } = await seeded();
  const past = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-14', vertical: 'reels', windowId: 'evening', action: 'remove', feedMode: null }], { by: 't', now: NOW, keepBooked: false });
  assert.equal((past as { status: number }).status, 422);
  // 10:00 AM: the reels morning window (8:45) has started; evening hasn't.
  const started = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-15', vertical: 'reels', windowId: 'morning', action: 'remove', feedMode: null }], { by: 't', now: NOW, keepBooked: false });
  assert.equal((started as { status: number }).status, 422);
  const later = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-15', vertical: 'reels', windowId: 'evening', action: 'remove', feedMode: null }], { by: 't', now: NOW, keepBooked: false });
  assert.deepEqual(later, { ok: true });
});

test('parseChanges rejects junk with a 400 message', () => {
  assert.equal(typeof parseChanges({ changes: [{ scope: 'template', op: 'put', weekday: 9, vertical: 'reels', windowId: 'morning', feedMode: 'trial' }] }), 'string');
  assert.equal(typeof parseChanges({ changes: [{ scope: 'date', op: 'put', nyDate: 'tomorrow', vertical: 'reels', windowId: 'morning', action: 'add', feedMode: 'trial' }] }), 'string');
  assert.equal(typeof parseChanges({ changes: [] }), 'string');
  assert.ok(Array.isArray(parseChanges({ changes: [{ scope: 'template', op: 'delete', weekday: 1, vertical: 'stories', windowId: 'guess_the_number' }] })));
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx tsx --test tests/slots-write.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `write.ts`**

```ts
// lib/social-hub/slots/write.ts
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import { addCalendarDays, windowMinuteInstant } from '@/lib/instagram/window';
import { isDayKey, weekdayOf } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';
import { isVertical } from '@/lib/social-hub/verticals';
import { PLAN } from '@/lib/social-hub/views/plan';

import { readOverrides, readTemplate } from './load';
import { resolveDay, validateDay } from './resolve';
import { readSeedInputs, seedTemplate } from './seed';
import type { FeedMode, OverrideRow, ResolvedSlot, SlotQuery, SlotSource, TemplateRow } from './types';

/**
 * The calendar's writes (spec §4). Writes only social_hub.slot_template,
 * social_hub.slot_override and social_hub.settings. Never unschedules: a
 * booked post in the way comes back as a 409 with its action refs, and the
 * client uses the existing unschedule action (or says keep).
 */

export type SlotChange =
  | { scope: 'template'; op: 'put'; weekday: number; vertical: Vertical; windowId: string; feedMode: FeedMode | null }
  | { scope: 'template'; op: 'delete'; weekday: number; vertical: Vertical; windowId: string }
  | { scope: 'date'; op: 'put'; nyDate: string; vertical: Vertical; windowId: string; action: 'add' | 'remove'; feedMode: FeedMode | null }
  | { scope: 'date'; op: 'delete'; nyDate: string; vertical: Vertical; windowId: string };

export type BookedPost = { scheduleId: string; vertical: Vertical; nyDate: string; windowId: string; feedMode: FeedMode | null; publishAt: string; refs: Record<string, string> };

export type ApplyResult = { ok: true } | { ok: false; status: 400 | 422; errors: string[] } | { ok: false; status: 409; booked: BookedPost[] };

const MAX_CHANGES = 20;
const hasWindow = (v: Vertical, id: unknown) => typeof id === 'string' && PLAN[v].some((w) => w.id === id);
const isMode = (m: unknown): m is FeedMode | null => m === null || m === 'trial' || m === 'main';

export function parseChanges(body: unknown): SlotChange[] | string {
  const list = (body as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_CHANGES) return `Send 1 to ${MAX_CHANGES} changes.`;
  const out: SlotChange[] = [];
  for (const c of list as Array<Record<string, unknown>>) {
    if (!isVertical(c.vertical) || !hasWindow(c.vertical, c.windowId)) return 'Pick a content type and one of its windows.';
    const base = { vertical: c.vertical, windowId: c.windowId as string };
    if (c.scope === 'template') {
      if (!Number.isInteger(c.weekday) || (c.weekday as number) < 0 || (c.weekday as number) > 6) return 'Pick a weekday.';
      if (c.op === 'delete') out.push({ scope: 'template', op: 'delete', weekday: c.weekday as number, ...base });
      else if (c.op === 'put' && isMode(c.feedMode)) out.push({ scope: 'template', op: 'put', weekday: c.weekday as number, ...base, feedMode: c.feedMode });
      else return 'Unknown template change.';
    } else if (c.scope === 'date') {
      if (!isDayKey(c.nyDate)) return 'Pick a day as YYYY-MM-DD.';
      if (c.op === 'delete') out.push({ scope: 'date', op: 'delete', nyDate: c.nyDate, ...base });
      else if (c.op === 'put' && (c.action === 'add' || c.action === 'remove') && isMode(c.feedMode)) out.push({ scope: 'date', op: 'put', nyDate: c.nyDate, ...base, action: c.action, feedMode: c.action === 'remove' ? null : c.feedMode });
      else return 'Unknown date change.';
    } else return 'Each change is for the template or for a date.';
  }
  return out;
}

const keyOf = (v: string, w: string) => `${v}|${w}`;

/** Apply changes to in-memory copies, so validation sees the result before anything is written. */
function applyInMemory(template: TemplateRow[], overrides: OverrideRow[], changes: readonly SlotChange[]): { template: TemplateRow[]; overrides: OverrideRow[] } {
  let t = [...template];
  let o = [...overrides];
  for (const c of changes) {
    if (c.scope === 'template') {
      t = t.filter((r) => !(r.weekday === c.weekday && keyOf(r.vertical, r.windowId) === keyOf(c.vertical, c.windowId)));
      if (c.op === 'put') t.push({ weekday: c.weekday, vertical: c.vertical, windowId: c.windowId, feedMode: c.feedMode });
    } else {
      o = o.filter((r) => !(r.nyDate === c.nyDate && keyOf(r.vertical, r.windowId) === keyOf(c.vertical, c.windowId)));
      if (c.op === 'put') o.push({ nyDate: c.nyDate, vertical: c.vertical, windowId: c.windowId, action: c.action, feedMode: c.feedMode });
    }
  }
  return { template: t, overrides: o };
}

/** A window that has begun (or a past day) can't be edited: something may already be posting. */
function startedNote(c: SlotChange, today: string, now: Date): string | null {
  if (c.scope !== 'date') return null;
  if (c.nyDate < today) return 'That day has passed.';
  if (c.nyDate > today) return null;
  const w = PLAN[c.vertical].find((p) => p.id === c.windowId)!;
  return windowMinuteInstant({ ...w, label: w.label }, c.nyDate, 0).getTime() <= now.getTime() ? `Today’s ${w.label.toLowerCase()} window has started, so it can’t change now.` : null;
}

/** The dates whose slots this change set can move: every override date ahead, plus the next two weeks (bookings live there). */
function affectedDates(today: string, overrides: readonly OverrideRow[], changes: readonly SlotChange[]): string[] {
  const out = new Set<string>();
  for (let i = 0; i < 14; i += 1) out.add(addCalendarDays(today, i));
  for (const o of overrides) if (o.nyDate >= today) out.add(o.nyDate);
  for (const c of changes) if (c.scope === 'date' && c.nyDate >= today) out.add(c.nyDate);
  return [...out].sort();
}

const REF_KEY: Record<Vertical, string> = { carousels: 'postId', explainers: 'jobId', last_few_days: 'lfdPostId', stories: 'setId', reels: 'postIdeaId' };

async function bookedIn(q: SlotQuery, dates: readonly string[]): Promise<BookedPost[]> {
  if (!dates.length) return [];
  const { rows } = await q(
    `SELECT s.id::text AS id, s.vertical, s.ny_date::text AS ny_date, s.slot, s.feed_mode, s.publish_at, s.idea_ref, ci.native_ref
       FROM social_hub.schedule s LEFT JOIN social_hub.content_items ci ON ci.id = s.content_item_id
      WHERE s.status = 'scheduled' AND s.ny_date = ANY($1::date[])`,
    [dates],
  );
  return rows.map((r) => {
    const v = r.vertical as Vertical;
    const ref = v === 'reels' ? r.idea_ref : r.native_ref;
    return {
      scheduleId: r.id, vertical: v, nyDate: String(r.ny_date).slice(0, 10), windowId: r.slot, feedMode: r.feed_mode ?? null,
      publishAt: new Date(r.publish_at).toISOString(), refs: ref ? { [REF_KEY[v]]: String(ref) } : {},
    };
  });
}

/** A booking is in the way when its slot is gone, or its slot's Trial/Main no longer matches the booking. */
function inTheWay(b: BookedPost, slots: readonly ResolvedSlot[]): boolean {
  const s = slots.find((x) => x.vertical === b.vertical && x.windowId === b.windowId);
  if (!s) return true;
  return s.feedMode != null && b.feedMode != null && s.feedMode !== b.feedMode;
}

export async function applySlotChanges(q: SlotQuery, changes: readonly SlotChange[], opts: { by: string; now: Date; keepBooked: boolean }): Promise<ApplyResult> {
  const today = calendarDateKey(opts.now, SOCIAL_TIMEZONE);
  const started = changes.map((c) => startedNote(c, today, opts.now)).filter((n): n is string => Boolean(n));
  if (started.length) return { ok: false, status: 422, errors: [...new Set(started)] };

  const [template, overridesAll] = await Promise.all([readTemplate(q), readOverrides(q, today, '9999-12-31')]);
  const next = applyInMemory(template, overridesAll, changes);

  const errors = new Set<string>();
  // The template alone, per weekday that changed (dates without overrides are just the template).
  for (const c of changes) {
    if (c.scope !== 'template') continue;
    const probe = probeDate(today, c.weekday);
    for (const e of validateDay(resolveDay(next.template, [], probe))) errors.add(e);
  }
  const dates = affectedDates(today, next.overrides, changes);
  for (const d of dates) for (const e of validateDay(resolveDay(next.template, next.overrides, d))) errors.add(`${d}: ${e}`);
  if (errors.size) return { ok: false, status: 422, errors: [...errors] };

  if (!opts.keepBooked) {
    const booked = (await bookedIn(q, dates)).filter((b) => inTheWay(b, resolveDay(next.template, next.overrides, b.nyDate)));
    // Only bookings this change set put in the way, not ones already out of step before it.
    const before = new Set((await bookedIn(q, dates)).filter((b) => inTheWay(b, resolveDay(template, overridesAll, b.nyDate))).map((b) => b.scheduleId));
    const fresh = booked.filter((b) => !before.has(b.scheduleId));
    if (fresh.length) return { ok: false, status: 409, booked: fresh };
  }

  for (const c of changes) {
    if (c.scope === 'template') {
      if (c.op === 'delete') await q(`DELETE FROM social_hub.slot_template WHERE weekday = $1 AND vertical = $2 AND window_id = $3`, [c.weekday, c.vertical, c.windowId]);
      else await q(
        `INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (weekday, vertical, window_id) DO UPDATE SET feed_mode = EXCLUDED.feed_mode, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [c.weekday, c.vertical, c.windowId, c.feedMode, opts.by],
      );
    } else if (c.op === 'delete') {
      await q(`DELETE FROM social_hub.slot_override WHERE ny_date = $1::date AND vertical = $2 AND window_id = $3`, [c.nyDate, c.vertical, c.windowId]);
    } else {
      await q(
        `INSERT INTO social_hub.slot_override (ny_date, vertical, window_id, action, feed_mode, updated_by, updated_at) VALUES ($1::date, $2, $3, $4, $5, $6, now())
         ON CONFLICT (ny_date, vertical, window_id) DO UPDATE SET action = EXCLUDED.action, feed_mode = EXCLUDED.feed_mode, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [c.nyDate, c.vertical, c.windowId, c.action, c.feedMode, opts.by],
      );
    }
  }
  return { ok: true };
}

/** The next date on or after `today` that falls on `weekday`. */
function probeDate(today: string, weekday: number): string {
  let d = today;
  while (weekdayOf(d) !== weekday) d = addCalendarDays(d, 1);
  return d;
}

/** Flip the switch. The first flip to 'template' seeds the week from today's settings (spec §1 Seed). */
export async function setSlotSource(q: SlotQuery, source: SlotSource, by: string): Promise<{ seeded: number }> {
  let seeded = 0;
  if (source === 'template') {
    const { rows } = await q(`SELECT count(*)::int AS n FROM social_hub.slot_template`);
    if (Number(rows[0]?.n ?? 0) === 0) {
      for (const r of seedTemplate(await readSeedInputs(q))) {
        await q(
          `INSERT INTO social_hub.slot_template (weekday, vertical, window_id, feed_mode, updated_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [r.weekday, r.vertical, r.windowId, r.feedMode, by],
        );
        seeded += 1;
      }
    }
  }
  await q(
    `INSERT INTO social_hub.settings (key, value, updated_at) VALUES ('slot_source', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(source)],
  );
  return { seeded };
}
```

Note for the implementer: `windowMinuteInstant` takes a `PostingWindow` (`{ id, label, startMinute, endMinute }`), and `PlanWindow` has all of those. Run `bookedIn` once and reuse its rows for both filters. The double call above is there for clarity, so fold it into one query when you implement.

- [ ] **Step 4: Add the flags**

In `lib/social-hub/flags.ts`:
- `ActionFlag` gets `| 'editSlots'`. `SOCIAL_HUB_FLAGS.actions` gets `editSlots: true` (comment: `// Weekly slot calendar: edit the template and single dates (spec 2026-10-14).`). `ACTION_FLAGS` gets `'editSlots'`.
- `ViewFlag` gets `| 'calendarWeek'`, and `views` gets `calendarWeek: true`.

In `tests/social-hub-scope.test.ts`, `INTENDED` gets `editSlots: true`.

- [ ] **Step 5: Write the routes**

```ts
// app/api/social-hub/slots/route.ts
import { NextResponse } from 'next/server';

import { dbQuery, dbTransaction } from '@/lib/db';
import { actionEnabled } from '@/lib/social-hub/flags';
import { loadSlots, readSlotSource } from '@/lib/social-hub/slots/load';
import { applySlotChanges, parseChanges } from '@/lib/social-hub/slots/write';
import { addDays, isDayKey } from '@/lib/social-hub/time';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const q = (text: string, params?: unknown[]) => dbQuery(text, params) as Promise<{ rows: any[] }>;

/** `?from&to` (≤ 62 days): the resolved slots per date and which source is live. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!isDayKey(from) || !isDayKey(to) || to < from || to > addDays(from, 61)) return NextResponse.json({ error: 'Pick from and to as YYYY-MM-DD, at most 62 days.' }, { status: 400 });
  const days = Object.fromEntries(await loadSlots(q, from, to));
  return NextResponse.json({ source: await readSlotSource(q), days });
}

/** Body `{ changes, keepBooked? }`. A person's click is the decision; 409 lists booked posts in the way. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actionEnabled('editSlots')) return NextResponse.json({ error: 'Editing slots is off.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  const changes = parseChanges(body);
  if (typeof changes === 'string') return NextResponse.json({ error: changes }, { status: 400 });
  const keepBooked = (body as { keepBooked?: unknown }).keepBooked === true;
  const out = await dbTransaction((client) => applySlotChanges((t, p) => client.query(t, p as unknown[]), changes, { by: session.email, now: new Date(), keepBooked }));
  if (out.ok) return NextResponse.json(out);
  return NextResponse.json(out.status === 409 ? { booked: out.booked } : { errors: out.errors }, { status: out.status });
}
```

```ts
// app/api/social-hub/slots/source/route.ts
import { NextResponse } from 'next/server';

import { dbTransaction } from '@/lib/db';
import { actionEnabled } from '@/lib/social-hub/flags';
import { setSlotSource } from '@/lib/social-hub/slots/write';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Body `{ source: 'legacy' | 'template' }`. The cutover switch (spec §5 checklist); flipping back is the rollback. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actionEnabled('editSlots')) return NextResponse.json({ error: 'Editing slots is off.' }, { status: 403 });
  const source = ((await request.json().catch(() => null)) as { source?: unknown } | null)?.source;
  if (source !== 'legacy' && source !== 'template') return NextResponse.json({ error: 'source is legacy or template.' }, { status: 400 });
  const out = await dbTransaction((client) => setSlotSource((t, p) => client.query(t, p as unknown[]), source, session.email));
  return NextResponse.json({ source, ...out });
}
```

- [ ] **Step 6: Run the tests**

Run: `npx tsx --test tests/slots-write.test.ts tests/social-hub-scope.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/social-hub/slots/write.ts app/api/social-hub/slots lib/social-hub/flags.ts tests/slots-write.test.ts tests/social-hub-scope.test.ts
git commit -m "feat(slots): slot change API with validation, booked-post 409s and the source switch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Trial / Main on the booking and in the publish payload; spacing by feed mode

**Files:**
- Modify: `lib/social-hub/spine.ts` (`bookSlot` takes `feedMode`), `lib/reels/music/publish.ts` (`queuePublish` payload), `lib/reels/music/meta.ts` (`createReelContainer` omits `trial_params` when no strategy), `lib/explainers/publish/publish.ts` (`queuePublish` payload + carry), `lib/explainers/publish/meta.ts` (`createReel` takes `graduationStrategy`), `lib/instagram/feed-spacing.ts` (main-feed reels count, trial explainers don't)
- Test: `tests/slots-feed-mode.test.ts`; update `tests/feed-spacing.test.ts` only if an existing expectation names explainers unconditionally (it shouldn't: explainers stay `main` by default).

**Interfaces:**
- Consumes: `bookingFeedMode`, `legacyFeedMode` (Task 3), `TRIAL_GRADUATION_STRATEGY` (`lib/reels/config.ts`).
- Produces:
  - `bookSlot(query, { …, feedMode?: FeedMode | null })` writes `schedule.feed_mode`
  - `reelPayloadFlags(mode: FeedMode): { graduation_strategy: string | null; share_to_feed: boolean | null }`, exported from `lib/reels/music/publish.ts`
  - `explainerPayloadFlags(mode: FeedMode): { share_to_feed: true; graduation_strategy: string | null }`, exported from `lib/explainers/publish/publish.ts`
  - `FeedSchema` gains `'reels'`; `busyFeedTimes` counts `reels` with `feed_mode = 'main'` and `explainers` with `coalesce(feed_mode, 'main') = 'main'`.

Behavior (spec §5):
- `trial` → `trial_params` with `TRIAL_GRADUATION_STRATEGY`, no `share_to_feed` beyond today's reels setting (`shareToFeed()` stays as it is for Trial reels: OPEN-3).
- `main` → no `trial_params`, `share_to_feed: true`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/slots-feed-mode.test.ts
/** Trial / Main from the booking to the request (spec §5). Request builders only; nothing is sent. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { explainerPayloadFlags } from '@/lib/explainers/publish/publish';
import { createLiveReelClient } from '@/lib/explainers/publish/meta';
import { busyFeedTimes } from '@/lib/instagram/feed-spacing';
import { TRIAL_GRADUATION_STRATEGY } from '@/lib/reels/config';
import { createLiveMetaClient } from '@/lib/reels/music/meta';
import { reelPayloadFlags } from '@/lib/reels/music/publish';
import { bookSlot } from '@/lib/social-hub/spine';

import { openHubTestDb } from './fixtures/social-hub/pglite';

/** A fetch stub that records the form body Meta would get. */
function recorder() {
  const sent: Array<Record<string, string>> = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const body = init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : JSON.parse(String(init?.body ?? '{}'));
    sent.push(body);
    return new Response(JSON.stringify({ id: 'c1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { sent, fetchImpl };
}

test('reel payload flags: trial keeps today\'s trial params, main drops them and shares to feed', () => {
  assert.deepEqual(reelPayloadFlags('trial', null), { graduation_strategy: TRIAL_GRADUATION_STRATEGY, share_to_feed: null });
  assert.deepEqual(reelPayloadFlags('main', null), { graduation_strategy: null, share_to_feed: true });
  assert.deepEqual(explainerPayloadFlags('main'), { share_to_feed: true, graduation_strategy: null });
  assert.deepEqual(explainerPayloadFlags('trial'), { share_to_feed: true, graduation_strategy: TRIAL_GRADUATION_STRATEGY });
});

test('a Text on Screen main-feed container has no trial_params', async () => {
  process.env.META_IG_USER_ID ??= 'ig-test';
  process.env.META_ACCESS_TOKEN ??= 'test-token';
  const { sent, fetchImpl } = recorder();
  const meta = createLiveMetaClient(fetchImpl);
  await meta.createReelContainer({ videoUrl: 'https://x/v.mp4', caption: 'c', audioId: 'a', audioVolume: 50, videoVolume: 50, graduationStrategy: null, shareToFeed: true });
  assert.equal(sent[0]!.trial_params, undefined);
  assert.equal(sent[0]!.share_to_feed, 'true');
  await meta.createReelContainer({ videoUrl: 'https://x/v.mp4', caption: 'c', audioId: 'a', audioVolume: 50, videoVolume: 50, graduationStrategy: TRIAL_GRADUATION_STRATEGY, shareToFeed: null });
  assert.match(sent[1]!.trial_params!, /SS_PERFORMANCE|graduation_strategy/);
});

test('an Explainer trial container carries trial_params', async () => {
  process.env.META_IG_USER_ID ??= 'ig-test';
  process.env.META_ACCESS_TOKEN ??= 'test-token';
  const { sent, fetchImpl } = recorder();
  const meta = createLiveReelClient(fetchImpl);
  await meta.createReel({ videoUrl: 'https://x/v.mp4', caption: 'c', shareToFeed: true, graduationStrategy: TRIAL_GRADUATION_STRATEGY });
  await meta.createReel({ videoUrl: 'https://x/v.mp4', caption: 'c', shareToFeed: true, graduationStrategy: null });
  assert.ok(sent[0]!.trial_params);
  assert.equal(sent[1]!.trial_params, undefined);
});

test('bookSlot stores feed_mode; spacing counts main-feed reels and skips trial explainers', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  const at = (iso: string) => new Date(iso);
  await bookSlot(q, { vertical: 'reels', itemId: null, ideaRef: 'idea-main', nyDate: '2026-10-20', slot: 'morning', publishAt: at('2026-10-20T13:00:00Z'), source: 'auto', feedMode: 'main' });
  await bookSlot(q, { vertical: 'reels', itemId: null, ideaRef: 'idea-trial', nyDate: '2026-10-20', slot: 'midday', publishAt: at('2026-10-20T15:30:00Z'), source: 'auto', feedMode: 'trial' });
  await bookSlot(q, { vertical: 'explainers', itemId: null, nyDate: '2026-10-20', slot: 'afternoon', publishAt: at('2026-10-20T17:30:00Z'), source: 'auto', feedMode: 'trial' });
  const modes = await pg.query(`SELECT slot, feed_mode FROM social_hub.schedule ORDER BY publish_at`);
  assert.deepEqual(modes.rows.map((r) => r.feed_mode), ['main', 'trial', 'trial']);
  const busy = (await busyFeedTimes(q, at('2026-10-20T04:00:00Z'))).map((d) => d.toISOString());
  assert.ok(busy.includes('2026-10-20T13:00:00.000Z'), 'a main-feed reel is a feed post');
  assert.ok(!busy.includes('2026-10-20T15:30:00.000Z'), 'a trial reel is not (D33)');
  assert.ok(!busy.includes('2026-10-20T17:30:00.000Z'), 'a trial explainer is not');
});
```

Note for the implementer: if `bookSlot` with `itemId: null` violates `content_item_id NOT NULL` for explainers in the current schema, create a `content_items` row first, as Task 4's `book()` helper does. Check the env var names `createGraph` reads (`lib/instagram/graph.ts`) and set those in the test.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx tsx --test tests/slots-feed-mode.test.ts`
Expected: FAIL (`reelPayloadFlags` is not exported).

- [ ] **Step 3: `bookSlot` writes `feed_mode`**

In `lib/social-hub/spine.ts`, add `feedMode?: 'trial' | 'main' | null;` to the `slot` parameter type, and change the INSERT to:

```ts
    `INSERT INTO social_hub.schedule (content_item_id, vertical, idea_ref, ny_date, slot, publish_at, status, source, approved_at, feed_mode)
     VALUES ($1, $2, $3, $4::date, $5, $6::timestamptz, 'scheduled', $7, CASE WHEN $8::boolean THEN now() END, $9) RETURNING id, publish_at`,
    [slot.itemId, slot.vertical, slot.ideaRef ?? null, slot.nyDate, slot.slot, slot.publishAt.toISOString(), slot.source, slot.approved === true, slot.feedMode ?? null],
```

- [ ] **Step 4: Reels payload**

In `lib/reels/music/publish.ts`, add next to `shareToFeed()`:

```ts
/**
 * The booking's Trial / Main (weekly slot calendar): trial keeps today's
 * trial params and the OPEN-3 share_to_feed setting; main posts as a normal
 * reel, shared to the feed, with no trial params.
 */
export function reelPayloadFlags(mode: FeedMode, trialShareToFeed: boolean | null): { graduation_strategy: string | null; share_to_feed: boolean | null } {
  return mode === 'main'
    ? { graduation_strategy: null, share_to_feed: true }
    : { graduation_strategy: TRIAL_GRADUATION_STRATEGY, share_to_feed: trialShareToFeed };
}
```

(`import type { FeedMode } from '@/lib/social-hub/slots/types'` and `import { bookingFeedMode } from '@/lib/social-hub/slots'`.) In `queuePublish`, replace the two payload lines:

```ts
    ...reelPayloadFlags(await bookingFeedMode(dbQueryHandle, itemId, 'reels', reel.postIdeaId), await shareToFeed()),
```

where `const dbQueryHandle = (t: string, p?: unknown[]) => dbQuery(t, p) as Promise<{ rows: any[] }>;` is defined once at module scope. The test's first `reelPayloadFlags('trial', null)` expectation matches `shareToFeed()` returning null (OPEN-3 undecided).

In `carryAttempt` the `graduation_strategy` column can now be null. Pass it through as `graduationStrategy: attempt.graduation_strategy` (type `string | null`).

- [ ] **Step 5: Reels Meta client**

In `lib/reels/music/meta.ts`, change the `createReelContainer` input type's `graduationStrategy: string` to `graduationStrategy: string | null`, and the params block to:

```ts
        ...(input.graduationStrategy ? { trial_params: JSON.stringify({ graduation_strategy: input.graduationStrategy }) } : {}),
      };
```

(Remove the old unconditional `trial_params` line.)

- [ ] **Step 6: Explainers payload + Meta client**

In `lib/explainers/publish/meta.ts`:

```ts
  createReel(input: { videoUrl: string; caption: string; shareToFeed: boolean; graduationStrategy?: string | null }): Promise<string>;
```

and in `createLiveReelClient` add to the posted params:

```ts
        ...(input.graduationStrategy ? { trial_params: JSON.stringify({ graduation_strategy: input.graduationStrategy }) } : {}),
```

Update the file's header comment: Explainers post as regular reels unless their slot is a Trial slot.

In `lib/explainers/publish/publish.ts`:

```ts
import { TRIAL_GRADUATION_STRATEGY } from '@/lib/reels/config';
import { bookingFeedMode } from '@/lib/social-hub/slots';
import type { FeedMode } from '@/lib/social-hub/slots/types';

/** The booking's Trial / Main: Explainers share to the feed either way; a Trial slot adds trial params. */
export function explainerPayloadFlags(mode: FeedMode): { share_to_feed: true; graduation_strategy: string | null } {
  return { share_to_feed: true, graduation_strategy: mode === 'trial' ? TRIAL_GRADUATION_STRATEGY : null };
}
```

In `queuePublish`, the payload becomes:

```ts
JSON.stringify({ video_object: ready.videoObject, ...explainerPayloadFlags(await bookingFeedMode((t, p) => db.query(t, p), itemId, 'explainers')) })
```

In the carry step (around line 174), select `payload->>'graduation_strategy' AS graduation_strategy` too and pass `graduationStrategy: attempt.graduation_strategy ?? null` to `meta.createReel`.

Check before importing: `lib/reels/config.ts` must not pull in network modules (`tests/social-hub-scope.test.ts` network reach). If it does, copy the constant into `lib/social-hub/slots/types.ts` as `TRIAL_STRATEGY` with a pin test against `TRIAL_GRADUATION_STRATEGY`.

- [ ] **Step 7: Spacing by feed mode**

In `lib/instagram/feed-spacing.ts`:

```ts
/** Feed-posting types by their schema: `social` is Carousels, `lfd` is Last Few Days, `reels` is Text on Screen on a Main-feed slot. */
export type FeedSchema = 'explainers' | 'social' | 'lfd' | 'reels';

const FEED_SCHEMAS: readonly FeedSchema[] = ['explainers', 'social', 'lfd', 'reels'];

/**
 * Each type's bookings, on the lifecycle spine (D36). A reel booking is a
 * feed post only on a Main-feed slot (weekly slot calendar; D33 keeps Trial
 * Reels exempt). Explainers with no feed_mode are Main, as before.
 */
const BOOKED: Record<FeedSchema, string> = {
  explainers: `SELECT publish_at FROM social_hub.schedule WHERE vertical = 'explainers' AND coalesce(feed_mode, 'main') = 'main' AND ${ACTIVE}`,
  social: `SELECT publish_at FROM social_hub.schedule WHERE vertical = 'carousels' AND ${ACTIVE}`,
  lfd: `SELECT publish_at FROM social_hub.schedule WHERE vertical = 'last_few_days' AND ${ACTIVE}`,
  reels: `SELECT publish_at FROM social_hub.schedule WHERE vertical = 'reels' AND feed_mode = 'main' AND ${ACTIVE}`,
};
```

`busyFeedTimes` already swallows errors per schema, so a database without the `feed_mode` column skips `reels` and keeps working. The `explainers` query would also fail there, so also wrap the `coalesce` query: on an error, retry the old query without `feed_mode` (two-line fallback in the loop) so that one missing column never drops explainers from spacing.

- [ ] **Step 8: Run the tests**

Run: `npx tsx --test tests/slots-feed-mode.test.ts tests/feed-spacing.test.ts tests/explainers-publish.test.ts tests/instagram-payloads.test.ts tests/social-hub-scope.test.ts`
Plus any reels publish test: `ls tests | grep -i "reels.*publish\|music"` and run those too.
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/social-hub/spine.ts lib/reels/music lib/explainers/publish/publish.ts lib/explainers/publish/meta.ts lib/instagram/feed-spacing.ts tests/slots-feed-mode.test.ts
git commit -m "feat(slots): bookings carry Trial/Main; payloads and feed spacing follow it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Reels and Explainers schedulers read the slots

**Files:**
- Create: `lib/social-hub/slots/choose.ts`
- Modify: `lib/reels/publish/schedule.ts` (`takenSlots`, `schedulePostIdea`), `lib/reels/pipeline/fill.ts` (`reelsPerDay`), `lib/explainers/publish/schedule.ts` (`scheduleJob`, `postsPerDay` caller), `lib/explainers/ideas/cycle.ts` (fill quota)
- Test: `tests/slots-schedulers.test.ts` (reels/explainers half)

**Interfaces:**
- Consumes: `slotPlan`, `nonSlotKeys`, `feedModeKeys`, `slotsOn`, `feedModeFor` (Task 3), `chooseFromWindows`, `slotTakenKey` (`lib/instagram/window.ts`), `slotKey`, `POSTING_SLOTS` (`lib/reels/publish/slots.ts`), `EXPLAINER_WINDOWS`, `bookSlot` with `feedMode` (Task 5), `busyFeedTimes`/`ownFeedTimes` with `'reels'` (Task 5).
- Produces:
  - `chooseByFeedMode(windows, now, taken, modes: { trial: Set<string>; main: Set<string> }, busy: readonly Date[], rng, throughDate?): WindowChoice | null`: the earliest of (a trial-slot choice with no spacing) and (a main-slot choice spaced from `busy`). Keys use `slotTakenKey` (`date|slot`).
  - `quotaFromSlots(q, vertical, nyDate): Promise<number | null>`, exported from `lib/social-hub/slots/index.ts`: the number of slots that date in template mode, `null` in legacy.

Template-mode behavior (legacy is untouched: every new branch is `if (plan) …`):
- **Reels**: `taken` also holds every non-slot window over 14 days. The choice comes from `chooseByFeedMode(POSTING_SLOTS, …)`, so Main slots space against feed posts (Review Focus: decision 9). The booking stores `feedModeFor(...)`. The daily quota is the slot count for that date.
- **Explainers**: same, over all `EXPLAINER_WINDOWS` (not sliced by `posts_per_day`). The idea cycle's quota is the slot count.

- [ ] **Step 1: Write the failing test**

```ts
// tests/slots-schedulers.test.ts (part 1: reels and explainers)
/** The schedulers follow the calendar in template mode and are unchanged in legacy mode (spec §5). Offline. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseByFeedMode } from '@/lib/social-hub/slots/choose';
import { slotTakenKey } from '@/lib/instagram/window';
import { POSTING_SLOTS } from '@/lib/reels/publish/slots';

const NOW = new Date('2026-10-20T04:00:00Z'); // Tue Oct 20, midnight New York
const first = () => 0;

test('chooseByFeedMode: a trial slot is picked with no spacing, a main slot avoids busy feed times', () => {
  const trialOnly = { trial: new Set(['2026-10-20|morning']), main: new Set<string>() };
  const taken = new Set(['2026-10-20|midday', '2026-10-20|evening']);
  // Busy at 8:45 does not stop a trial reel at 8:45 (D33).
  const busy = [new Date('2026-10-20T12:45:00Z')];
  const t = chooseByFeedMode(POSTING_SLOTS, NOW, taken, trialOnly, busy, first, '2026-10-20')!;
  assert.equal(t.publishAt.toISOString(), '2026-10-20T12:45:00.000Z');
  // The same window as Main moves ≥ 30 minutes off the busy instant.
  const mainOnly = { trial: new Set<string>(), main: new Set(['2026-10-20|morning']) };
  const m = chooseByFeedMode(POSTING_SLOTS, NOW, taken, mainOnly, busy, first, '2026-10-20')!;
  assert.ok(m.publishAt.getTime() - busy[0]!.getTime() >= 30 * 60_000);
});

test('chooseByFeedMode picks the earliest across modes', () => {
  const modes = { trial: new Set(['2026-10-20|evening']), main: new Set(['2026-10-20|morning']) };
  const c = chooseByFeedMode(POSTING_SLOTS, NOW, new Set(['2026-10-20|midday']), modes, [], first, '2026-10-20')!;
  assert.equal(c.slot, 'morning');
});
```

Then add PGlite tests for the real schedulers. Use the existing reels/explainers scheduler tests as the template for seeding a schedulable item: find them with `grep -ln "schedulePostIdea\|scheduleJob" tests/*.ts`, and copy their fixture setup (they already build a video job / render that can be booked). For each scheduler, write these three tests:

```ts
// Shape of each scheduler test (fill in the fixture from the existing test you copied):
test('<type> legacy: unchanged booking (same slot as before this change)', async () => {
  // slot_source = 'legacy' (default). Book; assert the slot and that feed_mode = legacyFeedMode('<type>').
});
test('<type> template: a removed window is never booked, and the slot\'s feed mode is stored', async () => {
  // setSlotSource(q, 'template'); add an override removing tomorrow's first window and flipping the second to the other mode.
  // Book with throughDate = tomorrow; assert slot = second window and schedule.feed_mode = the flipped mode.
});
test('<type> template: a started window still takes a post today (Review Focus 4)', async () => {
  // now = inside today's first window; assert it books today's first window with publishAt > now.
});
```

The reels scheduler uses `dbQuery` (the app pool), not an injected handle. Look at how the existing reels schedule tests stub `dbQuery` (search `tests/` for `reels-publish` or `mock.module`) and follow that pattern. If none exists, test reels through `chooseByFeedMode` plus a unit test on the new `reelTaken(plan, fromDate, base)` helper (Step 3), and leave the DB round trip to the explainers test.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx tsx --test tests/slots-schedulers.test.ts`
Expected: FAIL (module `choose` not found).

- [ ] **Step 3: Write `choose.ts` and `quotaFromSlots`**

```ts
// lib/social-hub/slots/choose.ts
import { chooseFromWindows, uniformIndex, type PostingWindow, type WindowChoice } from '@/lib/instagram/window';

/**
 * A reel type's next slot (weekly slot calendar): Trial slots ignore feed
 * spacing (D33), Main slots keep ≥ 30 minutes from every feed post (SH-47).
 * Two searches, one per mode, then the earlier. Pure.
 */
export function chooseByFeedMode(
  windows: readonly PostingWindow[],
  now: Date,
  taken: ReadonlySet<string>,
  modes: { trial: ReadonlySet<string>; main: ReadonlySet<string> },
  busy: readonly Date[],
  rng: (count: number) => number = uniformIndex,
  throughDate?: string,
): WindowChoice | null {
  const plus = (extra: ReadonlySet<string>) => new Set([...taken, ...extra]);
  const trial = chooseFromWindows(windows, now, plus(modes.main), [], rng, throughDate);
  const main = chooseFromWindows(windows, now, plus(modes.trial), busy, rng, throughDate);
  if (!trial) return main;
  if (!main) return trial;
  return trial.publishAt.getTime() <= main.publishAt.getTime() ? trial : main;
}
```

The key format: `chooseFromWindows` checks `slotTakenKey(nyDate, w.id)` (`date|slot`), so build `taken`, and the keys `nonSlotKeys`/`feedModeKeys` produce, with `slotTakenKey`. Reels' own `slotKey` (`date:slot`) stays for the legacy path.

Append to `lib/social-hub/slots/index.ts`:

```ts
/** A type's posts for a date in template mode (its slot count); null while legacy, so the caller keeps posts_per_day. */
export async function quotaFromSlots(q: SlotQuery, vertical: Vertical, nyDate: string): Promise<number | null> {
  const plan = await slotPlan(q, nyDate, 1);
  return plan ? slotsOn(plan, vertical, nyDate).length : null;
}
```

- [ ] **Step 4: Reels**

In `lib/reels/publish/schedule.ts`:

```ts
import { chooseByFeedMode } from '@/lib/social-hub/slots/choose';
import { feedModeFor, feedModeKeys, nonSlotKeys, slotPlan, type SlotPlan } from '@/lib/social-hub/slots';
import { busyFeedTimes, ownFeedTimes } from '@/lib/instagram/feed-spacing';
import { slotTakenKey } from '@/lib/instagram/window';

const hubQ = (t: string, p?: unknown[]) => dbQuery(t, p) as Promise<{ rows: any[] }>;

/** Template mode: every reels window that is not a slot counts as taken, in both key formats the reels code uses. */
export function reelTaken(plan: SlotPlan, base: ReadonlySet<string>, key: (d: string, s: string) => string): Set<string> {
  return new Set([...base, ...nonSlotKeys(plan, 'reels', POSTING_SLOTS.map((s) => s.id), key)]);
}
```

In `schedulePostIdea`'s loop, replace the `chooseSlot(...)` line with:

```ts
    const fromDate = calendarDateKey(now);
    const plan = await slotPlan(hubQ, fromDate);
    const takenNow = await takenSlots(fromDate);
    let choice: { nyDate: string; slot: SlotId; publishAt: Date } | null;
    if (!plan) {
      // Trial Reels are exempt from the cross-type feed spacing (D33 revises SH-47).
      choice = chooseSlot(now, takenNow, uniformIndex, POSTING_TIME_ZONE, throughDate);
    } else {
      // The calendar: only its slots, and Main slots space against feed posts.
      const taken = reelTaken(plan, new Set([...takenNow].map((k) => k.replace(':', '|'))), slotTakenKey);
      const busy = [...(await busyFeedTimes(hubQ, now, 'reels')), ...(await ownFeedTimes(hubQ, 'reels', now))];
      const picked = chooseByFeedMode(POSTING_SLOTS, now, taken, feedModeKeys(plan, 'reels', slotTakenKey), busy, uniformIndex, throughDate);
      choice = picked ? { nyDate: picked.nyDate, slot: picked.slot as SlotId, publishAt: picked.publishAt } : null;
    }
```

Add `feedMode: await feedModeFor(hubQ, 'reels', choice.nyDate, choice.slot)` to the `bookSlot` call. `takenSlots` keys are `date:slot`. The `replace(':', '|')` is safe because dates contain no colon, but write a tiny `toTakenKey` helper rather than an inline replace.

In `windowsStillOpen`: when `slotPlan(hubQ, today, 1)` is non-null, filter `POSTING_SLOTS` to today's reels slots before counting.

In `lib/reels/pipeline/fill.ts`, `reelsPerDay()` becomes:

```ts
/** The day's quota: the calendar's reels slots for today in template mode, else the `posts_per_day` row of reels.settings, else three. */
export async function reelsPerDay(now = new Date()): Promise<number> {
  const fromSlots = await quotaFromSlots((t, p) => dbQuery(t, p) as never, 'reels', calendarDateKey(now));
  if (fromSlots != null) return fromSlots;
  const raw = await getSetting<unknown>('posts_per_day');
  const value = raw == null ? NaN : Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : PASSING_REELS_PER_NIGHT;
}
```

and `reelsFill(now)` passes `now` through: `await reelsPerDay(now)`.

Update the reels scheduler's `scheduleNote` so it doesn't always say "trial reel". The new copy reads: `` `Scheduled for ${formatPublishAt(schedule.publishAt)} (${slotLabel(schedule.slot)}).` `` followed by `' It posts as a trial reel.'` or `' It posts to the main feed.'`, depending on the booking's `feed_mode`. Select `feed_mode` in `SCHEDULE_COLUMNS` and add `feedMode` to `StoredSchedule`.

- [ ] **Step 5: Explainers**

In `lib/explainers/publish/schedule.ts` `scheduleJob`'s loop, after `takenRows`:

```ts
    const hubQ = (t: string, p?: unknown[]) => db.query<Record<string, unknown>>(t, p) as never;
    const plan = await slotPlan(hubQ, calendarDateKey(now));
    const takenKeys = new Set(takenRows.map((r) => slotTakenKey(r.d, r.slot)));
    let choice;
    if (!plan) {
      const windows = EXPLAINER_WINDOWS.slice(0, Math.max(1, Math.min(await postsPerDay(db), EXPLAINER_WINDOWS.length)));
      choice = chooseFromWindows(windows, now, takenKeys, busy, rng, throughDate);
    } else {
      for (const k of nonSlotKeys(plan, 'explainers', EXPLAINER_WINDOWS.map((w) => w.id), slotTakenKey)) takenKeys.add(k);
      choice = chooseByFeedMode(EXPLAINER_WINDOWS, now, takenKeys, feedModeKeys(plan, 'explainers', slotTakenKey), busy, rng, throughDate);
    }
```

(Remove the old `const windows = …` and `const choice = chooseFromWindows(...)` lines this replaces. Keep the `busy` computation where it is.) Add `feedMode: await feedModeFor(hubQ, 'explainers', choice.nyDate, choice.slot)` to its `bookSlot` call.

In `lib/explainers/ideas/cycle.ts` `runIdeaCycle`, replace `await postsPerDay(db)` in the `dailyFillOrQuota` call with:

```ts
(await quotaFromSlots((t, p) => db.query(t, p) as never, 'explainers', day)) ?? (await postsPerDay(db))
```

- [ ] **Step 6: Run the tests**

Run: `npx tsx --test tests/slots-schedulers.test.ts tests/explainers-publish.test.ts tests/explainers-ideas.test.ts tests/social-hub-placement.test.ts tests/feed-spacing.test.ts`, plus every `tests/reels-*.test.ts` that imports `lib/reels/publish/schedule` or `lib/reels/pipeline/fill` (`grep -l "publish/schedule\|pipeline/fill" tests/*.ts`).
Expected: PASS. Legacy expectations in the existing tests must not change.

- [ ] **Step 7: Commit**

```bash
git add lib/social-hub/slots lib/reels/publish/schedule.ts lib/reels/pipeline/fill.ts lib/explainers/publish/schedule.ts lib/explainers/ideas/cycle.ts tests/slots-schedulers.test.ts
git commit -m "feat(slots): Text on Screen and Explainers book only calendar slots in template mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Carousels, Last Few Days, the 3 AM switch, and Stories read the slots

**Files:**
- Modify: `lib/social/overnight/schedule.ts` (`schedulePost`, `carouselFill`), `scripts/social_worker.ts` (night stories count, 3 AM), `lib/lfd/schedule.ts` (`scheduleLfdPost`), `lib/lfd/clock.ts` (`threeAmQueue` takes the slot answer), `lib/content-type/run-today-live.ts` (LFD due), `lib/stories/schedule.ts` (`requestAutoSets` takes a `dueOn`), `lib/stories/worker.ts` (passes it), `lib/social-hub/health/reporters/carousels.ts`
- Test: `tests/slots-schedulers.test.ts` (part 2), `tests/lfd-run.test.ts`/`tests/lfd-worker.test.ts` keep passing

**Interfaces:**
- Consumes: Task 3 seam, `datesByWeekday` stays for legacy.
- Produces:
  - `threeAmQueue(nyDate, lfd, carouselAutoRun, lfdDay?: boolean | null)`: `lfdDay` non-null (template mode) replaces `lfd.days.includes(weekday)` and decouples from `autoRun`. On an LFD-slot day with LFD's auto_run off, it returns `{ queue: 'none', reason: 'a Last Few Days day on the calendar, and Last Few Days is paused; no carousel run (the calendar is literal)' }`.
  - `requestAutoSets(db, settings, now, opts: { log?; dueOn?: (series: Series, nyDate: string) => boolean })`: `dueOn` replaces `isDueOn(cfg.window, date)` when given.
  - `storiesDueOn(q, now): Promise<((series, nyDate) => boolean) | null>`, in `lib/social-hub/slots/index.ts` (null while legacy).

- [ ] **Step 1: Write the failing tests**

Append to `tests/slots-schedulers.test.ts` (move the two new imports up to the file's import block; ESM imports can't sit mid-file):

```ts
import { threeAmQueue } from '@/lib/lfd/clock';
import { parseLfdSettings } from '@/lib/lfd/settings';

const lfd = (autoRun: boolean) => parseLfdSettings([{ key: 'auto_run', value: autoRun }, { key: 'days', value: [2, 5] }]);

test('3 AM legacy is unchanged', () => {
  assert.equal(threeAmQueue('2026-10-20', lfd(true), true).queue, 'last_few_days');
  assert.equal(threeAmQueue('2026-10-20', lfd(false), true).queue, 'carousels');
});

test('3 AM template: the calendar decides; a paused LFD on its day runs nothing (Review Focus 5)', () => {
  assert.equal(threeAmQueue('2026-10-21', lfd(true), true, true).queue, 'last_few_days'); // Wednesday LFD override
  assert.equal(threeAmQueue('2026-10-20', lfd(true), true, false).queue, 'carousels');    // Tuesday with LFD removed
  const paused = threeAmQueue('2026-10-20', lfd(false), true, true);
  assert.equal(paused.queue, 'none');
  assert.match(paused.reason, /paused/);
});
```

Then add PGlite tests for these, built like Task 6's scheduler tests (copy fixture setup from `tests/lfd-schedule.test.ts` and the carousel scheduling tests found by `grep -ln "schedulePost(" tests/*.ts`):
- **Carousels template:** an override that removes Wednesday's morning window → `schedulePost` with `throughDate` Wednesday books `afternoon`. A Wednesday LFD override (with the Carousel removals) → no carousel window that day.
- **Carousels template quota:** `carouselFill(q, wednesdayMorning)` → `quota` equals the slot count (0, 1 or 2) after overrides.
- **LFD template:** an LFD override on Wednesday → `scheduleLfdPost` with `throughDate` Wednesday books it. Removing Tuesday's LFD template row → Tuesday refused.
- **Stories template:** `storiesDueOn` true for a series on a date that has its slot, false after a `remove` override, and `requestAutoSets` with that `dueOn` requests only the due series. Copy the fixture from `tests/stories-pipeline.test.ts`.
- **Legacy for each:** the same calls with `slot_source = 'legacy'` behave exactly as before. Reuse an existing assertion from that type's test file.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx tsx --test tests/slots-schedulers.test.ts`
Expected: FAIL (`threeAmQueue` ignores its 4th argument; no `storiesDueOn`).

- [ ] **Step 3: Carousels**

In `lib/social/overnight/schedule.ts` `schedulePost`, replace the `off`/`datesByWeekday` marking with:

```ts
  const plan = await slotPlan(query, calendarDateKey(now, SOCIAL_TIMEZONE));
  // LFD-02 (legacy): while Last Few Days' auto_run is on, its days have no carousel windows.
  const off = plan ? [] : await carouselOffDays(query);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const busy = [...(await busyFeedTimes(query, now, 'social')), ...(await ownFeedTimes(query, 'social', now))];
    const today = calendarDateKey(now, SOCIAL_TIMEZONE);
    const taken = await takenSlots(query, today);
    if (plan) for (const k of nonSlotKeys(plan, 'carousels', CAROUSEL_SLOTS.map((w) => w.id), slotTakenKey)) taken.add(k);
    else for (const day of datesByWeekday(today, 14, off, true)) for (const w of CAROUSEL_SLOTS) taken.add(slotTakenKey(day, w.id));
    const perDay = plan ? CAROUSEL_SLOTS.length : await postsPerDay(query);
    const choice = chooseCarouselSlots(now, taken, busy, perDay, rng, throughDate);
```

(The rest of the loop is unchanged.) `carouselFill` becomes:

```ts
export async function carouselFill(query: Query, now = new Date()): Promise<DailyFill> {
  const day = calendarDateKey(now, SOCIAL_TIMEZONE);
  return dailyFill(query, 'carousels', day, (await quotaFromSlots(query, 'carousels', day)) ?? (await postsPerDay(query)));
}
```

In `scripts/social_worker.ts` (around line 173), where `stories = fill ? nightStories(fill, runStories) : runStories`: in template mode the slots are the knob, so use `nightStories(fill, Math.max(runStories, fill.making))` when `await readSlotSource(query) === 'template'`. Import `readSlotSource` from `@/lib/social-hub/slots/load`.

- [ ] **Step 4: Last Few Days**

In `lib/lfd/schedule.ts` `scheduleLfdPost`, after reading `days`:

```ts
  const plan = await slotPlan(query, calendarDateKey(now, SOCIAL_TIMEZONE));
```

and inside the loop replace `await takenSlots(query, today, days)` with:

```ts
plan ? await calendarTaken(query, today, plan) : await takenSlots(query, today, days)
```

where

```ts
/** Template mode: booked LFD windows, plus every date in the plan with no LFD slot. */
async function calendarTaken(query: Query, fromDate: string, plan: SlotPlan): Promise<Set<string>> {
  const taken = await takenSlots(query, fromDate, [0, 1, 2, 3, 4, 5, 6]); // every weekday "on": only real bookings
  for (const k of nonSlotKeys(plan, 'last_few_days', [LFD_SLOT], slotTakenKey)) taken.add(k);
  return taken;
}
```

Update `LFD_DAY_PASSED_NOTE`'s "pick a Tuesday or Friday" to "pick a day with a Last Few Days slot" (it's shown in both modes, and the new copy is true in both).

In `lib/lfd/clock.ts`:

```ts
/**
 * …(keep the existing comment)… In template mode (`lfdDay` given) the
 * calendar says whether today is an LFD day, and the calendar is literal:
 * an LFD day with LFD paused runs neither LFD nor Carousels.
 */
export function threeAmQueue(nyDate: string, lfd: LfdSettings | null, carouselAutoRun: boolean, lfdDay: boolean | null = null): ThreeAm {
  const isLfdDay = lfdDay ?? Boolean(lfd?.autoRun && lfd.days.includes(weekdayOfDate(nyDate)));
  if (isLfdDay && lfdDay !== null && !lfd?.autoRun) {
    return { queue: 'none', reason: 'a Last Few Days day on the calendar, and Last Few Days is paused; no carousel run (the calendar is literal)' };
  }
  if (isLfdDay) {
    return lfd?.runCapUsd == null
      ? { queue: 'none', reason: `lfd.settings.run_cap_usd is not a positive number (${JSON.stringify(lfd?.runCapRaw)}); no Last Few Days run, and no carousel run on its day` }
      : { queue: 'last_few_days', reason: 'a Last Few Days day' };
  }
  return carouselAutoRun ? { queue: 'carousels', reason: 'auto_run is on' } : { queue: 'none', reason: 'auto_run is off' };
}
```

In `scripts/social_worker.ts` at the 3 AM call:

```ts
        const today = calendarDateKey(new Date());
        const plan = await slotPlan(lfdQuery, today, 1).catch(() => null);
        const slot = threeAmQueue(today, lfd, await autoRunOn().catch(() => false), plan ? isLfdDay(plan, today) : null);
```

In `lib/content-type/run-today-live.ts` line 45, where `lfdDueOn(s, today, anyDay)` decides "Run today": in template mode use `anyDay || (s.autoRun && isLfdDay(plan, today))`. Read `plan` with `slotPlan(q, today, 1)` from the handle the function already has.

- [ ] **Step 5: Stories**

In `lib/social-hub/slots/index.ts`:

```ts
/** Template mode: whether a Stories series has its slot on a date. Null while legacy (the series' own days stand). */
export async function storiesDueOn(q: SlotQuery, from: string): Promise<((series: string, nyDate: string) => boolean) | null> {
  const plan = await slotPlan(q, from);
  if (!plan) return null;
  return (series, nyDate) => slotsOn(plan, 'stories', nyDate).some((s) => s.windowId === series);
}
```

In `lib/stories/schedule.ts` `requestAutoSets`, add `dueOn?: (series: Series, nyDate: string) => boolean` to `opts`, and change the guard to:

```ts
    const due = opts.dueOn ? opts.dueOn(s, date) : isDueOn(cfg.window, date);
    if (!cfg.enabled || !cfg.auto || !due) continue;
```

In `lib/stories/worker.ts` before the `requestAutoSets` call:

```ts
    const dueOn = await storiesDueOn((t, p) => deps.db.query(t, p) as never, nyDate(now)).catch(() => null);
    const requested = await requestAutoSets(deps.db, settings, now, { log: …unchanged…, ...(dueOn ? { dueOn } : {}) });
```

(`nyDate` is already available in `lib/stories/schedule.ts`. Import it or use `calendarDateKey(now, SOCIAL_TIMEZONE)`.)

- [ ] **Step 6: Health reporter**

In `lib/social-hub/health/reporters/carousels.ts` (line ~62):

```ts
  const plan = await slotPlan(q, night, 1);
  // A night Carousels give to Last Few Days asks for no carousel: LFD-02 in legacy, the calendar's LFD slot in template mode.
  const off = plan ? isLfdDay(plan, night) : (await carouselOffDays(q)).includes(weekdayIndex(night));
```

- [ ] **Step 7: Run the tests**

Run: `npx tsx --test tests/slots-schedulers.test.ts tests/lfd-*.test.ts tests/stories-*.test.ts tests/social-hub-run-today.test.ts tests/lfd-run-today.test.ts tests/social-hub-scope.test.ts`, plus every test importing `lib/social/overnight/schedule` (`grep -l "overnight/schedule" tests/*.ts`).
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/social/overnight/schedule.ts scripts/social_worker.ts lib/lfd lib/content-type/run-today-live.ts lib/stories lib/social-hub/health/reporters/carousels.ts lib/social-hub/slots/index.ts tests/slots-schedulers.test.ts
git commit -m "feat(slots): Carousels, Last Few Days, the 3 AM switch and Stories follow the calendar in template mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Hub placement and views read the slots; type pages lose cadence

**Files:**
- Modify: `lib/social-hub/placement.ts` (`placementRules`, `planPlacement`, `placeItem`, `rescheduleItem`), `lib/social-hub/views/day-rank.ts` (`DayQuotas.slots`), `lib/social-hub/queries/day.ts` (`readDayQuotas`), `lib/social-hub/views/plan.ts` (`windowsOn`, `capacityWindows`, `dayPlan` take `slots`), `lib/social-hub/views/{calendar,today,offer,day-rank}.ts`, `lib/content-type/{model,run-today-live}.ts` (pass `slots`), `lib/content-type/posting.ts` (`readPosting`/`writePosting`), `components/content-type/TypeControls.tsx` (`PostingSettings`), `components/social-hub/calendar/CalendarScreen.tsx` (pass `slots` to month view)
- Create: `components/content-type/ScheduleStrip.tsx`
- Test: `tests/slots-hub-views.test.ts`

**Interfaces:**
- Consumes: Task 3 (`slotPlan`, `slotsOn`, `feedModeFor`), `ResolvedSlot`.
- Produces:
  - `type SlotsByDate = Readonly<Record<string, readonly ResolvedSlot[]>>`, exported from `lib/social-hub/slots/types.ts`
  - `DayQuotas.slots?: SlotsByDate | null` (template mode: today−7 … today+21)
  - `windowsOn(vertical, nyDate, carouselOff = [], slots?: SlotsByDate | null): PlanWindow[]`: when `slots?.[nyDate]` exists, return `PLAN[vertical]` filtered to that date's slot ids for the vertical, ignoring `carouselOff`
  - `capacityWindows(…, today?, slots?)`, `dayPlan(posts, nyDate, carouselOff, today?, slots?)`, `monthModel(…, carouselOff, slots?)`, `daySlots(…, carouselOff, slots?)`: each passes `slots` down
  - `PostingState` adds `schedule: Array<{ nyDate: string; count: number; trial: number; main: number; series: string[]; override: boolean }> | null` (template mode: this Mon–Sun week for that type)
  - `writePosting` throws `'Cadence moved to the calendar.'` for `perDay` or series `days` while in template mode (the route turns it into a 400). In legacy mode it's unchanged, so the old controls keep working until the flip.

This is the place the spec calls "the calendar owns when". In legacy mode the type page keeps its old controls, because those settings still drive the workers. In template mode they're replaced by the strip. Hiding them in legacy mode would leave no way to change cadence at all.

- [ ] **Step 1: Write the failing test**

```ts
// tests/slots-hub-views.test.ts
/** Hub views and placement in template mode (spec §3, §4). Offline. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDay } from '@/lib/social-hub/slots/resolve';
import { DEFAULT_SEED_INPUTS, seedTemplate } from '@/lib/social-hub/slots/seed';
import type { SlotsByDate } from '@/lib/social-hub/slots/types';
import { windowsOn, dayPlan } from '@/lib/social-hub/views/plan';
import { planPlacement } from '@/lib/social-hub/placement';
import { setSlotSource, applySlotChanges } from '@/lib/social-hub/slots/write';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const tpl = seedTemplate(DEFAULT_SEED_INPUTS);
const slotsFor = (dates: string[], overrides = [] as Parameters<typeof resolveDay>[1]): SlotsByDate =>
  Object.fromEntries(dates.map((d) => [d, resolveDay(tpl, overrides, d)]));

test('windowsOn follows the day\'s slots when given, and the old rule when not', () => {
  const slots = slotsFor(['2026-10-21'], [{ nyDate: '2026-10-21', vertical: 'carousels', windowId: 'morning', action: 'remove', feedMode: null }]);
  assert.deepEqual(windowsOn('carousels', '2026-10-21', [], slots).map((w) => w.id), ['afternoon']);
  assert.deepEqual(windowsOn('carousels', '2026-10-21', []).map((w) => w.id), ['morning', 'afternoon']);
  // A date the map doesn't cover falls back to the old rule.
  assert.deepEqual(windowsOn('carousels', '2026-10-22', [], slots).map((w) => w.id), ['morning', 'afternoon']);
});

test('dayPlan offers only slot windows as open', () => {
  const slots = slotsFor(['2026-10-21'], [{ nyDate: '2026-10-21', vertical: 'reels', windowId: 'evening', action: 'remove', feedMode: null }]);
  const reels = dayPlan([], '2026-10-21', [], '2026-10-20', slots).types.find((t) => t.vertical === 'reels')!;
  assert.deepEqual(reels.open.map((w) => w.id), ['morning', 'midday']);
});

test('placing into a window that is not a slot that day is refused; a Main reel slot is spaced', async () => {
  const { query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 't');
  const now = new Date('2026-10-20T04:00:00Z');
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'reels', windowId: 'evening', action: 'remove', feedMode: null }], { by: 't', now, keepBooked: false });
  const refused = await planPlacement(q, { vertical: 'reels', itemId: null, ideaRef: 'i1', nyDate: '2026-10-21', slot: 'evening', now } as never);
  assert.equal(refused.ok, false);
  const ok = await planPlacement(q, { vertical: 'reels', itemId: null, ideaRef: 'i1', nyDate: '2026-10-21', slot: 'midday', now } as never);
  assert.equal(ok.ok, true);
});
```

Extend `tests/content-type.test.ts` (or add here) with three tests: `writePosting('carousels', { perDay: 1 })` throws "Cadence moved to the calendar." in template mode; it works in legacy mode; `readPosting` returns `schedule` with seven days in template mode and `null` in legacy. Follow that file's existing stubbing for `getSocialSetting`/`dbQuery`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx tsx --test tests/slots-hub-views.test.ts`
Expected: FAIL (`windowsOn` ignores its 4th argument).

- [ ] **Step 3: Plan helpers take `slots`**

Add to `lib/social-hub/slots/types.ts`:

```ts
/** Resolved slots by New York date, as the hub's dataset carries them. */
export type SlotsByDate = Readonly<Record<string, readonly ResolvedSlot[]>>;
```

In `lib/social-hub/views/plan.ts`:

```ts
import type { SlotsByDate } from '@/lib/social-hub/slots/types';

/**
 * A type's windows on a day. With the calendar (`slots` covers the date),
 * exactly that day's slots for the type. Otherwise the old rule:
 * `carouselOff` holds the weekdays Carousels give up to Last Few Days while
 * its auto_run is on (LFD-02; DayQuotas.lfdDays).
 */
export function windowsOn(vertical: Vertical, nyDate: string, carouselOff: readonly number[] = [], slots?: SlotsByDate | null): PlanWindow[] {
  const day = slots?.[nyDate];
  if (day) {
    const ids = new Set(day.filter((s) => s.vertical === vertical).map((s) => s.windowId));
    return PLAN[vertical].filter((w) => ids.has(w.id));
  }
  const weekday = weekdayOf(nyDate);
  if (vertical === 'carousels' && carouselOff.includes(weekday)) return [];
  return PLAN[vertical].filter((w) => !w.days || w.days.includes(weekday));
}
```

`capacityWindows` gets a trailing `slots?: SlotsByDate | null`, passed to both `windowsOn` calls. In template mode `all` and `open` are the same, so it returns `all`, which is correct: the calendar has no "closed but held" windows. Then do the same for `dayPlan`, `monthModel`, `daySlots`, `windowsFor` (`views/calendar.ts`). Each gets a trailing `slots?: SlotsByDate | null` passed to its inner call.

Then update every call site from this list to also pass `dataset.dayQuotas?.slots ?? null` (or `data.dayQuotas?.slots`):
`components/social-hub/calendar/CalendarScreen.tsx:43,122`, `lib/content-type/run-today-live.ts:72`, `lib/content-type/model.ts:115`, `lib/social-hub/views/day-rank.ts:155`, `lib/social-hub/views/today.ts:78,140`, `lib/social-hub/views/offer.ts:36`. After editing, run `grep -rn "lfdDays ?? \[\]" components lib` and make sure no call site was missed.

- [ ] **Step 4: `readDayQuotas` in template mode**

In `lib/social-hub/views/day-rank.ts` `DayQuotas`, add:

```ts
  /** The calendar's slots by date (template mode), today − 7 … today + 21; null or missing while legacy. */
  slots?: SlotsByDate | null;
```

In `lib/social-hub/queries/day.ts` `readDayQuotas(q, explainersQ, now = new Date())`:

```ts
  const today = nyDateOf(now)!;
  const plan = await slotPlan(q, addDays(today, -7), 29).catch(() => null);
  if (plan) {
    const slots = Object.fromEntries(plan.byDate) as SlotsByDate;
    const count = (v: Vertical) => (slots[today] ?? []).filter((s) => s.vertical === v).length;
    return { reels: count('reels'), carousels: count('carousels'), explainers: count('explainers'), last_few_days: count('last_few_days'), lfdDays: [], slots };
  }
  // …the existing legacy body, unchanged…
```

(`nyDateOf`/`addDays` from `lib/social-hub/time.ts`. Check `lib/social-hub/load.ts:66` and pass `now` if the loader has one.)

- [ ] **Step 5: Placement**

In `lib/social-hub/placement.ts` `planPlacement`, after `const window = …` resolves and before the `window.days` check:

```ts
  const plan = await slotPlan(query, input.nyDate, 1);
  if (plan) {
    const slot = slotsOn(plan, input.vertical, input.nyDate).find((s) => s.windowId === input.slot);
    if (!slot) return { ok: false, note: `${window.name} isn’t a ${TYPE_NAME[input.vertical]} slot on ${WEEKDAY[weekdayOf(input.nyDate)]}, ${input.nyDate}. Add it on the calendar first.` };
  } else if (window.days && !window.days.includes(weekdayOf(input.nyDate))) {
    return { ok: false, note: `${window.name} doesn’t post on ${WEEKDAY[weekdayOf(input.nyDate)]}s (it posts ${window.days.map((d) => WEEKDAY_SHORT[d]).join(', ')}).` };
  }
```

(This replaces the old `window.days` block.) Spacing then reads:

```ts
  const feedMode = await feedModeFor(query, input.vertical, input.nyDate, input.slot);
  if (rules.spaced || feedMode === 'main') {
```

and the same at line ~385 (`openSlots`). For Explainers, `rules.spaced` is true, but a Trial Explainer slot isn't spaced. So compute `const spaced = feedMode ? feedMode === 'main' : rules.spaced;` and use `spaced` in both places. Add `feedMode` to the `Planned` ok result. `placeItem` passes `feedMode: plan.feedMode` to `bookSlot`, and `rescheduleItem`'s UPDATE also sets `feed_mode = $5` with `plan.feedMode`.

In `placementRules`, the `carousels` and `last_few_days` branches skip `carouselOffDays`/LFD days when `await readSlotSource(query) === 'template'`. The windows then carry no `days`, and the slot check above decides.

- [ ] **Step 6: Posting settings**

In `lib/content-type/posting.ts`:
- `PostingState` gets `schedule: ScheduleDay[] | null` with `export type ScheduleDay = { nyDate: string; count: number; trial: number; main: number; series: string[]; override: boolean };`
- Add `async function weekSchedule(type: ContentType): Promise<ScheduleDay[] | null>`: `slotPlan(q, mondayOf(today), 7)` with `q = (t, p) => dbQuery(t, p)`, where `mondayOf` steps back to the most recent Monday using `weekdayOf`. Return null when the plan is null. Otherwise map each date to counts for `type`: `trial`/`main` from `feedMode`, `series` = window ids for stories, `override` = any slot with `origin === 'override'` or a `remove` override that day (the latter needs `readOverrides`). Keep it simple: `override: slots.some((s) => s.origin === 'override')`.
- `readPosting` sets `schedule: await weekSchedule(type)` on every branch's return.
- `writePosting` begins with:

```ts
  if ((patch.perDay !== undefined || patch.series?.days !== undefined) && (await readSlotSource((t, p) => dbQuery(t, p) as never)) === 'template') {
    throw new Error('Cadence moved to the calendar.');
  }
```

In `components/content-type/TypeControls.tsx` `PostingSettings`, after the Auto-publish switch: when `data.schedule` is non-null, render `<ScheduleStrip type={type} days={data.schedule} />` **instead of** the posts-per-day block and the series day buttons. The Enabled / Generate switches per series stay. When `data.schedule` is null, render exactly what's there today.

```tsx
// components/content-type/ScheduleStrip.tsx
import Link from 'next/link';

import type { ScheduleDay } from '@/lib/content-type/posting';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SERIES_SHORT: Record<string, string> = { morning_download: 'Morning Dl', guess_the_number: 'Guess #', free_vs_paid: 'Free/Paid' };

/** This week's slots for one type, read only; the calendar owns when (spec §4). */
export function ScheduleStrip({ type, days }: { type: string; days: ScheduleDay[] }) {
  const reel = type === 'reels' || type === 'explainers';
  return (
    <div className="rh-schedule">
      <p className="rh-settings__note">When this type posts is set on the calendar.</p>
      <ol className="rh-schedule__days">
        {days.map((d) => {
          const weekday = DAY[new Date(`${d.nyDate}T12:00:00Z`).getUTCDay()];
          return (
            <li key={d.nyDate} className={`rh-schedule__day${d.override ? ' rh-schedule__day--override' : ''}`} aria-label={`${weekday}: ${d.count} slot${d.count === 1 ? '' : 's'}`}>
              <span className="rh-schedule__weekday">{weekday}</span>
              <strong>{type === 'stories' ? (d.series.map((s) => SERIES_SHORT[s] ?? s).join(', ') || '—') : d.count}</strong>
              {reel && d.count ? <span className="rh-schedule__mode">{d.trial ? `${d.trial} trial` : ''}{d.trial && d.main ? ' · ' : ''}{d.main ? `${d.main} main` : ''}</span> : null}
            </li>
          );
        })}
      </ol>
      <Link className="rh-btn rh-btn--xs" href={`/social/calendar?view=week&type=${type}`}>Edit in Calendar →</Link>
    </div>
  );
}
```

Add `.rh-schedule*` styles next to `.rh-quota` in the stylesheet that defines `.rh-quota` (`grep -rn "rh-quota" app components --include=*.css`). Use that file's existing tokens: a 7-column grid, and the override day with the hub's accent border. No new colors.

- [ ] **Step 7: Run the tests**

Run: `npx tsx --test tests/slots-hub-views.test.ts tests/content-type.test.ts tests/social-hub-viewmodels.test.ts tests/social-hub-placement.test.ts tests/social-hub-run-today.test.ts tests/social-hub-scope.test.ts tests/lfd-hub.test.ts`
Expected: PASS. All legacy expectations unchanged.

- [ ] **Step 8: Commit**

```bash
git add lib/social-hub lib/content-type components/content-type components/social-hub/calendar/CalendarScreen.tsx tests/slots-hub-views.test.ts tests/content-type.test.ts
git commit -m "feat(slots): hub placement and views follow the calendar; type pages show a schedule strip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The week view (window grid + slot editor)

**Files:**
- Create: `lib/social-hub/views/week.ts`, `components/social-hub/calendar/WeekGrid.tsx`, `components/social-hub/calendar/SlotEditor.tsx`
- Modify: `components/social-hub/calendar/CalendarScreen.tsx` (Week | Month, This week | Template, `?type=` dimming, source switch), `app/social/(hub)/calendar/page.tsx` (load the week's slots + source), `app/social/(hub)/preview/calendar/page.tsx` (fixture week), `app/social/(hub)/hub-calendar.css`, `tests/social-hub-scope.test.ts` (register `SlotEditor` as a hub control)
- Test: `tests/slots-week.test.ts`

**Interfaces:**
- Consumes: `resolveDay`, `seedTemplate`, `DEFAULT_SEED_INPUTS` (preview), `loadSlots`, `readSlotSource`, `readTemplate`, `HubPost` (`slot.id`, `nyDate`, `status`, `refs`), `verticalInfo`, `typeStyle`/`TypeMark` (`components/social-hub/ui/marks`), `withParams`.
- Produces:
  - `ROWS: readonly WeekRow[]` with `type WeekRow = { id: string; label: string; startMinute: number; windows: ReadonlyArray<{ vertical: Vertical; windowId: string }> }`. The eight shared rows from the spec, in order: `stories` (8:30, all three series), `reel-morning` (8:45 reels morning), `feed-morning` (9:00 carousels morning + LFD morning), `reel-midday`, `explainer-afternoon` (1:00), `feed-afternoon` (2:30 carousels afternoon), `explainer-late` (3:30), `reel-evening` (6:00).
  - `type WeekChip = { vertical: Vertical; windowId: string; feedMode: FeedMode | null; origin: 'template' | 'override'; booked: HubPost | null }`
  - `type WeekCell = { nyDate: string | null; weekday: number; rowId: string; chips: WeekChip[]; blockedReason: string | null; editable: boolean; addable: Array<{ vertical: Vertical; windowId: string }> }`
  - `weekModel(input: { mode: 'week' | 'template'; days: Array<{ nyDate: string | null; weekday: number; slots: ResolvedSlot[] }>; posts: readonly HubPost[]; now: Date }): { columns: Array<{ nyDate: string | null; weekday: number; past: boolean; isToday: boolean }>; rows: Array<{ row: WeekRow; cells: WeekCell[] }> }`
  - `mondayOf(nyDate: string): string`
  - `SlotEditor` props: `{ cell: WeekCell; chip: WeekChip | null; scope: 'date' | 'template'; readOnly?: boolean }`

Rules the model enforces (and the tests pin):
- A cell's chips are the slots for that date whose `(vertical, windowId)` is in the row's windows.
- `blockedReason = 'LFD day'` for `feed-afternoon` and `feed-morning` cells on a day with an LFD slot, where the cell has no chip.
- `addable` = row windows not already chips, minus carousels on an LFD day, minus LFD on a day with carousels. Empty for past cells and for today's windows that have started.
- `booked` = the HubPost with `vertical`, `nyDate`, `slot.id === windowId`, and status in `scheduled | publishing | published`.
- `editable` = not past, and for today only windows not yet started. In template mode, always true.

- [ ] **Step 1: Write the failing test**

```ts
// tests/slots-week.test.ts
/** The week grid model (spec §3). Pure, offline. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDay } from '@/lib/social-hub/slots/resolve';
import { DEFAULT_SEED_INPUTS, seedTemplate } from '@/lib/social-hub/slots/seed';
import { mondayOf, ROWS, weekModel } from '@/lib/social-hub/views/week';
import { addDays, weekdayOf } from '@/lib/social-hub/time';
import type { HubPost } from '@/lib/social-hub/types';

const tpl = seedTemplate(DEFAULT_SEED_INPUTS);
const NOW = new Date('2026-10-20T14:00:00Z'); // Tue Oct 20, 10:00 AM New York
const week = (monday: string) => Array.from({ length: 7 }, (_, i) => {
  const nyDate = addDays(monday, i);
  return { nyDate, weekday: weekdayOf(nyDate), slots: resolveDay(tpl, [], nyDate) };
});

test('mondayOf steps back to Monday', () => {
  assert.equal(mondayOf('2026-10-20'), '2026-10-19');
  assert.equal(mondayOf('2026-10-25'), '2026-10-19');
  assert.equal(mondayOf('2026-10-19'), '2026-10-19');
});

test('eight rows in start order; Tuesday\'s 2:30 feed cell is an LFD day', () => {
  const m = weekModel({ mode: 'week', days: week('2026-10-19'), posts: [], now: NOW });
  assert.deepEqual(m.rows.map((r) => r.row.id), ROWS.map((r) => r.id));
  assert.equal(ROWS.length, 8);
  const feedAfternoon = m.rows.find((r) => r.row.id === 'feed-afternoon')!;
  assert.equal(feedAfternoon.cells[1]!.blockedReason, 'LFD day');
  assert.equal(feedAfternoon.cells[2]!.chips[0]!.vertical, 'carousels');
  const feedMorning = m.rows.find((r) => r.row.id === 'feed-morning')!;
  assert.equal(feedMorning.cells[1]!.chips[0]!.vertical, 'last_few_days');
});

test('Stories series for a day share one cell', () => {
  const m = weekModel({ mode: 'week', days: week('2026-10-19'), posts: [], now: NOW });
  const stories = m.rows.find((r) => r.row.id === 'stories')!;
  assert.deepEqual(stories.cells[0]!.chips.map((c) => c.windowId), ['morning_download', 'guess_the_number']); // Monday
});

test('past days and started windows are not editable; later ones are', () => {
  const m = weekModel({ mode: 'week', days: week('2026-10-19'), posts: [], now: NOW });
  const reelMorning = m.rows.find((r) => r.row.id === 'reel-morning')!;
  assert.equal(reelMorning.cells[0]!.editable, false); // Monday, past
  assert.equal(reelMorning.cells[1]!.editable, false); // today 8:45, started
  const reelEvening = m.rows.find((r) => r.row.id === 'reel-evening')!;
  assert.equal(reelEvening.cells[1]!.editable, true);  // today 6:00 PM
});

test('a booked post shows on its chip; addable never offers Carousel on an LFD day', () => {
  const post = { id: 'p', vertical: 'carousels', nyDate: '2026-10-21', status: 'scheduled', slot: { id: 'morning', label: '' }, refs: { postId: 'x' } } as unknown as HubPost;
  const days = week('2026-10-19');
  days[1]!.slots = days[1]!.slots.filter((s) => s.vertical !== 'last_few_days'); // Tue without LFD
  days[4]!.slots = days[4]!.slots; // Fri keeps LFD
  const m = weekModel({ mode: 'week', days, posts: [post], now: NOW });
  const feedMorning = m.rows.find((r) => r.row.id === 'feed-morning')!;
  assert.equal(feedMorning.cells[2]!.chips[0]!.booked?.id, 'p');
  assert.deepEqual(feedMorning.cells[4]!.addable, []); // Friday: LFD holds 9:00, no Carousel offered
  assert.ok(feedMorning.cells[1]!.addable.some((a) => a.vertical === 'carousels')); // Tuesday without LFD
});

test('template mode has no dates and everything is editable', () => {
  const days = Array.from({ length: 7 }, (_, i) => ({ nyDate: null, weekday: (i + 1) % 7, slots: resolveDay(tpl, [], addDays('2026-10-19', i)) }));
  const m = weekModel({ mode: 'template', days, posts: [], now: NOW });
  assert.ok(m.rows.every((r) => r.cells.every((c) => c.editable)));
  assert.ok(m.columns.every((c) => c.nyDate === null));
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx tsx --test tests/slots-week.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `views/week.ts`**

```ts
// lib/social-hub/views/week.ts
import { nyDateOf, nyDayStart, weekdayOf, addDays } from '@/lib/social-hub/time';
import type { FeedMode, ResolvedSlot } from '@/lib/social-hub/slots/types';
import type { HubPost, Vertical } from '@/lib/social-hub/types';
import { PLAN } from '@/lib/social-hub/views/plan';

/** The week grid (spec §3, layout A): rows are shared time windows, columns are days. Pure. */

export type WeekRow = { id: string; label: string; startMinute: number; windows: ReadonlyArray<{ vertical: Vertical; windowId: string }> };

const at = (v: Vertical, id: string) => PLAN[v].find((w) => w.id === id)!.startMinute;

export const ROWS: readonly WeekRow[] = [
  { id: 'stories', label: 'Stories', startMinute: at('stories', 'morning_download'), windows: [{ vertical: 'stories', windowId: 'morning_download' }, { vertical: 'stories', windowId: 'guess_the_number' }, { vertical: 'stories', windowId: 'free_vs_paid' }] },
  { id: 'reel-morning', label: 'Reel', startMinute: at('reels', 'morning'), windows: [{ vertical: 'reels', windowId: 'morning' }] },
  { id: 'feed-morning', label: 'Feed', startMinute: at('carousels', 'morning'), windows: [{ vertical: 'carousels', windowId: 'morning' }, { vertical: 'last_few_days', windowId: 'morning' }] },
  { id: 'reel-midday', label: 'Reel', startMinute: at('reels', 'midday'), windows: [{ vertical: 'reels', windowId: 'midday' }] },
  { id: 'explainer-afternoon', label: 'Explainer', startMinute: at('explainers', 'afternoon'), windows: [{ vertical: 'explainers', windowId: 'afternoon' }] },
  { id: 'feed-afternoon', label: 'Feed', startMinute: at('carousels', 'afternoon'), windows: [{ vertical: 'carousels', windowId: 'afternoon' }] },
  { id: 'explainer-late', label: 'Explainer', startMinute: at('explainers', 'late'), windows: [{ vertical: 'explainers', windowId: 'late' }] },
  { id: 'reel-evening', label: 'Reel', startMinute: at('reels', 'evening'), windows: [{ vertical: 'reels', windowId: 'evening' }] },
];

export type WeekChip = { vertical: Vertical; windowId: string; feedMode: FeedMode | null; origin: 'template' | 'override'; booked: HubPost | null };

export type WeekCell = {
  nyDate: string | null;
  weekday: number;
  rowId: string;
  chips: WeekChip[];
  blockedReason: string | null;
  editable: boolean;
  addable: Array<{ vertical: Vertical; windowId: string }>;
};

export type WeekDayInput = { nyDate: string | null; weekday: number; slots: ResolvedSlot[] };

const HOLDS = new Set(['scheduled', 'publishing', 'published']);

export function mondayOf(nyDate: string): string {
  const back = (weekdayOf(nyDate) + 6) % 7;
  return addDays(nyDate, -back);
}

export function weekModel(input: { mode: 'week' | 'template'; days: WeekDayInput[]; posts: readonly HubPost[]; now: Date }) {
  const today = nyDateOf(input.now)!;
  const columns = input.days.map((d) => ({ nyDate: d.nyDate, weekday: d.weekday, past: d.nyDate != null && d.nyDate < today, isToday: d.nyDate === today }));
  const rows = ROWS.map((row) => ({
    row,
    cells: input.days.map((d): WeekCell => {
      const inRow = (v: Vertical, id: string) => row.windows.some((w) => w.vertical === v && w.windowId === id);
      const chips = d.slots.filter((s) => inRow(s.vertical, s.windowId)).map((s): WeekChip => ({
        vertical: s.vertical,
        windowId: s.windowId,
        feedMode: s.feedMode,
        origin: s.origin,
        booked: d.nyDate ? input.posts.find((p) => p.vertical === s.vertical && p.nyDate === d.nyDate && p.slot?.id === s.windowId && HOLDS.has(p.status)) ?? null : null,
      }));
      const lfdDay = d.slots.some((s) => s.vertical === 'last_few_days');
      const carouselDay = d.slots.some((s) => s.vertical === 'carousels');
      const started = (minute: number) => d.nyDate === today && nyDayStart(today).getTime() + minute * 60_000 <= input.now.getTime();
      const editable = input.mode === 'template' || (d.nyDate != null && d.nyDate >= today && !started(row.startMinute));
      const addable = !editable ? [] : row.windows.filter((w) =>
        !chips.some((c) => c.vertical === w.vertical && c.windowId === w.windowId)
        && !(w.vertical === 'carousels' && lfdDay)
        && !(w.vertical === 'last_few_days' && (carouselDay || chips.length > 0)));
      const blockedReason = chips.length === 0 && lfdDay && row.windows.some((w) => w.vertical === 'carousels') ? 'LFD day' : null;
      return { nyDate: d.nyDate, weekday: d.weekday, rowId: row.id, chips, blockedReason, editable, addable: [...addable] };
    }),
  }));
  return { columns, rows };
}
```

Note: adding LFD to a day that has Carousels is still possible from the editor. It's offered from the chip editor of a Carousel cell ("Make this a Last Few Days day"), which sends the LFD add plus both Carousel removes in one request (spec §3). `addable` leaves LFD out of a Carousel day so the plain "+" never makes a save that will be refused.

- [ ] **Step 4: `WeekGrid.tsx` (server component)**

Render with existing hub building blocks: `PageHead`, `TypeMark`/`typeStyle` for type color, the `sh-` class prefix. Structure:

```tsx
// components/social-hub/calendar/WeekGrid.tsx
import { SlotEditor } from '@/components/social-hub/calendar/SlotEditor';
import { TypeMark, typeStyle } from '@/components/social-hub/ui/marks';
import { minuteLabel } from '@/lib/social-hub/views/plan';
import { WEEKDAY_SHORT } from '@/lib/social-hub/time';
import { verticalInfo } from '@/lib/social-hub/verticals';
import type { Vertical } from '@/lib/social-hub/types';
import type { weekModel } from '@/lib/social-hub/views/week';

/** The window grid (spec §3): rows are time windows, columns are days; click a chip or + to edit. */
export function WeekGrid({ model, scope, dim, readOnly }: { model: ReturnType<typeof weekModel>; scope: 'date' | 'template'; dim: Vertical | null; readOnly: boolean }) {
  return (
    <div className="sh-week" role="table" aria-label={scope === 'template' ? 'Weekly template' : 'This week'}>
      <div className="sh-week__head" role="row">
        <span role="columnheader" />
        {model.columns.map((c) => (
          <span key={`${c.weekday}-${c.nyDate}`} role="columnheader" className={`sh-week__col${c.isToday ? ' is-today' : ''}${c.past ? ' is-past' : ''}`}>
            {WEEKDAY_SHORT[c.weekday]}{c.nyDate ? ` ${Number(c.nyDate.slice(8, 10))}` : ''}
          </span>
        ))}
      </div>
      {model.rows.map(({ row, cells }) => (
        <div key={row.id} className="sh-week__row" role="row">
          <span role="rowheader" className="sh-week__time">{minuteLabel(row.startMinute)} {row.label}</span>
          {cells.map((cell) => (
            <div key={`${row.id}-${cell.weekday}-${cell.nyDate}`} role="cell" className="sh-week__cell">
              {cell.chips.map((chip) => (
                <SlotEditor key={`${chip.vertical}-${chip.windowId}`} cell={cell} chip={chip} scope={scope} readOnly={readOnly || !cell.editable}
                  label={`${verticalInfo(chip.vertical).short}${chip.feedMode ? ` · ${chip.feedMode === 'trial' ? 'Trial' : 'Main'}` : ''}`}
                  dimmed={dim !== null && dim !== chip.vertical} />
              ))}
              {cell.chips.length === 0 && cell.blockedReason ? <span className="sh-week__blocked">{cell.blockedReason}</span> : null}
              {cell.addable.length && !readOnly ? <SlotEditor cell={cell} chip={null} scope={scope} label="+" dimmed={false} /> : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

Chips get type color via the chip button's `style={typeStyle(chip.vertical)}` inside `SlotEditor`, the existing pattern used by month marks. The override marker is a `data-origin="override"` attribute styled in CSS. The booked marker is `data-booked="true"`.

- [ ] **Step 5: `SlotEditor.tsx` (client)**

A `'use client'` component: a button (the chip, or "+") that opens a `<dialog>` popover, following `ActionBar.tsx`'s dialog/pending/note pattern. It contains:
- Reel types: a Trial / Main segmented toggle.
- Date scope: an "Apply to" toggle, `Just <Mon Oct 20>` / `Every <Tuesday>`. Template scope shows no toggle.
- "+": a picker over `cell.addable` (type + window name), and for reel types the Trial/Main toggle (default Trial for `reels`, Main for `explainers`).
- A carousel chip on a date: an extra action, "Make this a Last Few Days day", which sends the LFD add plus a remove for every Carousel slot that day, and says so first: "This also removes <day>'s N Carousel slots."
- "Remove slot".
- Save → `POST /api/social-hub/slots` with the change(s):
  - Just this date: `{ scope: 'date', op: 'put', nyDate, vertical, windowId, action: 'add' | 'remove', feedMode }`
  - Every weekday: `{ scope: 'template', op: 'put' | 'delete', weekday, vertical, windowId, feedMode }`
- On **409**: show "N post(s) booked here." with two buttons:
  - **Move back to ready** (default, focused): for each booked post, `POST /api/social-hub/actions/unschedule` with `{ vertical, refs }`. Then re-POST the same changes. Show any unschedule failure's `note` and stop.
  - **Keep it**: re-POST with `keepBooked: true`.
- On **422**: show the `errors` list inline.
- On success: `router.refresh()`.
- `readOnly` (preview, past, started) renders the chip as a plain span.

Accessibility: the chip is a `<button>` with `aria-label` "Tue Oct 20, 8:45 AM, Text on Screen, Main feed, override, 1 post booked". The dialog has a title, Escape closes it, and focus returns to the chip.

Register it with the scope guard in `tests/social-hub-scope.test.ts`:

```ts
const HUB_CONTROLS = new Set([...existing entries..., 'components/social-hub/calendar/SlotEditor.tsx']);
const CONTROL_ENDPOINTS = /^\/api\/(content-type\/(posting|run-today|progress|idea-rank)|social-hub\/(slots|actions\/unschedule))\b/;
```

Read the scope test's check for `HUB_CONTROLS` (below line 200) and confirm it validates each `fetch` target against `CONTROL_ENDPOINTS`. If it does, keep every `fetch` URL in `SlotEditor` a literal string starting with one of those paths.

- [ ] **Step 6: Wire `CalendarScreen` and the pages**

`CalendarScreen` gets new props: `week?: { mode: 'week' | 'template'; monday: string; days: WeekDayInput[]; source: SlotSource } | null`. `params` gains `view` (`'week' | 'month'`, default `'week'` when `SOCIAL_HUB_FLAGS.views.calendarWeek`), `scope` (`'date' | 'template'`), `week` (a Monday), and `type`.

- Header toggles are links built with `withParams`: `Week | Month`, `This week | Template`, `‹ Oct 19 – 25 ›`, all following the month header's prev/Today/next pattern.
- Week view renders `<WeekGrid model={weekModel({...})} scope=… dim={isVertical(params.type) ? params.type : null} readOnly={!actionEnabled('editSlots') || readOnly} />`.
- Month view stays exactly as it is.
- In legacy mode, a notice above the grid reads: "The calendar is showing today’s settings. It starts deciding when you switch it on." It has a **Switch on** button, which posts `{ source: 'template' }` to `/api/social-hub/slots/source` (a confirm first: "From now on the calendar decides what posts when. Today’s pattern is copied in, so nothing changes until you edit it."). In template mode the notice is a small **Switch back to type settings** link with its own confirm. Put this button inside `SlotEditor.tsx`'s module as an exported `SourceSwitch` client component, so the one registered control file holds every slot fetch.

`app/social/(hub)/calendar/page.tsx`: when `params.view !== 'month'`:

```ts
const q = (t: string, p?: unknown[]) => dbQuery(t, p) as Promise<{ rows: any[] }>;
const source = await readSlotSource(q);
const monday = isDayKey(params.week) ? mondayOf(params.week) : mondayOf(nyDateOf(now)!);
let days: WeekDayInput[];
if (params.scope === 'template') {
  const template = source === 'template' ? await readTemplate(q) : seedTemplate(await readSeedInputs(q));
  days = [1, 2, 3, 4, 5, 6, 0].map((weekday, i) => ({ nyDate: null, weekday, slots: resolveDay(template, [], addDays(monday, i)) }));
} else if (source === 'template') {
  const map = await loadSlots(q, monday, addDays(monday, 6));
  days = [...map].map(([nyDate, slots]) => ({ nyDate, weekday: weekdayOf(nyDate), slots }));
} else {
  // Legacy: show today's pattern (read only) so the view isn't empty before the switch.
  const template = seedTemplate(await readSeedInputs(q));
  days = Array.from({ length: 7 }, (_, i) => { const d = addDays(monday, i); return { nyDate: d, weekday: weekdayOf(d), slots: resolveDay(template, [], d) }; });
}
```

In legacy mode, pass `readOnly` to the grid (editing only works once the switch is on). This keeps "slots are literal" honest: what the grid shows is what will run.

`app/social/(hub)/preview/calendar/page.tsx`: build the same `days` from `seedTemplate(DEFAULT_SEED_INPUTS)` for the week of `FIXTURE_NOW`, `source: 'template'`, `readOnly: true`. It must not import `load`, `db` or `queries` (scope test: preview never touches the database).

- [ ] **Step 7: CSS**

In `app/social/(hub)/hub-calendar.css`, add `.sh-week*` using the file's existing custom properties (`--sh-v-*` for type colors, the month grid's border/radius/spacing tokens). No new colors.
- An 8-column CSS grid: `minmax(5.5rem, auto)` for the time column, then `repeat(7, minmax(0, 1fr))`.
- Chips use the type's `colorVar` as background tint, matching the month marks.
- `[data-origin="override"]` gets the accent outline.
- `[data-booked="true"]` gets the dark inset left edge.
- `.is-past` is dimmed.
- At `max-width: 720px` the grid scrolls horizontally *inside* `.sh-week`, so the page itself never scrolls sideways: `overflow-x: auto` on the wrapper, with a 16px side gutter kept by the page.

- [ ] **Step 8: Run the tests and look at it**

Run: `npx tsx --test tests/slots-week.test.ts tests/social-hub-scope.test.ts tests/social-hub-preview.test.ts tests/social-hub-routes.test.ts`
Expected: PASS.

Then the visual check. Start the preview with `preview_start` (the project's `.claude/launch.json` dev entry), open `/social/preview/calendar?view=week`, and check:
- the grid shows 8 rows by 7 days;
- Tue and Fri show LFD at 9:00 and "LFD day" at 2:30;
- the Stories cells merge series;
- light and dark mode both work;
- at 375px width the grid scrolls inside its box.
Take a screenshot for the user.

- [ ] **Step 9: Commit**

```bash
git add lib/social-hub/views/week.ts components/social-hub/calendar app/social/'(hub)'/calendar app/social/'(hub)'/preview/calendar app/social/'(hub)'/hub-calendar.css tests/slots-week.test.ts tests/social-hub-scope.test.ts
git commit -m "feat(calendar): week view as a window grid with a slot editor and the source switch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Docs, the full suite, and the hand-off for deploy and cutover

**Files:**
- Modify: `docs/social-overnight.md` (the clock table says the calendar decides days in template mode), `planning/Social Hub/DECISIONS_LOG.md` (a new decision entry), `docs/trial-reels.md` (a Text on Screen slot may be Main feed)

- [ ] **Step 1: DECISIONS_LOG entry**

Append a new entry, numbered after the last `D<n>` in the file:

```markdown
## D<n> — The calendar owns cadence (weekly slot calendar), 2026-10-15

Lucas asked for the Calendar to be where posting days are managed. Decided
with Tommy (spec docs/superpowers/specs/2026-10-14-weekly-slot-calendar-design.md):
a standing weekly template of slots (a type in one of its own windows) plus
single-date overrides; Week is the Calendar's default view (supersedes SH-11
"no week view" and the read-only part of SH-13; SH-62's cadence change lands
here). Trial / Main feed is per slot, reel types only; a Main-feed reel is
spaced like any feed post (D33 applies to Trial only). Posts per day, Last Few
Days days and Stories series days stop being settings once
social_hub.settings slot_source = 'template'; a day with a Last Few Days slot
never runs Carousels, paused or not. Rollback: slot_source = 'legacy'.
```

- [ ] **Step 2: social-overnight.md and trial-reels.md**

`docs/social-overnight.md`: under the clock table, add a short paragraph: "While `social_hub.settings.slot_source` is `template`, each run fills that date's calendar slots instead of `posts_per_day`, Last Few Days runs on dates with an LFD slot, and Stories series post on dates with their slot. `legacy` is the old behavior." Then update the 3 AM row's note for the literal-LFD rule.

`docs/trial-reels.md`, near line 314: "A Text on Screen slot set to Main feed posts as a regular reel (no trial params, shared to the feed). Force post with no slot still posts as a trial reel."

- [ ] **Step 3: Full suite**

Run: `npm test`
Expected: PASS, with no new failures compared with `git stash; npm test; git stash pop` run on the starting commit. If a failure existed before this work, list it in the report rather than fixing it here.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add docs/social-overnight.md docs/trial-reels.md "planning/Social Hub/DECISIONS_LOG.md"
git commit -m "docs(slots): the calendar owns cadence (decision log, overnight clock, trial reels)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Hand-off report (no live actions)**

Report to Tommy, and do none of these yourself:
1. **Apply the schema** (Tommy): `node scripts/apply_social_hub_schema.js --apply`. Check it: `psql "$DATABASE_URL" -X -c "BEGIN READ ONLY; SELECT value FROM social_hub.settings WHERE key = 'slot_source'; ROLLBACK;"` returns `"legacy"`.
2. **Deploy the workers** in the same session as the merge, when Tommy says go: `./scripts/gcp/deploy-social-worker.sh`. Also run `./scripts/gcp/deploy-worker-code.sh` if `git diff --stat` shows changes to files the orchestration worker imports (`scripts/orchestration_worker.ts` import graph; at minimum check `lib/instagram/*`).
3. **Cutover checklist** (spec §5): parity test green and deploy done; review the seeded week in Calendar → Template; if Last Few Days is paused, decide whether Tue/Fri should go back to Carousels and edit the template first; press **Switch on**; watch one night. Rollback is **Switch back to type settings**.

---

## Self-review notes (done while writing)

- **Spec coverage:** §1 data model → Task 1 (+ seed in Tasks 2/4). §2 resolver/validation → Task 2. §3 calendar UI → Task 9. §4 type pages + API → Tasks 4, 8. §5 cutover, feed mode, spacing, deploy → Tasks 3, 5, 6, 7, 10. §6 testing → every task. Out-of-scope items aren't built.
- **One deliberate deviation from the spec text:** the spec's "legacy adapter" is implemented as "the seam returns null and each call site runs its existing code". This gives the same behavior, and legacy mode is literally today's code. The parity test (Task 2) proves the seed matches it.
- **Second deviation:** "move back to ready" runs on the client through the existing unschedule action route, not inside `applySlotChanges`. This keeps one unschedule path (spec §4 asks for reuse) and keeps `write.ts` from writing outside `social_hub`.
- **Type names checked across tasks:** `SlotPlan`, `slotPlan`, `slotsOn`, `nonSlotKeys`, `feedModeKeys`, `isLfdDay`, `feedModeFor`, `bookingFeedMode`, `legacyFeedMode`, `quotaFromSlots`, `storiesDueOn`, `SlotsByDate`, `ResolvedSlot`, `SlotChange`, `applySlotChanges`, `setSlotSource`, `weekModel`, `ROWS`, `mondayOf`.
