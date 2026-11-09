# Visual design — AI News Explained per-frame shot method (news-v1)

> The method behind **Step 4**. You (the orchestrator) enrich `STORYBOARD.md` frames in place: the plan
> wrote each frame's story; you add how it **looks and moves**. You write no code here. `frame.md` is
> the visual truth: read it in full first. Every rule here is mandatory.

## The unit is a time-coded shot sequence

A frame is a handful of time windows paced to its voiceover. Nothing appears before the voice reaches
it, and each shot gives one item the viewer's attention. Write each frame as:

```
Scene 1 (0.0–Xs):  [shot 1 — subject] only what the voice says at t=0, already moving
Scene 2 (Xs–Ys):   [shot 2 — subject] the next item arrives as the voice names it
  …                one window per shot
Scene N (…–end):   the frame lands on its last word
```

Each Scene line names **its shot** (from the frame's `shots:`), **the one item** it shows (a component
from `frame.md` with its words, or an object or player from `## Case file`), **how it arrives** (slapped
and pinned, taped, laid on the page, drawn, written), **the mark** on it if any (circle, underline,
arrow, cross, highlight, and the word it lands on), **the camera move** and **its sounds** in
`frame.md`'s words. Cue every window by the word that triggers it ("on 'closed'"); times are seconds
across the nominal `duration`, and the frame worker re-times them to the real word times.

## What you add to each frame

Under the plan's bullets (leave `ground`, `scene`, `voiceover`, `claims`, `artifacts`, `shots`, `type`,
`hold` and `transition_in` as they are), append the Scene lines, then:

```
- sounds: every action's sound in frame.md's words, in order
```

- **One item per shot.** The shot's item is what the voice names during it. Earlier items may stay,
  softened or out of frame; never two new items in one window.
- **The frame treatment** for the frame's `type` (`frame.md`) decides what each act shows.
- **The key detail** (`## Case file`) is marked on its word in acts 1, 3 and 5: a circle around a
  number or one word, an underline under a phrase.
- **Art:** objects only from `## Case file`'s `objects:` (a photo cutout on board and newspaper, a
  drawing on the whiteboard); players only as `## Players` allows; artifacts word for word from
  `## Artifacts`.
- **Whiteboard frames** draw everything in marker: name what is drawn and written, stroke by stroke,
  and where the arrows run. Only the verbatim artifact or a printed logo is paper, held by a magnet.
- **No picture repeats** from one shot to the next, or from the previous frame's last shot to this
  frame's first.
- **Frame 8** is code's: write nothing for it.

## One video direction, written once

Write `## Video direction` once, under `## Question`:

- **scenes:** which frames are board, newspaper and whiteboard, and why each act sits where it does
  (all three appear in frames 1 to 7);
- **the trail of evidence:** which item from which act comes back later (the key artifact in act 5,
  the key detail in acts 1, 3, 5) so the viewer recognizes it;
- **the tension curve:** where the camera pushes in, where it holds still for the question (act 4),
  and where the cause is circled (act 5).

## Composition

- **Portrait:** stack items vertically; the item in focus sits around y 800–1300; nothing readable in
  the caption band (y 260–560) or outside x 96–984 and y 1600.
- **Size:** the item in focus fills at least half the frame's width once the camera is on it; its text
  reads at phone size (26px on screen at least).
- **Quiet grounds:** cork, newsprint and melamine carry the frame; no set dressing beyond the scene's own.

## Before you finish

`## Video direction` exists once · every frame 1 to 7 has Scene lines, each naming its shot, its one
item, its arrival, its mark and its sounds · cues by words · the key detail marked in acts 1, 3 and 5 ·
only case-file art · whiteboard frames all marker · no `sfx:` lines · you wrote no code.
