# Guess the Number: one-call redesign

2026-10-19 · Tommy, from Lucas's handoff brief (Oct 19). Branch: `unify-social-hub`.

## Why

Guess the Number picks numbers people don't want to guess and drops the context that
makes them interesting. The Oct 15 set (`4d17707a`) asked for the price of xAI's
Ultra tier ($200/month) and left out that xAI had launched it three days earlier.

The steps each work as written; the design around them fails:

1. There is no definition of a good number, only a general-appeal rubric that prices do well on.
2. The rubric's example list ("money, jobs, everyday tools") steers toward exactly the wrong numbers.
3. Choosing and writing are split, so the launch context was lost between the two calls.
4. Pass/fail questions (`want_to_guess`, `verifiable`) are averaged, so a high score elsewhere hides a veto.

## Goals

- Every posted number is one a Helios follower would want to guess, about AI, with a source page that states it.
- When the source shows the figure was just announced or changed, the copy says so.
- Ideas come from both Claude's own knowledge (confirmed by web search) and the hub's pool, competing for the slot.
- Quality first, cost second. Target about $0.15 to $0.25 a set.

## Non-goals

- Images, layout family rotation, rendering and the render review do not change.
- The pool refresh (`lib/stories/pool.ts`) does not change. It still only reads other pools (CLAUDE.md rule 2).
- No new ranking model. Jev does not rank.

## Anti-goals (failure even if it runs)

- A number whose figure comes from model memory. Memory supplies ideas; web search supplies the figure and the source.
- A wrong answer credited to a real company ("from xAI"). This is the worst failure for the series.
- A list price or other look-up fact posted as trivia.
- Example lists in any prompt or Jev question. Principles only.

## Decisions

### Settled by Lucas (brief, Oct 19)

- `want_to_guess` and `verifiable` become pass/fail gates, not averaged inputs.
- "Newly revealed" does not define a good number. It only has to be stated in the copy when it applies.
- No example lists in prompts or the rubric.
- Ideas from Claude's web search and the top items from the hub's pool compete for the slot, with no source weight.
- The model's judgment ranks; Jev is the outside veto.
- Prompt rules are mandatory, not guidance.

### Settled by Tommy (this session)

- **Topic scope: AI only, broad.** The technology, companies, people using it, public opinion
  about it, and its history. General tech and other topics are out. Tommy's reference questions
  (for us, never for the prompt): embedding dimensions of OpenAI's model; how many users Claude has;
  the share of people who think AI ends the world within 10 years (from a study); the year of the first chatbot.
  What they share: a reader has a gut guess before thinking, the true answer lands away from
  most guesses, there is one answer a source states plainly, and the copy says when a figure was measured.
- **Jev wherever a yes/no or 0–1 judgment is needed** (gates, recency check, repeat check, difficulty), but **not for ranking**.
- **Contest rule:** the three candidates include at least one pool item and at least one idea of the model's own (`model`).
  If the pool is empty that run, three model ideas.
