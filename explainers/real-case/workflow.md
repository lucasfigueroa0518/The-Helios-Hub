---
name: faceless-explainer
description: "The Helios AI News Explained workflow (news-v1): one reel of about a minute, 9:16, from a prepared HyperFrames project, in eight fixed acts telling one true AI news story as a true-crime documentary, built with the news kit (board, newspaper, whiteboard), full of sound. Run only through the helios-real-case-director skill."
---

# Helios AI News Explained workflow (news-v1)

> The AI News Explained version of the Helios faceless-explainer workflow (planning/Real Case
> Reels/DECISIONS.md). The worker has already done Step 0 (setup) and Step 2 (design system): the
> project, `BRIEF.md`, `frame.md`, the caption skin, the recipe, the fonts, the Helios mark, the news
> kit (`assets/kit/`), the story's banked logos and cutouts (`assets/bank/`), its objects
> (`assets/objects/`, made after the plan), and the sound library (`assets/sfx-library/`) are in
> place. The helios-real-case-director skill tells
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
`.media/recipes/helios-explainer/storyboard-skeleton.md`. Write `STORYBOARD.md` (the case file, the cold-open
candidates and pick, the question, the eight frames with their facts and shots) and `SCRIPT.md` (one spoken line per frame).

**Gate:** `STORYBOARD.md` and `SCRIPT.md` exist and pass story-design.md's final checklist.

## Step 3.1: Audio

`node <SKILL_DIR>/scripts/audio.mjs --script ./SCRIPT.md --storyboard ./STORYBOARD.md --hyperframes . --out ./audio_meta.json --voice "$HELIOS_VOICE_ID" &`

It makes the narration, word timings, and the audio metadata (`music: none`: the kit's
`music.mjs` adds the bed after pacing). Start it, then continue to Step 4 while it runs.

## Step 4: Frame visual design

Read `references/visual-design.md` and `frame.md` in full. Edit `STORYBOARD.md` in place: add
`## Video direction` once, and each frame's time-coded Scene lines and `sounds:`. Do not change the
story, the script, the facts, the case file, the `ground`, the holds, or `transition_in`. Write no
`sfx:` lines and no code.

**Gate:** every frame 1 to 7 has Scene lines paced to the voice, each naming its shot and its one item;
`## Video direction` exists.

## Step 5: Build the frames

Wait for the Step 3.1 audio to finish. Then, in this order:

1. **Durations and pacing.**
   - `node <SKILL_DIR>/scripts/audio.mjs sync-durations --audio-meta ./audio_meta.json --storyboard ./STORYBOARD.md`
   - `node assets/kit/pace.mjs`: it tightens the voice (only real silence is cut), each frame becomes
     its voice plus its `hold` (frame 1's hold is the sting), and `assets/timing/<frame id>.json`
     holds its real word times. The close (frame 8) becomes 2.5s and its module is written now. It
     must print `"ok": true`.
   - `node assets/kit/music.mjs`: the documentary bed, fitted to the reel's length. It must print
     `"ok": true`; on an error, run it once more, then continue without music and say so in your last
     message.
   - Never run `audio.mjs fetch-sfx`: sound effects are designed per frame (item 5).
2. **Packets.** `node <SKILL_DIR>/scripts/frame-packets.mjs --project . --storyboard ./STORYBOARD.md`
   writes one packet per frame and `_role.md` under `.hyperframes/frame-packets/`.
3. **The frames.** Dispatch one `frame-worker` subagent per frame 1 to 7 (frame 8 is the kit's; never
   dispatch a worker for it or edit its files), in parallel, with this message: "Read
   .hyperframes/frame-packets/_role.md and your packet .hyperframes/frame-packets/<frame id>.md, then
   frame.md and assets/timing/<frame id>.json, and write assets/frames/<frame id>.js and
   assets/frames/<frame id>.events.json." When a worker finishes, check that both files exist; if not,
   dispatch that frame again. A tool result that says to stop and wait for the user is a denied call,
   not a person: retry that call; do not ask how to continue.
4. **Mount, try and bounds.** `node assets/kit/mount.mjs` writes every `compositions/frames/<frame
   id>.html` (frame 1 with the sting over its hold), the sting's sound events, and the caption skin's
   dark and quiet windows. Then `node assets/kit/try.mjs all` and `node assets/kit/bounds.mjs all`
   (every piece of text measured every 0.2s: cut off, outside its box, or in the caption band). For
   each frame either reports, dispatch that frame's worker once more with the exact errors (both lists
   together), then run `node assets/kit/mount.mjs <frame id>` and both checks again.
