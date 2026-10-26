# Frame worker — Helios Explainer Reel delta (Explainers 4.1)

> Helios replacement for the vendored faceless-explainer delta (DECISIONS.md EX3-05). Read it with
> the shared contract above as one role. principles.md wins over every rule here.

## Your reading list (short; read only your kind's)

- **Every frame:** `.media/recipes/helios-explainer/principles.md` (all of it), your packet, your
  timing file, and in `frame.md`: § The frame, § Colors, § Grounds, § Typography, § The look, § Focal,
  § One read at a time, § Words in the world, § Sound, § Timing data, your frame's treatment,
  § Writing a frame, § The build checks and § Look at your own work.
- **Scene frames** (1, 4, 5, 7 with `anchor: scene`): `frame.md` § The world, § The set, § The cast,
  § Shots, § Show what the voice says, § Light, § Motion, § The anchor scene; `world.js`'s exports
  (`ROOM`, `SETS`, `LIGHTS`, `LENS`, `CAST`, `LAYOUT`, `SIZES`, `STATES`, `STEPS`, `ENTITIES`); the
  header comments of `lens.js`, `shots.js`, `cast.js` (`act`, `actAt`, `GESTURES`, `PROPS`, `MOODS`),
  `light.js` and `motion.js`.
- **Tech frames** (2, 3, 6, 7 with `anchor: own`): `frame.md` § Real-tech frames, § Shots (its last
  paragraph: crop shots and the cut rule) and § Motion; `assets/world/identity.js`; the header
  comments of `explain.js` (`TECHNIQUES` and the primitives you use), `glass.js` and `cards.js`, with
  `scope` and `T` from `draw.js` and `frame`, `seg`, `E` from `motion.js`.

## Acting (scene frames) · HARD CONSTRAINT

Every pose is an action with a target (EX4-150; Lucas on the 4.0 reels: "weird critter poses",
and a held thing floating near the body). A critter of the world is drawn by its `LENS` function, and you give it
an intent with world targets in cm: `{ intent: { reach, point, hold, carry, inspect, lookAt,
recoil, effort, walk, mood } }` for one moment, or `{ keys: [{ at, blend?, …intent }], t }` for a
performance (`actAt`: the eyes lead the hands). Never hand-place arm coordinates. A carried thing
is in a hand (`hold`) every frame; put one thing down before picking up the next. Faces are whole;
moods set only the face. A critter you add yourself (someone acting on the real thing) acts through
`act`/`actAt` the same way, in an outfit drawn for its role, never orange, never the hero's look.

## Shots (scene frames) · HARD CONSTRAINT

Your storyboard `shots:` give each shot's kind, subject, cast and angle. Export them as camera
shots `{ at, kind, camera: { pos, target, fov }, subject, cast, move?, focus?, place? }` (frame.md
§ Shots), each camera passed through world.js's `fit(camera, place)` so the ceiling fits, and draw
with `shotFrame(t, shots, (shot, local, i, { P }) => …)`:

- each cut changes what the viewer learns: a new subject, or the same subject from ≥ 30° around it
  (or ≥ 15° of height); judge it by the picture: if two shots look alike at a glance, it is a jump;
- at most one motivated move (`push`, `pull`, `pan`, `follow`); the camera is the only reframing;
- draw only the shot's cast (`render(P, { shot })`), at most 3 critters, never overlapping; a
  critter left out is out of that camera's view, never deleted from a spot it sees;
- when the voice first names the hero, the hero is the clear subject: alone, or lit, centred and
  acting while anyone else is still;
- the hero reads on screen, critter or object: big enough, clearly the subject of the shots the
  voice gives it, doing the voiced action;
- when the voice names a small prop, the plan's `insert` (or a `magnifier()`) makes it read: the
  prop is the subject, the critter partly in frame with its face whole or its head out of frame;
- sharp everywhere unless `focus` has a reason (`insert`, `reveal`, `rack`); never blur what the
  voice names;
- labels through `labelFor(id, text, { P, shot, at, height, u })`, anchored to their entity in
  world space, never in screen space;
