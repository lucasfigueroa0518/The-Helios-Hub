# One-box Seeding v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One "Seed an idea" box on every content type except AI Events. A Claude call turns what the person typed into the full input that type scores, and then that type's own checks and scoring run.

**Architecture:** The branch's v1 one-box (request table, cards, ledger, search and verifier, filers) stays the base. The article types, Explainers and Field Notes run on Vercel in `after()`. Trivia and Real or AI? requests are queued for the Stories worker, and AI Drama requests for the drama worker. Each worker claims them between its own steps and runs that type's existing pipeline, made callable for one item. Both workers share the request table and the progress cards.

**Tech Stack:** Next.js route handlers (Vercel), Postgres (`social_hub`, `stories`, `reel_ai_drama` schemas), TypeScript workers on `helios-social-worker`, Anthropic Messages API with prompt caching (`lib/anthropic-cache.ts`), node:test via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-11-24-one-box-seeding-v2-design.md` (v2), on top of `docs/superpowers/specs/2026-11-04-one-box-seeding-design.md` (v1). Read both.

**Worktree:** `/Users/tommypozo/Desktop/HELIOS/The-Helios-Hub/.claude/worktrees/one-box-seeding-9dc0a9`, branch `claude/one-box-seeding-9dc0a9`. Don't create, switch or merge branches.

## Global Constraints

- **Rule 1:** no test or agent calls the live Claude API, `web_search`, OpenAI images or Jev. Every model, image and Jev client is stubbed with canned responses. Fixtures hold 1–2 items. The first live seed of each type is a person clicking in the built app.
- **Rule 2:** a seed reads only the one pool it files into (open headlines, at most 40, plus its duplicate check). Never loop over existing rows.
- **Prompt caching:** every new or changed `messages.create` puts tools → static system → user turn. `cache_control` goes on the stable prefix (`cachedSystemText`, `withToolCache`, or `writeStructured`, which already does this). The person's words and the pool headlines go only in the user turn.
- **Per-seed limits (USD):** `reels`, `carousels`, `last_few_days`, `stories`, `explainers`, `field_notes`, `ai_trivia` 0.35; `reel_ai_drama` 0.50; `real_or_ai` 0.60.
- **Reserves (USD, set aside from the limit for calls the runner can't stop):** v1 values unchanged (`reels`, `carousels`, `last_few_days`, `stories` 0.02; `explainers` 0.08). New: `field_notes` 0.02, `ai_trivia` 0.06, `real_or_ai` 0.08, `reel_ai_drama` 0.
- **Button estimates:** 12¢ for the article types, Morning Download, and Field Notes without a link; 1¢ for Field Notes with a link; 15¢ Explainers; 8¢ Trivia; 25¢ AI Drama; 30¢ Real or AI?.
- **No approval switch.** Remove `ONE_BOX_SEED_PROMPT_APPROVED` and `oneBoxApproved()`. The one box is live once merged.
- **Seedable:** every vertical except `ai_events`. The Stories series choice is removed, and `stories` always means `morning_download`.
- **Runner per vertical:** `vercel` for `reels`, `carousels`, `last_few_days`, `stories`, `explainers`, `field_notes`; `stories` for `ai_trivia`, `real_or_ai`; `drama` for `reel_ai_drama`.
- **Waiting rules:** a queued request waits at most 120 minutes. After that its card reads "The worker didn't pick this up; nothing was spent." and it is never run. Once claimed, the stale cutoff is 6 minutes (v1), or 10 minutes for `real_or_ai`.
- **Copy:** sentence case, the hub's plain style. A queued card reads "Waiting: the worker is busy with tonight's run" when queued for over 1 minute, and "Waiting for the worker" before that.
- **Worker sync:** worker code changes ship with `./scripts/gcp/deploy-social-worker.sh` in the same session as the merge.

## Review Focus

1. **A seed clicked while the drama worker runs the 10 PM session or the night.** The person expects it to wait and then run, not fail or block the night. Test in Task 9.
2. **A pool already at its cap (Trivia 50 unused, Real or AI? 40).** The person expects their seed to stay pooled and marked Yours, not be cut by the next cap pass. Test in Task 5.
3. **Field Notes with a link pasted that isn't a tool page (a news article).** The person expects it saved free as today (the page is read at Generate), with no search or page read. Test in Task 4.
4. **Two clicks of the same text inside 60 seconds on a worker type.** The person expects one request, not two worker runs. Test in Task 2.
5. **The worker dies mid-seed (deploy, crash).** The person expects the card to stop saying "working" and say whether it may have been added. Test in Task 2.

---

### Task 1: Types, shapes and the post handler for nine types (no switch)

**Files:**
- Modify: `lib/seed/one-box/types.ts`, `lib/seed/one-box/shape.ts`, `lib/seed/one-box/handle.ts`, `lib/seed/one-box/prompts.ts` (remove `oneBoxApproved`), `app/api/seed/one-box/route.ts`
- Modify: `lib/content-type/config.ts` (`seedable: true` for `ai_trivia`, `real_or_ai`, `reel_ai_drama`), `lib/content-type/seed-verticals.ts` (`SeedVertical = Exclude<Vertical, 'ai_events'>`)
- Test: `tests/one-box-route.test.ts`, `tests/one-box-prompts.test.ts`, `tests/seed-button-types.test.ts`

**Interfaces:**
- Produces:
  - `type SeedVerticalKey = 'reels' | 'carousels' | 'last_few_days' | 'stories' | 'explainers' | 'field_notes' | 'ai_trivia' | 'real_or_ai' | 'reel_ai_drama'`
  - `type Runner = 'vercel' | 'stories' | 'drama'` and `RUNNER: Record<SeedVerticalKey, Runner>` in `types.ts`
  - `OneBoxInput = { vertical: SeedVerticalKey; blurb: string; link?: string }` (no `series`)
  - `StorySeries` and the `guess_the_number` / `free_vs_paid` shapes are deleted. The `stories` shape is the old `morning_download` one.
  - `PostDeps` loses `approved`. `schedule(id, input)` is called only for runner `vercel`.

- [ ] **Step 1:** Update the failing tests in `tests/one-box-route.test.ts`:
  - `accepts every seedable type and refuses ai_events`: each of the nine verticals → 200; `ai_events` → 400 "Choose a pool that takes seeds."
  - `schedules only vercel types`: `schedule` is called for `reels` and `field_notes`, and not for `ai_trivia`, `real_or_ai` or `reel_ai_drama`.
  - `ignores a series field`: a `stories` body with `series: 'guess_the_number'` → 200, and the input has no `series`.
  - Delete the approval test in `tests/one-box-prompts.test.ts`.
- [ ] **Step 2:** Run `npx tsx --test tests/one-box-route.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the type and handler changes above. In `route.ts`, drop `approved`. GET returns `{ cards }` only (no `enabled`).
- [ ] **Step 4:** Run `npx tsx --test tests/one-box-*.test.ts tests/seed-button-types.test.ts` and `npx tsc --noEmit -p .`. Expected: PASS, apart from the two pre-existing `lib/stories/roa/{questions,screen}.ts` SDK errors. Fix every other compile error in this task.
- [ ] **Step 5:** Commit: `feat(seed): one-box takes all nine seedable types; no approval switch`.