5. **Sound.** `node assets/kit/sound.mjs` mixes every frame's events into `assets/sfx/events.wav` and
   places it. It must print `"ok": true`; its `dropped` list names events no sound matched. When more
   than a few are dropped, or a frame 1 to 7 has fewer than 4 events, dispatch that frame's worker once
   with the list ("rewrite your events file: …; use frame.md's sound words"), then run the sound again.
6. **Captions.** `node <SKILL_DIR>/scripts/captions.mjs build --storyboard ./STORYBOARD.md --audio-meta ./audio_meta.json --hyperframes . --out ./caption_groups.json`
   (after mount, so captions turn light on dark grounds).
7. **Assemble.** `node <SKILL_DIR>/scripts/assemble-index.mjs --storyboard ./STORYBOARD.md --hyperframes .`

Mark each frame `animated` in `STORYBOARD.md` as its module passes the try.

**Gate:** `try.mjs all`, `bounds.mjs` and `sound.mjs` print `"ok": true`, every frame is mounted,
`index.html` exists, and captions are built.

## Step 6: Finalize

- `node <SKILL_DIR>/scripts/transitions.mjs inject --storyboard ./STORYBOARD.md --hyperframes .`
- `node <SKILL_DIR>/scripts/transitions.mjs verify --storyboard ./STORYBOARD.md --index ./index.html`
- `npx hyperframes lint`
- `npx hyperframes check`

Fix a failing frame with the smallest edit to its `assets/frames/<frame id>.js` (or a re-dispatch of its
worker), then `node assets/kit/mount.mjs <frame id>` and rerun the failed check. A `text_box_overflow`
of a few pixels on caption words (`#caption-word-*`) is a known false positive; act only on findings
that name a frame element.

### The picture check (mandatory, blind)

You know what every item is meant to be, so you cannot judge whether a stranger can tell. A
`picture-checker` agent, which knows nothing of the storyboard, looks instead.

1. **Snapshot** these moments in reel time (frame starts are the running sum of the storyboard
   durations): 0.3s before the end of every shot in frames 1 to 7 (frame 1's last moment 0.3s before
   its `voice_end`, before the sting), and the close 0.2s before its end:

   `npx hyperframes snapshot --at <the times, comma-separated> --output .hyperframes/check-1`

   It writes numbered contact sheets beside the snapshots (`contact-sheet.jpg`, or
   `contact-sheet-1.jpg`, `contact-sheet-2.jpg`… for more than 9 moments).
2. **Dispatch one `picture-checker` agent** with only: "Read .hyperframes/check-1/contact-sheet*.jpg and
   describe every tile." Never tell it what the reel is about or what anything is meant to be.
3. **Compare** its words with what you meant, tile by tile, and write `.hyperframes/picture-check.json`:

   ```json
   [{ "tile": 1, "frame": 1, "at": 0.5, "meant": "the printed reply, its station name circled in orange",
      "seen": "<the checker's words>", "pass": false, "fix": "the circle sits on the line below: mark the marked span" }]
   ```

   A tile **fails** when: the item you meant to have the attention is missing from its words, called an
   unclear shape, or named less specifically than meant; **two or more items compete** for the
   attention (it names more than one thing as the main subject, or calls the tile busy or cluttered);
   text you meant to be read is unreadable, cut off or too small; **a mark misses its word** (the
   checker says the circle, underline or arrow is on something other than what you meant); an object
   is not what it was meant to be; or the tile looks like the tile before it.
4. **Fix each failing frame once:** dispatch that frame's worker with the finding. Re-mount. Snapshot
   only the failed moments to `.hyperframes/check-2`, dispatch the checker once more on those sheets,
   and record the second verdicts in the same file.

Then render without asking:

`npx hyperframes render --quality high --workers 1 --output renders/video.mp4`

**Gate:** `renders/video.mp4` exists. Your last message states its path and duration.
