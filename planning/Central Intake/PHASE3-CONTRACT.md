# Central intake Phase 3: one shared photo finder — shared contract (2026-11-10)

Read with `DECISIONS.md` CI-30 and CI-31. Worktree `/Users/lucasfigueroa/HELIOS/CODE/Helios-Hub-photos`, branch
`feat/photo-finder-phase3` (off main 729ea977). **Local only: no push, no deploy, no prod migration, no prod
writes.** Every name below is fixed. An owner who needs a change asks the lead and never edits another owner's files.
`lib/photos/types.ts` is written and FROZEN.

## Rules every owner keeps
- **Switch + fallback.** Each type keeps today's finder behind `intake.settings` key `photo_finders`
  (`{ "<profile>": "shared" | "legacy" }`). A missing row or key means 'legacy'. In 'legacy' mode the type's
  behavior is byte-identical to today's.
  - In 'shared' mode a frame tries the shared finder first. A frame it leaves empty goes to today's finder,
    unchanged: nothing usable came back, the post's cap is spent, or the shared finder threw.
  - A read error on the switch means 'legacy'. The shared finder never throws to its caller.
- **Per-post hard cap** `SHARED_PHOTO_CAP_USD = 0.30` (Serper + Haiku looks).
  - Frames run serially.
  - Frame i's allowance is `(capUsd - spent) / (frames left, counting this one)`, so one frame can't spend the
    whole post's cap. Unused money rolls forward.
  - A harvest that throws keeps its whole allowance charged, the same rule as `harvestBuilderPhoto` (fix 10).
- **No story-specific photo:** take a subject photo, else today's finder (CI-30).
- **CLAUDE.md Rule 1/2.** Tests stub every model, Serper and HTTP call, with no live calls, and never loop over
  stored rows. **Never run `tests/*.integration.ts`, `npm run test:db:*`, or a prefix glob like `tests/photos-*`:**
  run explicit `tests/<name>.test.ts` files only. Integration files load `.env.local` and hit PROD.
- **Prompt caching:** add no new `messages.create`. The shared finder reuses the harvest's look (`lookAt`) as is.
- **Haiku:** the shared path uses the harvest's `settings.vision_model` (`claude-haiku-5-5`). Legacy paths keep their
  models (CI-31).
- **DB writes:** the harvest's `db` is always a sink. The harvest still offers kept photos to the shared photo bank
  (`deps.harvest.photoBank`): "bank shared to the maximum". The comparison script stubs offer/flush to no-ops.
- Tests are node:test files under `tests/` and run offline (PGlite for SQL). Report pass/fail counts only. Run
  `npx tsc --noEmit -p .` filtered to your files.

## Owner A: core (`lib/photos/**`, `tests/photos-find.test.ts`, `tests/photos-switch.test.ts`)
- `profiles.ts`:
  - `PHOTO_PROFILES: Record<PhotoProfileId, PhotoProfile>`, every profile with `licence: 'editorial_credited'` and
    `capUsd: SHARED_PHOTO_CAP_USD`.
  - lfd: 600/600, allowLogo false.
  - md: 600/1080, allowLogo false.
  - gtn: 600/1080, allowLogo false.
  - fvp: 600/1080, allowLogo true.
  - carousel: 600/1080, allowLogo true.
  - Check these against today's floors (`lib/social/photos/size.ts`, `lib/lfd/lead-image.ts`) and today's logo
    rules per type, and match them.
- `switch.ts`:
  - `readPhotoFinderModes(q: { query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> }): Promise<PhotoFinderModes>`
    follows the pattern of `readConsumerSettings` (`lib/intake/read.ts:263`). Any error, or a missing
    `intake.settings` table, means all 'legacy'.
  - `photoFinderMode(modes, id)`.
