# Bottlenecks (Phase 2 baseline)

Source: `perf/baseline.json` (95 routes, 30 warm runs plus 30 cold cycles each, SQL trace, Lighthouse). The profile is in `PROFILE.md`.
The full ranking of all 95 routes by warm p95 is `perf/runs/baseline/ranking.md` (not committed; regenerate it with `node perf/lib/analyze.mjs baseline`). The worst 15 are below. Slowest statements and N+1 signals are in `perf/slow-queries.md`.

**Baseline verdict: 89/95 measured routes meet the warm budget** (page TTFB ≤ 150 ms and HTML ≤ 500 ms; API ≤ 500 ms). Six don't. Eleven more APIs are within 500 ms but over the 150 ms server target. Every page streams its shell well within budget (worst warm TTFB p95 is 95 ms). The problems are in the full response, the cold path, and the browser.

## Cross-cutting causes

1. **Postgres JIT compiling is most of the time in the slowest queries.** In `pg_stat_statements` (whole run): reels `loadSlates` 632 ms mean, of which **627 ms is JIT**. Outreach-stats per-day counts: 161 ms, of which 160 ms is JIT. Campaign list: 142 ms, of which 54 ms is JIT. Hub reel facts: 92 ms, of which 83 ms is JIT. Reels analytics headline query: 55 ms, of which 54 ms is JIT. Correlated subqueries, mostly over the recursive view `reels.idea_sources_v`, inflate the planner's cost estimate past the JIT thresholds. The actual execution is 10–30 ms. (Whether production has JIT on is DECISIONS D6.)
2. **The Social Hub dataset is rebuilt too often, and the rebuild starves the pool.** The rebuild is about 80 reads and 1.0–1.6 s cold. Under a burst of hub requests after the 60 s expiry, stale revalidations are not deduplicated: **25 rebuilds in 3 minutes** (`perf/runs/contention-burst-before.json`). Each takes all 3 per-isolate pool slots, so a one-query API on the same process went to **p99 1296 ms, max 2739 ms** (p50 20 ms). In the warm run, `/api/inboxes/[id]` (one 8 ms query) shows p95 3538 ms and p99 8408 ms right after the hub-warm route.
3. **Cold-rebuild waste.** The three Stories-format types each re-read the same Stories engine. That is 4 queries × 3, about 0.4 s of SQL, in every cold rebuild.
4. **Sequential awaits on independent reads**: the analytics summary (8 steps, 3 dependency levels), the Social cost page (8 steps, all independent after the first), and the reels overview waves.
5. **Payload size**: `/trello` sends **15.8 MB of HTML** (the entire workspace as RSC props), `/api/send-queue` sends **9.4 MB of JSON**, which `/hub/queue` fetches client-side (Lighthouse LCP **17.4 s**), and the music library sends **1.9 MB of HTML** (800 rows, each with a native `<audio controls>`; Lighthouse **TBT 4.5 s**). Note that `next start` does not compress route-handler JSON (Vercel's edge does), so local Lighthouse overstates `/hub/queue`. See REPORT.
6. **Client JS**: Next's "First Load JS" leaves out the root layout's chunks. The real first-load JS (`perf/bundle-baseline/first-load.json`, via `perf/lib/bundle-sizes.mjs`) is **160–250 KB gz on every signed-in page**, and every page is over the 150 KB budget. The root layout alone is about 57 KB, of which **37 KB is framer-motion**, used only by the sidebar's mobile drawer. `@anthropic-ai/sdk` (16 KB) is shipped to `/campaigns/[id]/draft` and `/prospect` through a pure helper's module.
7. **Fonts**: the brand font is a **244 KB OTF preloaded on every page** for one heading. On dashboards pages it downloads **twice**, once from `next/font` and once from a second `@font-face` in `/public`.

## Worst 15 routes by warm p95 (ms)

| # | Route | Warm p50 / p95 | Cold p95 | SQL (warm) | Where the time goes (evidence) |
|---|---|---|---|---|---|
| 1 | `GET /api/inboxes/[id]` | 16 / **3538** | 35 | 1 stmt, 8 ms | **Pool starvation.** Sampled right after `/api/hub/warm`: the overlapping background hub rebuilds (`dataset_rebuild` ×3 within 300 ms in the log) held all 3 slots. The route itself is a single 8 ms query. Cause 2. |
| 2 | `GET /api/reels/overview` | 1299 / **1500** | 1831 | 43 stmts, 1330 ms | **DB, JIT**: `loadSlates` (archive slates, 132 rows) takes 1216 ms, almost all JIT compile, from two correlated `idea_sources_v` reads per row. Everything else is about 115 ms. |
| 3 | `GET /trello` (page) | 1278 / **1457** (TTFB 95) | 1464 | 21 stmts, 617 ms | **Payload plus server JS**: 21 parallel whole-table reads (activity alone is 30 000 rows and 47 ms), shaped in JS and serialized as 15.8 MB of RSC/HTML. Lighthouse: FCP 8.2 s, LCP 9.4 s. The skeleton streams at 95 ms (heavy page). |
| 4 | `GET /social/analytics/cost` (page) | 527 / **859** | 2008 | 46 stmts, 266 ms | **Serial reads plus JS**: 8 awaits in a row (ledger, run stages, dataset, waste sets, cache rows, watches, readiness), then full ledger allocation in JS on every request. Cold also rebuilds the hub dataset. |
| 5 | `GET /api/send-queue` | 668 / **807** | 808 | 6 stmts, 224 ms | **Payload**: the main query returns 8289 rows (143 ms), the JS buckets items per day (O(days × items)), and 9.4 MB of JSON. The synthetic seed fills optional text columns, so production rows are smaller. |
| 6 | `GET /api/content-type/run-today` | 642 / **770** | 1114 | 103 stmts, 1032 ms | **Uncached work**: `livePlan()` calls `loadDataset()` directly, so it re-reads every vertical **and** re-reads and re-allocates the full cost ledger, which the plan never uses. It also reads `slot_source` 8× (repeated settings read). |
| 7 | `GET /social/content/library/music` (page) | 328 / 468 | 562 | 3 stmts, 20 ms | **Render/serialization**: 800 rows in 1.9 MB of HTML. SQL is 20 ms. Lighthouse TBT 4.5 s, LCP 6.2 s (800 native audio players to lay out). |
| 8 | `GET /api/analytics/summary` | 366 / 447 | 578 | 25 stmts, 431 ms | **Serial awaits**: 8 steps in 3 dependency levels. The largest single statement is lead-spend facts at 128 ms. |
| 9 | `GET /carousels` (page) | 143 / 447 | 1089 | 7 stmts, 42 ms | **Tail = hub rebuild contention** (p50 143). Cold = dataset rebuild. Lighthouse JS 237 KB. |
| 10 | `GET /ai-events` (page) | 88 / 443 | 137 | 4 stmts, 23 ms | Same tail cause as #9. |
| 11 | `GET /api/analytics/drilldown` | 289 / 372 | 487 | 23 stmts, 397 ms | Serial window and aggregate reads, 23 statements. |
| 12 | `GET /morning-download` (page) | 256 / 306 | 1489 | 4 stmts, 21 ms | 1.07 MB of HTML (frames and pool), and the cold dataset rebuild. Lighthouse TBT 549. |
| 13 | `GET /explainers` (page) | 180 / 247 | 307 | 9 stmts, 48 ms | Render; Lighthouse TBT 1050, JS 238 KB. |
| 14 | `GET /api/campaigns/[id]/outreach-stats` | 202 / 237 | 310 | 3 stmts, 146 ms | **DB, JIT**: 14-day series with 2 correlated counts per day takes 161 ms, of which 160 ms is JIT. `email_send_queue` has **no index led by `campaign_id`**. |
| 15 | `GET /api/campaigns` | 190 / 223 | 227 | 1 stmt, 132 ms | **DB**: 7 per-campaign subplans × 47 campaigns. The send-queue lateral scans the owner-led index without the owner key (0.7 ms × 47). JIT is 54 ms. |

Also over the 150 ms API server target, but within 500 ms: `/api/hub/warm` (167), `/reels/analytics` page (198 total).

## Browser (Lighthouse, mobile, Fast 4G, 4x CPU)

| Page | LCP | TBT | JS KB | Note |
|---|---|---|---|---|
| `/hub/queue` | 17 423 | 108 | 229 | waits on the 9.4 MB `/api/send-queue` (uncompressed locally) |
| `/trello` | 9 430 | 222 | 255 | 15.8 MB document; FCP 8.2 s |
| `/social/content/library/music` | 6 222 | 4 506 | 175 | 800 rows with native audio players |
| `/hub`, `/hub/analytics`, `/hub/inboxes` | 2 169–2 553 | 384–418 | 229 | client waterfall: hydrate, then fetch the API, then render |
| `/explainers`, `/field-notes` | 1 745–1 832 | 1 037–1 050 | 230–238 | heavy hydration of the content-type pool screen |

## Not slow (for the record)

Every other measured route is within budget warm. 74 of 95 are under 150 ms warm p95, including the dashboards, SEO, traffic, events, campaign pages, conversations and the Stories APIs. Static assets already get `immutable` caching and compression. HTML is `private, no-store`, which is correct for per-user pages.
