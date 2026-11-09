# Reel AI Drama — build plan (draft for Lucas's approval, 2026-10-28)

Source of truth: `PLAN.md` (decisions MD-01 to MD-51), `PROCESS.md` (the approved process),
`CALIBRATION.md`, `research/01–05`. Quality first; speed through parallel builders with one owner per file.

## Standing rules (every phase, every builder)

- **No live model, search or HeyGen calls in automated tests;** stub with canned responses. Any live run
  needs Lucas's go-ahead with a cost estimate (CLAUDE.md ~$1.50 rule).
- **Prompt caching** on every Messages API call with a stable prefix (`lib/anthropic-cache.ts`).
- **Local only:** no commits to main, no deploys, no Supabase apply without Lucas's OK.
- **Never edit Explainer files** (`lib/explainers/`, `explainers/` outside the new folder and
  `explainers/real-case/`). Shared libraries (photo finder, logo bank, media library) may gain new
  functions; their existing behavior and tests must not change.
- **Prompt-review lens** on every prompt: level of thought, no example pollution (Lucas's 12 stories never
  appear in a prompt), no contradictions, MECE (each rule in one layer), musts as HARD CONSTRAINTs.
- **Checks fail open:** one fix, then ship with a visible warning; the only exception is an unsupported
  claim, which is cut.
- **Old Real Case stays dormant** (MD-48): read it, copy from it, don't change it.

## Layout

| What | Where |
|---|---|
| Code | `lib/reel-ai-drama/` (development, reporting, harvest, production, checks, lab data) |
| Prompts, craft files, kit | `explainers/reel-ai-drama/` (writer and director craft, agent prompts, the media kit copied from `explainers/real-case/kit/` and extended) |
| Schema | `db/reel_ai_drama_schema.sql`, schema `reel_ai_drama` on the explainers connection |
| Lab | `app/reel-ai-drama/lab/` and `app/api/reel-ai-drama/` |
| Scripts | `scripts/reel_ai_drama_*.ts` |
| Tests | `tests/reel-ai-drama*.test.ts` |

## Phase 0 — the contract (written first, before any builder starts)

`planning/AI Mini Docs/CONTRACT.md` fixes every shared name:
- **Tables:** ledger cells and searches, pitches, scores, visuals cards, pool entries, jobs and stages,
  assets (with source, credit, what it shows, use history for the 20-day rule), cost events, settings.
- **Formats:** the pitch, the fact sheet, the visuals inventory, `SCRIPT.md` (narration, on-screen
  words, rung purposes, fact ids, the closing question), `SHOTPLAN.md` (per moment: image id, treatment,
  motion, marks, sound, music cue), the post text, the delivery report.
- **The kit API:** the DOM `{ ground, build(root, ctx), render(t) }` frame contract plus the new
  treatments (grade, grain, Ken Burns, parallax with gap fill, cutout lift, collision, measured page marks,
  printed map, lower third, Helios captions) and their options.
- **Check ids and the warning format;** stage names; kill reasons; settings keys (budgets, cadence,
  thresholds: 15 visuals, 20-day reuse, one per player per week, rung every 6–8s, hook within 1.5s,
  60–75s); model ids (MD-49).

**Accept:** Lucas skims the contract; every builder brief cites it.

## Phase 1 — parallel builders (one owner per area; coordinate through `notes/<builder>.md`)

