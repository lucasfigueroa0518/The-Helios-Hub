> **Status: awaiting replay review.** Phase 1 built 2026-11-09 in the worktree `feat/central-intake` (uncommitted).
> This file is a verbatim copy of the approved plan (`~/.claude/plans/ok-one-type-of-keen-umbrella.md`), kept here
> with the contract (`lib/intake/types.ts`), the decisions register (`DECISIONS.md`) and the replay reports.
> Where rounds conflict, the later round wins: "Phase 1 contract" as amended by "Round 3", "Round 4", "Round 4
> answers" and "Night schedule v2". "Contract (round 1, superseded)" is kept only as reference.

# Shared story judging + builder lane + one photo finder

## Context
Last Few Days (LFD) posts kept missing a kind of story Lucas wants: someone builds, discovers or newly applies something
with AI that goes past what had been done. Those stories **are in the pool**, often near the top by reels score. For
example: the AI tool that found an off-the-shelf drug for a baby's genetic disease (#1 on Nov 4); the blind student's
self-taught AI app (#3 on Nov 3); the woman who built a startup after an AI voice-clone call (#1 on Oct 29). They lose
in both lanes. Major-news pays for big companies, politics and global reach, and the rundown sorts big-name stories
first. Of 47 LFD slides from Oct 27 to Nov 6, none was a builder story from outside the big labs.

Round-1 decisions (Lucas, 2026-11-08):
- On the builder examples: "All these stories are AMAZING!!!" and "I think you nailed that." Keep the scoring approach.
- "I want their scoring methodologies to be similar… shared infrastructure across [LFD and Morning Download]… economies
  of scale… align our page's content." Also: "I don't want last few days to just be best hits from morning download."
  Dedup is **deferred**.
- Builder lane: no reserved slot. In LFD, builders win about half the slots by competing. Lab discoveries count; lab
  launches don't. Sourcing: judge deeper into the pool; add no new feeds.
- **Morning Download gets the builder lane too**, with a mix that leans toward major news.
- **One photo finder for every content type**, built on AI Drama's finder, adapting to what each type asks for and
  trying hard for story-specific photos. Bank shared to the maximum.
- News posts may use AI Drama's sources (Google Images via Serper, editorial photos), with the outlet credited.
- Rollout: LFD first, then Morning Download and the other Stories types, then carousels. "No signoff from tommy needed.
  Do it all."

## Round 2 (Lucas, 2026-11-08): one central intake
"I'd rather have one centralized ingestion run with EVERYTHING, and then the different content ideas pull in the sources
that belong to them, and when different content types use the same scoring logic they leverage the same runs, and then
that's how all the ideas get to all the idea pools already scored. When an idea is seeded it just jumps in, is scored,
and sits there."

Lucas, follow-up: "this applies to all the content types that ingest sources from the web. So even things like free vs.
paid. The only… exempt… is when something is being ideated/ingested by claude or llm calls (for example, claude websearch
is excluded…). When content types are using sources from the web, their [requests]… are pulling from the central pool…
sent as orders to the centralized ingestion pool. If a content type's runs are off and no other content types are
requesting a source, then that run doesn't need to happen anymore."

- **In scope:** every type that pulls web sources: Reels / Text-on-Screen / Trial Reels, Carousels, Morning Download,
  Guess the Number, Free vs Paid, LFD, and Memes (which read stories).
- **Exempt (model-driven ideation):** Claude web search (reels B6), the Real Case scout, the AI Drama producer, and the
  Explainers idea generator. AI Events ingests event listings, not news; that's out unless Lucas says otherwise.
- **Name: "intake orders".** Each content type places an intake order: the sources it wants, how far back, and which
  scorecards. The intake fetches only the union of the open orders. A type that is switched off has no open order, so a
  source no open order names is not fetched.

Round-2 answers (Lucas, 2026-11-08):
1. **YES**: Claude web search stays a Reels-owned call, but what it finds lands in the central store like a seed, and any
   type's order may list it.
2. **AI Events: out.**
3. **Phases: yes.** Phase 1 is intake, shared scorecards, and the LFD and MD pools plus the builder lane. Phase 2 moves
   Reels, Carousels, GTN and FvP onto intake orders and retires their own fetches. Phase 3 is the shared photo finder.
   Each phase ships and is checked before the next.

Today (mapped 2026-11-08):
- **Four separate ingestion paths:** reels at 1 AM (~30 adapters plus Claude web search); carousels at 3 AM (21 feeds,
  plus a live re-fetch of the reels adapters); LFD on Tue/Fri, which fetches the 21 feeds a third time; and the
  Real Case and AI Drama scouts with their own web search.
- **Scoring:** one big headline can be scored 4–5 times a night by different engines (reels pass 1+2, carousel
  story-scoring@4, md-score, major-news@3 for MD, then major-news@3 again for LFD).
- **Same-story grouping is done four different ways.**
- **Seeding works four different ways:** carousel and reels seeds are scored on entry; LFD and Stories seeds are not.

```
 ALL sources (reels adapters ∪ carousel feeds ∪ web search) ──► INTAKE (one run, ~1 AM + a pre-3 AM top-up)
                                                                  fetch once → one store → one same-story grouping
                                                                         │
                                       scorecards, each run ONCE per story per version, cached:
                                       reels pass1/pass2 · story-scoring@4 · major-news@3 · story-builder@1
                                       (a scorecard runs only on stories that belong to a type using it)
                                                                         │
             ┌──────────────┬──────────────┬─────────────────┬───────────┴──────┬──────────────┐
             ▼              ▼              ▼                 ▼                  ▼              ▼
          Reels pool   Carousel pool   MD / GTN / FvP     LFD pool          Memes reads   AI Drama / Real Case
          (its sources  (its sources    pools              (major+builder+   (as today)    read intake as news
           + scorecards) + scorecards)  (major+builder…)    reels scores)                  context (scouts stay)
             │ each pool = the type's sources + freshness window + its scorecards → ideas sit pre-scored
             ▼
          pickers at build time only pick (caps, repeats, company cap, slot mix). No scoring at pick time.
 SEED (any type): paste link → read → intake item → scored with that type's scorecards → sits in the pool, marked "yours"
                                                                         │
                        ▼  picked stories → writer → one "needs" spec per slide
        shared photo finder (lib/photos)
        needs → wants → bank first (photos, logos, cutouts) → article images → Wikidata/Commons → Serper/Openverse
        → cheapest-first screens (stock/watermark/AI-made → metadata → phash dedupe → reuse → Haiku look → identity → size)
        → best photo per slide, per content-type profile
                        │
                        ▼  LFD keeps its rendered-slide vision check; a story with no photo is replaced
```

| Step | Reads | Responsible for | Hands on |
|---|---|---|---|
| Pool (per type) | reels.*, social.runs, feeds | which stories are eligible (window, depth) | candidates |
| Story judge (shared) | candidates, `stories.judgments` | Jev answers + scores for every set; cache | `{major, builder, answers}` per story |
| Picker (per type) | scores | slot mix, caps, replacement order | picks |
| Photo finder (shared) | needs spec, banks, web | one vetted, story-specific photo per slide | `Photo` + trace + usd |
| Slide check (LFD) | rendered slide | photo shows the subject, not generic | ok / replace |

## Pre-mortem (2026-11-08): "It's December and this failed. Why?"
Ranked by likelihood × damage. Each risk is paired with the guard written into the build.

1. **Builder slots fill with stale or undated stories.** Every Claude web search find has `publish_time` equal to its
   ingest date (checked over 14 days), so its real date is unknown, and a weeks-old human-interest feature looks like
   today's news. `story-builder@1` has no recency question, unlike major-news's `happened`. *Guard:* a recency check on
   builders, using the article's own date where the page states one, else a "when did this happen" answer.
   Lucas's call (Q1).
2. **Builder slots fill with dev-tool noise.** GitHub repos, arXiv papers and "Show HN" items pass `made_or_found`, and
   in LFD builders are uncapped. Also, the examples Lucas loved were picked by hand from headlines; the question set has
   never run. *Guard:* the calibration replay is required before ship, and Lucas reviews the actual picks. If noise
   gets through, add a "would a general audience care" question rather than per-source rules.
3. **Builders lose their slots to photos.** The builder lane ships in Phase 1, but the better finder only arrives in
   Phase 3. Niche stories fail the current finder, get replaced quietly, and the post goes back to big-company news.
   *Guard:* record per-lane photo drops in the run record; Lucas decides whether to move part of the photo work earlier (Q2).
4. **A live nightly pipeline breaks during migration.** Reels (1 AM), carousels (3 AM), Stories (4 AM) and LFD
   (Tue/Fri) all run in prod, and the VM has run unmerged code before. *Guards:*
   - Phase 1 is additive: the intake runs next to today's paths.
   - LFD and MD switch over behind a setting that falls back to the old path.
   - Hash the VM before deploying, re-read the worker log before any restart, and Lucas runs the deploy.
5. **Freshness gets worse.** Intake runs at about 1 AM, while LFD today fetches the feeds live at 3 AM, so news from
   1–3 AM is lost. *Guard:* a pre-3 AM top-up pass of the same orders.
6. **Grouping changes what counts as "one story."** Four engines become one, so posts either show the same event twice
   or merge two different ones. *Guard:* Phase 1 keeps the pick-time same-event check as a safety net; grouping only
   changes for Reels and Carousels in Phase 2, with a before/after comparison.
7. **Score cache bugs.** Reels scores grouped *ideas*, major-news scores *articles*, and story keys differ between them.
   A changed question set must not reuse old answers. *Guard:* the cache key is (story key, scorecard version), with
   tests for a version bump and for a story that maps to many ideas.
8. **A Rule 2 breach.** A "score everything in the store" job is a database sweep. *Guard:* scorecards only run on items
   new to this intake run and on seeds. There is no backfill, and the calibration replay reads past windows and writes
   nothing to the cache.
9. **Costs creep or get misfiled.** Every scorecard runs on every item, and shared spend lands in the Reels or Stories
   cost watch. *Guard:* orders decide which scorecards run; there is a per-night Jev cap; and shared intake spend gets
   its own cost bucket.
10. **LFD becomes Morning Download's greatest hits.** With the same scores and lead logic and dedup deferred, the
    overlap grows. *Guard:* the record shows the LFD/MD overlap % from day one, so the dedup talk has numbers.
11. **The spec and the code disagree.** CLAUDE.md treats `planning/` as authoritative; if the LFD/Stories spec isn't
    updated, a future agent "fixes" the code back to it. *Guard:* each owner updates the matching spec section and the decisions log.
12. **Work collides with uncommitted work.** This checkout is `reels-iterations` with untracked folders, and Iteration 12
    was left uncommitted. *Guard:* build in a fresh worktree off `origin/main`.
13. **Readers downstream change silently.** AI Drama and Real Case read the Stories news reads as context, and memes
    read LFD lanes. *Guard:* list every reader of a pool and keep its contract or migrate it in the same phase.

## Inventory
**Stays**
- major-news@3 and same-event (wording unchanged)
- Each type's pool window and its rules
- LFD seeds, the company cap and repeat checks
- The LFD rendered-slide vision check
- AI Drama's harvest behavior (its planner, director wishes and cutouts stay AI-Drama-only)
- The banks, and the 7-day and 20-day reuse windows

**Moves to shared**
- `MAJOR_NEWS_WEIGHTS` / `MAJOR_NEWS_BAR` / `majorNewsScore` move from `stories/build/morning-download.ts` to `lib/stories/scores.ts`
- The AI Drama harvest engine (sources, pipeline, filters, look, reuse, photo-bank, logo-bank source) moves to
  `lib/photos/engine/`. The old paths keep re-export shims, so AI Drama's imports keep working.

**Goes**
- The Stories adapter's internals (`createLivePhotoFinder` becomes a thin call into `lib/photos`)
- LFD's `lead-image.ts` ordering (the engine's article source covers it)
- The carousel finder's search and pick path in `design-stage.ts` (replaced by the engine with the carousel profile)
- The five duplicate 7-day used-photo reads (one shared reader)
- The two duplicate stock lanes, two size floors, and mixed Haiku versions (one setting: `claude-haiku-5-5`)

