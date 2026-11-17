# Perf log

What was tried, what was measured, what was kept. Newest last.

## Setup (Phase 1–2)

- **Branch**: the playbook asks for `perf/overhaul`. This session can only push to `claude/eloquent-ramanujan-po7kia` (a platform rule), so all work and commits are on that branch. The PR is opened from that branch.
- **No CI existed** (no `.github/`). There was no `.env.local` in the container, and per CLAUDE.md I did not read the committed `.env.local.bak.*` (see DECISIONS D4.1).
- **Local DB**: Postgres 16 with all 45 `db/*.sql` files plus a Supabase shim (`perf/db/setup-local.sh`). `drafting_cost_persistence.sql` needs `-v drafting_data_schema=outreach -v drafting_function_schema=public`. `field_notes_schema.sql` depends on `media_library_schema.sql`, so it is ordered after it.
- **Build**: `next build` failed twice before succeeding:
  1. A transient `next/font/google` fetch error during the build (the same fetch worked in isolation, and a retry passed).
  2. The type-check step ran out of memory at Node's default heap of about 2 GB. `NODE_OPTIONS=--max-old-space-size=6144` fixed it. Vercel builders have 8 GB, so this only matters for local and CI builds. CI sets it explicitly.
- **Jaeger/OpenTelemetry**: skipped. There is no Docker daemon in the container, and the app aliases `@opentelemetry/api` to Next's compiled copy, so adding the SDK would fight that alias. I replaced it with `perf/lib/pg-trace.cjs`, a preload that attributes every SQL statement to the HTTP request that issued it (AsyncLocalStorage). It gives query count, SQL time and repeated statements per request, which is what the traces were for.
- **Seed**: `perf/db/seed.mjs` is schema-driven. It reads FK order, CHECK lists, regex CHECKs and unique keys from the catalog, and inserts about 0.8 M rows across 228 tables. The first pass exposed realism bugs that the measurements would have inherited:
  - Nullable tombstones (`deleted_at` and similar) were filled at random, so most rows looked deleted. They are now null for about 92% of rows.
  - JSON columns got `{}` where the hub expects arrays, and `idea_ref` got text where the reels read expects a UUID. Five of the ten Social Hub types failed to read. Since a dataset with errors is **never cached**, every hub page rebuilt the full dataset on every request (about 1.1 s each, `partial_read` in the log). `perf/db/seed-fixtures.mjs` now writes the real shapes (slides, slide objects, stories, cities, song shortlists) and links the spine (content item → native post → schedule → attempt → insights). All ten types now read without errors.
- **Harness fidelity**: the proxy runs on port 6543 with `VERCEL=1`, so `lib/db.ts` picks production's pool (transaction mode, max 3, query gate). There is 2.5 ms of one-way DB latency.
- **Baseline caveat**: during cold cycles ~25–26 of the baseline (of 30), a full-project `tsc --noEmit` ran in a scratch worktree on the same 4-vCPU machine. CPU contention may inflate cold p95 for routes sampled in those cycles. Warm, trace and Lighthouse phases were unaffected. The final run (`perf/final.json`) was measured without contention, so cold before/after deltas lean in the baseline's favor (conservative).
- **First full baseline lost**: Lighthouse threw an uncaught Chrome protocol error ("Session closed") on `/hub/queue`, and the harness only wrote results at the end. The fixes: every phase now writes `perf/runs/<out>/<phase>.json` as it finishes, each Lighthouse run has a 120 s timeout and one retry with a fresh Chrome, a process-level guard logs stray protocol errors instead of exiting, and `--lh-max-wait 20000` caps the network-idle wait (pages that poll never go idle). The baseline was rerun on the same, untouched baseline build. The trace phase from the first run was reused, then re-captured after the data fix below.
- **Seed fix during the rerun**: the generic seeder had excluded 358 of 400 runs from analytics, which put a 13 K-element lead-ID array into every analytics query. Production excludes a handful of test runs. It was corrected to 8 before any analytics route was measured in the rerun: summary 976 → 447 ms and drilldown 912 → 371 ms are the effect of the data, not of any code change.

