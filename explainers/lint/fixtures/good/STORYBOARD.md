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
- ground: paper
- hook: the carrier sprints up the drive, the letter flies into the mailbox, and the flag slams up before the carrier stops
- steps:
  - something happens at the store — the event fires
  - the carrier brings a letter to the mailbox — POST to the endpoint
  - the letter drops in — payload delivered
  - the flag snaps up — your app updates
- entities:
  - mailbox — a mailbox on a post — stands for your app's webhook URL — a tall box on a thin post, a rounded lid slab — beats 1, 2, 4, 5, 6
  - letter — a letter — stands for the event payload — a thin paper sheet folded in thirds — beats 1, 4, 5, 6
  - flag — the mailbox flag — stands for the notification your app receives — an orange slab on a hinge — beats 1, 2, 4, 5, 6
  - carrier — a mail carrier critter — stands for the other app sending the event — an ink critter with a bag — beats 1, 4, 5
- states: letters delivered 0 → 1 → 2; flag down → up; trips to check 0 the whole time
- layout: the mailbox centred on the table, the drive running in from the left, the carrier entering along it

## Hook

1. the carrier sprints up the drive, the letter flies into the mailbox, and the flag slams up before the carrier stops — clarity 4/5, thumb-stop 4/5
2. a critter peeks out of the house window at an empty mailbox, again and again — clarity 5/5, thumb-stop 3/5
3. the flag pops up on its own while the critter sleeps in a chair — clarity 4/5, thumb-stop 3/5
- pick: 1 — a mail carrier racing to a mailbox reads at a glance, and the flag snapping up on its own makes you ask why

## Curiosity gap

1. How do you know a letter arrived without walking out to the mailbox? — reach 5/5, value 4/5, closable 5/5
2. Why does the flag go up on its own? — reach 4/5, value 3/5, closable 5/5
3. Who tells the house a letter came? — reach 3/5, value 4/5, closable 4/5
- pick: 1 — everyone has waited on mail, and the flag answers it in one picture
- closed_by: frame 4, when the letter drops in and the flag snaps up

## Frame 1 — Series opener

- duration: 3.5s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/01-opener.html
- type: hook
- engagement: Open loop + visual hook + audio ramp
- voiceover: "In the next 30 seconds, this little mailbox will teach you an AI concept."
- anchor: scene
- shots: medium — the carrier racing to the mailbox — at 0s
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
- voiceover: "The mailbox sits at the end of a long drive. So how would you know the moment a letter lands, without walking out? Watch: apps tell each other the same way."
- gap_question: "So how would you know the moment a letter lands, without walking out?"
- anchor: scene
- shots: close — the empty mailbox — on "mailbox"; insert — the letter in the mailbox — on "letter"
- reset: the ground flips to night and the camera punches in on the mailbox
- ground: night
- scene: The mailbox alone at the end of a long drive at night, the house far behind it

narrativeRole: Poses the gap inside the anchor world.
keyMessage: Checking the mailbox is a long walk for nothing.

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
- engagement: Scene setting + analogy anchor + anticipation
- voiceover: "Here's the trick: a flag on the mailbox. A carrier brings letters. When one drops in, the flag snaps up. That's how you know the moment a letter lands."
- anchor: scene
- shots: wide — the drive and the mailbox — at 0s; medium — the carrier and the letter — on "letters"; close — the flag — on "flag"
- ground: paper
- scene: Establishing shot of the mailbox; the carrier walks in, the letter drops in, and the flag snaps up

narrativeRole: Plays out the mechanism as an everyday scene.
keyMessage: You find out because the mailbox tells you, not because you checked.

## Frame 5 — Map the analogy

- duration: 10s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/05-map.html
- type: feature_showcase
- engagement: Cached understanding + progressive disclosure
- voiceover: "The mailbox is your app's address, because messages arrive there. The letter is the event, because it carries what happened. The flag is your alert, because it tells you at once."
- anchor: scene
- shots: medium — the mailbox with its label — on "mailbox"; close — the flag with its label — on "flag"
- ground: paper
- scene: Labels land one at a time on the mailbox, the letter, and the flag as each because is spoken

narrativeRole: Maps each part of the scene onto the real components.
keyMessage: Webhook URL, event payload, notification.

## Frame 6 — Tiny real example

- duration: 10s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/06-example.html
- type: social_proof
- engagement: Worked example + progress tracker
- voiceover: "Here's a real example. A store ships order 4821. It sends one message to your app's address. Your app updates in a second."
- anchor: own
- example_steps: payment goes through → store sends a POST → order app updates
- shots: insert — the store's order 4821 — on "store"; insert — the message to your app — on "sends"; insert — the order screen updating — on "updates"
- ground: paper
- scene: A second letter reading order 4821 drops in while the step tracker lights event fires, POST to the endpoint, payload delivered, your app updates

narrativeRole: Runs the mechanism once with a real example.
keyMessage: One event, one message, instant update.

## Frame 7 — Real world

- duration: 6s
- hold: 0.15s
- transition_in: cut
- status: outline
- src: compositions/frames/07-real-world.html
- type: benefit_highlight
- engagement: Recognition
- voiceover: "In everyday life, you meet webhooks when a payment, a booking, or a reply reaches you instantly."
- anchor: own
- shots: medium — a critter at a phone getting a payment — at 0s; close — the phone's reply — on "reply"
- ground: forest
- scene: A paper phone on a counter lights with a payment receipt card

narrativeRole: Shows where the viewer meets this.
keyMessage: Instant alerts in your life are webhooks.

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
