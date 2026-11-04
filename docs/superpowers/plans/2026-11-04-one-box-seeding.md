# One-Box Seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One text box (plus optional link) in every pool's "Seed an idea" drawer; a web-search Claude call finds and verifies the real source and files the idea through each type's existing add function, capped at 35 cents.

**Architecture:** `POST /api/seed/one-box` inserts a `social_hub.seed_requests` row and runs a pipeline in `after()` (search call, page read, independent verifier call, per-type filer). A shared placeholder card reads that table. All new code is under `lib/seed/one-box/`; the add functions are reused, not changed.

**Tech Stack:** Next.js route handlers (`after` from `next/server`), `@anthropic-ai/sdk` via `newAnthropic`, PGlite tests (`tsx --test tests/*.test.ts`), existing `lib/anthropic-cache.ts` helpers.

**Spec:** `docs/superpowers/specs/2026-11-04-one-box-seeding-design.md` (approved by Tommy 2026-11-04).

## Global Constraints

- CLAUDE.md Rule 1: no task, test or command calls the live Claude API or `web_search`. Tests stub the client with canned responses; fixtures are 1-2 items. The first live seed is Tommy clicking in the built app.
- CLAUDE.md Rule 2: the only DB reads are for the one seed (that pool's headlines, one URL's duplicate check). No loop over contacts/companies/ideas to enrich anything.
- Prompt caching: static prefix (tools, then system) carries `cache_control` via `cachedSystemText` / `withToolCache`; blurb, link hint and pool headlines only in the user turn. Same tool schema and system text for all five types.
- Cost: `ONE_BOX_MAX_USD = 0.35` hard stop; Jev types reserve 2 cents, Explainers reserves 8 cents; search + verifier may use only `0.35 - reserve`. Submit button text: "Find source and add, about 12¢ (never more than 35¢)".
- Blurb max 600 characters. Pool headlines sent to the agent: at most 40. A `working` request older than 6 minutes shows as failed (or "may have been added; check the queue" if its stage is `filing`). Max 3 working requests; same blurb + pool inside 60 s returns the first request. Open-seed caps (10) and 7-day expiry come from the existing add functions.
- Prompt versions `one-box-seed-v1-draft` and `one-box-verify-v1-draft`, marked NOT APPROVED, gated by env `ONE_BOX_SEED_PROMPT_APPROVED=true`. Until set, the old forms render and the endpoint refuses. Do not set or ask to set the flag; wording needs Tommy's approval.
- Models: search call `B6_MODEL` (`lib/reels/config.ts`); verifier `claude-haiku-5-5`, no tools.
- Git: branch `claude/one-box-seeding-9dc0a9`; stage files by name; never touch `main`; no PR until Tommy says. Do not "fix" the pre-existing failing tests (warm-link fetch, New York DST, a few stories/explainers/reels-visual tests). No worker changes, so no `deploy-social-worker.sh`.
- AI Events keeps no seed.

## Review Focus

1. Search call reports 3 articles, the first fails the verifier, the second passes: the second is filed (tested in Task 7).
2. Stubbed usage far above the cap on any call: the seed stops, nothing filed, spend recorded (Task 2, Task 7).
3. Link pasted is unreadable or a private address: the seed still runs from the blurb alone (Task 4).
4. Pool already holds the idea: model says `duplicate_of`, nothing filed, the reason names that idea (Task 7).
5. Function killed after filing began: stale row reads "may have been added" not "failed" (Task 1).

---

## File Structure

