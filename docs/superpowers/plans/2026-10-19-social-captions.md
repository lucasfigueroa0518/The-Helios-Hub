# Social Captions Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite how Carousel, Reel, Explainer and Last Few Days captions are written, so
they read like a person with a view and every caption ties back to Helios.

**Architecture:**
- **One shared module** (`lib/social/captions/`) holds:
  - the Helios context block;
  - the shared caption rules;
  - the Jev "build fit" question plus the ceiling logic;
  - a small `social_hub.caption_closings` log that feeds "recent closings" and the
    ceiling.
- **Each content type** keeps its own caption call and imports the shared pieces.
- **Carousels** get a new `captioner` stage between the Editor and the Fact-checker. The
  Writer and Editor stop producing the caption.

**Tech Stack:** TypeScript, Node test runner via `tsx --test`, Anthropic Messages API
(cached system prompts via `lib/anthropic-cache.ts`), TypeSafe Jev (`@typesafe-ai/sdk`),
Postgres (Supabase) and pglite in tests.

**Spec:** `docs/superpowers/specs/2026-10-19-social-captions-design.md`

## Global Constraints

- **No live Claude or Jev calls in automated tests.** Stub the model with canned
  responses (CLAUDE.md Rule 1).
- **Prompt caching.**
  - Static parts go in the cached system prefix: the context block, the rules and the
    tool schema.
  - Per-post parts go after the breakpoint: recent closings, `include_build_line` and
    the story payload.
  - Use `cachedSystemText` and `withToolCache` from `lib/anthropic-cache.ts`.
- **Exact voice and format rules.**
  - Never write "DM us".
  - No list of services, no client-result claims, no invented Helios anecdotes, no
    engagement bait.
  - "We" and opinion are allowed only in the builder's read.
  - Every caption names Helios once.
- **Caption limit:** 2,200 characters for every type. That is unchanged.
- **Carousels:** no hashtags. The `Source:` line and the `Photos:` attribution are still
  code-built.
- **Explainers:** keep the episode stamp, the no-URL and no-emoji rules, and 3–5
  hashtags at the end.
- **Build-line constants:**
  - `BUILD_FIT_THRESHOLD = 0.6`
  - `CLOSINGS_WINDOW = 6`
  - `BUILD_LINE_MAX_IN_WINDOW = 2`, which means at most 1 in 3.
- **Context block:** upskilling and team training are excluded from it.
- **Existing review queue:** do not re-caption it. No backfill job (Tommy, 2026-10-19).
- **Version bumps.**
  - Bump every changed prompt's version and never edit a shipped version in place:
    - Reels `copy-caption-v27` becomes `copy-caption-v28`, with a new registry row in
      `planning/Trial Reels/BUILD_PLAN.md`.
    - Explainers `explainer-caption-v3` becomes `explainer-caption-v4`.
    - The Jev set gets `helios-build-fit@1`.
  - Carousel prompts are pinned against `docs/superpowers/specs/2026-10-04-helios-social-prompts.md`.
    Update that doc in the same commit as the prompt.
- **Human decisions.**
  - Applying the schema (`node scripts/apply_social_hub_schema.js --apply`) needs
    Tommy's go-ahead.
  - So does redeploying the worker (`./scripts/gcp/deploy-social-worker.sh`).
- **Live verification.**
  - At most 1 saved post per type, under $0.05 total (pre-approved).
  - If the estimate is higher, ask first.
  - The agent reports telemetry only. Tommy and Lucas judge the quality.
- **Run tests** with `npx tsx --test tests/<file>.test.ts`. The full suite is
  `npm test`. Run `npx tsc --noEmit` before each commit.
- **Git.** Commit on the current branch `unify-social-hub`. Never create or switch
  branches.

## Review Focus

1. **Jev fit call fails or times out.** Expected: `include_build_line` is false and the
   caption still ships with a light Helios mention. Test: Task 1 `decideBuildLine(null, …)`
   and the Task 7 reels stub that throws.
2. **The model omits Helios from the builder's read.** Expected: the stage's own check
   rejects it once with a reason, and the retry fixes it. It must not silently ship with
   no Helios. Tests: Task 4 `check rejects read without Helios`, Task 7 and Task 8
   equivalents.
3. **The Fact-checker cuts the whole builder's read,** for example because it made an
   unsupported Helios claim. Expected: only the captioner re-runs, at most
   `MAX_FRESH_CAPTIONS = 1` time, and after that the existing fresh-draft path. Test:
   Task 5 `orchestrator reruns only the captioner`.
4. **The closings log is empty** (first run, or the table was just created). Expected:
   no recent-closings block in the prompt, and the ceiling allows the line. Test: Task 1
   `recentClosingsBlock([])` and `ceilingAllows([])`.
5. **The Last Few Days model call fails, or returns an opener over 125 characters or a
   line without "Helios".** Expected: fall back to the current template caption and the
   post still ships. Test: Task 9 `falls back to template`.

---

### Task 1: Shared captions module

**Files:**
- Create: `lib/social/captions/helios-context.ts`
- Create: `lib/social/captions/build-line.ts`
- Test: `tests/social-captions-shared.test.ts`

**Interfaces:**
- Produces:
  - `HELIOS_CONTEXT: string`, `HELIOS_CONTEXT_VERSION = 'helios-context-v1'`
  - `CAPTION_SHARED_RULES: string`
  - `type RecentClosing = { closing: string; buildLine: boolean; createdAt: Date }`
  - `recentClosingsBlock(closings: RecentClosing[]): string`, which returns `''` when the
    list is empty
  - `buildLineInstruction(include: boolean): string`
  - `BUILD_FIT` = `defineQuestionSet({ id: 'helios-build-fit', version: 'helios-build-fit@1', questions: { builds: noul(...) } })`
  - `buildFitState(story: { headline: string; text: string }): EntryType`. The text goes
    under `story.untrusted_content`, sliced to 6,000 characters. The state also carries
    `helios: HELIOS_CONTEXT`.
  - `ceilingAllows(recent: RecentClosing[]): boolean`
  - `decideBuildLine(fit: number | null, recent: RecentClosing[]): boolean`
  - The constants listed in Global Constraints.

