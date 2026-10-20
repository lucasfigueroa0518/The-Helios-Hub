---
version: helios-explainer-v6
name: Helios — Explainer Reel frame (Explainers 3.3)
description: >
  Helios Explainer Reels drawn as if by a person on a drafting table: warm paper with a fading
  ink grid, isometric paper objects with ink outlines, riso grain, a line that boils slightly,
  one thing in Helios orange, and big lowercase captions at the top. Characters are critters;
  everyday objects come from the kit's prop library, and anything else is drawn in the same
  style. Scenes cut between shots. No photos, stock footage, rendered 3D, people, body parts, or
  pre-made illustration. Every moment of motion has a sound. Decisions:
  planning/Explainer Reels/DECISIONS.md (EX3-40 to EX3-47; 3.1: EX3-60 to EX3-75; 3.2: EX3-76 to
  EX3-88; 3.3: EX3-89 to EX3-98; 3.4: EX3-102, the opener bank), adopted from Explainer 2.0's
  approved style.
unit: the frame — 1080×1920 (9:16); every scene is SVG in frame pixels
principle: one idea per beat · one read at a time · orange marks the one thing to look at · the picture explains

colors:
  paper: "#F3F0EA"
  paper-lit: "#FBFAF6"
  paper-shade: "#E2DACB"
  paper-dark: "#CFC5B3"
  canvas: "#FFFFFF"
  ink: "#171717"
  ink-lit: "#2B2926"
  text-secondary: "#525252"
  text-tertiary: "#737373"
  orange: "#FF5E1A"
  orange-lit: "#FF7A3D"
  orange-shade: "#E8541C"
  orange-dark: "#C8430F"
  orange-text: "#CC4E19"
  green: "#138510"
  night: "#171717"
  forest: "#163815"
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
    description: "The ONE entity per beat the viewer must look at: an orange object, an orange critter, or the orange part of an object (its accent face or marking), drawn in the orange tones (orange-lit, orange-shade, orange-dark). Exactly one per beat. When the focal moves to another entity, the orange moves with it."
  solid:
    description: "An isometric paper solid on the table (box, slab, disc, cylinder, sheet, extrusion) with three flat tones (lit top, mid left face, dark right face), an ink outline, riso grain on its side faces, and a flat contact shadow. Built with the kit's isoBox, isoDisc, onPlane, shadow."
  label:
    typography: "{typography.label} or {typography.dimension}"
    description: "A short label pinned to the object it names: a number, a status, a name, a real term. 5 words or fewer. Shown as the voice names it. A dimension label runs along an isometric axis with a green dimension line that draws itself out."
  critter:
    description: "THE cast (EX3-77): every character is a critter from the kit's cast.js, never a person, a figure built from solids, or a body part. A critter does whatever someone does in the analogy: it holds, writes, reaches, feels its way, points, carries, sits, walks. Poses (arms), moods (brows, eyes, mouth), and role accessories (wear: cap, chef hat, grad cap, glasses, headset, apron, backpack…) tell its role. handAt() puts a prop in its hand. Orange when it is the focal. Its gaze points at the read."
  prop:
    description: "An everyday object from the kit's prop library (props.js, EX3-78): drawn once, approved, with its states (a switch on or off, a door open or closed) and an orange focal part. prop(name, x, y, { s, state, focal, flip }). A scene uses the library's prop whenever the library has the thing."
  shot:
    description: "A camera on the scene (shots.js, EX3-83, EX3-90): wide, medium, close, insert (a tight camera on one object), reaction (a critter's face). A scene frame lists its shots and hard-cuts between them on voice cues; every shot shows the same scene with everyone in it, centred on what the voice names."
  title-card:
    description: "Frame 1 only (EX3-80), drawn by the bank's opener (EX3-102) once its break is over, never by a frame worker: the kit's titleCard(). A paper note card in the top band (y 250–530, where captions would be) slides in and writes 'today's brain break:' in ink, then the term in orange beneath, larger, in Hershey Sans print handwriting, finished by the end of the opener line. The hook keeps playing below, undimmed. Its group carries data-role=\"title\". Captions are quiet for all of frame 1."
  dictionary-card:
    description: "Frame 3 only (EX3-80): the kit's dictionaryCard(). The top half (from about y 270): a paper dictionary entry, its headword the topic's term (Pragmatica Extended), its part of speech in Roboto 700 caps, green, then the definition in Roboto 500 laid out from measured font widths, filling in word by word on its voice times and staying. Its group carries data-role=\"definition\"; it returns its bottom edge. Below it: a drawn visual of what the definition says, revealed with its key words. Captions are quiet for the frame."
  step-tracker:
    description: "Frame 6 only. A numbered path or timeline drawn in the style along one edge of the safe area (a hand-drawn ink line with paper tabs or circles). Its stops are the example's own concrete steps (the storyboard's example_steps, EX3-87), 4 words or fewer each, Roboto 700 or Pragmatica label size. Stops light (the current one in green, done ones ink, upcoming ones at 25%) on their voice cue while an insert shot shows that step's real thing."
  text-box:
    description: "Text inside a shape (cards.js textBox(), EX3-92): a speech or chat bubble, a note, a sign or a screen, sized around the measured text so the text never leaves it. textBox(text, x, y, { kind, size, maxW, focal, progress, scale }) returns { svg, box }."
  close:
    asset: "assets/Helios-logo.png"
    description: "The last frame only, the kit's close.js (EX3-95), built by code: 2.5s, a white screen, the Helios logo animating in and 'AI BRAIN BREAK' writing itself beneath it in Hershey Sans. No voiceover."
