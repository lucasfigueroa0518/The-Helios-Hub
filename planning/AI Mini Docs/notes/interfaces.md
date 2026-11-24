# Interface map: what Reel AI Drama builds on (The-Helios-Hub, 2026-10-28)
Paths are repo-relative. "Q" = `Queryable` from `lib/explainers/db.ts`: `{ query<T>(sql, params?) => Promise<{rows:T[]}> }`.

## Surprises (carry into every brief)
1. The Real Case runner leans on Explainer code: `runAgentSession`, `SpendMeter`, `prepareWorkspace`, `renderProjectVideo`, the HeyGen voice setting, the faceless-explainer scripts. `withAgentOverrides` matches agent names; renames on the Explainer side silently break it. Import these, never edit them.
2. Two Jev clients: Real Case uses `JevTransport` (`lib/reels/jev`); the photo finder uses `JevAsk` (`lib/social/jev`). Reel AI Drama needs an adapter.
3. HeyGen spend is unknown (TTS runs through `audio.mjs`; ledger records `usd:null`). Music also comes from HeyGen's catalog.
4. `real_case.cost_events.vendor` is a CHECK list (anthropic, heygen, jev, openai). Our schema has its own, wider list.
5. The photo no-repeat rule lives in a JSON file and in `social.used_photos`. Reel AI Drama keeps its own use table (20 days, MD-45).
6. The Helios caption skin hardcodes ink colors (`#171717`, `#fbfaf6` on dark) and loads GSAP from jsdelivr.
7. Missing: no news-by-player reader in `lib/stories` (only last ~30h of `social.runs` / the reels slate); blue-chip people have `qid: null` (cutouts.json has QIDs); no exported find-player-by-name. Schema loaders split on lines ending `;` — **no `$$` bodies**, everything idempotent.

## 1. Real Case job runner and plumbing (`lib/real-case/`)

### render/job.ts
- `runRealCaseJob(deps: RealCaseRenderDeps, job): Promise<{status:'ok'} | {status:'failed'; error; capped}>`
- `RealCaseRenderDeps = { db: Q; query: AgentQuery; store: ArtifactStore; jobsRoot; secrets:{anthropicApiKey, heygenApiKey}; factChecker; jevTransport?; voiceId?; prepare?; hyperframesLint?; boundsCheck?; renderVideo?; repairAssembly?; objects?(projectDir, storyboard)=>Promise<PrepResult>; random?; log?(event, fields) }` (after `factChecker` = test seams).
- Stages via `setRealCaseJobStage`: `workspace → session_a → … → session_b → [repair] → collect → [render]`, then `finishRealCaseJob`.
- Agent seam: `runAgentSession({ query: withAgentOverrides(deps.query), prompt, projectDir, homeDir, tmpDir, model, frameWorkerModel, meter, secrets:{...secrets, voiceId}, log })` from `lib/explainers/render/agent.ts`; live query = `loadAgentQuery()` (claude-agent-sdk from `explainers/runtime/node_modules`).
- `SessionResult = { sessionId; subtype; isError; totalCostUsd; modelUsage{model→{inputTokens,outputTokens,cacheRead…,costUSD}}; capped; denials; errors; lastText }`.
- Spend cap: `new SpendMeter(capUsd, spentUsd)` (`lib/explainers/render/meter.ts`) prices streamed messages and aborts when `meter.overCap`; non-agent spend via `meter.settleSession(usd)`; a cap hit throws `RenderFailure(msg, capped=true)`.
- Flags: `addRealCaseJobFlag(db, jobId, kind, detail)`.
- Voice: `voiceId = deps.voiceId ?? (await loadExplainerSettings(db)).voice_id`; env `HELIOS_VOICE_ID`, `HEYGEN_API_KEY` (`scrubbedEnv`).
- HyperFrames: `node assets/kit/assemble.mjs`, `runHyperframesLint`, `runBoundsCheck`, `renderProjectVideo(projectDir)` = `explainers/runtime/node_modules/.bin/hyperframes render --quality high --workers auto --output renders/video.mp4` with `HYPERFRAMES_ENV`, 30-min timeout.
- Artifacts via `store.put` at `real-case/jobs/<id>/<name>`; transcript at `jobsRoot/<id>/transcript.jsonl`. Worker: `scripts/real_case_worker.ts`; jobs dir `REAL_CASE_JOBS_DIR` (default `.explainers-local/real-case/jobs`).

