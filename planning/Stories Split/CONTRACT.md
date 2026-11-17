# Stories Split: contract

Plan: `/Users/lucasfigueroa/.claude/plans/harmonic-sniffing-magpie.md`, Lucas's approval 2026-11-16.

"IG Stories" becomes **Morning Download**. "Are you smarter than AI?" and "Real or AI?" each become a hub content type of their own. All three keep one shared Stories engine.

Worktree: `/Users/lucasfigueroa/HELIOS/CODE/Helios-Hub-split` (branch `feat/stories-split`, off origin/main, with feat/ai-trivia and the Real or AI? work merged in **uncommitted**).

This file is the single source for every name that more than one owner touches. If a builder needs a shared name that isn't here, it asks the integrator rather than inventing one.

## §0 Rules for every builder (required)
1. **No git.** No commit, push, merge, stash, reset or checkout. Edit files only.
2. **No live calls.**
   - Never call the live Claude API, `web_search`, OpenAI, Jev, Commons, NASA or Supabase.
   - Tests stub every model and fetch.
   - Never run `tests/*.integration.ts`.
   - Run test files by exact name only, through `.stories-local/run-tests.sh <out> <file>...`, which strips DB and API keys.
3. **No production writes.** No `psql` against `DATABASE_URL`, and no deploy scripts.
4. **Edit only the files your section owns (§3).** If you need a change in someone else's file, write it in your report under "Requests for other owners"; don't make it.
5. **Keep behaviour.** Morning Download, Trivia and Real or AI? produce the same sets as today. This is a re-homing, not a redesign.
   - Don't touch trivia visuals (`lib/stories/trivia/render/**`, `TriviaSlide`, `trivia.css`): Lucas is still iterating on them.
   - Don't touch any prompt wording.
6. **Engineering style.** Match the surrounding code: comments cite decision ids (use `SS-n` for this split), with no new dependencies.
   - SQL must re-apply cleanly on live data: `IF NOT EXISTS`; drop and re-add CHECKs `NOT VALID` then `VALIDATE`; one transaction per file.
7. **Finish with** `npx tsc --noEmit -p .` clean for your files, plus your tests passing. Report in **at most 40 lines**: files changed, tests run with pass/fail counts, open issues, and requests for other owners.

## §1 Keys and labels

| vertical id | label | short | href | series (engine key) | lead days | days |
|---|---|---|---|---|---|---|
| `stories` | Morning Download | Morning | /morning-download | `morning_download` | 0 | every day |
| `ai_trivia` | Are you smarter than AI? | Trivia | /ai-trivia | `ai_trivia` | 2 | Sun, Mon, Thu |
| `real_or_ai` | Real or AI? | Real/AI | /real-or-ai | `real_or_ai` | 2 | Tue, Sat |

- **Shared fields.** All three have `format: 'story'`, color vars `--sh-v-stories`, `--sh-v-ai_trivia` and `--sh-v-real_or_ai`, and a review href equal to their href.
- **Morning Download keeps the internal id `stories`.** Production rows are not renamed. `/stories` and `/stories/*` redirect to `/morning-download`, with the query kept.
- **Lab move.** The Real or AI? swipe lab moves to `/real-or-ai/lab`, and `/stories/roa-lab` redirects there. The API route `app/api/stories/roa-lab` stays where it is.
- **Retired series.** `guess_the_number` and `free_vs_paid` stay in the engine's `Series` union so their history still reads. Any old row maps to vertical `stories` and is never requested again.

## §2 Shared code written by the integrator before the builders start (do not edit)
- **`lib/social-hub/story-types.ts`:**
  - `STORY_VERTICALS: readonly ['stories','ai_trivia','real_or_ai']`; `type StoryVertical`; `isStoryVertical(v): v is StoryVertical`;
  - `SERIES_OF_VERTICAL: Record<StoryVertical, StorySeries>`; `verticalOfSeries(series: string): StoryVertical` (unknown or retired → `'stories'`);
  - `STORY_TYPE_LABEL`, `STORY_TYPE_SHORT` (§1).
- **`lib/social-hub/types.ts`:** `Vertical` gains `'ai_trivia' | 'real_or_ai'`.
- **`lib/social-hub/verticals.ts`:** `VERTICALS` and `TYPE_PAGE_IDS` carry the §1 rows.

Everything else that enumerates verticals or `'stories'` belongs to an owner.

**The rule for "is this a Stories-format type?"** Wherever code compares `vertical === 'stories'` to mean "story format", it becomes `isStoryVertical(vertical)`. Where it means Morning Download in particular (MD seeding, the MD lead queue), it stays `'stories'`.

## §3 Owners (one owner per file)

