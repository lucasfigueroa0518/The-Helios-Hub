# Real Case Reels (AI News Explained) — build plan

Decisions: `DECISIONS.md` (RC-xx). Format spec: `FORMAT.md`. Milestones run in order, each meeting its
Accept line before the next, with a report at every boundary. Everything stays local (`reels-iterations`):
no commits to main, no deploys, no Supabase apply until a run validates it.

## The rebuild: N1–N6 (RC-26, 2026-10-26)

**Handoff (2026-10-26):** the remaining work (N4c → N6) is specified for another agent in
`CURSOR_BUILD_PROMPT.md`.

The first live reel showed the format had been built as an analogy Explainer with true captions. N1–N6
rebuild it as AI News Explained, keeping the machinery that worked (the pool, source check, Jev, jobs,
spend caps, fact gate, worker, lab) and replacing what made it an Explainer. Internal names stay
`real_case`. No file under `lib/explainers/`, or under `explainers/` outside `explainers/real-case/`, is
edited.

### N1 · Register and spec — done 2026-10-26
- RC-26 to RC-32, `FORMAT.md`, this plan.
- **Accept:** Lucas's four calls recorded; superseded entries marked.

### N2 · News scout, fact sheet, story scoring — built 2026-10-26 (stubbed tests)
- The scout searches AI news from the last 90 days and returns, per story: the event date, a timeline,
  the cast, the moment, fallout, the reveal, since then, artifacts (verbatim text) and claims covering
  every act; the closest Explainer topic is a label only.
- Jev's story set: stakes, turn, scene, reveal, artifacts, cast, freshness; gates: private person,
  facts cover the arc, same event.
- The pool: event date, expiry at 90 days, `searches_per_night` under the ~$1 cap.
- **Accept:** stubbed tests of parsing, expiry, scoring and a cycle; explainers suite unchanged.

### N3 · The writing — built 2026-10-26; prompts await Lucas
- Director, story design, workflow, skeleton, frame-worker role, scene builder and brief for the eight
  acts; the lint for acts and artifacts; the fact gate accepts faithful paraphrase; the understanding
  test asks this format's questions.
- **Accept:** lint tests on good and bad fixtures; `prompts-for-review.md` regenerated; **Lucas approves
  the prompts.**
- Built: `story-design.md`, `storyboard-skeleton.md`, `director/SKILL.md` (plan, fix, facts phases),
  `render/brief.ts`, the lint and its fictional fixture (Harbor City Transit), the fact check
  (`news-fact-check-v1`: judges meaning, not wording), and this format's first viewer and understanding
  judge (`render/agents.ts`, `render/understanding.ts`), swapped in through a wrapped `query`. The first
  build's regex patch of the Explainer frame.md is removed (it broke on Explainer 4.0).

### N4 · The look (RC-33, RC-34, RC-37)

- **N4a · Direction stills** for Lucas, before the kit is built (as Explainer 4.0 was approved). Round 1
  (premium Helios) was rejected as too glossy; round 2 is the true-crime case board
  (`.explainers-local/previews/ai-news-truecrime/`, RC-39 to RC-42).
- **N4b · The cutout bank:** built 2026-10-26: 18 of 18 (15 from Commons, 3 photos Lucas supplied),
  `scripts/real_case_cutout_bank.ts`, approved by Lucas 2026-10-26. Object cutouts (RC-41):
  `scripts/real_case_object_cutouts.ts` searches the Hub's stock lane and cuts out locally; stock hits
  are noisy, so the kit needs an automatic pick (a cheap vision check on the cutout sheet).
  The original plan for this step: a licensed Commons portrait per blue-chip person (Wikidata P18 on a pinned
  QID, licence checked, credited), background removed on this Mac (macOS Vision), reviewed by Lucas on a
  contact sheet. Logos come from the existing logo bank.
- **N4c · The kit and the engine forks** (below): the three scenes (RC-44), their motion and sound as
  `SCENES.md` specifies (RC-46), measured marker connectors, Gochi Hand for dry-erase notes.

Finding (2026-10-26): the Explainer render engine is bound to its look. `pace.mjs` inserts an opener
from the bank and speeds up frame 1's voice; frame 8 is hard-wired to the AI BRAIN BREAK `close.js`;
`mount.mjs` only knows paper/stage/white grounds; `try.mjs` requires the title card and the dictionary
card; `music.mjs` bans cinematic and electronic beds; and `repairProjectAssembly` runs the repo's world
kit, not the job's copy. So the news kit carries its own forks of the engine scripts (pace, mount,
frames, music, sting sound, try, bounds; sound.mjs unchanged) under `explainers/real-case/kit/`, the job
gets that kit as `assets/kit/`, and this route passes its own `repairAssembly`. The frame worker's
prompt is swapped the same way as the first viewer's.

- The `ai-news` preset (frame.md, caption skin) and the news kit (artifacts, stamps, chart, timeline,
  term card, lower-third, silhouettes, sting, close); the workspace builds frame.md from this preset.
- **Accept:** a kit preview renders every component; the job workspace has no world kit, critter or
  AI BRAIN BREAK reference; screenshot to Lucas.

### N5 · Sound and voice
- The Lucas Figueroa voice (RC-38, the Explainer voice id); its own music styles and history, sfx list, sting sound.
- **Accept:** a dry workspace names this format's voice, music and sounds.

