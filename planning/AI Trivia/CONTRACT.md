# AI Trivia: build contract (Stage 6)

Branch `feat/ai-trivia` (worktree `Helios-Hub-trivia`, based on origin/main 941fdcae). Decisions are AT-1 to AT-20 in PLAN.md.
Every name below is shared. A builder who needs a name that isn't here asks; nobody invents one.
Hard rules: no live Claude, Jev or web_search calls in tests or by builders (CLAUDE.md Rule 1). Prompts use
`writeStructured`, which already caches the tool and system. No commits until Lucas approves the output.

## 1. Names
- Series key `ai_trivia`, label `AI Trivia`. `guess_the_number` is retired: it stays in the `Series` union and SQL CHECKs
  (its history still loads), gets `enabled:false`, is removed from `SERIES` for new requests, and its builder, prompts and
  sources are deleted.
- Days `[0,1,4]` (Sun, Mon, Thu; JS `getDay`), window 08:30–10:00, `auto:false`, style `polished`.
- Pool key `trivia:<cellId>`, pool origin `model`, `PoolEntry` kind `'trivia'`.
- Cell id `t<theme 01-20>a<angle 01-20>` (e.g. `t07a13`). Themes and angles come from the approved CONTENT-MAP-DRAFT.md.
- Prompt ids `trivia-write@1` and `trivia-check@1`; Jev set `trivia-score@1`.
- Components (cost rows / jev logs): `trivia-write`, `trivia-score`, `trivia-check`, `trivia-music`.

## 2. Data (one schema file: `db/stories_ai_trivia.sql`, idempotent; apply needs Lucas's go-ahead)
- Add `ai_trivia` to the series CHECKs in stories.sets, stories.pool and stories.history, plus the social_hub_schema.sql CHECKs found by the map.
- Add `model` to the stories.pool origin CHECK.
- `stories.trivia_cells(cell_id text primary key, theme smallint, angle smallint, state text check (state in ('open','reserved','closed')) default 'open', pool_key text, updated_at timestamptz default now())`, seeded with all 400 cells.
- `stories.trivia_archive(key text, cell_id text, payload jsonb, reason text, archived_at timestamptz default now())`.
- `stories.frames`: add `media text not null default 'image' check (media in ('image','video'))`, `poster_path text`, `media_bytes int`.
- Cell lifecycle: writer output validated → `reserved`; pool row dropped (cap) or archived (fact-check) → `open`; set published → `closed`.

## 3. Shapes (`lib/stories/trivia/types.ts`, owner A)
```ts
type Difficulty = 'hard' | 'medium' | 'easy';           // option count: hard 2, medium 3, easy 4
type TriviaOption = { letter: 'A'|'B'|'C'|'D'; text: string };
type Scorecard = { surprise: number; about_you: number; social_currency: number }; // each 0–1
type TriviaQuestion = {
  cellId: string; question: string; difficulty: Difficulty; options: TriviaOption[]; correct: 'A'|'B'|'C'|'D';
  answerLine: string;         // why the answer matters to the viewer
  photoSubject: string; answerPhotoSubject: string;   // queries for findPhoto
  sources: string[];          // URLs the writer used
  writerScore: Scorecard;
};
type TriviaPoolPayload = { kind: 'trivia'; q: TriviaQuestion; jevScore: Scorecard; score: number; writtenOn: string };
type FactCheck = { verdict: 'pass' | 'fail'; problems: string[]; sources: string[] };   // pass = clean, problems empty
```
Score = mean over the 6 numbers (3 writer + 3 Jev). Validator limits: question ≤ 110 chars, option ≤ 32,
answerLine ≤ 120; no `!`, no emoji (the existing stories emoji check), option count matches difficulty, `correct` is
one of the letters, cell is open.

