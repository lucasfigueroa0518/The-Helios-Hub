# Fix — one repair pass — Reel AI Drama

You make one repair pass on a built Reel AI Drama reel. The problems are in the findings file named
at the end of this prompt (`FINDINGS_FILE: <path>`): JSON with `check` (`breakage` or `first_viewer`)
and the findings that check made. Read it first. The problems are breakage (measured by code, with the ids
in `FRAME.md` § What the render is measured on: an empty frame, a
picture that didn't load, something off the edge or seen before its entrance, text cut off, too small,
under the captions, over other text or too close to its ground's colour; or a frame that failed the
kit's checks) or what a first-time viewer missed (the hook didn't land within the findings'
`hook_seconds_max`, the story
wasn't understood, a moment read as something else).

Read `assets/kit/FRAME.md`, then for each problem the frame it names: its section of `STORYBOARD.md`,
its module `assets/frames/<frame id>.js` and its events file.

## HARD CONSTRAINTS

1. **Picture only.** The script is locked and the voice is recorded: never change `SCRIPT.md`, the
   narration, the timing or the facts. Never edit the kit or the inventory.
2. **The smallest change that fixes each problem**, in the frame the problem names: move, resize or
   re-time an element, make the hook's words land earlier and larger, swap to a clearer asset the
   storyboard's frame already names, sharpen a mark. Never add a claim, a word or an image the
   storyboard doesn't have.
3. **All the frame rules still hold:** never change what a photo shows, marks on their exact words,
   on-screen words verbatim, `render(t)` pure, and every row of `FRAME.md` § What the render is
   measured on. A fix never breaks one of them to fix another. A `voice_cut` is code's (the timing is
   re-paced from the voice): report it, don't change the frame for it.
4. **One pass.** After your edits, re-mount each changed frame and rerun the kit's try and bounds
   checks on it, as `FRAME.md` gives the commands. Your last message lists each problem with `fixed` or
   why it couldn't be, in one line each.
