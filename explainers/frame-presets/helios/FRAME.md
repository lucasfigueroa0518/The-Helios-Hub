---
version: helios-explainer-v14
name: Helios — Explainer Reel tools (Explainers 4.3)
description: >
  The tools layer of a Helios Explainer Reel: the frame and its safe area, the palette tokens and type
  styles the kit resolves, the world kit's API (what it builds and how to call it), and the build
  checks code runs. No taste: craft.md teaches how to choose, house-style.md holds what Helios has
  chosen, minimums.md what every reel must contain. Decisions: planning/Explainer Reels/DECISIONS.md;
  visual system 6: planning/Explainer Reels/VISUAL_SYSTEM_6.md.
unit: the frame — 1080×1920 (9:16); every scene is SVG in frame pixels, every world entity placed in centimetres

colors:
  paper: "#F3F0EA"
  paper-lit: "#FBFAF6"
  paper-shade: "#E2DACB"
  paper-dark: "#CFC5B3"
  paper-sweep: "#EFE9DF"
  canvas: "#FFFFFF"
  ink: "#171717"
  ink-lit: "#2B2926"
  ink-shade: "#101010"
  ink-dark: "#0A0A0A"
  text-secondary: "#525252"
  text-tertiary: "#737373"
  orange: "#FF5E1A"
  orange-lit: "#FF9462"
  orange-shade: "#E24213"
  orange-dark: "#A02B02"
  orange-text: "#CC4E19"
  green: "#138510"
  green-lit: "#5D9831"
  green-shade: "#036A29"
  green-dark: "#013D1F"
  yellow: "#E0AB3E"
  yellow-lit: "#F3C65E"
  yellow-shade: "#C38F29"
  yellow-dark: "#8F6418"
  blue: "#6684B0"
  blue-lit: "#86A1C8"
  blue-shade: "#4F6B94"
  blue-dark: "#34496A"
  teal: "#46978F"
  teal-lit: "#5DB5AE"
  teal-shade: "#357A74"
  teal-dark: "#24534F"
  lilac: "#6684B0"
  lilac-lit: "#86A1C8"
  lilac-shade: "#4F6B94"
  lilac-dark: "#34496A"
  red: "#B4473A"
  red-lit: "#D27665"
  red-shade: "#91372D"
  red-dark: "#5F231C"
  slate: "#6684B0"
  slate-lit: "#86A1C8"
  slate-shade: "#4F6B94"
  slate-dark: "#34496A"
  mustard: "#E0AB3E"
  mustard-lit: "#F3C65E"
  mustard-shade: "#C38F29"
  mustard-dark: "#8F6418"
  wood: "#9A7250"
  wood-lit: "#B48A62"
  wood-shade: "#7E5B3E"
  wood-dark: "#5E432D"
  leaf: "#5F8F48"
  leaf-lit: "#7FAE62"
  leaf-shade: "#4A7438"
  leaf-dark: "#355428"
  wall: "#F1E9DA"
  wainscot: "#E4D8C3"
  trim: "#CDBFA6"
  floor: "#E2DACB"
  board: "#D3C9B6"
  window: "#BFD3EC"
  white: "#FFFFFF"
  stage-top: "#161616"
  stage-bottom: "#0B0B0B"
  stage-orange: "#FF6A2A"
  stage-red: "#E8413B"
  sun-top: "#FDC60F"
  sun-mid: "#F48C3F"
  sun-bottom: "#EA3C3A"
  shadow-warm: "#3B2A16"
  night: "#171717"
  status-error: "#E5484D"
  status-success: "#30C463"
  status-warning: "#F5B014"
  status-info: "#3E8BF0"

typography:
  display:      { fontFamily: "Pragmatica Extended", px: 74, weight: 700, lineHeight: 1.05, tracking: "-0.02em", lower: true, color: "ink" }
  title:        { fontFamily: "Pragmatica Extended", px: 50, weight: 700, lineHeight: 1.1, tracking: "-0.01em", lower: true, color: "ink" }
  figure:       { fontFamily: "Pragmatica Extended", px: 64, weight: 700, lineHeight: 1.0, tracking: "-0.02em", color: "ink" }
  label:        { fontFamily: "Pragmatica Extended", px: 34, weight: 700, lineHeight: 1.1, color: "ink" }
  body:         { fontFamily: "Roboto", px: 34, weight: 500, lineHeight: 1.2, color: "ink" }
  dimension:    { fontFamily: "Roboto", px: 30, weight: 700, tracking: "0.18em", upper: true, color: "green" }

spacing:
  safe-x0: "96px"
  safe-x1: "940px"
  safe-y0: "570px"
  safe-y1: "1600px"
  ig-header: "250px"
  caption-band-top: "250px"
  caption-band-height: "320px"
  ig-bottom: "320px"
  ig-buttons: "x 940px–1080px"
---

# Helios — Explainer Reel tools (Explainers 4.3)

This file is the tools layer: the frame and its safe area, the palette and type the kit resolves,
the world kit's API (what it builds and how to call it) and the build checks code runs. It holds no
taste and says nothing about when to use a tool: how to choose is `craft.md`, the choices Helios has
made are `house-style.md`, and what every reel must contain is `minimums.md` (all three in
`.media/recipes/helios-explainer/`). Every name below exists in `assets/kit/`. Read a module's
header comment before you use it, and a function's doc comment when you call it; never its
internals.

## What the kit builds

The short list a planner needs (the director and the scene builder plan with it; builders read the
sections below for the calls):

- **Places:** interiors of any kind (walls with doors and windows and what lies beyond them,
  counters, shelving, desks, chairs, beds, curtains, signs, lamps, small dressing) and seven exteriors
  (street, shopfront, park, road, plaza, rooftop, dock). A trip between two places is a cut to the
  destination, or a travelling shot along a path. § Places.
- **Moods:** day, evening, night and dark, per frame, in a colour script; lamps, windows, screens and
  signs as practical lights; light that moves (a wedge through a door, a glint, a glow, a level
  change). § Light and mood.
- **Critters:** critter D in four bodies, each in one of the kit's roles (a head piece and a hand
  prop) or bare; seen from the front or the back; acting by intent (reach, point, hold, carry,
  inspect, look at, recoil, walk, gestures) with a pose for every mood; props held in a hand.
  § Critters, § Roles.
- **The analogy room:** a front-on room on the `room` ground, flat, with the drawn library's
  animals and organic things and a dusk room for dark beats. § The analogy room.
- **Objects:** 18 real things with states and one accent part (laptop, phone, tablet, screen, server,
  rack, chip, database, router, cloud, document, folder, envelope, box, key, lock, card, speaker); an
  element that travels between them (a request, a packet, a file, a message, or any object, small);
  objects that act through motion alone (hop, slide, tilt toward, react, nod, shake, open, close,
  settle, breathe, change state), on screen or standing in the world through the camera, so an object
  can be the hero. Never a face on an object. § Objects and the courier.
- **The mechanism's other tools:** flows, queues, splits and merges, copies, comparisons side by side,
  meters, counters and timers, transformations, structures and timelines, real screens and documents,
  and an optional step tracker. § Mechanism primitives.
- **Cameras:** wide, medium, close and insert shots, each with at most one move (a push, a pull, a
  pan, a follow or a track) and blur only for a named reason; an isometric overview; a magnifier on a
  small thing. § Cameras and shots.
