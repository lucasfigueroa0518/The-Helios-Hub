---
version: helios-explainer-v11
name: Helios — Explainer Reel frame (Explainers 4.0, hx-4)
description: >
  Helios Explainer Reels look made by an amazing animation team: premium, modern, soft 3D, tactile
  and full of effort. Soft lit volumes on a warm studio sweep (or the Helios premium stage for dark
  scenes), one room and one camera with real depth, everything at its true size, critters dressed
  for their role, light that moves, motion with weight, one thing in Helios orange, and big
  lowercase captions at the top. The real-tech beats are crisp glass-and-gloss UI motion. Every
  object is drawn to fit its scene; the asset bank is reused only for an exact fit. Scenes cut
  between shots. No photos, stock footage, people, body parts, or pre-made illustration. Every
  moment of motion has a sound. The look: planning/Explainer Reels/VISUAL_SYSTEM_4.md (approved by
  Lucas 2026-10-26); decisions: planning/Explainer Reels/DECISIONS.md.
unit: the frame — 1080×1920 (9:16); every scene is SVG in frame pixels, every world entity placed in centimetres
principle: one idea per beat · one read at a time · orange marks the one thing to look at · the picture explains

colors:
  # paper and ink: the quiet context
  paper: "#F3F0EA"
  paper-lit: "#FBFAF6"
  paper-shade: "#E2DACB"
  paper-dark: "#CFC5B3"
  canvas: "#FFFFFF"
  ink: "#171717"
  ink-lit: "#2B2926"
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
  green-lit: "#1BBF17"
  green-shade: "#0F6E0D"
  green-dark: "#0A4F09"
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
  # the stage ground (premium lit stage) and the Helios sun
  stage-top: "#161616"
  stage-bottom: "#0B0B0B"
  stage-orange: "#FF6A2A"
  stage-red: "#E8413B"
  sun-top: "#FDC60F"
  sun-mid: "#F48C3F"
  sun-bottom: "#EA3C3A"
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
    description: "The ONE entity per beat the viewer must look at: an orange object, an orange critter, or the orange part of an object (its accent face or marking), drawn in the orange ramp (orange-lit, orange, orange-shade, orange-dark) with gloss. Exactly one per beat. When the focal moves to another entity, the orange moves with it, except the hero critter, which keeps its orange wherever it appears: frames 1, 4, 5 and a frame-7 callback; frames 2, 3 and 6 never show it (EX3-107, EX3-132)."
  solid:
    description: "A soft 3D volume standing on the floor plane (box, slab, disc, cylinder, sheet, extrusion): faces graded from the key light (top right), rounded edges with a bright highlight on the lit edges, no outline, a soft contact shadow and ambient occlusion where it meets the surface below, gloss where the material is glossy. Placed in centimetres with space.js and drawn with the kit's isoBox, isoDisc, onPlane, shadow, gloss."
  label:
    typography: "{typography.label} or {typography.dimension}"
    description: "A short label pinned to the object it names: a number, a status, a name, a real term. 5 words or fewer. Shown as the voice names it. A dimension label runs along an isometric axis with a green dimension line that draws itself out."
  critter:
    description: "THE cast (EX3-77): every character is a critter from the kit's cast.js (Critter 2.0, a soft 3D body with glossy eyes), never a person, a figure built from solids, or a body part. A critter does whatever someone does in the analogy: it holds, writes, reaches, feels its way, points, carries, sits, walks. Poses (arms), moods (brows, eyes, mouth) and its outfit, drawn for its role, tell who it is. Its body and outfit are its look, fixed for the whole reel by world.js's CAST (EX3-107): the hero is the one orange critter, shown only in frames 1, 4, 5 and a frame-7 callback (EX3-132), and no critter is ever redrawn in another body or outfit. A critter is 72 cm tall: the scene's ruler. handAt() puts a prop in its hand. Its gaze points at the read."
  outfit:
    description: "A critter's clothes, drawn for its role in this reel (cast.js `outfit`): a top that wraps the body below the face (scrubs, a coat, a waistcoat, a vest…), sleeves, trousers, shoes, at most one head piece, and one or two tools of the trade in place (a stethoscope, a badge, a tray…), or a one-off garment drawn with `custom`. The stock `wear` list is used only when an item is exactly the role's own. Nothing covers or crowds the eyes or mouth (EX3-103); glasses are the one thing worn over the eyes."
  prop:
    description: "An object from the kit's asset bank (props.js and props/bank, EX3-78, EX3-112): drawn in the soft 3D style, with its states (a switch on or off, a door open or closed), an orange focal part, and tags saying exactly what it is, where it belongs and what it is never a stand-in for (props/CATALOG.md). prop(name, x, y, { s, state, focal, flip }). Reused only when its tags say it is exactly the thing the scene shows, in the scene's setting; otherwise the object is drawn new. Its scale comes from its real size, like every entity."
  container:
    description: "Anything that holds something (a fridge, a mailbox, a jar, a drawer): space.js container({ clip, back, contents, front }). The contents are clipped to the opening and drawn between the back and the front, so the frame and shell always cover them. Inside means behind the frame."
  magnifier:
    description: "space.js magnifier({ from, at, r, zoom, draw }): a lens inset with a zoom cone that redraws a tiny thing (a splinter, a chip, a pin) large enough to read, while the thing itself stays its true size in the scene."
  shot:
    description: "A camera on the scene (shots.js, EX3-83, EX3-90): wide, medium, close, insert (a tight camera on one object), reaction (a critter's face). A scene frame lists its shots and hard-cuts between them on voice cues; every shot shows the same scene with everyone in it, centred on what the voice names, in parallax layers with depth of field."
  glass:
    description: "The real-tech frames' components (glass.js): phone, chatBubble, glassCard, glossTile, pill, route, packet, uiIcon, on the soft studio light of glassGround(). Frosted glass, glossy tiles, hairlines, crisp UI motion on the brand ease-out. Frames 2, 3 and 6, and frame 7 when it shows the real thing."
  title-card:
    description: "Frame 1 only (EX3-80), drawn by the bank's opener (EX3-102) once its break is over, never by a frame worker: the kit's titleCard(), in glass and gloss. A card in the top band (y 250–530, where captions would be) slides in and writes 'today's brain break:', then the term in orange beneath, larger, finished by the end of the opener line. The hook keeps playing below, undimmed. Its group carries data-role=\"title\". Captions are quiet for all of frame 1."
  dictionary-card:
    description: "Frame 3 only (EX3-80): the kit's dictionaryCard(), in glass and gloss. The top half (from about y 270): a dictionary entry, its headword the topic's term (Pragmatica Extended), its part of speech in Roboto 700 caps, green, then the definition in Roboto 500 laid out from measured font widths, filling in word by word on its voice times and staying. Its group carries data-role=\"definition\"; it returns its bottom edge. Below it: a visual of what the definition says, built from glass.js, revealed with its key words. Captions are quiet for the frame."
  step-tracker:
    description: "Frame 6 only. A numbered rail along one edge of the safe area, built from glass.js (a hairline route with a glossy pill per stop). Its stops are the anchor scene's steps' technical names (world.js STEPS, the `technical` side, EX3-129), 4 words or fewer each, Roboto 700 or Pragmatica label size; the example walks the same steps, one example_steps entry per stop. Stops light (the current one in green, done ones ink, upcoming ones at 25%) on their voice cue while an insert shot shows that example step's real thing (EX3-87)."
  text-box:
    description: "Text inside a shape (cards.js textBox(), EX3-92): a speech or chat bubble, a note, a sign or a screen, sized around the measured text so the text never leaves it. textBox(text, x, y, { kind, size, maxW, focal, progress, scale }) returns { svg, box }. The glass components measure their text the same way."
  close:
    asset: "assets/Helios-logo.png"
    description: "The last frame only, the kit's close.js (EX3-95), built by code: 2.5s, a white screen, the Helios logo animating in and 'AI BRAIN BREAK' writing itself beneath it in Hershey Sans. No voiceover."
