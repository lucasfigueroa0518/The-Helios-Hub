# Iteration 9 — composition that is right the first time

Lucas's brief (2026-11-04): composition errors (size, position, scale, movement, depth) should never happen. Don't
leave it to the review gates: they aren't repairing the errors and they're expensive. The cheap system is the one
that needs no fixing. Also take any other safe win that follows the same logic.

## Why it fails today

1. **A model writes pixel numbers for pictures it can't see.** 17 of the 23 non-close frames in the Musk and Siri
   reels were placed by hand (`seats`, `inset`, `bottom`, `x`, `y`, `h`). Nearly every composition note falls in them.
2. **Code has no idea what must stay visible.** Keep-outs cover faces, the caption band, page words and other labels.
   A logo, a prop or another person's body counts for nothing. `collision` always paints the right figure over the
   left; `tableau` paints by baseline. Nothing decides depth from what would be hidden.
3. **Labels have no owner.** They move as one left-aligned block in the order they land, so Larry Page's name goes to
   Musk's side. Their timing follows a cue word, not the arrival of what they name.
4. **Marks and ink guess.** Expression marks hang off a face box at a fixed spot (`argue` is at jaw height) and get
   pushed in from the frame edge. `inkFor` picks ink from the ground's type, never from the pixels behind it.
5. **The style rule isn't enforced.** `character_image` can be an uncut search photo (V55, Larry Page). Logos arrive
   with their white square (V97).
6. **The gates can't repair this class of error.** The measured checks saw about 4 of Lucas's 24 notes. Design review
   described several more ("Musk is mostly hidden behind Page's photo", still in the final video). Repair is another
   blind agent guessing new numbers: $2.23–$2.70 a reel for that. A fix moved Page's label off Musk's face, to the
   wrong side.

## The principle

**The model says what the shot is. Code decides where everything goes.** Who and what is in the shot, who matters
most, what each label belongs to, when each thing arrives: those are story decisions. Position, size and depth are
arithmetic on measured pictures, and code gets them right every time, for free.

## The contract

### 1. Measured pictures (free, local, once per asset)
Every asset gets, from its real pixels (`sharp`), stored on its inventory record:
- `regions.visible`: the tight box of its opaque pixels, 0–1 of the image.
- `regions.shape`: a coarse alpha grid (about 32×32), so overlap is computed on the silhouette, not a rectangle.
- `regions.tone`: a coarse luminance grid (about 16×16), for measured ink on a picture.

Logos have a plain background keyed to transparent at this step. A logo that can't be keyed is printed on a deliberate
paper chip, never a bare white box.

### 2. `kit/stage-layout.js`: the solver (pure, no DOM, unit-tested in Node)
`solveStage(moment) → { pieces: [{ id, x, y, scale, z }], labels: [{ id, x, y }], report }`

For every moment (each time a piece arrives or leaves) it finds the arrangement that makes the pieces as large as the
rules allow. These hold by construction, not by check:

| # | Invariant |
|---|---|
| I1 | Every piece has a **keep** region: a person's head and upper shoulders, a logo's or thing's whole visible box, a card's face or words. No other piece and no text covers more than 5% of any keep. Bodies may overlap bodies for depth. |
| I2 | **Depth is derived:** any piece whose body would cover another's keep goes behind it. No entry-order or left-right painting. |
| I3 | Every head is whole inside the frame, clear of the caption band, faces on the subject line. Every piece sits inside the frame, or deliberately bleeds off the bottom. |
| I4 | **A label has an owner.** It sits next to its owner, on the owner's side, and covers no keep. It lands no earlier than its owner has arrived. Frame-level labels (a date, a place) use the free band. Labels with different owners are never stacked. |
| I5 | The arrangement holds through time: when a piece arrives, the others **slide over to make room** (what Lucas liked in the Siri opener). The final layout is known before anything moves, so nothing gets covered mid-shot. |
| I6 | If the pieces can't fit: shrink evenly, then allow more body overlap, then report `stage_tight`. It always returns a layout and never blocks a reel. |

Variety comes from the words the frame gives (`arrangement: 'face_off' | 'lead_inset' | 'row' | 'pile' | …`, `style:
'cutouts' | 'paper'`, `side`) and from seeded tilt and offset. The solver places within that choice, so reels don't
all look alike. `paper` keeps the collage feel Lucas likes: tilted, taped, overlapping, without covering a keep.

