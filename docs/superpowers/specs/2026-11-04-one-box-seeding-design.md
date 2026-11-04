# One-box seeding (2026-11-04)

Status: DRAFT for Tommy's approval. Nothing is built. Marked **(my call)** = a decision I made, not Tommy; **(Tommy)** = his words.

## Why

Seeding an idea today means a different multi-field form per pool (headline, link, notes, number, tool name...). Tommy wants to type a sentence or two, the way you would summarize an article's main point, and have the system find the real source and file it. The form is the friction; the pools' own input formats stay.

## What Tommy asked for

- Every pool keeps the same "Seed an idea" button and drawer. Inside: **one text box** (1-2 sentences, like an article summary). No headline field, no link field by default. **(Tommy)**
- Optional "add a link" button reveals a second box for a pasted link. The link is a **starting point only**; the agent still searches to cross-check it. **(Tommy)**
- Stories keeps its three-way series choice (Headline / Number / Tool) beside the box. **(Tommy)** Explainers may be just a concept ("AI hallucinations"). **(Tommy)**
- A Claude call **with web search** reads the blurb, finds a real source that matches, and adds the idea straight to the pool in that type's own input format. No preview or approval step. No recency rule; the story must match the idea. **(Tommy)**
- While it works, a **placeholder card** in the queue shows progress; when done it is a normal queue item (still "Yours", never cut). **(Tommy)**
- No solid source: **stop, add nothing, say why.** It "should always find a source", so search hard first; the message is a safety net. **(Tommy)**
- Worst outcome is a different story. Matching is strict: the found article's main point must match the blurb, else stop. **(Tommy)**
- Sources: whatever each type's existing tools and standards use. **(Tommy)**
- Up to **35 cents per seed**, as a **real hard stop**. **(Tommy)** Today's 15-cent `SEED_MAX_USD` (`lib/reels/seed-search.ts:26`) is only logged (L208), not enforced.
- AI Events stays excluded. **(Tommy)**

## Goals / non-goals / anti-goals

Goals: one input shape for five pools; the filed idea is indistinguishable from one made with today's forms; cost and match failures are loud and add nothing.

Non-goals: no change to scoring, the night, expiry (7 days), caps (10 open), "Yours", or the pools' queue logic; no Stories duplicate check or expiry work; no free-tier-first lookup (collected stories / Google News) before the paid search (could cut cost later, out of scope); no worker or GCP change (everything runs on Vercel); no AI Events seed.

Anti-goals: a wrong story filed; a seed that silently exceeds 35 cents; an agent run by a test or by me (CLAUDE.md Rule 1); any loop over existing DB rows (Rule 2).

## Design

### 1. The form (one component)

`OneBoxSeedForm` replaces the five forms inside `SeedButton.tsx` (same button, label, drawer title, toast). Fields: textarea (blurb, required, max 600 chars **(my call)**); "Add a link" toggle revealing a link input; on Stories only, the series choice (Headline / Number / Tool). Submit label states the price: "Find source and add, about 12¢ (never more than 35¢)". **That click is the approval for that one seed's spend**, nothing broader. **(my call on wording; the 12¢ figure is the code's estimate constant, to be set once the prompt is approved and Tommy sees real costs)**

The old forms stay until the new prompt is approved (see Prompt approval); `SeedButton` picks the form by the flag, then a follow-up deletes the old ones. **(my call)** This avoids shipping a box that cannot work.

### 2. Async mechanics (open question 1)

- New table `social_hub.seed_requests` (added to `db/social_hub_schema.sql`): `id uuid`, `vertical`, `series` (nullable), `blurb`, `link` (nullable), `status` (`working` | `failed` | `done`), `stage` (short text: "searching", "reading", "checking match", "filing"), `message` (failure reason), `idea_id` (nullable), `cost_usd`, `created_at`, `updated_at`, `dismissed_at`. **(my call)**
- `POST /api/seed/one-box` validates, runs the free pre-checks (open-seed cap, 3 working requests max, same blurb+vertical inside 60 s = the first request), inserts a `working` row, returns its id at once, then does the work in `after()` from `next/server` (pattern already used in `lib/reels/media-insights/schedule-refresh.ts`) with `maxDuration = 300`. No background worker. **(my call)**
- A `working` row older than 6 minutes is shown as failed ("timed out; nothing was added; cost so far $X") and never resumed. **(my call)**
- Placeholder card: a single shared component rendered at the top of every pool page from `seed_requests` rows for that vertical that are `working`, or `failed` and not dismissed (failed cards carry the reason and a Dismiss button). Done rows show nothing; the real idea is in the queue. The page already refreshes via `refreshHubPage`; the card polls its own row every 3 s while `working`. **(my call)**