- Create `lib/seed/one-box/types.ts`: shared types (`SeedVerticalKey`, `Finding`, `OneBoxInput`, `Outcome`).
- Create `lib/seed/one-box/budget.ts`: spend ledger, cap, worst-case math.
- Create `lib/seed/one-box/prompts.ts`: system text, `report_finding` tool, verifier prompt/tool, user-turn builders, versions, `oneBoxApproved()`.
- Create `lib/seed/one-box/search.ts`: the agent call.
- Create `lib/seed/one-box/verify.ts`: page reading, verifier call, extras checks.
- Create `lib/seed/one-box/file.ts`: per-type filers and pool-headline readers.
- Create `lib/seed/one-box/requests.ts`: `seed_requests` store.
- Create `lib/seed/one-box/run.ts`: orchestrator `runOneBox`.
- Create `app/api/seed/one-box/route.ts`, `app/api/seed/one-box/[id]/route.ts` (GET row, DELETE = dismiss).
- Create `components/content-type/OneBoxSeedForm.tsx`, `components/content-type/SeedRequestCards.tsx`.
- Modify `db/social_hub_schema.sql` (append table), `components/content-type/SeedButton.tsx` (form switch + cards), `tests/social-hub-scope.test.ts` (allowlists).
- Tests: `tests/one-box-*.test.ts` (one per task).

---

### Task 1: seed_requests table and store

**Files:** Modify `db/social_hub_schema.sql`; Create `lib/seed/one-box/types.ts`, `lib/seed/one-box/requests.ts`; Test `tests/one-box-requests.test.ts`

**Interfaces:**
- Produces (types.ts): `type SeedVerticalKey = 'reels'|'carousels'|'last_few_days'|'stories'|'explainers'`; `type OneBoxInput = { vertical: SeedVerticalKey; series?: 'morning_download'|'guess_the_number'|'free_vs_paid'; blurb: string; link?: string }`; `type Stage = 'queued'|'searching'|'reading'|'checking'|'filing'`.
- Produces (requests.ts), all taking `q: Query` (`@/lib/social/store/pg`): `createRequest(q, input, now?): Promise<{ id: string; reused: boolean }>`; `setStage(q, id, stage, costUsd?)`; `failRequest(q, id, message, costUsd)`; `doneRequest(q, id, ideaId: string|null, costUsd)`; `listCards(q, vertical, now?): Promise<Card[]>` where `Card = { id; blurb; status: 'working'|'failed'; stage; message: string|null; createdAt }`; `dismissRequest(q, id)`; `workingCount(q, now?)`.

- [ ] **Step 1: Write failing tests** in `tests/one-box-requests.test.ts` on PGlite loaded with `db/social_hub_schema.sql` (copy the setup used in `tests/idea-seeding-carousels.test.ts`). Tests: `createRequest twice with same blurb+vertical inside 60s returns reused:true and same id`; `fourth concurrent working request is refused (createRequest throws Error with message 'Three seeds are already being worked on; wait for one to finish.')`; `a working row 7 minutes old lists as failed with message 'Timed out; nothing was added.'`; `the same stale row with stage filing lists message 'This may have been added; check the queue.'`; `dismissed failed rows are not listed`; `done rows are not listed`.
- [ ] **Step 2:** Run `npx tsx --test tests/one-box-requests.test.ts`; expect FAIL (module missing).
- [ ] **Step 3:** Append to `db/social_hub_schema.sql` `CREATE TABLE IF NOT EXISTS social_hub.seed_requests (id uuid PK default gen_random_uuid(), vertical text NOT NULL, series text, blurb text NOT NULL, link text, status text NOT NULL DEFAULT 'working' CHECK (status IN ('working','failed','done')), stage text NOT NULL DEFAULT 'queued', message text, idea_id text, cost_usd numeric(8,4) NOT NULL DEFAULT 0, created_at/updated_at timestamptz default now(), dismissed_at timestamptz)` plus an index on `(vertical, status)`. Implement `requests.ts` with the signatures above; stale = `working` and `updated_at` older than 6 minutes (computed at read time from `now`, not by a writer).
- [ ] **Step 4:** Run the test file; expect PASS.
- [ ] **Step 5:** `git add db/social_hub_schema.sql lib/seed/one-box/types.ts lib/seed/one-box/requests.ts tests/one-box-requests.test.ts && git commit -m "feat(seed): seed_requests table and store"`.

### Task 2: Spend ledger

**Files:** Create `lib/seed/one-box/budget.ts`; Test `tests/one-box-budget.test.ts`

