# Perf run: final

2026-11-17T23:20:30.478Z · commit 5520450 · 95 routes · warm 30 runs · cold 30 cycles · DB one-way delay 2.5 ms

Budget: page warm p95 TTFB ≤ 150 ms and full HTML ≤ 500 ms; API warm p95 ≤ 500 ms (server target 150 ms).

| Route | Warm TTFB p50/p95 | Warm total p50/p95/p99 | Cold TTFB p95 | Cold total p95 | Queries (warm/cold) | LCP | TBT | JS KB | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `GET /ai-events` | 55/71 | 80/96/118 | 87 | 147 | 4/75 | 1291 | 236 | 231.6 | pass |
| `GET /ai-trivia` | 63/87 | 121/152/156 | 115 | 214 | 4/4 | 1237 | 229 | 233.1 | pass |
| `GET /api/analytics/drilldown?metricKey=emails_sent&period=week` | 266/322 | 267/322/334 | 484 | 484 | 23/23 | – | – | – | pass |
| `GET /api/analytics/runs` | 26/31 | 26/31/33 | 34 | 35 | 1/1 | – | – | – | pass |
| `GET /api/analytics/summary?period=week` | 236/323 | 236/324/327 | 430 | 431 | 25/25 | – | – | – | pass |
| `GET /api/auth/me` | 15/19 | 15/19/19 | 46 | 46 | 1/1 | – | – | – | pass |
| `GET /api/billing-guard` | 14/17 | 15/17/18 | 40 | 40 | 1/1 | – | – | – | pass |
| `GET /api/campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4/cost-estimate` | 78/88 | 78/88/89 | 120 | 120 | 6/6 | – | – | – | pass |
| `GET /api/campaigns/fc123e21-f5b4-478e-a655-47c6e6266ad2/outreach-stats` | 46/53 | 46/54/54 | 76 | 76 | 3/3 | – | – | – | pass |
| `GET /api/campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4/pre-enriched/ingest` | 16/22 | 16/22/22 | 37 | 37 | 1/1 | – | – | – | pass |
| `GET /api/campaigns/fc123e21-f5b4-478e-a655-47c6e6266ad2/prospect` | 51/54 | 51/54/55 | 70 | 71 | 6/6 | – | – | – | pass |
| `GET /api/campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4` | 21/25 | 21/26/26 | 49 | 49 | 1/1 | – | – | – | pass |
| `GET /api/campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4/sheet?sync=0` | 55/61 | 57/64/70 | 75 | 76 | 2/2 | – | – | – | pass |
| `GET /api/campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4/tags` | 16/21 | 16/21/22 | 31 | 31 | 1/1 | – | – | – | pass |
| `GET /api/campaigns` | 60/79 | 60/79/80 | 93 | 93 | 1/1 | – | – | – | pass |
| `GET /api/carousels/overview` | 28/30 | 28/31/33 | 41 | 42 | 7/7 | – | – | – | pass |
| `GET /api/carousels/settings` | 21/30 | 21/31/31 | 32 | 33 | 4/4 | – | – | – | pass |
| `GET /api/content-type/posting?type=carousels` | 54/71 | 54/71/78 | 93 | 93 | 5/5 | – | – | – | pass |
| `GET /api/content-type/progress?type=all` | 34/38 | 34/38/38 | 48 | 48 | 11/11 | – | – | – | pass |
| `GET /api/content-type/run-today` | 502/561 | 502/561/601 | 988 | 988 | 89/89 | – | – | – | fail |
| `GET /api/conversations/8aec63d4-99bc-44d7-8b7c-71c5bb61bbad` | 36/45 | 37/45/47 | 64 | 64 | 4/4 | – | – | – | pass |
| `GET /api/conversations?filter=all` | 24/29 | 24/29/31 | 40 | 40 | 2/2 | – | – | – | pass |
| `GET /api/dashboards/tokens` | 15/20 | 16/20/21 | 36 | 36 | 1/1 | – | – | – | pass |
| `GET /api/explainers/idea-cycle` | 22/26 | 23/27/27 | 40 | 40 | 4/4 | – | – | – | pass |
| `GET /api/explainers/jobs/028f4295-5797-49e8-9054-a30bb156c6b7` | 36/40 | 36/40/42 | 58 | 58 | 6/6 | – | – | – | pass |
| `GET /api/explainers/settings` | 14/17 | 14/18/20 | 28 | 28 | 1/1 | – | – | – | pass |
| `GET /api/field-notes/settings` | 16/19 | 16/19/21 | 29 | 29 | 1/1 | – | – | – | pass |
| `GET /api/health` | 9/12 | 10/12/12 | 22 | 22 | –/– | – | – | – | pass |
| `GET /api/hub/warm?path=%2Fsocial` | 46/127 | 46/127/497 | 62 | 63 | 0/0 | – | – | – | pass |
| `GET /api/inboxes/02f92a46-8b11-4610-8836-12024f694aa9` | 16/22 | 16/22/22 | 51 | 52 | 1/1 | – | – | – | pass |
| `GET /api/networking/events?from=2026-11-17` | 24/33 | 24/33/42 | 51 | 52 | 5/5 | – | – | – | pass |
| `GET /api/public/trivia-game/days?after=2026-11-17` | 14/22 | 14/22/25 | 34 | 34 | 1/1 | – | – | – | pass |
| `GET /api/reel-ai-drama/lab` | 100/106 | 101/106/117 | 163 | 163 | 14/15 | – | – | – | pass |
| `GET /api/reel-ai-drama/settings` | 16/20 | 16/20/27 | 30 | 31 | 1/1 | – | – | – | pass |
| `GET /api/reels/health?days=7` | 44/48 | 44/48/50 | 63 | 63 | 11/11 | – | – | – | pass |
| `GET /api/reels/overview` | 125/136 | 125/136/140 | 172 | 173 | 43/43 | – | – | – | pass |
| `GET /api/send-queue/0002e02f-4c00-4c9b-b2eb-d5ff29ee8d27` | 17/22 | 17/22/22 | 39 | 39 | 1/1 | – | – | – | pass |
| `GET /api/send-queue` | 250/284 | 257/291/353 | 382 | 397 | 6/6 | – | – | – | pass |
| `GET /api/sender-profiles` | 15/19 | 15/19/20 | 29 | 30 | 1/1 | – | – | – | pass |
| `GET /api/seo/properties` | 14/19 | 14/19/20 | 33 | 33 | 1/1 | – | – | – | pass |
| `GET /api/seo/rows?property=65208669-4a0b-422d-90fe-7a874e41be63&dimension=query&period=3m` | 26/31 | 26/31/33 | 43 | 43 | 3/3 | – | – | – | pass |
| `GET /api/seo/summary?property=65208669-4a0b-422d-90fe-7a874e41be63&period=3m` | 27/31 | 28/31/35 | 52 | 54 | 5/5 | – | – | – | pass |
| `GET /api/seo/sync` | 21/24 | 21/24/24 | 35 | 35 | 2/2 | – | – | – | pass |
| `GET /api/social-hub/actions/revisions?vertical=carousels&postId=2756d6b7-5c0a-4833-9528-fead0dec9ba4` | 22/27 | 22/27/29 | 58 | 58 | 2/2 | – | – | – | pass |
| `GET /api/social-hub/slots?from=2026-11-17&to=2026-11-17` | 22/30 | 22/30/34 | 35 | 35 | 4/4 | – | – | – | pass |
| `GET /api/social-hub/slots/schedule` | 27/36 | 27/36/38 | 48 | 49 | 3/3 | – | – | – | pass |
| `GET /api/stories/sets/0087127b-8bc0-4fa1-bea1-fdf527f26c3c` | 40/45 | 40/45/50 | 60 | 60 | 5/5 | – | – | – | pass |
| `GET /api/stories/sets?view=queue` | 35/41 | 35/41/44 | 62 | 62 | 3/3 | – | – | – | pass |
| `GET /api/stories/settings` | 16/21 | 16/21/24 | 34 | 34 | 1/1 | – | – | – | pass |
| `GET /api/stories/trivia-game` | 21/27 | 21/27/28 | 37 | 37 | 2/2 | – | – | – | pass |
| `GET /api/tags` | 14/17 | 14/18/20 | 36 | 36 | 1/1 | – | – | – | pass |
| `GET /api/users` | 13/18 | 13/18/19 | 35 | 35 | 1/1 | – | – | – | pass |
| `GET /campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4/draft` | 19/24 | 34/41/43 | 48 | 85 | 2/2 | 645 | 263 | 192.1 | pass |
| `GET /campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4` | 18/29 | 32/45/46 | 64 | 98 | 2/2 | 667 | 251 | 175.9 | pass |
| `GET /campaigns/fc123e21-f5b4-478e-a655-47c6e6266ad2/prospect` | 18/24 | 26/31/32 | 48 | 61 | 1/1 | 666 | 220 | 171.9 | pass |
| `GET /campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4/review` | 18/25 | 32/38/40 | 55 | 75 | 2/2 | 990 | 209 | 192.1 | pass |
| `GET /carousels` | 56/84 | 150/194/204 | 94 | 1223 | 7/7 | 1350 | 326 | 231.6 | pass |
| `GET /dashboards` | 19/29 | 24/34/35 | 45 | 58 | 1/1 | 1194 | 220 | 163.4 | pass |
| `GET /dashboards/projects/agency%20design%20summit%20helios-31-0` | 16/20 | 21/24/24 | 60 | 65 | 1/1 | 673 | 217 | 169 | pass |
| `GET /dashboards/projects/new` | 16/22 | 21/25/28 | 69 | 76 | 1/1 | 663 | 183 | 166.5 | pass |
| `GET /dashboards/tokens` | 16/24 | 20/33/34 | 61 | 73 | 1/1 | 788 | 221 | 163.4 | pass |
| `GET /dashboards/d/perf-dashboard-token-000000000000000000000001` | 14/21 | 36/39/43 | 50 | 87 | 5/5 | 983 | 129 | 131.2 | pass |
| `GET /events` | 14/18 | 15/20/20 | 46 | 56 | 0/0 | 1710 | 227 | 169.2 | pass |
| `GET /explainers` | 50/61 | 166/206/252 | 85 | 268 | 9/9 | 1515 | 1130 | 232.2 | pass |
| `GET /explainers/reels` | 16/24 | 35/43/45 | 50 | 74 | 1/1 | 1228 | 198 | 159.3 | pass |
| `GET /field-notes` | 41/59 | 109/140/140 | 107 | 1247 | 6/6 | 1970 | 1527 | 224.3 | pass |
| `GET /hub/analytics` | 14/18 | 15/20/20 | 49 | 54 | 0/0 | 2137 | 247 | 220.1 | pass |
| `GET /hub/conversations` | 13/17 | 15/19/19 | 60 | 63 | 0/0 | 2098 | 367 | 220.1 | pass |
| `GET /hub/inboxes` | 15/20 | 16/21/22 | 74 | 82 | 0/0 | 1839 | 300 | 220.1 | pass |
| `GET /hub` | 15/21 | 66/96/96 | 43 | 121 | 1/1 | 2217 | 256 | 220.1 | pass |
| `GET /hub/queue` | 13/23 | 14/24/39 | 49 | 53 | 0/0 | 17860 | 181 | 220.1 | pass |
| `GET /last-few-days` | 51/58 | 95/122/124 | 79 | 1230 | 4/4 | 1163 | 174 | 231.6 | pass |
| `GET /morning-download` | 45/60 | 206/238/244 | 158 | 1381 | 4/4 | 1433 | 577 | 231.6 | pass |
| `GET /` | 8/12 | 9/13/19 | 45 | 52 | 0/0 | 737 | 136 | 251.2 | pass |
| `GET /real-or-ai/lab` | 16/23 | 17/24/24 | 67 | 70 | 0/0 | 1073 | 118 | 152.9 | pass |
| `GET /real-or-ai` | 60/110 | 122/185/236 | 103 | 1321 | 4/4 | 1264 | 313 | 231.6 | pass |
| `GET /reel-ai-drama/lab` | 17/22 | 18/24/25 | 48 | 55 | 0/0 | 2175 | 472 | 157.1 | pass |
| `GET /reel-ai-drama` | 60/74 | 87/106/111 | 95 | 184 | 4/4 | 1254 | 277 | 232.2 | pass |
| `GET /reels/analytics?period=30d` | 19/27 | 164/189/189 | 53 | 274 | 25/25 | 1274 | 337 | 232.9 | pass |
| `GET /reels/health?days=7` | 20/27 | 50/59/60 | 44 | 80 | 11/11 | 1220 | 286 | 232.9 | pass |
| `GET /seo` | 15/21 | 16/23/23 | 50 | 54 | 0/0 | 1617 | 218 | 160 | pass |
| `GET /social/analytics/carousels` | 57/74 | 91/116/125 | 119 | 185 | 2/2 | 1369 | 215 | 168.1 | pass |
| `GET /social/analytics/compare?ids=carousels%3A2756d6b7-5c0a-4833-9528-fead0dec9ba4` | 63/109 | 72/118/224 | 117 | 1245 | 2/2 | 1092 | 148 | 168.7 | pass |
| `GET /social/analytics/cost` | 59/83 | 321/369/719 | 99 | 607 | 46/46 | 1620 | 334 | 175.7 | pass |
| `GET /social/analytics` | 57/75 | 104/131/134 | 92 | 159 | 2/2 | 1355 | 125 | 166.4 | pass |
| `GET /social/calendar?view=week` | 67/107 | 115/313/427 | 104 | 193 | 10/10 | 1135 | 207 | 207.5 | pass |
| `GET /social/content/library/music` | 23/47 | 320/480/872 | 52 | 476 | 3/3 | 5828 | 3816 | 168.4 | pass |
| `GET /social/content/library/photos` | 22/30 | 82/91/91 | 51 | 121 | 10/10 | 1493 | 272 | 169.5 | pass |
| `GET /social/health/night/2026-11-17` | 20/31 | 34/45/46 | 55 | 71 | 1/1 | 1229 | 222 | 175.1 | pass |
| `GET /social/health?nights=14` | 22/30 | 48/66/68 | 76 | 100 | 2/2 | 1222 | 315 | 173.9 | pass |
| `GET /social` | 56/78 | 93/127/129 | 98 | 1252 | 2/26 | 1177 | 151 | 186.9 | pass |
| `GET /social/post/carousels:2756d6b7-5c0a-4833-9528-fead0dec9ba4` | 61/89 | 81/107/126 | 121 | 1361 | 2/2 | 1008 | 132 | 197.4 | pass |
| `GET /traffic` | 15/22 | 16/23/24 | 95 | 103 | 0/0 | 1540 | 195 | 158.6 | pass |
| `GET /trello` | 49/108 | 1372/1591/1630 | 107 | 1355 | 21/21 | 9789 | 332 | 280.3 | fail |
| `GET /watch/perfReviewToken0000000000000000000000000000` | 20/26 | 38/44/47 | 81 | 92 | 4/4 | 602 | 133 | 134.1 | pass |

**93/95 routes meet the warm budget.**
