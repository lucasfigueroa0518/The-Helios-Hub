# Frame worker — Helios Explainer Reel delta (Explainers 3.3)

> Helios replacement for the vendored faceless-explainer delta (DECISIONS.md EX3-05). Read it
> with the shared contract above as one role.

## The cast and the objects (HARD CONSTRAINTS)

- **Objects can act; critters are the only characters** (EX3-77, EX3-109). Anyone who does
  something is a critter (`cast.js` or the world's critter function); objects that act on their
  own need no one beside them. Never draw a person, a figure built from solids, or a body part. A
  critter holds the thing (`handAt`), writes, reaches, feels its way, points, reacts (`mood`).
- **One thing to look at** (EX3-117, HARD CONSTRAINT). Every shot frames one thing on a clear
  ground, with at least half the frame empty; at most three readable things on screen at once; no
  set dressing, no background props, no crowd. Whatever else the moment needs sits small or faded,
  or is cut out of the shot.
- **Draw to fit; reuse only an exact fit** (EX3-112). A bank asset (`props/CATALOG.md`) is drawn
  with `prop(name, x, y, { s, state, focal })` only when its tags say it is exactly the thing your
  frame shows, in its setting; never the nearest thing as a stand-in. Anything else is drawn new.
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

The reel revolves around one staged analogy (frame.md, "The anchor scene"). If your frame shows
it (`anchor: scene`: frames 1, 4 and 5; frame 7 may call back to it in one shot):

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

## Frame 1 (HARD CONSTRAINT: write `assets/frames/01-hook.js`, never `01-opener.js`)

Frame 1 is the bank's opener (EX3-102): code wrote `01-opener.js`, which plays the opener named
in `assets/opener.json` over **your hook**. You write only the hook, `assets/frames/01-hook.js`,
to the contract in frame.md § 1:

- the storyboard's picked **hook** (`## Hook`), already moving at t=0 (first visible change by
  0.3s), clear on its own, building (`ramp-up`), under `shotFrame(t, shots, draw)`; never a slow
  pan over a still scene;
- `export const hero = { at, s, who, critter }`: the hook's critter (the anchor block's `hero:`), `at` its feet on the page (the world's `LAYOUT` spot, before any
  camera), `s` the scale it is drawn at, `who` its world id, `critter` the `critter()` options
  that make it itself (`wear`, `body`);
- `draw(t, { hideHero = false, heroPose = {} } = {})`: leave the hero out when `hideHero` is
  true, and pass `heroPose` last into its options (`look`, `arms`, `mood`), so an opener can cut
  it out, zoom into its eye or make it look at the viewer;
- no title card, no text, no events file: the opener draws "AI BRAIN BREAK" and the title card,
  and its stem is the frame's sound.

Try it with `node assets/kit/try.mjs frame 01-opener` (the opener over your hook).

## The hero (HARD CONSTRAINT, EX3-132)

The hero (the anchor block's `hero:`; CAST's orange critter in a critter-led reel) appears only in
frames 1, 4 and 5 and in a frame-7 callback shot. Frames 2, 3 and 6 never draw it, a copy of it,
or a critter in its look; `try.mjs` errors when they do.

## Frame 2

Its own picture of the real thing (`anchor: own`), in its `shots:`, each centred on what the voice
names while it is on screen. It echoes the hook (EX3-131): the same staging as `01-hook.js` (where
things sit, how they move), with the real thing in the analogy's place. Its `reset:` lands in the
first 0.3s: a camera punch-in (`punch`, `slam`), a ground flip to night or forest, the second half
of an in-frame zoom-through (`seams.js` `zoomThroughIn`), or a cut effect (`shock()` marks, a
one-frame palette flash).

## Frame 3

`const card = dictionaryCard(t, { headword: <the term>, pos: <part_of_speech>, words: WORDS })`,
where `WORDS` is your timing file's words (the definition is the voiceover), copied into a
constant. Draw `card.svg` after the visual. Below the card (from `card.bottom + 40` to y 1600), a
drawn visual of what the definition says (the real thing, with critters and props when someone
acts, never the hero), revealed on its key words.
Sounds: `paper slide` as the card lands, a soft `pen writing` or `typewriter key` with `dur`
under the fill-in, each arrival in the visual.

## Frame 4

Open on the reel's one **establishing shot** (`wide`; on the "without" state when the analogy has
two): each part arrives on the word that names it, and its real job lands as a label pinned to it
as the voice names that job (a critter may glance at or wave to the camera); then the closer shots
play each of the anchor scene's `steps` as a visible state change on its cue, building toward the
answer.

## Frame 5

Why it works, then where it breaks (EX3-128), on the scene, in close, medium or insert shots (not
frame 4's framing): first the defining trait doing its job, the object that carries it pulsing on
the word that names why; then the one limit or trade-off made visible in the scene, on the word
that names it. Never a list.

## Frame 6

The **example, illustrated** (EX3-87, EX3-129): the **step tracker** (frame.md `step-tracker`)
along one edge, its stops the anchor steps' technical names (world.js `STEPS`), in order,
numbered, each lighting (green) on its cue, done stops ink, upcoming ones 25%; and for each stop
an `insert` shot of the matching `example_steps` entry's real thing drawn in the style. Never the
anchor scene or the hero. Real values as labels where the example has them. A `tick` per stop.

## Frame 7

The payoff (EX3-128): the real thing doing what the answer to frame 2's question says, on a
ground different from frame 6's, built from objects drawn for it and critters when someone acts,
in at least two shots when it runs past 6s. At most one callback shot of the anchor scene, drawn
with `world.js`, where the hero may show in its orange.

## New objects

If your frame needs an object the world doesn't have, and no bank asset is exactly it, draw it
new: name it as specifically as a stranger names it in this setting, write it in
`assets/frames/<frame_id>.props.js` as `export const NEW_PROPS = { '<specific name>': { tags, size,
states, draw } }` (the tags `is`, `setting`, `material`, `parts` and `not`, as in
`assets/world/new-props.js`; it joins the bank once the picture check names it, EX3-114), import
only from `../kit/` (never `../kit/props.js`), and draw it with `propFrom()`. Draw it in the paper
style (frame.md V-4): boxy things from the kit's solids, organic ones as ink contours with flat
fills (`props/kit.js`), silhouette first, detail printed in `T.ink` on its faces, three flat
tones, an outline, grain, a contact shadow. Never a realistic drawing, never an icon standing in
for the object, never a list or a card of text.

## Frame 8

The close is the kit's (`close.js`, EX3-95), written by code. No worker builds it.
