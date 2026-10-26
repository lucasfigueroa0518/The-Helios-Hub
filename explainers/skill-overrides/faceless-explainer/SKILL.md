---
name: faceless-explainer
description: "The Helios Explainer Reel workflow (Explainers 4.1): one reel of about a minute, 9:16, from a prepared HyperFrames project, in eight fixed beats around one anchor scene: a dressed place built with the Helios world kit, critters acting by intent through the rig, a camera grammar where every cut teaches something, tech beats designed by technique with one identity per concept, builders that look at their own stills, a required picture check, full of sound. Run only through the helios-explainer-director skill."
---

# Helios Explainer Reel workflow (Explainers 4.1)

> Helios replacement for the vendored faceless-explainer `SKILL.md` (planning/Explainer
> Reels/DECISIONS.md, EX3-05; 3.1: EX3-60 to EX3-75; 3.2: EX3-76 to EX3-88; 4.0: the visual system,
> planning/Explainer Reels/VISUAL_SYSTEM_4.md; 4.1: EX4-145 to EX4-157). The worker has already
> done Step 0 (setup) and Step 2 (design system): the project, `BRIEF.md`, `frame.md`, the caption
> skin, the recipe with `principles.md`, the fonts, the logo, the world kit (`assets/kit/`, its
> `VERSION` saying 4.1), the opener sounds (`assets/sfx/`), and the sound library
> (`assets/sfx-library/`) are in place. The helios-explainer-director skill tells you which phase
> you are in. Every rule here is mandatory.

**`.media/recipes/helios-explainer/principles.md` comes first** (EX4-157): read it before any
step; it wins over every rule in this workflow, `frame.md` and the references, and a conflict is a
bug to report in your last message.

`<SKILL_DIR>` is `.claude/skills/faceless-explainer`. Run every command from the project root,
as one plain command: no `$(…)`, no pipes into scripts, no scripts in `/tmp`, no `cd` chains
(they are denied and waste turns).

## Step 1: Brief

Read `BRIEF.md` (the topic, its term, the learning objective, the picked analogy, the source note),
`capture/extracted/visible-text.txt`, and `source.txt` when present. Write
`capture/extracted/visible-text.txt` and `capture/extracted/tokens.json` only if they are missing
(tokens: `colors: []`, `fonts: []`).

**Gate:** you can state the reel's term, audience, and thesis in one sentence each.

## Step 3: Storyboard and script

