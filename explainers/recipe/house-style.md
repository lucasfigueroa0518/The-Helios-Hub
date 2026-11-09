# House style: how a Helios explainer looks and sounds

This file holds Helios's taste: the decisions Lucas has made about how every reel looks and
sounds, whatever the topic. `craft.md` teaches how to choose; house style is where Helios has
already chosen, so follow it. A line that leaves room for the director's judgement says so. Lines
marked HARD CONSTRAINT never bend.

The other layers: `minimums.md` (the eight things every reel must contain, and failing open), the
format (`story-design.md`: the eight beats and their jobs, fixed) and `frame.md` (the tools: the
palette tokens, the type styles, the safe area and the kit's API).

---

## The look

- **Premium, modern, tactile, full of effort:** each reel should feel made by an amazing animation
  team.
- **Soft 3D.** Every solid is a soft volume: its faces graded through its colour ramp, rounded lit
  edges, no outline, a soft contact shadow and ambient occlusion in a warm shadow tone, and gloss
  only on glossy materials (plastic, glass, screens, enamel, eyes). Lines remain only where a line
  is the thing itself: printed detail, writing, routes. No grain, grid, stipple, line wobble or
  drawing on twos; motion is smooth.
- **One motivated key light per scene,** the same in every shot of that scene. On the paper studio
  it comes from the top right; in a place, from a source in that world (the sun, a window, a lamp).
  Practical lights add pools and glows.
- **Moods and grounds follow the colour script.** Each frame's mood (day, evening, night, dark)
  comes from the reel's colour script and sets its light. Day and evening stand on the warm paper
  studio (the default); night and dark (dark is also the mood for a tense moment) stand on the
  Helios Premium stage (charcoal under a warm glow, with a rim light on everything). A frame's
  ground matches its mood. White is the close's alone.
- **Light as motion:** light is part of the action. Wedges of light, rims, glows, glints sweeping
  across gloss and light levels over time show where to look and how the moment feels, and a
  motivated light change can carry a beat.
- **Parallax:** in a camera move, the background, midground and foreground layers move at
  different speeds, so depth reads.
- **Motion:** world moves ease in and out; titles, UI and the camera use the brand ease-out with no
  bounce or overshoot. A move faster than about four frames gets one smear frame.
- **Type:** Pragmatica Extended Bold for captions, figures, titles and primary labels; Roboto for
  secondary labels and UI text; no other faces. Hierarchy comes from size, case and colour.
- **HARD CONSTRAINT: never** photos, stock footage, emoji, unicode glyph icons, real brands or
  logos other than Helios, real people's likenesses, infographic templates, bullet lists,
  headlines, or narration sentences on screen (the dictionary card's definition is the one
  exception).

## Palette and orange

- **Only the Helios palette:** the tokens `frame.md` lists, their ramps, a mix of two of them, or a
  gradient the kit draws from them. The kit resolves nothing else.
- **Paper and ink are the quiet base.** Yellow, blue, teal, lilac, green and red are the range the
  director draws places, things, outfits and moods from, planned per reel in the colour script.
  Red is for things that are red in real life; as a status it means error (below). It is never a
  ground.
- **Status colours** (error red, success green, warning yellow, information blue) carry their
  universal meaning only, on the signal itself, one at a time. They are never a ground, a
  decoration or a large area.
- **Orange marks whatever the viewer must look at right now.** Use it sparingly, on one thing at a
  time, and never as decoration: never the set, an outfit or a ground. It belongs to no fixed role,
  so when the focus moves, orange moves with it.
- **Orange is a mark, not a concept's identity.** It lands on the thing being looked at (its accent
  part, a rim, a glow, its label) while the thing keeps its own colours. No concept is identified
  by orange, so each one stays recognizable when orange leaves it. On text, orange marks the one
  word to look at.
- **The one exception is a critter hero,** which keeps the orange Helios critter body for the whole
  reel. It is the character the viewer follows. While it is on screen it is the orange, so nothing
  else in that shot is orange. An object hero takes no fixed orange, and no other critter is
  orange.

## Mechanism frames

- **Glass and gloss is the default look** for frames that show the real mechanism: the real things
  drawn as glossy soft-3D objects on the soft glass-studio ground (`frame.md` has the tools). The
  director may depart from it when the beat calls for it, and says so in the storyboard.
- **The language is mixed:** diagrammatic structure (paths, and markers that move, split, combine
  and change state) plus one or two pictorial hero elements. The thing the voice is talking about
  is drawn as a real object.
