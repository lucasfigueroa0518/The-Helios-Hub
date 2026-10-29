# Targeted Revisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A text box in every post view where a user types what is wrong, and only that part of the post is redone, with every revision logged and undoable.

**Architecture:** One shared engine (`lib/revisions/`) owns the queue, the Haiku interpreter, caps, back-to-review, versioning, undo, and the log. Each of the six content types supplies a code-defined `ContentTypeDescription` (parts, fix kinds, stage tags, cost estimates, `revise`, `unschedule`). The site only inserts a `requested` row; the social worker claims and runs it (existing `finish_requests` / `rerun_requests` pattern). A single table is both the queue and the log.

**Tech Stack:** Next.js (Vercel), Postgres/Supabase, PGlite for offline tests, `tsx --test`, Anthropic SDK with `lib/anthropic-cache.ts`, local Chromium/ffmpeg renders on `helios-social-worker`.

**Spec:** `docs/superpowers/specs/2026-10-28-targeted-revisions-design.md`

## Global Constraints

- Content types in the first build: carousels, stories, reels (labeled **"text on screen"** in all UI/log/labels, never "trial reels"; keep code identifiers), explainers, last_few_days, ai_events. Vertical ids are those in `lib/social-hub/types.ts`.
- Fix kinds: photo, wording, color/backdrop, layout/crop; text on screen also motion/video.
- Interpreter is **Haiku 5.5** (`claude-haiku-5-5`), given the **whole post** as context, with **prompt caching** (static instructions + schema first, per-request post last; `lib/anthropic-cache.ts`).
- Ambiguous sentence → **ask back**, spend nothing on the redo. A reply is a new submission linked to the earlier one (`parent_id`), one log row per attempt.
- Result replaces in place with **undo**; any number of revisions per part; the **pipeline's original** and every prior rendered file stay recoverable (never overwritten or garbage-collected while a log row references them).
- Revising an approved/scheduled post sends it **back to review** (existing per-type unschedule primitive). **Undo never re-approves.** Published posts are not revisable. Any hub user may revise.
- Reworded text that fails the type's fact-check → revision **blocked**, user told why. A fix that cannot be done → **original kept**, user told what was tried.
- **Click authorizes spend.** Per-type **cap** (override in the post view for that one revision) and per-type **ceiling** (pause + notification; user may keep going with another go-ahead). Cap/ceiling values are config; a type with no approved values **refuses** revisions.
- Log row records: exact words, fix type, stage tag (fixed list per type, from Haiku), before and after (copy, photo, colors, rendered file paths), cost, outcome, who, when, content type. Nothing reads or acts on the log.
- No prompt, gate, or pipeline edits from the log. No bi-weekly review. No concurrent-revision handling.
- **Rule 1/2 (CLAUDE.md):** tests never call the live Claude API, `web_search`, image/video models; stub the model with canned responses; fixtures of 1-2 items. The feature acts on one user-selected piece, never sweeps the database.
- Read-only DB checks use `BEGIN READ ONLY; ...; ROLLBACK;`, never a session `SET` through `DATABASE_URL`.
- Worker-side changes: apply the schema first, then `./scripts/gcp/deploy-social-worker.sh` in the same session. `helios-orch-worker` is not involved.
- Git: stay on the current branch; never create, switch, merge, or delete branches or worktrees; never merge to main. Commit steps run only after Tommy has OK'd committing.

## Review Focus

1. A sentence names a part that does not exist ("frame 9" in a 5-frame set): ask back, no spend, no change. (Task 3)
2. The post is published or rejected between submit and the worker running it: refuse at run time, original untouched. (Task 4)
3. The ceiling is hit mid-run: partial spend recorded, status `paused_at_ceiling`, original untouched, notification raised. (Task 4)
4. A swapped photo duplicates another photo already in the same post: the revision is rejected by the gate, not applied. (Tasks 6-9)
5. Undo on a post that was sent back to review, or after later revisions: stays in review; undoes only the latest applied revision of that part; "restore original" is separate. (Task 4)

---

## File Structure

