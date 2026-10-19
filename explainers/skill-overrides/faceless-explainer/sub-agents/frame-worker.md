# Frame worker — Helios Explainer Reel delta (Explainers 3.3)

> Helios replacement for the vendored faceless-explainer delta (DECISIONS.md EX3-05). Read it
> with the shared contract above as one role.

## The cast and the objects (HARD CONSTRAINTS)

- **Critters act** (EX3-77). Anyone who does something is a critter (`cast.js` or the world's
  critter function). Never draw a person, a figure built from solids, or a body part. A critter
  holds the thing (`handAt`), writes, reaches, feels its way, points, reacts (`mood`).
- **Props first** (EX3-78). An everyday object the library has is drawn with `prop(name, x, y,
  { s, state, focal })`; never draw your own version of it.
- **Text from the kit** (EX3-80, EX3-92). The title card is `titleCard()`, the dictionary card is
  `dictionaryCard()`, and any text inside a shape (a speech or chat bubble, a note, a sign, a
  screen) is `textBox(text, x, y, { kind, size, maxW, focal, progress, scale })`, which sizes the
  shape around the measured text and returns `{ svg, box }`. Never place text in a shape by hand,
  and never let text reach the frame edge: `bounds.mjs` measures every piece of text every 0.2s
  and sends anything cut off, outside its box, or in a keep-out back to you.
- **Critters keep their ids** (EX3-90). The world's critters carry `who:`; any critter you add
  passes its own `who: '<name>'` to `critter()`. A critter is drawn once at any moment, and
  never disappears from the scene mid-frame unless the story has it leave.

## The anchor scene

The reel revolves around one everyday scene (frame.md, "The anchor scene"). If your frame shows
it (`anchor: scene`: frames 1, 2, 4 and 5; frame 6 may cut back to it once):

- draw every entity with its `world.js` function, at its `LAYOUT` position, in the state your Scene
  lines name; start in the state the previous scene frame ended in;
- change the scene only through `STATES`' rules, one visible step at a time;
- show it in your storyboard `shots:` (frame.md § Shots): export them as `shots`, draw with
  `shotFrame(t, shots, draw)`, cut on the words the storyboard names (their times are in your
  timing file), aim each shot with `on:` at the world's `SUBJECTS` entry for the shot's subject,
  so what the voice names is centred. Never open on the framing the previous frame ended on;
  never change what the entities look like.
- **A shot is only a camera** (EX3-90): `draw` returns the same scene in every shot, with every
  entity in it; never skip a critter or object because of the shot kind, never add a second copy
  of one, never mirror the scene. An insert is a tight camera (zoom 2.2 or more) on one object;
  the rest falls out of frame by itself. When the voice names a critter doing something, it is
  in view doing it.

## Frame 1

The storyboard's picked **hook** (`## Hook`), already moving at t=0 (first visible change by
0.3s), clear on its own, building with the riser (`ramp-up`). Never a slow pan over a still scene.
Over it, drawn after the scene: `titleCard(t, { term, to: VOICE_END - 0.1 })` with the
storyboard's `term:`; it slides in from the first frame and starts writing at 0.25s (EX3-93).
Sounds: the hook's motion, `paper slide` at 0.1s for the card, a `pen writing` foley with `dur`
under "today's brain break:" and a `marker writing` one under the term.

## Frame 2

The anchor scene in its `shots:`, each centred on what the voice names while it is on screen. Its `reset:` lands in the first 0.3s: a
camera punch-in (`punch`, `slam`), a ground flip to night or forest, the second half of an
in-frame zoom-through (`seams.js` `zoomThroughIn`), or a cut effect (`shock()` marks, a one-frame
palette flash).

## Frame 3

`const card = dictionaryCard(t, { headword: <the term>, pos: <part_of_speech>, words: WORDS })`,
where `WORDS` is your timing file's words (the definition is the voiceover), copied into a
constant. Draw `card.svg` after the visual. Below the card (from `card.bottom + 40` to y 1600), a
drawn visual of what the definition says, with critters and props, revealed on its key words.
Sounds: `paper slide` as the card lands, a soft `pen writing` or `typewriter key` with `dur`
under the fill-in, each arrival in the visual.

## Frame 4

Open on the reel's one **establishing shot** (`wide`): each element arrives on the word that
introduces it (a critter may glance at or wave to the camera); then the closer shots play each
of the anchor scene's `steps` as a visible state change on its cue, to the payoff.

## Frame 5

A shot per mapped pair (a close, medium or insert on the object, not frame 4's framing); each real term lands
**on the scene's object** as its "because" is spoken, one at a time (the previous dims to 25%),
and the object's action pulses once on the "because" clause. Never a list.

## Frame 6

The **example, illustrated** (EX3-87): the **step tracker** (frame.md `step-tracker`) along one
edge, one stop per `example_steps` entry, in order, numbered, each lighting (green) on its cue,
done stops ink, upcoming ones 25%; and for each stop an `insert` shot of that step's real thing
drawn in the style (a search box card, a price list, a ticket), with critters and props. One cut
back to the anchor scene may show the example lining up with the analogy. Real values as labels
where the example has them. A `tick` per stop.

## Frame 7

A new drawn scene on a ground different from frame 6's, matching the line's transition, built
from critters and props, in at least two shots when it runs past 6s.

## New objects

If your frame needs something neither the world nor the prop library has, draw it in the paper
style (frame.md V-4): boxy things from the kit's solids, organic ones as ink contours with flat
fills (`props/kit.js`), silhouette first, detail printed in `T.ink` on its faces, three flat
tones, an outline, grain, a contact shadow. Never a realistic drawing, never an icon standing in
for the object, never a list or a card of text.

## Frame 8

The close is the kit's (`close.js`, EX3-95), written by code. No worker builds it.
