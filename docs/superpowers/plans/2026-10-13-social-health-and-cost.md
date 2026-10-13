# Social Hub Health Tab and Cost Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Health tab, which shows whether each content type worked each night and why not, and a Cost page inside Analytics, which shows usage spend, budget pace, worth and waste. Both pages are built on one shared failure record that every content type reports into.

**Architecture:**
- **Reporters.** Each content type has a *reporter*. It turns that type's own tables into a common `NightReport` (target, made, posted, funnel, failures, spend).
- **Pure core.** Pure functions turn reports into verdicts, problems, streaks and page view models.
- **Morning report.** A 7:30 AM job inside the existing social worker loop saves one report per night to `social_hub.health_reports`.
- **Cost data.** The Cost page reads the existing cost ledger uncached (`readCosts` → `buildLedger` → `allocate`). Ledger rows are extended with `vendor` and `mode` and aggregated in pure code.
- **No model calls.** Every sentence on both pages comes from code templates.

**Tech Stack:**
- Next.js App Router server components, plus small client components for hover and toggles.
- Postgres via `HubQuery`; PGlite in tests.
- `node:test` through `tsx --test`.
- Hand-drawn SVG charts. No chart library.

**Spec:** `docs/superpowers/specs/2026-10-13-social-health-and-cost-design.md`. Read it first. The approved mockups `health-v5d.html` and `cost-v3.html` are in `.superpowers/brainstorm/86518-1791921162/content/`.

**One deliberate deviation from the spec:**
- **Spec §4.3:** a systemd timer runs the 7:30 job.
- **This plan:** the job runs as another clock inside `scripts/social_worker.ts`.
- **Why:** this follows the existing 5:45 hub sweep pattern (`nextRunAt` + loop check). The behavior is the same, and the worker has fewer moving parts.

## Global Constraints

- **No live model or vendor calls.** No Claude API call, `web_search` or Meta call anywhere in this feature or its tests (CLAUDE.md Rule 1). "Copy for Claude" only writes to the clipboard.
- **Reads only.** The only writes this feature makes are to `social_hub.health_reports` and the new `stories.sets.mode` column default. Nothing sweeps or enriches pipeline data (CLAUDE.md Rule 2).
- **Type names come from `VERTICALS`** (`lib/social-hub/verticals.ts`): "Text on Screen", "Explainer Reels", "Carousels", "IG Stories". Never hard-code "Trial Reels".
- **Every type list loops over `VERTICAL_IDS` / `VERTICALS`.** The reporter registry is a `Record<Vertical, Reporter>`, so a new type is a compile error until it has a reporter.
- **Times are America/New_York.** A *night* `N` is the cycle from 08:00 on `N−1` to 07:30 on `N`. "Posted" judges posts scheduled for `N−1`.
- **Status thresholds are copied from the spec:**
  - heartbeat stale after 5 minutes (`HEARTBEAT_STALE_MS`);
  - near cap at 90% or more;
  - Fixed after 7 quiet nights, Almost at 6;
  - Back again after a gap of 3 or more quiet nights;
  - hover "≈" within ±8% of the series' own 7-day average.
- **Hub page rules:**
  - each page checks its view flag, then `getSession()`, then sets `dynamic='force-dynamic'`;
  - every live `page.tsx` has a `preview/` mirror (enforced by `tests/social-hub-routes.test.ts`);
  - no GET `<form>` and no native `<select>` in hub `.tsx` files;
  - type sizes are in px (DESIGN.md Pixel Root Rule) and never below 12px;
  - numbers use tabular figures;
  - motion respects `prefers-reduced-motion`, and animations use transform and opacity only.
- **Git:** commit on the current branch only. Never create, switch or merge branches (memory: branch hygiene). `git add` only the files the task names, because the tree has unrelated uncommitted work.
- **Worker sync:** any change to `scripts/social_worker.ts` or to code it imports is followed in the same session by `./scripts/gcp/deploy-social-worker.sh`. This is Task 9.
- **Test commands:**
  - `npx tsx --test tests/<file>.test.ts` for one file;
  - `npm test` for all;
  - `npx tsc --noEmit` for types.

## Review Focus

1. **A type that is switched off,** or has a quota of 0, must show grey "Didn't run" on that night, never red. *Pinned in Task 1:* `checksFor` with `due:false`.
2. **One reporter throwing** (for example, the Explainers database is unreachable from the VM) must not break the night or the page. That type shows a yellow "Couldn't read this type's data" and the others are unaffected. *Pinned in Task 6:* the `buildNight` reporter-error test.
3. **DST nights** must have correct cycle bounds. On 2026-11-01 New York falls back, so the night of 2026-11-02 runs from 2026-11-01 08:00 EST to 2026-11-02 07:30 EST. *Pinned in Task 1:* the `cycleBounds` DST test.
4. **HeyGen rows with unknown cost** (`usd_known=false`) must never make a day look cheap. The model counts them as "N calls with unknown cost" and never as $0. *Pinned in Task 11:* the `costModel` unknown-cost test.
5. **A series with no spend in the previous 7 days** (a new type, or a quiet week) must show the hover change as "new", not `Infinity` or `NaN`. *Pinned in Task 11:* the `hoverCompare` zero-average test.

---

## File map

**Health core** (`lib/social-hub/health/`)

| File | Purpose |
|---|---|
| `types.ts` | `NightReport`, `FailureEvent`, `Tone`, `Check`, `TypeVerdict`, `NightVerdict`, `StoredReport` |
| `time.ts` | `cycleBounds`, `reportNightFor`, `nightsEnding`, `weekdayIndex` |
| `verdict.ts` | Status rules (spec §4.4) |
| `reasons.ts` | Raw error → reason code; reason and stage labels |
| `problems.ts` | Problem grouping, Back again, Fixed and Almost; streaks |
| `reporters/shared.ts` | Publishing (scheduled and posted yesterday, retries, placed and filled today), quota, funnel helper |
| `reporters/carousels.ts`, `reporters/reels.ts`, `reporters/explainers.ts`, `reporters/stories.ts` | One reporter per type |
| `night.ts` | Reporter registry, `buildNight`, publisher heartbeat |
| `store.ts` | `saveReport`, `readReports` |
| `job.ts` | `runMorningReport` (today plus missing-night backfill) |
| `readiness.ts` | 30-day approved-as-is and rejection rates per type |
| `brief.ts` | Copy-for-Claude markdown |
| `view.ts` | `healthModel`: headline, chips, rows, hover data, problems, fixed, readiness |
| `load.ts` | Live loader for the page |

**Cost core** (`lib/social-hub/cost-page/`)

| File | Purpose |
|---|---|
| `normalize.ts` | Component → stage and vendor |
| `rows.ts` | `LedgerRow` → `CostRow`, including the carousel stage split |
| `waste.ts` | Waste classification SQL plus a pure classifier |
| `caching.ts` | Prompt-caching savings |
| `model.ts` | `costModel`, `dailySeries`, `hoverCompare`, `spikeDrivers`, `pace` |
| `load.ts` | Live loader |

**Modified**

| File | Change |
|---|---|
| `lib/social-hub/cost.ts` | `LedgerRow` gains `vendor?`, `mode?`, `unknown?` |
| `lib/social-hub/queries/costs.ts` | COST_SQL and CostReads gain vendor, production and unknown; `buildLedger` sets them |
| `lib/anthropic-pricing.ts` | Export `cacheReadMultiplier` |
| `db/social_hub_schema.sql` | `social_hub.health_reports` |
| `db/stories_schema.sql` | `stories.sets.mode` |
| `lib/stories/repository.ts` | Writes `mode` |
| `lib/social/overnight/config.ts` | `HEALTH_REPORT_HOUR_LOCAL` and `HEALTH_REPORT_MINUTE_LOCAL` |
| `scripts/social_worker.ts` | The 7:30 clock |
| `lib/social-hub/flags.ts` | `ViewFlag` adds `health` and `cost` |
| `lib/social-hub/views/nav.ts` | Health tab, section and crumbs |
| `app/social/(hub)/layout.tsx` | Imports `hub-ops.css` |
| `app/social/(hub)/analytics/layout.tsx` | Analytics sub-nav |
| `DESIGN.md` | Scoped green amendment and the Text on Screen rename |
| `tests/social-hub-nav.test.ts` | Covers four tabs |

**UI** (`components/social-hub/health/*`, `components/social-hub/cost/*`, `app/social/(hub)/hub-ops.css`)

**Routes**

| Route | Live page | Preview mirror |
|---|---|---|
| Health | `app/social/(hub)/health/page.tsx` | `app/social/(hub)/preview/health/page.tsx` |
| Night detail | `app/social/(hub)/health/night/[date]/page.tsx` | `app/social/(hub)/preview/health/night/[date]/page.tsx` |
| Cost | `app/social/(hub)/analytics/cost/page.tsx` | `app/social/(hub)/preview/analytics/cost/page.tsx` |

**Fixtures**
- `tests/fixtures/social-hub/health-fixture.ts`
- `tests/fixtures/social-hub/cost-fixture.ts`

---

### Task 1: Health types, night clock and status rules

**Files:**
- Create: `lib/social-hub/health/types.ts`
- Create: `lib/social-hub/health/time.ts`
- Create: `lib/social-hub/health/verdict.ts`
- Test: `tests/social-health-verdict.test.ts`

**Interfaces:**
- **Consumes:**
  - `zonedTime(y, m, d, hour, minute, tz)` from `lib/instagram/clock.ts` (month is 1-based);
  - `addDays`, `nyDateOf` from `lib/social-hub/time.ts`;
  - `Vertical` from `lib/social-hub/types.ts`.
- **Produces:**
  - all types below;
  - `cycleBounds(night): {start: Date; end: Date}`, `reportNightFor(now: Date): string`, `nightsEnding(night: string, n: number): string[]` (ascending), `weekdayIndex(night: string): number` (0 = Sunday);
  - `checksFor(r: NightReport, publisher: Tone): Check[]`, `typeVerdict(r: NightReport, publisher: Tone): TypeVerdict`, `nightVerdict(night: string, reports: NightReport[], publisher: Tone): NightVerdict`, `worst(tones: Tone[]): Tone`.

- [ ] **Step 1: Write `types.ts`. These are types only, so there is no test.**

```ts
import type { Vertical } from '@/lib/social-hub/types';

/** Health colors: worked = green, short = yellow, failed = red, none = grey (didn't run / unknown). */
export type Tone = 'worked' | 'short' | 'failed' | 'none';
export type Severity = 'failed' | 'healed' | 'warning';

export type FailureEvent = {
  vertical: Vertical;
  night: string;
  at: string;
  stage: string;
  reason: string;
  severity: Severity;
  item?: { kind: string; id: string; label: string; href?: string };
  rawError?: string;
  spentUsd?: number;
  runId?: string;
};

export type FunnelStep = { stage: string; in: number; out: number };

export type NightReport = {
  vertical: Vertical;
  night: string;
  /** The type was live and had a quota that night. false → grey "Didn't run". */
  due: boolean;
  ran: boolean;
  target: number;
  made: number;
  /** Slots the day needs (the quota). */
  needed: number;
  /** Filled slots plus fresh drafts waiting for them. */
  ready: number;
  scheduledYesterday: number;
  postedYesterday: number;
  retriedOk: number;
  funnel: FunnelStep[];
  failures: FailureEvent[];
  spendUsd: number;
  /** Production calls whose cost is unknown (HeyGen). */
  unknownCostCalls: number;
  feedsStale: string[];
  nearCap: boolean;
  /** Set when this type's reporter threw; its checks go grey and Plumbing goes yellow. */
  reportError: string | null;
};

export type CheckId = 'made' | 'ready' | 'posted' | 'plumbing';
export type Check = { id: CheckId; tone: Tone; note: string };
export type TypeVerdict = { vertical: Vertical; tone: Tone; checks: Check[]; cause: string | null };
export type NightVerdict = { night: string; types: TypeVerdict[]; worked: number; total: number; publisher: Tone };
export type StoredReport = { night: string; builtAt: string; verdict: NightVerdict; reports: NightReport[]; failures: FailureEvent[] };
```

- [ ] **Step 2: Write the failing tests.** These cover the verdict rules and the clock, including DST and switched-off types.

```ts
// tests/social-health-verdict.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { cycleBounds, nightsEnding, reportNightFor, weekdayIndex } from '@/lib/social-hub/health/time';
import type { NightReport } from '@/lib/social-hub/health/types';
import { checksFor, nightVerdict, typeVerdict, worst } from '@/lib/social-hub/health/verdict';

const base = (over: Partial<NightReport> = {}): NightReport => ({
  vertical: 'carousels', night: '2026-10-13', due: true, ran: true, target: 1, made: 1, needed: 1, ready: 1,
  scheduledYesterday: 1, postedYesterday: 1, retriedOk: 0, funnel: [], failures: [], spendUsd: 1.2,
  unknownCostCalls: 0, feedsStale: [], nearCap: false, reportError: null, ...over,
});

test('a clean night is green on every check', () => {
  assert.deepEqual(checksFor(base(), 'worked').map((c) => c.tone), ['worked', 'worked', 'worked', 'worked']);
  assert.equal(typeVerdict(base(), 'worked').tone, 'worked');
});

test('made fewer than the target is red, even by one', () => {
  const v = typeVerdict(base({ target: 3, made: 2, ready: 2, needed: 3 }), 'worked');
  assert.equal(v.checks[0]!.tone, 'failed');
  assert.equal(v.tone, 'failed');
});

test('a type that is switched off is grey, never red', () => {
  const v = typeVerdict(base({ due: false, ran: false, made: 0, target: 0, needed: 0, ready: 0 }), 'worked');
  assert.equal(v.tone, 'none');
});

test('a scheduled post that never went out is red; one that needed a retry is yellow', () => {
  assert.equal(checksFor(base({ scheduledYesterday: 2, postedYesterday: 1 }), 'worked')[2]!.tone, 'failed');
  assert.equal(checksFor(base({ retriedOk: 1 }), 'worked')[2]!.tone, 'short');
});

test('ready: none waiting is red, fewer than needed is yellow', () => {
  assert.equal(checksFor(base({ ready: 0, needed: 2 }), 'worked')[1]!.tone, 'failed');
  assert.equal(checksFor(base({ ready: 1, needed: 2 }), 'worked')[1]!.tone, 'short');
});

test('plumbing: dead publisher red, stale feed or near cap yellow, reporter error yellow with grey checks', () => {
  assert.equal(checksFor(base(), 'failed')[3]!.tone, 'failed');
  assert.equal(checksFor(base({ feedsStale: ['TechCrunch AI'] }), 'worked')[3]!.tone, 'short');
  assert.equal(checksFor(base({ nearCap: true }), 'worked')[3]!.tone, 'short');
  const err = checksFor(base({ reportError: 'boom' }), 'worked');
  assert.deepEqual(err.map((c) => c.tone), ['none', 'none', 'none', 'short']);
});

test('night verdict counts non-red types out of types that were due', () => {
  const v = nightVerdict('2026-10-13', [
    base({ vertical: 'reels' }),
    base({ vertical: 'explainers', retriedOk: 1 }),
    base({ vertical: 'carousels', made: 0, ready: 0 }),
    base({ vertical: 'stories', due: false, ran: false, made: 0, target: 0, needed: 0, ready: 0 }),
  ], 'worked');
  assert.equal(v.total, 3);
  assert.equal(v.worked, 2);
});

test('worst picks the most severe tone and ignores none', () => {
  assert.equal(worst(['worked', 'short', 'none']), 'short');
  assert.equal(worst(['none', 'none']), 'none');
});

test('cycle bounds: 08:00 the day before to 07:30, New York time, across DST', () => {
  const oct = cycleBounds('2026-10-13');
  assert.equal(oct.start.toISOString(), '2026-10-12T12:00:00.000Z');
  assert.equal(oct.end.toISOString(), '2026-10-13T11:30:00.000Z');
  const nov = cycleBounds('2026-11-02');
  assert.equal(nov.start.toISOString(), '2026-11-01T13:00:00.000Z');
  assert.equal(nov.end.toISOString(), '2026-11-02T12:30:00.000Z');
});

test('reportNightFor: before 07:30 the latest report is yesterday', () => {
  assert.equal(reportNightFor(new Date('2026-10-13T11:00:00Z')), '2026-10-12');
  assert.equal(reportNightFor(new Date('2026-10-13T11:31:00Z')), '2026-10-13');
});

test('nightsEnding is ascending and weekdayIndex is 0 = Sunday', () => {
  assert.deepEqual(nightsEnding('2026-10-13', 3), ['2026-10-11', '2026-10-12', '2026-10-13']);
  assert.equal(weekdayIndex('2026-10-11'), 0);
});
```

- [ ] **Step 3: Run the tests to confirm they fail.**
Run: `npx tsx --test tests/social-health-verdict.test.ts`
Expected: FAIL, because the modules can't be found.

- [ ] **Step 4: Write `time.ts`.**

```ts
import { zonedTime } from '@/lib/instagram/clock';
import { addDays, nyDateOf } from '@/lib/social-hub/time';

export const REPORT_HOUR = 7;
export const REPORT_MINUTE = 30;

const parts = (night: string) => night.split('-').map(Number) as [number, number, number];

/** Night N = 08:00 on N−1 to 07:30 on N, America/New_York. */
export function cycleBounds(night: string): { start: Date; end: Date } {
  const [py, pm, pd] = parts(addDays(night, -1));
  const [y, m, d] = parts(night);
  return { start: zonedTime(py, pm, pd, 8, 0), end: zonedTime(y, m, d, REPORT_HOUR, REPORT_MINUTE) };
}

/** The newest night whose 07:30 report time has passed. */
export function reportNightFor(now: Date): string {
  const today = nyDateOf(now)!;
  return now.getTime() >= cycleBounds(today).end.getTime() ? today : addDays(today, -1);
}

export function nightsEnding(night: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(night, i - (n - 1)));
}

/** 0 = Sunday … 6 = Saturday (the same convention as SeriesState.days in lib/content-type/posting.ts). */
export function weekdayIndex(night: string): number {
  return new Date(`${night}T12:00:00Z`).getUTCDay();
}
```

Before relying on `weekdayIndex` for Stories (Task 4), open `lib/content-type/posting.ts` and `lib/stories/settings.ts` and confirm that `window.days` uses 0 = Sunday. If it uses 1 = Monday … 7 = Sunday, change `weekdayIndex` to `((getUTCDay() + 6) % 7) + 1`, update its test, and note this in the commit.

- [ ] **Step 5: Write `verdict.ts`.**

```ts
import type { Check, NightReport, NightVerdict, Tone, TypeVerdict } from '@/lib/social-hub/health/types';
import { REASON_LABEL, stageLabel } from '@/lib/social-hub/health/reasons';

const RANK: Record<Tone, number> = { none: 0, worked: 1, short: 2, failed: 3 };

export function worst(tones: readonly Tone[]): Tone {
  return tones.reduce<Tone>((a, b) => (RANK[b] > RANK[a] ? b : a), 'none');
}

export function checksFor(r: NightReport, publisher: Tone): Check[] {
  if (r.reportError) {
    return [
      { id: 'made', tone: 'none', note: 'Unknown' },
      { id: 'ready', tone: 'none', note: 'Unknown' },
      { id: 'posted', tone: 'none', note: 'Unknown' },
      { id: 'plumbing', tone: 'short', note: "Couldn't read this type's data" },
    ];
  }
  const made: Check = !r.due
    ? { id: 'made', tone: 'none', note: "Didn't run" }
    : !r.ran
      ? { id: 'made', tone: 'failed', note: 'Did not run' }
      : { id: 'made', tone: r.made < r.target ? 'failed' : 'worked', note: `${r.made} of ${r.target} made` };
  const ready: Check = r.needed === 0
    ? { id: 'ready', tone: r.due ? 'worked' : 'none', note: 'Nothing needed' }
    : { id: 'ready', tone: r.ready === 0 ? 'failed' : r.ready < r.needed ? 'short' : 'worked', note: `${Math.min(r.ready, r.needed)} of ${r.needed} slots covered` };
  const posted: Check = r.scheduledYesterday === 0
    ? { id: 'posted', tone: r.due ? 'worked' : 'none', note: 'Nothing scheduled' }
    : {
        id: 'posted',
        tone: r.postedYesterday < r.scheduledYesterday ? 'failed' : r.retriedOk > 0 ? 'short' : 'worked',
        note: `${r.postedYesterday} of ${r.scheduledYesterday} posted${r.retriedOk ? `, ${r.retriedOk} after a retry` : ''}`,
      };
  const plumbing: Check = publisher === 'failed'
    ? { id: 'plumbing', tone: 'failed', note: 'Publisher stopped' }
    : r.feedsStale.length
      ? { id: 'plumbing', tone: 'short', note: `${r.feedsStale[0]} stale` }
      : r.nearCap
        ? { id: 'plumbing', tone: 'short', note: 'Spend near the cap' }
        : { id: 'plumbing', tone: 'worked', note: 'All fresh' };
  return [made, ready, posted, plumbing];
}

export function typeVerdict(r: NightReport, publisher: Tone): TypeVerdict {
  const checks = checksFor(r, publisher);
  const tone = !r.due && !r.reportError ? 'none' : worst(checks.map((c) => c.tone));
  const lead = r.failures.find((f) => f.severity === 'failed') ?? r.failures.find((f) => f.severity !== 'healed');
  const cause = lead
    ? `${stageLabel(lead.stage)}: ${REASON_LABEL[lead.reason] ?? lead.reason}`
    : checks.find((c) => c.tone === 'failed' || c.tone === 'short')?.note ?? null;
  return { vertical: r.vertical, tone, checks, cause: tone === 'worked' || tone === 'none' ? null : cause };
}

export function nightVerdict(night: string, reports: readonly NightReport[], publisher: Tone): NightVerdict {
  const types = reports.map((r) => typeVerdict(r, publisher));
  const counted = types.filter((t) => t.tone !== 'none');
  return { night, types, total: counted.length, worked: counted.filter((t) => t.tone !== 'failed').length, publisher };
}
```

`verdict.ts` imports `reasons.ts`. If you build Task 1 before Task 2, create `reasons.ts` with the full content from Task 2 Step 3 now. Task 2 then adds its tests.

- [ ] **Step 6: Run the tests to confirm they pass.**
Run: `npx tsx --test tests/social-health-verdict.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 7: Commit.**

```bash
git add lib/social-hub/health/types.ts lib/social-hub/health/time.ts lib/social-hub/health/verdict.ts lib/social-hub/health/reasons.ts tests/social-health-verdict.test.ts
git commit -m "feat(health): night report types, night clock and status rules"
```

---

### Task 2: Reason codes, problem grouping and streaks

**Files:**
- Create/complete: `lib/social-hub/health/reasons.ts`
- Create: `lib/social-hub/health/problems.ts`
- Test: `tests/social-health-problems.test.ts`

**Interfaces:**
- **Consumes:** `FailureEvent`, `Tone` (Task 1); `verticalInfo` (`lib/social-hub/verticals.ts`).
- **Produces:**
  - `reasonFor(stage: string, raw: string | null | undefined): string`
  - `carouselReason(code: string): string`
  - `REASON_LABEL: Record<string, string>`
  - `stageLabel(stage: string): string`
  - `type Problem`
  - `groupProblems(failures: FailureEvent[], window: string[]): Problem[]`
  - `cleanStreak(tones: Tone[]): number`
  - `bestStreak(tones: Tone[]): number`

- [ ] **Step 1: Write the failing tests.**

```ts
// tests/social-health-problems.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { bestStreak, cleanStreak, groupProblems } from '@/lib/social-hub/health/problems';
import { carouselReason, reasonFor, REASON_LABEL, stageLabel } from '@/lib/social-hub/health/reasons';
import { nightsEnding } from '@/lib/social-hub/health/time';
import type { FailureEvent } from '@/lib/social-hub/health/types';