---

# Helios — Explainer Reel frame (Explainers 4.0, hx-4)

## Overview

**The bar.** Every frame looks like an amazing animation team put it together: premium, modern,
soft 3D, tactile and full of effort. Soft lit volumes stand in one room seen by one camera, at
their true sizes; critters wear outfits drawn for their roles; light moves with the story; every
move has weight; one thing is in Helios orange; a big lowercase caption sits at the top. The
real-tech beats switch to crisp glass-and-gloss UI motion. **The style is how things are drawn,
never what is drawn**: every reel's analogy is its own world, built from objects drawn for it (and
critters when someone acts), reusing the asset bank only for an exact fit, all drawn in this
style. Failure looks like: a person or a hand built from boxes, an object a stranger cannot name,
sizes that make no sense (a carton as big as a store, tweezers as big as the critter), a costume
from the wrong job, a scene whose space does not add up, generic corporate icons, a list or a
slideshow, a busy frame, the same picture shown four times, the old grainy hand-drawn look, or a
camera that never stops moving.

Every rule in this file is mandatory. Rules marked HARD CONSTRAINT fail the frame outright when
broken. The rule ids (V-…) are the ones the kit's code comments cite.

## The frame · HARD CONSTRAINT (V-T3)

On the 1080×1920 frame:

- **y 0–250:** Instagram's Reels header. Nothing readable of ours.
- **y 250–570:** the caption band. The world may run behind it; nothing readable of the world.
- **y 1600–1920:** Instagram's username, caption, and audio line. Nothing readable of ours.
- **x 940–1080:** Instagram's action buttons. Nothing readable of ours.
- **Safe area:** x 96–940, y 570–1600.

The world (the ground, the room, its back and front layers) runs full-bleed. The focal, every
label, every number, the opener's title, and the logo sit inside the safe area at every landing
pose and hold. Things may cross the edges while they move.

## Colors · HARD CONSTRAINT (V-T1)

Every color on screen is one of the frontmatter tokens, a mix of exactly two of them, or a
gradient the kit draws from them (a solid's shading through its own ramp, the grounds, the sun),
at any opacity. The kit's `T` holds
them; a scene never writes another hex. No other hue exists. Light adds no new hue: highlights are
a ramp's lit step, `paper-lit` or `canvas`; glows take the color of what glows.

- **Each hue has a job.** Paper and ink are the quiet context. **Orange** is the hero and the one
  focal. **Green** marks labels, dimension lines and signposts. **Yellow** is light, signs and the
  payoff (a lamp, a lit sign, the glow as the answer lands). **Blue** is screens, data and the real
  tech. **Teal** dresses the secondary cast (outfits, uniforms) and cool objects (water, ice,
  steel). **Lilac** is one accent per reel, for the one thing that must stand apart from
  everything else. A hue never does another hue's job.
- **Color hierarchy.** The eye goes to orange first, green second, the rest after. Nothing
  competes with the focal: no other hue is larger, more saturated or brighter than it in the
  shot.
- **Ramps.** Every hue except the status colors is a 4-step ramp (`-lit`, base, `-shade`,
  `-dark`). A soft volume runs through its own ramp, lit toward the key light; it never borrows
  another hue's steps.
- **Status colors** carry their universal meaning and nothing else: red for error, rejection and
  destruction; a bright green for success; yellow for warning; blue for information. Only on the
  signal that carries the status (a light, a badge, a flash, a tick or cross, the object in the
  moment it fails or passes), never as a ground, never as decoration, never on large areas, one at
  a time. The orange focal still leads.

## Grounds · HARD CONSTRAINT (V-14)

- **`paper`** (the default): a warm studio sweep, `paper-lit` at the top falling to a warm
  `paper-shade` low, with a soft floor falloff and a faint warm bloom from the key light top
  right. No grid, no grain.
- **`stage`**: the Helios premium lit stage, `stage-top` to `stage-bottom` under a warm
  `stage-orange` glow top right, a faint white lift top left and a `stage-red` bloom low. Every
  solid and critter takes a rim light. For dark, tense or night scenes.
- **`white`**: the close only.

No other ground exists; `night` and `forest` are gone (the kit draws them as `stage` so old
projects still render, and the storyboard lint rejects them). The real-tech frames stand on
`paper` (§ Real-tech frames). On `stage`, lines and critters swap to light-on-dark by themselves
(the kit's `line()`, `TONES`, `scope()`). The ground changes only at a cut or through a motivated
light change in the world (§ Light), never by a fade. Each frame's ground is its storyboard
`ground:` field, and its scene module's `ground` matches it.

## Typography · HARD CONSTRAINT (V-T2)

Pragmatica Extended Bold for captions, figures, the title and primary labels; Roboto for
secondary labels and UI text. No other faces. Pragmatica ships Bold only: hierarchy comes from
size, case, and color. Load-bearing text is never under 30px on the 1080-wide frame and holds
4.5:1 contrast against what is behind it. Numbers stay numerals.

## How things are drawn

### V-2 · One room, one camera, real depth · HARD CONSTRAINT

The world is one room seen by one camera: one floor plane in the kit's isometric projection (30°,
`iso()`), the same for every frame of the reel. Every entity is placed in centimetres on that
floor with `space.js` (`scene({ ppcm, origin, P })` → `at(x, y, z)`, `size(cm)`), so where things
stand and how far apart they are makes physical sense, and everything is drawn back to front
(`depthSort()`). Objects stand on the floor or on each other: nothing floats, nothing sinks,
nothing is drawn over a thing in front of it.

Depth comes from the projection, from overlap and contact shadows, from the soft light (V-3),
from **parallax layers** and **depth of field**, and from cutting between camera distances. A
frame returns its picture as three layers, `{ bg, mid, fg }`: the camera moves `bg` at 0.35×,
`mid` at 1× and `fg` at 1.8× of its motion, and `bg` and `fg` are softly blurred unless the
camera's `focus` is on them. The scene lives in `mid`; `bg` holds what is behind it (a back wall,
a window, the far end of the room); `fg` holds at most one near thing passing the lens, or
nothing. There is no vanishing perspective, no horizon line and no free 3D camera.

**Containers** (`container({ clip, back, contents, front })`). Inside means behind the frame:
whatever is inside something (a carton in a fridge, a letter in a mailbox, a coin in a jar) is
clipped to the opening and drawn after the container's back and before its frame and shell, so
the container's edges always cover it. Contents never cross a container's border.

### V-3 · Soft 3D: one light · HARD CONSTRAINT

