# Story design — Helios AI News Explained (news-story-v1)

> The AI News Explained story design (planning/Real Case Reels/FORMAT.md, DECISIONS.md RC-26 to
> RC-44). A job installs it as `.claude/skills/faceless-explainer/references/story-design.md`. Use it
> in Step 3 to write `STORYBOARD.md` and `SCRIPT.md`. Every rule here is mandatory.

An AI News Explained reel tells one recent, true AI news story in about a minute, as a story. The story
is the star: who wanted what, what happened, what it cost. Inside it, the reel reveals what was
actually going on in the technology: one concept (the story's **term**), named once and explained
through this event. The viewer leaves knowing what happened, why it happened, and one thing to keep.

## Read first

1. `BRIEF.md`: the **term** (`## Term`), the story's **facts** (`## Facts`, numbered `c1`, `c2`…,
   each with the act it serves), the **players** (`## Players`, each with how it can be shown: a banked
   logo, a banked cutout, or neither), the **artifacts** (`## Artifacts`,
   numbered `a1`, `a2`…, each with its exact words), the **timeline** (`## Timeline`), and the act
   material (`## Story`).
2. `frame.md`: the visual system and the news kit. Story and picture are planned together.

## The facts (HARD CONSTRAINT)

The reel tells a true event, so every fact about it is one of BRIEF.md's facts.

- **Every fact about the event comes from `## Facts`**: who, what, when, where, numbers, causes,
  outcomes, what happened since. Say it as plainly as the fact states it, never stronger: no added
  number, date, cause, motive, superlative, or consequence. List the ids each frame uses in its
  `claims:` field.
- **Tell it straight.** No attribution phrasing: never "according to", "X says", "reportedly",
  "reports say". A fact is stated as a fact, because it is one. A detail the facts do not state is left
  out, never hedged in.
- **Artifacts are shown word for word.** An artifact on screen (a post, a reply, a statement, a
  headline, a filing) shows exactly its words from `## Artifacts`, or a shorter run of them cut at
  word boundaries with `…`; never reworded. The voice may read an artifact's words exactly, as part of
  the event ("The reply: …").
- **Names.** Organizations, products and the public figures listed in `## Players` are named, in voice
  and on screen. A private person is never named: they go by their role, as `## Players` writes it.
- **General explanation is yours**: how the concept works may come from general knowledge, and must be
  accurate. Never present it as something a player said or did.
- **Numbers** are numerals, exactly as the fact gives them. Dates as the fact gives them (a day, or a
  month). Never invent statistics, dates, counts, or quotes.
- **How players appear** (`## Players` says which applies): a company with a banked logo shows its
  real logo, from the kit's logo bank, never redrawn, recoloured or cropped; a person with a banked
  cutout shows their real photo cutout, from the kit's cutout bank; anyone else is the kit's faceless
  silhouette, or a company's name in the reel's lettering. Never any other photo of a person, and never a
  copy of a product's screens: an artifact is recreated in the kit's style.
- **Common objects come from code.** A common object the story mentions (a phone, a car, a map, a
  suitcase, a padlock) is a real photo cutout on the board and the newspaper, and a marker drawing on
  the whiteboard: name it in `## Case file`'s `objects:` plainly, as a shop would label it ("padlock",
  "paper map"), with the acts it appears in; code makes both versions before the build.
- **Never research the event.** Web search may help you check how the concept works; it never adds a
  fact about the event.

## The storytelling (what makes it work)

- **A narrator telling a story to a smart friend.** Short sentences with full stops, one beat each,
  each one moving the story forward. Concrete over abstract: the date, the place, the product, the
  number, the exact words on the screen.
- **Present tense for the moment** where it adds drama (the moment told as it unfolds), past tense for
  background and what happened since; present tense for how the concept works.
- **Momentum.** Every sentence earns the next one. Stakes before the moment; the moment before the
  fallout; the fallout before the reveal. Never explain before the viewer wants the explanation.
- **The reveal is the payoff, not a lecture.** It answers the question the story raised, in this
  event's own terms: what the system saw, what it did, and why that produced what everyone saw.
