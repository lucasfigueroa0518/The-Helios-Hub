# Frame worker — Helios Real Case Reel delta (real-case-v1)

> The Real Case replacement for the faceless-explainer frame-worker delta (planning/Real Case
> Reels/DECISIONS.md). Read it with the shared contract above as one role.

## The cast and the objects (HARD CONSTRAINTS)

- **Objects can act; critters are the only characters.** Anyone who does something in the event is a
  critter (`cast.js` or the world's critter function), named by role, in ink or paper; objects that act
  on their own need no one beside them. Never draw a person, a figure built from solids, or a body part.
- **The key item carries the orange.** The anchor block's `hero:` is the key item, an object, orange in
  its accent part wherever it appears. **No critter is ever orange.**
- **One thing to look at.** Every shot frames one thing on a clear ground, with at least half the frame
  empty; at most three readable things on screen at once; no set dressing, no background props, no
  crowd.
- **Draw to fit; reuse only an exact fit.** A bank asset (`props/CATALOG.md`) is drawn with
  `prop(name, x, y, { s, state, focal })` only when its tags say it is exactly the thing your frame
  shows, in its setting; anything else is drawn new.
- **No logos.** An organization's name appears only as a plain label in the kit's lettering, as the
  voice says it; never a logo, a brand mark, brand colors, or a copy of a product's real screen.
- **Facts only.** Every number, date, name and outcome on screen is in the storyboard's facts for your
  frame (its `claims:`, as the voiceover says them). Never add one.
- **Text from the kit.** The dictionary card is `dictionaryCard()`, and any text inside a shape (a
  speech or chat bubble, a note, a sign, a screen) is `textBox(text, x, y, { kind, size, maxW, focal,
  progress, scale })`. Never place text in a shape by hand, and never let text reach the frame edge.
- **Critters keep their ids.** The world's critters carry `who:`; any critter you add passes its own
  `who: '<name>'` to `critter()`. A critter is drawn once at any moment, and never disappears from the
  scene mid-frame unless the story has it leave.

## The story world

The reel lives in one world, the event's (frame.md, "The story world"). If your frame shows it
(`anchor: scene`: frames 1, 2, 4, 5 and 6; frame 7 may call back to it in one shot):

- draw every entity with its `world.js` function, at its `LAYOUT` position, in the state your Scene
  lines name; start in the state the previous frame ended in;
- change the world only through `STATES`' rules, one visible step at a time;
- show it in your storyboard `shots:`: export them as `shots`, draw with `shotFrame(t, shots, draw)`,
  cut on the words the storyboard names (their times are in your timing file), aim each shot with `on:`
  at the world's `SUBJECTS` entry for the shot's subject, so what the voice names is centred. Never open
  on the framing the previous frame ended on; never change what the entities look like.
- **A shot is only a camera:** `draw` returns the same scene in every shot, with every entity in it;
  never skip a critter or object because of the shot kind, never add a second copy of one, never mirror
  the scene.

## Frame 1 (HARD CONSTRAINT: write `assets/frames/01-hook.js`, never `01-opener.js`)

Frame 1 is the bank's opener: code wrote `01-opener.js`, which plays the opener named in
`assets/opener.json` over **your hook**. You write only the hook, `assets/frames/01-hook.js`, to the
contract in frame.md § 1: the storyboard's picked hook (`## Hook`), the event's key moment with the key
item in it, already moving at t=0 (first visible change by 0.3s), clear on its own, building
(`ramp-up`), under `shotFrame(t, shots, draw)`; `export default { ground, shots, draw(t, { hideHero,
heroPose }) }`, with no `hero` export (an object-led reel); no title card, no text, no events file.

Try it with `node assets/kit/try.mjs frame 01-opener` (the opener over your hook).

## Frame 2

The puzzle, in the story world. Its `reset:` lands in the first 0.3s: a camera punch-in (`punch`,
`slam`), a ground flip to night or forest, the second half of an in-frame zoom-through (`seams.js`
`zoomThroughIn`), or a cut effect (`shock()` marks, a one-frame palette flash). Each piece of what
happened arrives as the voice names it; then the strange detail is isolated and held while the
question is asked. Never the term on screen.

## Frame 3

`const card = dictionaryCard(t, { headword: <the term>, pos: <part_of_speech>, words: WORDS })`, where
`WORDS` is your timing file's words (the definition is the voiceover), copied into a constant. Draw
`card.svg` after the visual. Below the card (from `card.bottom + 40` to y 1600), a drawn visual of what
the definition says, revealed on its key words; the key item may appear in its orange.
Sounds: `paper slide` as the card lands, a soft `pen writing` or `typewriter key` with `dur` under the
fill-in, each arrival in the visual.

## Frame 4

Open on the reel's one **establishing shot** (`wide`) of the story world. Draw the **step tracker**
(frame.md `step-tracker`) along one edge: its stops the anchor steps' names (world.js `STEPS`,
`technical`), in order, numbered, each lighting (green) on the word that names it, done stops ink,
upcoming ones 25%. Then the closer shots play each step on the event's own thing (`STEPS`, `in_story`)
as a visible state change on its cue, the key item moving through them, building toward the outcome. A
`tick` per stop.

## Frame 5

The click, in `close` or `insert` shots (not frame 4's framing): replay the step that produced the
outcome on the key item, which glows or is traced through it; a dotted ink line draws itself from the
cause to the outcome as the voice says why, and the outcome lands on its word. Never a list.

## Frame 6

The other side, in the same story world, in its own shots: at the step the fix or the limit touches,
show the change (a failure's fix applied and the step running cleanly; a success's limit made visible;
a mystery's open question left faint). Labels only as the voice names them.

## Frame 7

The takeaway, on a ground different from frame 6's: the answer landing, then one drawn thing for the
rule the viewer keeps, built from objects drawn for it and critters when someone acts, in at least two
shots when it runs past 6s. At most one callback shot of the story world, with the key item in its
orange.

## New objects

If your frame needs an object the world doesn't have, and no bank asset is exactly it, draw it new: name
it as specifically as a stranger names it in this setting, write it in
`assets/frames/<frame_id>.props.js` as `export const NEW_PROPS = { '<specific name>': { tags, size,
states, draw } }` (the tags `is`, `setting`, `material`, `parts` and `not`, as in
`assets/world/new-props.js`), import only from `../kit/` (never `../kit/props.js`), and draw it with
`propFrom()`. Draw it in the paper style (frame.md V-4): boxy things from the kit's solids, organic ones
as ink contours with flat fills (`props/kit.js`), silhouette first, detail printed in `T.ink` on its
faces, three flat tones, an outline, grain, a contact shadow. Never a realistic drawing, never an icon
standing in for the object, never a logo, never a list or a card of text.

## Frame 8

The close is the kit's (`close.js`), written by code. No worker builds it.
