# Motion language — Helios Explainer Reel (Explainers 3.3)

> Helios replacement for the vendored `motion-language.md` (DECISIONS.md EX3-05). The motion
> vocabulary for Step 4 shot lines and Step 5 scene code. `frame.md` (V-6 to V-9, V-15) is the
> law; this is how to speak it. Every rule here is mandatory.

## Motion has a job

Every motion is one of four kinds. Name the kind in the Scene line when it is not obvious.

| Kind | What it does | Example |
|---|---|---|
| **Semantic** | the motion communicates the idea | a stamp prints the whole block at once |
| **Anticipatory** | it builds an outcome to await | a coin teeters at the edge before it falls |
| **State-driven** | a rule visibly produces a consequence | each finished line drops a coin |
| **Camera** | it carries attention to what matters next | a slow push onto the object about to change |

Decorative motion is forbidden: idle floating, random particles, wiggles with no cause, a slow
pan to keep a dead frame alive. The boil (the line wobble at 10 fps), drawn things on twos, and a
critter's blinks and glances are the drawing's life, not decoration.

## Polarity: the speed curve of every move

Name the curve for every major move (the kit's `E` in `assets/kit/motion.js`). The curve matches
the meaning.

| Polarity | Shape | Use it for |
|---|---|---|
| `slam` | fast in, hard stop | arrivals, landings, impacts, verdicts |
| `snap` | instant, tiny overshoot | state flips, switches, counters |
| `ramp-up` | slow start, accelerating | build-ups that end in an impact; the opener into the cut |
| `glide` | slow, fast, slow | repositioning, release after a peak |
| `spring` | overshoot and settle | objects with weight, physical bounces |
| `reverse` | goes, then pulls back | false starts, refusals, rejections |
| `drift` | near-constant, slow | a tension hold only |

Anticipation comes before every big action (a lift before the slam, a wind-up before the
shove). Things with weight squash on impact and overshoot. A speed ramp (`makeWarp`) slows the
one consequential instant when it serves the moment.

## The camera

Calm and motivated: a drift or a slow push or pull in every frame; at most one sharp `punch` per
beat, on its key moment; ≤1.2× zoom per move; roll within 3°; no tilt. Framing changes come from
cuts between shots (`shots.js`: wide, medium, close, insert, reaction), inside a frame and
between frames, never from swinging the camera. A shot is only a camera: it never hides, adds or
mirrors anything in the scene (EX3-90). The attention reset
at the 1→2 cut is the one place a harder punch belongs.

## Reveals and holds

- Reveal each piece **on the word that names it** (`assets/timing/<frame id>.json`); never put
  the whole frame on screen at t=0.
- One read at a time: a read element steps back (dims, shrinks, or leaves) before the next leads.
- Labels arrive as the voice names them (frame 4: as each part's real job is named) and step back before the
  next words.
- The voice is tight (0.2s between lines at most), so the picture keeps pace: the payoff lands on
  its word and the frame is resolved by `voice_end`. Stillness beats bad motion.

## Handwriting moves like a hand

`handwrite()` (Hershey Sans print) reveals strokes in writing order at a steady pace
(`E.linear`), never all at once; the kit's `titleCard()` paces its own lines across the opener.
The card or paper it is written on arrives first; the writing starts a beat later. Each written line has its own continuous writing sound (a `foley`
event with `dur` for the line's writing time).

## Every motion sounds

Every visible moment of motion gets its sound event at the instant of contact (frame.md § Sound):
the landing frame of a `slam`, the flip of a `snap`, each footstep, each page, each stroke. A
continuous action (writing, erasing, rustling, cutting) is one `foley` event with `dur` for its
whole length. Sound is part of the motion design, not decoration: a move without its sound reads
as weightless.

## The two failure modes

- **Slideshow:** everything dumped in the first quarter, then frozen; or the scene replaced by
  lists, grids, or cards.
- **Screensaver:** everything floating independently with no cause.
- **Silent film:** objects land, pages turn and pens write with no sound.