| Builder | Owns | Accept (offline, stubbed) |
|---|---|---|
| **B1 Development** | ledger picker, development producer prompt and call (Sonnet + web search, one cell per call, nearest past pitches only), same-event dedupe (fingerprint → similarity → Jev on borderline), Jev drama and material question sets, visuals check (free counts, 1–2 image searches, one Haiku sheet look; < $0.35), pool ranking, spread and tending, the weekly schedule | tests for cell choice and due dates, dedupe, ranking and spread, the visuals-card rules; a stubbed session fills a pool |
| **B2 Reporting + harvest** | reporting agent (Sonnet + search/fetch; fact sheet; kill rule); the harvest: new sources (image search API, article images, newsrooms and press, video frames, page and post screenshots, printed-map renderer, satellite, documents and papers) plugged into the photo finder; watermark (incl. TV channel logos) and AI-image rejection; perceptual-hash dedupe; identity and date checks; credits; sparing upscaling; the 15-visual kill; the 20-day reuse rule | tests per source adapter on recorded fixtures; kill rules; an inventory built from fixtures |
| **B3 Craft + prompts** | writer craft and director craft files (from research 01–05, Lucas's review calls, calibration traits; no stories as examples); writer, director and handoff prompts; the facts check (loose Jev), integrity check and first-time-viewer prompts; the post-text prompt | prompt-review lens passed; `prompts-for-review.md` generated; **Lucas approves the prompts before Phase 3** |
| **B4 Media kit + render** | the kit copied and extended with the full-screen treatments and Helios captions (mirroring the Explainer skin), maps, measured marks; sound (ambience, foley on actions) and music changing at act turns; the brand close with the spoken, captioned question; breakage checks; render wiring | a kit gallery renders every treatment; a fixture project renders to MP4 with no model calls; screenshot to Lucas |
| **B5 Orchestration + lab** | schema; the job runner (P1–P9 with kills and the next story; one round of director lines back; $8 cap; cost ledger); the lab (pool, ranking, visuals cards, ledger, jobs, costs, deliveries) | an end-to-end stubbed run moves a fixture story from pitch to MP4; the lab shows it |

## Phase 2 — integration

1. A script cross-checks every name in the docs and prompts against the code and the contract.
2. A fresh read-only reviewer reports contradictions, gaps, wrong altitude, pollution and repeats, ranked
   must-fix / should-fix / nit.
3. I review every prompt diff myself; fixes go back to their owners.
4. All Reel AI Drama tests, the existing Explainer and photo-finder tests, and the typecheck pass.

**Accept:** the stubbed end-to-end run produces an MP4 and a delivery report; no must-fix left.

## Phase 3 — live (each step on Lucas's go-ahead, with its estimate)

1. **Calibration:** Jev drama and material scores on Lucas's 12 stories and 10 near misses (about
   $0.10–0.30). The 12 must rank above the near misses, with "Her voice" the only near miss allowed through.
2. **One development session** (about $1–3): Lucas sees the pitches, scores and visuals cards.
3. **One production run** (cap $8): the MP4, a contact sheet, the post text, cost and warnings. Then iterate.

## Status (2026-10-28)
- Phase 0 done: contract, schema, types, settings, cost ledger, Jev runner.
- Phase 1 done: B1–B5 built in parallel (notes in `notes/B1–B5.md`).
- Phase 2 done: name cross-check clean; integrator fixes (`notes/integrator.md`); fresh review
  (`notes/review.md`, 40 findings) applied by a fix builder; 115/115 tests, typecheck clean; smoke MP4
  renders (28.8s, no paid calls); `prompts-for-review.md` regenerated.
- v1 limits: no video frames (yt-dlp not installed), no upscaling (no upscaler), no PDF capture (no
  poppler), synthesized ambience (no CC0 ambience recordings), no drawings/sketches/parallax offered to the
  director yet, Serper image search only with a key; Flickr, GDELT, Wayback, satellite, SEC/court not built.
- Next: Lucas approves the prompts; calibration (live, first step) on his go-ahead.

## Status (2026-10-28, evening)
- Phase 3 step 1 (calibration) done and approved; step 2 (development) run twice live: $1.99 total today.
  Fixes from the live runs: nullable-enum tool schema (400 from the API), place geocoding fallbacks,
  Wikidata P18 fallback for faces, material and drama bars fitted, the "part of how AI was built" gate.
- Gaps filled: yt-dlp (Homebrew), Real-ESRGAN (~/.local/share/realesrgan, wrapper on PATH, photo model),
  Serper key (Lucas). CC0 ambience import in progress.
- Pool: 6 pooled. Seeded calibration stories mostly fail the visuals check because their fixtures carry no
  sources or specific-visual hints (the producer's pitches do).
- Next: one production run (cap $8) on Lucas's go-ahead.
