# Helios Social rebuild: implementation plan


**Spec:** `docs/superpowers/specs/2026-10-01-helios-social-rebuild.md` (the authority; this plan only sequences it)
**Owner:** Tommy Pozo
**Status:** DRAFT, not started

## Ground rules for every milestone

- **One milestone at a time.** Meet its acceptance criteria and report before starting the next.
- **Tests are offline.** Pure functions, SQL and plumbing are tested with stubbed model responses. **No live Claude, Jev or web-search calls in tests or agent runs.** The only live run is §5D, and only with Tommy's go-ahead.
- **Prompt caching** on every `messages.create`: stable prefix first, `cache_control` on the last stable block (`lib/anthropic-cache.ts`, `docs/prompt-caching.md`).
- **Worker sync:** any change to worker logic or worker environment variables also redeploys the GCP VM (`./scripts/gcp/deploy-worker-code.sh`) in the same session.
- **Change tag on every commit:** `cause/symptom · type · new stages · new AI calls` (spec §2.2). Anything tagged 🔴 needs a written spec exception first.
- **No patches from single failures** (spec §2.3, §5C).

## Pull rule (DECIDED, supersedes the longer list below)

**Pull only code that fetches, draws or stores. Write fresh anything that decides.**

The old pipeline's errors came from its judgment layer (stages, prompts, rules, loops, checks), not from its plumbing. So only plumbing comes over, and it must not import any old pipeline code. The type checker enforces that.

**The minimal pull (~15 files):**

| Area | Files | Why it's safe |
|---|---|---|
| Slide drawing | `lib/social/render/SlideTemplate.tsx`, `lib/social/render/types.ts`, `app/social/render/preview/` (+ `fixtures/social/example-post.ts`) | Draws slides from data; no editorial logic |
| Photo lookups | `v2/image-step/wikidata.ts`, `commons.ts`, `openverse.ts`, `cache.ts`, `storage.ts`, `used-log.ts` | Fetch and store photos; no imports from the old pipeline |
| Fetching news | `lib/social/ingest/fetch-feeds.ts`, `extract-article-body.ts`, `resolve-google-news.ts`, `lib/social/feeds.ts` (feed list) | Fetch articles; no judgment |
| Shared plumbing | `lib/anthropic-cache.ts`, `lib/anthropic.ts`, `lib/db.ts`, `lib/social/session.ts` | Project-wide infrastructure |

**Written fresh** (old files may be **read as reference**, never copied in):

- **Orchestrator, brief parser, adapter, rules block, mechanical checks, cover fit, duplicate grouping, Jev questions:** all new.
- **The image-step entry point (`index.ts`) and the image check (`vision.ts`):** new. The old ones encode the old IMAGE-line rules.
- **JPEG export:** new and small.
- **All prompts:** start from `specs/2026-10-04-helios-social-prompts.md`, not from a blank page. Tested text there (Reporter, Writer, caption) is copied, not reworded; only its "added since the test" items are new. The Editor and Fact-checker drafts there are the starting point.
  - Reference: the old Reporter's reporting rules. The caption instructions carry over verbatim (spec §4.3) and are already in the prompts file.
- **Review page:** keep the look; rebuild its data loading and buttons on the new post shape. The old `PageClient.tsx` and the review route are reference.

**Reference only, never pulled:** `lib/social/photos/atmosphere.ts`, used to seed the photo bank's theme list.

The tables below are kept as the import-trace record. Where they say "pull, then rework", read it as **write fresh, using the old file as reference.**

## Branch and what to pull (traced from actual imports, 2026-10-04)

**Method:** new branch `feature/helios-social-rebuild`. Bring files over with `git checkout helios-social-v2/2026-10-02-root-cause-fixes -- <path>`, then run the type checker. Any import of a removed module shows up as an error, so the compiler defines the boundary.

**Pull as is** (no imports of removed code):