**New**
- The `story-builder@1` question set
- `lib/stories/judge.ts` + the `stories.judgments` table
- The LFD builder lane and MD builder mix
- `lib/photos/` (needs → wants planner, profiles, API)
- The builder calibration replay script

> **Superseded.** The round-1 Contract, Build and Verification sections below are replaced by "Phase 1 contract" at
> the end of this file. Their photo parts (`lib/photos`, Owners C and D) move to Phase 3, and `stories.judgments` is
> replaced by `intake.scores`. They are kept here only as reference for Phase 3.

## Contract (round 1, superseded)
**Judging (`lib/stories/`)**
- `questions.ts`: add `BUILDER` = `story-builder@1`, with the wording in the appendix.
- `scores.ts`:
  - `MAJOR_NEWS_WEIGHTS`, `MAJOR_NEWS_BAR = 0.55`, `majorNewsScore(answers)`
  - `BUILDER_WEIGHTS = {made_or_found: .35, pushes_limits: .35, shown_working: .30, routine_launch: -.40, speculative: -.35}`
  - `BUILDER_BAR` (start 0.6, set by calibration), `builderScore(answers)`
  - `type Lead = 'major' | 'builder'`, and `leadOf(s) → {lane: Lead, margin} | null` (the lane with the larger margin over its own bar)
