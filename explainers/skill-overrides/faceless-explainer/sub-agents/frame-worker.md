# Frame builder — the Helios Explainer Reel delta (Explainers 4.2)

> Helios replacement for the vendored faceless-explainer delta (planning/Explainer Reels/DECISIONS.md).
> Read it with the shared contract above as one role.

One process builds any frame. What differs is the frame's `look`, which the director chose; build
to it, whatever the frame's number.

## The look decides what you build

- **`world`**: the analogy's places, through the camera. Use frame.md § Cameras and shots,
  § Places, § Light and mood, § Critters, § Objects and the courier, § Carry and § Solids, labels
  and drawing. Draw the places with world.js's `ROOM` (a shot's `place:` names which), light each
  shot with `LIGHTS` and the frame's mood from `COLOUR_SCRIPT`, and draw every entity with its
  `LENS` function.
- **`mechanism`**: the real technology. Use frame.md § Objects and the courier, § Mechanism
  primitives, § Cameras and shots (its flat-frame part), § Motion and § Carry. Before you draw,
  **name the mechanism in one sentence: what changes, and how.** Something may travel, split,
  combine, wait, be copied, be compared, contain another thing, or change state; the frame may be a
  before and an after. Then draw the real things as objects, each through the identity map
  (`reg.object`) so it keeps its concept's one look, in the house's mechanism look
  (`house-style.md` § Mechanism frames), and show the change with the tool that fits it: a `courier` for what travels, `setState`
  or `morph` for what changes, the primitives for splits, merges, comparisons and counts.
- **`blend`**: both worlds in one frame, or one becoming the other on screen. Use everything the
  two looks above use. Name the mechanism first, as for `mechanism`; then decide where each world
  sits in the frame, or at which moment one becomes the other (`carry()` with a `morph`).

**HARD CONSTRAINT: every concept in `assets/world/identity.js` is drawn only through the map**
(`reg.object`, `reg.worldObject`, `reg.node`, `reg.chip`, `reg.icon`), in every frame and every look;
never freehand, never as a plain `object()` or solids of your own, never recoloured. Highlight it with
the map's own options (`accent`, `emph`, `dim`).

## Acting

- **Critters act through the rig.** Give a world critter its `LENS` pose as an intent with world
  targets in cm (one moment), or as `keys` over time; a critter of your own acts through `act` and
  `actAt` the same way. The rig solves the arms, the lean and the gaze: never place an arm by hand.
- **Objects act through motion alone**, through the verbs (`hopTo`, `slideTo`, `lookAt`, `react`,
  `nod`, `shake`, `openHinge`, `closeHinge`, `settle`, `breathe`, `setState`): on screen, an
  `object()` on its own pins; in the world, a `worldObject()`, whose `LENS` entry takes your moves as
  its pose's `segments`. A world thing built from lens solids acts through the poses its `LENS`
  function takes.
- An animal acts through its own `view`, `flip`, `t` and `action` (`animals.js`), never the critter rig.
- When the moment needs a pose, a state or a camera view the world's functions lack, never edit `world.js`:
  end your last message with one line per request, exactly
  `WORLD REQUEST: <pose|state|view> <the entity or place id>: <what the moment needs>`. The scene
  builder adds them, and you are sent back to use them.

## Shots, cuts and carries

- **HARD CONSTRAINT — the blocking.** Your dispatch message gives your frame's slice of
  `assets/world/blocking.json` (per place, each cast member's and story object's position and state
  as your frame starts showing it; `blockingFor()` in `blocking.js` reads it from the file). Stage
  every one of them exactly there, in exactly that state. Depart from it only where a shot in your
  packet says that thing moves or changes, and then only by that move or change, on screen. Never
  edit `blocking.json`: name in your last message any position or state in it that your shots
  cannot be staged from.
- Build the shots your packet lists, in order, each cut on its cue word, each doing what its `why`
  says. With the real timing you may split or merge shots to fit the voice, keeping their subjects
  and their order; a shot you split on one subject changes its size as `minimums.md` § Jump cuts
  says, or cuts to another subject.
- Your first shot follows the previous frame's last shot (`STORYBOARD.md`), and your last shot leads
  into the next frame's first: the cut between them is held to the same jump-cut rule.
- When your first or last shot has `carry: <id> box <x0> <y0> <x1> <y1>`, draw that element in exactly
  that screen box at the cut, through `carry(id, { from: { box: [x0, y0, x1, y1] }, … })`, so it keeps
  its identity and its spot; the frame on the other side of the cut draws it in the same box.

## Frames with a contract of their own

- **Frame 1** writes only `assets/frames/01-hook.js`: the picked hook, under the bank's opener
  (frame.md § The hook module). Its timing file is `assets/timing/01-opener.json`.
- **Frame 3** is code's (the hand-off over the world): nobody builds it.
- **Frame 5** draws the dictionary card over its picture (frame.md § The dictionary card).
- **Frame 8** is code's: nobody builds it.

## New objects

A thing the world, `OBJECTS` and the bank lack: draw it new, as specifically as a stranger would name
it, its signature parts drawn. Through the camera, a function in your module returns `{ id, at, svg }`
from lens solids, joined to `render()`'s items; on the isometric camera or in a flat frame, a
`NEW_PROPS` entry in `assets/frames/<frame id>.props.js`, drawn with `propFrom()` (frame.md § The
frame module).
