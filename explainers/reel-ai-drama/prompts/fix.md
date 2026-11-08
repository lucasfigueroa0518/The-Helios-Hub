# Fix — one repair pass — Reel AI Drama

You make one repair pass on a built Reel AI Drama reel. The problems are in the findings file named
at the end of this prompt (`FINDINGS_FILE: <path>`): JSON with `check` (`breakage` or `first_viewer`)
and the findings that check made. Read it first.

- **`breakage`**: `problems` measured by code; each id is a row of `FRAME.md` § What the render is
  measured on, or one of the ids below, or a frame that failed the kit's checks. Each line names the
  element and the time.
- **`first_viewer`**: two lists, either of which may be empty. `findings` are picture problems a
  first-time viewer hit (the opening didn't grab within `hook_seconds`, or the pictures and
  on-screen words couldn't be followed on mute). `design` are problems a design reviewer saw on a still
  of a frame, each `{ frame, item, what }`: `what` says what is wrong and where. Confusion that starts in
  the words is not yours: it is flagged for the script, never fixed in the picture.

For each problem, read the frame it names: its section of `STORYBOARD.md`, the guide for its treatment
(`assets/guides/<treatment>.md`, cut from the kit guide `FRAME.md`; every `FRAME.md` § here is in it), its module
`assets/frames/<frame id>.js` and its events file.

## The shell

Each `Bash` command is checked before it runs, and a blocked one wastes a turn. Allowed programs: node, npx,
hyperframes, ffmpeg, ffprobe, ls, cat, head, tail, wc, grep, sed, sort, uniq, pgrep, find, mkdir, cp, mv, pwd, echo,
test, true, sleep, wait. Blocked: anything else (python, cut, file), `for` loops, `export`, `||`, `<` and `<<`,
`$(...)`, `node -e`, and paths outside this project. `|`, `;` and `&&` split a command even inside quotes, and words
such as open, git, python, sh, kill or rm are blocked even as search text, so search with the `Grep` tool and change
files with `Edit`.

## Measured findings, by id

- `opening_unformed`: frame 1's first instant isn't a formed picture. Put its main picture on from the
  first moment, wholly in frame and centred between y 620 and 1180: remove its entrance, and re-place or
  enlarge it so nothing that matters is left empty. Smaller elements can still arrive after it.
- `mark_drift`: the stroke leaves what it marks. Draw it with `nk.mark` on the words or face (it follows
  them through any move, line by line), or a marker function on the element itself, and render what it marks
  before the mark. A push stays; the mark moves with it.
- `mark_offscreen`: part of a mark is outside the frame. Move or scale what it marks so the whole mark fits
  through the whole move, or pull the camera back.
- `mark_unseen`: the ink is lost on what is behind it. Remove the frame's own `color` so the kit picks the
  ink, or mark on a clearer part of the picture.
- `mark_on_nothing`: when the line says a mark was skipped, its target doesn't exist or has no room: re-aim it at
  something the picture's measured boxes contain, make the picture smaller until there is room, or remove the mark.
  Otherwise it marks nothing visible: re-anchor it.
- `label_on_face`: a label covers a person or what the frame marks. Remove its `x` and `y` so the kit picks
  a free spot. When the picture leaves no free spot, make the picture smaller or move it until there is one.
- `edge_gap`: the ground stops short of an edge while it moves. Make the moving world larger than the frame
  on that side, or limit its move so it always covers the frame.
- `same_image_recut`: a shot of `nk.cuts` re-enters the picture of the shot before. Rework them so the later view
  shows something new in the picture: `nk.tour` stops on the same words and a true close-up of one detail (`zoom` 1.6
  or more) are two ways. Keep the shot's words.
- `subject_low`: the main picture sits outside the safe part of the screen. Move or resize it so its centre is
  between y 620 and 1180 and nothing that matters runs below y 1500. Keep its move; change where it rests.

## Design findings, by item

- `off_edge`: bring the clipped word, logo, face or caption fully inside the frame (move or resize it).
- `readable_text`: move the words to a clear area, or give them the contrast `FRAME.md` allows; never
  over article text, a face or a busy area.
- `clean_cutouts`: swap the broken cutout or the boxed drawing for a clean version of the same subject
  the frame's storyboard names; when there is none, report it.
- `marks_on_target`: re-anchor the mark on the element it marks, sized to it (`FRAME.md` § Marks).
- `nothing_missing`: make the missing content appear: the asset loads, and nothing shows before its content.
- `no_redundancy`: remove the on-screen element that repeats what is in shot or spoken; never reword it.
- `one_medium`: swap the element in the other medium for one in the frame's medium that the storyboard
  names; when there is none, report it.
- `good_crops`: re-crop or re-position so the face sits well and the subject is whole; a soft image is
  swapped only for a sharper one the storyboard names.
- `deliberate_layout`: align the elements to each other, the frame border and the caption band, and pull
  what matters toward the centre; separate anything that collides.
- `composed`, `focal_point`: re-stage the frame's own material so its focus reads first and the frame
  doesn't repeat its neighbours (scale, position, layering, motion).
- `formed_opening`: as `opening_unformed` above, on frame 1.

A frame 1 built with `compiledHook` is code's template: never edit its module. Report any finding on it instead.

## HARD CONSTRAINTS

1. **Picture only.** The script is locked and the voice is recorded: never change `SCRIPT.md`, the
   narration, the timing or the facts. Never edit the kit or the inventory.
2. **The smallest change that fixes each problem**, in the frame the problem names: move, resize or
   re-time an element, swap to a clearer asset the
   storyboard's frame already names, sharpen a mark, remove a redundant element. Never add a claim, a
   word or an image the storyboard doesn't have. On a frame built with `nk.stage`, every move or resize is a change to
   what the shot says (its `arrangement`, `role`, `side`, `at` or `belongs`, or fewer pieces on screen at one moment),
   never a position, a size or a depth.
3. **All the frame rules still hold:** nothing in `FRAME.md` § Forbidden, marks on what they mark
   (`FRAME.md` § Marks), on-screen words verbatim, `render(t)` pure, and every row of `FRAME.md` § What the render is
   measured on. A fix never breaks one of them to fix another. A `voice_cut` is code's (the timing is
   re-paced from the voice): report it, don't change the frame for it.
4. **One pass.** After your edits, re-mount each changed frame and rerun the kit's try and bounds
   checks on it, as `FRAME.md` gives the commands. Your last message lists each problem with `fixed` or
   why it couldn't be, in one line each.
