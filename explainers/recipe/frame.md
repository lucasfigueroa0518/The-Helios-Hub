---
version: helios-explainer-v12
name: Helios — Explainer Reel frame (Explainers 4.1)
description: >
  Helios Explainer Reels look made by an amazing animation team: premium, modern, soft 3D, tactile
  and full of effort. A place you could walk into, built and dressed for this topic and seen through
  a real camera; critters who act with intent, dressed for their roles; cuts that each teach
  something; one thing in Helios orange; big lowercase captions at the top. The real-tech beats show
  the mechanism moving, designed by technique, in crisp glass and gloss. No photos, stock footage,
  people, body parts, or pre-made illustration. Every moment of motion has a sound. The principles:
  recipe/principles.md (they win over this file). The look: planning/Explainer Reels/VISUAL_SYSTEM_4.md;
  decisions: planning/Explainer Reels/DECISIONS.md.
unit: the frame — 1080×1920 (9:16); every scene is SVG in frame pixels, every world entity placed in centimetres
principle: a stranger on a phone understands what happened, who did it and why it matters, without reading a label · one read at a time · orange marks the one thing to look at

colors:
  # paper and ink: the quiet context
  paper: "#F3F0EA"
  paper-lit: "#FBFAF6"
  paper-shade: "#E2DACB"
  paper-dark: "#CFC5B3"
  paper-sweep: "#EFE9DF"
  canvas: "#FFFFFF"
  ink: "#171717"
  ink-lit: "#2B2926"
  ink-shade: "#0C0C0C"
  ink-dark: "#040404"
  text-secondary: "#525252"
  text-tertiary: "#737373"
  # orange: the hero and the one focal
  orange: "#FF5E1A"
  orange-lit: "#FF7A3D"
  orange-shade: "#E8541C"
  orange-dark: "#C8430F"
  orange-text: "#CC4E19"
  # green: labels, dimension lines, signposts, the step tracker's lit stop
  green: "#138510"
  green-lit: "#479830"
  green-shade: "#096E07"
  green-dark: "#004800"
  # yellow: light, signs, the payoff
  yellow: "#FDC60F"
  yellow-lit: "#FEDE78"
  yellow-shade: "#ECA811"
  yellow-dark: "#C47910"
  # blue: screens, data, the real tech
  blue: "#4169E1"
  blue-lit: "#4E88F1"
  blue-shade: "#3753CB"
  blue-dark: "#2B329F"
  # teal: the secondary cast's outfits and uniforms, cool objects
  teal: "#14B8C4"
  teal-lit: "#4ACFD2"
  teal-shade: "#009EAE"
  teal-dark: "#0A7788"
  # lilac: one accent per reel
  lilac: "#C377E0"
  lilac-lit: "#D992E9"
  lilac-shade: "#A662CC"
  lilac-dark: "#7947A6"
  # red: what is red in the real place (never a ground, never the hero's accent)
  red: "#E5484D"
  red-lit: "#F8695E"
  red-shade: "#CC2D3E"
  red-dark: "#97112B"
  # the stage ground (premium lit stage) and the Helios sun
  stage-top: "#161616"
  stage-bottom: "#0B0B0B"
  stage-orange: "#FF6A2A"
  stage-red: "#E8413B"
  sun-top: "#FDC60F"
  sun-mid: "#F48C3F"
  sun-bottom: "#EA3C3A"
  # the warm umber of every soft shadow and occlusion (never grey, never black)
  shadow-warm: "#3B2A16"
  # kept for older kit code only; never a ground (the stage replaces it)
  night: "#171717"
  # status: universal meaning only, on the signal itself
  status-error: "#E5484D"
  status-success: "#30C463"
  status-warning: "#F5B014"
  status-info: "#3E8BF0"

typography:
  # — display: Pragmatica Extended ships Bold only; hierarchy from size, case, and color —
  display:      { fontFamily: "Pragmatica Extended", px: 74, weight: 700, lineHeight: 1.05, tracking: "-0.02em", lower: true, color: "ink" }
  title:        { fontFamily: "Pragmatica Extended", px: 50, weight: 700, lineHeight: 1.1, tracking: "-0.01em", lower: true, color: "ink" }
  figure:       { fontFamily: "Pragmatica Extended", px: 64, weight: 700, lineHeight: 1.0, tracking: "-0.02em", color: "ink" }
  label:        { fontFamily: "Pragmatica Extended", px: 34, weight: 700, lineHeight: 1.1, color: "ink" }
  # — body: Roboto —
  body:         { fontFamily: "Roboto", px: 34, weight: 500, lineHeight: 1.2, color: "ink" }
  dimension:    { fontFamily: "Roboto", px: 30, weight: 700, tracking: "0.18em", upper: true, color: "green" }

spacing:
  # Organic Reels on a 1080×1920 frame, measured in the Instagram app.
  # y 0–250: Instagram's Reels header. y 250–570: the burned-in caption band.
  # y 1600–1920: Instagram's username, post caption, and audio. x 940–1080: its buttons.
  safe-x0: "96px"
  safe-x1: "940px"
  safe-y0: "570px"
  safe-y1: "1600px"
  ig-header: "250px"
  caption-band-top: "250px"
  caption-band-height: "320px"
  ig-bottom: "320px"
  ig-buttons: "x 940px–1080px"

components:
  focal:
    color: "{colors.orange}"
    description: "The ONE entity per beat the viewer must look at, drawn in the orange ramp with gloss. Exactly one per beat; the hero critter keeps its orange wherever it appears (frames 1, 4, 5 and a frame-7 callback; never frames 2, 3 or 6; EX3-107, EX3-132). Never an outfit, never the set."
  set:
    description: "The place (set.js, EX4-145): world.js writes a SET brief (place, 3–5 tells, architecture with openings, materials, a 2–3 token color story, fg/mid/bg layers, the place beyond, density) and builds it with setBuilder. Rich in detail, calm in contrast, never orange."
  critter:
    description: "THE cast (EX3-77): every character is a critter from cast.js (Critter 2.0), never a person or a body part. It acts by intent through the rig (act / actAt): reach, hold, carry, point, inspect, recoil, walk, the eyes leading. Body, outfit and view fixed by world.js CAST. 72 cm tall: the scene's ruler. At most 3 in a shot (EX4-146)."
  outfit:
    description: "A critter's clothes for its role (outfits.js: ROLE_GUIDE starters, TOP_READS, outfitReads): the one or two garments a stranger knows the job by, never another job's, never orange, nothing over eyes or mouth (EX3-103)."
  shot:
    description: "A camera in the room (shots.js, EX4-148): { at, kind, camera: { pos, target, fov }, subject, cast, move?, focus? }. The lens is the only reframing; every cut changes the subject or the angle; at most one move; depth of field only with a reason."
  label:
    typography: "{typography.label} or {typography.dimension}"
    description: "A short label anchored to its entity in world space (lens.js labelFor), 5 words or fewer, shown as the voice names it, gone when its entity leaves the shot. Never placed in screen space."
  tech:
    description: "The real-tech beats (explain.js on glass.js, EX4-154): a TECHNIQUE named on the module's first line, every concept drawn from the reel's identity map (assets/world/identity.js), the mechanism visibly moving. A card is the last resort, never the subject."
  title-card:
    description: "Frame 1 only (EX3-80), drawn by the bank's opener (EX3-102), never by a frame worker: titleCard() in the top band, 'today's brain break:' then the term in orange. Captions are quiet for frame 1."
  dictionary-card:
    description: "Frame 3 only (EX3-80): dictionaryCard(), its headword the term, the definition filling in word by word on its voice times and staying (data-role=\"definition\"). Below it, a tech visual of what the definition says."
  step-tracker:
    description: "Frame 6 only: stepTracker(steps, current, x, y, { axis, gap, size, maxW, lit, appear }) from glass.js along one edge of the safe area, its stops the anchor steps' technical names (world.js STEPS, EX3-129), drawn after shotFrame(...) in screen space."
  text-box:
    description: "Text inside a shape (cards.js textBox(), EX3-92), sized around the measured text: speech, chat, note, sign or screen."
  close:
    asset: "assets/Helios-logo.png"
    description: "The last frame only, the kit's close.js (EX3-95), built by code: 2.5s, white, the Helios logo animating in and 'AI BRAIN BREAK' writing itself beneath it. No voiceover."
