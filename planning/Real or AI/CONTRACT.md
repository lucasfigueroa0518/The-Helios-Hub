# Real or AI?: build contract (Stage 6 draft)

Decisions RA-1 to RA-18 are in PLAN.md (same folder).

**Where it's built**
- Worktree `Helios-Hub-roa`, branch `feat/real-or-ai`, created from `feat/ai-trivia` at ebf69de1.
- **Never edit an AI Trivia file** (`lib/stories/trivia/**`, `lib/stories/build/ai-trivia.ts`, `tests/trivia-*`); import from them.
- Free vs. Paid 2.0 (`Helios-Hub-fvp`, `feat/fvp-2`) is reference only. Copy its patterns (daily run, pool cap, archive, history), never its files.

**Hard rules**
- No live Claude, Jev, OpenAI image or web calls in tests or by builders (CLAUDE.md Rule 1).
- Prompts go through `writeStructured`, which caches tools and system.
- Never run `tests/*.integration.ts` or prefix-glob tests.
- Builders download nothing (the lead session fetches the dataset, RA-18). No commits.

## 1. Names
- **Series:**
  - New key `real_or_ai`, label "Real or AI?", days `[2, 6]`, Free vs. Paid's window, `auto:false`, style `polished`.
  - `free_vs_paid` becomes `enabled:false`. It stays in the `Series` union and SQL CHECKs so its history loads, and is not requestable.
- **Pool:** key `roa:<imageKey>`, origin `model`, `PoolEntry` kind `'roa'`. Settings record key `roa_daily`.
- **Image key:** `sha1(bytes)` first 16 hex characters, so the same image never enters twice.
- **Prompts:**
  - `roa-write@1`: the daily candidate specs.
  - `roa-reveal@1`: the reveal line, with the image attached.
- **Jev set:** `roa-screen@1` (vision, experimental images header).
- **Cost components:** `roa-write`, `roa-image`, `roa-screen`, `roa-reveal`.
- **Frame roles:** `roa_question`, `roa_reveal`.
- **Set payload:** `payload.roa`.
- **Tables:** `stories.roa_archive`, `stories.roa_lab`.
- **Storage:** candidate images at `roa/candidates/<imageKey>.jpg` in the stories bucket.
- **Hub page:** `/stories/roa-lab`.

## 2. Data (`db/stories_real_or_ai.sql`, idempotent, applied after `db/stories_ai_trivia.sql`; apply needs Lucas)
- Add `real_or_ai` to the series CHECKs, wherever `ai_trivia` was added.
- Add `roa_question` and `roa_reveal` to the `stories.frames` role CHECK.
- `stories.roa_archive(key text, payload jsonb, reason text check (reason in ('cap','screen','provenance')), archived_at timestamptz default now())`, indexed on key.
- `stories.roa_lab(id bigserial primary key, batch_id text, image_key text, truth text check (truth in ('real','ai')), guess text check (guess in ('real','ai')), ms int, created_at timestamptz default now())`.

## 3. Shapes (`lib/stories/roa/types.ts`, owner A; written by the lead, A may add helpers but not rename)
```ts
type Truth = 'real' | 'ai';
type Trap = 'too_perfect' | 'impossible' | 'mundane' | 'amateur' | 'twin';  // too_perfect, impossible → real; mundane, amateur → ai; twin → a real + ai pair
type Subject = 'nature_weather' | 'animals' | 'cities_architecture' | 'food' | 'everyday_interiors' | 'travel_spots'
  | 'space' | 'vehicles' | 'crowds_events' | 'old_photos';
type Provenance =
  | { kind: 'bank' | 'commons' | 'nasa'; url: string; licence: string; credit: string; place?: string; year?: string }
  | { kind: 'generated'; model: string; prompt: string; createdAt: string }
  | { kind: 'dataset'; dataset: string; id: string; model?: string }
  | { kind: 'viral'; url: string; firstSeen?: string; model?: string };
type RoaCandidate = { imageKey: string; truth: Truth; subject: Subject; trap: Trap; provenance: Provenance;
  storagePath: string; twinOf?: string };
type RoaScreen = { pass: boolean; reasons: string[];   // reasons: visible_tell, real_person, brand, readable_text
  difficulty: number;                                  // 0–1, chance a viewer gets it wrong in a 3-second look
  tellBox?: { x: number; y: number; w: number; h: number } };  // 0–1 image coordinates, AI only
type RoaPoolPayload = { kind: 'roa'; c: RoaCandidate; screen: RoaScreen; reveal: string; writtenOn: string };
type RoaQuestionData = { role: 'roa_question'; round: 1 | 2; photo: Photo };
type RoaRevealData = { role: 'roa_reveal'; round: 1 | 2; photo: Photo; truth: Truth; line: string;  // ≤ 10 words (RA-13)
  tellBox?: TellBox; prompt?: string;                  // RA-17: subtle tell circled, else (our own image) the prompt that made it, ≤ 25 words
  proof: string };                                     // real: "place, year · credit"; ai: model or source
type RoaSetPayload = { rounds: Array<{ key: string; truth: Truth; difficulty: number; provenance: Provenance }> };
```
**Validator limits**
- The reveal `line` is ≤ 10 words and ≤ 70 characters. No `!`, no emoji.
- `proof` is ≤ 60 characters.
- Every candidate has complete provenance (a real photo needs licence and credit).
- An image key is never in a published set.