test('raw errors map to reason codes; unknown text keeps its raw error under other', () => {
  assert.equal(reasonFor('render', 'Request timed out after 120s'), 'timeout');
  assert.equal(reasonFor('publish', 'Meta returned 500 Internal Server Error'), 'service_5xx');
  assert.equal(reasonFor('build', 'monthly watch reached (25)'), 'cap_hit');
  assert.equal(reasonFor('frame', 'copy_does_not_fit'), 'too_long');
  assert.equal(reasonFor('copy', 'unexpected token in JSON at position 4'), 'malformed_output');
  assert.equal(reasonFor('x', 'something brand new'), 'other');
  assert.equal(reasonFor('x', null), 'other');
});

test('carousel reason codes normalize and have labels', () => {
  assert.equal(carouselReason('over-limit'), 'too_long');
  assert.equal(carouselReason('cost-cap'), 'cap_hit');
  assert.equal(carouselReason('render-failed'), 'render_failed');
  for (const code of ['too_long', 'cap_hit', 'render_failed', 'other']) assert.ok(REASON_LABEL[code]);
  assert.equal(stageLabel('writer'), 'Writer');
  assert.equal(stageLabel('jev-scoring'), 'Scoring');
  assert.equal(stageLabel('some_new_stage'), 'Some new stage');
});

const ev = (night: string, over: Partial<FailureEvent> = {}): FailureEvent => ({
  vertical: 'carousels', night, at: `${night}T07:14:00Z`, stage: 'writer', reason: 'too_long', severity: 'failed', ...over,
});

test('one problem per vertical+stage+reason, counted by nights, newest first', () => {
  const window = nightsEnding('2026-10-13', 14);
  const problems = groupProblems([
    ev('2026-10-03'), ev('2026-10-08'), ev('2026-10-13'), ev('2026-10-13', { at: '2026-10-13T07:15:00Z' }),
    ev('2026-10-12', { vertical: 'explainers', stage: 'publish', reason: 'service_5xx', severity: 'healed' }),
  ], window);
  assert.equal(problems.length, 2);
  const writer = problems[0]!;
  assert.equal(writer.key, 'carousels|writer|too_long');
  assert.equal(writer.count, 3);
  assert.equal(writer.firstSeen, '2026-10-03');
  assert.equal(writer.lastSeen, '2026-10-13');
  assert.equal(writer.tone, 'current');
  assert.equal(writer.backAgain, true); // gap of 4 quiet nights before 10-13
  assert.equal(problems[1]!.tone, 'quiet');
});

test('quiet 6 nights is almost, 7 is fixed; back again needs a 3-night gap', () => {
  const window = nightsEnding('2026-10-13', 14);
  const [almost] = groupProblems([ev('2026-10-07')], window);
  assert.equal(almost!.quietNights, 6);
  assert.equal(almost!.state, 'almost');
  const [fixed] = groupProblems([ev('2026-10-06')], window);
  assert.equal(fixed!.state, 'fixed');
  const [close] = groupProblems([ev('2026-10-11'), ev('2026-10-13')], window);
  assert.equal(close!.backAgain, false);
});

test('streaks count trailing worked nights and skip grey nights', () => {
  assert.equal(cleanStreak(['failed', 'worked', 'none', 'worked', 'worked']), 3);
  assert.equal(cleanStreak(['worked', 'short']), 0);
  assert.equal(bestStreak(['worked', 'worked', 'failed', 'worked']), 2);
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**
Run: `npx tsx --test tests/social-health-problems.test.ts`
Expected: FAIL, because `problems.ts` can't be found (and `reasons.ts` too, if it wasn't created in Task 1).

- [ ] **Step 3: Write `reasons.ts`.**

```ts
/** Raw error → reason code (spec §4.2). Order matters: first match wins. No model involved. */
const RULES: ReadonlyArray<[RegExp, string]> = [
  [/watch reached|spend cap|cost.?cap|budget|capped/i, 'cap_hit'],
  [/timed? ?out|timeout|ETIMEDOUT/i, 'timeout'],
  [/rate.?limit|\b429\b/i, 'rate_limited'],
  [/\b5\d\d\b|internal server error|service unavailable|bad gateway/i, 'service_5xx'],
  [/\b40[13]\b|unauthori[sz]ed|forbidden|access token|invalid token|expired token|permission/i, 'auth'],
  [/copy_does_not_fit|too long|over.?limit|length/i, 'too_long'],
  [/rejected_background|no (usable )?(photo|image)|background/i, 'no_photo'],
  [/json|parse|malformed|schema/i, 'malformed_output'],
  [/refus/i, 'refused'],
  [/not found|\b404\b/i, 'not_found'],
];

export function reasonFor(_stage: string, raw: string | null | undefined): string {
  if (!raw) return 'other';
  for (const [re, code] of RULES) if (re.test(raw)) return code;
  return 'other';
}

/** Carousels already store a reason_code (lib/social/pipeline/types.ts ReasonCode). */
const CAROUSEL: Record<string, string> = {
  'over-limit': 'too_long',
  'cost-cap': 'cap_hit',
  'render-failed': 'render_failed',
  'service-error': 'service_5xx',
  'malformed-output': 'malformed_output',
  'needs-fresh-draft': 'needs_fresh_draft',
  'unfixable-draft': 'unfixable_draft',
  refused: 'refused',
  'main-claim-false': 'claim_false',
  'unverifiable-claim': 'claim_unverifiable',
};
export function carouselReason(code: string): string {
  return CAROUSEL[code] ?? code.replace(/-/g, '_');
}

export const REASON_LABEL: Record<string, string> = {
  cap_hit: 'hit its spend cap',
  timeout: 'timed out',
  rate_limited: 'was rate limited',
  service_5xx: 'service error',
  auth: 'sign-in or permission error',
  too_long: 'ran too long',
  no_photo: 'no usable photo',
  malformed_output: 'unreadable model output',
  refused: 'model refused',
  not_found: 'something it needed was missing',
  render_failed: 'render failed',
  needs_fresh_draft: 'needed a fresh draft',
  unfixable_draft: 'draft could not be fixed',
  claim_false: 'main claim was false',
  claim_unverifiable: "claim couldn't be verified",
  reporter_error: "couldn't read this type's data",
  did_not_run: "didn't run",
  other: 'unrecognized error',
};

const STAGE: Record<string, string> = {
  'jev-scoring': 'Scoring', reporter: 'Reporter', writer: 'Writer', editor: 'Editor', 'fact-checker': 'Fact-checker',
  mechanical: 'Checks', design: 'Design', copy: 'Copy', frame: 'Frame', video: 'Video', song: 'Song', run: 'Run',
  publish: 'Publish', ideas: 'Ideas', render: 'Render', build: 'Build', report: 'Report',
};
export function stageLabel(stage: string): string {
  if (STAGE[stage]) return STAGE[stage]!;
  const words = stage.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
```

- [ ] **Step 4: Write `problems.ts`.**

```ts
import type { FailureEvent, Severity, Tone } from '@/lib/social-hub/health/types';
import { REASON_LABEL, stageLabel } from '@/lib/social-hub/health/reasons';
import { verticalInfo } from '@/lib/social-hub/verticals';
import type { Vertical } from '@/lib/social-hub/types';

export const FIXED_AFTER = 7;
export const BACK_AGAIN_GAP = 3;

export type Problem = {
  key: string;
  vertical: Vertical;
  stage: string;
  reason: string;
  title: string;
  nights: string[];
  count: number;
  firstSeen: string;
  lastSeen: string;
  quietNights: number;
  backAgain: boolean;
  /** current = broke something last night; healed / warning = last night but recovered or a heads-up; quiet = not last night. */
  tone: 'current' | 'healed' | 'warning' | 'quiet';
  state: 'open' | 'almost' | 'fixed';
  latest: FailureEvent;
  events: FailureEvent[];
};

const SEVERITY_TONE: Record<Severity, Problem['tone']> = { failed: 'current', healed: 'healed', warning: 'warning' };

/** `window` is ascending; its last night is "last night". */
export function groupProblems(failures: readonly FailureEvent[], window: readonly string[]): Problem[] {
  const today = window[window.length - 1]!;
  const index = new Map(window.map((n, i) => [n, i]));
  const groups = new Map<string, FailureEvent[]>();
  for (const f of failures) {
    if (!index.has(f.night)) continue;
    const key = `${f.vertical}|${f.stage}|${f.reason}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(f);
  }
  const out: Problem[] = [];
  for (const [key, events] of groups) {
    events.sort((a, b) => a.at.localeCompare(b.at));
    const nights = [...new Set(events.map((e) => e.night))].sort();
    const lastSeen = nights[nights.length - 1]!;
    const quietNights = index.get(today)! - index.get(lastSeen)!;
    const prev = nights[nights.length - 2];
    const backAgain = prev !== undefined && index.get(lastSeen)! - index.get(prev)! - 1 >= BACK_AGAIN_GAP;
    const latest = events[events.length - 1]!;
    const lastNightEvents = events.filter((e) => e.night === today);
    const tone: Problem['tone'] = lastNightEvents.length
      ? lastNightEvents.some((e) => e.severity === 'failed') ? 'current' : SEVERITY_TONE[latest.severity]
      : 'quiet';
    const v = latest.vertical;
    out.push({
      key, vertical: v, stage: latest.stage, reason: latest.reason,
      title: `${verticalInfo(v).label} · ${stageLabel(latest.stage)} · ${REASON_LABEL[latest.reason] ?? latest.reason}`,
      nights, count: nights.length, firstSeen: nights[0]!, lastSeen, quietNights, backAgain, tone,
      state: quietNights >= FIXED_AFTER ? 'fixed' : quietNights === FIXED_AFTER - 1 ? 'almost' : 'open',
      latest, events,
    });
  }
  return out.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || b.count - a.count);
}

export function cleanStreak(tones: readonly Tone[]): number {
  let n = 0;
  for (let i = tones.length - 1; i >= 0; i--) {
    if (tones[i] === 'none') continue;
    if (tones[i] !== 'worked') break;
    n++;
  }
  return n;
}

export function bestStreak(tones: readonly Tone[]): number {
  let best = 0;
  let run = 0;
  for (const t of tones) {
    if (t === 'none') continue;
    run = t === 'worked' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}
```

- [ ] **Step 5: Run the tests to confirm they pass.**
Run: `npx tsx --test tests/social-health-problems.test.ts tests/social-health-verdict.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/social-hub/health/reasons.ts lib/social-hub/health/problems.ts tests/social-health-problems.test.ts
git commit -m "feat(health): reason codes, problem grouping, streaks"
```

---

### Task 3: Schema: `health_reports` and `stories.sets.mode`

**Files:**
- Modify: `db/social_hub_schema.sql` (append at the end)
- Modify: `db/stories_schema.sql` (append at the end)
- Modify: `lib/stories/repository.ts:107` (the `INSERT INTO stories.sets`)
- Test: `tests/social-health-schema.test.ts`

**Interfaces:**
- **Produces:**
  - table `social_hub.health_reports(night date PK, built_at, verdict jsonb, reports jsonb, failures jsonb)`;
  - column `stories.sets.mode text NOT NULL DEFAULT 'production' CHECK (mode IN ('development','production'))`.

- [ ] **Step 1: Write the failing test.**

```ts
// tests/social-health-schema.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { openHubTestDb } from './fixtures/social-hub/pglite';

test('health_reports exists with a night primary key', async () => {
  const { query } = await openHubTestDb();
  await query(`INSERT INTO social_hub.health_reports (night, built_at, verdict, reports, failures) VALUES ('2026-10-13', now(), '{}', '[]', '[]')`);
  await assert.rejects(query(`INSERT INTO social_hub.health_reports (night, built_at, verdict, reports, failures) VALUES ('2026-10-13', now(), '{}', '[]', '[]')`));
});

test('stories.sets.mode defaults to production and rejects other values', async () => {
  const { query } = await openHubTestDb();
  const { rows } = await query<{ mode: string }>(
    `INSERT INTO stories.sets (series, ny_date, trigger, style) VALUES ('morning_download', '2026-10-13', 'auto', 'polished') RETURNING mode`,
  );
  assert.equal(rows[0]!.mode, 'production');
  await assert.rejects(query(`INSERT INTO stories.sets (series, ny_date, trigger, style, mode) VALUES ('free_vs_paid', '2026-10-13', 'auto', 'polished', 'nope')`));
});
```

- [ ] **Step 2: Run it to confirm it fails.**
Run: `npx tsx --test tests/social-health-schema.test.ts`
Expected: FAIL, with `relation "social_hub.health_reports" does not exist`.

- [ ] **Step 3: Append to `db/social_hub_schema.sql`.**

```sql
-- Health tab (spec 2026-10-13 §4.3): the 07:30 morning report, one row per night.
CREATE TABLE IF NOT EXISTS social_hub.health_reports (
    night       date PRIMARY KEY,
    built_at    timestamptz NOT NULL,
    verdict     jsonb NOT NULL,
    reports     jsonb NOT NULL,
    failures    jsonb NOT NULL
);
```

- [ ] **Step 4: Append to `db/stories_schema.sql`.**

```sql
-- Cost page Production | Development split (spec 2026-10-13 §7). Older rows count as production.
ALTER TABLE stories.sets ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'production';
ALTER TABLE stories.sets DROP CONSTRAINT IF EXISTS stories_sets_mode_check;
ALTER TABLE stories.sets ADD CONSTRAINT stories_sets_mode_check CHECK (mode IN ('development', 'production'));
```

- [ ] **Step 5: Make the Stories insert write `mode`.** In `lib/stories/repository.ts` (around line 107), add `mode` to the column list and pass the value below as the next parameter. Keep the rest of the statement unchanged.

```ts
/** Local test runs set HELIOS_RUN_MODE=development; the VM leaves it unset, so production is the safe default. */
const runMode = process.env.HELIOS_RUN_MODE === 'development' ? 'development' : 'production';
```

For example, `INSERT INTO stories.sets (series, ny_date, trigger, style, requested_by, mode) VALUES ($1, $2, $3, $4, $5, $6)`, with `runMode` appended to the params array.

- [ ] **Step 6: Run the tests to confirm they pass, and check that the existing Stories tests still pass.**
Run: `npx tsx --test tests/social-health-schema.test.ts && npm test`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add db/social_hub_schema.sql db/stories_schema.sql lib/stories/repository.ts tests/social-health-schema.test.ts
git commit -m "feat(health): health_reports table; stories.sets.mode for the cost split"
```

---

### Task 4: Shared publishing reads plus the Carousels and IG Stories reporters

**Files:**
- Create: `lib/social-hub/health/reporters/shared.ts`
- Create: `lib/social-hub/health/reporters/carousels.ts`
- Create: `lib/social-hub/health/reporters/stories.ts`
- Test: `tests/social-health-reporters.test.ts`

**Interfaces:**
- **Consumes:**
  - Task 1: `cycleBounds`, `weekdayIndex`, types.
  - Task 2: `reasonFor`, `carouselReason`.
  - `HubQuery` (`lib/social-hub/db.ts`).
  - `PostingState` (`lib/content-type/posting.ts`).
  - `addDays` (`lib/social-hub/time.ts`).
- **Produces:**
  - `type ReportContext = { night: string; posting: PostingState; now: Date }`
  - `type Reporter = (q: HubQuery, ctx: ReportContext) => Promise<NightReport>`
  - `quotaFor(posting, night): number`
  - `publishingFor(q, vertical, night): Promise<Publishing>`
  - `funnelFrom(start: number, drops: Array<[string, number]>): FunnelStep[]`
  - `emptyReport(vertical, night): NightReport`
  - `reportCarousels: Reporter`, `reportStories: Reporter`

- [ ] **Step 1: Write the failing tests.** The `posting` helper builds a `PostingState`.

```ts
// tests/social-health-reporters.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PostingState } from '@/lib/content-type/posting';
import { reportCarousels } from '@/lib/social-hub/health/reporters/carousels';
import { funnelFrom, publishingFor, quotaFor } from '@/lib/social-hub/health/reporters/shared';
import { reportStories } from '@/lib/social-hub/health/reporters/stories';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const NIGHT = '2026-10-13';
const NOW = new Date('2026-10-13T11:31:00Z');
const posting = (over: Partial<PostingState> = {}): PostingState =>
  ({ type: 'carousels', live: true, generate: true, autoPublish: false, perDay: 1, maxPerDay: 2, series: null, ...over }) as PostingState;

test('quota: perDay for most types; enabled series that run that weekday for Stories', () => {
  assert.equal(quotaFor(posting({ perDay: 2 }), NIGHT), 2);
  const series = [
    { id: 'morning_download', label: 'MD', enabled: true, generate: true, days: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'guess_the_number', label: 'GN', enabled: true, generate: true, days: [1, 4] },
    { id: 'free_vs_paid', label: 'FP', enabled: false, generate: true, days: [2] },
  ];
  assert.equal(quotaFor(posting({ type: 'stories', perDay: null, series } as never), NIGHT), 1); // Tue: MD only (FP disabled)
});

test('funnel subtracts drops stage by stage', () => {
  assert.deepEqual(funnelFrom(10, [['scoring', 6], ['writer', 2]]), [
    { stage: 'scoring', in: 10, out: 4 },
    { stage: 'writer', in: 4, out: 2 },
  ]);
});

test('publishing: yesterday posted, failed and healed-by-retry, plus today placed/filled', async () => {
  const { query } = await openHubTestDb();
  await query(`
    INSERT INTO social_hub.content_items (id, vertical, format, native_ref, idea_ref) VALUES
      ('00000000-0000-0000-0000-0000000000a1', 'carousels', 'feed', 'p1', 's1'),
      ('00000000-0000-0000-0000-0000000000a2', 'carousels', 'feed', 'p2', 's2');
    INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, requested_at, caption) VALUES
      ('00000000-0000-0000-0000-0000000000a1', 'carousels', 'auto', 'failed', '2026-10-12T13:00:00Z', 'c'),
      ('00000000-0000-0000-0000-0000000000a1', 'carousels', 'auto', 'published', '2026-10-12T13:05:00Z', 'c');
    INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, requested_at, caption, error) VALUES
      ('00000000-0000-0000-0000-0000000000a2', 'carousels', 'auto', 'failed', '2026-10-12T18:00:00Z', 'c', 'Meta 500');
    UPDATE social_hub.publish_attempts SET error = 'Meta returned 500' WHERE status = 'failed' AND error IS NULL;
    INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES
      ('00000000-0000-0000-0000-0000000000a1', 'carousels', '2026-10-12', 'morning', '2026-10-12T13:00:00Z', 'published', 'auto'),
      ('00000000-0000-0000-0000-0000000000a2', 'carousels', '2026-10-12', 'afternoon', '2026-10-12T18:30:00Z', 'failed', 'auto');
  `);
  const p = await publishingFor(query, 'carousels', NIGHT);
  assert.equal(p.scheduledYesterday, 2);
  assert.equal(p.postedYesterday, 1);
  assert.equal(p.retriedOk, 1);
  assert.deepEqual(p.failures.map((f) => [f.stage, f.reason, f.severity]).sort(), [
    ['publish', 'service_5xx', 'failed'],
    ['publish', 'service_5xx', 'healed'],
  ]);
});

test('carousels: made from run posts, pipeline-fault set-asides are failures, should-not-run feed the funnel', async () => {
  const { query } = await openHubTestDb();
  await query(`
    INSERT INTO social.runs (kind, started_at, hook_pass, cap_usd, total_usd, trigger, status, requested_at, record) VALUES
      ('daily', '2026-10-13T07:00:00Z', true, 2, 1.2, 'scheduled', 'ok', '2026-10-13T07:00:00Z',
       '{"result":{"posts":[]}}');
    INSERT INTO social.set_asides (day, story_id, stage, reason_code, kind, detail, at) VALUES
      ('2026-10-13', 'st-1', 'writer', 'over-limit', 'pipeline-fault', 'slide 3 over 40 words', '2026-10-13T07:14:00Z'),
      ('2026-10-13', 'st-2', 'writer', 'over-limit', 'pipeline-fault', 'slide 2 over 40 words', '2026-10-13T07:15:00Z'),
      ('2026-10-13', 'st-3', 'jev-scoring', 'refused', 'should-not-run', 'off-topic', '2026-10-13T07:05:00Z');
    INSERT INTO social.feed_health (day, slug, name, fetched, in_window, flagged) VALUES
      ('2026-10-11', 'tc', 'TechCrunch AI', 5, 0, false), ('2026-10-12', 'tc', 'TechCrunch AI', 5, 0, false), ('2026-10-13', 'tc', 'TechCrunch AI', 5, 0, false);
  `);
  const r = await reportCarousels(query, { night: NIGHT, posting: posting(), now: NOW });
  assert.equal(r.ran, true);
  assert.equal(r.made, 0);
  assert.equal(r.target, 1);
  assert.equal(r.failures.filter((f) => f.stage === 'writer' && f.reason === 'too_long').length, 2);
  assert.equal(r.funnel[0]!.stage, 'jev-scoring');
  assert.deepEqual(r.feedsStale, ['TechCrunch AI']);
  assert.equal(r.spendUsd, 1.2);
});

test('stories: failed set is a failure, watch-reached skip is a cap warning', async () => {
  const { query } = await openHubTestDb();
  await query(`
    INSERT INTO stories.sets (series, ny_date, trigger, style, status, error, spend_usd) VALUES
      ('morning_download', '2026-10-13', 'auto', 'polished', 'failed', 'Request timed out', 0.4),
      ('guess_the_number', '2026-10-13', 'auto', 'polished', 'skipped', 'monthly watch reached (25)', 0);
  `);
  const series = [
    { id: 'morning_download', label: 'MD', enabled: true, generate: true, days: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'guess_the_number', label: 'GN', enabled: true, generate: true, days: [2] },
  ];
  const r = await reportStories(query, { night: NIGHT, posting: posting({ type: 'stories', perDay: null, series } as never), now: NOW });
  assert.equal(r.made, 0);
  assert.equal(r.target, 2);
  assert.deepEqual(r.failures.map((f) => [f.reason, f.severity]).sort(), [['cap_hit', 'warning'], ['timeout', 'failed']]);
  assert.equal(r.spendUsd, 0.4);
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**
Run: `npx tsx --test tests/social-health-reporters.test.ts`
Expected: FAIL, because the modules can't be found.

- [ ] **Step 3: Write `reporters/shared.ts`.**

```ts
import type { PostingState } from '@/lib/content-type/posting';
import type { HubQuery } from '@/lib/social-hub/db';
import { reasonFor } from '@/lib/social-hub/health/reasons';
import { weekdayIndex } from '@/lib/social-hub/health/time';
import type { FailureEvent, FunnelStep, NightReport } from '@/lib/social-hub/health/types';
import { addDays } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';

export type ReportContext = { night: string; posting: PostingState; now: Date };
export type Reporter = (q: HubQuery, ctx: ReportContext) => Promise<NightReport>;

export function quotaFor(posting: PostingState, night: string): number {
  if (posting.series) {
    const day = weekdayIndex(night);
    return posting.series.filter((s) => s.enabled && s.generate && s.days.includes(day)).length;
  }
  return posting.perDay ?? 0;
}

