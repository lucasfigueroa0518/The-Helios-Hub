# Build prompt: AI News Explained — the look, the render engine, and the first reel (N4c → N6)

You are picking up a half-built system in The Helios Hub repo
(`/Users/lucasfigueroa/HELIOS/CODE/The-Helios-Hub`, branch `reels-iterations`). Lucas (the owner) has
signed off on the format, the story pipeline, the prompts' direction, the look (stills), the motion and
sound spec, and the cutout bank. What's left is to **build the render side for the new look** and get
**one real reel** out. Work milestone by milestone, meet each milestone's Accept line before moving on,
and report at each boundary.

Read this whole file first. Then read, in this order:

1. `CLAUDE.md` (repo rules; they bind you).
2. `planning/Real Case Reels/FORMAT.md` (what the reel is).
3. `planning/Real Case Reels/DECISIONS.md` (RC-01 … RC-46; later entries override earlier ones, and
   entries marked *Superseded* are history only).
4. `planning/Real Case Reels/SCENES.md` (the three scenes: look, motion, sound — the spec you implement).
5. `planning/Real Case Reels/BUILD_PLAN.md` (N1–N6; N1–N3 are built).
6. The reference stills and motion tests (see "Reference material" below). Open the PNGs and play the
   MP4s with sound before writing any kit code.

---

## 1. What this is (in one paragraph)

**AI News Explained** is a one-minute, 9:16 reel that tells one recent (≤ 90 days), true AI news story
as a story and, inside it, reveals the AI/software concept that explains why it happened. It sits beside
the existing **Explainer Reels** (analogy-led, paper world, critters), and must look, feel and sound
nothing like them. It is styled as a **true-crime documentary** told across **three scenes**: a cork
**bulletin board** (push pins, red cord), a **whiteboard** in a room (flat magnets, dry-erase marker), and
a **newspaper** page (marker markups). Real logos and real photo cutouts of blue-chip people are used;
common objects are stock-photo cutouts; one item gets the viewer's attention per shot; information is
never shown as words on tiles or cards. Narrator: the Lucas Figueroa HeyGen voice.

---

## 2. Hard rules (non-negotiable)

- **Never edit Explainer Reels.** No changes to anything under `lib/explainers/`, or under `explainers/`
  outside `explainers/real-case/`. Another session is actively changing Explainer files. You may
  **import** from them and **copy** them into `explainers/real-case/`. Change Explainer behavior only
  through seams: a wrapped `query` (see `lib/real-case/render/agents.ts`), `deps.repairAssembly`, your own
  files laid into the job's workspace. `npx tsx --test tests/explainers*.test.ts` must pass unchanged.
- **Spend (CLAUDE.md Rule 1).** Automated tests never call the live Claude API, web search, HeyGen or
  Jev; stub them. Never start a live news search or a render yourself. Before anything that could cost
  more than ~$1.50, stop and ask Lucas with an estimate. A render costs about $6–8 (per-reel cap $8 in
  `real_case.settings`). Live runs must unset the IDE's own `ANTHROPIC_*` variables
  (`env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL …`), or `.env.local`'s keys
  are overridden (this cost a failed run before).
- **Prompt caching (CLAUDE.md).** Any new or changed `messages.create` puts the stable prefix first and
  carries `cache_control` (`lib/anthropic-cache.ts`).
- **Local only.** No commits to `main`, no deploys, no Supabase apply. Work on `reels-iterations`; commit
  only when Lucas says. The local Postgres for this route is `EXPLAINERS_DATABASE_URL` (127.0.0.1:54329,
  `npm run explainers:db`); tests use PGlite (`tests/explainers-pglite.ts`).
- **Read-only DB checks** against Supabase go through one read-only transaction
  (`BEGIN READ ONLY; … ROLLBACK;`), never a session `SET`.
- **Prompt edits** (any text a model reads): no contradictions with the rest of the prompt, no example
  pollution (never name a real event, company or person as an example; the fixtures use the fictional
  "Harbor City Transit"), the right level of abstraction, and rules written as HARD CONSTRAINTS, never
  as optional advice. Regenerate `planning/Real Case Reels/prompts-for-review.md` after any prompt change
  and show Lucas the diff before a live run.