---

# Helios — Explainer Reel frame (Explainers 3.3)

## Overview

**The bar.** Every frame looks drawn by a person on a drafting table: warm paper or a dark
ground, isometric paper objects with ink outlines, riso grain, a line that boils slightly, one
thing in Helios orange, and a big lowercase caption at the top. It feels human, playful and exact
at once. **The style is how things are drawn, never what is drawn**: every reel's analogy is its
own world, built from the kit's critters and prop library and, where those lack something, drawn
on demand in this style. Failure looks like: a person or a hand built from boxes, an object a
stranger cannot name, generic corporate icons, a list or a slideshow, gradients and glow,
rendered 3D, a busy frame, the same picture shown four times, or a camera that never stops moving.

Every rule in this file is mandatory. Rules marked HARD CONSTRAINT fail the frame outright when
broken. The rule ids (V-…) are the ones the kit's code comments cite.

## The frame · HARD CONSTRAINT (V-T3)

On the 1080×1920 frame:

- **y 0–250:** Instagram's Reels header. Nothing readable of ours.
- **y 250–570:** the caption band. The world may run behind it; nothing readable of the world.
- **y 1600–1920:** Instagram's username, caption, and audio line. Nothing readable of ours.
- **x 940–1080:** Instagram's action buttons. Nothing readable of ours.
- **Safe area:** x 96–940, y 570–1600.

The world (ground, grid, table objects) runs full-bleed. The focal, every label, every number,
the opener's title, and the logo sit inside the safe area at every landing pose and hold. Things
may cross the edges while they move.

## Colors · HARD CONSTRAINT (V-T1)

Every color on screen is one of the frontmatter tokens, or a mix of exactly two of them, at any
opacity. The kit's `T` holds them; a scene never writes another hex. No other hue exists.
Light does not add color: no gradients on objects, no glow, no rim light.

- **Color hierarchy.** Paper and ink are the quiet context. Green marks labels, dimension lines
  and signposts. Orange marks the one focal. The eye goes to orange first, green second, ink
  last. Nothing competes with the focal.
- **Status colors** carry their universal meaning and nothing else: red for error, rejection and
  destruction; a bright green for success; yellow for warning; blue for information. Only on the
  signal that carries the status (a light, a badge, a flash, a tick or cross, the object in the
  moment it fails or passes), never as a ground, never as decoration, never on large areas, one at
  a time. The orange focal still leads.
