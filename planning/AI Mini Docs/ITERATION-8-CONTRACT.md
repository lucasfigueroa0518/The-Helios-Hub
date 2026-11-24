# Iteration 8: shared contract

Every name more than one owner touches. Decisions: `PLAN.md` MD-134 to MD-143. Lucas's notes and the diagnosis:
`ITERATION-8.md`. `lib/reel-ai-drama/types.ts` already carries the plan fields below; don't edit it again without saying so.

## Owners (one owner per file; ask nothing of another owner's files, report it instead)

| Owner | Files |
|---|---|
| **Plan** | `craft/principles.md`, `craft/director-craft.md`, `craft/story-timing.md`, `prompts/director.md`, `prompts/writer.md`, `prompts/writer-revise.md`, `prompts/integrity.md`, `prompts/reporting.md`, `prompts/producer.md`; `lib/reel-ai-drama/writing/schemas.ts`, `writing/validate.ts`, `writing/review-doc.ts`, `checks/variety.ts`, `checks/integrity.ts`; the kit's STORYBOARD writer `kit/project-files.mjs` |
| **Moves** | `kit/components/moves.js` (new), `components/index.js`, `components/scenes.js`, `components/stat.js`, `kit/close.js`, `kit/close-timing.js`, `kit/frames.mjs`, `kit/assemble.mjs`, `kit/FRAME.md`, `kit/gallery.*`, `prompts/frame-worker.md`, `prompts/build-workflow.md` |
| **Checks** | `kit/components/marks.js`, `components/treatments.js`, `components/style.js`, `components/anchor.js`, `components/lift.js`, `kit/measure.mjs`, `kit/bounds.mjs`, `kit/screen.mjs`, `kit/pace.mjs`; `lib/reel-ai-drama/render/video.ts`, `checks/design.ts`, `prompts/design-review.md`, `prompts/first-viewer.md`, `prompts/fix.md` |
| **Sound + harvest** | `prompts/sound-designer.md`, `kit/music.mjs`, `kit/sound.mjs`, `lib/reel-ai-drama/render/sound-design.ts`, `tools/ambience-import.mjs`, the ambience catalog; `lib/reel-ai-drama/harvest/wishes.ts`, `harvest/plan.ts`, `harvest/look.ts`, `harvest/screens.ts`, `harvest/sources/logos.ts`, `prompts/harvest-look.md`, `lib/reel-ai-drama/render/wishes.ts` |

Paths starting `kit/`, `prompts/`, `craft/`, `tools/` are under `explainers/reel-ai-drama/`. Tests: each owner adds
`tests/reel-ai-drama-iter8-<owner>.test.ts`. Off limits: `lib/explainers/**`, `explainers/world-kit/**` (read and copy from
it, never edit), other content types.

## Plan fields (MD-135, MD-136, MD-138, MD-139)

- `StoryboardFrame.shots: FrameShot[]`, `FrameShot = { at, shows, asset_ids, introduces }`. `at` is the exact spoken words
  the beat lands on, copied from the frame's narration, in order. `introduces` names a player on first mention, or null.
- `ShotWish.query` (2–5 word Google Images query naming the thing), `ShotWish.as` (`photo|logo|product|object|place`),
  `ShotWish.count` (1–10). Required in the director's schema; optional in TS for old plans.
- `CastMember.kind` gains `product`.

Code checks on a plan (Plan owner, in `validate.ts`/`variety.ts`, fed to the director's existing fix loop):
- `SHOT_MAX_WORDS = 12`: no more than this many spoken words between one beat and the next or the frame's end.
- Every `at` is found in the frame's narration, in order. Every spoken number has a beat landing on it.
- Every company or product in the cast, and every person, has a beat with `introduces` on the line that first names them,
  with a non-empty `asset_ids` (or a make or wish).
- At most `FACE_RING_MAX = 2` circle marks on a face per reel. `thought` expression marks: at most 1 per reel.

## Kit moves (Moves owner; on `nk`, in `components/moves.js`)

All follow the frame contract: `build` once, `render(t)` deterministic, return `{ el, render, events }`. `events` is an array
of sound events `{ t, kind, ... }` in the kit's existing event shape, for the frame's events file.

- `nk.flashReveal(doc, { media, at, duration, credit })`: white flash, then the page; shutter foley on `at`.
- `nk.phoneShot(doc, { media, at, duration, credit })`: a page on a clean phone, held in frame, gently scrolling.
- `nk.clickReveal(doc, { media, headline, source, at, clickAt, duration })`: a cursor travels, clicks, a breaking-news
  notification drops in, then the article. Click and notification sounds.
- `nk.burst(doc, { media: [...], at, duration, opacity })`: pictures flip past fast at low opacity, behind a number or title.
- `nk.speech(doc, { on, text, side, at, duration })`: short paraphrase text beside a person, tied to their figure. No quote
  marks, so it can't read as a verbatim quote.
- `nk.cuts(doc, shots)`: shows `shots` `[{ at, el, render }]` in order, each from its own time, so one frame carries several
  beats. Workers use this for a frame's shot map.
- `nk.drawnLogo(doc, { media, at, duration })`: a real logo's shape drawn in marker ink, whiteboard only (MD-138 allows this
  and only this exception to "never recolor a logo").
