## C (kit, captions, screen checks) — 2026-11-02

**C → B (sidecars), how the kit reads them.** `project-files.mjs` (C) accepts the box sidecar as either
`<file>.boxes.json` (e.g. `V3.jpg.boxes.json`) or `<stem>.boxes.json` (`V3.boxes.json`, the old B2 name). A JSON
with any of `faces` / `words` / `photos` / `lift` is the new format; it lands in the inventory as
`regions: { faces, words, photos, lift }` (0–1 boxes as written; `lift` rewritten to `assets/media/<name>`), and
`words` also fill the old pixel `boxes` when the asset has none, so page marks keep working. Please put the `lift`
PNG beside the image with the same stem (e.g. `V3.lift.png`) so it is copied with it. Order `faces` largest first;
if a face is known to be a named person, an optional `name` on the face box (`{ x, y, w, h, name }`) lets frames
target `face:<name>`; without it they target by index.

**C → A (TREATMENTS).** The kit's `frames.mjs` TREATMENTS now includes `stat` and `lift` (contract names). Please
add both to `schemas.ts` TREATMENTS, and `lift` to `ASSET_TREATMENTS` + `CHARACTER_TREATMENTS` (contract). `stat`
needs no asset. Variety's STAGING maps `stat` → `number`, `lift` → `lift` (its own staging).

## A (writing code, voice, pace, close) — 2026-11-02, start
- Adding now (names fixed): `Spine.setup` (validated: when, where, present[] in the spine cast, wants[], fact_ids);
  rungs voicing it carry `spine_ids: ['setup']` and the first setup rung is R1 or R2. `FactSheet.relations` in the
  reporting tool + validator. TREATMENTS += `stat` (no asset), `lift` (asset + character treatment).
  Settings `voice_tempo` 1.12, `words_per_minute_target` 180, `silent_beat_max` 1.0.
- **D:** story-editor faults get a new field `check`: `'when' | 'present' | 'motive' | 'joins' | null` — set it when
  the fault comes from the always-checked list; code flags every fault with a `check` whatever its step (never
  capped/logged-only). Round 1 now receives ONLY the narration (Round + "Script, lines only"): no spine, pitch,
  facts, inventory or full draft (MD-97). The writer's and spine's `Length` section now states the word budget
  ("about N spoken words … at most about M"); craft can point at it instead of carrying numbers.
- **D:** `directorSystem()` = director + director-craft + `craft/story-timing.md` + FRAME.md; the writer-craft
  reference is gone from the director. story-timing.md is in CRAFT_NAMES, so tests need the file to exist.
- **D/C (fix.md):** the first-viewer fix now receives only picture findings (hook time, muted read); "story not
  understood" findings and confusions ship as flags (M11).

## B diagnosis (harvest) — 2026-11-02

Evidence: harvest logs `.explainers-local/reel-ai-drama/logs/harvest-<job>.jsonl` (events `look`, `wish_search`,
`wish_search_done`), `reel_ai_drama.assets` (usable + rejected rows with `reject_reason`), the director plans
(`artifacts` kind `director_plan`), the integrity log `integrity-2026-11-03.jsonl`, and the media files. Read only.

### 1. Why the wish searches found nothing

**Cause 1 (main): the look came back empty for whole sheets, silently.** The look runs `claude-haiku-5-5`, which
thinks by default; `max_tokens: 4000` is shared by the thinking and the 16-tile answer. On long-thinking sheets the
turn ran out of room mid-call and the `submit_looks` tool call arrived with input `{}` (thinking block present,
tool input empty). `lookAt` found the call, parsed zero tiles and reported no error, so every candidate on that
sheet became `not_checked:no_look`.
- Rosewood wish search: 4 sheets (16+16+16+6 = 54 candidates); sheets 2 and 3 came back `{}`. Those 32
  candidates were W2–W6's (Altman 2015, Rosewood hotel, Sutskever, Amodei). Sheet 1 (W1 Hassabis, W2) and sheet 4
  (W7) answered, which is exactly why W1 → V84 and W7 → V85 were the only finds.