### 3. `nk.stage`: what a frame writes
```js
// ILLUSTRATIVE
stage = nk.stage(doc, {
  ground, style, arrangement,
  pieces: [
    { id: 'a', media: m.V1, role: 'lead', at: tA, side: 'left', label: '<name>' },
    { id: 'b', media: m.V2, at: tB, label: '<name>' },
    { id: 'c', media: m.V3, belongs: 'b', at: tC },
  ],
  labels: [{ text: '<place>', sub: '<year>', at: tD }],
  marks: [{ kind: 'argue', on: 'a', at: tE }],
  duration: ctx.duration, credit,
});
```
No pixel numbers exist in this vocabulary. It replaces `collision`, real-setting `tableau`, `collage`, and placed
whiteboard items. The treatment names stay, so the schema and the director's vocabulary don't churn; seeded settings
keep their named seats. A frame for those treatments that hand-places pieces fails `try.mjs`, before any render.

### 4. Marks and ink (`anchor.js`, `settings/index.js`)
- Expression marks sit by convention **around the top of the head**, sized to the head, drawn on its silhouette. The
  solver looks for a free spot around the head; in a close-up with no room, the shot pulls back instead of squeezing.
- Ink and text colour always come from the measured pixels behind them (`regions.tone`, existing `pickInk`), including
  `nk.drawn`. The `ink` override is removed. A drawing can't be dark on a dark scene.
- Any readable text whose measured contrast is low gets a plate automatically.

### 5. Outside the stage
`nk.label`, `lineLabel`, `number` and `lowerThird` on any treatment also treat logos and things as keeps, take
`for: <piece or picture>` for ownership, and stop forming a single block across owners.

### 6. The checks stay as a safety net, and now see these errors
`screen.mjs` adds, measured on the silhouette every 0.2s: `keep_covered`, `label_off_owner`, `label_before_owner`,
`mark_off_head`, `mixed_style`. `try.mjs` adds `hand_placed`. They must fire on the old Musk and Siri frames: that's
the proof they see what Lucas sees.

## Safe wins (same logic: fix the cause, then nothing needs fixing)
- **Captions and labels keep proper capitalisation** (`caption-skin.html:57`, the lowercase rules in `style.js`).
  Re-check the caption width clamp.
- **Board pins on the top edge of cards**, slightly varied, with cords hanging between them.
- **Every person on a stage is a real cutout:** cut automatically (local rembg, free) rather than trusting
  `character_image`. An uncut person on a stage shows as a framed photo, never a bare rectangle beside cutouts.
- **Repeated picture caught on the storyboard** by the validator, before any build money is spent.
- **Stop paying to re-fix what a round didn't change:** a frame whose flags are identical after a fix round gets no
  further rounds. It ships, flagged.
- **False alarms cost real money.** Find and fix those that don't describe a visible problem (for example `mark_on_nothing`
  "dark on nothing (abs)" on whiteboards).
- **Workers read only their treatment's section** of `FRAME.md` (generated per treatment from the one source).

## Prompt changes (Claude reviews every edit with the lens: altitude, no examples, no contradictions)
- `director-craft.md` HARD 4: steer away from using one picture for several beats, re-cuts especially; a held visual
  is the worst case, and then be creative about it.
- `director.md`, `frame-worker.md`, `build-workflow.md`, `fix.md`, `FRAME.md`: director names who, what, order and
  ownership, never positions.
- `sound-designer.md`: when a scene ends on its tension, ramp into the last word and change the music on the cut into
  the next scene (resolving "not on the cut before it").

## Proof, with no API spend
1. **Property test:** thousands of seeded random casts through `solveStage`; I1–I6 hold on all.
2. **Regression tests from Lucas's notes:** each composition note is a test using the real measurements of those
   pictures.
3. **Replay:** rewrite the failing Musk and Siri frames in `nk.stage` by hand, render stills from the existing jobs'
   assets, and show before and after.
4. **The new checks fire on the old frames** and are silent on the replayed ones.
5. One live run (about $11) only with Lucas's go-ahead.
