# One-box seeding v2: every content type (2026-11-24)

Status: DRAFT for Tommy's approval. Builds on `2026-11-04-one-box-seeding-design.md` (v1), which is still the reference for
anything this document does not change (request table, progress cards, the 6-minute stale rule, the link hint, the
verifier, the ledger, prompt caching, testing and Rule 1). **(Tommy)** = his words or choice; **(my call)** = mine, open to
correction. Branch: `claude/one-box-seeding-9dc0a9`, brought up to date with `main-l2xadw` on 2026-11-24 (merge b5a4b3ac).

## Why

Lucas could not seed an AI Drama idea, and seeding looks different on every type (six forms, six field sets, six button
labels). Tommy wants one "Seed an idea" front end across every content type, the same way the Settings standard made
Settings the same everywhere.

## What changed since v1

- The Stories split (SS-1) turned Stories into three types: Morning Download (`stories`), Are you smarter than AI?
  (`ai_trivia`) and Real or AI? (`real_or_ai`). Guess the Number and Free vs. Paid are retired, so Morning Download's
  Headline / Number / Tool series choice goes away.
- Field Notes (`field_notes`) and AI Drama Reels (`reel_ai_drama`) were added.
- **The one-box's job is wider (Tommy, 2026-11-24): "the claude call is there to help build out what gets scored (goes for
  all kinda)".** v1 said "find the real source". v2: the call turns what you typed into the full input that type's own
  scoring needs; then that type's normal checks and scoring run, exactly as for the night's items. Finding a source is
  how the article types get there; the new types get there differently (below).

## What Tommy asked for (v2)

- One box everywhere, the v1 form: a sentence or two, optional "Add a link". Same button, drawer, title, progress cards
  and result notes on every type. **(Tommy, v1 and 2026-11-24)**
- Trivia takes a **topic**. Real or AI? takes a **subject**. **(Tommy)**
- A Real or AI? seed makes a **twin pair**: one real photo and one AI image made to match its scene. **(Tommy)**
- AI Drama gets a seed path. **(Tommy)**
- **Each seed runs where its type already runs (Tommy chose approach 1).**
- AI Events still has no seed (decided 2026-11-02, v1). **(my call: unchanged)**

## Goals, non-goals, anti-goals

Goals: one seed front end for nine types; a seeded item goes through the same code as the night's items for its type
and is indistinguishable from one, apart from "Yours"; every seed's spend has a hard per-seed limit; failures add nothing
and say why.

Non-goals: no change to any type's scoring, checks, caps, expiry, ranking or the night; no new pool shape for any type;
AI Events.

Anti-goals: a second copy of a type's pipeline written for seeds; a seed that silently spends past its limit; any loop
over existing rows (Rule 2: a seed reads only the one pool it is filed into, for duplicates); any live call by a test or
an agent (Rule 1: the first live seed of each type is Tommy or Lucas clicking in the built app).

## Approaches (the how, decided 2026-11-24)

1. **Each seed runs where its type already runs. Chosen by Tommy.** One shared request table and card; Vercel runs the
   article types, Explainers and Field Notes (v1 as built); the Stories worker runs Trivia and Real or AI? requests; the
   drama worker runs AI Drama requests. Both workers already poll every 15 seconds. Seeds reuse each type's own writer,
   checks and scoring. Cost: worker code changes, so both GCP workers are redeployed (worker-sync rule).
2. Everything on Vercel. Rejected: the Trivia writer, Real or AI?'s photo finder, image generation and photo bank, and the
   AI Drama producer would have to be made callable from a route (copying or untangling worker code), and a twin pair
   (photo search, image generation, vision screen) risks the 5-minute limit.
3. Everything on the workers. Rejected: throws away v1's working Vercel path and makes article seeds depend on a worker
   being up.

## Design

### 1. The front end (one form, every type)

`OneBoxSeedForm` (built) becomes the only form in `SeedButton`. Per type it varies only:

- the placeholder (what to type; table in section 4),
- the price line on the button: "Add · about N¢ (M¢ limit)", from that type's estimate and limit (section 5),
- one line under the button saying what happens, in that type's words.

Removed: the Stories series choice (retired series). The six old forms are deleted once the one-box is switched on for
every type (v1's plan: they stay until the prompts are approved; **(my call)** the switch stays one flag for all types, so
the front end never mixes old and new forms).

`seedable` becomes true for `ai_trivia`, `real_or_ai` and `reel_ai_drama`; `SeedVertical` excludes only `ai_events`.

### 2. Requests and where they run

`social_hub.seed_requests` (built) gains `runner text NOT NULL` (`vercel` | `stories` | `drama`) **(my call)**, set at insert
from the vertical. `POST /api/seed/one-box`:

