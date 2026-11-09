---
format: 1080x1920
duration: 60s
arc: concept-explainer
mode: autonomous
message: <fill in: the thesis, the one line the viewer leaves with>
term: <fill in: BRIEF.md's term, verbatim>
concept: <fill in: the same term>
audience: <fill in: who the reel is for>
music: none
---

## Visual arc

- throughline: <fill in: the one visual idea the reel builds from the first frame to the tie-together, in one line>
- colour script: <fill in: frame by frame, its mood or palette shift (1: …; 2: …; through 7)>
- motifs: <fill in: what recurs (a shape, a colour, a prop or a framing), and where it comes back changed>
- intensity: <fill in: where contrast rises, where it eases, and where it resolves>
- bridges: <fill in: each cut that is a bridge or a carry (frame N to M: the element and how it carries), or none>

## Anchor scene

- metaphor: <fill in: BRIEF.md's named analogy, staged, in one line>
- places:
  - <fill in: place id> — <interior or exterior: its kind> — <what happens there>
- hook: <fill in: the picked hook from ## Hook, in motion at frame 0>
- hero: <fill in: entity id> — <critter or object>
- steps:
  - <fill in: what happens in the analogy> — <the real step's technical name>
- entities:
  - <fill in: id> — <what it is> — stands for <the real part> — <how it is built> — beats <the beats it appears in>
- states: <fill in: each variable's start value, and how each beat changes it>

## Hook

<fill in: three hook candidates, each a moment in the anchor scene with the hero in it, rated 1–5 on standalone clarity and thumb-stop, then "- pick: <n> — <why>". See story-design.md § The plan's blocks.>

## Frame 1 — Hook

- duration: 4.5s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/01-opener.html
- type: hook
- ground: <fill in: paper or stage>
- look: <fill in: world or blend>
- voiceover: "<fill in: BRIEF.md's ## Opener line, its ___ filled>"
- shots:
  - <fill in: one line per shot, as story-design.md § Shot lines writes it>
- scene: <fill in: what the viewer sees, as a viewer would say it>

## Frame 2 — Quick definition

- duration: 5s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/02-define.html
- type: product_intro
- ground: <fill in: paper or stage>
- look: <fill in: world, mechanism or blend>
- voiceover: "<fill in: one plain sentence, about 15 words or fewer: [Term] is when …>"
- shots:
  - <fill in: one line per shot>
- scene: <fill in: what the viewer sees>

## Frame 3 — Hand-off

- duration: 3s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/03-handoff.html
- type: handoff
- ground: paper
- look: world
- voiceover: "Let's dive into this in everyday terms."
- handoff_parts: <fill in: 2–3 entity ids of the analogy's mapped parts that matter most, or none>
- world_sounds: <fill in: 1–2 foley words the analogy's world makes, from frame.md § Sound events, or none>
- scene: The card "today's AI Brain Break: <the term>", the analogy's world showing around it

## Frame 4 — The analogy plays

- duration: 13s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/04-analogy.html
- type: feature_showcase
- ground: <fill in: paper or stage>
- look: <fill in: world, mechanism or blend>
- voiceover: "<fill in: the analogy plays, continuing the hook's story>"
- shots:
  - <fill in: one line per shot>
- scene: <fill in: what the viewer sees>

## Frame 5 — Definition payoff

- duration: 10s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/05-payoff.html
- type: feature_showcase
- ground: <fill in: paper or stage>
- look: <fill in: world, mechanism or blend>
- definition: "<fill in: the term restated with the analogy attached, word for word as the voiceover's first sentence>"
- part_of_speech: <fill in: usually noun>
- voiceover: "<fill in: the definition, then why the analogy works>"
- shots:
  - <fill in: one line per shot, or one framing under the card>
- scene: <fill in: the dictionary card, and what the viewer sees below it>

## Frame 6 — Tiny real example

- duration: 11s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/06-example.html
- type: social_proof
- ground: <fill in: paper or stage>
- look: <fill in: mechanism or blend>
- voiceover: "<fill in: the real example>"
- shots:
  - <fill in: one line per shot>
- scene: <fill in: what the viewer sees>

## Frame 7 — Tie-together

- duration: 8s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/07-tie.html
- type: benefit_highlight
- ground: <fill in: paper or stage>
- look: <fill in: world, mechanism or blend>
- voiceover: "<fill in: the analogy's trait on the real example, then what it means for the viewer>"
- shots:
  - <fill in: one line per shot>
- scene: <fill in: what the viewer sees>

## Frame 8 — Close

- duration: 2.5s
- transition_in: cut
- status: outline
- src: compositions/frames/08-close.html
- type: branding
- ground: white
- scene: White screen; the Helios logo animates in and AI BRAIN BREAK writes itself beneath it, centred together

The close is fixed and built by code (the kit's close.js): no voiceover, no hold, no look, no shots. Copy this block as it is.