## 4. Flow and owners
| Owner | Files (one owner per file) | Delivers |
|---|---|---|
| **A: Ideas** | `lib/stories/trivia/{types,map,cells,validate,daily,prompts,questions}.ts`, `lib/stories/build/ai-trivia.ts`, `lib/stories/pool.ts`, the registry lines in `lib/stories/prompts.ts` and `lib/stories/questions.ts`, tests `tests/trivia-*.test.ts` (ideas) | content map; `runTriviaDaily(deps)`, which samples 12 open cells, makes one `trivia-write@1` call (Sonnet `settings.models.copy`, webSearch maxUses 5), validates, reserves cells, runs Jev `trivia-score@1` per question and writes pool rows. pool.ts exempts `trivia:` keys from the not-returned and stale drops, caps `ai_trivia` at 20, and frees cells of dropped rows. `buildAiTrivia` is the builder: top pool row → `trivia-check@1` (webSearch maxUses 3) → fail: archive, free cell, next (≤5 tries; none pass → skip with `triviaSkip` record) → `findPhoto` ×2 (answer reuses slide 1 if none) → `pickTriviaMusic` (from B) → returns 2 frames (`question`, `answer`) with `copy` = the question fields and `payload.trivia` = {q, scores, factCheck, music}. |
| **B: Video** | `lib/stories/trivia/render/*` (TriviaSlide.tsx, trivia.css, timeline.ts, clip.ts, audio.ts), `lib/stories/trivia/music.ts`, tests `tests/trivia-render-*.test.ts` | `pickTriviaMusic(deps): {trackId, url, bpm, beatMs[], startMs}` (HeyGen catalog via the AI Drama music kit, AT-26; one mood, not used in the last 10 sets). `renderTriviaClips(frames, music): {clips:[{role, mp4: Buffer, poster: Buffer(jpeg)}]}`: HTML at 1080×1920, Field Notes fonts (Pragmatica Extended Bold, Roboto Light from `lib/stories/render/assets`), photo dimmed, contrast checked on sampled frames (0, 1, 2.5, 4.9 s), motion M1–M7 with the PLAN timing, fixed copy "AI TRIVIA" and "Tap to reveal" (AT-25), HyperFrames at 30 fps, 5.0 s each. Clip 2's music continues at clip 1's end offset; the sting `lib/stories/trivia/render/assets/reveal-sting.wav` (AT-27) starts on clip 2's first frame (its card flip lands with the viewer's tap) and its hit is at +0.60 s; the reveal (correct option lights orange) lands on that hit, and the music is offset so a beat falls on the hit (shift the music start, never the sting); loudness normalised like AI Drama (loudnorm, AAC 192k, 48 kHz). Poster = the clip's frame at 4.5 s (clip 1) and 3.0 s (clip 2), used for the Haiku review. |
| **C: Plumbing** | everything in the map's §1 wiring list except A's files; `db/stories_ai_trivia.sql`; `lib/stories/render-stage.ts`, `lib/stories/storage.ts`, `lib/stories/publish/*`, `lib/stories/worker.ts`, `lib/intake/*` GTN order removal, docs/social-overnight.md; its tests | series wiring + GTN retirement; the worker runs `runTriviaDaily` once per pool day at the 3:00 refresh; render-stage branches on series `ai_trivia` → `renderTriviaClips`, review runs on posters, uploads `sets/<id>/NN-role.mp4` (`video/mp4`) + poster jpg, `media='video'`; publish adds `createStoryVideoContainer(videoUrl)` (`media_type:'STORIES'`, `video_url`), signs for 7200 s, polls every 10 s up to 10 min until FINISHED (fail on ERROR/EXPIRED), publishes in order; on publish closes the cell (`closeCell` from A). The video render must not overlap another video render on the VM (per-hour rule): the 3:00 Stories hour has no other video renderer today; render-stage takes the existing render lock if one exists, else documents the slot. |

Interfaces between owners: A exports `closeCell`, `freeCell`, `runTriviaDaily`, `buildAiTrivia`, the types. B exports
`pickTriviaMusic`, `renderTriviaClips`. C calls them and owns no trivia logic.

## 5. Acceptance (pass/fail, offline)
- A: with a stubbed `create` returning a canned tool response, `runTriviaDaily` writes 3 pool rows, reserves 3 cells, and rejects a canned question with `!`, an emoji, or a wrong option count. Pool cap test: 21 rows → 20, and the dropped row's cell is open. Builder test: canned fact-check fail → archived and cell open; the next row passes → 2 frames.
- B: `renderTriviaClips` on a fixture produces 2 MP4s of 5.0 s ±0.05, 1080×1920, 30 fps, with an audio stream; the reveal frame lies within ±1 frame of a beat; contrast passes on the fixture photos (the render test is opt-in like `test:stories:render`).
- C: `npm test` passes; `tsc --noEmit` is clean; a series of `ai_trivia` flows through the harness (tests/stories-harness.ts, local PGlite) from request → build (stubbed) → render (stubbed clips) → publish (stubbed graph) with `video_url` containers; GTN no longer requestable, and its history still reads.
- Every prompt diff passes the review lens (altitude, no examples, no contradictions, single ownership, strength matches intent).

## 6. Not in this build
Applying the schema to production, the social VM deploy and the first live run: all of these are Lucas's go-ahead (Stage 8).
