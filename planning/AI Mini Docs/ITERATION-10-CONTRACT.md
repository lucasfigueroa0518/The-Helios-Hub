# Iteration 10: the build contract

Everything more than one owner touches. The plan is `ITERATION-10.md`; the acceptance ledger is `test-runs/iter9-final-renders/VISUAL-AUDIT.md` (158 findings, each tagged P, L, C, D, B or K). A name here is binding. If a name must change, say so in your final report.

## Ground rules for every owner
- No live Claude API, `web_search`, or paid vendor call of any kind. No live reel. Tests are offline.
- No commits. Don't edit `lib/explainers/**` or `explainers/world-kit/**`, or start or stop servers or workers.
- Change only the files you own (§7). If you need a change elsewhere, name it in your final report.
- Don't edit prompts or `kit/FRAME.md`. Claude writes those last, from your report.
- Code decides geometry from measurements. Never add a hand-tuned number for one story, person or picture. Nothing here may name a real reel's content.
- Render stays a pure function of `t`: same input, same picture (`kit/try.mjs` checks this).
- Never block a reel. A rule that can't be met degrades and reports; it doesn't throw.
- Match the surrounding code. Tests: `npx tsx --test tests/reel-ai-drama*.test.ts 2>&1 | grep -E "^ℹ (tests|pass|fail)|^✖"`. Types: `npx tsc --noEmit -p . 2>&1 | grep -E "reel-ai-drama"`.

## 1. Picture record (P writes; everyone reads)
Added to `PictureRegions` in `lib/reel-ai-drama/types.ts`, measured at harvest, free and local, once per asset. Every field is optional, so old inventories still load.

| Field | Meaning |
|---|---|
| `faces[i].score` | Detector confidence, 0–1 |
| `faces[i].trusted` | Confident, plausible as a head for this picture, and consistent with the person when named. Only a trusted face may be a head. |
| `cut` | `{ grade: 'clean' \| 'rough' \| 'rejected', edge_softness, islands, straight_cuts, sharpness }`, each measure 0–1 |
| `open_edges` | `{ left, right, top, bottom }`, booleans: the cutout's picture stops at that image border |
| `sharp_width_px` | The widest it may be drawn on the 1080-wide frame and stay sharp |
| `phash` | Perceptual hash, hex string |
| `dup_of` | Asset id of the near-identical picture this one repeats, or null |
| `brightness` | Mean luminance, 0–1 |
| `expression` | Short plain words from the look step already paid for, or null |

Also from P:
- Cutout clean-up removes stray islands and old-background fringe, and tightens the edge. A person's cut keeps the person and drops what's beside them where measured.
- A `rejected` cut is never offered as a cutout: `inventoryForDirecting` leaves it out as a cutout and the stage shows that picture as a print.
- `npx tsx scripts/reel-ai-drama-remeasure.ts <projectDir>` re-measures an existing project's inventory in place, for the free replay.

## 2. The stage is the only way onto the screen (L owns)
Every frame compiles to one `nk.stage(doc, spec)` call. Existing options stay. New ones:

```
spec.pieces[i] may also be:
  { id, treatment: 'page'|'post'|'document'|'headline'|'newspaper'|'map'|'photo'|'number'|'stat'|'board'|'lift'|'lower_third', media?, opts, at, until }
      an existing component (K keeps its signature) drawn in the box the solver assigns. opts holds its non-geometry options.
  { id, media, fill: true, at }   the picture fills the frame, with its keep protected
  { id, media, onto: { piece: <id>, box: <name in that picture's boxes> }, at }   placed on a named spot in another picture
  { id, custom: { file, aspect, min_width }, at, until }   a custom piece (§5) in a box the solver assigns
  { id, note, role: 'figure'|'place'|'date'|'body', at }   a board note; the role sets its size
  { id, crop: {x,y,w,h}, ... }    existing crop, on any picture piece
spec.hook = { text, at }          the large hook words, in a protected band, visible by 1.2s
spec.speech = [{ on, text, at, until }]   plates, solved like everything else
spec.camera = { move: 'hold'|'push'|'drift'|'slide'|'tour', stops: [{ at, aim: 'whole'|<piece id>|'face:<name>'|'text:<words>', zoom? }] }
      replaces move/focus/amount/dir. Aims are measured. 'slide' is one limited move.
spec.peak = true                  this frame may not use 'slide'
spec.ground_tone = [{ at, to }]   the ground brightens or darkens to `to` (0–1), eased
spec.in_turn = [{ ids: [...], from, to }]   spaces those pieces' arrivals evenly between two times
spec.arrows = [{ from, to, at }]  computed between the two real items, with a minimum length; layout makes room
spec.arrangement also: 'facing' | 'turned_away' | 'leads_to' | 'solo'
```