- **Facts.** Every fact in a reel comes from the story's verified claims; artifacts (posts, statements,
  headlines) are shown word for word; no attribution phrasing; private individuals are never named or
  shown. Newspaper body text on screen is either the verified facts or illegible filler lines — never
  invented sentences.

---

## 3. What already exists (do not rebuild)

**Story side (N1–N3, built, 46 offline tests green: `npx tsx --test tests/real-case*.test.ts`).**

| Piece | Where |
|---|---|
| Schema (`real_case.*`: stories with `event_date`, `scores` jsonb, jobs, artifacts, cost ledger, settings) | `db/real_case_schema.sql`, `lib/real-case/schema.ts` |
| News scout (Sonnet 5.5 + web search/fetch, strict `submit_stories`, 90-day window, act-tagged claims, cast, timeline, verbatim artifacts) | `lib/real-case/scout.ts` |
| Source check (excerpt on page, Wayback fallback) | `lib/real-case/source-check.ts` |
| Jev scoring (stakes, turn, scene, reveal, artifacts, players; freshness in code) + gates + same-event | `lib/real-case/jev/questions.ts`, `scoring.ts`, `evaluate.ts` |
| Cycle, pool expiry at 90 days, lab data | `lib/real-case/cycle.ts`, `repository.ts`, `lab.ts` |
| Logo / cutout banking for a story's players | `lib/real-case/bank.ts` |
| BRIEF.md (acts, players with "logo banked"/"cutout banked", artifacts, timeline, facts by act) | `lib/real-case/render/brief.ts` |
| The writing prompts: eight acts, three scenes, engineered cold open, case file (players, artifacts, objects, mechanism) | `explainers/real-case/story-design.md`, `storyboard-skeleton.md`, `director/SKILL.md` |
| The plan lint (acts, scenes, word ranges, facts/numbers, artifacts verbatim, banking, cold open) + fictional fixture | `explainers/real-case/lint/` |
| Fact-check gate (meaning not wording; rewrite rounds; code cuts what stays untrue) | `lib/real-case/render/fact-check.ts` |
| This format's first-viewer prompt + understanding judge (cold-open test blocks; whole-reel test) | `lib/real-case/render/agents.ts`, `understanding.ts` |
| Render job orchestration (plan → understanding → facts → build → render → collect) | `lib/real-case/render/job.ts` |
| Worker + CLI | `scripts/real_case_worker.ts`, `scripts/real_case_scout.ts` |
| Lab page | `app/real-case/lab/`, `app/api/real-case/` |
| **Cutout bank: 18/18 blue-chip people, approved** (`approved: true`) | `explainers/real-case/bank/cutouts.json`, `cutouts/*.png`; builder `scripts/real_case_cutout_bank.ts`; cutter `explainers/real-case/bank/tools/cutout.swift` (macOS Vision, local) |
| Logo bank (shared, read-only) | `lib/social-hub/logo-bank.ts`, PNGs in `lib/social/render/assets/logos/` |
| Stock object finder (Openverse StockSnap/rawpixel lane → local cutout) | `scripts/real_case_object_cutouts.ts` |
| Dry-erase font (OFL) | `explainers/real-case/design/fonts/GochiHand-Regular.ttf` (+ OFL.txt) |

**What is NOT built (your job):** the news kit (components for the three scenes), this format's own
render engine scripts (forks of the Explainer world kit), the workspace overlay for them, the frame
worker's prompt and contract, the workflow's build phase, the sting and the close, sound placement per
SCENES.md, object auto-pick, the two missing sounds, the lab polish, and the first live reel.

---

## 4. Reference material (the look and the motion, approved)

- Stills (open every PNG): `.explainers-local/previews/ai-news-truecrime/` — `01…14-*.png`, sheets
  `truecrime-sheet-a.png`, `truecrime-sheet-b.png`, `whiteboard-sheet.png`. Generator:
  `gen.mjs` + `base.css` (cork, newsprint, halftone, torn edges, tape, push pins, red cord with its
  shadow, Polaroids, typed index cards and tags, the whiteboard in its room, flat magnets, dry-erase
  filter, measured marker arrows, film grain, warm lamp + vignette). **Port these techniques; they are the
  visual spec.** (`.explainers-local/` is untracked; it is on this machine.)