export function funnelFrom(start: number, drops: ReadonlyArray<[string, number]>): FunnelStep[] {
  let current = start;
  return drops.map(([stage, n]) => {
    const step = { stage, in: current, out: Math.max(0, current - Math.max(0, n)) };
    current = step.out;
    return step;
  });
}

export function emptyReport(vertical: Vertical, night: string): NightReport {
  return {
    vertical, night, due: false, ran: false, target: 0, made: 0, needed: 0, ready: 0,
    scheduledYesterday: 0, postedYesterday: 0, retriedOk: 0, funnel: [], failures: [], spendUsd: 0,
    unknownCostCalls: 0, feedsStale: [], nearCap: false, reportError: null,
  };
}

export type Publishing = {
  scheduledYesterday: number;
  postedYesterday: number;
  retriedOk: number;
  failures: FailureEvent[];
  placedToday: number;
  filledAutoToday: number;
};

type SlotRow = { id: string; status: string; error: string | null; publish_at: string; content_item_id: string | null; attempts: number; last_error: string | null };

export async function publishingFor(q: HubQuery, vertical: Vertical, night: string): Promise<Publishing> {
  const yesterday = addDays(night, -1);
  const { rows } = await q<SlotRow>(
    `SELECT s.id::text, s.status, s.error, s.publish_at::text, s.content_item_id::text,
            (SELECT count(*) FROM social_hub.publish_attempts a WHERE a.content_item_id = s.content_item_id)::int AS attempts,
            (SELECT a.error FROM social_hub.publish_attempts a
              WHERE a.content_item_id = s.content_item_id AND a.status = 'failed'
              ORDER BY a.requested_at DESC LIMIT 1) AS last_error
       FROM social_hub.schedule s
      WHERE s.vertical = $1 AND s.ny_date = $2::date AND s.status <> 'cancelled'`,
    [vertical, yesterday],
  );
  const failures: FailureEvent[] = [];
  let posted = 0;
  let retriedOk = 0;
  for (const r of rows) {
    const item = r.content_item_id ? { kind: 'post', id: r.content_item_id, label: `${yesterday} post` } : undefined;
    if (r.status === 'published') {
      posted++;
      if (r.attempts > 1) {
        retriedOk++;
        failures.push({ vertical, night, at: r.publish_at, stage: 'publish', reason: reasonFor('publish', r.last_error), severity: 'healed', rawError: r.last_error ?? undefined, item });
      }
    } else if (r.status === 'failed') {
      const raw = r.error ?? r.last_error;
      failures.push({ vertical, night, at: r.publish_at, stage: 'publish', reason: reasonFor('publish', raw), severity: 'failed', rawError: raw ?? undefined, item });
    }
  }
  const today = await q<{ source: string; n: number }>(
    `SELECT source, count(*)::int AS n FROM social_hub.schedule
      WHERE vertical = $1 AND ny_date = $2::date AND status <> 'cancelled' GROUP BY source`,
    [vertical, night],
  );
  const count = (source: string) => today.rows.find((r) => r.source === source)?.n ?? 0;
  return { scheduledYesterday: rows.length, postedYesterday: posted, retriedOk, failures, placedToday: count('user'), filledAutoToday: count('auto') };
}

/** Fills target/needed/ready/posted from the quota and publishing reads. */
export function withPublishing(r: NightReport, posting: PostingState, p: Publishing): NightReport {
  const quota = quotaFor(posting, r.night);
  const due = posting.live && posting.generate !== false && quota > 0;
  return {
    ...r,
    due,
    needed: quota,
    target: Math.max(0, quota - p.placedToday),
    ready: p.placedToday + Math.max(p.filledAutoToday, r.made),
    scheduledYesterday: p.scheduledYesterday,
    postedYesterday: p.postedYesterday,
    retriedOk: p.retriedOk + r.retriedOk,
    failures: [...r.failures, ...p.failures],
  };
}
```

- [ ] **Step 4: Write `reporters/carousels.ts`.**

```ts
import type { HubQuery } from '@/lib/social-hub/db';
import { carouselReason, reasonFor } from '@/lib/social-hub/health/reasons';
import { emptyReport, funnelFrom, publishingFor, withPublishing, type Reporter } from '@/lib/social-hub/health/reporters/shared';
import { cycleBounds } from '@/lib/social-hub/health/time';
import type { FailureEvent } from '@/lib/social-hub/health/types';

const STAGE_ORDER = ['jev-scoring', 'reporter', 'writer', 'editor', 'fact-checker', 'mechanical', 'design'];

type RunRow = { id: string; status: string; stop_reason: string | null; error: string | null; total_usd: number; cap_usd: number; posts: number; at: string };
type SetAside = { story_id: string; stage: string; reason_code: string; kind: string; detail: string; at: string };

export const reportCarousels: Reporter = async (q: HubQuery, { night, posting }) => {
  const { start, end } = cycleBounds(night);
  const range = [start.toISOString(), end.toISOString()];
  const runs = (await q<RunRow>(
    `SELECT id::text, status, stop_reason, error, total_usd::float8 AS total_usd, cap_usd::float8 AS cap_usd,
            CASE WHEN jsonb_typeof(record->'result'->'posts') = 'array' THEN jsonb_array_length(record->'result'->'posts') ELSE 0 END AS posts,
            COALESCE(started_at, requested_at)::text AS at
       FROM social.runs
      WHERE kind = 'daily' AND trigger = 'scheduled'
        AND COALESCE(started_at, requested_at) >= $1 AND COALESCE(started_at, requested_at) < $2
      ORDER BY requested_at`,
    range,
  )).rows;
  const asides = (await q<SetAside>(
    `SELECT story_id, stage, reason_code, kind, detail, at::text FROM social.set_asides WHERE at >= $1 AND at < $2`,
    range,
  )).rows;
  const stale = (await q<{ name: string }>(
    `SELECT name FROM social.feed_health WHERE day > $1::date - 3 AND day <= $1::date
      GROUP BY slug, name HAVING max(in_window) = 0 AND count(*) >= 3 ORDER BY name`,
    [night],
  )).rows.map((r) => r.name);

  const failures: FailureEvent[] = [];
  for (const run of runs) {
    if (run.status === 'failed' || run.stop_reason === 'cost-cap') {
      const reason = run.stop_reason === 'cost-cap' ? 'cap_hit' : reasonFor('run', run.error ?? run.stop_reason);
      failures.push({ vertical: 'carousels', night, at: run.at, stage: 'run', reason, severity: 'failed', rawError: run.error ?? run.stop_reason ?? undefined, runId: run.id, spentUsd: run.total_usd });
    }
  }
  for (const a of asides.filter((x) => x.kind === 'pipeline-fault')) {
    failures.push({
      vertical: 'carousels', night, at: a.at, stage: a.stage, reason: carouselReason(a.reason_code), severity: 'failed',
      rawError: a.detail, item: { kind: 'story', id: a.story_id, label: a.story_id },
    });
  }
  const made = runs.filter((r) => r.status === 'ok' || r.status === 'partial').reduce((n, r) => n + r.posts, 0);
  const drops = STAGE_ORDER.map((stage) => [stage, asides.filter((a) => a.stage === stage).length] as [string, number]).filter(([, n]) => n > 0);
  const base = {
    ...emptyReport('carousels', night),
    ran: runs.some((r) => ['ok', 'partial', 'failed', 'skipped'].includes(r.status)),
    made,
    funnel: funnelFrom(made + asides.length, drops),
    failures,
    spendUsd: runs.reduce((n, r) => n + r.total_usd, 0),
    feedsStale: stale,
    nearCap: runs.some((r) => r.cap_usd > 0 && r.total_usd >= 0.9 * r.cap_usd),
  };
  return withPublishing(base, posting, await publishingFor(q, 'carousels', night));
};
```

- [ ] **Step 5: Write `reporters/stories.ts`.**

```ts
import type { HubQuery } from '@/lib/social-hub/db';
import { reasonFor } from '@/lib/social-hub/health/reasons';
import { emptyReport, funnelFrom, publishingFor, withPublishing, type Reporter } from '@/lib/social-hub/health/reporters/shared';
import type { FailureEvent } from '@/lib/social-hub/health/types';

const MADE = ['ready', 'approved', 'scheduled', 'publishing', 'published'];
type SetRow = { id: string; series: string; status: string; error: string | null; spend_usd: number; at: string };

export const reportStories: Reporter = async (q: HubQuery, { night, posting }) => {
  const sets = (await q<SetRow>(
    `SELECT id::text, series, status, error, spend_usd::float8 AS spend_usd, created_at::text AS at
       FROM stories.sets WHERE ny_date = $1::date AND trigger = 'auto' AND mode = 'production'`,
    [night],
  )).rows;
  const failures: FailureEvent[] = [];
  for (const s of sets) {
    const item = { kind: 'story-set', id: s.id, label: s.series.replace(/_/g, ' ') };
    if (s.status === 'failed') failures.push({ vertical: 'stories', night, at: s.at, stage: 'build', reason: reasonFor('build', s.error), severity: 'failed', rawError: s.error ?? undefined, item });
    if (s.status === 'skipped' && s.error) failures.push({ vertical: 'stories', night, at: s.at, stage: 'build', reason: reasonFor('build', s.error), severity: 'warning', rawError: s.error, item });
  }
  const made = sets.filter((s) => MADE.includes(s.status)).length;
  const base = {
    ...emptyReport('stories', night),
    ran: sets.length > 0,
    made,
    funnel: funnelFrom(sets.length, [['build', sets.length - made]]),
    failures,
    spendUsd: sets.reduce((n, s) => n + s.spend_usd, 0),
  };
  return withPublishing(base, posting, await publishingFor(q, 'stories', night));
};
```

- [ ] **Step 6: Run the tests to confirm they pass.**
Run: `npx tsx --test tests/social-health-reporters.test.ts`
Expected: PASS.

A note on the Stories count: with only one failed set and one skipped set, `made` is 0 and `target` is 2. Both series run on Tuesday, and nothing was placed.

- [ ] **Step 7: Commit.**

```bash
git add lib/social-hub/health/reporters/shared.ts lib/social-hub/health/reporters/carousels.ts lib/social-hub/health/reporters/stories.ts tests/social-health-reporters.test.ts
git commit -m "feat(health): shared publishing reads, Carousels and IG Stories reporters"
```

---

### Task 5: Text on Screen and Explainer Reels reporters

**Files:**
- Create: `lib/social-hub/health/reporters/reels.ts`
- Create: `lib/social-hub/health/reporters/explainers.ts`
- Test: `tests/social-health-reporters.test.ts` (append)

**Interfaces:**
- **Consumes:**
  - Task 4 shared helpers.
  - `klingClipUsdSql(finishedAt: string): string` (`lib/reels/insights.ts`).
- **Produces:** `reportReels: Reporter`, `reportExplainers: Reporter`.

- [ ] **Step 1: Append the failing tests.** Seeds follow `tests/fixtures/social-hub/seed.ts` (topics need the full column list shown there).

```ts
import { reportExplainers } from '@/lib/social-hub/health/reporters/explainers';
import { reportReels } from '@/lib/social-hub/health/reporters/reels';

test('text on screen: made = ok videos; failed frame is a failure; a failed then ok video is healed', async () => {
  const { query } = await openHubTestDb();
  const { rows: [idea] } = await query<{ id: string }>(`INSERT INTO reels.post_ideas DEFAULT VALUES RETURNING id::text`);
  const { rows: [idea2] } = await query<{ id: string }>(`INSERT INTO reels.post_ideas DEFAULT VALUES RETURNING id::text`);
  await query(`
    INSERT INTO reels.runs (trigger, status, requested_at, started_at, finished_at) VALUES ('scheduled', 'ok', '2026-10-13T05:00:00Z', '2026-10-13T05:00:00Z', '2026-10-13T06:00:00Z');
    INSERT INTO reels.visual_jobs (post_idea_id, status, error, finished_at) VALUES ('${idea!.id}', 'copy_does_not_fit', 'copy_does_not_fit', '2026-10-13T05:20:00Z');
    INSERT INTO reels.video_jobs (post_idea_id, status, error, finished_at) VALUES
      ('${idea2!.id}', 'failed', 'Kling request timed out', '2026-10-13T05:30:00Z'),
      ('${idea2!.id}', 'ok', NULL, '2026-10-13T05:45:00Z');
  `);
  const r = await reportReels(query, { night: NIGHT, posting: posting({ type: 'reels', perDay: 3 }), now: NOW });
  assert.equal(r.made, 1);
  assert.equal(r.target, 3);
  assert.deepEqual(r.failures.map((f) => [f.stage, f.reason, f.severity]).sort(), [['frame', 'too_long', 'failed'], ['video', 'timeout', 'healed']]);
  assert.equal(r.retriedOk, 1);
});