---

# Helios — Explainer Reel frame (Explainers 4.1)

**Read `principles.md` first** (in the project: `.media/recipes/helios-explainer/principles.md`).
It is the director's teaching and wins over every rule here; a conflict between the two is a bug to
report in your last message. This file is the contract: the palette, the safe area, the kit's API
(what each module offers and its exact call shapes), and the build checks every frame must pass. It
names no topic: every reel is a new place, a new cast and a new mechanism, and nothing here is a
menu to copy.

**The test of every frame** (principles.md): a stranger watching on a phone with the sound on
understands what happened, who did it and why it matters, without reading a label. The 4.0 reels
failed it with bland rooms floating in white, poses nobody would make, a prop hovering beside a
hand, blur nobody needed, cuts to a zoomed copy of the same view, crowds squeezed into a shot with
no clear hero, a trip the voice described that never happened, and tech beats built from empty
cards. Every rule below exists to make those impossible.

Every rule in this file is mandatory. Rules marked HARD CONSTRAINT fail the frame outright when
broken. The V-… ids are the ones the kit's code comments cite.

## The frame · HARD CONSTRAINT (V-T3)

On the 1080×1920 frame:

- **y 0–250:** Instagram's Reels header. Nothing readable of ours.
- **y 250–570:** the caption band. The world may run behind it; nothing readable of the world.
- **y 1600–1920:** Instagram's username, caption and audio line. Nothing readable of ours.
- **x 940–1080:** Instagram's action buttons. Nothing readable of ours.
- **Safe area:** x 96–940, y 570–1600.

The world runs full-bleed. The subject, every label, every number, the title and the logo stay
inside the safe area at every landing and hold, including during camera moves (lens.js
`framingProblems`; `placeInSafe` and `safeProblems` on tech frames). A thing may cross a frame edge
while it moves through; text a crop shot keeps off screen for its whole length is not on screen
at all; readable text on screen lands and holds inside the safe area.

## Colors · HARD CONSTRAINT (V-T1)

Every color on screen is one of the frontmatter tokens, a mix of exactly two of them, or a
gradient the kit draws from them, at any opacity. The kit's `T` holds them, and every solid, set
piece and lens drawing resolves its color through `core.js` `resolveTone()` / `toneHex()` (set.js
`tone()` is the same, and also takes a `MATERIALS` name): a token or ramp name such as `ink-lit` or
`green-shade` (`toneNames()` lists them; `TONE_ALIASES` reads `white` as `canvas`), or
`{ mix: [a, b, k] }`; an unknown name throws with the allowed list. A scene never writes another
hex. Light adds no new hue: highlights are a ramp's lit step,
`paper-lit` or `canvas`; glows take the color of what glows.

- **Each hue has a job.** Paper and ink are the quiet context. **Orange** is the hero and the one
  focal. **Green** marks labels, dimension lines and signposts. **Yellow** is light, signs and the
  payoff. **Blue** is screens, data and the real tech. **Teal** dresses the secondary cast and cool
  objects (water, ice, steel). **Lilac** is one accent per reel. **Red** (its own ramp) is only for
  what a stranger knows as red in the real place, never a ground and never the hero's accent.
  Everyday things, outfits and the set take the hue their real thing has, from any ramp but orange
  and the status colors.
- **Hierarchy.** The eye goes to orange first, green second, the rest after. Nothing else in the
  shot is larger, more saturated or brighter than the focal.
- **Ramps.** Every hue but the status colors is a 4-step ramp (`-lit`, base, `-shade`, `-dark`); a
  soft volume runs through its own ramp, lit toward the key light, and never borrows another hue's
  steps.
- **Status colors** carry their universal meaning only (red for error, rejection and destruction; a
  bright green for success; yellow for warning; blue for information), on the signal itself (a
  light, a badge, a flash, the object in the moment it fails or passes), one at a time, never as a
  ground, decoration or a large area. The orange focal still leads.

## Grounds · HARD CONSTRAINT (V-14)

- **`paper`** (the default): a warm studio sweep, the studio key light top right. In an analogy
  frame the set covers it: the ground shows only where the place itself opens onto the studio.
- **`stage`**: the Helios premium lit stage (charcoal under a warm glow), for dark, tense or night
  scenes. Every solid and critter takes a rim light; whatever no light reaches stays dark.
- **`white`**: the close only.

`night` and `forest` are retired (the kit draws them as `stage` so old projects still render; the
storyboard lint rejects them). The real-tech frames stand on `paper`. The ground changes only at a
cut or through a motivated light change in the world, never by a fade. Each frame's ground is its
storyboard `ground:`, and its module's `ground` matches it.

## Typography · HARD CONSTRAINT (V-T2)

Pragmatica Extended Bold for captions, figures, the title and primary labels; Roboto for secondary
labels and UI text. No other faces. Pragmatica ships Bold only: hierarchy comes from size, case and
color. Load-bearing text is at least 30px on the 1080-wide frame (34px, `READ_MIN`, for anything
read in a tech frame) and holds 4.5:1 contrast against what is behind it. Numbers stay numerals.

## The look · HARD CONSTRAINT (V-3, V-15, V-16, V-17)

- **Soft 3D, one key light** from the top right (`LIGHT.key` in `core.js`), the same in every
  frame. Every solid is a soft volume: faces graded through its ramp, rounded lit edges, **no
  outline**, a soft contact shadow and ambient occlusion in the warm `shadow-warm`, gloss only on
  glossy materials (plastic, glass, screens, enamel, the critters' eyes). Lines remain only where a
  line is the thing: printed detail, writing, dimension lines, routes. No grain, grid, stipple or
  line wobble.
- **Smooth and deterministic.** `draw(t)` is a pure function of frame time: no boil, no drawing on
  twos (`onTwos(t)` returns `t`), no unseeded randomness, no clocks, no state between calls.
- **Built from the kit.** Tokens from `core.js` and `draw.js`; the camera, solids, critters,
  shadows, labels and depth of field from `lens.js`; the set from `set.js`; acting from `cast.js`
  and outfits from `outfits.js` (through `cast.js`'s exports); shots from `shots.js`; motion from
  `motion.js`; light from `light.js`; the real tech from `explain.js` on `glass.js`; text in shapes
  from `cards.js`; space, containers and magnifiers from `space.js`. The set and every anchor entity
  are drawn by `assets/world/world.js`, every tech concept by `assets/world/identity.js`. A frame
  never draws its own version of either, a second light, or a second token set.
- **Never:** photos, stock footage, emoji, unicode glyph icons, real brands or logos other than
  Helios, real people's likenesses, people or body parts of any kind as objects or actors,
  infographic templates, bullet lists, headlines, narration sentences on screen.

## The world: one place, one camera (V-2) · HARD CONSTRAINT

The anchor scene is one place in centimetres (x right, y away from the camera, z up). Every entity
stands at its `LAYOUT` spot at its `SIZES` size; things stand on the floor or on each other, and
nothing floats or sinks.

- **The perspective camera** (`lens.js`) is the camera of the analogy's frames (1, 4, 5 and a
  frame-7 callback): `lens({ pos, target, fov, roll })` → `P(x, y, z)` (`[sx, sy, depth]`, with
  `P.scaleAt`, `P.dist`), lit by `rig(P, { ground, ambient, key, dirs, points })`, drawn with
  `render(P, { env, items, shot, local })` (the env first in its order, then the items far to
  near). `worldAt(P, sx, sy, z = 0)` → `[x, y, z]` is the exact inverse: the world point at height
  `z` that the camera shows at screen `(sx, sy)`, for placing a thing by eye (it throws for a point
  above the horizon). Through the camera,
  solids are the lens's own (`box`, `obox`, `slab`, `cylinder`, `sphere`, `quad`, `faceArt`,
  `hinge`, `openBox`), critters are `critterAt()`, shadows `contactShadow()`, `shadowsOf()`,
  `floorShadow()`. The bank's isometric props never appear through it: an object is built from
  lens solids.
