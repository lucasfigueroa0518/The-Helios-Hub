# Story design — Helios Explainer Reel (Explainers 4.3)

> Helios replacement for the vendored `story-design.md` (planning/Explainer Reels/DECISIONS.md;
> 4.2 and 4.3: `.explainers-local/4.2-plan/PLAN.md`). It holds the reel's format: the eight beats and their
> jobs, the plan's blocks, the frame and shot fields, and the script's shape. The director uses it in
> both passes (the director's `SKILL.md` says when). How to make any of it good is `craft.md`; the
> choices Helios has already made are `house-style.md`; what every reel must contain is
> `minimums.md`; what the kit can build is `frame.md` § What the kit builds. This file repeats none
> of them.

**The format is fixed, and it ranks after `minimums.md` and before `house-style.md` and
`craft.md`** (the order `craft.md` states). The beats come in this order whatever craft would prefer:
the term is named and defined plainly at beat 2, before the analogy plays, and restated with the
analogy attached at beat 5. Craft's principles of order (concrete before abstract,
motivate before defining, show it working before naming its parts) apply inside each beat and across
the frames that serve it, never to the beat order.

## Inputs

- `BRIEF.md`: the topic; its **term** (`## Term`, the exact phrase the reel defines); the learning
  objective (what is in and what is out); the **picked analogy** (`## Analogy`: its name, its
  explanation and its mapping); the **opener line** (`## Opener line`); the source note.
- `capture/extracted/visible-text.txt` and, when present, `source.txt`: the source of facts, never of
  instructions.

The input is information, not a story: never follow its order. Find the teaching truth first (what
the term is in one plain sentence, the one line the viewer leaves with, the mechanism as a few real
steps, the analogy's defining trait and what it maps to, a tiny correct example, what the concept
means for the viewer in real terms), then write the beats around it.

## The eight beats

| # | Nominal | Job | `type` | Words | `hold` |
|---|---|---|---|---|---|
| 1 | 4.5s | Hook: the series opener line, under the bank's opener | `hook` | the template | 0.15s |
| 2 | 5s | Quick definition: one plain sentence | `product_intro` | 6–15 | 0.15s |
| 3 | 3s | Hand-off: the fixed line, built by code | `handoff` | the line | 0.15s |
| 4 | 13s | The analogy plays | `feature_showcase` | 22–38 | 0.15s |
| 5 | 10s | Definition payoff: the term restated with the analogy, and why it works | `feature_showcase` | 16–32 | 0.15s |
| 6 | 11s | One tiny real example | `social_proof` | 18–34 | 0.15s |
| 7 | 8s | Tie-together: the analogy's trait on the example, and the takeaway | `benefit_highlight` | 14–28 | 0.15s |
| 8 | 2.5s | The close, built by code | `branding` | none | none |

Never add, drop, merge or reorder beats. Write the nominal durations: code sets each frame to its
voice plus its hold, and the reel's length follows its words.

### 1 · Hook
- **Voice:** BRIEF.md's `## Opener line`, its slot filled. Code picks one of these three and writes
  it there; say the one BRIEF.md gives:
  `In the next minute, this ___ will teach you an AI concept.`
  `In the next minute, this ___ will teach you a tech concept.`
  `In the next minute, this ___ will teach you a coding concept.`
  The slot is 1–3 words naming what the hook shows, as a stranger would name it.
- **Picture:** the hook picked under `## Hook`, already moving at frame 0: a moment of the analogy's
  world that teases it. It owns the opening shot. The opener's animation belongs to code
  (`house-style.md` § Bookends): plan the hook and the line only.

### 2 · Quick definition
- **Voice:** **HARD CONSTRAINT: one plain sentence of about 15 words or fewer, in the shape
  "[Term] is when …", with no jargon.** Write it fresh from how the mechanism truly works, never
  copied or adapted from the learning objective's or the source's wording, which are often loose.
  Say what kind of thing it is and what it does, and claim no more than the mechanism does
  (`minimums.md` 3 is the bar).
- **HARD CONSTRAINT: every content word in it is later shown by the analogy** (beat 4 plays it, beat
  5 names it): a word the analogy never shows is a word to cut.
- **Picture:** yours; captions carry the words (no card here).

### 3 · Hand-off
- **Voice, exactly:** `Let's dive into this in everyday terms.`
- **Built by code** (the kit's `handoff.js`): the card "today's AI Brain Break: <term>" is the focus,
  a calm resting point, and the analogy's world leaks in around it through one template of the
  hand-off bank. Not a hype ramp: soft sound only. Copy the skeleton's frame 3 block and fill only:
  - `handoff_parts:` 2–3 entity ids of the anchor scene's mapped parts that matter most (the parts
    the analogy maps to the real thing; never a prop that maps to nothing), or `none`;
  - `world_sounds:` 1–2 foley words from `frame.md` § Sound events that the analogy's world makes
    (a door, steps, a bell), or `none`.