## 4. Flow and owners
| Owner | Files (one owner per file) | Delivers |
|---|---|---|
| **A: Engine** | `lib/stories/roa/{types,map,daily,generate,real,intake,screen,reveal,history,validate,prompts,questions}.ts`, `lib/stories/build/real-or-ai.ts`, `lib/stories/pool.ts`, the `roa` lines in `lib/stories/prompts.ts` and `lib/stories/questions.ts`, `scripts/roa-import.ts`, tests `tests/roa-engine-*.test.ts` | See **Owner A** below. |
| **B: Slides + lab** | `lib/stories/roa/render/{RoaSlide.tsx,roa.css}`, the `roa_*` case in `lib/stories/render/StoryFrame.tsx`, `app/stories/roa-lab/**`, `app/api/stories/roa-lab/route.ts`, `lib/stories/roa/lab.ts`, tests `tests/roa-slides-*.test.ts`, `tests/roa-lab-*.test.ts` | See **Owner B** below. |
| **C: Plumbing** | `lib/stories/render/types.ts`, `lib/stories/render-stage.ts`, `lib/stories/worker.ts`, `lib/stories/build/index.ts`, `lib/stories/schedule.ts` / series registry, `db/stories_real_or_ai.sql`, `scripts/apply_stories_schema.js`, hub labels (`lib/social-hub/adapters/stories.ts`, `lib/revisions/descriptions/stories.ts`, cost-page stages), `package.json` (`@typesafe-ai/sdk` → 0.7.0), `docs/social-overnight.md`, tests `tests/roa-plumbing-*.test.ts` | See **Owner C** below. |

**Owner A: Engine.** `runRoaDaily(deps)` makes 4 candidates a day (RA-16):
1. **Specs:** one `roa-write@1` call (Sonnet, `settings.models.copy`, no web search) picks 4 cells (subject × trap), balanced 2 real and 2 AI. For AI cells it writes the generation prompt (R2, mundane realism, no real people, brands or readable text). For real cells it writes the photo search words.
2. **Images:**
   - AI: `gpt-image-2` portrait through `lib/reels/visual/image.ts`.
   - Real: the bank reader first, then Wikimedia Commons Featured/Quality pictures and the NASA image API (free, keyless, licence and credit recorded).
   - Twin: the real image, then the AI twin from its description.
3. **Screen:** Jev `roa-screen@1` with the image. It rejects tells a viewer would spot in a 3-second look (R4), real people, brands and readable text, and scores difficulty. AI only: a subtle tell found on close inspection is boxed via `jev-preview` (RA-17).
4. **Reveal:** `roa-reveal@1` writes the line (R7). AI with a tell box: the line names that subtle tell. AI without one: ours shows the prompt; a dataset or viral image names a subtle tell in words, else it is archived with reason `screen`.
5. **Store:** validate, store the image, write the pool row, record `roa_daily` in a `finally`.

**Pool (`pool.ts`):**
- `roa:` rows are exempt from the stale and not-returned drops.
- `real_or_ai` is capped at 20 by difficulty; dropped rows go to `roa_archive` with reason `cap`.
- A Jev fail goes to the archive with reason `screen`.

