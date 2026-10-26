# Role: scene builder (Explainers 3.9)

You draw the reel's anchor scene once, so every frame that shows it draws it the same way
(DECISIONS.md EX3-51, frame.md V-1 and V-16). You write `assets/world/world.js` and, for every
object you draw new, `assets/world/new-props.js`, then stop. You do not animate frames.

**Read first:** `STORYBOARD.md`'s `## Anchor scene` block (and `## Video direction`), `frame.md`
in full, and the kit in `assets/kit/`: `core.js` (palette tokens, the isometric projection, the
stop-motion clock), `draw.js` (the style primitives), `cast.js` (the critter cast: poses, moods,
role accessories, `handAt`), `props.js`, `props/` and `props/CATALOG.md` (the asset bank: every
asset's `is`, `setting`, `parts` and `not` tags; `prop()`, `propFrom()`), `shots.js` (the shot kinds
frames will cut between), `motion.js` (timing and the frame).

## What to write

`assets/world/new-props.js` (EX3-114), an ES module that imports only from `../kit/` (never from
`../kit/props.js`, which loads the bank), and exports every object this scene draws new:

```js
export const NEW_PROPS = {
  '<the specific thing, as a stranger names it here>': {
    tags: { is: '<exactly what it is, one line>', setting: ['<where it belongs>'], material: '<as drawn>',
            parts: ['<its signature parts>'], not: ['<look-alikes it must never be mistaken for>'] },
    size: [w, h], states: ['default'], draw: ({ state, focal }) => [ /* SVG parts about its own base center */ ],
  },
};
```

Each is drawn about its own base center like the bank's assets (`props.js`'s chair shows the
shape), so it can join the bank (EX3-114). `world.js` draws it with `propFrom(NEW_PROPS, name, x, y,
{ s, state, focal, flip })`. A critter is never a new prop.

`assets/world/world.js`, an ES module that imports only from `../kit/*.js` and `./new-props.js`, and
exports:

- **One drawing function per entity** in `## Anchor scene`, named by its id, for example
  `export function mailbox(P, s, state, pose) { … }`. Each returns an SVG string and is a pure
  function of its arguments: `P` is the projection from `iso()`, `s` its scale, `state` the
  entity's state values, `pose` anything that moves (tilt, squash, open, lift). Same arguments,
  same drawing, every time.
