# News Ranker — shared contract (Stage 6, 2026-11-22)

Every name here is fixed. Builders code against `lib/news-ranker/types.ts` (written before the build; change it only through the integrator).

## Owners (one owner per file)
| Owner | Owns | Must not touch |
|---|---|---|
| R — Ranker core | `lib/news-ranker/**` except `lib/news-ranker/lab/**` and `types.ts`; edits to `lib/stories/build/morning-download.ts`, `lib/stories/md-development.ts`, `lib/stories/scores.ts`, `lib/stories/questions.ts`, `lib/lfd/{pick,ground,sources,run,lead,questions}.ts`, tests for those | lab files, any prompt for writing/photos (round 2) |
| L — Lab | `lib/news-ranker/lab/**`, `app/news-ranker/lab/**`, `app/api/news-ranker/lab/**`, `scripts/news-ranker-lab.ts`, its tests | everything R owns |
| Integrator (main session) | `types.ts`, this contract, PLAN.md, the prompt audit | — |

## Module `lib/news-ranker/`
- `types.ts` — shared types (integrator).
- `questions.ts` — (R) the ranker's Jev question sets moved out of `lib/stories/questions.ts`: `NEWS_GATE` (loosened, D10), `NEWS_MASSIVE_DEVELOPMENT` (D11), and the existing `MAJOR_NEWS`, `BUILDER`, `SAME_EVENT` re-homed. `lib/stories/questions.ts` re-exports for back-compat until MD is rewired.
- `scores.ts` — (R) `leadOf`, bars, `majorNewsScore`, `namesIn`, `SAME_EVENT_BAR`, `GROUNDING_BAR` moved here. MD and LFD import from here. **LFD imports nothing from `lib/stories/build/morning-download.ts` (D-arch).**
- `memory.ts` — (R) `readSaid(q, format, now): Promise<SaidRecord[]>` over BOTH formats' published/approved sets; `repeatVerdict(...)`: a story this format already ran is allowed back only if `NEWS_MASSIVE_DEVELOPMENT` ≥ `MASSIVE_BAR` (placeholder 0.8, calibrated in the lab). Cross-format: LFD may recap MD (D2) — `readSaid` filters to the asking format.
- `candidates.ts` — (R) `candidatesFor(q, format, window, now): Promise<RankerStory[]>` from the central intake (`lib/intake/read.ts listStories`). The legacy reels/carousel lane mirroring in `lib/intake/pool-lfd.ts` stays until the lab picks the scoring; R only adds the new reader beside it.
- `rank.ts` — (R) `rank(stories, variant, deps): Promise<RankedStory[]>` = gate → score → mix → optional final order. The production variant is `CURRENT_VARIANT` (today's behavior: major-news@3 + story-builder@2 + leadOf + md-final-rank@1) until the lab picks a winner.
- `lab/` — (L) variants, tag store, metrics, runner.

## Lab
- Reads intake stories read-only (`BEGIN READ ONLY` pattern for psql; app code uses read queries only). Never writes intake/stories/lfd tables.
- Tags: local only (same local-PGlite pattern as `lib/memes/db.ts`), table `lab_tags(story_id text pk, cool bool, need_to_know bool, note text, tagged_at timestamptz)`; also `lab_runs`, `lab_scores(run_id, story_id, variant_id, cool, need_to_know, mixed, final_position, detail jsonb, cost_usd)`.
- Candidate set: ~60 intake stories from the last 7 NY days (D5), frozen as `lab_sets` so variants compare on identical input.
- Metrics per variant (D7): precision@5 and @10 vs Cool tags, vs Need-to-know tags, vs either; and the share of tagged-"no" in the top 5.
- Mix sweep (D9): cool weight w ∈ {0, .25, .5, .75, 1}, free (no calls) once scores exist.
- Spend: hard cap $1.00 total across lab runs (D6), checked before each call from stored `cost_usd`. Jev via `lib/social/jev/client.ts`; Sonnet final-order via `lib/stories/writer.ts` with prompt caching (CLAUDE.md caching rule).
- Triggers (D6): UI buttons, and `scripts/news-ranker-lab.ts <command>` so the agent can run the same actions when Lucas asks. Automated tests use the Jev stub (`lib/social/jev/stub.ts`) and a stubbed `create`; no live calls in tests.
- First variants L builds (all pass the prompt-review lens; no in-domain examples):
  1. `current` — today's logic.
  2. `current-reweighted` — same stored answers, new weights (free).
  3. `cool-valuable@1` — two Jev question sets: Cool (surprise, "wait, really?", novelty, vivid/demo-able, story people would retell) and Need-to-know (changes what people can do, pay, trust, or are exposed to; broad public audience, D8), behind `NEWS_GATE`.
  4. `scalar@1` — one 1–10 Cool and one 1–10 Need-to-know judgment each.
  5. `final-interesting@1` — Sonnet side-by-side asking for most interesting / most worth knowing, not "annoyed to miss".

## Integration notes (R done 2026-11-22)
- `repeatVerdict(story, said, { jev, readArticles }, bar = MASSIVE_BAR)`; never run before means allowed, no call.
- Variant scoring is passed through `RankDeps.score`, since `RankerVariant` has no scorer field.
- Open for MD rewire: `md-final-rank` wrapper (no stable pre-publish story id); LFD posts should store `storyId` at publish; retire md-development@1 (0.6, any new event) for news-massive-development@1 (0.8).

## Decisions this contract encodes
D1 ranker scope · D2 per-format repeats · D5/D7 two tags · D6 lab/$1/agent triggers · D8 broad audience · D9 mix per format · D10 gate loosened · D11 massive development via Jev, bar from Lucas-tagged repeats.