### render/agents.ts
- `withAgentOverrides(query, overrides): AgentQuery` rewrites `options.agents[name]`; `null` deletes. `AgentOverrides = Record<name, {prompt, description} | null>`. Agent-name constants are exported by `lib/explainers/render/agent.ts`.

### render/workspace.ts
- `prepareRealCaseWorkspace({jobsRoot, jobId, story}) => {jobDir, projectDir, homeDir, tmpDir}`: Explainer `prepareWorkspace({ topic, sourceText:null, analogy:null, gap:null })` → `applyRealCaseOverlay` (BRIEF.md, CLAUDE.md/AGENTS.md, removes the explainer director skill, copies overlay files and lint) → `applyNewsKit` (removes `assets/kit`, `assets/world`, `opener.json`, opener sfx; copies `explainers/real-case/kit` → `assets/kit` minus gallery/bake-textures; fonts, `Helios-mark.png`; banked logos and approved cutouts → `assets/bank/{logos,cutouts}` + `credits.json`; `music-avoid.json`; `build-frame.mjs --preset ai-news --preset-dir explainers/real-case/presets` → `frame.md` + `.hyperframes/caption-skin.html`).
- `tmpDir` is deliberately short (`os.tmpdir()/hx-<8 chars>`, sandbox socket limit).

### render/fact-check.ts
- `FactChecker.check(FactCheckInput) → {sentences, usd, model, usage}`; live = one `messages.create` with `system: cachedSystemText(...)`, `output_config.format = json_schema(...)`, priced by `priceAnthropicUsage(..., '1h')`.

### render/understanding.ts (Jev usage)
- `defineQuestionSet({ id, version, questions: { key: noul({question, judge}) } })`; `jev.ask({ component, state, set, questions:{subset}, storyId })` → `answers[key].noul`.

### repository.ts / jobs.ts patterns
- Plain async functions `(db: Q, …)` with raw SQL. Jobs: `requestStoryRender`, `claimNextRealCaseJob`, `setRealCaseJobStage`, `addRealCaseJobFlag`, `finishRealCaseJob`, `failStaleRealCaseJobs`, `addRealCaseArtifact(db,{jobId, kind, content? | storagePath, bytes, storageLocation})`. Numeric columns coerced with `Number()`.

### Cost ledger
- `recordRealCaseCost(db, {cycleId?, jobId?, storyId?, mode, vendor, component, inputTokens?, outputTokens?, cacheReadTokens?, cacheWriteTokens?, webSearches?, usd: number|null})`: one CTE inserting the event and adding to `jobs.spend_usd`; `usd:null` stored as 0 with `usd_known=false`.

### settings.ts
- `loadRealCaseSettings(db)` (rows over defaults; throws on invalid), `saveRealCaseSetting(db, key, value)`, `isRealCaseSettingKey`. Defaults also seeded in SQL — keep in sync.

### jev/
- `defineQuestionSet` (`lib/reels/jev/question-set.ts`), `noul` (`@typesafe-ai/sdk`). Bump `version` on any wording change.
- Runner: `new RecordingRealCaseJevRunner(transport: JevTransport, db, {mode, cycleId?, jobId?}).ask({component, state, set, questions, storyId?})` → `transport.systemOne(state, questions)`, logs to `jev_logs`, records cost `vendor:'jev', usd: jevUsd(input_tokens)`.
- Client: `lib/reels/jev/client.ts` `liveJevTransport` (`TypeSafeClient({defaultModel: JEV_MODEL})`, `TYPESAFE_API_KEY`, `JEV_USD_PER_MTOK=0.042` input only, `lib/reels/config.ts`).
- Same-event sets: `STORY_SAME_EVENT_GATE`, `STORY_SAME_EVENT_PAIRS` (`PAIR_KEYS`), `DUPLICATE_YES` in `lib/real-case/jev/questions.ts`.

