# Iteration 3 — build contract (2026-11-02)

Source: Lucas's notes on Rosewood v2 (PLAN.md § Iteration 3) and decisions MD-66 to MD-76. Every builder reads
PLAN.md § Iteration 3 and MD-66–MD-76, this file, `research/08-plot.md` (§2–§4), and the prompt-review lens.

## The new flow
```
pick → reporting ‖ harvest (portraits for every named person; 6+ verified photos per central person; a cutout
for every central person) → SPINE (new, Opus) → writer (lines from the spine) → STORY EDITOR round 0
(diagnose + repair) → STORY EDITOR round 1 (re-read only; faults → flags) → director (shots first, wishes with
fallbacks) → WISH SEARCH (new, targeted harvest) → applyWishes → lines back (one revise) → facts check →
workspace → voice → integrity → makes → integrity re-check of the makes → sound → build → checks → deliver
```
Everything fails open (MD-65): a step that errors leaves the previous artifact in place and adds a flag.

## Owners (one owner per file)

### Integrator (Claude, main session) — prompts and contract
- New `explainers/reel-ai-drama/prompts/spine-writer.md`, `prompts/story-editor.md`.
- New `explainers/reel-ai-drama/craft/plot-craft.md` (research 08 distilled, roles tagged; MD-74 edits).
- Edits: `prompts/writer.md`, `prompts/writer-revise.md`, `craft/writer-craft.md` (C1–C13 per MD-74/75),
  `prompts/producer.md` (pitch `story_question`, `end_point`; implication as stakes), `prompts/first-viewer.md`.
- `lib/reel-ai-drama/types.ts` (done: Phase 0 below), `render/sound-design.ts` (done: tool_choice auto).

### Builder A — writing code and the run
Files: new `lib/reel-ai-drama/writing/spine.ts`, new `writing/story-editor.ts`, `writing/schemas.ts`,
`writing/writer.ts`, `writing/validate.ts`, `writing/review-doc.ts`, `lib/reel-ai-drama/prompts.ts`,
`lib/reel-ai-drama/settings.ts`, `development/producer.ts` (pitch schema fields only),
`production/run.ts`, `production/live.ts`, `production/draft.ts`, tests (`tests/reel-ai-drama-writing.test.ts`,
`tests/reel-ai-drama-production.test.ts`, new `tests/reel-ai-drama-story.test.ts`).
- `writeSpine(input: { pitch; facts; inventory; settings }, ctx) => Promise<Spine>`: tool `submit_spine`
  (mirrors `Spine`), model `settings.spine_model` (default `'claude-opus-5-5'`), system =
  `spineSystem()` = spine-writer prompt + plot-craft + writer-craft. Validation problems (missing fields,
  5–7 sentences, joins, unknown fact ids, cast `introduced_in` ids) become one in-call correction, then flags.
- `writeScript` gains `spine` in its input; the user message carries it; the draft keeps `spine`; rungs carry
  `spine_ids`. Revisions keep the spine.
- `editStory(input: { draft; spine; pitch; facts; inventory; round: 0 | 1 }, ctx) =>
  Promise<{ edit: StoryEdit; spine: Spine; draft: WriterDraft }>`: tool `submit_story_edit` with
  `{ tell_back, faults: StoryFault[], spine, rungs, hook, close_question, pronounce }` (round 1: the tool has
  no spine/rungs fields; it only reads). Model `settings.story_editor_model` (default `'claude-opus-5-5'`),
  system = story-editor prompt + plot-craft + writer-craft. The user message gives the script lines FIRST
  (cold read), then the spine, pitch, fact sheet and inventory. Code validates the repaired draft with the
  writer's validator (HARD 1–7); a repaired draft that fails keeps the previous draft and flags.
- Pitch schema: optional `story_question`, `end_point` (strings or null). Old pitches have neither.
- run.ts flow as above. Stages `spine`, `story_edit`, `wish_search`. Artifacts kept: `spine`, `story_edit`
  (each round). Round-1 faults at steps 1–7 → `flag('story', …)`; step 8 faults are logged only.
