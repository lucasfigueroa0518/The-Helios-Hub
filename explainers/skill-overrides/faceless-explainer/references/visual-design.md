# Visual design — Helios Explainer Reel per-frame shot method (Explainers 4.1)

> Helios replacement for the vendored `visual-design.md` (DECISIONS.md EX3-05). The method behind
> **Step 4**. You (the orchestrator) enrich `STORYBOARD.md` frames in place: the story wrote each
> frame's narrative, shots, casts, angles and techniques; you add how it **looks and moves**. You
> write no code here. Read `principles.md` first and `frame.md` in full; they are the visual truth.
> Every rule here is mandatory.

## The unit is a time-coded shot sequence

A frame's visual layer is a sequence of time windows paced to the voiceover, not a bag of effects.
Nothing appears before the voice reaches it; the development is the teaching (the scene gaining a
state, a label landing on its entity, a thing travelling to where it is needed). Write each frame as
a handful of windows cued by the spoken line:

```
Scene 1 (0.0–Xs):  [wide — <subject>] only what the voice is saying at t=0 is on screen, already moving
Scene 2 (Xs–Ys):   [medium — <subject>] the next piece arrives as the voice names it
  …                one window per spoken cue; a new shot starts a new window
Scene N (…–end):   the frame lands on its last word
```

Each Scene line names **the shot it is in** (from the frame's `shots:`), **what is on screen**,
**what each critter does and toward what** (its intent: reaching for, holding, looking at,
pointing toward, recoiling from), **what moves and on which polarity**, **what the light does**
when it changes, and **what it sounds like**. Times are seconds across the frame's nominal
`duration`; the frame worker re-times every cue to the real word times, so cue windows by the
words that trigger them ("on '<word>'"). Front-loading (the whole frame on screen in the first
quarter, then frozen) is the failure: spread reveals across the frame and let the picture keep
pace with the voice to its last word.

**Every action and trip the voice describes has its window** (EX4-151): the action happens in it,
in order, and its result is visible. A trip is a cut to the destination (world.js `SETS`, or seen
through an opening) or a time cut, never a walk to a door and back.

## What you add to each frame

Under the story's bullets (leave `scene`, `voiceover`, `transition_in`, `type`, `engagement`,
`ground`, `anchor`, `reset`, `shots` with their casts and angles, and `technique` as they are),
append:

```
- focal: the one orange entity of this beat (an anchor-scene entity id, a concept id, or a new object)
- eye: where the eye lands first → where it travels → what rewards it
- space: how the read stands out of the place (light, value, size, or a declared focus), in a few words
- camera: per shot, where the camera stands (side, height, distance) and why this angle teaches something new; its one move if any (push, pull, pan, follow) and what motivates it; a focus reason only for an insert, a reveal or a rack
- light: the shot's sources (the studio key, a window, a lamp, an open door, a screen), what the light does and what motivates it, or "steady"
- sounds: the frame's sound moments in the library's plain words (frame.md § Sound)

Scene 1 (0.0–1.4s): …
Scene 2 (1.4–3.0s): …
```

- **Shots** (frame.md § Shots): follow the frame's `shots:` in order, on their cue words; the
  plan's lengths are approximate, so re-time each cut to its cue word and, where a shot would run
  outside 1.5–4.5s, split or merge it, keeping its subject, cast and angle (a frame over 6s cuts
  between at least two). Every cut changes what the viewer learns: a new subject, or
  the same subject from a clearly new angle; judge it by the picture. A shot draws only its cast
  (at most 3 critters, a crowd counting as one); a critter left out is out of that camera's view.
  No frame opens on the picture the previous frame ended on.
- **Scene frames** (`anchor: scene`: frames 1, 4, 5, and 7 when it calls back) name the scene's
  entities by their ids, the state they start in (the state the previous scene frame ended in)
  and the state they end in; three layers in every shot but an insert (the set's foreground piece,
  the action, the background); never an entity redrawn differently.
- **The cast acts by intent** (EX4-150): name each critter's action and its target, its mood, and
  what it holds ("the <role>, reaching for the <thing>, mood: focused"), always in the outfit the
  anchor block gives it. Whatever the hero is, it reads: big enough, clearly the subject, doing the
  voiced action. When the voice names a small
  prop, its window is the planned `insert` on it. When the voice first names the hero, its window has the hero as the clear
  subject: alone, or lit, centred and acting while anyone else is still. Objects can act on their
  own (EX3-109). Never a person, a figure, or a body part alone.