### scout.ts (Anthropic + web_search/web_fetch)
- `client.messages.stream(params).finalMessage()` (streaming required above ~21k max_tokens; scout uses 48000).
- Tools: `[{type:'web_search_20250305', name:'web_search', max_uses:8}, {type:'web_fetch_20250910', name:'web_fetch', max_uses:10}, SUBMIT_TOOL]`, `tool_choice:{type:'auto'}` (Sonnet 5.5 rejects a forced tool choice). The 2026-02-09 tool versions returned encrypted results (RC-58) — use these.
- `system: cachedSystemText(...)`; per-request data in the user message after the cached prefix.
- Resume on `pause_turn` (up to 4×). Errors carry spend (`ScoutError(msg, spend)`). Pricing: `priceAnthropicMessages` (`lib/anthropic-pricing`). Log every response to JSONL.
- SDK 0.65 lacks server-tool types: cast through `unknown as Anthropic.Tool[]`.

### objects/ (object prep, RC-52)
- `prepareObjects(projectDir, needs, people, deps)`; `PrepDeps = { root?, create?, generate?, search?, http?, removeBg?, trace?, log? }`; `PrepResult = { placed, flags, usd:{vision, drawing} }`. Parts: `pick.ts` (Haiku contact-sheet pick), `drawing.ts` (gpt-image-2), `cutout.ts` (rembg), `trace.ts` (autotrace), `stock.ts` (Openverse), `bank.ts` (`findBanked(slug, kind)`, `bankObject`).

### bank.ts
- `loadCutouts(root?)` reads `explainers/real-case/bank/cutouts.json` (`{id, name, qid, file, width, height, credit, provenance, approved}`); `bankingFor(member) → {logo, cutout}`.

