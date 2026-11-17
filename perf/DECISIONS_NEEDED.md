# Decisions needed from a human

Items that need infra access, money, a product call, or a security call. Work continued around each one.

## D1. Confirm the Vercel function region matches the Supabase region (Phase 5)

- **Why**: every query is a network round trip to the Supabase pooler. Same-region costs about 1–5 ms. Cross-region costs about 50–150 ms **per query**, and pages here issue 3–40 queries (see `perf/BOTTLENECKS.md`). That would swamp every code fix in this branch.
- **What we know**: the workers run in GCP `us-west1-a`. Nothing in the repo pins the Vercel function region. Vercel's default is `iad1` (US East). The Supabase project region isn't in the repo.
- **Ask**: in Vercel → Project → Settings → Functions, check the region. In Supabase → Project Settings → General, check the region. If they differ, either set the Vercel function region to the Supabase region (one line in `vercel.json`: `"regions": ["<region>"]`) or accept the cost. I didn't add `vercel.json`, because guessing the region could make things worse.

## D2. Real production row counts for the perf seed

- **Why**: the local seed volumes (`perf/db/volumes.json`) are estimates. Pages whose cost grows with row count (Trello, Social Hub, campaign lists) are only as representative as those counts.
- **Ask**: run `psql "$DATABASE_URL" -X -A -F, -f perf/db/rowcounts.sql`. It is one read-only transaction and safe on the pooler. Paste the output into `perf/db/volumes.json`, then rerun `perf/db/seed.mjs`.

## D3. Shared cache (Redis/Valkey): not added

- **Why**: the app runs on Vercel serverless, so an in-process LRU is per isolate and cold on every new isolate. The existing Next Data Cache (`unstable_cache`) is already shared across isolates on Vercel, and this branch builds on it. A dedicated Redis (for example Upstash) would be a new paid service.
- **Ask**: none needed unless you want sub-10 ms reads for per-user data. Not recommended right now.

## D4. Security findings outside the performance scope

Not changed here, because the playbook forbids behavior changes in this branch. Each needs an owner.

1. **A committed env backup**: `.env.local.bak.1790223134` is tracked in git. `.gitignore` covers `.env.local` and `.env.*.local` but not `.env.local.bak.*`. I didn't open the file (playbook rule 4). If it holds real values, rotate them, remove the file from git history, and add `.env*.bak*` to `.gitignore`.
2. **Smartlead webhook is unreachable**: `/api/webhooks/smartlead/[token]` is not in `middleware.ts` `isPublicPath`, so middleware returns 401 to Smartlead before the route's own token check runs. If Smartlead events are expected, add the prefix to `isPublicPath`.
3. **Pages outside the middleware matcher**: `/carousels`, `/field-notes`, `/last-few-days`, `/ai-events` and `/personality` are listed in `isProtectedPage` but missing from `config.matcher`, so middleware never runs for them. Each page does check the session itself, so this isn't open access today. Add them to the matcher for defense in depth.

## D6. Check whether Postgres JIT is on in production (Supabase)

- **Why**: in the local profile (Postgres 16, default `jit = on`), the campaign list query spends **39 ms of its 152 ms compiling JIT code** (`EXPLAIN ANALYZE` → `JIT: Emission 34 ms`). Every plan whose cost is over `jit_above_cost` (100 000) pays this, which includes the campaign list, analytics, and hub dataset reads. Upstream PostgreSQL has since changed the default to off, and the commit notes that most large deployments already turn it off.
- **Ask**: run `psql "$DATABASE_URL" -X -c "BEGIN READ ONLY; SHOW jit; ROLLBACK;"`. If it says `on`, consider `ALTER DATABASE postgres SET jit = off;` (reversible with `RESET`). That is a database-wide setting, so it's your call. `perf/REPORT.md` has the measured effect of JIT on the local profile. All code changes in this branch were measured with JIT **on**, the same as the baseline.

## D7. Serve the brand font as WOFF2 (licensing check)

- **Why**: `app/fonts/PragmaticaExtended-Bold.otf` is 244 KB (about 105 KB gzipped on the wire), and `next/font` preloads it on **every** page for one title. A lossless WOFF2 conversion of the same file keeps all 707 glyphs and every table, and is **79 KB**. Turning the preload off instead is no good: LCP got worse by up to 476 ms (`perf/experiments/font-preload.json`), so the bytes are what has to shrink. A Latin-only subset would be smaller still.
- **Why it's your call**: the font is ParaType's commercial Pragmatica. Its license URL is `paratype.com/eula`, and its embedding flags allow preview and print embedding only. Some desktop EULAs forbid format conversion or subsetting, and web use may need a web license. I didn't convert it.
- **Ask**: confirm the Helios license covers web embedding and WOFF2 conversion (and subsetting, if wanted). If yes, the change is: convert with `fonttools` (`TTFont(...).flavor = 'woff2'; save`), add `app/fonts/PragmaticaExtended-Bold.woff2`, and point `localFont({ src })` in `app/layout.tsx` at it. About 165 KB less of the uncompressed file on each first visit.

## D8. Deploy steps after merging (I did not run these)

1. **Index migration**: `psql "$DIRECT_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/perf_2026_11_17_indexes.sql`. It is additive, `CREATE INDEX CONCURRENTLY`, so writes are not blocked. The rollback is `db/perf_2026_11_17_indexes_down.sql`. Without it, the campaign-list rewrite still returns the same rows, but its query stays near 127 ms instead of 56 ms.
2. **Worker sync (CLAUDE.md)**: the workers import files changed here. `lib/db.ts` gets slow-query logging. `lib/campaigns.ts`, `lib/auto-campaigns/*` and `lib/inboxes/capacity.ts` give the same results, faster. `lib/reels/scoring/store.ts` and `lib/stories/storage.ts` give the same results, with the storage timeout defaulting to 60 s as before. Redeploy `helios-orch-worker` with `./scripts/gcp/deploy-worker-code.sh` and `helios-social-worker` with `./scripts/gcp/deploy-social-worker.sh` in the same session as the merge.
3. **Slow-query log volume**: workers run batch queries that can legitimately exceed 100 ms. If `db/slow_query` lines are too noisy in the VM journal, set `DB_SLOW_QUERY_MS=500` (or `0` to turn it off) in the worker env. Leave the web app at the default of 100.

## D5. Production APM

- The app has structured logs and `Server-Timing`, but no tracing backend. Sentry Performance or Datadog would give real p95 per route in production, but both are paid. Vercel's built-in Speed Insights and Observability are the cheapest options. Your call.