### Task 2: Request table runner, worker claim, waiting rules, cancel

**Files:**
- Modify: `db/social_hub_schema.sql` (append idempotent `ALTER TABLE social_hub.seed_requests ADD COLUMN IF NOT EXISTS runner text NOT NULL DEFAULT 'vercel'` and `claimed_at timestamptz`)
- Create: `db/seed_requests_runner.sql` (the same two statements, for applying on their own)
- Modify: `lib/seed/one-box/requests.ts`, `app/api/seed/one-box/[id]/route.ts` (add `DELETE` = cancel)
- Test: `tests/one-box-requests.test.ts`

**Interfaces:**
- Produces in `requests.ts`:
  - `createRequest(q, input, now?)`: inserts `runner = RUNNER[input.vertical]`, with stage `'queued'` for worker runners.
  - `claimRequest(q: Query, runner: 'stories' | 'drama', now?: Date): Promise<{ id: string; input: OneBoxInput } | null>`: claims one queued request, never one queued longer than 120 minutes. Uses `FOR UPDATE SKIP LOCKED` and sets `stage = 'claimed'` and `claimed_at`.
  - `cancelRequest(q, id): Promise<boolean>`: only while `stage = 'queued'`. Sets `status = 'failed'`, message "Cancelled; nothing was spent.", and `dismissed_at`.
  - `QUEUED_MAX_MINUTES = 120`, `STALE_MINUTES_ROA = 10`.
  - `listCards`: a queued request over 120 minutes becomes failed with "The worker didn't pick this up; nothing was spent."; queued over 1 minute shows "Waiting: the worker is busy with tonight's run". The claimed stale rule is v1's, using 10 minutes for `real_or_ai`.