- `vercel` types: as built (work in `after()`).
- `stories` and `drama` types: insert the row with `stage = 'queued'` and return. Nothing runs in the request.

Each worker, on every poll, claims at most one `queued` request for its runner (`UPDATE … SET stage='working' … WHERE id =
(SELECT id … FOR UPDATE SKIP LOCKED LIMIT 1)`), runs it, and finishes it with the same `doneRequest` / `failRequest` the
Vercel path uses. The card reads "Waiting for the worker" while queued.

Stale rule **(my call)**: a request queued more than 10 minutes reads "The worker didn't pick this up; nothing was spent"
and is never run later (a worker that comes back after that skips it). A claimed request keeps v1's 6-minute rule, with
v1's "may have been added" wording when it died while filing. Real or AI? gets 10 minutes once claimed (photo search plus
up to two images).

Free pre-checks stay as v1 (open-seed cap per type, 3 working at once, same text within 60 s).

### 3. Shared rules for every Claude call

- Prompt caching per CLAUDE.md: tools, then a static system prompt per type, then the user turn with the person's words
  and the pool's open headlines. The breakpoint sits on the stable prefix. A new or changed call without `cache_control`
  is a defect.
- New prompt wording gets new version strings, marked draft and not approved, behind `ONE_BOX_SEED_PROMPT_APPROVED`
  (v1). Every new or changed prompt below is draft until Tommy approves it.
- Spend goes through the v1 `Ledger` with that type's limit: each billable step's worst case is checked before it runs,
  actual cost is added after; a step that would cross the limit is not started and the seed fails with the amount spent.
- The pool check (v1): the call sees the headlines or titles already open in that one pool and reports `duplicate_of`
  instead of building a repeat. Each type's own duplicate check stays the backstop.

### 4. Per type: what you type, what the call builds, what runs after

| Type | Runner | You type | The call builds | Then (unchanged code) |
|---|---|---|---|---|
| Text on Screen | vercel | the story | article (search) + verifier, as v1 | `addReelSeed` |
| Carousels | vercel | the story | as v1 | `addCarouselSeed` |
| Last Few Days | vercel | the story | as v1 | `addLfdSeed` |
| Morning Download | vercel | the story | as v1, headline shape only | `seedIdea` (`morning_download`), notes = your words |
| Explainers | vercel | a concept | concept title + explanatory sources, as v1 | `addAndEvaluateTopics` |
| Field Notes | vercel | the tool, skill or repo, and what you get; a link if you have it | with a link: `leaf` and `want` only (no search, no page read); without: official page (search) + verifier, then `leaf` and `want` | `saveSeededLink` path of `/api/field-notes/seed`; note = your words |
| Trivia | stories | a topic | 1 or 2 questions on it (below) | validator, repeat check, Jev `trivia-score@3`, pool |
| Real or AI? | stories | a subject | one twin spec (below) | real photo find, AI image, Jev screen, reveal, pool, bank offer (`intakeCandidate`) |
| AI Drama | drama | the story | one pitch (below) | `checkPitch`: dedupe, drama and material scores, visuals check, pool |

