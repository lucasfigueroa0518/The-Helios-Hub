# Iteration 3 — Builder B (harvest) notes, 2026-11-02

## Upscaler bug (V21, Altman's anchor as shuffled tiles on black)
- Root cause: `/opt/homebrew/bin/realesrgan-ncnn-vulkan` is our wrapper and always loads `realesrgan-x4plus`, a
  ×4-only model. `realEsrgan()` passed `-s 2` whenever the factor was ≤ 2, so the binary laid ×4 tiles on a ×2
  grid. Altman's banked cutout is 958 px, so `anchorUpscale` asked for ×2 → V21. Ilya (442 px, ×4) came out fine.
  RGBA was not the cause (×4 on the same RGBA cutout is clean). Every ≤ 2× size-floor upscale was garbled too.
- Fix (`harvest/live.ts`): always `-n realesrgan-x4plus -s 4`, then sharp resizes (lanczos) to the factor asked.
- Check (`harvest/media.ts` `checkedUpscale`): the output must be the requested size and, shrunk to a 96 px
  thumbnail, match the input (mean RGB diff over visible pixels ≤ 0.05, worst 12 px block ≤ 0.2). Measured:
  good ×4 ≈ 0.01 / 0.02–0.05; V21-style ≈ 0.12–0.22 / 0.44–0.62. A failure deletes the output and keeps the
  original (flag `upscale_garbled`). Verified live on scratch copies (Altman ×2 now 0.011).

## What the harvest now does
- Every named person (pitch + fact-sheet cast) is topped up to 3 verified looks; central people to 6, with a
  second Serper round. Top-ups add a free Commons `incategory:"Name"` search. Serper cap 30 → 72 queries;
  download cap 220 → 300 (looks ≈ $0.022/sheet; harvest cap still $1).
- Central = `centralPeople(pitch, facts, spineCentral?)` in plan.ts: central figure + cast with ≥ 3 facts
  naming them, max 3 (before facts: cast the scene/turn names). A spine list wins when passed.
- Every central person gets a rembg cutout (`deps.cutout`, live = `.venv-rembg`/REMBG_BIN via
  `lib/real-case/objects/cutout.ts`) of their best verified solo portrait, upscaled first when low-res. The
  cutout becomes the **anchor** and character image; the source photo stays a normal photo.
- Look tool gains required `garbled` (reject `garbled:look`) and `fits` (wish search keeps only fits);
  `prompts/harvest-look.md` updated. Garbled pictures are never anchors (cast.ts `anchorScore`).

## For Builder A (run.ts / live.ts)
1. **Fact-sheet cast needs the facts.** run.ts calls the harvest with `facts: null`, so fact-sheet-only people
   get no portraits. `HarvestInput.facts` now also accepts a promise: pass the reporting promise
   (`facts: reportPromise`), widen the dep type to `FactSheet | null | PromiseLike<FactSheet | null>`. Pass 1 runs
   on the pitch immediately; the cast passes wait for the facts (a rejection = no facts, noted).
2. **Anchor fallback after integrity:** `harvest/anchors.ts` —
   `reanchor(inventory, garbledAssetIds(problems))` → `{ inventory, moved }`. It flags the bad asset `garbled`,
   clears its anchor, and hands the anchor to the person's next best portrait (cutout first). Apply it to the
   inventory after `checkIntegrity`, before the fix round re-directs.
3. `searchWishes(deps, input)` in `harvest/wishes.ts` matches your binding. It records serper cost
   (`harvest_wish_search`); looks record themselves (`harvest_look`). Each found asset id is unique (one
   picture per wish), so your `added` filter can't duplicate. `problems` include one line per wish with nothing
   found ("W3: nothing found that shows …; V12 stands in") — flag or log as you prefer.

## For Builder C (director / kit)
- Cutouts in the inventory: `flags` include `cutout` (banked or made); made ones add `cutout_made` and
  `cutout_of:V<n>` (the photo it was cut from). Transparent PNG, `character_image: true`, `made: false`,
  and they are the central person's `anchor_for`. Non-central named people have photo anchors only.
- Wish-search assets carry `wish:W<n>` in `flags`.
- Not done: the spine's `central` list doesn't reach the harvest (it runs before the spine). Central people
  are guessed from the pitch + facts; a spine-central person missing a cutout falls back to a photo.
