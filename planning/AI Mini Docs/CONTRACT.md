# Reel AI Drama — build contract (Phase 0, 2026-10-28)

Every builder reads this, `PLAN.md` (decisions MD-01 to MD-52, in Lucas's words), `PROCESS.md` (the
approved process), `BUILD_PLAN.md` (rules, phases) and `notes/interfaces.md` (the existing code we build
on). **Already written (Phase 0 code, change only by telling the integrator):**

| File | What |
|---|---|
| `db/reel_ai_drama_schema.sql` | all tables (settings, cells, sessions, searches, pitches, jobs, artifacts, assets, asset_uses, cost_events, jev_logs) |
| `lib/reel-ai-drama/types.ts` | Pitch, VisualsCard, PitchRow, FactSheet, Asset, VisualsInventory, WriterDraft, ScriptLine, StoryboardFrame, DirectorPlan, JobFlag, PostText, DeliveryReport, JobStage, STORY_TYPES, ERAS, VISUAL_KINDS, CHECK_IDS |
| `lib/reel-ai-drama/schema.ts` | `ensureReelAiDramaSchema(db)` |
| `lib/reel-ai-drama/settings.ts` | `loadSettings`, `saveSetting`, `DEFAULT_SETTINGS` (all thresholds and models) |
| `lib/reel-ai-drama/cost.ts` | `recordCost`, `spendFor`, `developmentSpendSince` |
| `lib/reel-ai-drama/jev.ts` | `RecordingDramaJevRunner` (Jev via the reels `JevTransport`, logged and priced) |
| `tests/reel-ai-drama-contract.test.ts` | schema, settings, cost ledger |

## Rules for every builder

- Read `BUILD_PLAN.md` § Standing rules. Above all: **no live API calls in tests or during the build**
  (stub every model, search, HeyGen and network call with canned fixtures); prompt caching on every
  Messages call (`cachedSystemText`, `withToolCache`); never edit Explainer files or `explainers/real-case/`
  / `lib/real-case/` (copy from them); never edit another builder's files — write a note instead.
- Tests: `tests/reel-ai-drama-<area>.test.ts`, node:test via `npx tsx --test`, PGlite via
  `scratchExplainersDb()` + `ensureReelAiDramaSchema`. Run only your files; report pass/fail counts.