- `judge.ts`:
  - `type StoryJudgment = { key; major: number; builder: number; answers: Record<string, Record<string, number>> }`
  - `judgeStories(items: JudgeItem[], deps: { ask: JudgeAsk; cache: JudgmentCache }): Promise<Map<key, StoryJudgment>>`
  - `JudgeItem = { key, headline, outlets, published, body }`
  - `JudgeAsk` adapts both the Stories Jev (`createStoriesJev`) and the social `JevAsk`, so each type keeps its own logs and cost rows.
  - Concurrency 8, body cut at 9000 chars.
- `db/stories_judgments.sql`: `stories.judgments(story_key text, set_version text, answers jsonb, score double precision, judged_at timestamptz, PRIMARY KEY (story_key, set_version))`.
  - The cache is read before asking and written after.
  - It holds only stories that are already candidates of a run. It is never swept or backfilled.

**Photos (`lib/photos/`)**
- `types.ts`:
  - `PhotoNeed`, one per slide:
    - `id`, `copy`
    - `subjects: {name, type: 'person'|'organization'|'product'|'place', role?, qid?}[]`
    - `moment` (what the photo should show), `kind` (current enum), `alts`
    - `storyUrls`, `storyDate`
    - `specificity: 'story'|'subject'|'generic_ok'`
    - `cover?`
  - `PhotoProfile`, per content type:
    - `name`, `minShortSide`, `coverMinShortSide`
    - `licence: 'editorial_credited'|'open_only'`
    - `sources: SourceName[]` (order), `reuseDays`, `capUsd`, `allowIconScene: boolean`
  - `FoundPhoto = Photo & { trace: string[] }`
- `find.ts`: `findPhotos(needs: PhotoNeed[], profile: PhotoProfile, deps: PhotoDeps): Promise<{photos: (FoundPhoto|null)[], usd}>`.
  - It finds the set together: no photo or person twice in one set.
  - `PhotoDeps` = `{ http, look (Haiku), bank, logoBank, cutoutBank, serperKey, usedReader, now }`, all stubbable.
- `profiles.ts`: `LFD`, `MORNING_DOWNLOAD`, `GUESS_THE_NUMBER`, `FREE_VS_PAID`, `CAROUSEL`, `REVISIONS`.
  - All news profiles use `editorial_credited`.
  - LFD and MD use `specificity` from the writer: a builder story gets `'story'`.
