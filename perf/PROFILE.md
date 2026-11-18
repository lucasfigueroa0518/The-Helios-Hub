# Standard test profile

Every number in `baseline.json`, `final.json` and `REPORT.md` comes from this profile. Change it only on purpose, and re-baseline if you do.

## Server under test

- **Production build**: `next build` then `next start` (never `next dev`). `perf/measure.mjs` starts and stops the server itself.
- **Machine**: the agent container. 4 vCPU, 15 GB RAM, Linux, Node 22.23. Absolute numbers on a Vercel function will differ. Before/after deltas on this machine are what each change is judged by.
- **Environment**: `source perf/env.sh`. It sets a local `DATABASE_URL`, a throwaway `AUTH_SECRET` generated per machine, `EXTRACTION_MODE=stub` and `DRAFTING_MODE=stub`, and no API keys. With no keys set, no request can reach a paid API (CLAUDE.md Rule 1).
- **Auth**: a signed Auth.js session cookie for the seeded user `perf.tester@heliosgroup.ai` (`perf/lib/session.mjs`). Protected pages and APIs are measured signed in, the way people use them.

## Database

- **Postgres 16.15**, local cluster (`perf/db/setup-local.sh`), the full schema from `db/*.sql` plus a Supabase shim (`perf/db/supabase-shim.sql`: roles and the `storage` schema). `pg_stat_statements` is on.
- **Data volume**: a synthetic seed (`perf/db/seed.mjs`, volumes in `perf/db/volumes.json`). It is about 0.8 M rows across 228 tables, sized to roughly a year of use by a small team: 30 K leads, 15 K drafts, 4 K Trello cards, 3 K Social Hub items, 120 K SEO rows, and so on. Seeded rows are deterministic, so runs are comparable. On top of that, `perf/db/seed-fixtures.mjs` writes realistic JSON shapes into the hot tables, so pages run their real rendering paths.
  - *Caveat*: production row counts are unknown from here. `perf/db/rowcounts.sql` is a read-only query (one `BEGIN READ ONLY … ROLLBACK`, safe on the pooler per CLAUDE.md). Run it against production and paste the counts into `volumes.json` to make the seed match production.
- **Network distance to the DB**: production talks to Supabase over the network, and a local socket hides the cost of every round trip. The harness runs Postgres behind `perf/lib/latency-proxy.mjs`, which adds **2.5 ms each way (5 ms RTT)**. That is a typical same-region round trip to a pooled Supabase connection. N+1 queries and serial awaits therefore cost what they cost in production. The setting is recorded in each result file as `dbOneWayMs`.
- **Pool settings**: the proxy listens on port **6543** and the server runs with `VERCEL=1`, so `lib/db.ts` picks exactly what production picks: transaction mode, at most 3 clients per process, plus its query gate.
- **Warm DB**: the seed ends with `ANALYZE`, and shared buffers hold the working set. Postgres is not restarted between cycles. Only the app server is.

## HTTP timing (all measured routes)

- Sequential requests (concurrency 1), new TCP connection each time, `accept-encoding: identity`.
- **TTFB** = time to response headers. **Total** = time to the last body byte. For streamed pages (`loading.tsx` / Suspense), TTFB is the shell and total is the finished document.
- **Warm**: one server process, 3 warm-up requests, then **30 runs** per route. p50, p95 and p99 are recorded.
- **Cold**: **30 cycles**. Each cycle starts a fresh `next start` process with the Next data cache (`.next/cache/fetch-cache`) deleted, then sends one request per route in shuffled order. This is a cold start of the process and of the data cache, which is what a new Vercel isolate sees.
- **Trace pass**: one cold and one warm request per route with `perf/lib/pg-trace.cjs` preloaded. It records SQL statement count, SQL time and repeated statements (more than 5 of the same statement in one request is an N+1 signal).

## Browser metrics (page routes)

- Lighthouse 13.6 in headless Chromium 1243 against the warm server, mobile form factor.
- **Throttling**: DevTools method, **4x CPU slowdown**, Chrome's **"Fast 4G"** preset (165 ms request latency, 8.1 Mbps down, 1.35 Mbps up).
- Recorded: LCP, FCP, TBT (the lab stand-in for INP, which needs real interaction), CLS, Speed Index, JS transferred, and total bytes.

## Budgets (playbook section 0)

| Metric | Budget | How it's judged |
|---|---|---|
| Page server response | TTFB ≤ 150 ms, full HTML ≤ 500 ms | warm p95 |
| API route | ≤ 500 ms end to end; server target ≤ 150 ms | warm p95 |
| Initial JS per route | ≤ 150 KB gzipped | `next build` "First Load JS" |
| Cold start | recorded and reported, flagged when p95 > 500 ms | cold p95 |

A route **meets budget** when its warm p95 is inside the limits above. Heavy pages that stream (a shell with skeletons in budget, with data arriving after) are flagged in `REPORT.md` with TTFB as the budgeted number.