- Motion tests (play with sound): `.explainers-local/previews/ai-news-truecrime/motion/`
  `whiteboard-motion-test.mp4`, `newspaper-motion-test.mp4`, built by `motion.mjs`: each page exposes a
  pure `render(t)`, frames are captured at 30fps, and library sounds are mixed on contact frames with
  sustained ones cut to the stroke's exact length. **This is the motion/sound contract to reproduce in
  the real kit.**
- Rejected directions (do not reuse): `.explainers-local/previews/ai-news-directions/` (premium/glossy;
  Lucas: "TOO FAR INTO the premium/glossy feel"; the "Route data → Model learns" cards were called
  "really lazy").
- Lucas's verdicts that shaped the look: tactile true-crime, not glossy; "show less things on screen at
  the same time and move through different visuals"; "I don't want you to start just writing things on
  tiles or cards"; whiteboard must look like a whiteboard; magnets must not look like pins; motion and
  sound "extremely purposeful and apt".

---

## 5. The engine problem you must solve (read before designing)

The Explainer render engine is the job's `assets/kit/` (copied from `explainers/world-kit/` by
`prepareWorkspace` in `lib/explainers/render/workspace.ts`) and it is **bound to the Explainer look**:

| Coupling | Where | Consequence for this format |
|---|---|---|
| Opener bank auto-insert | `pace.mjs:382` `ensureOpener()` + `pace.mjs:396` `writeOpener` | Without care, frame 1 gets an Explainer opener and its voice is sped up 1.2× (`OPENER_TEMPO`, `pace.mjs:62,271,297`). Note `lib/real-case/render/job.ts` still calls `assignRealCaseOpener` — **remove it**. |
| Frame 8 = AI BRAIN BREAK close | `frames.mjs:55` `CLOSE_FRAME`, `isClose`, `writeClose` → `close.js` | Our close must be ours (§7.6). |
| Grounds | `mount.mjs:52` (paper/stage/white), `core.js` `GROUNDS` | Our grounds are `board`, `whiteboard`, `newspaper`. |
| Caption dark/quiet windows | `mount.mjs` `darkWindows`/`quietWindows`, `fillCaptionGrounds` | Captions must be light on `board`, dark on `whiteboard` and `newspaper`; quiet during the sting and the close. |
| Checks | `try.mjs` (title card on frame 1, dictionary card on frame 3, iso `validateShots`, ground names, "Infinity"/void-tag false positives), `bounds.mjs` (keep-outs, only measures SVG `text` / `[data-k=text]`) | Must be replaced/adapted for DOM-built news frames. |
| Music | `music.mjs` `STYLES` (funk/indie/hip-hop) + `BANNED` (cinematic, ambient, electronic…) | Our bed is different (open question Q1). |
| Repair runs the **repo's** kit | `lib/explainers/render/job.ts` `repairProjectAssembly` imports `explainers/world-kit/*` directly; `lib/real-case/render/job.ts` uses it by default | Pass `deps.repairAssembly` = your own repair using your kit. |
| Subagent prompts are fixed to the old look | `lib/explainers/render/agent.ts` `FRAME_WORKER_PROMPT`, `SCENE_BUILDER_PROMPT` | Override through `withAgentOverrides` in `lib/real-case/render/agents.ts` (already used for `first-viewer`): replace `frame-worker`, remove `scene-builder` (`null`). |
| Frame module contract | `assets/frames/<id>.js` default export `{ ground, shots?, draw(t) }` returning an SVG string; mount wraps it in `<svg>` and drives it with a paused GSAP tween on `clock.t`, registering `window.__timelines[id]` | Text-heavy newsprint, clippings and DOM filters are painful as SVG strings. See decision D1. |

