---
version: ai-news-v0
name: Helios — AI News Explained frame (true-crime documentary)
description: >
  A one-minute true AI news story told as a true-crime documentary across three scenes: a cork
  bulletin board (push pins, red cord), a whiteboard in a room (everything drawn in dry-erase marker;
  magnets only for the verbatim artifact and printed logos), and a newspaper page (felt-tip
  markups). Tactile, never glossy. One item gets the viewer's attention per shot. Helios orange marks
  the one detail that matters. Decisions: planning/Real Case Reels/DECISIONS.md (RC-39 to RC-50);
  motion and sound: planning/Real Case Reels/SCENES.md.
unit: the frame — 1080×1920 (9:16); frames are DOM built with the news kit (assets/kit/components/)
principle: one item per shot · every motion has a physical cause · every sound is that action's own · information is shown by the evidence, never by words on tiles

colors:
  ink: "#1B1A17"
  canvas: "#EFE7D6"
  accent: "#E8431A"
  cork: "#8E6136"
  cord: "#B5241B"
  manila: "#D9BE85"
  newsprint: "#E9E1CD"
  whiteboard: "#F2F3F3"
  dry-blue: "#1E3FAF"
  dry-red: "#C3271B"
  dry-black: "#141414"
  caption-light: "#FBF6EC"

typography:
  # display and body are the caption's faces (captions.mjs); both ship as files in assets/fonts
  display:   { fontFamily: "Pragmatica Extended", px: 62, weight: 700, lineHeight: 1.08, tracking: "-0.02em", lower: true, color: "ink" }
  body:      { fontFamily: "Roboto", px: 34, weight: 400, lineHeight: 1.38, color: "ink" }
  headline:  { fontFamily: "Playfair Display", px: 84, weight: 700, lineHeight: 0.95, color: "ink" }
  newsprint: { fontFamily: "Tinos", px: 26, weight: 400, lineHeight: 1.32, color: "ink" }
  typed:     { fontFamily: "Courier Prime", px: 40, weight: 400, lineHeight: 1.4, color: "ink" }
  marker:    { fontFamily: "Gochi Hand", px: 68, weight: 400, lineHeight: 1.1, color: "dry-blue" }
spacing:
  safe-x0: "96px"
  safe-x1: "984px"
  caption-band-top: "260px"
  caption-band-bottom: "560px"
  safe-y1: "1600px"
  min-readable-text: "26px on screen"
---

# AI News Explained — frame system

The visual system a frame worker builds in. Every rule is a hard constraint. When two seem to collide:
the facts → one item per shot → the frame treatment → layout → style.

## The three scenes

A frame's `ground:` names its scene. Each scene function returns `{ el, cam, ground, stage, front }`;
append `S.el` to the root and put every item on `S.stage` (the camera moves `S.cam`; the lamp and the
film grain never move).

- **`board`** — `nk.board(doc)`: cork, warm lamp, vignette. Items are pinned (`pushPin`) or taped; a red
  `cord` runs between pins to connect evidence. Photo cutouts, clippings, printouts, notices, index
  cards, evidence tags, Polaroids, printed logos.