| Area | Files |
|---|---|
| Slide renderer (v2 path) | `lib/social/render/SlideTemplate.tsx`, `lib/social/render/types.ts`, `app/social/render/preview/` (+ `fixtures/social/example-post.ts`), `v2/cover-fit.ts`, `v2/cover-reflow.ts` |
| Photo lookup base | `v2/image-step/` (wikidata, commons, openverse, vision, used-log, cache, storage, index), `v2/image-line.ts` |
| Ingest | `lib/social/ingest/fetch-feeds.ts`, `extract-article-body.ts`, `resolve-google-news.ts`, `lib/social/feeds.ts`, `lib/social/watchlist.ts` |
| Shared | `lib/anthropic-cache.ts`, `lib/anthropic.ts`, `lib/db.ts`, `lib/social/session.ts`, `v2/voice-block.ts`, `v2/tools/fetch-page.ts` (reworked in M2) |

**Pull, then rework** (each one encodes old decisions or old data):

| File | Why |
|---|---|
| `v2/adapter.ts` | Maps posts to slides; depends on `parse.ts` types, which change |
| `v2/render-preview.ts` | Imports a type from `test-runner-support.ts` (being removed). Swap in a local type. |
| `v2/export-winner.ts` (JPEG export) | Imports the `Winner` type from `jev-gate.ts` (being removed). Swap in a local type. |
| `v2/parse.ts` | Parses the **old** brief format; the new structured brief needs new parsing (M2) |
| `v2/rules-block.ts` | Still holds the coverage floor, "type only" on stat slides and "the Editor keeps kinds", all changed in the spec. **Rewrite.** |
| `v2/code-checks.ts`, `v2/rules/registry.ts` | Review every check against the spec; drop checks for removed rules |
| `lib/social/dedup.ts` | Groups stories using companies/people/topics from the **Haiku extraction we're removing**. Needs a new way to group (M1). |
| `lib/social/ingest/judge-relevance.ts`, `lib/social/rubric.ts` | Single relevance question → the full Jev question set (M1) |
| `app/social/PageClient.tsx`, `app/social/actions/loadBatch.ts`, `app/api/social/review/[id]/route.ts`, `lib/social/types.ts` | The review page is built on the **old pipeline's article shape** (and uses `dedup.ts`). The buttons carry over; the data model behind them is reworked in M7. |
| `lib/social/photos/atmosphere.ts` | Hand-picked Unsplash theme photos: the seed for the Helios photo bank |
| `v2/prompts/*` | Reworked per M2–M4; caption instructions carried over to the Writer verbatim |

**Leave behind:**

- **Removed stages:** `v2/orchestrate.ts`, `field-repair.ts`, `fact-check-cut.ts`, `jev-gate.ts`, `caption.ts`, `enforce-structure.ts`, `test-runner-support.ts`.
- **Dropped ingest calls:** `ingest/extract-packet.ts`, `ingest/shadow-haiku-judge.ts`.
- **The whole older pipeline:** `pipeline/generate.ts`, `editorial/strategy*.ts`, `copy.ts`, `fact-sheet.ts`, `story-plan.ts`, `hook-mine.ts`, `archetype.ts`, `qa.ts`, `polish.ts`, `repair.ts`, and `photos/subjects.ts`, `photos/picker.ts`.
- **Correction:** `render/layout-picker.ts` and `render/photo-assigner.ts` were first listed as "keep". They belong to the old pipeline (they import `copy.ts`, `fact-sheet.ts`, `story-plan.ts`, `photos/picker.ts`), so they're left behind. The v2 renderer doesn't use them.
- **`lib/social/editorial/config.ts`:** used only by removed or reworked modules. Re-create only what's needed.

## Relationship to Trial Reels (DECIDED)

Trial Reels (`lib/reels/`) is a **separate product with different criteria**. Social never modifies Reels code, tables or workers.

- **Not used:** anything in Reels' Jev setup, its question sets or its scoring criteria. Social writes its own Jev client on the `@typesafe-ai/sdk` package, and its own versioned question sets (spec §5A, §5B, §5B-1).
- **Not used:** Reels' ingest, grouping, fetchers, copy, visual or music code.
- **Usable: the Instagram integration (M8).** The Meta credentials/account setup and the low-level Instagram API client may be reused **read-only**.
  - **If generic:** if the low-level pieces (token/account config, API request helper) are generic, import them as they are.
  - **If tied to Reels:** if they're tied to Reels tables or video jobs, write Social's own client using the same Meta credentials. Don't edit Reels to make them generic.
  - **Carousel calls are new either way:** Reels publishes video, and carousels use Instagram's carousel container flow.
