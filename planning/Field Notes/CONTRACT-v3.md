# Field Notes contract v3 (2026-11-05): three pieces per tip slide, text-to-text arrows, packed placement
Adds to CONTRACT-v2.md (still in force; v3 wins where they differ). Decisions: PLAN.md "Feedback 2026-11-05 on the v2 sample sheet"; Tommy: "We can underline certain words in the text that need to stand out. your calls are good".
Lead already edited `lib/field-notes/types.ts` (MARK_KINDS now underline|circle|inline_underline|arrow; arrows are text-to-text, max 2 per slide) and `lib/field-notes/write/types.ts` (DraftSlide = {kind:'tip', headline, solves, how, emphasis: string[], tipId}). Do not edit those; ask the lead.

## Tip slide = three pieces
- `headline`: the tool/skill/repo's real name (<= 40 chars). `solves`: the problem it solves for the reader, plain words (<= 90 chars). `how`: how to use it, exact command/keys/clicks from the source (<= 90 chars). Whole slide about 20 words, hard cap 28 words and 200 chars (hard gate at 50% over, as before). Commands in backticks, kept whole.
- `emphasis`: up to 2 words or short phrases (<= 3 words each) that must stand out; each must appear verbatim in `solves` or `how` (code-checked; an invalid one is dropped, not a failure). The Writer chooses them as the words the reader most needs; the Editor may drop an emphasis entry but never add or reword (cut-only, code enforced; deleting text drops the emphasis that no longer matches).
- Reading order and arrows: headline -> solves -> how. Layout places each piece in its own calm region (they may be on one side of the photo or two), and draws a hand-drawn orange arrow from each piece to the next (2 arrows). Emphasis words get a hand-drawn underline; the first backticked command in `how` is circled.
- Arrow rules: text to text only, never aimed at the photo; never crossing a face, the logo clear space, or another piece; if no route is clean the arrow is dropped (slide still valid).

## Placement: pack the free space
- Replace single-block placement for tip slides with multi-region packing: find the calm regions of the photo (low edge density and low luminance variance; faces and the logo zone are no-go), then place the three pieces in the best regions, ranked by fit, each piece shaped to the region it is in (stepped line lengths that follow the edge of the subject, e.g. two columns down either side of a building), with font size per piece chosen to fill the region legibly (never below the minimum type size).
- Thresholds loosen to roughly half-way between the old and the stricter settings so that busy photos with a few calm areas place; a slide still fails with `no_calm_region` (the run's swap loop retries) only when the pieces cannot all be placed.
- No model call: pixel analysis only (no vision pass, no cost).
- Cover and Follow keep their current layouts.

## Ownership
B Writer: lib/field-notes/write/** (not types.ts), tests/field-notes-write.test.ts, tests/fixtures/field-notes/write/**, plus tests/fixtures/field-notes/run/seed.ts (its stub Writer output shape only) and any other test fixture that builds a DraftSlide.
C Render: lib/field-notes/render/**, lib/field-notes/post.ts, tests/field-notes-render.test.ts, tests/fixtures/field-notes/render/**. `draftToSlideInputs` maps the new DraftSlide to a tip `SlideInput` with three pieces and emphasis.
Rules as before: no commits, no git branch actions, no live calls, prompt-review lens (no example copy or example tool names in any prompt), prompt caching preserved. Report files changed, exact API, tests, anything unverified. C also re-renders the sample sheet into the same scratchpad folder (`fn2/out/sheet.jpg`; placeholder text clearly marked) and reports the path.