- Code style: match `lib/real-case/` (plain async functions taking `(db, …)`, raw SQL, deps objects for
  every outside call so tests can stub them, comments only where the why isn't obvious).
- Every model call: `@anthropic-ai/sdk` messages with streaming for long outputs
  (`client.messages.stream(...).finalMessage()`), the model id from settings, the cost recorded with
  `recordCost` (price with `lib/anthropic-pricing`), `tool_choice: auto` with a strict submit tool (Sonnet
  5.5 rejects forced tool choice), web tools `web_search_20250305` / `web_fetch_20250910` (RC-58), resume on
  `pause_turn`, every live response appended to a JSONL log under `.explainers-local/reel-ai-drama/logs/`.
- **Prompt files** live in `explainers/reel-ai-drama/prompts/` (B3 owns them). Code loads them with
  `loadPrompt(name)` from `lib/reel-ai-drama/prompts.ts` (B3 owns it): it reads
  `explainers/reel-ai-drama/prompts/<name>.md` and returns the text. Code never inlines prompt prose.
- Secrets/env: `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY` (Jev), `HEYGEN_API_KEY`, `SERPER_API_KEY`
  (optional: a source that needs a missing key is skipped and noted, never an error), `OPENAI_API_KEY`
  (image model, MD-14, optional the same way).
- Notes: append to `planning/AI Mini Docs/notes/<builder>.md` — decisions you made, questions for the
  integrator, anything another builder must know. Keep it short.

## Module map (owner → files → exports others call)

### B1 Development — `lib/reel-ai-drama/development/`
```ts
// ledger.ts
seedCells(db): Promise<number>                         // every blue-chip player × STORY_TYPES × ERAS, idempotent
pickCells(db, settings, now, opts?: { reopen?: { playerId: string; reason: string }[] }): Promise<CellRow[]>
markSearched(db, cellId, { pitchesMade, now, dueDays }): Promise<void>
newsTouching(db, now, days): Promise<{ playerId: string; headline: string; url: string; publishedAt: string }[]> // filters lib/stories pool by player tokens
// producer.ts
producePitches(deps: ProducerDeps, cell: CellRow, ctx: { nearest: Pitch[]; news: …[]; today: string }): Promise<{ pitches: Pitch[]; usd; queries: string[] }>
// dedupe.ts
eventKey(p: Pitch): string                             // normalized who-what-when fingerprint
findDuplicate(db, jev, p: Pitch): Promise<{ duplicateOf: string; why: string } | null> // key → similarity → Jev same-event on borderline
// scores.ts  (Jev question sets: DRAMA_SET, MATERIAL_SET; versioned)
scoreDrama(jev, pitchRow): Promise<Score>; scoreMaterial(jev, pitchRow): Promise<Score>
// visuals-check.ts
checkVisuals(deps: VisualsCheckDeps, pitch: Pitch, capUsd: number): Promise<VisualsCard>
// pool.ts
rankScore(row: PitchRow, settings, now): number        // drama first, material a little, fresh-news bonus (MD-32)
nextForProduction(db, settings, now): Promise<PitchRow | null> // top pooled pitch respecting the spread rule
tendPool(db, settings, now): Promise<{ faded: number; rechecked: number }>
// session.ts
runDevelopmentSession(deps: DevelopmentDeps, opts: { trigger: 'auto'|'click'|'calibration' }): Promise<SessionSummary>
// calibration.ts
runCalibration(deps): Promise<CalibrationReport>       // scores CALIBRATION.md's 12 + 10 near misses (MD-52 first live step)
seedCalibrationPitches(db): Promise<number>            // Lucas's 12 as origin='seed' pitches (into the pool via the same checks)
```
Uses the Real Case same-event Jev sets as a pattern (copy, new ids). The drama set weighs MD-29 heavily
(a central figure's want drives events) and the search criteria MD-24; the material set is MD-22.
Calibration data: CALIBRATION.md stories as fixtures in `lib/reel-ai-drama/development/calibration-data.ts`
(never in a prompt).

### B2 Reporting + harvest — `lib/reel-ai-drama/reporting/`, `lib/reel-ai-drama/harvest/`
```ts
// reporting/report.ts
reportStory(deps: ReportingDeps, pitch: Pitch, ctx: { jobId; mode }): Promise<FactSheet>   // verdict.holds=false kills (MD-31)
// harvest/harvest.ts
harvestVisuals(deps: HarvestDeps, input: { pitch: Pitch; facts: FactSheet | null; jobDir: string; jobId; mode; settings }): Promise<VisualsInventory>
// harvest/sources/*.ts — one adapter per source; each (query, run) => Promise<RawCandidate[]>
// harvest/screens.ts — Playwright screenshots of pages/posts/documents, with measured text boxes for marks
// harvest/places.ts — geocoding (Nominatim, 1 req/s, User-Agent) → lat/lon; calls the kit's map renderer
// harvest/filters.ts — watermark (incl. TV channel logos, MD-16), AI-image, identity, recency, phash dedupe, size, upscale-when-needed (MD-16)
// harvest/reuse.ts
recentlyUsed(db, assetKeys, reuseDays, now): Promise<Set<string>>   // character images exempt (MD-45)
recordUses(db, jobId, uses: { assetKey; purpose; characterImage }[]): Promise<void>
```
The fact sheet may run in parallel with the harvest: the harvest starts from the pitch's cast, places,
artifacts and expected visuals, and adds the fact sheet's sources and artifacts when available. Kill
under `settings.min_visuals` usable assets or with no image for the key moment (MD-33). Every asset has
`shows` (what it actually shows), credit and source. Banked cutouts are character images
(`character_image: true`); any other use of a person needs a different photo (MD-41).

### B3 Craft + prompts — `explainers/reel-ai-drama/craft/`, `explainers/reel-ai-drama/prompts/`, `lib/reel-ai-drama/prompts.ts`, `lib/reel-ai-drama/writing/`, `lib/reel-ai-drama/checks/`
- Craft files: `craft/writer-craft.md`, `craft/director-craft.md` — distilled from `research/01–05` with
  Lucas's review calls (PLAN.md § Review calls; the rest of each flagged item follows my recommendation in
  `research/flags.json`, written by the integrator), calibration traits (CALIBRATION.md corrections), the
  structure (four buckets + engines, MD-35–37) and the visual decisions (MD-41–46). Self-contained: never
  read or borrow from the Explainer `CRAFT.md`.
- Prompts (`prompts/*.md`): `producer`, `reporting`, `writer`, `director`, `writer-revise`,
  `build-workflow` (the frame-building session), `frame-worker`, `first-viewer`, `fix`, `post-text`,
  `integrity` (Haiku look), `visuals-look` (Haiku sheet look for the visuals check and harvest filters).
  B1 and B2 call `producer`, `reporting`, `visuals-look`; B3 owns the words, the callers own the code.
  Each prompt's required output shape is the matching type in `types.ts` (or a tool schema the caller
  defines from it).