Marks stay `{ kind, on, at, from, target }`, with `target: 'text:<words>'` or `'face:<name>'`.

`stage()` also returns `manifest()`, a plain list for the plan check: `{ pieces: [{ id, asset, at, until, side, box_at_rest }], labels: [{ text, owner, at, until }], marks: [{ kind, on, target, at }], camera: { move, stops } }`, with resolved times.

### New guarantees (added to the random-layout property test)
Beyond I1–I6:
- **I7** An open edge is off-frame or behind another piece. Bodies run off the bottom; none dissolves in mid-air (`mask-image` fade goes).
- **I8** Pieces hold their final spots from arrival. Layout plans the final moment first; nothing reshuffles at an arrival. The camera reveals. One `slide` is the sole exception, plus one small automatic slide (`auto`) that code may add away from a peak, when a piece has to make room for the next arrival.
- **I9** A camera `aim` and every marked phrase stay inside the frame at every point in a move.
- **I10** A wide picture that can't fill the frame without cutting its keep becomes a print.
- **I11** A background picture's keep counts as a keep.
- **I12** Words inside a picture stay clear of the caption band.
- **I13** A head has a maximum as well as a minimum size. People in one frame stay within a set ratio, except in `lead_inset`.
- **I14** The usable area is filled: no small piece on a void. Plain black is never a ground.
- **I15** Nothing is drawn wider than `sharp_width_px`.
- **I16** Only `trusted` faces are heads, and `biggest(faces)` goes.
- **I17** Labels: lifetime is code's. A label leaves after a beat or when the next person arrives. Only a first appearance gets a name. Names sit in clear space beside the owner or at the body's outer edge, never on the chest or tie. Dates and places take a free band, never a person.
- **I18** Marks clear hair and plates. Plates never sit on a head, face or chin, and stay inside the frame.
- **I19** One credit per picture on screen, never stacked or lost on a body. A picture isn't repeated within a stage.
- **I20** People in a frame are matched in tone, with one outline weight and no glow.

## 3. Component fixes (K owns; signatures stay)
- **Lift:** no ghost head (the original spot gets covered) and no dimming of the frame.
- **Captions:** one bright colour throughout (`presets/reel-ai-drama/caption-skin.html`).
- **Cards and prints:** a page is never keyed to bare text, and plates fit their words.
- **Handwriting:** a face that keeps every letter clear. OFL only, with the file and source named in the report.
- **Backdrops:** blur and darkening stop short of erasing the place.
- **Black-and-white pictures:** matched to the frame's other pictures. Expose `matchTone(media, others)` for the stage.
- **Whiteboard:** remove the fixed stains, draw logos cleanly with no smudgy hatch, and let the first item draw in, except in frame 1.

## 4. The plan: `StoryboardFrame.blueprint` (C owns the types; D owns the checks)
`motion`, `marks` and `sound` go away. Times are always the exact spoken words, never seconds.

```ts
type Words = string; // exact words in this frame's voice; '' means the frame's start
type Blueprint = {
  ground: 'charcoal' | 'kraft' | 'whiteboard' | string /* asset id */;
  style: 'cutouts' | 'paper';
  arrangement: 'face_off' | 'lead_inset' | 'row' | 'pile' | 'facing' | 'turned_away' | 'leads_to' | 'solo';
  hook?: { text: string; on: Words };
  peak?: boolean;
  pieces: {
    id: string; asset?: string; treatment?: string; opts?: object; fill?: boolean; note?: string;
    note_role?: 'figure' | 'place' | 'date' | 'body'; role?: 'lead'; side?: 'left' | 'right'; belongs?: string;
    onto?: { piece: string; box: string }; crop?: { x: number; y: number; w: number; h: number };
    on: Words; until?: Words; label?: string;
  }[];
  labels: { text: string; sub?: string; kind?: string; for?: string; on: Words }[];
  speech: { on_piece: string; text: string; on: Words; until?: Words }[];
  marks: { kind: string; on_piece: string; target?: string; from?: string; on: Words }[];
  arrows: { from: string; to: string; on: Words }[];
  camera: { move: 'hold' | 'push' | 'drift' | 'slide' | 'tour'; stops: { on: Words; aim: string; zoom?: number }[] };
  ground_tone?: { on: Words; to: number }[];
  sounds: { kind: string; what: string; on: Words; dur?: number }[];
};
```

