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
