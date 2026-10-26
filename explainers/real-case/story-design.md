# Story design — Helios Real Case Reel (real-case-v1)

> The Real Case story design (planning/Real Case Reels/DECISIONS.md, RC-01 to RC-19). A job installs
> it as `.claude/skills/faceless-explainer/references/story-design.md`. Use it in Step 3 to write
> `STORYBOARD.md` and `SCRIPT.md`. Every rule here is mandatory.

A Real Case Reel teaches one AI, software, or computer-science concept (the story's **term**) in about
a minute, through one true event. It opens on the event, makes the viewer need to know why it happened,
names the concept, walks the concept's steps using the event's own items, shows the step that explains
the outcome, then the fix or the limit, and ends on the puzzle's answer and one rule the viewer keeps.
The goal is understanding on the first watch, carried by a story the viewer wants to hear to the end.

**One world.** The event is the world the whole reel lives in. The concept is never shown in a
separate, made-up scene: its steps play out on the event's own things.

## Read first

1. `BRIEF.md`: the **term** (`## Term`), the story's **facts** (`## Facts`: numbered `c1`, `c2`… each a
   fact you may state), the beat material (`## Story`), the **key item** the story turns on, and its
   polarity (failure, success or mystery).
2. `frame.md`: the visual system. Story and picture are planned together.

## The facts (HARD CONSTRAINT)

The voiceover tells a true event, so every fact about it is one of BRIEF.md's facts.

- **Every fact about the event comes from `## Facts`**: who, what, when, numbers, quotes, causes,
  outcomes, the fix. Say it as plainly as the fact states it, never stronger: no added number, date,
  cause, motive, superlative, or consequence. List the ids each frame uses in its `claims:` field.
- **Tell it straight.** No attribution phrasing: never "according to", "X says", "reportedly",
  "reporters found". A fact is stated as a fact, because it is one. A detail the facts do not state is
  left out, never hedged in.
- **General explanation is yours**: how the concept works may come from general knowledge, and must be
  accurate. Never present it as something the event's organization said or did.
- **Numbers** are numerals, exactly as the fact gives them (an amount, a year, a duration, written as
  the fact writes it). Never invent statistics, dates, counts, or quotes.
- **No person's name** in a voiceover, label or scene: people are named by their role in the event (a customer,
  an employee). Organizations, products, courts and public bodies may be named.
- **No logos** (frame.md V-17): an organization's name appears on screen only as a plain label in the
  reel's lettering, as the voice says it; never a logo, a brand mark, brand colors, or a copy of a
  product's screen.
- **Never research the event.** Web search may help you check how the concept works; it never adds a
  fact about the event.

## Storytelling first (RC-05)

Plain-spoken and authoritative, in short sentences with full stops, one idea each. The event is told
like a story worth hearing: a concrete moment, rising stakes, the strange outcome, the reveal. Past tense
for the event, present tense for how the concept works. No hype words, no exclamation marks, no emoji,
no rhetorical filler, no "not X, but Y", no toss to the next beat.

## The eight beats (fixed order, fixed `type`)

| # | Nominal | Beat | `type` | Default `engagement` | Words | `hold` | Anchor |
|---|---|---|---|---|---|---|---|
| 1 | 5s | The incident: the event in one line, under the opener | `hook` | Open loop + visual hook + audio ramp | 10–16 | 0.15s | scene |
| 2 | 9s | The puzzle: the strange detail, then the question | `pain_point` | Attention reset + curiosity gap | 18–30 | 0.15s | scene |
| 3 | 5s | Name it: the dictionary card | `product_intro` | Grounding definition | 8–16 | 0.15s | own (the card) |
| 4 | 13s | Walk it: the concept's steps, on the event's own items | `feature_showcase` | Worked example + progress tracker | 32–44 | 0.15s | scene |
| 5 | 8s | The click: the step that explains the outcome | `feature_showcase` | State change + payoff | 18–28 | 0.15s | scene |
| 6 | 8s | The other side: the fix, or the limit | `social_proof` | Cached understanding + boundary | 18–28 | 0.15s | scene |
| 7 | 6s | The takeaway: the puzzle answered, one rule to keep | `benefit_highlight` | Payoff + distillation | 12–22 | 0.15s | own |
| 8 | 2.5s | The close (code's): the logo and "AI BRAIN BREAK", no voice | `branding` | Brand close | none | none | — |

Do not add, drop, merge, or reorder beats. Each frame's `duration` is its voice plus its `hold` (code sets
both from the real voice; write the nominal values); the close is a fixed 2.5s. About 165–180 spoken
words in all. Never cut a fact's meaning to save words, and never pad.

### 1 · The incident (the hook)

- **Voiceover:** the event in one line of 10–16 words, from BRIEF.md's incident: who, when, and the
  outcome that makes a stranger look twice. It is the first thing the viewer hears, so it carries the
  surprise, not the background.
