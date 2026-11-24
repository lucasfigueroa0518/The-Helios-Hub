# AI News Explained — the format

Decisions: `DECISIONS.md` RC-26 to RC-44. This spec is what the prompts, the lint, the preset and the
kit implement.

## What it is

A recent (≤ 90 days), true AI news story, told as a story. The story is the star; the viewer comes away
knowing what happened, why it happened (the concept), and one thing to keep. It sits beside Explainer
Reels (analogy-led, paper world, critters) and must not feel like one: a different structure, look and sound,
told in the same Lucas voice.

## The arc (about 60s)

| # | Act | Its job | Words |
|---|-----|---------|-------|
| 1 | Cold open | Engineered to stop the scroll (RC-35): the most surprising specific about a known player, moving on frame 0, an open loop; tested on a stranger. The AI NEWS EXPLAINED sting (code) follows the line. | 10–18 |
| 2 | Setup | When, where, who, what they wanted, what was at stake. A date or place stamp is on screen. | 22–34 |
| 3 | The moment | The event played out, with its real artifact recreated (the post, the reply, the filing, the statement); the detail someone noticed. | 22–34 |
| 4 | Fallout | What it cost or changed: numbers, reactions, headlines. | 14–24 |
| 5 | What actually happened | The reveal: what was going on inside the technology. The concept is named once ("that's called …", or the narrator's own way in) and explained through this event's own facts. | 30–42 |
| 6 | Since then | What happened next and where it stands now. | 14–24 |
| 7 | For you | The one line the viewer keeps: what this means for anyone using or building with AI. | 8–16 |
| 8 | Close | 2.5s, no voice, built by code: the Helios logo and AI NEWS EXPLAINED. | 0 |

About 150–210 spoken words at 180–200 wpm; pauses ≤ 0.2s.

## Writing

- A narrator telling a story: momentum, short sentences, concrete specifics (dates, numbers, places,
  companies, products, public figures). Present tense where it adds drama.
- The story leads; the concept serves it. Act 5 is the only act that teaches, and it teaches through
  this event, never in generic steps.
- No attribution phrasing ("according to", "X said", "reportedly"): say what the sources establish,
  straight. A quoted artifact on screen is the event itself, not attribution.
- Every sentence traces to a checked fact. Numbers and names come only from the facts. A quote shown on
  screen appears word for word in its source.
- Private individuals are never named; they go by their role.

## Look: true-crime documentary (RC-39 to RC-42)

- **Three scenes, all in every reel (RC-44):** the **bulletin board** (cork, push pins, red cord), the
  **whiteboard** (items held by magnets, marker arrows, circles and short handwritten notes; default for
  the reveal), and the **newspaper** (a newsprint page as the surface, marker markups circling and
  connecting its headlines, photos and lines; suits setup and fallout).
- **The case board:** a cork bulletin board under a warm practical lamp, vignette and film grain.
  Evidence is pinned with real push pins and tied with red cord: real newspaper clippings (newsprint,
  grain, halftone photos, column and headline design, torn edges, tape), printouts of posts and
  statements, typed notices and index cards, manila evidence tags, Polaroids.
- **Players:** a blue-chip person as a Polaroid of their banked photo cutout; a company as its banked
  logo printed and pinned; anyone else a faceless silhouette; private people never shown or named.
- **Objects:** a common object the story mentions is a real stock photo, cut out and pinned (RC-41).
- **One thing at a time (RC-40):** each shot gives one item full attention; the camera moves along the
  cords from item to item.
- **No boxes of words (RC-42):** the evidence explains: where the cord runs, dates on tags, what the
  system never saw pinned apart, a marker circle on the cause. The term is a dictionary clipping.
- **Accent:** the Helios orange marker for the one key detail; the cord is red. Pragmatica Extended for
  captions and the AI NEWS EXPLAINED stamp; newspaper serifs and typewriter type on the evidence.
- Direction stills: `.explainers-local/previews/ai-news-truecrime/`.

## Sound and voice

- The narrator is the Lucas Figueroa voice (HeyGen, the same voice Explainer Reels uses; RC-38).
- Music: its own rotation, picked by code. Sound effects: every visible motion has a sound (pins, card
  slides, stamps, marker strokes, whooshes, low hits on reveals), from the shared library.
- The sting has its own sound.

## The pool

- The scout searches recent AI news (≤ 90 days), picks events with a real story, and returns a fact
  sheet that covers every act: timeline, cast, the moment, fallout, the reveal, since then, artifacts.
- Code checks each claim's excerpt on its source page (an artifact's verbatim text included).
- Jev scores the story: stakes, turn, scene, reveal, artifacts, cast, freshness; gates: private person
  at the center, facts cover the arc, same event as a pooled or made story.
- A story leaves the pool when its event turns 90 days old.
