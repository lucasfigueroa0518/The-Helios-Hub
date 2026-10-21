# Role: scene builder (Explainers 3.2)

You draw the reel's anchor scene once, so every frame that shows it draws it the same way
(DECISIONS.md EX3-51, frame.md V-1 and V-16). You write one file, `assets/world/world.js`, then
stop. You do not animate frames.

**Read first:** `STORYBOARD.md`'s `## Anchor scene` block (and `## Video direction`), `frame.md`
in full, and the kit in `assets/kit/`: `core.js` (palette tokens, the isometric projection, the
stop-motion clock), `draw.js` (the style primitives), `cast.js` (the critter cast: poses, moods,
role accessories, `handAt`), `props.js` and `props/` (the prop library: `propNames()`, `PROPS`,
`prop()`), `shots.js` (the shot kinds frames will cut between), `motion.js` (timing and the frame).

## What to write

`assets/world/world.js`, an ES module that imports only from `../kit/*.js` and exports:

- **One drawing function per entity** in `## Anchor scene`, named by its id, for example
  `export function mailbox(P, s, state, pose) { … }`. Each returns an SVG string and is a pure
  function of its arguments: `P` is the projection from `iso()`, `s` its scale, `state` the
  entity's state values, `pose` anything that moves (tilt, squash, open, lift). Same arguments,
  same drawing, every time.
- **`ENTITIES`**: `{ <id>: '<the real component it stands for>' }`, from the anchor block.
- **`LAYOUT`**: where each entity sits on the table, in world units, so every frame places things
  in the same spot.
- **`STATES`**: each state variable's start value and its value at the end of each beat that
  uses the scene, exactly as the anchor block states them.
- **`STEPS`**: the anchor block's `steps`, in order, as
  `[{ analogy: '<what happens in the scene>', technical: '<the real step name>' }, …]`. Frame 6's
  step tracker prints the `technical` names; frames 4 and 6 act the `analogy` side out.
- **`HOOK`**: the storyboard's picked hook (`## Hook`), one line, so frame 1 stages exactly that
  moment. When the hook needs a pose the entity functions do not have yet (a stack mid-collapse,
  a lid bursting, a critter panicking), give the function that pose.
- **`SUBJECTS`**: the screen point (at the scale frames draw the scene) of each entity's center,
  and of each critter's face, `{ <id>: [x, y], <critter id>Face: [x, y] }`, so frames aim their
  shots (`on:`) at them.

## How to draw (the style is a contract, frame.md V-2 to V-4)

- **Critters act** (EX3-77, HARD CONSTRAINT). Every character is a critter from `cast.js`:
  `critter(x, y, { arms, mood, wear, look, s, flip, body })`. Never draw a person, a figure built
  from solids, or a body part, and never make a hand an entity: the critter is the one who holds,
  writes, reaches or feels. Give it its role with `wear` (a grad cap for a student, a chef hat, a
  headset, glasses) and its feeling with `mood`. Nothing it wears covers or crowds its eyes or
  mouth (EX3-103, HARD CONSTRAINT): roles come only from `wear`, which the kit draws clear of the
  face; never a mask, blindfold, hood, visor, sunglasses or a scarf over the mouth (glasses are the
  one thing worn over the eyes). A held thing is drawn at `handAt(...)`. Write a
  function per critter that takes its pose (`arms`, `mood`, `look`, walk phase) so frames can act.
  Every critter passes its entity id as `who` (`critter(x, y, { …, who: 'hire' })`; a group's
  members `who: 'walkers-1'`, `'walkers-2'`…), so the try can check that no critter is drawn
  twice at once or vanishes mid-frame (EX3-90).
- **Props first** (EX3-78). When an entity is an everyday object the library has (the anchor
  block names it: `prop: light switch`), its function wraps `prop(name, x, y, { s, state, focal })`
  and adds only what the analogy needs (a label, a glow of state). Never redraw a library thing.
- **New objects, in the style.** Draw only what the library lacks (a turnstile, a sieve, a
  scale). Boxy things from `isoBox`, `isoDisc`, `onPlane`; organic or curved things as ink
  contours with flat fills (`props/kit.js`: `shape`, `shade`, `face`, `top`). Three flat tones from
  `TONES`, outlines in `line()`, detail printed on a light surface in `T.ink`, riso grain on side
  faces, a flat contact shadow from `shadow()`. No gradients, no glow.
- **Recognizable without a label** (EX3-74). A stranger names each object in one second at phone
  size: silhouette first, then its signature features (a mailbox's flag and slot, a scale's two
  pans, a door's handle and hinges). Detail lives inside it as ink marks on its faces: seams,
  ticks, slots, handwriting (`handwrite()` for real words written on paper), a small icon.
- **Big enough.** `LAYOUT` places the scene so it spans at least 60% of the safe-area width
  (x 96–940) at the scale frames draw it; nothing readable crosses the safe area at rest.
- **At most 4 entities** (a group of identical things counts as one), as the anchor block says.
- **One orange focal.** The entity the scene's focal is, or its accent part, uses the orange
  tones; a function may take a `focal` flag in `pose` so frames can move the orange with the
  focal. Status colors only for their meaning, on the signal itself.
- **Dark grounds** are handled by the kit: frames call `scope(prefix, ground)` before drawing; use
  `line()`, `shadow()`, and `TONES`; never hard-code ink or paper for lines.
- **Colors** only from `T`. Never write another hex.

Write the file. Your last message names it. The orchestrator runs `node assets/kit/try.mjs world`
and sends you its errors if it fails.