## 5. Compile, touches, custom pieces (C owns)
**Compile.** `lib/reel-ai-drama/render/compile.ts` exports `compileReel({ plan, inventory, projectDir, touches })`. It writes `assets/frames/<id>.js` and `<id>.events.json` for every frame but the close, in the formats `assemble.mjs` and `frames.mjs` already read. Each module holds no logic:

```js
import { compiledFrame } from '../kit/components/compiled.js';
export default compiledFrame({ /* the blueprint plus accepted touches, as JSON */ });
```

`kit/components/compiled.js` resolves `Words` through `ctx.nk.cueAt`, `asset` through `ctx.media`, and line labels through `nk.lineLabel`, then calls `nk.stage`. A word that can't be found falls back to the line's start and reports. Sounds also land on words; arrivals keep the stage's own kit cues.

**Touches.** `assets/touches.json`, from the creative pass:

```ts
type Touches = { touches: Touch[]; custom: CustomPiece[] };
type Touch = { id: string; frame: number; why: string } & (
  | { type: 'extra_line'; text: string; for?: string; on: Words }
  | { type: 'in_turn'; piece_ids: string[]; from: Words; to: Words }
  | { type: 'closer_cuts'; aim: string; on: Words[] }
  | { type: 'mark'; kind: string; on_piece: string; target?: string; on: Words }
  | { type: 'ground_tone'; on: Words; to: number }
  | { type: 'sound'; kind: string; what: string; on: Words; dur?: number }
);
type CustomPiece = { id: string; frame: number; why: string; aspect: number; min_width: number; on: Words; until?: Words; code: string };
```

Limits, enforced in code: at most 3 touches and 2 custom pieces a reel, at most one of either per frame, none required. Touches only add, and can't name a planned piece's position, size or removal.

**A custom piece** is written to `assets/custom/<id>.js`:

```js
export default { build(el, ctx) {}, render(t) {} }; // el is its box; t is frame seconds
```

It may import only from `../kit/`. It may use no network, timers, randomness or `Date`, and can only touch `el`. A static check and `try.mjs` determinism reject it otherwise.

**Creative pass.** `lib/reel-ai-drama/production/creative.ts` exports `creativePass({ draft, plan, projectDir }, ctx)`. One `messages.create` on the existing writing client, on Sonnet 5.5, with cached prompt, `submit_touches` tool and images: one still per compiled frame, at its main beat, taken free with the kit's existing browser. The stable prompt and schema carry the cache breakpoint, per `lib/anthropic-cache.ts`. Prompt: `explainers/reel-ai-drama/prompts/creative-pass.md`, added to `PromptName`. It fails open: an error means no touches and a flag.

**Removal.** Each touch is compiled and measured against its frame's clean baseline. Any new layout, breakage or plan-check finding removes that touch, leaves the compiled frame, and flags it on delivery.

## 6. Checks and pipeline (C owns run.ts; D owns validate.ts)
**Plan check on render.** `checkPlanCarried(plan, manifests)` compares each frame's manifest with its blueprint: every piece, label, mark, arrow and camera stop on its word. A miss triggers one recompile with a new layout seed, then a flag.

**New run order in `runJob`.** The build session is gone:

`… integrity → sound design → compileReel → assemble/measure → creativePass → apply touches (removal rule) → render → first viewer ‖ design review → one director re-plan of the named frames → recompile → re-render → deliver`

- `build-workflow`, `frame-worker`, `fix` prompts and `fixSession` are removed from the run. Breakage repair is a recompile with a new seed, then a flag.
- A picture finding from the first viewer or design review goes to the director's existing `fix` mode, for those frames only, once.
- The integrity check gets each frame's shot map, and its wrong-picture findings go back to the director once before compile.

**Plan checks (D, in `validate.ts`; one fix round, then a flag):**
- One picture of a person appears at most three times a reel, never in adjacent frames, counting `dup_of` and cutouts. `repeatedPictures` exemptions go.
- Consecutive frames can't reuse the same cast in the same arrangement.
- Every person, company and product a line names gets a beat with a real picture or logo. Cast logos come from harvest.
- A line that names a place gets that place, as a picture or a built scene.
- Every `asset` exists. A planned drawing that doesn't exist becomes a `makes` entry before compile.
- Every `Words` occurs in the frame's voice.
- A failed search is never silently replaced by an unrelated stand-in: decision 4 in `ITERATION-10.md`.
- Picture choice can read `expression` and `brightness` (`inventoryForDirecting` shows them).

