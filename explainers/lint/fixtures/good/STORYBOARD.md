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

## Anchor scene

- metaphor: a mailbox whose flag pops up the instant a letter lands, so nobody walks out to check it
- setting: table
- set: a curbside lawn at the end of a short gravel drive, the house's front step behind it; tells: the mailbox on its post, the gravel drive, the porch steps, a low picket fence; walls and openings: the house front with its door and a window; density: lived
- beyond: the quiet street past the fence, seen behind the mailbox; no other place
- ground: paper
- hook: the carrier sprints up the drive, the letter flies into the mailbox, and the flag slams up before the carrier stops
- hero: carrier — critter
- steps:
  - something happens at the store — the event fires
  - the carrier brings a letter to the mailbox — POST to the endpoint
  - the letter drops in — payload delivered
  - the flag snaps up — your app updates
- entities:
  - mailbox — a mailbox on a post — stands for your app's webhook URL — prop: mailbox (exact: an American rural curbside mailbox on a post, in a house curb) — size: 48 × 23 × 120 cm — beats 1, 2, 4, 5, 6
  - letter — a letter — stands for the webhook message, the event's payload — a thin paper sheet folded in thirds — size: 24 × 11 cm (exaggerate 1.3×) — beats 1, 4, 5, 6
  - flag — the mailbox flag — stands for the notification your app receives — an orange slab on a hinge — size: 20 cm — beats 1, 2, 4, 5, 6
  - carrier — a mail carrier critter — stands for the other app sending the event — a critter with a bag, look: orange, outfit a mail carrier's uniform: blue shirt and shorts, a mailbag across the body, a name badge — beats 1, 4, 5
- states: letters delivered 0 → 1; flag down → up; mailbox on its post → gone (frame 5); trips to check 0 the whole time
- layout: the mailbox centred on the table, the drive running in from the left, the carrier entering along it

## Hook

1. the carrier sprints up the drive, the letter flies into the mailbox, and the flag slams up before the carrier stops — clarity 4/5, thumb-stop 4/5
2. a critter peeks out of the house window at an empty mailbox, again and again — clarity 5/5, thumb-stop 3/5
3. the flag pops up on its own while the critter sleeps in a chair — clarity 4/5, thumb-stop 3/5
- pick: 1 — a mail carrier racing to a mailbox reads at a glance, and the flag snapping up on its own makes you ask why

## Curiosity gap

Say this line in frame 2, word for word (written by the gap writer, picked by Jev, EX3-120):

> A store takes your card, and a second later your phone buzzes with the payment. Nobody refreshed anything. So how does the app know the moment it happens?

- gap_question: So how does the app know the moment it happens?
- way in: everyday mystery
- score: 87.5 of 100
- closed_by: frame 7, when the voice says the store sends the app a message

## Frame 1 — Series opener

- duration: 3.5s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/01-opener.html
- type: hook
- engagement: Open loop + visual hook + audio ramp
- voiceover: "In the next minute, this little mailbox will teach you a tech concept."
- anchor: scene
- shots: medium — the carrier racing to the mailbox — at 0s — cast: carrier, mailbox, letter — angle: low at the drive's edge, the mailbox ahead and the house behind
- ground: paper
- scene: The carrier sprints up the drive and the flag slams up mid-stride; then the handwritten title card

narrativeRole: Opens the loop on a moment the viewer cannot explain yet.
keyMessage: Something here happens on its own, and the reel will show how.

## Frame 2 — Curiosity gap

- duration: 9s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/02-gap.html
- type: pain_point
- engagement: Attention reset + curiosity gap
- voiceover: "A store takes your card, and a second later your phone buzzes with the payment. Nobody refreshed anything. So how does the app know the moment it happens?"
- gap_question: "So how does the app know the moment it happens?"
- anchor: own
- technique: process — the payment message travels from the store to the phone in one hop, and the phone lights as it lands
- shots: close — the phone buzzing — on "phone"; close — the payment message — on "payment"
- reset: the studio light snaps brighter and the camera punches in on the phone
- ground: paper
- scene: The hook's staging with the real thing in the mailbox's place: a payment message races in along a route, lands on a glass phone alone in the frame, and the phone lights up, plenty of empty space around it

narrativeRole: Poses the gap about the real thing the viewer uses.
keyMessage: The app knew at once, and nobody asked it.

## Frame 3 — Define the concept

