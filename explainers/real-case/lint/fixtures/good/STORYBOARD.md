---
format: 1080x1920
duration: 60s
arc: news-story
mode: autonomous
message: "A transit assistant sent riders to a closed station because its model only knew the routes from before the closure."
term: knowledge cutoff
concept: knowledge cutoff
audience: broad business audience
music: none
---

## Case file

- when: September 14, 2026 · where: Harbor City
- key artifact: a1 — the assistant's confident answer is the story
- key detail: "Pier Street station" — a1
- players:
  - Harbor City Transit — organization — shown as: name card — acts 2, 4, 6
  - the trip assistant — product — shown as: name card — acts 1, 3, 5, 6
  - riders — private person — shown as: silhouette (walking) — acts 3, 4
- artifacts:
  - a1 — reply — shown in acts 1, 3, 5 — "Take the Blue Line to Pier Street station, then walk two blocks east."
  - a2 — post — shown in act 4 — "We are pausing the trip assistant…"
- numbers:
  - 2,300 riders — c5 — big number — act 4
- objects:
  - smartphone — acts 1, 3, 5
  - padlock — act 3
  - paper map — act 5
- mechanism: route data before March → model learns routes → no live alerts (cause) → old answer

## Cold open

1. number: "A city's new transit assistant sent about 2,300 riders to a station that was already closed." — the answer card slams in, "Pier Street station" underlined, 2,300 counting beside it — clarity 4/5, thumb-stop 4/5, open loop 5/5
2. artifact: "Take the Blue Line to Pier Street station. Pier Street had been closed since March." — the reply card alone, a CLOSED stamp landing on it — clarity 4/5, thumb-stop 3/5, open loop 4/5
3. stakes: "Thousands of riders followed an app to a locked station." — walking silhouettes stopping at a gate — clarity 3/5, thumb-stop 4/5, open loop 3/5
- pick: 1 — a stranger sees a confident answer and a big number at once, and wants to know what went wrong.

## Question

- question: So why would it send anyone there?
- answer: The model learned its routes before the station closed, and nothing gave it newer information.
- closed_by: frame 5: the cause step marked in the key color

## Frame 1 — Cold open

- duration: 5s
- hold: 1.2s
- transition_in: cut
- status: outline
- src: compositions/frames/01-cold-open.html
- type: cold_open
- ground: board
- scene: The assistant's answer card builds in, "Pier Street station" underlined in the key color, a counter climbing to 2,300 beside it
- voiceover: "A city's new transit assistant sent about 2,300 riders to a station that was already closed."
- claims: c3, c5
- artifacts: a1
- shots:
  - close — the assistant's answer card and the counter — on "assistant"
- beat: intrigue

narrativeRole: Opens on the outcome so the viewer wants the story.
keyMessage: A confident answer sent thousands of people the wrong way.

## Frame 2 — Setup

- duration: 9s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/02-setup.html
- type: setup
- ground: newspaper
- scene: The date stamp slams in, then the agency's name card, then the app with its trip assistant
- voiceover: "September 14, 2026. Harbor City Transit adds an AI trip assistant to its app. It should mean fewer calls to the help line. Riders ask, and it plans the trip."
- stamp: SEPTEMBER 14, 2026 · HARBOR CITY
- claims: c1, c2
- artifacts: none
- shots:
  - insert — the date stamp, September 14 — on "September"
  - medium — Harbor City Transit's app and its trip assistant — on "Harbor"
  - close — the help line, fewer calls — on "fewer"
- beat: tension

narrativeRole: Sets the date, the players and what they wanted.
keyMessage: A transit agency trusted an assistant to answer riders.

## Frame 3 — The moment

- duration: 9s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/03-moment.html
- type: moment
- ground: board
- scene: A rider's question types in, the answer card builds word by word, then "Pier Street station" is underlined in the key color as a CLOSED stamp lands
- voiceover: "That weekend, riders ask for directions. The answer looks perfect: take the Blue Line to Pier Street station, then walk two blocks east. Pier Street closed in March."
- claims: c3, c4
- artifacts: a1
- shots:
  - medium — riders asking for directions — on "riders"
  - close — the answer, take the Blue Line to Pier Street — on "take"
  - insert — Pier Street closed in March — on "Pier"
- beat: surprise

narrativeRole: Plays the moment with the real answer on screen.
keyMessage: The answer was confident and wrong.

## Frame 4 — Fallout

- duration: 6s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/04-fallout.html
- type: fallout
- ground: newspaper
- scene: The number 2,300 counts up over walking figures, the agency's pause post slides in, the question holds
- voiceover: "About 2,300 riders walk up to a closed station. Two days in, the assistant goes dark. So why would it send anyone there?"
- question: So why would it send anyone there?
- claims: c5, c6
- artifacts: a2
- shots:
  - close — riders at the closed station, 2,300 — on "riders"
  - medium — why it sent anyone there — on "So"
- beat: tension

narrativeRole: Shows the cost, then asks the question the reveal answers.
keyMessage: Thousands were misled and the assistant was pulled.

## Frame 5 — What actually happened

- duration: 12s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/05-reveal.html
- type: reveal
- ground: whiteboard
- scene: A flow builds left to right: route data stamped before March, the model learning routes, a missing live-alerts link marked in the key color, the old answer coming out
- voiceover: "The assistant learned its routes from data collected before the station closed. Nothing told it the map had changed. That's called a knowledge cutoff: a model only knows the world up to the day its data was gathered."
- term_card: What a model knows stops on the day its data was collected.
- claims: c7
- artifacts: a1
- shots:
  - medium — the routes learned from data — on "assistant"
  - close — the map that changed — on "Nothing"
  - insert — the term card, knowledge cutoff — on "That's"
  - close — the day its data was gathered, marked — on "day"
- beat: clarity

narrativeRole: Reveals the mechanism that explains the outcome.
keyMessage: A model's knowledge stops on the day its data was collected.

## Frame 6 — Since then

- duration: 6s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/06-since.html
- type: since
- ground: board
- scene: The timeline stamp moves to September 20, then a live alerts line connects to the assistant
- voiceover: "September 20. The assistant comes back, now connected to the agency's live service alerts. A closed station is news it can read."
- claims: c8
- artifacts: none
- shots:
  - insert — the timeline stamp, September 20 — on "September"
  - medium — the assistant connected to live service alerts — on "comes"
- beat: satisfaction

narrativeRole: Shows the fix and where it stands.
keyMessage: Live information closes the gap.

## Frame 7 — For you

- duration: 4s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/07-for-you.html
- type: for_you
- ground: board
- scene: The line sets in large headline type, "how fresh" in the key color
- voiceover: "Before you trust an AI's answer, ask how fresh its information is."
- claims: none
- artifacts: none
- shots:
  - close — the line, how fresh its information is — on "Before"
- beat: satisfaction

narrativeRole: Gives the viewer the one thing to keep.
keyMessage: Ask how current an AI's information is.

## Frame 8 — Close

- duration: 2.5s
- transition_in: cut
- status: outline
- src: compositions/frames/08-close.html
- type: branding
- ground: board
- scene: The Helios logo animates in and AI NEWS EXPLAINED slams in beneath it, centred together

The close is fixed and built by code (the news kit's close.js): no voiceover, no hold, no shots. Copy this block as it is.