What the engine gives you for free and you should keep using **as is** (read-only): the HyperFrames
runtime and CLI (`npx hyperframes snapshot|render|lint|check`), `faceless-explainer/scripts/`
(`audio.mjs` incl. `sync-durations`, `frame-packets.mjs`, `captions.mjs build`, `assemble-index.mjs`,
`transitions.mjs`), the sound mixer pattern of `world-kit/sound.mjs` (it only imports `frames.mjs`), the
waveform-silence pacing algorithm in `pace.mjs` (pauses ≤ 0.2s, never clip a word — a hard Lucas rule),
`renderProjectVideo`, `runHyperframesLint`, `runBoundsCheck` from `lib/explainers/render/job.ts`, the
session runner `runAgentSession`, the SFX library `explainers/design/sfx/` (catalog.json, 1,309 CC0
sounds; symlinked into jobs as `assets/sfx-library`).

### Design decisions to make early (recommendations given)

- **D1 — Frame contract: DOM `render(t)` (recommended).** Fork `mount.mjs` so a news frame module
  exports `{ ground, build(root, ctx), render(t) }`: `build` creates DOM once inside the frame's root
  (clippings, cutouts, magnets, ink SVG), `render(t)` is a pure function of time that sets transforms,
  stroke dash offsets, clip-paths, opacity — exactly the pattern of `motion/motion.mjs`. The fork's
  composition template keeps the HyperFrames contract (template, `data-composition-id`, `data-duration`,
  a paused GSAP tween on a clock that calls `render(t)`, `window.__timelines[id]`). Keep it deterministic
  (no `Date.now`, no CSS animations/transitions; filters with fixed seeds). If you choose to stay with
  SVG strings instead, say why in the register.
- **D2 — Where the fork lives:** `explainers/real-case/kit/` (engine scripts + components + close +
  sting), copied into the job as `assets/kit/` by `applyRealCaseOverlay` after removing the world kit,
  the opener bank and `assets/opener.json`. Fork only what you must change (`frames.mjs`, `mount.mjs`,
  `pace.mjs`, `try.mjs`, `bounds.mjs`, `music.mjs`, the sting-sound placer replacing `opener-sfx.mjs`);
  copy `sound.mjs` unchanged if it works against your `frames.mjs`.
- **D3 — Measurement:** marker connectors, circles and underlines are drawn by measuring the DOM boxes
  of the marked words/items at build time (see `motion.mjs` `boxOf`/`ellipseAround` and `gen.mjs`'s
  `data-link`/`data-link-to` edge-to-edge connector). Never hand-placed coordinates for marks on text.