- `Stage` gains `'claimed' | 'writing' | 'making'`.

- [ ] **Step 1:** Write failing tests with the stub `Query` already used in this file:
  - `claimRequest returns the oldest queued request for its runner and nothing for the other runner`
  - `claimRequest skips a request queued 121 minutes ago`
  - `same text twice in 60 s on ai_trivia makes one request` (Review Focus 4)
  - `a claimed request untouched for 7 minutes reads may-have-been-added when its stage is filing, timed out otherwise` (Review Focus 5); `real_or_ai` uses 10 minutes
  - `cancelRequest works only while queued`
  - `listCards shows the 1-minute and 120-minute queued wording`
- [ ] **Step 2:** Run `npx tsx --test tests/one-box-requests.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the changes above. Queued requests don't count toward `MAX_WORKING`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(seed): seed requests carry a runner; workers claim them; queued requests wait up to 2 hours`.

### Task 3: Ledger limits and reserves per type

**Files:**
- Modify: `lib/seed/one-box/budget.ts`, plus the `run.ts` LIMIT message, which names each type's own limit
- Test: `tests/one-box-budget.test.ts`

**Interfaces:**
- Produces: `LIMIT_USD: Record<SeedVerticalKey, number>` and `RESERVE_USD: Record<SeedVerticalKey, number>`, with the Global Constraints values. `new Ledger(vertical)` has `usable = LIMIT_USD[v] - RESERVE_USD[v]` and a new `remaining(): number` (`usable - spent`, floored at 0). `limitText(v): string` returns e.g. "Stopped at the 60-cent limit; nothing was added."

- [ ] **Step 1:** Write failing tests:
  - `real_or_ai usable is 0.52`
  - `reel_ai_drama usable is 0.50`
  - `remaining never goes negative after a huge add`
  - `limitText names 35, 50 and 60 cents`
- [ ] **Step 2:** Run `npx tsx --test tests/one-box-budget.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(seed): per-type seed limits and reserves`.

### Task 4: Field Notes on Vercel: free with a link, search without

**Files:**
- Modify: `lib/seed/one-box/shape.ts` (`field_notes` shape: required `url`; the agent also returns `leaf` and `want`), `lib/seed/one-box/types.ts` (`EntryField` += `'leaf' | 'want'`), `lib/seed/one-box/prompts.ts` (Field Notes search guidance and the `report_finding` fields; new classify prompt `one-box-fieldnotes-classify-v1` and its tool), `lib/seed/one-box/run.ts` (branch), `lib/seed/one-box/file.ts` and `file-live.ts` (`fieldNote` filer → `saveSeededLink`)
- Create: `lib/seed/one-box/classify.ts`
- Test: `tests/one-box-fieldnotes.test.ts`

