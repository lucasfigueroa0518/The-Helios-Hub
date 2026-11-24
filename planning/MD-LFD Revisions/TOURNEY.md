# Ranker tournament: three blind builds (2026-11-22)

Ground truth: Lucas's 99 ratings (Cool + Value, 0–10 each). Each build is a set of Jev questions, scored by `scripts/news-ranker-tourney.ts`. Jev spend: $0.108 in total.
Metrics:
- **Overall**: Spearman rank correlation with Lucas's sum.
- **Top 10 / Top 20**: the mean of Lucas's sum over the build's top 10 or top 20. A perfect pick scores 14.1 / 12.95. All 99 average about 6.2. Today's logic averaged about 6.3 at its top 10.

| Build | R1 overall / top10 / top20 | R2 | R3 (final) |
|---|---|---|---|
| A, reader's reaction | 0.47 / 10.7 / 9.5 | 0.58 / 11.0 / 10.3 | **0.57 / 10.9 / 10.3** (8 questions) |
| B, editor's slot | 0.45 / 9.9 / 9.35 | 0.61 / 10.9 / 10.7 | **0.59 / 11.3 / 10.1** (11 questions) |
| C, minimal | 0.47 / 10.7 / 8.8 | 0.60 / 10.6 / 10.25 | cut after R2 |

Final logic: `.memes-local/news-ranker-lab/tourney/build-{a,b}/FINAL.md`. Specs: `spec-r3.json`. Per-story results: `results-r*.json`.

## Rounds 4–8 (A and B only, shared brief `tourney/BRIEF.md`)
| Round | A overall / top10 / top20 | B overall / top10 / top20 |
|---|---|---|
| R4 | 0.61 / 11.2 / 11.25 | 0.62 / 12.0 / 11.35 |
| R5 | 0.62 / 13.1 / 11.45 | 0.615 / 9.9 / 11.5 (looser news test; reverted in R6) |
| R6 | 0.63 / 12.4 / 11.4 | 0.62 / 12.0 / 11.55 |
| R7 | 0.63 / 13.1 / 11.4 | 0.615 / 11.6 / 11.55 |
| **R8 final** | **0.615 / 13.1 / 11.35** (8 questions) | **0.645 / 11.9 / 11.4** (9 questions) |

Noise check: re-scoring A's R5 spec unchanged gave 0.613 / 12.4 / 11.4. The top 10 moves by about ±0.7 between runs, so top-10 gaps under 1 point are noise. The total tournament spend on Jev was $0.275.

## Notes
- R2 gained the most, but those fixes came from the same 99 stories, so the scores are in-sample. R3 traded a little fit for generality. A fresh graded set is the real test.
- A's top 10 holds three Huang pieces and two IPO pieces. The ranker's same-event dedup (keep the strongest write-up) would free up those slots. B's top 10 is more varied, and none of its picks are 0-rated.
- Both builds landed on the same core: the story must contain a real new fact, not talk. Cool = a "wait, really?" you'd retell, and a picture. Value = it reaches ordinary Americans' lives, products or power. Insider and builder material sinks.

## Held-out test (20 fresh stories Lucas graded, 2026-11-22)
Ids: `tourney/holdout-ids.json`; ratings + text: `tourney/holdout.json`. Lucas's average sum is 11.75 (the 99 averaged 6.2), so this set is mostly real news with a narrow spread.

| Build (R8) | overall | Cool | Value | top 10 of 20 (ideal 13.5) | overlap with Lucas's top 10 |
|---|---|---|---|---|---|
| A | 0.31 | 0.38 | 0.41 | 12.1 | 6/10 |
| B | **0.48** | 0.47 | 0.47 | **12.9** | 7/10 |

- B holds up better on unseen stories. A's in-sample top-10 edge did not carry over.
- Both builds bury classic big news (Lucas: "punishing classic big news too hard", Rubio 1/8 sat at ranks 59 and 50):
  - Isomorphic's $5B raise (8/7) ranked 15–16th, hit by the "money moves aren't deeds" rule.
  - Amodei's cancer claim (7/8) ranked 9–13th, hit by the "talk" penalty.
  - The Microsoft outage (4/8), the stock correction (4/7) and the US AI-safety-center story (4/7) ranked low.
  - Cause: rules that discount money, statements and dry government action dock Value even when the stakes are national or industry-wide.

## R9 (B only, aimed at Lucas's three duds and buried big news, 2026-11-22)
Changes:
- The news test now also catches forecasts, matchups and questions the piece itself poses.
- Surprise is judged against what people can already get and against who did the feat (the makers showing off their own tool is expected).
- Small features and me-too capabilities earn little usable Value.
- Stakes and the landmark question count money, words and official acts in full.

