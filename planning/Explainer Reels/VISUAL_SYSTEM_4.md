# Explainers visual system 4.0 (hx-4): build spec and API contract

Approved by Lucas on 2026-10-26 from the 15 direction stills
(`.explainers-local/previews/visual-directions/01…15-*.png`):

> "1–7 GREAT · 8 EVEN GREATER (go with Soft 3D) · 9 I LOVE PREMIUM STAGE · 10 I LOVE GLASS & GLOSS FOR THE
> REAL-TECH FRAMES · 11 … if it's a question between premium stage and this I think Premium stage fits better ·
> 12 I love critter 2.0 · 13 I ABSOLUTELY LOVE the DEPTH & CAMERA LOOK · 14 LIGHT AS MOTION IS AMAZINGGGG ·
> 15 THE MOTION PRINCIPLES ARE GREAT · I love all of it, please build now."

Lucas's brief behind them: the reels must "feel like an amazing animation team put them together"; sizes were
"preposterous"; outfits must be "drawn custom for the reel … the bank is only used if there's an exact match";
scenes made no spatial sense; colors "TOO limited"; the look "way too grainy/paper/handdrawn … we want it to
feel tactile and full of effort, but … PREMIUM and MODERN".

The direction stills and their generator code are the visual reference:
`.explainers-local/previews/visual-directions/` (PNGs, `src/*.html`) and `…/gen/` (the illustrators' scripts:
`a07/lib.mjs` soft-3D volumes and Critter 2.0, `my0615/geo.mjs` + `kit.mjs` metric 3D, palette ramps, light,
motion, `d0911/s09.mjs` premium stage and `s10.mjs` glass UI, `fixes/lib.mjs` outfits, container, magnifier).
Reuse their code freely; it was drawn for exactly this.

## What changes, by approved still

| Still | Becomes |
|---|---|
| 01 True scale | A scale ledger: every world entity has a real size in cm (`SIZES`); one px-per-cm per scene; story exaggeration capped at 1.5×. |
| 02 Props in hand | Held props sized from the critter's real size; tiny things made readable with a magnifier inset, never drawn huge. |
| 03 Drawn for the role | Outfits drawn for the role (`outfit`), garments built for this reel; stock `wear` only on an exact match. |
| 04 One room, one camera | One floor plane, one camera; everything placed in world coordinates and drawn back to front. |
| 05 Correct overlap | Containers: contents clipped to the opening, the frame and shell drawn over them. |
| 06 Wider palette | Sun yellow, royal blue, teal and lilac join paper, ink, orange and green, each a 4-step ramp. Orange stays the hero's. |
| 07/08 Lit paper → Soft 3D (chosen) | Every solid is a soft volume: gradient faces lit from the top right, rounded edges with a bright edge highlight, no ink outline, soft contact shadows and ambient occlusion, gloss on glossy things. No grain, no grid, no line wobble, no stipple. |
| 09 Premium stage | The dark ground: `stage` (charcoal under a warm glow, rim light on everything) replaces `night` and `forest`. |
| 10 Glass & gloss | The real-tech beats (frames 2, 3 and 6, and frame 7 when it shows the real thing) are crisp UI motion: phones, chat bubbles, frosted glass cards, glossy tiles, pills, routes and packets, on the paper studio ground. |
| 12 Critter 2.0 | The soft-3D critter: same footprint, eyes, limbs and face kit; volume gradient, form shadow, bounce, gloss, glossy eyes with two catchlights. |
| 13 Depth & camera | Parallax layers (bg / mid / fg) with depth of field, moving at different speeds in camera moves. |
| 14 Light as motion | Light is animated: wedges of light, rim light, glows, glints sweeping across gloss, light levels. |
| 15 Motion principles | Anticipation, volume-preserving squash and stretch, follow-through, arcs, eased timing, one smear frame on fast moves. World moves ease in-out; titles, UI and camera keep the brand ease-out with no bounce. |

11 (editorial flat color) is not built.

## Grounds

`paper` (default): a warm studio sweep, `#FBFAF6` at the top to `#EFE9DF` low, with a soft floor falloff and a
faint warm key-light bloom top right. No grid, no grain. `stage`: the Helios Premium lit stage, charcoal
`#161616 → #0B0B0B` under a warm orange glow top right, a faint white lift top left and a red bloom low
(`premium.css` values); every outline and critter gets a rim light. `white`: the close only. `night` and
`forest` are gone (a storyboard that says them is a lint error; the kit maps them to `stage` so old projects
still render).

## API contract (names and signatures the builders implement and the prompts document)

Every module stays an ES module importing only from the kit; every draw function returns an SVG string (or the
same shape it returns today) and is a pure function of its arguments and frame time.

