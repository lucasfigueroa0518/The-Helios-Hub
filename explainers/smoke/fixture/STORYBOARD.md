---
format: 1080x1920
duration: 18s
message: "Zero-cost smoke test of the Explainers 3.3 kit inside the 1.0 pipeline"
concept: Prompt Caching
arc: concept-explainer
audience: Helios engineering (fixture, never published)
mode: autonomous
music: none
---

## Anchor scene

- metaphor: a critter writes the same long instructions on every request, and every finished line drops a coin
- setting: table
- ground: paper
- hook: the pen races through the last lines while coins pour onto a tall stack
- steps:
  - the pen writes the instructions — the model reads the prompt
  - a coin drops per line — input tokens are billed
- entities:
  - sheet — a sheet of paper on the table — stands for the prompt — a thin paper slab — beats 1, 2
  - ink — handwriting that writes itself — stands for tokens processed from scratch — freehand ink on the sheet — beats 1, 2
  - coins — a stack of coins — stands for input tokens billed — paper discs, one per finished line — beats 1, 2
  - writer — a critter writing with a pen — stands for the model reading the prompt — a critter holding the kit's pen — beats 1, 2
- states: lines written 3 → 10; coins 3 → 10
- layout: the sheet centred on the table, the coin stack at its lower right

## Frame 1 — Series opener

- duration: 3.496s
- voice_end: 3.346s
- hold: 0.15s
- poster: 3.2s
- transition_in: cut
- status: animated
- src: compositions/frames/01-opener.html
- ground: paper
- type: hook
- engagement: Open loop + visual hook + audio ramp
- voiceover: "In the next 30 seconds, this busy writer will teach you an AI concept."
- anchor: scene

Fixture frame. Checks the hook (a critter writing), the title card animating from the first frame, the riser and hit, and sound events.

## Frame 2 — The scene

- duration: 6.458s
- voice_end: 6.308s
- hold: 0.15s
- poster: 5s
- transition_in: cut
- status: animated
- src: compositions/frames/02-scene.html
- ground: night
- type: feature_showcase
- engagement: Scene setting + analogy anchor
- voiceover: "Picture a pen copying the same long instructions onto every sheet, one costly line at a time."
- anchor: scene

Fixture frame. Checks elements arriving as they are named, a cut from wide to a close-up (shots), light captions on night, and sound events.

## Frame 3 — Define the concept

- duration: 8.264s
- voice_end: 8.114s
- hold: 0.15s
- poster: 8s
- transition_in: cut
- status: animated
- src: compositions/frames/03-define.html
- ground: paper
- type: product_intro
- engagement: Grounding definition
- definition: Prompt caching is when a model provider saves the repeated start of your prompt, so later requests reuse it instead of reading it again.
- part_of_speech: noun
- voiceover: "Prompt caching is when a model provider saves the repeated start of your prompt, so later requests reuse it instead of reading it again."

Fixture frame. Checks the dictionary card filling in on its word times, quiet captions, and a visual below.

## Frame 8 — Close

- duration: 2.5s
- transition_in: cut
- status: animated
- src: compositions/frames/08-close.html
- ground: white
- type: branding
- engagement: Brand close

Fixture frame. Checks the kit's close (EX3-95): written by code, 2.5s, no voice, the logo and AI BRAIN BREAK centred together, the words writing beneath the logo, and its fixed sounds.
