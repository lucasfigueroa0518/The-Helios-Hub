# Iteration 3 — Builder A notes (writing code and the run)

## What exists
- `writing/spine.ts` `writeSpine(deps, { pitch, facts, inventory, settings }) → { spine, problems }`: tool `submit_spine`,
  model `settings.spine_model`, system `spineSystem()`. One in-call correction; problems left after it come back
  (run.ts flags them `story`), not thrown. An unreadable spine throws (run.ts flags and the writer writes without one).
- `writing/story-editor.ts` `editStory(deps, { draft, spine, pitch, facts, inventory, round }) → { edit, spine, draft, problems }`.
  Round 0 tool `submit_story_edit` = `{ tell_back, faults, spine, rungs, hook, turn_rung_id, landing_rung_id,
  close_question, pronounce }` (all required, "repaired or unchanged"); round 1 tool (same name) = `{ tell_back, faults }`.
  User message: `## Round`, `## Script, lines only (read this first, cold)`, `## Spine`, `## Pitch`, `## Fact sheet`,
  `## Visuals inventory`, `## Full draft` (draft JSON without its spine). The repair is checked by `validateSpine` +
  `validateDraft` (with the spine); one correction, then refused (previous spine + draft kept, `problems` → flag).
  Title and engine are kept; word_count recomputed. `edit.repaired` = something actually changed.
- `validate.ts`: `validateSpine`, `wishProblems` (W ids, ≤ 12, fallback must be an inventory asset or a plan make,
  every wish used), `validatePlan` accepts wish ids in `asset_ids`; `validateDraft` takes an optional `spine` and
  rejects rung `spine_ids` the spine doesn't have; `pruneCutLines` keeps used wishes.
- Schemas: `SUBMIT_SPINE_TOOL`, `SUBMIT_STORY_EDIT_TOOL`, `SUBMIT_STORY_READ_TOOL`; rungs carry `spine_ids`
  (required in `submit_script`); `submit_plan` has `wishes`; producer pitch has `story_question`, `end_point`
  (nullable, required by the strict schema).
- Settings `spine_model`, `story_editor_model` (default Opus 5.5). Prompts/craft names + review-doc entries added.

## Run flow (run.ts)
spine → writer(spine) → story edit round 0 → round 1 **only when round 0 changed something** (otherwise round 0's
faults are the remaining ones and are flagged; saves a paid re-read) → director → wish search → applyWishes →
lines back → … Round faults steps 1–7 → `flag('story', …)`; step 8 logged only.
- Wishes are searched once, for the first plan. Any later plan (re-plan after lines back, script-revision, variety and
  image-check fix rounds) that still carries wishes gets `applyWishes(plan, new Map())` (fallbacks), logged.
- Integrity: after the image-check fix, `runMakes` runs before the re-check.
- Flag dedupe is in `jobs.ts addFlag` (SQL: skip when the job's flags already hold the same check + detail).
  `jobs.ts` also gains ArtifactKind `spine`, `story_edit`. (jobs.ts was in no builder's list; touched only for these.)

## For Builder B
- run.ts calls `deps.harvest.searchWishes?.({ wishes, pitch, facts, jobDir: <_harvest/jobId>, jobId, mode, settings })`
  and expects `{ found: { wish_id, asset }[], problems, usd }`. **It must record its own cost** with `recordCost`
  under the jobId (run.ts only settles the ledger; `usd` is logged, not recorded, to avoid double counting).
  Found assets whose id already exists in the inventory are ignored.
- live.ts: `searchWishes` is bound (fresh `liveHarvestDeps` per call, closed after).

## For Builder C
- run.ts imports `applyWishes` from `lib/reel-ai-drama/render/wishes.ts` and calls `applyWishes(plan, found)` with
  `found: Map<wishId, assetId>`; with an empty map every wish must take its fallback and `wishes` be dropped.
- The draft handed to `directReel` now carries `spine` (and rungs carry `spine_ids`). director.ts's user message is
  yours: strip `spine` from the Script section if you don't want it in the director's context.
- Fix rounds may return wishes; they are not searched (fallbacks). Worth one line in director.md's fix-round text.
