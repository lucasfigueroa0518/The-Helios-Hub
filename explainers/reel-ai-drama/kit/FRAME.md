# Reel AI Drama — the kit guide

The one source for how a Reel AI Drama frame is built: the treatments and their options, motion and
sound, the frame module contract, what is forbidden, and determinism. The director picks a treatment
per frame from this guide; frame workers build it with this kit. Decisions: `planning/AI Mini
Docs/PLAN.md` (MD-03, MD-13, MD-14, MD-18, MD-34, MD-35, MD-41 to MD-46, MD-58 to MD-60; kept D-47,
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
- **Helios carries the words; the pictures keep the documentary grade (MD-44).** Overlay words are
  Pragmatica Extended Bold (names, numbers, short lines) and Roboto (roles, labels), in paper-lit
  `#FEF9F3` and Helios orange `#FF5E1A`. Orange marks the one detail that matters.
- **Captions** mirror the Explainer Helios skin (MD-42): big lowercase Pragmatica Extended Bold in the
  band under the Reels header (x 96–940, y 292–542; its keep-out margin is y 260–560), no plate, paper-lit with a soft shadow on dark
  grounds, ink on the whiteboard. They are code's: never draw captions in a frame.
- **One image, one job (MD-41, MD-46).** A person's banked character cutout represents them and may
  move through the reel; any other use of them (a full-screen photo, a backdrop) is a different photo.
  The same image may repeat only when it says the same thing again.

## Layout

| Zone | Pixels | Rule |
|---|---|---|
| Caption keep-out (the band y 292–542 plus margin) | y 260–560 | Nothing readable here; keep faces and key detail out of it too. |
| Overlay words | x 96–940, y 600–1500 | Every number, name, label and lower third. |
| Bottom platform UI | y > 1500 | Pictures only; the small source credit sits at y 1560–1600. |
| Right button column | x > 940 | Pictures only. |

Readable text is at least **26px on screen** (after the camera's scale). Text smaller than that must be
dressing (`data-set`) or the credit (`data-credit`). `bounds.mjs` checks every 0.2s of every frame.

## The frame module contract

A frame is one ES module, `assets/frames/<id>.js` (`<id>` is the basename of the frame's `src` in
STORYBOARD.md):

```js
import * as nk from '../kit/components/index.js'; // optional: ctx.nk is the same module

let shot = null;
let words = null;
export default {
  treatment: 'photo',                      // must equal the storyboard's `- treatment:`
  build(root, ctx) {                       // once: create the DOM
    const doc = root.ownerDocument;
    shot = ctx.nk.photo(doc, { media: ctx.media.V1, focus: [0.48, 0.3], move: 'push', duration: ctx.duration, credit: ctx.media.V1.credit });
    words = ctx.nk.number(doc, { value: '$4M', label: 'then the board met.', at: 1.2 });
    shot.el.append(words.el);
    root.append(shot.el);
  },
  render(t) { shot.render(t); words.render(t); }, // every frame: a pure function of t (seconds)
};
```

`ctx = { id, duration, treatment, timing: { words: [{ text, start, end }], lines: [{ id, start, end, label }] }, media, objects, nk, assets: 'assets/' }`.

- `ctx.timing.words`: the frame's voice, word by word, in frame seconds. Land marks, number reveals and
  lower thirds on the word they belong to (`words.find((w) => /founder/i.test(w.text)).start`).
- `ctx.timing.lines`: each script line's span in the frame's voice, with its label. The storyboard's
  `- labels:` (`L2: … | L3: …`) are the lines' on-screen labels: each lands as its line starts and
  holds while it plays, in the overlay zone. The frame's own `- on_screen:` is not repeated there.
- `- pause_after:` in the storyboard: the frame runs that long past its voice, a silent picture beat
  (`ctx.duration` includes it). Keep the picture alive through it (a drift, a mark landing).
- `ctx.media`: the inventory by asset id: `{ file, kind, width, height, credit, shows, character_image,
  anchor_for, face?, made, made_kind, flags, boxes?, map?, cutout? }`. Use only the assets the storyboard
  frame lists in `- assets:`, and always by `ctx.media.<id>` (pass the entry, or `ctx.media.<id>.file`,
  never a path you type). `face` is the main face's box, 0–1 of the image: keep it in the upper third of
  the frame and out of the caption band. A made asset's flags say how it was made: `seed:<id>` (a seeded
  tool; build it with the kit by that id), `from:<id>` (what it was drawn from).
- `- shows:` in the storyboard: who appears in the frame and as which asset (`Name = V3 (tableau)`).
  `- makes:` the made assets the frame uses and the brief each was made to.
- `ctx.objects`: banked whiteboard drawings (`drawing`, `person-sketch`) by slug.
- Every treatment returns `{ el, render(t), … }`. Append `el` to `root` (or layer one treatment's `el`
  inside another's, as above) and call each `render(t)` from the frame's `render(t)`.
- A frame may import only from `../kit/`.
- Each frame also writes `assets/frames/<id>.events.json`: its sounds (below).

The close is code's: its module is written for you (`frames.mjs`). Never write the close.

## Treatments

Times are frame seconds. `media` is a `ctx.media` entry; `src` a path under `assets/` instead.

### `photo` — a real photo, full screen
`nk.photo(doc, { media | src, width, height, focus, move, dir, amount, at, duration, grade, top, bottom, vignette, grain, blur, credit, parallax })`
- `focus` `[fx, fy]` (0–1 of the image): the detail the narration names; the move goes toward it.
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
`nk.cutoutLift(doc, { cutout, backdrop, backdropWidth, backdropHeight, height, bottom, at, duration, name, role, credit })`
- `cutout`: the person's banked character cutout (`character_image: true`). `backdrop`: a different
  picture, blurred and darkened (default a dark ground).
- The cutout lifts in over `at` (`[0.1, 0.7]`), then a slow push. `name` / `role` add a lower third
  after the lift.

### `collision` — two figures or images brought together for a clash or a comparison
`nk.collision(doc, { left: { src, height, inset, bottom }, right: { … }, center: { src, w, y, light }, at, credit })`
- Two character cutouts (or images) slide in from opposite sides and meet over `at` (`[0.1, 0.8]`);
  the thing between them (a logo, an object) appears as they meet. `light: true` shows a dark one-colour logo
  light on the dark ground.

### `page` — a real page, marked on its words
`nk.page(doc, { media | src, width, height, boxes, marks, fit, x, y, tilt, push, arrive, duration, credit })`
- A screenshot of a real page. `boxes`: the harvest's measured text boxes, `[{ text, x, y, w, h }]` in
  the image's pixels (default `media.boxes`). Never place a mark by eye.
- `marks: [{ box, kind, at, color }]`: `box` is a box's index or (part of) its text; `kind` is
  `circle | underline | highlight | box`; the stroke ends on `at` (the cue word's start). A circle or box
  takes 0.45–0.7s, an underline 0.2–0.45s, a highlight 0.35–0.8s (MD-43: measured onto the words).
- `fit` (1300) is the page's width on screen; `x`, `y` (−40, 640) its top-left; `tilt` (−1.2°).
- `push: { at: [t0, t1], scale }`: a slow push toward the first marked box (default the whole frame, 1.12).
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
the role in Roboto (36px), wiped in at `at`. Default position x 96, y 1300. A `lower_third` frame
renders over the frame's first asset: build that asset as a `photo` and layer the lower third on it
(the module's `treatment` stays `lower_third`). Any frame may also layer one for a line's label.

### `number` — a big stat
`nk.number(doc, { value, label, tone, labelTone, at, countUp, x, y, size })`: the number in Pragmatica
Extended (118px; `tone` `paper` or `orange`), a short line under it (`labelTone` `orange` in Pragmatica
lowercase, or `muted` in Roboto). `countUp` counts it up over 0.7s. Default x 96, y 1130. A `number`
frame renders over the frame's first asset, built as a `photo` (the module's `treatment` stays
`number`); any frame may also layer one for a line's label.

### `board`, `whiteboard`, `newspaper` — the news kit's tools for a moment
`nk.scene(doc, 'board' | 'whiteboard' | 'newspaper', opts)` returns `{ el, cam, stage, front, render }`
(`render(t)` moves the grain; the newspaper page starts at y 600, below the captions). Put items on `stage` with the news kit's components: `clipping`,
`article`, `pullQuote`, `printout`, `notice`, `indexCard`, `evidenceTag`, `polaroid`, `cutout`,
`logoPrint`, `silhouette` (never for a main character: the director's HARD CONSTRAINT 8), `tape`, `stamp`; fasteners `pushPin`, `cord`, `magnet`; marks `inkLayer`,
`markerCircle`, `markerUnderline`, `markerArrow`, `markerCross`, `highlight`, `markerNote`,
`markerDrawing`; the camera `cameraRig(scene).key().push()`, `rackFocus`; `motion.arrive/pin/magnet/swing`.
The rules of those scenes hold: every motion has a physical cause; on the whiteboard everything is drawn
in marker (only the verbatim artifact and printed logos are paper, held by magnets); a pin, magnet,
tape or cord never covers a face or a photo.

### `tableau` — people staged in a place
`nk.tableau(doc, { setting, seats, cast, screen, move, focus, amount, at, duration, credit })`
- `setting`: a seeded setting id (the made asset's flag `seed:<id>`), or a made setting picture
  (`ctx.media.M2`), then with your own `seats`. Seeded settings: `dinner-table` (seats `back-left`,
  `back-right`, `left`, `right`), `boardroom` (`head`, `left-far`, `right-far`, `left-near`, `right-near`;
  wall screen `wall`), `stage` (`podium`, `stage-left`, `stage-right`; screen `main`), `phone-call`
  (`left`, `right`, each clipped to its own panel), `hearing-room` (`panel-left`, `panel-centre`,
  `panel-right`, `witness`).
- `cast: [{ media, seat, h?, dx?, enter? }]`: character cutouts in their seats. The setting's table, desk
  or dais covers each figure's cut edge, and a contact shadow grounds it; every figure gets one grade.
  Seat rivals facing each other (a seat's `facing`) and keep each person on the same side through a
  confrontation. `enter: { at: [t0, t1], from: 'left' | 'right' }` slides a figure in from wholly outside
  the frame; without it the figure is seated from t = 0.
- `seats: [{ id, x, y, h, under? }]`: frame px, `y` is the figure's baseline; adds or overrides seats.
- `screen: { media, on, at? }`: a logo or picture on one of the setting's screens.
- Returns `{ el, stage, figures, seats, render }`: put marks, expression marks and labels on `stage`
  (it moves with the camera).

### `collage` — paper, photo and marker layers
`nk.collage(doc, { ground, layers, move, focus, amount, duration, credit })`
- `ground`: `kraft` (default), `charcoal`, or a picture (`ctx.media.V…`, darkened and softened).
- `layers: [{ media | seed, x, y, w, h?, rot, at, halftone, torn, z, color }]`: photos, cutouts, made
  collage elements and seeded layers (`torn-paper`, `tape`, `scribble-ring`, `halftone`). `halftone`
  prints a photo as newsprint dots, `torn` tears its edges, `at` slaps it on (hidden before), no `at` =
  there from t = 0. Halftone, tearing and tape are treatments of the whole picture; nothing inside a photo
  changes.

### Drawn layers — sketches and expression marks (any treatment)
- `nk.drawn(doc, { media, x, y, w, at, dir })`: a made drawing (an expression sketch, a drawn object)
  revealed as if drawn (`at` `[t0, t1]`; `dir` `down` or `right`); its white paper drops out on a
  whiteboard or paper ground. On the whiteboard it goes on the scene's `stage`.
- `nk.expressionMarks(doc, { kind, face, at, color })`: marker marks of an inner state drawn around a
  face, stroke by stroke from `at`: `worry`, `anger`, `shock`, `thought`, `question`, `idea`, `argue`.
  `face` is the face's box in the coordinates of the layer you append to. Ink (`#15110e`) on a light
  ground; paper-lit `#FEF9F3` or orange on a dark one.

### `close` — the brand close (code's)
The last frame, always 2.5s: the "Reel AI Drama" wordmark, "a Helios series" and the Helios mark on a
dark ground. The comment question is spoken and captioned over it and never makes the reel longer
(MD-13, MD-18); a question voiced past `CLOSE.maxQuestion` (2.3s) is flagged, never stretched. There is no opening sting: the cold open is frame 1.

### Helpers
`nk.grain(doc)` (moving grain), `nk.credit(doc, text, { y, light })` (the small source credit; every
found picture shows its credit), `nk.GRADES`, `nk.tg` (pure helpers: `kenBurns`, `coverFit`,
`markShape`, `findBox`, `countUp`, `SAFE`, `CAPTION_BAND`), `nk.geo` (easing, `seg`, `arrive`, `rng`).

## Motion

- Frame 1 opens on its charged image with the move already running and the hook's words on screen.
- A frame over 8s needs changes inside it (a push reaching its detail, a mark, a number, a lower third,
  a new layer); `try.mjs` warns.
- The frame is moving from t = 0; a later move may start on its cue word. Push in for tension and
  discovery, pull out for context and release; hold the camera on each map stop.
- Marks, numbers and names land on their cue word (`ctx.timing.words`).
- No bounce, no spin, no decorative float; ease-out for the camera, ease-in-out for things placed.

## Sound

Every frame writes `assets/frames/<id>.events.json`: `[{ t, kind, what?, dur?, shown? }]` in frame
seconds. `sound.mjs` resolves each to the library (`assets/sfx-library`) and mixes one track under the
voice; anything under speech is turned down.

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
- **Forbidden kinds in a frame's events:** `whoosh` and `sting` (decorative; `try.mjs` fails them).
  Designed stingers (risers, hits, whooshes, silences) belong to the sound designer's
  `sound_cues.json` alone; when it exists, its stingers and ambience lead and a frame's own ambience is
  dropped.

## Music

The director marks music on the storyboard frame where it changes (`- music:`), and `music.mjs` lays a
tense documentary bed from the HeyGen catalog that follows it (S-74):

| cue | At the frame's start |
|---|---|
| `start` | the bed comes in, or comes back after a drop |
| `change` | the next track takes over (a short crossfade): an act turns |
| `drop` | the music cuts out: a sudden silence before a reveal |
| `end` | the music fades out across the frame |
| `hold` | nothing changes (the default) |

Frame 1 starts the bed unless it says `drop`. The bed always fades out across the close. Change at act
turns, not on every cut. When the sound designer's `sound_cues.json` exists (MD-61), its music cues lead
and these marks are only the brief it was written from.

## Forbidden

- Drawing captions, titles over the caption band, or text in the bottom or right UI zones.
- A picture standing in for something it doesn't show (each asset's `shows` is what it shows).
- Recoloring or distorting a logo or the Helios mark; a fastener or cord on a face.
- Generated images beyond MD-14 and MD-59 (marker drawings, line and expression sketches traced from a
  person's photo, drawn settings and collage elements made for a moment, a fallback object photo when
  stock has nothing clean) and parallax gap-fill plates. Nothing made may look like a photo of a real event.
- A recreated document, post or headline that isn't labelled as one.
- Decorative sounds in a frame's events (`whoosh`, `sting`: designed stingers are the sound designer's)
  and sounds that imply unrecorded events.

## Determinism (checked by `try.mjs`)

`render(t)` must be a pure function of `t`: the same `t` gives the same DOM whatever was drawn before.
No `Date`, `Math.random` (use `nk.geo.rng(seed)`), `requestAnimationFrame`, timers, CSS animations or
transitions, Web Animations, SVG filters (`filter: url(…)`), network URLs, or `visibility: visible`
(set `''` to show). Everything the frame draws comes from `ctx` and the kit.

## What the render is measured on (MD-58)

After the frames are built, code plays every frame in a real browser and measures it every 0.2s. A frame
with any of these is rebuilt; build it right the first time:

| id | What it catches | How to avoid it |
|---|---|---|
| `voice_cut` | the frame ends before its voice | never set your own length: `ctx.duration` is the voice's |
| `empty_frame` | nothing to look at | the frame shows its main image from t = 0 |
| `image_unloaded` | a picture that didn't load | paths only from `ctx.media.<id>` (`.file`), never typed |
| `off_frame` | something parked half off the edge | inside the frame, or full-bleed with `data-bleed` |
| `early_visible` | an element seen before its entrance | an entrance starts wholly outside the frame (from its own box) or hidden until its cue |
| `low_contrast` | text the colour of its ground | dark ink on a whiteboard or paper, paper-lit on dark |
| `text_over_text` | words over a page's, post's or document's own words | labels go in clear space beside the document, never on its text |
| `text_cut_off` | words clipped by their box or the frame | set widths that fit the words; never clip text |
| `under_captions` | readable text in the caption keep-out | words in the overlay zone only |
| `too_small` | readable text under 26px on screen | dressing is `data-set`; real words are ≥ 26px after the camera's scale |

Any words you set over a picture or a page sit on a plate: `nk.plate(el, { tone })` (`dark`, light text
on a dark plate; `light`, ink on a paper plate). The kit's own overlay treatments set theirs.

## The checks

`node assets/kit/try.mjs` (storyboard, sources, events, determinism in a browser) and
`node assets/kit/bounds.mjs` (text cut off, off its paper, under the captions, too small; fasteners on
photos; paper on the whiteboard) run before the render; `assemble.mjs` paces, mounts, places music,
sound and captions, and assembles `index.html`.
