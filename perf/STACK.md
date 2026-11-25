# Stack (Phase 1 discovery, 2026-11-17)

## Summary

| Layer | What it is | Where it's configured |
|---|---|---|
| Frontend framework | Next.js **15.5.25**, App Router, React **19** (server components + client islands) | `package.json`, `app/` |
| Bundler | **webpack** (Next default for `next build`); SWC transpiler | `next.config.ts` |
| Styling | Tailwind CSS 3.4 (scoped to `.helios-ui`), plus about 250 KB of hand-written global CSS in `app/*.css` | `tailwind.config.ts`, `app/*.css` |
| UI libraries | Radix UI primitives, `lucide-react` (111 files), `framer-motion` 11 (26 client files), `@dnd-kit` (5 client files), `react-colorful` | client components |
| Backend | Next.js route handlers (`app/**/route.ts`, Node runtime) and server components; durable workers run outside Vercel on GCP VMs (`scripts/*_worker.ts`) | `app/api`, `scripts/gcp/*.service` |
| Database | Postgres (Supabase), about 250 tables across 20 schemas (`outreach`, `social`, `social_hub`, `reels`, `boards`, `dashboards`, …) | `db/*.sql` |
| DB access | Raw SQL via `pg` 8 (no ORM). Shared per-process `Pool` plus an in-process concurrency gate (`lib/db.ts`); connect retries; Vercel pool max 3 | `lib/db.ts` |
| Connection mode | Supabase **transaction pooler** (:6543) at runtime; session pooler (:5432) for scripts | `.env.example`, `lib/db.ts` |
| Auth | Auth.js v5 (`next-auth@5 beta`), Google provider, **JWT session** (no DB read per request); middleware gates `/api/*` (401) and listed pages (redirect) | `auth.ts`, `auth.config.ts`, `middleware.ts` |
| Cache layer | No Redis/Valkey. Next **Data Cache** (`unstable_cache`) for the Social Hub dataset, costs, libraries, progress (60 s/600 s TTL, tag invalidation via `revalidateTag`); React `cache()` per request; in-process stale copies on DB connect timeout | `lib/social-hub/views/cached-*.ts` |
| Rendering | 176 routes declare `force-dynamic`; nearly every page is per-request SSR; 16 `loading.tsx` shells stream skeletons | `app/**/page.tsx` |
| Fonts | `next/font/google` Roboto (4 weights, self-hosted at build) and local `PragmaticaExtended-Bold.otf` | `app/layout.tsx` |
| Images | 31 raw `<img>` tags, 3 `next/image`; most media are signed Supabase Storage URLs or proxied through API routes | components |
| Third-party scripts | None (no analytics, tag managers, or chat widgets) | — |
| Observability | Structured JSON logs (`lib/observability/*`), `Server-Timing` hook for hub pages, request telemetry; no APM vendor | `instrumentation.ts` |
| Hosting | **Vercel** for the web app (no `vercel.json`; defaults). Workers on **GCP** Compute Engine VMs in `us-west1-a` (`helios-orch-worker`, `helios-social-worker`) | `docs/gcp-e2-micro-worker.md` |
| CDN | Vercel Edge Network (implicit). No custom CDN config in the repo | — |
| CI | **None**. No `.github/workflows` | — |
| Tests | `node:test` via `tsx --test tests/*.test.ts` (550 files, offline, model stubbed) | `package.json` |

## Notable existing performance work (git history)

- `7b298a0` cut DB connect storms: connect retries, Vercel pool cap 3, a query gate, and hover warm-up through `/api/hub/warm`.
- `67c8b95` stopped Social Hub pages from rebuilding on every visit: per-type data-cache entries and `loading.tsx` shells.
- `7b61ac3` stopped pages from stacking slow reads: polls wait for the previous request, and independent queries run in parallel.
- The Social Hub dataset is gzipped into the Data Cache, because the raw dataset (about 3 MB) exceeded the 2 MB entry limit.

## Constraints that shape this audit

- **CLAUDE.md Rule 1 / Rule 2**: no live Claude, `web_search`, or other paid API calls from automated runs. Every route that can start enrichment, generation, rendering, or sending is excluded from load measurement (`measure: false` in `routes.json`, with the reason).
- **Secrets**: no `.env.local` exists in this environment. Measurement uses `perf/env.sh`: a local Postgres URL, a throwaway `AUTH_SECRET` generated per machine, stub modes, and no API keys.
- Production data is not reachable from here (and must not be used). Measurements run against a local Postgres 16 that has the full schema applied (`perf/db/setup-local.sh`) and synthetic seed data (`perf/db/seed.mjs`).
- Docker has no daemon in this container, so the Jaeger exporter step is replaced by an in-process SQL tracer (`perf/lib/pg-trace.cjs`). See `perf/LOG.md`.
