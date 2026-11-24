# Iteration 12: build contract

Source of decisions: `ITERATION-12-ALIGN.md` (sections 1, 5, 6, 7, 8, 10, 12, 14, 15, 16). Lucas's words there outrank this file; where they conflict, stop and report.

## Standing rules for every owner

- **No live calls.** No Claude API, `web_search`, HeyGen, Higgsfield or any paid API from tests or from you. Stub models with canned tool responses. No real end-to-end run: Lucas starts it.
- **No commits, pushes or deploys.** Leave everything uncommitted on `reels-iterations`.
- **One owner per file.** Edit only files in your list. `lib/reel-ai-drama/types.ts` and `writing/schemas.ts` are already updated for this contract; if you need another shared change, say so in your report instead of editing.
- **Never block a reel.** A check triggers one fix or a fallback, the reel ships, the problem is flagged on delivery.
- **Right first time.** Model states intent, code does geometry. Prefer designing an error out to adding a gate.
- **Prompt edits** follow the lens: state the class of behaviour; no examples unless unavoidable (never names, companies or topics from test reels: no Jobs, Hinton, Dell, Siri, Chrome in prompt text); no contradictions anywhere in the run; one owner per rule; what must hold is phrased as a HARD CONSTRAINT and is checkable. Any Claude call keeps prompt caching (`lib/anthropic-cache.ts`).
- **Tests.** Add `tests/reel-ai-drama-iter12-<part>.test.ts`, offline, fast. Run with `npx tsx --test <file>` and report counts only. Don't read big logs into context; don't re-read files needlessly.
- **Report**: at most 15 lines. What's done, acceptance result, anything unfinished, any shared change you need.

## Shared data (already in `types.ts`)

```ts
type HookId = 'flashbulb'|'wall_of_screens'|'lock_on'|'rewind'|'darkroom'|'slide_carousel'|'front_page'|'burn';
type HookBeat = { asset: string; on: BlueprintWords };          // an image, in order, landing on exact spoken words
type HookHeadline = { text: string; publisher: string; url: string };
type HookChoice = {
  id: HookId;
  beats: HookBeat[];                 // the director's images and words; code does crops, timing and sound
  charged: BlueprintWords;           // the line's most charged words: where the hook's main hit lands
  headlines?: HookHeadline[];        // front_page only: one per page where the sources have several
  fallback?: 'wall_of_screens_3'|'darkroom'; // set by code when no hook qualified
  flags?: string[];                  // set by code: what it changed or lowered, shipped as delivery flags
};
DirectorPlan.hook?: HookChoice | null;   // null or missing: frame 1 renders from its blueprint as before
Touches.hook_swap?: HookChoice | null;   // the problem solver's swap; passes through resolveHook
CastMember.widely_known?: boolean;       // decided once, at story selection
WriterDraft.hook: { line_id: string; on_screen?: string }  // on_screen is gone for new scripts; saved drafts may carry it
```

## Functions (owner C; D, A and E call them)

`lib/reel-ai-drama/hooks/eligibility.ts`, pure:

```ts
hookOptions(inventory: VisualsInventory, sources: SourceRef[]): HookOption[]
  // HookOption = { id: HookId; meaning: string; needs: string; assets: string[]; headlines?: HookHeadline[] }
  // Only hooks that pass their asset gate. Assets lists the ids usable for that hook.
resolveHook(proposed: HookChoice | null | undefined, options: HookOption[], ctx: { inventory: VisualsInventory; sources: SourceRef[]; words: string }): HookChoice | null
  // Keeps a valid choice. Drops assets outside the option. An ineligible or missing choice becomes the code's choice, with a flag.
  // Fallback chain (Lucas): no hook qualifies → wall_of_screens with 3 photos → darkroom with 1 confirmed photo → null (blueprint frame, flagged).
```

Assets are the hard rule; meaning decides among what's left.