- **Social keeps its own feed and page fetching:** re-pull the old Social fetchers (`lib/social/ingest/fetch-feeds.ts`, `extract-article-body.ts`, `resolve-google-news.ts`) and their 4 packages (`rss-parser`, `jsdom`, `@mozilla/readability`, `google-news-decoder`).

## Step 0: risk tests first (first days, before the full build)

Test the three things most likely to surprise us, so a failure shows up in week one, not week three:

| Test | What | Cost / approval |
|---|---|---|
| ~~S1: Jev story scoring~~ | **Dropped (2026-10-04).** No hand-labelled set. Jev thresholds are calibrated from live run reports (§2.3); every run logs Jev's raw answers per candidate for that. | — |
| **S2: Photo coverage** | Script on Tommy's machine: for every person and company in past briefs, does Wikidata/Commons have a usable photo, and how many have two or more? Plus a sample of the other sources. | No AI. Free. |
| **S3: Instagram publish** | Publish one test carousel (JPEGs + caption) to a private or test account through the existing Meta setup. | No AI. **Tommy's OK.** |

If one fails, adjust the spec before building around it.

## Milestones

### M0: Skeleton and removals

- **Remove:**
  - fact-check loop
  - Writer rewrite path
  - `field-repair.ts`
  - Editor CUT / repair mode
  - `fact-check-cut.ts`
  - final-gate bail
  - `jev-gate.ts` and 6-draft generation
  - separate Caption stage
- **New orchestrator:** Jev scoring → Reporter → Writer → Editor → Fact-checker → Design → mechanical checks, with every model stage stubbed.
- **Set-aside log:** stage + reason code + story; stories expire with the day.
- **Cost meter** with the $5/day cap.
- **Accept:**
  - an end-to-end dry run with stubs produces a post object and log entries;
  - the removed modules have no remaining imports;
  - the test suite is green.

### M1: Ingest and story selection (spec §5B, §5B-1, §5A #1–2)

- Feeds, freshness filter (24h, 36h on weekends), feed-health log.
- Duplicate grouping in code (same story, many outlets = 1 candidate, with outlet count).
- One Jev call per candidate:
  - the 6 scoring questions, with relevance reworded to "AI is the main subject";
  - the 4 skip-list category questions;
  - the "already posted" question.
- Ranking, tie-break by outlet count, shortlist of up to 10, 2 winners with the different-stories rule, backups in order, widen to 48h if fewer than 2 qualify.
- **Remove** the per-article Haiku extraction. Leave the shadow judge off.
- **Accept:** fixture feeds with stubbed Jev answers give the expected shortlist, winners, skips and feed-health entries.

### M2: Reporter and raw-text page reader (spec §4, §4.2c, §5.1)

- **Reporter prompt:** from the prompts file, §1.

- `fetch-page` returns **raw text** plus the photos with captions and credit lines (code, no summarizing).
- **New brief format:**
  - THE NEWS
  - WHY IT MATTERS
  - F / B facts with sources
  - Q quotes (exact text, ⚠ for single-source)
  - N numbers with a number type
  - TERMS
  - SUBJECTS
  - EVENTS
  - ARTICLE PHOTOS
  - NOT ANSWERED
  - SOURCES
  - [CLAIM: X says] marks
- A parser for the brief, with validation (IDs unique, every fact sourced).
- **Accept:** a saved fixture brief (the Super Intelligence Force or Robinson story) parses, and a malformed brief fails with a clear error.

### M3: Writer and copy-by-ID (spec §4.1a, §4.2a, §4.3, §5.3, §5.3a)

- **Writer prompt:** from the prompts file, §2–3 (tested text plus the listed additions):
  - quotes and numbers by ID, plus exact excerpts;
  - 3 cover options;
  - role before an unknown name;
  - an IMAGE line on every slide;
  - a symbolic stock search on stat slides;
  - the caption instructions carried over verbatim from `prompts/caption.ts`;
  - "stop when the story is told".
- **Code fill-in:** IDs → exact text. Excerpt and quoted-words check against the brief.
- **Accept:** a stubbed Writer output with IDs renders exact quotes and numbers; a made-up excerpt is rejected.

### M4: Editor, Fact-checker, fixes and fresh drafts (spec §4.1, §4.2, §4.2b)