**Interfaces:**
- Produces:
  - `classifyLeafWant(i: { client: Client; ledger: Ledger; blurb: string; recordCost?: CostRecorder }): Promise<{ leaf: ContentLeaf; want: Want } | { error: string }>`: one call, no tools besides its report tool, `max_tokens` 200. The system prompt lists `CONTENT_LEAVES` and `WANTS` verbatim.
  - `FileDeps.fieldNote(a: { sourceUrl: string; leaf: ContentLeaf; want: Want; note: string }): Promise<{ id: string; title: string } | { duplicate: string }>`
  - `runOneBox`, for `field_notes` with `input.link`: no search, no verifier, no page read. Goes `classifyLeafWant` → `fieldNote` with `sourceUrl = link` and `note = blurb`. Without a link: v1 search + verifier, then the same filer, with `leaf` and `want` from the finding.
- An answer outside the lists fails with "That didn't match a Field Notes kind; nothing was added."

- [ ] **Step 1:** Write failing tests with a stub client and stub `readPage`:
  - `with a link: one classify call, no readPage, files the link and the blurb as the note` (Review Focus 3: a news-article URL is filed the same way)
  - `without a link: search, verify, file with the finding's leaf and want`
  - `classify returns an unknown leaf: failed, nothing filed`
  - `the classify request puts cache_control on the system block and not on the user turn`
- [ ] **Step 2:** Run `npx tsx --test tests/one-box-fieldnotes.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx tsx --test tests/one-box-*.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(seed): Field Notes one-box: free with a link, search without`.

### Task 5: Stories pools: a `seed` payload flag means Yours and never cut

**Files:**
- Modify: `lib/stories/pool.ts` (the three cap queries near lines 253, 320, 362 add `AND COALESCE((p.payload->>'seed')::boolean, false) = false`, beside `key NOT LIKE 'seed:%'`), `lib/social-hub/adapters/stories.ts:264-266` (`yours` and `detail` are also true for `payload.seed === true`)
- Test: `tests/one-box-stories-yours.test.ts`

**Interfaces:**
- Produces: the rule that a pool row whose payload has `seed: true` is Yours and exempt from the caps. Tasks 6 and 7 set it.

- [ ] **Step 1:** Write failing tests:
  - `capTriviaPool with 51 unused rows keeps the seeded one` (Review Focus 2)
  - `the Real or AI? cap keeps a seeded roa row at 41 rows`
  - `the stories adapter marks payload.seed rows yours with detail "You typed this in"`

  Use the in-memory or local Stories db helpers the existing pool tests use (`tests/*pool*.test.ts`).