- **Grounds (V-14):** `paper` (with grain and the fading grid; the default, for clarity),
  `night` (for tension), `forest` (a deep Helios green, for rich, immersive scenes), and `white`
  for the last frame only. Never blue. On night and forest every outline and critter swaps to
  light-on-dark by itself (the kit's `line()`, `TONES`, `scope()`). The ground changes only at a
  cut or through a motivated light change in the world, never by a fade. Each frame's ground is
  its storyboard `ground:` field, and its scene module's `ground` matches it.

## Typography · HARD CONSTRAINT (V-T2)

Pragmatica Extended Bold for captions, figures, the title and primary labels; Roboto for
secondary labels. No other faces. Pragmatica ships Bold only: hierarchy comes from size, case,
and color. Load-bearing text is never under 30px on the 1080-wide frame and holds 4.5:1 contrast
against what is behind it. Numbers stay numerals.

## How things are drawn

### V-2 · Depth from isometric drawing · HARD CONSTRAINT

The world is a drafting table seen in one isometric projection (30°, the kit's `iso()`), the
same for every frame of the reel. Objects are paper solids standing on the table or on each
other: boxes, slabs, discs, cylinders, sheets, extrusions. Depth comes from the projection, from
overlap, from stacking and contact shadows, and from cutting between camera distances. There is
no vanishing perspective, no horizon, no free 3D camera and no rendered 3D.

### V-3 · Paper and ink · HARD CONSTRAINT

The light is fixed, from the top left, and expressed only through flat tones: every solid has
three (lit top, mid left face, dark right face), an ink outline (about 3–4px for large objects,
2–2.5px for small ones), riso stipple that darkens side faces toward the bottom, and a flat ink
contact shadow at 10–18% opacity. The ground carries paper grain; on paper a faint ink grid fades
out toward the top and bottom. No gradients on objects, no glow, no blur except context dimming.

### V-4 · Props first, then drawing new things · HARD CONSTRAINT

**Characters are critters** (EX3-77): whoever acts in the scene is a critter from `cast.js`. Never
draw a person, a figure built from solids, or any body part; a critter holds the thing, writes the
line, feels for the switch. Critters are the default cast: when someone could act or react, a
critter does.

**Everyday objects come from the prop library** (EX3-78, `props.js`): light switch, lamp, door,
chair, table, shelf, bed, jar, box, bucket, cup, bottle, book, notebook, pencil, pen, eraser,
paper sheet, sticky note, envelope, mailbox, stamp, key, padlock, phone, laptop, monitor,
keyboard, clock, bell, magnifier, map, pin, coin, piggy bank, sign, flag, ball, ladder, plant,
tree, house, car, bicycle, truck, flashlight, backpack (`propNames()` lists them, with states).
When the library has the thing, the scene uses it, scaled and placed; it never draws its own
version. When the analogy needs something the library lacks (a turnstile, a sieve, a scale, a
valve), it is drawn, in this style:

- **constructed or contoured:** boxy things are built from the kit's solids and paths laid on
  iso planes; organic and curved things (a leaf, a cloth, a round body) may be ink contours with
  flat fills and stipple shading (`props/kit.js`: `shape`, `shade`). Either way, V-3's tones,
  outline and grain;
- **a stranger names it in one second at phone size, without a label** (EX3-74): its silhouette
  and its signature features carry it (a mailbox has its flag and slot, a scale its two pans, a
  door its handle and hinges); if it would need a label to be read, redraw it until it doesn't;
- detail lives **inside** it, as ink marks on its faces (seams, ticks, slots, handwriting, a small
  line icon), never as extra loose parts; the focal carries the most detail;
- anything organic is **simplified**: a plant is a few leaf shapes on a pot; anyone is a critter;
- it **moves like paper**: it squashes on impact, overshoots with weight, and boils with the rest
  of the drawing.

A new object passes the blind picture check (a stranger names it) or it is redrawn; good ones
join the library once Lucas approves them. Never pick an analogy because a piece already exists.
At most five readable objects are in frame at once; a group of identical objects counts as one.
Detail printed or cut into a light surface (seams, writing, ticks) is ink (`T.ink`), so it never
vanishes on a dark ground; outlines use `line()`.

**Scale (EX3-74) · HARD CONSTRAINT.** The anchor scene spans at least 60% of the safe-area width
(about 510px of the 844px) at rest; the focal is at least 20% of the safe area; nothing readable
crosses x 96–940 or y 570–1600 at rest. Small, distant scenes are the failure the picture check
catches first. Lucide-style line icons appear only as
small markings on a drawn object (a tag, a screen, a card), never as the picture itself.

### V-15 · The hand and determinism · HARD CONSTRAINT

A frame is SVG, redrawn each tick as a pure function of frame time `t` (one clock; any seek
renders the same frame). The hand comes from the kit, never hand-rolled: the line wobble (its
seed steps at 10 fps, so lines boil), drawn things on twos (`twos(t)`), freehand ink strokes,
riso stipple. The camera, lines that draw themselves out, and captions stay smooth. No unseeded
randomness, no clocks, no state kept between calls.

### V-16 · Built from the kit · HARD CONSTRAINT

Colors from the kit's tokens, the camera and grid from the kit's `frame()`, the hand from the
kit's filters and ink. Every anchor-scene entity is one drawing function in
`assets/world/world.js`, reused by every frame that shows the scene. A frame never draws its own
version of a world entity, a second camera, or a second token set.

### V-17 · What never appears · HARD CONSTRAINT

Photos, stock footage, emoji, unicode glyph icons, real brands or logos other than Helios, real
people's likenesses, people or human figures of any kind, body parts (hands, arms, fingers, faces,
heads) as objects or actors, rendered or modeled 3D, gradients and glow on objects, infographic
templates, bullet lists, node-and-arrow slides, headlines, and narration sentences on screen.

## The anchor scene (V-1)

The everyday analogy is one scene the whole reel revolves around (EX3-15). STORYBOARD.md's
`## Anchor scene` defines it once: metaphor, setting, ground, hook (the opener's moment), steps
(each with its analogy action and its technical name), entities (what each is, what real
component it stands for, how it is built), states, layout. The scene builder turns it into
`assets/world/world.js`. Then:

- every entity is drawn by its one function and looks the same in every frame it appears in;
- every entity sits where `LAYOUT` puts it;
- every number, position, fill, label and outcome on screen comes from `STATES` and changes only
  by its rules;
- a frame that shows the scene starts in the state the previous scene frame ended in (the cut
  between them is a continuity cut);
- an entity enters only when the narration needs it, and never disappears without a cause the
  viewer sees.

Reusing the scene gains the viewer's cached understanding: they already know the objects, so the
next idea costs them less. That is the trade-off every `anchor:` choice weighs.

## Shots: same scene ≠ same shot (V-24, EX3-83) · HARD CONSTRAINT

The anchor scene returns in beats 1, 2, 4 and 5, so the picture must change: a scene frame is a
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
- Beats 1, 2, 4 and 5 each use at least one shot kind the others don't.
- Inside a shot the camera stays calm (a push of at most 1.2×); the cut does the reframing.
- Closer shots (zoom above 1.25) get the kit's caption-band wash automatically (`shotFrame`):
  the band behind the captions fades back toward the ground, so enlarged objects never fight the
  caption. Keep the subject in the safe area; never rely on the band for anything readable.
- Cuts land on voice cues (the word that names the next subject) and on action.

## Focal (V-5) · HARD CONSTRAINT

Each beat has exactly one focal entity: the thing the viewer must look at. It is the only element
in the orange family (the opener title's concept word is outside the world and does not count).
It dominates its nearest neighbor by 3× or more in size, contrast, or motion. Camera and motion
deliver the eye to it within 0.5s of the beat's start. The focal changes only at a beat boundary.

## Motion

### V-6 · Motion has a job · HARD CONSTRAINT

Every motion is one of:

- **semantic:** the motion communicates the idea (a stamp prints the whole block at once);
- **anticipatory:** the motion creates an outcome to await (the coin teetering at the edge);
- **state-driven:** a rule produces a visible consequence (a line is written; a light turns on);
- **camera:** the camera moves attention to what matters next.

Decorative motion is forbidden: idle floating, random particles, wiggles with no cause. Three
things are not decoration: the boil (the drawing's texture), character life (critters blink,
breathe slightly, and glance; context critters stay nearly still while something is being read),
and the opener's build into the cut.

### V-8 · Polarity: the speed curve

Every major move uses a named curve from the kit (`E` in `motion.js`), matched to its meaning:
`slam` (fast in, hard stop: arrivals, impacts, verdicts), `snap` (instant, tiny overshoot: state
flips, counters), `ramp-up` (slow start, accelerating: build-ups that end in an impact), `glide`
(slow, fast, slow: repositioning), `spring` (overshoot and settle: things with weight), `reverse`
(goes, then pulls back: refusals, rejections), `drift` (near-constant: a tension hold only).
Anticipation comes before every big action: a wind-up before the shove, a lift before the slam.
Squash on impact; overshoot with weight.

### V-9 · Speed ramps

Where it serves the moment (no minimum): at speed, then slow motion through the consequential
instant, then back to speed (the kit's `makeWarp`). The slow section sits exactly on the moment
the viewer is anticipating.

### V-7 · The camera · HARD CONSTRAINT

One 2D camera frames the isometric table (`frame(t, { camera })`): position, zoom, a little roll.
It is calm and motivated: the energy comes from the objects, the cuts and the sound, never from
throwing the frame around. Every frame has gentle camera motion (a drift or a slow push or
pull); at most one sharp move (a punch) per beat, on its key moment; no single move changes zoom
by more than 1.2×; roll within 3°; no tilt; every move follows the action, reveals a consequence,
or carries the eye to the next focal. The one exception is the attention reset at the 1→2 cut
(below), which may punch harder.

## Space and reading

### V-22 · One read at a time · HARD CONSTRAINT

The frame is never busy. At every moment the viewer has exactly one thing to read: the caption
(while the voice speaks), or one short label (the thing the voice just named, or the term it is mapping in
frame 5), or the focal doing its action, or one of the designed cards (the title card, the
dictionary card) while captions are quiet.

- **Sequential reveal.** Elements arrive one at a time, in reading order, each after the previous
  had time to be read (about 0.3s per word for type, at least 0.6s for an object's action). A read
  element steps back (dims, shrinks, or leaves) before the next takes the lead.
- **Context stays quiet.** Everything that is not the current read is dimmed toward the ground
  (labels and marks on context objects at about 25% opacity) and still.
- **The read gets the light.** On paper the read sits on clear ground; on dark grounds a soft pool
  of `paper` at low opacity lies under it.
- **Gaze.** Critters on screen look at the read.
- **Choreography.** Lead with the hero, then its context; with three or more animated elements, at
  most a third move at once; supporting elements move less, slower and later than the hero.

### V-20 · Negative space, balance, and the eye path

Negative space is a tension dial set beat by beat: **crowd** (builds pressure), **isolate**
(suspense: one thing in a vast field), **open** (release: the answer lands in clean space),
**snap** (the density flips in one cut). Crowding comes from scale, camera distance and groups
of identical objects, never from more kinds of objects. The visual weight is balanced around the
focal: a heavy object on one side is answered by space or a lighter group on the other, never by
clutter. Each beat's shot sequence states its **eye path**: where the eye lands first, where it
travels, and what rewards it when it gets there. The eye moves naturally and is rewarded.

## Words in the world (V-13)

**No headlines** (EX3-44): the captions carry every spoken word. Other on-screen type is a short
label pinned to the object it names (a number, a status, a name, the real term), 5 words or
fewer, shown only as the voice names it or as its "because" is spoken (frame 5), never a narration
sentence or a near-copy of one. A label may run along an isometric axis, like a dimension on a
technical drawing (green, Roboto 700 caps, tracked), with a dimension line that draws itself out.
Emphasis is colored text only (`orange-text` on light grounds, `orange` on dark), at most one
emphasized word per line, no boxes or fills behind words. **Three exceptions, each a kit or
designed component:** the opener's title card (frame 1, `titleCard()`), the dictionary card
(frame 3, `dictionaryCard()`), and the step tracker's example steps (frame 6).

## Captions (V-18)

The caption skin (EX3-45) owns them: big lowercase Pragmatica Extended Bold at the top-left of the
caption band, no plate, light on night and forest. A page holds up to 7 words on two lines and
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
> its ground, focal, shots, the move that carries the beat, and its sounds.

### 1 · Series opener (about 4–5s · `hook` · cut in)

**The opener is the bank's** (EX3-102). Every reel draws one animated intro at random from the
opener bank (`assets/kit/openers/`: Paper Rip, Record Scratch Freeze, Typewriter, Big Bang, Knock
Knock, Eye Zoom-Out, Balloon Pop, Block Drop, Unboxing, Paper Plane, Scissors Cut-Out), never one
of the last 8 reels' openers; `assets/opener.json` names it. Each opener is an audio and visual
pattern break built over **this reel's hook**: it rips a sheet off the hook, freezes it and
circles its critter, zooms out of its critter's eye, cuts its critter out of a page… The first
text it shows is "AI BRAIN BREAK" alone (never the term); the title card with the term follows
its break. Code writes `assets/frames/01-opener.js` (`pace.mjs`, `mount.mjs`); never edit it. The
opener's wait before its line is silence at the head of frame 1's voice (`pace.mjs`), and its
sound is its own stem (`opener-sfx.mjs`).

**The frame worker writes the hook only: `assets/frames/01-hook.js`**, to this contract:

```js
export const shots = [ /* one shot, as any scene frame */ ];
/** The hook's critter: its feet on the page (the world's LAYOUT spot, before any shot's camera),
 *  its scale (as drawn), its world id, its look (the critter() options that make it itself). */
export const hero = { at: LAYOUT.thermostat.at, s: 1.3, who: 'thermostat', critter: { wear: ['scarf', 'cap'] } };
export default {
  ground: 'paper',
  shots,
  draw(t, { hideHero = false, heroPose = {} } = {}) {
    // the hook in motion under shotFrame(); the hero is left out when hideHero is true, and
    // heroPose (look, arms, mood) is passed last into the hero's critter options
  },
};
```

No title card and no text in the hook (the opener draws them), no events file (the opener's
stem is the frame's sound). The hook is the critter-led scene the storyboard picked, and every
opener drops the viewer straight into it, so it must still read with no context.

**Hook shot** (EX3-62, EX3-88): the storyboard's picked hook, **already moving at frame 0**, its
first visible change by 0.3s, and **clear on its own**: a viewer with no context knows what they
are looking at within 1 second (a familiar situation, recognizable critters and props, an obvious
problem or surprise). It is usually a critter moment: a reaction that grows out of the setting.
It raises a question; it is not the payoff, never a slow pan over a still scene, and never niche
or strange for its own sake. **Ground** the anchor scene's. **Shots** one, or two if the frame
runs past 6s. **Move** the hook builds (`ramp-up`); the camera may push in with it.

**Title card** (EX3-80): the opener's. Captions are quiet for the frame.

**Sounds:** the opener's stem (its break, its foley) and the bed coming in on its drop; the
worker declares none.

### The 1→2 cut: the attention reset (mandatory)

A hit lands exactly on the cut (placed by `opener-sfx.mjs`). Frame 2 opens with the reset its
storyboard `reset:` names: a camera **punch-in**, a **color change** (the ground flips paper →
night or forest), an **in-frame zoom-through** out of the hook (`seams.js` `zoomThroughIn`), or a
**visual effect on the cut** (the kit's `shock()` marks, or a one-frame palette flash). The reset
lands in the first 0.3s.

### 2 · Curiosity gap, inside the anchor world (about 10s · `pain_point`)

**Shows** the anchor scene (required), in shots each centred on what the voice names while it is
on screen: the character and its goal, the obstacle, the twist happening, and the question landing
on a held shot of the stuck moment. Never the hook's framing again. The line is a tiny story (goal,
obstacle, twist, the viewer's own question, a promise tying the answer to their life, EX3-101);
the picture shows each part as it is said. **Focal** the thing the question is about. **Move** anticipatory: something is about to happen
and the viewer wants to know how or why.

### 3 · Define the concept: the dictionary card (about 7s · `product_intro`)

**Top half** `dictionaryCard(t, { headword, pos, words })` from `cards.js`: the headword is the
topic's term (the storyboard `term:`, EX3-86), `pos` is `part_of_speech:`, `words` are frame 3's
word times from `assets/timing/03-define.json` (the definition equals the voiceover); each word
appears on its time and stays. Never lay the text out by hand. **Below the card** (from its
returned `bottom` + 40px to y 1600) a drawn visual of what the definition says (a critter and
props doing it), revealed in step with the definition's key words; simple, open space. **Focal**
the thing the definition names, in the visual. Captions are quiet. **Sounds:** `paper slide` as
the card lands; a `typewriter key` or soft `pen writing` with `dur` under the fill-in; a sound on
each arrival in the visual.

### 4 · Everyday analogy: set the scene, then play it (about 12s · `feature_showcase`)

**Establishing shot first:** the reel's one `wide` shot of the anchor scene. Elements arrive
**one at a time, each on the word that names it** (the voice introduces each by name and job
before it acts); a critter may acknowledge the viewer (a wave, a glance at the camera). **Then**
the process plays out in closer shots (`medium`, `close`, `insert`, `reaction`), step by step
(the anchor scene's `steps`, analogy side), each step a visible state change on its voice cue,
to its payoff. **Ground** the anchor scene's. **Focal** the moving piece of the
process. This is the reel's richest picture: the eye moves through it naturally and is rewarded,
and it stays clean. **Sounds:** every arrival, every step, the payoff.

### 5 · Map, saying why (about 10s · `feature_showcase`)

**Shows** the anchor scene (required), in a shot per mapped pair (a `close`, `medium` or `insert`
on the object being mapped; not the frame-4 framing), while each real term lands on its object **as
its "because" is spoken**: a label pinned to the object (or the object turning into its real
counterpart in place), and the object's action pulses once with the "because" clause. One pair
at a time; the previous label dims to 25%. **Never** a list, a node grid, or a slideshow.
**Focal** the object being mapped. **Sounds:** a `pop` or `tick` per label, the action's own
sound per pulse.

### 6 · Tiny real example, illustrated, with the step tracker (about 10s · `social_proof`)

**Shows the example itself** (EX3-87): the **step-tracker** component along one edge of the safe
area, its stops the storyboard's `example_steps` (the example's own concrete steps, "search
flights → read prices → pick cheapest → book"), and for each stop an `insert` shot of that
step's real thing drawn in the style (a search box card, a price list, a ticket), lit on its
voice cue. It may cut back to the anchor scene once, so the viewer sees the real step line up
with the analogy they learned (the critter reaching as "reads the prices" lights). Real values
appear as labels or figures where the example has them. **Focal** the step happening now; the
result lands last. **Sounds:** a `tick` as each stop lights, plus each insert's own.

### 7 · Meet it in the real world (about 6s · `benefit_highlight`)

**Shows** a new drawn scene with a **visible break** that matches the line's transition: a new
ground (a different one from frame 6's) and a new setting, built from critters and props. One
place the viewer meets this (at most two), illustrated in the same paper style (a critter at a
phone, a laptop on a desk, a front door), never only named on a card. **Shots** two or more when
it runs past 6s. **Focal** the familiar moment it happens in.

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
import { twos } from '../kit/motion.js';
import { shotFrame } from '../kit/shots.js';
import { LAYOUT, STATES /* , entity functions */ } from '../world/world.js';

const GROUND = 'paper'; // must equal the frame's storyboard `ground:`
/** The frame's shots (the storyboard's `shots:`), cutting on word times from the timing file. */
export const shots = [
  { at: 0, kind: 'wide', on: [540, 1080] },
  { at: 3.1, kind: 'close', on: LAYOUT.jar.at, push: 1.08 }, // "jar"
  { at: 6.4, kind: 'reaction', on: LAYOUT.critter.face },     // "but"
];

export default {
  ground: GROUND,
  shots,
  draw(t) {
    scope('f04-', GROUND); // first, every call: `f` + the frame number + `-`
    const tc = twos(t);   // drawn things move on twos
    return shotFrame(t, shots, (shot, local) => [/* SVG strings from world.js and the kit */]);
  },
};
```

A frame of one shot (6s or shorter, the dictionary card) may call the kit's `frame(t,
{ camera }, parts)` directly. `shotFrame`'s draw callback gets the active shot and returns the
same scene for every shot (a shot is only a camera); returning anything but the scene's parts
throws.

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
in a shape by hand. For other handwriting inside the world (a note, a sign,
a ledger line) use `handwrite(text, x, y, size, progress, { color, weight, align })` from
`draw.js` (Hershey Sans print, drawn stroke by stroke; drive `progress` with `seg(t, start, end,
E.linear)`; `size` is the cap height; `handwriteWidth(text, size)` measures it). For a typeset
label, `textWidth()` and `typeset()` from `cards.js` give real widths.

**Critters and props.** `critter(x, y, { arms, mood, wear, look, s, flip, body, who })` and
`handAt(x, y, sameOptions)` from `cast.js`; `walk(t)` for a walk cycle; `prop(name, x, y, { s,
state, focal, flip })` from `props.js`. A held prop is drawn at `handAt(...).r` after the critter.

**What the try checks:** frame 1's hook (`01-hook.js`) keeps its contract: it exports `hero`,
draws it (`data-who`), leaves it out on `hideHero`, and draws no title card;
frame 3 draws the dictionary card (`data-role="definition"`); every scene frame longer than 6s
exports `shots` that pass the shot rules; no critter is drawn twice at one moment or vanishes
mid-frame; every frame has a valid events file. **`bounds.mjs`** then measures every piece of text
every 0.2s in a browser: text cut off by the frame edge, outside its `textBox`, or in a keep-out
goes back to the frame's worker.

## Numerals and claims · HARD CONSTRAINT

Never invent figures, dates, counts, or claims. Every number on screen comes from `SCRIPT.md`, the
storyboard, or `STATES`; with a source, nothing on screen contradicts it.

## Pre-Render Self-Audit

- **Focal:** exactly one orange-family entity per beat; it dominates by 3×.
- **Palette:** only kit tokens; no gradients or glow on objects; status colors only as signals.
- **Style:** isometric paper solids, ink outlines, three flat tones, grain; critters for every
  character (no people, no body parts); library props for everyday objects; the scene drawn only
  by `world.js`.
- **Reading:** one read at a time; labels land as the voice names them, 5 words or fewer; no headlines, no
  narration on screen; type ≥ 30px.
- **Keep-out:** nothing readable in y 0–570, y 1600–1920, or x 940–1080.
- **Motion:** every motion has a job; named polarities; anticipation before big actions; calm
  camera; content arrives on voiceover cues, never all at t=0.
- **Continuity:** a scene frame starts in the state the last scene frame ended in.
- **Close:** the kit's, last frame only.
- **Fabrication:** every number traces to the script, storyboard, or states.
- **Opener:** the bank's (EX3-102), over a hook that moves at frame 0 and reads on its own; the
  hook keeps its contract (`hero`, `hideHero`, `heroPose`, no text).
- **Define:** `dictionaryCard()` fills in on the voice and stays; a visual sits below it.
- **Shots:** a camera only (never hide, add or mirror); centred on what the voice names; no two
  consecutive shots the same picture; frames over 6s cut between at least two.
- **Example:** the step tracker shows the example's own steps, each with an insert of its real thing.
- **Scale:** the scene spans at least 60% of the safe-area width; every object reads without a
  label at phone size.
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
- Objects outside the prop library are drawn per reel; quality varies by worker. The blind
  picture check catches weak ones; good ones join the library after review.
- 16:9 and 1:1 are not designed for; this preset is 9:16 only.