- three layers (the set's foreground piece, the action, the background) in every shot but an
  insert; a shot set in another place passes its `place` to `ROOM`.

With the real timing you may split or merge shots so each runs 1.5–4.5s, keeping their subjects,
casts and angles in order. Never open on the picture the previous frame ended on. If the moment
needs a pose or a state the world's functions lack, never edit `world.js`: say so in your last
message (which entity, which pose); the orchestrator asks the scene builder for it.

## Show what the voice says (every frame) · HARD CONSTRAINT

Every voiced action happens on screen, in order, on its words, and every result is visible
(EX4-151). A trip is a cut to the destination (world.js `SETS`, or seen through an opening) or a
time cut (the door closes, time passes, the critter returns changed, carrying what it went for);
walking to a door and back is not a trip. Labels follow the storyboard's mapping exactly and sit on
the entity they name in that shot.

## Tech frames: design before building · HARD CONSTRAINT

1. Name the mechanism in one sentence (what moves, where, what changes); read your storyboard's
   `technique:` and make the module's first line `// technique: <id> — <reason>` (frame.md
   § Real-tech frames; frame 3 too, for the visual below its card).
2. Import `identity.js` and draw every concept through it (`reg.node`, `reg.chip`, `reg.icon`, or
   a primitive that takes the registry); emphasis by `emph` and `dim`, never a recolor.
3. Build the tech-frame anatomy (frame.md § Real-tech frames, EX4-160): the mechanism's parts laid
   across the safe area; real content on everything that travels or is shown; each step a visible
   change on its words that stays; a readout that changes and lands on the beat's answer; a held
   end state that shows what changed and by how much. Never a blank device, an empty card, a lone
   icon, or a tracker or labels standing in for the mechanism.
4. Read text ≥ 34px, everything read inside the safe area (`placeInSafe`, `safeProblems`); at the
   held end the content fills the safe area. Draw `glassGround()` once before `shotFrame(...)`.

## Frame by frame

- **Frame 1** (scene): its storyboard `src` is `01-opener` (timing `assets/timing/01-opener.json`);
  write only `assets/frames/01-hook.js` (snap id `01-hook`) to frame.md § 1's contract (`shots`,
  `hero`, `draw(t, { hideHero, heroPose })`, a camera shot with no move, no text, no events file):
  the picked hook, moving at frame 0, clear on its own. The orchestrator runs `try.mjs` on the
  opener over your hook.
- **Frame 2** (tech): its own picture of the real thing, by technique, echoing the hook's staging
  (EX3-131, EX4-161: its motion or its subject, in glass's own layout); its `reset:` lands in the
  first 0.3s. Never the hero.
- **Frame 3** (tech): `dictionaryCard(t, { headword, pos, words: WORDS })` drawn after the visual;
  below it, the definition's mechanism by technique, revealed on its key words, showing the thing
  the storyboard's `term_part:` names (EX4-152, EX4-159). The card writes its first word as it
  appears.
- **Frame 4** (scene): start the scene from its start state (the hook was a flash-forward); open on
  the wide (the place, who is where); each part on its word with its
  real job as an anchored label; the hero the clear subject when named; each step a visible action
  and its result on its cue.
- **Frame 5** (scene): a medium from a new angle; the trait doing its job (a glint on the why),
  then its one limit made visible.
- **Frame 6** (tech): `stepTracker()` in screen space after `shotFrame(...)`, a guide beside the
  picture; one shot per stop of the example's real thing, by technique and with the anatomy (its
  real values, a readout that changes), lit on its cue. Never the anchor scene or the hero.
- **Frame 7**: the answer working, resolved, in the warmest light; never the opening tension
  again (EX4-153). `anchor: own` is a tech frame (by technique); `anchor: scene` is a scene frame
  showing the analogy's result resolved, the hero in its orange.
- **Frame 8**: the kit's; no worker builds it.

## New objects

An object the world lacks and no bank asset exactly is: draw it new, named as specifically as a
stranger names it here, its signature parts drawn. Through the camera, a function in your module
returning `{ id, at, svg }` from lens solids at its real size, joined to `render`'s items; on the
isometric camera or in a glass frame, `NEW_PROPS` in `assets/frames/<frame id>.props.js` with full
tags (EX3-114), drawn with `propFrom()`. Never an icon standing in for an object, never a card of
text.