- **Picture: the hook** (`## Hook`): the event's key moment in motion at frame 0, in the story world,
  clear on its own within one second. The key item is in it.
- **The opener is the bank's** (code): an animated intro over your hook shows "AI BRAIN BREAK", then the
  title card writes "today's brain break:" and the term. Captions are quiet in this frame; the title
  card is the text. Plan the hook and the line; never the opener's text, sound or timing.

### The 1→2 break

Beat 2 opens on a sound hit and a **visual attention reset**, declared in its `reset:`: a camera
punch-in, a color change (the ground flips paper → night or forest), an in-frame zoom-through, or a
visual effect on the cut. It stays in the story world.

### 2 · The puzzle

The rest of what happened, the one detail that makes it strange, and the question the concept answers.
The line ends on that question, said as the viewer would ask it. It is a real
question, about the real technology, that the reel answers in beat 5 and states plainly in beat 7.
Write it in `gap_question:`, and in `## Puzzle`. Never name the term here: beat 3 does.

### 3 · Name it: the dictionary card

The term as a dictionary entry: the headword (the term, exactly), its part of speech (`part_of_speech:`),
and the definition (`definition:`), filling in as it is spoken and staying. A visual of what it says sits
below. **The voiceover is the definition, word for word**, one sentence of 16 words or fewer that starts
"A <term> is…", "An <term> is…" or "<Term> is…": what it is (its category) and what it does, in words the
viewer already uses. The detail comes later, on the event's own things.

- Good: it names the category and the job, in words a stranger already uses.
- Bad: a vague phrase ("a thing that", "some data", "when something happens") or a second technical term.

### 4 · Walk it: the steps, on the event's own items

The concept's steps (the anchor scene's `steps`, 3 or 4), in order, each **named as it plays** and shown
with the event's own thing: "Step one, <step>: <what it was in this event>." The step tracker shows the
step names and lights each on its cue. Open on the one wide establishing shot of the story world, then
closer shots, one step at a time. Build toward the outcome without stating why yet. At most two new
technical words beyond the term, each said in plain words the first time.

### 5 · The click

The step that explains the outcome, said and shown: the moment in the walk where the event's outcome was
produced, and why that step produced it. Replay that step on the key item, in close or insert shots, and
let the cause visibly lead to the outcome. This is the answer to the puzzle; make it land on one clear
sentence.

### 6 · The other side

For a **failure**, the fix: what changed, at which step, as the facts state it. For a **success**, the
limit or the trade-off of the step that made it work. For a **mystery**, what is known and what is still
open. Show it on the same story world, at the step it touches. This is the second look at the
mechanism: the viewer sees the same step from the other side.

### 7 · The takeaway

First the puzzle's answer in one plain sentence, in real terms; then one rule a business viewer can use
in their own work. It may call back to the key item in one shot. `closed_by` points here.

### 8 · The close

Built by code: a white screen, the Helios logo animating in, and "AI BRAIN BREAK" writing itself beneath
it, 2.5s, no voiceover. Copy the skeleton's frame 8 block as it is; write no line for it in `SCRIPT.md`.

## `## Anchor scene`: the story world (write it before the frames)

The story world is the event's setting and its things, drawn once and reused by frames 1, 2, 4, 5 and 6
(frame 7 may call back to it in one shot).

```md
## Anchor scene

- metaphor: <the event's world in one line: where it happened and what is in it>
- setting: table | scene
- ground: paper | night | forest
- hook: <the event's key moment, in motion at frame 0>
- hero: <the key item's entity id> — object
- steps:
  - <the step's name, 4 words or fewer> — <what it was in this event>
  - … (3 or 4 steps, in order; the step tracker prints the names)
- entities:
  - <id> — <what it is in the event> — <critter (role, wear), look: ink|paper, wear <…> | new drawing: <the specific thing, as a stranger names it> — how it is built | prop: <bank name> (exact: <its is line>, in <this setting>)> — beats <n, n>
- states: <variable>: <start> → <how each beat changes it>; …
- layout: <where things sit, one line>
```

- **The hero is the key item**, always an object: the thing the outcome turns on. It carries the orange
  in every frame it appears in. **No critter is orange.**
- **At most 4 entities** (a group of identical things counts as one), each one of the event's real
  things, each readable at phone size without a label. Never a logo or a product's real screen: a
  generic, drawn thing, named as a stranger names it.
- **Objects can act; critters are the only characters.** When someone in the event acts, that someone is a
  critter named by role, in ink or paper; never a person, a figure, or a
  body part.
- **Every object is drawn to fit**: a `new drawing:` named as specifically as a stranger names it is the
  default; a bank asset (`assets/kit/props/CATALOG.md`) only on an exact fit, with an `exact:` reason.
- Every number or outcome the scene shows is a state, and comes from the facts.

## `## Hook` (write it before the frames)