- Create `db/revisions_schema.sql`, `scripts/apply_revisions_schema.js` (+ `db:revisions` in `package.json`).
- Create `lib/revisions/types.ts`: shared types and fixed enums.
- Create `lib/revisions/caps.ts`: per-type cap/ceiling config and lookup.
- Create `lib/revisions/store.ts`: queue + log repository.
- Create `lib/revisions/interpret.ts`: Haiku interpreter.
- Create `lib/revisions/engine.ts`: run, undo, restore-original, ceiling, back-to-review.
- Create `lib/revisions/registry.ts`: vertical → description.
- Create `lib/revisions/descriptions/{ai-events,carousels,last-few-days,stories,text-on-screen,explainers}.ts`.
- Create `lib/revisions/worker.ts`: `claimAndRunRevisions`, called from `scripts/social_worker.ts`.
- Modify `lib/publishing/actions/types.ts`, `lib/publishing/actions/live.ts` and the six `lib/publishing/actions/<type>.ts`: add `revise` / `undoRevision` verbs.
- Create `app/api/social-hub/actions/revise/{route,handler}.ts` (+ undo/continue variants), modify `lib/social-hub/flags.ts`, `app/api/social-hub/actions/content-action.ts`.
- Create `app/components/RevisionBox.tsx`; mount it in each type's post view.
- Create `tests/revisions-*.test.ts`, `tests/fixtures/revisions/*`.

---

### Task 1: Schema, apply script, and store

**Files:**
- Create: `db/revisions_schema.sql`, `scripts/apply_revisions_schema.js`, `lib/revisions/store.ts`, `lib/revisions/types.ts`
- Modify: `package.json` (add `"db:revisions": "node scripts/apply_revisions_schema.js"`)
- Test: `tests/revisions-store.test.ts`

**Interfaces:**
- Produces (`types.ts`): `Vertical` (re-export), `FixKind = 'photo'|'wording'|'color'|'layout'|'motion'`, `PartRef = { kind: string; key: string }`, `RevisionStatus = 'requested'|'asking'|'running'|'applied'|'blocked'|'failed'|'paused_at_ceiling'|'undone'`, `Interpretation`, `PartState` (jsonb: copy, photo, colors, layout, `files: string[]`), `RevisionRow`.
- Produces (`store.ts`): `createRequest(q, { vertical, refs, itemId, by, instruction, parentId? }): Promise<RevisionRow>`; `claimNextRequested(q): Promise<RevisionRow | null>`; `markAsking(q, id, question)`; `markRunning(q, id, interpretation, capUsd, ceilingUsd)`; `markApplied(q, id, { before, after, costUsd })`; `markEnded(q, id, status: 'blocked'|'failed'|'paused_at_ceiling', note, costUsd)`; `markUndone(q, id, by)`; `listForItem(q, itemId): Promise<RevisionRow[]>`; `latestApplied(q, itemId, part: PartRef): Promise<RevisionRow | null>`; `originalOf(q, itemId, part): Promise<PartState | null>` (the `before` of the earliest applied row for that part); `setOverride(q, id, overrideUsd)`.
- `Query` is `@/lib/social/store/pg`.