**Interfaces:**
- Produces: `ONE_BOX_MAX_USD = 0.35`; `RESERVE_USD: Record<SeedVerticalKey, number>` (reels/carousels/last_few_days/stories 0.02, explainers 0.08); `SEARCH_MAX_USES = 4`, `SEARCH_MAX_OUTPUT_TOKENS = 1500`, `SEARCH_INPUT_ALLOWANCE_TOKENS = 40_000`; `searchWorstCaseUsd(): number` (uses × $0.01 + output cap and input allowance priced at `B6_MODEL` rates from `lib/anthropic-pricing.ts`); `verifyWorstCaseUsd(): number`; `class Ledger { constructor(vertical); spent: number; canAfford(worstCase: number): boolean; add(usd: number): void; get exhausted(): boolean }` where the usable budget is `0.35 - RESERVE_USD[vertical]`.
- [ ] **Step 1:** Tests: `searchWorstCaseUsd() <= 0.20`; `searchWorstCaseUsd() + verifyWorstCaseUsd()*3 <= 0.35 - 0.08`; `canAfford is false once spent + worstCase would pass the usable budget`; `exhausted is true when spent >= usable budget`; `Ledger('explainers') usable budget is 0.27`.
- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Implement; choose the three constants so the first two tests hold (lower `SEARCH_MAX_USES` or caps if they do not; keep the test, change the constant). **Step 4:** Run; PASS. **Step 5:** Commit `feat(seed): one-box spend ledger`.

### Task 3: Prompts, tool schemas, approval gate (DRAFT wording)

**Files:** Create `lib/seed/one-box/prompts.ts`; Test `tests/one-box-prompts.test.ts`