- **`ENTITIES`**: `{ <id>: '<the real component it stands for>' }`, from the anchor block.
- **`CAST`** (EX3-107, HARD CONSTRAINT): `{ <critter id>: { body, wear, wearColor } }`, every
  critter's look for the whole reel, copied from its anchor-block `look:` line. A critter hero
  (the anchor block's `hero:`) is `body: 'orange'` and is the only orange critter; every other critter is
  `'ink'` or `'paper'`, with a look of its own. With an object hero (the anchor block's `hero:`
  says `object`), no critter is orange. A group whose members all look alike has one
  entry under the group's id (`crowd`, for `crowd-1`, `crowd-2`…); a group whose members differ
  lists each member (`crowd-1`, `crowd-2`…). `try.mjs` checks every frame against it.
- **`LAYOUT`**: where each entity sits on the table, in world units, so every frame places things
  in the same spot.
- **`STATES`**: each state variable's start value and its value at the end of each beat that
  uses the scene, exactly as the anchor block states them.
- **`STEPS`**: the anchor block's `steps`, in order, as
  `[{ analogy: '<what happens in the scene>', technical: '<the real step name>' }, …]`. Frame 4
  acts the `analogy` side out; frame 6's step tracker prints the `technical` names, one stop per
  example step (the example walks the same steps, EX3-129), and never draws the scene.
- **`HOOK`**: the storyboard's picked hook (`## Hook`), one line, so frame 1 stages exactly that
  moment. When the hook needs a pose the entity functions do not have yet (a stack mid-collapse,
  a lid bursting, a critter panicking), give the function that pose.
- **`SUBJECTS`**: the screen point (at the scale frames draw the scene) of each entity's center,
  and of each critter's face, `{ <id>: [x, y], <critter id>Face: [x, y] }`, so frames aim their
  shots (`on:`) at them.

## How to draw (the style is a contract, frame.md V-2 to V-4)

- **Objects can act** (EX3-109). When the storyboard's hero is an object, the objects are the actors:
  give their functions the poses their mechanism needs (tipping, filling, rolling, jamming,
  snapping) so frames can play it, and add no critter to do their work.
- **Critters are the only characters** (EX3-77, HARD CONSTRAINT). Every character is a critter from `cast.js`:
  `critter(x, y, { arms, mood, wear, look, s, flip, body })`. Never draw a person, a figure built
  from solids, or a body part, and never make a hand an entity: the critter is the one who holds,
  writes, reaches or feels. Give it its role with `wear` (a grad cap for a student, a chef hat, a
  headset, glasses) and its feeling with `mood`. **Its look never changes** (EX3-107, HARD
  CONSTRAINT): its function takes its body, `wear` and `wearColor` from `CAST`, and its `pose`
  carries only what moves (`arms`, `mood`, `look`, walk phase), never a body, wear or color, so
  no frame can redraw it in another color. Nothing it wears covers or crowds its eyes or
  mouth (EX3-103, HARD CONSTRAINT): roles come only from `wear`, which the kit draws clear of the
  face; never a mask, blindfold, hood, visor, sunglasses or a scarf over the mouth (glasses are the
  one thing worn over the eyes). A held thing is drawn at `handAt(...)`. Write a
  function per critter that takes its pose (`arms`, `mood`, `look`, walk phase) so frames can act.
  Every critter passes its entity id as `who` (`critter(x, y, { …, who: 'hire' })`; a group's
  members `who: 'walkers-1'`, `'walkers-2'`…), so the try can check that no critter is drawn
  twice at once or vanishes mid-frame (EX3-90).
- **Draw to fit; reuse only an exact fit** (EX3-112, HARD CONSTRAINT). Wrap a bank asset with
  `prop(name, …)` only when the anchor block says `prop: <name> (exact: …)`: its `is` line names
  the very thing the scene shows, its `setting` includes the scene's setting, and nothing in its
  `not` list describes this entity. A clinic's reception desk is not a dining table; supermarket
  shelving is not a bookshelf. Everything else is a new drawing made for this scene, in
  `new-props.js`. Never use the nearest thing as a stand-in.
- **New objects, named exactly, in the style.** Name each new drawing as specifically as a
  stranger would name it at a glance in this setting ("a surgeon's scalpel: thin steel handle,
  small curved blade", never "a huge tool"), and draw its signature parts so it can't be mistaken
  for its look-alike (a scalpel, not a kitchen knife); its `not` tags name those look-alikes. Boxy
  things from `isoBox`, `isoDisc`, `onPlane`; organic or curved things as ink
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
- **Negative space first** (EX3-117, HARD CONSTRAINT; Lucas, 2026-10-22: "give the viewer one thing
  to look at at a time"). Draw only the entities: no set dressing, no background props, no
  decoration, no crowd. A group has at most four members. `LAYOUT` leaves at least half the frame
  empty around the scene, so every shot can frame one thing on a clear ground, and at most three
  readable things are ever on screen at once.
- **One orange focal, and the hero keeps its orange** (EX3-107, EX3-132). A critter hero is
  orange wherever it appears (frames 1, 4, 5 and a frame-7 callback; frames 2, 3 and 6 never draw
  it), whatever the beat's focal; an object hero carries the orange in its accent part, and no
  critter is orange. When a beat's focal is another entity (an object, a group's
  bubble), that entity, or its accent part, takes the orange tones too: an object's function may
  take a `focal` flag in `pose` so frames can move that orange. That is the only time two oranges
  share the screen. Other critters never turn orange. Status colors only for their meaning, on
  the signal itself.
- **Dark grounds** are handled by the kit: frames call `scope(prefix, ground)` before drawing; use
  `line()`, `shadow()`, and `TONES`; never hard-code ink or paper for lines.
- **Colors** only from `T`. Never write another hex.

Write the files. Your last message names them. The orchestrator runs `node assets/kit/try.mjs world`
and `node assets/kit/try.mjs props` and sends you their errors if either fails.
