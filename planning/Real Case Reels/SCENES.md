# AI News Explained — the three scenes: look, motion and sound

Decisions: RC-39 to RC-46. This is the spec the format's `frame.md` frame treatments and the news kit
implement (N4c). Reference stills: `.explainers-local/previews/ai-news-truecrime/`; motion tests:
`.explainers-local/previews/ai-news-truecrime/motion/`.

## The rule for every motion and every sound

1. **Every motion has a physical cause.** Something is placed, pinned, slapped down, drawn, turned or
   wiped, by an unseen hand. Nothing floats, fades in from nowhere, or bounces for decoration.
2. **Every sound is that action's own sound, on its contact frame.** A marker squeaks only while its tip
   is moving; a magnet clacks on the frame it lands; a page lands with the page. A continuous action (a
   stroke, a wipe) gets a sustained sound cut to the action's exact length. No decorative whooshes, no
   risers, no stingers except the sting.
3. **Writing and drawing happen at hand speed, on the voice.** A circle closes in 0.45–0.7s and finishes
   on the word it marks; handwriting runs about 10 letters a second, stroke by stroke in writing order;
   an arrow draws tail to head, then the head as two quick flicks.
4. **Anticipation and settle.** An item lifts 2–4% before it lands, lands with a 1–3px settle, never an
   elastic bounce. Paper flexes a little; magnets and pins do not.
5. **The camera is motivated.** It follows the marker tip, rides the cord or the arrow to the next item,
   or pushes into what the voice names. Cuts land on the voice's cue words.
6. **Sound sits under the voice.** Contact sounds stay crisp; sustained ones duck under speech.

## The bulletin board (`board`)

| Action | Motion | Sound (library) |
|---|---|---|
| Clipping arrives | Slapped onto the cork from just off frame, 0.25s, flexes and settles | `paper-drop` on contact |
| Pin goes in | Pin presses in over 2 frames; the paper dimples | `pushpin` on the press |
| Cord stretched | Unspools from the first pin along its path to the next, pulled taut over 0.4–0.6s, a slight sag after | a taut-string pluck *(gap: no string sound yet)* |
| Tape | Strip laid over a corner, pressed | `tape` |
| Polaroid / cutout | Placed and pinned like a clipping | `paper-drop`, then `pushpin` |
| Typed tag | Hung on a pin, swings once and settles | `paper-flutter` (short) |
| Marker circle | Drawn as on the newspaper | `marker-write` cut to the stroke |
| Camera | Rides the cord from item to item; rack focus to the next item | none |

## The newspaper (`newspaper`)

| Action | Motion | Sound (library) |
|---|---|---|
| Page arrives | Dropped flat onto a desk from 6–8% above, a quick air-push ripple, settles | `paper-drop` (the newspaper set) on contact |
| Marker uncapped | Once, before the first markup of the scene | `marker-cap` (off) |
| Circle | Drawn around the word as the voice reaches it, closing on the word | `marker-write` cut to the stroke (felt tip on newsprint) |
| Underline | One quick stroke under the line the voice reads | short `marker-write` |
| Arrow | Tail to head from one marked item to the next, then two flicks for the head | `marker-write` for the shaft, two short strokes for the head |
| Highlight | A wide translucent pass over a quote | a soft, longer `marker-write` |
| Next story | Page turns, or slides away to reveal the page beneath | `page-turn` / `paper-slide` |
| Camera | Pushes into the article the voice names; slides along the page to the next one | light `paper-rustle` only if the page itself moves |

## The whiteboard (`whiteboard`)

The board is a real one in a room: aluminum frame, gray corner caps, a tray with markers and an eraser,
a window reflection on the melamine, faint ghosting of old notes. **Everything on it is drawn in marker
(RC-48)**: people as simple line sketches from their banked photo, objects as simple line drawings, notes
in **dry-erase marker** (Gochi Hand through a streak filter: slightly translucent, chisel-streaked), blue,
red or black, all drawn stroke by stroke on screen. **Magnets are rare (RC-49):** only the verbatim
artifact being explained and printed company logos are paper, held by **flat matte magnets** on their
margin, never pins.

| Action | Motion | Sound (library) |
|---|---|---|
| Drawing (person / object) | Drawn stroke by stroke in drawing order, ~3–5s, the camera following the tip | `marker-write` (whiteboard squeak) cut to each stroke |
| Artifact / logo placed (rare) | Slid onto the board, held flat; the magnet is slapped on top and the item settles 1px | a magnet clack on contact *(gap: nearest today is `metalClick`)* |
| Marker uncapped | Once, before the scene's first stroke | `marker-cap` (whiteboard) |
| Writing | Stroke by stroke in writing order at hand speed | `marker-write` (whiteboard squeak) cut to each word's writing time |
| Arrow | Tail to head, then two flicks | squeak for the shaft, two short squeaks |
| Cross-out | Two fast diagonal strokes | two short squeaks |
| Erase | The eraser wipes a region; ghosting stays | `eraser` (sustained) cut to the wipe |
| Marker capped | At the end of the scene | `pen-cap` click |
| Camera | Follows the marker tip while it writes; pushes into the cause | none |

## Library gaps

The shared library (`explainers/design/sfx`, CC0) has the paper, marker, cap, pin, tape, eraser and
page sounds. It has no **magnet clack** and no **cord pulled taut**. Two to four CC0 cuts of each would
be imported with the library's own Freesound tools when the kit is built (asked first).