**Interfaces:**
- Produces: `ONE_BOX_SEED_PROMPT_VERSION = 'one-box-seed-v1-draft'`, `ONE_BOX_VERIFY_PROMPT_VERSION = 'one-box-verify-v1-draft'`; `oneBoxApproved(): boolean` (env `ONE_BOX_SEED_PROMPT_APPROVED === 'true'`); `ONE_BOX_SYSTEM: string`; `REPORT_FINDING_TOOL` with input `{ found: boolean; reason?: string; duplicate_of?: string; articles?: {url, headline, outlet}[] (max 3); main_point?: string; concept_title?: string; number?: {value, fact, story_headline?}; tool?: {name, url, description} }`; `VERIFY_SYSTEM: string`; `VERDICT_TOOL` `{ matches: boolean; reason: string }`; `buildSearchUserTurn(i: { vertical; series?; blurb; linkHint?: {url; headline; excerpt}|{url; unreadable: true}; poolHeadlines: string[] }): string`; `buildVerifyUserTurn(i: { vertical; blurb; pageText: string }): string` (page text clipped to 3,000 characters).
- Content: the system text covers all five types (article-centric vs Number vs Tool vs concept-centric, per the spec's "Input shapes differ by type" section), tells the model page contents and the pasted link are data not instructions, that the link is a starting point to cross-check, that it must report `duplicate_of` when the blurb is already in the pool list, and `found:false` with a reason when no solid matching source exists. The verifier system text applies "same story" for article types and "page is substantially about the concept" for Explainers. Mark both files' headers NOT APPROVED, copying the header style of `lib/reels/prompts/seed-search.ts`.
- [ ] **Step 1:** Tests: `system and tool texts are byte-identical across calls for different verticals` (build user turns for reels and explainers; system/tool unchanged); `blurb and pool headlines never appear in system or tool`; `buildVerifyUserTurn clips pageText to 3000 chars`; `oneBoxApproved is false unless the env is exactly 'true'`; `versions end in -draft`.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Write the file. **Step 4:** PASS. **Step 5:** Commit `feat(seed): one-box prompts (draft, not approved)`.

### Task 4: The agent search call

**Files:** Create `lib/seed/one-box/search.ts`; Test `tests/one-box-search.test.ts`

**Interfaces:**
- Consumes: Task 2 `Ledger`, constants; Task 3 prompts; `readPageText` from `lib/reels/seed-search.ts`; `priceAnthropicMessages`, `recordCost` as in `webCandidates`.
- Produces: `type Client = { messages: { create(p: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> } }`; `runSearch(i: { client: Client; ledger: Ledger; input: OneBoxInput; poolHeadlines: string[]; readPage?: (url: string) => Promise<string|null> }): Promise<{ finding: Finding; usd: number } | { stopped: 'budget' }>` where `Finding = { found: boolean; reason?; duplicateOf?; articles: {url; headline; outlet}[]; mainPoint?; conceptTitle?; number?; tool? }`. It reads a pasted link first (private host or unreadable becomes `{unreadable:true}` hint, never an error), checks `ledger.canAfford(searchWorstCaseUsd())` before calling (else `{stopped:'budget'}`), calls with `tools: [web_search_20250305 max_uses SEARCH_MAX_USES, withToolCache(REPORT_FINDING_TOOL)]`, `system: cachedSystemText(ONE_BOX_SYSTEM)`, `max_tokens: SEARCH_MAX_OUTPUT_TOKENS`, user turn from `buildSearchUserTurn`; prices the message, `ledger.add`, `recordCost({runId:null, vendor:'anthropic', component:'one-box-seed', ...})`.
- [ ] **Step 1:** Tests with a stub client returning canned `tool_use` blocks: `parses articles, number and tool extras`; `request has cache_control on system and on the last tool, none on the user turn` (assert on the captured params); `private-host link becomes an unreadable hint and the call still happens`; `returns stopped:'budget' without calling the client when the ledger cannot afford it`; `missing report_finding block yields found:false with a reason`; `ledger.spent rises by the priced usage of the stub message`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(seed): one-box agent search call`.

### Task 5: Page read and independent verifier

**Files:** Create `lib/seed/one-box/verify.ts`; Test `tests/one-box-verify.test.ts`

**Interfaces:**
- Consumes: Task 4 `Client`, `Finding`; Task 2 ledger; Task 3 verifier prompt.
- Produces: `verifyFinding(i: { client: Client; ledger: Ledger; input: OneBoxInput; finding: Finding; readPage?: ... }): Promise<{ ok: true; articles: VerifiedArticle[]; conceptTitle?; number?; tool? } | { ok: false; reason: string }>` with `VerifiedArticle = { url; headline; outlet; text: string }`.
- Behavior: for each reported article best-first (max 3): `isPrivateHost` skip, `readPage` (200-char minimum), then if `ledger.canAfford(verifyWorstCaseUsd())` one Haiku call (`claude-haiku-5-5`, `tools:[withToolCache(VERDICT_TOOL)]`, `tool_choice` forced, cached system) with `buildVerifyUserTurn`; only `matches:true` passes; the first pass is primary, later passes are supporting. Number: `number.value` must appear in some verified page text. Tool: `tool.url` must read and its page text must include `tool.name` (case-insensitive). No verified article (or failed extra) gives `{ok:false, reason}` where the reason says what the best candidate was and the verifier's reason. Budget exhausted mid-way gives reason 'Stopped at the 35-cent limit.'
- [ ] **Step 1:** Tests (stub client): `first article rejected, second accepted: primary is the second`; `all rejected: ok:false and the reason names the first candidate's headline`; `unreadable page is skipped without a verifier call`; `Number value missing from page text fails`; `Tool name missing from the tool page fails`; `huge stub usage stops further verifier calls`; `verifier request has cache_control on system and tool, none on user turn`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; record each verifier call with `recordCost` component `one-box-verify`. **Step 4:** PASS. **Step 5:** Commit `feat(seed): one-box verifier`.

### Task 6: Per-type filers and pool headlines

**Files:** Create `lib/seed/one-box/file.ts`; Test `tests/one-box-file.test.ts`

**Interfaces:**
- Consumes: `addReelSeed` (`lib/reels/seeds.ts`), `addCarouselSeed` (`lib/social/overnight/seeds.ts`), `addLfdSeed` (`lib/lfd/seeds.ts`), `seedIdea` (`lib/stories/seed.ts`), `addAndEvaluateTopics` (`lib/explainers/ideas/cycle.ts`).
- Produces: `type FileDeps = { reels: {...ReelSeedDeps}; carousel: {query; deps}; lfd: {...}; stories: {db}; explainers: {...} }` (inject the real deps in the route; stubs in tests); `fileIdea(i: { input: OneBoxInput; verified: Verified; deps: FileDeps }): Promise<{ status: 'added'; ideaId: string; title: string } | { status: 'duplicate'; existing: string } | { status: 'refused'; reason: string }>`; `poolHeadlines(vertical, series, deps): Promise<string[]>` (read-only, at most 40, the open queue plus open seeds of that one pool, using the same queries the pool page uses in `lib/social-hub/queries/<type>.ts` or each add function's open-seed reader; Stories filtered by series); `existingFor(vertical, url, deps): Promise<string|null>` (the free duplicate check on the found URL: reels `findQueueDuplicate`, carousels/LFD their existing refusal conditions, Stories none, Explainers none).
- Mapping (exact, from the spec table): reels `{headline: primary.headline, url: primary.url}`; carousels `{url, headline}`; LFD `{url, headline}`; Stories Headline `{series:'morning_download', headline, url, notes: input.blurb}`; Number `{series:'guess_the_number', value, fact, storyHeadline, url}`; Tool `{series:'free_vs_paid', toolName, url: tool.url, description}`; Explainers `addAndEvaluateTopics(..., [{title: conceptTitle, origin:'manual', sourceUrl: primary.url, sourceText: articles joined as "URL\ntext" blocks, clipped to 20,000}])`. `SeedError`/`ApiError` from the add functions become `{status:'refused', reason: error.message}`.
- [ ] **Step 1:** Tests with stubbed deps capturing arguments: one per row of the mapping asserting the exact call arguments; `Explainers sourceText is clipped to 20000 and starts with the primary URL`; `SeedError becomes refused with its message`; `reels duplicate outcome becomes duplicate with the existing headline`; `poolHeadlines returns at most 40 and only that series for Stories`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(seed): one-box per-type filers`.

### Task 7: Orchestrator

**Files:** Create `lib/seed/one-box/run.ts`; Test `tests/one-box-run.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 5, 6.
- Produces: `runOneBox(i: { q: Query; id: string; input: OneBoxInput; client: Client; fileDeps: FileDeps; readPage?; now? }): Promise<void>` (never throws; every ending writes `done` or `failed`).
- Order: `setStage searching` → `poolHeadlines` → `runSearch` → `duplicateOf` or `!found` fail with the model's reason → `existingFor` on the primary article URL (duplicate fails naming the existing idea) → `setStage checking` → `verifyFinding` → `setStage filing` → `fileIdea` → `doneRequest`. Any thrown error becomes `failRequest('Something went wrong; nothing was added.')`. Every failure records `ledger.spent`.
- [ ] **Step 1:** Tests (stub client + stub deps, PGlite for the store): `happy path files once and marks done`; `first article fails verifier, second passes: second filed` (Review Focus 1); `stub usage of $5 stops after the first call, nothing filed, cost recorded, message mentions 35 cents` (Review Focus 2); `duplicate_of from the model fails with the existing headline in the message and files nothing` (Review Focus 4); `found:false fails with the model's reason`; `existing duplicate on the found URL fails before any verifier call`; `a thrown filer error leaves status failed, never working`; `stage is filing at the moment fileIdea runs` (Review Focus 5).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(seed): one-box orchestrator`.

### Task 8: Routes

**Files:** Create `app/api/seed/one-box/route.ts`, `app/api/seed/one-box/[id]/route.ts`; Test `tests/one-box-route.test.ts`

**Interfaces:**
- Consumes: Task 1 store, Task 7 `runOneBox`, `oneBoxApproved`.
- Produces: `POST /api/seed/one-box` body `{ vertical, series?, blurb, link? }` → `{ id }` (200), or `{ error }` with 401 (`getSession()` missing), 403 `'The one-box seed isn’t switched on yet.'` (prompt not approved), 400 (bad vertical, `ai_events`, empty blurb, blurb over 600, bad link scheme, missing series for stories), 409 (open-seed cap already reached: read with each type's open-seed reader before inserting, so nothing is spent; three working). `export const maxDuration = 300`. Work runs in `after(() => runOneBox(...))` with the real client `newAnthropic({apiKey})`; no `ANTHROPIC_API_KEY` returns 500 before inserting. `GET [id]` returns the row's card; `DELETE [id]` dismisses.
- [ ] **Step 1:** Tests exporting a testable `handlePost(body, deps)` so no live client is built: `unapproved prompt returns 403 and inserts nothing`; `ai_events returns 400`; `blurb of 601 chars returns 400`; `approved valid body inserts one working row and schedules the run once`; `cap reached returns 409 and inserts nothing`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(seed): one-box routes`.

### Task 9: Form, cards, button switch, scope allowlists

**Files:** Create `components/content-type/OneBoxSeedForm.tsx`, `components/content-type/SeedRequestCards.tsx`; Modify `components/content-type/SeedButton.tsx`, `tests/social-hub-scope.test.ts` (add both component paths to `HUB_CONTROLS`; add `seed\/one-box` to `CONTROL_ENDPOINTS`); Test `tests/one-box-form.test.ts`

**Interfaces:**
- `OneBoxSeedForm({ vertical, done }: SeedFormProps & { vertical: SeedVertical })`: textarea (600 max, counter), "Add a link" toggle revealing a link input, Stories-only radio Headline / Number / Tool (labels from `SERIES_LABEL`), submit text exactly "Find source and add, about 12¢ (never more than 35¢)"; on 200 closes the drawer with `done('Looking for a source. It will appear in the queue when it is found.')`; errors shown inline.
- `SeedRequestCards({ vertical })`: lists cards from a `GET /api/seed/one-box?vertical=` handler (add this to the Task 8 route file: returns `listCards`), polls every 3 s while any card is `working`, calls `refreshHubPage` when a card disappears, failed cards show the message and a Dismiss button (DELETE).
- `SeedButton`: renders `OneBoxSeedForm` when the server says the prompt is approved, else the old per-type form; `SeedRequestCards` rendered next to the button. The approval state comes from a prop read server-side where `SeedButton` is mounted (`oneBoxApproved()`), not from `NEXT_PUBLIC` env.
- [ ] **Step 1:** Tests (render with the project's existing component test style, see `tests/seed-button-types.test.ts`): `Stories form shows the series choice, other verticals do not`; `submit is disabled with an empty blurb and over 600 characters`; `link input is hidden until Add a link is pressed`; `AI Events still renders no seed button`; `button label text is exact`; the social-hub scope test passes with the new files listed.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Run `npx tsx --test tests/one-box-form.test.ts tests/social-hub-scope.test.ts tests/seed-button-types.test.ts`; expect PASS except the known pre-existing failures in the scope file. **Step 5:** Commit `feat(seed): one-box form, cards and button switch`.

### Task 10: Full run and hand-off

- [ ] **Step 1:** `npx tsx --test tests/one-box-*.test.ts` all pass. **Step 2:** `npm test` and `npx tsc --noEmit`; the only failures are the pre-existing ones listed in Global Constraints. **Step 3:** Start the dev server via `preview_start` with the approval flag unset; confirm the old forms still render and a POST to the endpoint returns 403 (no live call is possible). **Step 4:** Write a short hand-over note to the shared notes folder: what to set (`ONE_BOX_SEED_PROMPT_APPROVED`), the schema statement to apply (`db/social_hub_schema.sql` addition), and that Tommy must approve the two draft prompts and then click the first live seed himself. **Step 5:** Commit any note under `docs/` only if it belongs in the repo; otherwise leave it in the notes folder.

## Self-review

- Spec coverage: form (T9), async + cards (T1, T8, T9), agent + pool check + several articles (T3, T4), match (T5), cost (T2, T4, T5, T7), per-type filing incl. Explainers concept shape (T6), duplicates/caps/failures (T1, T7, T8), killed mid-run (T1, T7), prompt gate (T3, T8, T9), scope allowlists (T9), old forms kept until approval (T9), tests stubbed (all).
- Deliberately deferred to a follow-up (needs Tommy's prompt approval first): deleting the old five forms.