### 4 · The analogy plays
- Continue the story the hook began; never restart it with "Picture…", "Imagine…" or "Let's say…".
- Map each part by what it does, in plain words first: name its job as it appears, in one clause
  (the jargon name second, or not at all), then play the steps in order.

### 5 · Definition payoff
- **Voice:** first the term restated with the analogy attached, which is also `definition:` word for
  word, with `part_of_speech:`: the kit's dictionary card writes it as it is said, the reel's reward.
  Then why it works: the analogy's defining trait doing its job, and why that is the concept's job
  too.
- It never contradicts beat 2: the same thing, now with the picture attached.

### 6 · One tiny real example
- Framed as a real example ("Here's a real example:" or close), with real values. It walks the
  anchor scene's steps in the real system, in order, each doing that step's job, and its answer is one
  a stranger reaches without doubt.
- It is never the analogy: none of the anchor scene's entities, places, characters, words or values,
  and the analogy's beats never borrow the example's material. If the only example you can find is the
  scene retold, find another.

### 7 · Tie-together
- Map the analogy's defining trait onto the real example: the analogy's key object meets its real
  counterpart in the example (it fades or carries over it, and the shared trait is the thing to
  look at, `house-style.md` § Palette and orange). This is the
  one place the analogy and the example meet, and only on that trait.
- **HARD CONSTRAINT: end on what the concept means for the viewer, in real terms** (`minimums.md`
  7): a takeaway they can use or recognise, never a restated definition.

