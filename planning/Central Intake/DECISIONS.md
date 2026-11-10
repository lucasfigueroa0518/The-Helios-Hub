# Central intake: decisions register

Lucas's decisions for the central intake, in order. Plan: `planning/Central Intake/PLAN.md`. Contract:
`lib/intake/types.ts`. A later entry wins over an earlier one where they touch; the entry says what it replaces.
Quotes are Lucas's words as recorded in the plan. Where the plan records only the answer, the entry says so.

| ID | Date | Decision | Lucas's words |
|---|---|---|---|
| CI-01 | 2026-11-08 | Keep the builder scoring approach (`story-builder@1`) built from his builder examples. | "All these stories are AMAZING!!!" and "I think you nailed that." |
| CI-02 | 2026-11-08 | LFD and Morning Download share scoring infrastructure, but LFD must not become MD's best hits. Dedup between them is deferred. | "I want their scoring methodologies to be similar… shared infrastructure across [LFD and Morning Download]… economies of scale… align our page's content." Also: "I don't want last few days to just be best hits from morning download." |
| CI-03 | 2026-11-08 | Builder lane: no reserved slot; builders compete for slots. Lab discoveries count, lab launches don't. No new feeds; judge deeper into the pool. MD gets the builder lane too, with a mix that leans toward major news. | Answer recorded in the plan (round 1); no verbatim quote. |
| CI-04 | 2026-11-08 | One photo finder for every content type, built on AI Drama's finder, bank shared to the maximum. News posts may use AI Drama's sources with the outlet credited. Now Phase 3 (CI-09). | "No signoff from tommy needed. Do it all." |
| CI-05 | 2026-11-08 | One central intake. Types pull the sources that belong to them; types with the same scoring share the same runs; ideas reach every pool already scored; a seed is scored on entry. | "I'd rather have one centralized ingestion run with EVERYTHING, and then the different content ideas pull in the sources that belong to them, and when different content types use the same scoring logic they leverage the same runs, and then that's how all the ideas get to all the idea pools already scored. When an idea is seeded it just jumps in, is scored, and sits there." |
| CI-06 | 2026-11-08 | Scope: every type that ingests web sources places an intake order. Model-driven ideation (Claude web search, Real Case scout, AI Drama producer, Explainers idea generator) is exempt. A source no open order names is not fetched. | "this applies to all the content types that ingest sources from the web. So even things like free vs. paid. The only… exempt… is when something is being ideated/ingested by claude or llm calls… If a content type's runs are off and no other content types are requesting a source, then that run doesn't need to happen anymore." |
| CI-07 | 2026-11-08 | Claude web search stays a Reels-owned call; its finds land in the intake like a seed, and any order may list them. | "YES" (round 2, answer 1). |
| CI-08 | 2026-11-08 | AI Events stays out of the intake. | Answer recorded in the plan (round 2, answer 2): "AI Events: out." |
| CI-09 | 2026-11-08, amended 2026-11-09 | Phased rollout, each phase shipped and checked before the next. Phase 1: intake, shared scorecards, LFD and the three Stories series (MD, GTN, FvP) plus the builder lane. Phase 2: Reels, Carousels, Field Notes and the meme lab. Phase 3: the shared photo finder. (GTN and FvP moved from Phase 2 to Phase 1 by round 4, answer 1.) | "Phases: yes." Round 4 answer 1 is recorded without a verbatim quote. |
| CI-10 | 2026-11-09 | The intake owns its sources from Phase 1 and never reads `reels.*`. LFD and MD fetch through it whether or not Reels runs. | "One of the main reasons for building this is to make the source ingestions not be dependent on a certain content type (reels). LFD and MD should be able to call upon those sources by themselves." |
| CI-11 | 2026-11-09 | Builder lane window: the event happened in the last 7 days (event date, not ingest date). Applies to LFD and MD; MD's 4-day pool window still bounds MD. | "Builder stories need to be from the last 7 days." |
| CI-12 | 2026-11-09 | No cap on builder stories in LFD. The calibrated `BUILDER_BAR` is the only control, so the calibration replay and Lucas's review of its picks are required before ship. (MD's builders stay at most 2 of 5, from the Phase 1 contract.) | "No cap on builder stories." |
| CI-13 | 2026-11-09 | The intake may make Jev-only calls in other types' hours. (Times now set by CI-20.) | "Yes, it can." |
| CI-14 | 2026-11-09 | Phase 1 photo slice: LFD builder slides use AI Drama's harvest engine, capped at $0.15 a post. Major and rundown slides keep today's finder until Phase 3. | Answer recorded in the plan (round 3, Q2): yes. |
| CI-15 | 2026-11-09 | Undated builders are let in. Claude web search moves to `web-search-v3`: the window and today's date go in the per-night user message, and the report carries a required `happened_on` date (null when the sources don't state it). The adapter stores `publishTime = happened_on ?? now`. Builder recency uses `happened_on`, else the feed's publish date; no extra Jev "when" question. | "Let them in, but please make sure the llm finding them is aware of the time window we're looking for. What would be even better is if claude can just know what we need and we can add the real date to be carried with the fetch." |
| CI-16 | 2026-11-09 | Re-score on growth: a story touched in this run is re-scored when new coverage joins it (cache key includes the member set). Untouched stories are never re-scored. | "Re-score on growth: yes." (round 3b; refined in round 4). |
| CI-17 | 2026-11-09 | Same stories, independent types, same access. Sources and judgments belong to the intake. Each order names the sources and scorecards its type reads today, and the intake runs them whether or not the type that first built them runs. Finished posts stay readable but optional. Intended differences are only the builder lane, the LFD builder photo slice, and web search's recency window plus real event date. | "In terms of what stories come through to certain content types, our end result after this plan should make it largely the same." "My main concern right now is dependencies that we're removing that will result in behavior changes." "I want you to re-evaluate some of the decisions you made based on my desire for every content to be independent of each other in their dependencies and also my desire for every content type to still have access to all the same stuff it currently has access to." |
| CI-18 | 2026-11-09 | Field Notes runs at 2:00 AM on its days instead of noon. `auto_run` stays its switch; the posting window stays 2:30–3:30 PM. Phase 1 keeps its own fetch; Phase 2 puts it on an intake order. | "field notes ingestion/production should be set to run at 2 AM, not noon." |
| CI-19 | 2026-11-09 | GTN and FvP move to Phase 1, on their own orders (GTN: reels adapters, feeds, `reels-score`, `story-scoring@4`; FvP: reels adapters including GitHub Trending, `reels-score`). | Answer recorded in the plan (round 4, answer 1); no verbatim quote. |
| CI-20 | 2026-11-09 | Night schedule v2: at most two content types per clock hour, never two video renderers. The intake (Jev scoring only) does not count. Intake main 12:00 AM, top-up 2:40 AM; Field Notes 2:00 AM with the Explainers idea cycle; Carousels or LFD plus the IG Stories sets at 3:00 AM (Stories were 4:00). | "Yes, share the hour. Lets move to a two-content-type per hour rule and try to stack everything so they run efficiently in parallel and are done earlier in the night (optimize the schedule)." |
| CI-21 | 2026-11-09 | GTN is fully independent of Carousels: it stops reading carousel brief numbers and finds the number itself on every shortlisted story. The shortlist uses the same sources and `story-scoring@4` ranking the carousel uses. GTN's numbers may differ from the carousel's for the same story. | "Fully independent. It should still see the same sources though." |
| CI-22 | 2026-11-09 | Carousels off does not starve MD or GTN. With their order open, the intake fetches the feeds and runs `story-scoring@4` whether or not Carousels run (CI-17). The posted check still reads the carousel's posted list, read-only. On nights Carousels do run, the feeds are fetched twice until Phase 2. | Follows from CI-17 and CI-21; no separate quote. |