**`buildRealOrAi`:**
1. Draw each round's truth 50/50 on its own (R5).
2. Take the hardest pool row of that truth, with the two rounds from different subjects. A twin pair may fill both rounds.
3. Re-check provenance; a failure goes to the archive with reason `provenance`, and the builder moves on.
4. Return frames `[roa_question 1, roa_reveal 1, roa_question 2, roa_reveal 2]` with `payload.roa`, and mark the pool rows used.
5. Fewer than 2 usable rows → skip, logged.

**`scripts/roa-import.ts`:**
- Reads a local folder of images plus `provenance.json` (dataset or viral, AI only, RA-5).
- Screens them like the daily run.
- Refuses any image whose provenance lacks `kind`.

**Owner B: Slides + lab.**

*Slides*
- Still 1080×1920 JPEGs through the existing `framesHtml` and `openRenderer`, in AI Trivia's Instagram-native look (RA-12): classes and pen styling imported from `lib/stories/trivia/render`.
- **Question slide:** the photo full-bleed, not dimmed, plus "Real or AI?" in Classic text (R6). Nothing else.
- **Reveal slide:** the same photo, slightly dimmed, with:
  - "REAL" in a white highlight box, or "AI" in an orange highlight box
  - the line, in a soft dark box
  - the proof, small
  - AI only: a static pen circle around `tellBox` when present, else the `prompt` in a white Typewriter-style box (Courier Prime from `explainers/reel-ai-drama/kit/fonts`, with its OFL)
- Contrast checked like Trivia's. All within the safe zones.

*Lab* (`/stories/roa-lab`, signed-in hub page; the memes lab at `app/memes/lab` is the model)
- Shows a blind sample of the current `real_or_ai` pool (up to 20, shuffled) for 3 s each, then two buttons: Real / AI.
- Writes `roa_lab` rows. Shows the batch score at the end: ≤ 62% "engine passes", else "selection too easy" (RA-7).
- Never writes to the pool (RA-4).

**Owner C: Plumbing.**
- Series registry and the new roles. `real_or_ai` is NOT in `VIDEO_SERIES`, so render-stage takes the still path.
- The worker runs `runRoaDaily` once per pool day after the 3:00 refresh, as Trivia's.
- `build/index.ts` dispatches the builder.
- Schema file, labels (Question / Reveal; origin `model` reads "AI writer").
- **SDK upgrade:** the worktree gets its own `node_modules` (remove the symlink, `npm install`), so the shared checkout is untouched. The upgrade must keep every existing Jev caller compiling and every test passing.

Interfaces: A exports `runRoaDaily`, `buildRealOrAi` and the types. B exports `RoaSlide` (through StoryFrame) and the lab. C calls them and owns no Real or AI logic.

## 5. Acceptance (pass/fail, offline)
- **A:**
  - With stubbed `create`, image and Jev calls, `runRoaDaily` writes 4 pool rows (2 real, 2 AI).
  - The validator rejects:
    - an 11-word line
    - `!` or an emoji
    - a real photo without a credit
    - a used image key
  - Pool: 21 rows → 20, and the dropped row is in `roa_archive`.
  - Builder:
    - it gives 4 frames in order
    - over 1,000 seeded draws, all four truth patterns (RR, RA, AR, AA) appear
    - fewer than 2 rows → skip
  - Import: an entry without provenance is refused, and a dataset entry marked real is refused.
- **B:**
  - The fixture renders 4 JPEGs at 1080×1920 and ≤ 8 MB.
  - Element counts via `data-el`: question 2 (photo, label); reveal ≤ 5; a reveal never has both a pen circle and a prompt.
  - Contrast passes.
  - Lab API: it records guesses, the score maths is right (≤ 62% passes), and it makes no pool writes.
- **C:**
  - `npm test` passes and `tsc --noEmit` is clean, including after the SDK upgrade.
  - A `real_or_ai` set flows through `tests/stories-harness.ts` (PGlite): stubbed build → still render → stubbed publish with 4 image containers.
  - `free_vs_paid` history still reads.
- Every prompt diff passes the review lens.

## 6. Not in this build
- Schema apply to production.
- Social VM deploy.
- Downloading any dataset.
- The first live run.

Each needs Lucas's go-ahead with a cost estimate (Stage 8).
