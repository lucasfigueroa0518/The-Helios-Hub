# Reel AI Drama — the kit guide

The one source for what a Reel AI Drama frame can be: the blueprint and its fields, the treatments and their options,
motion and sound, and what is forbidden. The director plans each frame in a blueprint from this guide, and code builds
the frame from it. Decisions: `planning/AI Mini Docs/PLAN.md` (MD-03, MD-13, MD-14, MD-18, MD-34, MD-35, MD-41 to MD-46, MD-58 to MD-60, MD-69, MD-91, MD-94, MD-96, MD-127, MD-130, MD-136, MD-138, MD-143, MD-153 to MD-155; kept D-47,
D-48, S-74).

## The look

- **Real media, full screen, is the base (MD-03).** Photos, pages, documents, posts and maps fill the
  1080×1920 frame with a documentary grade, coarse moving grain and a vignette. The board, whiteboard
  and newspaper are tools for a moment, not the stage.
- **Composed shots, not slides (MD-59).** People are staged in places (`tableau`), drawn with an
  expression (`drawn`, `expressionMarks`), layered into a collage (`collage`). Seeded settings, expression
  marks and collage layers (below) are cheap tools used only when one is an exact match; otherwise the
  storyboard names a made asset (`M1`, `M2`…, `made: true`) drawn for that moment. Made assets are drawn,
  traced or code-built and read as illustration, never as a photo.
- **One medium per frame (MD-127).** A frame is all real (photos and cutouts of real photos) or all made
  (drawings, seeded settings, code-built pictures), never both. A scene rebuilt from real things (the people
  and the real objects and place elements the moment had) is a visible collage of real cutouts: each keeps a paper edge and a
  soft shadow, on a real place photo or a plain kraft or charcoal ground (§ `tableau`, § `collage`). It
  never blends into something that passes for a photograph. The kit's labels, numbers, pins, marks and seeded dressing are
  not a medium: they go on either kind of frame.
- **Helios carries the words; the pictures keep the documentary grade (MD-44).** Overlay words are
  Pragmatica Extended Bold (names, numbers, short lines) and Roboto (roles, labels), in paper-lit
  `#FEF9F3` and Helios orange `#FF5E1A`. Orange marks the one detail that matters.
- **Captions** mirror the Explainer Helios skin (MD-42): big Pragmatica Extended Bold, in the script's own capitalisation, in the
  band under the Reels header (x 96–940, y 292–542; its keep-out margin is y 260–560). Their tone is
  measured, not chosen: after mount, `measure.mjs` samples what is under the band every 0.2s and the skin
  sets paper-lit words with a soft shadow on a dark band, ink on a light one, and paper-lit words on a dark
  backing plate (typed in with the letters) over a busy or mid-tone band. They are code's: never draw
  captions in a frame.
- **Character images (MD-41, MD-46).** A person's banked character cutout represents them and may
  move through the reel; any other use of them (a full-screen photo, a backdrop) is a different photo.
  Any other image used again shows the viewer something new each time, never the same view (§ Moves).

## Layout

| Zone | Pixels | Rule |
|---|---|---|
| Caption keep-out (the band y 292–542 plus margin) | y 260–560 | Nothing readable here; keep faces and key detail out of it too. |
| Subject | centre column, visual centre y ≈ 800–1100 | The thing the line is about sits where the viewer looks: faces just below the caption band, never low in the frame. |
| Overlay words | x 96–940, y 600–1500 | Every number, name, label and lower third. |
| Bottom platform UI | y > 1500 | Pictures only; the small source credit sits at y 1560–1600. |
| Right button column | x > 940 | Pictures only. |

