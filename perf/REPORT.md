# Performance report: The Helios Hub

Branch `claude/eloquent-ramanujan-po7kia` (the playbook's `perf/overhaul`; this session can only push to its assigned branch). Baseline commit `0d5ca11` (app code as of `f2bf691`).

<!-- VERDICT -->

## How this was measured

Full method in [`PROFILE.md`](PROFILE.md):

- Production build (`next start`).
- Local Postgres 16 with the full schema and a synthetic seed of about 0.6 M rows ([`db/volumes.json`](db/volumes.json)), behind a proxy adding **5 ms round trips** on port 6543 with `VERCEL=1`, so `lib/db.ts` uses production's pool (transaction mode, 3 connections).
- 95 measurable routes out of 307 route/method entries in [`routes.json`](routes.json). Every route that could spend money, call third parties or write is excluded, with the reason recorded.
- Per route: 30 warm runs, 30 cold cycles (fresh process with an empty data cache), a per-request SQL trace, and Lighthouse (mobile, Fast 4G, 4x CPU) on the pages.
- Raw results: [`baseline.json`](baseline.json) and [`final.json`](final.json). Bundle sizes are the **true** first-load JS including layouts ([`bundle-baseline/first-load.json`](bundle-baseline/first-load.json) → [`bundle-final/first-load.json`](bundle-final/first-load.json)).

Caveats that matter when reading the numbers:

1. **The data is synthetic.** Volumes are estimates (DECISIONS D2). The Social Hub tables are calibrated to the dataset size recorded in the code comments.
2. **Postgres JIT is on locally** (the PG 16 default). It was the biggest single cost in the slowest queries. Whether production uses it is DECISIONS D6.
3. **`next start` does not compress route-handler JSON** (Vercel's edge does), so local Lighthouse is pessimistic for pages that fetch large JSON (`/hub/queue`).
4. **This machine is not Vercel.** Absolute numbers will differ in production. Before/after on the same machine, data and profile is what each change was judged by.

## Before / after, every measured route

<!-- TABLE -->

## Changes kept, with measured impact

One commit per optimization; the numbers are also in each commit message.

### Backend and data (Phase 3)

| # | Change | Commit | Measured effect |
|---|---|---|---|
| 1 | `loadSlates` reads `reels.idea_sources_v` once per slate set instead of 2 correlated subqueries per row | `45c96b4` | `/api/reels/overview` warm p95 **1500 → 122 ms**. The statement went 632 → 5 ms; it had been 627 ms of JIT compile. |
| 2 | Single-flight hub dataset rebuild, invalidation-aware | `faefd0e` | Under a hub burst: rebuilds **25 → 3** per 3 min, unrelated probe p99 **1296 → 118 ms** (max 2739 → 592). `/api/inboxes/[id]` warm p95 **3538 → 18 ms**. |
| 3 | Campaign list counts bounces once (CTE) + `email_send_queue (campaign_id, status, schedule_date)` index | `ddd387c` | `/api/campaigns` warm p95 **223 → 71 ms**. The statement went 157 → 56 ms, below the JIT threshold. |
| 4 | `businessDaysBetween` counts whole weeks | `29f8c1c` | `/api/send-queue` warm p95 **807 → 324 ms**. Identical on 51,992 date pairs. |
| 5 | Cost analytics page reads in one wave | `2e52704` | `/social/analytics/cost` warm p95 **859 → 320 ms** |
| 6 | Outreach-stats daily series as two grouped reads | `54e883a` | warm p95 **237 → 49 ms**. The statement went 161 → 0.35 ms. |
| 7 | Analytics summary in two waves | `2f8939d` | warm p95 **447 → 260 ms** |
| 8 | Run-today plan uses the cached cost part | `74512c4` | warm p95 **770 → 530 ms**, 103 → 89 queries |
| 9 | One Stories read per hub rebuild | `f33d5bd` | Full cold rebuild **888 → 522 ms**, 79 → 71 queries (function benchmark) |
| 10 | Progress "typical duration" once per key (N+1) | `0727241` | With a 40-set backlog, **51 → 14 queries**, 111 → 28 ms. Constant count; unchanged with today's data. |
| 11 | Reel facts read lead headlines once | `7b7d6ee` | Statement 92 → 18 ms (JIT 83 → 0). Rebuild wall time unchanged (it runs in parallel); kept for DB CPU. |
| 12 | Render-path story-frame signing gets a 1.5 s timeout | `da5fe97` | A slow Storage stub (5 s) blocked render **5040 → 1505 ms**; a healthy 60 ms Storage response still signs in 89 ms. |
| 13 | Slow-query log (`db/slow_query` at ≥ 100 ms, no parameters) | `41b02d2` | Guardrail (Phase 6.4) |

### Frontend (Phase 4)

| # | Change | Commit | Measured effect |
|---|---|---|---|
| 14 | Sidebar drawer: `LazyMotion` + `m` | `9308548` | **−27.5 KB gz initial JS on every page.** Pages within 150 KB: **0 → 40 of 55**. |
| 15 | Anthropic SDK out of client bundles (pure helper split) | `d9115a1` | draft 179 → 163 KB, prospect 158 → 142 KB; prospect TBT 168 → 99 ms |
| 16 | Trello views and dialogs on demand, prefetched when idle | `4ea4c54` | 255 → 229 KB (LCP unchanged: see "still over budget") |
| 17 | Hub streams the campaign list from the server (no client waterfall) | `13e1e70` | `/hub` LCP **2169 → 1785 ms**, TBT 385 → 155 ms |
| 18 | Dashboards reuse the `next/font` brand font (no second copy) | `44538d7` | −113 KB per visit; `/dashboards` LCP **1141 → 657 ms** |
| 19 | `content-visibility: auto` on stacked hub table rows | `2972581` | Music library LCP **6222 → 4290 ms**, TBT 4506 → 3102 ms |

### Guardrails (Phase 6)

`.github/workflows/perf-budgets.yml` runs on every PR. It checks the true first-load JS per route against [`budgets.json`](budgets.json), the warm p95 per measured route against the playbook budgets, and Lighthouse CI (server response ≤ 150 ms is an error; LCP, TBT and CLS are warnings). A deliberately regressed branch (all of `date-fns` in the root layout) failed 44 of 45 bundle budgets ([`experiments/ci-regression-demo.txt`](experiments/ci-regression-demo.txt)). How to run, read, and extend it: [`README.md`](README.md).

## Changes reverted, with the reason

| Change | Why it was reverted |
|---|---|
| `email_send_queue` campaign index **alone** | The planner used it, but the routes didn't improve (`/api/campaigns` p50 128 ms without it vs 132 ms with it, 40 runs back to back), because JIT and the other subplans dominated. It was brought back only together with the bounced-count CTE (#3), where the two combined clear the JIT threshold. |
| Hub reads capped at pool size − 1 | It took about 20 ms off the burst p99 (118 → 97) but made every cold rebuild about 14% slower (522 → 603 ms). Single-flight had already removed the cause. |
| Brand font `preload: false` | FCP −70 ms and −105 KB on pages that don't use the face, but **LCP got worse everywhere**, +476 ms on `/`, where the title is the LCP element. The real fix is a smaller file (DECISIONS D7). |
| size-limit, autocannon and Lighthouse as devDependencies | `tests/social-hub-scope.test.ts` pins `package.json` and the lockfile. The tools are installed on demand (`perf/tools.sh`), and size-limit was replaced by `perf/lib/bundle-sizes.mjs --check`. |

## Still over budget: root cause and proposed plan

<!-- OVER -->

## Heavy pages (budget applied to first paint)

<!-- HEAVY -->

## Decisions needed from you

See [`DECISIONS_NEEDED.md`](DECISIONS_NEEDED.md):

- **D1**: the Vercel function region must equal the Supabase region.
- **D2**: real row counts for the seed.
- **D3**: no Redis needed.
- **D4**: security findings outside scope. A committed `.env.local.bak.*`, an unreachable Smartlead webhook, and 4 pages missing from the middleware matcher.
- **D5**: APM.
- **D6**: check Postgres JIT in production. This is potentially the biggest single win.
- **D7**: WOFF2 brand font (licensing).
- **D8**: deploy steps (index migration, worker redeploys).
