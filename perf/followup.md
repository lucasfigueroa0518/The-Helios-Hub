# Perf run: followup

2026-11-18T14:42:53.202Z · commit 648b45e · 2 routes · warm 30 runs · cold 30 cycles · DB one-way delay 2.5 ms

Budget: page warm p95 TTFB ≤ 150 ms and full HTML ≤ 500 ms; API warm p95 ≤ 500 ms (server target 150 ms).

| Route | Warm TTFB p50/p95 | Warm total p50/p95/p99 | Cold TTFB p95 | Cold total p95 | Queries (warm/cold) | LCP | TBT | JS KB | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/content-type/run-today` | 126/140 | 127/140/142 | 1552 | 1552 | 32/103 | – | – | – | pass |
| `GET /trello` | 22/29 | 364/450/490 | 198 | 714 | 21/21 | – | – | – | pass |

**2/2 routes meet the warm budget.**