- [ ] **Step 1: Write the failing tests** in `tests/social-captions-shared.test.ts`:
  - `HELIOS_CONTEXT names the four readers and excludes training`. It matches
    `/forward-deployed/`, `/agentic marketing and sales/`, `/Founder/`, `/Operator/` and
    `/Technical lead/`, and does not match `/train|upskill/i`.
  - `CAPTION_SHARED_RULES bans pitches`. It matches `/DM us/` and `/Helios once/`.
  - `ceilingAllows([])` is true. It is false when 2 of the last 6 have
    `buildLine: true`, and true when the only `true` rows sit beyond the 6 most recent.
  - `decideBuildLine` gives these results:
    - `(0.59, [])` gives false
    - `(0.6, [])` gives true
    - `(null, [])` gives false
    - `(0.9, twoBuildLinesInLastSix)` gives false
  - `recentClosingsBlock([])` returns `''`. With 2 closings the block contains both texts
    and `/do not reuse/i`.
  - `buildLineInstruction(true)` matches `/what Helios builds/`. `(false)` matches
    `/do not describe what Helios builds/i`.

- [ ] **Step 2: Run the tests and confirm they fail**

  Run `npx tsx --test tests/social-captions-shared.test.ts`. Expected: FAIL (module not
  found).

- [ ] **Step 3: Implement `helios-context.ts`**

  Use this exact copy. It is the spec's context block, approved by Tommy.

```ts
export const HELIOS_CONTEXT = `## Who Helios is

Helios is a team of forward-deployed AI engineers who build and ship, not advise from the sidelines. Helios integrates systems and builds proprietary tools when off-the-shelf doesn't cut it. The focus is agentic marketing and sales: automating repetitive work while improving conversion, connecting the stack, and surfacing the intelligence buried in a company's data.

Who Helios builds for, and what each cares about:
- Founder/CEO: systems that remove the bottleneck slowing growth, without hiring a team to run them.
- Marketing/growth: scaling efforts without more headcount or agency fees.
- Operator/COO: automation that replaces manual, repeatable busywork with a system.
- Technical lead: systems integration, stack modernization, custom agents.

What sets Helios apart:
- Builders, not advisors. Helios does both the strategy and the engineering, has built AI content systems at scale since October 2025, and has shipped several full-stack products to production, not prototypes.
- Full-stack visual AI. Image generation, video generation and generative HTML-first design run in production for clients, so Helios knows where they break.

Industries Helios works with (use one as a concrete example only when the story fits; never list them):
Professional services: real estate, law firms, financial services, hospitality and nightlife, accounting and tax, wealth management and RIAs, insurance agencies and brokers, architecture and design, engineering and construction consulting, healthcare practices (dental, med spa, cosmetic, dermatology, concierge medicine), home services (HVAC, roofing, remodeling, landscaping), staffing and recruiting, IT/MSPs, property management.
Consumer brands: food and beverage products, beauty and personal care, supplements and wellness, apparel and footwear, home goods and furniture, pet products, beverage (alcohol, RTD cocktails, non-alc and functional), fitness and boutique studios, automotive (dealerships, detailing, EV/aftermarket), education (tutoring, certification, ed-tech), travel and experiences.

Outcomes Helios works toward (direction only; never state a number or a client result):
- Cutting labor and software spend by replacing manual workflows and stacked subscriptions with owned systems.
- An integrated, AI-forward stack instead of duct-taped tools and manual handoffs.
- Scaling outreach and content without scaling headcount or agency retainers.
- Removing operational bottlenecks so the team works on growth.

Facts about Helios are limited to this block. Never invent a client, a project, a result, or something Helios "is already doing".`;
```

  Write `CAPTION_SHARED_RULES` as a short prompt section stating spec rules 1–5, 7 and 9.
  Each rule is one plain sentence:
  - hook in the first 125 characters, not "X announced Y";
  - short paragraphs;
  - the news part stays factual, third-person and hedged only where it matters, with no
    paragraph about sourcing;
  - the builder's read closes the caption and says what the story changes for someone
    running marketing, sales or ops at a business like the ones above;
  - name Helios once, lightly, worded fresh each time, with "we" allowed only in the read;
  - vary the ending (a question, a share prompt or just the take), and don't default to
    "Would you…?";
  - no "DM us", no list of services, no client results, no invented anecdotes, no
    engagement bait.

- [ ] **Step 4: Implement `build-line.ts`**

  Wording of the Jev question:

  > Does this story directly touch what Helios builds: agentic marketing or sales
  > automation, connecting business tools and data, or production image/video/design AI?

  - `true`: the story is about a tool, capability or workflow a business could put to
    work in marketing, sales or operations.
  - `false`: it is policy, safety, legal, culture, funding or people news with no direct
    build angle.

  `ceilingAllows` counts `buildLine` in the first `CLOSINGS_WINDOW` entries, assuming the
  newest come first, and returns `count < BUILD_LINE_MAX_IN_WINDOW`.

  `decideBuildLine` returns `fit !== null && fit >= BUILD_FIT_THRESHOLD && ceilingAllows(recent)`.

