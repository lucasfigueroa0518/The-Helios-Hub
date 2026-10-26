# Motion language — Helios Explainer Reel (Explainers 4.1)

> Helios replacement for the vendored `motion-language.md` (DECISIONS.md EX3-05). The motion
> vocabulary for Step 4 shot lines and Step 5 scene code. `principles.md` and `frame.md` (§ Shots,
> § Motion, § Light) are the law; this is how to speak it. Every rule here is mandatory.

## Motion has a job

Every motion is one of four kinds. Name the kind in the Scene line when it is not obvious.

| Kind | What it does | Example |
|---|---|---|
| **Semantic** | the motion communicates the idea | a stamp prints the whole block at once |
| **Anticipatory** | it builds an outcome to await | a coin teeters at the edge before it falls |
| **State-driven** | a rule visibly produces a consequence | each finished line drops a coin |
| **Camera** | it carries attention to what matters next | a slow push onto the object about to change |

Decorative motion is forbidden: idle floating, random particles, wiggles with no cause, light that
pulses for nothing, a slow pan to keep a dead frame alive. A critter's blinks, breath and glances
are its life, not decoration. Motion is smooth at the full frame rate: no boil, no drawing on twos.

## Polarity: the speed curve of every move

Name the curve for every major move (the kit's `E` in `assets/kit/motion.js`). The curve matches
the meaning.

| Polarity | Shape | Use it for |
|---|---|---|
| `slam` | fast in, hard stop | arrivals, landings, impacts, verdicts |
| `snap` | instant, tiny overshoot | state flips of world objects, switches, counters |
| `ramp-up` | slow start, accelerating | build-ups that end in an impact; the opener into the cut |
| `glide` | slow, fast, slow | repositioning, release after a peak |
| `spring` | overshoot and settle | world objects with weight, physical bounces |
| `reverse` | goes, then pulls back | false starts, refusals, rejections |
| `drift` | near-constant, slow | a tension hold only |

A world move with no stronger meaning eases in and out (`E.world`), and so does the lens moving
through the room. Titles, UI (the glass frames) and the camera's 2D framing (a shot's crop, its
push, a punch) take the brand ease-out (`E.ui`) and never overshoot or bounce. A speed ramp
(`makeWarp`) slows the one consequential instant when it serves the moment.

## The principles (every world move)

| Principle | How | Kit |
|---|---|---|
| **Anticipation** | a lift before the slam, a wind-up before the shove, a crouch before the jump | a small reverse move first |
| **Squash and stretch** | squash on impact, stretch at speed, the volume kept (sx·sy = 1); never on rigid things | `squash(u)`, a critter's `squash` |
| **Follow-through** | what hangs from a mover (a lanyard, a towel, a tie, a sign) swings on and settles after it stops; parts never all stop on one frame | `follow(t, stopAt)` |
| **Arcs** | thrown, falling and jumping things travel on arcs, never straight lines | `arcPath(p0, p1, lift, u)` |
| **Eased timing** | every move eases; linear only for handwriting and a `drift` | `E`, `seg` |
| **Smear** | one stretched frame along the path of a move faster than about 4 frames | `smear(from, to, u)` |

## Light moves too

Light is motion with a job, and every light has a source in the shot or stated (frame.md § Light):
a door's wedge sweeps the floor as it opens
(`lightWedge`), a screen or sign wakes (`glow`, `glowSign`), a glint crosses the glossy thing as it
lands or becomes the focal (`glint`, once), the room dims as tension builds and lifts as the answer
lands (`level`). The key light itself never moves. Name each light change in the Scene line with
what motivates it.

## Acting is motion too

A critter moves because it wants something (principles.md § 2, EX4-150): the eyes turn to the
target first, then the hands go; the body leans into effort and away from fear; a carried thing
pulls the body over it. Write the intent and its target, and the rig (`act`, `actAt`) solves the
arms, the lean and the gaze; never animate an arm by hand. A pose that does nothing is wrong.

## The camera

Calm and motivated (frame.md § Shots). In the analogy's frames each shot has its own camera,
standing in the place: closeness comes from where it stands, never from a crop on top. **Within a
shot, at most one motivated move**: a `push` as tension builds, a `pull` to reveal, a `pan` to
follow a turn, a `follow` travelling with a walker; otherwise the camera is still. The hook's camera
stays still. **Every cut changes what the viewer learns**: a new subject, or the same subject from
a clearly new angle (about 30° around it, or a clear change of height), judged by the picture;
never a cut to a closer copy of the same view. Depth of field only by intent (an insert, a reveal,
a rack focus from one read to the next); never blur what the voice names. Roll within 3°; at most
one sharp punch per beat, and the attention reset at the 1→2 cut is the one place a harder punch
belongs. The isometric camera (an overview, a diagram) has no parallax and no focus. Tech frames
are flat: a modest crop per shot at most, and the same cut rule.

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

## The failure modes

- **Slideshow:** everything dumped in the first quarter, then frozen; or the scene replaced by
  lists, grids, or cards.
- **Weightless:** things slide in straight lines at constant speed, stop dead, and never squash,
  overshoot or settle.
- **Screensaver:** everything floating independently with no cause.
- **Silent film:** objects land, pages turn and pens write with no sound.