- duration: 7s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/03-define.html
- type: product_intro
- engagement: Grounding definition
- definition: "A webhook is a message one app sends to another app's web address the moment an event happens, like a payment going through."
- part_of_speech: noun
- term_part: letter — the letter the carrier drops in
- technique: process — one envelope travels from the store's app to the other app's address the moment the payment clears
- voiceover: "A webhook is a message one app sends to another app's web address the moment an event happens, like a payment going through."
- anchor: own
- ground: paper
- scene: The dictionary card fills in; below it, a payment slab sends one envelope to a second app slab

narrativeRole: Grounds the viewer in what a webhook is.
keyMessage: One app tells another the moment something happens.

## Frame 4 — Everyday analogy

- duration: 12s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/04-analogy.html
- type: feature_showcase
- engagement: Analogy anchor + progressive disclosure + anticipation
- voiceover: "Here's the trick: a flag on the mailbox. It is our alert. A carrier, the other app, brings a letter, the event. When it drops in, the flag snaps up on its own."
- anchor: scene
- shots: wide — the drive and the mailbox — at 0s — cast: mailbox, flag — angle: eye level from across the lawn, the house behind; medium — the carrier and the letter — on "carrier" — cast: carrier, letter, mailbox — angle: low from the drive, 40 degrees left of the wide; close — the flag — on "flag" — cast: flag, mailbox — angle: from the mailbox's side, level with the flag
- ground: paper
- scene: Establishing shot of the mailbox; the carrier walks in, the letter drops in, and the flag snaps up

narrativeRole: Plays the analogy, naming each part's real job as it appears.
keyMessage: The mailbox tells you; nobody has to check.

## Frame 5 — Why it works, where it breaks

- duration: 10s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/05-why.html
- type: feature_showcase
- engagement: Cached understanding + boundary
- voiceover: "The flag goes up because the letter itself raises it, so nobody walks out to check. That is the webhook's trick. But if the mailbox is gone, the letter has nowhere to land."
- anchor: scene
- shots: medium — the letter pushing the flag up — on "flag" — cast: letter, flag, mailbox — angle: from the street side, looking back at the house; insert — the empty post where the mailbox stood — on "mailbox" — cast: letter — angle: high, looking down at the bare post
- ground: paper
- scene: The letter pushes the flag up in an insert; then the mailbox is gone and the next letter drops onto the bare post

narrativeRole: Shows why the analogy works, then its one limit.
keyMessage: The sender does the telling; it only works while your app is there to receive.

## Frame 6 — Tiny real example

- duration: 10s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/06-example.html
- type: social_proof
- engagement: Worked example + progress tracker
- voiceover: "Here's a real example. A store ships order 4821. It sends one message to your app's address. The message lands with the order number. Your app updates in a second."
- anchor: own
- example_steps: order 4821 ships → store sends message → message lands → order screen updates
- technique: process — order 4821's message travels from the store to the app's address, one stop at a time
- shots: close — the store's order 4821 — on "store"; close — the message to your app — on "sends"; close — the message landing with the order number — on "lands"; close — the order screen updating — on "updates"
- ground: paper
- scene: The step tracker lights the event fires, POST to the endpoint, payload delivered, your app updates, while close shots show order 4821 shipping, the store's message, the message landing and the order screen updating

narrativeRole: Runs the mechanism once with a real example.
keyMessage: One event, one message, instant update.

## Frame 7 — The payoff

- duration: 6s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/07-payoff.html
- type: benefit_highlight
- engagement: Payoff + callback + distillation
- voiceover: "Your app knows the moment it happens because the store sends it a message as the payment clears. Nobody checks; the flag just goes up."
- anchor: own
- technique: cause-effect — the payment clearing sends the message that lights the phone, with no one checking
- shots: medium — the phone getting the store's message — at 0s; close — the order screen's alert flag lighting — on "flag"
- ground: paper
- scene: A glass phone lights with the store's payment message; the order screen's alert flag lights on its own, resolved

narrativeRole: Answers frame 2's question in real terms, then the takeaway.
keyMessage: The sender tells your app; your app never has to ask.

## Frame 8 — Close

- duration: 2.5s
- transition_in: cut
- status: outline
- src: compositions/frames/08-close.html
- type: branding
- engagement: Brand close
- ground: white
- scene: White screen; the Helios logo animates in and AI BRAIN BREAK writes itself beneath it, centred together

narrativeRole: Signs the series off.
keyMessage: AI Brain Break, by Helios.