- **Carries:** an element held at one screen box across a cut, optionally changing from the world's
  look to the mechanism's (or back). The box is in frame pixels inside the safe area (§ The frame).
  § Carry.
- **Sound:** a foley library led by paper, pen and writing, plus impacts, whooshes, pops, ticks, clicks
  and stings; the music bed is chosen by code. § Sound events.

## The frame

- 1080×1920 (9:16). Every scene is one SVG string in frame pixels; every world thing is placed in
  centimetres (x right, y away from the camera, z up).
- **Keep-outs** (Instagram, measured in the app): y 0–250 (the Reels header), y 250–570 (the caption
  band), y 1600–1920 (the username, caption and audio line), x 940–1080 (the action buttons).
- **Safe area:** x 96–940, y 570–1600 (`SAFE` in `explain.js`, `lens.js` and `layout.js`). Text a
  viewer reads, and every subject, lands and holds inside it; the world may run full-bleed behind the
  keep-outs. `framingProblems` (lens.js), `placeInSafe(part)`, `fitToSafe(box)` and
  `safeProblems(boxes)` (explain.js) measure it; `layout.js` places into it (§ Solids, labels and
  drawing: placed text).

## Colours

The palette is the frontmatter's `colors:`, held by the kit as `T` (`draw.js`) and `TOKENS`
(`core.js`). Every hue but the status colours is a ramp: `-lit`, base, `-shade`, `-dark`. Every
colour a scene draws is a token, a mix of exactly two (`{ mix: [a, b, k] }`), or a gradient the kit
draws from them, at any opacity. `resolveTone(name)` and `toneHex(name)` (`core.js`) resolve a token
or ramp name (`toneNames()` lists them; `TONE_ALIASES` reads `white` as `canvas`); `set.js` `tone()`
also takes a `MATERIALS` name. An unknown name throws with the allowed list; a scene never writes a
hex of its own.

The families (visual system 6, `planning/Explainer Reels/VISUAL_SYSTEM_6.md` § 2): `slate` (systems)
and `mustard` (data and key objects) carry the same values as the older names `blue` and `yellow`,
which still draw; `lilac` is retired and draws in the slate values; `teal` is the payoff, `red` small
accents, `wood` furniture, `leaf` plants; `wall`, `wainscot`, `trim`, `floor`, `board`, `window` and
`white` are single room tones. Which family goes on what is `house-style.md` § Palette and orange.

## Type

- Pragmatica Extended ships Bold (700) only; Roboto ships 300, 400, 500 and 700 (§ Font loading).
  The frontmatter's `typography:` styles are the sizes the kit uses.
- The smallest text a viewer must read: `MIN_TEXT` 30px (`glass.js`) anywhere, `READ_MIN` 34px
  (`explain.js`) in a flat frame. `contrast(a, b)` (`glass.js`) measures a colour pair.
- Text inside a shape goes through `textBox(text, x, y, { kind, size, maxW, focal, progress, scale })`
  (`cards.js`, `BOX_KINDS`: speech, chat, note, sign, screen) or a primitive that measures it.
- **HARD CONSTRAINT — a line of text in a window (a calculator's display, a counter, a scoreboard, a
  device's screen line) is `readout(text, { x, y, w, h }, { fitTo, chars, align, fill })` (`cards.js`),
  never an `el('text')` at a size you picked:** it sizes the line to fit the window with a margin,
  `fitTo` lists every text the window will show (the typed sum and its result) so all share one
  size, and `chars` types it in place. It works in a prop's own units (cm on a face).
  `handwrite(text, x, y, size, progress, { color, weight, align })` (`draw.js`) writes strokes in
  order. Set text added outside `setBuilder` is wrapped with `set(svg)` (`lens.js`).

## Grounds

`GROUNDS` (`core.js`): `paper` (the studio sweep, its key light top right), `stage` (the premium lit
stage), `room` (the analogy frames' ground: clean paper with the faint 72 px drafting grid, no grain,
§ The analogy room) and `white` (the close). No ground draws grain. `night` and `forest` are read as `stage` (`GROUND_ALIASES`). A frame
module's `ground` equals its storyboard `ground:`, and `scope(prefix, ground)` (`draw.js`) sets it.
A mood carries its ground: `mood(name).ground` is `paper` for day and evening and `stage` for night
and dark, so a frame's `ground:` is the one its mood in the colour script gives; an analogy frame
(the anchor scene's `look: world` frames that stage the analogy) is `room` in every mood (its dark
beat is the dusk room, § The analogy room). Blend, mechanism and real-example frames keep `paper` or
`stage`.

## The frame module

A frame is `assets/frames/<frame id>.js` (the frame id is the basename of its storyboard `src`):
an ES module that imports only from `../kit/*.js`, `../world/world.js` and `../world/identity.js` and
default-exports `{ ground, shots, draw(t) }`, with `shots` also a named export (a one-shot frame may
omit it). `draw(t)` is a pure function of frame time: no unseeded randomness, no clocks, no state
between calls, no DOM, no file reads. It calls `scope('f<NN>-', ground)` first (NN = the frame
number, two digits) and returns one SVG string. `mount.mjs` writes `compositions/frames/<frame
id>.html` around it.

A frame in the world, through the camera:

```js
import { scope } from '../kit/draw.js';
import { rig, render, labelFor } from '../kit/lens.js';
import { shotFrame } from '../kit/shots.js';
import { ROOM, LENS, LIGHTS, COLOUR_SCRIPT } from '../world/world.js';

const GROUND = 'paper';   // the storyboard's ground:
const NAMED_AT = 3.1;     // "<the word>" (copied from the timing file)
export const shots = [ /* camera shots, § Cameras and shots */ ];

export default {
  ground: GROUND,
  shots,
  draw(t) {
    scope('f04-', GROUND);
    const state = { /* this moment's values, from STATES */ };
    return shotFrame(t, shots, (shot, local, i, { P }) => {
      const R = rig(P, { ground: GROUND, mood: COLOUR_SCRIPT.at(4).light, ...LIGHTS(state, shot.place) });
      const set = ROOM(P, R, state, shot.place);
      const cast = Object.entries(LENS).map(([id, draw]) => draw(P, R, state, poseOf(id, t, shot)));
      return [render(P, { env: set.env, items: [...set.items, ...cast], shot, local }) + labelsOf(P, shot, t)];
    });
  },
};
```

`poseOf` and `labelsOf` are the frame's own: each entity's pose for the moment, and the shot's
`labelFor(...)` labels. A flat frame returns its parts from `shotFrame` with crop shots, or from
`frame(t, { camera }, parts)` (`motion.js`) with one framing, starting with `glassGround()`.

- **New objects:** through the camera, a function in the module returning `{ id, at, svg }` from lens
  solids, joined to `render()`'s items; on the isometric camera or in a flat frame, `NEW_PROPS` in
  `assets/frames/<frame id>.props.js` (each with its tags: `is`, `setting`, `material`, `parts`,
  `not`), drawn with `propFrom(NEW_PROPS, name, x, y, { s, state, focal, flip })` (`props.js`).
- **Events:** `assets/frames/<frame id>.events.json`, § Sound events.

### The opener (frame 1)
Frame 1 is code's: its storyboard `src` is `01-opener`, and code writes `01-opener.js` (the opener
named in `assets/opener.json`) and `01-hook.js` (the AI 101 card it lands on). Nobody builds frame 1.

