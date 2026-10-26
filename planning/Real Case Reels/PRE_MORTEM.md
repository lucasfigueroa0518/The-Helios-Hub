# Pre-mortem — AI News Explained, before the first live reels (2026-10-26)

The gate Lucas set before any live scout or render: every item below is Pass, Fixed, or Deferred
with a reason. No item is Fail.

## Objective

| # | Check | Result | Evidence / what changed |
|---|---|---|---|
| 1 | All real-case + explainer tests pass | **Pass** | `tests/real-case*.test.ts` 79/79; `tests/explainers*.test.ts` 324/324 (unchanged files); `tsc` clean apart from the existing `seo-gsc-auth` errors. |
| 2 | Dry fixture workspace: news kit; no world kit, opener, critter, AI BRAIN BREAK | **Pass** | `tests/real-case-render.test.ts` builds the workspace with no model and greps every job file for `critter`, `AI BRAIN BREAK`, `dictionaryCard`, `titleCard`, `world.js`; the Explainer director folder and `opener.json` are absent. |
| 3 | Fixture project: pace/mount/try/bounds + `hyperframes render` → MP4 | **Pass** | `npx tsx explainers/real-case/smoke/run-smoke.ts` → `.explainers-local/real-case/smoke-jobs/smoke/project/renders/video.mp4` (1080×1920, 35.7s); bounds ok over 163 moments; lint 0 errors. |
| 4 | `sound.mjs` dry run: no dropped events | **Fixed** | Placed 42 of 42, dropped []. The magnet clack, cord taut and whiteboard squeak were missing; imported 23 CC0 one-shots (RC-56), append-only, with tags no existing sound used. Fixture frame 3's cord now unspools in 0.5s, pulls taut, and has its `cord taut` sound. |
| 5 | Smoke video had a constant tone | **Fixed** | The smoke's stand-in voice (220 Hz per word, needed by pace's silence detection) is now replaced by silence of the same length before render; 220 Hz band measured at −61 dB mean. Smoke-only; live renders use the HeyGen voice. |
| 6 | Prompt audit: contradictions | **Fixed** | Act 5 defaulted to the whiteboard yet asked for a `dictionaryClipping` (paper), against RC-49. Now: the term is written in marker on the whiteboard, a clipping on board/newspaper; FRAME.md, frame-worker.md, story-design.md and storyboard-skeleton.md agree. FRAME.md's magnet colours were unlisted (an unknown colour drew an invisible magnet); listed, and the kit falls back to orange. |
| 7 | Prompt audit: example pollution | **Pass** | No real company or person in any build prompt (FRAME.md, frame worker, workflow, visual design, director, story design, skeleton, agents, object prompts); the only example is Harbor City Transit. |
| 8 | Prompt audit: HARD CONSTRAINTS; build prompts match DOM kit + RC-48/49/50 | **Fixed** | Added "Fasteners never cover a face or photo (HARD CONSTRAINT)" to FRAME.md; whiteboard rule names what fails. `prompts-for-review.md` regenerated. |
| 9 | Spend/env | **Pass** | Shell has no `ANTHROPIC_*`/`OPENAI_*`; live commands still use `env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL`. The worker only fills unset vars from `.env.local`. No Real Case worker running. The local Postgres (port 54329) had stopped; restarted with `npm run explainers:db`. `cost_events_vendor_check` includes `openai` (read-only check). |
| 10 | Fact-check gate before spend on art | **Pass** | `job.ts`: understanding test → fact gate (rewrites, then cut) → checkpoint lint → objects → session B. Objects never run on unverified text. |
| 10b | The $8 job cap counts every spend | **Fixed** | Object prep (images, vision pick) and the fact-check calls were recorded but not metered, so session B could overshoot the cap by their cost. Both now settle into the job's meter; prep over the cap fails the job (capped) before the build (new test). Jev calls stay unmetered (fractions of a cent). |
| 11 | Explainer coupling | **Pass** | No file under `lib/explainers/` or `explainers/` outside `explainers/real-case/` edited, except append-only sound library entries (allowed by the build prompt). Importer lives in `explainers/real-case/tools/`. |
| 12 | Non-deterministic render paths | **Pass** | Kit test bans clock, randomness, CSS animation and network in the kit; `try.mjs` checks the same `t` gives the same DOM. Network/model work (music search, object prep) happens before render, and its outputs are files. |
| 13 | Missing tests for new pure logic | **Fixed** | `coverProblems` and `wallProblems` (bounds) have unit tests; each also proven in a real browser on a planted violation (magnet on a photo; push pin on the whiteboard). |
| 14 | Where Vision/stroke tools run | **Pass** | Object prep uses rembg + autotrace (Linux-capable), installed on this Mac only; RC-52 notes the social VM needs both first. Real Case renders run on this Mac (`npm run real-case:worker`); no GCP redeploy (no `lib/reels/**` or `lib/social/**` change). |