```ts
// prompts.ts
loadPrompt(name: PromptName): string
// writing/writer.ts, writing/director.ts, writing/post.ts
writeScript(deps, input: { pitch; facts: FactSheet; inventory: VisualsInventory; settings }): Promise<WriterDraft>
reviseScript(deps, input: { draft: WriterDraft; linesBack: DirectorPlan['lines_back']; facts }): Promise<WriterDraft>
directReel(deps, input: { draft: WriterDraft; inventory; facts; kitGuide: string }): Promise<DirectorPlan>
writePost(deps, input: { draft; facts; inventory; usedAssetIds: string[] }): Promise<PostText>
// checks/*.ts
checkFacts(jev, input: { draft; facts }): Promise<{ unsupported: { line_id; why }[] }>          // loose, semantic Jev (MD-39)
checkIntegrity(deps, input: { plan: DirectorPlan; inventory; draft }): Promise<{ problems: { frame; asset_id; why }[] }> // Haiku looks
checkFirstViewer(deps, input: { contactSheet: string; captions: string; draft; facts }): Promise<{ hookSeconds: number|null; understood: boolean; problems: string[] }>
```

### B4 Media kit + render — `explainers/reel-ai-drama/kit/`, `lib/reel-ai-drama/render/`
- Copy `explainers/real-case/kit/` to `explainers/reel-ai-drama/kit/` and extend. **Fork** what is
  hard-wired: `frames.mjs` (variable frame count; no sting frame; the last frame is the close),
  `try.mjs` (no 8-frame / 3-ground rule), `close.js` (Reel AI Drama + Helios close, about 2.5s, with the
  spoken and captioned question, MD-18 / S-33), `music.mjs` (music changes at frames marked
  `music: change|drop|start`, MD S-74), captions (mirror the Explainer Helios skin, MD-42).
