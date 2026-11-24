# Visual system 6 (hx-6): prod's system, a new analogy, critter D and the new palette

Decided with Lucas on 16 Nov 2026, after the first real hx-5 reel (decisions D106–D120, EX6 in
`DECISIONS.md`). The base is **prod (main)**: what each frame shows and how stays exactly as it is.
This file is the CONTRACT for the parts that change. A file that disagrees with it is wrong.

## 1. Scope
| Part | Source |
|---|---|
| Director logic, story, beats, script, opener, hand-off, dictionary, close, real-example and mechanism staging, Soft 3D finish, stage ground, glass components, motion (parallax, smear, breathing), shots, craft | **main, unchanged** |
| Palette values | **new** (§2), on main's token names |
| The critter's drawing, everywhere a critter appears | **critter D** behind main's critter API (§3) |
| Critter roles (head piece + hand prop, put-down rule), everywhere a critter appears | **new** (§4) |
| Analogy frames (`look: world` frames that stage the analogy): room, finish, drawn things, ground, labels, dark beats | **new** (§5) |
| Grain or noise on any frame | **none** |

Out of scope: Real Case, the opener and hand-off designs (only their critter changes, through §3).

## 2. Palette (`core.js` TOKENS: names stay, values change)
Main's code keeps calling its token names; their values move to the approved palette. New names are added.

| Main name | New value (base, lit, shade, dark) | Role |
|---|---|---|
| ink | #171717, #2B2926, #101010, #0A0A0A | line, text, ink critters |
| paper | #F3F0EA, #FBFAF6, #E2DACB, #CFC5B3 | paper ground |
| orange | unchanged | the hero only |
| green | unchanged | Helios green |
| blue → slate | #6684B0, #86A1C8, #4F6B94, #34496A | systems |
| yellow → mustard | #E0AB3E, #F3C65E, #C38F29, #8F6418 | data and key objects |
| teal | #46978F, #5DB5AE, #357A74, #24534F | the payoff |
| red | #B4473A, #D27665, #91372D, #5F231C | small accents |
| lilac | the slate values | (retired hue; kept so old code draws) |
| stage-top / stage-bottom / night | unchanged (prod's dark stage) | non-analogy dark beats |

Added: `slate-*`, `mustard-*` (same values as blue/yellow), `wood-*` (#9A7250, #B48A62, #7E5B3E,
#5E432D), `leaf-*` (#5F8F48, #7FAE62, #4A7438, #355428), `wall` #F1E9DA, `wainscot` #E4D8C3, `trim`
#CDBFA6, `floor` #E2DACB, `board` #D3C9B6, `window` #BFD3EC, `white` #FFFFFF. Status, sun and
shadow-warm tokens unchanged.

## 3. Critter D behind main's critter API (`cast.js`)
- `critter(x, y, opts)` and everything that calls it (`act`, `actAt`, `walk`, `RIG`, `solveArms`,
  `heldProp`, `GESTURES`, `blendRig`, openers, hand-off) keep their signatures and behaviour; only the
  drawing is critter D (`explainers/world-kit/reference/critter-d/critter_d.py`, variant d, plain
  pupils; port from commit `1c7813d` cast.js `critterTile`, byte-identical to the reference SVGs).
- Body: `orange` (hero), `green`, `ink`, `white` (main's `paper` body draws as `white`).
- Mood: main's MOODS names map to D's ten moods (nearest lids/pupils/tilt); `mouth` and `brows` are
  accepted and ignored. Arms: main's rig solves arm angles; D draws its ink stub arms with mitten ends
  at the solved angles.
- Views: `front` is D; `back` is D's tile with no eyes (body, arms, legs). `side` stays flip.
- Outfits and main's `WEAR`: accepted and translated to a role (§4) when one matches, else bare. No
  garment is ever drawn on the body.
- Shadow: main's existing contact/floor shadow, unchanged.
- Motion: main's motion for everything; critter D's idle and mood loops (blink, glance, lid switch)
  are snaps per the approved motion sheet (HOLD 1–2.5 s, SNAP 0.14–0.2 s, overshoot
  cubic-bezier(.34,1.32,.55,1), amplitude 0.82). Nothing else in main's motion changes.

## 4. Roles (`wear.js`, from `1c7813d`)
- HEADS, HANDS, ROLES (17), GRIP/FRONT layering, `wearProblems`: as in `1c7813d`. Standards R1–R7
  live in house-style § Critter roles.
- A critter takes `role` (or head/hand) in any frame. A hand prop is held only while the beat does not
  need the critter's hands; the storyboard plans a put-down beat first (lint `put_down`).
- The wear vision check (job.ts `runWearCheck`, bare fallback) and lint `critter_look` are ported.

## 5. The analogy frame
Applies only to frames that stage the analogy (the anchor scene's world frames).
- **Room:** front-on (`set.js` `frontRoom`, `frontCamera`; vanishing point centred, back wall,
  wainscot, skirting, perspective floor), the cast on the floor in front of the wall.
- **Finish:** flat tones (lit top, mid front, darker side); no gloss, rim, glow or gradient.
- **Ground:** the new ground name `room` (`core.js` GROUNDS, painted by `draw.js` `ground()`):
  clean paper #F3F0EA with the faint drafting grid (72 px, ink at 4.5%); **no grain**. Lint accepts
  `ground: room`; the director gives it to analogy frames. Main's `paper`, `stage`, `white` stay.
- **Drawn things:** animals and organic props come from the drawn library (`drawn.js`, `subjects/`),
  flat. Outside the analogy, main's objects and animals stay.
- **Labels:** Helios pills (white names, ink contrast, green status).
- **Colour:** colour with purpose; walls, floors, big furniture keep room tones; teal and red never
  large; in the analogy, orange is the hero's and at most one more thing's (outside it, main's
  orange guidance).
- **Dark beat:** the dusk room (slate walls, lamps lit, windows dark). Outside the analogy, prod's
  dark stage.

## 6. Checks
- Kept from main: every check, unchanged.
- Added: wear check (vision, bare fallback), lint `critter_look` and `put_down`, try.mjs `wear`.
- try.mjs `orange` (the hero + at most one more orange thing) runs ONLY on analogy frames (frames
  whose `ground:` is `room`). Everywhere else main's orange guidance and checks apply unchanged.
- A test pins that no ground draws grain (`feTurbulence` absent from every ground).