## Quality

| # | Check | Result | Evidence / what changed |
|---|---|---|---|
| 15 | Gallery vs stills (cork, newsprint, whiteboard, magnets vs pins) | **Fixed** / Deferred eye-check | The gallery's board cord ran across Sam Altman's face; rerouted above the items. The whiteboard "things" sheet showed photos and clippings; it now shows only what RC-49 allows. Lucas's eye-check of `.explainers-local/real-case/kit-gallery/*.png` against the stills remains his. |
| 16 | One focal item per shot in FRAME.md | **Pass** | "One item per shot (HARD CONSTRAINT)"; the picture check fails a tile when items compete. |
| 17 | Whiteboard: no photo cutouts except RC-49; stroke-draw path | **Fixed** | `bounds.mjs` now fails a whiteboard frame showing a cutout, Polaroid, clipping, card, tag, pin, tape or cord. `markerDrawing` draws traced strokes (smoke frame 4). |
| 18 | Faces never under pins/cords; Polaroid framing | **Fixed** | `bounds.mjs` fails a fastener centred, or a cord point, inside a photo's inner area. Polaroid CSS fits the cutout whole, bottom-aligned at 92% height (headroom). |
| 19 | Readable text minimum | **Pass** | `bounds.mjs` fails text under 26px on screen. |

## Deferred (with reason)

- **HyperFrames lint warning `caption_track_kind_missing`** on `#el-captions`: a timeline-grouping hint, not a render fault; the mount is shared in shape with Explainers. Revisit after the live reels.
- **Jensen Huang whiteboard sketch** is banked unapproved; until Lucas approves it, a whiteboard frame uses his name in marker (RC-52).
- **The music bed is chosen at render time** from HeyGen's catalog (RC-54); the first two reels are its audition.
- **Fonts**: OFL faces render on every host (RC-55); if Lucas prefers Apple Didot/Times on Mac, swap the stack order.

## Live-spend estimate (inside the $22 session authorisation)

- Pool is empty → one scout: up to 8 web searches + Haiku/Sonnet evaluation + Jev, **about $0.50–1.00**.
- Two renders at **about $6–8 each** (cap $8 per job, enforced by the job), including object prep
  (Haiku pick ~$0.01/object, gpt-image ~$0.05/drawing or photo, ~6–10 images ≈ $0.50).
- Total expected **$13–17**; hard stop well under $22. A third render or second scout needs Lucas.

## Found in Phase C (live), and fixed

- **The scout could never submit a story** (tool versions with encrypted code-execution results; then a 20,000-token limit that cut off the submission). Fixed, RC-58.
- **A failed scout turn could cost money and log $0.** Fixed (priced `ScoutError`); the one unlogged run ($0.71) was recorded.
- **Every scouted story failed `acts_beyond_facts`** because the scout's prose padded its claims (Jev was right). Fixed by the facts-only rebuild and re-ask (RC-58); 1 of 5 then entered the pool, 1 fell below the bar, 3 still fail (title, summary or place carry unsupported detail).
- **The local Postgres died with its shell** (twice). It now runs in a detached `screen` session (`screen -dmS rcdb …`); so does the render.
