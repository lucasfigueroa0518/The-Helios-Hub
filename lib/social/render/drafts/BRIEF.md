# Helios carousel premium drafts — contract

These files are **drafts**. They must not replace production
`lib/social/render/SlideTemplate.tsx` or `app/social/render/preview/preview.css`
until a human picks them in `/social/render/templates-review`.

## What you are making

A more premium version of **one** slide family. Same data. Same brand. Same
three layout-system rules. Stronger engagement and a designed eye path.

The viewer should be drawn to the slide, then their eye should move through
what the slide is communicating without hunting.

## Hard constraints

1. Canvas **1080×1350**. Content well still respects the 96px left/right margin
   unless the layout is already full-bleed (cover bleed, image, spread).
2. Same `SlideCopy` fields. Do not add editorial fields. Do not drop a field
   the old layout draws — every text field of the draft is drawn.
3. Layout-system rules (Tommy, 2026-10-06):
   - Text fit: every text block is a region with `data-fit-min`. Use `Fit`
     from `./blocks`. Max-height is the region height. No mid-word breaks.
   - Contrast: text over a photo sits on a scrim (`data-scrim="gradient"` or
     `"shade"`).
   - Faces stay clear: a subject photo only in its own region (`RegionPhoto`).
     Full-bleed under text is scene/mood only.
4. Reuse `./blocks` for `Fit`, `SpanRunView`, `RegionPhoto`, `BleedPhoto`,
   `Backdrop`, `PhotoCredit`, `IconBackground`, `MIN`.
5. Keep photo frame class names the helpers key on:
   `helios-cover__photo`, `helios-split__photo`, `helios-quote__speaker`.
6. Class prefix for **new** structure: `helios-v2-{family}__*`.
7. Fonts: Pragmatica Extended (headings), Roboto (body), Roboto Mono
   (attribution). Do not introduce fonts.
8. Colors: only existing canvas tokens (`--brand-*`). Orange is the hook.
   Green is pivot/metadata. No new accents, no purple, no grain, no texture.
9. Four canvases must still work: black (default), green, orange, white.
   Tokens already recolor via `[data-canvas]` on `.helios-slide`.
10. Lucide only if you add an icon. No emoji.
11. Do not edit production renderer files, tests, or writer prompts.

## Minimum font floors (do not lower)

```
headline 44 · cover 48 · body 28 · number 52 · splitNumber 40 · note 22 · quote 36 · by 18 · landing 52
```

Display sizes on a 1080px Instagram image stay large (cover ~84–104, numbers
~130–220). Do not shrink toward web-UI type.

## Shared chrome

- Non-cover / non-follow / non-full-bleed slides may keep a quiet HELIOS
  wordmark. Make it chrome, not a competitor to the headline.
- Photo credit stays one position: bottom-right pill. Use `PhotoCredit`.
- Icon background still draws when there is no photo (`IconBackground`).

## What “premium + engaging” means here

- **One dominant element.** Squint test.
- **Designed eye path:** entry → read → settle. Export `EYE_PATH` (percent
  of canvas) so the review UI can overlay it.
- **Hook is visual.** The first fixation opens a loop (a number, a face, a
  claim, a quote). The settle is the swipe, the note, or the handle.
- **Accent once.** One orange moment. Two is none.
- **Continuity.** A viewer who swipes from another Helios slide should not
  have to relearn the grid.
- **Restraint.** Premium is editorial, not decorated. If you cannot explain
  a line, disc, or glow, remove it.

## Files you own

Write only your assigned files. Do not touch another family's files.

| File | What |
| --- | --- |
| `lib/social/render/drafts/{id}.tsx` | The React layout. Export the component named in the agent prompt, plus `EYE_PATH`. |
| `lib/social/render/drafts/{id}.css` | Only your `helios-v2-*` rules. |
| `lib/social/render/drafts/{id}.rationale.md` | Short: what was wrong, the new eye path, why it is more premium. |

`EYE_PATH` shape:

```ts
export const EYE_PATH: { id: string; label: string; x: number; y: number }[] = [
  { id: '1', label: 'Entry', x: 50, y: 34 },
  { id: '2', label: 'Read', x: 18, y: 72 },
  { id: '3', label: 'Settle', x: 88, y: 12 },
];
```

`x` / `y` are percentages of the 1080×1350 canvas (0–100).

## Aesthetic direction

**Editorial luxury. Dark news magazine. Helios.** Not a SaaS landing page,
not a TikTok template, not a pitch-deck card. Type is the material. Photos
are evidence or atmosphere. The brand is already loud in the palette — the
layout should feel considered and inevitable.