## 2. DB connection and schema
- `explainersDb()` (`lib/explainers/connection.ts`): `EXPLAINERS_DATABASE_URL` → pg Pool; `EXPLAINERS_DB=supabase` → live; else PGlite at `.explainers-local/pgdata`. `ExplainersDb = Q & { transaction(fn) }`.
- Schema apply pattern: `ensureRealCaseSchema(db)` (WeakSet once per connection), statements split from the SQL file (drops `\` and `--` lines, a statement ends at a line ending in `;`). No `$$`; idempotent SQL.
- Tests: `npm test` = `tsx --test tests/*.test.ts` (node:test). `import { scratchExplainersDb } from './explainers-pglite'` → in-memory PGlite + explainers schema; then ensure your schema.

## 3. Lab and API patterns
- `app/real-case/lab/page.tsx`: server component, `dynamic='force-dynamic'`, `robots:{index:false,follow:false}`, redirect outside dev when `getSession()` is null, renders the client lab, imports `./lab.css`.
- Client lab: `'use client'`, tabs, `fetch('/api/…/lab', {cache:'no-store'})`, a `post(url, body)` helper; types from `lib/real-case/lab.ts` (`LabData = Awaited<ReturnType<typeof labData>>`).
- Routes: `export const runtime='nodejs'; export const dynamic='force-dynamic'`; `realCaseRoute(fn, {session?, db?})` wraps session check (dev → `{email:'local'}`), DB + schema, JSON; `LabError(msg, status)`.

## 4. News kit (`explainers/real-case/kit/`; Node `.mjs`, browser `.js`)
- **Frame module:** `assets/frames/<id>.js` default-exports `{ ground, build(root, ctx), render(t) }`; `ctx = { id, duration, ground, timing:{words[]}, sting, objects, nk, assets:'assets/' }`. `render(t)` pure (no clock, randomness, CSS animation, network); imports only `../kit/`. Sound cues `assets/frames/<id>.events.json`: `[{t, kind, what?, dur?}]` (`whoosh`, `sting` banned). Real Case hard-wires frame 1 = sting, frame 8 = close.
- **components/** (`import * as nk from '../kit/components/index.js'`): dom (`installKit`, `h`, `place`, `marked("text [[word]]")`, `markOf`, `filler`), scenes (`board`, `whiteboard{framing}`, `newspaper{…}`, `filmGrain`), evidence (`clipping`, `article`, `pullQuote`, `printout{kind:'post'…}`, `notice`, `indexCard`, `evidenceTag`, `dictionaryClipping`, `polaroid{cutout,caption}`, `cutout{src,edge}`, `logoPrint`, `silhouette`, `tape`, `stamp`, `caseFolder`), fasteners (`pushPin`, `cord`, `magnet`), marks (`inkLayer`, `markerCircle`, `markerUnderline`, `markerArrow`, `markerCross`, `highlight`, `markerNote`, `markerDrawing` → `{el, length, seconds, progress(u)}`, `done`), camera (`cameraRig(scene).key().push()`, `rackFocus`), `COLORS`, `geo` (`FRAME{w:1080,h:1920,safe}`, easing, rng), `motion.{arrive,pin,magnet,swing}`.
- **CLIs** (run from project root; JSON out; exit 1 on error): `mount.mjs` (writes `compositions/frames/<id>.html`, fills caption DARK/QUIET), `pace.mjs` (after `audio.mjs sync-durations`; cuts silence −40 dB, gaps 0.15/0.2, writes `assets/timing/<id>.json`), `try.mjs` (8 frames, 3 grounds, determinism — must be forked), `bounds.mjs` (`coverProblems`, `wallProblems`, `CAPTION_BAND{260..560}`, `MIN_TEXT_PX=26`), `sound.mjs` (`placeSound(root)` → `assets/sfx/events.wav`), `music.mjs` (`placeMusic(root,{search,download})`, HeyGen catalog, `BED_LUFS=-16.5`, `NO_REPEAT=3`), `close.js` (AI NEWS EXPLAINED close — replace), `frames.mjs` (`parseFrames(storyboard)` from `## Frame N — Name` + `- key: value`; `STING_FRAME=1`, `CLOSE_FRAME=8` — fork), `assemble.mjs` (pace → mount → music → sound → `captions.mjs build` → `assemble-index.mjs` → `transitions.mjs inject`, from `.claude/skills/faceless-explainer/scripts`), `gallery.mjs`.
- **Smoke:** `npx tsx explainers/real-case/smoke/run-smoke.ts [--out dir] [--no-render]` (no model, no HeyGen).
- **Render env:** `HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_NO_UPDATE_CHECK=1`.

## 5. Photo finder (`lib/social/photos/`)
- `searchVisual(request:{kind, query}, ctx: SearchContext, deps: PhotoDeps, slide) → {candidates (≤2), steps, identity}`; kinds `person|company|logo|product|event|thematic|setting`; routes: person → wikidata, named article; company → CEO/HQ pool, official, named article; logo → P154; product → articles, Commons; event → named article, Commons, Openverse; thematic/setting → StockSnap, Commons, Openverse; bank per `BANK_ROUTE`.
- `PhotoDeps = { jev: JevAsk; http?; stock?; commons?; vision?; faces?; secondPhotos?; tagSheet?; bank?; size? }`; `newSearchContext(brief /*social Brief: subjects[], facts, the_news*/, pages, {...})`. Needs an adapter from our fact sheet to the social `Brief`.
- `Candidate = {url, credit, source, width, height, qid, subject, plate?, faces?, lane, date, title, verified}`.
- `sources/*`: `Source = (request, run) => Promise<Candidate[]>` — `personSource`, `companySource`, `logoSource`, `articleSource('official'|'named')`, `stocksnapSource`, `openverseSource`, `commonsSearchSource`, `createCommonsSearch({http})`, `bankSource`.
- `used-photos.ts` (`NO_REPEAT_DAYS=7`, `UsedPhotoLog`), `credit.ts` (`classifyCredit`), `faces.ts` (`detectFacesLive`, MediaPipe in headless Chromium), `identity.ts` (`checkIdentity({name, role}, brief, {jev, http})`), `size.ts` (`createSizeProbe`, floors 1080/600), `vision.ts` (`createVisionCheck({create})`), `p18.ts` (`subjectP18`).
- Jev here is `JevAsk` (`lib/social/jev/client.ts`: `createJevAsk`, `capped`, `jevCostUsd`).

## 6. Logo bank and blue chips
- `lib/social-hub/logo-bank.ts`: `logoFor(companyId)`, `logoForPlayer(p)`, `logoForPlayerId(id)`; `BankedLogo = {id, name, qid, file (PNG under lib/social/render/assets/logos), width, height, plate, credit, source, mark?, provenance}`.
- `lib/social-hub/blue-chip-players.ts`: `BLUE_CHIP_PLAYERS` (~43: 25 companies, 18 people); `BluePlayer = {id, kind, name, aka?, qid (null for people), companyIds[], rollsUpTo?, jevLabel, jevRoster, tokens[], aliases[]}`; `bluePlayer(id)`, `companiesOf`, `peopleOf`, `BLUE_CHIP_HEADLINE_MATCH`.

## 7. Media library / photo bank (`lib/media-library/`)
- `createBankReader({query, settings?, now?}).find({kind, query, qid, recent, cover, limit}) → BankHit[]` (`{photoId, url, urls[], source, lane, credit, title, date, width, height, qids[], subjects[], tags[], faces, plate}`).

## 8. Prompt caching (`lib/anthropic-cache.ts`)
- `cachedSystemText(text, ttl='1h')`, `withToolCache(tool, ttl)`, `withConversationCache(messages)`, `cacheUsageFromMessage`. Price with `lib/anthropic-pricing` (`priceAnthropicUsage(usageBucketsFromMessage(msg,'1h'), {modelId})`, `priceAnthropicMessages`).

## 9. Hub news pool (`lib/stories/`)
- No news-by-player reader. Closest: `livePoolReads(db, now)` → `gatherPool(reads)`; `StoryCandidate = {key, origin, ref, headline, sourceName, url, body, publishedAt, nativeScore, photo?}`. Filter by a player's `tokens` / `BLUE_CHIP_HEADLINE_MATCH` (to be written).

## 10. HeyGen voice
- Voice id = Explainer setting `voice_id` (`lib/explainers/settings.ts`). TTS by `node <SKILL_DIR>/scripts/audio.mjs --script ./SCRIPT.md --storyboard ./STORYBOARD.md --hyperframes . --out ./audio_meta.json --voice "$HELIOS_VOICE_ID"` then `audio.mjs sync-durations` (`explainers/hyperframes-skills/faceless-explainer/scripts/audio.mjs` → `media-use/audio`). No TS wrapper exists.

## 11. Helios caption skin (`explainers/frame-presets/helios/caption-skin.html`, read-only; mirror)
- Composition `captions`; holes `GROUPS`, `DURATION` (captions.mjs), `DARK`, `QUIET` (mount.mjs); tokens `--cap-ink --cap-canvas --cap-accent --cap-accent-2 --font-display --font-body`.
- Look: lowercase Pragmatica Extended Bold 74px, band top 292px (y 250–570), pages ≤7 words / 2 lines broken at sentence ends, typewriter letters over each word's spoken time, page holds ≤1.2s. Real Case fork: `explainers/real-case/presets/ai-news/caption-skin.html`.