- `used.ts`: `recentlyUsed(keys, days)`, one reader over `social.used_photos` (by URL) and `reel_ai_drama.asset_uses` (by phash).
- `lib/stories/photos.ts`: keeps the `PhotoFinder` interface (`find`, `findSet`, `usd`, `size`) so callers don't change, and implements it by mapping `PhotoRequest → PhotoNeed`.

## Build (parallel; one owner per file; contract written first)
Rough size: 4 builder agents plus 1 read-only reviewer, each briefed narrowly. This is a big build, mostly agent tokens.
It makes no live Claude, Jev, Serper or web calls; tests are stubbed only.

1. **Owner A: shared judging and MD.**
   - Files: `lib/stories/{questions,scores,judge}.ts`, `db/stories_judgments.sql`, `lib/stories/build/morning-download.ts`, `lib/stories/md-score.ts` (imports only).
   - MD ranks with `judgeStories` and picks lead stories by margin, builders ≤ 2 of 5, the rest major. `chooseStories` keeps min 2 / max 5.
   - Accept: MD's tests pass; a builder-only pool still yields ≥ 2 stories; the cache is hit on a second call; no sweep path exists.
2. **Owner B: the LFD builder lane.**
   - Files: `lib/lfd/{pick,run,types}.ts`, `lib/social-hub/queries/last-few-days.ts` and the LFD Ideas view, `scripts/lfd/calibrate-builder.ts`.
   - Judging moves to `judgeStories`. Builder depth is 30 per night (cap 120); major depth stays at 60.
   - The Selector gets a lead queue by margin. Majors stay ≤ 3, builders are uncapped (calibrated toward about half), and the rundown fills the rest.
   - Replacement goes same lane → lead → rundown. `record.queues.builder` is added. Owner B also wires LFD's photo call to `findPhotos` with the LFD profile, as Owner D specifies.
   - Accept: the offline tests from the earlier plan pass; with no builders, the lineup is identical to today's.
3. **Owner C: the photo engine.**
   - Files: `lib/photos/engine/**` (moved from `lib/reel-ai-drama/harvest/` with re-export shims), `lib/photos/{types,find,profiles,used}.ts`.
   - The needs → wants planner per subject: a person gets a portrait, plus an event photo when `specificity = 'story'`; an organization gets the logo bank and HQ; a product gets the product and its logo; `moment` gets a key-moment want from the story URLs plus Serper.
   - The article lead image is a first-class source for `'story'` needs.
   - Accept: AI Drama's existing tests pass unchanged; `findPhotos` passes stubbed tests for every profile (bank hit, article image, person by QID, story-specific moment, nothing found → null, cap respected, no duplicate in a set).
4. **Owner D: the adopters.**
   - Files: `lib/stories/photos.ts` (adapter), `lib/lfd/photos.ts` (drop `lead-image.ts`), `lib/stories/build/{morning-download,guess-the-number,free-vs-paid}.ts` photo calls only (coordinated with A on `morning-download.ts`: A owns ranking, D owns the one photo call), `lib/revisions/descriptions/*-live.ts`, `lib/social/pipeline/design-stage.ts`, and the five used-photo reads → `used.ts`.
   - Accept: every content type's existing photo tests pass or are updated to the new behavior, with each change listed; `npx tsc --noEmit` is clean.
5. **Review (fresh, read-only):**
   - Cross-check every contract name against the code.
   - Apply the prompt lens to the new question set: altitude, no examples, no contradictions with major-news.
   - Rank findings must-fix / should-fix / nit. Fixes are routed to owners until no must-fix remains.

