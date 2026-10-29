---
format: 1080x1920
duration: 60s
message: "A webhook is an app ringing your doorbell the moment something happens, so you never have to keep checking."
arc: concept-explainer
mode: autonomous
term: webhook
concept: webhook
audience: broad business audience, nontechnical through technically curious
music: none
---

## Visual arc

- throughline: one letter's trip from the sender to the mailbox, then the same trip as a real message, ending with the alert raised by the sender
- colour script: 1 morning, warm and open; 2 day on paper and glass; 3 day, calm; 4 morning sun on the lawn; 5 morning sun; 6 day on paper and glass; 7 the warmest light of the reel
- motifs: the flag snapping up; it comes back in frame 7 as the order screen's alert lighting on its own
- intensity: quick at the hook, a calm rest at the hand-off, rising through the analogy, resolved at the tie-together
- bridges: frame 5 to 6, the letter carries across the cut and becomes the order message

## Anchor scene

- metaphor: a mailbox whose flag pops up the instant a letter lands, so nobody walks out to check it
- places:
  - lawn — exterior: a curbside lawn at the end of a short gravel drive, the house behind — the carrier delivers and the flag goes up
- hook: the carrier sprints up the drive, the letter flies into the mailbox, and the flag slams up before the carrier stops
- hero: carrier — critter
- steps:
  - something happens at the store — the event fires
  - the carrier brings a letter to the mailbox — POST to the endpoint
  - the letter drops in — payload delivered
  - the flag snaps up — your app updates
- entities:
  - mailbox — a mailbox on a post — stands for your app's webhook URL — prop: mailbox (exact: an American rural curbside mailbox on a post, in a house curb) — beats 1, 4, 5
  - letter — a letter — stands for the webhook message, the event's payload — a thin paper sheet folded in thirds, cheated big so it reads — beats 1, 4, 5, 6
  - flag — the mailbox flag — stands for the notification your app receives — a slab on a hinge — beats 1, 3, 4, 5, 7
  - carrier — a mail carrier critter — stands for the other app sending the event — a critter in a mail carrier's uniform with a mailbag across the body — beats 1, 4, 5
- states: letters delivered 0 → 1; flag down → up; trips to check 0 the whole time

## Hook

1. the carrier sprints up the drive, the letter flies into the mailbox, and the flag slams up before the carrier stops — clarity 4/5, thumb-stop 4/5
2. a critter peeks out of the house window at an empty mailbox, again and again — clarity 5/5, thumb-stop 3/5
3. the flag pops up on its own while the critter sleeps in a chair — clarity 4/5, thumb-stop 3/5
- pick: 1 — a mail carrier racing to a mailbox reads at a glance, and the flag snapping up on its own makes you ask why

## Frame 1 — Series opener

- duration: 3.5s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/01-opener.html
- type: hook
- ground: paper
- look: world
- voiceover: "In the next minute, this little mailbox will teach you a tech concept."
- shots:
  - medium — the carrier racing to the mailbox — at 0s — angle: low at the drive's edge, the mailbox ahead and the house behind — why: a race to a mailbox reads at once, and the flag going up on its own makes you wonder why — cast: carrier, mailbox, letter — place: lawn
- scene: The carrier sprints up the drive and the flag slams up mid-stride

## Frame 2 — Quick definition

- duration: 5s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/02-define.html
- type: product_intro
- ground: paper
- look: mechanism
- voiceover: "A webhook is when one app sends another a message the moment something happens."
- shots:
  - medium — one app sending a message to another — at 0s — angle: straight on, the two apps side by side — why: the whole idea in one picture
  - close — the message arriving — on "message" — angle: in on the receiving app — why: it lands the moment it is sent
- scene: One laptop sends a single envelope to a second laptop, which lights up as it lands

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
- handoff_parts: mailbox, letter, flag
- world_sounds: footstep, creak
- scene: The card "today's AI Brain Break: webhook", the lawn and its mailbox showing around it

## Frame 4 — Everyday analogy

- duration: 13s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/04-analogy.html
- type: feature_showcase
- ground: paper
- look: world
- voiceover: "This mailbox is where messages land. The carrier, the sending app, brings a letter, the message. When it drops in, the flag snaps up on its own, so nobody walks out to check."
- shots:
  - wide — the mailbox by the drive — at 0s — angle: eye level from across the lawn, the house behind — why: where we are and what waits for the letter — cast: mailbox, flag — place: lawn
  - medium — the carrier and the letter — on "carrier" — angle: low from the drive, the mailbox ahead — why: the sender arrives with the message — cast: carrier, letter, mailbox — place: lawn
  - close — the flag — on "flag" — angle: from the mailbox's side, level with the flag — why: the alert goes up with nobody checking — cast: flag, mailbox — place: lawn
- scene: The mailbox on the lawn; the carrier walks in, the letter drops in, and the flag snaps up

## Frame 5 — Definition payoff

- duration: 10s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/05-payoff.html
- type: feature_showcase
- ground: paper
- look: world
- definition: "A webhook is a letter one app drops in another app's mailbox the moment something happens."
- part_of_speech: noun
- voiceover: "A webhook is a letter one app drops in another app's mailbox the moment something happens. It works because the sender raises the flag, so nobody has to check."
- shots:
  - medium — the letter pushing the flag up — on "works" — angle: from the street side, looking back at the house — why: the sender's own delivery raises the alert — cast: letter, flag, mailbox — place: lawn — carry: letter box 400 1000 680 1300
- scene: The dictionary card fills in; below it, the letter pushes the flag up on its own

## Frame 6 — Tiny real example

- duration: 11s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/06-example.html
- type: social_proof
- ground: paper
- look: mechanism
- voiceover: "Here's a real example. A store ships order 4821. It sends one message to your app's address. The message lands with the order number. Your app updates in a second."
- shots:
  - medium — the store's order 4821 — on "store" — angle: straight on, the store's laptop on the left — why: the event that starts it — carry: letter box 400 1000 680 1300
  - medium — the message to your app — on "sends" — angle: straight on, the route from the store to the app — why: one message travels, nobody asks
  - insert — the message landing with the order number — on "lands" — angle: in on the app's address — why: the order number arrives with it
  - close — the order screen updating — on "updates" — angle: straight on, the phone's order screen — why: the result, a second later
- scene: Order 4821 ships on the store's laptop, one message travels to the app's address, lands with the order number, and the phone's order screen updates

## Frame 7 — Tie-together

- duration: 8s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/07-tie.html
- type: benefit_highlight
- ground: paper
- look: blend
- voiceover: "The store raised the flag itself, the moment the order shipped. So when an app updates the instant something happens, you know a message just landed."
- shots:
  - medium — the mailbox flag fading over the phone's alert — at 0s — angle: straight on, the phone and the store's laptop — why: the analogy's flag and the real alert are the same trick
  - close — the app updating its alert — on "app updates" — angle: in on the phone's screen — why: what it means for the viewer, in real terms
- scene: The mailbox flag fades over the phone's order alert, which lights on its own

## Frame 8 — Close

- duration: 2.5s
- transition_in: cut
- status: outline
- src: compositions/frames/08-close.html
- type: branding
- ground: white
- scene: White screen; the Helios logo animates in and AI BRAIN BREAK writes itself beneath it, centred together