- [ ] **Step 1: Write failing tests** in `tests/revisions-store.test.ts` on PGlite loading the real `db/social_hub_schema.sql` then `db/revisions_schema.sql`: `createRequest inserts status requested`; `claimNextRequested takes the oldest and flips to running exactly once (second claim returns null)`; `latestApplied returns the newest applied row for a part and ignores undone`; `originalOf returns the before of the first applied revision even after later ones`; `parentId links an ask-back reply`.
- [ ] **Step 2: Run** `npx tsx --test tests/revisions-store.test.ts`. Expected: FAIL (module/schema missing).
- [ ] **Step 3: Write `db/revisions_schema.sql`**: schema `revisions`, table `requests` (id uuid pk, `vertical` text check in the six, `item_id` uuid references `social_hub.content_items`, `refs` jsonb, `requested_by`, `instruction` text, `parent_id` uuid null, `status`, `question` text, `interpretation` jsonb, `stage_tag` text, `fix_kind` text, `part` jsonb, `cap_usd`/`ceiling_usd`/`override_usd` numeric, `spend_usd` numeric default 0, `before`/`after` jsonb, `note` text, timestamps incl. `undone_at`/`undone_by`), index on `(item_id, created_at)`, partial index on `status='requested'`. Idempotent (`create ... if not exists`), matching the style of `db/stories_schema.sql`.
- [ ] **Step 4: Write `scripts/apply_revisions_schema.js`** copying `scripts/apply_stories_schema.js`; implement `store.ts` with the signatures above (claim uses `FOR UPDATE SKIP LOCKED`).
- [ ] **Step 5: Run the test.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(revisions): schema and store`.

### Task 2: Description interface, caps config, registry

**Files:**
- Create: `lib/revisions/caps.ts`, `lib/revisions/registry.ts`
- Modify: `lib/revisions/types.ts`
- Test: `tests/revisions-caps.test.ts`

**Interfaces:**
- Produces (`types.ts`): `StageTag` as a per-type const list exported from each description (`STAGE_TAGS: readonly string[]`); `CostMeter = { spend(usd: number): void; readonly spent: number }` which throws `CeilingReached` past the ceiling; `PostSnapshot = { vertical; refs; status: 'preview'|'review'|'approved'|'scheduled'|'published'|'rejected'; parts: ReadonlyArray<{ ref: PartRef; text?: string; photoUrl?: string; photoCredit?: string; color?: string; layout?: string }> }`; `RevisionResult = { ok: true; before: PartState; after: PartState } | { ok: false; reason: 'blocked'|'failed'; note: string }`; and
  `interface ContentTypeDescription { vertical: Vertical; label: string; stageTags: readonly string[]; fixKinds: readonly FixKind[]; load(q: Query, refs: ActionTarget): Promise<PostSnapshot | null>; estimate(fix: FixKind): number; revise(ctx: { q: Query; refs: ActionTarget; interpretation: Interpretation; meter: CostMeter }): Promise<RevisionResult>; restore(ctx: { q: Query; refs: ActionTarget; part: PartRef; state: PartState }): Promise<void>; unschedule(q: Query, refs: ActionTarget): Promise<{ ok: boolean; note: string }>; }`
- Produces (`caps.ts`): `capFor(vertical, fix): { capUsd: number; ceilingUsd: number } | null` (null = no approved values, revisions refused); `CAPS` config object with every vertical set to `null`; `setCapsForTest(overrides)`.
- Produces (`registry.ts`): `descriptionFor(v: Vertical): ContentTypeDescription | null`.

- [ ] **Step 1: Failing tests:** `capFor returns null for every type until values are approved`; `a CostMeter throws CeilingReached once spent exceeds the ceiling and records the partial spend`; `descriptionFor returns null for a type with no description yet`.
- [ ] **Step 2: Run** `npx tsx --test tests/revisions-caps.test.ts`; expected FAIL.
- [ ] **Step 3: Implement** the interfaces and `caps.ts` (all `null`; do not invent numbers).
- [ ] **Step 4: Run; expected PASS.**
- [ ] **Step 5: Commit** `feat(revisions): description interface, caps config`.

### Task 3: Haiku interpreter

**Files:**
- Create: `lib/revisions/interpret.ts`
- Test: `tests/revisions-interpret.test.ts`

**Interfaces:**
- Consumes: `PostSnapshot`, `descriptionFor`, `ephemeralCache`/`cachedSystemText` from `lib/anthropic-cache.ts`, an injected `complete(req): Promise<{ text: string; usage }>` so tests stub the model.
- Produces: `interpret(deps: { complete: Complete }, input: { snapshot: PostSnapshot; sentence: string; prior?: { sentence: string; question: string } }): Promise<{ status: 'ok'; interpretation: Interpretation; costUsd: number } | { status: 'ask'; question: string; costUsd: number }>`.

- [ ] **Step 1: Failing tests** (canned `complete` responses only): `returns ok with part frame 3, fix photo, stageTag from the type's list`; `a sentence naming a part not in the snapshot returns ask`; `malformed JSON from the model returns ask, not a throw`; `a stageTag outside the type's STAGE_TAGS returns ask`; `the request marks cache_control on the static system block and not on the post block` (assert on the captured request); `a prior question and reply are included as context`.
- [ ] **Step 2: Run; expected FAIL.**
- [ ] **Step 3: Implement.** System block (instructions, schema, the type's fix kinds and stage tags) cached 1h; the whole-post snapshot and sentence go last. Validate the model JSON against the snapshot and the type's lists; any mismatch → `ask`. Cost from usage at Haiku 5.5 rates (reuse the pricing helper `lib/stories` uses; find it via `recordCost`).
- [ ] **Step 4: Run; expected PASS.**
- [ ] **Step 5: Commit** `feat(revisions): Haiku interpreter`.

### Task 4: Engine (run, ceiling, back-to-review, undo, restore original)

**Files:**
- Create: `lib/revisions/engine.ts`
- Test: `tests/revisions-engine.test.ts` (uses a fake `ContentTypeDescription` and PGlite)

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: `runRevision(deps: { q: Query; interpret: typeof interpret; notify: (msg: string) => Promise<void>; now: () => Date }, row: RevisionRow): Promise<void>` (row already claimed, status `running`);
  `undoRevision(deps, itemId: string, part: PartRef, by: string): Promise<{ ok: boolean; note: string }>` (reverts the latest applied revision of that part);
  `restoreOriginal(deps, itemId, part, by)`;
  `continueAfterCeiling(deps, id: string, by: string)`.
- Order inside `runRevision`: reload snapshot → refuse if status `published`/`rejected` → look up `capFor` (null → status `failed`, note "no approved cap for <label>") → compare `estimate` to cap (over → pause with the estimate for override) → `revise` with a meter capped at the ceiling → on success `unschedule` if approved/scheduled → `markApplied`. `CeilingReached` → `markEnded('paused_at_ceiling')` + `notify`.

- [ ] **Step 1: Failing tests:** `refuses a post that became published after queueing and leaves it untouched` (Focus 2); `no approved cap refuses with a plain note`; `estimate above cap pauses; setOverride then run proceeds`; `ceiling hit mid-run records partial spend, status paused_at_ceiling, calls notify, after state not written` (Focus 3); `success on an approved post calls unschedule once and logs applied with before and after`; `blocked result writes status blocked and the note, original unchanged`; `undo restores the previous state, marks the row undone, and does not re-approve` (Focus 5); `undo twice walks back one revision each`; `restoreOriginal restores originalOf even after three revisions`; `rendered file paths referenced by a log row are never deleted by a later revise` (assert the fake's file set).
- [ ] **Step 2: Run; expected FAIL.**
- [ ] **Step 3: Implement** `engine.ts` to the order above.
- [ ] **Step 4: Run; expected PASS.**
- [ ] **Step 5: Commit** `feat(revisions): engine`.

### Task 5: Verbs, route, worker hook

**Files:**
- Modify: `lib/publishing/actions/types.ts` (add `'revise' | 'undoRevision' | 'continueRevision'` to `ActionVerb`; add `instruction?: string; revisionId?: string; part?: PartRef; overrideUsd?: number` to `ActionInput`), `lib/social-hub/flags.ts` (a `revise` action flag, default off like its siblings; verify how `ACTION_FLAGS` is declared), `app/api/social-hub/actions/content-action.ts` (parse `instruction` ≤ 1000 chars, `overrideUsd` > 0)
- Create: `app/api/social-hub/actions/revise/{route,handler}.ts` (+ `undo-revision`, `continue-revision`), `lib/revisions/actions.ts` (`reviseVerbs(deps): Pick<ContentActions, 'revise'|'undoRevision'|'continueRevision'>`), `lib/revisions/worker.ts`
- Modify: the six `lib/publishing/actions/<type>.ts` and `live.ts` to spread `reviseVerbs`; `scripts/social_worker.ts` to call `claimAndRunRevisions` each tick.
- Test: `tests/revisions-actions.test.ts` (mirrors `tests/social-hub-actions.test.ts`)

**Interfaces:**
- Produces: `revise(target, by, input)` → inserts a `requested` row (`createRequest`) and returns `{ ok: true, note: 'Revising…' }`; rejects empty instruction (400). `claimAndRunRevisions(deps): Promise<number>` runs the interpreter first: `ask` → `markAsking` (no spend beyond the Haiku call); `ok` → `runRevision`.

- [ ] **Step 1: Failing tests:** `route is unreachable while the flag is off`; `revise inserts one requested row with the user's words and returns immediately`; `empty or over-length instruction is a 400`; `a published post is refused at submit with a clear note`; `claimAndRunRevisions asks back on an ambiguous sentence without calling revise` (stub description asserts not called); `a reply with parentId links to the earlier row`; `undoRevision and continueRevision call the engine with the user's email`.
- [ ] **Step 2: Run; expected FAIL.**
- [ ] **Step 3: Implement.** Route/handler copy the shape of `app/api/social-hub/actions/hard-regenerate`. Worker follows `lib/reels/pipeline/claim.ts` for claim/loop conventions.
- [ ] **Step 4: Run** `npx tsx --test tests/revisions-actions.test.ts tests/social-hub-actions.test.ts`; expected PASS (existing action tests still green).
- [ ] **Step 5: Commit** `feat(revisions): revise verbs, route, worker claim`.

### Task 6: AI Events description (cheapest; proves the engine)

**Files:**
- Create: `lib/revisions/descriptions/ai-events.ts`; register in `registry.ts`
- Test: `tests/revisions-ai-events.test.ts` (PGlite fixture from `tests/fixtures/ai-events/seed.ts`)

**Interfaces:**
- Consumes: `updatePostRender` (`lib/ai-events/store.ts:166`), `storeSlideJpegs`, `unschedulePost` in `lib/ai-events/schedule.ts`.
- Produces: `aiEventsDescription: ContentTypeDescription`; parts `{ kind: 'slide', key: '<index>' }`; fixKinds `photo|wording|layout`; `STAGE_TAGS` derived from the stages in the spec findings (e.g. `pick`, `copy`, `layout`, `render`); `estimate()` returns 0 (no model).

- [ ] **Step 1: Failing tests:** `wording fix patches render.slides[i].aiEvents title and re-renders only that slide's JPEG`; `other slides' storage paths are unchanged`; `title over COPY_MAX.title (80) is blocked`; `a photo swap that duplicates another slide's image is rejected`; `render_version is bumped and the previous JPEG path stays in the log's before state`; `a rejected post is refused`.
- [ ] **Step 2: Run; expected FAIL.**
- [ ] **Step 3: Implement** by patching one slide, then `storeSlideJpegs` for that index with a versioned storage key (never overwrite), `updatePostRender`. Do not use the both-cities rebuild.
- [ ] **Step 4: Run; expected PASS.**
- [ ] **Step 5: Commit** `feat(revisions): AI Events`.

### Task 7: Carousels description

**Files:**
- Create: `lib/revisions/descriptions/carousels.ts`; register
- Test: `tests/revisions-carousels.test.ts`

**Interfaces:**
- Consumes: `render.slides[i]` in `social.posts`, `storeSlideJpegs` (`lib/social/overnight/slides.ts`), photo chain `photosForDraft` (`lib/social/photos/design.ts`), fit check (`lib/social/render/fit-check.ts`), fact-checker (`lib/social/factcheck`), `unschedulePost` (`lib/social/overnight/schedule.ts:343`), `social.used_photos`.
- Produces: `carouselsDescription`; parts `{ kind: 'slide', key }`; fix kinds `photo|wording|color|layout`; `estimate`: render-only 0, wording = one fact-check call, photo = one photo-chain call.

- [ ] **Step 1: Failing tests (stubbed model/finder):** `color fix changes canvas on one slide, zero model calls`; `wording fix runs the fact-check once and a failure returns blocked with the checker's reason`; `photo fix excludes every URL already in the post and the 7-day used_photos set`; `a photo swap with no candidates returns failed and keeps the original`; `fit-check failure returns failed and keeps the original`; `before state holds the previous slide JSON and storage path`.
- [ ] **Step 2: Run; expected FAIL.**
- [ ] **Step 3: Implement** per the interface; new JPEG key per revision (`posts/<slug>/slide-NN.rev<id>.jpg`).
- [ ] **Step 4: Run; expected PASS.**
- [ ] **Step 5: Commit** `feat(revisions): Carousels`.