- **D4 — The `frame.md` for this format** is built from your own preset folder
  `explainers/real-case/presets/ai-news/FRAME.md` (+ `caption-skin.html`) with the faceless skill's
  `build-frame.mjs` (`--preset ai-news --preset-dir explainers/real-case/presets`), run by the overlay,
  replacing the Explainer frame.md. FRAME.md needs YAML front matter with `colors:` and `typography:`
  (build-frame's self-check: ink vs canvas brightness ≥ 40).

---

## 6. Milestones

Each milestone: build → offline tests → report to Lucas with what changed, what's verified, and what's
next. Keep `npx tsx --test tests/real-case*.test.ts` and `tests/explainers*.test.ts` green throughout.

### N4c-1 · The news kit components (no engine yet)

Build `explainers/real-case/kit/components/` (ES modules, no CDN, fonts from the job's `assets/fonts/`):

- **Scenes (grounds):** `board()` cork (the stills' three-layer turbulence cork, warm lamp, vignette),
  `whiteboard()` (board in a room: aluminum frame, gray corner caps, tray with three markers and an
  eraser, window reflection, faint residue; also a close variant with the frame edge still in view),
  `newspaper()` (a full newsprint page as the surface: masthead, datelines, rules, columns of illegible
  filler lines, grain), plus `filmGrain()`.
- **Evidence on any scene:** `clipping({ masthead, date, kicker, headline, deck, body, photo, torn })`
  (Didot/Times, halftone photo, torn edge, paper grain), `printout({ kind: post|statement|reply, speaker,
  date, text, highlight })` (an artifact recreated, never a copy of a real product screen),
  `notice()`, `indexCard({ lines })` (typewriter), `evidenceTag({ text })` (manila tag with string),
  `polaroid({ cutout, caption })`, `cutout({ src, edge })` (photo with a hand-cut paper edge and a lifted
  shadow), `logoPrint({ logo })` (banked logo untouched on a paper print), `silhouette({ pose })`
  (faceless, for anyone not banked), `dictionaryClipping({ term, pos, meaning })` (the term — RC-42 allows
  it as a real object), `tape()`, `stamp({ text })` (the rubber stamp used by the sting/close).
- **Fasteners and marks:** `pushPin({ color })` (glossy dome, long shadow), `cord(points)` (red, slight
  sag, twist highlight, shadow on the cork), `magnet({ shape: disc|bar, color })` (flat, matte, flush,
  short hard shadow — must never read as a pin), `markerCircle(target)`, `markerUnderline(target)`,
  `markerArrow(from, to)`, `markerCross(target)`, `markerNote(text, { color })` (Gochi Hand through the
  dry-erase streak filter; on the newspaper use a felt-tip look, not dry-erase), `highlight(target)`.
  Each mark exposes its stroke length and a `progress(u)` so `render(t)` can draw it at hand speed.
- **Camera:** a camera rig per frame (`push`, `pan along a cord/arrow`, `follow a marker tip`, `rack
  focus` = blur/brightness on non-focal items) with the brand ease-out for camera moves and ease-in-out
  for world moves; cuts land on the voice's cue words.
- **A kit gallery page** (`explainers/real-case/kit/gallery.html`) rendering every component on all three
  scenes, and a script that snapshots it to PNG.

**Accept:** gallery PNGs match the stills by eye (Lucas checks); unit tests for the pure helpers
(connector geometry, stroke lengths, timing helpers); no network at render; Explainer tests unchanged.

### N4c-2 · The engine forks and the workspace

- Fork into `explainers/real-case/kit/`: `frames.mjs` (no opener bank; close = our close module;
  grounds = `board|whiteboard|newspaper`), `pace.mjs` (keep the waveform-silence tightening and the
  0.2s cap exactly; frame 1 keeps its natural tempo unless Lucas says otherwise (Q2); frame 1's `hold`
  (1.2s) is the sting window; frame 8 = 2.5s close), `mount.mjs` (the DOM contract from D1; caption
  windows: light captions on `board`, dark on `whiteboard`/`newspaper`, quiet during the sting and the
  close), `try.mjs` (module shape, ground matches storyboard, events file valid, `render` deterministic
  — same t twice gives the same DOM, no text outside the safe area, frame 1 reaches its sting, frame 8
  is the close; drop every critter/title-card/dictionary/iso-shot check), `bounds.mjs` (measure DOM text
  boxes: clipped by the frame edge, outside its card, or under the caption band), `music.mjs` (Q1), and a
  sting-sound placer.
- **The sting** (`explainers/real-case/kit/sting.js`): in frame 1's hold, a rubber stamp hits a manila
  case folder — AI NEWS EXPLAINED in Helios orange (Pragmatica Extended, ink-distressed), ~1.2s, its own
  thud (`freesound/stamp/*`) and a paper settle. Reference: `03-sting.png`.
- **The close** (`explainers/real-case/kit/close.js`, frame 8, 2.5s, no voice): the case folder, the
  Helios mark lands (never recolored, clear space respected — Helios logo rules), the stamp AI NEWS
  EXPLAINED beneath it; sounds: folder slap, stamp thud; music fades out. Reference: `13-close.png`.
- **Workspace overlay** (`lib/real-case/render/workspace.ts` `applyRealCaseOverlay`): remove
  `assets/kit` and lay in this kit; build frame.md from the `ai-news` preset (D4); copy the fonts
  (`explainers/real-case/design/fonts/` + Pragmatica/Roboto already in `assets/fonts`) — **the newspaper
  and typewriter faces Lucas approved (Didot, Times, American Typewriter) are macOS system fonts**: they
  render locally but not on Linux. Ask Lucas (Q3) before swapping in free equivalents; never ship Apple
  font files. Copy the story's banked assets into `assets/bank/` (its players' logos and approved cutouts
  per `lib/real-case/bank.ts`, plus its objects, N4c-3). Write no `assets/opener.json`.
- **Job wiring** (`lib/real-case/render/job.ts`): delete `assignRealCaseOpener` and its opener history;
  pass `repairAssembly` that re-mounts/re-paces/re-mixes with this kit; keep `withAgentOverrides` and add
  the frame-worker override (N4c-4).

**Accept:** a **dry workspace** built from the fixture story (no model) has the news kit, no world kit,
no opener bank/opener.json, frame.md from the `ai-news` preset, banked assets present; a test grep shows
no `critter`, `AI BRAIN BREAK`, `dictionaryCard`, `titleCard`, `world.js` references in the job; the
fork's pace/mount/try/bounds pass on a **hand-written fixture project** (eight frames built with the kit,
a fake voice track with known silences) and `npx hyperframes render` produces a fixture MP4 locally.
Show Lucas that fixture MP4.

### N4c-3 · Objects: find, cut out, auto-pick, bank (RC-41)

- From the plan's `## Case file` `objects:` list, after session A: for each object, check the object
  bank first (`explainers/real-case/bank/objects/<slug>/` + `objects.json`, reused across reels), then the
  Hub's photo bank (media_library, read-only; by tags), then the stock lane
  (`scripts/real_case_object_cutouts.ts` logic → a library function), up to 4 candidates, each cut out
  locally (`cutout.swift`).
- **Auto-pick:** stock results are noisy (a boxing match for "box", keys for "padlock"). Build one
  contact sheet of the candidates per object and ask one cheap vision call (Haiku 5.5, cached system
  prompt) to pick the candidate that is "one clean, whole <object>, no people, no text or logos, readable
  at phone size", or none. On none: the frame drops the object (log a flag), never a wrong object.
- Record credit and licence (CC0/CC BY) per object; keep a `credits` list per job.
- macOS-only: `cutout.swift` needs macOS Vision. The social worker VM is Linux; note this in the register
  and keep object/cutout prep on this Mac for now (Q4).

**Accept:** stubbed-vision tests for pick/none/cache-hit; a local run on 3 objects (no model call needed
if you stub the pick) produces banked cutouts with credits.

### N4c-4 · The build-phase prompts (frame worker, workflow, frame treatments)

- `explainers/real-case/presets/ai-news/FRAME.md` — the visual system for a frame worker: the three
  scenes, the components and their exact API, the one-item-per-shot rule, the camera grammar, the
  forbidden list (text tiles/cards standing for concepts; glossy/premium UI; critters; any photo of a
  person not in the cutout bank; copies of product screens; decorative motion; whooshes), the marks'
  colors (orange for the key detail on board/newspaper; blue/red/black dry-erase on the whiteboard), and
  **Frame Treatments per act** (cold open, setup, moment, fallout, reveal, since, for you, close) taken
  from the stills.
- `SCENES.md` turned into the worker's **motion and sound rules**: every motion has a physical cause;
  every sound is that action's own sound on its contact frame; sustained sounds cut to the stroke/wipe;
  writing at ~10 letters/s, circles 0.45–0.7s closing on the cue word, arrows tail→head then two
  flicks; anticipation + 1–3px settle, no elastic bounce; marker uncap before the first stroke of a
  scene, cap at the end. The events file per frame uses the existing sound kinds (`impact`, `foley`
  with `what` and `dur`, `click`, `tick`…); add a **foley vocabulary** mapping each action to library
  tags (marker on whiteboard → `marker-write` whiteboard/squeak; felt tip on newsprint → `marker-write`;
  page lands → `paper-drop` newspaper; pin → `pushpin`; tape → `tape`; eraser → `eraser`; cap off →
  `marker-cap`; cap on → `pen-cap`; stamp → `stamp`; page turn → `page-turn`).
- `explainers/real-case/frame-worker.md` + `frame-worker-core.md` rewritten for the DOM contract; the
  **frame-worker agent prompt** override in `lib/real-case/render/agents.ts` (and `scene-builder: null`).
- `explainers/real-case/workflow.md` (the faceless-explainer `SKILL.md` the overlay installs) rewritten
  for the build phase: audio → sync-durations → **this kit's** pace → music → sting sound → frame
  packets → frame workers (frames 1–7; 8 is code) → mount → try → bounds → sound → captions → assemble →
  transitions → lint/check → the blind picture check (adapt the checker's failure rules to this look:
  a tile fails when the focal item is unclear, two or more items compete for attention, text is
  unreadable, or a mark misses its word) → render.
- `explainers/real-case/director/SKILL.md` Phase: build updated to match; remove `director/scene-builder.md`
  from `OVERLAY_FILES` (no scene builder in this format).
- Regenerate `prompts-for-review.md` (it should now include the frame-worker prompt and FRAME.md).

**Accept:** prompt-edit checks done (contradictions, example pollution, abstraction); **Lucas approves
the build prompts** before any live render.

### N4c-5 · Sounds

- The library has everything except a **magnet clack** (on a whiteboard) and a **cord pulled taut**.
  Ask Lucas before downloading; then import 2–4 CC0 cuts of each with the library's own tools
  (`explainers/design/sfx/tools/freesound-*.mjs`, `merge-catalog.mjs`). That folder is shared with
  Explainer Reels: **adding** catalog entries is fine, changing existing ones is not.
- Music (Q1): implement whatever Lucas picks in the fork's `music.mjs` with its own history file
  (`.explainers-local/real-case/music-history.json`), never the Explainer rotation.

**Accept:** a dry run of `sound.mjs` on the fixture project places every event; dropped list empty.

### N6 · Lab polish and the first live reel

- Lab (`app/real-case/lab/`): title "AI News Explained"; story card shows the date, players (with
  banked logo/cutout thumbnails), artifacts, timeline, scores; Renders tab plays the video. Verify in the
  browser (start the dev server with the repo's preview config; `.env.local` points the app at the local
  Postgres — that is expected for this route).
- **Live runs only on Lucas's go-ahead, one at a time, each with an estimate:**
  1. one news search (`npx tsx scripts/real_case_scout.ts --search --yes`, about $0.50–1.00);
  2. Lucas picks a pooled story; one render (`--make <storyId>`, then `npm run real-case:worker -- --once`;
     about $6–8). Re-read the worker log before any restart (a restart once killed a Lucas-clicked render).
- Send Lucas the MP4 and a short report: spend, flags (facts cut, understanding findings, picture-check
  fails), and what you'd tune.

---

## 7. Open questions for Lucas (ask when you reach them, with your recommendation)

- **Q1 Music:** the Explainer bed rules (groovy funk/indie/hip-hop; "cinematic/ambient/electronic"
  banned) don't fit true crime. Recommend: a tense, low documentary bed (pulse, muted piano/strings/
  percussion, ~80–100 BPM), its own rotation, still from HeyGen's catalog, normalized like the Explainer
  bed. Get his yes or his pick of 3 sample beds before building.
- **Q2 Cold-open voice tempo:** Explainer openers run 20% faster; keep this format's cold open at natural
  speed unless he wants the boost.
- **Q3 Fonts on Linux:** Didot / Times / American Typewriter are approved but are Apple system fonts. For
  any render off this Mac, propose OFL look-alikes (e.g. Playfair Display or Bodoni Moda for Didot,
  Libre Caslon / Old Standard TT for Times, Special Elite for the typewriter) and show a side-by-side.
- **Q4 Where it runs:** cutouts need macOS Vision. Recommend: renders stay on this Mac until validated;
  later, a Linux matting path (e.g. rembg) or pre-baking all cutouts here.
- **Q5 Prompts:** confirm `prompts-for-review.md` (scout, scoring, fact check, first viewer) is approved
  before the first live search.

---

## 8. How to report

At each milestone boundary: what you built (files), what's verified (tests run, renders/snapshots made,
with paths), what's not verified, decisions you made (and add them to `DECISIONS.md` as RC-47+ with the
date and Lucas's words when they are his), spend so far (should be $0 until N6), and the next step.
Send images/videos, not descriptions, for anything visual.