- **Draw real things as simple objects:** devices, chips, servers, documents, boxes and the like,
  in today's look.
  - 2–4 objects on screen.
  - One moving real element: the thing that travels, changes or is transformed.
  - One short label at a time, sitting on the thing the voice is naming.
  - Orange as the one accent.
- **No step trackers or floating cards by default.** The step tracker is a tool the director may
  pick, never a default; a frame that uses one names it in its `scene:` line.

## Heroes, critters and objects

- **The hero is a critter or an object;** the director decides. Critters are optional, and an
  object hero is just as good.
- **Critters are Critter 2.0:** soft-3D bodies with glossy eyes and two catchlights; on the stage,
  a warm rim and a cool counter-rim.
- **Critters face the camera or turn their back: front or back views only.** An over-the-shoulder
  shot uses the back view.
- **HARD CONSTRAINT: in an over-the-shoulder shot, the foreground body sits at the frame's side,
  covers at most a third of the frame, and never covers the subject.**
- **HARD CONSTRAINT: critters are the only characters.** Never a person, a figure built from
  solids, a hand or any other body part, on its own or as an actor.
- **HARD CONSTRAINT: nothing a critter wears covers or crowds its eyes or mouth.** Leave real
  negative space around them. Glasses are the exception.
- **Outfits are drawn for the role:** the one or two garments a stranger knows the job by, built
  for this reel. A stock garment is used only when it fits exactly.
- **In the voice and the captions, a critter is named by its role,** never called a "critter".
- **HARD CONSTRAINT: an object never gets a face.** No eyes, brows or mouth on an object, ever. An
  object that acts does it through motion alone: hops, slides, tilts, nods, reactions, settling,
  breathing.
- **HARD CONSTRAINT: an animal is its own category, never a critter and never a character.** A
  real animal the analogy needs (a dog, a bird, a horse) is drawn with the kit's `animal()`, or
  composed the same way from `ANIMAL_PARTS` with `animalFrom()` (`animals.js`): six to twelve soft
  volumes in the species' true proportions, the one or two marks a stranger knows it by, a coat from
  one palette ramp, a soft contact shadow. Side view first; front when it looks at or walks toward
  the camera; never a back or three-quarter view.
- **HARD CONSTRAINT: an animal wears nothing and has no face beyond its glossy bead eyes.** No
  outfit, accessory, held prop or text; no eye whites, brows, mouth or expression; no human pose. It
  acts as that animal really does, one natural action at a time (a tail wag, a head tilt, a hop, a
  peck, a head toss, a step).

## Scale

- **Scale is cheated, never measured** (`craft.md` § 9 says how), and everything stays believable
  relative to everything else.

## Bookends

- **The opener bank, the hand-off card, the dictionary card and the logo close stay exactly as they
  are,** handwritten feel and all. The contrast between the handwritten bookends and the Soft-3D
  body is intended.
- The opener's visual hook owns the opening shot: no title card there. The card "today's AI Brain
  Break: <term>" is the hand-off's (frame 3).
- They are built by code, the opener bank and the hand-off bank; no builder redraws them (a builder
  draws only the dictionary card's call, `frame.md` § The dictionary card). The Helios logo itself
  is never changed.

## Captions, voice and pacing

- **Captions:** big lowercase Pragmatica Extended Bold in the caption band at the top of the
  frame, no plate, typed letter by letter as each word is spoken, **at most 2 lines**. The caption
  skin draws them; frames never do. They stay quiet while the opener and the dictionary card own
  the screen.
- **The voice is tight:** no pause runs longer than 0.2 s. Code trims a silence inside a line to
  0.15 s (0.2 s after a sentence ends), and each frame ends on a 0.15 s hold. The picture keeps
  pace with the voice.
- **No word is ever cut** to tighten the voice or to chase a length; only real silence is trimmed.
  A reel may run long: understanding comes first.

## Sound and music

- **Dense, event-timed sound.** Every meaningful event gets a sound at its exact moment, and since
  nearly everything on screen carries meaning, the soundtrack is full. A continuous action gets a
  sound that lasts as long as the motion. Never thin the sound out; a short, deliberate drop before a
  reveal (`craft.md` § 11) is contrast, not thinning.
- **Paper, pen and writing foley comes first:** pencil scratches, pen clicks, page turns, paper
  slides, crumples and stamps are the signature of the style. Other materials get their own
  families.
- **Music:** groovy, high-energy instrumentals under the voice: groovy funk, driving indie or
  hip-hop instrumental, 105–128 BPM. Never calm or corporate, and never upbeat electronic. Code
  finds the track and levels it; nobody hand-picks it.