- `find.ts`: `findPhotos(needs: PhotoNeed[], profile: PhotoProfile, deps: PhotoDeps, opts: FindOptions): Promise<FoundPhotos>`.
  - Generalizes `harvestBuilderPhoto` (`lib/lfd/photos.ts:139`); that function stays for LFD's legacy mode.
  - One harvest per need, serial, under the allowance rule above.
  - Pitch from the need: a cast member for each subject (person → 'person', organization → 'company',
    product → 'product'), `scene = need.query || need.copy || need.headline`, and the story URLs as sources.
  - Settings `{ ...DEFAULT_SETTINGS, min_visuals: 1, reuse_days: 0 }`, a sink db, `mode: 'production'`.
  - Choice per need, from the usable assets: web URL, not made, not excluded, not already picked in this set by URL
    or by pHash (Hamming ≤ `NEAR_DUPLICATE`, `harvest/filters.ts`), short side ≥ the profile floor (the cover floor
    for `cover`), no logo on a cover, and a logo only when `kind` is logo/company or `allowLogo` is true.
    - 'story': the story's own moment first (the key-moment asset, then the story pages' images), then portraits
      of named people, then product or logo.
    - 'subject': portraits or the product/logo of the named subject first, then the moment.
    - None usable → null, with a trace saying why.
  - Photo mapping as `asPhoto` (`lib/lfd/photos.ts`): kind, credit, and focus from the face box.
  - Traces are prefixed `shared:` so adopters and the review page can tell the steps apart.