- [ ] **Step 5: Run the tests and confirm they pass.** Same command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/social/captions tests/social-captions-shared.test.ts
git commit -m "feat(captions): shared Helios context, caption rules and build-line ceiling"
```

---

### Task 2: Closings log table + store

**Files:**
- Modify: `db/social_hub_schema.sql` (append)
- Create: `lib/social/captions/closings-store.ts`
- Test: `tests/social-captions-closings.test.ts`

**Interfaces:**
- Consumes: `RecentClosing` (Task 1)
- Produces:
  - `type CaptionType = 'carousel' | 'reel' | 'explainer' | 'lfd'`
  - `type Query = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>`, the
    same shape as `lib/social/store/pg.ts:17`
  - `recentClosings(query: Query, type: CaptionType, limit?: number): Promise<RecentClosing[]>`.
    The default limit is `CLOSINGS_WINDOW`, newest first.
  - `recordClosing(query: Query, row: { type: CaptionType; subjectId: string; closing: string; buildLine: boolean }): Promise<void>`
  - `type ClosingsLog = { recent(): Promise<RecentClosing[]>; record(subjectId: string, closing: string, buildLine: boolean): Promise<void> }`
  - `closingsLog(query: Query, type: CaptionType): ClosingsLog`

- [ ] **Step 1: Write the failing test** using the pglite scratch-DB pattern from
  `tests/explainers-caption.test.ts`. Apply only the new `CREATE TABLE` block.
  - `records and returns newest first, per type`. It records 3 carousel rows and 1 reel
    row, then checks that `recentClosings(q,'carousel')` has length 3, the newest
    closing comes first, and the reel row is excluded.
  - `limit caps the window`. Record 8 rows; the result has length `CLOSINGS_WINDOW`.

- [ ] **Step 2: Run and confirm it fails.** Run
  `npx tsx --test tests/social-captions-closings.test.ts`.

- [ ] **Step 3: Append to `db/social_hub_schema.sql`**

  Every caption type logs its closing paragraph here, which feeds recent-closings and the
  build-line ceiling (social captions redesign, 2026-10-19).

```sql
CREATE TABLE IF NOT EXISTS social_hub.caption_closings (
    id          bigserial PRIMARY KEY,
    type        text NOT NULL CHECK (type IN ('carousel','reel','explainer','lfd')),
    subject_id  text NOT NULL,
    closing     text NOT NULL,
    build_line  boolean NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS caption_closings_type_created
    ON social_hub.caption_closings (type, created_at DESC);
```

  Implement the store functions with positional params, mirroring `listPosts` in
  `lib/social/store/pg.ts`.

  **Recording time.** A closing is recorded when it is written, not when it is published.
  That way posts captioned earlier in the same run count toward later ones (spec rule 8).
  Recording failures are caught and logged, and they never fail the caption.

- [ ] **Step 4: Run the test and confirm it passes.**

- [ ] **Step 5: Commit**

  `git add db/social_hub_schema.sql lib/social/captions/closings-store.ts tests/social-captions-closings.test.ts`, then
  `git commit -m "feat(captions): caption_closings log and store"`. Do **not** apply the
  schema yet. Task 10 asks Tommy first.

---

### Task 3: Carousel Writer and Editor stop producing the caption

**Files:**
- Modify: `lib/social/writer/draft.ts`:
  - `:107-118` `DraftSubmission`
  - `:146-173` `DRAFT_SCHEMA`
  - `:210` `checkDraft`
  - `:265` caption `tagCheck`
- Modify: `lib/social/writer/prompt.ts`:
  - `:59-63` `WRITER_SECTION_LIST`
  - `:65-107` `CAPTION_CHECK_RULES` and `WRITER_CAPTION_SECTION`
  - `:109-115` `WRITER_SYSTEM`
- Modify: `lib/social/editor/prompt.ts` (`:28`, `:33`)
- Modify: `docs/superpowers/specs/2026-10-04-helios-social-prompts.md`, sections 3 (Writer)
  and the Editor section
- Test: `tests/social-writer.test.ts`, `tests/social-editor-factcheck.test.ts`,
  `tests/social-prompts.test.ts`, `fixtures/social/drafts.ts`

**Interfaces:**
- Produces:
  - `DraftSubmission.caption: TaggedLine` stays required. It now holds only the **news
    part**, and it is `{ text: '', facts: [] }` until the captioner runs.
  - New optional field `DraftSubmission.caption_read?: TaggedLine`, the builder's read.
  - `DRAFT_SCHEMA` no longer has `caption`. `checkDraft` fills the empty caption.

- [ ] **Step 1: Update the tests first.**
  - In `social-writer.test.ts`, the guard test at `:72-98` rebuilds `WRITER_SYSTEM` from
    the updated prompts doc.
  - Add `writer schema has no caption`: `'caption' in DRAFT_SCHEMA.properties` is false,
    and `WRITER_SYSTEM` does not match `/## Caption/`.
  - Add `checkDraft fills an empty caption`: given a submission with no caption, it
    returns `caption` equal to `{ text: '', facts: [] }`.
  - In `social-editor-factcheck.test.ts`, assert that `EDITOR_SYSTEM` does not match
    `/goes to the caption/`.
  - Update `sifDraft()` fixtures to the new shape.

- [ ] **Step 2: Run them and confirm they fail.** Run
  `npx tsx --test tests/social-writer.test.ts tests/social-editor-factcheck.test.ts tests/social-prompts.test.ts`.

- [ ] **Step 3: Implement.**
  - Remove `caption` from the schema and `required`.
  - Remove `CAPTION:` from the section list and drop `WRITER_CAPTION_SECTION` from
    `WRITER_SYSTEM`. Delete it, or move it to the doc's history.
  - Editor prompt:
    - `:28` lists "(cover options, slides)".
    - At `:33`, a gloss that won't fit goes on the slide body or is cut.
  - Mirror every prompt edit in the prompts doc.
  - `draftTextFailures` already tolerates an empty caption. Confirm C1–C4 pass on `''`.

- [ ] **Step 4: Run the tests and confirm they pass,** plus `npx tsc --noEmit`.

- [ ] **Step 5: Commit** with
  `git commit -m "refactor(social): writer and editor no longer write the caption"`.

---

### Task 4: Carousel captioner (prompt, tool, call)

**Files:**
- Create: `lib/social/captioner/prompt.ts`
- Create: `lib/social/captioner/captioner.ts`
- Modify: `lib/social/pipeline/models.ts:9-24`. Add `'captioner'` to `ClaudeStage` with
  `{ model: 'claude-sonnet-5-5', effort: 'medium' }`.
- Modify: `lib/social/prompts/rules-block.ts:79-102`. Add `'captioner'` to `RuleStage`,
  rendering the caption-relevant `CHECKED_RULES` lines (≤2,200 characters, no hashtags,
  voice).
- Modify: `lib/social/mechanical/checks.ts:361`. Widen the `draftTextFailures` stage
  param to include `'captioner'`.
- Modify: `docs/superpowers/specs/2026-10-04-helios-social-prompts.md`. Add a new
  "Captioner" section.
- Test: `tests/social-captioner.test.ts`

**Interfaces:**
- Consumes: `HELIOS_CONTEXT`, `CAPTION_SHARED_RULES`, `recentClosingsBlock`,
  `buildLineInstruction`, `RecentClosing` (Task 1); `runStructuredCall`,
  `StructuredCall` (`lib/social/writer/structured-call.ts:41`); `VOICE_BLOCK`;
  `renderRulesFor('captioner')`.
- Produces:
  - `CAPTIONER_SYSTEM: string`
  - `SUBMIT_CAPTION_TOOL: Anthropic.Tool`, with input
    `{ news: { text: string; facts: string[] }; read: { text: string; facts: string[] } }`
  - `captionerUserMessage(filled: FilledDraft, brief: Brief, recent: RecentClosing[], includeBuildLine: boolean): string`
  - `type CaptionerDeps = { create: MessagesCreate; config?: StageModelConfig }`
  - `runCaptioner(brief: Brief, draft: { submission: DraftSubmission; filled: FilledDraft }, recent: RecentClosing[], includeBuildLine: boolean, deps: CaptionerDeps): Promise<StructuredResult<{ news: TaggedLine; read: TaggedLine }>>`

- [ ] **Step 1: Write the failing tests** in `tests/social-captioner.test.ts`, using the
  `scripted` and `msg` stubs from `social-writer.test.ts`, with the tool name
  `submit_caption`.
  - `system is static and cached`. `req.system[0].text === CAPTIONER_SYSTEM`, it contains
    `HELIOS_CONTEXT`, and it has `cache_control`. The tool has `cache_control`.
  - `per-post inputs go in the user message`. Running with `includeBuildLine = true` and 2
    recent closings, the user message contains both closings and
    `buildLineInstruction(true)`, and the system does not contain them.
  - `check rejects read without Helios`. The first response has
    `read.text = 'This matters for agencies.'` and the second names Helios. The result is
    ok, there are 2 requests, and the second carries an `is_error` tool_result that
    mentions Helios.
  - `check rejects unknown fact ids in news`. `news.facts = ['F99']` triggers a retry.
  - `check rejects a hashtag or a Source line`. `news.text` containing `#AI` or
    `Source:` triggers a retry.
  - `CAPTIONER_SYSTEM retires the wire framing`. It does not match `/Reuters/`, and it
    matches `/builder's read/`.

- [ ] **Step 2: Run and confirm they fail.** Run
  `npx tsx --test tests/social-captioner.test.ts`.

- [ ] **Step 3: Implement `prompt.ts`.**
  - **`CAPTIONER_SYSTEM`** is built in this order:
    1. an intro: you write the Instagram caption for a finished carousel on the Helios
       account;
    2. `HELIOS_CONTEXT`;
    3. `CAPTION_SHARED_RULES`;
    4. the carousel specifics (below);
    5. `VOICE_BLOCK`;
    6. `renderRulesFor('captioner')`;
    7. a "No hashtags" line and an "Image credits and the Source line are added
       automatically" line.
  - **Carousel specifics:**
    - The caption is the take on top of the slides, not a retelling of them.
    - It runs about 4–6 short paragraphs.
    - Every fact in `news` comes from the slides or the BRIEF and is tagged with its IDs.
    - `read` may interpret but may not add facts. Any story fact it uses is tagged.
    - `read` names Helios once.
  - **`captionerUserMessage`** renders:
    - the final slides (headline and body per slide, from `filled`);
    - the BRIEF (same rendering as `writerUserMessage`);
    - `recentClosingsBlock(recent)`;
    - `buildLineInstruction(includeBuildLine)`.

- [ ] **Step 4: Implement `runCaptioner`** with `runStructuredCall`.
  - `check(input)` validates the IDs with the same tag rules as `checkDraft`'s
    `tagCheck`.
  - It requires `/\bHelios\b/` in `read.text`.
  - It rejects `#` and `/^Sources?:/m` in either part.
  - It runs `draftTextFailures` voice and limit checks on the joined text. Joined length
    plus 300 characters of headroom for Source and credits must be ≤ 2,200.

- [ ] **Step 5: Run the tests and confirm they pass.** Also run `npx tsc --noEmit` and
  `npx tsx --test tests/social-prompts.test.ts`.

- [ ] **Step 6: Commit** with `git commit -m "feat(social): captioner prompt and call"`.

---

### Task 5: Wire the captioner into the carousel pipeline, Fact-checker and mechanical

**Files:**
- Create: `lib/social/pipeline/captioner-stage.ts`, mirroring
  `lib/social/pipeline/editor-stage.ts`
- Modify: `lib/social/pipeline/stages.ts:9-27`. Add
  `caption(draft: Draft, brief: Brief): Promise<StageResult<Draft>>`.
- Modify: `lib/social/pipeline/types.ts:16-26`. `STAGE_ORDER` inserts `'captioner'` after
  `'editor'`. Add a `ReasonCode` value `'needs-fresh-caption'`.
- Modify: `lib/social/pipeline/orchestrator.ts:33,135,188-207`:
  - an inner caption → fact-check loop;
  - `MAX_FRESH_CAPTIONS = 1`;
  - a `FreshCaptionNeeded` error.
- Modify: `lib/social/pipeline/stubs.ts:15-23` (`STUB_COST_USD.captioner`) and the
  `createStubStages` caption stage.
- Modify: `lib/social/pipeline/live-stages.ts:94-212`. Build the captioner stage with
  `create`, `jev` and `closingsLog(query,'carousel')`, and add `captioner[]` to
  `StoryLog`.
- Modify: `lib/social/factcheck/flags.ts:16-25,94,103,166-209`. Add part `'caption_read'`
  and a `'fresh-caption'` outcome.
- Modify: `lib/social/factcheck/prompt.ts:19,43`. Add `HELIOS_CONTEXT` and the
  caption_read rules.
- Modify: `lib/social/pipeline/factcheck-stage.ts:19`. Map `fresh-caption` to
  `needs-fresh-caption`.
- Modify: `lib/social/mechanical/checks.ts:81,119-139`. Join the read into the caption
  before the Source line, and include `caption_read.facts` in `citedIds`.
- Modify the stage label and cost maps:
  - `lib/social-hub/health/reasons.ts:60`
  - `lib/social-hub/health/reporters/carousels.ts:9`
  - `lib/social-hub/cost-page/rows.ts:11-15` (`captioner → 'writing'`)
- Modify: `docs/superpowers/specs/2026-10-04-helios-social-prompts.md`, the Fact-checker
  section.
- Test:
  - `tests/social-pipeline.test.ts`
  - `tests/social-live-stages.test.ts` (`:33` `fakeClaude` gets a `submit_caption`
    branch; `:86` stage list)
  - `tests/social-editor-factcheck.test.ts`
  - `tests/social-mechanical.test.ts`

**Interfaces:**
- Consumes:
  - `runCaptioner` (Task 4)
  - `closingsLog`, `ClosingsLog` (Task 2)
  - `BUILD_FIT`, `buildFitState`, `ceilingAllows`, `decideBuildLine` (Task 1)
  - `JevAsk` (`lib/social/jev/client.ts:34`)
- Produces:
  - `createCaptionerStage(deps: { create: MessagesCreate; jev: JevAsk; closings: ClosingsLog; config?: StageModelConfig }): PipelineStages['caption']`
  - `joinCaption(news: string, read: string): string`, which returns `news + '\n\n' + read`.

**Stage behaviour (`createCaptionerStage`):**
1. Load `recent = await closings.recent()`.
2. If `ceilingAllows(recent)`, ask Jev for `BUILD_FIT` with
   `buildFitState({ headline: chosen cover, text: brief summary + facts })` and meta
   `{ version: BUILD_FIT.version, subjectId: storyId }`.
3. If Jev throws, `fit = null`.
4. Compute `include = decideBuildLine(fit, recent)`.
5. Run `runCaptioner`.
6. Set `submission.caption = news` and `submission.caption_read = read`, then call
   `fillDraft`.
7. Call `closings.record(storyId, read.text, include)`, catching errors.
8. Return the Claude cost plus the Jev cost.

- [ ] **Step 1: Write the failing tests:**
  - `social-pipeline.test.ts:50` expects `post.stages` to equal the new `STAGE_ORDER`,
    which includes `'captioner'`.
  - `captioner stage skips Jev when the ceiling is hit`. With 2 build-line rows in the
    stub log, Jev is called 0 times and the user message carries
    `buildLineInstruction(false)`.
  - `captioner stage survives a Jev failure`. The Jev stub throws; the stage is ok and
    `include` is false.
  - `captioner stage records the closing`. The stub log receives
    `(storyId, read.text, include)`.
  - `fact-check can flag the read`. `checkFlags` accepts `where.part = 'caption_read'`
    and `applyFlags` cuts inside `caption_read.text`.
  - `cutting the read to nothing asks for a fresh caption`. `applyFlags` returns
    `kind: 'fresh-caption'`. The same holds when `caption.text` is emptied; that path no
    longer returns `fresh-draft`.
  - `orchestrator reruns only the captioner`. The fact-check script returns
    `fresh-caption` once and then passes. The writer is called once, the captioner twice,
    and the post ships. A second `fresh-caption` falls through to the existing
    fresh-draft path.
  - `mechanical joins read before Source`. Given news `N`, read `R` and a cited fact, the
    caption is `N\n\nR\n\nSource: …`.
  - `FACTCHECK prompt includes Helios context`. The system contains `HELIOS_CONTEXT` and
    matches `/opinion is allowed/i`.

- [ ] **Step 2: Run them and confirm they fail.** Run
  `npx tsx --test tests/social-pipeline.test.ts tests/social-live-stages.test.ts tests/social-editor-factcheck.test.ts tests/social-mechanical.test.ts`.

- [ ] **Step 3: Implement the Fact-checker changes.**
  - Prompt additions:
    - The edited draft now includes `caption` (the news) and `caption_read` (the
      builder's read).
    - Hold `caption` to "the brief is the only truth".
    - In `caption_read`, opinion and interpretation are allowed. A factual claim about the
      story must match the brief. A claim about Helios must match the Helios context
      block; CUT any that doesn't.
    - `FLAGS` `where` accepts `caption_read`.
  - `HELIOS_CONTEXT` goes in the cached system.

- [ ] **Step 4: Implement the stage, the orchestrator loop, the mechanical join,
  stubs/live wiring and the label maps.**
  - In `mechanical-stage`, call `joinCaption` before `applySilentFixes`, then clear
    `caption_read`. The rendered caption and `social.posts.caption` are therefore
    unchanged downstream.

- [ ] **Step 5: Run all the tests and confirm they pass.** Run `npm test` and
  `npx tsc --noEmit`.

- [ ] **Step 6: Commit** with
  `git commit -m "feat(social): captioner stage with Jev build-fit, fact-check of the read, caption-only retry"`.

---

### Task 6: Carousel prompt doc and stub-run sanity check

**Files:**
- Modify: `docs/superpowers/specs/2026-10-04-helios-social-prompts.md`, if anything from
  Tasks 3–5 is still unsynced
- Test: an existing stub run

- [ ] **Step 1: Run the offline stub pipeline,** with no live calls. Run
  `npx tsx --test tests/social-pipeline.test.ts tests/social-overnight.test.ts`.
  Expected: PASS, and the posts carry captions that contain "Helios", with no `#`.

- [ ] **Step 2: Grep for leftovers.** Run
  `grep -rn "WRITER_CAPTION_SECTION\|Reuters, brief like Axios" lib docs/superpowers/specs/2026-10-04-helios-social-prompts.md`.
  Expected: no live references.

- [ ] **Step 3: Commit any fixes** with `git commit -m "chore(social): sync prompts doc"`.

---

### Task 7: Reels captions

**Files:**
- Modify: `lib/reels/copy/skill.ts`:
  - `:71` (`COPY_PROMPT_VERSION = 'copy-caption-v28'`)
  - `:75`, `:81`, `:111`, `:155-169`, `:163`
  - `:208` (arousal)
- Modify: `lib/reels/copy/assemble.ts:56,92,179-189`. Add `HELIOS_CONTEXT` and
  `CAPTION_SHARED_RULES` to `copyStaticSystem()`. Add
  `CopyInput.recentClosings?: RecentClosing[]` and `CopyInput.includeBuildLine?: boolean`,
  and render them in `draftTask`, `rewriteTask` and `polishTask` (the uncached task
  block).
- Modify: `lib/reels/copy/report.ts:42-103,249`. Add the required tool field
  `builder_read: string`.
- Modify: `lib/reels/pipeline/copy.ts:181-219`. Ask Jev, decide, pass the inputs, and
  record the closing.
- Modify: `planning/Trial Reels/BUILD_PLAN.md`, adding the v28 registry row.
- Modify: `tests/reels-copy.test.ts` (`:141-202`), `tests/reels-copy-quality-wave.test.ts`
  (`:247-263`), `tests/reels-copy-tension.test.ts:18`
- Test: `tests/reels-copy-helios.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 exports; `closingsLog(query,'reel')` (Task 2); `JevRunner.ask`
  (`lib/reels/jev/runner.ts`).
- Produces:
  - `CopyReport.builderRead: string`
  - `writeTargetCopy` deps gain `closings?: ClosingsLog`

**Skill text changes (in v28):**
- `:81` and `:163`: "no sales pitch" stays. The offer ban becomes "no list of Helios
  services and no claim about Helios clients or results".
- `:111`: Helios still never speaks in first person in the news part. The builder's read
  is the one place "we" is allowed.
- The caption section gets the builder's read: one short paragraph just before the call
  to action, naming Helios once, following `CAPTION_SHARED_RULES`. Return it verbatim in
  `builder_read` as well.
- Arousal `:208`: when the call to action already asks to follow Helios, the builder's
  read must not name Helios a second time. It still gives the builder's take.

- [ ] **Step 1: Write the failing tests** in `tests/reels-copy-helios.test.ts`, using
  `stubClient` (`reels-copy.test.ts:513`) and `stubJev` (`reels-copy-pick.test.ts:227`):
  - `v28 pins`: `COPY_PROMPT_VERSION === 'copy-caption-v28'`, and `copyStaticSystem()`
    contains `HELIOS_CONTEXT`.
  - `builder_read must appear in the caption and name Helios`. `parseCopyReport` rejects
    a report whose `builder_read` is not a paragraph of `caption`, or does not match
    `/\bHelios\b/`. For an arousal framework with a follow-Helios CTA, the read may omit
    Helios.
  - `task block carries closings and build-line flag`. The assembled prompt's last user
    block contains both closings and `buildLineInstruction(true)`, and the system blocks
    do not.
  - `Jev failure means no build line`. `stubJev` throws; `writeTargetCopy` still saves
    the copy and the task block carries `buildLineInstruction(false)`.
  - `closing recorded`. The stub `closings.record` is called with `(postIdeaId, builderRead, include)`.
  - Update the old pins: drop `/There is no pitch and no offer of Helios services/` and
    the v27 assertions, and add regexes for the new lines.

- [ ] **Step 2: Run them and confirm they fail.** Run
  `npx tsx --test tests/reels-copy*.test.ts`.

- [ ] **Step 3: Implement** the skill text, assemble, report and pipeline changes.
  - Jev state is `buildFitState({ headline: primary member title, text: primary member body })`.
  - The component name is `'copy-build-fit'`.
  - Skip Jev when `!ceilingAllows(recent)`.
  - Add the v28 registry row.

- [ ] **Step 4: Run all the reels tests and confirm they pass.** Run
  `npx tsx --test tests/reels-*.test.ts` and `npx tsc --noEmit`.

- [ ] **Step 5: Commit** with
  `git commit -m "feat(reels): caption v28 with Helios builder's read and build-fit ceiling"`.

---

### Task 8: Explainer captions

**Files:**
- Modify: `lib/explainers/caption.ts`:
  - `:38` (`CAPTION_VERSION = 'explainer-caption-v4'`)
  - `:40-65` (`CAPTION_INSTRUCTIONS`)
  - `:112-155` (user message, schema, signature)
- Modify: `lib/explainers/caption-format.ts:9-14,61-97`
- Modify: `lib/explainers/render/job.ts:543-569`. Add a build-fit decision and record the
  closing.
- Modify: `.cursor/skills/explainer-caption/SKILL.md` (`:43`, `:50`, `:55-56`, Shape,
  Example)
- Test: `tests/explainers-caption.test.ts`

**Interfaces:**
- Consumes: Task 1 exports; `closingsLog(query,'explainer')`; `JevAsk`.
- Produces:
  - `writeExplainerCaption(facts: CaptionFacts, model: string, opts: { recent: RecentClosing[]; includeBuildLine: boolean }): Promise<CaptionDraft>`
  - The json_schema becomes `{ caption: string; builder_read: string }`.
  - `CaptionDraft` gains `builderRead`.
  - `job.ts` deps gain `buildFit?: (facts: CaptionFacts) => Promise<number | null>` and
    `closings?: ClosingsLog`.

**Format changes in `caption-format.ts`:**
- `CAPTION_MIN_BODY_CHARS` goes from 400 to 200.
- `CAPTION_MIN_PARAGRAPHS` goes from 4 to 3 (hook, builder's read, call to action).
- Remove the `speaks as Helios` throw.
- All other rules stay.

**Instruction changes (v4):**
- Embed `HELIOS_CONTEXT` and `CAPTION_SHARED_RULES`.
- The builder's read says where the episode's concept shows up in a real business of a
  kind from the context block, and names Helios once.
- Rule 5 drops "no offer of Helios services" in favour of the shared "no list of
  services" rule.
- Rule 7 drops the we/us ban and "Do not sign off with Helios". "No emoji. No URLs."
  stays.
- Recent closings and `buildLineInstruction` go in the user message.

- [ ] **Step 1: Write the failing tests** in `tests/explainers-caption.test.ts`:
  - Update `:35`. A 250-character, 3-paragraph body with 3 tags now passes. A
    2-paragraph body still fails.
  - `we is allowed`. A caption whose read contains "we build" passes `parseCaption`.
  - `builder_read must be in the caption and name Helios`. This is checked in
    `writeExplainerCaption`'s parse step with an injected stub client. If it fails twice,
    the job uses its existing failure path.
  - Update `:96` to pin v4.
  - `job records closing and skips Jev at the ceiling`. Use the injected
    `deps.buildFit`, `deps.closings` and `deps.writeCaption` stubs.

- [ ] **Step 2: Run them and confirm they fail.** Run
  `npx tsx --test tests/explainers-caption.test.ts tests/explainers-*.test.ts`.

- [ ] **Step 3: Implement** the caption, format and job changes, and the SKILL.md mirror.
  - Live `buildFit` uses `createJevAsk()` with `BUILD_FIT` and
    `buildFitState({ headline: title, text: script })`.
  - It returns `answers.builds.noul`, or `null` on error.

- [ ] **Step 4: Run all the explainer tests and confirm they pass,** plus
  `npx tsc --noEmit`.

- [ ] **Step 5: Commit** with
  `git commit -m "feat(explainers): caption v4 with Helios builder's read, loosened padding gates"`.

---

### Task 8b: Revision — every caption ends on the Helios line; per-format shapes from comps

Spec: the "Revision (2026-10-19): per-format comps" section and revised rules 4, 5, 7 plus
the revised per-type bullets in `docs/superpowers/specs/2026-10-19-social-captions-design.md`.
Version bumps for wording changes:
- Reels: `copy-caption-v29`, with a registry row in `planning/Trial Reels/BUILD_PLAN.md`.
- Explainers: `explainer-caption-v5`.
- Shared: `HELIOS_CONTEXT_VERSION` stays; `CAPTION_SHARED_RULES` text changes.

**Files:**
- Modify: `lib/social/captions/helios-context.ts` (`CAPTION_SHARED_RULES`)
- Modify: `lib/social/captions/build-line.ts` (`buildLineInstruction` wording only, if it
  refers to "read" placement)
- Modify: `lib/social/captioner/prompt.ts` and the prompts doc §9
- Modify the Reels files:
  - `lib/reels/copy/skill.ts`
  - `lib/reels/copy/report.ts` (`fullCaption`, `fitCaptionParts`,
    `shortenAssembledCaption`, `checkBuilderRead`, first-person split)
  - `lib/reels/copy/assemble.ts` (if the order text lives there)
  - `planning/Trial Reels/BUILD_PLAN.md`
- Modify the Explainers files:
  - `lib/explainers/caption.ts`
  - `lib/explainers/caption-format.ts` (`parseCaption`)
  - `.cursor/skills/explainer-caption/SKILL.md`
- Tests:
  - `tests/social-captions-shared.test.ts`
  - `tests/social-captioner.test.ts`
  - `tests/reels-copy*.test.ts`
  - `tests/explainers-caption.test.ts`
  - `tests/explainers-render.test.ts`

**Interfaces:** unchanged signatures. Order changes only.

**Rules to implement:**
1. **`CAPTION_SHARED_RULES`:**
   - The order is body, then the question or call to action, then the Helios line (one or
     two sentences, a builder's take tied to the story, may end as a follow invite, the
     only place for "we" and opinion).
   - Then credits, Source and hashtags where the format uses them.
   - A short specific question is the normal choice; never "what do you think?" or
     engagement bait.
   - A so-what line in the body is fine but does not name Helios.
   - Helios is named once, in the Helios line.
2. **Carousel captioner:**
   - The shape is: surprising first sentence, 2–4 short body paragraphs, a so-what line,
     a specific question.
   - All of that is the `news` part, so the question ends `news`.
   - `read` is the one-or-two-sentence Helios line.
   - The code join (news, read, Source) already puts it last. Assert this in a test.
3. **Reels:**
   - **Order:** `fullCaption` assembles body, CTA, Helios line, hashtags.
   - **The read leaves the body.** `builder_read` is no longer required to be a body
     paragraph. It is the last line after the CTA. Either give it its own position or
     keep it in the report field and assemble it after the CTA, whichever is cleaner.
     The `caption` field instruction changes to match.
   - **Trimming:** the over-length trimmer protects the Helios line and the CTA, and
     drops body paragraphs from just before the CTA backwards.
   - **Arousal framework:** when its follow-Helios CTA exists, the CTA and the Helios line
     must not both name Helios. Pick the cleaner rule: the CTA drops its Helios name and
     the line carries it, or the line becomes the follow invite.
   - **Hooks** lead with a number, a quote or a vivid claim where the story has one.
   - **First-person check:** still exempts the Helios line.
4. **Explainers:**
   - **Shape:** the hook names a problem or situation the reader has that the concept
     explains; then 2–3 short paragraphs; then a save prompt and/or a "which would you use
     first"-style question; then the Helios line; then 3–5 hashtags.
   - **`parseCaption`:** the paragraph before the hashtags must be the Helios line, and
     it must name Helios.
   - **Minimums:** keep the minimum paragraph and body-length checks as relaxed in Task 8
     (3 paragraphs and 200 characters), counting the Helios line.
5. **No emoji change.** The voice rules still ban emoji. That is open for Tommy and Lucas.

- [ ] **Step 1:** Update the pins and tests to the new order (they fail).
  - Carousel: the joined caption ends `…question\n\nREAD\n\nSource: …`.
  - Reels: `fullCaption` gives `body\n\nCTA\n\nREAD\n\n#tags`; the trimmer keeps
    READ and CTA.
  - Explainers: `parseCaption` rejects a caption whose last paragraph before the
    hashtags lacks Helios.
  - Shared: the rules match `/question or call to action, then the Helios line/i` (your
    exact wording, pinned).
  - Arousal: no double Helios between the CTA and the line.
- [ ] **Step 2:** Run them and confirm they fail.
- [ ] **Step 3:** Implement the copy and ordering changes, then mirror them in the
  prompts doc §9 and SKILL.md.
- [ ] **Step 4:** Run the focused tests, `npm test` once, and tsc.
- [ ] **Step 5:** Commit with
  `git commit -m "feat(captions): every caption ends on the Helios line; per-format shapes from comps"`.

---

### Task 9: Last Few Days caption opener and Helios line

**Files:**
- Create: `lib/lfd/caption-lines.ts`
- Modify: `lib/lfd/post.ts:17-30,55`. `captionFor(ready, lines?)` and
  `buildPost(ready, now, lines?)`.
- Modify: `lib/lfd/run.ts:335`. Call `writeLfdCaptionLines` before `buildPost`, then
  record the closing.
- Test: `tests/lfd-post.test.ts`, `tests/lfd-caption-lines.test.ts` (new)

**Interfaces:**
- Consumes: `HELIOS_CONTEXT`, `CAPTION_SHARED_RULES`, `recentClosingsBlock`;
  `closingsLog(query,'lfd')`; `d.create: MessagesCreate` (`run.ts:40-58`).
- Produces:
  - `type LfdCaptionLines = { opener: string; heliosLine: string }`
  - `writeLfdCaptionLines(ready: Ready[], recent: RecentClosing[], create: MessagesCreate): Promise<{ lines: LfdCaptionLines | null; costUsd: number }>`
  - `captionFor(ready: Ready[], lines?: LfdCaptionLines | null): string`

**Behaviour (revised 2026-10-19 after comps; supersedes the opener-only design):**
- **The call:** one cached-system Sonnet call (`claude-sonnet-5-5`, effort low), with a
  json_schema output `{ opener, body, question, helios_line }`.
  - **`opener`** is a swipe cue plus a preview of the topics. It is ≤125 characters, has
    no emoji, and starts by pointing to the swipe.
  - **`body`** is 2–3 prose paragraphs on the week's highlights, wildest story first.
    Facts come only from the stories' own `copy` fields (headline, body).
  - **`question`** is one short "which caught your attention"-style question, worded
    fresh against recent closings.
  - **`helios_line`** is one or two sentences. It gives a builder's read on the week,
    names Helios once, and may end as a follow invite. LFD never gets a build line, so
    the call uses `buildLineInstruction(false)`.
- **Validation:** opener length, no emoji anywhere, `/\bHelios\b/` in `helios_line`, no
  Helios in opener/body/question, and a non-empty body. Any failure or throw gives
  `lines: null`.
- **Caption order:** opener, body, question, `heliosLine`, credits. With `null`, the
  caption is today's exact template (hook, headlines, `FOLLOW_LINE`, credits).
- **Over the limit:** trim body paragraphs from the end first, and never the Helios line
  or the question. The template fallback keeps its existing headline-drop loop.
- **Interface change:**
  - `LfdCaptionLines = { opener: string; body: string; question: string; heliosLine: string }`
  - `writeLfdCaptionLines` has the same signature.

- [ ] **Step 1: Write the failing tests:**
  - `lfd-caption-lines.test.ts`:
    - `valid lines pass through`;
    - `opener over 125 chars gives null`;
    - `helios_line without Helios gives null`;
    - `create throws gives null`;
    - `system is cached and contains HELIOS_CONTEXT; closings in user message`.
  - `lfd-post.test.ts`:
    - `:34` keeps passing with no lines (template fallback);
    - a new case `captionFor with lines uses opener and heliosLine, not the template hook or FOLLOW_LINE`;
    - `falls back to template` when `lines` is null.

- [ ] **Step 2: Run them and confirm they fail.** Run
  `npx tsx --test tests/lfd-caption-lines.test.ts tests/lfd-post.test.ts`.

- [ ] **Step 3: Implement,** and wire `run.ts` so it goes through the existing
  budget-guarded `d.create`. Record `(runId, heliosLine, false)` when the lines are
  non-null.

- [ ] **Step 4: Run all the LFD tests and confirm they pass.** Run
  `npx tsx --test tests/lfd-*.test.ts` and `npx tsc --noEmit`.

- [ ] **Step 5: Commit** with
  `git commit -m "feat(lfd): model-written opener and Helios line with template fallback"`.

---

### Task 10: Schema, live check, deploy (human-gated)

**Files:** none (operations only)

- [ ] **Step 1: Run the full offline suite.** Run `npm test` and `npx tsc --noEmit`.
  Expected: all PASS.
- [ ] **Step 2: Ask Tommy before applying the schema.** Once he approves, run
  `node scripts/apply_social_hub_schema.js --apply`, then verify with:
  `psql "$DATABASE_URL" -X -c "BEGIN READ ONLY; SELECT count(*) FROM social_hub.caption_closings; ROLLBACK;"`.
  Expected: `0`.
- [ ] **Step 3: Estimate the live verification cost.**
  - Plan one saved post per type, re-captioned through the new code path, with nothing
    published and nothing written to review.
  - Report the token estimate.
  - Run only if the total is under $0.05. Otherwise ask Tommy first.
  - Report the objective telemetry: whether Helios is present, character counts, the
    `include_build_line` value, Jev fit, cost.
  - Hand the captions to Tommy and Lucas to judge.
- [ ] **Step 4: Ask Tommy before redeploying the social worker.** Once he approves, run
  `./scripts/gcp/deploy-social-worker.sh`.
- [ ] **Step 5: Report** the milestone summary, and the new constants for tuning
  (`BUILD_FIT_THRESHOLD`, `BUILD_LINE_MAX_IN_WINDOW`) once they have seen output.
