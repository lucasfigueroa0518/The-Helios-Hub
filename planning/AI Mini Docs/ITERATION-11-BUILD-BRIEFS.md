# Iteration 11 build briefs

Lucas approved the build on 2026-11-05 and asked for it to run in a cloud session. Spec: `ITERATION-11-CONTRACT.md`. Decisions and his words: `ITERATION-11-ALIGN.md`. Solver prompts, approved and verbatim: `ITERATION-11-SOLVER-PROMPT-DRAFT.md`.

## Rules for everyone
- Commit only to `reels-iterations`. Never to main. No deploys.
- No live Claude API or `web_search` calls. Tests stub the model. The live reel needs Lucas's go-ahead.
- Don't edit `lib/explainers/**` or `explainers/world-kit/**`. `reel_ai_drama` schema stays as it is.
- Prompt caching on every `messages.create`: `docs/prompt-caching.md`, `lib/anthropic-cache.ts`.
- Reels are never held back. Reels may run up to 80 s, so there is no length work.
- Every prompt edit: classes of behaviour rather than specifics, no examples a model would copy, no contradictions, one home per rule, required things phrased as required.
- Match surrounding code. Grep first and read ranges. Filter test output to counts and failing names.
- Test set: `tests/fixtures/iter11-live/`. See its README. `.explainers-local` isn't here, and neither is the live job's database row beyond what the cloud seed holds.
- First-draft code from the stopped local builders is already in the tree, unfinished and unreviewed. Read it, keep what meets the contract, finish the rest. At the move, 646 of 647 tests passed; the failure is the story-score test in `tests/`, touched by owner C's gate.

## Owner A: moments and sheets
Files: `render/moments.ts`, `render/sheets.ts`, `render/video.ts`, `checks/design.ts`, `checks/first-viewer.ts`, `prompts/design-review.md`, `prompts/first-viewer.md`, `tests/reel-ai-drama-moments.test.ts`, and existing tests of those checks. Spec: contract §2, §3, §9.
- Near-identical moments stay on the sheet. Tiles are always 441x784 with the label strip outside the picture, up to 6 a sheet. Use `sharp` and SVG labels; assume ffmpeg has no `drawtext`.
- Keep the `contactSheet` deliverable. Leave `frameStills` and `stillAt` until integration. Scene detection uses ffmpeg's scene score from `showinfo`, with an injected runner.
- The first viewer reads moment tiles. Design review takes `sheets`. Tell reviewers what a sheet is and that tiles are small, so `readable_text` is judged at phone size relative to the tile's scale.
- Prove it: build a sample from the fixture video and look at it.

## Owner B: solver
Files: `production/solver.ts`, `writing/schemas.ts`, `prompts/solver-look.md`, `prompts/solver-frame.md`, `kit/try.mjs`, `kit/compiled-read.mjs`, `kit/stage-layout.js`, `render/compile.ts`, `production/live.ts`, `tests/reel-ai-drama-solver.test.ts`. Spec: contract §5, §6, §7, §9.
- Copy the prompts verbatim. If the code can't honour them, change the code or report it.
- `solverLook`, `solverReworkFrame`, a spend guard, `seriousFindings`, `chooseVersion`, last resort via `plainBlueprint`. Injected dependencies, in the style of `creative.ts`. Fails open.
- The look gets every available picture described, and both calls get the kit guide in the cached prefix.
- `place`: unplaced pieces must lay out exactly as today; prove it with existing tests.
- Pre-mortem items #4–#8, #12–#14, #16, #17 are yours. Run your own pre-mortem and fix what you find, without open-ended loops.
- Prove with stubbed submissions on the fixture project (frames 4, 8, 9) that a plan change, a `place` change and a code change each build and survive a recompile, and that a broken code submission falls back.
- Don't delete `creative.ts` or the touches code. Integration retires them.

## Owner C: director fixes, story rule, logo
Files: `writing/director.ts`, `prompts/director.md`, `checks/variety.ts`, `prompts/producer.md`, `development/scores.ts`, `development/calibration-data.ts`, `kit/components/stage.js`, `tests/reel-ai-drama-iter11-director.test.ts`. Spec: contract §4, §8.
- Measured on the live reel: the plan is about 8k tokens, yet fix rounds wrote 70k, 18k and 22k on Opus at high effort, $4.22 of $9.83.
- Fix kinds `pre_build` and `content_pass`. Send named frames, their findings, one line each on neighbours, and the cached shared input. Return only named frames. Effort `medium`, `director_fix_model`, with an `escalate` option for `director_fix_escalation_model`. If partial frames need a schema, build it inside `director.ts` from `SUBMIT_PLAN_TOOL`.
- Variety: a group isn't a person who must be shown.
- Story: Lucas: "A company CANNOT be the central player of a story." "Stories need to be told through people." A rejecting gate on `central_want`, following the existing gates. A test shows this shape fails: a company story whose central player, a CEO, is only "addressed by employee letter and handed the petition". Don't name real companies in prompts.
- Logo: confirm the black dot cause on the fixture's V45 and report it. A logo that would collapse when flattened keeps its colours on a chip. A simple one-colour logo must still work. Also find the causes of frame 9's blank white square (the plan wanted a black logo on kraft) and the garbled Microsoft logo on a whiteboard (frame 10 of the reel, frame 4's cross mark too); fix them if they're in your files, or report the cause and file.

## Integration: the main session
`production/run.ts`, `settings.ts`, `types.ts`, `production/live.ts` wiring after B. New order per the "Proposed process" and contract: combined pre-build fix with the ladder; compile; measure; render each round and cut sheets from the video; reviewers; split findings; director content pass; solver look; two rounds; last resort; final read; flags; deliver. The blind new-layout retry goes. Retire `Touch`, `acceptTouches`, `applyTouches`, `creative.ts`, `prompts/creative-pass.md`, and `frameStills`/`stillAt` where unused. Full stubbed run, all tests pass, types clean, every name cross-checked. Then a fresh read-only review ranked must-fix, should-fix, nit.

## Report to Lucas
What passed, what didn't, what caused the black dot, blank square and garbled logo, and a request for go-ahead on one live reel on a new person-led story at about $8–12. The live reel is simplest on his Mac.