### Task 8: Last Few Days description

**Files:**
- Create: `lib/revisions/descriptions/last-few-days.ts`; register
- Test: `tests/revisions-last-few-days.test.ts`

**Interfaces:**
- Consumes: `lfd.posts.stories[i]`, `buildPost`, `storeSlideJpegs`, `findPhotos` (`lib/lfd/photos.ts`), Haiku vision (`lib/lfd/vision.ts`), grounding check, `unschedulePost` (`lib/lfd/schedule.ts`).
- Produces: `lastFewDaysDescription`; parts `{ kind: 'story', key }` (the cover is `key: 'cover'`); fix kinds `photo|wording|layout`.

- [ ] **Step 1: Failing tests:** `wording fix re-runs grounding; a miss returns blocked`; `photo fix runs findPhotos and the vision check, excluding the post's other photos`; `layout fix needs no model`; `fit_problems after rebuild returns failed, original kept`; `a post with publishing off still revises (publishing_live affects approval only)`.
- [ ] **Step 2-5:** run (FAIL), implement, run (PASS), commit `feat(revisions): Last Few Days`.

### Task 9: Stories description (the Dario case)

**Files:**
- Create: `lib/revisions/descriptions/stories.ts`; register
- Modify: `lib/stories/repository.ts` (add `saveFrameRevision` beside `saveFrameRender` at l.243 if the existing writer cannot take a versioned storage path)
- Test: `tests/revisions-stories.test.ts` (uses `openLocalStoriesDb`)