### The hand-off (frame 3)
Code writes `03-handoff.js` and its events from `assets/handoff.json` (the job's pick from the
hand-off bank, `handoff-bank.js`): `handoffFrame()` (`handoff.js`) draws the card "today's AI
Lesson: <term>", which appears with its first words, over frame 4's first shot (frame 4's own
`draw(0)`: its camera, place and object states), so the cut into frame 4 continues the picture; it
renders the storyboard's `handoff_parts:` (`LENS` ids) on their own. Code rewrites `03-handoff.js`
once frame 4 is built. Nobody builds frame 3. Without a frame 4 it draws the world's first `VIEWS`
camera, and a world that cannot be drawn leaves the card alone on its ground.

### The dictionary card (frame 5)
`dictionaryCard(t, { headword, pos, words })` (`cards.js`): `headword` the term, `pos` the
`part_of_speech:`, `words` the word times of the `definition:` (the voiceover's first words; the rest
of the line plays under the card). Draw it after the frame's picture; it returns `{ svg, bottom }`, and the picture below it uses `bottom` + 40 px to
y 1600. It writes its first word as it appears, on an opaque plate. **HARD CONSTRAINT:** the card sits
in a clear zone: its `y` is `clearZone(objectBoxes, cardHeight)` (`layout.js`, the boxes of the
shot's objects), and no object is under it.

### The close (frame 8) and the 1→2 cut
`close.js` is the close, written by `pace.mjs`; nobody builds frame 8. The hit on the 1→2 cut is
placed by `opener-sfx.mjs`.

## Timing

`assets/timing/<frame id>.json`, written by `pace.mjs`: `{ frame, id, duration, voice_end, hold,
words: [{ text, start, end }] }`, in frame seconds. The module never reads it: copy the times you need
into constants.

## Cameras and shots

- **The camera** (`lens.js`): `lens({ pos, target, fov, roll })` → `P(x, y, z)` = `[sx, sy, depth]`,
  with `P.scaleAt(x, y, z)` and `P.dist(x, y, z)`. `worldAt(P, sx, sy, z)` is its inverse (it throws
  above the horizon). `rig(P, { mood, ground, ambient, key, dirs, points })` lights a shot;
  `render(P, { env, items, focus, shot, local })` draws the environment, then the items far to near.
  `insertCamera(target, { size, fill, dist, deg, elev, fov, at })` frames one small thing: `size` is its
  extent in cm (a number or `[w, d, h]`), and the camera fits and centres that box inside the safe area.
- **A camera shot** (`shots.js`): `{ at, kind, camera: { pos, target, fov }, subject, cast, place?,
  move?, focus? }`. `SHOT_KINDS`: `wide`, `medium`, `close`, `insert` (and `reaction`).
  `move` is one of `SHOT_MOVES` (`push` and `pull` by cm, `pan` by degrees, `follow` and `track` by
  cm), with optional `at`, `dur` and `e`; `focus` names one of `FOCUS_REASONS` (`insert`, `reveal`,
  `rack` with `on`, `to`, `at`, `dur`); without one, `render()` draws everything sharp.
  `shotFrame(t, shots, (shot, local, i, { P }) => parts)` draws the frame under its shot list;
  `shotAt(t, shots)` and `shotLensAt(shot, local, length)` give the shot and its camera at a moment.
  `inShot(shot, id)` and `castItems(shot, items)` keep a shot to its `cast`.
- **The kit frames each camera shot for you** (`scene-fit.js`, applied to the render and the try
  alike): state the shot's `kind` and `subject`, and the kit fits the camera so the subject is whole
  inside the safe area (x 96–940, y 570–1600) at its kind's size (it slides the picture, or aims at
  the subject and dollies), turns it around the subject (15–45°, or higher) when a nearer thing
  hides it, and moves a thing that would appear within 0.3 s after a cut to the cut itself. Aim the
  camera roughly; do not hand-tune offsets. `fit: false` (or `fit: { orbit: false }`, `fit: {
  frame: false }`) keeps your angle and size, but a subject over the safe area's edge is still
  backed off or slid whole inside it, without cutting a face; a cut opts out with `popIn: false`.
  A close or an insert focuses on its subject unless it says `focus` (`focus: false` keeps it all
  sharp): what lies behind goes soft, so a sign on the wall never fights the captions.
- **HARD CONSTRAINT — a critter stays in its place:** a critter a shot of a place casts is in the
  cast of every later shot of that place until a shot lists it in `away: [<id>]` (it left on
  screen); `shotFrame` keeps it drawn whatever a cast says (an object an earlier shot cast too), so
  the camera, not the cast, decides what shows. In an insert or a close it reads one way: whole, or as a glimpse of its body at the
  frame's edge with the set hiding its legs and its head out of frame; never cut through the face.
- **HARD CONSTRAINT — the locked set** (`setlock.js`): every camera shot of a place draws that
  place's whole `DRESSING`: `render()` adds any piece you did not pass, at its declared spot and state.
  Call `dressedItems(world, place, P, R, { t, states, poses })` only to change a piece's state or pose;
  `undress: [<id>]` on a shot leaves a piece out there (rare). A shot changes a dressing object's state (`states[id]`: open, lit,
  plugged) or pose, never adds or drops one; a `STORY` object enters or leaves inside a shot, on screen.
- **HARD CONSTRAINT — the fill:** in every frame the subject covers about 25–50% of the frame. A lone
  small object on an empty ground never holds for more than 1 s: bring the camera in, or show the
  subject with what it acts on (`fill`).
- **HARD CONSTRAINT — a close shows a relationship:** a `close` or `insert` shows at least two related
  things, or the subject together with what it acts on; never one label, number or text alone (`close`).
- **HARD CONSTRAINT — nothing is glimpsed:** every thing the viewer sees (a critter, an object, an
  icon, a card) stays on screen at least 1.2 s, its first look included: a thing that turns into another
  shows its first form for 1.2 s before the change. Show it long enough to read, or leave it out (`brief`).
- **A crop shot** (flat frames): `{ at, kind, on: [x, y], zoom?, push?, picture? }`, `on` the
  subject's point in the drawing at zoom 1, placed at `SUBJECT_AT` (x 518, y 1085); `push` ≤ 1.2.
  A shot that draws its own composition (each shot laid out for its own frame) names it with
  `picture: '<name>'`: a cut to another picture is a cut to a new subject. Shots that reframe one
  drawing share a `picture` (or none).
- **The cut rule is the kit's** (`snapCuts`, applied by `shotFrame`): on the same picture or subject
  a cut goes in to at least 2× or out to at most ½. Declare each shot's kind and the size it is
  composed for; when a cut is short of 2×, the kit pulls the wider shot of the two back (a crop's zoom,
  never below 1; a camera along its line to the subject, the angle kept), and the tighter shot keeps
  your size. A cut it cannot fix that way (two zooms near 1) is reported: name each composition with
  `picture`, or compose the close for a real close (at least 2× the shot before it).
- **The isometric camera** (`space.js`): `scene({ ppcm, origin, P })`, `plane(at, origin, u, v)`,
  `depthSort(items)`; no parallax and no focus (`frame()` throws on them).
- **Seams** (`seams.js`): `zoomThrough(t, dur, { at, to })` on an outgoing frame's last moments and
  `zoomThroughIn(t, { at, from })` on the incoming frame's first; `whipOut`, `whipIn`. The assembly
  joins frames by cut; a transition is built inside the two frames.