- **`newspaper`** — `nk.newspaper(doc, { masthead, date, section })`: a full page on a desk. The page is
  the surface: `article()`s sit on it, and felt-tip marks (`markerCircle`, `markerUnderline`,
  `markerArrow`, `highlight`) are drawn on it. The masthead is a plain invented paper name of the story's
  place (never a real paper's name or look). Only facts are printed; everything else is filler lines.
- **`whiteboard`** — `nk.whiteboard(doc, { framing: 'wide' | 'close' })`: a real board in a room.
  **Everything on it is drawn in dry-erase marker, stroke by stroke** (`markerDrawing` for objects and
  people, `markerNote` for words, arrows, circles, crosses). Only the verbatim artifact and a printed
  logo are paper, each held by one flat `magnet` on its margin, never a pin. `bounds.mjs` fails a
  whiteboard frame showing anything else (a cutout, Polaroid, clipping, card, tag, pin, tape or cord).

## Components (import nothing; use `ctx.nk`)

Every item takes `doc` first and a placement `{ x, y, w, h, rot, z }` in stage coordinates, and returns an
absolutely positioned element you append to `S.stage`. Text in `[[double brackets]]` becomes a marked
span; `nk.markOf(el, n)` returns the n-th one for a mark to measure.

| Component | Use | Key options |
|---|---|---|
| `clipping` | a cut-out newspaper story on the board | `masthead, date, kicker, headline, deck, body[], photo, torn, seed` |
| `article` | a story set on the newspaper page | `headline, deck, body[], photo, headSize, columns` |
| `pullQuote` | a printed verbatim quote | `text, speaker` |
| `printout` | an artifact word for word on office paper | `kind: 'post' \| 'statement' \| 'reply', speaker, date, text` |
| `notice` | a typed notice | `title, lines[], foot` |
| `indexCard` | a typed card (a date, a stamp line) | `label, lines[]` |
| `evidenceTag` | a manila tag naming one item or a date | `text` |
| `polaroid` | a banked person's photo | `cutout, caption` |
| `cutout` | a photo cutout (an object or a banked person) | `src, edge: 'paper' \| 'clean'` |
| `logoPrint` | a banked logo printed on paper | `logo` |
| `silhouette` | a person who is not banked and not private | `pose: 'front' \| 'side' \| 'back'` |
| `dictionaryClipping` | the term, as a clipped dictionary entry (frame 5) | `term, pos, meaning, guide` |
| `stamp` | a rubber-stamp impression (a date, a word) | `text, size` |
| `tape` | a strip of tape over a corner | placement only |
| `pushPin` | a pin at `(x, y)` | `color: red \| yellow \| white \| blue` |
| `cord` | the red cord through pin points | `points[]`; returns `progress(u, taut)` |
| `magnet` | a flat magnet (whiteboard only) | `shape: disc \| bar, color: orange \| blue \| teal \| yellow \| black \| red` |

Marks are drawn in an ink layer: `const ink = nk.inkLayer(doc, S.stage)` (felt tip on board and
newspaper, dry-erase on the whiteboard). Each returns `{ el, seconds, progress(u) }`:

- `markerCircle(doc, ink, target, { color, seed })` — **only around a number or a single word**.
- `markerUnderline(doc, ink, target)` — under a phrase of two words or more.
- `markerArrow(doc, ink, fromEl, toEl, { bend, color })` — tail to head, then two flicks.
- `markerCross(doc, ink, target)` — two strokes over something that is wrong or gone.
- `highlight(doc, ink, target)` — a translucent pass over a quote.
- `markerNote(doc, ink, text, { x, y, size, color, rot })` — handwriting, at most 4 words.
- `markerDrawing(doc, ink, data, { x, y, w, color })` — a drawn object or person; `data` is the
  strokes JSON (below). `box` gives where it landed, for arrows.

`nk.motion.arrive(el, u, { from, rot })`, `.pin(pinEl, u)`, `.magnet(magEl, u)`, `.swing(tagEl, u)` move
items physically; `nk.cameraRig(S)` with `.key(t, x, y, scale)`, `.push(t0, t1, box)`, `.ride(t0, t1,
pts)`, `.follow(t0, t1, tipAt)`, then `.apply(t)` in `render`; `nk.rackFocus(items, focal, amount)`;
`nk.geo.seg(t, a, b)` (0→1 over a window) and `nk.geo.writeSeconds(text)`.

## Art the frame may use (and nothing else)

Paths are relative to the project root: prefix them with `ctx.assets` (`ctx.assets + 'objects/…'`).

- **Objects** from `## Case file`'s `objects:`, where `<slug>` is the object's name in lower case with
  dashes: on board and newspaper, `cutout({ src: ctx.assets + 'objects/cutout/<slug>.png' })`; on the
  whiteboard, `markerDrawing(doc, ink, ctx.objects.drawing['<slug>'], …)` (the mount hands every drawing's
  strokes to the frame; never fetch a file). Only what `assets/objects/credits.json` lists exists; when
  an object is missing, leave it out and never stand in another.
- **People** — `assets/bank/cutouts/<id>.png` (`polaroid()` or `cutout()`), only players `## Players`
  marks "cutout banked". On the whiteboard, `ctx.objects['person-sketch']['<slug>']` when it exists,
  otherwise the person's name in `markerNote`. Anyone else is a `silhouette`; a private person is never
  shown or named.
- **Logos** — `assets/bank/logos/<id>.png` (`logoPrint()`), only companies marked "logo banked",
  untouched. Any other company is its name, typed or handwritten.

## One item per shot (HARD CONSTRAINT)

Each shot gives one item the viewer's full attention, and that item is what the voice names during the
shot. Items arrive one per shot, on the voice; earlier items may stay, softened by `rackFocus` or out of
frame. Never show a frame's evidence all at once. **The key detail** (`## Case file`) is marked in Helios
orange (`COLORS.marker`) on board and newspaper, on its word, in acts 1, 3 and 5; on the whiteboard the
marks are blue, red or black dry-erase, red for the key detail.

## Fasteners never cover a face or photo (HARD CONSTRAINT)

Pins, magnets and tape sit on an item's border or margin: the white frame of a Polaroid, the paper
around a clipping's photo, the top edge of a sheet, never on the photo or a face inside it. A cutout
person sits whole inside the Polaroid's photo area with headroom; never crop a head. Cords run pin to
pin around photos, never across one. `bounds.mjs` fails any fastener whose centre, or any cord point,
falls inside a photo's inner area.

## The camera

Every move has a reason: push into what the voice names, ride the cord or an arrow to the next item,
follow the marker tip while it writes. Scale stays 1 to 2.4. Hold still while text is read. No drift,
no shake, no spin. Cuts land on the voice's cue words.

## Frame treatments per act

| Act | `type` | Treatment |
|---|---|---|
| 1 Cold open | `cold_open` | In motion at frame 0: the one striking piece of evidence (a clipping, an artifact, a number) slapped into frame and its key detail marked in orange as the voice says it. One shot (two only if the line runs past 5s). The sting after the line is code's. |
| 2 Setup | `setup` | The stamp first (`indexCard` or `stamp` with the date and place), then each player one per shot: a printed logo, a Polaroid, a silhouette, or a typed name, each with an `evidenceTag` naming them the first time. Often the newspaper: the launch as the press told it. |
| 3 The moment | `moment` | The key artifact (`printout`, word for word) builds in as the voice reaches it; the last shot is an insert on the key detail, marked in orange on its word. A cord may connect it to what it got wrong. |
| 4 Fallout | `fallout` | The number first (a headline or clipping with the figure, circled on its word), then the question held on one still picture: nothing new arrives while the question is spoken. Never the term. |
| 5 What actually happened | `reveal` | The whiteboard by default. Back to the moment's artifact; then the mechanism drawn on: what the system had, an arrow to what it missed (crossed out), the date it stopped learning. The term appears when the voice names it (written in `markerNote` on the whiteboard; a `dictionaryClipping` on board or newspaper); the cause is circled last. Never boxes of words. |
| 6 Since then | `since` | A date moving forward (a new `stamp` or tag), then where it stands now: the latest clipping or statement. |
| 7 For you | `for_you` | One printed line (an `indexCard` or `notice`) whose key words are underlined as the voice says them; at most one callback to the key detail. |
| 8 Close | `branding` | Code's. Never write it. |

## Forbidden

Text tiles or cards whose words stand for a concept or a step · glossy, glassy or "premium" UI · any
interface copied from a real product · cartoon characters or mascots · any photo of a person not in
`assets/bank/cutouts/` · a real newspaper's name or look · decorative motion (floating, bobbing, pulsing,
elastic bounce, idle drift) · whooshes, risers and stingers · a CSS `filter: url(#…)` and setting
`visibility` to `'visible'` (clear it to `''`) · text under 26px on screen · text inside the caption
band (y 260–560) or outside the safe area (x 96–984, y to 1600).