### core.js
- `VERSION = 'hx-4'`.
- `TOKENS` keeps every existing key and adds, each with `-lit`, `-shade`, `-dark`:
  `yellow #FDC60F` (lit `#FEDE78`, shade `#ECA811`, dark `#C47910`), `blue #4169E1` (`#4E88F1`, `#3753CB`,
  `#2B329F`), `teal #14B8C4` (`#4ACFD2`, `#009EAE`, `#0A7788`), `lilac #C377E0` (`#D992E9`, `#A662CC`,
  `#7947A6`); `green-lit`, `green-shade`, `green-dark` (derive); stage tokens `stage-top #161616`,
  `stage-bottom #0B0B0B`, `stage-orange #FF6A2A`, `stage-red #E8413B`; `sun-top #FDC60F`, `sun-mid #F48C3F`,
  `sun-bottom #EA3C3A`.
- `GROUNDS = { paper: { fill, dark: false }, stage: { fill, dark: true }, white: { … } }` plus aliases
  `night → stage`, `forest → stage` resolved by `groundOf(name)`.
- `LIGHT = { key: [0.62, -0.78] /* toward the top right */, ambient, bounce }` — the one light direction.
- `CRITTER_CM = 72` (a critter's height, the ruler) and `PX_PER_CM` at scale 1 (critter height in px ÷ 72).
- Drop the boil: `FPS_BOIL`, `boilSeed` and `onTwos` stay exported for old code but `onTwos(t)` returns `t`
  (smooth motion everywhere).

### draw.js (soft 3D; agent RENDER)
- `scope(prefix, ground)` accepts `paper | stage | white` (and the aliases).
- `defs()` → the soft filters (`soft-shadow`, `ao`, `glow`, `blur-bg`, `blur-fg`) and shared gradients; no
  wobble, no grain, no stipple filters.
- `ground(name)` draws the studio sweep or the stage; `grid()` returns `''`.
- `TONES` → for every palette color name (`paper`, `ink`, `orange`, `green`, `yellow`, `blue`, `teal`,
  `lilac`), `{ top, left, right, lit, base, shade, dark }` (keep the old keys the props use).
- `isoBox(P, x, y, z, w, d, h, tones, { radius = 6, gloss = false, outline = false })` → same return shape as
  today, drawn as a soft volume (per-face gradients from LIGHT, a rounded-edge highlight on the lit edges, a
  soft contact shadow / AO where it meets the surface below). `isoDisc` and `cyl` likewise.
- `shadow(cx, cy, rx, ry, opacity)` → a soft blurred contact shadow. `gloss(shapeD, { strength })` a
  specular highlight clipped to a shape. `stippleShade` keeps its signature but draws a smooth gradient.
- `line()` stays (the color for the few line marks that remain: icons, handwriting, ticks).
- `props/kit.js` primitives (`box`, `cbox`, `cyl`, `top`, `face`, `shape`, `mark`, `shade`, `accent`,
  `accentFill`) re-implemented in the soft style with the same signatures, so the 47 library props and the
  asset bank restyle without edits. `shape(d, fill)` becomes a soft-shaded filled shape with no ink stroke.

### cast.js (Critter 2.0 and outfits; agent CAST)
- `critter(x, y, { arms, mood, look, s, flip, body, who, outfit, wear, wearColor, squash })` draws the soft-3D
  critter (study `gen/a07/lib.mjs`): same footprint, ARM_POSES, MOODS, eyes kit and FACE_KEEPOUT, limbs as
  soft tubes, glossy eyes with two catchlights, contact shadow; on `stage` a warm rim light and a cool
  counter-rim. `squash: { sx, sy }` from motion.js scales about the feet.
- **`outfit`** (approved still 03): `{ top: { kind, color, trim, neck, pocket }, sleeves, pants, shoes,
  head: { kind, color }, items: [...], custom }`.
  - `top.kind`: `scrubs | coat | vest | waistcoat | tee | cardigan | apron | jacket | overalls | uniform |
    sweater | dress | hoodie | none`. `neck`: `v | crew | collar | lapel`. `color`/`trim`: palette names.
  - `sleeves`, `pants`, `shoes`: a palette name or `false`.
  - `head.kind`: `scrub-cap | chef | hard-hat | beanie | bandana | headband | crown | none` (never covering
    eyes or mouth; brims never cross the brow keep-out).
  - `items`: named tools of the trade drawn in place: `stethoscope, badge, lanyard, fob-watch, pen, heart-pin,
    bowtie, tie, towel, tray, earpiece, wristband, glasses, glasses-chain, clipboard, name-tag, whistle,
    tool-belt, apron-pocket, scarf`.
  - `custom(ctx)`: a function returning SVG for a one-off garment, given `{ by, fill, tones, keepout }`; it is
    clipped out of FACE_KEEPOUT by the kit.
  - Everything is soft-shaded like the body and stays clear of FACE_KEEPOUT (EX3-103 holds).
- `wear` (the old stock list) still works, for an exact match only.
- `lookKey({ body, outfit, wear, wearColor })` includes the outfit so try.mjs can check looks stay locked.
- `handAt(...)` unchanged; `walk(t)` unchanged; new `heldScale(propCm)` → the scale for a held prop of that
  real size, from `CRITTER_CM`.

### space.js (new; agent SPACE)
- `scene({ ppcm, origin, P })` → `{ at(x, y, z) /* cm → screen */, size(cm), depth(x, y, z) }` on the kit's
  iso projection, so every entity is placed in centimetres on one floor plane.
- `sizes(SIZES)` validates a world's `SIZES` (`{ id: { w, d, h } }` in cm, `exaggerate?` ≤ 1.5) and returns
  `scaleOf(id, drawnPxHeight)` helpers; `scaleProblems(SIZES, drawn)` → error strings for try.mjs (an entity
  drawn more than its allowed exaggeration away from its real size relative to the critter).
- `depthSort(items)` → `items: [{ at: [x, y, z], svg }]` joined back to front.
- `container({ clip, back, contents, front })` → contents clipped to the opening, the frame and shell over them.
- `magnifier({ from: [x, y], at: [cx, cy], r, zoom, draw })` → a lens inset with a zoom cone redrawing
  `draw()` at `zoom` with line weights for its size (still 02).

### light.js (new; agent SPACE)
- `lightWedge({ from: [[x, y], [x, y]], to: [[x, y], [x, y]], level, color })` a soft cast wedge of light.
- `rim(svgShape, { side, color, width })`, `glow(cx, cy, r, { color, level })`,
  `glint(clipD, u, { angle, width })` (a specular band sweeping across a glossy face as u goes 0 → 1),
  `glowSign(text, x, y, { color })`, `level(t, keys)` (a light level over time).

### motion.js and shots.js (agent SPACE)
- `E.world` (ease in-out) and `E.ui` (`cubic-bezier(0.16, 1, 0.3, 1)`, the brand ease-out) join `E`.
- `squash(u, { amount })` → `{ sx, sy }` with sx·sy = 1; `follow(t, stopAt, { amp, freq, damp })` a damped
  swing for follow-through; `arcPath(p0, p1, apexLift, u)` a parabola; `smear(from, to, u)` → `{ stretch,
  angle }` for one smear frame on a move faster than about 4 frames.
- `frame(t, { camera, focus }, parts)`: `parts` may be an array (as today) or `{ bg, mid, fg }`; layers move
  at `bg 0.35×`, `mid 1×`, `fg 1.8×` of the camera's motion and get depth of field (bg and fg blurred unless
  focused). `shotFrame`'s draw callback may return the same layered object. No grid, no boil.