| Hook | Fits when the line is about | Asset gate |
|---|---|---|
| flashbulb | Fame, pressure, a public moment | 3–5 sharp photos of one person |
| wall_of_screens | Scale, the world watching | 5+ usable images (3 only as first fallback) |
| lock_on | The one person no one noticed | 1–4 targets with a known position, in a photo wide enough to zoom into |
| rewind | It started long ago | 3+ photos with known, different dates |
| darkroom | Hidden, revealed, a stranger | 1 confirmed photo |
| slide_carousel | A sequence of events told step by step | 4–7 varied images |
| front_page | News, an announcement, a deal, a scandal | A real headline from `SourceRef.title`, plus 2–4 images. Never invent a headline; code verifies the text is verbatim. |
| burn | Something destroyed, replaced or taken over | 2–4 strong images with no baked-in text |

**A usable image, for every gate:** large enough at full size; identity not marked unconfirmed in `shows` (an unconfirmed identity never represents a named person); face not too close, read from `face`. Logos count only where the hook can show them well.

## Rendering (owner C)

- A hook is a frame module: `export default compiledHook(spec)` from `assets/kit/hooks/index.js`, same `{ treatment, build(root, ctx), render(t) }` shape as `compiledFrame` (`kit/components/compiled.js`). `render(t)` is deterministic and seek-based, matching the approved mockups: `$S/presets3.js` and `$S/hooks2.cjs` (slide_carousel, front_page, burn, wall_of_screens, lock_on, rewind, darkroom) and `$S/hooks.cjs` (flashbulb), where `S=/private/tmp/claude-501/-Users-lucasfigueroa-HELIOS-CODE-The-Helios-Hub/8fa24f20-ac92-4f67-9b98-c22ccc885cec/scratchpad`. Approved renders to match: `planning/AI Mini Docs/test-runs/iter12-hooks/` (`flashbulb-siri.mp4`, `wall_of_screens-browser-v2.mp4`, `lock_on-browser-v2.mp4`, `rewind-redmond-v2.mp4`, `darkroom-redmond-v2.mp4`, `slide_carousel-siri.mp4`, `front_page-browser.mp4`, `burn-redmond.mp4`).
- Those mockups have hand-tuned crops and timings. Templates must work from `HookChoice`, `ctx.media`, `ctx.timing.words` and `ctx.duration` alone, on any line length: all cues resolve from spoken words via `cueAt`, a missing word spreads evenly rather than failing. Crops come from `face`, `regions` and `width/height`. No flicker anywhere.
- The look holds until frame 1 ends (the opening line). A hook that throws falls back to the frame's plain blueprint picture and reports, as `compiledFrame` does; it records `document.__compiled[id]` so `kit/compiled-read.mjs` and the plan check still work, and those checks treat a hook frame as carried.
- Frame 1 keeps its director blueprint (used by integrity, variety and as fallback). `plan.hook` only replaces what's rendered.
- Plates, burn masks and sounds move to `explainers/reel-ai-drama/kit/hooks/` (only what's used; keep the size down; don't copy rejected plates). Check how `render/workspace.ts` copies the kit, and that per-job copying stays cheap.
- **Sound.** Each template has a score: its cues are written to `<id>.events.json` as a new event kind `file` `{ t, kind: 'file', src, level_db }`, played as is by `kit/sound.mjs`. The designer already leaves a frame's own events alone. Every visible move or step has a cue. Voice stays on top, voice starts at 0, nothing waits. All shipped sounds are peak-normalized and trimmed to onset; add a test or script that enforces this. Levels as in the final mockups: a slide change clearly audible over the voice, the press bed well under it, fire audible, no low hit on Burn.

## Parts and files

**A. Harness.** `render/voice.ts`, `render/video.ts`, `production/run.ts`, `production/live.ts`, `production/jobs.ts`, `checks/first-viewer.ts`, `checks/design.ts`, `retry.ts`, `render/runner.ts`, `scripts/reel_ai_drama_worker.ts`. Deliver section 1's list (ALIGN §1): full errors kept per step, free preflight before any spend, re-voice only missing frames, first-viewer and design-review "reading 'length'" crash fixed, outages wait rather than fail, Mac held awake during a job, environment failures never retire a story, resume past the director, gsap shipped locally. Re-evaluate the uncommitted voice lock and CDN wait: keep what's justified, remove what isn't. Also: in `run.ts`, flag `plan.hook?.flags` on delivery.
*Accepted when:* an offline test simulates each failure class in ALIGN §1 and each behaves as stated.

