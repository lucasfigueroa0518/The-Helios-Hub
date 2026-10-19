---
format: 1080x1920
duration: 60s
arc: concept-explainer
mode: autonomous
term: <fill in: BRIEF.md's term, verbatim>
concept: <fill in: the same term>
music: none
---

## Anchor scene

<fill in from BRIEF.md's picked analogy: metaphor, setting, ground, hook, steps (3–5, each "<analogy action> — <technical step name>"), entities (at most 4: id — what it is — stands for — how it is built — beats; the actor is a critter with its role accessories; an everyday object names its library prop, e.g. "prop: light switch"; never a person or a body part), states, layout. See story-design.md.>

## Hook

<fill in: three hook candidates for frame 1 (the analogy's own hook is one), each rated 1–5 on standalone clarity (a viewer with no context knows what they are looking at within 1 second) and thumb-stop, then the pick and why. See story-design.md.>

## Curiosity gap

<fill in: three candidate gaps, each a tiny story in the hook's scene (goal, obstacle, twist, the viewer's own question, a promise), rated on clarity, pull, relevance and closable (1–5), then the pick and why, and closed_by. See story-design.md.>

## Frame 1 — Series opener

- duration: 3.5s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/01-opener.html
- type: hook
- scene: <fill in: one line, what is drawn and what moves>
- engagement: Open loop + visual hook + audio ramp
- voiceover: "In the next 30 seconds, this <fill in: 1–3 words naming what the hook shows> will teach you an AI concept."
- anchor: scene
- shots: <fill in: usually one shot (kind — subject); two if the frame runs past 6s>

<fill in: the picked hook, in motion at frame 0 and clear on its own; the title card ("today's brain break:" + the term) starts writing itself in the top band on the first frame. The line is the opener template; its slot names what the hook shows ("this little shop", "this soggy forecaster").>

## Frame 2 — Curiosity gap

- duration: 9s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/02-gap.html
- type: pain_point
- scene: <fill in: one line, what is drawn and what moves>
- engagement: Attention reset + curiosity gap
- anchor: scene
- gap_question: <fill in: the question exactly as the voiceover asks it>
- shots: <fill in: 2–3 shots (kind — subject — on "the word the cut lands on"); each subject is what the voice names while it is on screen; none the hook's framing>

<fill in: the gap as a tiny story in the hook's scene (story-design.md § 2), 18–36 words: the goal (who wants what); the obstacle; the twist or stakes; the viewer's own question about how it plays out; then a promise naming something in the viewer's life ("Stick around: it's the same reason chatbots make things up."). No term, no "same spot", plain roles. Reset (punch-in, color change, in-frame zoom-through, or a cut effect).>

## Frame 3 — Define the term

- duration: 7s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/03-define.html
- type: product_intro
- scene: <fill in: one line, what is drawn and what moves>
- engagement: Grounding definition
- anchor: own

<fill in: definition of the term (what it is, what it does, when or why; it equals the voiceover) and part_of_speech; the kit's dictionary card in the top half, a visual of the definition below.>

## Frame 4 — Everyday analogy

- duration: 12s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/04-analogy.html
- type: feature_showcase
- scene: <fill in: one line, what is drawn and what moves>
- engagement: Scene setting + analogy anchor + anticipation
- anchor: scene
- shots: <fill in: the one wide establishing shot first, then closer shots for the steps (kind — subject — on "cue word"), each subject what the voice names then, a cut every 2.5–4s>

<fill in: continue the scene the viewer has already seen ("Here's what the hire does:", "Watch the forecaster:", "Back on the lawn:"; never "Picture…" or "Imagine…"), introduce each new element by name and job as it arrives, then play the steps to the payoff.>

## Frame 5 — Map the analogy

- duration: 10s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/05-map.html
- type: feature_showcase
- scene: <fill in: one line, what is drawn and what moves>
- engagement: Cached understanding + progressive disclosure
- anchor: scene
- shots: <fill in: a shot per mapped pair (close, medium or insert on the object the voice names), not frame 4's framing>

<fill in: "the X is the Y, because …" for each pair (at least two), each landing on its object; never a list.>

## Frame 6 — Tiny real example

- duration: 10s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/06-example.html
- type: social_proof
- scene: <fill in: one line, what is drawn and what moves>
- engagement: Worked example + progress tracker
- anchor: own
- example_steps: <fill in: 3–5 of the example's own concrete steps, in order, each 4 words or fewer, separated by " → ">
- shots: <fill in: an insert of each step's real thing (kind — subject — on "cue word"); at most one cut back to the anchor scene>

<fill in: "Here's a real example:", real values, walked through the example_steps in order; the step tracker shows them, an insert illustrates each.>

## Frame 7 — Real world

- duration: 6s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/07-real-world.html
- type: benefit_highlight
- scene: <fill in: one line, what is drawn and what moves>
- engagement: Recognition
- anchor: own
- shots: <fill in: two shots when it runs past 6s>

<fill in: open with a transition ("Another example would be…", "In everyday life, you meet … when…"); one place the viewer meets this (at most two), a new drawn scene with critters and props on a new ground.>

## Frame 8 — Close

- duration: 2.5s
- transition_in: cut
- status: outline
- src: compositions/frames/08-close.html
- type: branding
- engagement: Brand close
- ground: white
- scene: White screen; the Helios logo animates in and AI BRAIN BREAK writes itself beneath it, centred together

The close is fixed and built by code (the kit's close.js): no voiceover, no hold, no shots. Copy this block as it is.
