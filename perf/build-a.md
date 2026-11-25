# Perf run: build-a

2026-11-17T20:30:27.504Z · commit 0d5ca11 · 14 routes · warm 30 runs · cold 30 cycles · DB one-way delay 2.5 ms

Budget: page warm p95 TTFB ≤ 150 ms and full HTML ≤ 500 ms; API warm p95 ≤ 500 ms (server target 150 ms).

| Route | Warm TTFB p50/p95 | Warm total p50/p95/p99 | Cold TTFB p95 | Cold total p95 | Queries (warm/cold) | LCP | TBT | JS KB | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `GET /ai-events` | 54/67 | 77/91/136 | 123 | 1212 | 4/75 | – | – | – | pass |
| `GET /api/analytics/summary?period=week` | 216/260 | 217/260/264 | 424 | 424 | 25/25 | – | – | – | pass |
| `GET /api/campaigns/fc123e21-f5b4-478e-a655-47c6e6266ad2/outreach-stats` | 38/49 | 39/49/50 | 77 | 77 | 3/3 | – | – | – | pass |
| `GET /api/campaigns` | 132/158 | 132/158/158 | 204 | 205 | 1/1 | – | – | – | pass |
| `GET /api/content-type/progress?type=all` | 29/33 | 30/33/33 | 67 | 67 | 11/11 | – | – | – | pass |
| `GET /api/content-type/run-today` | 474/530 | 474/530/573 | 1012 | 1012 | 89/89 | – | – | – | fail |
| `GET /api/hub/warm?path=%2Fsocial` | 45/60 | 45/60/60 | 767 | 767 | 0/0 | – | – | – | pass |
| `GET /api/inboxes/02f92a46-8b11-4610-8836-12024f694aa9` | 14/18 | 14/18/19 | 50 | 50 | 1/1 | – | – | – | pass |
| `GET /api/reels/overview` | 115/122 | 115/122/123 | 184 | 184 | 43/43 | – | – | – | pass |
| `GET /api/send-queue` | 562/668 | 574/676/712 | 844 | 855 | 6/6 | – | – | – | fail |
| `GET /carousels` | 54/74 | 146/182/198 | 103 | 1141 | 7/7 | – | – | – | pass |
| `GET /morning-download` | 49/65 | 215/286/303 | 169 | 1338 | 4/4 | – | – | – | pass |
| `GET /social/analytics/cost` | 56/73 | 277/320/340 | 116 | 1586 | 46/46 | – | – | – | pass |
| `GET /social` | 54/75 | 86/116/141 | 148 | 1269 | 2/26 | – | – | – | pass |

**12/14 routes meet the warm budget.**
