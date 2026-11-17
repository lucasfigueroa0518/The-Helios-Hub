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

## D5. Production APM

- The app has structured logs and `Server-Timing`, but no tracing backend. Sentry Performance or Datadog would give real p95 per route in production, but both are paid. Vercel's built-in Speed Insights and Observability are the cheapest options. Your call.