- **Tech frames** (frames 2, 3, 6, and 7 with `anchor: own`) follow the tech-frame anatomy
  (frame.md § Real-tech frames, EX4-160): the mechanism's parts laid across the safe area, with
  their concept ids from the identity map; the real content each carries (names, words, numbers
  from the reel's example or definition); in each window, what travels, splits, waits, gets copied
  or compared, and stays; the readout that changes and the number it lands on; the held end
  state. A device or a window shows its content from its first frame; a container arrives with
  its content; a card is the last resort, never the subject; a tracker is a guide, never the
  picture.
- **Space and size** (frame.md § The world): one place in centimetres; everything at its real size
  next to the critter; a closer camera, never a bigger drawing, makes a small thing read, and a
  tiny thing gets a magnifier or an insert. Whatever is inside a container stays behind its frame.
- **Labels** (the real terms, numbers, names) land as the voice names them, 5 words or fewer,
  anchored to their entity; say in which window. The mapping stays straight: a label names the
  part the storyboard's mapping gives it, on that part.
- **Frame 1:** the picked hook, in motion from Scene 1 (first change by 0.3s), clear on its own,
  building (`ramp-up`); its camera is still. The bank's opener breaks in over it (code). Describe
  the hook only.
- **Frame 2:** its own picture of the real thing, by technique, echoing the hook's motion or
  subject in its own layout (EX3-131, EX4-161); its `reset:` lands in the first 0.3s; never the
  hero.
- **Frame 3:** the dictionary card in the top half, filling in on the voice; below it the
  definition's mechanism by technique, showing the part `term_part:` names, revealed on its key
  words.
- **Frame 4:** the scene starts from its start state (the hook was a flash-forward). Scene 1 is
  the wide (the place, who is where; the "without" state when the analogy
  has two); then one window per part as the voice names it with its real job, its label landing;
  then one window per step, its action and its result.
- **Frame 5:** opens on a medium from a new angle; one window for why the analogy works (the trait
  doing its job), one for its limit or trade-off, made visible in the scene.
- **Frame 6:** the step tracker along one edge, and one window per example step: its real thing
  by technique while its stop lights; never the anchor scene or the hero (EX3-132).
- **Frame 7:** the answer working, resolved, in the reel's warmest light (EX4-153); never the
  opening tension again.
- **Frame 8:** the close is the kit's: no Scene lines beyond the skeleton's.

## One video direction, written once

Write a `## Video direction` block once, under `## Anchor scene`, so every frame inherits it and
the per-frame lines carry only the delta:

- **the place:** the set brief in words (the place, its tells, its architecture and openings, its
  materials and color story, its density, the place beyond and every other place the story goes);
- **palette and grounds:** which frames are `paper` and which `stage`; the one orange focal per
  beat (the hero's orange only in frames 1, 4, 5 and a frame-7 callback); green for labels; each
  other hue in its job; status colors only as signals;
- **the identity map** in words: each tech concept's icon, color and shape, the same in every tech
  frame;
- **light:** every source, where light moves with the story and what motivates each change, and
  where the warmest light lands (the payoff);
- **motion grammar:** motion has a job; named polarities; anticipation, volume-keeping squash and
  stretch, follow-through, arcs, a smear frame on fast moves; world moves ease in and out, titles
  and UI on the brand ease-out with no bounce; reveals on voice cues;
- **the tension curve:** where tension builds, where the attention reset sits (the 1→2 cut), where
  the payoff resolves (frame 7);
- **negative list:** a floor in a white void, poses with no target, a prop beside a hand, blur
  with no reason, a cut to a closer copy of the same view, a crowd squeezed into a shot, a trip
  that is never shown, empty cards, slides, lists, headlines, narration on screen, decorative
  motion, sizes that make no sense, a costume from the wrong job.

## Composition

- **One read at a time** (frame.md § One read at a time): the caption while the voice speaks, one
  label as the voice names it, or the focal acting. The place is full; the read is single, carried
  by light, value and size.
- **Color hierarchy:** orange leads, green follows, the set stays quiet in value.
- **Fill the safe area with the picture** (EX3-74): each object recognizable without a label; the
  subject and every label inside x 96–940, y 570–1600 for the whole shot.
- **Portrait:** stage the cast across the frame at different depths, the camera a little off the
  room's axis; never line critters up along the camera's axis.

## Before you finish

- `## Video direction` exists once; per-frame lines are deltas.
- Every frame has `focal`, `eye`, `space`, `camera`, `light`, `sounds`, and time-coded Scene lines
  paced to the voice, each naming its shot.
- Every voiced action and trip has its window; every result is visible.
- Every cut changes the subject or the angle; every shot's cast is at most 3 critters.
- Scene frames name what each critter does and toward what; the hero is the clear subject when the
  voice names it.
- Tech frames describe their technique's mechanism moving, with concept ids and real content.
- No `sfx:` lines; no hero in frames 2, 3 and 6; you wrote no code.