## Phase 2 findings (evidence in BOTTLENECKS.md and slow-queries.md)

- **Postgres JIT dominates several of the slowest statements**: reels `loadSlates` spends 626 of 631 ms compiling JIT code, outreach-stats 160 of 161 ms, campaign list 54 of 143 ms, hub reel facts 85 of 94 ms, and reels analytics 55 of 56 ms. In each case, correlated subqueries over the recursive `reels.idea_sources_v` view (or per-day correlated counts) inflate the planner's cost past `jit_above_cost` and the optimize/inline thresholds. The code fixes rewrite these into set-based queries, which win whether JIT is on or off. Whether production runs JIT is DECISIONS D6.
- **N+1**: `lib/content-type/progress.ts` runs a "typical duration" query per in-flight item; it depends only on the series or run kind.
- **The Social Hub dataset is one ~2 MB data-cache item away from never caching**: at 3.05 MB packed (first seed), Next refused it and every hub page rebuilt it (4–5 s). Production is about 230 KB per the code comments, so there's headroom, but the failure is silent. See REPORT.
- **Pool starvation**: a background hub-dataset rebuild (about 80 queries) takes all 3 per-isolate pool slots; a one-query API on the same process went from p50 16 ms to p95 3.5 s and p99 8.4 s.
- **Duplicate reads in a cold rebuild**: the three Stories-format types each re-read the same Stories engine (about 0.4 s of SQL).
- **Sequential awaits**: the analytics summary has 8 steps in a row (3 dependency levels), and the cost page has 8 steps in a row (all independent after one).
- **Uncached work on a GET**: `/api/content-type/run-today` re-reads and re-allocates the entire cost ledger, which the plan never uses.
- **Payloads**: `/trello` sends 15.4 MB of HTML (the entire workspace, including 30 K activity rows), `/api/send-queue` sends 9.2 MB of JSON, and the music library sends 1.9 MB of HTML (800 rows).
- **Frontend**: Next's "First Load JS" leaves out the root layout's chunks. Every signed-in page carries about 57 KB more than reported, including framer-motion (37 KB gz), which only the sidebar's mobile drawer uses. `@anthropic-ai/sdk` (16 KB gz) is shipped to `/campaigns/[id]/draft` and `/prospect` through a pure helper's module. The brand font is a 244 KB OTF, preloaded on every page and downloaded **twice** on dashboards pages.
- **Measurement tools are not devDependencies.** Adding them changed `package.json` and `package-lock.json`, which broke `tests/social-hub-scope.test.ts`. That test pins both files' hashes on purpose (the baseline is in `planning/Social Hub/scope-baseline.json`). Both files are back to their originals, and `perf/tools.sh` installs the pinned tools with `npm install --no-save`. I dropped autocannon: `perf/measure.mjs` and `perf/lib/contention.mjs` do the timing and load work themselves.

## Phase 3 (backend), measured on Build A (perf/build-a.json) plus function-level A/B benchmarks

Kept (one commit each, numbers in the commit messages and REPORT.md):

1. progress N+1, memoized per key: with a 40-set backlog, 51 → 14 queries and 111 → 28 ms. Unchanged with realistic data.
2. reels `loadSlates`, set-based: `/api/reels/overview` warm p95 1500 → 122 ms. The statement went 632 → 5 ms (it had been 627 ms of JIT).
3. outreach-stats daily series, grouped reads: warm p95 237 → 49 ms.
4. analytics summary in two waves: warm p95 447 → 260 ms.
5. cost page in one wave: warm p95 859 → 320 ms.
6. run-today uses the cached cost part: warm p95 770 → 530 ms, 103 → 89 queries.
7. render-path signing timeout of 1.5 s: against a 5 s Storage stub, 5040 → 1505 ms.
8. one Stories read per rebuild: full cold rebuild 888 → 522 ms (function benchmark).
9. reel facts headline read once: statement 92 → 18 ms with JIT gone. Rebuild wall time is unchanged (it runs off the critical path); kept for DB CPU.
10. single-flight hub rebuild: under burst load, rebuilds 25 → 3 in 3 minutes and probe p99 1296 → 118 ms. The probe's p50 moved 20 → 55 ms only because of the shared 250 ms cadence; with an offset cadence (237 ms) it is 18.5 ms, the same as no load.