### N6 · Lab and the first live reel
- The lab titled AI News Explained with each story's date, timeline, cast and artifacts. One live news
  scout (≤ $1) and one render (≈ $6), each on Lucas's go-ahead.

## Shape

```
explainers.topics (read only) ──► seed picker ──► story scout (Sonnet + web search) ──► source check (code)
                                                                                         │
            lab page ◄── story pool (real_case.stories) ◄── Jev score + dedupe ◄─────────┘
                                │
                                └──► promote best ──► render job (director: real-case story design,
                                                       fact-check gate + rewrite loop, shared kit) ──► MP4
```

- **Own schema `real_case`** on the same database connection as Explainer Reels (`explainersDb()`), applied
  by its own idempotent `db/real_case_schema.sql`. It holds no foreign keys into `explainers`: it stores the
  inspiring topic's id and a title snapshot, so nothing on the Explainer side can be blocked or changed.
- **Read-only use of `explainers.topics`**: every non-archived topic is a possible seed (RC-08).
- **Shared render machinery**: the world kit, sound, captions, opener and close. Any shared seam pulled
  out of the Explainer render code keeps the Explainer tests passing unchanged.

## History: M1–M6 (the first build, superseded in part by N1–N6)


### M1 · Data model and story pool core (offline, no model) — done 2026-10-25
- `db/real_case_schema.sql`: settings, story cycles, topic scouts, stories (beat material, claims, sources,
  scores), cost events, Jev logs.
- `lib/real-case/`: types, schema apply, repository (seed picker over `explainers.topics`, story insert,
  pool listing, trim, scout history), scoring (weights, bar, pick), source check (fetch, HTML to text,
  excerpt match, archive fallback, URL guard).
- **Accept:** offline tests pass on PGlite (seed picker skips archived and recently scouted topics; the
  source check passes a real excerpt and fails a changed one; trim keeps the best `pool_size`); the
  Explainer test suite is unchanged and passing.

### M2 · Story scout, Jev scoring, nightly cycle (stubbed tests) — built 2026-10-26; wording awaits Lucas, then one live scout
- The scout prompt (Sonnet with the web search and web fetch tools, prompt-cached), with structured output:
  up to `stories_per_topic` stories, each with its term, beat material and claims (URL + exact excerpt,
  core or not).
- Jev question sets: story scoring (recognition, tension, illumination, mechanism fit, tellable) and the
  gates (private person at the center), plus the duplicate gate against the pool and made reels.
- `runStoryCycle`: own clock, off by default, `topics_per_night` = 3, `nightly_cap_usd` = 1.
- **Accept:** stubbed-model tests cover a full cycle (found, weak, failed topics; dedupe; trim); the prompt
  is reviewed for contradictions, example pollution and abstraction level, and Lucas approves its wording;
  one live scout of one topic only on Lucas's go-ahead (estimate given before it runs).

### M3 · Lab page — built 2026-10-26
- `/real-case/lab` (local): the story pool with scores, claims and source checks; weak topics; Find stories
  for one topic (Lucas's click authorizes that one search); Make reel.
- **Accept:** the page renders against the local database with stubbed data; buttons call the routes.

### M4 · The format's director — built 2026-10-26
- A real-case story design, storyboard skeleton and director skill (new files; the Explainer director is not
  edited), the BRIEF `## Story` block (checked facts + beat material), and the format's lint profile
  (beat sheet, word ranges, no attribution phrasing, numbers and names only from cited claims).
- **Accept:** lint tests on good and bad fixture storyboards; prompt review as in M2.

### M5 · Fact-check gate and the render route — built 2026-10-26
- Between plan and audio: the deterministic claim lint, then one cached Sonnet check per reel, sentence by
  sentence. Failures go back for rewrite (up to 2 rounds; the last says "say only what the source says, or
  cut the detail"); the reel always goes on (RC-06).
- The real-case render job on the shared machinery, its own jobs table and spend cap.
- **Accept:** stubbed tests of the gate and the rewrite loop; Explainer render tests unchanged.

### M6 · One live reel — ready; waits for Lucas's clicks
- Lucas clicks Make reel on one story he picks in the lab. Review the reel; record decisions.

## Known limits (M1)
- The source check reads HTML pages. PDF sources (some court records) can't be checked by code yet, so a
  core claim needs at least one HTML source. A PDF text extractor can come later if it matters.
- The URL guard blocks localhost and private IP literals; it does not resolve DNS.

## Running it (M6)

1. Start the local Postgres the dev server and the worker share: `npm run explainers:db` (once per session),
   then the app: `npm run dev`.
2. Open `/real-case/lab`. **Topics** → **Find stories** on one topic: one live search, an estimated
   $0.30–0.70 (the page asks first). Stories that pass the source check, the gates and the bar land in the
   **Story pool**; the rest show under **Dropped** with why.
3. Open a pooled story, read its facts and their checks, and click **Make reel**: a render costs about
   $6–8, capped at $8 (the page asks first).
4. Run the worker: `npm run real-case:worker`. It claims the job and runs plan → understanding test →
   fact-check gate → build → render. **Renders** shows its stage, spend, any flags (a cut sentence, a
   remaining misunderstanding) and the video.
