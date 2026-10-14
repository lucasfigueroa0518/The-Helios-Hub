# Social Hub: Health tab and Cost page

Date: 2026-10-13 · Status: draft for review · Owner: Tommy (with Lucas)
Mockups: `.superpowers/brainstorm/86518-1791921162/content/` (Health: `health-v5d.html`; Cost: `cost-v3.html`)

## 1. Why

Each morning you should be able to open one place and know whether the Social
machine worked last night, and if it didn't, why, when and how. A second place
should show what the machine costs and whether that money is well spent.

These two pages are the first step toward a system that runs itself:

```
Failure record → Health tab (see it) → Diagnose (group, spot repeats, propose a fix) → Heal / Modify
 [this build]     [this build]           [later]                                       [later]
```

The most important deliverable is not the UI. It is **one consistent record of
every failure and every dollar, across all content types**. The pages read that
record now. A future self-diagnosing step will read the same record later.

**Users:** Tommy and Lucas. Signed-in hub users only; there are no roles (SH-14).
The page is checked in the morning, and a few more times during the day.

## 2. Scope

**In scope**
- A **Health** tab, added as the fourth Social Hub tab: Content · Calendar · Analytics · Health.
- A **Cost** page inside Analytics, with sub-tabs **Performance | Cost**. Cost is a separate page from performance analytics.
- A shared failure record, plus one reporter per content type that translates that type's own tables into the record.
- A **morning report** job that runs at 7:30 AM ET on the social worker VM and saves each night's report.

**Out of scope (decided)**
- Fixed costs: subscriptions, VMs, Supabase, Vercel. The Cost page shows **usage only**.
- Email, push, Slack or any other notification. The morning report lives only in the Health tab.
- Automatic fixing: self-healing changes, self-diagnosis, self-modification. This build only records and shows.
- A hub-wide (all-apps) analytics page. That may come later.
- Any on/off controls for the pipelines. Both pages are read-only, except for the 7:30 job writing its report.

**Hard rules that apply**
- **No Claude API calls anywhere in this feature** (CLAUDE.md Rule 1). Headlines, ledes and problem titles are produced by code templates, not by a model. "Copy for Claude" only copies text to the clipboard.
- Reads only. Nothing sweeps or modifies pipeline data (CLAUDE.md Rule 2 spirit).
- Changes to the worker or its timer must be redeployed in the same session with `./scripts/gcp/deploy-social-worker.sh`.

## 3. Navigation and routes

| Page | Route | Notes |
|---|---|---|
| Health | `/social/health` | `HUB_TABS` gains `{id:'health', label:'Health', path:'/health'}` (`lib/social-hub/views/nav.ts`). `sectionOf` and `crumbsFor` learn the new section. |
| Night detail | `/social/health/night/[date]` | Opened by clicking a night block or a problem. It may also open as the `@drawer` intercept, like post pages do. |
| Cost | `/social/analytics/cost` | This is a static segment, so it takes precedence over `analytics/[type]`. Analytics gets a sub-nav: Performance (the existing pages) and Cost. |

Each page follows the hub pattern:
- view flag check, then `getSession()`, then a server component with `dynamic='force-dynamic'`;
- a pure view model over the data;
- a `preview/` mirror on fixture data (`tests/social-hub-routes.test.ts` requires one);
- new view flags `health` and `cost` in `lib/social-hub/flags.ts`.

## 4. Data foundation

### 4.1 Content types come from one list

Neither page names a content type in its code. Both loop over `VERTICALS`
(`lib/social-hub/verticals.ts`), which holds the label ("Text on Screen",
"Explainer Reels", "Carousels", "IG Stories"), the color and the links. Labels
are always read from there.

### 4.2 Reporter contract (one per type)

Each content type supplies a reporter. It answers the same questions for any
night *N*. A night is the overnight cycle that ends at 7:30 AM ET on date *N*.

```ts
type NightReport = {
  vertical: Vertical;
  night: string;                 // 'YYYY-MM-DD', the morning the cycle ends
  ran: boolean;                  // false → "Didn't run" (grey)
  target: number;                // that day's quota minus what people placed
  made: number;                  // drafts the run produced toward the target
  ready: number;                 // approvable drafts waiting for the coming slots
  scheduledYesterday: number;    // posts scheduled for night−1
  postedYesterday: number;       // of those, how many went out
  retriedOk: number;             // posts or stages that failed, then succeeded on retry
  funnel: { stage: string; in: number; out: number }[];   // filtered, not failures
  failures: FailureEvent[];
  spendUsd: number;              // production spend attributed to this night's run
};

type FailureEvent = {
  vertical: Vertical; night: string; at: string;          // ISO timestamp
  stage: string;                 // the type's stage name: 'writer', 'photo', 'render', 'publish', …
  reason: string;                // normalized reason code, e.g. 'too_long', 'no_photo', 'cap_hit', 'meta_5xx'
  severity: 'failed' | 'healed' | 'warning';
  item?: { kind: string; id: string; label: string; href?: string };
  rawError?: string;
  spentUsd?: number;
  runId?: string;
};
```