- **Editor prompt:** from the prompts file, §4 (line editor, the four reader checks, cut/sharpen only).
- **Fact-checker, two versions:**
  - **Jev claim checking (target):** Writer claim tags `[F3]` → code pairs each sentence with its source passage → one Jev yes/no per pair. Code also flags untagged sentences that contain a number, name or quote.
  - **Claude Fact-checker (comparison, batch 1 only, prompt from the prompts file §5):** the single truth test and the 5 always-flag types, giving a swap from the brief or a cut.
  - Both check all 3 cover options.
- **Fix logic:** swap → cut → cover fallback → a fresh draft (no notes) → next story. Limits: 2 fresh drafts per story, $5/day.
- **Accept:** stubbed flags exercise every branch, and the fresh-draft limit and cost cap are enforced.

### M5: Mechanical guarantees (spec §6)

- **Silent fixes:** punctuation, quotes, whitespace, highlight snapping, credits and Source line.
- **Pass/fail checks:** structure, character limits (one retry), quoted-text match, background slides ≤ 2, agency-credit rejection, photo licence/resolution/crop, render, cost cap.
- **Accept:** a unit test per guarantee.

### M6: Design and photos (spec §5.1–5.3a)

**S2 results (2026-10-04) that shape M6:**

- **People:** 60% have at least 1 usable Commons photo, 47% have 2 or more. Well-known people are covered; lesser-known people mostly aren't.
- **Companies:** 13% have one. Company slides depend on **press kits** and the **photo bank**, so build the press-kit lookup early in M6. The bank needs plenty of generic company scenes (offices, servers, product-in-hand).
- **Identity check:** the subject identity check (spec §5A #5: the P31 type check plus Jev's description match) is required before any subject photo is used.
- **Photo bank (spec §5.1a):** grows from every shipped photo. Build the tag schema, the 7-day reuse rule and the "event photos stay with their event" rule in M6, with the bank second in the search order.

- **Photo chain:**
  - article photos filtered by their credit line;
  - official portraits and government galleries by date;
  - conference Flickr accounts (organizer accounts only);
  - press kits;
  - Commons via Wikidata;
  - stock libraries;
  - broader scene search;
  - the Helios photo bank.
- **Ranking:** code first, then the Jev metadata pre-screen, then the image check on the top ~5.
- No-repeat log.
- **Rendering:** cover fit measured on the rendered slide, face-safe crop (code library), stat-slide darkened backgrounds, layout alternation within a type.
- **Accept:** fixture slides always get a photo; a person slide never falls back to another person; covers pass the fit check.

### M7: Persistence and review page (spec Q8)

- Write finished posts to `article_queue`. Real database writes start here, with Tommy's OK.
- Upload slide JPEGs to Storage.
- **Wire the existing `/social` page and review endpoint:**
  - **Publish** (replaces Approve)
  - **Regenerate with notes** (one rerun)
  - **Reject** (discard + automatically fill the slot from backups)
- Show photo credits and identity proof.
- **Accept:** a stubbed post appears on the page and each button changes its state correctly.

### M8: Instagram publishing and daily schedule

- **Publish** posts the carousel (JPEG URLs + caption) through the existing Meta/Instagram setup, with a single confirm (PROPOSED).
- **Daily schedule** on the GCP worker: ingest → 2 winners → pipeline → review queue. Redeploy the worker.
- **Accept:** a dry-run publish against a test or private target, or a stubbed client.

### M9: First live batch (spec §5D), with Tommy's explicit go-ahead

- 10 stories in one sitting, about $10–17.
- Jev and Claude fact-check side by side. Both results are logged and compared, then the pipeline switches to Jev only if Jev catches everything Claude caught (spec §10).
- Judged on: 0 false facts, 0 wrong-person photos, 0 slides without a photo, 0 render failures, **≥ 7 of 10 approved as is**, plus the other measures.
- **Pass:** switch on the daily schedule.
- **Miss:** fix only what shows up in 3 or more of the 10.

### M10: Spread slide type (spec §5.4), after M9

## Parallel tracks (not blocking)

- **Read the photo terms:** White House photos (overlay/edit and commercial use), Pixabay, Unsplash, EU audiovisual service.
- **Photo bank:** curate a few hundred pre-cleared generic photos tagged by theme.
- **Coverage script:** Wikidata photo coverage of past subjects. Run on Tommy's machine with network access; no AI.
