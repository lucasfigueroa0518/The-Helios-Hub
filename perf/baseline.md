# Perf run: baseline

2026-11-17T19:24:00.731Z · commit 269c401 · 95 routes · warm 30 runs · cold 30 cycles · DB one-way delay 2.5 ms

Budget: page warm p95 TTFB ≤ 150 ms and full HTML ≤ 500 ms; API warm p95 ≤ 500 ms (server target 150 ms).

| Route | Warm TTFB p50/p95 | Warm total p50/p95/p99 | Cold TTFB p95 | Cold total p95 | Queries (warm/cold) | LCP | TBT | JS KB | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `GET /ai-events` | 64/84 | 88/443/636 | 99 | 137 | 4/83 | 1204 | 162 | 237.4 | pass |
| `GET /ai-trivia` | 72/83 | 133/170/181 | 94 | 183 | 4/4 | 1369 | 262 | 238.9 | pass |
| `GET /api/analytics/drilldown?metricKey=emails_sent&period=week` | 289/371 | 289/372/401 | 487 | 487 | 23/23 | – | – | – | pass |
| `GET /api/analytics/runs` | 23/28 | 23/28/35 | 39 | 40 | 1/1 | – | – | – | pass |
| `GET /api/analytics/summary?period=week` | 365/447 | 366/447/456 | 578 | 578 | 25/25 | – | – | – | pass |
| `GET /api/auth/me` | 15/19 | 15/19/19 | 25 | 25 | 1/1 | – | – | – | pass |
| `GET /api/billing-guard` | 15/19 | 15/19/19 | 44 | 44 | 1/1 | – | – | – | pass |
| `GET /api/campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4/cost-estimate` | 78/94 | 78/94/97 | 109 | 109 | 6/6 | – | – | – | pass |
| `GET /api/campaigns/fc123e21-f5b4-478e-a655-47c6e6266ad2/outreach-stats` | 202/237 | 202/237/239 | 310 | 310 | 3/3 | – | – | – | pass |
| `GET /api/campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4/pre-enriched/ingest` | 14/19 | 15/19/22 | 30 | 30 | 1/1 | – | – | – | pass |
| `GET /api/campaigns/fc123e21-f5b4-478e-a655-47c6e6266ad2/prospect` | 50/57 | 50/57/60 | 71 | 71 | 6/6 | – | – | – | pass |
| `GET /api/campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4` | 22/25 | 22/25/26 | 34 | 34 | 1/1 | – | – | – | pass |
| `GET /api/campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4/sheet?sync=0` | 62/71 | 63/74/75 | 110 | 112 | 2/2 | – | – | – | pass |
| `GET /api/campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4/tags` | 16/23 | 16/23/24 | 36 | 36 | 1/1 | – | – | – | pass |
| `GET /api/campaigns` | 190/223 | 190/223/224 | 226 | 227 | 1/1 | – | – | – | pass |
| `GET /api/carousels/overview` | 25/28 | 25/29/38 | 37 | 37 | 7/7 | – | – | – | pass |
| `GET /api/carousels/settings` | 20/23 | 20/23/23 | 53 | 53 | 4/4 | – | – | – | pass |
| `GET /api/content-type/posting?type=carousels` | 71/77 | 71/77/77 | 948 | 962 | 5/5 | – | – | – | pass |
| `GET /api/content-type/progress?type=all` | 32/36 | 32/36/36 | 51 | 51 | 11/11 | – | – | – | pass |
| `GET /api/content-type/run-today` | 642/770 | 642/770/786 | 1114 | 1114 | 103/103 | – | – | – | fail |
| `GET /api/conversations/8aec63d4-99bc-44d7-8b7c-71c5bb61bbad` | 33/40 | 33/40/41 | 47 | 48 | 4/4 | – | – | – | pass |
| `GET /api/conversations?filter=all` | 22/27 | 22/27/27 | 35 | 35 | 2/2 | – | – | – | pass |
| `GET /api/dashboards/tokens` | 15/19 | 15/19/19 | 34 | 34 | 1/1 | – | – | – | pass |
| `GET /api/explainers/idea-cycle` | 21/29 | 22/30/30 | 31 | 31 | 4/4 | – | – | – | pass |
| `GET /api/explainers/jobs/028f4295-5797-49e8-9054-a30bb156c6b7` | 36/42 | 37/42/45 | 75 | 75 | 6/6 | – | – | – | pass |
| `GET /api/explainers/settings` | 15/18 | 15/18/20 | 44 | 44 | 1/1 | – | – | – | pass |
| `GET /api/field-notes/settings` | 13/18 | 14/18/18 | 30 | 30 | 1/1 | – | – | – | pass |
| `GET /api/health` | 10/12 | 10/13/13 | 17 | 17 | –/– | – | – | – | pass |
| `GET /api/hub/warm?path=%2Fsocial` | 103/167 | 103/167/202 | 1203 | 1203 | 0/0 | – | – | – | pass |
| `GET /api/inboxes/02f92a46-8b11-4610-8836-12024f694aa9` | 16/3538 | 16/3538/8408 | 35 | 35 | 1/1 | – | – | – | fail |
| `GET /api/networking/events?from=2026-11-17` | 22/29 | 22/29/37 | 36 | 36 | 5/5 | – | – | – | pass |
| `GET /api/public/trivia-game/days?after=2026-11-17` | 12/20 | 12/20/20 | 24 | 24 | 1/1 | – | – | – | pass |
| `GET /api/reel-ai-drama/lab` | 94/104 | 94/104/106 | 158 | 159 | 14/15 | – | – | – | pass |
| `GET /api/reel-ai-drama/settings` | 14/16 | 14/16/19 | 36 | 36 | 1/1 | – | – | – | pass |
| `GET /api/reels/health?days=7` | 40/49 | 40/50/56 | 77 | 77 | 11/11 | – | – | – | pass |
| `GET /api/reels/overview` | 1299/1499 | 1299/1500/1561 | 1830 | 1831 | 43/43 | – | – | – | fail |
| `GET /api/send-queue/0002e02f-4c00-4c9b-b2eb-d5ff29ee8d27` | 15/18 | 15/18/19 | 45 | 46 | 1/1 | – | – | – | pass |
| `GET /api/send-queue` | 659/795 | 668/807/844 | 804 | 808 | 6/6 | – | – | – | fail |
| `GET /api/sender-profiles` | 16/23 | 16/23/24 | 26 | 26 | 1/1 | – | – | – | pass |
| `GET /api/seo/properties` | 15/18 | 15/18/19 | 27 | 27 | 1/1 | – | – | – | pass |
| `GET /api/seo/rows?property=65208669-4a0b-422d-90fe-7a874e41be63&dimension=query&period=3m` | 27/30 | 27/30/31 | 47 | 47 | 3/3 | – | – | – | pass |
| `GET /api/seo/summary?property=65208669-4a0b-422d-90fe-7a874e41be63&period=3m` | 24/29 | 24/29/32 | 64 | 65 | 5/5 | – | – | – | pass |
| `GET /api/seo/sync` | 18/25 | 19/25/26 | 32 | 32 | 2/2 | – | – | – | pass |
| `GET /api/social-hub/actions/revisions?vertical=carousels&postId=2756d6b7-5c0a-4833-9528-fead0dec9ba4` | 21/25 | 21/25/34 | 51 | 51 | 2/2 | – | – | – | pass |
| `GET /api/social-hub/slots?from=2026-11-17&to=2026-11-17` | 19/24 | 19/24/24 | 32 | 33 | 4/4 | – | – | – | pass |
| `GET /api/social-hub/slots/schedule` | 24/34 | 24/34/40 | 43 | 43 | 3/3 | – | – | – | pass |
| `GET /api/stories/sets/0087127b-8bc0-4fa1-bea1-fdf527f26c3c` | 35/40 | 35/40/53 | 52 | 52 | 5/5 | – | – | – | pass |
| `GET /api/stories/sets?view=queue` | 34/38 | 34/38/43 | 50 | 50 | 3/3 | – | – | – | pass |
| `GET /api/stories/settings` | 13/16 | 13/16/21 | 33 | 33 | 1/1 | – | – | – | pass |
| `GET /api/stories/trivia-game` | 19/23 | 20/23/23 | 45 | 45 | 2/2 | – | – | – | pass |
| `GET /api/tags` | 14/18 | 14/19/19 | 31 | 32 | 1/1 | – | – | – | pass |
| `GET /api/users` | 13/18 | 14/18/21 | 30 | 30 | 1/1 | – | – | – | pass |
| `GET /campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4/draft` | 16/21 | 31/36/37 | 76 | 95 | 2/2 | 675 | 253 | 216 | pass |
| `GET /campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4` | 17/22 | 32/38/42 | 57 | 110 | 2/2 | 677 | 296 | 182.7 | pass |
| `GET /campaigns/fc123e21-f5b4-478e-a655-47c6e6266ad2/prospect` | 17/21 | 26/31/31 | 59 | 84 | 1/1 | 711 | 168 | 194.6 | pass |
| `GET /campaigns/5a161b20-499b-44aa-a793-1af136b0e8f4/review` | 17/28 | 30/42/46 | 50 | 64 | 2/2 | 1026 | 197 | 216 | pass |
| `GET /carousels` | 53/73 | 143/447/623 | 90 | 1089 | 7/7 | 1095 | 159 | 237.4 | pass |
| `GET /dashboards` | 17/21 | 20/25/28 | 98 | 108 | 1/1 | 1141 | 107 | 170.1 | pass |
| `GET /dashboards/projects/agency%20design%20summit%20helios-31-0` | 17/20 | 21/24/25 | 62 | 69 | 1/1 | 690 | 227 | 175.7 | pass |
| `GET /dashboards/projects/new` | 20/24 | 23/30/31 | 87 | 95 | 1/1 | 687 | 175 | 173.2 | pass |
| `GET /dashboards/tokens` | 15/22 | 19/25/29 | 40 | 50 | 1/1 | 720 | 218 | 170.1 | pass |
| `GET /dashboards/d/perf-dashboard-token-000000000000000000000001` | 15/21 | 37/45/48 | 49 | 75 | 5/5 | 1055 | 179 | 158.7 | pass |
| `GET /events` | 11/19 | 13/21/23 | 49 | 54 | 0/0 | 1421 | 143 | 175.9 | pass |
| `GET /explainers` | 58/80 | 180/247/248 | 93 | 307 | 9/9 | 1832 | 1050 | 237.9 | pass |
| `GET /explainers/reels` | 18/23 | 39/45/46 | 42 | 70 | 1/1 | 1132 | 137 | 166 | pass |
| `GET /field-notes` | 48/67 | 111/168/169 | 86 | 208 | 6/6 | 1745 | 1037 | 230 | pass |
| `GET /hub/analytics` | 12/16 | 13/17/19 | 42 | 46 | 0/0 | 2553 | 384 | 229.1 | pass |
| `GET /hub/conversations` | 12/17 | 13/19/19 | 95 | 104 | 0/0 | 1454 | 143 | 229.1 | pass |
| `GET /hub/inboxes` | 12/22 | 14/25/27 | 47 | 53 | 0/0 | 2185 | 418 | 229.1 | pass |
| `GET /hub` | 11/15 | 13/18/18 | 49 | 60 | 0/0 | 2169 | 385 | 229.1 | pass |
| `GET /hub/queue` | 15/19 | 17/21/22 | 41 | 44 | 0/0 | 17423 | 108 | 229.1 | pass |
| `GET /last-few-days` | 62/72 | 123/144/149 | 87 | 168 | 4/4 | 1220 | 196 | 237.4 | pass |
| `GET /morning-download` | 58/69 | 256/306/310 | 101 | 1489 | 4/4 | 1506 | 549 | 237.4 | pass |
| `GET /` | 9/12 | 10/13/16 | 34 | 37 | 0/0 | 743 | 140 | 270.3 | pass |
| `GET /real-or-ai/lab` | 20/25 | 22/27/33 | 72 | 78 | 0/0 | 628 | 170 | 159.6 | pass |
| `GET /real-or-ai` | 75/82 | 145/171/179 | 91 | 1368 | 4/4 | 1165 | 280 | 237.4 | pass |
| `GET /reel-ai-drama/lab` | 13/19 | 14/22/23 | 71 | 78 | 0/0 | 2009 | 293 | 163.8 | pass |
| `GET /reel-ai-drama` | 64/82 | 91/118/119 | 98 | 184 | 4/4 | 1370 | 416 | 237.9 | pass |
| `GET /reels/analytics?period=30d` | 18/23 | 169/198/199 | 51 | 278 | 25/25 | 726 | 236 | 238.7 | pass |
| `GET /reels/health?days=7` | 20/28 | 50/62/67 | 42 | 75 | 11/11 | 1171 | 168 | 238.7 | pass |
| `GET /seo` | 13/19 | 14/21/21 | 46 | 53 | 0/0 | 1734 | 368 | 166.7 | pass |
| `GET /social/analytics/carousels` | 68/77 | 107/120/162 | 101 | 1407 | 2/2 | 1740 | 393 | 174.8 | pass |
| `GET /social/analytics/compare?ids=carousels%3A2756d6b7-5c0a-4833-9528-fead0dec9ba4` | 60/78 | 69/87/87 | 109 | 1295 | 2/2 | 1212 | 259 | 175.4 | pass |
| `GET /social/analytics/cost` | 23/31 | 527/859/1693 | 76 | 2008 | 46/46 | 1307 | 366 | 182.4 | fail |
| `GET /social/analytics` | 66/86 | 119/147/509 | 102 | 192 | 2/2 | 1469 | 242 | 173.1 | pass |
| `GET /social/calendar?view=week` | 68/88 | 114/142/142 | 100 | 1271 | 10/10 | 1069 | 129 | 214.2 | pass |
| `GET /social/content/library/music` | 16/26 | 328/468/783 | 61 | 562 | 3/3 | 6222 | 4506 | 175.1 | pass |
| `GET /social/content/library/photos` | 18/26 | 73/86/88 | 86 | 171 | 10/10 | 1198 | 123 | 176.1 | pass |
| `GET /social/health/night/2026-11-17` | 19/24 | 29/36/40 | 56 | 72 | 1/1 | 1208 | 219 | 181.8 | pass |
| `GET /social/health?nights=14` | 19/26 | 45/58/61 | 77 | 113 | 2/2 | 1318 | 516 | 180.6 | pass |
| `GET /social` | 61/90 | 96/197/235 | 104 | 1048 | 2/26 | 1206 | 199 | 193.6 | pass |
| `GET /social/post/carousels:2756d6b7-5c0a-4833-9528-fead0dec9ba4` | 72/84 | 91/102/103 | 108 | 1397 | 2/2 | 1117 | 132 | 204.1 | pass |
| `GET /traffic` | 11/19 | 13/21/23 | 39 | 41 | 0/0 | 1396 | 144 | 165.3 | pass |
| `GET /trello` | 36/95 | 1278/1457/1625 | 79 | 1464 | 21/21 | 9430 | 222 | 255.2 | fail |
| `GET /watch/perfReviewToken0000000000000000000000000000` | 15/19 | 31/36/36 | 38 | 57 | 4/4 | 607 | 283 | 161.5 | pass |

**89/95 routes meet the warm budget.**