```md
## Hook

1. <the anchor scene's hook> — clarity 4/5, thumb-stop 4/5
2. <another moment of the event> — clarity 5/5, thumb-stop 3/5
3. <another> — clarity 3/5, thumb-stop 4/5
- pick: 1 — <one line on why a stranger gets it at once>
```

**Clarity** (standalone): a viewer with no context knows what they are looking at within one second.
**Thumb-stop:** it makes them stay. Clarity wins ties; a hook below 4 on clarity is never picked.

## `## Puzzle` (write it before the frames)

```md
## Puzzle

- question: <the question beat 2 ends on, word for word>
- answer: <the click, in one sentence>
- closed_by: <the frame and moment that answers it, e.g. "frame 7: the answer line">
```

## Frame fields

Every frame block keeps the recipe skeleton's `duration`, `hold`, `transition_in`, `src`, `type`, and
`engagement`, and fills:

- `scene`: a one-line picture idea (what is drawn and what moves), not composition detail;
- `voiceover`: the spoken line;
- `claims`: the fact ids the voiceover and the frame's labels use (`c1, c3`), or `none`; frames 1, 2, 4,
  5, 6 and 7;
- `beat`: the target feeling (curiosity, intrigue, recognition, clarity, satisfaction);
- `engagement`: a named technique (catalog below), never "explain the idea";
- `ground`: paper, night, or forest (frame 8: white);
- `hold`: the skeleton's value (0.15s); never longer; the close has none;
- `shots:` (frames 1, 2, 4, 5, 6, 7): the frame's shots in order, one per sub-bullet,
  `<kind> — <subject> — on "<cue word>"` (frame.md § Shots). **The subject is what the voice is naming
  while the shot is on screen.** Kinds: wide, medium, close, insert, reaction. Frames over 6s cut between
  at least two; no two consecutive shots, and no frame's first shot and the previous frame's last, are
  the same picture; the one `wide` establishing shot opens frame 4;
- frame 2: `reset:` and `gap_question:` (the puzzle's question, word for word); frame 3: `definition:`
  and `part_of_speech:`.

Under the bullets, two prose lines: `narrativeRole:` (the frame's job in the viewer's understanding) and
`keyMessage:` (the one thing the viewer understands after it).

## Engagement catalog

| Family | Techniques |
|---|---|
| **Open and hold** | Open loop · Visual hook · Audio ramp · Attention reset · Curiosity gap · Anticipation |
| **Ground** | Grounding definition · Scene setting · Recognition · Concretization |
| **Build understanding** | Worked example · Progress tracker · Cached understanding · State change · Progressive disclosure · Boundary |
| **Land** | Payoff · Callback · Distillation |

## Transitions

Only `cut`. A push through an object into the next framing is built inside the frames, never as a
transition.

## Script rules

- `SCRIPT.md` uses the exact `script-format.md` shape: one `## Line N — <label> (Frame N)` heading per
  frame, and the spoken words in a block indented four spaces beneath it. Frames 1 to 7 are spoken; the
  close is not.
- **Every word is said out loud**: no quoted words, no symbols (`= / & # @ < > → *`), no code tokens, no
  file names; write them as a person says them.
- Word ranges per beat (the table above). Never two new terms in one sentence.

## Music and sound

The storyboard frontmatter says `music: none`: the kit picks the bed after pacing. Write no `sfx:` lines:
the frame workers design each frame's sound events.

## Final checklist

- Frontmatter `term:` is BRIEF.md's term; `concept:` equals it; `music: none`.
- `## Anchor scene` is the story world: a `hook`, 3 or 4 `steps` (name — what it was in this event), a
  `hero:` line naming the key item as an `object`, at most 4 entities, no orange critter, no person or
  body part, no logo.
- `## Hook` has three candidates rated on clarity and thumb-stop, and a pick at 4+ clarity.
- `## Puzzle` has the question, the answer and `closed_by`.
- Eight frames in order, each with `type`, `engagement`, `ground`, `scene`, and (frames 1–7) `hold`,
  `voiceover`, `beat`; frames 1, 2, 4, 5, 6 and 7 have `claims:` and `shots:`.
- Every fact about the event in a voiceover is in a fact its frame's `claims:` names, said no stronger;
  no attribution phrasing; no person's name.
- Frame 2 ends on its question (`gap_question:`, word for word) and has `reset:`; frame 3's voiceover is
  its `definition:`, 16 words or fewer, starting "A/An <term> is" or "<Term> is"; frame 4 opens on the
  wide shot and names each step as it plays; frame 5 says why the outcome happened; frame 7 answers the
  puzzle and gives one rule.
- Frame 8 is the skeleton's close, unchanged, with no voiceover and no line in `SCRIPT.md`.
- Word ranges kept; no `!`, no emoji; every `transition_in` is `cut`; no `sfx:` lines; the Real Case lint
  shows no errors.
