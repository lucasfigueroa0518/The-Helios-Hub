---
format: 1080x1920
duration: 60s
arc: concept-explainer
mode: autonomous
message: "A cache serves a saved copy fast, until the original changes."
term: caching
concept: caching
audience: broad business audience
music: none
---

## Anchor scene

- metaphor: a bakery's website in a paper browser, with a stack of saved page copies beside it
- setting: table
- ground: paper
- hook: a paper price tag flips back from the new price to the old one as order slips pile up
- hero: pricetag — object
- steps:
  - request — a customer opens the sourdough page
  - check the copy — the site finds a saved page
  - serve the copy — the old price goes out
  - refresh — the copy expires after a day
- entities:
  - pricetag — the sourdough's price tag — new drawing: a paper price tag on a string — beats 1, 2, 4, 5, 6
  - copies — the saved page copies — new drawing: a stack of paper web pages with a clock stamp — beats 2, 4, 5, 6
  - slips — the orders — new drawing: a pile of paper order slips — beats 1, 2, 5
  - clerk — the bakery's clerk — critter (clerk, apron), look: ink, wear apron — beats 6
- states: price: $4 → new price in beat 2 → old $4 served in beats 4–5; orders: 0 → 1,200 by beat 2
- layout: browser centre, copies left, slips right

## Hook

1. a paper price tag flips back from the new price to the old one as order slips pile up — clarity 4/5, thumb-stop 4/5
2. a clerk stares at a stack of order slips — clarity 4/5, thumb-stop 3/5
3. a browser page with a clock stamp — clarity 3/5, thumb-stop 2/5
- pick: 1 — anyone reads a price tag going the wrong way

## Puzzle

- question: So why would a website keep showing a price that no longer exists?
- answer: The site served a saved copy of the page, made before the price changed.
- closed_by: frame 7: the answer line

## Frame 1 — The incident

- duration: 5s
- hold: 0.15s
- transition_in: cut
- src: compositions/frames/01-opener.html
- type: hook
- scene: a price tag flips back to the old price while order slips pile up
- engagement: Open loop + visual hook + audio ramp
- voiceover: "In June 2025, a bakery's website kept selling sourdough at its old price of $4."
- claims: c1
- anchor: scene
- shots:
  - medium — the price tag — on "In"

## Frame 2 — The puzzle

- duration: 9s
- hold: 0.15s
- transition_in: cut
- src: compositions/frames/02-puzzle.html
- type: pain_point
- scene: order slips stack up; the old price tag is circled and lifted
- engagement: Attention reset + curiosity gap
- anchor: scene
- reset: punch-in
- gap_question: So why would a website keep showing a price that no longer exists?
- claims: c1, c3
- shots:
  - close — the orders — on "orders"
  - insert — the price tag — on "price"

## Frame 3 — Name it

- duration: 5s
- hold: 0.15s
- transition_in: cut
- src: compositions/frames/03-define.html
- type: product_intro
- scene: the dictionary card fills in; a page copy slides onto a stack below
- engagement: Grounding definition
- anchor: own
- definition: Caching is keeping a saved copy of something so it can be served faster.
- part_of_speech: noun

## Frame 4 — Walk it

- duration: 13s
- hold: 0.15s
- transition_in: cut
- src: compositions/frames/04-walk.html
- type: feature_showcase
- scene: the tracker lights request, check the copy, serve the copy, refresh, each on the bakery's page
- engagement: Worked example + progress tracker
- anchor: scene
- claims: c2
- shots:
  - wide — the sourdough page — on "Step"
  - close — the saved copies — on "copy"
  - insert — the 24 hours stamp — on "lasts"

## Frame 5 — The click

- duration: 8s
- hold: 0.15s
- transition_in: cut
- src: compositions/frames/05-click.html
- type: feature_showcase
- scene: a dotted line runs from the old copy to the price tag going out
- engagement: State change + payoff
- anchor: scene
- claims: c1, c2
- shots:
  - insert — the saved copy — on "copy"
  - close — the old price — on "price"

## Frame 6 — The other side

- duration: 8s
- hold: 0.15s
- transition_in: cut
- src: compositions/frames/06-other-side.html
- type: social_proof
- scene: the clerk changes the price and the saved copy is cleared
- engagement: Cached understanding + boundary
- anchor: scene
- claims: c4
- shots:
  - medium — the bakery and the price — on "bakery"
  - close — the saved copy — on "copy"

## Frame 7 — The takeaway

- duration: 6s
- hold: 0.15s
- transition_in: cut
- src: compositions/frames/07-takeaway.html
- type: benefit_highlight
- scene: a fresh price tag lands; a small clock beside the page
- engagement: Payoff + distillation
- anchor: own
- ground: forest
- claims: none
- shots:
  - medium — the cache — on "cache"
  - close — the saved copy — on "clear"

## Frame 8 — Close

- duration: 2.5s
- transition_in: cut
- src: compositions/frames/08-close.html
- type: branding
- engagement: Brand close
- ground: white
- scene: White screen; the Helios logo animates in and AI BRAIN BREAK writes itself beneath it, centred together