| | 99 overall / top10 / top20 | held-out overall / top10 / overlap | duds' rank on their day | big news ranks (Rubio, Isomorphic, outage, correction) of 119 |
|---|---|---|---|---|
| R8 | 0.645 / 11.9 / 11.4 | 0.48 / 12.9 / 7 | 2, 2, 1 | 66, 56, 55, 96 |
| R9 | 0.638 / 11.8 / 11.2 | 0.37 / 12.1 / 5 | 2, 10, 3 | 51, 53, 42, 82 |

Offline re-combine of R9's answers, where each axis takes its strongest route instead of a sum: fewer launches (22 to 12 of the 50 top-10 slots) and duds lower, but every correlation is worse. Rubio's best rank is 40.
Read: the cheap model itself rates national-stakes statements as middling (Rubio stakes 0.54). Wording changes have stopped moving the ranking.

## Stage 2 reranker (2026-11-22)
Setup:
- Build B R8 shortlists each day's top 25.
- One Sonnet 5.5 call per day grades the shortlist 0–10 on Cool and Value and marks same-event duplicates (`scripts/news-ranker-rerank.ts`, output `build-b/rerank-r8.json`).
- Five days cost $0.133. Lab total is $0.876 of the $1 cap.

Lucas's flagged stories (shortlist rank, then final rank):

| Story | Lucas's call | Result |
|---|---|---|
| Phota Labs | dud | #2 → #13 |
| ChatGPT Wallet vs. Gemini | dud | #1 → #16 |
| Theme Park | dud | #2 → **#4** |
| Businesses in ChatGPT | should rise | #10 → #5 |
| Star Wars animatronics | should rise | #7 → #5 |
| Adobe agentic AI | should rise | #7 → **#13** (wrong way) |

- 16 duplicates were merged.
- About a third of each new top 10 came from shortlist ranks 15–25, so the cheap pass is a weak filter and big stories likely sit below 25.
- Sonnet's grades run low (3–7). On Nov 15 the Nvidia CEO saga fills three slots as separate events.

## Opus 5.5 (low effort) rerank with Lucas's eight approved lines (2026-11-22)
- Output is in `build-b/rerank-opus-r8.json`. It cost $0.249, and the lab total is now $1.125 of the $1.50 ceiling.
- Because the model and the prompt both changed, this is not a clean comparison with the Sonnet run.

| Story | Lucas's call | Rank |
|---|---|---|
| Phota Labs | dud | #14 |
| Wallet opinion | dud | #20 |
| Theme Park | dud | **#3** (Sonnet had it at #4) |
| Businesses in ChatGPT | should rise | #5 |
| Star Wars animatronics | should rise | #6 |
| Adobe | should rise | **#12** |

- On Nov 15 the Nvidia saga holds four of the top five slots, so the dominant-story line amplifies it.
- On Nov 18 Huang is #1.

## Posting cut (Morning Download depth), 2026-11-22
- The reranker now marks `top_tier` and `crowds` for each story. Code walks down the ranked list and stops at the first story that is not top tier or that crowds one already kept, posting at least 2 and at most 5 (`choosePosts`).
- Opus low, $0.292. Lab total is $1.416 of the $1.50 ceiling. Output: `build-b/rerank-opus-post.json`.
- Depth by day (Lucas vs model): Nov 9 5 vs 3, Nov 10 2 vs 3, Nov 12 4 vs 5, Nov 15 3 vs 2, Nov 18 5 vs 5. Four of five days are within ±1.
- Lucas's depths were read off the previous Opus order, and the order shifted between runs, so this is only a rough match.

## Held-out trial: Nov 17, 20, 21 (2026-11-22)
- Shortlist cost $0.057 (594 Jev calls); Opus low rerank $0.166. Lab total is now $1.656, past the $1.50 ceiling with Lucas's approval. Output: `build-b/rerank-opus-days3.json`.
- Posted: 4 / 2 / 4 stories.
- Issues:
  - An opinion piece was posted at Nov 21 #2 ("OUTSIDE VIEW: NVIDIA mess should lead to AI regulation").
  - On Nov 20, a crowding story at #2 stopped the walk. The minimum of 2 then pulled in #3, and top-tier #4–#6 were dropped.
  - Many posted stories came from shortlist ranks 20–25, so the shortlist is too shallow.
  - The same math story appears on both Nov 20 and Nov 21, so the ranker needs to know what earlier days already posted.
