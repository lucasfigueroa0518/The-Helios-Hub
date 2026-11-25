# Iteration 11 contract: the problem solver

Status: approved by Lucas 2026-11-05; build started. Decisions and his words: `ITERATION-11-ALIGN.md`. Flow: published "Proposed process" page. Solver prompts, verbatim: `ITERATION-11-SOLVER-PROMPT-DRAFT.md`.

Reels are never held back. Length stays as it is (up to 80 s). No model or web call in tests or agent-run builds.

## 1. Settings (additive, `lib/reel-ai-drama/settings.ts`)
| Name | Default |
|---|---|
| `director_fix_model` | `claude-sonnet-5-5` |
| `director_fix_escalation_model` | `claude-opus-5-5` |
| `solver_look_model` | `claude-sonnet-5-5` |
| `solver_first_model` | `claude-sonnet-5-5` |
| `solver_second_model` | `claude-opus-5-5` |
| `solver_limit_usd` | `4` |

## 2. Moments (`lib/reel-ai-drama/render/moments.ts`, pure apart from the ffmpeg read)
```ts
type Moment = { frame: number; id: string; t: number; reel_t: number; what: string; source: 'timeline' | 'finding' | 'change' | 'edge' };
pickMoments(input: { spans: FrameSpan[]; records: Record<string, CompiledFrameRecord>; findings: string[]; changes: number[] }): Moment[]
```
- `edge`: each frame's first and last moment; reel's first instant at `OPENING_STILL_AT`.
- `timeline`: from each frame's manifest: every piece arrival and exit, mark, label, speech and camera stop, shot `SETTLE` seconds after it starts.
- `finding`: the middle of every time range a measured check names.
- `change`: where pixels change sharply in the rendered video and the timeline has no event (ffmpeg scene score). This catches what no manifest knows, including solver-written frames, which may have none.
- Moments within 0.15 s merge and keep both labels. Near-identical moments are never dropped.

## 3. Sheets (`lib/reel-ai-drama/render/sheets.ts`, sharp)
```ts
type Sheet = { frame: number; file: string; moments: Moment[] };
makeSheets(videoPath: string, moments: Moment[], dir: string): Promise<Sheet[]>
fullStill(videoPath: string, reel_t: number, file: string): Promise<string>
```
- Tile: fixed at 441x784, about 461 tokens. Layout by moment count: 1, 2 across, 2x2, 3x2. More than 6 moments starts another sheet. Tiles never shrink.
- Each tile carries a label strip: frame number, time, what happens. The strip sits outside the picture so it can't hide a fault.
- Stills come from the rendered video, so captions are what the viewer sees (see §9, risk 1).
- Used by design review, the solver and the first viewer. `stillAt` single stills go. The delivered `contact-sheet.png` stays.

## 4. Director fixes (`writing/director.ts`, `prompts/director.md` fix section, `production/run.ts`)
- Variety and image-check findings go into one `pre_build` fix. Sent: the named frames, their findings and the cached shared input. Returned: only the named frames. `validateFixedPlan` already merges them.
- Effort `medium`. `director_fix_model` first; `director_fix_escalation_model` if the re-check still finds the problem. Then flags.
- `picture_review` becomes the content pass: `nothing_missing` and `one_medium` findings, once, on `director_fix_model`. What remains goes to the solver.
- Variety stops treating a group, such as employees who signed a letter, as a person who must be shown.

## 5. Solver (`production/solver.ts`, replaces `production/creative.ts`)
```ts
type LookVerdict = { frame: number; verdict: 'strong' | 'weak' | 'wrong'; because: string; aim?: string };
type FrameChange =
  | { kind: 'plan'; blueprint: Blueprint; makes?: MakeRequest[] }
  | { kind: 'code'; module: string; events: unknown[] };
type SolverSubmit = { frame: number; diagnosis: string; approach: string; change: FrameChange };
```
- **Look:** one call on `solver_look_model` with every frame's sheets, the script, all findings, every available picture described, and the kit guide in the cached prefix. Every frame gets a verdict, and `strong` must say why. The work list is every `weak` or `wrong` frame plus any frame with a serious finding, worst first.
- **Round 1:** one call per listed frame on `solver_first_model`, up to 3 at a time. The first call runs alone so the cache is warm. It gets the frame's sheets, a full-size still, its neighbours' sheets, findings, blueprint, script lines, the pictures available and the kit guide. An unbuildable submission gets one retry in the same conversation.
- **Check:** apply, run `try.mjs` and measured checks on the frame, re-render, re-shoot, re-review changed frames only.
- **Round 2:** frames with a serious finding, on `solver_second_model`, with the previous attempt and what's still wrong.
- **May:** rewrite the blueprint, set exact geometry, write frame code, order drawings, use any harvested picture.
- **May not:** change the script, voice, facts or frame length, add a name, number or date the reel doesn't state, or search the web.
- **Spend:** `solver_limit_usd` covers look and rounds. Before each call, spend plus that call's worst case must fit, or the call doesn't run.
- It fails open: any failure leaves the frame's last good version and a flag.

