# Visual design — Helios Real Case Reel per-frame shot method (real-case-v1)

> The Real Case version of the Helios `visual-design.md`. The method behind
> **Step 4**. You (the orchestrator) enrich `STORYBOARD.md` frames in place: story wrote each
> frame's narrative; you add how it **looks and moves**. You write no code here. `frame.md` is
> the visual truth: read it in full first. Every rule here is mandatory.

## The unit is a time-coded shot sequence

A frame's visual layer is a sequence of time windows paced to the voiceover, not a bag of
effects. Nothing appears before the voice reaches it; the development is the teaching (the scene
gaining a state, a label landing on its object, the coin dropping). Write each frame as a handful
of windows cued by the spoken line:

```
Scene 1 (0.0–Xs):  only what the voice is saying at t=0 is on screen, already moving
Scene 2 (Xs–Ys):   [close — the jar] the next piece arrives as the voice names it
  …                one window per spoken cue; a new shot starts a new window
Scene N (…–end):   the frame lands on its last word
```

Each Scene line names **the shot it is in** (from the frame's `shots:`), **what is on screen**,
**what moves and on which polarity**, **where it sits**, and **what it sounds like**. Times are
seconds across the frame's nominal `duration` (the voice is tight; the `hold` is 0.15s); the frame
worker re-times every cue to the real word times in
`assets/timing/<frame id>.json`, so cue windows by the words that trigger them ("on 'sheet'"). Front-loading (the whole frame
on screen in the first quarter, then frozen) is the failure: spread reveals across the frame, and
let the picture keep pace with the voice to its last word.

## What you add to each frame

Under the story's bullets (leave `scene`, `voiceover`, `transition_in`, `type`, `engagement`,
`ground`, `anchor`, `anchor_why`, `reset` as they are), append:

```
- focal: the one orange entity of this beat (a story-world entity id, or a new object)
- eye: where the eye lands first → where it travels → what rewards it
- space: crowd | isolate | open | snap — and why, in a few words
- camera: the calm move (drift, slow push-in, pull-back, track, crane) and at most one punch, with its polarity
- sounds: the frame's sound moments in the library's plain words (frame.md § Sound): every arrival, landing, step, label, stroke of writing, page or card, and the payoff

Scene 1 (0.0–1.4s): …
Scene 2 (1.4–3.0s): …
```

- **Shots** (frame.md § Shots): follow the frame's `shots:`; a frame over 6s cuts between at
  least two, a cut every 2.5–4s, on its cue word; no picture repeats from one shot to the next, or
  from the previous frame's last shot to this frame's first. **A shot is only a camera** (EX3-90):
  every shot shows the same scene with everyone in it; when the voice names a critter doing
  something, that critter is in view doing it. The shot centres what the voice is naming
  (EX3-91).
- **Frames that use the story world** (`anchor: scene`: frames 1, 2, 4, 5 and 6) name the world's
  entities by their ids, the state they start in (the state the previous frame ended in), and the
  state they end in. They never redraw an entity differently.
- **Cast and objects:** characters are critters, named by role with their pose and mood ("the clerk
  critter, arms: reach, mood: worried"); objects can act on their own; every object is named as
  specifically as a stranger names it in its setting and described as a construction (frame.md V-4),
  and a bank asset is named ("prop: light switch, state on") only on an exact fit. Never a person, a
  figure, a hand, or a logo.
- **Labels** (the real terms, numbers, names) land as the voice names them, 5 words or fewer, pinned to
  their object; say in which window. Every number or name on a label is in the frame's facts.
- **Frame 1:** the picked hook (`## Hook`), the event's key moment with the key item in it, in motion
  from Scene 1 (first change by 0.3s), clear on its own, building (`ramp-up`); the bank's opener (code)
  breaks in over it and draws "AI BRAIN BREAK" and the title card (frame.md § 1). Describe the hook
  only. Never a slow pan over a still scene.
- **Frame 2:** the puzzle in the story world: its `reset:` lands in the first 0.3s; each piece of what
  happened arrives as the voice names it; the strange detail is isolated and held while the question is
  asked.
- **Frame 3:** the kit's dictionary card in the top half, filling in on the voice; below it, the visual
  of the definition, revealed on the definition's key words.
- **Frame 4:** Scene 1 is the reel's one **establishing shot** (`wide`) of the story world; the step
  tracker along one edge; then one window per step as the voice names it, the step playing on the
  event's own thing as its stop lights.
- **Frame 5:** the click: one window for the key item passing through the step that produced the
  outcome, one for the line from cause to outcome and the outcome landing.
- **Frame 6:** the other side at the step it touches: the fix applied, the limit shown, or the open
  question left faint.
- **Frame 7:** the takeaway on a ground different from frame 6's: the answer landing, then the rule's
  drawn object; at most one callback shot of the story world.
- **Frame 8:** the close is the kit's (`close.js`): no Scene lines to write beyond the skeleton's.

## One video direction, written once

Write a `## Video direction` block once, under `## Anchor scene` (the story world), so every frame inherits it and
the per-frame lines carry only the delta:

- **palette and grounds:** which frames are paper, night, forest; the one orange focal per beat
  (the key item keeps its orange wherever it appears; no critter is orange); green for labels;
  status colors only as signals;
- **motion grammar:** motion has a job (semantic, anticipatory, state-driven, camera); named
  polarities; anticipation before big actions; squash and overshoot with weight; on twos with the
  boil; reveals on voice cues; holds read still;
- **the tension curve:** which frames crowd, which isolate, which open; where the scene's payoff
  lands (beat 5, the click; beat 7 states it) and where the attention reset sits (the 1→2 cut);
- **negative list:** slides, lists, node grids, headlines, narration on screen, decorative motion,
  gradients and glow, a busy frame, a camera that never stops.

## Composition

- **One read at a time** (frame.md V-22): the caption while the voice speaks, one label as the
  voice names it, or the focal acting. Never two.
- **Negative space, balance, color hierarchy** (V-20): the focal sits in clear space; visual
  weight balances around it; orange leads, green follows, ink and paper stay quiet.
- **Fill the safe area with the picture, not with things** (frame.md EX3-74): the scene spans at
  least 60% of the safe-area width, the focal is at least 20% of the safe area, at most five
  readable objects, each recognizable without a label.
- **Portrait:** stack things vertically; anchor a centred focal around y ≈ 1000; keep everything
  readable inside x 96–940, y 570–1600.

## Before you finish

- `## Video direction` exists once; per-frame lines are deltas.
- Every frame has `focal`, `eye`, `space`, `camera`, `sounds`, and time-coded Scene lines paced
  to the voice, each naming its shot.
- Frame 1 is the hook (the bank's opener and its text are code's); frame 2 isolates the strange
  detail; frame 3 has the card and its visual; frame 4 opens on the one establishing shot with the
  step tracker; frame 5 shows the cause leading to the outcome; no critter is orange.
- No `sfx:` lines (retired; sound moments go in `sounds:`).
- Story-world frames use its entity ids and carry its state forward.
- Critters for every character; props by library name; new objects described as constructions.
- Labels as the voice names them; no headlines; no lists, grids, or slides.
- You wrote no code.