- **The isometric camera** (`space.js`: `scene`, `plane`, `depthSort`) only for a room overview
  or a diagram: orthographic, so no parallax and no focus (`frame()` throws on them).
- **True size** (EX3-137). `SIZES` holds every entity's real size; the critter (72 cm,
  `CRITTER_CM`) is the ruler; story exaggeration at most 1.5×, declared as `exaggerate`; a thing
  seen far away is `far`. A held prop is sized from the critter (`heldScale(propCm, drawnPx)`). A
  tiny thing reads through `magnifier({ from, at, r, zoom, draw })` or an insert shot, never by
  being drawn bigger. The camera, never the object, makes a thing big.
- **Containers** (EX3-138): inside means behind the frame (`openBox()` through the lens,
  `container({ clip, back, contents, front })` on the isometric camera). Contents never cross a
  container's border.
- **Objects drawn to fit** (EX3-112). A bank asset (`props/CATALOG.md`) only on an exact fit: the
  same thing, in the same setting. Everything else is drawn new, named as specifically as a
  stranger names it here, its signature parts drawn so it cannot be mistaken for its look-alike,
  recognizable at phone size without a label (EX3-74), detail printed on its faces. Props that carry
  the idea have the one shape detail a stranger knows them by, large enough to see on a phone
  (principles.md § 4). New drawings join the bank once the picture check names them (EX3-114).

## The set: a place you could walk into (V-4) · HARD CONSTRAINT

Principles.md § 1. Dressed worlds supersede EX3-117's "no set dressing" (EX4-145): the place is
built and inhabited; the read stays one thing at a time through light, focus, value and size, never
through emptiness. Lucas on the 4.0 reels: "bland 'world of white' rooms".

**The brief first.** `world.js` exports `SET` before anything is drawn:

```js
export const SET = {
  place: '<the place as a stranger names it>',
  tells: ['<3–5 things that make it this place, built first, at true size>'],
  architecture: { walls: ['back', 'left'], openings: [{ wall: 'back', kind: '<an OPENING_KINDS name>' }] },
  materials: { floor: '<a MATERIALS name>', walls: '<a MATERIALS name>' /* , the main fixtures … */ },
  colorStory: ['<2–3 palette tokens the real place has, in quiet values>'],
  layers: { fg: '<one piece near the lens, partly cropped>', mid: '<where the action stands>', bg: '<walls, openings, what is seen beyond>' },
  beyond: { kind: 'outdoor' | 'room', place: '<what lies past the openings, and every other place the story goes>' },
  density: 'sparse' | 'lived' | 'busy',
};
```

`setBriefProblems(SET)` must be `[]`. `MATERIALS`: plaster, paint, tile, subway, brick, wood,
planks, panel, linoleum, carpet, steel, concrete, terrazzo, raised-floor, glass, fabric (each its
own tone and pattern; `{ kind, tone }` overrides the tone). `OPENING_KINDS`: door, doorway,
window, pass, arch, glazing.

**Build it with `setBuilder(P, R, SET)`** (`set.js`), in world centimetres through the shot's
camera. Each method draws a general primitive and files it as architecture (`env`) or as a thing
sorted by distance with the cast (`items`); pass `tell: '<one of SET.tells>'` on the piece that
builds a tell, and `layer: 'fg' | 'mid' | 'bg'` to override the guess.

| Method | What it builds (options) |
|---|---|
| `.room({ x, y, h, walls, floor, wall, ceiling, enclose, skirting, dado, cornice, tell })` | the shell: floor `x [x0, x1] × y [y0, y1]` (`y1` the back wall), walls `['back', 'left', 'right', 'front']` or `{ back: { mat, openings, dado } }`; `ceiling: 'flat' \| 'beamed' \| 'none'` or `{ style, mat, beam, every, depth, w, along }`; `enclose: 'auto'` (default) closes the room with a plain wall when a camera inside looks at a side you did not list (a reverse shot never turns into a void), `false` keeps an open cutaway |
| `.wall({ a, b, h, n, mat, openings, dado, skirting, trim, cornice })` | one wall from floor point `a` to `b`; `openings: [{ kind, at, w, z0, z1, beyond, mullions }]`; the dado rail splits at openings |
| `beyond` on an opening | `{ kind: 'outdoor' \| 'room', sky, ground, dist, tell, volumes: [{ u, at: [_, d], size: [w, d, h], tone, windows, sign, awning, tell }], custom: (P, R, ctx) => svg \| { svg, tell } }`: real volumes at real distance, seen only through the opening, so they parallax; `.beyond(svg, at, { tell, clip })` adds a custom piece beyond |
| `.surface(pts, mat, { part })` | a flat world quad in a material (a rug, a stripe of paint, a counter top) |
| `.run({ at, facing, len, depth, h, body, top, doors, drawers, gaps, inserts, upper })` | a counter or cabinet run; `h: 'critter'` (the chin line, `CRITTER_COUNTER_CM` 19 cm, so a critter behind it shows its whole face; `faceCutProblems` flags a face cut by nearer set pieces) or a number; `inserts: [{ kind: 'sink' \| 'hob' \| 'screen' \| 'tray', s, w }]` |
| `.shelving({ at, facing, len, depth, h, bay, levels, contents, density, rack })` | shelves filled with `books`, `binders`, `boxes`, `jars`, `files`, `goods`, `servers`, `folded` |
| `.desk`, `.chair`, `.bed`, `.drape`, `.sign`, `.lamp`, `.beam`, `.solid` | furniture, curtains and partitions, wall signs and screens, lamps (`.lamp` returns its point light), overhead runs, plain solids |
| `.dress({ area, kinds, density, palette, seed })` / `.thing(kind, at, tone)` | the place's real small things (`DRESS_KINDS`) on a surface at the brief's density, or one placed by hand |
| `.foreground(svg, at)` / `.piece(svg, at, { tell })` | the near framing piece (always `fg`), or a custom piece built from lens solids (an empty piece records no tell) |
| `.done()` | `{ env, items, meta, lights, apertures }` |

