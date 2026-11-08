# Iteration 2, W2 (harvest): builder B notes for the integrator (2026-10-29)

## Identity rule (the real cause of "Brockman has no image")
Rosewood had 10 Brockman photos, all `identity:probable`, so the director staged a faceless placeholder.
New rule (`harvest/filters.ts` `identityVerdict`):
- **verified**: a QID-tied source (Wikidata P18/P180, the bank), or the look sees a face **and** the
  picture itself is captioned with the name: a Commons file description, a news or press caption
  (`newsroom`/`article`), the IPTC/XMP caption embedded in the file, or a search result whose title
  **and** URL both name the person. Flag `identity_basis:<caption|embedded_caption|title_and_url>`.
- **probable**: only a search title names them, or an article image whose "caption" is just the page
  title (flag `caption:page_title`).
- Cast people with no QID are resolved by name on Wikidata (`wbsearchentities`, exact label, namesakes
  need the role to match), so Commons P18/P180 portraits are found for them too.
- Anchors are only ever confirmed solo pictures. A main character with none gets the MD-14 line sketch
  traced from the best solo reference (usable probable photo first, else one rejected for a reason
  unrelated to identity, such as a watermark), and the sketch is their anchor.

## What the harvest now guarantees per asset
- `anchor_for`: one per cast person (banked cutout first, else best confirmed solo portrait, else sketch);
  the anchor is also `character_image: true` (MD-41).
- `face`: main face box (normalised, local MediaPipe detector via Playwright; no AI spend). Null when no
  face was found or the detector could not run (noted). Flags `faces:N`.
- `made_kind: 'sketch'` + `made: true` for sketches; `null` for everything else.
- Every saved raster: long edge ≤ 2160 px, re-encoded (photos JPEG; alpha/text kinds PNG). Text boxes
  are rescaled with the image. Flag `resized:<scale>`.
- Anchors under 1200 px short edge are upscaled (Real-ESRGAN ×2/×4), `upscaled: true`,
  flag `upscaled:anchor:2x`; on error the original is kept with `upscale_failed:<msg>`.
- `harvest.json` has `cast: [{ name, main, portraits, verified, anchor, sketch }]`, and notes carry one
  `cast: <name> (main): N look(s), M confirmed, anchor V12` line per person.

## For the integrator to wire
1. **Crops use `face`** (render/kit, W1/W3): keep the face box in the upper third; never crop it out.
2. **Full-frame low-res photos**: the harvest only upscales anchors (it can't know which photo the
   director puts full-frame). If a full-frame use needs it, call `deps.upscale` (or `realEsrgan()` from
   `harvest/live.ts`) at render time for photos with short edge < 1200.
3. **Director/plan**: treat `identity:verified` and `anchor_for` as confirmed; `probable` photos are
   usable as context shots but never as the person's anchor. Variety check (W3) can key on `anchor_for`.
4. `runHarvest` now also returns `cast` (coverage); `harvestVisuals` still returns only the inventory.
   If the run report should show coverage, read `media/harvest.json` or return `cast` from
   `production/live.ts`.
5. `harvest-look.md` gained a `portrait` field: regenerate `prompts-for-review.md`.

## Env / deps / cost
- No new packages. Uses existing `@mediapipe/tasks-vision` + `playwright` (face boxes) and `sharp`.
- `OPENAI_API_KEY` (already used elsewhere) enables sketches; without it, a note. Upscaler is found on
  PATH or at `/opt/homebrew/bin/realesrgan-ncnn-vulkan`.
- Spend (all inside the existing $1 harvest cap): Serper cap 12 → 30 queries (+≈$0.02); downloads
  150 → 220 (≈+5 look sheets, ≈+$0.05); sketches ≤ 4 at ≈$0.05–0.07 each, only when needed.
- Wikimedia 429s (5 Rosewood cast photos lost) are retried after Retry-After / 1.5 s / 5 s; a failed
  look sheet is retried once (Rosewood lost 16 tiles to one failed sheet).
