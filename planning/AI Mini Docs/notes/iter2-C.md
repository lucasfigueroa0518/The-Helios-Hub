# Iteration 2 — builder C (W3: director, makes, kit) notes for the integrator

## Wire into run.ts (yours)
1. After `directReel` (and after any director fix), before `writeProjectFiles`:
   `const made = await makeAssets({ plan, inventory, jobDir, draft }, { record: (e) => recordCost(db, { jobId, mode, vendor: 'openai', component: 'make', usd: e.usd }) })`
   (`lib/reel-ai-drama/render/make.ts`). Then `inventory = { ...inventory, assets: [...inventory.assets, ...made.assets] }`
   and `const fb = planWithoutFailedMakes(plan, made.assets.map((a) => a.id), inventory)`; use `fb.plan`, flag
   `made.problems` + `fb.notes` (fail open). Default spend cap for makes is $0.80 (`deps.maxUsd`); ≤ 6 image
   makes per plan (validatePlan), seeds are free. Makes are written to `<jobDir>/media/M<n>.svg|png`.
2. `varietyFindings(plan, { draft, inventory })` (`lib/reel-ai-drama/checks/variety.ts`; `varietyProblems`
   is the same as strings). Suggested: if any, one `directReel(..., fix: { kind: 'variety', plan, problems: findings })`
   round (director.ts supports `kind: 'variety'`), re-run makes for new M-ids, then flag what's left. Signature
   takes an optional ctx (draft + inventory) — without it the `not_shown` check is skipped.
   Main characters = the names with an `anchor_for` asset (builder B's harvest).
3. `pruneCutLines` now keeps `makes` (only the ones still used).

## Edits I made outside my listed files (small, please keep)
- `kit/frames.mjs`: TREATMENTS += `tableau`, `collage` (try/mount accept them).
- `kit/components/index.js`: exports `setting, tableau, collage, drawn, expressionMarks` (scenes.js) and
  `SETTINGS, EXPRESSIONS, COLLAGE_LAYERS, SEED_CATALOG` (kit/settings); `TREATMENT_BUILDERS` is now built
  in index.js as `{ ...treatments.js builders, tableau, collage }` (so treatments.js stays yours; the kit
  test that every TREATMENT has a builder passes). If you'd rather register them in treatments.js, move it.
- `craft/director-craft.md`: HARD 4 (character images also in `tableau`, `collage`), Core 1 and §1 (real
  media composed, not slides), §1 treatment list (+tableau, collage), "where no photo can exist" (+makes),
  §7 (+ never words on words, never repeat what a document visibly says). Needed to avoid contradicting director.md.
- `writing/schemas.ts`, `writing/validate.ts` (makes/shows validation, `makeProblems`), `writing/director.ts`
  (anchor_for/made_kind to the director, variety fix kind), `writing/review-doc.ts` (+ sound-designer entry).

## Requests
- `nk.plate(el, { tone })` — the dom.js signature you added is what the prompts and FRAME.md use. FRAME.md says
  "The kit's own overlay treatments set theirs": please confirm lowerThird/number/labels plate themselves.
- screen.mjs: tableau/collage background layers carry `data-bleed` + `data-set`; seated figures are clamped
  inside the frame (or their phone-call panel) in render(t). Expression marks and drawn layers are `data-set`.
- Rebuild sessions: build-workflow.md now says "when the user message lists measured problems (a rebuild),
  dispatch only the frames named, each with its problems and their ids" — please pass them that way.
- fix.md no longer lists `voice_cut` as a fix-agent problem (the agent can't change timing); keep it code's.

## Open risks
- Image-model makes are unproven live (prompt quality for drawn settings / expression likeness). Seeds are
  verified visually (contact sheet in my scratchpad); one live run will tell.
- `not_shown` uses surname/full-name matching; a surname shared by two main characters would mis-credit.
- A made (non-seed) setting has no seat anchors: the frame worker passes `seats` by eye.