## Motion rules

1. **Every motion has a physical cause.** An unseen hand places, slaps, pins, tapes, draws, turns or
   wipes it. Nothing fades in from nowhere.
2. **Arrivals:** `motion.arrive` over 0.25–0.35s (lift before contact, a 1–3px settle, never a bounce);
   a pin presses in over 2 frames (`motion.pin`, about 0.07s) right after its item lands; a magnet slaps
   on after its sheet (`motion.magnet`); a tag swings once and settles (`motion.swing`).
3. **Writing at hand speed, on the voice:** handwriting at about 10 letters a second
   (`geo.writeSeconds`); a circle closes in 0.45–0.7s and finishes on the word it marks; an underline
   finishes on the last word it marks; an arrow draws tail to head then two flicks; a drawing takes its
   own `seconds` (1.2–3.5s), the camera following.
4. **The cord** unspools from the first pin to the next over 0.4–0.6s, then pulls taut.
5. **The marker is uncapped** once before a scene's first mark, and **capped** after its last.

## Sound rules (the frame's `.events.json`)

Every sound is its action's own, on its contact frame; a continuous action gets a sustained sound cut to
its length (`dur`). No sound without a visible action, except the unseen hand's marker uncap (just before
the scene's first mark) and cap (just after its last). At least 4 events in frames 1 to 7. Events use the
kinds `foley` (with `what` and, for sustained ones, `dur`), `impact`, `tick`, `click`; never `whoosh` or
`sting`. The `what` words for each action:

| Action | `what` |
|---|---|
| marker writing or drawing on the whiteboard | `marker writing whiteboard` (`dur` = the stroke's time) |
| a short sharp whiteboard mark (a tick, a cross, an arrowhead's flicks) | `squeak dryerase` |
| felt tip on paper (circle, underline, arrow, highlight) | `felt marker writing paper` (`dur`) |
| a sheet, clipping or page lands | `paper drop` |
| the newspaper page lands | `paper drop newspaper` |
| a pin goes in | `pushpin` |
| tape laid over a corner | `tape` |
| an eraser wipes | `eraser` (`dur`) |
| marker uncapped | `marker cap` |
| marker capped | `pen cap` |
| a rubber stamp hits | `stamp` |
| a page turns | `page turn` |
| a sheet slides away | `paper slide` |
| a tag swings | `paper flutter` |
| a magnet lands | `magnet` |
| the cord is pulled taut | `cord taut` |