## The world module

`assets/world/world.js` (written by the scene builder) imports only from `../kit/*.js` and
`./new-props.js`, and exports:

| Export | Shape |
|---|---|
| `SET` | the first place's brief, `setBuilder`'s `SET` (§ Places) |
| `SETS` | `{ <place id>: <its brief> }`, every other place (an exterior's brief names its `exterior` kind) |
| `ROOM(P, R, state, place = 'main')` | that place built through `P`: `{ env, items, meta, lights, apertures }` |
| `LIGHTS(state, place = 'main')` | `{ dirs, points, ambient?, key? }`: that place's lights at that state |
| `COLOUR_SCRIPT` | `colourScript({ … })`, the reel's moods by frame (§ Light and mood) |
| `VIEWS` | `[{ pos, target, fov, place? }]`, the cameras `snap.mjs world` renders (not `cast.js`'s critter `VIEWS`) |
| `fit(camera, place = 'main')` | the camera fitted under that place's ceiling (`fitCeiling`) |
| `LENS` | `{ <entity id>: (P, R, state, pose) => ({ id, at, svg }) }`; `''` when off stage |
| `DRESSING` | `{ <place id>: [{ id, at, state? }] }`: each place's set dressing, declared once (`LENS` or `OBJ` ids) |
| `STORY` | `[<id>]`: the objects that enter or leave on screen (never in `DRESSING`) |
| `CAST` | `{ <critter id>: { body, role, view } }` (`role` a `ROLES` name or `'bare'`; an older `outfit` is read as a role, § Roles) |
| `LAYOUT` | `{ <entity id>: { at: [x, y, z], face? } }`; a thing a critter handles sits within reach of its spot (`reachProblems`, § Critters) |
| `SIZES` | `{ <entity id>: { w, d, h, scale? } }` in cm; `scale` is `'cheat'` or a factor |
| `ENTITIES` | `{ <entity id>: '<the real part it stands for>' }` |
| `STATES` | each variable's start value and its value at the end of each beat |
| `STEPS` | `[{ analogy, technical }]`, in order |

`assets/world/identity.js` default-exports `identity({ <conceptId>: { icon?, color?, shape?, label?,
object?, tone? } })` (`explain.js`), one entry per concept, each in one or both forms:

- **the real thing:** `object`, an `OBJECTS` id, and `tone`, its body tone (it defaults to `color`
  when given, else the object's own tone);
- **a diagram marker:** `icon` (a `UI_ICONS` name), `color` (one of `CONCEPT_COLORS`) and `shape` (one
  of `SHAPES`: tile, disc, doc, chip).

An entry needs an object or an icon; with both, the concept wears one colour (a tone of another colour
throws). No concept is orange: an orange `color` or `tone` throws, and a default colour is never
orange. It returns the registry `reg` (§ Mechanism primitives). A mapped concept is drawn only through `reg` (its drawings carry the map's `data-concept` tag); a freehand drawing of it is a second look. Isometric drawings of the world
(`ROOM_ISO`, `SUBJECTS`, `DRAWN`) are exported only when a frame uses the isometric camera.

## Places

- **An interior:** `setBuilder(P, R, SET)` (`set.js`), its brief
  `{ place, tells, architecture, materials, colorStory, layers, beyond, density }`
  (`setBriefProblems(SET)` names any unknown name). Its methods draw in world cm through `P` and file
  each piece as architecture or as an item sorted with the cast; each takes `tell` and `layer`:

  | Method | What it builds (options) |
  |---|---|
  | `.room({ x, y, h, walls, floor, wall, ceiling, enclose, skirting, dado, cornice })` | the shell: floor `x [x0, x1]` × `y [y0, y1]`; `walls` from back, left, right, front; `ceiling` one of `CEILING_STYLES`; `enclose: 'auto'` closes a side a camera inside looks at |
  | `.wall({ a, b, h, mat, openings, dado, skirting, trim, cornice })` | one wall from floor point `a` to `b`; `openings: [{ kind, at, w, z0, z1, beyond }]`, `kind` one of `OPENING_KINDS` |
  | `.beyond(svg, at, { tell, clip })` | a piece seen only through an opening; an opening's `beyond` takes `{ kind, sky, ground, dist, volumes, custom }` |
  | `.surface(pts, mat, { part })` | a flat world quad in a material |
  | `.run({ at, facing, len, depth, h, body, top, doors, drawers, inserts, upper })` | a counter or cabinet run; `h: 'critter'` is `CRITTER_COUNTER_CM` |
  | `.shelving({ at, facing, len, depth, h, bay, levels, contents, density })` | shelves and their contents |
  | `.desk`, `.chair`, `.bed`, `.drape`, `.sign`, `.lamp`, `.beam`, `.solid` | furniture, curtains, wall signs and screens, lamps (`.lamp` returns its point light), overhead runs, plain solids |
  | `.dress({ area, kinds, density, palette, seed })`, `.thing(kind, at, tone)` | small things of `DRESS_KINDS` at a `DENSITY` |
  | `.foreground(svg, at)`, `.piece(svg, at, { tell })` | a near framing piece; a custom piece from lens solids |
  | `.done()` | `{ env, items, meta, lights, apertures }` |

  A fixture's `at` is its front-left floor corner seen from the front. `MATERIALS` and
  `OPENING_KINDS` list the names. `ceilingShare(P, room)` measures a camera's ceiling, and
  `fitCeiling(camera, room)` lowers its aim to fit.
- **An exterior:** `exterior(P, R, kind, { mood, seed, palette, accent, signs, lamps, far, clouds,
  density, x, depth })` (`set.js`), or `.exterior(kind, opts)` inside `setBuilder` (a brief names it
  as `exterior: <kind>`); `kind` is one of `EXTERIOR_KINDS` (street, shopfront, park, road, plaza,
  rooftop, dock; `EXTERIOR_ABOUT` says what each holds). It returns `{ kind, env, items, lights,
  tells, spots, lanes, horizon, mood }`: `spots` are named world points to stage things on, and
  `lanes.walk` and `lanes.drive` are paths a traveller can take. Extras (a crowd, passers-by, a pet)
  stand on spots or lanes beside the critters in the shot's view, never behind them: a thing mostly
  hidden by a nearer critter reads as stacked on it, and the check flags it. A group drawer returns
  `{ parts: [...] }` (one entry per member) so each member sorts by its own depth.
- **A journey:** `journey(from, to, { by, at, dur, traveller, cast, side, dist, height, fov, camera,
  arrive, via })` (`shots.js`). `from` and `to` are places: a `SETS` id, or `{ id, at, door?, path?,
  camera? }` in world cm. `by: 'cut'` is two shots, out of `from` and a hard cut to a wide of `to`;
  `by: 'travel'` is a travelling shot along `path` (an exterior's `lanes.walk`), the camera `'side'`
  (a follow) or `'behind'` (a track), with `arrive: true` adding the cut to `to`. It returns
  `{ by, shots, at(t), cutAt, end, dir, path }`: camera shots to put in the frame's list, and where the
  traveller is at frame time `t` (`{ place, pos, heading, flip, view, walking, u }`).

## The analogy room

The analogy frames' tools (`house-style.md` § The analogy frame says when):

- `frontCamera({ back, eye, dist, fov, horizon, x })` (`set.js`): the level, front-on camera, its
  vanishing point centred.
- `frontRoom(P, R, { back, x, near, h, wainscot, boards, windows, rug, pendants, mood })` (`set.js`)
  → `{ env }`: the back wall, wainscot, skirting and perspective floor in the room tones, flat.
  `mood` is `day` or `dusk` (the dark beat: slate walls, lamps lit, windows dark); without it the
  rig's mood name is used. `roomMood(name)` (`analogy.js`) gives that mood's room tones.
- `pillSvg(text, x, y, { kind, size, who })` (`analogy.js`): a Helios label pill, `kind` `white` (a
  name), `ink` (the contrast case) or `green` (a status).
- **Drawn subjects** (`drawn.js`, the library in `subjects/`, listed by `SUBJECTS`): every animal and
  organic thing the kit ships, jointed where it moves, flat. `drawnSvg(spec, o)` (a study cell),
  `drawn(spec, x, y, o)` (on screen, base at `(x, y)`) and `drawnAt(P, spec, wx, wy, wz, o)` (a
  `render()` item in the world); `spec` is a spec or a library name (`subject(name)`); `o` takes the
  view, the pose, the state, `flip` and the scale. A small subject is cheated up so it reads. A
  subject the library lacks is a new spec in the same shape (`drawn.js`), exported from the props
  file that uses it.

## Light and mood

- **Moods** (`light.js`): `mood(name, over)` resolves one of `MOOD_NAMES` (day, evening, night,
  dark) into its key, rim, sky, haze, ground and practicals; `rig(P, { mood })` lights a shot with it.
  `colourScript(spec)` holds the reel's plan: `spec` maps frame numbers to a mood name or
  `{ mood, palette, accent, note }`; a frame not named holds the one before. It returns
  `{ frames, at(n), problems, strip(box) }`, where `at(n).light` is that frame's resolved mood.
  `hazed(hex, distCm, mood)` fades a far thing into the haze.
- **Lights** in a shot's rig: `dirs` (directional) and `points: [{ pos, level, reach, color,
  aperture }]`, `aperture` an opening's four world corners in cm; `ambient` and `key` lift or dim.
- **Light that moves:** `lightWedge({ from, to, level, color })`, `rim(shape, { side, color })`,
  `glow(cx, cy, r, { color, level })`, `glint(clipD, u)`, `glowSign(text, x, y, { color })`,
  `level(t, keys)`, `spill(P, light)`, `veil(svg, { level, color })`, `wash(svg, { color, level })`;
  a light's `color` is `warm`, `hot`, `cool` or a token.

## Critters

`critter(x, y, options)` (`cast.js`), or through the camera `critterAt(P, x, y, z, options, R)` →
`{ svg, s, feet, at, dist }`. The kit draws critter D: a flat tile body, white eyes with plain ink
pupils and lids in the body colour, ink stub arms with mitten ends, ink legs, and the floor shadow.
Options:

- `body`: one of `BODIES`: `orange` (the hero), `green`, `ink`, `white` (`paper` draws as `white`; an
  unknown body throws).
- `role`, `head`, `hand`, `bowtie`: what it wears and holds (§ Roles). An `outfit` (or `WEAR`) is
  accepted and read as the role it matches, else bare; no garment is drawn on the body.
- `view`: one of `VIEWS` (`front`, `back`); the back view has no eyes. `side` one of `SIDES` for a
  back view.
- `who`: its world id.
- The pose, from `act` or `actAt` (below), and `mood`: one of `MOODS`. A mood sets the lids, the
  pupils and the tilt; `mouth` and `brows` are accepted and ignored. Its idle and mood loops (blink,
  glance, a lid switch) hold and snap.

**Acting through the rig:** `act({ gesture, reach, point, hand, hands, hold, carry, inspect, lookAt,
recoil, effort, lean, walk, mood }, frame)` → a pose, where `frame = { x, y, s, flip }` (the feet on
screen, the scale, the facing), targets are screen points, `gesture` is one of `GESTURES` and `hold`
is a `PROPS` name, `{ kind, color }` or a custom `{ draw, box, upright, follow, grips }`.
`actAt(t, keys, frame)` performs a list of `{ at, blend?, …intent }` over time.
`blendRig(a, b, u)` mixes two poses; `heldScale(propCm, drawnPx, cheat)` sizes a held prop;
`gripAt(x, y, options, side)` and `heldProp(x, y, options)` give a held prop as its own layer.
`riggedProblems(options)` names a broken rig (`critter()` writes it as `data-rig`). The rig solves
the arm angles; critter D draws its stub arms at them.

**Hands on things** (`cast.js`, world cm, keys for a world actor's `pose.keys`): D's stub arm is
short (`REACH_CM`: side, up, depth from its feet); a hand sent further stops short.
`reachProblems(standAt, target)` says why a critter cannot touch a point, and `reachSpot(target, { hand })`
is where its feet go so it can.

- **HARD CONSTRAINT — a placed thing rides in the hand:** a critter that puts something somewhere
  uses `handPlace({ hold, to, at, dur, hand, standAt, grip })` → `{ keys, release, thingAt(t) }`:
  the arm reaches `to` with the thing held, lets go there, and the thing is drawn only at
  `thingAt(t)` (null while in the hand). When `to` is out of reach, the same call tosses it: the
  arm swings toward `to`, lets go at the end of its reach, and `thingAt(t)` flies it there on an
  arc (`lands` is when it arrives). Never move a placed thing on its own.
- **HARD CONSTRAINT — marks grow under a tool:** a critter that writes or draws uses
  `handWrite({ from, to, at, dur, tool, hand, standAt })` → `{ keys, u(t), tipAt(t) }`: `u(t)`
  drives the marks (from `from` to `to`), `keys` keep the held tool's point on their growing end,
  and a world tool in an insert sits at `tipAt(t)`. Marks never grow with no tool on them, and the
  tool is the same one in every shot.

**The acting track:** `actingAt(t, track)` → the pose at time t of a performance, a list of beats
`{ at, emotion, intensity?, blend?, hold?, look?, pose?, accent?, state? }`: `emotion` is a `MOODS`
or `D.MOODS` name, `pose` a `D.ARM_POSES` name or `[left, right]`, `accent` a `D.ACCENTS` name (a
gesture, eye behaviour or body move that plays once). A feeling persists until the next beat; changes
blend; a seeded life layer (blinks, glances, breath) runs underneath. Spread the pose into
`critter()` or pass it as `act({ acting })`. `actingProblems(track)` flags emote spam (short holds,
too many changes, accents over the cap); keep it empty.

## Roles

`wear.js`:

- `HEADS`: `toque`, `hardhat`, `nursecap`, `cap`, `beanie`, `gradcap`, `beret`, `fedora`, `sunhat`,
  `headphones`, `glasses`.
- `HANDS`: `cup`, `briefcase`, `book`, `palette`, `tray`, `football`, `docbag`, `magnifier`,
  `envelope`, `wateringcan`, `flask`, `camera`. The kit draws each one held: `cup`, `book`, `flask`,
  `camera` and `football` in front of the mitten (`FRONT`), the rest gripped by a handle or an edge
  (`GRIP`).
- `ROLES`: role name → `{ head?, hand?, bowtie?, headTone? }`, the kit's 17 named roles. A critter
  takes one of them, or `'bare'`:
  chef (toque) · builder (hardhat) · nurse (nursecap) · doctor (docbag) · waiter (tray, bow tie) ·
  office worker (briefcase) · developer (headphones) · librarian (glasses, book) · barista (cup) ·
  coach (cap, football) · student (gradcap) · artist (beret, palette) · detective (fedora,
  magnifier) · mail carrier (cap, envelope) · gardener (sunhat, wateringcan) · scientist (glasses,
  flask) · photographer (camera).
- `wearProblems(wear, beats)` → string[]: more than two signifiers, a name outside the lists, or a
  hand prop still held in a beat that uses the hands with no put-down beat before it.
- `wear({ role, head, hand, bowtie, headTone })` resolves a critter's pieces: `role` gives them, an
  explicit piece overrides one, and `hand: null` puts the role's prop down for that beat (a critter
  after its put-down beat is drawn with `hand: null`).

## Objects and the courier

`objects.js`: real things drawn as soft-3D objects, on screen (flat and isometric frames) or standing in
the world through the camera. Objects never get a face: every call throws on a face option
(`FACE_KEYS`).

- `OBJECTS`: id → `{ states, hinge, mass, accent, label }`; `OBJECT_IDS`: laptop, phone, tablet,
  screen, server, rack, chip, database, router, cloud, document, folder, envelope, box, key, lock,
  card, speaker. `OBJECT_CM`: each one's true size in cm.
- **On screen:** `object(id, at, { size, accent, label, state, tone, facing, floor, key, labelSize,
  concept })`: the thing standing with its base centre at screen `at` (`[x, y]`). `size` is a scale
  (1 ≈ 240–340 px wide); `accent` (true or 0..1) turns its accent part orange; `label` is a short
  label on the thing; `state` is one of its `states`; `tone` its body colour (never orange); `facing`
  `'left'` or `'right'`; `floor` the screen y it stands on; `concept` its identity-map concept. It
  returns a handle `{ id, key, at, size, pins, box, pin(name), draw(t, segments), pose(t, segments),
  pinsAt(t, segments) }`; its pins are `PIN_NAMES` (`base`, `center`, `top`, `front`, and `hinge` on
  things that open).
- **In the world, through the camera:** `worldObject(id, [x, y] | [x, y, z], { size, accent, label,
  state, tone, facing, key, labelSize, concept })` stands it at a world point in cm; `size` is against
  its true size (`1`, `'cheat'` to cheat it bigger so it reads, or a factor). `lensObject(P, obj, { t,
  segments, rig })` draws it at frame time `t` as one of `render()`'s items `{ id, at, bounds, svg,
  pins, box, dist }`: in perspective, lit by the shot's rig, with its shadows, its `id` its `key` (a
  shot's cast names it). A world object hero is a `LENS` entry:
  `LENS.hero = (P, R, state, pose) => lensObject(P, HERO, { t: pose.t, segments: pose.segments, rig: R })`.
- `courier(kind, from, to, { at, dur, label, state, startState, arc, keep, arrive, bump, accent, tone,
  size, trail })`: the element that travels on screen. `kind` is one of `COURIER_KINDS` (request,
  packet, file, message) or an object id drawn small; `from` and `to` are screen points, screen objects
  (their `top` pin) or `obj.pin(name)` (in a world frame, points from `lensObject(...).pins`); it rides
  with its bottom on the path, lands in `state` (`'ok'`, `'error'` or the object's own), switches its
  destination to `arrive`, and is absorbed or, with `keep`, stays. `dur` ≥ 0.4s. `accent` defaults to
  `false` (its own colours; `true` makes it orange); `tone` colours a carried object (never orange).
- **Verbs** (`VERBS`), each returning a timeline segment `{ verb, at, dur, end, events }` with
  anticipation, squash and stretch, easing, arcs, overlap and settle built in; on a world object they
  move in cm: `hopTo(obj, to, { at, dur, height })`, `slideTo(obj, to, { at, dur })`,
  `lookAt(obj, target, { at, dur, amount })`, `react(obj, kind, { at, dur })` with `kind` one of
  `REACTIONS` (surprised, proud, worried, no, yes), `nod(obj, { at, times, dur })`,
  `shake(obj, { at, times, dur })`, `openHinge(obj, { at, dur, state })`,
  `closeHinge(obj, { at, dur, state })`, `settle(obj, { at, amount, dur })`,
  `breathe(obj, { at, dur, amount, period })`, `setState(obj, state, { at, sound })`,
  `setAccent(obj, level, { at, dur })`. `hopTo`, `slideTo`, `lookAt`, the hinges, `setState` and
  `setAccent` keep their end state; the others return to rest.
- `play(t, segments, objects)`: every screen object posed at `t`, then the couriers, as one SVG string
  (`objects` lists those with no segment of their own). The frame draws `defs()` (`draw.js`) first.
  `poseAt(obj, t, segments)` gives an object's pose at `t`, `pinsAt(obj, t, segments)` a screen
  object's pins; `soundEvents(segments)` gives the segments' sound events for the events file.
- `objectProblems(samples)`: pins out of frame, an object below its floor, a face on an object.
- **Ports and cables** (`connect.js`): every device has named ports (`OBJECT_PORTS`: a laptop's `usb`,
  `usb2`, `usb_l`, `power`; a router's `eth`, …); `lensObject(…).ports.<name>` and
  `portsAt(obj, t).<name>` give them. **HARD CONSTRAINT:** a cable is always
  `cable(P, a.ports.usb, b.ports.usb, { slack, color, rest })` through the camera (a render() item;
  `rest` is the surface z it lies on) or `screenCable(from, to, { slack, color, rest })` on screen: it
  leaves each port straight, sags with gravity, and draws a plug seated in each port. A thing you
  build with a socket of its own passes `{ at, dir }`. Never draw a cable freehand, and never one that
  ends in mid-air or short of a port.

## Carry

`carry(declaration, { to, morph, at, dur })` (`shots.js`): an element keeps its identity and its spot
on screen across a cut. The storyboard declares the spot on both shots of the cut, as
`carry: <element id> box <x0> <y0> <x1> <y1>` (frame px, inside the safe area), and both builders
pass that declaration (`'<id> box <x0> <y0> <x1> <y1>'`) or `{ from: { box: [x0, y0, x1, y1] } }`, so
they get the same box; `parseCarry(text)` reads it (`{ id, box }`). The spot is never read from the
other frame.

- **In a lens shot:** `to: { P, z, size: [w, d, h] }` returns `to.at` (where the element stands, cm)
  and `to.fit`; draw it through `scaledLens(P, to.at, to.fit)` (`lens.js`) and it lands on the box.
- **In a flat frame:** `draw(local, { world, mechanism })` puts it on the box (each a `(box) => svg`);
  `lensOnto(box, size)` gives a lens `{ P, cam }` that draws a world look on the box.
- `morph` is `'world→mechanism'`, `'mechanism→world'` or `null`, over `dur` seconds from `at` into the
  incoming shot; `mix(local)` gives the two looks' shares. `tag(svg)` marks a drawn element so
  `carriedBoxes(svg)` finds it.
- Inside one frame, `from` may instead be `{ P, at, size }` (a lens shot) or `{ svg, who }` (a drawn
  frame).
- A cut whose shots carry an element, or that changes look, is never a jump cut (`jumpCutProblems`).

## Solids, labels and drawing

- **Lens solids** (`lens.js`): `box(P, at, size, tones, R, opts)` (also `slab`),
  `obox(P, o, U, V, N, tones, R, opts)`, `cylinder(P, at, r, h, tones, R)`, `sphere(P, at, r, tones,
  R)`, `quad(P, pts, fill)`, `faceArt(P, origin, U, V, inner)` (flat art on one side of a solid: a
  screen, a panel, a printed face), `hinge(at, { width, height, along,
  swing, deg })`, `openBox(P, at, size, tones, R, { open, contents })` (its contents stay behind its
  edges). Shadows: `contactShadow(P, footprint)`, `shadowsOf(P, footprint, height, R)`,
  `floorShadow(P, poly)`.
- **Tags:** `entity(P, id, at, size, svg)` marks a world entity for labels, subjects and checks;
  `focal(P, at, size, svg, { name })` marks the beat's focal.
- **Labels:** `labelFor(id, text, { P, shot, at, height, lift, size, u })` anchors a label in world
  space to its entity, hides it when the entity leaves the shot, and keeps it inside the safe area.
- **HARD CONSTRAINT — placed text** (`layout.js`): a word that belongs to a thing is drawn inside
  that thing's group (its page, magnet, screen or chip). Every other text, label, chip, bubble or
  small card is placed by code, never at hand-picked coordinates: `placeText({ w, h }, { near,
  avoid })` gives the spot nearest `near` that keeps `MIN_GAP` off every `avoid` box (the boxes of
  the objects on screen) inside the safe area; `inSafe(box)` moves a box you laid out into it. Inside
  `shotFrame`'s draw both work in the drawing's coordinates under the shot's crop (`viewSafe()` is
  the safe area there), so what they place stays in the safe area at that shot's zoom.
- **Space** (`space.js`): `container({ clip, back, contents, front })` on the isometric camera;
  `magnifier({ from, at, r, zoom, draw })` enlarges one small thing.
- **Drawing** (`draw.js`): `scope`, `el`, `g`, `handwrite`, `shock(x, y, u)`.

## Mechanism primitives

`explain.js` on `glass.js`. Every primitive is a pure function of its arguments and a progress (or a
time) and returns `{ svg, box }`; the primitives refuse to draw an empty container.

- **The registry:** `reg = identity(map)` (`identity.js` exports it). A concept's real thing:
  `reg.object(id, at, { label, …object() options })` on screen, `reg.worldObject(id, [x, y, z], o)` in
  the world (the tone is the map's). Its marker: `reg.node(id, x, y, { size, emph, dim, appear, name })`,
  `reg.chip(id, x, y, { text })`, `reg.icon(id, x, y, size)`; `emph` and `dim` highlight and step back.
  Each form throws on a concept that does not declare it.
- **Flow:** `connector(reg, cid, a, b, opts)`, `travel(reg, cid, points, u, opts)`, `queue(reg, items,
  x, y, opts)`, `fan(reg, cid, paths, u, opts)`, `merge(reg, items, paths, u, opts)`,
  `copyOut(reg, cid, points, u, opts)`.
- **Measure:** `versus({ left, right }, opts)`, `meter(x, y, w, opts)`, `counter(x, y, value, opts)`,
  `stopwatch(cx, cy, r, opts)`, `unitGrid(x, y, count, opts)`, `sizeBars(x, y, w, items, opts)`.
- **Change:** `tokenize(pieces, x, y, w, opts)`, `vectorize(x, y, values, opts)`, `morph(a, b, u,
  opts)`, `matchCut(a, b, u, opts)`, `ripple(cx, cy, u, opts)`, `alarm(svg, cx, cy, u, opts)`.
- **Structure:** `layers(x, y, w, items, opts)`, `graph(reg, nodes, edges, opts)`, `pointMap(x, y, w,
  h, points, opts)`, `timeline(x, y, w, events, opts)`.
- **Screens and documents:** `appWindow(x, y, w, h, opts)`, `docPage(x, y, w, opts)`,
  `fileList(reg, x, y, w, files, opts)`, `resultsList(x, y, w, results, opts)`, `terminal(x, y, w,
  lines, opts)`, `thread(rect, messages, opts)`.
- **Glass** (`glass.js`): `glassGround()` (drawn once, in screen space, before `shotFrame(...)`),
  `phone(x, y, { w, h, title, messages, children })`, `chatBubble(text, x, y, { from, maxW, progress,
  typing })`, `glossTile(x, y, size, { icon, color })`, `pill(text, x, y, { dot, color })`,
  `route(points, { color, progress, glow, dashed })`, `packet(points, u, { color, trail })`,
  `uiIcon(name, x, y, size, { color })`, `glassCard(x, y, w, h, opts)`,
  `stepTracker(steps, current, x, y, { axis, gap, size, maxW, lit, appear })` (drawn in screen space
  after `shotFrame(...)`).
- **HARD CONSTRAINT — UI spacing** (`layout.js`): icons, numbers and buttons placed side by side or
  stacked by hand are laid out with `row(items, { x, y, width, align })` or `column(items, { x, y })`,
  which keep at least `MIN_GAP` px between neighbours; a row that does not fit (`fits: false`) is
  rewritten shorter, never squeezed. Every spot a piece comes to rest in (a token's slot, a chip's
  place in a tray) comes from `row`/`column`; a piece on its way there may pass over others.

## Motion

`motion.js` and `core.js`.

- **Curves** (`E`): `slam`, `snap`, `ramp-up`, `glide`, `spring`, `reverse`, `drift`, `linear`, and
  `E.world` (ease in and out) and `E.ui` (the brand ease-out). `seg(t, a, b, e)` is progress through
  `[a, b]` on curve `e`; `lerp`, `arch(t, a, b)`.
- **Principles as tools:** `squash(u)` → `{ sx, sy }` (volume kept), `follow(t, stopAt)`,
  `arcPath(p0, p1, lift, u)`, `smear(from, to, u)`, `makeWarp(ramps, duration)` (a speed ramp).
- `frame(t, { camera }, parts)` frames a flat drawing with one camera.

## Sound events

`assets/frames/<frame id>.events.json`: a JSON array of `{ "t": <frame seconds>, "kind": <kind>,
"what"?: <plain words>, "dur"?: <seconds>, "sound"?: <library id>, "motif"?: <name> }`, `t` on the
landing frame, from 0 to the frame's `duration`. `sound.mjs` mixes every frame's events into
`assets/sfx/events.wav` and lists what it dropped and what it varied; `opener-sfx.mjs` places the
opener's sound and the 1→2 hit, which no events file declares.

| kind | for |
|---|---|
| `foley` | a physical action, in plain words in `what`; `dur` (0.2–8s) for a continuous one |
| `impact` | a heavy landing, a slam, a payoff hitting |
| `whoosh` | a fast move through the air, a camera punch |
| `pop` | something appearing, a label popping on |
| `tick` | a small count, a step lighting, a number changing |
| `click` | a switch, a toggle, a button, a lock |
| `sting` | a payoff's musical accent |

**Foley words the library knows** (`what` is matched word by word against its tags; a description
with no known word is dropped):

- **Writing and drawing:** pencil writing, pencil scribble, pencil sketch, pen writing, pen
  scribble, pen signature, ballpoint, marker writing, sharpie, whiteboard marker, highlighter,
  chalk writing, chalkboard, crayon, eraser rubbing, pen click, pen cap, marker cap, pencil tap,
  pencil drop on desk, typewriter key, typewriter bell.
- **Paper:** paper slide, paper drop, sheet of paper, paper crumple, paper tear, paper rip, paper
  fold, unfold, crease, page turn, page flip, paper rustle, paper shuffle, stack of papers, paper
  flutter, paper flap, paper plane, envelope open, letter, sticky note peel, notebook close, book
  open, book close, clipboard, cardboard box.
- **Desk tools:** scissors cut, snip, tape pull, scotch tape, stapler, staple, hole punch, rubber
  stamp, seal, pushpin, thumbtack, paper clip, binder clip, ruler flick.
- **Everything else:** coins, coins drop, card, cards, card slide, card place, chips, dice,
  footstep, door open, door close, creak, bell, glass, plate, metal, wood, knife, cloth, leather,
  drop, throw, shove, grab, handle, place, lay, switch, toggle, keyboard typing, chime.

**Finding sounds:** `node assets/kit/sfx-find.mjs <words>` lists the library families those words
reach; `--kind <kind> [words]` lists what one kind can reach, and `--families` lists the whole
library. Give every event a `what`, whatever its kind: its words choose among that kind's sounds
(an impact on glass, a click on a metal latch). `sound` plays one exact id from that list; use it
only when no words reach the sound you need.

**Variety is enforced in code.** In each reel `sound.mjs` rotates variants within a family. It plays
no file more than 2–4 times, never the same sound twice in a row for a kind or on two accents in a
row, and never an opener sound again as an accent. A blocked pick becomes the nearest sound of the
same family. So describe each action as it is and leave the variation to code. `motif` (one short
name shared by those events) keeps one exact sound for a recurring concept (`craft.md` § 11), for up
to five plays. Use it only for that.

## Self-review

- `node assets/kit/snap.mjs world`: the world at its start states through `VIEWS`, to
  `.hyperframes/snaps/world-<n>.png`.
- `node assets/kit/snap.mjs <frame id> <t1,t2,…>`: up to `MAX_TIMES` (6) stills a call, seconds into
  the frame, to `.hyperframes/snaps/<frame id>-<t>.png`.
- `node assets/kit/snap.mjs sequences`: the picture check's stills for frames 1–7 and
  `.hyperframes/sequences/manifest.json`.
- Each id has `MAX_CALLS` (4) calls (a call where the frame threw is not counted). Every call prints
  JSON with `files`.

## The build checks

`try.mjs` and `bounds.mjs` hold every frame to objective breakage only; `try.mjs`'s `CHECKS` names
each check (a check left after the fix round becomes the warning `breakage:<check>`). Each frame's
checks follow its storyboard `look:`. Each builder runs them on its own work before it hands back
(`try.mjs frame <frame id>`, or `world` and `props` for the scene builder; at most 2 runs), so build
to this section from the start. Errors still left go to the build's one fix round; the job
turns whatever is left into warnings and still renders.

- **Every frame:** the module loads and `draw(t)` returns clean SVG at every moment (`load`, `draw`),
  on its storyboard ground (`ground`), with valid sound events (`events`); the dictionary card on
  the frame with `definition:` (`cards`); a shot list that can play
  (`shots`); no critter drawn twice at one moment, vanishing mid-shot, or left out of a later shot's
  cast of the place it is in (`cast`); nothing a critter lets go of travelling on with no hand on it
  (`hands`); one look per concept:
  `CAST` looks, no two critters alike, every concept as `identity.js` gives it (`identity`); the rig: no
  hand or held prop over a face (`rig`); nothing worn over the eyes or mouth (`outfit`); no container
  shown empty (`empty`); `objectProblems` (`objects`); on every frame a builder draws, orange only on
  the hero and at most one more thing (`orange`).
- **The world's wear** (`wear`): each `CAST` critter's role, head piece and hand prop from `wear.js`'s
  lists, and `wearProblems` against the storyboard's beats (a hand prop held into a beat that uses the
  hands). In the render, one vision check on the cast draws a critter whose role does not read bare.
- **Jump cuts** (`jump_cut`, `jumpCutProblems`): two consecutive shots of the same subject change its
  size on screen by at least 2× (in) or to at most ½ (out), measured on the last video frame before
  the cut and the first after it, on the shot list as `snapCuts` draws it. A crop cut that keeps the
  very same framing jumps nothing and is not one. The cut between two frames is held to the same rule
  when both shots name the same subject (`edgeCutProblems`, in `try.mjs all`).
- **Every frame, layout:** no read text, label or card at rest over an object, except a text written
  on its own object (inside its group: a label on it, a word on its page or magnet, even where that
  object lies on another) (`overlap`); no UI texts at rest overlapping or running into an icon or
  button edge (`ui`); the
  frame shows something within its first 0.5 s (`open`); in a builder's frame, content never covers
  under 6% of the frame for more than 1 s (`fill`).
- **Through the camera** (any lens picture): the shot's subject whole and inside the safe area, at
  least half of it on screen and at least 3% of the frame, and no near-empty shot (its things under 6%
  of the frame) (`framing`); no face cut by the frame edge or a nearer set piece (`face_cut`); no
  critter mostly hidden behind a nearer one (`occlusion`); every `DRESSING` object of the shot's place
  drawn, and nothing undeclared appearing or vanishing across a cut in one place (`set_lock`); no
  `close` or `insert` whose only thing in frame is one label or text (`close`). `render()` leaves out a
  set-dressing piece that would show under 15% of itself at a frame edge (still counted as drawn).
  The kit's own fixes (dressing, framing, unblocking, pop-in) run before these checks.
- **`world` and `blend` frames:** labels on their entities and inside the safe area (`label`), the
  set's breakage (`set`).
- **`mechanism` and `blend` frames:** read text at least `READ_MIN` and, at rest, inside the safe area
  (`text`); every part a frame lists in `boxes()` inside the safe area (`safe`).
- **The world and the props** (`try.mjs world`, `try.mjs props`): `world.js`'s parts load and return
  their shapes (`world`), `SET`, `SETS` and the built places (`set`), new drawings tagged and clean
  (`props`), every kit module loaded (`kit`).
- **`bounds.mjs`:** every piece of text, every 0.2s in a browser: cut off by the frame edge, outside
  its box, or in a keep-out.

Captions are drawn by the caption skin, at most 2 lines; no frame draws them.

## Font loading

Fonts ship as local files in `assets/fonts/`; never link Google Fonts. `mount.mjs` writes this
`@font-face` block into every frame composition, so SVG text resolves in preview, snapshot and render
alike:

```html
<style>
@font-face{font-family:"Pragmatica Extended";font-weight:700;font-style:normal;font-display:block;src:url("assets/fonts/PragmaticaExtended-Bold.otf") format("opentype");}
@font-face{font-family:"Roboto";font-weight:300;font-style:normal;font-display:block;src:url("assets/fonts/Roboto-300.woff2") format("woff2");}
@font-face{font-family:"Roboto";font-weight:400;font-style:normal;font-display:block;src:url("assets/fonts/Roboto-400.woff2") format("woff2");}
@font-face{font-family:"Roboto";font-weight:500;font-style:normal;font-display:block;src:url("assets/fonts/Roboto-500.woff2") format("woff2");}
@font-face{font-family:"Roboto";font-weight:700;font-style:normal;font-display:block;src:url("assets/fonts/Roboto-700.woff2") format("woff2");}
</style>
```