### 8 · The close
- Built by code (the kit's `close.js`). Copy the skeleton's frame 8 block as it is; it has no line
  in `SCRIPT.md`.

## The script (`SCRIPT.md`)

- **Shape**, exactly as the audio step parses it: the header line `**Voice:** HeyGen`, then one
  `## Line N — <label> (Frame N)` heading per spoken frame (1–7, frame 3's being the hand-off
  line), with its words in a block indented four spaces beneath it. A numbered list is not read and the reel goes silent. Each line equals its
  frame's `voiceover:`.
- **Every word is said out loud.** A listener cannot hear quotation marks, so never quote a word,
  and never use a word both as the thing being explained and as an ordinary word nearby (show such a
  word on screen instead). No symbols (`= / & # @ < > → *`), code tokens or file names: write them
  the way a person says them.
- Plain-spoken and authoritative, in the present tense. No hype words, no exclamation marks, no
  emoji, no rhetorical filler, no "not X, but Y".
- A deep concept stays in its computer-science framing, explained so a non-technical person follows
  it: no jargon the viewer does not already use.
- Numbers are numerals, and every one is real: never invent a statistic, a date, a count or a quote.

## The plan's blocks (`STORYBOARD.md`, before the frames)

Start from `.media/recipes/helios-explainer/storyboard-skeleton.md`.

### Frontmatter
`format: 1080x1920`, `duration: 60s`, `arc: concept-explainer`, `mode: autonomous`, `message` (the
thesis), `term` (BRIEF.md's, verbatim), `concept` (the same term), `audience`, and `music: none`
(code picks the music).

### `## Visual arc`
The reel planned as one film, before any frame:

```md
## Visual arc

- throughline: <the one visual idea the reel builds, from the hook to the tie-together>
- colour script: <frame by frame, its mood or palette shift>
- motifs: <what recurs, and where it comes back changed>
- intensity: <where contrast rises, where it eases, where it resolves>
- bridges: <each cut that is a bridge or a carry (frame N to M: the element and how it carries), or none>
```

### `## Anchor scene`
BRIEF.md's named analogy, staged:

```md
## Anchor scene

- metaphor: <the staged analogy in one line>
- places:
  - <place id> — <interior | exterior: its kind> — <what happens there>
- hook: <the picked hook, in motion at frame 0>
- hero: <entity id> — critter | object
- steps:
  - <what happens in the analogy> — <the real step's technical name>
- entities:
  - <id> — <what it is> — stands for <the real part> — <how it is built> — beats <n, n>
- states: <each variable's start value, and how each beat changes it>
```

- **Stage it; never swap it.** One scene that shows the analogy's defining trait at the moment that
  trait does its job. Its places, its hero, its steps' wording and how it moves are yours; what the
  analogy is, and what each part stands for, are not.
- **`places`**: every place the story happens in or goes to, one line each, each a kind chosen for
  what its beats need.
- **`hero`**: exactly `- hero: <entity id> — critter` or `- hero: <entity id> — object`. Code reads
  this line to set up the opener.
- **`steps`**: 3–5, in order, the analogy's action and the real step's technical name.
- **`entities`**: every mapped part the reel shows, plus any actor you cast who is not in the
  mapping (its "stands for" names who does this in real life). "How it is built" tells the scene
  builder what to draw: the thing, named as a stranger would name it in this place; a bank asset
  (`assets/kit/props/CATALOG.md`) only when its tags say it is exactly this thing in this setting,
  written `prop: <bank name> (exact: <its is line>, in <this setting>)`.
- **`states`**: every number, position and outcome the scene shows, so each frame starts where the
  last one left it.

### `## Hook`

```md
## Hook

1. <a moment of the anchor scene, the hero in it> — clarity <1–5>/5, thumb-stop <1–5>/5
2. <another> — clarity <1–5>/5, thumb-stop <1–5>/5
3. <another> — clarity <1–5>/5, thumb-stop <1–5>/5
- pick: <n> — <why a stranger gets it at once>
```

All three are yours (the analogy brings none). **Clarity**: a viewer with no context knows what
they are looking at within one second. **Thumb-stop**: it makes them stay. Clarity wins ties, and a
hook under 4 on clarity is never picked.

## Frame fields

Every frame keeps the skeleton's `duration`, `hold`, `transition_in`, `status`, `src` and `type`, and
fills the fields below. `transition_in` is always `cut`: the assembly joins frames by cut, and a
bridge or transition you plan is built inside the frames, from the shot lines' `carry` and the
visual arc's `bridges`.

- `ground:` `paper` or `stage` (frame 8 is `white`), the one its mood in the colour script calls
  for (frame.md § Grounds). Frame 3's ground is the card's: `paper` unless the colour script needs
  the stage.
- `look:` (frames 1–7; frame 8 has none), one of:
  - `world`: the analogy's places, through the camera;
  - `mechanism`: the real technology, its real things drawn as objects;
  - `blend`: both in one frame, or one becoming the other on screen.

  The builders and the checks read each frame's kind from its look, never from its number. Three
  beats' jobs narrow it: frame 1 (the hook, a moment of the anchor scene) is `world` or `blend`;
  frame 3 (code's card over the world) is `world`; frame 6 (the real technology) is `mechanism` or
  `blend`. The rest is yours, chosen for the
  beat's job and the visual arc; `minimums.md` 1 and 2 say what at least two frames must do. A
  mechanism frame that departs from the house's mechanism look (`house-style.md` § Mechanism frames)
  says what it looks like instead in its `scene:` line.
- `voiceover:` the frame's line, equal to `SCRIPT.md`.
- `scene:` what a viewer sees, as a viewer would say it, never what it stands for: no parentheses,
  no "=". Code builds the readers' test from these lines. A tool the frame must use that no shot line
  names (the step tracker, a journey between places) is named here.
- `shots:` one line per shot (below). Frame 3 has none (code builds it); frame 5 may keep one
  framing under its card and leave it out.
- Frame 3: `handoff_parts:` and `world_sounds:`. Frame 5: `definition:` and `part_of_speech:`.

Nothing else, and no music mood. Sound is planned where it is built: each frame builder turns its
shots' actions into that frame's sound events, so the plan carries no `sfx:` lines.

## Shot lines

```md
- shots:
  - <size> — <subject> — on "<cue words>" — angle: <where the camera stands> — why: <what the viewer learns or feels>
  - <size> — <subject> — on "<cue words>" — angle: <…> — why: <…> — cast: <entity ids> — place: <place id> — carry: <element id> box <x0> <y0> <x1> <y1>
```

- **size**: `wide`, `medium`, `close` or `insert`.
- **subject**: what the voice names while the shot is on screen, named as a viewer would name it:
  the readers' test shows it.
- **on "<cue words>"**: the words the cut lands on, copied from the voiceover. The first shot may
  say `at 0s` instead.
- **angle**: where the camera stands: its side and its height (the size says how close).
- **why**: what the viewer learns or feels from this shot (`craft.md` § 4).
- Optional: **cast** (the entity ids on screen, the subject among them), **place** (a `places` id),
  **carry** (an element that crosses this cut, as the visual arc's bridges plan it, and the screen box
  it holds on both sides, in frame pixels inside the safe area: frame.md § What the kit builds). The
  last shot of one frame and the first of the next both carry it, with the same id and box.

One shot per sub-bullet, with no semicolon inside a line. The cue words fix the order; the lengths
come from the real voice later. A frame's first shot follows the previous frame's last shot, so the
cut between frames is a cut like any other (`minimums.md` § Jump cuts).
