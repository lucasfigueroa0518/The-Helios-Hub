# perf/: measuring and guarding page and API speed

Budgets, how to run the measurements, how to read the output, and how to add a route.
The method is in `PROFILE.md`. The results and every change are in `REPORT.md`.

## Budgets (playbook section 0)

| What | Budget | Checked by |
|---|---|---|
| Page server response | warm p95 TTFB ≤ 150 ms, full HTML ≤ 500 ms | `perf/lib/check-budgets.mjs` (CI) |
| API route | warm p95 ≤ 500 ms (server target ≤ 150 ms) | `perf/lib/check-budgets.mjs` (CI) |
| Initial JS per route | ≤ 150 KB gzipped, **including layouts** (documented exceptions in `budgets.json`) | `perf/lib/bundle-sizes.mjs --check`, `size-limit` (CI) |
| Lighthouse server response | ≤ 150 ms; LCP, TBT and CLS are warnings | `lighthouserc.js` (CI) |

All budgets live in `perf/budgets.json`. A route with no entry gets the defaults. A route that can't meet the default has its own entry, set a little above its current number so it can't get worse, and is listed under "still over budget" in `REPORT.md`.

> `next build` prints "First Load JS" **without the root layout's chunks**. For this app that hides about 20–55 KB on every signed-in page. Use `node perf/lib/bundle-sizes.mjs` for the real number.

## Run it locally

```bash
# once per machine: Postgres 16 with the full schema (loopback only)
perf/db/setup-local.sh
source perf/env.sh
node perf/db/seed.mjs            # ~0.6 M synthetic rows (perf/db/volumes.json); --scale 0.5 for a faster run
node perf/db/seed-fixtures.mjs   # perf user, realistic JSON shapes, tokens -> perf/db/seed-ids.json
npx tsx perf/db/seed-shapes.ts   # documents built with the app's own helpers (health reports, ...)

# production build (type-check needs a bigger heap than Node's default)
NODE_OPTIONS=--max-old-space-size=6144 npm run build

# full run: 30 warm + 30 cold cycles + SQL trace + Lighthouse  (~1.5 h)
node perf/measure.mjs --out mytest
# quick run on a few routes
node perf/measure.mjs --out quick --runs 10 --phases warm,trace --only "page:/hub,api:GET:/api/campaigns"
node perf/lib/analyze.mjs mytest     # perf/runs/mytest/ranking.md + slow-queries.md
node perf/lib/bundle-sizes.mjs       # true first-load JS per page
```

`perf/env.sh` only points at the local database. It sets stub modes and **no API keys**, so nothing a measurement does can reach Claude, `web_search` or any paid API (CLAUDE.md Rule 1). Never point it at Supabase.

## Reading the output

- `perf/<out>.md`: one row per route with warm TTFB p50/p95, warm total p50/p95/p99, cold p95, SQL statements per request (warm/cold), LCP, TBT, JS KB, and the verdict.
- `perf/runs/<out>/trace-summary.json`: per route, the statement count, SQL time, the five slowest statements, and any statement repeated more than 5 times in one request (an N+1).
- `perf/runs/<out>/pg_stat_statements.json`: every statement over the whole run, with mean time and **JIT time** (Postgres JIT dominated several of the slowest queries; see REPORT).
- `perf/runs/<out>/server.log`: the app's structured logs, including `dataset_rebuild` and `dataset_serve` for the Social Hub cache.

## Adding a route to `routes.json`

1. Add an entry: `id` (`page:/path` or `api:METHOD:/path`), `kind`, `method`, `path`, `file`, `auth`, `sideEffects`.
2. Set `measure: true` only if a GET has no side effects beyond trivial telemetry, needs nothing outside the local DB, and **cannot spend money**. Otherwise set `measure: false` with a `measureReason`.
3. Give it a `sample.path` (plus `query`, `headers`, `body` if needed). `{placeholders}` are filled from `perf/db/seed-ids.json`. If you need a new one, pick it in `perf/db/seed-fixtures.mjs`.
4. If it can't meet the default budget, add it under `latency.routes` in `budgets.json` and explain why in `REPORT.md`.

## The local data is synthetic

`perf/db/volumes.json` is an estimate (DECISIONS D2). To match production, run the read-only `perf/db/rowcounts.sql` against production and copy the counts in.