**Where today's types already record this**
- **Text on Screen:** `reels.runs`, the `copy_jobs`, `visual_jobs`, `video_jobs` and `song_picks` stage jobs, `reels.finish_requests`, `reels.watermarks`.
- **Carousels:** `social.runs` (including `record` and `stop_reason`), `social.set_asides` (which already has `stage` plus `reason_code`), `social.feed_health`.
- **Explainers:** `explainers.idea_cycles`, `explainers.jobs` (`stage`, `error`, `capped`).
- **IG Stories:** `stories.sets` (`status`, `error`).
- **Publishing (all types):** `social_hub.schedule`, `social_hub.publish_attempts`, and the publisher heartbeat in `social_hub.settings`.

**Reason codes.** Carousels already store reason codes. For the other three, the
reporter maps the stage plus the raw error to a code using a small, tested rule
table (`lib/social-hub/health/reasons.ts`), with no model involved. Anything
unmatched becomes `other` and keeps its raw error, so a new kind of failure is
never hidden.

**New content types** write failures and spend directly in the `FailureEvent` and
cost-row shape from day one, which leaves their reporter nearly empty. Adding a
type means one `VERTICALS` entry plus one reporter. The type then gets its Health
row, streak, problems, Cost line and filter slot automatically.

### 4.3 Morning report (stored)

A job runs at **7:30 AM ET** on `helios-social-worker` as a systemd timer, after
the last overnight run (Stories, at 4:00) and the 5:45 account sweep. It builds
every type's `NightReport` for today and upserts one row per night:

```sql
CREATE TABLE social_hub.health_reports (
  night        date PRIMARY KEY,
  built_at     timestamptz NOT NULL,
  verdict      jsonb NOT NULL,   -- overall + per-type status and check results
  reports      jsonb NOT NULL,   -- NightReport[] as built
  failures     jsonb NOT NULL    -- FailureEvent[] (denormalized for grouping)
);
```

- The job is idempotent: re-running it for a night replaces that night's row.
- **History at launch:** reporters can compute any past night from the source tables, so the 14- and 30-night views fill in immediately. The stored row is the frozen "as reported at 7:30" version.
- **Live layer:** after 7:30, the page also reads today's live state (posts going out, new failures) and marks anything newer than the report as live.

### 4.4 Status rules (one place: `lib/social-hub/health/verdict.ts`)

Each type gets a status for each night, based on four checks:

| Check | Red (Failed) | Yellow (Short) | Green |
|---|---|---|---|
| **Made** | `made < target`, the run crashed or didn't run when due, or the cap stopped it | none | `made ≥ target` |
| **Ready** | 0 approvable drafts when slots need them | fewer waiting than the coming slots need | enough |
| **Posted** (night−1) | a scheduled post never went out | it went out only after a retry | everything posted on the first try |
| **Plumbing** | worker or publisher heartbeat is stale (over 5 min, matching `overnight_check.ts`) | a news source is stale, or spend is at or above 90% of the cap | all fresh |

- A type's color is its worst check. The overall headline counts types that were not red ("3 of 4 worked").
- A target already accounts for drafts people placed (quota − placed), so "short of target" is always red.
- **Healed** (yellow) means the system recovered on its own: a retry that succeeded.

### 4.5 Problems (grouping)

- **One problem per kind of failure.** The grouping key is `vertical + stage + reason`. Each problem carries `count` in the window, `firstSeen`, `lastSeen` and the nights it happened.
- **Back again:** it happened after at least 3 quiet nights.
- **Fixed:** it was quiet for **7 nights in a row** after its last occurrence. It then moves to the Fixed list. At 6 quiet nights it shows as "Almost".
- **Sort order:** newest `lastSeen` first. Problems quiet in the window fade out but stay listed.

## 5. Health tab (UI)

The approved mockup is `health-v5d.html`.

1. **Headline.** The eyebrow reads "Morning report · <day> · 7:30 AM". Then a one-line verdict:
   - a bad night reads, for example, "Last night, 3 of 4 worked. *Carousels didn't.*";
   - a clean night reads "**Clean night.** All 4 worked.";
   - a one-sentence lede gives the main cause and how often it has happened ("It's the third time in 14 nights").

   All of this is templated from the verdict, never generated by a model.