- Plain-spoken and authoritative. No hype words, no exclamation marks, no emoji, no rhetorical filler
  ("Let's dive in", "Here's the thing", "Imagine…"), no "not X, but Y", no toss to the next act ("But
  that's not all").

## Showing it: the case board (HARD CONSTRAINT)

The reel looks like a true-crime documentary, told across three scenes (frame.md). **Every reel uses
all three**, each at least once in frames 1 to 7; a frame's `ground:` names its scene:

- `board` — the **bulletin board**: cork, push pins and red cord tying the evidence together. It suits
  the evidence of the moment: artifacts, objects, players.
- `newspaper` — the **newspaper**: a real newspaper page is the surface; marker markups circle,
  underline and connect its headlines, photos and lines. It suits the setup and the fallout: the
  launch, the numbers, the reaction as the press told it (only the facts, in print).
- `whiteboard` — the **whiteboard**: everything drawn in dry-erase marker, stroke by stroke (people
  as line sketches, objects as line drawings, short handwritten notes, arrows and circles connecting
  them); only the verbatim artifact and a printed logo are paper, held by a magnet. It suits working
  out the mechanism in the reveal.

Pick each frame's scene for what it shows best; a scene change is also an attention reset.

- **One thing at a time.** Each shot gives one item the viewer's full attention: a clipping, a photo, an
  artifact, a tag. The camera moves from item to item, along the cords, instead of showing a frame's
  evidence all at once. A frame's items arrive one per shot.
- **The evidence explains, never boxes of words.** Show what happened with the objects, the artifacts,
  where the red cord runs, the order things arrive, a date on a tag, a marker circle. Never a card or
  tile whose words stand for a step or a concept. A short typed tag may name an item or a date, as on a
  real case board.
- **Real paper.** Headlines and statements appear as clippings, printouts or notices, in their own words
  (artifacts) or as the facts state them.

## Understood on the first watch (HARD CONSTRAINT)

A stranger watches once, on a phone, with no context. Every rule here exists because a first-time
viewer got lost without it.

- **Shots follow the voice.** What is on screen is what the voice is naming at that moment.
- **Only what is on screen.** Never refer to something the viewer has not seen or heard: a player is
  named and shown before "they" or "it" stands for them.
- **Plain roles and plain words.** A player is named with what they are ("Harbor City Transit, the
  city's bus and train agency") the first time. One new technical word at a time, said in plain words
  the first time; never two in one sentence.
- **The question is the viewer's own.** Act 4's question is the one a stranger would ask after the
  fallout, in their words, about what they just saw; never a question about a mechanism they have not
  met. The reveal closes exactly that question.
- **The reveal replays the moment.** Act 5 shows the moment's own artifact or picture again, now with
  the mechanism drawn over it, so the viewer maps the concept onto what they already saw.
- **The payoff is in real terms.** Act 7 is true to the reveal and useful to someone who uses or builds
  with AI; never a slogan.
- **Length follows understanding.** Never drop a step the viewer needs to save a second; never pad.

## The eight acts (fixed order, fixed `type`)

| # | Nominal | Act | `type` | Words | `hold` |
|---|---|---|---|---|---|
| 1 | 5s | Cold open: the most striking moment, then the code-built AI NEWS EXPLAINED sting | `cold_open` | 10–18 | 1.2s (the sting) |
| 2 | 9s | Setup: when, where, who, what they wanted, what was at stake | `setup` | 22–34 | 0.15s |
| 3 | 9s | The moment: it plays out, with the real artifact on screen | `moment` | 22–34 | 0.15s |
| 4 | 6s | Fallout: what it cost or changed, then the question the reveal answers | `fallout` | 14–24 | 0.15s |
| 5 | 12s | What actually happened: the concept, named once, explained through this event | `reveal` | 30–42 | 0.15s |
| 6 | 6s | Since then: what happened next, where it stands now | `since` | 14–24 | 0.15s |
| 7 | 4s | For you: the one line the viewer keeps | `for_you` | 8–16 | 0.15s |
| 8 | 2.5s | The close (code's): the Helios logo and AI NEWS EXPLAINED, no voice | `branding` | none | none |

Do not add, drop, merge, or reorder acts. Each frame's `duration` is its voice plus its `hold` (code
sets both from the real voice; write the nominal values); the close is a fixed 2.5s. About 140–200
spoken words in all. Never cut a fact's meaning to save words, and never pad.

### 1 · Cold open (engineered to stop the scroll)

The viewer decides in the first second and a half. The cold open is built for that second, and tested.

- **The line** (10–18 words, the voice starts on frame 0): the single most surprising specific of the
  story, about a player the viewer knows, ending on the turn. Lead with the strongest word: the player,
  the number, or the outcome. It opens a loop: the viewer knows exactly what happened and needs to know
  how or why. **Never** background, a date or a place first ("In March…", "Last week…"), a question
  ("Have you ever…?"), a framing line ("This is the story of…", "Here's how…"), a superlative the facts
  don't state, or the term.
- **The picture** (in motion on frame 0): the story's most striking thing, readable within one second:
  the key artifact with the key detail marked, the key number circled, or the player's cutout or logo
  against it. One focal point, at most 7 words on screen besides the artifact, and a pattern break on
  frame 0 (a slam, a punch-in, a mark drawing on). Never a title, a logo sting, or a calm build first.
- **Three candidates, three different hooks** (`## Cold open`): pick three of these kinds, one each:
  the number (a striking figure and what it cost), the irony (it did the opposite of its job), the
  artifact (the real words, damning on their own), the player (a known name in an unlikely spot), the
  stakes (who got hurt or what was risked). Score each 1–5 on **clarity** (a stranger knows what they
  are looking at within one second), **thumb-stop** (they stop), and **open loop** (they need the rest).
  Pick the best total with clarity and open loop at 4 or more.
- **The sting is code's**: after the line, AI NEWS EXPLAINED slams in over the frame (the `hold`).
  Plan the line and the picture; never the sting's text, sound or timing.

### 2 · Setup

Rewind to the start: when and where (a date or place stamp is on screen), who is involved (the players,
by name and role), what they wanted, and what was at stake. Opens on an attention reset from the sting
(a new item, close). One player per shot, shown as `## Players` allows (logo, cutout, or silhouette), with
a typed tag naming each the first time.

### 3 · The moment

The event plays out, in order, as a scene: who did what, and what appeared. The key artifact is
recreated on screen and builds in as the voice reaches it; the detail someone noticed is marked (an
underline, a circle, a highlight in the key color) on the word it lives in. This is the reel's richest
picture.

### 4 · Fallout

What it cost or changed: the numbers (the figure in print, circled on its word), the reactions, the
decisions, from the facts. It ends on **the question** the reveal answers, in the story's own words and
as the viewer would ask it: why the technology did what it did. Write it in `question:` and in
`## Question`. Never name the term here: act 5 does.

### 5 · What actually happened

The reveal. It opens by bringing back the moment's own artifact (on the whiteboard, by default), then
answers act 4's question through the concept's mechanism, shown with the evidence: what the system had (the item it
learned from or read, held up and tagged), what it did, and why that produced what everyone saw. A cord
or a marker arrow runs from the outcome back to its cause; what the system never saw sits apart,
unconnected. **Name the term once, exactly as `## Term` writes it**, as
the voice reaches it; the term and its meaning (`term_card:`, 14 words or fewer, plain words) are
written in marker on the whiteboard, or shown as a dictionary clipping on the board or newspaper. At most two new technical words beyond the term, each
said in plain words the first time. The cause gets the marker circle in the key color.

### 6 · Since then

What happened next and where it stands now, from the facts: the fix, the response, the ruling, the
open question. A newer clipping or printout is pinned over the old evidence, dated.

### 7 · For you

One line the viewer keeps: what this means for anyone who uses or builds with AI. General advice, true
to the reveal, said plainly. Not a summary of the story.

### 8 · The close

Built by code: the Helios logo and AI NEWS EXPLAINED, 2.5s, no voiceover. Copy the skeleton's frame 8
block as it is; write no line for it in `SCRIPT.md`.

## `## Case file` (write it before the frames)

What the reel shows, decided once, reused by every frame.

```md
## Case file

- when: <the event date as the facts give it> · where: <the place, or "online", or none>
- key artifact: <artifact id> — <why it is the picture of the story>
- key detail: <the exact words or number the reel marks in the key color> — <artifact id or fact id>
- players:
  - <name as ## Players writes it> — <kind> — <shown as: logo | cutout | silhouette (<pose>) | name card> — acts <n, n>
- artifacts:
  - <artifact id> — <kind> — shown in acts <n, n> — <the words shown: all, or the run cut with …>
- numbers:
  - <the number as the fact gives it> — <fact id> — <shown as: headline | clipping | stamp | note> — act <n>
- objects:
  - <a common object the story mentions, named plainly as a shop would label it> — acts <n, n>
- mechanism: <the reveal's chain of evidence, 2 to 4 links joined with →, each 4 words or fewer — the cause marked "(cause)">
```

- **The key detail** is the one thing the reel marks in the key color; it appears in acts 1, 3 and 5.
- **Players** are named only as `## Players` names them, and shown only as it allows: `logo` only for
  a company `## Players` marks "logo banked", `cutout` only for a person it marks "cutout banked";
  any other person is a `silhouette` (a faceless figure from the kit), any other company a `name card`.
  At most 4 players on screen across the reel.
- **Artifacts** come only from `## Artifacts`, word for word. At most 3 artifacts across the reel.
- **Objects** are common things the story mentions, never a proper noun (a logo or a person has its own
  bank). At most 5 across the reel, or `none`.
- **The mechanism** is planned here and shown as evidence on the board in act 5, never as boxes of words.
- Every number shown comes from a fact.

## `## Cold open` (write it before the frames)

```md
## Cold open

1. <hook kind>: "<the line>" — <the picture on frame 0> — clarity 4/5, thumb-stop 4/5, open loop 5/5
2. <another kind>: "<the line>" — <the picture> — clarity 5/5, thumb-stop 3/5, open loop 4/5
3. <another kind>: "<the line>" — <the picture> — clarity 3/5, thumb-stop 5/5, open loop 4/5
- pick: 1 — <one line on why a stranger stops and needs the rest>
```

Hook kinds: number, irony, artifact, player, stakes; three different ones. **Clarity** (standalone): a
viewer with no context knows what they are looking at within one second. **Thumb-stop:** it makes them
stop. **Open loop:** they need to know how or why. Pick the best total; a candidate below 4 on clarity
or open loop is never picked.

## `## Question` (write it before the frames)

```md
## Question

- question: <the question act 4 ends on, word for word>
- answer: <the reveal, in one sentence>
- closed_by: <the frame and moment that answers it, e.g. "frame 5: the cause marked in the key color">
```

## Frame fields

Every frame block keeps the recipe skeleton's `duration`, `hold`, `transition_in`, `src`, `type`, and
`ground`, and fills:

- `scene`: a one-line picture idea (what is on screen and what moves), not composition detail;
- `voiceover`: the spoken line;
- `claims`: the fact ids the voiceover and the frame's on-screen words use (`c1, c3`); frames 1 to 6
  always have some; frame 7 may say `none`;
- `artifacts`: the artifact ids the frame shows, or `none`;
- `beat`: the target feeling (intrigue, tension, surprise, clarity, satisfaction);
- `shots:` (frames 1 to 7): the frame's shots in order, one per sub-bullet,
  `<kind> — <subject> — on "<cue word>"` (frame.md § Shots). **The subject is what the voice is naming
  while the shot is on screen.** Kinds: wide, medium, close, insert. Frames over 6s cut between at least
  two; no two consecutive shots, and no frame's first shot and the previous frame's last, are the same
  picture;
- frame 2: `stamp:` (the date and place as shown on a typed card, from the facts); frame 4: `question:`
  (word for word); frame 5: `term_card:` (the term's meaning for the dictionary clipping, 14 words or
  fewer).

Under the bullets, two prose lines: `narrativeRole:` (the frame's job in the story) and `keyMessage:`
(the one thing the viewer knows after it).

## Transitions

Only `cut`. A push into a detail, or a move along the cord from one item to the next, is built inside the
frames, never as a transition.

## Script rules

- `SCRIPT.md` uses the exact `script-format.md` shape: one `## Line N — <label> (Frame N)` heading per
  frame, and the spoken words in a block indented four spaces beneath it. Frames 1 to 7 are spoken; the
  close is not.
- **Every word is said out loud**: no symbols (`= / & # @ < > → *`), no code tokens, no file names, no
  handles or URLs; write them as a person says them. Never put a single word or two in quotation marks.
- Word ranges per act (the table above). Never two new terms in one sentence.

## Music and sound

The storyboard frontmatter says `music: none`: the kit picks the bed after pacing. Write no `sfx:` lines:
the frame workers design each frame's sound events.

## Final checklist

- Frontmatter `term:` is BRIEF.md's term; `concept:` equals it; `music: none`.
- `## Case file` has when/where, the key artifact, the key detail, the players (at most 4), the
  artifacts (at most 3, from `## Artifacts`), the numbers (each with its fact), and the mechanism.
- `## Cold open` has three candidates rated on clarity and thumb-stop, and a pick at 4+ clarity.
- `## Question` has the question, the answer and `closed_by`.
- Eight frames in order, each with `type`, `ground`, `scene`, and (frames 1–7) `hold`, `voiceover`,
  `beat`, `claims`, `artifacts`, `shots:`.
- Every fact about the event in a voiceover or on screen is in a fact its frame's `claims:` names, said
  no stronger; no attribution phrasing; no private person named; artifacts word for word.
- Frame 2 has `stamp:`; frame 4 ends on its `question:`, word for word; frame 5 names the term once,
  exactly, and has `term_card:`; frame 7 is one line for the viewer.
- Frame 8 is the skeleton's close, unchanged, with no voiceover and no line in `SCRIPT.md`.
- Word ranges kept; no `!`, no emoji; every `transition_in` is `cut`; no `sfx:` lines; the lint shows no
  errors.