**Interfaces:**
- Consumes: `stories.frames` (`copy`, `photo`, `backdrop`, `template`, `storage_path`), `createLivePhotoFinder().find` (`lib/stories/photos.ts:228`), the renderer's `render(frames)` for one frame, `saveFrameRender`, `unscheduleItem` for the set.
- Produces: `storiesDescription`; parts `{ kind: 'frame', key: '<seq>' }`; fix kinds `photo|wording|color|layout`. Photo `exclude` = every other frame's `photo.src` in the set plus the 7-day held set. Wording runs a Sonnet rewrite then Jev `md-grounding` for the series; the render-stage no-word-change rule applies only to the render review, not to this path. Keep `frames.copy.photo` and `frames.photo` in sync.

- [ ] **Step 1: Failing tests:** `frame 3 repeating frame 1's photo is replaced with a photo not used by any other frame in the set` (Dario case; stub finder returns a repeated URL first, then a fresh one); `only frame 3's row and JPEG change`; `opener photo counts as used`; `wording fix blocked when grounding is under 0.6`; `color fix cycles backdrop among black|white|orange|green without a model call`; `an approved set goes back to review`; `finder returning only used photos returns failed, original kept`.
- [ ] **Step 2-5:** run (FAIL), implement, run (PASS), commit `feat(revisions): Stories`.