2. **Reward chips:** per-type clean-night streaks ("🔥 Text on Screen 13 clean nights"), "Clean nights this month N of M", and "✦ New best" when the all-types streak beats its record.
3. **Each type, night by night.** One row per type, plus a Publisher row.
   - Each row has 14 blocks, one per night, colored by that night's worst outcome. A segmented toggle switches between 14 and 30 nights.
   - The right column shows the status word plus either the streak or "N of 14 nights".
   - **Hover or keyboard focus on any block** opens a card: type · date · status pill · Made x of y · Posted x of y · Spend. Then a one-line reason, or "Clean night ✓" for a green block. A footer says "Click to open this night".
   - The Publisher card shows the heartbeat and posts sent instead. A grey block reads "No run that night".
   - **Click** opens the night detail.
4. **Problems** has an **ⓘ** popover that explains the dot, strip, count, Back again, Healed and Fixed. Each row shows:
   - the severity dot (red pulses gently only while it is current);
   - the title ("Carousels · Writer drops stories as too long");
   - a tag (Back again or Healed);
   - the latest-occurrence line, with *See items* and *Copy for Claude*;
   - a 14-night mini strip;
   - the count and when it was first seen.

   On a clean night the section reads "Nothing new last night."
5. **Fixed.** Confirmed fixes, each with a check mark that draws itself in, "Fixed <date> · quiet N nights · was N×". This is the payoff for fixing things.
6. **Auto-publish readiness ring**, per type. It fills to the approved-as-is rate over 30 days, the same number as the Cost page's rejection rate. It is a trust meter for the auto-publish goal.

**Night detail** (`/social/health/night/[date]`)
- per type: status, the four checks, the stage funnel (`in → out`) with the broken stage highlighted, and the failures with their items;
- per item: stage, plain reason, raw error (collapsed), time, spend so far, a hub link, and "Seen N times in 14 nights" linking to the other occurrences;
- **Copy for Claude** builds a markdown brief: type, night, stage, reason, raw error, earlier occurrences, run id, and the source files for that stage.

## 6. Cost page (UI)

The approved mockup is `cost-v3.html`. The section order is approved.

**Controls**
- Type filter: All types · Text on Screen · Explainers · Carousels · Stories.
- Range: `7 days | 30 days | This month | Custom`, defaulting to **This month**.
- `Production | Development`, defaulting to **Production**.

**Sections, top to bottom**
1. **Headline.** The total spend for the range in large type, counting up on load. Then one sentence:
   - projected month total vs. the combined watch;
   - last night's spend vs. normal;
   - dollars that went to drafts that never posted.

   Below that is a pace bar (spent · projected · watch).
2. **Reward chips:** "✦ New low" for the best-ever cost per interaction of any type, days in a row under daily pace, and waste % vs. last month. Then a month record: "Months closed under watch: ✓ Aug ✓ Sep · Oct on track".
3. **Main chart.** Daily spend as stacked bars, with a toggle bar `By type | By vendor | By stage`.
   - **Hover** shows that day's total. Each series gets its dollars and a change marker against **its own average over the previous 7 days**: "≈" within ±8%, ▲ higher (red), ▼ lower (green). Then a line comparing the day's total to the 7-day average. The hovered segment is emphasized.
   - **Click** opens "what drove it": the top type-and-stage lines for that day, a one-sentence cause when a spike has a known driver (for example, re-renders), and *Open the run* and *Copy for Claude*.
4. **Budget.** One card per type showing spent of its monthly watch, the projection, and a progress bar. A self-drawing check appears when the type is on pace to stay under its watch. Clicking a card filters the page to that type.
5. **Worth.** Cost per interaction per type. Click a type for the cost per kind (like, save, share, comment, follow, profile visit), then a kind for that type's posts ranked by cost per that kind. Also two cards:
   - **Best value this month:** thumbnail, title, interactions, cost.
   - **Saved by prompt caching:** the dollars saved, and what the range would have cost without caching.
6. **Waste**, with the dollar total and percentage of spend, and a change badge against last month. It is split into:
   - **Rejected or regenerated:** a finished draft a person said no to, and every earlier attempt behind a regenerate.
   - **Failed mid-pipeline:** spend on items with a `failed` FailureEvent.
   - **Expired:** a finished, approvable draft that was never posted and is no longer eligible.

   **Selection cost** (filtered or set aside) is shown separately and is not counted as waste. Next to the split, each type's **30-day rejection rate** is shown, where lower means closer to auto-publish.

**Rewards rule (both pages):** rewards appear only for real good news. Bad
states stay calm: no glow, no confetti, no celebratory copy. All motion respects
`prefers-reduced-motion`.

## 7. Cost data

- **Usage only**, from the existing per-type sources:
  - Text on Screen: `reels.cost_events`, plus the Kling estimate from `reels.video_jobs` via `klingClipUsdSql()`.
  - Explainers: `explainers.cost_events`.
  - IG Stories: `stories.cost_events`.
  - Carousels: `social.runs`, using `total_usd` and `record.result.costByStage`.
