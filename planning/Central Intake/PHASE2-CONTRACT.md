# Central intake Phase 2: shared contract (2026-11-10)

Read with `PLAN.md` § "Phase 2" and `DECISIONS.md` CI-24..CI-26. Branch `feat/central-intake-phase2` (off main
c9589d8, which has Phase 1). Every name below is fixed; an owner who needs a change asks the lead, never edits
another owner's files.

## Rules every owner keeps
- **Same stories, independent types, same access.** Each type gets the stories it gets today from the same sources it
  reads today (CI-26: no cross-type source sharing). A type never waits on another type's run or output.
- **Switch + fallback.** Each type keeps its legacy path behind `intake.settings.consumers.<order>` ('legacy' by
  default). Intake mode falls back to the legacy path when the intake is stale (`readConsumerMode` → 'stale-fallback')
  or the intake read throws. Never delete legacy code in Phase 2.
- **CLAUDE.md Rule 1/2.** Tests stub every model and HTTP call. No live Claude, Jev, Serper or web calls. No loop over
  stored rows to score them: only items new to a run (or a seed) are scored.
- **Prompt caching** on any new or changed `messages.create` (there should be none in Phase 2).
- Tests: node:test files under `tests/`, offline, PGlite for SQL (see `tests/intake-*.test.ts` for the pattern).
  Report pass/fail counts only.

## Frozen types (already in `lib/intake/types.ts`)
- `Family` adds `'field-notes'`: Field Notes' own sources; each item is its own story, never grouped with others.
- `OrderId` adds `'reels' | 'carousel' | 'field-notes'`. `ConsumerSettings` (Record<OrderId, ConsumerMode>) therefore
  has seven keys; missing keys read as 'legacy'.
- `ScorecardId` adds `'field-notes-score'`; `ScorecardResult` adds
  `{ kind: 'field-notes-score'; score; tags: TipTags; answers }` (from `scoreFromAnswers`).
- `IntakeRunKind` adds `'deposit'`; `INTAKE_DEPOSIT_CAP_USD = 0.15`.

## The Reels idea id (the core of option b)
- **A Reels idea id is its intake story id.** In intake mode Reels never creates an idea id of its own: for every
  intake story it uses, it upserts a registry row `reels.post_ideas (id = intake.stories.id)`. That row keeps Reels'
  own per-night state (`first_seen`, `last_joined`, `timely`, `version_n`) and satisfies the ~15 foreign keys
  (idea_scores, idea_copy, visual/video jobs, published_status, locks, ...). No schema change to those tables.
- **Content comes from the intake.** In intake mode Reels writes no `reels.sources` or `reels.post_idea_members` rows.
  Every reader that needs an idea's headline, URL, body, outlets or members reads the view below.
- Merged stories: when `intake.stories.merged_into` is set, the surviving story id is the idea; the registry row of
  the merged one keeps its history and is not offered again (`resolveStoryId` follows the chain).

### View `reels.idea_sources_v` (Owner E, `db/reels_intake_views.sql`)
One row per member of an idea, legacy and intake alike:
`post_idea_id uuid, member_key text, url text, headline text, body text, source_name text, adapter_id text,
family text, role text ('primary'|'supporting'|'merged_duplicate'), publish_time timestamptz, ingest_time timestamptz,
drop_reason text, origin text ('legacy'|'intake')`.
- legacy branch: `reels.post_idea_members` ⋈ `reels.sources` (empties naturally: `reels.sources` rows are deleted
  after 21 days).
- intake branch: `intake.items` with `story_id = post_idea_id` (role from `items.role`, adapter_id from
  `reels_source_id` else `source_id`, drop_reason from `reels_drop_reason`), plus items of stories merged into it.
- Intake item retention must cover every reader's window: at least 21 days, and never drop items of a story that has
  a `reels.published_status` row or an `idea_copy` row (Owner A).

