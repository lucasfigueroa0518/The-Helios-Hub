# Field Notes: design spec (DRAFT, 2026-11-04)

Status: draft for Tommy. Nothing here is built. Items marked **[TASTE]** need Tommy's call, ideally from a mock sheet on 1-2 real photos. Brand source: the helios-design-system skill (README + `colors_and_type.css`).

## 1. Canvas and slides
- 1080 x 1350 (4:5), JPEG, 4-6 slides: 3-5 content slides + 1 Follow slide.
- Every slide is a real iPhone photo with text on it. No bare text slides.
- Slide roles (layered range, decided): **1 Hook** (the tip in one plain line, anyone gets it) · **Steps** (1-2 slides, numbered, doable by the lowest level) · **Why / Catch** (one slide, for higher levels) · **Follow** (CTA, `@heliosgroup.ai`).

## 2. Type (brand-fixed, no handwriting font)
- Headline: Pragmatica Extended Bold, tight tracking (-0.02em), Title Case.
- Body and annotations: Roboto Light (300). Never 400+ except tiny UI-like labels.
- Eyebrow: uppercase, 0.18em tracking, 12-14px at design scale (scaled for 1080 canvas), e.g. `FIELD NOTES`.
- No emoji, no exclamation marks, no clip-art. Lucide icons only.

## 3. Contrast-aware text (required on every text block)
Tommy: "white fill on dark photos, black fill on really bright photos; if it's in between, then lower the exposure on the photo and put the white text."
Proposed rule, measured **per text block on the region of photo behind it**, not the whole photo:
1. Layout picks the calmest region away from faces and the logo zone, then places the block.
2. Measure that region's luminance. Compute WCAG contrast of white `#FFFFFF` and of off-black `#171717` against it.
3. If white clears 4.5:1 (3:1 for large type) with margin -> white. Else if `#171717` clears it -> off-black. Else (mid-tones) -> darken the photo's exposure until white clears, then white.
4. If darkening would need more than a cap [TASTE: cap size], move the block to a calmer region instead.
5. "Black" is `#171717`, never pure `#000`. A gradient scrim is a last resort only (brand allows image overlays when text must read).
6. Accent colors (orange `#FF5E1A`, green `#138510`) on photos go through the same check; if they fail, the element falls back to white or off-black.
Thresholds are calibrated on real photos, not guessed. Checks live in code (`fit-check`), not in a prompt.

## 4. Annotation vocabulary (whiteboard feel from structure, no hand-drawn art)
Allowed: underline under the key phrase, bracket around a short group, boxed callout, numbered step markers, Lucide arrows pointing to the subject. Orange for the one emphasized phrase or arrow per slide ("key data point"); green for the structural eyebrow label. [TASTE: weight/length of lines, box corners (brand: 16px cards, pill buttons), how many marks per slide.]
Not allowed: hand-drawn strokes, textures, grain, marker fonts.

**Decided (Tommy, 2026-11-04, from mock-sheet-1):** the default style is **underline + arrow** (mock style 1): an orange underline under the key phrase and a Lucide arrow pointing at the subject. Max **2 marks per slide**. Boxed callouts and bracket marks are not used unless Tommy asks for them later; numbered step markers stay for Steps slides because the content is a sequence. Note: I had suggested a box for the Why/Catch slide; Tommy picked style 1 without that exception, so it is not in.

## 5. Placement rules
- Text never over a detected face (existing `fit-check` rule stays); annotations go around people, with a clear margin around a head (mock showed a box nearly touching one).
- Text blocks go on calm regions only: measure edge density as well as luminance, and avoid screens, foliage, fences and crowds (mock-sheet-1: body text on a monitor, headline on trees, steps across a building logo all failed).
- Third-party logos prominent in a photo (e.g. a company building sign) make it ineligible for the pool; the Helios logo is the only logo. Upload box gets a manual reject for photos with readable private screens or recognizable strangers. [Tommy to confirm]
- Logo (mark or wordmark) fully on-canvas, nothing over it, clear space >= the "H" height on every side. Applies to the Follow slide.
- Safe margins for Instagram crop and UI [TASTE: margin size].
- Layered detail stays short; if a slide's text will not fit in the type scale, split or shorten, never shrink below the minimum size.
- The layout rule "full-bleed photos under text are scene/mood only" needs a Field Notes carve-out.

## 6. Photo treatment
- Real photos only; crop/zoom allowed; exposure lowering only as in section 3. No filters, no AI generation.
- Location metadata stripped from published images.

## 7. Follow slide
Real photo, "Follow Helios" in headline type, `@heliosgroup.ai`, full logo with clear space. [TASTE: photo choice rule: calmest / most "us working" photo in the post.]

## 8. Open
- Mock sheet of 2-3 annotation styles on 1-2 real photos (needs sample photos from Tommy or Lucas).
- Margin sizes and darkening cap.
