# AI News Explained — the format

Decisions: `DECISIONS.md` RC-26 to RC-32. This spec is what the prompts, the lint, the preset and the
kit implement.

## What it is

A recent (≤ 90 days), true AI news story, told as a story. The story is the star; the viewer comes away
knowing what happened, why it happened (the concept), and one thing to keep. It sits beside Explainer
Reels (analogy-led, paper world, critters) and must not feel like one: different structure, look, sound
and voice.

## The arc (about 60s)

| # | Act | Its job | Words |
|---|-----|---------|-------|
| 1 | Cold open | The most striking moment of the story, stated so a stranger stops scrolling. The AI NEWS EXPLAINED sting (code) follows the line. | 10–18 |
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

## Look: newsroom case file

- Ground: dark graphite with fine grain; type off-white; one red accent for the thing that matters now.
- Type: a condensed bold headline face; a mono face for stamps, labels and timestamps; a plain sans for
  artifact body text.
- The story is told through **recreated artifacts** (posts, chat replies, headlines, statements,
  filings, documents), **stamps** (date, place), **numbers** (big figures, a chart), **timelines**, and
  **simple faceless silhouettes** with a name or role lower-third. Highlighter, circle and redaction
  marks point at the detail that matters.
- No real logos, photos or copies of a product's screens: artifacts are drawn in the reel's own style
  with their verbatim text.
- Camera: push into a detail, whip cut between artifacts, highlight-then-zoom. Every move has a job.

## Sound and voice

- Its own narrator voice (documentary/news register), separate from Explainer Reels.
- Music: a tense, low news/documentary bed, its own rotation.
- Sound effects: teletype, shutter, whoosh, low hit, data blip, highlighter, paper slide for documents.
- The sting has its own sound.

## The pool

- The scout searches recent AI news (≤ 90 days), picks events with a real story, and returns a fact
  sheet that covers every act: timeline, cast, the moment, fallout, the reveal, since then, artifacts.
- Code checks each claim's excerpt on its source page (an artifact's verbatim text included).
- Jev scores the story: stakes, turn, scene, reveal, artifacts, cast, freshness; gates: private person
  at the center, facts cover the arc, same event as a pooled or made story.
- A story leaves the pool when its event turns 90 days old.