Readable text is at least **26px on screen** (after the camera's scale). Text smaller than that must be
dressing (`data-set`) or the credit (`data-credit`). `bounds.mjs` checks every 0.2s of every frame.

Code places everything, keeps it out of these zones, and keeps what matters uncovered. A blueprint never gives a position or a size.

## The blueprint

A frame is its blueprint. Code builds it from these fields alone. Every `on` is the exact words from this frame's narration
that the thing lands on, or `''` for the frame's start.

| Field | Values |
|---|---|
| `ground` | `charcoal`, `kraft`, `whiteboard`, or a picture's asset id |
| `style` | `cutouts` (clean figures) or `paper` (torn, tilted, overlapping collage) |
| `arrangement` | `solo`, `face_off` (two sides), `facing`, `turned_away`, `leads_to` (one thing leading to the next), `row`, `pile` (overlapping), `lead_inset` (one big, others small) |
| `hook` | `{ text, on }`: frame 1's large hook words, in their own band, on screen by 1.2s |
| `peak` | `true` on the story's peak: the frame doesn't slide |
| `pieces` | what is on screen; below |
| `labels` | `{ text, sub, kind, for, on }`: words about the frame or a piece (`for` is its id). Each script line's own label is shown by code, so don't repeat it. |
| `speech` | `{ on_piece, text, on, until }`: a few paraphrased words beside a person |
| `marks` | `{ kind, on_piece, target, from, on }`: § Marks |
| `arrows` | `{ from, to, on }`: between two pieces, drawn to their real positions |
| `camera` | `{ move, stops: [{ on, aim, zoom }] }`: `move` is `hold`, `push`, `drift`, `slide` or `tour`. A frame opens on the whole shot, and a stop is where the camera arrives. `aim` is `whole`, a piece id, `face:<person>` or `text:<exact words on the picture>`. |
| `ground_tone` | `[{ on, to }]`: the ground brightens or darkens to `to`, 0 dark to 1 bright |
| `sounds` | `{ kind, what, on, dur }`: § Sound |

A piece has an `id`, an `on`, and an optional `until` for when it leaves, and is one of:
- **A picture:** `asset`, with `role: 'lead'` for who the line is about, `side: 'left' | 'right'`, `belongs: <id>` (by that piece, smaller: a person's company, their device), `label` (its name), `crop` (`{ x, y, w, h }`, 0–1 of the picture).
- **A full picture:** `asset`, `fill: true`. It fills the frame. A wide picture that can't fill it without cutting what it shows becomes a framed print.
- **A picture on a spot in another:** `asset`, `onto: { piece, box }`. `box` is a name in that picture's measured `boxes`.
- **A treatment:** `treatment`, `asset` where it shows one, and `opts`, its own options (§ Treatments and § Moves). Its time, place, size and credit are code's. Values: `photo`, `page`, `post`, `document`, `headline`, `newspaper`, `map`, `board`, `lift`, `number`, `stat`, `lower_third`, `flash_reveal`, `phone_shot`, `click_reveal`, `burst` (`opts.assets` lists its pictures), `pull_quote`.
- **A note on a board:** `note` (its words), `note_role: 'figure' | 'place' | 'date' | 'body'`. The role sets its size.

The frame's `treatment` names its staging. Several pictures in one frame are several pieces, each with its `on` and `until`. One picture worked by the camera across beats is a `tour`.

### What code guarantees

- What matters is never covered: a head never, a logo's mark, a thing or a drawing by no more than 5%. Depth comes from that.
- Heads sit on one line, whole and clear of the caption band, within a set ratio of each other, with the lead largest. Bodies run off the frame's foot or stand behind a torn paper strip. Nothing fades out in mid-air, so never ask for a body cropped by hand.
- Pieces land in their final spots and hold them. The camera reveals them. One `slide` is available for a frame that truly needs it.
- A camera's aim and any marked words stay in the frame throughout its move. Zoom is capped by head size and sharpness.
- Nothing is drawn wider than it stays sharp.
- Labels live for a beat (dates a little longer) or until the next person arrives, so don't plan a name for a whole frame. A name shows on a person's first appearance only.
- A person standing in a shot is a cutout (code cuts them before the build). One that can't be cut shows as a framed print. A logo on a ground it would disappear on gets a paper chip.
- A lift leaves a cut hole in its page, and nothing dims. Captions are always bright. Backdrops keep the place recognisable. Pages stay on paper. On a board, the first item draws in, except in frame 1.
- When the cast can't fit, everything shrinks and the frame still ships, so fewer pieces at one moment look better.

## Treatments

The code below names each treatment's options, and those go in a piece's `opts`. Position, time, size, `media`, `duration` and `credit` are code's, whatever an example shows.

Times are frame seconds. `media` is a `ctx.media` entry; `src` a path under `assets/` instead.

### `photo` — a real photo, full screen
`nk.photo(doc, { media | src, width, height, focus, move, dir, amount, at, duration, grade, top, bottom, vignette, grain, blur, credit, parallax })`
- `focus` `[fx, fy]` (0–1 of the image): the detail the narration names; the move goes toward it.
  Default: the media's main face, placed on the subject line.
- `move`: `push` (1 → 1+amount, tension and discovery), `pull` (back out, context and release), `pan`
  with `dir` `left | right | up | down` (across the picture), `hold` (a slow 1.03 → 1.06 drift; a still
  never sits dead). `amount` 0.12 by default. The frame is moving from t = 0; a later move may start on
  its cue word (`at`).
- `at` `[t0, t1]`: the move's window (default the whole `duration`).
- `grade`: `documentary` (default), `cool`, `warm`, `mono`, `archival`, `none`.
- `top` / `bottom` (default on): dark shades that keep the caption band and the overlay words legible.
- `parallax: { fg, plate?, depth }` (D-54): only when the asset has a cut (`media.cutout.fg`; the
  inventory flags it `parallax`). `fg` is the subject cut from this same photo; it moves `depth` (0.06)
  more than the picture behind it. The gap it opens is filled by `plate` (`cutout.plate`, the photo with
  the subject inpainted) or, without one, by the photo itself softened. Use it on key images only; on
  every frame it makes everything float.

### `cutout_lift` — a person lifted off the picture
`nk.cutoutLift(doc, { cutout, media, backdrop, backdropWidth, backdropHeight, height, bottom, at, duration, name, role, credit })`
- `cutout`: the person's banked character cutout (`character_image: true`). `backdrop`: a different
  picture, blurred and darkened. Always pass one: the kit's fallback dark ground reads as a black void, which
  a frame never shows.
- `height` 1300 by default; `bottom` defaults so the face (from `media`, the cutout's `ctx.media` entry)
  lands on the subject line. A thing's cutout (`cutout_thing`) works too: it is 900 tall
  by default with its middle on the subject line.
- The cutout lifts in over `at` (`[0.1, 0.7]`), then a slow push. `name` / `role` add a lower third
  after the lift, placed under the face.

### `collision` — two figures or images brought together for a clash or a comparison
A stage, usually `arrangement: 'face_off'`, two `role: 'lead'` pieces with `side: 'left'` and
`'right'` and an `at` for each, and any logo between them as a piece that `belongs` to no one.

### `page` — a real page, marked on its words
`nk.page(doc, { media | src, width, height, boxes, marks, fit, x, y, tilt, push, arrive, duration, credit })`
- A screenshot of a real page. `boxes`: the harvest's measured text boxes, `[{ text, x, y, w, h }]` in
  the image's pixels (default `media.boxes`). Never place a mark by eye.
- Its text lines are keep-outs (§ Keep-outs). For a mark on its words, a face or its photo, use
  `nk.mark` with `on` the page (§ Marks).
- `marks: [{ box, kind, at, color }]`: `box` is a box's index or (part of) its text; `kind` is
  `circle | underline | highlight | box`; the stroke ends on `at` (the cue word's start). A circle or box
  takes 0.45–0.7s, an underline 0.2–0.45s, a highlight 0.35–0.8s (MD-43: measured onto the words).
- `fit` (1300) is the page's width on screen; `x`, `y` (−40, 640) its top-left; `tilt` (−1.2°).
- `push: { at: [t0, t1], scale }`: a slow push toward the first marked box (default the whole frame, 1.12).
  The first `nk.mark` with a `text:` target on the page aims it the same way. The marked words' whole line
  stays in frame with a margin all through the push: a line wider than the frame makes the page smaller
  instead of cutting it.
- `arrive`: a time when the page slides in (default: on screen from the cut).

### `document` — a real document on a desk
`nk.documentSheet(doc, { …page options })`: a scan, filing, letter or paper page as paper on a desk,
with the same measured marks. Defaults: `fit` 1000, `x` 40, `y` 620, `tilt` 1.4°. With `text` (and
`speaker`, `date`) instead of a picture it prints a recreation labelled "Recreated from …" (a rebuilt
document must read as one); prefer the real one.

### `post` — a real social post
`nk.post(doc, { …page options, backdrop })`: the post's screenshot as a card (`fit` 940, rounded), with
measured marks; `backdrop` softens a picture behind it. With `text`, `speaker`, `date` it prints a
labelled recreation; prefer the screenshot.

### `map` — a printed map with a pin
`nk.map(doc, { media | src, width, height, pin, label, sublabel, at, move, amount, duration, credit })`
- The map is made at harvest time by `kit/maps/render-map.mjs` (MapLibre, OpenFreeMap, printed paper
  look). `media.map` carries the plain image, the pin and the label; the orange pin drops at `at` (0.5s)
  and the Helios label wipes in after it while the camera pushes toward the pin. Hold on each stop.

### `headline` — a real headline as published
`nk.headline(doc, { media | src, boxes, marks } | { text, publication, date, over, at, markAt, y, credit })`
- With a screenshot it is a `page`. With `text` it is a paper strip (publication and date in Roboto
  caps, the headline in the paper's serif) slammed onto a dark ground or onto a softened photo
  (`over`: `photo` options); words in `[[double brackets]]` get an orange underline at `markAt`. Words
  only as the publication printed them.

### `lower_third` — who this is
`nk.lowerThird(doc, { name, role, at, x, y })`: an orange rule, the name in Pragmatica Extended (76px),
the role in Roboto (36px), wiped in with its plate at `at`. Options also `near`, `plate`. Start spot x 96,
y 1320; it keeps clear (§ Keep-outs). A `lower_third` frame
renders over the frame's first asset: build that asset as a `photo` and layer the lower third on it
(the module's `treatment` stays `lower_third`). Any frame may also layer one for a line's label.

### `number` — a big stat
`nk.number(doc, { value, label, tone, labelTone, at, countUp, x, y, size })`: the number in Pragmatica
Extended (118px; `tone` `paper` or `orange`), a short line under it (`labelTone` `orange` in Pragmatica, or
`muted` in Roboto), in the capitals you give it. `countUp` counts it up over 0.7s. Start spot x 96, y 1240;
options also `for`, `near`, `plate`, `until`; it keeps clear. A `number` frame renders over the frame's first asset, built as a
`photo` (the module's `treatment` stays `number`); any frame may also layer one for a line's label. For a
number beat that moves, use `stat`.

### `label` — a line's label, a name on a scene
`nk.label(doc, { text, sub, kind, at, until, for, near, x, y, tone })`: Roboto on a plate, wiped in with its plate at
`at`, held to `until` (default the end). `for: <piece or picture>` puts it by its owner, and it must not land before
them; `near: { on, target: 'face:<person>' }` by one face; otherwise it starts at x 96, y 1180 and keeps clear (§ Keep-outs). Not a treatment: layer it on one.
- A name lasts only while that person is the subject, not the whole frame: give it `until`, the moment the words
  leave them.
- `kind: 'date'` (MD-130): a date is the label the viewer must not miss. It is set larger than any other
  label: an orange rule over the date in Pragmatica Extended Bold (60px, a little smaller only for a long
  date), paper-lit on its dark plate. It keeps clear of faces, the caption band, page text and other labels
  like any label. Use it only for the line the writer marked a date.
- `nk.lineLabel(doc, line, { for, near, x, y, until })`: a line's label from `ctx.timing.lines`, with its words,
  its kind and its line's start; null when the line has no label. Prefer it for line labels.

### `stat` — a number beat that moves
`nk.stat(doc, { kind, at, duration, title, label, credit, over, … })`, centred on the subject line on a
dark ground (or `over`: a `ctx.media` picture, darkened and softened):
- `counter`: `value` (`'<figure>'`), `count` (seconds counting, 1.2), `tone` (`orange` | `paper`), `label`
  under it.
- `bar`: `items: [{ label, value, display? }]` (2–5; `display` is the text shown), `stagger` (0.35),
  `highlight` (an index, orange).
- `scale`: `items` (2–3, smallest first) as discs whose areas are true to the values, `stagger` (0.7).
Nothing shows before `at`. It carries its own sound cues (ticks while counting or growing, a pop or an
impact as it lands); the kit adds them to the frame's events (§ Sound).
- `burst`: a list of `ctx.media` entries, or `{ media, at, duration, opacity }`: `nk.burst` (§ Moves) between the
  ground and the number. Default: it runs while the stat counts in.
- `camera: { on, scale, at: [t0, t1] }`: opens close (`scale`, 2) on item `on` (a bar or disc; a counter's figure)
  and pulls out to the whole graphic over `at`, with its sound. Use this for a move on a number: only the graphic
  moves. The ground reaches past the frame on every side, so no camera move shows an edge.
- With `over`, the picture's faces keep out like they do for labels: the kit slides the picture (along
  its spare width, or down with its top fading into the ground) or moves and scales the graphic so no
  disc, bar or figure covers a face and no face sits under the captions. Pass the `ctx.media` entry, not a
  bare src, so its faces are known. A face in the backdrop is never the frame's subject.

### `lift` — a picture lifted off its own page
`nk.lift(doc, { media, lift, region, at, size, sheet, fit, x, y, tilt, marks, duration, credit })`
- `media`: the page, post or article (a `ctx.media` entry whose `regions` has `photos` and `lift`). It
  lies on the desk like `document` (`sheet: 'page'` for a screenshot page); at `at` (0.8) the cut-out
  peels up from exactly where it is printed and settles in the centre column with its face on the subject
  line (`size`: its height at rest, 760): a lift, a small turn, a growing shadow, the page dimmed behind
  it. The original stays visible: this is the one way to pull a person out of a page.
- `lift` / `region` override the sidecar's cut-out and its page region; without a cut-out the region
  itself is cut out as a paper piece.
- Returns `{ el, page, piece, picture, render, cues }`: marks go on `piece` (`face:…`) or `page`
  (`text:"…"`). Peel and landing sounds are its own (§ Sound).

### `board` — connected players
`nk.playersBoard(doc, { players, links, duration, credit })`: use it when the story's point is how three or more
players connect. Each player is one pinned card; a red cord is pulled between those the line connects.
- `players: [{ media, name, at, logo }]`, 3–5, in the order the voice names them. `media` is a person's photo or
  cutout; `logo: true` prints a logo untouched on paper. `name` is the card's caption. `at` is its cue word; with
  no `at` it follows the one before; `at: 0` is there from the start.
- `links: [{ from, to, at, label }]`: player indices. A cord only where the line states a connection, and `label`
  (a few words) only where the storyboard gives them. Pins and cords run from card edge to card edge, never over a
  picture. The kit places everything and carries the sounds.
- Returns `{ el, cam, stage, front, cards, cords, render, events }`: marks go on `cards[i].picture`.

### `newspaper` — how the world read a moment
`nk.frontPage(doc, { masthead, date, vol, price, photo, headline, deck, at, landAt, duration, credit })`: a front
page thrown onto the desk at `at` (0: it lies there from the start), then the headline stamped down on its cue word
at `landAt`, and a slow push. Build the frame's `newspaper` with this.
- `headline`: the on-screen words, sized by the kit to fill the measure. `photo`: a `ctx.media` entry, printed in
  halftone above it. Filler columns fill the rest of the page. The page's top stays below the caption band.
- Returns `{ el, cam, page, headline, picture, render, events }`: mark the headline with `target: 'el:headline'`,
  a printed face through `picture`.

### `whiteboard`, and the scenes' parts
A whiteboard frame's pictures, drawings, logos and notes are pieces on `ground: 'whiteboard'` (they hold
still: drawn things don't slide). Board and newspaper items stay on the scene's own `stage`:
`nk.scene(doc, 'board' | 'whiteboard' | 'newspaper', opts)` returns `{ el, cam, stage, front, render }`
(`render(t)` moves the grain; the newspaper page starts at y 600, below the captions). Put items on `stage` with the news kit's components: `clipping`,
`article`, `pullQuote`, `printout`, `notice`, `indexCard`, `evidenceTag`, `polaroid`, `cutout`,
`logoPrint`, `silhouette` (never for a named person: anyone the reel names is shown by their photo, cutout or drawing), `tape`, `stamp`; fasteners `pushPin`, `cord`, `magnet`; marks `inkLayer`,
`markerCircle`, `markerUnderline`, `markerArrow`, `markerCross`, `highlight`, `markerNote`,
`markerDrawing`, and `nk.mark` (§ Marks); the camera `cameraRig(scene).key().push()`, `rackFocus`; `motion.arrive/pin/magnet/swing`.
The rules of those scenes hold: every motion has a physical cause; on the whiteboard everything is drawn
in marker, and a logo on it is `nk.drawnLogo`, never a hand-drawn approximation or a word standing in for it; a pin, magnet, tape or
cord never covers a face or a photo.

### `tableau` — people and things staged in a place
A real scene is a stage, on a plain ground or a place photo as `ground`, with real cutouts as pieces.
A seeded setting keeps its named seats:
`nk.tableau(doc, { setting: 'boardroom', cast, screen, move, focus, amount, at, duration, credit })`
- **Real or drawn, never both (MD-127).** A seeded setting takes drawn people; never seat a real cutout in a seeded
  or made setting.
- Seeded settings (the made asset's flag `seed:<id>`): `dinner-table` (seats `back-left`, `back-right`, `left`,
  `right`), `boardroom` (`head`, `left-far`, `right-far`, `left-near`, `right-near`; wall screen `wall`), `stage`
  (`podium`, `stage-left`, `stage-right`; screen `main`), `phone-call` (`left`, `right`, each clipped to its own
  panel), `hearing-room` (`panel-left`, `panel-centre`, `panel-right`, `witness`).
- `cast: [{ media, seat, enter? }]`: drawn people in their seats; the setting's table, desk or dais covers the cut edge.
  Seat rivals facing each other and keep each person on the same side through a confrontation.
  `enter: { at: [t0, t1], from: 'left' | 'right' }` slides a figure in from wholly outside the frame.
- `screen: { media, on, at? }`: a logo or picture on one of the setting's screens.
- Every face in a frame shares one style (MD-94; the director's HARD 10): all cutouts, all photos, or all drawn.
- Returns `{ el, stage, figures, props, seats, render }`: put labels on `stage` (it moves with the camera);
  marks and expression marks go on a figure (`on: tb.figures[i]`).

### `collage` — paper, photo and marker layers
A stage with `style: 'paper'`: cuts and prints thrown down on `kraft`, `charcoal` or a
darkened picture, tilted and overlapping, with paper edges and soft shadows. Cutouts are never torn. A rebuilt real
scene is real cutouts and photos only: never lay a drawing in it.

### Drawn layers — sketches and expression marks
- `nk.drawn(doc, { media, x, y, w, h, at, dir })` (on a stage, a piece of `nk.stage` instead): a made drawing (an expression sketch, a drawn object)
  revealed as if drawn, with a soft edge (`at` `[t0, t1]`; `dir` `down` or `right`; `h` defaults from the media's aspect; `try.mjs` fails a moving clip written by hand, whose straight edge reads as a cut picture); a drawn element never shows its paper: made drawings arrive background-removed and sit on any ground.
  (An older opaque drawing has its paper keyed out by the kit as it loads.) Its ink follows the ground:
  dark ink on the whiteboard, a newspaper page, the board or paper; light chalk on any dark ground (kraft,
  charcoal, every made collage), read from the pixels really behind it, so the lines always read; there's no
  option to change it. On the whiteboard it goes on the scene's `stage`. A drawn person appears
  only where the storyboard puts them: frames keep people in one style (MD-69, MD-94), so never lay a
  sketch of someone over a photo or beside another person's cutout.
- `nk.expressionMarks(doc, { kind, on, target, at })` (on a stage, `marks` of `nk.stage`): marker marks of an inner
  state drawn around the top of the head, stroke by stroke from `at`, never across it: `worry`, `anger`, `shock`,
  `thought`, `question`, `idea`, `argue`. `on` is the picture and `target` its face (`face:<person>`, default `face:0`);
  they are sized to the head, follow its silhouette and follow it through every move. A close-up with no room pulls back
  until they fit (`nk.tour`, `cutout_lift`). Their ink is read from the pixels behind them.

### Moves — more than a screenshot and a ring

In a blueprint, a move is a treatment piece: `nk.flashReveal` is `flash_reveal`, `nk.phoneShot` is `phone_shot`, `nk.clickReveal` is `click_reveal`, `nk.burst` is `burst`, `nk.pullQuote` is `pull_quote`. `nk.speech` is the `speech` field, `nk.cuts` is pieces with `on` and `until`, `nk.tour` is a `tour` camera, and `nk.drawnLogo` is a logo piece on a `whiteboard` ground.

Each is built once and drawn by a pure `render(t)`, and returns `{ el, render, events }`. Nothing shows before
`at`; with `duration`, nothing after `at + duration`. Their sounds are the kit's (§ Sound); never write them.

An article, a page or a post has several ways onto the screen. Pick the one the moment asks for, and vary them
across a reel:
- `nk.flashReveal(doc, { media, at, duration, credit, …page options })`: a white flash on `at` and a shutter, then
  the page. Marks go on the result's `page`. Not on frame 1's first instant, which opens on its picture.
- `nk.phoneShot(doc, { media, at, duration, credit })`: the page on a clean phone with no brand, held in frame,
  gently scrolling. `at` above 0 slides the phone up into the frame. Marks go on the result's `picture`.
- `nk.clickReveal(doc, { media, headline, source, at, clickAt, duration, credit })`: a cursor crosses a plain window
  and clicks on `clickAt`, a breaking-news notification with `headline` and `source` drops in, then the article
  takes the window. Use it only for news that broke, with the words as the publication printed them.

Behind a number or a title:
- `nk.burst(doc, { media: […], at, duration, opacity, seed })`: pictures flip past fast at low opacity (0.2) as
  ground, never as the subject. The pictures are the storyboard's. On a stat, use the stat's `burst`.

On a person:
- `nk.speech(doc, { on, target, text, side, at, duration })`: a few words of what the person says, paraphrased as
  the storyboard words them, beside their face and tied to their figure. `on` is the picture (a treatment result, a
  figure); `target` their face (`face:<person>`). Prefer it to a ring on a face. It reads as a paraphrase, with
  no quote marks, so a real quote stays a `pullQuote` or a page. It keeps clear of other faces. Call its `render` after
  `on`'s. A picture without that face is skipped and reported as `[mark_on_nothing]`.

Several beats in one frame:
- `nk.cuts(doc, shots)`: `shots: [{ at, el, render }]`, each a treatment's or a move's result with its beat's time
  (`{ at: nk.cueAt(ctx.timing.words, '<the exact words>'), ...nk.photo(doc, { … }) }`). The frame opens on the first
  shot; each later one cuts in on its `at`. Build each shot as if it starts at 0: its `render` receives seconds
  since it cut in, and its sounds move with it.
  Adjacent shots of one picture are `[same_image_recut]` unless the later is a true close-up (about 1.6x or more).
- `nk.tour(doc, { media, stops, duration, credit, grade })`: one picture carrying several beats, worked by one
  continuous camera. `stops: [{ at, focus | face, zoom, label }]`: the camera moves, eased, from stop to stop, arriving
  as `at`'s words are spoken. `focus` is `[fx, fy]`, 0–1 of the picture; `face` a person in its measured faces, framed
  close unless `zoom` says otherwise (`zoom` 1 is the picture just filling the frame). `label` is a name that shows
  only while the camera holds on that stop, always inside the frame. Wide and then a close-up is two stops. Marks go
  `on` the result. A face the picture doesn't hold is left out and reported as `[mark_on_nothing]`.
- `nk.cueAt(ctx.timing.words, '<the exact words>', after)`: when the voice starts those words, from `after` on;
  null when none of them is spoken.

On the whiteboard:
- `nk.drawnLogo(doc, { media, at, duration, x, y, w, color })`: a real logo's own shape in marker ink: the marker
  follows the outline traced from the file, then fills it, in its true proportions. Whiteboard only (elsewhere it is
  skipped and reported), on the scene's `stage`. Everywhere else a logo stays as printed.

### `close` — the brand close (code's)
The last frame, 2.5s: white, the Helios logo scales in at the centre, "Reel AI Drama" writes itself beneath it in the
print handwriting (MD-143). The comment question is spoken over it, captioned in ink;
a question voiced past `CLOSE.maxQuestion` (2.3s) is stretched to fit the question. The last story frame holds and
crossfades into it, with its own sound. There is no opening sting: the cold open is frame 1.

### Helpers
`nk.grain(doc)` (moving grain), `nk.credit(doc, text, { y, light })` (the small source credit; every
found picture shows its credit), `nk.GRADES`, `nk.tg` (pure helpers: `kenBurns`, `coverFit`,
`markShape`, `findBox`, `countUp`, `softReveal`, `SAFE`, `CAPTION_BAND`), `nk.geo` (easing, `seg`, `arrive`, `rng`),
`nk.regionsOf` / `nk.findFace` / `nk.findPhrase` (what a `ctx.media` entry's regions hold),
`nk.SUBJECT`, `nk.OVERLAY`, `nk.CAPTION_KEEPOUT`.

### Marks — attached to what they mark
A mark (circle, underline, highlight, box, cross, arrow, scribble ring) points at one thing the voice
names, and is drawn from that thing's measured box, never placed at coordinates:

```js
// ILLUSTRATIVE
ring = ctx.nk.mark(doc, { on: shot, target: 'face:<person>', kind: 'circle', at: cue, duration: ctx.duration });
line = ctx.nk.mark(doc, { on: page, target: 'text:"<phrase>"', kind: 'underline', at: cue, duration: ctx.duration });
// render(t): ring.render(t); line.render(t);
```

- `on`: the picture it is on: a treatment result (`shot`, a `lift`'s `piece` or `page`), a figure
  (`tb.figures[i]`), a collage item, a `drawn` result.
- `target`: `face:<person>` (or `face:<index>`), `text:"<phrase>"` (the page's measured words; a phrase
  inside a longer line is sized to its letters), `photo:<index>` (a picture on a page), or
  `el:<element>` (the element itself, or the name in its `data-name`).
- The ring is the target's size plus `pad` (10): never the layer's or the picture's. The mark lives inside
  the picture's frame, so it follows every push, slide and lift. `at` is the cue word's start (the stroke
  ends on it); a mark never lands in the frame's last 0.4s (`duration`).
- A target the picture can't confirm is skipped and reported as `[mark_on_nothing]`: a face named for someone the picture
  doesn't show, a phrase not on the page, coordinates.
- On a page, document, post or headline the treatment's own `marks` (measured text boxes) still work.
- On the whiteboard: `nk.markerCircle(doc, layer, target)`, `markerUnderline`, `markerCross`,
  `highlight`, `markerArrow(doc, layer, from, to)` on drawn items (`layer` is `nk.inkLayer(doc, surface)`);
  `target`, `from` and `to` are drawn items on the board, given in the target forms of § Marks, never coordinates.
- In a collage, a `scribble-ring` layer with `around` and `target`.
The screen check reports a mark whose target is missing, hidden, or blank, a finished mark off its target
(`mark_off_target`), and any orange stroke a frame draws by hand. Orange strokes are marks: draw them only
with these functions. Expression marks (`nk.expressionMarks`) are a drawn feeling beside a head, not a mark.

## Motion

- Frame 1 opens on its charged image, whole and composed in the middle of the screen from its first instant, with the
  move already running; the hook's words arrive on the story timing's clock. Only what is secondary to it may arrive later.
- A frame changes inside it on the story timing's clock (a push reaching its detail, a mark, a number, a lower third,
  a new layer); `try.mjs` warns.
- The frame is moving from t = 0; a later move may start on its cue word. Push in for tension and
  discovery, pull out for context and release; hold the camera on each map stop.
- Marks, numbers and names land on their cue word (`ctx.timing.words`).
- No bounce, no spin, no decorative float; ease-out for the camera, ease-in-out for things placed.

## Sound

A blueprint's `sounds` are `{ kind, what, on, dur }`. Code places each on its words and mixes one track under the
voice; anything under speech is turned down. Arrivals, marks and marker writing already have their own sounds.

| kind | What it is | Fields |
|---|---|---|
| `ambience` | The place's steady sound under a still (D-47): a room, an office, a hall, a street, servers, wind, rain | `what` (plain words), `dur` 0.5–30s (it may run on under the next frame) |
| `foley` | The sound of an action you see: a marker on a page, a paper landing, a page turning, period detail of the place | `what`, `dur` for a continuous action (0.2–8s) |
| `impact` | A soft hit when two things meet or a big reveal lands | — |
| `tick`, `click`, `pop` | Small contact sounds (a pin dropping on a map) | — |

- **Stills get a full sound world (D-47):** an ambience bed for the place on most frames, foley for
  what moves (a marker squeaks only while its tip moves; a page lands on its contact frame).
- **No sound may imply an event the record doesn't show (D-48).** A `foley` or `ambience` whose `what`
  names an event (applause, cheering, shouting, a crash, a siren, a door, a shutter…) must carry
  `shown`: the id of the asset that shows that event. Otherwise drop it. `try.mjs` fails it.
- **Kit cues.** A kit graphic that moves carries its own sound: `stat`, `lift`, every move in § Moves,
  `playersBoard` and `frontPage`. `assemble.mjs` adds them to the frame's events marked `kit: true`; never
  write them yourself. They may use `whoosh`, because a graphic visibly moves.
- **Forbidden kinds in the events a frame writes:** `whoosh` and `sting` (decorative; `try.mjs` fails them).
  Designed stingers (risers, hits, whooshes, silences) belong to the sound designer's
  `sound_cues.json` alone; when it exists, its stingers and ambience lead and a frame's own ambience is
  dropped.

## Music

The director marks music on the storyboard frame where it changes (`- music:`), and `music.mjs` lays a
bed from the HeyGen catalog that follows it (S-74):

| cue | At the frame's start |
|---|---|
| `start` | the bed comes in, or comes back after a drop |
| `change` | the next track takes over (a short crossfade): an act turns |
| `drop` | the music cuts out: a short stop before a reveal |
| `end` | the music fades out across the frame |
| `hold` | nothing changes (the default) |

Frame 1 starts the bed. The bed always fades out across the close. Change at act
turns, not on every cut. When the sound designer's `sound_cues.json` exists (MD-61), its music cues lead
and these marks are only the brief it was written from.

## Forbidden

- Never change what a photo shows. Stylized treatment (cutout, grade, grain, duotone, blur behind a lifted subject) is allowed when it reads as treatment. Never add, remove, move or clone anything inside a photo's scene; lifting a subject out as a visible cutout is a treatment, not an edit. The same holds for a `lift` off its own page with the original left visible, a crop, Ken Burns, halftone or torn edges on a whole picture, and parallax with its gap filled; inventing visible content is never allowed. [D-73, D-74]
- Drawing captions, titles over the caption band, or text in the bottom or right UI zones.
- A picture standing in for something it doesn't show (each asset's `shows` is what it shows).
- Recoloring or distorting a logo or the Helios mark (`nk.drawnLogo` on the whiteboard is the one exception); a
  fastener or cord on a face.
- Generated images beyond MD-14 and MD-59 (marker drawings, line and expression sketches traced from a
  person's photo, drawn settings and collage elements made for a moment) and parallax gap-fill plates. Nothing made may look like a photo of a real event.
- A recreated document, post or headline that isn't labelled as one.
- Decorative sounds in the events a frame writes (`whoosh`, `sting`: designed stingers are the sound designer's)
  and sounds that imply unrecorded events.