**B. Story and writer.** `prompts/producer.md`, `prompts/reporting.md`, `prompts/writer.md`, `prompts/writer-revise.md`, `prompts/story-editor.md`, `prompts/first-viewer.md`, `development/*`, `reporting/*`, `writing/writer.ts`, `writing/story-editor.ts`, `writing/validate.ts`, `production/draft.ts`, `checks/facts.ts`, `craft/principles.md`. Player limit (ALIGN §3): one person to follow, one opposing force, about two new names; blue-chip players and `widely_known` people are exempt, judged conservatively ("someone that the general public would know"; most adults outside tech and business news recognize the name unexplained; if in doubt, no). Selection scores it first, then the writer; story editor and first viewer check it. A company can't be the central player (memory: stories through people). Strangers get a plain handle when they appear. One short first line, no title: remove `hook.on_screen` as a requirement everywhere including every validate rule that depends on it, and "L1's label is the date". Saved drafts carrying it still load.
*Accepted when:* replay of the three reels' stored inputs with a stubbed model passes; validate has no hook-words rule left.

**C. Hook engine.** New `lib/reel-ai-drama/hooks/*`, new `explainers/reel-ai-drama/kit/hooks/*`, `render/compile.ts`, `kit/sound.mjs`, `kit/compiled-read.mjs`, `kit/try.mjs`, `render/plan-carried.ts`, `render/workspace.ts`. Also `withOnScreen` in `compile.ts` stops adding a hook text. Compile honours `plan.hook` and `Touches.hook_swap`.
*Accepted when:* each of the eight templates renders offline from slots alone on all three stored reels (`.explainers-local/reel-ai-drama/jobs/{34d7446b-c3ae-46e1-94e1-a272e4f08bc9,5ebc20ef-8a44-47c3-91e9-9bd0fd246be6,2a98cfa0-0569-4244-bb51-61d86157b78f}`) where its gate passes, with no hand-tuned crops. Write MP4s to `planning/AI Mini Docs/test-runs/iter12-build/` and check sampled frames yourself. Report any hook that looks clearly weaker than its approved mockup.

**D. Director, sound, problem solver.** `prompts/director.md`, `prompts/sound-designer.md`, `prompts/creative-pass.md`, `prompts/fix.md`, `prompts/frame-worker.md`, `prompts/build-workflow.md`, `craft/director-craft.md`, `writing/director.ts`, `render/sound-design.ts`, `production/creative.ts`. The director receives `hookOptions`, names the charged words, picks one hook by meaning, prefers starting on a person when an image of one fits, and fills `plan.hook`; `directReel` runs `resolveHook` on the result, so a bad choice can't get through. Frame 1 carries L1 only. Remove every hook-words instruction. Sound designer adds to a hook's score but never removes it. Problem solver may set `hook_swap` after looking at the rendered opening. `inventoryForDirecting` keeps unconfirmed identities from standing for a named person.
*Accepted when:* stubbed director runs show eligible, ineligible and fallback cases resolving correctly; every name in the prompts matches code.

**E. Frames and labels.** `kit/components/compiled.js`, `stage.js`, `style.js`, `treatments.js`, `kit/stage-layout.js`, `kit/project-files.mjs`, `kit/FRAME.md`, `harvest/look.ts`, `harvest/places.ts`, `prompts/harvest-look.md`, `checks/integrity.ts`. Labels (ALIGN §5, §7): only a new person's name and role when the voice says the name, a place photo's place, an old photo's date and place (and who, if not otherwise clear), each with source data or not at all; photo labels come and go with the photo. Date labels that repeat the voice go. `place` filled at harvest from what `shows` already states. Defects (ALIGN §6): logo ground chosen from the logo's brightness, no white card, text fitted to the safe area, overlaps only when deliberate. Hold: nothing flat with a slow push; a minimum hold on anything shown. Trace the two "cause not traced" items.
*Accepted when:* stubbed replays on the three reels show the §6 defects gone and the 18 audited labels behave as §5 says.

## Integration (me, after the parts)

Cross-check every name the prompts use against code, review every prompt diff, run a fresh read-only reviewer, run the reel test files and `tsc`, report to Lucas. Then one real run, started by Lucas.