**A — Hub registration and calendar** (the largest set)
- **Code:**
  - `lib/social-hub/**` (except `story-types.ts`), `lib/content-type/**` (except `posting.ts`), `lib/posting.ts`, `lib/revisions/**`, `lib/publishing/**`, `lib/preflight/**`, `lib/social/**`, `lib/instagram/**`.
  - `components/social-hub/**`, `components/hub-shell/**`, `components/content-type/**` (except `TypeControls.tsx`, `StorySeedForm.tsx`, `ScheduleStrip.tsx`).
  - `app/**` (except `app/api/stories/**`), `middleware.ts`, `app/social-hub.css`.
  - `scripts/preflight_night.ts`, `scripts/backfill_spine.ts`, `docs/social-overnight.md`.
  - `db/social_hub_schema.sql` (comments only, if any) and the new `db/stories_split.sql`.
- **Tests:** the tests for these areas (`slots-*`, `social-hub-*`, `social-fill`, `lead-time`, `week-board-model`, `content-type*`, `revisions-stories`, `idea-pool-stories`, `idea-seeding-stories`, `publisher-approval-gate`).
- **Jobs:**
  - Every `Record<Vertical,…>` and every list of verticals.
  - Literal `'stories'` checks become `isStoryVertical` (scheduler `FeedVertical`, `isFeedSlot`, `typeHubModel`, `house.ts`, `week-edit.ts`, `placement.ts`, `rules.ts`, health, `run-today`, progress, costs, factors, analytics, revisions).
  - **Calendar per vertical:** times, `SCHEDULE_ENTRIES`, seed, the `TRAY`, plan, week chips.
  - **`lead.ts`:** `LEAD_DAYS` keyed by vertical (`ai_trivia: 2`, `real_or_ai: 2`, `stories: 0`). Drop the `stories:<series>` keys, but keep `leadDaysFor(vertical, series?)` working for engine callers by mapping the series to its vertical.
  - **Six label-map copies collapse into `lib/content-type/story-series.ts`,** which reads `STORY_TYPE_LABEL`.
  - **The central content view gets one pool card per Stories-format type:** `views/pools.ts` `REFILL_CADENCE`, `PoolScreen` `HOW`.
  - **`typeHubModel`:** the three pages no longer get series tabs. Each page shows only its own series.
  - New route pages and redirects.
  - **`db/stories_split.sql`:**
    - Widen every `social_hub` vertical CHECK: content_items, idea_adjustments, schedule slot and feed_mode, publish_attempts trigger, slot_template and slot_override series.
    - The series CHECK becomes "required, and equal to the vertical's series, for the three Stories-format verticals".
    - Move existing rows: `vertical='stories' AND series IN ('ai_trivia','real_or_ai')` → `vertical = series`, in schedule, slot_template, slot_override, content_items and idea_adjustments.
    - Seed `daily_caps` for the two new verticals.
    - Add the file to the social-hub PGlite loader the tests use.

**B — Stories engine, per type**
- **Code:**
  - `lib/stories/**` (except `trivia/**`, `roa/**`, `pool-intake.ts`, `photos.ts`, `photos-shared.ts`).
  - `lib/content-type/posting.ts`.
  - `components/content-type/{TypeControls,StorySeedForm,ScheduleStrip}.tsx`.
  - `app/api/stories/**`, `scripts/stories_worker.ts`.
