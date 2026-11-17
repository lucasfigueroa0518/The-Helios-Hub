# Perf run: build-c

2026-11-17T21:46:27.315Z · commit 29f8c1c · 8 routes · warm 30 runs · cold 0 cycles · DB one-way delay 2.5 ms

Budget: page warm p95 TTFB ≤ 150 ms and full HTML ≤ 500 ms; API warm p95 ≤ 500 ms (server target 150 ms).

| Route | Warm TTFB p50/p95 | Warm total p50/p95/p99 | Cold TTFB p95 | Cold total p95 | Queries (warm/cold) | LCP | TBT | JS KB | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/campaigns/fc123e21-f5b4-478e-a655-47c6e6266ad2/outreach-stats` | 46/52 | 46/52/55 | – | – | 3/3 | – | – | – | pass |
| `GET /api/campaigns` | 57/71 | 57/71/71 | – | – | 1/1 | – | – | – | pass |
| `GET /api/send-queue` | 260/316 | 268/324/326 | – | – | 6/6 | – | – | – | pass |
| `GET /dashboards` | 14/19 | 19/24/26 | – | – | 1/1 | 1235 | 340 | 163.2 | pass |
| `GET /events` | 15/19 | 17/22/23 | – | – | 0/0 | 1359 | 121 | 169 | pass |
| `GET /` | 7/11 | 9/13/13 | – | – | 0/0 | 777 | 184 | 276.6 | pass |
| `GET /seo` | 13/19 | 15/21/22 | – | – | 0/0 | 1740 | 410 | 159.8 | pass |
| `GET /social/calendar?view=week` | 65/86 | 107/133/134 | – | – | 10/81 | 1034 | 146 | 207.3 | pass |

**8/8 routes meet the warm budget.**