## 7. Owners
| Owner | Files | Ledger |
|---|---|---|
| **P** (wave 1) | `lib/reel-ai-drama/harvest/{regions,faces,cutouts,transparent,look,pipeline,live}.ts`, `PictureRegions` in `types.ts`, `scripts/reel-ai-drama-remeasure.ts`, new `tests/reel-ai-drama-pictures*.test.ts` | [P] |
| **L** (wave 1) | `kit/stage-layout.js`, `kit/components/{stage,anchor,camera}.js`, `kit/screen.mjs`, `kit/geometry.js`, `kit/treatment-geometry.js`, `tests/reel-ai-drama-stage*.test.ts`, `tests/fixtures/reel-ai-drama-stage-pictures.json` | [L], and [B] on size, arrangement, arrows, collisions and filling the board |
| **K** (wave 1) | `kit/components/{marks,moves,scenes,lift,evidence,stat,style,treatments,fasteners,dom}.js`, `kit/settings/**`, `kit/fonts/**`, `kit/textures/**`, `presets/reel-ai-drama/**`, new `tests/reel-ai-drama-kit-fixes*.test.ts` | [K], and [B] on drawing cleanly, stains, handwriting and first draw-in |
| **C** (wave 2) | `render/compile.ts`, `kit/components/compiled.js`, `production/{creative,run,agents}.ts`, `writing/schemas.ts`, blueprint types in `types.ts`, `kit/components/index.js`, `render/workspace.ts`, `scripts/reel-ai-drama-replay.ts`, new tests | [C] |
| **D** (wave 2) | `writing/{validate,director,review-doc}.ts`, `lib/reel-ai-drama/checks/**`, new tests | [D] |
| **Claude** (wave 3) | Every prompt, `kit/FRAME.md`, the replay audit and the ledger | Remaining |

All `kit/` paths are under `explainers/reel-ai-drama/`.

## 7b. Additions from wave 1 (binding for wave 2)
**From L (stage):**
- `custom.module`: compile must import `assets/custom/<id>.js` and pass the module, or pass `spec.customModules[file]`. Without it, the box stays empty and `custom_failed` is reported.
- `spec.known_names`: names already introduced in earlier frames. Needed for "only a first appearance gets a name", so compile must pass it.
- `spec.mediaIndex`: lets a rejected cut show its source photo. Compile must pass it.
- `manifest()` also returns `arrows`, `speech` and `hook`. Arrows also appear in `marks` with kind `arrow`.
- `document.__stageNotes` carries notes such as `fill_print`, `aim_missing` and `slide_on_peak`. `document.__stageReports` carries tight reports.
- A note's role is accepted as `role` or `note_role`.
- `kit/screen.mjs` has `measureStage` with `[head_size] [over_sharp] [open_edge] [plate_on_head] [plate_off_frame] [label_on_body] [credits_stacked] [void]`.

**From K (components):**
- Optional `box: { w, h }` on page, document, post and lift draws inside the box.
- C adds to `kit/components/index.js`: `export { matchTone, isMono, isPage, BACKDROP } from './style.js';`

**From P (pictures):**
- C calls `measurePictures(inventory, harvestDir)` after harvest and again after the cut and wish steps, before directing. The replay runs remeasure with `force`.
- D: `inventoryForDirecting` shows `cut.grade`, `dup_of`, `brightness`, `expression`, `sharp_width_px`, `open_edges` and the trusted-face count; leaves out rejected cuts as cutouts; never sends the `shape` or `tone` grids.
- Flag `garbled:cut_rejected` marks a rejected cut. `isRejectedCut` and `cutSource` are in `harvest/cutouts.ts`.

`Blueprint` is already in `lib/reel-ai-drama/types.ts`, with `StoryboardFrame.blueprint`. C removes `motion`, `marks` and `sound` and owns later changes to it.

## 8. Done
An owner is done when every ledger finding in its tag is fixed by code and covered by a test or check, or named in its report as not fixed and why. Its tests and types must pass. Final report: at most 25 lines, listing what changed, any contract change, findings not fixed, and what Claude must say in `FRAME.md` or a prompt.