- **Tests:** `tests/stories-harness.ts` and the `stories-*` tests not owned by D.
- **Jobs:**
  - **`settings.ts`:** a new `stories.settings` key `types`, holding `Record<StoryVertical, {requireApproval:boolean; publishingLive:boolean; dailyCapUsd:number}>`.
    - Old global keys (`require_approval`, `publishing_live`, `daily_cap_usd`) are the fallback for every type, so the current behaviour holds.
    - `monthlyWatchUsd` and `models` stay engine-wide.
    - New exports: `typeSettings(settings, vertical)` and `saveTypeSetting(db, vertical, patch)`.
  - **`spine.ts`:** project `vertical: verticalOfSeries(series)`.
  - **`worker.ts`, `build/index.ts`, `schedule.ts`, `repository.ts`:**
    - gate scheduling and publishing by the type's `publishingLive` and approval by its `requireApproval`;
    - the daily spend cap is per type (sum of `stories.cost_events` for the type's sets that day), and the monthly watch stays engine-wide.
  - **`posting.ts`:** each Stories-format type gets the standard days-based `PostingState`: live, generate (= series auto), autoPublish (= !requireApproval), days, cap (0–1), costPerPostMicros. The `series` patches go away.
  - **API routes:**
    - accept `vertical` (a Stories-format type) or `series`, checked against the map;
    - `generate` asks for the type's own series;
    - `settings` POST takes `{vertical, …}`.
  - **UI:**
    - `StoriesGenerate` → one Generate per type page;
    - `PostingSettings` shows the standard controls for each Stories-format type;
    - `StorySeedForm` and seeding stay Morning Download only.
  - Remove the dead fvp bits from `build/index.ts` `ORDER_OF` and `POOL_SERIES`. Keep `free_vs_paid` rows in the `Series` union and in `DEFAULT_SETTINGS.series`.

**C — Central intake (Trivia's research)**
- **Code:** `lib/intake/**`, `lib/stories/pool-intake.ts`, `lib/stories/trivia/**` (except `render/**`), `db/intake_*.sql` (new file `db/intake_stories_split.sql`), `scripts/intake/**`.
- **Tests:** `tests/intake-*`, `tests/trivia-ideas.test.ts`, `tests/trivia-opponent.test.ts`.
- **Jobs:**
  - **`OrderId` adds `'trivia'`; `TRIVIA_ORDER`:**
    - its sources are the deposit family Trivia's web finds land in (reuse Reels' deposit path, `DepositFind`; add a `search` sub-source if needed);
    - lookback 30 days, with a scorecard that fits (reuse `story-scoring` unless that is wrong for facts);
    - `isOpen` when the `ai_trivia` series is enabled.
  - The `consumers` key `trivia` defaults to `legacy`.
  - **`runTriviaDaily`:**
    - deposits the pages its writer cited (source URL + quote) into the intake;
    - in `intake` mode, hands the writer the order's recent items as material (sources already found), with stale and error fallback to legacy;
    - question writing and prompts are unchanged; the material gains an optional `research` list.
  - **Retire `fvp` and `gtn`:** `FVP_ORDER`, `INTAKE_ORDERS`, `read.ts` (`PHASE1_ORDERS` etc.), `pool-intake.ts`, and the `consumers` seed. Old rows still read.
  - Real or AI? has no intake order. Its scrapes are photo requests (owner D). Note that in `orders.ts`.

**D — Photo finder and photo bank**
- **Code:**
  - `lib/photos/**`, `lib/media-library/**`, `lib/stories/roa/**`, `lib/stories/photos.ts`, `lib/stories/photos-shared.ts`.
  - `lib/reel-ai-drama/harvest/**` (additions only; AI Drama's behaviour must not change).
  - `db/media_library_*.sql` (new file `db/media_library_stories_split.sql`), `db/social_used_photos*.sql`.
- **Tests:** `tests/roa-*`, `tests/stories-photo*`, `tests/photos-*`, `tests/media-library-*`, `tests/trivia-photo-validate*`.
- **Jobs:**
  - **`PhotoProfileId`:** add `'trivia'` and `'roa'`; drop `'gtn'` and `'fvp'`. `PHOTO_PROFILES` gets both.
    - `roa`: licence open or government, credit kept off the frame, min 1200 px tall, portrait or croppable to 9:16, no faces, brands or readable text.
    - `trivia`: today's `gtn` values.
  - `photo_finders` keys `trivia` and `roa`, defaulting to `legacy`. `SERIES_PROFILE` maps `ai_trivia→trivia` and `real_or_ai→roa`.
  - **Shared sources:** Commons Featured/Quality search and NASA image search (with EXIF via `camera.ts`) become shared finder sources.
    - `findRealPhotos` asks through the shared finder when `photo_finders.roa = shared`, and its own path otherwise (legacy).
    - Bank-first either way.
  - **Bank:**
    - licence `generated`; new columns `truth text CHECK (truth IN ('real','ai'))`, `gen_model text`, `gen_prompt text`;
    - `sightings.run_kind` adds `ai_trivia` and `real_or_ai`;
    - `BankReader.find` never returns `generated` rows unless the caller asks with `{ allowGenerated: true }` (Real or AI? only).
  - **`lib/stories/roa/intake.ts`:** after a candidate is pooled, `offer()` it to the bank.
    - Real photos: their licence and credit.
    - AI images: licence `generated`, `reuse_ok` false, and `truth`, `gen_model` and `gen_prompt` filled in.
    - A failed offer is logged and never drops the candidate.
  - **Ledger and hold:** `UsedVertical` adds `ai_trivia` and `real_or_ai`. Real or AI? real candidates are checked against `readUsedLedger` as well as its own never-repeat history, and `lib/photos/pending.ts` covers both types.

## §4 Order of SQL files (local and later production)
1. `db/stories_split.sql` (A)
2. `db/intake_stories_split.sql` (C)
3. `db/media_library_stories_split.sql` (D)

All come after the existing `db/stories_ai_trivia.sql` and `db/stories_real_or_ai.sql`. None is applied to production in this pass.
