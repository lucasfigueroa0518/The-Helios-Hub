# Perf run: build-d

2026-11-17T21:53:30.693Z · commit 9308548 · 7 routes · warm 30 runs · cold 0 cycles · DB one-way delay 2.5 ms

Budget: page warm p95 TTFB ≤ 150 ms and full HTML ≤ 500 ms; API warm p95 ≤ 500 ms (server target 150 ms).

| Route | Warm TTFB p50/p95 | Warm total p50/p95/p99 | Cold TTFB p95 | Cold total p95 | Queries (warm/cold) | LCP | TBT | JS KB | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `GET /campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4/draft` | 20/28 | 35/42/49 | – | – | –/– | 665 | 224 | 192.1 | pass |
| `GET /campaigns/fc123e21-f5b4-478e-a655-47c6e6266ad2/prospect` | 15/18 | 24/28/28 | – | – | –/– | 674 | 99 | 171.9 | pass |
| `GET /dashboards` | 16/19 | 20/24/24 | – | – | –/– | 657 | 171 | 163.4 | pass |
| `GET /dashboards/d/perf-dashboard-token-000000000000000000000001` | 14/19 | 34/40/41 | – | – | –/– | 931 | 105 | 131.2 | pass |
| `GET /hub` | 21/27 | 77/96/104 | – | – | –/– | 1785 | 155 | 220.1 | pass |
| `GET /social/content/library/music` | 17/29 | 275/390/397 | – | – | –/– | 4290 | 3102 | 168.4 | pass |
| `GET /trello` | 21/29 | 1098/1356/1390 | – | – | –/– | 9170 | 211 | 280.2 | fail |

**6/7 routes meet the warm budget.**
