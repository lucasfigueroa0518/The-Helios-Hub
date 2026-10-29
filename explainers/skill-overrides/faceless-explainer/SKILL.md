---
name: faceless-explainer
description: "The Helios Explainer Reel workflow (Explainers 4.2): one reel of about a minute, 9:16, from a prepared HyperFrames project, in eight fixed beats around one named analogy. The director writes the voiceover and plans the picture as one film (each frame's look: world, mechanism or blend; every shot with its why); the scene builder builds the world; one frame builder per frame builds it by its look and reviews its own stills; code checks breakage; a picture check reads the reel as a stranger would; everything fails open. Run only through the helios-explainer-director skill."
---

# Helios Explainer Reel workflow (Explainers 4.2)

> Helios replacement for the vendored faceless-explainer `SKILL.md` (planning/Explainer
> Reels/DECISIONS.md; 4.2: `.explainers-local/4.2-plan/PLAN.md`). The worker has already done
> Step 0 (setup), Step 1 (the brief and the extracted source) and Step 2 (design system): the
> project, `BRIEF.md`, `capture/extracted/`, `frame.md`, the caption skin,
> the recipe (`craft.md`, `house-style.md`, `minimums.md`, the storyboard skeleton), the fonts, the
> logo, the world kit (`assets/kit/`), the opener sounds (`assets/sfx/`) and the sound library
> (`assets/sfx-library/`) are in place. The helios-explainer-director skill names the phase.

This file is the order of work. The rules every step builds to live in
`.media/recipes/helios-explainer/craft.md`, `house-style.md` and `minimums.md`; the kit's API and the
build checks in `frame.md`. When they seem to conflict, minimums win, then the format
(`references/story-design.md`), then house style, then craft; report the conflict in your last
message.

`<SKILL_DIR>` is `.claude/skills/faceless-explainer`. Run every command from the project root, as
one plain command: no `$(…)`, no pipes into scripts, no scripts in `/tmp`, no `cd` chains (they are
denied and waste turns).

**Fail open, everywhere.** A check that fails sends its exact errors back to whoever built the
thing, once. Whatever is still failing after that one fix round is named in your last message and
the work goes on; the job turns it into a warning on the reel. Only a crash with nothing to deliver,
or the spend cap, ends a run.

## Step 3: Storyboard and script (Session A, the director)

The director's `PHASE: plan` (helios-explainer-director `SKILL.md`): the voiceover in `SCRIPT.md`,
then the visual plan in `STORYBOARD.md` (the visual arc, the anchor scene, each frame's look, every
shot with its why) and `.hyperframes/answer-key.json`. Code then runs the
understanding test and, at most once, the director's `PHASE: fix`.

**Gate:** `STORYBOARD.md` and `SCRIPT.md` exist and the storyboard lint has had its one fix round.

## Step 3.1: Audio

Steps 3.1 to 6 are the build. The worker runs them as code (`lib/explainers/render/build.ts`,
settings `build_runner: code`): the same commands in this order, the same dispatches and the same
one fix round per check. This text is that code's specification, and the order of work for an
orchestrator session when the worker runs the build as an agent (`build_runner: agent`).

`node <SKILL_DIR>/scripts/audio.mjs --script ./SCRIPT.md --storyboard ./STORYBOARD.md --hyperframes . --out ./audio_meta.json --voice "$HELIOS_VOICE_ID" &`

It makes the narration, the word timings and the audio metadata. Always pass `$HELIOS_VOICE_ID`;
never fall back to another voice, and if the variable is empty, stop and say so. Start it, then
continue while it runs. (Step 4, the frames' visual design, is the director's pass 2: there is
nothing to add to the storyboard here.)

## Step 5: Build the frames

Wait for the Step 3.1 audio to finish. Then, in this order:

1. **Durations, pacing, music and the opener's sound.**
   - `node <SKILL_DIR>/scripts/audio.mjs sync-durations --audio-meta ./audio_meta.json --storyboard ./STORYBOARD.md`
   - `node assets/kit/pace.mjs`, right after, before anything reads frame lengths. It tightens the
     voice, makes each frame its voice plus its `hold`, writes `assets/timing/<frame id>.json`, and
     writes the close (frame 8, the kit's `close.js`), frame 1's opener module (`01-opener.js`) and
     frame 3's hand-off (`03-handoff.js`, the kit's `handoff.js` over the world).
     It must print `"ok": true`.
   - `node assets/kit/music.mjs`: the bed, fitted to the reel. It must print `"ok": true`; on an
     error run it once more, then continue without music and say so in your last message. Never
     choose music yourself.
   - `node assets/kit/opener-sfx.mjs`: the opener's own sound and the hit on the 1→2 cut. It must
     print `"ok": true`. Never run `audio.mjs fetch-sfx`: frame builders design each frame's sound.