### glass.js and cards.js (agent GLASS)
- `glass.js`: `phone(x, y, { w, h, title, children })`, `chatBubble(text, x, y, { from: 'user'|'ai', maxW })`,
  `glassCard(x, y, w, h, { title, sub, icon, state: 'picked'|'idle'|'plain', accent })`,
  `glossTile(x, y, size, { icon, color })`, `pill(text, x, y, { dot, color })`,
  `route(points, { color, progress, glow, dashed })`, `packet(points, u, { color })`, `uiIcon(name, x, y,
  size, { color })` (an inline Lucide subset, no CDN), `glassGround()` (the soft studio light for these
  frames). Text inside them goes through the same measuring as `textBox` so `bounds.mjs` can check it.
- `cards.js`: `titleCard`, `dictionaryCard`, `textBox` restyled to glass and gloss (same signatures, same
  timing, same data attributes the try and bounds checks read).

### Checks and prompts (agent PROMPTS)
- `frame.md` and `FRAME.md` → `helios-explainer-v11`: the look, palette, grounds, space and scale, outfits,
  containers and magnifiers, light, depth and camera, motion principles, and the glass mode for the real-tech
  beats, with every old rule that contradicts them removed (V-3 paper and ink, V-15 the hand and on twos, V-17's
  "no gradients and glow, no rendered 3D", the grain and grid, `night` and `forest`).
- `scene-builder.md`: `world.js` also exports `SIZES` (cm per entity), places entities with `space.js`, builds
  containers, draws outfits; `CAST` is `{ body, outfit }`.
- Story design, the skeleton and SKILL.md: each anchor entity line carries its real size (`size: 26 cm`); a
  critter's `look:` line is `look: <orange|ink|paper>, outfit <the role's outfit>`.
- `lint-storyboard.mjs`: grounds `paper | stage | white`; entity `size:`; `look:` with `outfit`.
- `try.mjs`: ground names; CAST with outfit; the scale ledger (`scaleProblems`); outfits clear of the face.

## Register
EX3-134 to EX3-146, one per row of the table above plus the grounds and the checks (written when the build is
verified).

## Verification
Offline only: unit tests per module; a kit gallery render (every primitive, the critter in every outfit and
mood, both grounds, the glass components) checked by eye against the stills; the smoke fixture
(`npm run explainers:smoke`) rendered and checked; then one live test render on Lucas's go-ahead.
