# Iteration 7 — build contract (2026-11-03)

Decisions: MD-127 to MD-133 in PLAN.md. Lucas's notes: PLAN.md § Iteration 7. Scope: the director's visuals, wishes,
date labels, and a design reviewer. Nothing outside `explainers/reel-ai-drama/` and `lib/reel-ai-drama/` (plus their
tests) is edited. No live API calls; no commits; no deploys.

## Shared names (every owner uses these exactly)

- `StoryboardFrame.focus: { kind: FocusKind; what: string }` — what the eye lands on first in this frame.
  `FocusKind = 'person' | 'place' | 'object' | 'logo' | 'document' | 'number' | 'animation'`. The close frame has
  `focus: null`.
- `ShotWish.cut_out: boolean` — when true, the found picture is cut out (background removed) and joins the inventory
  as a transparent cutout of what `want` names (a person, an object, a place element), usable in `tableau`,
  `collage`, `cutout_lift` and `collision` like any cutout. `want` may name an object or a place, not only a person.
  The cutout asset's `shows` says what it is; `people` lists the person when there is one.
- `ScriptLine.on_screen_kind: 'date' | null` — the writer marks a label that is a date (`L1`'s label is always a
  date). The kit gets it as `label_kind` on each line (`assets/lines.json` and `ctx.timing.lines[]`) and styles date
  labels more prominently than other labels.
- Focus shares (code, `checks/variety.ts`): `PERSON_FOCUS_MAX = 0.65`, `OTHER_FOCUS_MAX = 0.5` of story frames
  (the close excluded). Breaking either is a variety problem and goes through the existing director variety fix.
- Medium (code, `validatePlan`): a story frame mixes media when it uses both real material (photos, pages,
  documents, posts, real cutouts, logos) and made material (drawn or code-built makes, whiteboard, seeded drawn
  settings). That is a plan problem. Code-built kit graphics that carry a fact in a real frame (a map pin, a stat's
  count, a label, a mark) are not "made material" for this rule.
- Design review: `checks/design.ts`, prompt `prompts/design-review.md`, components `design_review_fast` (Haiku,
  `vision_model`) and `design_review_judge` (Sonnet, new setting `design_judge_model: 'claude-sonnet-5-5'`).
  Haiku items: off-edge, readable text, clean cutouts and drawings, marks on target, nothing missing, no redundancy.
  Sonnet items: one medium per frame, good crops, deliberate layout, composed not lazy, a clear focal point. Its
  problems join the first viewer's picture problems in the one fix session; the rest are flags.

## Owners

1. **Director** — `prompts/director.md`, `craft/director-craft.md`, `prompts/writer.md`, `prompts/writer-revise.md`,
   `lib/reel-ai-drama/types.ts`, `writing/schemas.ts`, `writing/validate.ts`, `checks/variety.ts`, their tests.
2. **Kit + wishes** — `explainers/reel-ai-drama/kit/**` (incl. `FRAME.md`, `project-files.mjs`, components),
   `lib/reel-ai-drama/harvest/**` (wish search → cutouts), their tests.
3. **Design reviewer** — `checks/design.ts`, `prompts/design-review.md`, `prompts.ts` registration,
   `settings.ts`, `render/*` (a still per frame), `production/run.ts`, `prompts/fix.md`, their tests.

## Status (2026-11-03): built locally, not committed, not deployed
- Owners 1–3 done; tests 296/296, typecheck clean. Integration adds: a cut-out wish may only sit in
  tableau / collage / cutout_lift / collision frames (validate.ts `wishProblems`); the design review's
  one-medium item matches the director's (marker strokes around a real face are not "made").
- Open for Lucas: expression marks on real photos count as marks (allowed), not made material.
- Gallery stills: `test-runs/iter7-gallery/`.