- Wish search: `deps.harvest.searchWishes?` (B's API below) after the first director plan, then
  `applyWishes(plan, found)` (C's API), keep `director_plan`, settle cost. Missing dep = skip.
- Ordering fix: the integrity re-check after the integrity fix runs after `runMakes`, so made assets exist
  when it checks (Rosewood flagged M6–M9 "not in the inventory").
- Flag dedupe: `addFlag` (or run.ts's `flag`) skips a flag whose check + detail is already on the job.
- prompts.ts: PROMPT_NAMES gains `'spine-writer'`, `'story-editor'`; CRAFT_NAMES gains `'plot-craft'`;
  `spineSystem()`, `storyEditorSystem()`. review-doc includes the new prompts and craft.
- settings: `spine_model`, `story_editor_model` (DB-backed like the other model settings).

### Builder B — harvest
Files: `lib/reel-ai-drama/harvest/**`, `explainers/reel-ai-drama/prompts/harvest-look.md`, tests
(`tests/reel-ai-drama-harvest*.test.ts`).
- Portraits for **every named cast person** (fact sheet cast, kind person), not only main characters:
  ≥ 1 verified, target 3. **Central people (the pitch's central figure and cast with the most facts; when a
  spine exists later, its `central` list): ≥ 6 verified, distinct photos** (different years, settings,
  expressions) from Wikidata/Commons, Serper image search, official pages and the bank (MD-68).
- **A transparent cutout for every central person** from their best portrait (rembg; `lib/real-case/objects/
  cutout.ts` may be imported, never edited), so cutout treatments never fall back to a boxed photo.
- **Upscaler bug:** V21 (Altman's anchor) came out as shuffled tiles on black. Find the cause
  (Real-ESRGAN on an RGBA cutout is the suspect), fix it (e.g. upscale RGB and alpha separately, or upscale
  the source before cutting), and add a sanity check that rejects a garbled output (compare to the input
  downscaled; keep the original when they disagree).
- **Anchor fallback:** an asset the look/integrity marks corrupted or garbled is never an anchor; the next
  best portrait becomes the anchor.
- `searchWishes(input: { wishes: ShotWish[]; pitch; facts; jobDir; jobId; mode; settings }) =>
  Promise<{ found: { wish_id: string; asset: Asset }[]; problems: string[]; usd: number }>`: a targeted
  search per wish (person + want), the same filters and identity/look checks as the harvest, new assets
  numbered after the inventory's last V id and copied into the job media. Bound: ≤ 3 queries per wish,
  ≤ 12 wishes, cost recorded. Fails open per wish.

### Builder C — director and kit
Files: `explainers/reel-ai-drama/prompts/{director,frame-worker,fix,build-workflow}.md`,
`explainers/reel-ai-drama/kit/**` (incl. FRAME.md, captions), `explainers/reel-ai-drama/craft/director-craft.md`,
`lib/reel-ai-drama/checks/variety.ts`, new `lib/reel-ai-drama/render/wishes.ts`, `lib/reel-ai-drama/writing/director.ts`
(user message only), tests (`tests/reel-ai-drama-director-composition.test.ts`, `-kit`, `-screen`).
- **Shots first (MD-68):** the director plans the best shot for each moment, then uses the inventory; where
  the inventory lacks it, it adds a `ShotWish` with a fallback (an inventory asset or a make). The schema
  field is A's (in schemas.ts, per the type); C writes the prompt and `applyWishes`.
- `applyWishes(plan: DirectorPlan, found: Map<string, string>) => DirectorPlan`: replaces every wish id in
  `asset_ids`, `shows[].asset_id`, `motion`, `marks` with the found asset id, else the wish's `fallback`;
  drops `wishes` it resolved. Pure, tested.
- **One medium per frame for people (MD-69):** HARD CONSTRAINT in director.md, and a code check in
  variety.ts (`medium_mix`: a frame whose `shows` mixes photo-based treatments with drawn ones) feeding the
  existing variety fix round.
- **Every named person is shown when named (MD-75):** HARD CONSTRAINT in director.md; code check
  (`named_not_shown`: a line names a cast person and its frame's `shows` lacks them) in variety.ts.
- **Marks attach to what they mark:** the kit's mark API takes a target element (ring, underline, arrow
  drawn from the target's measured box); a mark with no target, or on an empty target, is a screen-check
  problem (`mark_on_nothing`). Rosewood 00:24 circled blank paper.
- **First caption letter** ("S" of Summer, "I" in v1) is cut off at t=0. Find and fix in the caption path.
- **Collision/cutout treatments use cutouts** (from B) for every person in them; a photo in a cutout
  treatment is a problem the director prompt forbids.
- **No marker-sketch-of-B beside photo-of-A;** variety (MD-60) comes from more real photos (B), not makes.

## Shared names (Phase 0 — in `lib/reel-ai-drama/types.ts`, nobody renames these)
`Pitch.story_question?`, `Pitch.end_point?`, `SpinePart`, `Spine`, `StoryFault`, `StoryEdit`,
`WriterDraft.spine?`, `WriterDraft.rungs[].spine_ids?`, `ShotWish`, `DirectorPlan.wishes?`,
`CHECK_IDS` + `'story'`, `JobStage` + `'spine' | 'story_edit' | 'wish_search'`.
Artifacts: `spine`, `story_edit`. Settings: `spine_model`, `story_editor_model`. Prompts: `spine-writer`,
`story-editor`; craft: `plot-craft`. Check ids: `medium_mix`, `named_not_shown` (variety), `mark_on_nothing`
(screen).

## Prompt-review lens (every prompt edit)
1. Altitude that covers every story, never Rosewood. 2. No example pollution (the only worked example is
research 08's non-AI one, marked ILLUSTRATIVE, and it stays out of prompts unless marked). 3. No
contradictions with the rest of the prompt or other prompts. 4. MECE: each rule in one prompt; point to it.
5. Musts are HARD CONSTRAINTs; the rest is craft.

## Acceptance (offline; no live Claude/HeyGen/web calls in tests)
- `npx tsx --test tests/reel-ai-drama*.test.ts` passes; no new `tsc` errors under `lib/reel-ai-drama`,
  `tests/reel-ai-drama*` (unrelated suites have 9 pre-existing errors).
- Prompts regenerated into `prompts-for-review.md`; Lucas approves before the live runs (MD-73).
- Live, step 1 (MD-77): spine-only runs for Rosewood (kept fact sheet), Best on Paper and Thirty-Two GPUs
  Against Sora (reporting + spine, no harvest). Lucas approves the spines.
- Live, step 2: full runs, $15 cap each (MD-73).

## Status
- Phase 0 done (types, sound tool_choice). Builders A, B, C started 2026-11-02.
- Builders A, B, C done (2026-11-02); integrator wired the harvest's facts promise, re-anchoring after the
  image check, fallback makes and facts in the variety check. 200/200 tests pass.
- Spine test (MD-77) run: `SPINES-REVIEW.md`, $2.33. Best on Paper strong; Rosewood's resolution crams the
  aftermath and its close question returns to the lawsuit; Thirty-Two GPUs became a 2½-year saga.
- Prompt review (fresh reviewer): 4 must-fix, 9 should-fix, 7 nits, all to apply in one pass after Lucas
  answers the spine questions:
  - must-fix: the spine order vs the end-first/in-the-middle engines (allow one cold-open line to jump
    ahead; the spine keeps story order);
  - must-fix: the "call them by role" repair contradicts writer HC8;
  - must-fix: resolution/aftermath defined in several places (define it once in plot-craft §1);
  - must-fix: Rosewood-shaped wording in plot-craft;
  - should-fix: the editor's repaired spine must keep the spine rules; the editor HC lacks the
    close-question form and the spine coverage; wished people in cutout treatments need cutouts;
    the director's wish musts become a HARD CONSTRAINT; attribution becomes one writer-craft HARD
    CONSTRAINT; "one or two central figures" vs MD-75; spine cast names must be fact-sheet cast names;
    repeats; the director doesn't see the spine;
  - nits: "few names", "face clear when a photo", plot-craft pointers, "Lucas's call", the spine `part`
    enum, "spine's end point", repeated word counts.
- Prompt pass 2 (integrator, 2026-11-02): MD-78/79/80 and the reviewer's must/should/nit fixes applied
  (plot-craft §1 is the one definition of span, resolution and aftermath; writer-craft HARD 7 credits
  sources on screen; the spine HC 1–10; the editor HC 1–6 carry the writer and spine rules; director HC 11
  covers wishes, and HC 6 accepts cut-out wishes; the producer's story test adds the opposition and the
  bounded episode; the writer now also reads plot-craft). Builder D on MD-81/82 code.