Fixtures take `at` as the front-left floor corner seen from the front, the body extending behind it
(away from `facing`); against a wall, `at` is the wall's line minus the depth. `setProblems(meta,
SET)` must be `[]`: a floor; two walls meeting at a corner or a wall with an opening; something
beyond every opening; all three layers; a material on every large surface; every brief tell built;
dressing at the brief's density; the ceiling at most `CEILING_MAX_SHARE` (12%) of the frame; no
orange anywhere in the set. `ceilingShare(P, room)` measures a camera before you build, and
`fitCeiling(cam, room)` lowers its aim until the ceiling fits; a `beamed` ceiling reads as
architecture in the sliver a tall frame keeps.

- **Recognizable in one second**: the tells first, at true size.
- **Rich and calm**: detail and dressing in the set, quiet in value; contrast, orange and the
  brightest light stay with the read. Dressing is what this place really holds, smaller and calmer
  than any read, never generic.
- **Three layers in every shot** but an insert: a foreground piece near the lens, the action, the
  background walls and openings.
- **A place beyond**: when the story goes somewhere, that somewhere exists, seen through an
  opening or built as its own set the same way (world.js `SETS`, § Show what the voice says).
- **A foreground for every camera**: `ROOM` places its foreground piece near the camera it is
  called with (`worldAt(P, sx, sy)` near a bottom corner), so each view has one.
- **Text in a custom piece** is wrapped with `set(svg)`; things inside an `openBox` are drawn by the
  box (its `contents`), so the box's edges cover them.

## The cast: acting by intent · HARD CONSTRAINT

Principles.md §§ 2–3.

**The hero reads on screen** (principles.md § 3). Whatever the hero is, a critter or an object
(EX3-109, EX3-110), it is big enough to read on a phone, clearly the subject of the shots the voice
gives it, and doing the voiced action. A director who casts an actor outside the mapping writes it
as an entity that "stands for the actor: …", one beside the mapping's four (EX4-158).

**Critters are the only characters** (EX3-77); objects may act on their own (EX3-109). Never a
person, a figure built from solids, or a body part, and never a body part alone in a shot
(EX4-147): a hand never enters without its critter; an insert shows the object by itself, or is
framed so the critter doing the action is in the picture with its face whole.

**`critter(x, y, options)`** (`cast.js`; through the lens, `critterAt(P, x, y, z, options, R)`, which
returns `{ svg, s, feet, at, dist }`). The look options come from world.js `CAST` and never change:

- `body` (`BODIES`): `ink`, `paper` or `orange` (the hero's only), or a light body `yellow`,
  `blue`, `teal`, `lilac`, `green`; an unknown body throws.
- `outfit` (below); `view` (`VIEWS`: `'front'` by default, `'three-quarter'`, `'back'`) and `side`
  (`SIDES`: `'left'`, `'right'`) for which way a three-quarter or back view turns. A back view shows
  no face, the head turned away, which is not faceless; its outfit is drawn from behind
  (`outfitBack`).
- `who`: the critter's world id (`data-who`), always.

**Pose from intent, through the rig** (EX4-150). Never hand-place arm coordinates: write what the critter
does and let the rig solve the arms (two-bone, elbows down and out), the lean (into effort, away
from fear), the weight and the gaze (the eyes lead the hands).

```js
const frame = { x, y, s, flip };            // the critter's feet on screen, its scale, its facing
const pose = act({
  gesture,                                  // a GESTURES name: calm, clutch, shrug, relief, cheer, hips, think, wave, feel, cover, guard
  reach: [sx, sy], point: [sx, sy], hand: 'l' | 'r', hands: { l, r },
  hold: { l, r, both },                     // a PROPS name (mug, cup, carton, box, parcel, clipboard, card, phone, pen, bag),
                                            // { kind, color }, or a custom { draw, box, upright, follow, grips }
  carry: [sx, sy], inspect: 'l' | 'r', lookAt: [sx, sy], recoil: [sx, sy],
  effort: 0.4, lean, walk: { t, pace, stride }, mood,
}, frame);
critter(x, y - pose.bob, { ...CAST[id], ...pose, who: id });
// a performance over time, eased, the eyes a beat ahead of the hands:
const p = actAt(t, [{ at: 0, lookAt: A }, { at: 0.6, blend: 0.4, reach: A, effort: 0.5 }, { at: 1.4, hold: { r: 'box' } }], frame);
```

Targets are screen points; through the lens, project world points with `P(x, y, z)` (world.js's
critter functions do it for the frames, § The anchor scene). `blendRig(a, b, u)` mixes two poses;
`gripAt(x, y, options, side)` and `heldProp(x, y, options)` give a held prop as its own layer.

- **Hands hold things**: a carried thing is in a hand (`hold`) every frame; two things take two
  hands; a thing is put down before the next is picked up. A resting hand holding a prop sits below
  the face line unless a reach or point targets it (the rig puts it there by itself).
- **Moods set only the face** (`MOODS`: neutral, happy, confident, proud, sly, confused, worried,
  panicked, surprised, sad, angry, focused, pained, relieved, curious); every face has eyes, brows
  and a mouth, and `neutral` is calm, not blank.
- `riggedProblems(options)` must be `[]` (codes: faceless, unknown-mood, unknown-view,
  hand-over-eyes, hand-on-mouth, arm-across-face, hand-above-mouth, prop-on-face, prop-off-hand,
  overreach);
  `critter()` writes the drawn codes as `data-rig`, and the try reads them.

**Looks are locked** (EX3-107): `CAST` fixes each critter's `body`, `outfit` and `view` for the
reel. A critter hero is the one orange critter and appears only in frames 1, 4, 5 and a frame-7
callback (EX3-132). No two individual critters on screen look alike.

**Outfits say the job** (EX3-136). Start from `ROLE_GUIDE[role]` when the role is there, then fit
it to this reel: `{ top: { kind, color, trim, neck, pocket, under, print, pattern }, sleeves,
pants, shoes, head: { kind, color }, items, custom }` from `TOP_KINDS`, `NECKS`, `HEAD_KINDS` and
`ITEMS` (an unknown name throws). `outfitReads(outfit)` → `{ kind, reads, clashes }`: `reads` must
be the role's and `clashes` empty. The one or two garments a stranger knows the job by; never
another job's colors or shapes, never orange, nothing over the eyes or mouth (EX3-103), glasses
excepted. `custom(ctx)` draws a garment the kinds do not cover (`ctx`: `{ by, fill, tones, keepout,
soft, line, el, g }`).

**Few on screen, one to watch** (EX4-146). At most **3 critters in a shot**, only the ones the
moment needs; the rest are off screen, never squeezed in. A crowd is one subject: its members
drawn with `critter()` and no `who`, all doing the same action, smaller and quieter than the read,
in the background or its own shot, wrapped together as one `entity(P, '<crowd id>', at, size, svg)`
and listed once in a shot's cast; never mixed in with the individuals. When the voice names
"this <role>", that critter is the clear subject: alone in the shot, or lit, centred and acting
while anyone else is still. Never overlap critters to fit them: change the shot.

## Shots: the camera grammar (V-24) · HARD CONSTRAINT

Principles.md § 4. A scene frame is a list of shots cut on voice cues. Each shot carries its own
camera in the room:

```js
export const shots = [
  { at: 0,   kind: 'wide',   camera: { pos, target, fov }, subject: 'hero', cast: ['hero', 'other'],
    move: { kind: 'pan', deg: 6 } },
  { at: 3.1, kind: 'medium', camera: { pos, target, fov }, subject: 'other', cast: ['other'] },
  { at: 6.4, kind: 'insert', camera: { pos, target, fov }, subject: 'thing', cast: ['thing'],
    focus: { reason: 'insert', on: 'thing' } },
];
```

- **The camera is the only reframing.** A camera shot has no `on`, `zoom` or `push` crop:
  closeness comes from where the camera stands and its field of view. `kind` (`SHOT_KINDS`: wide,
  medium, close, insert, reaction) says the shot's job: wide, where are we and who is where;
  medium, what are they doing; close, how do they feel; insert, the one small thing that matters;
  reaction, a face carrying the moment. Open each scene wide enough to read the place.
- **Every cut changes what the viewer learns** (EX4-148): a new subject, or the same subject from
  a clearly new angle (≥ 30° around it, `CUT_MIN_DEG`, or ≥ 15° of height, `CUT_MIN_HEIGHT_DEG`).
  A cut to a closer copy of the same view is a jump cut. Judge it by the picture, not the numbers:
  two consecutive shots that look alike at a glance (same subject, same side, similar size) are a
  jump even when the camera moved. `cutProblems(shots, { duration })` must be `[]`.
- **At most one motivated move per shot** (`SHOT_MOVES`): `push` (cm, as tension builds), `pull`
  (cm, to reveal), `pan` (deg, to follow a turn), `follow` (cm, travelling with a walker).
  Otherwise the camera is still. `shotLensAt(shot, local, length)` is the camera at a moment.
- **The cast is planned with the camera.** A shot draws only its `cast` (`render(P, { shot })`,
  `castItems`, `inShot`), so the cast lists every entity this camera sees, the subject among them:
  at most 3 critters (`MAX_CAST_CRITTERS`, a crowd counting as one). Things spread over the whole
  place are part of the set, or one entity, never a dozen ids. A critter left out of a shot is out of that camera's view (behind it,
  off to the side, in another part of the place), never deleted from a spot the camera sees (a
  shot is still only a camera, EX3-90). No critter more than 15% hidden behind another
  (`MAX_HIDDEN_SHOT`); the named subject whole and inside the safe area. `crowdProblems(shots,
  samples)` must be `[]`.
- **Depth of field by intent** (EX4-149). Everything is sharp unless `focus` gives a reason
  (`FOCUS_REASONS`): `insert` (one small object isolated), `reveal` (the subject sharpens out of a
  soft scene), `rack` (`on` → `to`, at `at`, over `dur`). The thing the voice is naming is never
  blurred. `dofProblems(shots, samples)` must be `[]`. Lucas: "blur where none is needed".
- **Labels belong to things** (EX4-148): `labelFor(id, text, { P, shot, at, height, lift, size, u })`
  anchors a label in world space at the top of its entity, hides it when the entity leaves the
  shot's cast or the frame, slides it along a short leader to stay in the safe area (it is clamped
  to x 96–940, y 570–1600 by itself). Non-critter entities are tagged with `entity(P, id, at, size,
  svg)` so labels, subjects and checks can find them; the beat's focal with `focal(P, at, size,
  svg, { name })`. `labelProblems(samples, shots)` must be `[]`.
- **Small things read** (principles.md § 4, EX4-147): when the voice names a small prop (a held
  thing, something on a surface), plan a shot that makes it read: an `insert` with the prop as its
  subject (the critter partly in frame, its face whole or its head out of frame entirely), or a
  `magnifier()`. At true size next to a 72 cm critter a held prop is a few dozen pixels.
- **Rhythm.** Shots run 1.5–4.5s (`validateShots`); a frame over 6s has at least 2. No frame opens
  on the picture the previous frame ended on.
- **Frame for the phone.** Stage the cast across the frame at different depths, the camera a
  little off the room's axis at about eye level; never line critters up along the camera's axis.
  The subject and every label stay inside the safe area for the whole shot, moves included.

**Tech frames** (glass, flat) may use crop shots `{ at, kind, on, zoom }` of about 1.2–1.6, or a
single framing. The same rule holds: a cut never lands on a closer crop of the same view.

## Show what the voice says · HARD CONSTRAINT

Principles.md § 5 (EX4-151).

- **Every action the voice describes happens on screen, in order, on its words.** A trip is
  shown: a cut to the destination (built as its own set, or seen through an opening) or a time cut
  (the door closes, time passes, the critter comes back changed, carrying what it went for).
  Walking to a door and back is not a trip.
- **Every result is visible**: what is poured fills, what is fixed is seen fixed, what spoils
  shows the spoilage, not a stripe changing color.
- **The mapping stays straight**: the definition, the analogy and the example name the same parts
  the same way; labels follow the storyboard's mapping and sit on the entity they name in that
  shot.
- **The payoff resolves**: frame 7 shows the answer working, the satisfying result, never the
  opening tension again.

## Focal (V-5) · HARD CONSTRAINT

Each beat has exactly one focal: the only thing in the orange family (the opener title's concept
word is outside the world), except that a critter hero keeps its orange wherever it appears (with
an object hero, no critter is orange and the hero object carries it; EX3-107, EX3-132). When a
beat's focal is another entity, it takes orange too, the only time two oranges share the screen.
Orange is never an outfit (its items included) and never the set. In a perspective shot the focal
is wrapped with `focal(P, at, size, svg, { name })` (`at`, `size`: its world box in cm). It
dominates its neighbours by size, light, contrast or motion; camera, light and motion deliver the
eye to it within 0.5s; it changes only at a beat boundary.

## One read at a time (V-22, V-20) · HARD CONSTRAINT

The place is full; the read is single (EX4-145). At every moment the viewer has one thing to read:
the caption while the voice speaks, one short label (the thing the voice just named), the focal
acting, or a designed card while captions are quiet.

- **The read through light, value and size.** It is the brightest, most contrasted and most
  saturated thing in the shot; the set is rich but quiet in value; dressing is smaller and calmer
  than the read. Depth of field only with a reason (§ Shots).
- **Sequential reveal.** Elements arrive one at a time, in reading order, each after the previous
  had time to be read (about 0.3s per word for type, at least 0.6s for an object's action); a read
  element steps back (dims, shrinks, or leaves) before the next takes the lead.
- **Gaze.** Critters look at the read; the viewer looks where they look.
- **Choreography.** Lead with the hero, then its context; with three or more moving things, at
  most a third move at once; supporting things move less, slower and later.
- **Eye path.** Each shot sequence states where the eye lands first, where it travels, and what
  rewards it.

## Light

Light is part of the action (EX3-143): it shows where to look, tells how the moment feels, and
changes when something in the world changes it.

- **Every light has a source**: a light in the shot (a window, a lamp, an open door, a screen, a
  sign) or the studio key on `paper`. A pool, rim, glow or warm face is drawn only where a named
  light reaches, in its color, falling off with distance, and only through what lets it out (an
  opening's `aperture`). In a dark scene, whatever no light reaches stays dark.
- **The rig** of a perspective shot is `rig(P, { ground, ...LIGHTS(state, place) })`: on `paper` the studio
  key from the top right and its fill; on `stage` only the lights added, directional (`dirs`) and
  point lights (`points: [{ pos, level, reach, color, aperture }]`); `ambient` and `key` lift or dim
  the room. World.js's `LIGHTS(state, place)`
  carries the set's lamps and the light coming through its openings. The key light never moves.
- **Light that moves** (`light.js`): `lightWedge({ from, to, level, color })`, `rim(shape, { side,
  color })`, `glow(cx, cy, r, { color, level })`, `glint(clipD, u)`, `glowSign(text, x, y, { color
  })`, `level(t, keys)`, `spill(P, light)`; a light's `color` is `warm`, `hot`, `cool` or a token.
- **Every light change is motivated** by the story; ordinary levels (about 0.3–0.6); soft, short,
  pale shadows; one glint at a time, marking a moment; the payoff lands in the reel's warmest
  light.

## Motion (V-6, V-7, V-8, V-9) · HARD CONSTRAINT

- **Every motion has a job:** semantic (it shows the idea), anticipatory (it builds an outcome to
  await), state-driven (a rule visibly produces a consequence), or camera (it carries the eye).
  No decorative motion: no idle floating, random particles, wiggles or light that pulses for
  nothing. Character life (blinks, breath, glances) is allowed; critters not being read stay
  nearly still.
- **Named curves** from `E` (`motion.js`): `slam`, `snap`, `ramp-up`, `glide`, `spring`,
  `reverse`, `drift`; a world move with no stronger meaning `E.world` (in-out); titles, UI and the
  tech primitives `E.ui` (the brand ease-out, never an overshoot or bounce). `seg(t, a, b, e)`,
  `lerp`, `arch`.
- **Principles:** anticipation before every big action; volume-keeping squash and stretch
  (`squash(u)` → `{ sx, sy }`, a critter's `squash`; never on rigid things); follow-through
  (`follow(t, stopAt)`); arcs (`arcPath(p0, p1, lift, u)`); eased timing; one smear frame on a move
  faster than about 4 frames (`smear(from, to, u)`). Speed ramps (`makeWarp`) where the moment
  earns them.
- **The camera is calm:** at most one move per shot (§ Shots), roll within 3°, at most one punch
  per beat; the 1→2 attention reset may punch harder.

## Real-tech frames: designed by technique · HARD CONSTRAINT

Principles.md § 6 (EX4-154, EX4-160). Frames 2, 3 (its visual), 6, and 7 when it is built in
glass. Lucas on 4.0: "lazy, simple tech frames built from cards and tiles". The 4.1 rehearsals
still shipped them: small icons, blank phones and a step tracker on empty paper. A tech frame is
a diagram that performs: the viewer watches the mechanism work and reads its result.

### The anatomy of a tech frame (EX4-160)

Every tech frame has these five parts. They are the bar the Phase 1 frames Lucas approved met, on
any topic:

1. **The parts of the mechanism, laid across the safe area.** Each concept is a node from the
   identity map, large (about 100–140px), placed so the frame reads top to bottom or left to right
   as the mechanism runs: where things come from, where they go, what happens between. The layout
   spans the safe area (x 96–940, y 620–1580 under the caption band), never a cluster in its middle.
2. **Real content.** Whatever travels, is stored, is compared or is shown carries its real name or
   words: a file name, the words of a request, a message, a row, a number, from the reel's own
   example or definition, short enough to read. A device or a window always shows its content
   from the first frame it appears.
3. **The mechanism moving, step by step, on the voice.** Each step is a visible change on its words:
   something travels, is copied, splits, waits, merges, lights. What happened stays on screen (a
   route stays drawn, a copy stays where it landed, a done step stays done), so the frame
   accumulates the whole story.
4. **A measured outcome that changes on screen.** A readout the viewer can read (a stopwatch, a
   meter, a counter, a count of steps, links or items) starts, runs and lands on the number that
   answers the beat. A comparison shows the same readout for each side, side by side.
5. **A clear before and after, held.** The frame ends on its completed state for its last moments:
   every part, the content, the route it took and the final readout, filling the frame. A viewer
   who sees only that held end still reads what changed and by how much.

**Never:** a blank device or an empty window, a card or panel waiting for content, a lone icon or a
few icons in a sea of paper, a step tracker or labels standing in for the mechanism, a readout
that never changes, text that only names a part.

### Choose the technique, then build its anatomy

Name the mechanism in one sentence (what moves, where, what changes), pick the technique that
shows it best (`TECHNIQUES` in `explain.js`; the storyboard's `technique:` is the plan), and make it
the module's first line: `// technique: <id> — <reason>`. Each technique has its own anatomy:

