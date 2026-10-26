---
name: faceless-explainer
description: "The Helios Real Case Reel workflow (real-case-v1): one reel of about a minute, 9:16, from a prepared HyperFrames project, in eight fixed beats around one true event drawn with the Helios world kit (critters, the prop library, shots, the text cards), full of sound. Run only through the helios-real-case-director skill."
---

# Helios Real Case Reel workflow (real-case-v1)

> The Real Case version of the Helios faceless-explainer workflow (planning/Real Case
> Reels/DECISIONS.md). The worker has already done Step 0 (setup)
> and Step 2 (design system): the project, `BRIEF.md`, `frame.md`, the caption skin, the recipe,
> the fonts, the logo, the world kit (`assets/kit/`), the opener sounds (`assets/sfx/`), and the
> sound library (`assets/sfx-library/`) are in place. The helios-real-case-director skill tells
> you which phase you are in. Every rule here is mandatory.

`<SKILL_DIR>` is `.claude/skills/faceless-explainer`. Run every command from the project root,
as one plain command: no `$(…)`, no pipes into scripts, no scripts in `/tmp`, no `cd` chains
(they are denied and waste turns).

## Step 1: Brief

Read `BRIEF.md` (the term, the story, its facts, the key item) and
`capture/extracted/visible-text.txt`. Write
`capture/extracted/visible-text.txt` and `capture/extracted/tokens.json` only if they are missing
(tokens: `colors: []`, `fonts: []`).

**Gate:** you can state the reel's term, audience, and thesis in one sentence each.

## Step 3: Storyboard and script

Read `references/story-design.md`, `../hyperframes/references/storyboard-format.md`,
`../hyperframes/references/script-format.md`, `frame.md`, and the recipe skeleton
`.media/recipes/helios-explainer/storyboard-skeleton.md`. Write `STORYBOARD.md` (the story world, the hook
candidates and pick, the puzzle, the eight frames with their facts and shots) and `SCRIPT.md` (one spoken line per frame).

**Gate:** `STORYBOARD.md` and `SCRIPT.md` exist and pass story-design.md's final checklist.

## Step 3.1: Audio

`node <SKILL_DIR>/scripts/audio.mjs --script ./SCRIPT.md --storyboard ./STORYBOARD.md --hyperframes . --out ./audio_meta.json --voice "$HELIOS_VOICE_ID" &`

It makes the narration, word timings, and the audio metadata (`music: none`: the kit's
`music.mjs` adds the bed after pacing). Start it, then continue to Step 4 while it runs.

## Step 4: Frame visual design

Read `references/visual-design.md`, `references/motion-language.md`, and `frame.md` in full. Edit
`STORYBOARD.md` in place: add `## Video direction` once, and each frame's `focal`, `eye`,
`space`, `camera`, `sounds`, and time-coded Scene lines that follow its `shots:` (each Scene line
names the shot it is in). Do not change the story, the script, the facts, the story world, the holds,
or `transition_in`. Write no `sfx:` lines and no code.

**Gate:** every frame has its shot fields and Scene lines paced to the voice; frames 1, 2, 4, 5,
6 and 7 have `shots:` that never repeat a picture; `## Video direction` exists.

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
3. **The anchor scene.** Dispatch one `scene-builder` subagent: "Build the anchor scene. Read
   .claude/skills/helios-explainer-director/scene-builder.md and follow it." When it returns, run
   `node assets/kit/try.mjs world`. On errors, dispatch it once more with the errors, then run the
   try again.