## Verification
1. **Offline:** run every touched test file plus the AI Drama harvest tests, filtered to pass/fail counts, then tsc and lint.
2. **Builder calibration replay** (needs Lucas's go-ahead): 4 past LFD windows, about 520 Jev calls, roughly
   **$0.10–0.20**. It prints the builder picks at each bar; Lucas looks at the picks, and the bar is set for about half in
   LFD. Tune the bar, never the wording.
3. **One real run** (needs Lucas's go-ahead): one LFD run and one Morning Download build, run locally against prod data.
   - Estimate: Jev under $0.10, writer and vision as today, photo finder roughly **$0.15–0.30 per post** (Serper plus Haiku looks), with each profile's `capUsd` as the hard stop.
   - Deliver: the posts, the cost, the photo traces for any slide that fell back, and the builder share.
4. **Ship, after Lucas approves the output:**
   - Commit.
   - Apply `stories.judgments` to prod.
   - Redeploy the social worker; Lucas runs it after a VM hash check.
   - Carousels move last, in the same release, once one carousel run has been checked.

## Appendix: `story-builder@1` wording (DRAFT; Lucas approves at the review gate)
- `made_or_found`: Is the story centrally about a specific person, team, startup, lab or company that built, discovered or newly applied something using AI: a product, a tool, a project, a scientific or medical finding, or a new use in its field?
- `pushes_limits`: Does what they did go beyond what had been done before: a first, a record, a result people thought was out of reach, or AI doing real work in a field that had not used it this way?
- `shown_working`: Does the story report it working in the real world: a shipped product, a live demo, a measured result, a real case or real users? A plan, a funding round, a hiring push, or a claim with no result does not count.
- `routine_launch` (−): Is it mainly a routine product, feature, pricing or model launch from an established tech or AI company, rather than a striking result or a first?
- `speculative` (−): the same wording as major-news@3.

## Phase 1 contract (design, 2026-11-08; Reels and Carousels untouched)
- **Store:** a new `intake` schema. Intake never writes to `reels.*`.
  - The intake fetches every source an open order names, by itself: the reels primary adapters (`primaryAdapters()`)
    and the 19 `HELIOS_SOCIAL_FEEDS`. A URL on both lists is fetched once. It reads nothing from `reels.*`, so LFD and
    MD get their sources whether Reels runs or not.
  - Claude web search finds are deposited straight into the intake by the Reels adapter (`depositFind`, like a seed),
    alongside its normal `reels.sources` write. They exist only on nights Reels runs, because that call is Reels'
    own ideation (exempt).
  - Tables: `intake.runs`, `items` (unique on `storyKey`), `stories`, `pair_decisions`, `scores` (primary key
    item_key + scorecard version), and `pool` (primary key order + story; retention LFD 10 days, MD 4; used and `yours`
    rows are never dropped).
- **Clock:** inside `helios-social`'s serial claim loop.
  - Main run at 12:00 (night schedule v2, round 4). It does not wait on Reels.
  - Top-up at 2:40.
  - `ensureIntakeFresh` runs before manual LFD runs and MD Generate (stale after 180 minutes). It never fails the caller.
- **Grouping:** reels `grouping-v2` is the one engine.
  - grouping-v2 runs as a library over the intake's own items. Exact key matches cost 0 calls, and pair decisions are
    cached in `intake.pair_decisions` only.
  - The pick-time repeat check stays as a safety net.
- **Orders** (`lib/intake/orders.ts`): LFD and MD, opened and closed from each type's existing settings and open seeds.
  With no order open, the run is skipped and nothing is fetched.
- **Scorecards:** every judgment another type reads today becomes an intake scorecard. A scorecard runs when an open
  order names it, whether or not the type that built it is running (round 4).
  - `reels-screen` (the reels ingest screen), on reels-adapter items, so the same items are dropped as today.
  - `reels-score` (pass 1 + pass 2 → net, blockbuster, bucket: timely, The Number, Ball Knowledge), called as a
    library from `lib/reels/jev/questions` and `lib/reels/scoring`, with no change to their wording.
  - `story-scoring@4`, without its `already_posted` question. Each order applies that check at pick time against the
    same posted list it uses today, so the carousel-posted exclusion that MD gets today stays the same.
  - `major-news@3` and `story-builder@1`.
  - Cache key: (story, scorecard version, member-set hash). When new coverage joins a story touched in this run, the
    story is re-scored, the way today's nightly runs score fresh groups. This replaces "re-score once on doubling".
    Untouched stories are never re-scored (no sweep).
  - Until Phase 2, Reels and Carousels still run their own scoring too: about $0.06 a night of duplicated Jev, measured
    from `reels.cost_events` over 7 days.
- **Pools:** LFD reads `intake.pool`. MD keeps `stories.pool`, refreshed from it. Pickers only pick.
  - LFD: seeds (at most 3) → lead queue by margin (majors at most 3, builders uncapped) → rundown → 6.
  - Builder lane entry: the event happened in the last 7 days (round 3).
  - MD: lead queue by margin, builders at most 2 of 5, minimum 2.
- **Seeds:** one `addIntakeSeed`. A seed is read, joins or creates a story, is scored on entry (at most 2 Jev calls),
  and lands in the pool marked `yours`.
- **Budget:**
  - About $0.15–0.30 a night (reels screen, grouping and scoring are about $0.06 today; plus story-scoring, major-news,
    builder and re-scores). That's about $5–9 a month, and it drops in Phase 2 when Reels' and Carousels' own scoring
    retires.
  - Caps: $0.50 for the main run, $0.15 for the top-up.
  - Calibration and equivalence replay (one dry run, writes nothing): 3 past nights, about $0.60–1.00, and needs `--go`
    plus Lucas's go-ahead with that estimate.
- **Owners** (no shared files; `lib/intake/types.ts` is written first and then frozen):
  - **A:** intake core and worker clock.
  - **B:** scorecards, orders, pools, seeds and calibration.
  - **C:** Morning Download.
  - **D:** Last Few Days and the hub view.
  - **E:** read-only review, including a Rule 2 grep audit for any unbounded loop over `intake.items` or `reels.*`.
  - Each owner's pass/fail criteria are in the design notes and get copied into its brief.
- **Deploy (after approval):**
  0. Merge `origin/main` into `reels-iterations` (clean in a test merge), then create the build worktree off `origin/main`.
  1. Tests, tsc and lint.
  2. Calibration.
  3. Apply the schema to prod (read-only verify).
  4. VM hash check, then the social VM deploy (Lucas runs it), then Vercel.
  5. Read `intake.runs` the next morning.
  6. One real LFD run and one MD build, with Lucas's go-ahead.
  - Rollback: revert and redeploy.
- **New risks from the design:**
  - Intake makes Jev calls in the reels and explainers hours, an exception to the one-type-per-hour rule (Q4).
  - A wrong global merge hides a story from both LFD and MD.
  - Scores freeze at first scoring.
  - On carousel days, the feeds are still fetched twice until Phase 2.

## Round 3 (Lucas, 2026-11-09)
Answers to the pre-mortem questions:
- Q1: "Builder stories need to be from the last 7 days." This is the event's date, not the date we ingested it: the
  article's own date where the page states one, else a Jev "when did this happen" answer. It applies to the builder
  lane in both LFD and MD (MD's 4-day pool window still bounds MD).
- Q3: "No cap on builder stories." The calibrated `BUILDER_BAR` is the only control, so the calibration replay and
  Lucas's review of its picks are required before ship.
- Q4: "Yes, it can." The intake may make Jev-only calls at 1:45 and 2:40 AM.
- Q2 (photo slice): **yes, in Phase 1**, for LFD builder slides only.

Round 3b (Lucas, 2026-11-09):
- **Undated builders:** "Let them in, but please make sure the llm finding them is aware of the time window we're
  looking for. What would be even better is if claude can just know what we need and we can add the real date to be
  carried with the fetch."
  - Claude web search (`lib/reels/prompts/web-search.ts`, `web-search-v2` → `v3`):
    - The window and today's date go in the per-night user message, not the cached system text.
    - The report schema gains a required `happened_on` field: the date the main event happened, or null when the
      sources don't state it. The prompt states the 7-day window as the target.
    - Lens check: no example, no contradiction with "never invent a date".
  - `lib/reels/adapters/web-search.ts:522` writes `publishTime = happened_on ?? now` (today it is always `now`), so
    every reader gets the real date.
  - Side effect: Reels' two nightly Claude-search stories also lean recent.
  - Builder recency uses the best known date: `happened_on`, else the feed's publish date. A story with no date is let
    in. No extra Jev "when" question.
- **Re-score on growth: yes.** Refined in round 4: the story is re-scored when new coverage joins it (see Scorecards in
  the Phase 1 contract).

**Phase 1 photo slice (LFD builder slides only; Owner D):**
- For a builder slide, LFD calls AI Drama's harvest engine directly (`planWants` and `runHarvest` from
  `lib/reel-ai-drama/harvest/`, not moved yet).
- Wants: a portrait for each named person, plus one key-moment shot from the story URLs and Serper. The article lead
  image comes first; editorial sources are credited.
- LFD keeps the existing 7-day reuse window and the rendered-slide vision check.
- Cap: $0.15 per post. Estimated $0.05–0.15.
- Major and rundown slides keep today's finder until Phase 3.
- Tests: stubbed only (bank hit, person found, nothing found → today's finder, cap respected).

**Main moved: Field Notes (Tommy, PR #28).**
- What it is: an AI-tips post of 3–6 tips over the team's own photos. It runs at noon, manual only (auto_run is off).
- Sources: about 27 public sources (Claude/Codex/Gemini/Cursor/Copilot changelogs, GitHub topics, Show HN, Simon
  Willison, One Useful Thing), collected by `collectThinCandidates(SOURCE_REGISTRY)` in `lib/field-notes/live.ts`.
- Scoring: its own Jev set, `field-notes-score@3` (`lib/field-notes/sources/{questions,score}.ts`), applied to new
  candidates only, never to stored rows.
- Overlap: Reels already fetches Hacker News and markdown changelogs (`lib/reels/adapters/{hacker-news,markdown-changelog}.ts`).
- Placement:
  - Field Notes pulls web sources, so by Lucas's rule it gets an intake order in **Phase 2**, next to GTN and FvP.
    Its unit is a tip, not a news story, so its order names its own sources and its own scorecard.
  - Its photos are the team's own uploads (`lib/field-notes/photos/`), not web photos, so it **stays out of the Phase 3
    shared photo finder**.
  - The builder lane leaves practical dev tips (repos, changelog entries) to Field Notes. `routine_launch` and
    `shown_working` already push those out; the calibration review checks it.

**Branch.** `reels-iterations` is 3 commits behind main and 1 ahead (`081dec3b`, the rembg bootstrap, already on
`origin/reels-iterations`), so a true fast-forward is impossible. Step 0 after approval: merge `origin/main` into
`reels-iterations` (a test merge reports no conflicts). The Phase 1 build still happens in a fresh worktree off
`origin/main`, so it includes Field Notes.

**Audit of the plan's shape (2026-11-09).**
- Build order inside Phase 1: the scorecard, `leadOf` and the picker changes come first, because they are pure and the
  calibration replay needs only them. The store, clock and deploy follow. Builders land as soon as Phase 1 ships, not
  later.
- **The intake owns its sources from Phase 1** (Lucas, 2026-11-09: "One of the main reasons for building this is to make
  the source ingestions not be dependent on a certain content type (reels). LFD and MD should be able to call upon
  those sources by themselves.")
  - LFD's and MD's orders name the sources they want (the reels adapters and the feeds). The intake fetches them itself
    (plain HTTP, no model calls), groups them, and scores them. It never reads `reels.*`.
  - The only remaining link is one-way: Reels deposits its Claude web search finds into the intake.
  - Until Phase 2, Reels keeps its own fetch, so on nights Reels runs, its adapters are fetched twice. Those are free
    HTTP calls. Phase 2 puts Reels on an intake order and removes its own fetch.
  - Tests (Owner A):
    - Reels off: LFD and MD pools still fill from the adapters (stubbed HTTP).
    - No open order: nothing is fetched.
    - Nothing in `lib/intake` imports a `reels.*` table query.
- Still-live pre-mortem risks: #1 (undated builder finds), #2 (noise, now uncapped), #3 (photos, Q2), #4 (live
  pipeline), #6 (grouping), #7 (cache keys), #10 (LFD/MD overlap), plus "scores freeze at first scoring".
- Settled by guards or decisions: #5 (top-up), #8 (no sweep), #9 (caps and a cost bucket), #11 (owners update the specs),
  #12 (worktree), #13 (readers listed).

## Round 4 (Lucas, 2026-11-09): same stories, independent types, same access
Lucas:
- "In terms of what stories come through to certain content types, our end result after this plan should make it
  largely the same."
- "field notes ingestion/production should be set to run at 2 AM, not noon."
- "My main concern right now is dependencies that we're removing that will result in behavior changes."
- "I want you to re-evaluate some of the decisions you made based on my desire for every content to be independent of
  each other in their dependencies and also my desire for every content type to still have access to all the same stuff
  it currently has access to."
- Earlier the same day: "One of the main reasons for building this is to make the source ingestions not be dependent
  on a certain content type (reels). LFD and MD should be able to call upon those sources by themselves."

**Today's cross-type dependencies (mapped 2026-11-09)**, in three kinds:
| Reader | Sources it borrows | Judgments it borrows | Outputs it borrows |
|---|---|---|---|
| LFD | reels adapters (via reels), 19 feeds (own fetch) | reels net + blockbuster (rundown), carousel shortlist | none |
| MD | reels slate, carousel run | reels "timely" bucket, carousel qualified (story-scoring@4) | none |
| GTN | reels slate, carousel run | reels "The Number" bucket, carousel shortlist | carousel brief numbers (`social.posts`) |
| FvP | reels slate | reels "Ball Knowledge" bucket | none; GitHub Trending hints |
| Memes (LFD) | none | none | LFD posts (by design: memes of the LFD post) |
| AI Drama / Real Case | none | none | Stories news reads as context |

**The rule that settles them all:**
- Sources and judgments belong to the intake, not to a content type.
- A type's order names the sources and scorecards it reads today. The intake fetches and scores them whether or not the
  type that first built them is running.
- Outputs (a finished post) stay readable but optional. Nobody waits on another type's post.

**Re-evaluated decisions:**
- *Reversed:* "Reels scores are not read." The intake runs `reels-score`, so LFD's rundown and MD's timely ideas keep
  today's ordering.
- *Reversed:* "MD loses the story-scoring@4 gate." The intake runs it, and `already_posted` moves to pick time, against
  today's lists.
- *Added:* the reels ingest screen runs in the intake on reels-adapter items, so the same junk is dropped.
- *Refined:* re-scoring happens when new coverage joins, matching today's nightly re-scoring (see the contract).
- *Kept:* the intake fetches reels adapters itself; Claude web search finds are deposited by Reels (its own ideation,
  exempt). LFD and MD see them on the same nights they see them today.
- *Kept:* one grouping engine (grouping-v2), checked by the equivalence replay below.
- *Kept:* the readers AI Drama, Real Case and Memes use keep their contracts unchanged (pre-mortem #13).

**Intended differences (the only ones):** the builder lane (LFD and MD), the Phase 1 photo slice for LFD builder slides,
and Claude web search's recency window plus a real event date (Reels' two nightly finds lean recent).

**Common-sense patches (no decision needed):**
- *Equivalence replay:* before ship, one dry replay of 3 past nights runs today's selection and the intake path side by
  side. It must show at least 80% of the same stories per type outside builder picks. Any gap is explained or fixed
  before ship. It shares the run (and the go-ahead) with the builder calibration.
- *Freshness:* LFD's manual runs and MD Generate call `ensureIntakeFresh`, as already planned, so "fetched live at
  3 AM" behavior is kept within the 2:40 top-up.
- *Failure isolation:* an intake failure never blocks a type. LFD and MD fall back to today's path behind the switch
  until the switch is removed in Phase 2.
- *Order lifecycle:* each order opens from its type's own settings (enabled, auto, or a pending manual run) and its open
  seeds. It never opens because another type is on.

**Field Notes at 2 AM (patched; the hour clash is question 2):**
- The noon run becomes 2:00 AM on its days (`FIELD_NOTES_AUTO_DAYS`, Tue/Fri), changed in `lib/field-notes/config.ts`
  (`FIELD_NOTES_RUN_HOUR_LOCAL`) and `docs/social-overnight.md`.
- `auto_run` stays the switch it is today.
- In Phase 1 it keeps its own fetch. In Phase 2 it reads its intake order, which the 12:00 intake run has ready well
  before 2:00 (night schedule v2).
- The posting window stays 2:30–3:30 PM.

### Round 4 answers (Lucas, 2026-11-09)
1. **GTN and FvP move to Phase 1.** Owner C takes all three Stories series in `lib/stories/pool.ts` (orders MD, GTN,
   FvP). Phase 2 is now Reels, Carousels, Field Notes and the meme lab.
   - GTN's order: the reels adapters and the feeds, plus `reels-score` (for the "The Number" bucket) and
     `story-scoring@4` (for today's carousel shortlist).
   - FvP's order: `reels-score` (for the "Ball Knowledge" bucket), plus GitHub Trending as a source.
2. "Yes, share the hour. Lets move to a two-content-type per hour rule and try to stack everything so they run
   efficiently in parallel and are done earlier in the night (optimize the schedule)." → the schedule below.
3. "Fully independent. It should still see the same sources though." → GTN stops reading carousel brief numbers.
   - It runs its own extractor (`gtn-extract@1`, `lib/stories/prompts.ts`) on every shortlisted story, not only the
     ones without a brief.
   - The shortlist comes from the same sources and the same `story-scoring@4` ranking the carousel uses, so GTN sees
     the same stories.
   - Cost: one extractor call per shortlisted story. Measure it from the Stories cost rows before the build, and keep
     prompt caching on the stable prefix.
   - Intended difference: GTN's numbers may differ from the carousel's for the same story.

### Night schedule v2: at most two content types per clock hour, done about an hour earlier
Pairing rule: two runs may share an hour, but never two video renderers, because all of them run on one social VM.
The intake is shared infrastructure (Jev scoring only) and doesn't count toward the two.

| Time | Runs | Today | Why |
|---|---|---|---|
| 12:00 | AI Drama night fill + **intake main** | AI Drama 12:00 | Intake needs nothing, so it goes first and every type after it reads a scored pool. |
| 12:30 | Reels song ingest | same | Light. |
| 1:00 | Reels night run | same | Keeps its hour. Its Claude web search finds are deposited into the intake as they arrive. |
| 2:00 | Explainers idea cycle + **Field Notes** | Explainers 2:00, Field Notes noon | Lucas's 2 AM. One video renderer plus one slide renderer. |
| 2:40 | **intake top-up** | new | Fresh news for the 3:00 pair. |
| 3:00 | Carousels or LFD (on its days) + **IG Stories sets (MD, GTN, FvP)** | Stories 4:00 | Both are slide builds reading the same fresh pool. Everything is done by about 3:30 instead of 4:30. |
| 5:00–5:45 | insights sweeps | same | Unchanged. |

- This replaces the intake times in the Phase 1 contract (main 1:15 → 12:00; top-up 2:40 stays).
- Posting windows are unchanged, and MD now builds 1 hour earlier (8:30 AM post, 3:00 AM news cut-off plus the top-up).
- Before deploy, a read-only check: the last 7 nights' run lengths per type from each type's runs table, and peak memory
  from the social VM journal for the 2:00 and 3:00 pairs. If a pair overlaps badly, it is re-paired before deploy.
- Code: each type's clock constant (AI Drama, Reels, Explainers, Field Notes, Carousels/LFD, Stories) and
  `docs/social-overnight.md` ("one type per hour" becomes "two per hour, never two video renderers"). It ships with the
  Phase 1 deploy; Lucas runs the VM redeploy after a hash check.

## Phase 2 (Lucas, 2026-11-10): Reels, Carousels, Field Notes and the meme lab on intake orders
Scope: each of the four stops fetching its own sources and reads the intake. Same rules as Phase 1: same stories per
type, every type independent, every type keeps access to what it has today.

| Type | After Phase 2 |
|---|---|
| Reels (1 AM) | Reads stories the 12:00 intake run already screened, grouped and scored (reels-screen, reels-score). Its Claude web search stays Reels' own call; finds are deposited and scored on entry. |
| Carousels (3 AM, off since Nov 2) | Reads the intake's story-scoring@4 shortlist; "already posted" is checked at pick time, as in Phase 1. |
| Field Notes (2 AM) | The intake fetches its ~27 sources as their own family and runs `field-notes-score@3` as an intake scorecard; Field Notes reads its candidates. Sources shared with Reels are fetched once. |
| Meme lab | Reads LFD's intake lanes instead of the legacy reels/carousel lanes. |

Lucas's answers (2026-11-10):
1. Reels' idea pool: "Ok sure but by the time this phase is done b has to be implemented." → Phase 2 first mirrors
   intake stories into Reels' tables (step a, readers unchanged), then moves every Reels reader onto the intake directly
   (step b) and retires the mirror. Phase 2 is not done until (b) ships.
2. Spend: "You're authorized for $5" (replay plus one real Reels, Carousels and Field Notes run, nothing posted).
   The build pauses only at the replay review and the test-output review.
3. Sources stay per type: an order names only the sources the type reads today. Sharing sources across types (for
   example Field Notes' blogs into LFD's builder lane) is a separate decision after a few weeks of builder picks.

Common-sense patches (no decision needed):
- Per-type switch with stale and error fallback to the type's own path, as in Phase 1.
- Equivalence replay: at least 80% of each type's legacy stories per night, gaps explained or fixed.
- Legacy fetch code stays behind the switches and is deleted after two clean weeks (Phase 1's legacy paths too).
- Ship gate: build now; ship only after Phase 1's first two nights (including the Nov 10 LFD run) check out clean.

### Phase 2 deploy order (must hold; review must-fix 1)
Legacy-mode readers now read `reels.idea_sources_v`, and intake reads select Phase 2 columns, so code must never reach
Vercel or a VM before the schema:
1. Apply `db/intake_schema.sql` (Phase 2 additions are additive and idempotent) to prod, then
   `db/reels_intake_views.sql`. Read-only verify both.
2. Merge; Vercel deploys. Hash the social VM, re-read the worker log, deploy the social worker and the reels worker
   code (`./scripts/gcp/deploy-social-worker.sh`, `./scripts/gcp/deploy-worker-code.sh`).
3. Switches stay 'legacy' for reels, carousel and field-notes until one real run of each is reviewed; then flip one
   type at a time.
