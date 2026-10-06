# M8 drafts: layout-system rules (not live)

These are parked here because the renderer is frozen until after the checkpoint (Tommy, 2026-10-06). The `.draft` extension keeps them out of the typecheck and the build.

## Files
- **`SlideTemplate-layout-system.tsx.draft`:** the slide components rewritten around three rules that apply to every layout.
- **`text-fit.ts.draft`:** the text-fit routine. It's self-contained, so the preview page and the headless render-fit check can run the same code.

## The rules (Tommy, 2026-10-06; tag: cause · renderer layout rules · 0 new stages · 0 new AI calls)
1. **Text fit.** Each text block is a region with a minimum font size. The block shrinks until its longest word fits on one line and the whole block fits. Mid-word breaks are not allowed (the "CYBERSECURIT/Y" case). If the text still doesn't fit at the minimum size, the render fails. This also fixes the Gemini split-stat overflow.
2. **Contrast.** Any text over a photo sits on a dark scrim, on every layout.
3. **Faces stay clear.** A photo of a person or company goes in its own region: a split cover, a split text slide, or the speaker's round spot. Full-bleed photos under text are scene or mood photos only.

## Still to do when M8 picks this up
- **CSS:** regions and max-heights per layout, the `[data-scrim]` styles, and the split cover and text photo regions. Mid-word breaks off for `[data-fit-min]`.
- **`SlideCopy.photoKind`** (`subject` | `scene`). `from-draft.ts` sets it: article and Commons photos are `subject`; stock and starter-set photos are `scene`. The layout rotation may make a slide full-bleed only when its photo is a `scene`.
- **`fit-check.ts`:** after the existing bounds check,
  - run `fitText` in the page and fail on any misses;
  - contrast: fail any text element over an image unless it has a `[data-scrim]` ancestor or a backdrop shade covers it;
  - faces: fail any text element that overlaps an `img[data-photo-kind="subject"]`.
- **Not in scope here:** face-safe crop and photo placement. Both are M8 framing items.
