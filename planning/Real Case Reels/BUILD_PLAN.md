# Real Case Reels — build plan

Decisions: `DECISIONS.md` (RC-xx). Milestones run in order, each meeting its Accept line before the next,
with a report at every boundary. Everything stays local (`reels-iterations`): no commits to main, no
deploys, no Supabase apply until a run validates it.

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

## Milestones

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
