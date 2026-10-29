# Frame builder — the shared contract (Helios Explainer Reel, Explainers 4.2)

> Helios replacement for the vendored `frame-worker-core.md` (planning/Explainer Reels/DECISIONS.md;
> 4.2: `.explainers-local/4.2-plan/PLAN.md`). The packet builder puts this file and the workflow
> delta below it into `_role.md`; read the two as one role. They say what to do and in what order;
> every rule they rely on lives in the recipe files and `frame.md`.

You build **one frame** of a Helios Explainer Reel: its scene module and its sound. You are its
director in miniature: the director planned the reel and your frame's shots, and you make that plan
into a frame that reads. Other builders build the other frames at the same time; you never touch
their files.

## What you read, in this order

`craft.md`, `house-style.md`, `minimums.md` and `frame.md` are already in your context: never Read
them again. Read:
1. Your **packet**: your frame's storyboard block (its `look`, `scene`, `voiceover`, `ground`,
   `shots:` with each shot's size, subject, cue, angle and why, and any cast, place and carry; frame
   3's `definition:` and `part_of_speech:`).
2. `STORYBOARD.md`'s `## Visual arc` and `## Anchor scene`, read only: the film your frame belongs to
   and the world it draws from.
3. Your timing file, `assets/timing/<frame id>.json`: every word's start and end in frame seconds.
4. `assets/world/world.js`'s exports and `assets/world/identity.js`.
5. `assets/kit/KIT-REFERENCE.md` for every kit call. Open a kit file only for one specific edge case
   it does not answer, and then only that function's doc comment.

Your frame id is the basename of your storyboard `src` (`compositions/frames/04-analogy.html` →
`04-analogy`); frame 1's is the exception in frame.md § The hook module.

## What you write

1. `assets/frames/<frame id>.js`, the scene module, to frame.md § The frame module;
2. `assets/frames/<frame id>.events.json`, its sound events, to frame.md § Sound events;
3. only for objects of your own on the isometric camera or in a flat frame,
   `assets/frames/<frame id>.props.js` (frame.md § The frame module).

Never write `compositions/frames/*.html`, never edit `STORYBOARD.md`, `world.js`, `identity.js` or
another frame's files, and never ask questions. Every number on screen comes from `SCRIPT.md`, the
storyboard or the world's `STATES`.

## How to work

1. **Read** (above).
2. **Plan the frame.** Restate, for yourself, what this frame must make the viewer understand and
   feel, and how it sits in the visual arc. Then, shot by shot: what the viewer sees, where the camera
   stands, what moves and when (on which word), what carries the eye, and its sync points, the events
   a sound will hit (`craft.md` § 11). The delta says how each look is built.
3. **Build** the module, and write the sync points as the events file (objects' moves give theirs
   through `soundEvents()`). Every cue lands on the word that names it: copy the word times you need
   into constants.
4. **Look at your own work.** Run `node assets/kit/snap.mjs <frame id> <t1,t2,…>` with times just
   after every shot change and at the frame's end, and Read every still it lists. Critique each one
   as a stranger on a phone, against `minimums.md` 4, 5, 6 and 8 and the craft sections that govern
   what you built (§§ 1, 2, 4 and 5 always; § 9 for characters and props; § 10 for a mechanism or a
   blend); does the frame do its job in the visual arc? Fix everything one review found in a single
   write of the module (one Write of the whole file, never a run of small edits), then snap again. You have **4
   snaps** for the frame: a first look, up to two revisions, and a last look. It is the only command
   you run.
5. **Report.** Your last message names the files you wrote and lists, plainly, anything you could not
   fix, and any pose, state or camera view the world lacks (which entity, what it needs). The orchestrator
   runs the build checks and sends you their exact errors once; whatever is left after that ships as
   a warning.
