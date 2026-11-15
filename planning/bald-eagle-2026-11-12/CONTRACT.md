# Build contract: Bald-Eagle 2026-11-12

Every name, field and interface that more than one track touches. Decisions live in `PLAN.md` (D1–D10); this file says how they meet in code. A builder that needs to change anything here stops and reports it instead of changing it.

## Ground rules (every track)
- Branch `field-notes`. Don't commit, push, switch branches, deploy or run migrations against Supabase. Leave changes in the working tree.
- No live Claude, `web_search` or Jev/TypeSafe calls from tests or scripts. Tests are offline and use stubs (`npm test` = `tsx --test tests/*.test.ts`).
- Any new or changed `messages.create` uses prompt caching. Go through `writeStructured` (`lib/stories/writer.ts`, already cached) or `lib/anthropic-cache.ts`.
- Schema changes go in a **new** idempotent SQL file under `db/` named `db/bald_eagle_2026_11_12_<track>.sql` (`IF NOT EXISTS`). Don't edit the existing schema files.
- Read-only DB checks only: `psql "$DATABASE_URL" -X -c "BEGIN READ ONLY; …; ROLLBACK;"`. Never run a session `SET`.
- Before each edit to a file another track might also touch (only `lib/stories/prompts.ts` and `lib/stories/questions.ts`; see ownership), re-read the file and edit only your own named block.
- Prompt-review lens for every prompt or Jev question: state the class of behavior, not the case; **no concrete examples** (NVIDIA, Huang, Anthropic IPO, etc. must not appear in prompts); no contradictions; each rule lives in one place; "must" only for what code checks.
- Keep the repo's comment style (plain-language header comments citing the decision, e.g. `Bald-Eagle D10`).

## File ownership
| Track | Owns (may create or edit) |
|---|---|
| **T1 GTN** | `lib/stories/build/guess-the-number.ts`; the `GTN_PICK` block of `lib/stories/prompts.ts`; `lib/stories/source-page.ts` (adding the fallback reader only); new `lib/stories/gtn-sources.ts`; GTN tests |
| **T2 MD** | `lib/stories/build/morning-download.ts`; the `MD_HEADLINES` block of `lib/stories/prompts.ts`; new `lib/stories/md-development.ts`, `lib/stories/md-final-rank.ts`, `lib/intake/outlets.ts`; new Jev sets added at the end of `lib/stories/questions.ts`; `lib/stories/pool-intake.ts` / `lib/intake/pool-stories.ts` only for spin-off linkage and outlet fields; `db/bald_eagle_2026_11_12_md.sql`; MD tests |
| **T3 Photos** | `lib/photos/used.ts`, `lib/photos/used-guard.ts`, `lib/stories/sources/carousel.ts` (`recentUsedPhotoUrls`/`recentPhotoUses` only), new `lib/photos/pending.ts`; `db/bald_eagle_2026_11_12_photos.sql` (the `finder_source` → `first` setting update); photo tests |
| **T4a Lead core + Stories + Field Notes** | new `lib/social-hub/lead.ts`; `lib/social-hub/slots/book.ts`, `slots/scheduler.ts`, `lib/social-hub/fill.ts`, `lib/social-hub/adapters/common.ts`, `lib/social-hub/views/*` and `queries/day.ts` as far as lead time needs; `lib/stories/schedule.ts`, `lib/stories/worker.ts`, `lib/stories/build/common.ts` (`keysToAvoid`), `lib/stories/sources/reels.ts` (freshness windows); `lib/field-notes/**`; `scripts/social_worker.ts` (Field Notes clock only); lead tests |
| **T4b AI Drama + Explainers** (after T4a) | `lib/reel-ai-drama/**`, `lib/explainers/**`, `lib/publishing/actions/{explainers,reel-ai-drama}.ts` |
| **T4c Text on Screen** (after T4a) | `lib/reels/**`, `lib/publishing/actions/reels.ts`, `lib/content-type/run-today-live.ts` |
| Health/preflight (`lib/social-hub/health/**`, `scripts/preflight_night.ts`) | T4a, with only the date changes lead time needs |

## Shared interfaces

### Lead time (T4a defines; T4b/T4c consume)
```ts
// lib/social-hub/lead.ts
export const LEAD_DAYS: Readonly<Record<LeadKey, number>>;
// LeadKey = Vertical | `stories:${StorySeries}`
// 2: reels (Text on Screen), explainers, reel_ai_drama, field_notes, stories:guess_the_number, stories:free_vs_paid
// 0: carousels, last_few_days, stories:morning_download, ai_events (already a week ahead; untouched)
export function leadDaysFor(vertical: Vertical, series?: StorySeries | null): number;
/** The New York dates a night run fills: every date from runDay+1 through runDay+lead that still has unfilled
 *  slots for the type, plus runDay itself when lead is 0. With lead 2, the cutover night (D8) naturally fills
 *  day+1 and day+2; later nights find day+1 already filled and make only day+2. */
export function fillDates(runDay: string, lead: number): string[]; // 'YYYY-MM-DD', ascending
```
- **Target-date stamp:** every item a cushion type makes carries the New York date it is *for*, in the column it already uses for its day (`ny_date`, `nightDate`, `posts.ny_date`, …). The *run* date is kept separately where the type already records it (`requested_at`, run rows).
- **Booking:** slot choosers gain an optional `fromDate` next to `throughDate`. A cushion item books with `fromDate = throughDate = its target date`. Approving an item keeps (or books) its target-date slot. It never moves the item to today.
- **Quota:** for a target date, `quota − every booking already on that date for the type` (user and automatic), never negative.
- **Spend caps:** daily caps count against the **target date** (D8: the cutover night may spend up to one cap per date it fills). Per-request caps are unchanged.
- **Freshness windows** (how recent source ideas must be) are measured from the **run** time, never the target date.
- **Board:** an unbooked item shows on its target date, not on the date it was made.