- Same fault in the first harvests: 16 of 69 look sheets across all harvest logs came back `{}`; it is the top
  reject reason in both jobs (`not_checked:no_look`: Rosewood 48, Best on Paper 46). Sheets with longer thinking
  (signature 7.5–9.8k chars) are the empty ones; answered sheets run 3.2–7.2k. The same model's bank identity
  checks show `stop_reason: max_tokens` with near-empty tool input in the same logs.

**Cause 2: a place picture that fits the wish was thrown out as "off story".** Rosewood W2 (Googleplex exterior):
tile 1.11 "An aerial view of a large campus of low office buildings…" was judged `fits: true` but
`about_story: false` (the look can't tie a building to an OpenAI story), and the pipeline rejects any picture that
names no person and isn't "about the story" (`off_story`). For a wish the director asked for, `fits` is the test.

**Cause 3: the queries were built from the wish's prose, not its names.** `wishWants` kept shot-direction words
("clear", "photo", "alone", "around", "while", "exterior", "real", "passage", "published") and dropped capitalised
names into lower case. Commons (which ANDs every word) got `"exterior photo"`, `"Sam Altman photo alone 2014"`,
`"Thomas Wolf real photo 2018"`, `"passage convai2 1902"` — all 10 Commons queries in both jobs returned nothing.
Serper `"passage convai2 organizers paper arxiv 00098 1902"` returned teaching worksheets ("Paired Passages").

**Cause 4: a fitting small picture loses to a bigger one that doesn't fit.** The size floor keeps an under-600 px
picture only if no other live candidate for the same want clears the floor — fit or not. In a wish search most
candidates for a want don't fit, so a small fitting one (Best on Paper W6 tile 3.4, the human-evaluation table
with 3.11 vs 2.68, `fits: true`) is rejected. The wish search logs no reject reasons, so this is the most likely
reason for W6, not a proven one (the tmp files are deleted and rejected wish candidates are not recorded).
BoP W4/W5 ask for a passage of an arXiv paper; image search is the wrong tool for a paragraph of a PDF (the
paper's page is already in the inventory as V23; a crop of it is a `lift`/page-mark job for the director/kit).

### 2. Why "main pictures went to the wrong person"

Two different things were reported as one.

**(a) Rosewood frames 1, 5, 8 — the anchors are right; the frames put a second person under one person's line
and label.** V1 is Musk (Gage Skidmore, bank), V47 is Sutskever (Lucas's manual file), V48 is Amodei (bank); the
integrity check itself names them correctly ("this is the Ilya Sutskever anchor image"). The findings come from:
- frame 1: the frame's only label is L1 "Elon Musk", drawn by `lowerThird` at a fixed y1330 under both men; the
  integrity check reads V47 against that label → "Sutskever's picture under a Musk caption".
- frame 8: the director's `shows` deliberately stage Musk (V9, then V1 after the fix) beside Amodei on an Amodei
  line; the integrity check reads every image against the line only → "Musk for an Amodei line".
- frame 5: the "Demis Hassabis" lower third sits at y1330 over M2 (the Musk + Brockman sketch).
Not a harvest fault. Fix requests below (C: labels tied to their subject; D: every person staged is named on
screen or in the line; integrity input: the frame's `shows`).

**(b) Best on Paper — a real wrong anchor: Thomas Wolf is a Denver mayoral candidate.** BoP V2 (Thomas Wolf's
anchor cutout, `cutout_of:V5`) is cut from denverite.com/2022/09/06/thomas-wolf-denver-mayor-race-2023 — a
different Thomas Wolf. Identity was `identity:verified` with basis `title_and_url`: the search title and the URL
both say "Thomas Wolf", which proves the name, not the person. The look had already seen it: tile 1.10 "A smiling
older man in a dark vest… captioned as an investment banker running for Denver mayor, a different person"
(`about_story: false`), but nothing downstream reads that. The director then wished for a real photo
("The banked cutout V2 is cut from a photo of a different man and must not be used"), and that wish was W2.
Also: the look is never told who the cast are (role), only their names, so it can't always spot a namesake.

### Fixes (B, this iteration)
1. look.ts: room for thinking + answer (`max_tokens` 16000); a sheet whose call stops at `max_tokens` or answers
   fewer tiles than it got is re-asked once for the missing tiles only; tiles still unanswered are reported.
2. pipeline.ts: a picture the look says fits a wish is never `off_story`; the size floor's "is there a better one"
   counts only candidates that fit.
3. wishes.ts: queries from the wish's names (capitalised phrases, quoted titles) and the person's role, without
   shot-direction words; the year narrows only the first query; Commons gets names only. Each wish's candidate
   outcomes (reject reasons) are logged in `wish_search_done`. Period preference: a dated candidate within a year
   of the wish's year scores up, one far from it scores down.
4. Identity (filters.ts + look): the look gets each cast member's role and a new `namesake` answer ("the caption
   or picture shows this is a different person with the same name"). A namesake, or name-only evidence
   (`title_and_url`/page title) on a picture the look calls off-story, never verifies a person: it is dropped
   (namesake) or stays probable, so it can't become an anchor or a cutout source.

### Requests to other owners
- **C (kit):** labels/lower thirds anchored to their subject (`face:<name>` from the sidecar's named face boxes,
  else the subject element's box), never a fixed y; when a frame shows two people and only one is named, the
  label sits under that person (Rosewood F1, F4, F5). Already in your contract; these are the three test cases.
- **D (director prompt):** every person a frame stages is named on screen or in the frame's line; don't stage a
  second person under another person's lower third (Rosewood F1 Sutskever unnamed, F8 Musk on Amodei's line).
- **A or whoever owns `checks/integrity.ts` (no owner listed):** pass each image's role in the frame from the
  plan's `shows` ("staged as Elon Musk") into the integrity item, so an image of a deliberately present second
  person is judged against who it is staged as, not against the line's subject. Today the item carries only
  the line, the on-screen text and `anchor_for`.

## D (prompts) — 2026-11-02

Prompts and crafts are edited (spine-writer, writer, writer-revise, story-editor, director, first-viewer,
integrity, sound-designer, reporting, frame-worker, fix; plot-craft, writer-craft, director-craft; new
`craft/story-timing.md`). story-timing.md is now the one home of the reel's parts (hook, setup, ladder, turn,
landing, close question) and its clock (hook in L1/frame 1 ≤1.5s, setup right after, something new ≤8s, one turn
in the back half, ~60/≤75s, one silent beat ≤1s, close question ~6 words). writer-craft no longer carries them.

**D → A (prompts.ts + validators):**
1. Please compose `craft/story-timing.md` into the writer, writer-revise, spine and story-editor systems too (not
   only the director): writer = writer(+revise) + writer-craft + plot-craft + story-timing; spine = spine-writer +
   plot-craft + story-timing + writer-craft; editor = story-editor + plot-craft + story-timing + writer-craft. The
   prompts say "your brain follows: … and the story timing"; without it the writer loses the hook/8s/turn rules.
2. Story-editor faults: I use your `check` field (`when|present|motive|joins|null`); always-checked faults are
   listed first, then up to three ranked ones. Round 1 prompt text says it gets the narration only.
3. Writer: prompts now say L1's `on_screen` label is the date (writer-craft HARD 1) — a validator check would help;
   `pause_after` on one line at most; rung cap "about 24 spoken words" (8 s at 180 wpm); the word budget comes
   from your Length section (craft points at it, no numbers). Please update validate.ts messages that still say
   "fixed 2.5s close" (close question) and "about 140–170 makes 60 seconds".
4. Spine: `cast[].introduced_in` may be `"setup"` (people introduced in the setup); `setup.present` people each
   have a `relation` and a `wants` entry unless `missing` says the record lacks it (spine HARD 8).
5. Director inventory: please expose which assets can be lifted (e.g. `lift: true` when the box sidecar has a
   `lift` PNG) — the director prompt tells it a `lift` frame's first asset is the page/post/article it lifts from.
   Director words written onto a scene (whiteboard context, drawn person's name, stat figure/label) go in `motion`
   in quotes; the prompt limits them to names/dates/places/events/figures the script's lines or labels state.
6. Integrity: the prompt now judges "is it the real artifact" (parody/recreation → no) and answers `unsure` for a
   person's face clearly from a much later period in a dated beat. It needs the line's date label in the item
   (on-screen words already carry it) — and B's request (the frame's `shows`) would help it too.

**D → C (FRAME.md prose, please put in verbatim; mechanics/numbers are yours):**
1. § The frame module contract, the `face` sentence (line ~76), replace "keep it in the upper third of the frame and
   out of the caption band" with: "the subject is placed from it (§ Layout)". Add a § Layout row:
   `| Subject | centre column, visual centre y ≈ 800–1100 | The thing the line is about sits where the viewer looks:
   faces just below the caption band, never low in the frame. |`
2. § Forbidden, new first bullet: "Changing what a photo shows: adding, removing, moving or cloning anything inside a
   photo's scene, or inventing visible content. Treatments that read as treatment are allowed: grade, grain, crop,
   Ken Burns, a visible cutout, a `lift` off its own page with the original left visible, halftone or torn edges
   on a whole picture, blur behind a lifted subject, parallax with its gap filled." (frame-worker HARD 2, fix HARD
   3 and director-craft §9 now point here.)
3. § Drawn layers: replace "its white paper drops out on a whiteboard or paper ground" with "a drawn element never
   shows its paper: made drawings arrive background-removed and sit on any ground."
4. The module example: replace `value: '$4M', label: 'then the board met.'` and `/founder/i` with neutral
   placeholders, e.g. `value: '<figure>', label: '<label words>'` and `/<cue word>/i`, and mark the block
   "ILLUSTRATIVE".
5. § Music: "lays a tense documentary bed" → "lays a bed" (the sound designer owns the mood).
6. Plates: prefer a dark plate or a shadow over a picture; a light paper plate only on a dark ground (a paper
   plate over a photo reads as a white box).
7. § map: director-craft now says "use two pins when the line places one place relative to another". If the kit
   can't take two pins this iteration, tell me and I'll drop that clause.
8. § Marks: the director names targets as `face:<person>`, `text:"<phrase>"`, `el:<element>`; please spell them
   the same way in § Marks.
9. Tableau/collage: one line that a frame's faces share one grade and print (director HARD 10, MD-94).

**D → B:** done — director HARD 8 now says every person a frame shows has been named by then, and when its lines
name only some of them the others carry their name written onto the scene (no one under another's name).

## A — done (2026-11-02)
- Voice (`render/voice.ts`): one HeyGen take per script (frames grouped only past 4,500 chars) via the shared
  `heygen-tts.mjs` (called, not edited), `atempo=voice_tempo` on the take, word timestamps aligned to SCRIPT's
  frames (edit distance), cut at the measured silence between frames → `assets/voice/NN.wav` + the same
  frame-keyed `audio_meta.json` (host bed/sounds kept); take files in `assets/voice/take/`. Falls back to
  audio.mjs per-frame clips (also sped up) when the take fails, flagged `voice`. Stale `assets/voice/orig/` is
  removed before every voicing (pace used to start from the OLD voice after a re-voice). Writes `pace.json`
  `{ silent_beat_max }` at the project root.
- Pace: OPENER_TEMPO stays 1 (comment fixed: the whole take is sped once); silent beats and `pause_after` capped
  by `silent_beat_max` (default 1s); **the close stretches**: `closeLength(voice) = max(2.5, voice + 0.2)`.
- **C (request):** `kit/try.mjs:90` errors when `f.duration > CLOSE.duration + 0.05` — that now fires on every
  stretched close. Please compare with pace's `closeLength(questionVoice) + 0.05` (or drop it), and FRAME.md:223
  ("flagged, never stretched") → "stretched to fit the question". `music.mjs` FADE_OUT = CLOSE.duration is fine.
- **C:** the KIT_GUIDE test wants FRAME.md to name `` `stat` `` (and `` `lift` ``); director-composition test
  line 395 has a tsc error (`kind` on a mark) — yours.
- **D:** `flags.json` test fails on missingRewrites (W-130, W-36, W-82, D-73, D-74, D-54, D-6, W-9, D-33, D-68,
  W-86, S-10, D-40) after the craft collapse — keep those rewrites verbatim or get Claude to retire them in
  flags.json. Writer-craft numbers: the Length section now carries the budget (180 wpm → ~180 words/60s,
  max ~230); validator allows ONE line with `pause_after` > 0; rung cap 24 words; the close question still ≤ ~6
  words but no longer "fits a fixed 2.5s close".
- **fix.md (D):** first-viewer fix findings file now `{ check: 'first_viewer', hook_seconds_max, hookSeconds,
  findings }` — picture findings only (hook time, muted read); no `problems`/`warnings` spread anymore.

## B (harvest and assets) — 2026-11-02, built

All four fixes above are in, with tests (`tests/reel-ai-drama-harvest-iter4.test.ts`, plus two stale wish tests
updated in `reel-ai-drama-harvest-cast.test.ts`). Also: `bank-check.ts` max_tokens 1500 → 6000 (same thinking
squeeze: its log shows `max_tokens` stops with no verdict).

**B → C, box sidecars as written** (`harvest/boxes.ts`, `writeSidecars`): `media/<stem>.boxes.json` (stem name,
your reader's old-name path), for every saved harvest and wish image (not makes, not SVGs, not cutPeople's
director-requested cutouts yet). Fields: `faces` (largest first; `name` only when the asset has one person and
one face; `score`), `words` (`{ text, box }`, Tesseract conf ≥ 60, only for `web_page`/`social_post`/`document`/
`paper`/`headline`/`chart`/`archival` or text-heavy pictures, else `[]`), `photos` (only for page kinds or
text-heavy, else `[]`), `lift` (`<stem>.lift.png` beside the image, trimmed rembg cutout) and an extra
`lift_from` (the 0–1 region of the page it was cut from, so the lift can start where it sits on the page). A
screenshot's old pixel fields (`image`, `width`, `height`, `boxes`) are kept in the same file. The asset gets
`boxes:media/<stem>.boxes.json` and, with a lift, the flag `lift`. Checked on Rosewood V59 (Big Technology page:
131 words, the hero image boxed) and V85 (OpenAI post, dark mode).

**B → C, made drawings:** expression sketches, drawings and the harvest's line sketches are now ink on transparent
(no paper anywhere, inside the figure too; colour un-blended from white, so the kit can tint the lines, e.g. a CSS
`invert(1)` reads as chalk on a dark ground). Collage elements keep their own paper and lose only the white around
them. Settings stay opaque. Flag `transparent`. `whiteboard` placements on a white board look as before.

**B → D (harvest-look.md, my file, FYI):** the cast line now carries each person's role and the look answers a new
`namesake` field; one bullet added, no example names.

## C — done (2026-11-02)
- Built: anchored `nk.mark` (face:/text:"…"/photo:/el:, ring = target + pad, lives in the picture's frame),
  keep-outs (`keepClear`, `near`, label/lower third/number defaults), subject-line centring (photo zooms a
  high face down, cutout/collision/tableau/stat/lift on y 800–1100), sampled caption tones + plate
  (`measure.mjs`, run by assemble), `stat` and `lift` with kit cues, drawn elements keyed/no box shadow,
  `style_mix`, screen ids, `kit/gallery.mjs` (stills in test-runs/iter4-gallery/). FRAME.md updated; D's
  wording 1–6, 8, 9 inserted verbatim.
- **A:** try.mjs close warning now fires only past CLOSE.duration + 0.5s ("stretched … keep the question to
  about 6 words"); FRAME.md close says "stretched to fit the question". director-composition tsc error fixed
  (expressionMarks JSDoc).
- **B:** reader takes `lift_from` (the lift starts there). The on-disk sidecars in both test jobs are still the
  old pixel format; and V48's inventory face box sits ~220px below the face in the cutout (cutoutLift centres
  the box, so the real face lands high) — please check face boxes on trimmed cutouts.
- **D:** item 7: the kit's map takes one pin (the map image is rendered around one place at harvest) — please
  drop the two-pin clause. flags.json D-73/D-74/D-54: flagsReport reads craft + prompts only, not FRAME.md, so
  the § Forbidden text doesn't count; keep the rewrites in a prompt/craft file.
