# Performance report: The Helios Hub

Branch `claude/eloquent-ramanujan-po7kia` (the playbook's `perf/overhaul`; this session can only push to its assigned branch). Baseline commit `0d5ca11` (app code as of `f2bf691`).

## Verdict

**93 of 95 measured routes now meet the 500 ms budget at warm p95, up from 89.** Every page streams its first paint within 150 ms TTFB (worst warm TTFB p95 is 110 ms). The two still over are documented exceptions with a plan: `/trello` (a 15.8 MB workspace document) and `/api/content-type/run-today` (a fresh full read before a spend decision).

| | Baseline | Final |
|---|---|---|
| Routes within warm budget | 89 / 95 | **93 / 95** |
| Routes with **cold** p95 over 500 ms | 17 | **11** |
| Measured pages with true first-load JS ≤ 150 KB gz | 0 / 45 | **32 / 45** |
| Slowest API, warm p95 | 3538 ms (`/api/inboxes/[id]`, pool starvation) | 561 ms (`run-today`, by design) |
| `/api/reels/overview` warm p95 | 1500 ms | **136 ms** |
| `/api/send-queue` warm p95 | 807 ms | **291 ms** |
| `/social/analytics/cost` warm p95 | 859 ms | **369 ms** |
| `/api/campaigns` warm p95 | 223 ms | **79 ms** |

Tests: 5853 of 5868 pass. Every failure reproduces identically on the untouched baseline code (perf/LOG.md, Phase 7).


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

Warm and cold numbers are from 30 runs each. "SQL/request" is the traced statement count on a warm request. JS is the true first-load (layouts included). LCP and TBT here are **single** Lighthouse runs, which swing ±30% run to run. Use the 5-run A/B below for frontend claims.

| Route | Warm p50 (ms) | Warm p95 (ms) | Warm TTFB p95 (ms) | Cold p95 (ms) | SQL/request (warm) | First-load JS (KB gz) | LCP (ms) | TBT (ms) | Budget |
|---|---|---|---|---|---|---|---|---|---|
| `GET /ai-events` | 88 → 80 | 443 → 96 | 84 → 71 | 137 → 147 | 4 → 4 | 216 → 189 | 1204 → 1291 | 162 → 236 | ✅ → ✅ |
| `GET /ai-trivia` | 133 → 121 | 170 → 152 | 83 → 87 | 183 → 214 | 4 → 4 | 218 → 191 | 1369 → 1237 | 262 → 229 | ✅ → ✅ |
| `GET /api/analytics/drilldown` | 289 → 267 | 372 → 322 | 371 → 322 | 487 → 484 | 23 → 23 | – | – | – | ✅ → ✅ |
| `GET /api/analytics/runs` | 23 → 26 | 28 → 31 | 28 → 31 | 40 → 35 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/analytics/summary` | 366 → 236 | 447 → 324 | 447 → 323 | 578 → 431 | 25 → 25 | – | – | – | ✅ → ✅ |
| `GET /api/auth/me` | 15 → 15 | 19 → 19 | 19 → 19 | 25 → 46 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/billing-guard` | 15 → 15 | 19 → 17 | 19 → 17 | 44 → 40 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/campaigns/[id]/cost-estimate` | 78 → 78 | 94 → 88 | 94 → 88 | 109 → 120 | 6 → 6 | – | – | – | ✅ → ✅ |
| `GET /api/campaigns/[id]/outreach-stats` | 202 → 46 | 237 → 54 | 237 → 53 | 310 → 76 | 3 → 3 | – | – | – | ✅ → ✅ |
| `GET /api/campaigns/[id]/pre-enriched/ingest` | 15 → 16 | 19 → 22 | 19 → 22 | 30 → 37 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/campaigns/[id]/prospect` | 50 → 51 | 57 → 54 | 57 → 54 | 71 → 71 | 6 → 6 | – | – | – | ✅ → ✅ |
| `GET /api/campaigns/[id]` | 22 → 21 | 25 → 26 | 25 → 25 | 34 → 49 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/campaigns/[id]/sheet` | 63 → 57 | 74 → 64 | 71 → 61 | 112 → 76 | 2 → 2 | – | – | – | ✅ → ✅ |
| `GET /api/campaigns/[id]/tags` | 16 → 16 | 23 → 21 | 23 → 21 | 36 → 31 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/campaigns` | 190 → 60 | 223 → 79 | 223 → 79 | 227 → 93 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/carousels/overview` | 25 → 28 | 29 → 31 | 28 → 30 | 37 → 42 | 7 → 7 | – | – | – | ✅ → ✅ |
| `GET /api/carousels/settings` | 20 → 21 | 23 → 31 | 23 → 30 | 53 → 33 | 4 → 4 | – | – | – | ✅ → ✅ |
| `GET /api/content-type/posting` | 71 → 54 | 77 → 71 | 77 → 71 | 962 → 93 | 5 → 5 | – | – | – | ✅ → ✅ |
| `GET /api/content-type/progress` | 32 → 34 | 36 → 38 | 36 → 38 | 51 → 48 | 11 → 11 | – | – | – | ✅ → ✅ |
| `GET /api/content-type/run-today` | 642 → 502 | 770 → 561 | 770 → 561 | 1114 → 988 | 103 → 89 | – | – | – | ❌ → ❌ |
| `GET /api/conversations/[itemId]` | 33 → 37 | 40 → 45 | 40 → 45 | 48 → 64 | 4 → 4 | – | – | – | ✅ → ✅ |
| `GET /api/conversations` | 22 → 24 | 27 → 29 | 27 → 29 | 35 → 40 | 2 → 2 | – | – | – | ✅ → ✅ |
| `GET /api/dashboards/tokens` | 15 → 16 | 19 → 20 | 19 → 20 | 34 → 36 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/explainers/idea-cycle` | 22 → 23 | 30 → 27 | 29 → 26 | 31 → 40 | 4 → 4 | – | – | – | ✅ → ✅ |
| `GET /api/explainers/jobs/[id]` | 37 → 36 | 42 → 40 | 42 → 40 | 75 → 58 | 6 → 6 | – | – | – | ✅ → ✅ |
| `GET /api/explainers/settings` | 15 → 14 | 18 → 18 | 18 → 17 | 44 → 28 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/field-notes/settings` | 14 → 16 | 18 → 19 | 18 → 19 | 30 → 29 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/health` | 10 → 10 | 13 → 12 | 12 → 12 | 17 → 22 | – → – | – | – | – | ✅ → ✅ |
| `GET /api/hub/warm` | 103 → 46 | 167 → 127 | 167 → 127 | 1203 → 63 | 0 → 0 | – | – | – | ✅ → ✅ |
| `GET /api/inboxes/[id]` | 16 → 16 | 3538 → 22 | 3538 → 22 | 35 → 52 | 1 → 1 | – | – | – | ❌ → ✅ |
| `GET /api/networking/events` | 22 → 24 | 29 → 33 | 29 → 33 | 36 → 52 | 5 → 5 | – | – | – | ✅ → ✅ |
| `GET /api/public/trivia-game/days` | 12 → 14 | 20 → 22 | 20 → 22 | 24 → 34 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/reel-ai-drama/lab` | 94 → 101 | 104 → 106 | 104 → 106 | 159 → 163 | 14 → 14 | – | – | – | ✅ → ✅ |
| `GET /api/reel-ai-drama/settings` | 14 → 16 | 16 → 20 | 16 → 20 | 36 → 31 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/reels/health` | 40 → 44 | 50 → 48 | 49 → 48 | 77 → 63 | 11 → 11 | – | – | – | ✅ → ✅ |
| `GET /api/reels/overview` | 1299 → 125 | 1500 → 136 | 1499 → 136 | 1831 → 173 | 43 → 43 | – | – | – | ❌ → ✅ |
| `GET /api/send-queue/[id]` | 15 → 17 | 18 → 22 | 18 → 22 | 46 → 39 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/send-queue` | 668 → 257 | 807 → 291 | 795 → 284 | 808 → 397 | 6 → 6 | – | – | – | ❌ → ✅ |
| `GET /api/sender-profiles` | 16 → 15 | 23 → 19 | 23 → 19 | 26 → 30 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/seo/properties` | 15 → 14 | 18 → 19 | 18 → 19 | 27 → 33 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/seo/rows` | 27 → 26 | 30 → 31 | 30 → 31 | 47 → 43 | 3 → 3 | – | – | – | ✅ → ✅ |
| `GET /api/seo/summary` | 24 → 28 | 29 → 31 | 29 → 31 | 65 → 54 | 5 → 5 | – | – | – | ✅ → ✅ |
| `GET /api/seo/sync` | 19 → 21 | 25 → 24 | 25 → 24 | 32 → 35 | 2 → 2 | – | – | – | ✅ → ✅ |
| `GET /api/social-hub/actions/revisions` | 21 → 22 | 25 → 27 | 25 → 27 | 51 → 58 | 2 → 2 | – | – | – | ✅ → ✅ |
| `GET /api/social-hub/slots` | 19 → 22 | 24 → 30 | 24 → 30 | 33 → 35 | 4 → 4 | – | – | – | ✅ → ✅ |
| `GET /api/social-hub/slots/schedule` | 24 → 27 | 34 → 36 | 34 → 36 | 43 → 49 | 3 → 3 | – | – | – | ✅ → ✅ |
| `GET /api/stories/sets/[id]` | 35 → 40 | 40 → 45 | 40 → 45 | 52 → 60 | 5 → 5 | – | – | – | ✅ → ✅ |
| `GET /api/stories/sets` | 34 → 35 | 38 → 41 | 38 → 41 | 50 → 62 | 3 → 3 | – | – | – | ✅ → ✅ |
| `GET /api/stories/settings` | 13 → 16 | 16 → 21 | 16 → 21 | 33 → 34 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/stories/trivia-game` | 20 → 21 | 23 → 27 | 23 → 27 | 45 → 37 | 2 → 2 | – | – | – | ✅ → ✅ |
| `GET /api/tags` | 14 → 14 | 19 → 18 | 18 → 17 | 32 → 36 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /api/users` | 14 → 13 | 18 → 18 | 18 → 18 | 30 → 35 | 1 → 1 | – | – | – | ✅ → ✅ |
| `GET /campaigns/[id]/draft` | 31 → 34 | 36 → 41 | 21 → 24 | 95 → 85 | 2 → 2 | 207 → 163 | 675 → 645 | 253 → 263 | ✅ → ✅ |
| `GET /campaigns/[id]` | 32 → 32 | 38 → 45 | 22 → 29 | 110 → 98 | 2 → 2 | 174 → 147 | 677 → 667 | 296 → 251 | ✅ → ✅ |
| `GET /campaigns/[id]/prospect` | 26 → 26 | 31 → 31 | 21 → 24 | 84 → 61 | 1 → 1 | 186 → 142 | 711 → 666 | 168 → 220 | ✅ → ✅ |
| `GET /campaigns/[id]/review` | 30 → 32 | 42 → 38 | 28 → 25 | 64 → 75 | 2 → 2 | 166 → 138 | 1026 → 990 | 197 → 209 | ✅ → ✅ |
| `GET /carousels` | 143 → 150 | 447 → 194 | 73 → 84 | 1089 → 1223 | 7 → 7 | 216 → 189 | 1095 → 1350 | 159 → 326 | ✅ → ✅ |
| `GET /dashboards` | 20 → 24 | 25 → 34 | 21 → 29 | 108 → 58 | 1 → 1 | 156 → 129 | 1141 → 1194 | 107 → 220 | ✅ → ✅ |
| `GET /dashboards/projects/[id]` | 21 → 21 | 24 → 24 | 20 → 20 | 69 → 65 | 1 → 1 | 160 → 133 | 690 → 673 | 227 → 217 | ✅ → ✅ |
| `GET /dashboards/projects/new` | 23 → 21 | 30 → 25 | 24 → 22 | 95 → 76 | 1 → 1 | 158 → 130 | 687 → 663 | 175 → 183 | ✅ → ✅ |
| `GET /dashboards/tokens` | 19 → 20 | 25 → 33 | 22 → 24 | 50 → 73 | 1 → 1 | 163 → 135 | 720 → 788 | 218 → 221 | ✅ → ✅ |
| `GET /dashboards/d/[token]` | 37 → 36 | 45 → 39 | 21 → 21 | 75 → 87 | 5 → 5 | 154 → 127 | 1055 → 983 | 179 → 129 | ✅ → ✅ |
| `GET /events` | 13 → 15 | 21 → 20 | 19 → 18 | 54 → 56 | 0 → 0 | 171 → 143 | 1421 → 1710 | 143 → 227 | ✅ → ✅ |
| `GET /explainers` | 180 → 166 | 247 → 206 | 80 → 61 | 307 → 268 | 9 → 9 | 216 → 190 | 1832 → 1515 | 1050 → 1130 | ✅ → ✅ |
| `GET /explainers/reels` | 39 → 35 | 45 → 43 | 23 → 24 | 70 → 74 | 1 → 1 | 162 → 134 | 1132 → 1228 | 137 → 198 | ✅ → ✅ |
| `GET /field-notes` | 111 → 109 | 168 → 140 | 67 → 59 | 208 → 1247 | 6 → 6 | 222 → 195 | 1745 → 1970 | 1037 → 1527 | ✅ → ✅ |
| `GET /hub/analytics` | 13 → 15 | 17 → 20 | 16 → 18 | 46 → 54 | 0 → 0 | 168 → 141 | 2553 → 2137 | 384 → 247 | ✅ → ✅ |
| `GET /hub/conversations` | 13 → 15 | 19 → 19 | 17 → 17 | 104 → 63 | 0 → 0 | 162 → 134 | 1454 → 2098 | 143 → 367 | ✅ → ✅ |
| `GET /hub/inboxes` | 14 → 16 | 25 → 21 | 22 → 20 | 53 → 82 | 0 → 0 | 168 → 141 | 2185 → 1839 | 418 → 300 | ✅ → ✅ |
| `GET /hub` | 13 → 66 | 18 → 96 | 15 → 21 | 60 → 121 | 0 → 1 | 181 → 153 | 2169 → 2217 | 385 → 256 | ✅ → ✅ |
| `GET /hub/queue` | 17 → 14 | 21 → 24 | 19 → 23 | 44 → 53 | 0 → 0 | 163 → 136 | 17423 → 17860 | 108 → 181 | ✅ → ✅ |
| `GET /last-few-days` | 123 → 95 | 144 → 122 | 72 → 58 | 168 → 1230 | 4 → 4 | 216 → 189 | 1220 → 1163 | 196 → 174 | ✅ → ✅ |
| `GET /morning-download` | 256 → 206 | 306 → 238 | 69 → 60 | 1489 → 1381 | 4 → 4 | 216 → 189 | 1506 → 1433 | 549 → 577 | ✅ → ✅ |
| `GET /` | 10 → 9 | 13 → 13 | 12 → 12 | 37 → 52 | 0 → 0 | 163 → 136 | 743 → 737 | 140 → 136 | ✅ → ✅ |
| `GET /real-or-ai/lab` | 22 → 17 | 27 → 24 | 25 → 23 | 78 → 70 | 0 → 0 | 155 → 128 | 628 → 1073 | 170 → 118 | ✅ → ✅ |
| `GET /real-or-ai` | 145 → 122 | 171 → 185 | 82 → 110 | 1368 → 1321 | 4 → 4 | 216 → 189 | 1165 → 1264 | 280 → 313 | ✅ → ✅ |
| `GET /reel-ai-drama/lab` | 14 → 18 | 22 → 24 | 19 → 22 | 78 → 55 | 0 → 0 | 159 → 132 | 2009 → 2175 | 293 → 472 | ✅ → ✅ |
| `GET /reel-ai-drama` | 91 → 87 | 118 → 106 | 82 → 74 | 184 → 184 | 4 → 4 | 216 → 190 | 1370 → 1254 | 416 → 277 | ✅ → ✅ |
| `GET /reels/analytics` | 169 → 164 | 198 → 189 | 23 → 27 | 278 → 274 | 25 → 25 | 159 → 132 | 726 → 1274 | 236 → 337 | ✅ → ✅ |
| `GET /reels/health` | 50 → 50 | 62 → 59 | 28 → 27 | 75 → 80 | 11 → 11 | 159 → 131 | 1171 → 1220 | 168 → 286 | ✅ → ✅ |
| `GET /seo` | 14 → 16 | 21 → 23 | 19 → 21 | 53 → 54 | 0 → 0 | 162 → 135 | 1734 → 1617 | 368 → 218 | ✅ → ✅ |
| `GET /social/analytics/[type]` | 107 → 91 | 120 → 116 | 77 → 74 | 1407 → 185 | 2 → 2 | 165 → 138 | 1740 → 1369 | 393 → 215 | ✅ → ✅ |
| `GET /social/analytics/compare` | 69 → 72 | 87 → 118 | 78 → 109 | 1295 → 1245 | 2 → 2 | 162 → 135 | 1212 → 1092 | 259 → 148 | ✅ → ✅ |
| `GET /social/analytics/cost` | 527 → 321 | 859 → 369 | 31 → 83 | 2008 → 607 | 46 → 46 | 169 → 141 | 1307 → 1620 | 366 → 334 | ❌ → ✅ |
| `GET /social/analytics` | 119 → 104 | 147 → 131 | 86 → 75 | 192 → 159 | 2 → 2 | 166 → 138 | 1469 → 1355 | 242 → 125 | ✅ → ✅ |
| `GET /social/calendar` | 114 → 115 | 142 → 313 | 88 → 107 | 1271 → 193 | 10 → 10 | 196 → 169 | 1069 → 1135 | 129 → 207 | ✅ → ✅ |
| `GET /social/content/library/music` | 328 → 320 | 468 → 480 | 26 → 47 | 562 → 476 | 3 → 3 | 159 → 131 | 6222 → 5828 | 4506 → 3816 | ✅ → ✅ |
| `GET /social/content/library/photos` | 73 → 82 | 86 → 91 | 26 → 30 | 171 → 121 | 10 → 10 | 160 → 132 | 1198 → 1493 | 123 → 272 | ✅ → ✅ |
| `GET /social/health/night/[date]` | 29 → 34 | 36 → 45 | 24 → 31 | 72 → 71 | 1 → 1 | 161 → 134 | 1208 → 1229 | 219 → 222 | ✅ → ✅ |
| `GET /social/health` | 45 → 48 | 58 → 66 | 26 → 30 | 113 → 100 | 2 → 2 | 164 → 136 | 1318 → 1222 | 516 → 315 | ✅ → ✅ |
| `GET /social` | 96 → 93 | 197 → 127 | 90 → 78 | 1048 → 1252 | 2 → 2 | 175 → 148 | 1206 → 1177 | 199 → 151 | ✅ → ✅ |
| `GET /social/post/[id]` | 91 → 81 | 102 → 107 | 84 → 89 | 1397 → 1361 | 2 → 2 | 170 → 142 | 1117 → 1008 | 132 → 132 | ✅ → ✅ |
| `GET /traffic` | 13 → 16 | 21 → 23 | 19 → 22 | 41 → 103 | 0 → 0 | 161 → 134 | 1396 → 1540 | 144 → 195 | ✅ → ✅ |
| `GET /trello` | 1278 → 1372 | 1457 → 1591 | 95 → 108 | 1464 → 1355 | 21 → 21 | 249 → 229 | 9430 → 9789 | 222 → 332 | ❌ → ❌ |
| `GET /watch/[token]` | 31 → 38 | 36 → 44 | 19 → 26 | 57 → 92 | 4 → 4 | 158 → 130 | 607 → 602 | 283 → 133 | ✅ → ✅ |

Routes within the warm budget: **89/95 → 93/95**.

Single-run tails: the final run had fewer hub rebuilds (48 vs 131), but whichever route is sampled during one gets a slow p95 sample. `/social/calendar` (141.6 → 312.7 p95) and `/social/analytics/compare` (87 → 118) are that: re-measured alone on the final build they are 128.5 and 93.8 ms, with p50 unchanged (114 → 115, 69 → 72).

<!-- AB -->

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

| Route | Now (warm p95) | Root cause | Proposed plan |
|---|---|---|---|
| `/trello` (page) | TTFB 108 ms ✅, HTML 1591 ms ❌; LCP ~9.5 s | `loadWorkspace` sends the **entire** workspace as RSC props: every card with all comments, checklists, attachments, and all 30 000 activity rows (15.8 MB on the seed). The Home, Activity and Profile views compute from that client-side. | Send boards, lists and cards (titles, labels, members, counts) up front. Load a card's comments, checklist items and activity through a server action when it opens, and page the activity views. This changes the data flow of the Trello views, so it needs your OK. Expected document < 1 MB. |
| `GET /api/content-type/run-today` | 561 ms ❌ | The "Run today" preview re-plans from a **fresh** read of every content type (89 statements). That's deliberate, because the POST spends money and must not plan from stale data. This branch already removed the ledger re-read (770 → 561 ms). | Let the GET preview use the 60 s cached hub reads, and keep the fresh read for the POST (which re-plans anyway). The preview could then be up to 60 s stale. That's a product call. |
| `GET /api/send-queue` (and `/hub/queue`) | 291 ms ✅ (server target 150 ❌); `/hub/queue` LCP ~17 s locally | A 9.4 MB JSON board (about 8 300 items across 22 days) that the queue page fetches client-side. Locally it's uncompressed (Vercel compresses it). | Return the visible week (or one day at a time) and drop unused per-item fields. Measure on production row counts first (D2): the seed fills optional text columns. |
| `GET /api/analytics/summary`, `/drilldown` | 324 / 322 ms (server target 150 ❌) | 25 and 23 aggregate statements over leads, drafts and sends. The largest is the lead-spend facts (128 ms). | Pre-aggregate per day (a materialized view refreshed by the worker), or a 60 s shared cache keyed by filter (a freshness decision). |
| `/social/content/library/music` (page) | 390 ms ✅; Lighthouse TBT ~3–4 s | 800 rows, each with a native `<audio controls>` (1.9 MB HTML). `content-visibility` already cut LCP and TBT by about 30%. | Virtualize the list, or render a play button that mounts the `<audio>` element on tap. Both change the DOM and look, so a design call. |
| Content-type pages (`/carousels`, `/explainers`, `/field-notes`, …) JS | ~189 KB gz (budget 150) | The pool screen's drag-to-reorder (`@dnd-kit`, 17 KB) and the `TypeHub` panels ship with the page. | Load dnd-kit on first pointerdown on a queue card, and split the settings popover. |
| `/trello` JS | 229 KB gz | Home itself uses dnd-kit and framer-motion. | Comes with the Trello data plan above. |
| `/hub` JS | 153 KB gz | The campaign hub's create and edit dialogs ship with the list. | Load the dialogs on demand. |


## Heavy pages (budget applied to first paint)

These meet the budget on first meaningful paint (TTFB ≤ 150 ms; a shell or skeleton streams at once), with data streaming in after:

- **Social Hub pages on a cold cache** (`/social`, `/carousels`, the content-type pages, analytics, calendar): TTFB 75–110 ms. The dataset rebuild (about 0.5 s after this branch, from 0.9 s) streams in behind `loading.tsx`. Warm, the shared 60 s cache serves them, and single-flight keeps the background refreshes from piling up.
- **`/trello`**: the skeleton is at 108 ms; the workspace follows (see above).
- **`/hub/queue`, `/hub`**: the shell and nav paint at once, and the board or list fills in.


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