### Photo hold (T3 defines; every finder already reads it)
- `readUsedLedger(…)` / `recentUsedPhotoUrls(…)` / `recentPhotoUses(…)` keep their signatures and return the union of:
  (a) photos published in the last `USED_PHOTO_DAYS` (20, unchanged; it meets D3's week), and
  (b) photos chosen by any item of any type that is built but not yet posted (ready / approved / scheduled / publishing), via `pendingPhotoUrls(db, now): Promise<Set<string>>` in `lib/photos/pending.ts`.
- An item's own photos must not block that same item (rebuilding or re-rendering it). Callers that rebuild pass the item's id to exclude; T3 adds an optional `excludeItem` argument.
- Brand assets and logos stay exempt (as `used.ts:27` today).
- `media_library.settings.finder_source` → `"first"` (D9), shipped as a SQL file; not applied by the builder.

### Morning Download (T2 only, recorded here for reviewers)
- Remember what we said: per published (or approved) MD story, store the intake story id, the headline we ran and when it posted (new table `stories.md_said` in `db/bald_eagle_2026_11_12_md.sql`, or columns on `stories.history`, whichever fits the code; T2 decides and records it here).
  - **T2 chose: columns on `stories.history`** (`headline text`, `intake_story_id text`; `db/bald_eagle_2026_11_12_md.sql`). `recordHistory` (repository.ts, the one place history is written, at publish) fills them for a Morning Download set from its story frame (else the set's payload headline) and the payload's new `stories[].storyId`; it checks the columns exist first and never fails the publish. Approved / scheduled / publishing sets that have not posted are read straight from the set at run time (`payload.stories` + frames; posted_at = `publish_at`, else `approved_at`), so nothing is written at approval. `readWhatWeSaid` (lib/stories/md-development.ts) reads the columns through `to_jsonb(h)`, so it runs before the SQL is applied; a row without a stored headline uses its story frame's headline (no backfill), else the story stays blocked. A candidate with an intake story id is matched by that id at any age (one read per run, bounded by the night's candidate ids; integration review S5); `SAID_DAYS` = 7 applies only to key-only matches. Same-date sets keep the hard R13 block (`sameDayKeys`).
- Development test: Jev set `MD_DEVELOPMENT` (component `md-development`) gets `{ we_said, posted_at, new_articles: untrusted_content }` and returns `new_event` (noul); bar `DEVELOPMENT_BAR` in `lib/stories/scores.ts` (first value 0.6, to calibrate). A story we ran is a candidate again only with articles first seen after `posted_at` **and** `new_event ≥ bar`.
- Spin-offs: an intake story judged the same event as a story we ran (existing `SAME_EVENT` check) goes through the same test, with that story's `we_said`.
- Outlet signal: `outletCount(storyIds, since)` in `lib/intake/outlets.ts` = distinct outlets among the direct big-outlet feeds (a named list in that file) with items in the last 24 h, spin-offs folded in. Outlet names are normalized (fix the "Gemini on CarPlay = 18 outlets" counting error first, and record the cause).
- Final rank: `md-final-rank@1` via `writeStructured` (Sonnet, `deps.settings.models.copy`), one call over the top ≤10 by score with each story's headline, outlets/outlet count, scores and a short excerpt. It returns the order. `chooseLeads` then takes 2–5 from that order (the builder cap stays). Order by "which would an informed follower be most annoyed to have missed today".
- Writer: a returning story's material carries `we_already_said`; `MD_HEADLINES` says, at class level, that such a story leads with what is new since then.

### GTN (T1 only)
- `GATE_FLOORS.want_to_guess = 0.45` (D10).
- Source fallback: for a pool candidate, read its link; on failure (or the number not on the page), try the other member links of the same intake story, publisher links before Google News wrappers, skipping pages flagged paywalled (reuse `lib/reels/net/html.ts` `PAYWALL_MARKERS` / `paywalled`). Gate on the first page that contains the answer figure (`figureNeedle`). No model calls added.
- Picker rules (in `GTN_PICK`, class level): a model idea cites a page it opened, never a news-aggregator wrapper link; no two candidates share a link. Code also enforces: duplicate or `news.google.com` links on model ideas fail with a new gate value `'bad-link'`.
- Second try: if no candidate passes, one more `GTN_PICK` call whose material adds the first round's failures (question, failed gate, short reason) and the links already tried. Gate those three the same way. The record keeps both rounds (`GtnRecord.rounds`). Skip only after round 2.

## Acceptance (each track)
- Its unit tests are written (offline, stubbed) and pass; `npm test` is green on the touched suites; `npx tsc --noEmit` passes.
- No prompt contains a concrete news example.
- The track's final report lists the files touched, the new SQL files, anything that changes this contract, and the open calibration values.