| id | use when the idea is… | what fills the frame | the readout that changes | primitives |
|---|---|---|---|---|
| `process` | a thing moving through steps | the source, each stop and the destination, with the item travelling between them carrying its real content | the steps done, the time taken, or the items delivered | `connector`, `travel`, `queue`, `fan`, `merge`, `copyOut` |
| `before-after` | a change in speed, cost, size or quality | the same task run twice in the same layout, the first run kept on screen beside or above the second | one readout per run (a stopwatch for time), the second ending far from the first | `versus`, `stopwatch`, `meter`, `counter`, `appWindow` |
| `comparison` | two options or paths with different outcomes | two lanes or columns fed the same input | the same readout under each lane | `versus`, `meter`, `sizeBars`, `fan` |
| `transformation` | one thing becoming another | the input on one side, the output built piece by piece on the other | a count of pieces made | `tokenize`, `vectorize`, `morph`, `travel` |
| `scale` | a size, count or cost that is surprising | units or bars filling most of the safe area | the counter climbing to the surprising number | `unitGrid`, `sizeBars`, `counter` |
| `structure` | parts arranged in a system | every part and every link, then the system rearranged | the count of parts or links before and after | `layers`, `graph`, `pointMap` |
| `timeline` | order and waiting over time | lanes over time with events landing in order | elapsed time, or what is waiting | `timeline`, `stopwatch`, `queue` |
| `cause-effect` | an input that triggers a consequence | the trigger, the chain it sets off, and the consequence | the consequence's measure (what was spent, lost, reached) | `travel`, `docPage`, `alarm`, `ripple` |
| `product` | the real app or screen doing the job | the real window filling the frame, its content changing as the job runs | the result the screen shows (rows found, items done, time) | `appWindow`, `thread`, `docPage`, `fileList`, `resultsList`, `terminal` |
| `match-cut` | the analogy object becoming its tech twin | the object morphing into its twin, which then does the job | the twin's first result | `matchCut`, `morph` |