- [ ] **Step 2:** Run `npx tsx --test tests/one-box-stories-yours.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it, plus the existing Stories pool tests (`npx tsx --test tests/*stories*pool*.test.ts tests/*trivia*.test.ts tests/*roa*.test.ts`). Expected: PASS.
- [ ] **Step 5:** Commit: `feat(stories): seeded pool rows are Yours and never cut by the caps`.

### Task 6: Trivia seed runner (Stories worker)

**Files:**
- Modify: `lib/stories/trivia/daily.ts`. Export `writerCall` as `writeTriviaBatch` with no behavior change for the daily path. `CallInput` gains `topic?: string`, `count?: number` and `seed?: boolean`. When `seed` is set, each pooled payload gets `seed: true`.
- Modify: `lib/stories/trivia/prompts.ts`. Add `trivia-seed@1`, the `trivia-write@6` rules text plus: "Write up to {count} questions about this topic: {topic}. Place each in the offered cell it fits best; skip a question that fits none." Same tool and output shape, at most 3 searches.
- Create: `lib/seed/one-box/workers/trivia.ts`
- Test: `tests/one-box-trivia.test.ts`

**Interfaces:**
- Consumes: `claimRequest` and request updates (Task 2), `Ledger` (Task 3), `payload.seed` (Task 5).
- Produces: `runTriviaSeed(i: { q: Query; id: string; input: OneBoxInput; deps: TriviaDailyDeps; ledger: Ledger }): Promise<void>`. It never throws, and ends with `doneRequest` (idea id = the first pooled key) or `failRequest` with the validator, repeat or Jev reasons. Offered cells are all open cells (`openCellIds`). Count is 2. Before the writer call, the ledger checks the writer's worst case (3 searches plus 4,000 output tokens at the copy model's price).

- [ ] **Step 1:** Write failing tests with a stub writer returning canned `TriviaWriteOut` and a stub Jev:
  - `two valid questions pool with seed true and the request is done`
  - `both fail the validator: failed with the reasons, nothing pooled`
  - `a question in a retired cell is dropped`
  - `the ledger refuses when the writer's worst case passes 0.29`
  - `the daily path's pooled payloads have no seed flag`
- [ ] **Step 2:** Run `npx tsx --test tests/one-box-trivia.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it plus `npx tsx --test tests/*trivia*.test.ts`. Expected: PASS, with the daily tests unchanged.
- [ ] **Step 5:** Commit: `feat(seed): Trivia one-box seed on the daily writer's path`.

### Task 7: Real or AI? twin seed runner (Stories worker)

**Files:**
- Modify: `lib/stories/roa/daily.ts`. Extract the per-spec body of `runRoaDaily` (lines ~165–230: `take`, the real photo find, `aiCell`, the twin branch) into an exported `runRoaSpec(ctx: RoaSpecCtx, spec: RoaSpec, opts?: { seed?: boolean; beforeImage?: () => boolean }): Promise<RoaSpecResult>`, with no behavior change for the daily run. `beforeImage` returning false skips the image call.
- Modify: `lib/stories/roa/prompts.ts`. Add `roa-seed@1`: the `roa-write@3` rules plus "Write exactly one spec with trap twin for this subject: {subject}. Choose the subject category from the list; if none fits, report none."
- Create: `lib/seed/one-box/workers/roa.ts`
- Test: `tests/one-box-roa.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3 and 5.
- Produces:
  - `RoaSpecResult = { pooled: string[]; rejected: { problems: string[] }[]; usd: number }`
  - `runRoaSeed(i: { q: Query; id: string; input: OneBoxInput; deps: RoaDailyDeps; ledger: Ledger }): Promise<void>`
  - The ledger adds the writer's actual cost and gates each image at 0.17 through `beforeImage`.
- Card outcomes:
  - No category: failed with "That subject doesn't fit Real or AI?'s subjects; nothing was made."
  - No real photo: failed with "No real photo of that found."
  - Real pooled, AI failed: done, with the message "The real photo was added; the AI twin didn't pass."

- [ ] **Step 1:** Write failing tests with a stub writer, image generator, `findRealPhotos` and `intakeCandidate`:
  - `twin pooled: two keys, both payloads seed true, done`
  - `no real photo: failed, no image call`
  - `real pooled and both AI attempts fail the screen: done with the real-only message`
  - `a second image attempt is refused when it would pass 0.52`
  - `the subject maps to no category: failed before any image`
  - `runRoaDaily still pools the same rows for the existing daily fixture`
- [ ] **Step 2:** Run `npx tsx --test tests/one-box-roa.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it plus `npx tsx --test tests/*roa*.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(seed): Real or AI? twin seed on the daily run's spec path`.

### Task 8: Stories worker claims seeds

**Files:**
- Modify: `scripts/stories_worker.ts` (after `tick(deps)` in the loop, claim and run at most one request per poll), `lib/seed/one-box/workers/index.ts` (create)
- Test: `tests/one-box-workers.test.ts`

**Interfaces:**
- Produces: `runClaimedSeed(i: { q: Query; runner: 'stories'; deps: { trivia: TriviaDailyDeps; roa: RoaDailyDeps } }): Promise<{ id: string } | null>`. It claims with `claimRequest`, routes by vertical to `runTriviaSeed` or `runRoaSeed`, and never throws (an error becomes `failRequest`). The worker wraps the call so a failure is logged and the loop continues.

- [ ] **Step 1:** Write failing tests:
  - `routes ai_trivia and real_or_ai to their runners`
  - `nothing queued: returns null and calls no runner`
  - `a runner that throws leaves the request failed and returns`
- [ ] **Step 2:** Run `npx tsx --test tests/one-box-workers.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Build the deps in the worker from what `tick` already builds (settings, db, bank, finder).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(seed): the Stories worker runs Trivia and Real or AI? seeds`.

### Task 9: AI Drama seed runner and drama worker step

**Files:**
- Modify: `lib/reel-ai-drama/development/session.ts`. Export `checkPitch` and its `Outcome` type, with no behavior change.
- Modify: `lib/reel-ai-drama/development/producer.ts`. Add `producer-seed@1`: the producer system and roster blocks unchanged (the cached prefix), a user turn "Write exactly one pitch about this story: {blurb}" plus the link hint, and the same tool and `validatePitch`.
- Create: `lib/seed/one-box/workers/drama.ts`
- Modify: `scripts/reel_ai_drama_worker.ts` (a `step('seeds', …)` right after `step('requests', …)`), `lib/seed/one-box/workers/index.ts` (runner `drama`)
- Test: `tests/one-box-drama.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 3, and `checkPitch(ctx, id, pitch)`.
- Produces: `runDramaSeed(i: { q: Query; id: string; input: OneBoxInput; db: Queryable; deps: DevelopmentDeps; settings: ReelAiDramaSettings; ledger: Ledger; now: Date }): Promise<void>`. Steps:
  1. Fail first, with "Tonight's development cap is reached; nothing was spent.", when tonight's development spend plus the producer's worst case would pass `nightly_dev_cap_usd`.
  2. Call the producer and add its cost to the ledger.
  3. Run `validatePitch`.
  4. Insert the pitch with `origin = 'seed'` and `status = 'new'`.
  5. Run `checkPitch` with `settings.visuals_check_cap_usd = min(setting, ledger.remaining())`.
  6. Finish: `pooled` → done; `duplicate` or `rejected` → failed with the reject reason; `held` → failed with "Held at the development cap; it will be checked in the next session."

  Seed costs are recorded in `reel_ai_drama.cost_events` with `mode` `seed`, so they count toward the nightly cap.

- [ ] **Step 1:** Write failing tests with a stub producer and Jev:
  - `pooled pitch: done with the pitch id`
  - `drama under the bar: failed with the reason`
  - `nightly cap reached: failed before the producer call`
  - `visuals cap passed to checkPitch equals the ledger remaining`
  - `the seeds step runs while the night step would also run, and neither blocks the other's loop iteration` (Review Focus 1: simulate one loop pass with a queued seed and the night due; both run in order)
- [ ] **Step 2:** Run `npx tsx --test tests/one-box-drama.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it plus `npx tsx --test tests/reel-ai-drama-*.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(seed): AI Drama one-box seed, checked at once on the drama worker`.

### Task 10: One form for every type; old forms deleted

**Files:**
- Modify: `components/content-type/OneBoxSeedForm.tsx`, `components/content-type/SeedButton.tsx`, `components/content-type/SeedRequestCards.tsx` (Cancel on a queued card → `DELETE /api/seed/one-box/[id]`; always render the cards)
- Delete: `components/content-type/{Reel,Carousel,Lfd,Story,Explainer}SeedForm.tsx`, `components/field-notes/FieldNotesSeedForm.tsx`, and their entries in `tests/social-hub-scope.test.ts` `HUB_CONTROLS`. Keep the old `/seed` routes (scripts and tests use them).
- Test: `tests/one-box-form.test.ts`, `tests/social-hub-scope.test.ts`

**Interfaces:**
- Produces: `ESTIMATE_CENTS: Record<SeedVerticalKey, number>`, with `field_notes` 12 and `fieldNotesWithLink` 1. Also `submitLabel(v: SeedVerticalKey, hasLink: boolean): string` → "Add · about N¢ (M¢ limit)", and the placeholders and after-lines below.

Placeholders:

| Type | Placeholder | After-line |
|---|---|---|
| `reels`, `carousels`, `last_few_days`, `stories` | In a sentence or two, what is the story? | Claude finds the real article, checks it matches, and adds it. If it can't, nothing is added. |
| `explainers` | A concept, or a sentence about it. | Claude names the concept and finds pages that explain it, then it is scoped and scored. |
| `field_notes` | The tool, skill or repo, and what someone gets from it. | With a link: added free; the page is read when you press Generate. Without: Claude finds its official page first. |
| `ai_trivia` | A topic for a question. | Claude writes up to two questions on it; they're checked and scored like the daily ones. |
| `real_or_ai` | A subject to photograph. | Claude finds a real photo of it and makes an AI twin; both are screened like the daily ones. |
| `reel_ai_drama` | The story, in a sentence or two. | Claude writes a pitch from it, then the drama, material and visuals checks run. |

- [ ] **Step 1:** Write failing tests:
  - `submitLabel for real_or_ai reads "Add · about 30¢ (60¢ limit)"`
  - `field_notes label drops to about 1¢ when a link is given`
  - `every seedable type has a placeholder and after-line`
  - `no series choice is rendered`
  - `the scope test lists only the one-box form among seed controls`
- [ ] **Step 2:** Run `npx tsx --test tests/one-box-form.test.ts tests/social-hub-scope.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement and delete the old forms. `SeedButton` always uses `OneBoxSeedForm`.
- [ ] **Step 4:** Run `npm test` and `npx tsc --noEmit -p .`. Expected: PASS, apart from the two pre-existing roa SDK errors and the known parallel-run timing on `tests/one-box-run.test.ts` (rerun that file alone if it fails).
- [ ] **Step 5:** Preview the hub locally (`preview_start`). Open the Trivia, Real or AI?, AI Drama and Field Notes pools. Check that the drawer shows the right placeholder and price, and that the button changes with a link on Field Notes. Don't submit (a submit would be live).
- [ ] **Step 6:** Commit: `feat(seed): one seed form for every type; old forms removed`.

### Task 11: Ship

- [ ] **Step 1:** Run `psql "$DATABASE_URL" -X -f db/seed_requests_runner.sql` (idempotent DDL; no session `SET`). Also apply the v1 `seed_requests` table, if it's missing, from `db/social_hub_schema.sql`. Check with `psql "$DATABASE_URL" -X -c "BEGIN READ ONLY; SELECT column_name FROM information_schema.columns WHERE table_schema='social_hub' AND table_name='seed_requests'; ROLLBACK;"`. Expected: `runner` and `claimed_at` listed.
- [ ] **Step 2:** Open the PR from `claude/one-box-seeding-9dc0a9` into `main-l2xadw`. The description includes all new prompt texts (`one-box-seed`, `one-box-verify`, `one-box-fieldnotes-classify-v1`, `trivia-seed@1`, `roa-seed@1`, `producer-seed@1`) for Tommy's approval in review. Don't merge.
- [ ] **Step 3:** After Tommy merges, run `./scripts/gcp/deploy-social-worker.sh` in the same session. Expected: the `helios-stories` and `helios-reel-ai-drama` units restart cleanly.
- [ ] **Step 4:** Tell Tommy and Lucas that the first live seed of each type is theirs to click. Report the request rows' `cost_usd` afterward (read-only query).