- `needs.ts` (pure mappers; adopters and the comparison script use only these):
  - `needFromRequest(req: PhotoRequest, id: string, extra?: { headline?: string; brief?: string; sourceName?: string | null }): PhotoNeed`
    (`lib/stories/photos.ts` PhotoRequest).
  - `needForLfd(pick: LfdPick, copy: StoryCopy, id: string): PhotoNeed` (LFD `Pick`/`StoryCopy`, `lib/lfd/types.ts`).
  - `needsForDraft(draft: FilledDraft, brief: Brief): Array<{ slot: string; need: PhotoNeed }>` (carousels:
    `cover_options[0].visual` with `cover: true`, then each slide's `visual`). Slot names follow the design stage's own.
  - `specificityFor(kind: string): Specificity` → 'subject' for person/company/logo/product, else 'story'.
- `live.ts`:
  - `livePhotoDeps(env = process.env, opts?: { bankWrites?: boolean }): Promise<PhotoDeps>` wires the deps the way
    `lib/lfd/live.ts:102-114` does: fetch, `streamingCreate(newAnthropic())`, loadPrompt, SERPER_API_KEY,
    `liveHarvestPhotoBank`, `cutouts: []`.
  - `bankWrites: false` (used by the comparison script) keeps `lookup`/`fetchStored` and makes `offer`/`flush` no-ops.
- Accept: stubbed tests cover
  - a bank hit;
  - a story moment chosen over a portrait for 'story';
  - a portrait chosen over the moment for 'subject';
  - nothing usable → null with a trace;
  - the cap and per-frame allowance respected across a set, with a throwing harvest charged;
  - no duplicate in a set by URL and by pHash;
  - the cover floor and no logo on a cover;
  - the switch reading missing, garbage, error and 'shared' values;
  - each mapper.

## Owner B: Stories + LFD adopters
Files:
- `lib/stories/photos-shared.ts` (new)
- `scripts/stories_worker.ts`
- `lib/stories/build/common.ts` (only if needed for the series)
- `lib/lfd/{run,live}.ts`
- `lib/revisions/descriptions/{stories-live,last-few-days-live}.ts`
- `tests/stories-photos-shared.test.ts`, `tests/lfd-shared-photos.test.ts`

Do not edit `lib/lfd/photos.ts`: it keeps the legacy builder slice. Ask the lead if you must.

- `createSharedPhotoFinder(o: { profile: PhotoProfile; deps: PhotoDeps; fallback: PhotoFinder; budget?: PhotoBudget }): PhotoFinder`
  - It is a `PhotoFinder` (`lib/stories/photos.ts:58`).
  - `findSet` runs `findPhotos` over every request (via `needFromRequest`), then sends only the empty frames to
    `findSetOrEach(fallback, …)`, with `exclude` extended by the shared picks. A frame that was `cover` stays `cover`.
  - `find` is the same for one request.
  - `usd = fallback.usd + shared spend`. `size = fallback.size`.
  - Traces: the shared steps first, then the fallback's.
  - A fresh budget per `findSet` call (one post) unless `budget` is passed.
- **MD / GTN / FvP:** where the worker builds the finder, wrap it per series when that series' switch is 'shared',
  with that series' profile.
  - The switch is read once per build, in the worker (or the build's entry), never per frame.
  - In legacy mode the finder object is today's, untouched.
- **LFD** (`lib/lfd/run.ts`, `live.ts`), in 'shared' mode (read once per run):
  - Every slide (major, builder, rundown) goes through the shared finder first.
  - Then the run's existing chain for empty slides: lead image → today's finder → meme rescue → replace the story.
    In shared mode the builder-only harvest slice is skipped, because the shared finder covers it.
  - The rendered-slide vision check still runs on every slide. A rejected shared photo goes to today's finder,
    as a rejected lead image does today.
  - Shared spend counts in the run's cost the way the builder harvest's does.
  - Legacy mode: unchanged.
- **Revisions:** stories-live and last-few-days-live use the shared finder first when their type's switch is
  'shared', else today's path unchanged. Same fallback order.
- Accept:
  - Stubbed tests: shared hit, shared miss → fallback with the extended exclude, cap spent → fallback, legacy mode
    never calls the shared finder, and the LFD shared run order with the vision-check reject.
  - The existing tests pass: `tests/lfd-*.test.ts` and `tests/stories-*.test.ts`. List them explicitly; never run an
    `*.integration.ts`.

## Owner C: Carousel adopter
Files: `lib/social/pipeline/{design-stage,live-stages}.ts`, `lib/revisions/descriptions/carousels-live.ts`,
`tests/social-shared-photos.test.ts`.
- In 'shared' mode (`carousel` switch, read once per run in live-stages):
  - The design stage first fills each slot from `findPhotos` (via `needsForDraft`), under one post budget.
  - Today's `photosForDraft` path fills the slots still empty, with the shared picks excluded and kept.
  - The image-swap rounds and the review stay as today. A slot the shared finder filled can still be swapped by
    today's rounds.
  - The output shape is unchanged (`social.runs.record` readers).
  - The used-photo log write is unchanged, so shared picks are recorded as used too.
- The carousels revision uses the shared finder first in 'shared' mode.
- Legacy mode is byte-identical.
- Accept: stubbed tests (shared fills a slot, misses fall to today's path, legacy never calls it), and today's
  `tests/social-*design*.test.ts` and carousel revision tests pass. List them explicitly.

## Owner D: side-by-side comparison (`scripts/photos/compare.ts`, `lib/photos/compare/**`, `tests/photos-compare.test.ts`)
- Reads recent posts from prod **read only**: every query goes through `readOnlyQuery`, which runs
  `BEGIN READ ONLY` / the query / `ROLLBACK` on one client and refuses any text that isn't a SELECT or WITH.
  There is never a session-level SET.
- Default is 2 recent posts each for lfd, md and carousel, and 1 each for gtn and fvp. It rebuilds each post's needs
  from stored data with the `needs.ts` mappers.
  - LFD: the post's picks and copy.
  - Stories: the set's stored photo requests, or its frames' copy.
  - Carousels: the run's draft and brief.
  - Find where each is stored by reading the code. Skip a post whose inputs can't be rebuilt, and say so.
- "Old" is the photo the post actually shipped with (from stored data), so it costs nothing. "New" is `findPhotos`
  with that type's profile, `livePhotoDeps(env, { bankWrites: false })`, and the post's own exclude (the 7-day used
  URLs as of that post's date, when readable).
- Without `--go` it prints the plan (posts, needs) with no calls. `--go` runs live, with a global cap
  `--cap 2.80` (default) checked before each post.
- Output in `planning/Central Intake/phase3-review/`:
  - `index.html`: per post and frame, the old and new images side by side, the frame copy, the new trace, cost.
    External images are hotlinked. It is self-contained, with no scripts from CDNs.
  - `results.json`.
- Accept: stubbed tests for `readOnlyQuery` refusing writes, the plan builder, and the HTML renderer (escaping).
  The dry mode runs against prod and prints a plan.

## Review (fresh, read-only, after builders)
- Cross-check every name here against the code.
- Legacy parity: 'legacy' mode is byte-identical for every type.
- Cap math and serial order.
- No prod writes on any shared path except today's existing writes and the photo bank offer.
- No new `messages.create`, and no `*.integration.ts` run.
- Rank findings must-fix / should-fix / nit.