**Field Notes: free with a link, search without one (Tommy, 2026-11-24: "free with a link, but the ability to search
also").** The person's words become the tip's note (the Writer reads it as ground truth, as today).
- *With a pasted link:* no search and no page read (today's rule: the page is read when someone presses Generate). One
  small call with no tools picks `leaf` and `want` from the person's words, then the link goes into the existing
  `/api/field-notes/seed` path. About 1¢. The button reads "Add · about 1¢" once a link is in.
- *Without a link:* the search path. The call finds the tool's official page, the verifier reads it and confirms it is
  the tool described, and the same call picks `leaf` and `want`. About 12¢, with a 35¢ limit.
- In both cases an answer outside `CONTENT_LEAVES` or `WANTS` fails the seed. **(my call)**

**Trivia.** A seed variant of the daily writer: same model setting (`settings.models.copy`), same rules text and output
shape (`TriviaWriteItem`), with the topic in place of offered cells. The call places each question in the open cell
(theme × angle, `map.ts`) that fits it best; a question that fits no open cell is dropped. Up to **2** questions per seed
**(my call: the daily writer averages 4 per call at 7¢; 2 keeps the seed small and still gives the topic a second
chance to pass)**, at most 3 web searches. Then the daily writer's own path: `validate.ts`, the repeat check
(`repeats.ts`), the shorten retry, numbering (`claimQuestionNumber`), Jev, pool score as AT-61, deposit of cited pages
(SS-30). The pool cap applies as usual. A seed whose questions all fail the checks fails with the reasons.

**Real or AI?** A seed variant of `roa-write@3`: one spec with `trap = 'twin'`, the subject mapped to one of the ten
`SUBJECTS` (`map.ts`); a subject that fits none fails the seed with that reason **(my call)**. Then the daily run's twin
path, unchanged: find the real photo (shared photo finder, used-photo ledger, bank), then the AI image from the same
scene's prompt (`generateAiImage`, at most `AI_ATTEMPTS` = 2), then `intakeCandidate` for each image (screen, room,
reveal, store, pool, bank offer). No real photo found: the twin is skipped whole, as in the daily run, and the seed fails
with "no real photo of that found". If the real image pools and the AI image fails, the real one stays pooled and the card
says so **(my call: the same as a daily twin)**. The 40-image pool cap applies as usual.

**AI Drama.** A seed variant of the producer prompt: one pitch (`Pitch`, MD-100 brief) from the person's words, with
web search, the same producer model setting and the same `validatePitch`. It is inserted as `origin = 'seed'`, status
`new`, and `checkPitch` runs on it at once in the same worker job, so the card ends pooled, duplicate or rejected (with
the reason) within minutes, not at 10 PM. **(my call; replaces the "free now, researched tonight" mockup.)** Seed spend
also counts toward the nightly development cap (`nightly_dev_cap_usd`), like a Develop click; when that cap is reached
the seed fails before any call with "tonight's development cap is reached" **(my call)**.

### 5. Price and limit per seed

From the last 30 days of cost rows (2026-11-24): Trivia writer 7¢ average (4 questions, ≤5 searches, max 17¢); Real or
AI? image 17¢ each, writer 1.5¢, reveal 5¢, screen ~0; AI Drama producer 22¢ average (max 38¢), visuals check 1¢, scores
~0.

| Type | Button says about | Hard limit |
|---|---|---|
| Article types, Morning Download, Field Notes without a link | 12¢ | 35¢ (v1) |
| Field Notes with a link | 1¢ | 35¢ |
| Explainers | 15¢ | 35¢ (v1) |
| Trivia | 8¢ | 35¢ |
| AI Drama | 25¢ | 50¢ |
| Real or AI? (twin) | 30¢ | 60¢ |

**(my call; the "about" figures are estimates to be replaced by measured averages after the first seeds.)** The image
call's worst case is its known price (17¢), so the ledger refuses a second attempt that would cross 60¢.

### 6. Switching on

One env flag for all types, as v1. Before it is set: prompts approved by Tommy, both workers redeployed (both run on
`helios-social-worker` as `helios-stories` and `helios-reel-ai-drama`: `./scripts/gcp/deploy-social-worker.sh`),
migrations applied.

### 7. Builder-check answers (2026-11-24)

- **"Yours" on Trivia and Real or AI? (my call).** Seeded rows keep the daily keys (`trivia:<cellId>:<n>`, `roa:<imageKey>`)
  so numbering, the repeat check, `cellOfKey` and the game read them unchanged. "Yours" is a payload flag,
  `payload.seed = true` (jsonb, no schema change, no new origin value). The hub adapter treats it as Yours, and the three
  pool cap queries in `lib/stories/pool.ts` skip it the way they skip `seed:%` keys. Seeds can push a pool past its cap. The
  open-seed cap (10 per type) bounds that, the same as every other type.
- **What the hard limit covers (my call, same as v1).** The ledger gates every step the seed runner starts itself: the
  seed writer or producer call, the search and verifier, each image attempt, and each `intakeCandidate` or `checkPitch`
  call. Calls inside those steps that the runner can't stop are reserved up front at their measured worst case: Jev ~0,
  Real or AI? reveal 5¢, AI Drama visuals check 35¢ (its own cap), Trivia shorten 2¢. The photo finder's cost is
  measured before the limit is set. No shared pipeline is changed to take a ledger. The limit is exact for the runner's
  own steps and holds overall as long as the reserves do, which is the same guarantee v1 made.
- **A busy worker (my call; replaces the 10-minute queued rule above).** The claim runs between the worker's own steps,
  never inside the night's work. A queued seed waits while its worker finishes a set build or the 10 PM session. Its card
  reads "Waiting: the worker is busy with tonight's run". It fails only if it is still queued after 2 hours, with
  "nothing was spent", and a worker never runs it after that. A Cancel button on a queued card removes it.
- **AI Drama origin (my call).** One-box pitches use `origin = 'seed'`, like Lucas's calibration pitches. Both are
  person-provided, both are Yours, and MD-55 (a failed seed is left for the producer to rediscover) is the right rule for
  both. No CHECK change.

## Left to the builder

- Exact prompt wording for the three new seed variants and the Field Notes search, within the rules above, marked draft.
- Card wording for the new stages, in the hub's existing style.
- Where in each worker loop the claim runs, as long as it never blocks the night's work.
- Test fixtures: 1–2 items per type, stubbed model and image clients, no live call.