## 6. Exact geometry and frame code (kit)
- `Piece.place?: { x; y; w; rotate?; z? }`, in px on the 1080x1920 frame. `solveStage` treats a placed piece as fixed and lays the others around it. Guarantees I1–I20 are not forced on a placed piece; measured checks report on it.
- Solved frames live in `assets/solved/<id>.js` with `assets/solved.json` holding `{ id: { kind, round, usd } }`. `compileReel` never overwrites a frame listed there. `try.mjs` waives `[hand_placed]` for them and nothing else.
- `compiled-read.mjs` reports a solved frame without a manifest as `manifest: null`, which `pickMoments` handles.

## 7. Which version ships
- "Serious": reviewer `problem` on `off_edge`, `readable_text`, `nothing_missing`, `clean_cutouts`; measured `off_frame`, `mark_on_nothing`, `opening_unformed`, `keep_covered`; a frame that won't build.
- Every attempt is kept. The version with the fewest serious findings ships, ties going to the latest. A swap back is always flagged.
- **Last resort:** still serious after round 2 or at the limit. `plainBlueprint` is tried. If it has fewer serious findings it ships, flagged; if not, the best version does. A frame that's only weak never takes the last resort.

## 8. Story rule and logo fix
- `prompts/producer.md`: the central figure is a named person; "a company acting through named people" goes. `development/scores.ts` central_want: the viewer follows this person's want through the story, and a person who only receives events doesn't count. It becomes a gate, not only a weight. `calibration-data.ts`: `central_figure: 'OpenAI'` is replaced by a person. Prompt-lens check applies.
- `kit/components/stage.js:512`: the one-colour filter only applies when the logo's shape stays recognisable after flattening. A logo that would collapse into a solid shape keeps its colours on a chip. Fixture: V45 from job 7e9fcc49. The builder also finds the causes of the blank white square and the garbled Microsoft logo.

## 9. Pre-mortem
| # | How it breaks | Answer |
|---|---|---|
| 1 | Browser stills have no captions, so collisions hide until the end | **Changed from the page:** re-render each round (2 min, free) and cut stills from the video |
| 2 | Reviewers misread text on small tiles | Fixed tile size; solver also gets a full-size still. Only a live run proves it. That run saves a few full-size stills so it can be judged |
| 3 | Too many moments raise cost | Merge at 0.15 s, 461 tokens a tile, spend logged per read |
| 4 | Solver code hangs or throws | Browser check has a timeout; last good version stays |
| 5 | A recompile wipes solved frames | `solved.json`; compile skips those frames, with a test |
| 6 | Hand-placed code escapes the layout rules | Measured checks still run; the waiver covers one rule only |
| 7 | Solver code puts false words on screen | On-screen text is read from the browser and compared with the script and facts; a new name, number or date is serious |
| 8 | A swapped picture misrepresents the line | Image check re-runs on frames whose pictures changed |
| 9 | Noisy findings trigger needless work or last resorts | The serious list is short and named; group false alarm fixed; weak frames can't take the last resort |
| 10 | Reviewers contradict themselves between rounds | Unchanged frames keep their findings; only changed frames are re-read |
| 11 | Frames drift apart in look | Solver sees neighbours; look and materials stay in the kit guide |
| 12 | Opus burns the limit | Worst-case check before each call; per-call token ceiling |
| 13 | Parallel calls miss the cache | First call alone, stable prefix, per `docs/prompt-caching.md` |
| 14 | Parallel frames collide on one project | Models run in parallel; applying and measuring run one at a time |
| 15 | A later render fails | Last good video kept and flagged, as today |
| 16 | A job restarts mid-solver | Attempts and `solved.json` are on disk and kept as artifacts; finished frames aren't redone |
| 17 | Sounds go missing on code frames | `events` are required on `kind: 'code'`; `eventProblems` validates them |
| 18 | The moments miss something a viewer would see | Scene-change moments cover what no timeline knows; measured checks still run every 0.2 s |

## 10. Owners (one per file)
| Owner | Files | Done when |
|---|---|---|
| A: moments and sheets | `render/moments.ts`, `render/sheets.ts`, `render/video.ts`, `checks/design.ts`, `checks/first-viewer.ts`, reviewer prompt input sections | Tile sizes, merging, labels and all four moment sources tested on a real project's files |
| B: solver | `production/solver.ts`, `writing/schemas.ts`, `prompts/solver-look.md`, `prompts/solver-frame.md`, `kit/try.mjs`, `kit/compiled-read.mjs`, `kit/stage-layout.js`, `render/compile.ts`, `production/live.ts` | Stubbed plan and code submissions build, fail safely and survive a recompile |
| C: director and story | `writing/director.ts`, `prompts/director.md`, `checks/variety.ts`, `prompts/producer.md`, `development/scores.ts`, `development/calibration-data.ts`, `kit/components/stage.js` | Fix round sends and returns named frames only; Microsoft pitch fails the gate; V45 stays recognisable |
| Me: integration | `production/run.ts`, `settings.ts`, `types.ts`, doc review | Full stubbed run, 632+ tests pass, types clean, every name cross-checked |

Retired: `Touch`, `acceptTouches`, `applyTouches`, `prompts/creative-pass.md`. `custom` pieces stay, available through a blueprint. Later clean-up with approval: `prompts/{build-workflow,frame-worker,fix}.md`.

## 11. Proof
Offline tests can't judge taste. The real test is one live reel on a new person-led story, about $8–12, only with Lucas's go-ahead. It's judged on what ships with no touch-ups.
