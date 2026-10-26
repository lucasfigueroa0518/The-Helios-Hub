# Frame worker — the shared contract (Helios Explainer Reel, Explainers 4.1)

> Helios replacement for the vendored `frame-worker-core.md` (DECISIONS.md EX3-05, EX3-52, EX3-60,
> EX3-63, EX3-75, EX3-77 to EX3-84, EX4-145 to EX4-157). The packet builder puts this file and the
> workflow delta below it into `_role.md`. Every rule here is mandatory;
> `.media/recipes/helios-explainer/principles.md` wins over all of them.

You build **one frame** of a Helios Explainer Reel: the scene code for one beat, and its sound
design. Other workers build the other frames at the same time; you never touch their files. You are
one of two kinds of frame worker, and the delta's reading list says which part of the kit is yours:

- a **scene frame worker** (`frame-worker-scene`): frames 1 (the hook), 4, 5, and 7 when its
  storyboard says `anchor: scene`: the analogy's world, through the camera, acted by critters;
- a **tech frame worker** (`frame-worker-tech`): frames 2, 3, 6, and 7 when its storyboard says
  `anchor: own`: the real technology, designed by technique, in glass and gloss.

## What you read

1. `_role.md` (this file and the delta) and your **frame packet**: your storyboard block (`scene`,
   `voiceover`, `duration`, `ground`, `anchor`, `shots` with each shot's `cast:` and `angle:`,
   `technique:` on tech frames, frame 3's `definition:` and `term_part:`, frame 6's
   `example_steps`, and Step 4's `focal`, `eye`, `space`, `camera`, `light`, `sounds` and
   time-coded Scene lines). Where a visual field is missing, work it out from the story's fields,
   principles.md and frame.md.
2. `principles.md` in full, then the parts of `frame.md` the delta's reading list names for your
   kind.
3. `assets/timing/<frame id>.json`: `duration`, `voice_end`, `hold`, every word's `start` and `end`
   in frame seconds. Time every cue from it.
4. Your kind's part of the kit (the delta lists it): each file's header comment and the doc comment
   of each function you call, nothing more.

The `voiceover` is the timing reference and the script of what the picture must show: reveal each
piece on the word that names it, and show every action and result the voice describes (EX4-151).
Never render narration as text; the captions carry the spoken words.

## What you write

1. `assets/frames/<frame id>.js`, the scene module (frame.md § Writing a frame), where the frame id
   is the basename of your storyboard `src` (`compositions/frames/04-analogy.html` → `04-analogy`);
2. `assets/frames/<frame id>.events.json`, its sound events (below);
3. only for objects of your own on the isometric camera or in a glass frame,
   `assets/frames/<frame id>.props.js` (`NEW_PROPS` with full tags, EX3-114).

**Frame 1 is the exception** (EX3-102): one file, `assets/frames/01-hook.js`, to frame.md § 1's
contract; `01-opener.js` and its sound are code's.

The module imports only from `../kit/*.js`, `../world/world.js` and `../world/identity.js`;
`export default { ground, shots, draw(t) }` with `shots` also a named export; `draw(t)` is a pure
function of `t` (no randomness without a seed, no clocks, no state between calls, no DOM) returning
one SVG string, and calls `scope('f<NN>-', ground)` first (NN = your frame number, two digits). Copy
the word times you need into constants (`const NAMED_AT = 3.8; // "<the word>"`): the module never
reads files. Never write `compositions/frames/*.html`, never edit `STORYBOARD.md`, `world.js`,
`identity.js` or another frame's files, never ask questions.

## Sound events

A JSON array, one entry per moment of motion, in frame seconds, on the landing frame (not the start
of the fall):

```json
[
  { "t": 0.0, "kind": "foley", "what": "pencil writing", "dur": 1.6 },
  { "t": 1.1, "kind": "foley", "what": "footstep" },
  { "t": 2.3, "kind": "pop" },
  { "t": 3.8, "kind": "impact" }
]
```

`kind` is `foley`, `impact`, `whoosh`, `pop`, `tick`, `click` or `sting` (frame.md § Sound); a
`foley` needs `what` in frame.md's foley words; a continuous action (writing, rubbing, rustling) is
one `foley` with `dur` for exactly as long as it moves. Every visible moment of motion has its event,
at least 4 on frames 1, 2, 4, 5, 6 and 7; never a sound for nothing on screen; never the opener's
sound or the 1→2 hit (code places them); `t` runs from 0 to your frame's `duration`.

## Constraints

- **Duration** is the voice plus a 0.15s hold. The voice is tight, so the picture keeps pace: each
  arrival on its word, the payoff on its word, the frame landed by `voice_end`.
- **Tokens** from the kit only, each hue in its job; one orange focal per beat; the hero only in
  frames 1, 4, 5 and a frame-7 callback (EX3-132), drawn in its `CAST` look.
- **Keep-outs:** nothing readable in y 0–570, y 1600–1920 or x 940–1080; the world may run
  full-bleed behind them.
- **Text** is an anchored label (5 words or fewer, as the voice names it), a figure, the cards, the
  tracker, the set's signs, or what the real thing itself shows; text in a shape goes through
  `textBox()` or a primitive that measures it. `bounds.mjs` checks every piece.
- **Scale:** every entity at its real size next to the 72 cm critter; a tiny thing through a
  magnifier or an insert, never drawn bigger.
- **Implement the Scene lines faithfully**: each window a phase of `t`, each piece on its cue with
  its named curve.

## How to work

1. **Read** (above).
2. **Design.** Scene frames: per shot, its camera (where it stands and why this angle teaches
   something new), its cast (at most 3 critters), its subject, what each critter intends and when,
   its one move if any, what it sounds like. Tech frames: name the mechanism in one sentence, pick
   the technique, and write the module's first line, `// technique: <id> — <reason>`.
3. **Write** the module and the events file.
4. **Look at your own work** (EX4-155): `node assets/kit/snap.mjs <frame-id> <t1,t2,…>` (up to 6
   times, seconds into the frame: just after every shot change and at the frame's end); Read every
   file it lists in `.hyperframes/snaps/`; ask principles.md § 7's seven questions of each still as
   a stranger on a phone; fix what fails and snap again. **At most 2 revision rounds**: the command
   runs at most 3 times per frame, and it is the only command you run.
5. **Self-check** against frame.md § The build checks for your kind; the orchestrator then runs
   `try.mjs` and `bounds.mjs` and sends you their exact errors.
6. **Report**: your last message names the files you wrote and lists, plainly, anything you could
   not fix.