## Owner A: intake core (`lib/intake/**`, `db/intake_schema.sql`, `scripts/intake/**`)
1. Fix the two type errors; `readConsumerSettings` covers seven keys.
2. **Orders** (`lib/intake/orders.ts`):
   - `reels`: sources `'reels:*'` (primary adapters) + search deposits; scorecards `reels-screen`, `reels-score`;
     lookback 14 days; open when Reels' own settings say it runs tonight or a Reels run/seed is pending.
   - `carousel`: sources `'feeds:*'` + `'reels:*'` (today's carousel also re-fetches the reels adapters); scorecard
     `story-scoring`; lookback 2 days; open from social's own auto/run settings.
   - `field-notes`: sources `'field-notes:*'` (every SOURCE_REGISTRY entry); scorecard `field-notes-score`; lookback 45
     days; open when `field_notes.settings` auto_run is on or a Field Notes run is requested.
3. **Field Notes fetch** (`lib/intake/fetch.ts`): `fetchFieldNotesItems(deps)` calls `collectThinCandidates(SOURCE_REGISTRY, …)`
   and stores each `TipCandidate` as an `IntakeItem` (family 'field-notes', key = `canonicalSourceUrl`). An item
   already stored from a reels adapter (same key) gains field-notes membership, so it is fetched once. Grouping skips
   'field-notes' items; each becomes its own story.
4. **Scorecard** `FIELD_NOTES_CARD` (`lib/intake/scorecards.ts`): wraps `scoreCandidate` (field-notes-score@3, wording
   unchanged), enriching the body only for items it scores. Per run it scores at most Field Notes' `MAX_SCORED_PER_RUN`
   in Field Notes' own `scoringOrder`; the rest carry to the next run (the existing carried/unscored mechanism). It must
   not read `field_notes.tips` (per-type state); Field Notes drops already-stored links at pick time.
5. **Deposit run**: `runIntakeDeposit(q, deps): Promise<{ runId; record }>` in `lib/intake/run.ts` — kind 'deposit',
   no fetch; groups and scores items first seen since the last successful run with the open orders' scorecards; cap
   `INTAKE_DEPOSIT_CAP_USD`. Never fails the caller.
6. **Read helpers** (`lib/intake/read.ts`): `resolveStoryId(q, id)`; `listOrderStories(q, order, { since, needScores })`
   (a thin wrapper over the existing `listStories` that applies the order's sources and kept memberships).
7. **Retention** as stated under the view.
8. **Replay** (`scripts/intake/replay.ts`): add Phase 2 comparisons, same ≥80% rule:
   - Reels: per night, legacy slate ideas (selected + top 10 by net) vs the intake path's.
   - Carousel: the last nights with a carousel run (≤ Oct 28): its stored `selection.scored` articles as items, legacy
     shortlist vs the intake shortlist.
   - Field Notes: legacy candidate tips from `field_notes.tips` of past runs vs the intake's scored field-notes items.
   Writes nothing to the real DB (in-memory PGlite, read-only snapshot), as today. Default cap $1.00.

## Owner B: Reels pipeline (`lib/reels/pipeline/**`, `lib/reels/seeds.ts`, `lib/reels/seed-search.ts`, `lib/reels/repository.ts`, `lib/reels/adapters/awesome-lists.ts`)
In intake mode (`readConsumerMode(q, 'reels', now) === 'intake'`), `executeRun` becomes:
1. Budget gate as today.
2. Derived adapters (A4 awesome-lists, B6 web-search) run as today, but deposit into the intake
   (`lib/intake/deposit.ts`; add A4) and write no `reels.sources` rows. Primary adapters are not fetched.
3. `runIntakeDeposit`.
4. Register ideas: for each story from `listOrderStories(q, 'reels', …)` with a kept reels/search member, upsert the
   registry row; `timely = (latest sighting of a kept reels/search member >= runStartedAt)` (the Phase 1
   `reelsLastSeen` rule, D-059 parity).
5. `scoreRun`: candidates as today (timely ideas + carryovers + today's slate). Scores come from the story's stored
   `reels-score` result (InterpretedScore); no `scoreOneIdea` call for a story the intake scored. A legacy idea id
   (carryover from before the switch) with no intake score is scored the legacy way.
6. Everything after the slate (fill, copy, slots, schedule, retention, finish) unchanged.
- Seeds (`addReelSeed`) in intake mode: `addIntakeSeed` with order 'reels', register the idea, `writeSeedRow` from the
  stored score.
- `loadIdeaMaterial` and every pipeline read of members/sources read `reels.idea_sources_v`.

## Owner C: Carousels (`scripts/social_daily.ts`, `lib/social/pipeline/selection-stage.ts`, `lib/social/ingest/select/**`, `lib/carousels/hub-sources.ts`)
In intake mode (`'carousel'`): no feed or hub-adapter fetch, no `groupArticles`/`scoreGroups` calls. Selection reads
the intake's stories with a `story-scoring` result (`listOrderStories(q, 'carousel', …)`), applies today's code filters
and the posted check at pick time, then `rankQualified → mergeSameEvent → spreadByCompany → pickWinners` as today.
`social.runs.record.selection.{scored,shortlist}` keep their exact shape (readers: LFD carouselLane, Stories, hub,
pinned/promote, meme sim). In intake mode, write `social.feed_health` from the intake run record's per-feed results so
feed health keeps working.

## Owner D: Field Notes (`lib/field-notes/**` except `sources/questions.ts` and `sources/score.ts` wording)
In intake mode (`'field-notes'`): `collect` + `scoreCandidate` are replaced by reading the order's scored stories
(`listOrderStories(q, 'field-notes', { since: now − 45 d, needScores: ['field-notes-score'] })`), dropping links already
in `field_notes.tips`, and saving each as a candidate tip with the stored score and tags (`saveCandidateTip`, same
columns, `score_version` = the scorecard version). `selectStoredTips` and everything after are unchanged. No Jev at
pick time beyond today's posted-duplicate check.

## Owner E: Reels readers + meme lab (option b) (`db/reels_intake_views.sql`, and the reader files listed in `planning/Central Intake/phase2-reels-readers.md`)
1. Create `reels.idea_sources_v` exactly as specified.
2. Move every reader that joins `reels.post_idea_members`/`reels.sources` for an idea's content onto the view
   (Stories/LFD legacy readers excepted: they are the legacy path). Behavior on legacy rows must not change.
3. Meme lab: `lib/memes/lfd-source.ts` uses `intakeLanes` when the 'lfd' switch is 'intake', else today's lanes;
   `lib/memes/lfd-sim/*` keep their legacy replay (historic days) and gain intake lanes for days after the switch.

## Review (fresh, read-only, after builders)
Cross-check every name here against the code; Rule 2 grep audit (no unbounded loop over intake.items / reels.*);
switch-off parity (legacy mode byte-identical behavior); FK safety of registry ids; view correctness on mixed
legacy/intake data. Ranked must-fix / should-fix / nit.