Reverted:

- **Index `email_send_queue (campaign_id, status, schedule_date)`**. The planner used it (the per-campaign probe went 0.28 → 0.014 ms × 47), and the campaign-list statement got about 20% faster under `EXPLAIN ANALYZE`. But back to back, 40 runs each, the routes didn't improve: `/api/campaigns` p50 128 ms without versus 132 ms with, and outreach-stats p50 44 versus 46 ms. JIT (39 ms) and the other per-campaign subplans dominate. Rule 2: dropped. The migration was never committed, and the local DB has it rolled back.
- **Hub-read cap** (hub reads limited to pool size − 1, so one slot is always free): measured after single-flight. Probe tail under a burst improved modestly (p99 ≈118 → 97 ms, max 592 → 491 ms; `perf/experiments/contention-burst-B-cap.json`). But a full cold rebuild got about 14% slower (median 522–533 → 603 ms, function benchmark), and users wait on that rebuild on a cold hub page. Single-flight already removed the cause (25 → 3 rebuilds). The remaining gain does not clearly beat the cost, so it was reverted.
- **Brand font `preload: false`** (Phase 4F, "preload the primary font only"): reverted. Lighthouse median of 3 (`perf/experiments/font-preload.json`): FCP improved by about 70 ms, and pages that never render the display face stopped downloading it (−105 KB on `/events`, `/seo`, `/hub/conversations`). But LCP got worse on every page tested, +476 ms on `/` where the greeting title is the LCP element. The real fix is a smaller file: lossless WOFF2 is 79 KB, against 244 KB for the OTF. That conversion is a licensing call (DECISIONS D7).

## Phase 3, continued, on Build C (perf/build-c.json)

- `businessDaysBetween` counts whole weeks instead of walking days. A CPU profile showed it was about half of `/api/send-queue`. Route warm p95 807 → 324 ms. Identical results on 51,992 date pairs.
- Campaign list: a bounced-count CTE plus the send-queue `campaign_id` index. Each alone did nothing at the route level (JIT kept firing); together the plan drops under `jit_above_cost`. Statement 157 → 56 ms, route warm p95 223 → 71 ms. The index came back as `db/perf_2026_11_17_indexes.sql`, with the rollback beside it.

## Phase 4 (frontend), on Build C and Build D (perf/build-c.json, perf/build-d.json; Lighthouse is the median of 3 for Build D)

- F1 LazyMotion in the sidebar: −27.5 KB gz of initial JS on every page; pages within 150 KB went from 0 to 40 of 55.
- F2 Anthropic SDK out of the client: `/campaigns/[id]/draft` 179 → 163 KB, `/prospect` 158 → 142 KB.
- F3 Trello view splitting: 255 → 229 KB. LCP is unmoved, because the document is the bottleneck.
- F4 hub streams campaigns: `/hub` LCP 2169 → 1785 ms, TBT 385 → 155 ms.
- F5 dashboards drop the duplicate font: −113 KB, `/dashboards` LCP 1141 → 657 ms.
- F6 `content-visibility` on stacked tables: music library LCP 6222 → 4290 ms, TBT 4506 → 3102 ms.
- F7 brand font `preload: false`: **reverted** (LCP worse; see above).
- Not done, by design: virtualizing the music list (it would mean a client component and different DOM), and Trello lazy-loading activity and comments (behavior change). Both are proposed in REPORT.