### Task 10: Text on screen description (includes new wording-only path)

**Files:**
- Create: `lib/revisions/descriptions/text-on-screen.ts`, `lib/revisions/text-on-screen-plate.ts`; register
- Test: `tests/revisions-text-on-screen.test.ts` (PGlite from `db/reels_schema.sql`; ffmpeg calls injected)

**Interfaces:**
- Consumes: `reels.idea_copy` (+ `idea_copy_history`), `visual_jobs`, `video_jobs`, `renderTextPlate` + `overlayPlate` (`lib/reels/visual/overlay.ts`), `finish_requests.start_stage` frame/video paths, color route.
- Produces: `textOnScreenDescription`; parts `{ kind: 'stage', key: 'copy'|'frame'|'video' }`; fix kinds `wording|photo`(background image)`|motion|color`. `relayPlate(deps, { storedClipPath, newCopy }): Promise<{ videoPath: string }>` for wording-only: re-lay text over the stored clip with ffmpeg only, no image or video model. Reels in `reel_locks` are refused with a clear note; `requestFinish` and the today-only limit are not used.

- [ ] **Step 1: Failing tests:** `wording fix calls relayPlate and zero image or video model calls`; `wording fix appends to idea_copy_history`; `new copy that fails checkCopy or copy-fit returns blocked`; `background image fix runs frame then video stages once`; `motion fix reruns only video from the stored frame`; `color fix changes the grade and re-renders`; `a locked reel is refused`; `a reel from a past slate is revisable`; `UI label and stage tags say "text on screen"` (assert `label`).
- [ ] **Step 2-5:** run (FAIL), implement, run (PASS), commit `feat(revisions): Text on screen`.

### Task 11: Explainers description and job-folder retention

**Files:**
- Create: `lib/revisions/descriptions/explainers.ts`; register
- Modify: `lib/explainers/render/job.ts` (activate the existing `resume` + `resumeNote` path for a named scene), the worker's job-folder cleanup (find where `/opt/helios-social/explainers/jobs/<id>` is removed; add the retention rule)
- Test: `tests/revisions-explainers.test.ts`

