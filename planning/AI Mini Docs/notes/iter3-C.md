# Iteration 3 — Builder C notes (director and kit)

## What exists
- `lib/reel-ai-drama/render/wishes.ts` `applyWishes(plan, found: Map<wishId, assetId>) → DirectorPlan` (pure).
  Each wish id becomes the found asset, else its `fallback`, in `asset_ids` (de-duplicated), `shows[].asset_id`,
  `motion`, `marks` and the makes' `from_assets` (a make never traces itself). Resolved wishes leave the plan
  (`wishes` deleted when all resolve). A wish with no find and no fallback is removed from the frames and stays
  listed. A make that was only a wish's fallback and is unused after resolution is dropped (never paid for).
  An empty map = every wish takes its fallback. A plan with no wishes is returned as is.
- `checks/variety.ts`: ids are now `same_way | named_not_shown | medium_mix | staging_repeat`
  (`not_shown` is gone: `named_not_shown` covers every named person, MD-75). Context gains `facts?` (cast
  persons are the names checked; without it, everyone the inventory pictures, plus the main characters) and
  `makes?` (read from `plan.makes` first). Single names match only capitalised ("page" is not Cy Page).
  `medium_mix`: a frame's `shows` mixes drawn people (a drawn make, a made drawing, the whiteboard) with photo
  ones, or a drawn person sits in a frame with a found photo (person/event/place photo, archival, video frame).
- `writing/director.ts`: user message is Script (without `spine`) → Fact sheet → Visuals inventory (shots first).
  `scriptForDirecting(draft)` exported.
- Kit marks (`kit/components/marks.js`): every mark stroke carries `data-ink` + `data-ink-for`, its target
  `data-ink-target`. A mark without a target throws `[mark_on_nothing] …`. `nk.markTarget(doc, holder, box)`
  makes a target for a detail inside a picture. Page/document/post marks target an invisible rect over the
  measured box; headline underlines target their span; a collage `scribble-ring` takes `around: <layer index>`
  (a ring without it is untargeted). Expression marks carry `data-expression` (not marks).
- `kit/screen.mjs`: `[mark_on_nothing]` for a mark with no target, a target blank for ≥ 0.4s (no words, no drawn
  strokes, picture luminance spread < 0.035 under it), or an orange stroke a frame drew by hand. A build that
  throws the kit's mark error reports `mark_on_nothing`, not `empty_frame`. Ran it on Rosewood's delivered
  project: frames 04, 06, 10 flag their hand-drawn strokes; 01, 02, 07, 09 clean.
- Caption skin (`presets/reel-ai-drama/caption-skin.html`): root cause and fix below.

## The first caption letter (root cause)
Per letter the skin set `opacity: 0` at the page start and `opacity: 1` at the letter's time. For the first
letter of the first page both sets land at t = 0 on the same element. GSAP resolves two zero-duration sets at
the timeline's very start to the hide once the playhead has been past 0 and back (reproduced in headless Chrome
with the real skin and the delivered GROUPS: after priming to the end, `progress()` seeks leave "S" at opacity 0
for the whole page; "u…" types normally). Fix: one set per letter per time: the hide only when the letter shows
after its page appears. Verified the same way: "S" visible at 0, 0.04, 0.5, 1s. Offline test in the kit suite.
**The Explainer skin `explainers/frame-presets/helios/caption-skin.html` has the identical pattern (lines
237–238) and almost certainly the same bug; outside my files, not touched.**

## For Builder A
- `validate.ts makeProblems` says "make … is used by no frame" for a make that is only a wish's fallback, and
  `pruneCutLines` drops it. director.md HC5 now says "Every make is used by a frame or is a wish's fallback";
  please count wish fallbacks as use in both (else the director must put a fallback make in some frame).
- `run.ts`: pass `facts` to both `varietyFindings` calls so `named_not_shown` checks the fact sheet's cast persons
  (it falls back to inventory people without it). Any filter on `'not_shown'` is now `'named_not_shown'`.
- Not checked in code (prompt HC6 only): a person in a `cutout_lift`/`collision`/`tableau` frame shown by a
  non-character image. A `validatePlan` problem would be cheap if you want it.

## Prompts changed (regenerate prompts-for-review.md)
`prompts/director.md` (shots first, Wishes section, `wishes` output, marks name a target, fix rounds' wishes take
fallbacks, HC5 wishes, HC6 cutouts, HC8 every named person, HC10 one medium), `craft/director-craft.md` (shots
first, vary with real photos, one medium, named shown, marks on something visible), `prompts/frame-worker.md` HC4
and `prompts/fix.md` HC3 (marks point to FRAME.md § Marks), `kit/FRAME.md` (§ Marks, collage `around`, drawn
layers one medium, `mark_on_nothing` row).