A time comparison is always shown with timers or clocks running, never only stated.

### The rules every tech frame keeps

- **One identity per concept.** The scene builder writes `assets/world/identity.js` once
  (`export default identity({ <conceptId>: { icon, color, shape, label } })`, `shape` one of
  `SHAPES`: tile, disc, doc, chip; `icon` a `UI_ICONS` name; `color` a `GLASS_COLORS` name). Every
  tech frame imports it and draws every concept through it: `reg.node(id, x, y, { size, emph,
  dim, appear, name })`, `reg.chip(id, x, y, { text })`, `reg.icon(id, x, y, size)`, or a
  primitive that takes the registry and a concept id. Highlight with `emph` (light, a ring, a
  little scale) and step back with `dim`; never recolor. `identityProblems(samples)` must be `[]`.
- **Pure and progressive.** Every primitive is a pure function of its arguments and a progress
  (or time) and returns `{ svg, box }`; animate it through that progress on the voice's words.
- **Nothing empty** (EX4-154): a container arrives with its content (a card writes its first
  words as it appears); the primitives refuse to draw an empty shell, and
  `emptyShellProblems(samples)` must be `[]`.
- **Cards are the last resort** (`glassCard`, `textBox`): never the subject, never the default.
- **Readable and full**: read text ≥ 34px (`READ_MIN`), everything read inside the safe area
  (`fitToSafe(box)`, `placeInSafe(part)`, `safeProblems(boxes)`); a frame may export `boxes(t)` →
  `[{ name, x, y, w, h }]` (its primitives' boxes) for the try. At the held end the content
  (marks and text, not grounds, panels or a device's own body) covers a large share of the safe
  area, in all three of its thirds, with several readable texts of real content; and over the frame
  a number changes, a state changes, or the content builds up. The try measures it
  (`techFillProblems`, § The build checks).
- **Framing.** A tech frame is flat: no lens, no depth layers, no focus; the only blur is frosted
  glass. Draw `glassGround()` once, in screen space, before `shotFrame(...)` (never inside a crop,
  where its edge shows as a seam). A crop shot `{ at, kind, on, zoom }` sets `zoom` itself (about
  1.2–1.6; a `close` left at its kind's default is 2.4×) and puts its `on` point where a subject
  sits on screen (`SUBJECT_AT`, x 518, y 1085); lay out what it shows inside the 1080 ÷ zoom it
  keeps. When the content changes in place, keep one framing and let the content move, or cut to
  a new subject; never nudge a crop to fake a cut.

The glass components (`glass.js`) are the material the primitives are made of: `glassGround()`,
`phone(x, y, { w, h, title, messages, children })`, `chatBubble(text, x, y, { from, maxW,
progress, typing })`, `glossTile(x, y, size, { icon, color })`, `pill(text, x, y, { dot, color
})`, `route(points, { color, progress, glow, dashed })`, `packet(points, u, { color, trail })`,
`uiIcon(name, x, y, size, { color })`, `stepTracker(...)`. A phone or a window is drawn with its
`messages` or `children` from its first frame. A physical device stays a soft 3D volume; its
screen and data are glass. A critter appears only when someone acts on the real thing, in its
own look; never the hero. UI moves are short and crisp on `E.ui`.

## Words in the world (V-13)

No headlines (EX3-44): the captions carry every spoken word. On-screen type is a short label
anchored to its entity (`labelFor`, 5 words or fewer, as the voice names it), a figure, the title
card, the dictionary card, the step tracker, the set's signs (1–3 words, part of the place), or
text the real thing itself shows (a message in a `chatBubble`, a file name in a `fileList`). Never
a narration sentence or a near-copy of one. Emphasis is colored text only (`orange-text` on light
grounds, `orange` on dark), at most one word per line. Text inside a shape goes through
`textBox(text, x, y, { kind, size, maxW, focal, progress, scale })` or a primitive that measures
it; never placed by hand. Set text is part of the place: `render()` marks every `env` piece as set,
and set text added another way (a `.piece()` or a frame's own) is wrapped with `set(svg)`
(`lens.js`). Set text never sits in the caption band (y 250–570; `hyperframes check` fails it):
frame a sign below the band or leave it out of shot. A label belongs to an entity; to name a
place, the place carries a sign.

## Captions (V-18)

The caption skin (EX3-45) owns them: big lowercase Pragmatica Extended Bold at the top-left of the
caption band, no plate, light on `stage`, at most 7 words on at most two lines; each word appears on
its voice time; pages switch instantly. Captions are quiet for all of frame 1 (the title card) and
all of frame 3 (`mount.mjs` writes those windows). Frames never draw captions and keep the band
free of anything readable, except the title card and the dictionary card.

## Seams (V-11) · HARD CONSTRAINT

Frames join only by `cut` (EX3-46): a cut on action to a new framing, the world and its state
continuing. A push through an object into the next framing is built inside the two frames with
`seams.js` (`zoomThrough` on the outgoing frame's last moments, `zoomThroughIn` on the incoming
frame's first). Never crossfades, dissolves, wipes, slides, or fades inside the reel.

## Sound (EX3-63, EX3-75) · HARD CONSTRAINT

The reel is full of sound: every visible moment of motion has one, at its exact moment of contact.
A frame worker writes `assets/frames/<frame id>.events.json`: a JSON array of `{ "t": <frame
seconds>, "kind": <kind>, "what"?: <plain words>, "dur"?: <seconds> }`.

| kind | for |
|---|---|
| `foley` | a physical action, in plain words in `what`; add `dur` (0.2–8s) when the action is continuous, so the sound lasts as long as the motion |
| `impact` | a heavy landing, a slam, the payoff hitting |
| `whoosh` | a fast move through the air, a camera punch |
| `pop` | something appearing, a label popping on |
| `tick` | a small count, a step lighting, a number changing |
| `click` | a switch, a toggle, a button, a lock |
| `sting` | the one musical accent of a payoff (at most one per frame) |

What gets a sound: each arrival or landing, each thing set down or picked up, each footstep, each
number or label landing, each line or handwriting stroke (a `foley` with `dur`), each page or card
moving, each state flip, and the payoff. At least 4 events on frames 1, 2, 4, 5, 6 and 7, at least
30 across the reel; never a sound for nothing on screen.

**Foley words the library knows** (`what` is matched word by word against its tags; a description
none of whose words is known is dropped):

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

`assets/kit/sound.mjs` mixes the events into one track (`assets/sfx/events.wav`). The opener's
sound and the hit on the 1→2 cut are placed by `opener-sfx.mjs`; never declare them.

## Timing data (EX3-60, EX3-79)

`assets/timing/<frame id>.json` holds the frame's real timing after `pace.mjs`: `{ frame, id,
duration, voice_end, hold, words: [{ text, start, end }] }`, in frame seconds. Every arrival,
label, definition word, shot cut and sound lands on the word that names it: copy the times you
need into constants at the top of the module. The voice is tight (at most 0.2s between lines); the
picture keeps pace with it and nothing waits for a pause.

## The anchor scene (V-1)

STORYBOARD.md's `## Anchor scene` defines the analogy's scene once (EX3-15, EX3-128): metaphor,
set, beyond, ground, hook, hero, steps (analogy — technical), entities (what each stands for, its
real size, its look), states, layout. The scene builder turns it into `assets/world/world.js` (its
contract: `scene-builder.md`): `SET` (and `SETS`, every other place the story cuts to), `ROOM`,
`LIGHTS`, `VIEWS`, `fit` (a camera fitted under the ceiling), `LENS`, `CAST`, `LAYOUT`, `SIZES`, `ENTITIES`, `STATES`, `STEPS`, `HOOK`, and
`assets/world/identity.js`.

- Every entity is drawn by its one `LENS` function, at its true size, at its `LAYOUT` spot, and
  looks the same in every frame; a critter's function takes its pose as an intent with world
  targets in cm (`scene-builder.md`).
- Every number, position, label and outcome on screen comes from `STATES` and changes only by its
  rules; a scene frame starts in the state the previous scene frame ended in.
- An entity enters only when the narration needs it, and never vanishes from a shot that sees it
  without a cause the viewer sees.

## Frame treatments

> Eight frames in this order (EX3-10), usually 50–65s, each its voice plus a 0.15s `hold`.

### 1 · Series opener (`hook`)

**The opener is the bank's** (EX3-102): code writes `01-opener.js`, which plays the opener named in
`assets/opener.json` over **your hook**; it draws "AI BRAIN BREAK" and then the title card with the
term. The frame worker writes only `assets/frames/01-hook.js`:

```js
export const shots = [ /* one camera shot (two past 6s) that shows the place, with no move */ ];
/** The hook's critter: its world id, its CAST look, and its static lens: the shot's camera as P,
 *  the hero's feet in cm and the shot's rig. An object-led reel exports no hero. */
export const hero = { who: HERO_ID, critter: CAST[HERO_ID], lens: { P: HOOK_LENS, at: LAYOUT[HERO_ID].at, rig: HOOK_RIG } };
export default {
  ground: GROUND,
  shots,
  draw(t, { hideHero = false, heroPose = {} } = {}) { /* heroPose is passed last into the hero's critter options */ },
};
```

The hook is the storyboard's pick, already moving at frame 0, measured from the moment the opener uncovers it (`HOOK_REVEAL` in
`openers/bank.js`): its first visible change within 0.3s of the reveal, clear on its own within one
second of it (a familiar situation, recognizable objects, a critter when
someone acts, an obvious problem or surprise), building (`ramp-up`) toward a question; never the
payoff, never a pan over a still scene. Its camera is static (no `move`) so the opener can find the
hero on the page. No text, no title card, no events file (the opener's stem is the frame's sound).
A hero not drawn with `critterAt()` exports `at`, `s` and `box` instead of `lens`. Frame 1's
storyboard `src` is `01-opener` (its timing file is `assets/timing/01-opener.json`); the worker's
file and snap id are `01-hook`. The bank's opener breaks in over the hook for its first moments:
the hook is judged from the moment it is revealed, and it must already be moving then. In an
object-led reel (`"hero": "object"` in `assets/opener.json`) the hook follows its focal object and
exports no `hero`.

**The 1→2 cut** (mandatory): a hit on the cut (code's); frame 2 opens with its storyboard `reset:`
in the first 0.3s: a punch-in, a light change (`level()` snapping, or a one-frame palette flash),
an in-frame zoom-through (`zoomThroughIn`), or a cut effect (`shock()` marks).

### 2 · Curiosity gap (`pain_point`)

The real technology as the viewer meets it, designed by technique (§ Real-tech frames), each shot
on what the voice names, the surprising moment visible, the question landing on a held shot. It
echoes the hook (EX3-131, EX4-161): the hook's motion or its subject, in the real thing's own
flat layout (a perspective scene cannot keep its composition in glass). Never the analogy's scene,
never the hero.

### 3 · Define the term (`product_intro`)

`dictionaryCard(t, { headword, pos, words })` in the top half (headword the term, `pos` the
`part_of_speech:`, `words` the frame's word times: the definition is the voiceover); below it
(from its returned `bottom` + 40px to y 1600), a tech visual of what the definition says, by
technique, revealed on its key words, with the tech-frame anatomy (§ Real-tech frames). The card
writes its first word as it appears, never a blank card. The visual shows the thing the analogy
calls the term (EX4-152, EX4-159). Captions are quiet. Sounds: `paper slide` as the card lands, a `typewriter key` or soft
`pen writing` with `dur` under the fill-in, each arrival in the visual.

### 4 · The analogy plays (`feature_showcase`)

The hook was a flash-forward to one moment; frame 4 starts the scene from its start state (the
continuity rule runs from frame 4) and reaches that moment again from a new angle. Opens on its
`wide` (the place, who is where; the "without" state when the analogy has two); each
part arrives on its word with its real job as an anchored label (EX3-128); the named hero is the
clear subject when the voice names it; then each step plays as a visible action and its result on
its cue, mostly in mediums that keep the place in view, a close or insert for the moment a step
turns on. Every voiced action and trip is shown (§ Show what the voice says).

### 5 · Why it works, then where it breaks (`feature_showcase`)

The scene again, opening on a medium from a new angle (never frame 4's picture): the defining trait
doing its job (a glint on the word that names why), then its one limit made visible in the scene,
the light turning with it. Never a list.

### 6 · Tiny real example (`social_proof`)

`stepTracker()` along one edge of the safe area in screen space, drawn after `shotFrame(...)`, its
stops the anchor steps' technical names (world.js `STEPS`); for each stop, the example step's real
thing by technique, with the tech-frame anatomy: the example's real content filling the frame and
a readout that changes. The tracker is a guide beside the picture, never the picture. Never the
anchor scene or the hero (EX3-132).

### 7 · The payoff (`benefit_highlight`)

The answer to frame 2's question working, resolved (EX4-153): the satisfying result, landing in the
reel's warmest light, never the opening tension again. Its storyboard `anchor:` says how it is
built: `anchor: own` in glass, by technique (a tech frame), or `anchor: scene`, a callback to the
analogy world showing the analogy's result resolved, the hero in its orange (a scene frame).

### 8 · The close (`branding`) · built by code

`close.js` (EX3-95): 2.5s, white, the Helios logo animating in and "AI BRAIN BREAK" writing itself
beneath it, centred together; fixed sounds. No worker writes it.

## Writing a frame (the frame-module contract)

A frame is `assets/frames/<frame id>.js` (the basename of its storyboard `src`:
`compositions/frames/04-analogy.html` → `04-analogy`), an ES module importing only from
`../kit/*.js`, `../world/world.js` and `../world/identity.js`, that default-exports
`{ ground, shots, draw(t) }` (`shots` also a named export; a one-shot frame of 6s or less may
omit it). `draw(t)` calls `scope('f<NN>-', ground)` first (NN = the frame number, two digits) and
returns one SVG string.

A scene frame:

```js
import { scope } from '../kit/draw.js';
import { rig, render, labelFor } from '../kit/lens.js';
import { shotFrame } from '../kit/shots.js';
import { ROOM, LENS, LIGHTS, LAYOUT } from '../world/world.js';

const GROUND = 'paper';   // equals the storyboard `ground:`
const NAMED_AT = 3.1;     // "<the word>" (copied from the timing file)
export const shots = [ /* camera shots, § Shots */ ];

export default {
  ground: GROUND,
  shots,
  draw(t) {
    scope('f04-', GROUND);
    const state = { /* this moment's values, from STATES */ };
    return shotFrame(t, shots, (shot, local, i, { P }) => {
      const R = rig(P, { ground: GROUND, ...LIGHTS(state, shot.place) });
      const set = ROOM(P, R, state, shot.place); // a shot set elsewhere names its place (world.js SETS)
      const cast = Object.entries(LENS).map(([id, draw]) => draw(P, R, state, poseOf(id, t, shot)));
      return [render(P, { env: set.env, items: [...set.items, ...cast], shot, local }) + labelsOf(P, shot, t)];
    });
  },
};
```

`poseOf` returns each entity's pose for the moment (a critter's intent with world targets, an
object's state flags, `focal: true` on the beat's focal); `labelsOf` returns the shot's
`labelFor(...)` labels. A tech frame returns its flat parts from `shotFrame` (crop shots) or
`frame(t, { camera }, parts)` (one framing), starting with `glassGround()`; frame 3 adds
`dictionaryCard(…).svg` after its visual. `mount.mjs` writes the composition around the module;
never write `compositions/frames/*.html`. Every frame also writes its events file. New objects: in
a perspective shot, a function in the module returning `{ id, at, svg }` from lens solids at its
real size, joined to `render`'s items; on the isometric camera or in a glass frame, `NEW_PROPS` in
`assets/frames/<frame id>.props.js` with full tags (EX3-114), drawn with `propFrom()`.

## The build checks (what `try.mjs` and `bounds.mjs` hold every frame to)

The orchestrator runs `node assets/kit/try.mjs` and `bounds.mjs`; a failing frame goes back to its
worker with the exact errors.

- **Every frame:** `draw(t)` returns a clean SVG string (no `NaN`, `undefined`, unbalanced tags);
  a valid events file; every drawn critter's look matches `CAST`, no critter drawn twice at one
  moment, no two individual critters on screen alike; the rig (`data-rig` codes from
  `riggedProblems`) clean on every critter; orange only on the hero and the focal; the hero only in
  frames 1, 4, 5 and a frame-7 callback.
- **Scene frames** (1, 4, 5, 7 with `anchor: scene`): `validateShots`, `cutProblems`,
  `dofProblems`, `crowdProblems` (≤ 3 critters, only the shot's cast), `labelProblems`,
  `framingProblems` (the subject whole in the safe area at each shot's first and last moment),
  `occlusionProblems` (no critter more than 15% hidden), and the set (`setProblems` on what the
  frame draws: floor, walls and a corner or an opening, the three layers, materials, the brief's
  tells, no orange). The hook keeps its contract (`hero`, `hideHero`, `heroPose`, no title card).
- **Tech frames** (2, 3, 6, 7 with `anchor: own`): the `// technique: <id> — <reason>` header in
  the first lines (frame 3 too); every `data-concept` matching `identity.js` (same icon, color and
  shape; a concept outside the map is an error); `emptyShellProblems`; read text ≥ 34px and inside
  the safe area (`safeProblems`); the fill check (`techFillProblems`, thresholds in try.mjs `FILL`,
  calibrated on the Phase 1 frames: at the held end the content covers at least 18% of the safe
  area, at least 8% of each third, with at least 6 readable texts; on frames 2, 6 and a glass 7 a
  number or a state changes, or at least 3 more readable texts build up over the frame); frame 3
  draws the dictionary card (`data-role="definition"`).
- **The world** (`try.mjs world`): `SET` passes `setBriefProblems`, `ROOM` builds it
  (`setProblems`, every brief tell), `identity.js` exists and loads, `SIZES` (and `DRAWN` when there
  are isometric drawings) hold to the scale ledger, every `CAST` outfit draws, clear of the face and
  never orange, and every `LENS` function returns `{ id, at, svg }`.
- **`bounds.mjs`** measures every piece of text every 0.2s in a browser: text cut off by the frame
  edge, outside its box, or in a keep-out goes back to the worker. Set text may run into the
  caption band or off the frame, but never over the focal or other readable text.

## Look at your own work (EX4-155) · HARD CONSTRAINT

Passing the try is not the bar; the picture is. The scene builder and every frame worker render
stills of their own work and look at them as a stranger would:

- `node assets/kit/snap.mjs world` (the scene builder): the set and the entities at their start
  states through world.js `VIEWS` (or two default eye-level views), to `.hyperframes/snaps/world-<n>.png`.
- `node assets/kit/snap.mjs <frame-id> <t1,t2,…>` (frame workers): up to 6 times a call, seconds into
  the frame, to `.hyperframes/snaps/<frame-id>-<t>.png`. Snap just after every shot change and at
  the frame's end.
- At most 4 calls per frame id (and 4 for `world`; a call where the frame threw is not counted); the command prints JSON with `files`: Read
  every file it lists.

Critique each still with principles.md § 7's seven questions: Do I know where we are? Do I know who
the named character is? Does every pose read as an action, is every face whole? Is anything
floating, cut off, overlapping or crowded? Does the picture show exactly what the voice says right
now? Would this cut feel like a jump? Does the tech beat show the idea moving, or only label it?
Fix what fails, snap again, **at most 2 revision rounds**, then report in your last message,
plainly, anything you could not fix. Those two commands are the only ones a builder runs.

## Numerals and claims · HARD CONSTRAINT

Never invent figures, dates, counts or claims. Every number on screen comes from `SCRIPT.md`, the
storyboard or `STATES`; with a source, nothing on screen contradicts it.

## Font loading

Fonts ship as local files in `assets/fonts/`. Do NOT link Google Fonts. `mount.mjs` writes this
`@font-face` block into every frame composition, so SVG text resolves in preview, snapshot and
render alike:

```html
<style>
@font-face{font-family:"Pragmatica Extended";font-weight:700;font-style:normal;font-display:block;src:url("assets/fonts/PragmaticaExtended-Bold.otf") format("opentype");}
@font-face{font-family:"Roboto";font-weight:300;font-style:normal;font-display:block;src:url("assets/fonts/Roboto-300.woff2") format("woff2");}
@font-face{font-family:"Roboto";font-weight:400;font-style:normal;font-display:block;src:url("assets/fonts/Roboto-400.woff2") format("woff2");}
@font-face{font-family:"Roboto";font-weight:500;font-style:normal;font-display:block;src:url("assets/fonts/Roboto-500.woff2") format("woff2");}
@font-face{font-family:"Roboto";font-weight:700;font-style:normal;font-display:block;src:url("assets/fonts/Roboto-700.woff2") format("woff2");}
</style>
```

## Known gaps

- Pragmatica Extended ships Bold only; emphasis is orange text or size.
- Drawing quality varies by builder; the self-review loop and the required picture check catch
  weak, look-alike or wrongly sized pieces, floating props, faceless critters and jump cuts.
- Heavy blur and many glows cost render time; depth of field only with a reason.
- 16:9 and 1:1 are not designed for; this preset is 9:16 only.
