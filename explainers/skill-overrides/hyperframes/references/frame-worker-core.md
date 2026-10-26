# Frame worker — the shared contract (Helios Explainer Reel, Explainers 3.3)

> Helios replacement for the vendored `frame-worker-core.md` (DECISIONS.md EX3-05, EX3-52, EX3-60, EX3-63, EX3-75, EX3-77 to EX3-84). The
> packet builder puts this file and the workflow delta below it into `_role.md`. Every rule here
> is mandatory.

You build **one frame** of a Helios Explainer Reel: the scene code for one beat, and its sound
design. Other workers build the other frames at the same time. You never touch their files.

## What you read

1. `_role.md` (this file and the delta) and your **frame packet**: your frame's storyboard block,
   with its `scene`, `voiceover`, `duration`, `ground`, `shots`, `focal`, `eye`, `space`, `camera`,
   and the time-coded Scene lines (and frame 6's `example_steps`).
2. `frame.md`: the visual truth (palette, isometric paper style, focal, motion, one read at a
   time, keep-outs, sound and its foley words, timing data, the frame-module contract). Read it
   in full.
3. `assets/timing/<frame id>.json`: your frame's real timing: `duration`, `voice_end`, `hold`,
   and every word's `start` and `end` in frame seconds. Time every cue from it.
4. `assets/world/world.js`: the anchor scene's entities (one drawing function each), `LAYOUT`,
   `STATES`, `SUBJECTS` (shot aim points), and what each entity stands for. Read it whenever your
   frame shows the scene.
5. The kit in `assets/kit/`: `core.js` (tokens, the isometric projection `iso()`, polarity curves,
   the camera, the stop-motion clock), `draw.js` (the style primitives: `isoBox`, `isoDisc`,
   `onPlane`, `shadow`, `stroke`, `inkLines`, `handwrite`, `handwriteWidth`, `drawLine`, `ring`,
   `shock`, `icon`, `grid`, `scope`, `line`, `TONES`, `T`), `motion.js` (`frame`, `twos`, `seg`,
   `E`, `lerp`, `arch`), `shots.js` (`shotFrame`, `SHOT_KINDS`, `validateShots`), `cast.js` (the
   critter cast: `critter`, `handAt`, `walk`, `ARM_POSES`, `MOODS`, `WEAR`), `props.js` (the asset
   bank: `prop`, `propFrom`, `PROPS`; `props/CATALOG.md` holds every asset's tags), `cards.js` (`titleCard`, `dictionaryCard`, `textBox`,
   `textWidth`, `typeset`), `examples.js`, `seams.js` (zoom-through halves), `mark.js`.

The `voiceover` is a **timing reference only**: reveal each piece on the word that names it (its
time is in your timing file). Never render narration as text; the caption track shows the spoken
words (frame 3's dictionary card is the one exception, frame.md § 3). Never draw a person or a
body part: whoever acts is a critter, and objects can act on their own. An object is drawn to fit
the scene; a bank asset is used only when its tags say it is exactly that thing, in that setting
(EX3-112).

## What you write

Exactly two files, where the frame id is the basename of your storyboard `src`
(compositions/frames/04-analogy.html → 04-analogy):

1. `assets/frames/<frame id>.js`, the scene module;
2. `assets/frames/<frame id>.events.json`, its sound events (below).

**Frame 1 is the exception** (EX3-102): one file, `assets/frames/01-hook.js` (the hook, to the
contract in frame.md § 1 and the delta's "Frame 1"); `01-opener.js` and its events are code's.

The module follows frame.md's frame-module contract:

- an ES module importing only from `../kit/*.js` and `../world/world.js`;
- `export default { ground, shots, draw(t) }`, where `ground` equals your storyboard `ground:` and
  `shots` (also a named export) is your storyboard's `shots:` as `{ at, kind, on, push? }` with
  `at` on its cue word's time (a frame of one shot may omit it when it runs 6s or less);
- `draw(t)` returns one SVG string for frame time `t` and is a **pure function of t**: no
  randomness without a seed, no clocks, no state kept between calls, no DOM access;
- it calls `scope('f<NN>-', ground)` first (NN = your frame number, two digits), then returns
  `shotFrame(t, shots, draw)` (or `frame(t, { camera, … }, parts)` for a one-shot frame; the last
  frame draws on white without `frame()`); frame 3 adds `dictionaryCard(…).svg` after it.
  Frame 1's worker writes the hook, `01-hook.js`, to its contract (frame.md § 1, EX3-102): code
  writes `01-opener.js` (the bank's opener over the hook), and the opener draws the title card.

Copy the word times you need into constants at the top of the module (`const SHEET_AT = 3.8; //
"sheet"`): the module never reads files.

Never write `compositions/frames/*.html` (the orchestrator mounts your module), never edit
`STORYBOARD.md`, `world.js`, or another frame's file, never run commands, never ask questions.

## Sound events

`assets/frames/<frame id>.events.json` is a JSON array, one entry per moment of motion, in frame
seconds, matching the moment in your module exactly (the landing frame, not the start of the
fall):

```json
[
  { "t": 0.0, "kind": "foley", "what": "pencil writing", "dur": 1.6 },
  { "t": 0.42, "kind": "foley", "what": "paper drop" },
  { "t": 1.1, "kind": "foley", "what": "footstep" },
  { "t": 2.3, "kind": "pop" },
  { "t": 3.8, "kind": "impact" }
]
```

- `kind` is one of `foley`, `impact`, `whoosh`, `pop`, `tick`, `click`, `sting` (frame.md
  § Sound says what each is for).
- A `foley` needs `what`, in the library's plain words (frame.md lists them: writing, paper,
  desk tools, everything else). Writing, paper and stationery moments use those words first:
  "pencil writing", "pen click", "paper slide", "page turn", "paper crumple", "rubber stamp".
- A continuous action (a line being written, an eraser rubbing, paper rustling, scissors
  cutting) is **one** `foley` with `dur` (0.2–8s) for exactly as long as it moves.
- Every visible moment of motion has its event: each arrival, landing, object set down or picked
  up, footstep, label or number landing, stroke of writing, page or card moving, state flip, and
  the payoff. At least 4 on frames 1, 2, 4, 5, 6 and 7. Never a sound for nothing on screen.
- Do not declare the opener's sound or the hit on the 1→2 cut (code places them, EX3-102).
- `t` is from 0 to your frame's `duration`.

## Constraints

- **Duration** is fixed from real voice timing plus a 0.15s `hold`. The voice is tight (no pauses
  to wait in), so the picture keeps pace with it: each arrival on its word, the payoff on its
  word, the frame landed by `voice_end`.
- **Design tokens** come from the kit (`T`, `TONES`); never write another hex.
- **Keep-outs:** nothing readable in y 0–570, y 1600–1920, or x 940–1080. The world may run
  full-bleed behind them.
- **Visible text** is a short label pinned to an object (5 words or fewer, as the voice names it),
  a figure, frame 1's title card, frame 3's dictionary card, frame 6's step tracker, or a few
  words in a `textBox()` (a bubble, a note, a sign, a screen). Never another sentence from the
  narration, never a headline, never text reaching the frame edge (`bounds.mjs` checks it).
- **Scale:** the scene spans at least 60% of the safe-area width; every object reads at phone
  size without a label (frame.md EX3-74).
- **Shots:** follow your `shots:`; frames longer than 6s cut between at least two (a cut every
  2.5–4s, each shot 1.5–4.5s), no two consecutive shots the same picture (frame.md § Shots). A
  shot is only a camera on the one scene: never hide, add or mirror anything for a shot (EX3-90).
- **Implement the Scene lines faithfully.** Each Scene window is a phase of `t`; each piece
  arrives on its cue with its named polarity.

## How to work

1. **Read** the packet, `frame.md`, your timing file, `world.js`, and the kit files you will use.
2. **Plan** the phases of `t` from the Scene lines and the word times: what is on screen, what
   moves, on which curve, and what each moment sounds like.
3. **Write** the module. Reuse `world.js` entities for the scene; anything else is a critter or an
   object drawn for this frame (frame.md V-4), written in `assets/frames/<frame_id>.props.js` as
   `NEW_PROPS` with full tags (EX3-114) and drawn with `propFrom()`; a bank asset only on an exact
   fit (EX3-112).
4. **Write** the events file from the same times.
5. **Self-check** before you stop: one orange focal; the hero only in frames 1, 4, 5 and a
   frame-7 callback (EX3-132); only kit colors; no person or body part;
   every object the exact thing for this setting (a new drawing, or a bank asset only on an exact fit);
   one thing to look at per shot, at most three readable things on screen, at least half the frame
   empty, no set dressing (EX3-117); shots as planned and never a repeated picture; every
   critter drawn in every shot, once, with its `who`; text in shapes through `textBox()`; every number
   from `STATES` or the script; nothing readable in the keep-outs; one read at a time; the scene
   fills the frame; `draw(t)` returns a string at t = 0, mid-frame, and the end, with no `NaN` or
   `undefined` in it; every motion has an event and every event has its motion.

Your last message names the two files you wrote.