4. **The frames.** Dispatch one `frame-worker` subagent per frame except the close (frame 8 is
   the kit's; never dispatch a worker for it or edit its files), in parallel, with this message:
   "Read .hyperframes/frame-packets/_role.md and your packet .hyperframes/frame-packets/<frame
   id>.md, then frame.md, assets/timing/<frame id>.json, assets/world/world.js and the kit, and
   write assets/frames/<frame id>.js and assets/frames/<frame id>.events.json." When a worker
   finishes, check that both files exist; if not, dispatch that frame again. A tool result that
   says to stop and wait for the user is a denied call, not a person: retry that call; do not ask
   how to continue.
5. **Mount, try and bounds.** `node assets/kit/mount.mjs` writes every `compositions/frames/<frame
   id>.html` and the caption skin's dark and quiet windows. Then `node assets/kit/try.mjs all`
   and `node assets/kit/bounds.mjs all` (every piece of text measured every 0.2s: cut off by the frame
   edge, outside its box, or in a keep-out). For each frame either reports, dispatch that frame's
   worker once more with the exact errors (both lists together), then run
   `node assets/kit/mount.mjs <frame id>` and both checks again.
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

### The picture check (mandatory, blind: EX3-84)

You know what every drawing is meant to be, so you cannot judge whether a stranger can tell.
A `picture-checker` agent, which knows nothing of the storyboard, looks instead.

1. **Snapshot** these moments in reel time (frame starts are the running sum of the storyboard
   durations): frame 1 0.3s before its end (the hook, after the opener's break); 0.3s before the
   end of every shot in frames 2, 4,
   5, 6 and 7 (after its write-ons, so every picture the viewer sees is looked at once; a frame
   of one shot is one moment); frame 3 0.3s before its end (the dictionary card); the close 0.2s
   before its end:

   `npx hyperframes snapshot --at <the times, comma-separated> --output .hyperframes/check-1`

   It writes numbered contact sheets beside the snapshots (`contact-sheet.jpg`, or
   `contact-sheet-1.jpg`, `contact-sheet-2.jpg`… for more than 9 moments).
2. **Dispatch one `picture-checker` agent** with only: "Read .hyperframes/check-1/contact-sheet*.jpg
   and describe every tile." Never tell it what the reel is about or what anything is meant to be.
3. **Compare** its words with what you meant, tile by tile, and write `.hyperframes/picture-check.json`:

   ```json
   [{ "tile": 1, "frame": 1, "at": 0.5, "meant": "a critter in a dark room feeling for the light switch",
      "seen": "<the checker's words>", "pass": false, "fix": "the switch reads as a white box: redraw it with its toggle and plate" }]
   ```

   Then add one row per new drawing (every `NEW_PROPS` name in `assets/world/new-props.js` and
   `assets/frames/*.props.js`, EX3-114) under `"assets"`, in the same file, which becomes
   `{ "tiles": [ …the rows above… ], "assets": [ … ] }`:

   ```json
   { "name": "surgical scalpel", "file": "assets/world/new-props.js", "meant": "a surgeon's scalpel",
     "seen": "<the checker's words for it>", "pass": true }
   ```

   An asset passes only when the checker names it as specifically as it was meant. A passing
   asset joins the asset bank after the render (EX3-114), so never pass a near-miss.

   A tile **fails** when: an entity you meant is missing from its words or called an "unclear
   shape" or something else, **or named less specifically than meant** (a "knife" for a scalpel,
   "shelves" for supermarket shelving, "a table" for a reception desk, EX3-112); **the tile is busy**
   (EX3-117): the checker names more than three things in it, or calls it busy, cluttered or
   crowded; the hook tile does not name the situation; something it calls cut off
   or too small is readable or the focal; or it looks like the tile before it (the same subject in
   the same framing). Also fail any frame where the scene spans less than 60% of the safe-area
   width, or the title card, dictionary card, labels or tracker are not readable (you may Read the
   same contact sheets).
4. **Fix each failing frame once:** dispatch that frame's worker (or the scene builder, when an
   entity's drawing is the problem) with the finding: redraw it to its specific name; a bank asset
   replaces it only on an exact fit (EX3-112). Re-mount. Snapshot only the failed moments to `.hyperframes/check-2`, dispatch
   the checker once more on those sheets, and record the second verdicts in the same file.

Then render without asking:

`npx hyperframes render --quality high --workers 1 --output renders/video.mp4`

**Gate:** `renders/video.mp4` exists. Your last message states its path and duration.