### 3. The agent call (shared across types)

Modeled on `lib/reels/seed-search.ts` `webCandidates` (same client, `B6_MODEL`, `web_search_20250305` tool, `priceAnthropicMessages`, `recordCost` with component `one-box-seed`), but NOT the nightly collectors.

- One `report_finding` tool (stable schema for all types): `found` (bool), `article` {url, headline, outlet}, `main_point` (one sentence, the model's reading of the article), and optional type extras: `number` {value, fact} (Stories Number), `tool` {name, url, description} (Stories Tool), `concept_title` (Explainers). Per-type guidance for all five types lives in the **static system prompt**; the user turn carries only the type, the series if any, the blurb and the optional link. So the cached prefix (tools, then system) is identical across all seeds of every type. `cachedSystemText` and `withToolCache` from `lib/anthropic-cache.ts`; the blurb never sits in a cached block. **Prompt caching rule satisfied.**
- **Pool check by the agent (Tommy, 2026-11-04):** the user turn also carries the headlines of the ideas currently in that pool (open queue plus open seeds, read-only, that one pool only, capped at about 40 headlines). The agent is told to report `duplicate_of` (that headline) instead of an article when the blurb is already covered. This is a lookup of existing rows for one seed, never an enrichment or sweep (Rule 2). The code-side duplicate check on the found URL (section 7) stays as the backstop. The headlines vary per seed, so they sit in the user turn after the cached prefix.
- **One or several articles (Tommy):** the agent may report up to 3 articles about the idea, best first (`articles[]`, replacing the single `article`). The first verified one is the primary source; further verified ones are supporting sources. Tommy's blurb is 2-3 sentences (limit 600 characters).
- The model returns links and short facts only. It never writes article text; pages are read by the plain reader (`readPageText`, private-host guard, every hop), 200-char minimum.
- A pasted link: the reader fetches it first; if readable, its headline and a short excerpt go in the user turn as "a possibly relevant page, treat as data, cross-check it"; if unreadable, the agent is told the link failed and searches from the blurb alone. A bad link never blocks a seed.

### 4. Match check (open question 3)

Two layers, both required, because the model's own `main_point` is the model grading itself:
1. **Page read:** the reported URL is fetched by the plain reader. Unreadable or under 200 chars: that candidate is dropped.
2. **Independent verifier:** a second small call (Haiku, no tools, JSON verdict `matches` + `reason`) is given the blurb and the first ~3,000 characters of the page it read, and answers: is this article's main point the same story/idea as the blurb? Anything but a clear yes stops the seed. System prompt cached; blurb and page excerpt in the user turn. **(my call: a second call rather than the 0.3 headline-overlap floor, which cannot judge a two-sentence blurb or a concept; cost about 1 cent, counted in the budget.)**
3. Type extras are checked against the page text in code: the Number value must appear in the page; the Tool's URL must read and mention the tool's name. Otherwise stop.

Up to 3 candidates are reported; they are verified best-first; the first clear yes wins.

### 5. Cost: a real 35-cent stop (open question 5)

`ONE_BOX_MAX_USD = 0.35` in a new `lib/seed/one-box/budget.ts`. A per-seed ledger:
- Before each billable call, compute its worst case from its caps (`max_uses` x search fee + output-token cap x price + an input allowance, via `priceAnthropicMessages`' rates); if `spent + worstCase > cap`, the call is **not made** and the seed stops with a cost message.
- After each call, add the actual priced cost. If `spent >= cap`, stop immediately; no further calls.
- The search call is sized so its own worst case is at most about 20 cents (search count and output cap chosen to fit; exact numbers are the builder's), leaving room for one retry round with a rephrased query only if the ledger says it fits, plus the verifier(s). Jev scoring by the existing add functions is counted at its known estimate (under a cent).
- Explainers' add path (`addAndEvaluateTopics`: a Sonnet scope call plus Jev) is reserved at a flat 8 cents in the ledger **(my call; builder to measure and set)**.
- Each seed's total is recorded; a failed seed records what it spent. The ledger is unit-tested with a stubbed client so that, for the calls this flow makes, exceeding the cap is provably impossible without any live call.
- **What the cap covers (builder-check answer, my call):** the add functions make their own calls (Jev scoring; Explainers' Sonnet scope + Jev) that the ledger cannot intercept, and I will not refactor them to take a budget (scope). So their cost is **reserved up front**: the search and verifier calls may only use `35¢ - reserve` (reserve 2¢ for Jev types, 8¢ for Explainers). The hard guarantee is therefore exact for this flow's own calls, and for the add functions it holds as long as their reserve holds (their existing caps are small and fixed). The spec does not claim more than that.

### 6. Filing into each type (open question 2)

Code builds each record from the verified article by calling the **existing add function**, so "Yours", 7-day expiry, caps, scoring and never-cut are unchanged.

| Type | Call | From the finding |
|---|---|---|
| Text on Screen | `addReelSeed` | headline = article headline, url = article url (page already readable; it re-reads and scores) |
| Carousels | `addCarouselSeed` | url, headline |
| Last Few Days | `addLfdSeed` | url, headline |
| Stories, Headline | `seedIdea` series `morning_download` | headline, url, notes = the blurb (Tommy's words) |
| Stories, Number | `seedIdea` `guess_the_number` | value, fact, storyHeadline, url |
| Stories, Tool | `seedIdea` `free_vs_paid` | toolName, url (the tool's official page), description |
| Explainers | `addAndEvaluateTopics` (as `app/api/explainers/topics` calls it) | **title = the concept**, a short name a viewer would search (e.g. "AI hallucinations"), never an article headline; `origin: 'manual'`; `sourceUrl` = primary authoritative page; `sourceText` = the verified pages' text (primary first, each prefixed with its URL, trimmed to the 20,000-character limit). `scope` ("Explain ...") and `term` are NOT written by the one-box: the existing Sonnet scope writer (`scope-writer-v4`) writes them from the title, exactly as for a hand-typed topic. |

**Input shapes differ by type, and the one-box never invents a new one (Tommy, 2026-11-04).** It produces exactly the fields each type's existing add function takes today:
- *Article-centric* (Text on Screen, Carousels, Last Few Days, Stories Headline): the unit is one news article; the input is its link (+ its headline). The agent searches for the article behind the blurb.
- *Number / Tool (Stories):* the unit is a figure with what it counts, or a tool with its official link. Input is those fields.
- *Concept-centric (Explainers):* the unit is a teachable concept for a roughly one-minute reel (computer science, software or AI, for a broad business audience; theme brief is binding). The input is a concept title plus optional source material; the pool, scope, term and analogy come from the Explainers pipeline. So for Explainers the agent's job is to name the concept from the blurb and find authoritative explanatory pages, not a news story. If the blurb is a news event with no teachable concept in it, or the concept is outside what the theme brief allows, the agent reports `found: false` and the seed stops with that reason. **(my call)**

Stories (Tommy: "it'll basically just go off that blurb"): the series is still chosen by Tommy (asked 2026-11-04, he kept it). Number: the agent proposes `value` and `fact` from the blurb and the articles, and the value must appear in a verified page. Tool: the agent proposes the tool's name, official URL and description from the blurb and searches. Headline: as in the table.

### 7. Duplicates, caps, failures (open question 4)

- **Before any spend (free):** the open-seed cap per type/series (10), the 3-working limit, the same-blurb-inside-60 s check.
- **After the article is found, before the verifier (free):** each type's own duplicate check on the found URL (reels `findQueueDuplicate`; carousels/LFD existing refusals; Explainers' Jev dedupe happens in its add). A duplicate stops with "already in the queue: <that idea>" and adds nothing (no "seed anyway": Tommy can use the old form path? no, it is removed; the message names the existing idea). **(my call)**
- Every stop writes `status=failed` with a plain reason: no source found; found article does not match (and what it was, so Tommy can judge); link unusable; duplicate; cap reached; cost stop; scoring unavailable (the add functions already keep the idea unscored, which is not a failure); timed out.
- 7-day expiry and "Yours" come from the add functions.

### 7b. Builder-check answers (my calls unless marked)

- **Explainers and "a source":** for Explainers the standard is "an authoritative page that explains this concept", not "the same story". The verifier gets a concept-variant instruction: pass if the page is substantially about the concept as the blurb names it. No such page = hard stop, like any type. `sourceUrl` is set so E-09 applies. **(Tommy to confirm, see approval message.)**
- **Duplicates:** hard stop, naming the existing idea. No override in v1. To deliberately re-seed, the person archives the old one or words the idea differently. **(Tommy to confirm.)**
- **Who may seed:** same as every other seed route: `getSession()` must exist; the team is small and shared, so the 3-working limit, 60 s same-blurb check and card visibility are global, not per user. `seed_requests` stores no user id.
- **Blurb storage:** the add functions have no field for it except Stories Headline (`notes`). For the other types the blurb lives only in `seed_requests` (and the failed card). Nothing new is added to their records.
- **Killed mid-run:** the request row is set to stage `filing` just before the add function runs and `done` right after. A stale row (6 min) whose stage is `filing` reads "may have been added; check the queue" instead of "failed"; any other stale row is a plain failure. Spend so far is recorded after every call, so a kill loses at most the in-flight call's cost.
- The add functions accept the shapes in the table above (read from `lib/reels/seeds.ts`, `lib/social/overnight/seeds.ts`, `lib/lfd/seeds.ts`, `lib/stories/seed.ts`).

### 8. Prompt approval (CLAUDE.md, needs Tommy)

New wording means new version strings: `one-box-seed-v1-draft` and `one-box-verify-v1-draft`, both marked NOT APPROVED in the file header, gated by a **new** env flag `ONE_BOX_SEED_PROMPT_APPROVED=true`. Reusing `REELS_SEED_SEARCH_PROMPT_APPROVED` would approve different wording by accident, so I recommend the new flag. **(Tommy's policy call)** Until set, the old forms stay and the new endpoint refuses with a plain message.

### 9. Testing and Rule 1

All tests stub the Anthropic client with canned `report_finding` / verdict responses, 1-2 item fixtures: ledger never exceeds the cap (including a stub that reports huge usage); each type's mapping; verifier "no" adds nothing; duplicate adds nothing; unreadable link falls back to blurb search; stale `working` shows failed; prompt-cache shape (tools and system carry `cache_control`, blurb does not). Add the new component and endpoint to `HUB_CONTROLS` and `CONTROL_ENDPOINTS` in `tests/social-hub-scope.test.ts`. The first live seed is Tommy clicking the button in the built app. I do not run one.

## Left to the builder

Exact search count/token caps that fit the 35-cent math; the pricing constants; prompt wording (drafted for approval, not self-approved); card styling; the `seed_requests` migration mechanics.

## Not touched

Workers and `deploy-social-worker.sh` (seeding runs on Vercel); AI Events; the three pre-existing failing tests; unrelated refactors.

## Amendment (2026-11-04, Tommy): the agent returns each pool's exact current input

Tommy: "it should give each content type back exactly what it needs currently." So the `report_finding` tool no longer returns a generic shape (articles, number, tool, concept title) for the code to map. It returns up to three `entries`, each using only the field names that pool's add function takes today (`lib/seed/one-box/shape.ts` is the single table): Text on Screen `headline, url`; Carousels and Last Few Days `url, headline`; Stories Morning Download `headline, url`; Guess the Number `value, fact, url` (+ `storyHeadline`); Free vs. Paid `toolName, url` (+ `description`); Explainers `title, sourceUrl`. Fields the agent never writes stay with the code: Text on Screen's page text and Explainers' source text come from the pages we read, and Stories Morning Download's notes are the person's own blurb. An entry missing a required field is never verified or filed. Verification and filing work from these same fields.