## Build defaults (from the plan's guards; Lucas changes them, agents don't)

- Consumer switch `intake.settings` key `consumers`: every type ships `legacy`. Lucas flips a type to `intake` after
  the real run. An `intake` type with no successful main run in 26 h reads `legacy` for that build (`stale-fallback`);
  an intake read error does the same for that run.
- `BUILDER_BAR` is 0.6 in `lib/stories/scores.ts`, a placeholder until the calibration replay sets it.
- LFD: seeds (at most 3), then the lead queue by margin (majors at most 3, builders uncapped), then the rundown.
  MD: lead queue by margin, builders at most 2 of 5, minimum 2.
- Caps: $0.50 for the main run, $0.15 for the top-up. The calibration and equivalence replay needs `--go` plus
  Lucas's go-ahead with its estimate.

## CI-23: story-builder@2 (Lucas, 2026-11-09, replay review)
- Why: in the first two replays the builder questions (@1) picked mostly research papers and AI incidents
  (a robot breach, exposed hacking tools), not people stories.
- "Yes, change both":
  - `made_or_found` counts achievements only: a failure, breach, leak, misuse or harm does not count.
  - New question `general_interest`: would a general audience, not only specialists, understand why this matters and
    find it remarkable?
- Weights: made_or_found .25, pushes_limits .20, shown_working .20, general_interest .35, routine_launch −.40,
  speculative −.35. A specialist-only result tops out at 0.65.
- `BUILDER_BAR` is still 0.6 until Lucas sets it from the @2 replay picks.
- Bar (Lucas, 2026-11-09, after the @2 replays): `BUILDER_BAR` = 0.65. On the example nights (Oct 29, Nov 3, Nov 4)
  his examples scored 0.80–0.90 and the best research paper 0.68; on Nov 7–9 the best paper scored 0.65.