One key light, from the **top right** (`LIGHT.key` in `core.js`), the same in every frame. Every
solid is a soft volume: its faces graded through its ramp toward the light, rounded edges with a
bright highlight on the lit edges, **no outline**, a soft contact shadow and ambient occlusion
where it meets the surface beneath (`shadow()`), and gloss on glossy materials (plastic, glass,
screens, enamel, the critters' eyes; `gloss()`). Matte things (cloth, paper, wood) carry no gloss.
On `stage`, every solid and critter also takes a warm rim light on its lit side and a cool
counter-rim on the other (`rim()`), and the stage's own glow sits behind them.

Lines remain only where a line is the thing: printed detail on a surface (seams, ticks, writing,
a small icon), handwriting, dimension lines, routes. They use `line()` (or `T.ink` on a light
surface). There is no grain, no grid, no stipple, no line wobble and no ink outline on solids.

### V-4 · Objects drawn to fit, at their true size; critters dressed for the role · HARD CONSTRAINT

**Characters are critters** (EX3-77): whoever acts in the scene is a critter from `cast.js`. Never
draw a person, a figure built from solids, or any body part; a critter holds the thing, writes the
line, feels for the switch. Critters are the only characters, never the default: a scene shows
one only when someone's action or reaction carries the mechanism. Objects that act on their own are
actors too, staged with the same care: a clear silhouette, a visible cause, and a state change the
eye can follow (EX3-109).

**Outfits are drawn for the role** (Lucas, 2026-10-26: "A triage nurse … wearing a baseball cap.
That's horrible!"). Every critter with a role wears an outfit drawn for that role in this reel,
through `cast.js`'s `outfit` (`{ top, sleeves, pants, shoes, head, items, custom }`): a top that
wraps the body below the face, sleeves, trousers, shoes, at most one head piece, and one or two
tools of the trade drawn in place; a garment the kit's kinds do not cover is drawn once with
`custom`. A stranger names the role at a glance from the outfit alone. The stock `wear` list is
used only when an item is exactly the role's own (a chef's hat on a chef), never as the nearest
thing. Nothing a critter wears covers or crowds its eyes or mouth (EX3-103): no mask, blindfold,
hood, visor, sunglasses, or scarf over the mouth, and no brim across the brow; glasses are the one
thing worn over the eyes. Orange is never an outfit color: the hero's orange is its body. A
critter's body and outfit are its look, locked for the reel (§ Focal).

**Everything is at its true size** (Lucas, 2026-10-26: sizes were "preposterous"). Every world
entity has a real size in centimetres, written once in world.js's `SIZES` (`{ <id>: { w, d, h } }`),
and the scene has one scale (`ppcm`, pixels per centimetre): a critter is 72 cm tall
(`CRITTER_CM`), the ruler everything else is measured against. Story exaggeration is allowed up to
**1.5×**, written in the ledger as `exaggerate`, never more. A held prop is sized from the
critter's real size (`heldScale(propCm)`), never drawn huge to be seen. A thing too small to read
at its true size (a splinter, a chip, a pin) is shown through a `magnifier()` inset or an `insert`
shot, never enlarged in the scene. `try.mjs` checks the ledger (`scaleProblems`).

**Everyday objects are drawn to fit the scene** (EX3-112; Lucas, 2026-10-22: "I never want this
stand-in look"). The asset bank (`props/CATALOG.md`: each asset's `is`, `setting`, `parts` and
`not` tags) is reused only for an exact fit: the same thing, in the same setting, at the same
detail. A clinic's reception desk is not a dining table; supermarket shelving is not a bookshelf.
Anything else is drawn new, which is the usual case. Name each new drawing as specifically as a
stranger would name it at a glance in this setting ("a surgeon's scalpel: thin steel handle, small
curved blade", never "a huge tool"), and draw its signature parts so it can't be mistaken for its
look-alike (a scalpel, not a kitchen knife). It is drawn in this style:

- **built or contoured as a soft volume:** boxy things from the kit's solids on the floor plane;
  organic and curved things (a leaf, a cloth, a round body) as soft-shaded filled shapes
  (`props/kit.js`: `shape`, `shade`). Either way, V-3's light, edges, shadow and gloss;
- **a stranger names it in one second at phone size, without a label** (EX3-74): its silhouette
  and its signature features carry it (a mailbox has its flag and slot, a scale its two pans, a
  door its handle and hinges); if it would need a label to be read, redraw it until it doesn't;
- detail lives **inside** it, as marks printed on its faces (seams, ticks, slots, writing, a small
  line icon), never as extra loose parts; the focal carries the most detail;
- anything organic is **simplified**: a plant is a few leaf shapes on a pot; anyone is a critter;
- it **moves with weight** (§ Motion principles): anticipation, squash and stretch, follow-through.

A new object passes the blind picture check (a stranger names it, as specifically as it was
meant) or it is redrawn. Every new drawing the check names exactly joins the asset bank on its own,
with its tags (EX3-114). Never pick an analogy because a piece already exists.
**At most three readable things are on screen at once** (EX3-117; a critter counts as one, and a
group of identical things counts as one); a group has at most four members, never a crowd.
Detail printed on a light surface (seams, writing, ticks) is ink (`T.ink`), so it never vanishes
on a dark ground; other lines use `line()`.

**Frame scale (EX3-74) · HARD CONSTRAINT.** The anchor scene spans at least 60% of the safe-area
width (about 510px of the 844px) at rest; the focal is at least 20% of the safe area; nothing
readable crosses x 96–940 or y 570–1600 at rest. The camera, never the object, makes a thing big:
true sizes hold, and closer shots bring the small things forward. Small, distant scenes are the
failure the picture check catches first. Line icons appear only as small markings on a drawn
object or inside a glass component (`uiIcon` in a tile, card or pill), never as the picture
itself.

### V-15 · Smooth motion and determinism · HARD CONSTRAINT

A frame is SVG, redrawn each tick as a pure function of frame time `t` (one clock; any seek
renders the same frame). Motion is smooth at the full frame rate: no boil, no line wobble, no
drawn-on-twos stepping (`onTwos(t)` returns `t`). No unseeded randomness, no clocks, no state kept
between calls.

### V-16 · Built from the kit · HARD CONSTRAINT

Colors from the kit's tokens; the light from `core.js`'s `LIGHT` and `light.js`; space, scale,
containers and magnifiers from `space.js`; the volumes from `draw.js` and `props/kit.js`; critters
and outfits from `cast.js`; the camera, its layers and depth of field from `motion.js`'s `frame()`
and `shots.js`'s `shotFrame()`; moves from `motion.js`; the real-tech components from `glass.js`;
cards and text boxes from `cards.js`. Every anchor-scene entity is one drawing function in
`assets/world/world.js`, with its `SIZES` entry, reused by every frame that shows the scene. A
frame never draws its own version of a world entity, a second camera, a second light, or a second
token set.

### V-17 · What never appears · HARD CONSTRAINT

Photos, stock footage, emoji, unicode glyph icons, real brands or logos other than Helios, real
people's likenesses, people or human figures of any kind, body parts (hands, arms, fingers, faces,
heads) as objects or actors, infographic templates, bullet lists, node-and-arrow slides,
headlines, narration sentences on screen, and the old hand-drawn texture (paper grain, grids,
stipple, wobbling lines, ink outlines on solids).

## Light (light as motion)

Light is part of the action, the way an animation team lights a shot: it shows where to look, it
tells the viewer how the moment feels, and it changes when something in the world changes it.

- **The key light never moves**: top right, every frame. What moves is what light does in the
  world.
- **The kit's light** (`light.js`): `lightWedge()` a soft wedge of light cast through an opening
  (a door opening, a window, a lamp); `rim()` a rim along a silhouette; `glow()` a soft glow
  around a source (a lamp, a screen, a sign); `glint(clipD, u)` a specular band sweeping across a
  glossy face as `u` goes 0 → 1; `glowSign()` a sign that lights; `level(t, keys)` a light level
  over time.
- **Every light change is motivated** by the story: a door opens and its wedge falls across the
  floor; a screen wakes and glows; a sign lights as the voice names it; the room dims as tension
  builds and lifts as the answer lands. Never a light that pulses for nothing (V-6).
- **A glint marks a moment**: one sweep across the glossy thing as it lands, is revealed, or
  becomes the focal; at most one glint at a time.
- **The read gets the light**: the payoff lands in the warmest light of the reel (a yellow glow,
  a level lift); on `stage` the current read sits in a soft pool of warm light (`glow()`).

## The anchor scene (V-1)

The everyday analogy is one scene the whole reel revolves around (EX3-15). STORYBOARD.md's
`## Anchor scene` defines it once: metaphor, setting, ground, hook (the opener's moment), steps
(each with its analogy action and its technical name), entities (what each is, what real
component it stands for, how it is built, its real size), states, layout. The scene builder turns
it into `assets/world/world.js`. Then:

- every entity is drawn by its one function, at its true size, and looks the same in every frame
  it appears in;
- every entity sits where `LAYOUT` puts it, in centimetres on the one floor;
- every number, position, fill, label and outcome on screen comes from `STATES` and changes only
  by its rules;
- a frame that shows the scene starts in the state the previous scene frame ended in (the cut
  between them is a continuity cut);
- an entity enters only when the narration needs it, and never disappears without a cause the
  viewer sees.

Reusing the scene gains the viewer's cached understanding: they already know the objects, so the
next idea costs them less. That is the trade-off every `anchor:` choice weighs.

## Shots: same scene ≠ same shot (V-24, EX3-83) · HARD CONSTRAINT

The anchor scene returns in beats 1, 4 and 5 (and frame 7's callback), so the picture must change: a scene frame is a
list of **shots** that hard-cut on voice cues (`shots.js`), each framing the scene differently.

| kind | what it shows |
|---|---|
| `wide` | the whole scene (establishing); used once, at beat 4's opening |
| `medium` | two or three entities and what passes between them |
| `close` | one entity and its state, 2–3× |
| `insert` | a tight camera (zoom 2.2 or more) on one object (the switch plate, the card in the jar); the rest of the scene falls out of frame |
| `reaction` | a critter's face, its mood carrying the moment |

**A shot is only a camera** (EX3-90) · HARD CONSTRAINT. Every shot draws the same scene with
every entity in it; the camera only chooses what is in view. Never skip a critter or an object
for a shot (3.2's insert dropped the critters while the voice said "the hire pulls"), never add a
second copy of one (3.2's over-the-shoulder shot drew the hire twice), never mirror the scene.
When the voice names a critter doing something, it is in view doing it. Every critter carries its
world id (`critter({ who })`); the try errors on a critter drawn twice at one moment or one that
vanishes mid-frame and comes back.

**Shots follow the voice** (EX3-91): each shot is centred on what the voice is naming while it is
on screen (aim `on:` at that entity's `SUBJECTS` point). Variety comes from the shot kind, never
from pointing away from what is being said.

- Every frame longer than 6s has **at least 2 shots**, with a cut every 2.5–4s (a shot runs
  1.5–4.5s); a shorter frame may be one shot.
- **No frame opens on the same shot kind and subject the previous frame ended on.**
- Beats 1, 4 and 5 each use at least one shot kind the others don't.
- Inside a shot the camera stays calm (a push of at most 1.2×); the cut does the reframing. The
  parallax layers make even a small push read as depth.
- Closer shots (zoom above 1.25) get the kit's caption-band wash automatically (`shotFrame`):
  the band behind the captions fades back toward the ground, so enlarged objects never fight the
  caption. Keep the subject in the safe area; never rely on the band for anything readable.
- Cuts land on voice cues (the word that names the next subject) and on action.

## Focal (V-5) · HARD CONSTRAINT

Each beat has exactly one focal entity: the thing the viewer must look at. It is the only element
in the orange family (the opener title's concept word is outside the world and does not count),
with one exception: **a critter hero keeps its orange wherever it appears** (with an object hero,
no critter is orange and the hero object carries it) (EX3-107; Lucas, 2026-10-21:
"Character looks should be locked across frames"). A viewer follows a character by its look, so
no critter's body or outfit ever changes during the reel (world.js `CAST`, checked by
`try.mjs`). When a beat's focal is another entity, it takes orange too, and that is the only time
two oranges share the screen; other critters never turn orange. **The hero appears only in the
analogy's frames** (EX3-132): frames 1, 4 and 5, and a frame-7 callback. Frames 2, 3 and 6 show
the real thing and never draw the hero, a copy of it, or anything in its look (`try.mjs` checks
it); their focal takes the orange.
It dominates its nearest neighbor by 3× or more in size, contrast, light or motion. Camera, light
and motion deliver the eye to it within 0.5s of the beat's start. The focal changes only at a beat
boundary.

## Motion

### V-6 · Motion has a job · HARD CONSTRAINT

Every motion is one of:

- **semantic:** the motion communicates the idea (a stamp prints the whole block at once);
- **anticipatory:** the motion creates an outcome to await (the coin teetering at the edge);
- **state-driven:** a rule produces a visible consequence (a line is written; a light turns on);
- **camera:** the camera moves attention to what matters next.

Decorative motion is forbidden: idle floating, random particles, wiggles with no cause, light
that pulses for nothing. Two things are not decoration: character life (critters blink, breathe
slightly, and glance; context critters stay nearly still while something is being read), and the
opener's build into the cut.

### V-8 · Polarity: the speed curve

Every major move uses a named curve from the kit (`E` in `motion.js`), matched to its meaning:
`slam` (fast in, hard stop: arrivals, impacts, verdicts), `snap` (instant, tiny overshoot: state
flips of world objects, counters), `ramp-up` (slow start, accelerating: build-ups that end in an
impact), `glide` (slow, fast, slow: repositioning), `spring` (overshoot and settle: things with
weight), `reverse` (goes, then pulls back: refusals, rejections), `drift` (near-constant: a
tension hold only). A world move with no stronger meaning eases in and out (`E.world`). Titles,
UI and the camera take the brand ease-out (`E.ui`, `cubic-bezier(0.16, 1, 0.3, 1)`) and never
overshoot or bounce.

### Motion principles · HARD CONSTRAINT

The world moves the way a great animation team moves it (`motion.js`):

- **Anticipation** before every big action: a wind-up before the shove, a crouch before the jump,
  a lift before the slam.
- **Squash and stretch that keeps the volume**: a thing squashes on impact and stretches as it
  speeds up, its width and height trading so its area holds (`squash(u)` → `{ sx, sy }` with
  sx·sy = 1; a critter takes it as `squash`). Rigid things (a phone, a steel tool) never squash.
- **Follow-through and overlapping action**: when a mover stops, what hangs from it (a lanyard, a
  towel, a tie, a sign on a hook) swings on and settles (`follow()`); the parts of a move never
  all stop on the same frame.
- **Arcs**: thrown, falling and jumping things travel on arcs (`arcPath()`), never in straight
  lines.
- **Eased timing**: every move eases (V-8); linear motion is only for handwriting and a `drift`.
- **One smear frame** on a move faster than about 4 frames: the mover stretches along its path for
  one frame (`smear()`), so the eye reads the speed.

### V-9 · Speed ramps

Where it serves the moment (no minimum): at speed, then slow motion through the consequential
instant, then back to speed (the kit's `makeWarp`). The slow section sits exactly on the moment
the viewer is anticipating.

### V-7 · The camera · HARD CONSTRAINT

One camera frames the room (`frame(t, { camera, focus })`): position, zoom, a little roll, and
which layer is in focus. It is calm and motivated: the energy comes from the objects, the light,
the cuts and the sound, never from throwing the frame around. Every frame has gentle camera motion
(a drift or a slow push or pull, its parallax giving the room depth); at most one sharp move (a
punch) per beat, on its key moment; no single move changes zoom by more than 1.2×; roll within 3°;
no tilt; every move eases out (`E.ui`) or punches (`slam`), never springs; every move follows the
action, reveals a consequence, or carries the eye to the next focal. A focus pull (moving `focus`
from `mid` to `fg` or `bg`) counts as a camera move. The one exception is the attention reset at
the 1→2 cut (below), which may punch harder.

## Real-tech frames: glass and gloss · HARD CONSTRAINT

Frames 2, 3 and 6, and frame 7 when it shows the real thing, show the real technology the reel
teaches. They are built from `glass.js` on the paper studio ground (`ground: paper`, the soft light
of `glassGround()`): crisp UI motion, the way a premium product film shows software. The analogy's
frames (1, 4, 5 and frame 7's callback) stay in the soft 3D world.

- **Components:** `phone(x, y, { w, h, title, children })`, `chatBubble(text, x, y, { from, maxW })`,
  `glassCard(x, y, w, h, { title, sub, icon, state, accent })` (`state`: `picked`, `idle` or
  `plain`), `glossTile(x, y, size, { icon, color })`, `pill(text, x, y, { dot, color })`,
  `route(points, { color, progress, glow, dashed })`, `packet(points, u, { color })`,
  `uiIcon(name, x, y, size, { color })`. Frosted glass, glossy tiles, hairlines; nothing else is
  drawn as UI.
- **Motion:** UI elements arrive with short, crisp moves on the brand ease-out (`E.ui`): a slide of
  a few dozen pixels with a fade, a scale from 0.96, a route drawing itself on with a `packet`
  riding it, a card switching to `picked` (it lifts and its accent glows) while the others go
  `idle`. No overshoot, no bounce, no squash on UI.
- **A route is a real path something travels**, drawn as it moves (a packet riding it), never a
  static diagram of boxes and arrows (V-17).
- **Colors keep their jobs** (V-T1): blue for screens and data, the focal tile or card in orange,
  green for a lit step, yellow for the light of the payoff.
- **Physical things stay soft 3D**: when the real thing is a device or an object (a server, a
  card reader), it is a soft volume like any object; its screen and data are glass. A critter
  appears only when someone acts on the real thing (the one holding the phone), in its own look;
  the hero never does.
- **Text** inside a glass component is measured like `textBox()`, so `bounds.mjs` checks it;
  never place text in a component by hand.

## Space and reading

### V-22 · One read at a time · HARD CONSTRAINT

The frame is never busy. At every moment the viewer has exactly one thing to read: the caption
(while the voice speaks), or one short label (the thing the voice just named, or the real job of
the part frame 4 is naming), or the focal doing its action, or one of the designed cards (the title card, the
dictionary card) while captions are quiet.

- **Sequential reveal.** Elements arrive one at a time, in reading order, each after the previous
  had time to be read (about 0.3s per word for type, at least 0.6s for an object's action). A read
  element steps back (dims, shrinks, or leaves) before the next takes the lead.
- **Context stays quiet.** Everything that is not the current read is dimmed toward the ground
  (labels and marks on context objects at about 25% opacity) and still.
- **The read gets the light** (§ Light): on `paper` it sits on clear ground in the key light; on
  `stage` a soft pool of warm light lies under it.
- **Gaze.** Critters on screen look at the read.
- **Choreography.** Lead with the hero, then its context; with three or more animated elements, at
  most a third move at once; supporting elements move less, slower and later than the hero.
- **One thing to look at** (EX3-117). The read is the only thing drawn in full; whatever else the
  moment needs sits small or faded, out of focus in another layer, or cut out of the shot.

### V-20 · Negative space, balance, and the eye path

**Negative space comes first** (EX3-117, HARD CONSTRAINT; Lucas, 2026-10-22: "High performing reels
on social media try to give the viewer one thing to look at at a time"). Every shot frames one
thing to look at on a clear ground, with at least half of the frame empty. The scene holds the
fewest pieces that make the moment readable: no set dressing, no background props, no crowds, no
decoration. Negative space is still a dial set beat by beat, between **isolate** (one thing in a
clear field, the default), **open** (release: the answer lands in clean space), and **snap** (one cut
from a single thing to the next); never a crowd. The visual weight is balanced around the
focal: a heavy object on one side is answered by space or a lighter group on the other, never by
clutter. Each beat's shot sequence states its **eye path**: where the eye lands first, where it
travels, and what rewards it when it gets there. The eye moves naturally and is rewarded.

## Words in the world (V-13)

**No headlines** (EX3-44): the captions carry every spoken word. Other on-screen type is a short
label pinned to the object it names (a number, a status, a name, the real term), 5 words or
fewer, shown only as the voice names it (frame 4: as each part's real job is named), never a narration
sentence or a near-copy of one. A label may run along an isometric axis, like a dimension on a
technical drawing (green, Roboto 700 caps, tracked), with a dimension line that draws itself out.
Emphasis is colored text only (`orange-text` on light grounds, `orange` on dark), at most one
emphasized word per line, no boxes or fills behind words. **Three exceptions, each a kit or
designed component:** the opener's title card (frame 1, `titleCard()`), the dictionary card
(frame 3, `dictionaryCard()`), and the step tracker's stops (frame 6). Text the real thing itself
shows (a chat message in a `chatBubble()`, a card's title) is part of the picture, a few words,
never the narration.

## Captions (V-18)

The caption skin (EX3-45) owns them: big lowercase Pragmatica Extended Bold at the top-left of the
caption band, no plate, light on `stage`. A page holds up to 7 words on two lines and
stays put; each word fades in (0.08s) on its voice time; pages switch instantly. Captions are
quiet for all of frame 1 (the title card) and all of frame 3 (`mount.mjs` writes those windows). Frames
never draw captions and keep the band free of anything readable, except the title card and the
dictionary card, which may use it while captions are quiet.

## Seams (V-11) · HARD CONSTRAINT

Frames join only by `cut` (EX3-46): a continuity cut, on action, to a new framing, the world and
its state continue. The vendored `zoom-through` transition is not used (it draws a gray panel
over the frame). When a push through an object into the next framing serves the moment, build it
inside the two frames with the kit's `seams.js` (`zoomThrough` on the outgoing frame's last
moments, `zoomThroughIn` on the incoming frame's first). Never crossfades, dissolves, wipes,
slides, or fades to black or white inside the reel. Cut at peak velocity, with matched direction.

## Sound (EX3-63, EX3-75) · HARD CONSTRAINT

The reel is **full of sound**: every visible moment of motion has one, at its exact moment of
contact. A frame worker writes `assets/frames/<frame id>.events.json` next to its module: a JSON
array of `{ "t": <frame seconds>, "kind": <kind>, "what"?: <plain words>, "dur"?: <seconds> }`.

| kind | for |
|---|---|
| `foley` | a physical action, described in plain words in `what` (below). Add `dur` (0.2–8s) when the action is continuous, so the sound lasts exactly as long as the motion: a line being written, an eraser rubbing, paper rustling, scissors cutting. |
| `impact` | a heavy landing, a slam, the payoff hitting |
| `whoosh` | a fast move through the air, a camera punch |
| `pop` | something appearing, a label or tag popping on |
| `tick` | a small count, a step lighting, a number changing |
| `click` | a switch, a toggle, a button, a lock |
| `sting` | the one musical accent of a payoff (at most one per frame) |

**What gets a sound:** each arrival or landing, each object sitting down or being picked up, each
footstep, each number or label landing, each line or handwriting stroke (a `foley` with `dur`),
each page or card moving, each state flip, and the payoff. At least 4 events on frames 1, 2, 4,
5, 6 and 7, and at least 30 across the reel. Never a sound for nothing on screen.

**Foley words the library knows.** `what` is matched word by word against the library's tags;
rarer words weigh more, and a description no word of which is known is dropped. Use these words:

- **Writing and drawing (the reel's signature):** pencil writing, pencil scribble, pencil
  sketch, pen writing, pen scribble, pen signature, ballpoint, marker writing, sharpie,
  whiteboard marker, highlighter, chalk writing, chalkboard, crayon, eraser rubbing, pen click,
  pen cap, marker cap, pencil tap, pencil drop on desk, typewriter key, typewriter bell.
- **Paper:** paper slide, paper drop, sheet of paper, paper crumple, paper tear, paper rip, paper
  fold, unfold, crease, page turn, page flip, paper rustle, paper shuffle, stack of papers, paper
  flutter, paper flap, paper plane, envelope open, letter, sticky note peel, notebook close,
  book open, book close, clipboard, cardboard box.
- **Desk tools:** scissors cut, snip, tape pull, scotch tape, stapler, staple, hole punch, rubber
  stamp, seal, pushpin, thumbtack, paper clip, binder clip, ruler flick.
- **Everything else:** coins, coins drop, card, cards, card slide, card place, chips, dice,
  footstep, door open, door close, creak, bell, glass, plate, metal, wood, knife, cloth, leather,
  drop, throw, shove, grab, handle, place, lay, switch, toggle, keyboard typing, chime.

`assets/kit/sound.mjs` turns the events into one premixed track (`assets/sfx/events.wav`):
it picks and rotates sounds, level-matches them, and keeps them under the voice. The opener's
sound and the hit on the 1→2 cut are placed separately by `opener-sfx.mjs`; do not declare them.

## Timing data (EX3-60, EX3-79)

`assets/timing/<frame id>.json` holds the frame's real timing after `pace.mjs`:
`{ frame, id, duration, voice_end, hold, words: [{ text, start, end }] }`, in frame seconds.
Every arrival, label, title stroke, definition word, shot cut and sound event is timed from it:
the thing lands on the word that names it. The voice is tight: at most 0.15s of silence between
words (0.2s at a sentence end; only measured silence is ever cut, EX3-89), and 0.2s between lines
(`hold` 0.15s after `voice_end`); the close is a fixed 2.5s with no voice. Pictures keep up with
the voice; nothing waits for a pause.

## Frame Treatments

> The reel always has eight frames in this order (DECISIONS.md EX3-10), usually 50–65s; length is
> never chased by cutting words. Each frame is its voice plus a 0.15s `hold`. Each treatment names
> its ground, its look (the soft 3D world or glass and gloss), focal, shots, the move that carries
> the beat, and its sounds.

### 1 · Series opener (about 4–5s · `hook` · cut in)

**The opener is the bank's** (EX3-102). Every reel draws one animated intro at random from the
opener bank (`assets/kit/openers/`: Paper Rip, Record Scratch Freeze, Typewriter, Big Bang, Knock
Knock, Eye Zoom-Out, Balloon Pop, Block Drop, Unboxing, Paper Plane, Scissors Cut-Out), never one
of the last 8 reels' openers; `assets/opener.json` names it. Each opener is an audio and visual
pattern break built over **this reel's hook**: it rips a sheet off the hook, freezes it and
circles its critter, zooms out of its critter's eye, cuts its critter out of a page… In an
object-led reel (`assets/opener.json` says `"hero": "object"`) the opener is one of the seven that
never touch the hero (Paper Rip, Typewriter, Big Bang, Balloon Pop, Block Drop, Unboxing, Paper
Plane; EX3-111). The first
text it shows is "AI BRAIN BREAK" alone (never the term); the title card with the term follows
its break. Code writes `assets/frames/01-opener.js` (`pace.mjs`, `mount.mjs`); never edit it. The
opener's wait before its line is silence at the head of frame 1's voice (`pace.mjs`), and its
sound is its own stem (`opener-sfx.mjs`).

**The frame worker writes the hook only: `assets/frames/01-hook.js`**, to this contract:

```js
export const shots = [ /* one shot, as any scene frame */ ];
/** The hook's critter: its feet on the page (the world's LAYOUT spot, before any shot's camera),
 *  its scale (as drawn), its world id, its look (its CAST entry, unchanged). An object-led reel
 *  exports no hero. */
export const hero = { at: HERO_AT, s: HERO_S, who: HERO_ID, critter: CAST[HERO_ID] };
export default {
  ground: GROUND,
  shots,
  draw(t, { hideHero = false, heroPose = {} } = {}) {
    // the hook in motion under shotFrame(); the hero is left out when hideHero is true, and
    // heroPose (look, arms, mood) is passed last into the hero's critter options
  },
};
```

No title card and no text in the hook (the opener draws them), no events file (the opener's
stem is the frame's sound). The hook is the scene the storyboard picked, and every opener drops
the viewer straight into it, so it must still read with no context. In an object-led reel
(`"hero": "object"` in `assets/opener.json`) the hook follows its focal object: it exports no
`hero`, and `hideHero` and `heroPose` are never passed.

**Hook shot** (EX3-62, EX3-88): the storyboard's picked hook, **already moving at frame 0**, its
first visible change by 0.3s, and **clear on its own**: a viewer with no context knows what they
are looking at within 1 second (a familiar situation, recognizable objects or critters, an obvious
problem or surprise). It is a critter moment when someone acts (a reaction that grows out of the
setting), or an object moment when the objects act (something about to overflow, tip, jam, or
collide).
It raises a question; it is not the payoff, never a slow pan over a still scene, and never niche
or strange for its own sake. **Look** the soft 3D world. **Ground** the anchor scene's. **Shots**
one, or two if the frame runs past 6s. **Move** the hook builds (`ramp-up`); the camera may push
in with it, its parallax opening the room.

**Title card** (EX3-80): the opener's. Captions are quiet for the frame.

**Sounds:** the opener's stem (its break, its foley) and the bed coming in on its drop; the
worker declares none.

### The 1→2 cut: the attention reset (mandatory)

A hit lands exactly on the cut (placed by `opener-sfx.mjs`). Frame 2 opens with the reset its
storyboard `reset:` names: a camera **punch-in**, a **light change** (the studio light snaps to
a new level with `level()`, or a one-frame palette flash), an **in-frame zoom-through** out of the
hook (`seams.js` `zoomThroughIn`), or a **visual effect on the cut** (the kit's `shock()` marks).
The reset lands in the first 0.3s.

### 2 · Curiosity gap, about the real thing (about 10s · `pain_point`)

**Shows** its own picture (EX3-115): the real technology the reel teaches, as the viewer meets it
(a phone, a chat, a search box, a screen), in glass and gloss on the paper studio ground (§ Real-tech
frames), in shots each centred on what the voice names while it is on screen: what the viewer
does with it, the surprising thing it does, and the question landing on a held shot of that
moment. Never the analogy's scene and never the hero. **It echoes the hook** (EX3-131): the same
staging as frame 1 (where things sit and how they move), with the real thing in the analogy's
place, so the viewer sees one idea twice; the reset on the cut changes the camera, so no shot
repeats the hook's framing. The line ends on the viewer's own question, with no toss (EX3-116).
**Focal** the thing the question is about, alone in the frame. **Move** anticipatory: something
surprising has just happened and the viewer wants to know how.

### 3 · Define the concept: the dictionary card (about 7s · `product_intro`)

**Top half** `dictionaryCard(t, { headword, pos, words })` from `cards.js`: the headword is the
topic's term (the storyboard `term:`, EX3-86), `pos` is `part_of_speech:`, `words` are frame 3's
word times from `assets/timing/03-define.json` (the definition equals the voiceover); each word
appears on its time and stays. Never lay the text out by hand. **Below the card** (from its
returned `bottom` + 40px to y 1600) a visual of what the definition says, in glass and gloss (the
real thing, never the hero), revealed in step with the definition's key words; simple, open
space. **Focal** the thing the definition names, in the visual. Captions are quiet. **Sounds:**
`paper slide` as the card lands; a `typewriter key` or soft `pen writing` with `dur` under the
fill-in; a sound on each arrival in the visual.

### 4 · The analogy plays (about 12s · `feature_showcase`)

**Establishing shot first:** the reel's one `wide` shot of the anchor scene (a two-state analogy
may open on its "without" state), the whole room readable at once: where everything stands and
how big it is. Elements arrive **one at a time, each on the word that names it**, and as the voice
names a part's real job, that job lands as a label pinned to the part (EX3-128); a critter may
acknowledge the viewer (a wave, a glance at the camera). **Then** the steps play out in closer
shots (`medium`, `close`, `insert`, `reaction`), step by step (the anchor scene's `steps`, analogy
side), each a visible state change on its voice cue, building toward the answer; the frame ends on
the last step, never on a stated answer. **Look** the soft 3D world. **Ground** the anchor
scene's. **Focal** the moving piece of the process. This is the reel's richest picture: the eye
moves through it naturally and is rewarded, and it stays clean. **Sounds:** every arrival, every
step, the payoff.

### 5 · Why it works, then where it breaks (about 10s · `feature_showcase`)

**Shows** the anchor scene (required; EX3-128), in two moves, each in its own shots (`close`,
`medium` or `insert`; not the frame-4 framing): first the analogy's defining trait doing its job
again, the object that carries it lit (a glint or a glow) on the word that names why; then its one
limit or trade-off made visible in the scene (a state the analogy cannot hold, a cost, a miss), on
the word that names it, the light turning with it. **Never** a list, a node grid, or a slideshow.
**Look** the soft 3D world. **Focal** the trait, then the limit. **Sounds:** the action's own
sound on each move, a `pop` or `tick` for any label.

### 6 · Tiny real example, illustrated, with the step tracker (about 10s · `social_proof`)

**Shows the example itself** (EX3-87, EX3-129), in glass and gloss: the **step-tracker** component
along one edge of the safe area, its stops the anchor scene's steps' technical names (world.js
`STEPS`), and for each stop an `insert` shot of the matching `example_steps` entry's real thing,
lit on its voice cue, so the viewer sees the real system walk the steps the analogy walked.
Never the anchor scene and never the hero (EX3-132). Real values appear as labels, figures or the
real thing's own text where the example has them. **Focal** the step happening now; the result
lands last. **Sounds:** a `tick` as each stop lights, plus each insert's own.

### 7 · The payoff (about 6s · `benefit_highlight`)

**Shows** the answer to frame 2's question (EX3-128): the real thing from frame 2 doing what the
answer says, in glass and gloss, landing in the reel's warmest light (§ Light). It may call back
to the analogy with one shot of the anchor scene, in the soft 3D world, where the hero shows in
its orange (EX3-132). **Shots** two or more when it runs past 6s. **Focal** the moment the answer
happens, then the takeaway.

### 8 · The close (2.5s · `branding`) · built by code

The kit's `close.js` (EX3-95); no worker writes it. **Ground** `white`. The Helios logo, about
40% of the width, animates in (scaling up with a small overshoot over 0.4s); then "AI BRAIN
BREAK" writes itself beneath it in Hershey Sans, in ink (0.45–1.85s); then it holds. The logo and
the words together, top of the logo to the bottom of the words, are centred on the screen. No voiceover, no captions. **Sounds** (fixed, `close-timing.js`): a
whoosh into a chime as the logo lands, `pencil writing` for exactly the strokes, a `pen click` as
the writing ends. The music fades out across it.

## Writing a frame (the frame-module contract)

A frame is `assets/frames/<frame id>.js`, where the frame id is the basename of its storyboard
`src` (compositions/frames/04-analogy.html → 04-analogy). It is an ES module that imports only
from `../kit/*.js` and `../world/world.js`, and default-exports:

```js
import { scope } from '../kit/draw.js';
import { depthSort } from '../kit/space.js';
import { shotFrame } from '../kit/shots.js';
import { LAYOUT, SUBJECTS /* , entity functions */ } from '../world/world.js';

const GROUND = 'paper'; // must equal the frame's storyboard `ground:`
/** The frame's shots (the storyboard's `shots:`), cutting on word times from the timing file. */
export const shots = [
  { at: 0, kind: 'wide', on: [540, 1080] },
  { at: 3.1, kind: 'close', on: SUBJECTS.jar, push: 1.08 }, // "jar"
  { at: 6.4, kind: 'reaction', on: SUBJECTS.keeperFace },   // "but"
];

export default {
  ground: GROUND,
  shots,
  draw(t) {
    scope('f04-', GROUND); // first, every call: `f` + the frame number + `-`
    return shotFrame(t, shots, (shot, local) => ({
      bg: [/* what stands behind the scene: a back wall, a window */],
      mid: [depthSort([/* { at: [x, y, z] in cm, svg } for every entity, from world.js */])],
      fg: [/* at most one near thing passing the lens, or nothing */],
    }));
  },
};
```

A frame of one shot (6s or shorter, the dictionary card) may call the kit's `frame(t,
{ camera, focus }, parts)` directly; `focus` (`'mid'` unless a focus pull moves it) names the sharp
layer. `parts` may be an array (one flat layer) or `{ bg, mid, fg }`. `shotFrame`'s draw callback
gets the active shot and returns the same scene for every shot (a shot is only a camera); returning
anything but the scene's parts throws.

`assets/kit/mount.mjs` writes the HyperFrames composition around it (the ground on a clip layer,
the single clock, the timeline, fonts); never write `compositions/frames/*.html` by hand. Labels
are SVG `<text>` in Pragmatica Extended or Roboto. The close is the kit's; never write it.

**Alongside the module, every frame writes:**

- `assets/frames/<frame id>.events.json`: its sound events (§ Sound), times inside the frame.

**Timing.** Read `assets/timing/<frame id>.json` and copy the times you need into constants at the
top of the module (`const VOICE_END = 3.42;`, `const SHEET_AT = 3.8; // "sheet"`), so each
arrival lands on its word. The module never reads files.

**Text.** The title card and the dictionary card are `titleCard()` and `dictionaryCard()` from
`cards.js`; never lay them out yourself. Text inside a shape (a speech or chat bubble, a note, a
sign, a screen) is `textBox(text, x, y, { kind, size, maxW, focal, progress, scale })`, which
sizes the shape around the measured text (EX3-92); draw `textBox(...).svg`, and never place text
in a shape by hand. In the real-tech frames, the glass components (`chatBubble`, `glassCard`,
`pill`) measure their own text. For other handwriting inside the world (a note, a sign, a ledger
line) use `handwrite(text, x, y, size, progress, { color, weight, align })` from `draw.js`
(Hershey Sans print, drawn stroke by stroke; drive `progress` with `seg(t, start, end,
E.linear)`; `size` is the cap height; `handwriteWidth(text, size)` measures it). For a typeset
label, `textWidth()` and `typeset()` from `cards.js` give real widths.

**Space and size.** Place every entity in centimetres with `space.js` (`scene()`, `at()`,
`size()`) from world.js's `SIZES` and `LAYOUT`; join a layer's pieces with `depthSort()`; put
contents in a `container()`; show a tiny thing through `magnifier()`.

**Critters, outfits and props.** `critter(x, y, { arms, mood, look, s, flip, body, who, outfit,
wear, wearColor, squash })` and `handAt(x, y, sameOptions)` from `cast.js`; `walk(t)` for a walk
cycle; `heldScale(propCm)` for a held prop's scale; `prop(name, x, y, { s, state, focal, flip })`
from `props.js`. A held prop is drawn at `handAt(...).r` after the critter. A world critter takes
its `body` and `outfit` (and any exact-match `wear`) from `CAST`, unchanged; a frame never draws
clothing or headgear of its own on a critter, and nothing it draws covers a critter's eyes or
mouth (EX3-103).

**Light and motion.** Light from `light.js` (`lightWedge`, `rim`, `glow`, `glint`, `glowSign`,
`level`); moves from `motion.js` (`E`, `seg`, `lerp`, `squash`, `follow`, `arcPath`, `smear`).

**What the try checks:** frame 1's hook (`01-hook.js`) keeps its contract: in a critter-led reel
it exports `hero`, draws it (`data-who`), and leaves it out on `hideHero`; it draws no title card;
frame 3 draws the dictionary card (`data-role="definition"`); every scene frame longer than 6s
exports `shots` that pass the shot rules; no critter is drawn twice at one moment or vanishes
mid-frame; every critter matches its `CAST` look; every frame has a valid events file. The world
check holds `SIZES` to the scale ledger and every outfit clear of the face. **`bounds.mjs`** then
measures every piece of text every 0.2s in a browser: text cut off by the frame edge, outside its
box, or in a keep-out goes back to the frame's worker.

## Numerals and claims · HARD CONSTRAINT

Never invent figures, dates, counts, or claims. Every number on screen comes from `SCRIPT.md`, the
storyboard, or `STATES`; with a source, nothing on screen contradicts it.

## Pre-Render Self-Audit

- **Focal:** exactly one orange-family entity per beat; it dominates by 3×.
- **Palette:** only kit tokens and their ramps; every hue in its job; orange never on an outfit;
  status colors only as signals.
- **Look:** soft 3D volumes lit from the top right, no outlines on solids, soft contact shadows,
  gloss only on glossy things, a rim light on `stage`; no grain, grid, stipple or wobble; the
  real-tech frames in glass and gloss; critters for every character (no people, no body parts);
  objects drawn to fit, the asset bank reused only on an exact fit; the scene drawn only by
  `world.js`.
- **Size:** every entity at its `SIZES` size against the 72 cm critter, exaggeration at most 1.5×;
  held props sized from the critter; tiny things through a magnifier or an insert.
- **Outfits:** every critter's outfit drawn for its role; stock `wear` only on an exact match;
  nothing over the eyes or mouth (glasses excepted).
- **Space:** one room, one camera, everything on the one floor and depth-sorted; contents inside
  their containers; parallax layers with the scene in `mid`; one thing to look at per shot; at
  most three readable things on screen; at least half the frame empty; no set dressing, no crowd.
- **Light:** every light change motivated; at most one glint at a time; the payoff in the warmest
  light.
- **Reading:** one read at a time; labels land as the voice names them, 5 words or fewer; no headlines, no
  narration on screen; type ≥ 30px.
- **Keep-out:** nothing readable in y 0–570, y 1600–1920, or x 940–1080.
- **Motion:** every motion has a job; named polarities; anticipation, volume-keeping squash,
  follow-through, arcs, a smear frame on fast moves; titles, UI and camera on the brand ease-out
  with no bounce; calm camera; smooth motion (no boil, no twos); content arrives on voiceover
  cues, never all at t=0.
- **Continuity:** a scene frame starts in the state the last scene frame ended in.
- **Close:** the kit's, last frame only.
- **Fabrication:** every number traces to the script, storyboard, or states.
- **Opener:** the bank's (EX3-102), over a hook that moves at frame 0 and reads on its own; the
  hook keeps its contract (`hero`, `hideHero`, `heroPose`, no text).
- **Define:** `dictionaryCard()` fills in on the voice and stays; a glass visual sits below it.
- **Shots:** a camera only (never hide, add or mirror); centred on what the voice names; no two
  consecutive shots the same picture; frames over 6s cut between at least two.
- **Example:** the step tracker shows the anchor steps' technical names, each lit with an insert of the example step's real thing; no hero.
- **Hero:** only in frames 1, 4, 5 and a frame-7 callback; never in frames 2, 3 or 6.
- **Frame scale:** the scene spans at least 60% of the safe-area width; every object reads
  without a label at phone size.
- **Sound:** an events file per frame; every visible motion has its event; writing and paper
  moments use the paper and pen words; continuous actions carry `dur`.

## Font loading

Fonts ship as local files in `assets/fonts/`. Do NOT link Google Fonts. `mount.mjs` writes this
`@font-face` block into every frame composition, so SVG text resolves in preview, snapshot, and
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

## Known Gaps

- Pragmatica Extended ships Bold only; there is no italic. Emphasis is orange text or size.
- Objects and outfits are drawn per reel; quality varies by worker. The blind picture check
  catches weak, look-alike or wrongly sized ones; every object it names exactly joins the asset
  bank with its tags (EX3-114).
- Soft 3D is drawn in SVG (gradients, filters, blur); heavy blur and many glows cost render time,
  so depth of field and glows stay on the layers and pieces that need them.
- The try checks the size ledger and the outfits' data; whether a drawing looks its real size
  next to the critter is the picture check's to judge.
- 16:9 and 1:1 are not designed for; this preset is 9:16 only.