- **Build on `unify-social-hub`.**
- **Repeat = same subject**, not just the same news event (see §4).
- **Origin label `model`** for an idea the call came up with itself. Pool ideas keep `carousel` or
  `reels` (an unbriefed carousel story is `carousel`). Every candidate is web-confirmed, so the label
  records who had the idea, not how it was checked. Adding `model` to the `stories.candidates.origin`
  CHECK is a one-line migration Tommy approved without needing Lucas (`stories.pool` is unchanged:
  model ideas never enter the pool). A model idea's history key is `model:` plus its normalized
  label (builder's call); the same-subject check is its main repeat protection.

## The new run

```
pool finalists (code) ─┐
                       ├─► gtn-pick@1 (one Sonnet 5.5 call, web search + fetch)
recent topics (code) ──┘        │  3 finished candidates, ranked 1–3
                                ▼
                 worker fetches each source page (readPage, no model)
                                ▼
                 gtn-gate@1 (Jev) per candidate: verifiable · want_to_guess
                          · recency · repeat (stories-same-event@1)
                                ▼
         first candidate in model rank order that passes every gate → images → render
         none passes → skip the day, record why
```

### 1. Pool finalists (code)

From the series' pool rows (or the live sources when there is no pool, as today):
carousel brief numbers, Trial Reels "The Number" ideas, and shortlisted stories without a
brief. Drop anything whose story key was used in the last 30 days (`recentKeys`, as today).
Pass the top few in the pool's own order: numbers with their value, fact, counts, story
headline, outlet and URL; unbriefed stories as headline, outlet, URL and trimmed text, so the
call finds the number itself (this replaces `gtn-extract@1`, S-26's separate step).

### 2. `gtn-pick@1` (one call)

Through `writeStructured` (`lib/stories/writer.ts`), which already handles caching, the strict
output tool, server tools, `pause_turn` and cost rows. Model: `deps.settings.models.copy`
(Sonnet 5.5). Web search up to about 5 uses, web fetch up to 3.

**Cached prefix (stable):** tools, then the system prompt: the principles of a good number,
the scope, the rules below, the voice line and the frozen humanizer.
**Uncached suffix (per run):** the pool finalists and the last ~30 days of Guess the Number
topics (question and topic line of recent sets), as untrusted material.

The system prompt must state, as mandatory rules:

- What a good number is, as principles (from Tommy's reference questions, never quoting them):
  a gut guess exists, the truth surprises, one source states it plainly, it's about AI in the broad scope.
  A price or spec someone would simply look up is not a good number.
- Every figure must be confirmed by web search in this call. Never answer from memory.
- Cite one page that states the figure in its text (not only in an image, chart or PDF, and not behind a paywall),
  and quote the line that states it.
- If the source shows the figure was announced or changed recently, the copy must say so.
- Do not repeat a topic from the recent list.
- Return exactly three candidates ranked best first, with at least one pool item and one idea
  of its own (unless the material has no pool items). Pool items are candidates, not defaults.
- Existing copy rules carry over from `gtn-question@1`: lengths, no hint in the question (S-51),
  voice, humanizer, photo requests.

**Output per candidate:** `rank`, `origin` (`pool` with the pool item's short id, or `model`),
`question`, `answer`, `label`, `meaning`, `topic`, `source_url`, `source_quote`,
`source_verb`, `source_name`, `subjects`, `visual`, `answer_visual`.

### 3. Fetch (code)

For each candidate the worker reads `source_url` itself with `readPage`
(`lib/social/reporter/read-page.ts`). A page that fails to load or comes back below
`MIN_TEXT_CHARS` fails `verifiable`. The gates read this text, never `source_quote`.

*Builder's call:* Readability only finds article-shaped pages, so docs pages, model cards and
study landing pages may come back empty even when the model read them fine. Stories adds its
own fallback in a Stories-side wrapper (plain body text from the fetched HTML when Readability
finds no article); the shared Reporter module is not changed. JS-rendered pages still fail;
`gtnSkip` records each fetch failure so we can see how often it costs a day. The prompt also
asks for a source whose figure is in the page's plain text.

*Builder's call:* a pool candidate may cite a different page from its pool story's URL when
that page states the figure better. The credit follows the cited page. Carousel photo reuse still
applies, since the subject is the same.

### 4. `gtn-gate@1` (Jev, new set)

Per candidate, over the fetched page text plus the written copy:

| Question | Role | Rule |
|---|---|---|
| `verifiable` | gate | The page text states this answer for what the question asks. Must pass. |
| `want_to_guess` | gate | An average Helios follower would want to guess it. Must clear a floor. |
| `newly_changed` + `copy_says_new` | gate | If the page shows the figure was just announced or changed, the copy must say so. Fails when the first is likely and the second is not. |
| `guessable`, `surprise` | label only | Feed the difficulty chip with today's `difficultyFrom` formula. Never rank or gate. |

*Recency inputs (builder's call, wording goes to Lucas):* Jev's state carries today's date
and the page's `publishedTime` when `readPage` finds one. "Just announced or changed" means
within about the last 30 days. The window is provisional and gets calibrated with the floors.

Repeat check (Tommy: **same subject**): a new `same_subject` question in `gtn-gate@1` asks
whether the candidate is about the same subject as a recent set (the same product, company
figure or study), even when the number differs. A match fails the candidate. It replaces the
idea of reusing `stories-same-event@1`, which only catches the same news event. It runs against Guess the Number sets of the
last 30 days in `ready`, `approved`, `scheduled`, `publishing` or `published` (the statuses
`nextFamily` already reads), comparing each candidate's question and label with theirs.

All questions written as principles; `interest_category` and its example list are retired.

### 5. Pick (code)

Walk the candidates in the model's rank order; the first that passes every gate wins. None →
skip the day. Like Free vs. Paid's `fvpSkip`, record on the set (`payload.gtnSkip`) what was
proposed, each candidate's gate answers, and which gate failed, so a skip can be explained.
Every candidate is saved to `stories.candidates` with its origin, Jev answers, model rank,
`chosen`, and the failing gate as `reason`.

### 6. Images and render (unchanged)

As today: a carousel pool number reuses its post's photo; otherwise the finder runs on the
candidate's `visual`; the answer frame takes a second photo only when one is found;
layout family rotation; render; Haiku review. The answer frame's credit uses the
candidate's `source_verb` and `source_name`.

## Cost

About $0.15 to $0.25 a set: mostly search results as input tokens plus about $0.05 in search
fees, and fractions of a cent for Jev. Today's pipeline costs about $0.10 to $0.20. Two sets a
week is about $2 a month, well under the $25 `monthly_watch_usd`.

## Constraints

- **Lucas approves wording before it ships.** `gtn-pick@1` and `gtn-gate@1` are drafted as text
  first. Any wording change bumps the version; shipped versions are never edited in place.
  Code can be built and tested offline before approval; the worker deploy waits for it.
- **No live Claude API, `web_search` or Jev in tests.** Stub the model with canned tool
  responses (including server-tool blocks and a `pause_turn`), stub Jev and the page reader.
- **Prompt caching:** stable tools and system prompt, breakpoints on the last tool and the system block;
  pool material and recent topics are the uncached user turn.
- **First live run is Lucas's**, from the Stories tab. Agents never start one.
- **Worker sync:** the Stories worker runs on `helios-social-worker` (unit `helios-stories`).
  Redeploy with `./scripts/gcp/deploy-social-worker.sh` in the same session as the worker change,
  after checking the worker log for an in-progress set.
- **Read-only DB checks** go through `BEGIN READ ONLY; …; ROLLBACK;`, never a session `SET`.

## Decision log (`planning/Stories/BUILD_PLAN.md`)

- New S-decisions (next free number is S-74): the one-call design, the scope, Jev's roles,
  the contest rule, the gate floors once calibrated.
- Supersedes S-10 (carousel preference, ×1.15), folds S-26's extraction into the call,
  replaces S-64's scoring values. Resolves O-10 (difficulty from Jev's `guessable` and `surprise`).
- Rewrite §5.2 to the new run.

## Open

- **Gate floors.** No values agreed. Ship provisional floors and calibrate on the first runs,
  logged as an S-decision. Lucas's call.
- **The Oct 12 set.** Check whether its $50B AWS-OpenAI number came from the AWS multi-model
  story it cites. Read-only DB check; report to Lucas.

## Left to the builder

- How many pool numbers and unbriefed stories the call sees, and how much story text each carries.
- Provisional gate floors until Lucas calibrates them.
- What happens when the model breaks the contest rule: log it and gate what came back, don't reject the run.
- Whether `gtn-extract@1` and `gtn-question@1` stay in `prompts.ts` for log lookups once the build stops using them.
- Tests to replace in `tests/stories-pipeline.test.ts` and `tests/stories-pool.test.ts`.