- Sound on motion: a kit graphic that moves carries its own sound through `events`. `whoosh` is allowed in events when a
  graphic visibly moves (Sound owner makes `kit/sound.mjs` accept it).

## Close (MD-143; Moves owner)

Port the look of `explainers/world-kit/close.js`: white screen, Helios logo scales in at centre, wordmark writes itself in the
print handwriting beneath it. Wordmark "Reel AI Drama". The question stays spoken and captioned over it, and captions must be
readable on white. A clean transition from the last story frame (no hard cut), with its sound.

## Build-time findings (Checks owner; ids used in `breakage`, `prompts/fix.md`)

Measured free in the browser every 0.2s, before render. Prefer a kit default that makes the error impossible, then a check.

- `opening_unformed`: at frame 1's first instant the main picture isn't fully on screen and composed.
- `mark_drift`: a mark's stroke leaves its target while the target moves. Fix the cause too: a mark tracks its target.
- `mark_offscreen`, `mark_unseen`: any part of a mark outside the frame; ink without contrast against what's behind it. Ink
  picks its colour from what's behind it. A thought mark sits over the person.
- `label_on_face`: a label covers a face or the focus. `nk.label`/`nk.lineLabel` choose a free spot by themselves.
- `edge_gap`: the ground doesn't reach past the frame at some time (the white left border).
- `subject_low`: the main picture's centre isn't between y 620 and 1180 of 1920, or it runs below y 1500. Burnt captions are y
  260–560; platform captions sit low.

Design review also receives a still at t≈0.1s of frame 1. It stays a trigger for the fix step (MD-140).

## Harvest (MD-135, MD-139, MD-141; Sound + harvest owner)

- `wishWants`: `query` is the first Serper search and is searched as written; `as` picks the want kind and route (`logo` to the
  logo source first). `count` keeps that many different pictures; `render/wishes.ts` expands the wish id in a frame's
  `asset_ids` to all of them. Failing open stays.
- Generic things (no person, no year) carry no event-date filter.
- `plan.ts`: a `product` cast member gets a logo want and a product-photo want.
- `look`: a capture showing an error state, a broken player, a broken image or an ad over the content is rejected before the
  director sees it. `screens.ts` crops a page to its headline block where it can.

## Sound (MD-142; Sound + harvest owner)

- `drone` is no longer a lead style: remove it from what the designer can pick. The bed opens on real music.
- `BED_VOLUME = 0.31` (Lucas's pick by ear, 2026-11-03), and the prompt's gain range moves up with it. Keep loudness limits sane.
- Tracks differ (MD-144). Code measures each candidate and levels it on the part actually used, prefers tracks that sit well
  behind speech and can be heard on a phone speaker, and enforces the song rotation: history spans the last 4 reels; a reel using 1 or 2 songs repeats none; a reel using 3 or more
  may repeat at most one, its strongest.
- Code check: no stretch over 8s without audible music before the close, apart from a deliberate `silence`/`drop`. Silence is
  rare and has a stated reason.
- Rewrite the prompt's "supports and never pushes", the cold-open drone text and "Fewer, better cues" to match. Revisit HARD 3's
  10 seconds. Ambience beds match places the script names. Import fire and other specific beds with `tools/ambience-import.mjs`.
- The score carries across the close transition and resolves on the close.

## For every prompt edit

Altitude (state the class of behaviour), no example pollution (no examples from Lucas's notes in a prompt: no fireplace, no
Amazon, no dollar signs), no contradictions across prompts, single ownership, required means checkable. Automated tests never
call the live Claude API or `web_search`. No commits, no deploys, no live runs.