Read `principles.md`, `references/story-design.md`, `../hyperframes/references/storyboard-format.md`,
`../hyperframes/references/script-format.md`, `frame.md`, and the recipe skeleton
`.media/recipes/helios-explainer/storyboard-skeleton.md`. Write `STORYBOARD.md` (the anchor scene
staging the named analogy, the hook candidates and pick, the curiosity gap BRIEF.md picked (copied,
said word for word), the eight frames with their shots, each shot's cast and angle, and the tech
frames' techniques) and `SCRIPT.md` (one spoken line per frame).

**Gate:** `STORYBOARD.md` and `SCRIPT.md` exist and pass story-design.md's final checklist.

## Step 3.1: Audio

`node <SKILL_DIR>/scripts/audio.mjs --script ./SCRIPT.md --storyboard ./STORYBOARD.md --hyperframes . --out ./audio_meta.json --voice "$HELIOS_VOICE_ID" &`

It makes the narration, word timings, and the audio metadata (`music: none`: the kit's
`music.mjs` adds the bed after pacing). Start it, then continue to Step 4 while it runs.

## Step 4: Frame visual design

Read `references/visual-design.md`, `references/motion-language.md`, and `frame.md` in full. Edit
`STORYBOARD.md` in place: add `## Video direction` once, and each frame's `focal`, `eye`,
`space`, `camera`, `light`, `sounds`, and time-coded Scene lines that follow its `shots:` (each Scene line
names the shot it is in). Do not change the story, the script, the anchor scene, the shots'
subjects, casts and angles, the techniques, the holds, or `transition_in`; you may re-time cuts to
their cue words and split or merge a shot to keep it within 1.5–4.5s (frame.md § Shots). Write no `sfx:` lines and no code.

**Gate:** every frame has its shot fields and Scene lines paced to the voice; frames 1, 2, 4, 5,
6 and 7 have `shots:` where every cut changes the subject or the angle; every voiced action and
trip has its Scene line; `## Video direction` exists.

## Step 5: Build the frames

Wait for the Step 3.1 audio to finish. Then, in this order:

1. **Durations and pacing.**
   - `node <SKILL_DIR>/scripts/audio.mjs sync-durations --audio-meta ./audio_meta.json --storyboard ./STORYBOARD.md`
   - `node assets/kit/pace.mjs`: it tightens the voice (only real silence is cut, 0.2s between
     lines at most), each frame becomes its voice plus its `hold`, and
     `assets/timing/<frame id>.json` holds its real word times. The close (frame 8) has no voice:
     it becomes 2.5s, and its module and sounds (the kit's `close.js`) are written now. It must
     print `"ok": true`.
   - `node assets/kit/music.mjs`: the bed (groovy funk, driving indie, or hip-hop instrumental,
     fitted to the reel's length). It must print `"ok": true`; on an error, run it once more,
     then continue without music and say so in your last message.
   - `node assets/kit/opener-sfx.mjs` (the bank opener's own sound, the bed held back until its
     drop, and the hit on the 1→2 cut; frame 1's real length is now known, EX3-102). It must
     print `"ok": true`. `pace.mjs` has already written frame 1's module (`01-opener.js`, the
     opener named in `assets/opener.json`); frame 1's worker writes only the hook, `01-hook.js`.
   - Never run `audio.mjs fetch-sfx`: sound effects are designed per frame (item 6).
2. **Packets.** `node <SKILL_DIR>/scripts/frame-packets.mjs --project . --storyboard ./STORYBOARD.md`
   writes one packet per frame and `_role.md` under `.hyperframes/frame-packets/`.
3. **The world first.** Dispatch one `scene-builder` subagent (EX4-156: it carries its model
   setting) with: "Build the anchor scene. Read .claude/skills/helios-explainer-director/scene-builder.md
   and follow it." It writes `assets/world/world.js` (the dressed place, the cast, how they act)
   and `assets/world/identity.js` (the reel's concept identity map, which the tech frames import),
   snaps its own stills and revises at most twice. When it returns, run
   `node assets/kit/try.mjs world` (the set brief and the set, the identity map, the scale ledger,
   the outfits, every `LENS` drawing). On errors, dispatch it once more with the errors, then run
   the try again.
4. **The frames.** Once `try.mjs world` passes, dispatch every frame worker in one message, in
   parallel, each as its kind's agent type (EX4-156; frame 7's kind is its storyboard `anchor:`):
   - `frame-worker-scene`: frames 1 (the hook), 4, 5, and 7 when `anchor: scene`;
   - `frame-worker-tech`: frames 2, 3, 6, and 7 when `anchor: own`.

   Never dispatch a worker for the close (frame 8 is the kit's) or edit its files. Every frame
   worker's message is:
   "Read .hyperframes/frame-packets/_role.md and your packet .hyperframes/frame-packets/<frame
   id>.md, then frame.md, assets/timing/<frame id>.json (frame 1's is 01-opener.json; its worker
   writes 01-hook.js) and your frame's part of the kit that
   _role.md lists, and write assets/frames/<frame id>.js and assets/frames/<frame id>.events.json.
   Look at your own stills with snap.mjs before you hand off." When a worker finishes, check that
   both files exist; if not, dispatch that frame again. Keep each worker's list of what it could
   not fix for the picture check. When a worker reports a pose or a state the world lacks, dispatch
   the scene builder once with those requests, run `try.mjs world`, then dispatch that worker again. A tool result that says to stop and wait for the user is a
   denied call, not a person: retry that call; do not ask how to continue.
5. **Mount, try and bounds.** `node assets/kit/mount.mjs` writes every `compositions/frames/<frame
   id>.html` and the caption skin's dark and quiet windows. Then `node assets/kit/try.mjs all`
   and `node assets/kit/bounds.mjs all` (every piece of text measured every 0.2s: cut off by the frame
   edge, outside its box, or in a keep-out). In this 4.1 job the try also holds the scene frames to
   the camera grammar, the cast, the rig and the set, and the tech frames to their technique, the
   identity map, no empty shells and readable text (frame.md § The build checks). For each frame
   either reports, dispatch that frame's worker (its same agent type) once more with the exact
   errors (both lists together), then run `node assets/kit/mount.mjs <frame id>` and both checks
   again.
6. **Sound.** `node assets/kit/sound.mjs` mixes every frame's events into `assets/sfx/events.wav`
   and places it. It must print `"ok": true`; its `dropped` list names events no sound matched.
   When more than a few are dropped, or a frame has fewer than 4 events (frames 1, 2, 4, 5, 6,
   7), dispatch that frame's worker once with the list ("rewrite your events file: …; use
   frame.md's foley words"), then run the sound again.
7. **Captions.** `node <SKILL_DIR>/scripts/captions.mjs build --storyboard ./STORYBOARD.md --audio-meta ./audio_meta.json --hyperframes . --out ./caption_groups.json`
   (after mount, so captions turn light on dark grounds and stay quiet on the cards).
8. **Assemble.** `node <SKILL_DIR>/scripts/assemble-index.mjs --storyboard ./STORYBOARD.md --hyperframes .`

Mark each frame `animated` in `STORYBOARD.md` as its module passes the try.

**Gate:** `try.mjs all`, `bounds.mjs` and `sound.mjs` print `"ok": true`, every frame is mounted,
`index.html` exists, and captions are built.

## Step 6: Finalize

- `node <SKILL_DIR>/scripts/transitions.mjs inject --storyboard ./STORYBOARD.md --hyperframes .`
- `node <SKILL_DIR>/scripts/transitions.mjs verify --storyboard ./STORYBOARD.md --index ./index.html`
- `npx hyperframes lint`
- `npx hyperframes check`

Fix a failing frame with the smallest edit to its `assets/frames/<frame id>.js` (or a re-dispatch
of its worker), then `node assets/kit/mount.mjs <frame id>` and rerun the failed check. A
`text_box_overflow` of a few pixels on caption words (`#caption-word-*`) is a known false
positive; act only on findings that name a frame element.

### The picture check (required: EX3-84, EX4-155)

You know what every drawing is meant to be, so you cannot judge whether a stranger understands
it. A `picture-checker` agent (Sonnet with vision, its own model setting) looks instead, at each
frame's shots in order, the way a viewer meets them.

1. **Stills.** `node assets/kit/snap.mjs sequences` renders, for every frame 1–7 (frame 1 is the
   hook), a still just after each shot starts and one at the frame's last moment, into
   `.hyperframes/sequences/`, and writes `.hyperframes/sequences/manifest.json`
   (`{ frames: [{ id, number, kind, voiceover, stills: [{ t, shot, file }] }] }`).
2. **Dispatch one `picture-checker` agent** with, for each frame in order, only its still paths (in
   order) and the line the viewer hears over them (its `voiceover`): never the storyboard, the
   scene line, or what anything is meant to be. It answers, frame by frame, as a first-time viewer:
   who the named character is; what just happened, and whether it matches the line; any cut that
   felt like a jump; anything floating, faceless, cut off or crowded; whether the place reads; and,
   on a tech frame, whether the idea moves or is only labelled; and every object it can name, as
   specifically as it can. It replies with a per-frame array. Write `.hyperframes/picture-check.json`
   as its reply under `frames`, plus one `assets` row per new drawing (every `NEW_PROPS` name in
   `assets/world/new-props.js` and `assets/frames/*.props.js`; `pass` only when the checker's
   `objects` named it as specifically as it was meant, never a near miss: EX3-112, EX3-114):

   ```json
   { "frames": [{ "frame": "<id>", "stills": ["0.15s", "…"], "named_character": "…", "action": "…",
       "matches_line": "yes|partly|no", "why": "…", "jump_cuts": [{ "between": ["…", "…"], "why": "…" }],
       "floating": [], "faceless": [], "cut_off": [], "crowded": "", "tech_moves": "moves|only_labels|not_tech",
       "place": "…", "objects": [], "unclear": [] }],
     "assets": [{ "name": "<NEW_PROPS name>", "file": "<file>", "meant": "…", "seen": "…", "pass": true }] }
   ```

   The job records a missing or unreadable file as an error on the reel.
3. **Compare** its answers with what each frame meant. A frame **fails** when the named character
   is not the one the voice names (or the checker cannot say), `matches_line` is `no`, it lists
   any jump cut, anything floating, faceless or cut off, calls a shot crowded, cannot say where we
   are on a scene frame, says `only_labels` on a tech frame, or names an object less specifically
   than it was meant (EX3-112).
4. **Fix each failing frame once:** dispatch that frame's worker (its same agent type), or the
   scene builder when a world drawing is the problem, with the checker's words for it. Re-mount,
   run the try and bounds for it, run `snap.mjs sequences` again, and dispatch the checker once
   more on the fixed frames; write its second reply into the same file, replacing those frames'
   entries.

Then render without asking:

`npx hyperframes render --quality high --workers auto --output renders/video.mp4` (`auto` sizes the
workers to the machine)

**Gate:** `renders/video.mp4` exists. Your last message states its path and duration.