**Interfaces:**
- Produces: `explainersDescription`; parts `{ kind: 'scene', key }` and `{ kind: 'caption', key: 'caption' }`; fix kinds `wording|layout|color|photo` for scenes, `wording` for caption; scene redo estimate = the type's per-reel spend cap fraction. `retainJobFolder(job, now): boolean` is true until the explainer is published or 7 days after creation, whichever is earlier (spec: "earlier of the two").
- If the folder is gone: refuse with "This explainer's working files were cleaned up, so single scenes can't be redone." Existing explainers with no folder are not revisable.

- [ ] **Step 1: Failing tests:** `retainJobFolder is true at day 6 unpublished and false at day 8`; `retainJobFolder is false once published even at day 2`; `scene redo with a missing folder is refused with the plain note`; `scene redo deletes only that frame's module and calls resume with a resumeNote naming it (injected session runner)`; `caption-only fix needs no agent session`; `scene redo respects the meter and pauses at the ceiling`.
- [ ] **Step 2-5:** run (FAIL), implement, run (PASS), commit `feat(revisions): Explainers and job-folder retention`.

### Task 12: Revision box in the post view

**Files:**
- Create: `app/components/RevisionBox.tsx`
- Modify: each type's post view (locate where the hub opens a post; Tommy offered a screenshot of this view: ask for it or read the real components before writing)
- Test: `tests/revisions-box.test.ts` (pure view-model function `revisionBoxState(rows): BoxState`)

**Interfaces:**
- Produces: `<RevisionBox vertical refs />` showing: the text area and submit; a "revising…" state that polls the item's rows until applied; an ask-back question with a reply field (reply posts with `parentId`); a blocked/failed note; a paused-at-estimate or at-ceiling state with an **Allow up to $X** override button (`overrideUsd`) and the notification line; **Undo** (latest) and **Restore original** per part; hidden/disabled for published posts. Labels say "text on screen" for reels.

- [ ] **Step 1: Failing tests** on `revisionBoxState`: `requested shows revising`; `asking shows the question and a reply input`; `paused_at_ceiling shows the override button and amount`; `published disables the box`; `applied shows undo; after undo shows restore original`.
- [ ] **Step 2-3:** run (FAIL), implement the view-model and component.
- [ ] **Step 4: Verify in the browser** with `preview_start`: submit against a seeded local post with the interpreter stubbed; confirm every state renders and no console errors.
- [ ] **Step 5: Commit** `feat(revisions): revision box`.

### Task 13: Cap proposals, deploy, live check handoff

**Files:**
- Modify: `lib/revisions/caps.ts` (fill values only after Tommy approves)
- Create: `docs/revisions-runbook.md` (how to read the log; how to set caps)

- [ ] **Step 1: Build the cap proposal** from each description's `estimate()` and the real redo costs in `stories.cost_events` / `reels` / `explainers` ledgers (read-only `BEGIN READ ONLY` queries). Present per type: cap, ceiling. **Wait for Tommy's approval; do not invent numbers.**
- [ ] **Step 2: Fill `CAPS`** with the approved values; add a test `capFor returns the approved numbers for every type`.
- [ ] **Step 3: Run the full suite** `npm test`; expected PASS, with no live API calls.
- [ ] **Step 4: Apply schema and deploy:** `npm run db:revisions`, then `./scripts/gcp/deploy-social-worker.sh` (needs Tommy's go-ahead for the deploy). Enable the `revise` flag only after the deploy.
- [ ] **Step 5: Hand off to Tommy** for the live check: he clicks submit on a Morning Download frame with a repeated photo. The agent runs no live revision. Report objective telemetry only (rows, status, cost).
- [ ] **Step 6: Commit** `feat(revisions): caps, runbook`.

---

## Self-Review

- **Spec coverage:** box (T12), interpreter/whole post/cache/ask-back (T3, T5), six types (T6-11), logging fields (T1, T4), undo/original (T4), back-to-review/never re-approve (T4), published locked (T4, T5), fact-check block / failed keeps original (T4, T7-11), cap/override/ceiling/notify (T2, T4, T12, T13), explainer retention (T11), text on screen label and wording-only path (T10), worker execution and redeploy (T5, T13), stage tags (T2-3, T6-11), any hub user (T5: no role check).
- **Types:** `ContentTypeDescription`, `RevisionResult`, `CostMeter`, `PartRef`, store function names match across Tasks 1-12.
- **Open:** cap numbers (T13, Tommy), screenshot of the post view (T12), ceiling reading (pause-and-notify; spec flags it for Tommy to confirm).