- **Treatments** (frame `treatment:` values; each a kit function with options, documented in
  `kit/FRAME.md`): `photo` (full-screen, grade, grain, Ken Burns push/pan/hold), `cutout_lift`,
  `collision`, `page` (a screenshot with marks measured onto words from the harvest's text boxes),
  `map` (pre-rendered printed-style map with pin and Helios label), `document`, `post`, `headline`,
  `lower_third`, `number` (a big stat in Helios type), `board`, `whiteboard`, `newspaper` (from the news
  kit), `close`. Parallax with gap fill is an option of `photo`/`cutout_lift` (MD-14 allows it).
  Helios type: Pragmatica Extended Bold + Roboto; orange `#FF5E1A`; paper-lit `#FEF9F3`.
- `kit/maps/render-map.mjs`: `renderMap({ lat, lon, zoom, label, sublabel, out })` → PNG (MapLibre +
  OpenFreeMap liberty, printed paper look; network is allowed here, at harvest time only).
- `kit/project-files.mjs`: `writeProjectFiles(projectDir, { draft: WriterDraft, plan: DirectorPlan, inventory })`
  → `SCRIPT.md` + `STORYBOARD.md` in exactly the formats `audio.mjs`, `pace.mjs`, `mount.mjs` and
  `captions.mjs` need (B4 reads those scripts to confirm), plus `assets/media/` copies and
  `assets/inventory.json`.
```ts
// lib/reel-ai-drama/render/
prepareWorkspace({ jobsRoot, jobId }): Promise<Workspace>      // Explainer prepareWorkspace + our overlay + kit (pattern: lib/real-case/render/workspace.ts)
runVoice(projectDir, { voiceId, heygenApiKey }): Promise<void>  // audio.mjs + sync-durations + pace (no model)
assembleProject(projectDir): Promise<{ ok; problems: string[] }> // kit assemble + try + bounds (breakage, MD-39)
renderVideo(projectDir): Promise<string>                        // HyperFrames → renders/video.mp4
contactSheet(projectDir, videoPath): Promise<string>            // stills grid PNG + caption transcript
KIT_GUIDE: string                                               // kit/FRAME.md text, for the director and frame workers
```
- Gallery: `kit/gallery.mjs` renders every treatment to `.explainers-local/reel-ai-drama/kit-gallery/`.
- Smoke: `explainers/reel-ai-drama/smoke/run-smoke.ts` renders a fixture reel (fixture draft, plan and
  inventory using banked images) to MP4 with no model and no HeyGen (silent stand-in voice).

### B5 Orchestration + lab — `lib/reel-ai-drama/production/`, `lib/reel-ai-drama/lab.ts`, `app/reel-ai-drama/`, `app/api/reel-ai-drama/`, `scripts/reel_ai_drama_*.ts`
```ts
// production/jobs.ts
requestJob(db, { pitchId, trigger, settings }); claimNextJob(db); setStage(db, jobId, stage); addFlag(db, jobId, flag); finishJob(db, jobId, { status, error?, killReason? }); addArtifact(db, { jobId, kind, content?|storagePath, bytes })
// production/run.ts
runJob(deps: ProductionDeps, job): Promise<{ status: 'ok'|'failed'|'killed' }>
//   P1 pick → P2 reportStory ‖ P3 harvestVisuals → kill? next pitch → P4 writeScript → P5 directReel
//   → (lines_back? reviseScript once) → lock → C1 checkFacts (cut unsupported lines after one fix)
//   → prepareWorkspace + writeProjectFiles → P6 runVoice → C2 checkIntegrity (one fix via directReel, then warn)
//   → P7 frame-building agent session (runAgentSession + withAgentOverrides pattern, prompts build-workflow /
//      frame-worker) → assembleProject (breakage: one repair session, then warn) → renderVideo
//   → C3 checkFirstViewer (one fix session, then warn) → contactSheet → writePost → recordUses → deliver
//   Spend: SpendMeter with settings.per_reel_cap_usd; every call recorded with recordCost.
// production/schedule.ts
weeklyTick(deps, now): Promise<…>     // when settings.auto: one development session a week under the cap; per_week jobs spread over the week
// lab.ts
labData(db): Promise<LabData>         // pool (ranked), cells/ledger, sessions, jobs, costs, deliveries, calibration report
```
Routes `app/api/reel-ai-drama/{lab, develop, calibrate, make, settings, artifacts/[id]}` (pattern:
`realCaseRoute`); page `app/reel-ai-drama/lab/` (tabs: Pool, Development, Jobs, Calibration, Settings);
scripts `reel_ai_drama_develop.ts`, `reel_ai_drama_calibrate.ts`, `reel_ai_drama_worker.ts` (each live
action behind `--yes`).

## Artifact kinds (jobs)
`fact_sheet`, `inventory`, `writer_draft`, `director_plan`, `script_md`, `storyboard_md`, `facts_check`,
`integrity_check`, `first_viewer`, `breakage`, `post_text`, `contact_sheet`, `video`, `delivery_report`,
`transcript_log`.

## Flags and kills
- `JobFlag.check`: one of `CHECK_IDS` or `harvest | reporting | voice | render | cost`; `detail` is one
  plain sentence a person can act on.
- Kill reasons (job `status='killed'`, pitch `status='killed'`, next pitch picked): `facts_dont_hold`,
  `too_few_visuals`, `no_key_moment_image`.

## Integration hand-off
Each builder ends with: files written, exports, tests (pass/fail counts), open questions, and anything it
stubbed for another builder. The integrator (me) runs the cross-check script, the reviewer, the prompt-diff
review, and the stubbed end-to-end run.