- **Do not load this through the cached hub dataset.** `slim()` strips the ledger (it is about 9 MB). The Cost page runs its own SQL that aggregates by day × vertical × vendor × stage (`lib/social-hub/queries/cost-page.ts`). It reuses the attribution rules in `queries/costs.ts`, so the hub's per-post cost and this page agree. `cost.ts` invariants hold: Σ allocations + Σ unattributed = Σ ledger.
- **Vendor and stage normalization.** Each type maps its own `component` or stage names onto the four chart stages (Research + scoring · Writing · Visuals · Video + render) and the vendor list. The map lives in one file per type, with tests.
- **Honest labels:**
  - Kling is a floor estimate, labeled "estimated".
  - HeyGen calls have `usd_known = false`. They are counted as unknown, shown as "N calls with unknown cost", and never shown as $0.
  - Carousels only have run-level and stage-level detail, so their drill stops at stage.
- **Production vs Development.**
  - Explainers already record `mode`.
  - Text on Screen uses `reels.runs.trigger` and its existing production/development ledger split (`lib/reels/analytics/rollups.ts`).
  - Carousels: `trigger = 'cli'` is development.
  - IG Stories has no mode today. The build adds one, recorded at the source going forward, and earlier rows count as production.

  Part of this build is confirming each mapping.
- **Watches.**
  - Text on Screen: `MONTHLY_WATCH_USD` (100).
  - IG Stories: `monthly_watch_usd`.
  - Explainers and Carousels only have daily caps (`daily_spend_cap_usd`, `run_cap_usd`). Their monthly watch is the daily cap × days in the month until a monthly setting exists.

  The combined watch is the sum.
- **Interactions.**
  - Feed posts and reels use the `totalInteractions` metric.
  - Stories use replies + shares + follows + profile visits (taps are navigation, not interactions).

  Spend is attributed to posts by the existing `withCosts` / `itemTotals`.
- **Prompt-caching savings** = `cache_read_tokens` × (input rate − cache-read rate) − cache-write premium, using `lib/anthropic-pricing.ts` rates. Only Explainers and Stories record cache tokens today, and the card says so. Adding cache columns to `reels.cost_events` and the carousel record is listed as follow-up work.
- **"Last night's spend"** = production spend whose run started in that night's cycle.

## 8. Design system

- Built on the hub's tokens and px type scale (DESIGN.md, Pixel Root Rule), in `app/social-hub.css` with `sh-` classes. Charts are hand-made SVG like `MetricChart.tsx`; no chart library.
- **DESIGN.md amendment (scoped):** on Health and Cost only, Helios green (#138510) is the highlight color and the color for success. It is used for:
  - the active toggle;
  - the "worked" blocks;
  - check marks;
  - reward chips;
  - progress fills.

  Carousels keep green as their type mark in charts; this was approved. The rest of the hub keeps the Quiet State Rule. The amendment is written into DESIGN.md as part of this build.
- Type hues stay as marks (dots, bars), never text. Failed uses Failed Ink on Failed Wash; Short uses an amber ink on wash.
- Hover cards also open on keyboard focus. Every number uses tabular figures. Nothing renders below 12px.
- Fixes noted from the mockups:
  - no thick left-border accent on panels;
  - animate with transform and opacity, not width.

## 9. Testing (offline only)

- **Verdict rules:** a table of fixture nights with the expected status per check and per type.
- **Reason mapping:** raw errors → codes, with unmatched → `other`.
- **Problem grouping:** count, first and last seen, Back again, Fixed at 7 quiet nights, Almost at 6.
- **Reporters:** one test per type against PGlite fixtures built from each type's schema.
- **Cost aggregation:**
  - totals match `summarize()` for the same window;
  - unknown-cost rows are never counted as $0;
  - dev/prod split;
  - 7-day comparison math.
- **View models** over `previewDataset()` at `FIXTURE_NOW`, plus preview mirrors for every new page (the routes test).
- **Morning report job:** idempotent upsert, with the clock injected.

No test calls the Claude API, `web_search` or Meta.

## 10. Build order (suggested)

1. Reporter contract, reason rules, verdict rules, problem grouping (pure, tested).
2. The four reporters, plus the `health_reports` table and the 7:30 job (deploy to the social worker).
3. Health tab UI and night detail.
4. Cost queries (aggregation, normalization maps, dev/prod, watches).
5. Cost page UI.
6. DESIGN.md amendment and the preview fixtures throughout.

## 11. Open items

- **The new content type:** name and status not yet given. The design needs only a `VERTICALS` entry and a reporter. If it isn't built yet, its requirements should include "report failures and spend in the shared shape".
- **Docs drift:** DESIGN.md and some docs still say "Trial Reels". The hub's code uses "Text on Screen". The DESIGN.md amendment fixes the name too.
- **Cache columns** for Text on Screen and Carousels, so caching savings cover every type (follow-up).
