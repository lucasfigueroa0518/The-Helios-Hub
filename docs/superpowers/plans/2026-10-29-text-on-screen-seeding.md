# Text on Screen Seeding Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Text on Screen seed (headline + link, or headline only) becomes a scored idea ranked by its score, marked "Yours", that the night never makes on its own; duplicates stop and show the existing idea; headline-only and unreadable links search for a substitute story within a 15-cent ceiling.

**Architecture:** `addReelSeed` ([lib/reels/seeds.ts](../../../lib/reels/seeds.ts)) becomes an orchestrator that returns a status union. Searching and choosing a substitute story lives in a new `lib/reels/seed-search.ts` (free tiers first, paid tier last, all injectable so tests stub them). The night's carryover query and the queue view are changed so seeds are skipped by the night and sorted by net in the view.

**Tech Stack:** Next.js route handlers, Postgres (PGlite in tests), Jev (`scoreOneIdea`), Anthropic Messages API with web search (paid tier only), `node:test` via `tsx --test`.

**Spec:** [docs/superpowers/specs/2026-10-29-text-on-screen-seeding-design.md](../specs/2026-10-29-text-on-screen-seeding-design.md)

## Global Constraints

- CLAUDE.md Rule 1: no test or agent run calls the live Claude API, `web_search` or Jev. Tests stub `JevTransport`, `fetch`, and the paid search. Fixtures are 1–2 items. Agents never click Seed on a deployed build; Tommy does.
- CLAUDE.md Rule 2: lookups of queue ideas and collected stories are read-only, per seed. No loop over the database.
- Prompt caching: the paid search call puts its stable prefix (system, tool schema) first with `cache_control` via `lib/anthropic-cache.ts`.
- Ceiling: **15 cents (`SEED_MAX_USD = 0.15`) per seed**, paid search **at most 3 searches (`SEED_WEB_SEARCHES = 3`)**, at most **4 candidates scored (`SEED_MAX_CANDIDATES = 4`)**.
- Seeds expire after **7 days** (`SEED_DAYS`, unchanged). **No cap on open seeds.** Headline ≤ 200 chars, text ≤ 10,000, 60-second double-click guard, a scored slate must exist (all unchanged).
- Say "text on screen", not "trial reels", in labels, logs and chat. Do not rename code identifiers.
- Work on the current branch (`home-dashboard`). Commit per task; never create, switch or merge branches; never push.
- Worker logic changes (Task 1 touches nightly scoring) must be redeployed with `./scripts/gcp/deploy-worker-code.sh` in the same session (Task 9, after Tommy's go-ahead).

## Review Focus

- A Google News wrapper link pasted as the link: resolve it first; if it cannot be resolved, take the unreadable-link path rather than failing.
- Same story pasted with different tracking parameters: the canonical URL matches, so it stops as a duplicate.
- Google News returns zero items or an HTTP error: treat as no results and move on to the next tier, never a 500.
- Every candidate fails to score (Jev down): nothing is added, nothing is half-written, the message says scoring was unavailable.
- Confirm-paid sent twice, or sent while the paid prompt is not approved: no second spend, and no spend at all when not approved.

## File Structure

- Modify `lib/reels/scoring/store.ts` — `loadSlateRanked` skips seeds.
- Modify `lib/social-hub/queries/reels.ts` — `REEL_IDEAS_SQL` ordering.
- Modify `lib/reels/seeds.ts` — status union, duplicate stop, no cap, substitute flow.
- Create `lib/reels/seed-search.ts` — candidate search, relatedness, pick best, paid search wrapper, cost constants.
- Create `lib/reels/prompts/seed-search.ts` — the paid search prompt (needs Tommy's wording approval).
- Modify `app/api/reels/seed/route.ts`, `components/content-type/ReelSeedButton.tsx` — new statuses and panels.
- Modify `tests/idea-seeding-reels.test.ts`; create `tests/idea-seeding-reels-search.test.ts`.

---

### Task 1: The night leaves seeds alone

**Files:**
- Modify: `lib/reels/scoring/store.ts` (`loadSlateRanked`, ~line 87)
- Test: `tests/idea-seeding-reels.test.ts` (replace the test at ~line 261, "the night’s carryover rule picks up a high-net seed")

**Interfaces:**
- Produces: `loadSlateRanked(nyDate)` returns no row for an idea whose source is a seed (`adapter_id = 'seed' AND drop_reason = 'seed'`). Its only caller is `lib/reels/pipeline/scoring.ts:97-98`; confirm with grep before editing.

- [ ] **Step 1: Rewrite the existing test** as `the night’s carryover rule never picks up a seed, however high its net`. Seed a high-net seed (net 9) onto yesterday's slate, call `loadSlateRanked`, run `carryoverMisses(ranked, heldFromCarryover(ranked))`, assert the seed's id is absent and the normal idea (`NORMAL`) is still a candidate.
- [ ] **Step 2: Run** `npx tsx --test tests/idea-seeding-reels.test.ts` — expect the new test to FAIL (seed still present).
- [ ] **Step 3: Implement** by adding `AND NOT EXISTS (SELECT 1 FROM reels.post_idea_members m JOIN reels.sources so ON so.id = m.source_id WHERE m.post_idea_id = s.post_idea_id AND so.adapter_id = 'seed' AND so.drop_reason = 'seed')` to the `WHERE` in `loadSlateRanked`.
- [ ] **Step 4: Run** the same command — expect PASS, and the pin test (`putOnSlate copies the seed’s stored row`) still PASS (pins do not use this query).
- [ ] **Step 5: Commit** `fix(reels): the night's carryover skips Text on Screen seeds`

### Task 2: Queue sorts seeds by score

**Files:**
- Modify: `lib/social-hub/queries/reels.ts:271` (`ORDER BY` of `REEL_IDEAS_SQL`)
- Test: `tests/idea-seeding-reels.test.ts`

**Interfaces:**
- Consumes: the `yours` column already in the query (line 249).
- Produces: rows ordered so a seed with net N sits after every non-seed idea whose net is greater than N and before the rest; non-seeds keep rank order; unscored seeds (`net IS NULL`) sort last.

- [ ] **Step 1: Test** `the queue puts a seed where its score falls, not last`. Ideas on the slate with nets 3.0 (rank 1), 2.0 (rank 2), 1.0 (rank 3); seed with net 2.5. Assert `REEL_IDEAS_SQL` rows order is `[3.0, seed 2.5, 2.0, 1.0]`. A second assertion: a seed with net 0.5 is last; an unscored seed is after it.
- [ ] **Step 2: Run** — expect FAIL (seed is last).
- [ ] **Step 3: Implement** the ordering as `ORDER BY CASE WHEN s.net IS NULL THEN 1 ELSE 0 END, CASE WHEN yours THEN (SELECT count(*) FROM pool p WHERE p.net > s.net AND NOT EXISTS (seed check for p)) + 0.5 ELSE s.rank END NULLS LAST, s.net DESC NULLS LAST`. The seed check reuses the `seeds` CTE. Do not change stored ranks and do not call `rerankSlate`.
- [ ] **Step 4: Run** — expect PASS, including the existing pool-view tests.
- [ ] **Step 5: Commit** `feat(reels): sort Text on Screen seeds into the queue by score`

### Task 3: Remove the open-seed cap

**Files:**
- Modify: `lib/reels/seeds.ts` (remove the `MAX_OPEN_SEEDS` constant and the check at line 180; keep `readOpenSeeds`, still used elsewhere — grep first)
- Modify: `tests/idea-seeding-reels.test.ts` (test at ~line 154)

- [ ] **Step 1: Rewrite the test** as `an 11th open seed is accepted; expired and archived seeds still leave the pool`. Add 11 seeds with distinct headlines; assert none is refused.
- [ ] **Step 2: Run** — expect FAIL on the 11th.
- [ ] **Step 3: Implement** the removal. Update the file's header comment and the drawer text if either mentions the limit (`grep -rn "seeded ideas waiting"`).
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(reels): no cap on open Text on Screen seeds`

### Task 4: Duplicate stops and shows the existing idea

**Files:**
- Modify: `lib/reels/seeds.ts`
- Test: `tests/idea-seeding-reels.test.ts` (replace the test at ~line 250, "warnings…added anyway")

**Interfaces:**
- Produces (used by Tasks 6–8):
```ts
export type ReelSeedOutcome =
  | (ReelSeedResult & { status: 'added'; substitute?: { url: string; title: string; why: 'link_unreadable' | 'headline_only' } })
  | { status: 'duplicate'; existing: { id: string; headline: string; net: number | null; yours: boolean } }
  | { status: 'needs_paid_confirm'; estimateUsd: number; maxUsd: number }
  | { status: 'no_match'; reason: 'nothing_found' | 'scoring_unavailable' };
export async function findQueueDuplicate(canonical: string | null, headline: string): Promise<ReelSeedOutcome & { status: 'duplicate' } | null>;
```
- `addReelSeed(input: { headline?; text?; url?; seedAnyway?: boolean; confirmPaid?: boolean }, deps: ReelSeedDeps): Promise<ReelSeedOutcome>`. The double-click `repeat` result is returned with `status: 'added'`.

- [ ] **Step 1: Tests** (replace the warnings test with three):
  - `a link already in the queue stops with the existing idea and spends nothing`: first seed added; second seed with the same URL plus `?utm_source=x` returns `status: 'duplicate'`, `existing.id` equal to the first, Jev call count unchanged, one source row.
  - `a headline close to a queued idea stops the same way` (similarity ≥ 0.6, the existing `HEADLINE_FLOOR`).
  - `seedAnyway adds it after a duplicate stop` — result `status: 'added'`.
  - "In the queue" means the idea is on the newest slate or is an open seed (the same pool `REEL_IDEAS_SQL` lists), not any idea in `reels.sources`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** `findQueueDuplicate` (canonical-URL match first, then `shortlistCandidates(..., 1, HEADLINE_FLOOR)` restricted to queue ideas); call it before any spend, skipped when `seedAnyway`. Keep "story already posted" as a flag (note only). Drop the two replaced flags. Return `status: 'added'` on success paths.
- [ ] **Step 4: Run** — expect PASS; the other existing tests still PASS after adding `status` to their expectations.
- [ ] **Step 5: Commit** `feat(reels): a seed already in the queue stops and shows the existing idea`

### Task 5: Candidate search, free tiers

**Files:**
- Create: `lib/reels/seed-search.ts`
- Test: `tests/idea-seeding-reels-search.test.ts`

**Interfaces:**
- Produces:
```ts
export const SEED_MAX_USD = 0.15;
export const SEED_WEB_SEARCHES = 3;
export const SEED_MAX_CANDIDATES = 4;
export const OVERLAP_FLOOR = 0.4;   // my call: share of the seed headline's significant words a candidate must contain
export const COLLECTED_FLOOR = 0.3; // my call: trigram floor for collected stories (the duplicate check uses 0.6)
export type SeedCandidate = { url: string; headline: string; body: string; outlet: string; source: 'collected' | 'news' | 'web' };
export function headlineOverlap(seedHeadline: string, candidateHeadline: string): number;
export async function collectedCandidates(headline: string): Promise<SeedCandidate[]>;
export async function newsCandidates(headline: string, deps: { fetchText: (url: string) => Promise<string>; readPage: (url: string) => Promise<string | null> }): Promise<SeedCandidate[]>;
```
- `collectedCandidates` reads `reels.sources` (non-seed, `drop_reason IS NULL`, inside `REFERENCE_POOL_HOURS`) via a trigram match at `COLLECTED_FLOOR`, limit 4, body ≥ 200 chars. `newsCandidates` builds `https://news.google.com/rss/search?q=<encoded headline>&hl=en-US&gl=US&ceid=US:en`, parses with `parseFeed` (`lib/reels/net/feed.ts`), resolves wrapper URLs with `resolveGoogleNewsUrl`, reads each page with `readPage`, keeps pages ≥ 200 chars, limit 4. Any fetch error returns `[]`.

- [ ] **Step 1: Tests**: `headlineOverlap` cases (identical = 1, unrelated < 0.2, stop-words ignored); `collectedCandidates` finds a seeded `reels.sources` row and skips seeds and short bodies; `newsCandidates` with a stubbed RSS string returns candidates, with `fetchText` throwing returns `[]`, with an RSS of zero items returns `[]`.
- [ ] **Step 2: Run** `npx tsx --test tests/idea-seeding-reels-search.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(reels): free candidate search for headline-only seeds`

### Task 6: Pick the best match; headline-only and unreadable-link paths

**Files:**
- Modify: `lib/reels/seed-search.ts`, `lib/reels/seeds.ts`
- Test: `tests/idea-seeding-reels-search.test.ts`, `tests/idea-seeding-reels.test.ts` (replace the test at ~line 202, "an unreadable link still adds the idea")

**Interfaces:**
- Consumes: `scoreOneIdea(runId, jev, idea: IdeaMaterial)` (`lib/reels/pipeline/scoring.ts:50`); `IdeaMaterial = { id; lastJoinedMs; members: [{ role: 'primary', sourceName, headline, body }] }`; Task 4's `ReelSeedOutcome`.
- Produces:
```ts
export async function pickBest(headline: string, candidates: SeedCandidate[], jev: JevRunner): Promise<{ candidate: SeedCandidate; score: InterpretedScore } | { failed: 'none_related' | 'scoring_unavailable' }>;
```
`pickBest` drops candidates with `headlineOverlap < OVERLAP_FLOOR`, scores at most `SEED_MAX_CANDIDATES` in parallel with `scoreOneIdea` (in-memory `IdeaMaterial`, ids `candidate:<n>`), skips ones that throw or have `net == null`, returns the highest `net`.
- `ReelSeedDeps` gains `search?: { collected; news; web }` (each a function returning `SeedCandidate[]`; `web` also returns `usd`), defaulting to Task 5's functions and Task 7's.

- [ ] **Step 1: Tests** (stubbed Jev, all offline):
  - `pickBest` returns the highest-net related candidate and ignores a higher-net unrelated one.
  - `pickBest` with Jev throwing for every candidate returns `{ failed: 'scoring_unavailable' }`.
  - Headline-only seed with a collected match: `status: 'added'`, `substitute.why === 'headline_only'`, source row's `canonical_url` is the candidate's, idea headline is the typed headline, one `idea_scores` row, no extra scoring of the idea (the candidate's score is reused: Jev call count = 2 × candidates scored).
  - Collected empty, news has one: news tier is used. Both empty and paid not approved: `status: 'no_match'`, `reason: 'nothing_found'`, nothing written.
  - Headline + unreadable link: `status: 'added'`, `substitute.why === 'link_unreadable'`, and `flags` include a note naming the unreadable link and the story used.
  - Duplicate check runs again on the substitute's URL: a substitute already in the queue returns `status: 'duplicate'`.
  - One-word headline with no related candidate: `no_match`.
- [ ] **Step 2: Run** both files — expect FAIL.
- [ ] **Step 3: Implement** `pickBest`; in `addReelSeed`, when there is no `text` and (no `url` or the page read fails), run tiers in order collected → news → (Task 7) and write the seed from the chosen candidate using the existing source/idea/`writeSeedRow` code with the candidate's score. Free tiers are tried in order and the first tier with an acceptable candidate wins.
- [ ] **Step 4: Run** both files — expect PASS.
- [ ] **Step 5: Commit** `feat(reels): headline-only and unreadable-link seeds find a related story`

### Task 7: Paid search tier with the 15-cent ceiling

**Files:**
- Create: `lib/reels/prompts/seed-search.ts`
- Modify: `lib/reels/seed-search.ts`, `lib/reels/seeds.ts`
- Test: `tests/idea-seeding-reels-search.test.ts`

**Interfaces:**
- Produces:
```ts
export function seedSearchApproved(): boolean; // process.env.REELS_SEED_SEARCH_PROMPT_APPROVED === 'true'
export function estimatePaidSearchUsd(): number; // 0.10: SEED_WEB_SEARCHES * 0.01 plus a 0.07 token allowance
export async function webCandidates(headline: string, deps: { client: CopyClient }): Promise<{ candidates: SeedCandidate[]; usd: number }>;
```
- Behavior: a single `messages.create` call (model `B6_MODEL`), tool `{ type: 'web_search_20250305', name: 'web_search', max_uses: SEED_WEB_SEARCHES }`, `max_tokens: 2000`, system and tool blocks carry `cache_control` (`cachedSystemText`, `withToolCache`). Cost = `computeSearchCostUsd(searches)` + token cost from the message usage; returned as `usd` and recorded with `recordCost` (vendor `anthropic`, component `seed-search`).
- `addReelSeed` reaches this tier only after both free tiers found nothing. If `!seedSearchApproved()` it returns `no_match` (`nothing_found`) and spends nothing. If `!confirmPaid` it returns `needs_paid_confirm` with `estimateUsd` and `maxUsd: SEED_MAX_USD`. With `confirmPaid` it runs the tier. The 60-second headline guard (existing) makes a repeated confirm return the first seed.

- [ ] **Step 1: Write the prompt file and STOP.** Show Tommy the proposed wording (find one article on the open web about the given headline, return up to 3 articles with URL, headline and the article's own text; no commentary) and get his approval before wiring it. Record his approval in the file's header comment, following `lib/reels/prompts/web-search.ts`.
- [ ] **Step 2: Tests** with a stub client (no network): (a) `estimatePaidSearchUsd() <= SEED_MAX_USD`; (b) the request has `max_uses === 3`, `max_tokens === 2000` and `cache_control` on the system block and the tool; (c) a stub reply with 3 searches and known usage returns `usd` equal to the formula; (d) not approved: no client call, `no_match`; (e) approved without `confirmPaid`: `needs_paid_confirm`, no client call; (f) approved with `confirmPaid`: one client call, candidates scored through `pickBest`; (g) a repeated confirm within 60 seconds: one client call total; (h) the worst case (`max_uses` searches at 0.01 plus `max_tokens` output at the model's rate plus a 60,000-token input allowance) is ≤ `SEED_MAX_USD`, computed with `lib/anthropic-pricing.ts`.
- [ ] **Step 3: Run** — expect FAIL.
- [ ] **Step 4: Implement** the three functions and the `addReelSeed` branch.
- [ ] **Step 5: Run** — expect PASS.
- [ ] **Step 6: Commit** `feat(reels): paid web search tier for seeds, 15-cent ceiling, behind approval`

### Task 8: Route and drawer

**Files:**
- Modify: `app/api/reels/seed/route.ts`, `components/content-type/ReelSeedButton.tsx`
- Create: `lib/reels/seed-outcome.ts` (pure helper) and `tests/reel-seed-outcome.test.ts`

**Interfaces:**
- Produces: `seedOutcomeView(out: ReelSeedOutcome): { kind: 'toast'; text: string } | { kind: 'duplicate'; existing: {...} } | { kind: 'confirm'; text: string; estimateUsd: number } | { kind: 'none'; text: string }`.

- [ ] **Step 1: Tests** for `seedOutcomeView`: added → toast naming score and, when `substitute` is present, the substitute story and why; duplicate → existing idea's headline and score; `needs_paid_confirm` → text with the estimate formatted in cents; `no_match` → plain message for each `reason`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the helper. In the route, pass `seedAnyway` and `confirmPaid` from the body, add `export const maxDuration = 120`, and update the doc comment (it still says "two Jev calls, well under a cent"). In the drawer: duplicate panel with **Seed anyway** (resends with `seedAnyway: true`) and **Use existing** (closes the drawer); confirm panel with **Search the web (about N¢, max 15¢)** (resends with `confirmPaid: true`) and **Cancel**; keep the "Yours" badge from the queue view and verify it renders for substitute seeds.
- [ ] **Step 4: Run** `npx tsx --test tests/reel-seed-outcome.test.ts` and `npx tsc --noEmit` — expect PASS / no new errors.
- [ ] **Step 5: Commit** `feat(reels): seed drawer shows duplicates and the paid-search estimate`

### Task 9: Full run, worker redeploy, hand-off

- [ ] **Step 1:** `npm test` — expect all tests pass; if the PGlite tests cannot run locally (missing env), say so and name them; do not call them passing.
- [ ] **Step 2:** `npx tsc --noEmit` and `npm run lint` — report any failure.
- [ ] **Step 3:** Ask Tommy before running `./scripts/gcp/deploy-worker-code.sh` (Task 1 and the jsdom pin both need it). Run only on his yes, then report the output.
- [ ] **Step 4:** Tell Tommy exactly what to click on the deployed build: a headline + link seed, the same seed again (duplicate panel), a headline-only seed (free path), and, only if he wants it, a paid one. Agents do not run these.