2. **Packets.** `node <SKILL_DIR>/scripts/frame-packets.mjs --project . --storyboard ./STORYBOARD.md`
   writes one packet per frame and `_role.md` under `.hyperframes/frame-packets/`.
3. **The world first.** Dispatch one `scene-builder` agent with: "Build the reel's world. Read
   .claude/skills/helios-explainer-director/scene-builder.md and follow it." It writes
   `assets/world/world.js` and `assets/world/identity.js`, looks at its own stills, and reports. Then
   run `node assets/kit/try.mjs world` and `node assets/kit/try.mjs props` (it already ran both on
   itself); on errors still left, dispatch it once more with the exact errors and run both again.
4. **The frames, by look.** Dispatch one frame builder per frame 1–7 except frame 3 (code's hand-off), all in one message, in
   parallel, in the foreground (never in the background): the replies come back together, so you
   wait once, in that one step, and never poll or check on builders while they work. Each frame's agent type comes from its storyboard `look:`, never from its number:
   - `world` → `frame-worker-scene`;
   - `blend` → `frame-worker-scene` (it has the tools for both worlds);
   - `mechanism` → `frame-worker-tech`.

   Never dispatch a builder for frame 3 or frame 8 or edit their files (a check error on either goes
   into your last message). Every builder's message is: "Read
   .hyperframes/frame-packets/_role.md and your packet .hyperframes/frame-packets/<frame id>.md,
   and follow them." (The code build gives both files inline instead: the same content.) When one finishes, check that its module and its events file exist; if not,
   dispatch that frame once more. Keep each builder's list of what it could not fix for the picture
   check. When a builder's report ends with `WORLD REQUEST:` lines (a pose, a state or a camera view
   the world lacks), dispatch the scene builder once with those requests, run `try.mjs world`, then dispatch that builder again. A tool
   result that says to stop and wait for the user is a denied call, not a person: retry the call;
   never ask how to continue.
5. **Mount, try and bounds.** `node assets/kit/mount.mjs` writes every `compositions/frames/<frame
   id>.html` and the caption skin's dark and quiet windows. Then `node assets/kit/try.mjs all` and
   `node assets/kit/bounds.mjs all` (the build checks, `frame.md` § The build checks). For each frame
   either reports (each builder already ran `try.mjs frame` on itself and fixed what it could; this
   round takes only what is left), dispatch its builder (the same agent type) once with both lists of
   exact errors, all such builders in one foreground message,
   then run `node assets/kit/mount.mjs <frame id>` and both checks again.
6. **Sound.** `node assets/kit/sound.mjs` mixes every frame's events into `assets/sfx/events.wav`
   and places it. It must print `"ok": true`; its `dropped` list names events no sound matched. When
   a frame has two or more dropped events, dispatch its builder once with them ("rewrite your events
   file: …; use frame.md's foley words"), then run the sound again.
7. **Captions.** `node <SKILL_DIR>/scripts/captions.mjs build --storyboard ./STORYBOARD.md --audio-meta ./audio_meta.json --hyperframes . --out ./caption_groups.json`
   (after mount, so captions turn light on dark grounds and stay quiet over the cards).
8. **Assemble.** `node <SKILL_DIR>/scripts/assemble-index.mjs --storyboard ./STORYBOARD.md --hyperframes .`

Mark each frame `animated` in `STORYBOARD.md` once its module is mounted.

**Gate:** every frame is mounted, `index.html` exists, the captions are built, and the checks have
had their one fix round.

## Step 6: Finalize

- `node <SKILL_DIR>/scripts/transitions.mjs inject --storyboard ./STORYBOARD.md --hyperframes .`
- `node <SKILL_DIR>/scripts/transitions.mjs verify --storyboard ./STORYBOARD.md --index ./index.html`
- `npx hyperframes lint`
- `npx hyperframes check`

Fix a failing frame with the smallest edit to its `assets/frames/<frame id>.js`, or one more
dispatch of its builder, then `node assets/kit/mount.mjs <frame id>` and the failed check again. A
`text_box_overflow` of a few pixels on caption words (`#caption-word-*`) is a known false positive;
act only on findings that name a frame element.

### The picture check and the render

The worker runs both after this phase stops: `snap.mjs sequences`, the `picture-checker`, one fix round
for the frames a viewer could not follow (it dispatches their builders through this same phase), then
`npx hyperframes render`. Never run the picture check and never render here. Stop after Step 6's
checks; your last message lists what each check left.