test('explainers: capped job is cap_hit; unknown-cost HeyGen rows are counted, not priced', async () => {
  const { query } = await openHubTestDb();
  await query(`
    INSERT INTO explainers.topics (id, title, scope, source_url, origin, status, audience_fit, teachability_45s, analogy_potential, visual_potential, accuracy_under_simplification, hook_strength, weighted_score)
      VALUES ('00000000-0000-0000-0000-0000000000e1', 'Webhooks', NULL, NULL, 'generated', 'queued', 3, 3, 3, 3, 3, 3, 70);
    INSERT INTO explainers.idea_cycles (status, mode, ny_date, ideas_generated, ideas_entering_pool) VALUES ('ok', 'production', '2026-10-13', 12, 6);
    INSERT INTO explainers.jobs (id, topic_id, status, stage, trigger, mode, spend_usd, spend_cap_usd, capped, error, orchestrator_model, frame_worker_model, requested_at, finished_at) VALUES
      ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'failed', 'render', 'auto', 'production', 5, 5, true, 'spend cap reached', 'claude-opus-5-5', 'claude-sonnet-5-5', '2026-10-13T06:00:00Z', '2026-10-13T06:40:00Z');
    INSERT INTO explainers.cost_events (job_id, mode, vendor, component, usd, usd_known, created_at) VALUES
      ('00000000-0000-0000-0000-0000000000f1', 'production', 'anthropic', 'session_a', 4.5, true, '2026-10-13T06:10:00Z'),
      ('00000000-0000-0000-0000-0000000000f1', 'production', 'heygen', 'tts+bgm+sfx', 0, false, '2026-10-13T06:20:00Z');
  `);
  const r = await reportExplainers(query, { night: NIGHT, posting: posting({ type: 'explainers', perDay: 2 }), now: NOW });
  assert.equal(r.made, 0);
  assert.equal(r.failures[0]!.reason, 'cap_hit');
  assert.equal(r.unknownCostCalls, 1);
  assert.equal(r.spendUsd, 4.5);
  assert.equal(r.funnel[0]!.in, 12);
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**
Run: `npx tsx --test tests/social-health-reporters.test.ts`
Expected: FAIL, because the reels and explainers modules can't be found.

- [ ] **Step 3: Write `reporters/reels.ts`.**

```ts
import { klingClipUsdSql } from '@/lib/reels/insights';
import type { HubQuery } from '@/lib/social-hub/db';
import { reasonFor } from '@/lib/social-hub/health/reasons';
import { emptyReport, funnelFrom, publishingFor, withPublishing, type Reporter } from '@/lib/social-hub/health/reporters/shared';
import { cycleBounds } from '@/lib/social-hub/health/time';
import type { FailureEvent } from '@/lib/social-hub/health/types';

type Job = { stage: string; id: string; idea: string; status: string; error: string | null; at: string };

export const reportReels: Reporter = async (q: HubQuery, { night, posting }) => {
  const { start, end } = cycleBounds(night);
  const range = [start.toISOString(), end.toISOString()];
  const runs = (await q<{ id: string; status: string; note: string | null; at: string }>(
    `SELECT id::text, status, note, requested_at::text AS at FROM reels.runs
      WHERE trigger = 'scheduled' AND requested_at >= $1 AND requested_at < $2`,
    range,
  )).rows;
  const jobs = (await q<Job>(
    `SELECT 'copy' AS stage, id::text, post_idea_id::text AS idea, status, error, finished_at::text AS at FROM reels.copy_jobs WHERE finished_at >= $1 AND finished_at < $2
     UNION ALL SELECT 'frame', id::text, post_idea_id::text, status, error, finished_at::text FROM reels.visual_jobs WHERE finished_at >= $1 AND finished_at < $2
     UNION ALL SELECT 'video', id::text, post_idea_id::text, status, error, finished_at::text FROM reels.video_jobs WHERE finished_at >= $1 AND finished_at < $2
     UNION ALL SELECT 'song', id::text, post_idea_id::text, status, error, finished_at::text FROM reels.song_picks WHERE finished_at >= $1 AND finished_at < $2
     ORDER BY at`,
    range,
  )).rows;
  const spend = (await q<{ usd: number }>(
    `SELECT (COALESCE((SELECT sum(usd) FROM reels.cost_events WHERE created_at >= $1 AND created_at < $2), 0)
           + COALESCE((SELECT sum(${klingClipUsdSql('finished_at')}) FROM reels.video_jobs
                        WHERE higgsfield_job_id IS NOT NULL AND finished_at >= $1 AND finished_at < $2), 0))::float8 AS usd`,
    range,
  )).rows[0]?.usd ?? 0;
  const stale = (await q<{ adapter_id: string }>(
    `SELECT adapter_id FROM reels.watermarks WHERE last_success_at < $1::timestamptz - interval '3 days' ORDER BY adapter_id`,
    [end.toISOString()],
  )).rows.map((r) => r.adapter_id);

  const failures: FailureEvent[] = [];
  let retriedOk = 0;
  for (const run of runs.filter((r) => r.status === 'failed')) {
    failures.push({ vertical: 'reels', night, at: run.at, stage: 'run', reason: reasonFor('run', run.note), severity: 'failed', rawError: run.note ?? undefined, runId: run.id });
  }
  for (const j of jobs) {
    const broken = j.status === 'failed' || j.status === 'rejected_background' || j.status === 'copy_does_not_fit';
    if (!broken) continue;
    const recovered = jobs.some((k) => k.stage === j.stage && k.idea === j.idea && k.status === 'ok' && k.at > j.at);
    if (recovered) retriedOk++;
    failures.push({
      vertical: 'reels', night, at: j.at, stage: j.stage, reason: reasonFor(j.stage, j.error ?? j.status),
      severity: recovered ? 'healed' : 'failed', rawError: j.error ?? j.status, item: { kind: 'idea', id: j.idea, label: `Idea ${j.idea.slice(0, 8)}` },
    });
  }
  const okBy = (stage: string) => new Set(jobs.filter((j) => j.stage === stage && j.status === 'ok').map((j) => j.idea)).size;
  const ideas = new Set(jobs.map((j) => j.idea)).size;
  const made = okBy('video');
  const base = {
    ...emptyReport('reels', night),
    ran: runs.some((r) => ['ok', 'partial', 'failed', 'skipped'].includes(r.status)),
    made,
    retriedOk,
    funnel: funnelFrom(ideas, [['copy', ideas - okBy('copy')], ['frame', okBy('copy') - okBy('frame')], ['video', okBy('frame') - made]]),
    failures,
    spendUsd: spend,
    feedsStale: stale,
  };
  return withPublishing(base, posting, await publishingFor(q, 'reels', night));
};
```

The healed video in the test has no visual or copy job, so its funnel steps clamp at 0 through `Math.max` in `funnelFrom`. That is expected.

- [ ] **Step 4: Write `reporters/explainers.ts`.**

```ts
import type { HubQuery } from '@/lib/social-hub/db';
import { reasonFor } from '@/lib/social-hub/health/reasons';
import { emptyReport, funnelFrom, publishingFor, withPublishing, type ReportContext, type Reporter } from '@/lib/social-hub/health/reporters/shared';
import { cycleBounds } from '@/lib/social-hub/health/time';
import type { FailureEvent } from '@/lib/social-hub/health/types';

type Cycle = { id: string; status: string; error: string | null; generated: number; pool: number; at: string };
type Job = { id: string; status: string; stage: string | null; error: string | null; capped: boolean; spend: number; at: string };

/**
 * `q` here reads the Explainers database; `hubQ` reads social_hub (publishing).
 * They are the same handle in tests and when Explainers share Supabase.
 */
export function makeExplainersReporter(hubQ?: HubQuery) {
  return async (q: HubQuery, { night, posting }: ReportContext) => {
    const { start, end } = cycleBounds(night);
    const range = [start.toISOString(), end.toISOString()];
    const cycles = (await q<Cycle>(
      `SELECT id::text, status, error, ideas_generated AS generated, ideas_entering_pool AS pool, started_at::text AS at
         FROM explainers.idea_cycles WHERE ny_date = $1::date AND mode = 'production'`,
      [night],
    )).rows;
    const jobs = (await q<Job>(
      `SELECT id::text, status, stage, error, capped, spend_usd::float8 AS spend, COALESCE(finished_at, requested_at)::text AS at
         FROM explainers.jobs WHERE mode = 'production' AND requested_at >= $1 AND requested_at < $2`,
      range,
    )).rows;
    const cost = (await q<{ usd: number; unknown: number }>(
      `SELECT COALESCE(sum(usd) FILTER (WHERE usd_known), 0)::float8 AS usd, count(*) FILTER (WHERE NOT usd_known)::int AS unknown
         FROM explainers.cost_events WHERE mode = 'production' AND created_at >= $1 AND created_at < $2`,
      range,
    )).rows[0] ?? { usd: 0, unknown: 0 };

    const failures: FailureEvent[] = [];
    for (const c of cycles.filter((x) => x.status === 'failed')) {
      failures.push({ vertical: 'explainers', night, at: c.at, stage: 'ideas', reason: reasonFor('ideas', c.error), severity: 'failed', rawError: c.error ?? undefined });
    }
    for (const j of jobs.filter((x) => x.status === 'failed' || x.capped)) {
      failures.push({
        vertical: 'explainers', night, at: j.at, stage: j.stage ?? 'render', reason: j.capped ? 'cap_hit' : reasonFor(j.stage ?? 'render', j.error),
        severity: 'failed', rawError: j.error ?? undefined, spentUsd: j.spend, item: { kind: 'job', id: j.id, label: `Render ${j.id.slice(0, 8)}` },
      });
    }
    const made = jobs.filter((j) => j.status === 'ok').length;
    const generated = cycles.reduce((n, c) => n + c.generated, 0);
    const pool = cycles.reduce((n, c) => n + c.pool, 0);
    const base = {
      ...emptyReport('explainers', night),
      ran: cycles.length > 0 || jobs.length > 0,
      made,
      funnel: funnelFrom(generated, [['ideas', generated - pool], ['render', Math.max(0, pool - made)]]),
      failures,
      spendUsd: cost.usd,
      unknownCostCalls: cost.unknown,
    };
    return withPublishing(base, posting, await publishingFor(hubQ ?? q, 'explainers', night));
  };
}

export const reportExplainers: Reporter = (q, ctx) => makeExplainersReporter()(q, ctx);
```

- [ ] **Step 5: Run the tests to confirm they pass.**
Run: `npx tsx --test tests/social-health-reporters.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/social-hub/health/reporters/reels.ts lib/social-hub/health/reporters/explainers.ts tests/social-health-reporters.test.ts
git commit -m "feat(health): Text on Screen and Explainer Reels reporters"
```

---

### Task 6: Night builder, store, morning report job and readiness

**Files:**
- Create: `lib/social-hub/health/night.ts`
- Create: `lib/social-hub/health/store.ts`
- Create: `lib/social-hub/health/job.ts`
- Create: `lib/social-hub/health/readiness.ts`
- Test: `tests/social-health-report-job.test.ts`

**Interfaces:**
- **Consumes:**
  - Tasks 1, 2, 4 and 5.
  - `HEARTBEAT_STALE_MS` (`lib/publishing/publisher.ts`).
  - `VERTICAL_IDS`.
- **Produces:**
  - `REPORTERS: Record<Vertical, Reporter>`
  - `type Handles = { q: HubQuery; explainersQ: () => Promise<HubQuery>; posting: (v: Vertical) => Promise<PostingState> }`
  - `publisherTone(q: HubQuery, now: Date): Promise<Tone>`
  - `buildNight(h: Handles, night: string, now: Date, publisher: Tone): Promise<StoredReport>`
  - `saveReport(q, r, mode: 'replace' | 'missing-only'): Promise<void>`
  - `readReports(q, from: string, to: string): Promise<StoredReport[]>`
  - `runMorningReport(h: Handles, now: Date, backfill?: number): Promise<{ night: string; backfilled: number }>`
  - `type Readiness = { vertical: Vertical; approved: number; rejected: number; rate: number | null }`
  - `readinessFor(q, now: Date): Promise<Readiness[]>`

- [ ] **Step 1: Write the failing tests.**

```ts
// tests/social-health-report-job.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PostingState } from '@/lib/content-type/posting';
import type { HubQuery } from '@/lib/social-hub/db';
import { runMorningReport } from '@/lib/social-hub/health/job';
import { buildNight, publisherTone } from '@/lib/social-hub/health/night';
import { readinessFor } from '@/lib/social-hub/health/readiness';
import { readReports } from '@/lib/social-hub/health/store';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const NOW = new Date('2026-10-13T11:31:00Z');
const posting = async (v: string): Promise<PostingState> =>
  ({ type: v, live: true, generate: true, autoPublish: false, perDay: v === 'stories' ? null : 1, maxPerDay: 3,
     series: v === 'stories' ? [{ id: 'morning_download', label: 'MD', enabled: true, generate: true, days: [0, 1, 2, 3, 4, 5, 6] }] : null }) as PostingState;

test('a reporter that throws does not break the night: that type reads as unknown', async () => {
  const { query } = await openHubTestDb();
  const broken: HubQuery = async () => { throw new Error('explainers database unreachable'); };
  const night = await buildNight({ q: query, explainersQ: async () => broken, posting }, '2026-10-13', NOW, 'worked');
  const exp = night.reports.find((r) => r.vertical === 'explainers')!;
  assert.match(exp.reportError ?? '', /unreachable/);
  assert.equal(night.verdict.types.find((t) => t.vertical === 'explainers')!.tone, 'short');
  assert.equal(night.reports.length, 4);
});

test('failures on a type that met its target are downgraded to warnings', async () => {
  const { query } = await openHubTestDb();
  await query(`
    INSERT INTO social.runs (kind, started_at, hook_pass, cap_usd, total_usd, trigger, status, requested_at, record) VALUES
      ('daily', '2026-10-13T07:00:00Z', true, 2, 1, 'scheduled', 'ok', '2026-10-13T07:00:00Z', '{"result":{"posts":[{"storyId":"a"}]}}');
    INSERT INTO social.set_asides (day, story_id, stage, reason_code, kind, detail, at) VALUES
      ('2026-10-13', 'st-9', 'writer', 'over-limit', 'pipeline-fault', 'too long', '2026-10-13T07:14:00Z');
  `);
  const night = await buildNight({ q: query, explainersQ: async () => query, posting }, '2026-10-13', NOW, 'worked');
  const car = night.reports.find((r) => r.vertical === 'carousels')!;
  assert.equal(car.made, 1);
  assert.equal(car.failures.find((f) => f.stage === 'writer')!.severity, 'warning');
});

test('publisher tone: fresh heartbeat worked, stale failed, missing none', async () => {
  const { query } = await openHubTestDb();
  assert.equal(await publisherTone(query, NOW), 'none');
  await query(`INSERT INTO social_hub.settings (key, value) VALUES ('publisher_heartbeat', $1::jsonb)`, [JSON.stringify({ at: '2026-10-13T11:30:00Z', verticals: [] })]);
  assert.equal(await publisherTone(query, NOW), 'worked');
  assert.equal(await publisherTone(query, new Date('2026-10-13T11:40:00Z')), 'failed');
});

test('morning report: saves today, backfills missing nights once, is idempotent', async () => {
  const { query } = await openHubTestDb();
  const h = { q: query, explainersQ: async () => query, posting };
  const first = await runMorningReport(h, NOW, 5);
  assert.equal(first.night, '2026-10-13');
  assert.equal(first.backfilled, 4);
  const again = await runMorningReport(h, NOW, 5);
  assert.equal(again.backfilled, 0);
  const stored = await readReports(query, '2026-10-09', '2026-10-13');
  assert.deepEqual(stored.map((r) => r.night), ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']);
  assert.equal(stored[0]!.verdict.publisher, 'none'); // backfilled nights have no heartbeat
});

test('readiness: approved-as-is rate per type over 30 days', async () => {
  const { query } = await openHubTestDb();
  await query(`
    INSERT INTO social_hub.content_items (id, vertical, format, native_ref) VALUES
      ('00000000-0000-0000-0000-0000000000b1', 'reels', 'reel', 'v1'), ('00000000-0000-0000-0000-0000000000b2', 'reels', 'reel', 'v2'),
      ('00000000-0000-0000-0000-0000000000b3', 'reels', 'reel', 'v3'), ('00000000-0000-0000-0000-0000000000b4', 'reels', 'reel', 'v4');
    INSERT INTO social_hub.approvals (content_item_id, decision, decided_at, via) VALUES
      ('00000000-0000-0000-0000-0000000000b1', 'approved', '2026-10-10T12:00:00Z', 'user'),
      ('00000000-0000-0000-0000-0000000000b2', 'approved', '2026-10-10T12:00:00Z', 'user'),
      ('00000000-0000-0000-0000-0000000000b3', 'approved', '2026-10-10T12:00:00Z', 'user'),
      ('00000000-0000-0000-0000-0000000000b4', 'rejected', '2026-10-10T12:00:00Z', 'user');
  `);
  const r = (await readinessFor(query, NOW)).find((x) => x.vertical === 'reels')!;
  assert.equal(r.rate, 0.75);
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**
Run: `npx tsx --test tests/social-health-report-job.test.ts`
Expected: FAIL, because the modules can't be found.

- [ ] **Step 3: Write `night.ts`.**

```ts
import type { PostingState } from '@/lib/content-type/posting';
import { HEARTBEAT_STALE_MS } from '@/lib/publishing/publisher';
import type { HubQuery } from '@/lib/social-hub/db';
import { reportCarousels } from '@/lib/social-hub/health/reporters/carousels';
import { makeExplainersReporter } from '@/lib/social-hub/health/reporters/explainers';
import { reportReels } from '@/lib/social-hub/health/reporters/reels';
import { emptyReport, type Reporter } from '@/lib/social-hub/health/reporters/shared';
import { reportStories } from '@/lib/social-hub/health/reporters/stories';
import type { NightReport, StoredReport, Tone } from '@/lib/social-hub/health/types';
import { nightVerdict } from '@/lib/social-hub/health/verdict';
import type { Vertical } from '@/lib/social-hub/types';
import { VERTICAL_IDS } from '@/lib/social-hub/verticals';

export type Handles = { q: HubQuery; explainersQ: () => Promise<HubQuery>; posting: (v: Vertical) => Promise<PostingState> };

/** A new content type is a compile error here until it has a reporter (spec §4.2). */
export const REPORTERS: Record<Vertical, (h: Handles) => Promise<{ q: HubQuery; run: Reporter }>> = {
  reels: async (h) => ({ q: h.q, run: reportReels }),
  carousels: async (h) => ({ q: h.q, run: reportCarousels }),
  stories: async (h) => ({ q: h.q, run: reportStories }),
  explainers: async (h) => ({ q: await h.explainersQ(), run: makeExplainersReporter(h.q) }),
};

export async function publisherTone(q: HubQuery, now: Date): Promise<Tone> {
  const { rows } = await q<{ value: { at?: string } }>(`SELECT value FROM social_hub.settings WHERE key = 'publisher_heartbeat'`);
  const at = rows[0]?.value?.at;
  if (!at) return 'none';
  return now.getTime() - Date.parse(at) > HEARTBEAT_STALE_MS ? 'failed' : 'worked';
}

/** Failures on a type that met its target were absorbed: they stay visible, as warnings. Publish failures keep their severity. */
function settle(r: NightReport): NightReport {
  if (r.made < r.target) return r;
  return { ...r, failures: r.failures.map((f) => (f.severity === 'failed' && f.stage !== 'publish' ? { ...f, severity: 'warning' as const } : f)) };
}

export async function buildNight(h: Handles, night: string, now: Date, publisher: Tone): Promise<StoredReport> {
  const reports = await Promise.all(
    VERTICAL_IDS.map(async (v) => {
      try {
        const posting = await h.posting(v);
        const { q, run } = await REPORTERS[v](h);
        return settle(await run(q, { night, posting, now }));
      } catch (error) {
        return { ...emptyReport(v, night), due: true, reportError: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  const failures = reports.flatMap((r) => r.failures);
  return { night, builtAt: now.toISOString(), verdict: nightVerdict(night, reports, publisher), reports, failures };
}
```

- [ ] **Step 4: Write `store.ts`.**

```ts
import type { HubQuery } from '@/lib/social-hub/db';
import type { StoredReport } from '@/lib/social-hub/health/types';

export async function saveReport(q: HubQuery, r: StoredReport, mode: 'replace' | 'missing-only'): Promise<void> {
  await q(
    `INSERT INTO social_hub.health_reports (night, built_at, verdict, reports, failures)
     VALUES ($1::date, $2::timestamptz, $3::jsonb, $4::jsonb, $5::jsonb)
     ON CONFLICT (night) DO ${mode === 'replace' ? 'UPDATE SET built_at = EXCLUDED.built_at, verdict = EXCLUDED.verdict, reports = EXCLUDED.reports, failures = EXCLUDED.failures' : 'NOTHING'}`,
    [r.night, r.builtAt, JSON.stringify(r.verdict), JSON.stringify(r.reports), JSON.stringify(r.failures)],
  );
}

export async function readReports(q: HubQuery, from: string, to: string): Promise<StoredReport[]> {
  const { rows } = await q<{ night: string; built_at: string; verdict: StoredReport['verdict']; reports: StoredReport['reports']; failures: StoredReport['failures'] }>(
    `SELECT to_char(night, 'YYYY-MM-DD') AS night, built_at::text, verdict, reports, failures
       FROM social_hub.health_reports WHERE night >= $1::date AND night <= $2::date ORDER BY night`,
    [from, to],
  );
  return rows.map((r) => ({ night: r.night, builtAt: r.built_at, verdict: r.verdict, reports: r.reports, failures: r.failures }));
}

export async function storedNights(q: HubQuery, from: string, to: string): Promise<Set<string>> {
  const { rows } = await q<{ night: string }>(
    `SELECT to_char(night, 'YYYY-MM-DD') AS night FROM social_hub.health_reports WHERE night >= $1::date AND night <= $2::date`,
    [from, to],
  );
  return new Set(rows.map((r) => r.night));
}
```

- [ ] **Step 5: Write `job.ts`.**

```ts
import { buildNight, publisherTone, type Handles } from '@/lib/social-hub/health/night';
import { saveReport, storedNights } from '@/lib/social-hub/health/store';
import { nightsEnding, reportNightFor } from '@/lib/social-hub/health/time';

/**
 * The 07:30 morning report (spec §4.3). It replaces tonight's row, then fills
 * any missing night in the last `backfill` from the source tables. This is a
 * read-only report, not an enrichment sweep. Backfilled nights have no
 * heartbeat, so their publisher tone is 'none'.
 */
export async function runMorningReport(h: Handles, now: Date, backfill = 30): Promise<{ night: string; backfilled: number }> {
  const night = reportNightFor(now);
  await saveReport(h.q, await buildNight(h, night, now, await publisherTone(h.q, now)), 'replace');
  const window = nightsEnding(night, backfill).slice(0, -1);
  const have = await storedNights(h.q, window[0] ?? night, night);
  let backfilled = 0;
  for (const n of window) {
    if (have.has(n)) continue;
    await saveReport(h.q, await buildNight(h, n, now, 'none'), 'missing-only');
    backfilled++;
  }
  return { night, backfilled };
}
```

- [ ] **Step 6: Write `readiness.ts`.**

```ts
import type { HubQuery } from '@/lib/social-hub/db';
import type { Vertical } from '@/lib/social-hub/types';
import { VERTICAL_IDS } from '@/lib/social-hub/verticals';

export type Readiness = { vertical: Vertical; approved: number; rejected: number; rate: number | null };

/** Approved-as-is rate over 30 days: a person's approve ÷ (approve + reject). Rejection rate = 1 − rate. */
export async function readinessFor(q: HubQuery, now: Date): Promise<Readiness[]> {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const { rows } = await q<{ vertical: Vertical; approved: number; rejected: number }>(
    `SELECT ci.vertical,
            count(*) FILTER (WHERE a.decision = 'approved' AND a.via = 'user')::int AS approved,
            count(*) FILTER (WHERE a.decision = 'rejected')::int AS rejected
       FROM social_hub.approvals a JOIN social_hub.content_items ci ON ci.id = a.content_item_id
      WHERE a.decided_at >= $1 GROUP BY ci.vertical`,
    [since],
  );
  return VERTICAL_IDS.map((vertical) => {
    const r = rows.find((x) => x.vertical === vertical) ?? { approved: 0, rejected: 0 };
    const total = r.approved + r.rejected;
    return { vertical, approved: r.approved, rejected: r.rejected, rate: total ? r.approved / total : null };
  });
}
```

- [ ] **Step 7: Run the tests to confirm they pass.**
Run: `npx tsx --test tests/social-health-report-job.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add lib/social-hub/health/night.ts lib/social-hub/health/store.ts lib/social-hub/health/job.ts lib/social-hub/health/readiness.ts tests/social-health-report-job.test.ts
git commit -m "feat(health): night builder, stored morning report with backfill, readiness"
```

---

### Task 7: Health view model and Copy-for-Claude brief

**Files:**
- Create: `lib/social-hub/health/view.ts`
- Create: `lib/social-hub/health/brief.ts`
- Create: `tests/fixtures/social-hub/health-fixture.ts`
- Test: `tests/social-health-view.test.ts`

**Interfaces:**
- **Consumes:** Tasks 1, 2 and 6 (types, `groupProblems`, streaks, `Readiness`); `verticalInfo`, `VERTICALS`.
- **Produces:**

```ts
type HealthModel = {
  reportNight: string; eyebrow: string; clean: boolean;
  headline: { lead: string; emphasis: string | null; rest: string | null }; lede: string;
  chips: Array<{ id: string; text: string; best?: boolean }>;
  monthClean: { clean: number; nights: number };
  rows: HealthRow[]; problems: Problem[]; fixed: Problem[];
  readiness: Readiness[]; windowNights: number; empty: boolean;
};
type HealthRow = { id: Vertical | 'publisher'; label: string; colorVar: string | null; blocks: HealthBlock[]; status: Tone; statusWord: string; sub: string };
type HealthBlock = { night: string; tone: Tone; live: boolean; card: { title: string; status: string; lines: Array<[string, string]>; why: string | null } };
```

  - `healthModel(input: { stored: StoredReport[]; live: StoredReport | null; readiness: Readiness[]; now: Date; windowNights: 14 | 30 }): HealthModel`
  - `briefFor(problem: Problem): string`
  - `previewHealth(): { stored: StoredReport[]; live: null; readiness: Readiness[]; now: Date }`

- [ ] **Step 1: Write the fixture** (`tests/fixtures/social-hub/health-fixture.ts`). It is deterministic: 30 nights ending 2026-10-08 (the night of `FIXTURE_NOW`). Carousels Writer fails on 09-28, 10-03 and 10-08; Explainers has a healed publish retry on 10-08; a Stories feed is stale on 10-08; Text on Screen is clean except one short night.

```ts
import type { Readiness } from '@/lib/social-hub/health/readiness';
import { emptyReport } from '@/lib/social-hub/health/reporters/shared';
import { nightsEnding } from '@/lib/social-hub/health/time';
import type { FailureEvent, NightReport, StoredReport } from '@/lib/social-hub/health/types';
import { nightVerdict } from '@/lib/social-hub/health/verdict';
import type { Vertical } from '@/lib/social-hub/types';

import { FIXTURE_NOW } from './preview-dataset';

const LAST = '2026-10-08';
const QUOTA: Record<Vertical, number> = { reels: 3, explainers: 2, carousels: 1, stories: 1 };

function report(v: Vertical, night: string): NightReport {
  const q = QUOTA[v];
  const r: NightReport = { ...emptyReport(v, night), due: true, ran: true, target: q, made: q, needed: q, ready: q, scheduledYesterday: q, postedYesterday: q, spendUsd: q * 0.9 };
  const fail = (over: Partial<FailureEvent>): FailureEvent => ({ vertical: v, night, at: `${night}T07:14:00Z`, stage: 'run', reason: 'other', severity: 'failed', ...over });
  if (v === 'carousels' && ['2026-09-28', '2026-10-03', LAST].includes(night)) {
    r.made = 0; r.ready = 0;
    r.funnel = [{ stage: 'jev-scoring', in: 30, out: 12 }, { stage: 'writer', in: 2, out: 0 }];
    r.failures = [fail({ stage: 'writer', reason: 'too_long', rawError: 'slide 3 over 40 words', item: { kind: 'story', id: 'st-1', label: "OpenAI's new model" } })];
  }
  if (v === 'explainers' && night === LAST) {
    r.retriedOk = 1;
    r.failures = [fail({ stage: 'publish', reason: 'service_5xx', severity: 'healed', rawError: 'Meta returned 500' })];
  }
  if (v === 'stories' && night === LAST) r.feedsStale = ['TechCrunch AI'];
  if (v === 'reels' && night === '2026-10-01') r.retriedOk = 1;
  return r;
}

export function previewHealth(): { stored: StoredReport[]; live: null; readiness: Readiness[]; now: Date } {
  const stored = nightsEnding(LAST, 30).map((night): StoredReport => {
    const reports = (['reels', 'explainers', 'carousels', 'stories'] as Vertical[]).map((v) => report(v, night));
    return { night, builtAt: `${night}T11:30:00Z`, verdict: nightVerdict(night, reports, 'worked'), reports, failures: reports.flatMap((r) => r.failures) };
  });
  const readiness: Readiness[] = [
    { vertical: 'reels', approved: 46, rejected: 2, rate: 46 / 48 },
    { vertical: 'explainers', approved: 22, rejected: 8, rate: 22 / 30 },
    { vertical: 'carousels', approved: 27, rejected: 6, rate: 27 / 33 },
    { vertical: 'stories', approved: 20, rejected: 2, rate: 20 / 22 },
  ];
  return { stored, live: null, readiness, now: FIXTURE_NOW };
}
```

- [ ] **Step 2: Write the failing tests.**

```ts
// tests/social-health-view.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { briefFor } from '@/lib/social-hub/health/brief';
import { healthModel } from '@/lib/social-hub/health/view';

import { previewHealth } from './fixtures/social-hub/health-fixture';

test('headline names the type that failed and how often', () => {
  const m = healthModel({ ...previewHealth(), windowNights: 14 });
  assert.equal(m.reportNight, '2026-10-08');
  assert.equal(m.headline.lead, 'Last night, 3 of 4 worked.');
  assert.equal(m.headline.emphasis, "Carousels didn't.");
  assert.match(m.lede, /Writer/);
  assert.match(m.lede, /third time in 14 nights/);
  assert.equal(m.clean, false);
});

test('rows: one per type plus publisher, labels from VERTICALS, 14 blocks each', () => {
  const m = healthModel({ ...previewHealth(), windowNights: 14 });
  assert.deepEqual(m.rows.map((r) => r.label), ['Text on Screen', 'Explainer Reels', 'Carousels', 'IG Stories', 'Publisher']);
  assert.ok(m.rows.every((r) => r.blocks.length === 14));
  const car = m.rows[2]!;
  assert.equal(car.blocks.at(-1)!.tone, 'failed');
  assert.equal(car.blocks.at(-1)!.card.status, 'Failed');
  assert.deepEqual(car.blocks.at(-1)!.card.lines[0], ['Made', '0 of 1']);
  assert.match(car.blocks.at(-1)!.card.why ?? '', /Writer/);
  assert.equal(m.rows[0]!.blocks.at(-1)!.card.why, 'Clean night ✓');
});

test('problems: writer problem current and back again; fixed list empty in this window', () => {
  const m = healthModel({ ...previewHealth(), windowNights: 14 });
  const writer = m.problems.find((p) => p.key === 'carousels|writer|too_long')!;
  assert.equal(writer.tone, 'current');
  assert.equal(writer.count, 3); // 09-28, 10-03 and 10-08 all fall inside 09-25..10-08
  assert.equal(writer.backAgain, true);
  assert.equal(m.fixed.length, 0);
});

test('a clean night reads as clean and gets streak chips', () => {
  const h = previewHealth();
  const stored = h.stored.slice(0, -1); // drop 10-08 → 10-07 is newest and clean
  const m = healthModel({ ...h, stored, now: new Date('2026-10-07T19:00:00Z'), windowNights: 14 });
  assert.equal(m.clean, true);
  assert.equal(m.headline.lead, 'Clean night.');
  assert.ok(m.chips.some((c) => /clean nights/.test(c.text)));
});

test('no reports yet → empty model with a first-report note', () => {
  const m = healthModel({ stored: [], live: null, readiness: [], now: new Date('2026-10-13T12:00:00Z'), windowNights: 14 });
  assert.equal(m.empty, true);
});

test('brief carries type, stage, reason, raw error, nights and files', () => {
  const m = healthModel({ ...previewHealth(), windowNights: 14 });
  const brief = briefFor(m.problems.find((p) => p.key === 'carousels|writer|too_long')!);
  for (const s of ['Carousels', 'Writer', 'too_long', 'slide 3 over 40 words', '2026-10-03', 'lib/social/']) assert.ok(brief.includes(s), s);
});
```

- [ ] **Step 3: Run the tests to confirm they fail.**
Run: `npx tsx --test tests/social-health-view.test.ts`
Expected: FAIL, because the modules can't be found.

- [ ] **Step 4: Write `brief.ts`.**

```ts
import type { Problem } from '@/lib/social-hub/health/problems';
import { REASON_LABEL, stageLabel } from '@/lib/social-hub/health/reasons';
import type { Vertical } from '@/lib/social-hub/types';
import { verticalInfo } from '@/lib/social-hub/verticals';

/** Where to start reading for each type; the publish stage is shared. */
const FILES: Record<Vertical, string[]> = {
  reels: ['lib/reels/'],
  explainers: ['lib/explainers/render/job.ts', 'lib/explainers/'],
  carousels: ['lib/social/pipeline/', 'lib/social/writer/prompt.ts'],
  stories: ['lib/stories/build/'],
};

export function briefFor(p: Problem): string {
  const files = p.stage === 'publish' ? ['lib/publishing/publisher.ts'] : FILES[p.vertical];
  const lines = [
    `# Helios Social health problem: ${verticalInfo(p.vertical).label} · ${stageLabel(p.stage)}`,
    '',
    `- Reason: ${p.reason} (${REASON_LABEL[p.reason] ?? 'unlabeled'})`,
    `- Seen on ${p.count} night(s): ${p.nights.join(', ')}${p.backAgain ? ' (back again after a quiet stretch)' : ''}`,
    `- Latest: ${p.latest.at}${p.latest.runId ? ` · run ${p.latest.runId}` : ''}${p.latest.item ? ` · ${p.latest.item.kind} ${p.latest.item.id} (${p.latest.item.label})` : ''}`,
    '',
    '## Raw errors (newest first)',
    ...p.events.slice().reverse().slice(0, 5).map((e) => `- ${e.night} ${e.at}: ${e.rawError ?? '(no message)'}`),
    '',
    '## Start reading',
    ...files.map((f) => `- ${f}`),
    '',
    'Fix the stage that produced this, not a downstream check. Do not run live pipelines to reproduce; use fixtures.',
  ];
  return lines.join('\n');
}
```

- [ ] **Step 5: Write `view.ts`.**

```ts
import { bestStreak, cleanStreak, groupProblems, type Problem } from '@/lib/social-hub/health/problems';
import type { Readiness } from '@/lib/social-hub/health/readiness';
import { REASON_LABEL, stageLabel } from '@/lib/social-hub/health/reasons';
import { nightsEnding, reportNightFor } from '@/lib/social-hub/health/time';
import type { NightReport, StoredReport, Tone, TypeVerdict } from '@/lib/social-hub/health/types';
import { dayLabel } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';
import { VERTICALS, verticalInfo } from '@/lib/social-hub/verticals';

export type HealthBlock = { night: string; tone: Tone; live: boolean; card: { title: string; status: string; lines: Array<[string, string]>; why: string | null } };
export type HealthRow = { id: Vertical | 'publisher'; label: string; colorVar: string | null; blocks: HealthBlock[]; status: Tone; statusWord: string; sub: string };
export type HealthModel = {
  reportNight: string; eyebrow: string; clean: boolean;
  headline: { lead: string; emphasis: string | null; rest: string | null }; lede: string;
  chips: Array<{ id: string; text: string; best?: boolean }>;
  monthClean: { clean: number; nights: number };
  rows: HealthRow[]; problems: Problem[]; fixed: Problem[];
  readiness: Readiness[]; windowNights: number; empty: boolean;
};

const WORD: Record<Tone, string> = { worked: 'Worked', short: 'Short', failed: 'Failed', none: "Didn't run" };
const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
const ordinal = (n: number) => ORDINAL[n] ?? `${n}th`;
const money = (n: number) => `$${n.toFixed(2)}`;

function cleanNight(r: StoredReport | undefined): boolean {
  if (!r) return false;
  const counted = r.verdict.types.filter((t) => t.tone !== 'none');
  return counted.length > 0 && counted.every((t) => t.tone === 'worked') && r.verdict.publisher !== 'failed';
}

function card(v: Vertical, night: string, t: TypeVerdict | undefined, rep: NightReport | undefined): HealthBlock['card'] {
  const title = `${verticalInfo(v).label} · ${dayLabel(night)}`;
  if (!t || !rep || t.tone === 'none') return { title, status: WORD.none, lines: [], why: rep?.reportError ? "Couldn't read this type's data" : 'No run that night' };
  return {
    title,
    status: WORD[t.tone],
    lines: [['Made', `${rep.made} of ${rep.target}`], ['Posted', `${rep.postedYesterday} of ${rep.scheduledYesterday}`], ['Spend', money(rep.spendUsd)]],
    why: t.tone === 'worked' ? 'Clean night ✓' : t.cause,
  };
}

export function healthModel(input: { stored: StoredReport[]; live: StoredReport | null; readiness: Readiness[]; now: Date; windowNights: 14 | 30 }): HealthModel {
  const reportNight = input.stored.at(-1)?.night ?? reportNightFor(input.now);
  const window = nightsEnding(reportNight, input.windowNights);
  const byNight = new Map(input.stored.map((r) => [r.night, r]));
  if (input.live && input.live.night === reportNight) byNight.set(reportNight, input.live);
  const latest = byNight.get(reportNight);
  const empty = !latest;

  const rows: HealthRow[] = VERTICALS.map((info) => {
    const blocks = window.map((night): HealthBlock => {
      const r = byNight.get(night);
      const t = r?.verdict.types.find((x) => x.vertical === info.id);
      const rep = r?.reports.find((x) => x.vertical === info.id);
      return { night, tone: t?.tone ?? 'none', live: Boolean(input.live && night === input.live.night), card: card(info.id, night, t, rep) };
    });
    const tones = blocks.map((b) => b.tone);
    const streak = cleanStreak(tones);
    const status = tones.at(-1) ?? 'none';
    const counted = tones.filter((t) => t !== 'none');
    return {
      id: info.id, label: info.label, colorVar: info.colorVar, blocks, status, statusWord: WORD[status],
      sub: streak >= 2 ? `🔥 ${streak} in a row` : `${counted.filter((t) => t !== 'failed').length} of ${counted.length} nights`,
    };
  });
  const pubBlocks = window.map((night): HealthBlock => {
    const tone = byNight.get(night)?.verdict.publisher ?? 'none';
    return { night, tone, live: false, card: { title: `Publisher · ${dayLabel(night)}`, status: tone === 'none' ? 'No heartbeat recorded' : tone === 'worked' ? 'Alive' : 'Stopped', lines: [], why: null } };
  });
  const pubStatus = pubBlocks.at(-1)!.tone;
  rows.push({ id: 'publisher', label: 'Publisher', colorVar: null, blocks: pubBlocks, status: pubStatus, statusWord: pubStatus === 'failed' ? 'Stopped' : pubStatus === 'worked' ? 'Alive' : 'Unknown', sub: '' });

  const all = groupProblems(window.flatMap((n) => byNight.get(n)?.failures ?? []), window);
  const problems = all.filter((p) => p.state === 'open');
  const fixed = all.filter((p) => p.state !== 'open');

  const clean = cleanNight(latest);
  const failed = latest?.verdict.types.filter((t) => t.tone === 'failed') ?? [];
  const labels = failed.map((t) => verticalInfo(t.vertical).label);
  const headline = empty
    ? { lead: 'No morning report yet.', emphasis: null, rest: null }
    : clean
      ? { lead: 'Clean night.', emphasis: null, rest: `All ${latest!.verdict.total} worked.` }
      : { lead: `Last night, ${latest!.verdict.worked} of ${latest!.verdict.total} worked.`, emphasis: labels.length ? `${labels.join(' and ')} didn't.` : null, rest: null };

  let lede = empty ? 'The first report is written at 7:30 AM.' : '';
  if (!empty && clean) lede = `All ${latest!.verdict.total} types made what they needed and every post went out.`;
  if (!empty && !clean) {
    const first = failed[0] ?? latest!.verdict.types.find((t) => t.tone === 'short');
    const rep = first && latest!.reports.find((r) => r.vertical === first.vertical);
    const lead = rep?.failures.find((f) => f.severity === 'failed') ?? rep?.failures[0];
    const prob = lead && all.find((p) => p.key === `${lead.vertical}|${lead.stage}|${lead.reason}`);
    const what = lead ? `${stageLabel(lead.stage)}: ${REASON_LABEL[lead.reason] ?? lead.reason}` : first?.cause ?? '';
    lede = first && rep ? `${verticalInfo(first.vertical).label} made ${rep.made} of ${rep.target}. ${what}.` : '';
    if (prob && prob.count > 1) lede += ` It's the ${ordinal(prob.count)} time in ${input.windowNights} nights.`;
  }

  const month = reportNight.slice(0, 7);
  const monthNights = [...byNight.values()].filter((r) => r.night.startsWith(month) && r.night <= reportNight);
  const monthClean = { clean: monthNights.filter(cleanNight).length, nights: monthNights.length };
  const allTones = nightsEnding(reportNight, 30).map((n): Tone => (byNight.has(n) ? (cleanNight(byNight.get(n)) ? 'worked' : 'failed') : 'none'));
  const chips: HealthModel['chips'] = [];
  const top = rows.filter((r) => r.id !== 'publisher').map((r) => ({ r, s: cleanStreak(r.blocks.map((b) => b.tone)) })).sort((a, b) => b.s - a.s)[0];
  if (top && top.s >= 2) chips.push({ id: 'streak', text: `🔥 ${top.r.label} ${top.s} clean nights` });
  const allStreak = cleanStreak(allTones);
  if (allStreak >= 3 && allStreak === bestStreak(allTones)) chips.push({ id: 'best', text: `✦ New best: ${allStreak} clean nights in a row, all types`, best: true });
  if (monthClean.nights) chips.push({ id: 'month', text: `Clean nights this month ${monthClean.clean} of ${monthClean.nights}` });

  return {
    reportNight, eyebrow: `Morning report · ${dayLabel(reportNight)} · 7:30 AM`, clean, headline, lede, chips, monthClean,
    rows, problems, fixed, readiness: input.readiness, windowNights: input.windowNights, empty,
  };
}
```

`dayLabel` comes from `lib/social-hub/time.ts`. Check its signature (`dayLabel(nyDate: string): string`); if it differs, adapt the call. The tests only match on stable text.

- [ ] **Step 6: Run the tests to confirm they pass.**
Run: `npx tsx --test tests/social-health-view.test.ts`
Expected: PASS. The 14-night window ending 10-08 starts 09-25, so it holds all three Carousels Writer nights (09-28, 10-03, 10-08). That gives "third time in 14 nights".

- [ ] **Step 7: Commit.**

```bash
git add lib/social-hub/health/view.ts lib/social-hub/health/brief.ts tests/fixtures/social-hub/health-fixture.ts tests/social-health-view.test.ts
git commit -m "feat(health): page view model, Copy for Claude brief, preview fixture"
```

---

### Task 8: Health tab: nav, flag, routes and UI

**Files:**
- Modify: `lib/social-hub/flags.ts` (`ViewFlag` adds `'health' | 'cost'`; both views `true`)
- Modify: `lib/social-hub/views/nav.ts` (`HubTab` adds `'health'`; `HUB_TABS` adds Health; `sectionOf` and `crumbsFor` learn `/health`)
- Modify: `tests/social-hub-nav.test.ts` (four tabs; `/health` section and crumbs)
- Create: `lib/social-hub/health/load.ts`
- Create: `components/social-hub/health/HealthScreen.tsx`
- Create: `components/social-hub/health/NightRows.tsx` (client)
- Create: `components/social-hub/health/ProblemsList.tsx` (client)
- Create: `components/social-hub/health/NightDetail.tsx`
- Create: `app/social/(hub)/hub-ops.css`
- Modify: `app/social/(hub)/layout.tsx` (import `./hub-ops.css`)
- Create pages:
  - `app/social/(hub)/health/page.tsx`
  - `app/social/(hub)/health/night/[date]/page.tsx`
  - `app/social/(hub)/preview/health/page.tsx`
  - `app/social/(hub)/preview/health/night/[date]/page.tsx`

**Interfaces:**
- **Consumes:**
  - `healthModel`, `previewHealth`, `briefFor`, `readReports`, `buildNight`, `publisherTone`, `readinessFor`;
  - `readPosting`; `explainersHubQuery`, `liveHubQuery`;
  - `assertPreviewAllowed` (`lib/social-hub/preview.ts`), `PREVIEW_BASE`, `HUB_BASE`.
- **Produces:**
  - `loadHealthPage(now: Date, windowNights: 14 | 30): Promise<{ stored; live; readiness } | { error: string }>`
  - `<HealthScreen model base />` and `<NightDetail report base />`

- [ ] **Step 1: Write failing nav tests** (append to `tests/social-hub-nav.test.ts`).

```ts
test('Health is the fourth hub tab with its own section and crumb', () => {
  assert.deepEqual(HUB_TABS.map((t) => t.label), ['Content', 'Calendar', 'Analytics', 'Health']);
  assert.equal(sectionOf('/health'), 'health');
  assert.equal(sectionOf('/health/night/2026-10-13'), 'health');
  assert.deepEqual(crumbsFor('/social', '/social/health/night/2026-10-13').map((c) => c.label), ['Health', 'Night of Oct 13']);
  assert.deepEqual(crumbsFor('/social', '/social/analytics/cost').map((c) => c.label), ['Analytics', 'Cost']);
});
```

Make sure `HUB_TABS`, `sectionOf` and `crumbsFor` are imported at the top of that test file. If an existing test asserts exactly three tabs, update it to four.

- [ ] **Step 2: Run the nav test to confirm it fails.**
Run: `npx tsx --test tests/social-hub-nav.test.ts`
Expected: FAIL on the new test.

- [ ] **Step 3: Update `nav.ts`.**
  - `export type HubTab = 'content' | 'calendar' | 'analytics' | 'health';`
  - Append `{ id: 'health', label: 'Health', path: '/health' }` to `HUB_TABS`.
  - In `sectionOf`, add `if (rest.startsWith('/health')) return 'health';` before the final return.
  - In `crumbsFor`:
    - In the `analytics` branch, add `if (parts[1] === 'cost') push('Cost', '/analytics/cost');` before the `isVertical` check.
    - Add a branch before the `isTypePage` check:

```ts
  } else if (parts[0] === 'health') {
    push('Health', '/health');
    if (parts[1] === 'night' && parts[2]) push(`Night of ${new Date(`${parts[2]}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`, `/health/night/${parts[2]}`);
```

  - In `flags.ts`, set `export type ViewFlag = 'calendar' | 'analytics' | 'house' | 'post' | 'health' | 'cost';` and add `health: true, cost: true` to `views`.

- [ ] **Step 4: Run the nav tests to confirm they pass.**
Run: `npx tsx --test tests/social-hub-nav.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `lib/social-hub/health/load.ts`.**

```ts
import { readPosting } from '@/lib/content-type/posting';
import { explainersHubQuery, liveHubQuery } from '@/lib/social-hub/db';
import { buildNight, publisherTone, type Handles } from '@/lib/social-hub/health/night';
import { readinessFor, type Readiness } from '@/lib/social-hub/health/readiness';
import { readReports } from '@/lib/social-hub/health/store';
import { nightsEnding, reportNightFor } from '@/lib/social-hub/health/time';
import type { StoredReport } from '@/lib/social-hub/health/types';

export const liveHandles: Handles = { q: liveHubQuery, explainersQ: explainersHubQuery, posting: (v) => readPosting(v) };

/** Never throws (like loadForPage). Stored reports for the window, plus a live rebuild of the report night. */
export async function loadHealthPage(now: Date, windowNights: 14 | 30): Promise<{ stored: StoredReport[]; live: StoredReport | null; readiness: Readiness[] } | { error: string }> {
  try {
    const night = reportNightFor(now);
    const window = nightsEnding(night, windowNights);
    const [stored, readiness, publisher] = await Promise.all([readReports(liveHubQuery, window[0]!, night), readinessFor(liveHubQuery, now), publisherTone(liveHubQuery, now)]);
    const live = stored.some((r) => r.night === night) ? await buildNight(liveHandles, night, now, publisher).catch(() => null) : null;
    return { stored, live, readiness };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
```

- [ ] **Step 6: Write the pages.** Each follows the pattern of `app/social/(hub)/analytics/page.tsx`.

```tsx
// app/social/(hub)/health/page.tsx
import { notFound, redirect } from 'next/navigation';

import { HealthScreen } from '@/components/social-hub/health/HealthScreen';
import { LoadError } from '@/components/social-hub/LoadError';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { loadHealthPage } from '@/lib/social-hub/health/load';
import { healthModel } from '@/lib/social-hub/health/view';
import { HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Health · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  if (!SOCIAL_HUB_FLAGS.views.health) notFound();
  const session = await getSession();
  if (!session) redirect('/');
  const windowNights = toParams(await searchParams).get('nights') === '30' ? 30 : 14;
  const now = new Date();
  const loaded = await loadHealthPage(now, windowNights);
  if ('error' in loaded) return <LoadError message={loaded.error} />;
  return <HealthScreen model={healthModel({ ...loaded, now, windowNights })} base={HUB_BASE} />;
}
```

`toParams` returns a `URLSearchParams`-like object; check `lib/social-hub/links.ts` and use its `.get` equivalent if the shape differs.

```tsx
// app/social/(hub)/preview/health/page.tsx
import { HealthScreen } from '@/components/social-hub/health/HealthScreen';
import { healthModel } from '@/lib/social-hub/health/view';
import { PREVIEW_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';

import { previewHealth } from '../../../../../tests/fixtures/social-hub/health-fixture';

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  assertPreviewAllowed();
  const windowNights = toParams(await searchParams).get('nights') === '30' ? 30 : 14;
  return <HealthScreen model={healthModel({ ...previewHealth(), windowNights })} base={PREVIEW_BASE} />;
}
```

Copy the exact fixture import style (alias or relative path) from the existing `app/social/(hub)/preview/page.tsx`.

The night detail pages, both live and preview:
- validate `date` with `isDayKey` and call `notFound()` if it fails;
- live: `readReports(liveHubQuery, date, date)`; preview: the fixture's report for that night;
- pass `report` (a `StoredReport`) to `<NightDetail report={report} base={...} />`;
- if there is no report, render `<LoadError message="No report for that night." />`.

- [ ] **Step 7: Write the components.**
  - All copy must match the approved mockup `health-v5d.html`.
  - Class prefix is `sh-ops-`.
  - Colors are `--sh-v-*` for type marks, and Helios green `#138510` (`--color-accent-2`) for success and active states.

**`HealthScreen.tsx`** is a server component. Its structure:

```tsx
import { PageHead } from '@/components/social-hub/ui/PageHead';
import { NightRows } from '@/components/social-hub/health/NightRows';
import { ProblemsList } from '@/components/social-hub/health/ProblemsList';
import type { HealthModel } from '@/lib/social-hub/health/view';
import { briefFor } from '@/lib/social-hub/health/brief';

export function HealthScreen({ model, base }: { model: HealthModel; base: string }) {
  return (
    <div className="sh-ops">
      <header className={`sh-ops-hero${model.clean ? ' is-clean' : ''}`}>
        <p className="sh-ops-eyebrow">{model.eyebrow}</p>
        <h1 className="sh-ops-big">
          {model.clean ? <span className="sh-ops-good">{model.headline.lead}</span> : model.headline.lead}{' '}
          {model.headline.rest ?? (model.headline.emphasis && <em>{model.headline.emphasis}</em>)}
        </h1>
        <p className="sh-ops-lede">{model.lede}</p>
        {model.chips.length > 0 && (
          <ul className="sh-ops-chips">
            {model.chips.map((c, i) => <li key={c.id} className={c.best ? 'is-best' : undefined} style={{ animationDelay: `${120 * i}ms` }}>{c.text}</li>)}
          </ul>
        )}
        {model.clean && <div className="sh-ops-burst" aria-hidden />}
      </header>

      <section aria-labelledby="h-nights">
        <div className="sh-ops-sechead">
          <h2 id="h-nights">Each type, night by night</h2>
          <nav className="sh-ops-seg" aria-label="Window">
            <a href={`${base}/health`} aria-current={model.windowNights === 14 ? 'page' : undefined}>14 nights</a>
            <a href={`${base}/health?nights=30`} aria-current={model.windowNights === 30 ? 'page' : undefined}>30 nights</a>
          </nav>
        </div>
        <p className="sh-ops-sub">One block per night, colored by its worst outcome. Hover a block to see what happened, or click to open that night.</p>
        <NightRows rows={model.rows} base={base} />
      </section>

      <ProblemsList problems={model.problems} fixed={model.fixed} briefs={Object.fromEntries([...model.problems, ...model.fixed].map((p) => [p.key, briefFor(p)]))} base={base} clean={model.clean} />

      <section className="sh-ops-ready" aria-label="Auto-publish readiness">
        {model.readiness.filter((r) => r.rate !== null).map((r) => (
          <figure key={r.vertical} className="sh-ops-ring" style={{ ['--pct' as string]: String(r.rate) }}>
            <svg viewBox="0 0 60 60" aria-hidden><circle className="bg" cx="30" cy="30" r="24" /><circle className="fg" cx="30" cy="30" r="24" /></svg>
            <figcaption><b>{Math.round(r.rate! * 100)}%</b> approved as-is · {r.vertical === 'reels' ? 'Text on Screen' : r.vertical}</figcaption>
          </figure>
        ))}
      </section>
    </div>
  );
}
```

For the readiness captions, replace the inline label with `verticalInfo(r.vertical).label` (import it). The literal above only shows the intent.

**`NightRows.tsx`** is a `'use client'` component.
- It renders each row: the name with a type mark (`style={{ background: \`var(${row.colorVar})\` }}`), then the blocks as `<a href={\`${base}/health/night/${b.night}\`} className={\`sh-ops-b is-${b.tone}\`} aria-label={\`${b.card.title}: ${b.card.status}\`}>`, then the status word and sub.
- **Hover card:** one shared, absolutely positioned `<div role="tooltip">`. It is shown on `onMouseEnter`/`onFocus` of a block and hidden on `onMouseLeave`/`onBlur`. It renders `card.title`, a status pill (`is-${tone}`), `card.lines` as label/value rows, `card.why`, and the footer "Click to open this night".
- Position it above the block with `getBoundingClientRect`, clamped to the viewport (as in the mockup script).
- Blocks grow in with `animation-delay: ${rowIndex*60 + i*28}ms`.

**`ProblemsList.tsx`** is a `'use client'` component.
- **Section head:** "Problems" plus an ⓘ button (`aria-expanded`, `aria-controls`) that toggles a popover with this copy, verbatim:
  - **intro:** "Each row is one kind of failure. Every time the same thing goes wrong (same type, same stage, same reason), it's counted on the same row instead of being listed again."
  - **Dot:** "Red broke something last night · yellow healed or heads-up · grey quiet lately"
  - **Strip:** "The last 14 nights; a tick marks each night it happened"
  - **Count:** "Times in the window, and when it first appeared"
  - **Back again:** "It returned after a quiet stretch, so a fix didn't hold"
  - **Healed:** "The system recovered on its own (e.g. retried)"
  - **Fixed:** "Quiet for 7 nights after a change. It moves to Fixed."

  Close the popover on Escape or an outside click.
- **Each problem row:**
  - dot `is-${tone}` (it pulses only when `tone==='current'`);
  - the title;
  - a "Back again" tag when `backAgain`, or a "Healed" tag when `tone==='healed'`;
  - a meta line: `latest.rawError` truncated to 90 characters · "See items" (link to `${base}/health/night/${lastSeen}`) · a "Copy for Claude" button that calls `navigator.clipboard.writeText(briefs[key])` and shows "Copied" for 1.5 seconds;
  - a mini strip with one tick per window night, ticked when `nights.includes(n)`;
  - the count `${count}×` and `first ${firstSeen}`.
- **Clean night with no problems:** "Nothing new last night."
- **"Fixed" section:**
  - its sub reads "Problems that stopped happening. Proof the fixes worked.";
  - each row has the self-drawing check SVG from the mockup, the title, and "Fixed {date} · quiet {n} nights · was {count}×" (or "Quiet {n} nights · 1 more to confirm" with an "Almost" tag when `state==='almost'`).

**`NightDetail.tsx`** is a server component. For each type in `report.reports`:
- the status pill and the four checks (label and note);
- the funnel as a row of chips `Stage in → out`, with the broken stage (the first stage with a failure) styled `is-failed`;
- the failures list: stage label, reason label, item label (linked when `href` exists), time, and spend so far;
- the raw error in `<details>`;
- a "Copy for Claude" button that uses `briefFor` for that failure's problem.

  Build it by calling `groupProblems(report.failures, [report.night])`. `NightDetail` needs a small client child for the copy button; reuse the button from `ProblemsList` by exporting it as `CopyBrief`.

**`app/social/(hub)/hub-ops.css`** ports the mockup CSS to tokens.
- **Type scale:** `--sh-fs-*`. The hero's big headline is 30px; the cost total is 44px.
- **Colors:**
  - `--color-accent-2` (#138510) and `--color-accent-2-soft` for green;
  - `--sh-failed-ink` / `--sh-failed-wash` for red;
  - amber `#a15c07` on `#fdf3e1` for short. Define these as `--sh-short-ink` and `--sh-short-wash` at the top of the file.
- **Avoid:** thick side borders on panels; animating `width` or `height` (use `transform: scaleX/scaleY`).
- Wrap all animations in `@media (prefers-reduced-motion: no-preference)`.

- [ ] **Step 8: Run the route, nav and preview tests, plus types.**
Run: `npx tsx --test tests/social-hub-routes.test.ts tests/social-hub-nav.test.ts tests/social-hub-preview.test.ts && npx tsc --noEmit`
Expected: PASS. The routes test sees the preview mirrors for both new live pages.

- [ ] **Step 9: Verify in the browser.**
  1. Start the dev server with `preview_start` (create `.claude/launch.json` with `npm run dev:web` on port 3000 if it doesn't exist).
  2. Open `/social/preview/health`.
  3. Check:
     - the headline reads "Last night, 3 of 4 worked. Carousels didn't.";
     - there are five rows with 14 blocks each;
     - hovering and keyboard-focusing the last Carousels block shows the card with "Made 0 of 1";
     - the ⓘ popover opens and closes;
     - "Copy for Claude" copies text;
     - `?nights=30` shows 30 blocks;
     - with reduced motion emulated, the page is static.
  4. Take a screenshot as proof.

- [ ] **Step 10: Commit.**

```bash
git add lib/social-hub/flags.ts lib/social-hub/views/nav.ts tests/social-hub-nav.test.ts lib/social-hub/health/load.ts components/social-hub/health app/social/\(hub\)/hub-ops.css app/social/\(hub\)/layout.tsx app/social/\(hub\)/health app/social/\(hub\)/preview/health
git commit -m "feat(health): Health tab, night detail, problems with info popover and earned rewards"
```

---

### Task 9: 7:30 morning report in the social worker, then deploy

**Files:**
- Modify: `lib/social/overnight/config.ts` (add `HEALTH_REPORT_HOUR_LOCAL = 7`, `HEALTH_REPORT_MINUTE_LOCAL = 30`)
- Modify: `scripts/social_worker.ts` (add a third clock beside `nextHubSweep`)

**Interfaces:**
- **Consumes:** `runMorningReport` (Task 6); `explainersHubQuery`; `readPosting`; the worker's existing `query`, `nextRunAt`, `log`, `errorText`.

- [ ] **Step 1: Add the constants to `config.ts`.**

```ts
/** Health tab morning report (spec 2026-10-13 §4.3): after Stories (4:00) and the 5:45 sweep. */
export const HEALTH_REPORT_HOUR_LOCAL = 7;
export const HEALTH_REPORT_MINUTE_LOCAL = 30;
```

- [ ] **Step 2: Wire the clock into `scripts/social_worker.ts`.**
  - In `main()`, after `const nextHubSweep = …`, add:

```ts
  const nextHealthReport = () => nextRunAt(new Date(), cfg.HEALTH_REPORT_HOUR_LOCAL, cfg.HEALTH_REPORT_MINUTE_LOCAL);
  const health = await import('@/lib/social-hub/health/job');
  const { explainersHubQuery } = await import('@/lib/social-hub/db');
  const { readPosting } = await import('@/lib/content-type/posting');
```

  - After `let hubSweepAt = nextHubSweep();`, add `let healthAt = nextHealthReport();`.
  - Inside the loop, directly after the `hubSweepAt` block, add:

```ts
      if (Date.now() >= healthAt.getTime()) {
        await health
          .runMorningReport({ q: query, explainersQ: explainersHubQuery, posting: (v) => readPosting(v) }, new Date())
          .then((r) => log('health_report_complete', r))
          .catch((error) => log('health_report_failed', { error: errorText(error) }));
        healthAt = nextHealthReport();
        continue;
      }
```

The worker's `query` (from `socialQuery()`) must accept the `HubQuery` call shape `(text, params) => { rows }`. Check `lib/social/store` for its type. If it differs, wrap it: `const hubQ: HubQuery = async (t, p) => ({ rows: (await query(t, p)).rows })`.

- [ ] **Step 3: Check types and run the full test suite.**
Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 4: Apply the schema changes to the real database.** This is a production DDL change. Show the user the two commands below and wait for an explicit yes before running them.

```bash
node scripts/apply_social_hub_schema.js --apply
```

```bash
node scripts/apply_stories_schema.js --apply
```

Expected: `social_hub schema applied`, and the Stories equivalent. Both are idempotent (`IF NOT EXISTS`, plus `DROP CONSTRAINT IF EXISTS`).

- [ ] **Step 5: Deploy the social worker (the worker-sync rule).**

```bash
./scripts/gcp/deploy-social-worker.sh
```

Expected: the deploy completes. Check the service log and look for `scheduled` on startup. The first `health_report_complete` arrives at 07:30 ET.

Also check that the VM env has `EXPLAINERS_DATABASE_URL` or `EXPLAINERS_DB=supabase`. If neither is set, the Explainers row shows "Couldn't read this type's data" (yellow). Tell the user; don't change the env without asking.

- [ ] **Step 6: Commit.**

```bash
git add lib/social/overnight/config.ts scripts/social_worker.ts
git commit -m "feat(health): 07:30 morning report clock in the social worker"
```

---

### Task 10: Ledger rows carry vendor, mode and unknown-cost

**Files:**
- Modify: `lib/social-hub/cost.ts` (`LedgerRow`)
- Modify: `lib/social-hub/queries/costs.ts` (`CostReads`, `COST_SQL`, `buildLedger`)
- Modify: `lib/anthropic-pricing.ts` (export `cacheReadMultiplier`)
- Test: `tests/social-cost-ledger-mode.test.ts`

**Interfaces:**
- **Produces:** `LedgerRow` gains:

```ts
  /** anthropic | openai | jev | huggingface | heygen | web_search | kling | carousel-claude | carousel-jev | carousel-other */
  vendor?: string;
  mode?: 'production' | 'development';
  /** Cost not known (HeyGen usd_known=false): micros is 0 and must not read as free. */
  unknown?: boolean;
```

- [ ] **Step 1: Write the failing test.**

```ts
// tests/social-cost-ledger-mode.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLedger, readCosts } from '@/lib/social-hub/queries/costs';

import { openHubTestDb } from './fixtures/social-hub/pglite';

test('ledger rows carry vendor and production/development mode per type', async () => {
  const { query } = await openHubTestDb();
  await query(`
    INSERT INTO reels.settings (key, value) VALUES ('prod_spend_since', '"2026-10-01T04:00:00Z"');
    INSERT INTO reels.cost_events (vendor, component, usd, created_at) VALUES
      ('anthropic', 'copy-caption', 0.5, '2026-09-20T05:00:00Z'), ('openai', 'reel-background', 0.3, '2026-10-05T05:00:00Z');
    INSERT INTO explainers.cost_events (mode, vendor, component, usd, usd_known, created_at) VALUES
      ('development', 'anthropic', 'session_a', 1, true, '2026-10-05T05:00:00Z'), ('production', 'heygen', 'tts+bgm+sfx', 0, false, '2026-10-05T05:00:00Z');
    INSERT INTO social.runs (kind, started_at, hook_pass, cap_usd, total_usd, claude_usd, trigger, status, requested_at, record) VALUES
      ('daily', '2026-10-05T07:00:00Z', true, 2, 1.5, 1.2, 'cli', 'ok', '2026-10-05T07:00:00Z', '{"jev":{"costUsd":0.3},"result":{"posts":[]}}');
    INSERT INTO stories.sets (id, series, ny_date, trigger, style, mode) VALUES ('00000000-0000-0000-0000-0000000000c1', 'morning_download', '2026-10-05', 'click', 'polished', 'development');
    INSERT INTO stories.cost_events (set_id, vendor, component, usd, created_at) VALUES ('00000000-0000-0000-0000-0000000000c1', 'web_search', 'search', 0.1, '2026-10-05T05:00:00Z');
  `);
  const { rows } = buildLedger(await readCosts(query));
  const pick = (re: RegExp) => rows.filter((r) => re.test(r.id));
  assert.deepEqual(pick(/^reels:ce:/).map((r) => [r.vendor, r.mode]).sort(), [['anthropic', 'development'], ['openai', 'production']]);
  const exp = pick(/^explainers:ce:/);
  assert.ok(exp.some((r) => r.mode === 'development' && r.vendor === 'anthropic'));
  assert.ok(exp.some((r) => r.unknown === true && r.vendor === 'heygen'));
  assert.ok(pick(/^carousels:run:/).every((r) => r.mode === 'development'));
  assert.deepEqual(pick(/^stories:ce:/).map((r) => [r.vendor, r.mode]), [['web_search', 'development']]);
});
```

- [ ] **Step 2: Run it to confirm it fails.**
Run: `npx tsx --test tests/social-cost-ledger-mode.test.ts`
Expected: FAIL, because `vendor` and `mode` are undefined.

- [ ] **Step 3: Update `COST_SQL` and `CostReads`.** Add these SQL fragments (and the matching fields on each `CostReads` row type):

```ts
/** Spend before this instant is Text on Screen development (lib/reels/analytics/rollups.ts defaultProdSpendSince). */
const REEL_PROD_SINCE = `COALESCE((SELECT (value #>> '{}')::timestamptz FROM reels.settings WHERE key = 'prod_spend_since'), '2026-09-30T04:00:00Z'::timestamptz)`;
```

  - `reelEvents`: add `, vendor, (created_at >= ${REEL_PROD_SINCE}) AS production`. Row type: `vendor: string; production: boolean`.
  - `reelKling`: add `, (finished_at >= ${REEL_PROD_SINCE}) AS production`. Row type: `production: boolean`.
  - `explainerEvents`: add `, e.vendor, (e.mode = 'production') AS production, (NOT e.usd_known) AS unknown`. Row type: `vendor: string; production: boolean; unknown: boolean`.
  - `carouselRuns`: add `, (trigger <> 'cli') AS production`. Row type: `production: boolean`.
  - `storyEvents`: replace with:

```ts
    storyEvents: `SELECT e.id, e.set_id, e.component, e.vendor, e.usd::text AS usd, ${day('e.created_at')} AS ny_date,
                         (COALESCE(s.mode, 'production') = 'production') AS production
                    FROM stories.cost_events e LEFT JOIN stories.sets s ON s.id = e.set_id`,
```

    Row type: add `vendor: string; production: boolean`.

- [ ] **Step 4: Set the new fields in `buildLedger`.** At each `rows.push({...})`, add the fields below. Define `const mode = (p: boolean) => (p ? 'production' : 'development') as const;` at the top of `buildLedger`.

| Row id prefix | Fields to add |
|---|---|
| `reels:ce:` | `vendor: e.vendor, mode: mode(e.production)` |
| `reels:kling:` | `vendor: 'kling', mode: mode(k.production)` |
| `explainers:ce:` | `vendor: e.vendor, mode: mode(e.production), unknown: e.unknown || undefined` |
| `carousels:run:<run>:<storyId>` and `carousels:run:<run>:shared` | `vendor: 'carousel', mode: mode(run.production)` |
| `stories:ce:` | `vendor: e.vendor, mode: mode(e.production)` |

Carousel vendor splits (Claude / Jev / other) happen on the cost page from `claude_usd` and `jev_usd` (Task 11). Leave the ledger split as it is, so the reconciliation invariants in `tests/social-hub-cost.test.ts` hold.

- [ ] **Step 5: Export `cacheReadMultiplier` in `lib/anthropic-pricing.ts`.** Change `function cacheReadMultiplier` to `export function cacheReadMultiplier`. Nothing else changes.

- [ ] **Step 6: Run the new test and the existing cost tests.**
Run: `npx tsx --test tests/social-cost-ledger-mode.test.ts tests/social-hub-cost.test.ts tests/social-hub-preview.test.ts`
Expected: PASS. The existing invariants are unchanged, because no micros moved.

- [ ] **Step 7: Commit.**

```bash
git add lib/social-hub/cost.ts lib/social-hub/queries/costs.ts lib/anthropic-pricing.ts tests/social-cost-ledger-mode.test.ts
git commit -m "feat(cost): ledger rows carry vendor, production/development mode and unknown cost"
```

---

### Task 11: Cost normalization, rows, waste, caching and the page model

**Files:**
- Create: `lib/social-hub/cost-page/normalize.ts`
- Create: `lib/social-hub/cost-page/rows.ts`
- Create: `lib/social-hub/cost-page/waste.ts`
- Create: `lib/social-hub/cost-page/caching.ts`
- Create: `lib/social-hub/cost-page/model.ts`
- Create: `tests/fixtures/social-hub/cost-fixture.ts`
- Test: `tests/social-cost-model.test.ts`

**Interfaces:**
- **Consumes:**
  - `LedgerRow` and `CostLedger` with the Task 10 fields;
  - `itemTotals`, `itemFirstDay`, `toMicros`, `usd` (`lib/social-hub/cost.ts`);
  - `HubPost`, `MetricKey`; `VERTICALS`; `cacheReadMultiplier`, `ratesForModel`.
- **Produces:**

```ts
type Stage = 'research' | 'writing' | 'visuals' | 'video' | 'other';
type VendorGroup = 'claude' | 'video' | 'images' | 'jev-search' | 'other';
type CostRow = { nyDate: string; vertical: Vertical; vendor: VendorGroup; stage: Stage; micros: number; mode: 'production' | 'development'; unknown: boolean; runId: string | null };
type By = 'type' | 'vendor' | 'stage';
type Series = { days: string[]; keys: Array<{ id: string; label: string; color: string }>; values: number[][] }; // values[dayIndex][keyIndex] in micros
type Compare = { label: string; micros: number; change: 'new' | 'same' | 'up' | 'down'; pct: number | null };
type Waste = { rejected: number; failed: number; expired: number; selection: number; spend: number };
type CostModel = {
  totalMicros: number; unknownCalls: number; headline: string; pace: Pace;
  chips: Array<{ id: string; text: string; best?: boolean }>;
  months: Array<{ month: string; label: string; under: boolean | null }>;
  series: Record<By, Series>;
  budget: Array<{ vertical: Vertical; label: string; spentMicros: number; watchMicros: number; projectedMicros: number; onPace: boolean }>;
  worth: WorthModel; waste: Waste & { pct: number; prevPct: number | null };
  rejection: Array<{ vertical: Vertical; label: string; rate: number | null }>;
  caching: { savedMicros: number; withoutMicros: number; covered: Vertical[] };
};
```

  - `stageOf(vertical: Vertical, label: string): Stage`
  - `vendorOf(vendor: string | undefined): VendorGroup`
  - `toCostRows(ledger: CostLedger, carouselStages: CarouselStageSplit[], carouselVendors: CarouselVendorSplit[]): CostRow[]`
  - `dailySeries(rows, days, by): Series`
  - `hoverCompare(series: Series, dayIndex: number): { total: Compare; parts: Compare[] }`
  - `spikeDrivers(rows, day, days): Array<{ label: string; micros: number; ratio: number | null }>`
  - `pace(spentMicros, now, watchMicros): Pace`
  - `classifyWaste(input: WasteInput): Waste`
  - `cacheSavings(rows: CacheRow[]): { savedMicros; withoutMicros }`
  - `costModel(input: CostInput): CostModel`
  - `previewCost(): CostInput`

- [ ] **Step 1: Write the failing tests.**

```ts
// tests/social-cost-model.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { cacheSavings } from '@/lib/social-hub/cost-page/caching';
import { costModel, dailySeries, hoverCompare, pace, spikeDrivers } from '@/lib/social-hub/cost-page/model';
import { stageOf, vendorOf } from '@/lib/social-hub/cost-page/normalize';
import type { CostRow } from '@/lib/social-hub/cost-page/rows';
import { classifyWaste } from '@/lib/social-hub/cost-page/waste';

import { previewCost } from './fixtures/social-hub/cost-fixture';

const row = (nyDate: string, micros: number, over: Partial<CostRow> = {}): CostRow => ({
  nyDate, vertical: 'explainers', vendor: 'claude', stage: 'writing', micros, mode: 'production', unknown: false, runId: null, ...over,
});

test('components map to stages and vendors; unknown labels go to Other', () => {
  assert.equal(stageOf('reels', 'copy-caption'), 'writing');
  assert.equal(stageOf('reels', 'reel-background'), 'visuals');
  assert.equal(stageOf('reels', 'Kling clip'), 'video');
  assert.equal(stageOf('explainers', 'tts+bgm+sfx'), 'video');
  assert.equal(stageOf('stories', 'search'), 'research');
  assert.equal(stageOf('stories', 'zzz'), 'other');
  assert.equal(vendorOf('anthropic'), 'claude');
  assert.equal(vendorOf('kling'), 'video');
  assert.equal(vendorOf('openai'), 'images');
  assert.equal(vendorOf('web_search'), 'jev-search');
});

test('hover compares each series to its own previous-7-day average; zero history reads as new', () => {
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
  const rows = [
    ...days.slice(0, 7).map((d) => row(d, 3_000_000)),
    row('2026-10-08', 9_000_000),
    row('2026-10-08', 1_000_000, { vertical: 'stories' }),
  ];
  const h = hoverCompare(dailySeries(rows, days, 'type'), 7);
  const exp = h.parts.find((p) => p.label === 'Explainer Reels')!;
  assert.equal(exp.change, 'up');
  assert.equal(exp.pct, 200);
  assert.equal(h.parts.find((p) => p.label === 'IG Stories')!.change, 'new');
  const flat = hoverCompare(dailySeries([...days.map((d) => row(d, 3_000_000))], days, 'type'), 7);
  assert.equal(flat.parts.find((p) => p.label === 'Explainer Reels')!.change, 'same');
});

test('spike drivers rank type·stage lines by spend and ratio to their usual', () => {
  const days = ['2026-10-01', '2026-10-02', '2026-10-03'];
  const d = spikeDrivers([row('2026-10-01', 1e6, { stage: 'video' }), row('2026-10-02', 1e6, { stage: 'video' }), row('2026-10-03', 6e6, { stage: 'video' })], '2026-10-03', days);
  assert.equal(d[0]!.label, 'Explainer Reels · Video + render');
  assert.equal(d[0]!.ratio, 6);
});

test('pace projects the month linearly', () => {
  const p = pace(142_000_000, new Date('2026-10-13T16:00:00Z'), 360_000_000);
  // 12:00 NY on Oct 13 → 12.5 days elapsed; 142 / 12.5 × 31 = 352.16
  assert.equal(Math.round(p.projectedMicros / 1e6), 352);
  assert.equal(p.underWatch, true);
});

test('waste splits unshipped item cost into rejected, failed, expired; filtered is selection', () => {
  const w = classifyWaste({
    itemMicros: new Map([['a', 5e6], ['b', 3e6], ['c', 2e6], ['d', 4e6], ['e', 1e6]]),
    firstDay: new Map([['a', '2026-10-01'], ['b', '2026-10-01'], ['c', '2026-09-20'], ['d', '2026-10-12'], ['e', '2026-10-01']]),
    published: new Set(['e']), rejected: new Set(['a']), failed: new Set(['b']), inFlight: new Set(['d']), filtered: new Set(),
    unattributedMicros: 7e5, now: new Date('2026-10-13T16:00:00Z'), spendMicros: 20e6,
  });
  assert.deepEqual([w.rejected, w.failed, w.expired, w.selection], [5e6, 3e6, 2e6, 7e5]);
});

test('caching savings: reads saved minus the write premium, per model', () => {
  const s = cacheSavings([{ vertical: 'stories', model: 'claude-sonnet-5-5', readTokens: 1_000_000, writeTokens: 100_000 }]);
  // sonnet-5-5 input $2/Mtok: reads would cost $2, cost $0.20 → saved $1.80; writes premium 0.25 × $0.20 = $0.05
  assert.equal(Math.round(s.savedMicros), 1_750_000);
});

test('model: unknown-cost calls are surfaced, never priced as $0 savings', () => {
  const m = costModel(previewCost());
  assert.ok(m.unknownCalls > 0);
  assert.match(m.headline, /On pace for \$\d+/);
  assert.equal(m.series.type.keys.map((k) => k.label).join(','), 'Text on Screen,Explainer Reels,Carousels,IG Stories');
  assert.equal(m.budget.length, 4);
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**
Run: `npx tsx --test tests/social-cost-model.test.ts`
Expected: FAIL, because the modules can't be found.

- [ ] **Step 3: Write `normalize.ts`.**

```ts
import type { Vertical } from '@/lib/social-hub/types';

export type Stage = 'research' | 'writing' | 'visuals' | 'video' | 'other';
export type VendorGroup = 'claude' | 'video' | 'images' | 'jev-search' | 'other';

export const STAGE_META: Record<Stage, { label: string; color: string }> = {
  research: { label: 'Research + scoring', color: '#0e5c0c' },
  writing: { label: 'Writing', color: '#138510' },
  visuals: { label: 'Visuals', color: '#5aa857' },
  video: { label: 'Video + render', color: '#a6d4a4' },
  other: { label: 'Other', color: '#d4d4d4' },
};
export const VENDOR_META: Record<VendorGroup, { label: string; color: string }> = {
  claude: { label: 'Claude', color: '#171717' },
  video: { label: 'Video (Kling, HeyGen)', color: '#525252' },
  images: { label: 'OpenAI images', color: '#a3a3a3' },
  'jev-search': { label: 'Jev + search', color: '#d4d4d4' },
  other: { label: 'Other', color: '#e5e5e5' },
};

/** Ordered keyword rules; first match wins. One table for every type (component names differ, words don't). */
const STAGE_RULES: ReadonlyArray<[RegExp, Stage]> = [
  [/kling|video|render|motion|heygen|tts|bgm|sfx|song|music/i, 'video'],
  [/background|image|frame|photo|visual|color|scene|design|vision|tag/i, 'visuals'],
  [/score|rank|idea|research|search|dedupe|duplicate|select|jev|generator|feed|story-match|reporter/i, 'research'],
  [/copy|writ|caption|script|hook|line|edit|fact|session|cue|story|draft/i, 'writing'],
];
export function stageOf(_vertical: Vertical, label: string): Stage {
  for (const [re, stage] of STAGE_RULES) if (re.test(label)) return stage;
  return 'other';
}

export function vendorOf(vendor: string | undefined): VendorGroup {
  switch (vendor) {
    case 'anthropic': case 'carousel-claude': return 'claude';
    case 'kling': case 'heygen': return 'video';
    case 'openai': return 'images';
    case 'jev': case 'web_search': case 'carousel-jev': case 'huggingface': return 'jev-search';
    default: return 'other';
  }
}
```

- [ ] **Step 4: Write `rows.ts`.**

```ts
import type { CostLedger } from '@/lib/social-hub/cost';
import { stageOf, vendorOf, type Stage, type VendorGroup } from '@/lib/social-hub/cost-page/normalize';
import type { Vertical } from '@/lib/social-hub/types';

export type CostRow = { nyDate: string; vertical: Vertical; vendor: VendorGroup; stage: Stage; micros: number; mode: 'production' | 'development'; unknown: boolean; runId: string | null };
/** Carousels record stage spend per run (record.result.costByStage); the page splits each run's ledger rows by these shares. */
export type CarouselStageSplit = { runId: string; byStage: Record<string, number> };
/** Carousel Claude vs Jev split per run (claude_usd, jev_usd). */
export type CarouselVendorSplit = { runId: string; claude: number; jev: number; total: number };

const CAROUSEL_STAGE: Record<string, Stage> = {
  'jev-scoring': 'research', selection: 'research', reporter: 'research', feeds: 'research',
  writer: 'writing', editor: 'writing', 'fact-checker': 'writing', mechanical: 'writing', hook: 'writing',
  design: 'visuals', photos: 'visuals', render: 'visuals',
};

export function toCostRows(ledger: CostLedger, stages: readonly CarouselStageSplit[], vendors: readonly CarouselVendorSplit[]): CostRow[] {
  const out: CostRow[] = [];
  for (const r of ledger.rows) {
    const base = { nyDate: r.nyDate, vertical: r.vertical, mode: r.mode ?? 'production', unknown: Boolean(r.unknown) } as const;
    if (r.vertical !== 'carousels') {
      out.push({ ...base, vendor: vendorOf(r.vendor), stage: stageOf(r.vertical, r.label), micros: r.micros, runId: null });
      continue;
    }
    const runId = r.id.split(':')[2] ?? null;
    const split = stages.find((s) => s.runId === runId)?.byStage ?? {};
    const v = vendors.find((x) => x.runId === runId);
    const total = Object.values(split).reduce((a, b) => a + b, 0);
    const parts = total > 0
      ? Object.entries(split).map(([k, usd]) => [CAROUSEL_STAGE[k] ?? 'other', usd / total] as [Stage, number])
      : [['writing', 1] as [Stage, number]];
    const claudeShare = v && v.total > 0 ? v.claude / v.total : 1;
    const jevShare = v && v.total > 0 ? v.jev / v.total : 0;
    for (const [stage, share] of parts) {
      const micros = Math.round(r.micros * share);
      out.push({ ...base, stage, vendor: 'claude', micros: Math.round(micros * claudeShare), runId });
      if (jevShare > 0) out.push({ ...base, stage, vendor: 'jev-search', micros: Math.round(micros * jevShare), runId });
      const rest = micros - Math.round(micros * claudeShare) - Math.round(micros * jevShare);
      if (rest > 0) out.push({ ...base, stage, vendor: 'other', micros: rest, runId });
    }
  }
  return out;
}
```

- [ ] **Step 5: Write `waste.ts`.**

```ts
import type { HubQuery } from '@/lib/social-hub/db';

export type Waste = { rejected: number; failed: number; expired: number; selection: number; spend: number };
export type WasteInput = {
  itemMicros: Map<string, number>; firstDay: Map<string, string>;
  published: Set<string>; rejected: Set<string>; failed: Set<string>; inFlight: Set<string>; filtered: Set<string>;
  unattributedMicros: number; now: Date; spendMicros: number;
};

const EXPIRE_DAYS = 7;

/** Pure. Rejected wins over failed; anything unshipped, not in flight and older than 7 days is expired. */
export function classifyWaste(i: WasteInput): Waste {
  const w: Waste = { rejected: 0, failed: 0, expired: 0, selection: i.unattributedMicros, spend: i.spendMicros };
  const cutoff = new Date(i.now.getTime() - EXPIRE_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const [item, micros] of i.itemMicros) {
    if (i.published.has(item)) continue;
    if (i.filtered.has(item)) w.selection += micros;
    else if (i.rejected.has(item)) w.rejected += micros;
    else if (i.failed.has(item)) w.failed += micros;
    else if (!i.inFlight.has(item) && (i.firstDay.get(item) ?? '9999') < cutoff) w.expired += micros;
  }
  return w;
}

/**
 * Item keys (matching lib/social-hub/queries/costs.ts buildLedger) for rejected, regenerated, failed and filtered items.
 * Regenerated (an earlier unpublished attempt at the same idea) counts as rejected.
 */
export async function wasteSets(q: HubQuery, eq: HubQuery | null): Promise<{ rejected: Set<string>; failed: Set<string>; filtered: Set<string> }> {
  const rejected = new Set<string>();
  const failed = new Set<string>();
  const filtered = new Set<string>();
  const spine = await q<{ vertical: string; native_ref: string; idea_ref: string | null }>(
    `SELECT ci.vertical, ci.native_ref, ci.idea_ref FROM social_hub.approvals a JOIN social_hub.content_items ci ON ci.id = a.content_item_id WHERE a.decision = 'rejected'`,
  );
  const reelVideoIds: string[] = [];
  for (const r of spine.rows) {
    if (r.vertical === 'explainers') rejected.add(`explainers:${r.native_ref}`);
    if (r.vertical === 'stories') rejected.add(`stories:${r.native_ref}`);
    if (r.vertical === 'carousels' && r.idea_ref) rejected.add(`carousels:story:${r.idea_ref}`);
    if (r.vertical === 'reels') reelVideoIds.push(r.native_ref);
  }
  if (reelVideoIds.length) {
    const v = await q<{ post_idea_id: string; slate_id: string | null }>(
      `SELECT post_idea_id::text, slate_id::text FROM reels.video_jobs WHERE id::text = ANY($1::text[])`, [reelVideoIds],
    );
    for (const r of v.rows) rejected.add(`reels:${r.post_idea_id}:${r.slate_id ?? 'none'}`);
  }
  for (const r of (await q<{ id: string }>(`SELECT id::text FROM stories.sets WHERE status = 'rejected'`)).rows) rejected.add(`stories:${r.id}`);
  for (const r of (await q<{ id: string }>(`SELECT id::text FROM stories.sets WHERE status = 'failed'`)).rows) failed.add(`stories:${r.id}`);
  for (const r of (await q<{ i: string; s: string | null }>(`SELECT post_idea_id::text AS i, slate_id::text AS s FROM reels.video_jobs WHERE status = 'failed'`)).rows) failed.add(`reels:${r.i}:${r.s ?? 'none'}`);
  // Regenerated reels: an idea with more than one slate; every slate but the newest is an earlier attempt.
  for (const r of (await q<{ i: string; s: string | null }>(
    `SELECT post_idea_id::text AS i, slate_id::text AS s FROM (
       SELECT post_idea_id, slate_id, row_number() OVER (PARTITION BY post_idea_id ORDER BY max(finished_at) DESC NULLS LAST) AS rn
         FROM reels.video_jobs GROUP BY post_idea_id, slate_id) x WHERE rn > 1`,
  )).rows) rejected.add(`reels:${r.i}:${r.s ?? 'none'}`);
  for (const r of (await q<{ story_id: string; kind: string }>(`SELECT DISTINCT story_id, kind FROM social.set_asides`)).rows) {
    (r.kind === 'pipeline-fault' ? failed : filtered).add(`carousels:story:${r.story_id}`);
  }
  if (eq) {
    for (const r of (await eq<{ job_id: string }>(`SELECT job_id::text FROM explainers.feedback WHERE verdict = 'rejected'`)).rows) rejected.add(`explainers:${r.job_id}`);
    for (const r of (await eq<{ id: string }>(`SELECT id::text FROM explainers.jobs WHERE status = 'failed'`)).rows) failed.add(`explainers:${r.id}`);
    // Regenerated explainers: earlier jobs for a topic that has a later job.
    for (const r of (await eq<{ id: string }>(
      `SELECT id::text FROM (SELECT id, row_number() OVER (PARTITION BY topic_id ORDER BY requested_at DESC) AS rn FROM explainers.jobs) x WHERE rn > 1`,
    )).rows) rejected.add(`explainers:${r.id}`);
  }
  return { rejected, failed, filtered };
}
```

- [ ] **Step 6: Write `caching.ts`.**

```ts
import { cacheReadMultiplier, ratesForModel } from '@/lib/anthropic-pricing';
import type { HubQuery } from '@/lib/social-hub/db';
import type { Vertical } from '@/lib/social-hub/types';

export type CacheRow = { vertical: Vertical; model: string; readTokens: number; writeTokens: number };
/** 5-minute cache writes cost 1.25× input (lib/drafting/cost.ts DRAFTING_PRICE_SNAPSHOT). */
const WRITE_PREMIUM = 0.25;

export function cacheSavings(rows: readonly CacheRow[]): { savedMicros: number; withoutMicros: number } {
  let saved = 0;
  let readFull = 0;
  for (const r of rows) {
    const input = ratesForModel(r.model).inputPerMtokUsd;
    const full = (r.readTokens / 1e6) * input;
    saved += full * (1 - cacheReadMultiplier(r.model)) - (r.writeTokens / 1e6) * input * WRITE_PREMIUM;
    readFull += full;
  }
  return { savedMicros: Math.round(saved * 1e6), withoutMicros: Math.round(readFull * 1e6) };
}

/** Only Explainers and Stories record cache tokens today (spec §7). */
export async function readCacheRows(q: HubQuery, eq: HubQuery | null, from: string, to: string): Promise<CacheRow[]> {
  const out: CacheRow[] = [];
  const s = await q<{ model: string | null; r: number; w: number }>(
    `SELECT model, sum(cache_read_tokens)::float8 AS r, sum(cache_write_tokens)::float8 AS w FROM stories.cost_events
      WHERE vendor = 'anthropic' AND created_at >= $1 AND created_at < $2 GROUP BY model`, [from, to],
  );
  for (const r of s.rows) out.push({ vertical: 'stories', model: r.model ?? 'claude-sonnet-5-5', readTokens: r.r, writeTokens: r.w });
  if (eq) {
    const e = await eq<{ model: string | null; r: number; w: number }>(
      `SELECT j.orchestrator_model AS model, sum(e.cache_read_tokens)::float8 AS r, sum(e.cache_write_tokens)::float8 AS w
         FROM explainers.cost_events e LEFT JOIN explainers.jobs j ON j.id = e.job_id
        WHERE e.vendor = 'anthropic' AND e.created_at >= $1 AND e.created_at < $2 GROUP BY 1`, [from, to],
    );
    for (const r of e.rows) out.push({ vertical: 'explainers', model: r.model ?? 'claude-sonnet-5-5', readTokens: r.r, writeTokens: r.w });
  }
  return out;
}
```

Before relying on `ratesForModel('claude-sonnet-5-5').inputPerMtokUsd` being 2 for the test, open `lib/anthropic-pricing.ts:81` and check. If the snapshot differs, change the test's expected number to match the snapshot; the arithmetic in the test comment is the rule.

- [ ] **Step 7: Write `model.ts`.**

```ts
import { VENDOR_META, STAGE_META, type Stage, type VendorGroup } from '@/lib/social-hub/cost-page/normalize';
import type { CostRow } from '@/lib/social-hub/cost-page/rows';
import type { Waste } from '@/lib/social-hub/cost-page/waste';
import type { Readiness } from '@/lib/social-hub/health/readiness';
import { addDays } from '@/lib/social-hub/time';
import type { HubPost, MetricKey, Vertical } from '@/lib/social-hub/types';
import { VERTICALS, verticalInfo } from '@/lib/social-hub/verticals';

export type By = 'type' | 'vendor' | 'stage';
export type Series = { days: string[]; keys: Array<{ id: string; label: string; color: string }>; values: number[][] };
export type Compare = { label: string; micros: number; change: 'new' | 'same' | 'up' | 'down'; pct: number | null };
export type Pace = { spentMicros: number; projectedMicros: number; watchMicros: number; underWatch: boolean };

const TYPE_COLOR: Record<Vertical, string> = { reels: '#14b8c4', explainers: '#4169e1', carousels: '#138510', stories: '#c377e0' };

function keysFor(by: By) {
  if (by === 'type') return VERTICALS.map((v) => ({ id: v.id, label: v.label, color: TYPE_COLOR[v.id] }));
  if (by === 'vendor') return (Object.keys(VENDOR_META) as VendorGroup[]).map((id) => ({ id, ...VENDOR_META[id] }));
  return (Object.keys(STAGE_META) as Stage[]).map((id) => ({ id, ...STAGE_META[id] }));
}
const keyOf = (r: CostRow, by: By) => (by === 'type' ? r.vertical : by === 'vendor' ? r.vendor : r.stage);

export function dailySeries(rows: readonly CostRow[], days: readonly string[], by: By): Series {
  const keys = keysFor(by);
  const di = new Map(days.map((d, i) => [d, i]));
  const ki = new Map(keys.map((k, i) => [k.id, i]));
  const values = days.map(() => keys.map(() => 0));
  for (const r of rows) {
    const d = di.get(r.nyDate);
    const k = ki.get(keyOf(r, by));
    if (d !== undefined && k !== undefined) values[d]![k]! += r.micros;
  }
  return { days: [...days], keys, values };
}

function compare(label: string, micros: number, history: number[]): Compare {
  const avg = history.length ? history.reduce((a, b) => a + b, 0) / history.length : 0;
  if (avg <= 0) return { label, micros, change: micros > 0 ? 'new' : 'same', pct: null };
  const pct = Math.round(((micros - avg) / avg) * 100);
  return { label, micros, change: Math.abs(pct) <= 8 ? 'same' : pct > 0 ? 'up' : 'down', pct: Math.abs(pct) };
}

/** Each series vs its own average over the previous 7 days (spec §6.3). */
export function hoverCompare(s: Series, dayIndex: number): { total: Compare; parts: Compare[] } {
  const prev = s.values.slice(Math.max(0, dayIndex - 7), dayIndex);
  const parts = s.keys.map((k, j) => compare(k.label, s.values[dayIndex]![j]!, prev.map((d) => d[j]!)));
  const total = compare('Total', s.values[dayIndex]!.reduce((a, b) => a + b, 0), prev.map((d) => d.reduce((a, b) => a + b, 0)));
  return { total, parts };
}

export function spikeDrivers(rows: readonly CostRow[], day: string, days: readonly string[]) {
  const idx = days.indexOf(day);
  const prior = new Set(days.slice(Math.max(0, idx - 7), idx));
  const label = (r: CostRow) => `${verticalInfo(r.vertical).label} · ${STAGE_META[r.stage].label}`;
  const today = new Map<string, number>();
  const before = new Map<string, number>();
  for (const r of rows) {
    if (r.nyDate === day) today.set(label(r), (today.get(label(r)) ?? 0) + r.micros);
    else if (prior.has(r.nyDate)) before.set(label(r), (before.get(label(r)) ?? 0) + r.micros);
  }
  return [...today.entries()]
    .map(([l, micros]) => {
      const avg = prior.size ? (before.get(l) ?? 0) / prior.size : 0;
      return { label: l, micros, ratio: avg > 0 ? Math.round((micros / avg) * 10) / 10 : null };
    })
    .sort((a, b) => b.micros - a.micros)
    .slice(0, 4);
}

export function pace(spentMicros: number, now: Date, watchMicros: number): Pace {
  const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const daysInMonth = new Date(ny.getFullYear(), ny.getMonth() + 1, 0).getDate();
  const elapsed = Math.max(1, ny.getDate() - 1 + ny.getHours() / 24);
  const projectedMicros = Math.round((spentMicros / elapsed) * daysInMonth);
  return { spentMicros, projectedMicros, watchMicros, underWatch: projectedMicros <= watchMicros };
}

const INTERACTIONS: Record<Vertical, MetricKey[]> = {
  reels: ['totalInteractions'], explainers: ['totalInteractions'], carousels: ['totalInteractions'],
  stories: ['replies', 'shares', 'follows', 'profileVisits'],
};
export const KINDS: Array<{ key: MetricKey; label: string }> = [
  { key: 'likes', label: 'Like' }, { key: 'saved', label: 'Save' }, { key: 'shares', label: 'Share' },
  { key: 'comments', label: 'Comment' }, { key: 'replies', label: 'Reply' }, { key: 'follows', label: 'Follow' }, { key: 'profileVisits', label: 'Profile visit' },
];
export const interactionsOf = (p: HubPost) => INTERACTIONS[p.vertical].reduce((n, k) => n + (p.metrics[k] ?? 0), 0);

export type WorthModel = {
  byType: Array<{ vertical: Vertical; label: string; interactions: number; cpiMicros: number | null; kinds: Array<{ label: string; key: MetricKey; cpiMicros: number | null }> }>;
  best: { post: HubPost; interactions: number; cpiMicros: number } | null;
};

export type CostInput = {
  rows: CostRow[]; from: string; to: string; now: Date; vertical: Vertical | null; mode: 'production' | 'development';
  watchUsd: Record<Vertical, number>; posts: HubPost[]; waste: Waste; prevWastePct: number | null;
  readiness: Readiness[]; caching: { savedMicros: number; withoutMicros: number };
  monthTotals: Array<{ month: string; micros: number }>; bestEverCpi: Partial<Record<Vertical, number>>;
};

export type CostModel = {
  totalMicros: number; unknownCalls: number; headline: string; pace: Pace;
  chips: Array<{ id: string; text: string; best?: boolean }>;
  months: Array<{ month: string; label: string; under: boolean | null }>;
  series: Record<By, Series>; rows: CostRow[];
  budget: Array<{ vertical: Vertical; label: string; spentMicros: number; watchMicros: number; projectedMicros: number; onPace: boolean }>;
  worth: WorthModel; waste: Waste & { pct: number; prevPct: number | null };
  rejection: Array<{ vertical: Vertical; label: string; rate: number | null }>;
  caching: { savedMicros: number; withoutMicros: number; covered: Vertical[] };
};

const usd0 = (m: number) => `$${Math.round(m / 1e6)}`;
const usd2 = (m: number) => `$${(m / 1e6).toFixed(2)}`;

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function costModel(i: CostInput): CostModel {
  const rows = i.rows.filter((r) => r.mode === i.mode && (!i.vertical || r.vertical === i.vertical));
  const days = daysBetween(i.from, i.to);
  const inRange = rows.filter((r) => r.nyDate >= i.from && r.nyDate <= i.to);
  const totalMicros = inRange.reduce((n, r) => n + r.micros, 0);
  const unknownCalls = inRange.filter((r) => r.unknown).length;
  const types = i.vertical ? VERTICALS.filter((v) => v.id === i.vertical) : VERTICALS;
  const month = i.to.slice(0, 7);
  const monthMicros = (v?: Vertical) => rows.filter((r) => r.nyDate.startsWith(month) && (!v || r.vertical === v)).reduce((n, r) => n + r.micros, 0);
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const watch = (v: Vertical) => Math.round(i.watchUsd[v] * 1e6);
  const totalWatch = types.reduce((n, v) => n + watch(v.id), 0);
  const p = pace(monthMicros(i.vertical ?? undefined), i.now, totalWatch);
  const yesterday = addDays(i.to, 0);
  const last = rows.filter((r) => r.nyDate === yesterday).reduce((n, r) => n + r.micros, 0);
  const prior7 = days.slice(-8, -1).map((d) => rows.filter((r) => r.nyDate === d).reduce((n, r) => n + r.micros, 0));
  const avg7 = prior7.length ? prior7.reduce((a, b) => a + b, 0) / prior7.length : 0;
  const lastWord = avg7 <= 0 ? '' : Math.abs(last - avg7) / avg7 <= 0.15 ? ', about normal' : last > avg7 ? `, ${(last / avg7).toFixed(1)}× a normal day` : ', below normal';
  const wasteMicros = i.waste.rejected + i.waste.failed + i.waste.expired;
  const headline = `On pace for ${usd0(p.projectedMicros)} this month, ${p.underWatch ? 'under' : 'over'} the ${usd0(totalWatch)} watch. Last night cost ${usd2(last)}${lastWord}. ${usd0(wasteMicros)} went to drafts that never posted.`;

  const budget = types.map((v) => {
    const spent = monthMicros(v.id);
    const proj = pace(spent, i.now, watch(v.id)).projectedMicros;
    return { vertical: v.id, label: v.label, spentMicros: spent, watchMicros: watch(v.id), projectedMicros: proj, onPace: proj <= watch(v.id) };
  });

  const published = i.posts.filter((p) => p.status === 'published' && p.postedAt && p.postedAt.slice(0, 10) >= i.from && p.postedAt.slice(0, 10) <= i.to && (!i.vertical || p.vertical === i.vertical));
  const byType = types.map((v) => {
    const posts = published.filter((p) => p.vertical === v.id && p.costMicros != null);
    const cost = posts.reduce((n, p) => n + (p.costMicros ?? 0), 0);
    const interactions = posts.reduce((n, p) => n + interactionsOf(p), 0);
    const kinds = KINDS.map((k) => {
      const n = posts.reduce((a, p) => a + (p.metrics[k.key] ?? 0), 0);
      return { label: k.label, key: k.key, cpiMicros: n > 0 ? Math.round(cost / n) : null };
    }).filter((k) => k.cpiMicros !== null);
    return { vertical: v.id, label: v.label, interactions, cpiMicros: interactions > 0 ? Math.round(cost / interactions) : null, kinds };
  }).sort((a, b) => (a.cpiMicros ?? Infinity) - (b.cpiMicros ?? Infinity));
  const bestPost = published
    .filter((p) => (p.costMicros ?? 0) > 0 && interactionsOf(p) > 0)
    .map((p) => ({ post: p, interactions: interactionsOf(p), cpiMicros: Math.round((p.costMicros ?? 0) / interactionsOf(p)) }))
    .sort((a, b) => a.cpiMicros - b.cpiMicros)[0] ?? null;

  const chips: CostModel['chips'] = [];
  const low = byType.find((t) => t.cpiMicros !== null && (i.bestEverCpi[t.vertical] === undefined || t.cpiMicros! < i.bestEverCpi[t.vertical]!));
  if (low) chips.push({ id: 'low', text: `✦ New low: ${low.label} at $${(low.cpiMicros! / 1e6).toFixed(3)} per interaction`, best: true });
  const dailyPace = totalWatch / daysInMonth;
  let streak = 0;
  for (let d = addDays(i.to, -1); d.startsWith(month); d = addDays(d, -1)) {
    if (rows.filter((r) => r.nyDate === d).reduce((n, r) => n + r.micros, 0) > dailyPace) break;
    streak++;
  }
  if (streak >= 2) chips.push({ id: 'pace', text: `🔥 ${streak} days in a row under daily pace` });
  const pct = totalMicros > 0 ? Math.round((wasteMicros / totalMicros) * 100) : 0;
  if (i.prevWastePct !== null) chips.push({ id: 'waste', text: `Waste ${pct}%, ${pct <= i.prevWastePct ? 'down' : 'up'} from ${i.prevWastePct}%` });

  const months = i.monthTotals.slice(-3).map((m) => ({
    month: m.month,
    label: new Date(`${m.month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
    under: m.month === month ? null : m.micros <= totalWatch,
  }));

  return {
    totalMicros, unknownCalls, headline, pace: p, chips, months, rows: inRange,
    series: { type: dailySeries(inRange, days, 'type'), vendor: dailySeries(inRange, days, 'vendor'), stage: dailySeries(inRange, days, 'stage') },
    budget, worth: { byType, best: bestPost }, waste: { ...i.waste, pct, prevPct: i.prevWastePct },
    rejection: i.readiness.map((r) => ({ vertical: r.vertical, label: verticalInfo(r.vertical).label, rate: r.rate === null ? null : 1 - r.rate })),
    caching: { ...i.caching, covered: ['explainers', 'stories'] },
  };
}
```

- [ ] **Step 8: Write the fixture** (`tests/fixtures/social-hub/cost-fixture.ts`). It is deterministic: 2026-10-01 to 2026-10-08 (`FIXTURE_NOW`), with one Explainers render spike on 10-08 and one unknown-cost HeyGen row. Posts come from `previewDataset().posts`.

```ts
import type { CostInput } from '@/lib/social-hub/cost-page/model';
import type { CostRow } from '@/lib/social-hub/cost-page/rows';
import type { Vertical } from '@/lib/social-hub/types';

import { FIXTURE_NOW, previewDataset } from './preview-dataset';

const DAILY: Record<Vertical, number> = { reels: 4.6, explainers: 3.5, carousels: 1.9, stories: 0.7 };

export function previewCost(): CostInput {
  const rows: CostRow[] = [];
  for (let d = 1; d <= 8; d++) {
    const nyDate = `2026-10-0${d}`;
    for (const v of Object.keys(DAILY) as Vertical[]) {
      const usd = v === 'explainers' && d === 8 ? 9.8 : DAILY[v];
      rows.push({ nyDate, vertical: v, vendor: 'claude', stage: 'writing', micros: Math.round(usd * 0.6e6), mode: 'production', unknown: false, runId: null });
      rows.push({ nyDate, vertical: v, vendor: v === 'reels' ? 'video' : 'jev-search', stage: v === 'reels' || v === 'explainers' ? 'video' : 'research', micros: Math.round(usd * 0.4e6), mode: 'production', unknown: false, runId: null });
    }
  }
  rows.push({ nyDate: '2026-10-08', vertical: 'explainers', vendor: 'video', stage: 'video', micros: 0, mode: 'production', unknown: true, runId: null });
  rows.push({ nyDate: '2026-10-05', vertical: 'reels', vendor: 'claude', stage: 'writing', micros: 2_000_000, mode: 'development', unknown: false, runId: null });
  return {
    rows, from: '2026-10-01', to: '2026-10-08', now: FIXTURE_NOW, vertical: null, mode: 'production',
    watchUsd: { reels: 100, explainers: 310, carousels: 62, stories: 25 },
    posts: previewDataset().posts,
    waste: { rejected: 8_900_000, failed: 6_600_000, expired: 3_900_000, selection: 11_200_000, spend: 142_000_000 },
    prevWastePct: 21,
    readiness: [
      { vertical: 'reels', approved: 46, rejected: 2, rate: 46 / 48 },
      { vertical: 'explainers', approved: 22, rejected: 8, rate: 22 / 30 },
      { vertical: 'carousels', approved: 27, rejected: 6, rate: 27 / 33 },
      { vertical: 'stories', approved: 20, rejected: 2, rate: 20 / 22 },
    ],
    caching: { savedMicros: 23_000_000, withoutMicros: 165_000_000 },
    monthTotals: [{ month: '2026-08', micros: 280e6 }, { month: '2026-09', micros: 300e6 }, { month: '2026-10', micros: 90e6 }],
    bestEverCpi: { carousels: 20_000 },
  };
}
```

- [ ] **Step 9: Run the tests to confirm they pass.**
Run: `npx tsx --test tests/social-cost-model.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit.**

```bash
git add lib/social-hub/cost-page tests/fixtures/social-hub/cost-fixture.ts tests/social-cost-model.test.ts
git commit -m "feat(cost): normalization, waste, caching savings, 7-day hover compare, page model"
```

---

### Task 12: Cost page loader, route and UI, plus the Analytics sub-nav

**Files:**
- Create: `lib/social-hub/cost-page/load.ts`
- Create: `components/social-hub/cost/AnalyticsSubnav.tsx` (client)
- Create: `components/social-hub/cost/CostScreen.tsx`
- Create: `components/social-hub/cost/CostChart.tsx` (client)
- Create: `components/social-hub/cost/RangeControls.tsx` (client)
- Modify: `app/social/(hub)/analytics/layout.tsx` (render `<AnalyticsSubnav />` above children)
- Modify: `app/social/(hub)/preview/analytics/layout.tsx` (the same)
- Create: `app/social/(hub)/analytics/cost/page.tsx`
- Create: `app/social/(hub)/preview/analytics/cost/page.tsx`
- Modify: `app/social/(hub)/hub-ops.css` (cost section styles)

**Interfaces:**
- **Consumes:**
  - `readCosts`, `buildLedger` (`lib/social-hub/queries/costs.ts`); `allocate`, `itemTotals`, `itemFirstDay` (`lib/social-hub/cost.ts`);
  - `toCostRows`, `wasteSets`, `classifyWaste`, `readCacheRows`, `cacheSavings`, `costModel`;
  - `loadForPage` (posts); `readinessFor`;
  - `MONTHLY_WATCH_USD` (`lib/reels/config.ts`), `loadSettings` from `lib/stories/settings.ts` with `liveStoriesDb`, `loadSettings` from `lib/explainers/settings.ts` with `explainersDb()`, `getSocialSetting('run_cap_usd')` with `DEFAULT_RUN_CAP_USD`.
- **Produces:**
  - `parseCostParams(params): { range: '7d' | '30d' | 'month' | 'custom'; from: string; to: string; vertical: Vertical | null; mode: 'production' | 'development' }`
  - `loadCostPage(email: string, params, now): Promise<CostInput | { error: string }>`

- [ ] **Step 1: Write a failing test for `parseCostParams`** (append to `tests/social-cost-model.test.ts`).

```ts
import { parseCostParams } from '@/lib/social-hub/cost-page/load';

test('cost params: defaults to this month, production, all types; custom needs valid days', () => {
  const now = new Date('2026-10-13T16:00:00Z');
  assert.deepEqual(parseCostParams(new URLSearchParams(''), now), { range: 'month', from: '2026-10-01', to: '2026-10-13', vertical: null, mode: 'production' });
  assert.equal(parseCostParams(new URLSearchParams('range=7d'), now).from, '2026-10-07');
  assert.equal(parseCostParams(new URLSearchParams('range=custom&from=2026-09-01&to=2026-09-30'), now).to, '2026-09-30');
  assert.equal(parseCostParams(new URLSearchParams('range=custom&from=nope'), now).range, 'month');
  assert.equal(parseCostParams(new URLSearchParams('type=carousels&mode=development'), now).vertical, 'carousels');
});
```

- [ ] **Step 2: Run it to confirm it fails.**
Run: `npx tsx --test tests/social-cost-model.test.ts`
Expected: FAIL, because `load.ts` can't be found.

- [ ] **Step 3: Write `load.ts`.** `parseCostParams` is pure; `loadCostPage` never throws.

```ts
import { allocate, itemFirstDay, itemTotals } from '@/lib/social-hub/cost';
import { cacheSavings, readCacheRows } from '@/lib/social-hub/cost-page/caching';
import { costModel, type CostInput } from '@/lib/social-hub/cost-page/model';
import { toCostRows, type CarouselStageSplit, type CarouselVendorSplit } from '@/lib/social-hub/cost-page/rows';
import { classifyWaste, wasteSets } from '@/lib/social-hub/cost-page/waste';
import { explainersHubQuery, liveHubQuery, type HubQuery } from '@/lib/social-hub/db';
import { readinessFor } from '@/lib/social-hub/health/readiness';
import { loadForPage } from '@/lib/social-hub/live';
import { buildLedger, readCosts } from '@/lib/social-hub/queries/costs';
import { addDays, isDayKey, nyDateOf } from '@/lib/social-hub/time';
import { isVertical, VERTICAL_IDS } from '@/lib/social-hub/verticals';
import type { Vertical } from '@/lib/social-hub/types';

type Params = { get(name: string): string | null };

export function parseCostParams(p: Params, now: Date) {
  const today = nyDateOf(now)!;
  const type = p.get('type');
  const vertical: Vertical | null = isVertical(type) ? type : null;
  const mode = p.get('mode') === 'development' ? 'development' : 'production';
  const r = p.get('range');
  if (r === '7d') return { range: '7d' as const, from: addDays(today, -6), to: today, vertical, mode } as const;
  if (r === '30d') return { range: '30d' as const, from: addDays(today, -29), to: today, vertical, mode } as const;
  const from = p.get('from');
  const to = p.get('to');
  if (r === 'custom' && isDayKey(from) && isDayKey(to) && from <= to) return { range: 'custom' as const, from, to, vertical, mode } as const;
  return { range: 'month' as const, from: `${today.slice(0, 7)}-01`, to: today, vertical, mode } as const;
}

async function watches(): Promise<Record<Vertical, number>> {
  const { MONTHLY_WATCH_USD } = await import('@/lib/reels/config');
  const { loadSettings: storiesSettings } = await import('@/lib/stories/settings');
  const { liveStoriesDb } = await import('@/lib/stories/db');
  const { loadSettings: explainersSettings } = await import('@/lib/explainers/settings');
  const { explainersDb } = await import('@/lib/explainers/connection');
  const { getSocialSetting } = await import('@/lib/social/overnight/settings');
  const { DEFAULT_RUN_CAP_USD } = await import('@/lib/social/overnight/config');
  const now = new Date();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const stories = await storiesSettings(liveStoriesDb as never).catch(() => null);
  const explainers = await explainersDb().then((db) => explainersSettings(db as never)).catch(() => null);
  const runCap = (await getSocialSetting<number>('run_cap_usd').catch(() => null)) ?? DEFAULT_RUN_CAP_USD;
  return {
    reels: MONTHLY_WATCH_USD,
    stories: stories?.monthlyWatchUsd ?? 25,
    explainers: (explainers?.daily_spend_cap_usd ?? 10) * days,
    carousels: runCap * days,
  };
}

export async function loadCostPage(email: string, params: Params, now: Date): Promise<CostInput | { error: string }> {
  try {
    const p = parseCostParams(params, now);
    const eq: HubQuery | null = await explainersHubQuery().catch(() => null);
    const reads = await readCosts(liveHubQuery, eq ?? Promise.reject(new Error('Explainers database not available')));
    const { rows, pools } = buildLedger(reads);
    const ledger = allocate(rows, pools);
    const stages = (await liveHubQuery<{ id: string; s: Record<string, number> | null; claude: number; jev: number | null; total: number }>(
      `SELECT id::text, record->'result'->'costByStage' AS s, claude_usd::float8 AS claude, (record->'jev'->>'costUsd')::float8 AS jev, total_usd::float8 AS total
         FROM social.runs WHERE status IN ('ok', 'partial', 'failed')`,
    )).rows;
    const cRows = toCostRows(
      ledger,
      stages.map((r): CarouselStageSplit => ({ runId: r.id, byStage: r.s ?? {} })),
      stages.map((r): CarouselVendorSplit => ({ runId: r.id, claude: r.claude, jev: r.jev ?? 0, total: r.total })),
    );
    const loaded = await loadForPage(email);
    const posts = 'error' in loaded ? [] : loaded.posts;
    const sets = await wasteSets(liveHubQuery, eq);
    const inRangeItems = new Map([...itemTotals(ledger)].filter(([k]) => {
      const d = itemFirstDay(ledger).get(k);
      return d !== undefined && d >= p.from && d <= p.to;
    }));
    const spendMicros = cRows.filter((r) => r.mode === p.mode && r.nyDate >= p.from && r.nyDate <= p.to).reduce((n, r) => n + r.micros, 0);
    const published = new Set(posts.filter((x) => x.status === 'published' && x.costItemKey).map((x) => x.costItemKey!));
    const inFlight = new Set(posts.filter((x) => ['ready', 'scheduled', 'publishing', 'generating'].includes(x.status) && x.costItemKey).map((x) => x.costItemKey!));
    const unattributed = ledger.unattributed.filter((u) => u.nyDate >= p.from && u.nyDate <= p.to).reduce((n, u) => n + u.micros, 0);
    const waste = classifyWaste({ itemMicros: inRangeItems, firstDay: itemFirstDay(ledger), published, inFlight, unattributedMicros: unattributed, now, spendMicros, ...sets });
    const prevFrom = `${addDays(p.from, -1).slice(0, 7)}-01`;
    const prevTo = addDays(p.from, -1);
    const prevItems = new Map([...itemTotals(ledger)].filter(([k]) => { const d = itemFirstDay(ledger).get(k); return d !== undefined && d >= prevFrom && d <= prevTo; }));
    const prevSpend = cRows.filter((r) => r.mode === 'production' && r.nyDate >= prevFrom && r.nyDate <= prevTo).reduce((n, r) => n + r.micros, 0);
    const prevWaste = classifyWaste({ itemMicros: prevItems, firstDay: itemFirstDay(ledger), published, inFlight: new Set(), unattributedMicros: 0, now, spendMicros: prevSpend, ...sets });
    const prevWastePct = prevSpend > 0 ? Math.round(((prevWaste.rejected + prevWaste.failed + prevWaste.expired) / prevSpend) * 100) : null;
    const months = new Map<string, number>();
    for (const r of cRows) if (r.mode === 'production') months.set(r.nyDate.slice(0, 7), (months.get(r.nyDate.slice(0, 7)) ?? 0) + r.micros);
    const bestEverCpi: Partial<Record<Vertical, number>> = {};
    for (const v of VERTICAL_IDS) {
      const byMonth = new Map<string, { cost: number; n: number }>();
      for (const x of posts.filter((y) => y.vertical === v && y.status === 'published' && y.postedAt && y.costMicros && y.postedAt.slice(0, 7) < p.to.slice(0, 7))) {
        const m = byMonth.get(x.postedAt!.slice(0, 7)) ?? { cost: 0, n: 0 };
        m.cost += x.costMicros!;
        m.n += (await import('@/lib/social-hub/cost-page/model')).interactionsOf(x);
        byMonth.set(x.postedAt!.slice(0, 7), m);
      }
      const cpis = [...byMonth.values()].filter((m) => m.n > 0).map((m) => m.cost / m.n);
      if (cpis.length) bestEverCpi[v] = Math.min(...cpis);
    }
    const caching = cacheSavings(await readCacheRows(liveHubQuery, eq, `${p.from}T00:00:00-05:00`, `${addDays(p.to, 1)}T00:00:00-05:00`));
    return {
      rows: cRows, from: p.from, to: p.to, now, vertical: p.vertical, mode: p.mode, watchUsd: await watches(), posts, waste, prevWastePct,
      readiness: await readinessFor(liveHubQuery, now), caching,
      monthTotals: [...months.entries()].sort().map(([month, micros]) => ({ month, micros })), bestEverCpi,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
```

Move the dynamic `import('@/lib/social-hub/cost-page/model')` inside the loop to a static top-level import of `interactionsOf`. It is written inline above only to show which function is used.

The `readCacheRows` bounds use the EST offset as an approximation. Replace them with `nyDayStart(p.from).toISOString()` and `nyDayStart(addDays(p.to, 1)).toISOString()` from `lib/social-hub/time.ts`, which are DST-correct.

- [ ] **Step 4: Run the tests to confirm they pass.**
Run: `npx tsx --test tests/social-cost-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the pages.**
  - **Live** (`app/social/(hub)/analytics/cost/page.tsx`), the same shape as the Health page:
    1. check the `views.cost` flag;
    2. check the session;
    3. `const input = await loadCostPage(session.email, toParams(await searchParams), new Date())`;
    4. if `'error' in input`, render `<LoadError message={input.error} />`;
    5. otherwise render `<CostScreen model={costModel(input)} params={parseCostParams(toParams(...), now)} base={HUB_BASE} />`.
  - **Preview** (`app/social/(hub)/preview/analytics/cost/page.tsx`): call `assertPreviewAllowed()`, then render `<CostScreen model={costModel({ ...previewCost(), ...overrides from parseCostParams(params, FIXTURE_NOW) })} params={...} base={PREVIEW_BASE} />`. The overrides are `vertical` and `mode`; keep the fixture's `from`/`to` unless the range is custom.

- [ ] **Step 6: Write the components.** All copy and layout come from `cost-v3.html`.

**`AnalyticsSubnav.tsx`** is a `'use client'` component.
- It shows two links, "Performance" (`${base}/analytics`) and "Cost" (`${base}/analytics/cost`), with `aria-current` set from `usePathname()`. `base` comes from `hubBaseOf(path)`.
- Cost is active when the path ends in `/analytics/cost`; otherwise Performance is active.
- Render it in both analytics layouts, above `{children}`.

**`RangeControls.tsx`** is a `'use client'` component.
- **Three segmented link groups**, built from the current params with one key changed (use `URLSearchParams`):
  - Type: All types · Text on Screen · Explainer Reels · Carousels · IG Stories (labels from `VERTICALS`);
  - Range: 7 days · 30 days · This month · Custom;
  - Mode: Production · Development.
- **Custom** reveals two `<input type="date">` fields and an "Apply" button that does `router.push(...)`. Do not use a `<form method="get">` (routes test). Do not use a native `<select>`.

**`CostScreen.tsx`** is a server component. In order:
1. `<RangeControls>`.
2. An eyebrow: "{Month} so far · production · usage only". Use "development" when in that mode, and "{from}–{to}" for other ranges.
3. **Total.** A big total `<span className="sh-ops-total" data-to={model.totalMicros}>`, which counts up through a tiny client `CountUp` child. When `unknownCalls > 0`, add a muted note "+ {n} calls with unknown cost".
4. **Headline and pace.** The headline sentence. Then the pace bar: a fill via `transform: scaleX(spent/watch)`, a projected dashed marker at `projected/watch`, and the labels "${spent} spent · projected ${projected} · watch ${watch}".
5. **Chips and months.** The chips. Then "Months closed under watch:" with a pill per month: "✓ Aug" in green when `under`, "Oct · on track" or "Oct · over pace" when `null`.
6. **Chart.** `<CostChart series={model.series} rows={model.rows} />`.
7. **Budget.** A heading with ⓘ (popover copy: "Each type's spend this month against its monthly watch. Types with only a daily cap use the cap × days in the month."). Then four cards:
   - mark, label, "$spent of $watch", "on pace for $projected" (adding " · over watch" when `!onPace`), and a fill bar;
   - a self-drawing check when `onPace`;
   - each card links to `?type=<vertical>`, keeping the other params.
8. **Worth.** A heading with ⓘ. Two panels:
   - left: cost per interaction per type, with the interaction count;
   - right: the selected type's kinds (the first type by default; clicking a type on the left switches it through a client `WorthDrill` child), plus a "See posts ranked by cost per {kind}" link that expands a list of that type's published posts sorted by `costMicros / metrics[kind]`.

   Then the "Best value this month" card: thumbnail from `post.media` (video poster, or the first slide or frame src), `post.name`, interactions · follows · cost, and the cost per interaction. Then the "Saved by prompt caching" card: the counted-up dollars, plus the line "Explainers and Stories, where cache use is recorded. Without caching, this range would be ${total + saved}."
9. **Waste.** A heading with ⓘ (popover copy: "Money spent on things that never posted. Rejected includes earlier attempts behind a regenerate. Filtered stories are the cost of choosing, shown separately and not counted as waste."). Then:
   - the dollar total and "wasted · {pct}% of spend";
   - a badge "↓ {prev−pct} pts vs last month" (green) or "↑ …" (plain) when `prevPct` is not null;
   - the three-part stacked bar and the key-value rows, plus a muted "Selection cost (filtered, not waste)" row;
   - the "Rejection rate · 30 days" bars per type, with the line: "Lower is closer to auto-publish. The same number feeds the readiness ring on Health."

**`CostChart.tsx`** is a `'use client'` component.
- **Toggle:** a segmented `By type | By vendor | By stage`, held in local state.
- **SVG:** stacked bars with `viewBox="0 0 760 230"`, a y-axis in dollars, and day labels.
- **Hover:** the `onMouseMove` / `onFocus` of a bar group shows a card listing the day, the total, and each series with its colored mark, dollars and change marker from `hoverCompare(series, i)`:
  - "≈" for `same`;
  - "▲{pct}%" for `up` (failed ink);
  - "▼{pct}%" for `down` (green);
  - "new" for `new`.

  Then the line "vs the 7 days before: ${avg} avg · {marker}", and the footer "Click the bar for what drove it". The hovered segment gets `filter: brightness(1.1)`.
- **Click:** selecting a day dims the others to opacity 0.35 and opens a panel with `spikeDrivers(rows, day, series.days)` as label · bar · dollars. Lines with `ratio ≥ 2` are flagged in failed ink with "{ratio}× its usual". The panel ends with "Open the night" (`${base}/health/night/${day}`).
- **Accessibility:** each bar group is a focusable `<g tabIndex={0} role="button" aria-label="Oct 8: $17.20">`; Enter or Space selects it.
- **Motion:** bars grow in with `transform: scaleY` from 0, staggered.

- [ ] **Step 7: Run the route and preview tests, plus types.**
Run: `npx tsx --test tests/social-hub-routes.test.ts tests/social-hub-preview.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Verify in the browser.**
  1. Open `/social/preview/analytics/cost`.
  2. Check:
     - Performance | Cost sub-nav;
     - controls;
     - the total counts up;
     - the headline includes "On pace for";
     - hovering the 10-08 bar shows the Explainer Reels line with ▲ and the 7-day comparison;
     - clicking opens the drivers;
     - `By vendor` and `By stage` change the legend and hover rows;
     - Budget, Worth (drill), Best value, Caching, Waste and Rejection all render;
     - `?type=carousels` filters;
     - `?mode=development` shows only the development row.
  3. Check `/social/preview/analytics` still shows Performance with the sub-nav.
  4. Take a screenshot.

- [ ] **Step 9: Commit.**

```bash
git add lib/social-hub/cost-page/load.ts components/social-hub/cost app/social/\(hub\)/analytics app/social/\(hub\)/preview/analytics app/social/\(hub\)/hub-ops.css tests/social-cost-model.test.ts
git commit -m "feat(cost): Cost page in Analytics with toggle chart, hovers, budget, worth and waste"
```

---

### Task 13: DESIGN.md amendment and final checks

**Files:**
- Modify: `DESIGN.md`

- [ ] **Step 1: Rename the type in `DESIGN.md`.** Replace "Trial Reels" with "Text on Screen" everywhere: in the Tertiary heading list, "Reel Teal (#14b8c4): Text on Screen", and the typography example. Leave the history note ("moved to teal (decided 2026-10-08)") as it is, apart from the name.

- [ ] **Step 2: Add the scoped amendment** under §2 Named Rules, after The Quiet State Rule.

```markdown
**The Health and Cost Exception (2026-10-13).** On the Health tab and the Cost page only, Helios Green (#138510) is the highlight and the success color: the active toggle, "worked" night blocks, check marks, reward chips, progress fills and "under pace" states. Short uses amber ink (#a15c07) on amber wash (#fdf3e1); Failed keeps Failed Ink on Failed Wash. Carousels keep green as their type mark in charts. Every other hub screen keeps The Quiet State Rule. Rewards (streaks, new bests, fixed problems, clean-night glow) appear only for real good news; a bad morning stays calm.
```

- [ ] **Step 3: Run the full verification.**
Run: `npm test && npx tsc --noEmit`
Expected: every test passes, with no type errors.

- [ ] **Step 4: Commit.**

```bash
git add DESIGN.md
git commit -m "docs(design): Health and Cost green exception; Text on Screen name"
```

- [ ] **Step 5: Report to the user.** Cover:
  - what shipped;
  - that the 7:30 job runs inside the social worker (the deviation from the spec);
  - whether the VM can read the Explainers database;
  - that `HELIOS_RUN_MODE=development` should be set in `.env.local` for local Stories runs;
  - follow-ups: cache-token columns for Text on Screen and Carousels; the new content type's reporter.
