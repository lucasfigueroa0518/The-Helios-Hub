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

<fill in: the story world (story-design.md § Anchor scene): metaphor (the event's world in one line), setting, ground, hook (the event's key moment, in motion at frame 0), `hero: <key item id> — object`, steps (3 or 4, each "<step name, 4 words or fewer> — <what it was in this event>"), entities (at most 4: id — what it is in the event — how it is built — beats; critters in ink or paper with their role wear, never orange; every object a `new drawing:` or, only on an exact fit, a `prop:` with its `exact:` reason; never a person, a body part or a logo), states (every number or outcome shown, from the facts), layout.>

## Hook

<fill in: three hook candidates for frame 1 (the anchor scene's hook is one), each rated 1–5 on standalone clarity and thumb-stop, then the pick and why. See story-design.md.>

## Puzzle

<fill in: question (frame 2's last sentence, word for word), answer (the click in one sentence), closed_by (the frame and moment that answers it).>

## Frame 1 — The incident

- duration: 5s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/01-opener.html
- type: hook
- scene: <fill in: one line, what is drawn and what moves>
- engagement: Open loop + visual hook + audio ramp
- voiceover: "<fill in: the event in one line, 10–16 words>"
- claims: <fill in: the fact ids the line uses>
- anchor: scene
- shots: <fill in: one shot (kind — subject — on "cue word"); two if the frame runs past 6s>

<fill in: the picked hook, the event's key moment in the story world, in motion at frame 0 and clear on its own, with the key item in it. The opener, "AI BRAIN BREAK" and the title card are code's.>

## Frame 2 — The puzzle

- duration: 9s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/02-puzzle.html
- type: pain_point
- scene: <fill in: one line, what is drawn and what moves>
- engagement: Attention reset + curiosity gap
- anchor: scene
- reset: <fill in: punch-in | color change | zoom-through | cut effect>
- gap_question: <fill in: the question the voiceover ends on, word for word>
- claims: <fill in: the fact ids the line uses>
- shots: <fill in: 2–3 shots (kind — subject — on "cue word"); each subject what the voice names then; none the hook's framing>

<fill in: the rest of what happened and the one detail that makes it strange, then the question, in the story world; the question lands on a held shot of the strange thing. Never the term.>

## Frame 3 — Name it

- duration: 5s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/03-define.html
- type: product_intro
- scene: <fill in: one line, what is drawn and what moves>
- engagement: Grounding definition
- anchor: own
- definition: <fill in: the definition, 16 words or fewer, "A/An <term> is…" or "<Term> is…"; it equals the voiceover>
- part_of_speech: noun

<fill in: the kit's dictionary card in the top half; below it, a simple visual of what the definition says (the key item may appear).>

## Frame 4 — Walk it

- duration: 13s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/04-walk.html
- type: feature_showcase
- scene: <fill in: one line, what is drawn and what moves>
- engagement: Worked example + progress tracker
- anchor: scene
- claims: <fill in: the fact ids the line uses>
- shots: <fill in: the one wide establishing shot first, then closer shots, one per step (kind — subject — on "cue word"), a cut every 2.5–4s>

<fill in: each of the anchor scene's steps named as it plays, shown with the event's own thing, the step tracker lighting each; build toward the outcome without stating why yet.>

## Frame 5 — The click

- duration: 8s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/05-click.html
- type: feature_showcase
- scene: <fill in: one line, what is drawn and what moves>
- engagement: State change + payoff
- anchor: scene
- claims: <fill in: the fact ids the line uses>
- shots: <fill in: close or insert shots on the key item at the step that produced the outcome; not frame 4's framing>

<fill in: the step that explains the outcome, replayed on the key item, the cause visibly leading to the outcome; the answer to the puzzle in one clear sentence.>

## Frame 6 — The other side

- duration: 8s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/06-other-side.html
- type: social_proof
- scene: <fill in: one line, what is drawn and what moves>
- engagement: Cached understanding + boundary
- anchor: scene
- claims: <fill in: the fact ids the line uses>
- shots: <fill in: shots on the step the fix or the limit touches (kind — subject — on "cue word")>

<fill in: for a failure, the fix (what changed, at which step); for a success, the limit or trade-off; for a mystery, what is known and what is still open; on the same story world.>

## Frame 7 — The takeaway

- duration: 6s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/07-takeaway.html
- type: benefit_highlight
- scene: <fill in: one line, what is drawn and what moves>
- engagement: Payoff + distillation
- anchor: own
- claims: <fill in: the fact ids the line uses, or none>
- shots: <fill in: one shot, two when it runs past 6s; at most one a callback to the key item>

<fill in: the puzzle's answer in one plain sentence, then one rule a business viewer can use; a new ground. closed_by points here.>

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
