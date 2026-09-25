# Trial reel engine: build plan

The central planning document for the Helios trial reel build. It's a living file. The agent keeps the status block, Decision Log, registry, and parking lot current as work happens. Product direction lives in `PRODUCT_SPEC.md` (Lucas's plan, verbatim) and changes only when Lucas changes it.

The biggest risk on this build is an agent that fills gaps with reasonable-sounding guesses. The spec sets product direction. Nearly everything underneath it is still open: system prompts, Jev question sets, data models, infrastructure, thresholds, and the sub-builds, starting with a source adapter for every source type. Each of those is Lucas's call, reached through an interview.

## Status

| Field | Value |
|---|---|
| Active build | Build 3: on-screen copy and captions (D-006). Kickoff answered (D-090 to D-096), writer built (Section 9), prompt approved (D-097, tightened D-098). |
| Stage | 3, approved. P-10 `copy-caption-v5`. One screen, word count is a hard constraint, natural line breaks, the hook's noun is plain to a general viewer, and the on-screen copy never starts with a pronoun (D-098, D-099, D-104, D-107). |
| Locked | Visuals, publishing, and cooldown matching. Humanizer stays on copy and captions (D-065). |
| Decisions logged | 109 |
| Next action | `REELS_COPY_PROMPT_APPROVED=true` is set. The 1 AM run writes copy for the three selected ideas. |
| Last updated | 2026-09-24 |

## Start here

1. Read `PRODUCT_SPEC.md` end to end, then this plan, including the Decision Log (8.1). Logged decisions already narrow the spec in places (R9).
2. Read the TypeSafe docs linked in Section 3.
3. Add anything missing to the Build 1 decision inventory (6.5) and order it by dependency.
4. Open the kickoff interview with foundations (FND) and Jev setup (JEV). The spec gaps and their follow-ups are already answered (6.4).
5. Update the status block at the end of every session.

## 1. Operating rules

These apply to every session and every build.

**R1. Lucas decides.** Product and architecture decisions belong to Lucas. Your job is to find each decision, frame it so it's easy to answer, get his answer, log it, and build exactly what was decided. This plan makes no decisions of its own. Anything marked open is open.

**R2. When in doubt, it's a decision.** If you aren't sure whether something needs Lucas, ask. Over-asking is the right error on this build.

**R3. One build at a time.** All effort goes to the active build. Don't design, scaffold, or optimize for a locked build. If you notice something a later build will need, add it to the parking lot (8.3) and ask Lucas whether it changes anything in the current build.

**R4. No silent defaults.** Page sizes, rate limits, time windows, thresholds, filters, model settings, retry behavior: if a value changes what gets ingested, kept, grouped, or shown, it's a decision. That includes library and API defaults.

**R5. Bring evidence.** Run spikes to inform decisions. Pull a night of real data, try three thresholds, show what each one produces. Present the evidence and the options, and Lucas picks.

**R6. Prompts and question sets need approval.** Every language model prompt and every Jev question set goes through Lucas before it produces anything he reviews. Draft it, show it, revise it, and record the approved version in the registry (8.2).

**R7. Reach for Jev.** For every judgment step in the pipeline, work out whether it can be a Jev decision before reaching for a language model, and bring that analysis to Lucas. Section 3 covers where Jev is strong and where it isn't.

**R8. Log everything.** Record each answer in the Decision Log (8.1) in the same session. When a later answer changes an earlier one, add a new entry that supersedes it. Don't rewrite old entries.

**R9. Leave the spec alone.** Don't edit `PRODUCT_SPEC.md`. If it looks wrong, contradictory, or silent, ask instead of reinterpreting. Where a logged decision changes what the spec says, the decision wins and the spec file stays as written.

**R10. Check facts before asking.** API limits, costs, what an endpoint actually returns, whether a site has a feed: look these up first, so the question Lucas answers is about a real tradeoff.

You can handle implementation details inside an approved decision without asking: internal naming, file layout within the approved structure, tests, and refactors that don't change behavior or interfaces. Anything past that falls under R2.

## 2. How to interview Lucas

### When interviews happen

| Moment | What happens |
|---|---|
| Kickoff | Before any code in a build, work through its decision inventory until every blocking question has an answer. This is the deep-planning session, so give it the time it needs. |
| Just in time | A new decision surfaces mid-build: stop, ask, log, continue. Work on something unblocked while you wait, if anything is. |
| Review gate | Review outputs are ready: walk Lucas through them, collect feedback, and turn the feedback into logged decisions. |

### What every question includes

- Context: why it matters, in a line or two.
- Options: two to four real ones, plus "something else."
- Tradeoffs: what each option costs and what it buys.
- Blocks: what can't move until it's answered.
- Recommendation: yours, if you have one, labeled as a recommendation. Lucas still decides.

### Order and pacing

- Upstream first. Stack, data model, and definitions come before thresholds, prompts, and formatting, since the later answers depend on the earlier ones.
- Ask in small batches of related questions. Wait for the answers before the next batch.
- For definitions like "same story" or "new material," ask for examples. Once real data exists, ask with real items from the pool.
- After each round, play the answers back as short decision statements and log them once Lucas confirms.
- If Lucas hands a decision back ("your call"), make it, log it as delegated with your reasoning, and point it out at the next review gate.
- If your environment has a structured question tool (multiple choice, tappable options), use it for option questions.

## 3. Jev and TypeSafe

Jev is TypeSafe AI's decision model, the first in a class TypeSafe calls System One models. It went into early access on September 15, 2026. The spec gives Jev the grouping decisions (merge, link, or leave alone), the published-story cooldown, and all four scores in Build 2, and Lucas wants it used wherever else it fits.

What to know before designing with it. This comes from TypeSafe's docs as of September 2026; the model is new, so check the current docs first.

- Jev takes application state plus declared questions and returns typed answers with probabilities and a confidence value. It doesn't write prose.
- It has three primitives. Choice picks one declared option. Score places the state on a declared rubric. Noul returns the probability that a yes/no proposition is true. Questions run independently against the same state.
- TypeSafe's build guidance: keep deterministic work in code, ask narrow atomic questions, send only the state that matters, and route low-confidence cases to a person or a stronger model.
- The documented weak spots for Jev 1.13 include literal reading, numeric precision, date comparison, large irrelevant state, and adversarial content in the state. Everything this pipeline scrapes is untrusted input.
- Each request has a size budget for state (see the models page). Long sources like full papers, model cards, or long post-mortems, especially two at once in a pairwise comparison, may not fit whole. That matters for GRP-02.
- Confidence isn't correctness. Thresholds have to be calibrated on our own data, and closed option sets need an escape option (unsure, other, needs review).
- Pin the model version and log it with every call. The `jev-latest` alias can move underneath you.

The split TypeSafe's guidance points to is deterministic work in code, bounded judgments in Jev, and anything that produces text in a language model. Where each Build 1 step actually lands is question JEV-03. Don't assume it.

Docs:

- Launch post: https://typesafe.ai/blog/introducing-system-one-models-and-jev
- Introduction and quick start: https://docs.typesafe.ai/introduction
- Primitives: https://docs.typesafe.ai/primitives
- Confidence: https://docs.typesafe.ai/confidence
- Building with System One: https://docs.typesafe.ai/concepts/how-to-build-with-system-one
- Jev 1.13 limitations: https://docs.typesafe.ai/model-jaggedness/jev-1.13
- Models and versions: https://docs.typesafe.ai/models

## 4. Build sequence

Two builds, strictly in order. Both run through the same stages. Build 3 (on-screen copy and captions, D-006) follows Build 2 and isn't planned here.

| Stage | What happens | Exit condition |
|---|---|---|
| 0. Prep | Read the spec and this plan. Add missing questions to the build's inventory. | Inventory complete and ordered by dependency |
| 1. Kickoff interview | Deep planning with Lucas | Every blocking question answered and logged |
| 2. Build brief | One page in this doc: what gets built per the logged decisions, proposed slice order, review checkpoints, known risks | Lucas approves the brief |
| 3. Build | Slice by slice, with just-in-time interviews | Pipeline runs end to end |
| 4. Review outputs | Produce the outputs Lucas reviews, in the format he chose | Outputs delivered |
| 5. Review and iterate | Review-gate interview. Feedback becomes decisions. Back to stage 3 as often as needed. | Lucas says the build is done |
| 6. Sign-off | Log the sign-off (question ID `SIGNOFF-B1` or `SIGNOFF-B2`) and unlock the next build | Sign-off entry in the Decision Log |

Build 2 was opened before `SIGNOFF-B1` (D-072). That Build 1 sign-off is still open. Build 2 itself is signed off (D-089): brief D-085, question sets D-086, blockbuster amount D-087, Scores tab D-088. Build 3 is unlocked and has no brief yet.

## 5. Context from earlier planning

Confirm each point at kickoff.

- The system produces short-form vertical text-on-screen reels for Helios. Every post should position Helios as an expert in AI consulting.
- The source pool should be grounded in material that's already performing well elsewhere. Sources without native engagement signals are still acceptable.
- Two audiences, weighted about equally: developers and technical practitioners, and founders and executives.
- The spec's 12 source types appear to come from an earlier list of 40. On that list, "Open" meant freely accessible, openly licensed or public API, and open-source software, and "Diff" was a difficulty rating from 1 to 5.
- A third content category is planned but not defined.
- Existing Helios tooling includes n8n, Zapier, Google Drive and Sheets, and Notion. Whether any of it plays a role here is a question for Lucas, not an assumption.

## 6. Build 1: sources and post ideas

Spec Phases 1 and 2.

### 6.1 Scope

In scope:

- Phase 1: nightly ingestion, normalized storage, and 3-week retention for the spec's source types, except oral history archives (B5) and Wikipedia (B2), which are out (D-003, D-010). That leaves 10 types. Only sources the spec lists are in play (D-002). Within each type, the agent picks the individual sources worth using (D-001). Lucas expects roughly 13 to 18 in total.
- Phase 2: cleaning, dedupe/merge/link against the 72-hour reference pool (D-007), the post idea pool, and a place to log published status per post idea (D-012). That log is the only cooldown work in Build 1.

Out of scope (don't build it, don't design for it):

- Scoring. That's Build 2.
- On-screen copy and captions. That's Build 3 (D-006).
- Image and video generation.
- Publishing to Meta. It comes later, and published status will be logged by post idea when it does (D-005).
- Cooldown matching and its testing (D-012). They wait until publishing exists.
- Anything named only in the content buckets' "Feeds from" lines (D-002).

### 6.2 What Lucas reviews

1. The raw source pool: everything ingested, normalized.
2. The post idea pool built from it, showing what merged, what linked, and what stands alone.

Format, surface, and checkpoints are open (REV).

### 6.3 Settled by the spec

Don't re-ask these, but do flag ambiguity inside them.

- Ingestion runs daily at 1 AM and pulls new material from every source.
- Three weeks of trailing material is kept for all sources. Anything older is deleted.
- There are 12 source types in two buckets, A (Education) and B (Storytelling / Reporting), as listed in the spec. D-003 and D-010 take oral history archives and Wikipedia out of Build 1 (see 6.1).
- Hugging Face Daily Papers is the main Hugging Face feed.
- Records hold the full source (body, author, source, headline, byline, etc.), normalized across all sources.
- The Claude web search source runs daily and returns exactly one story idea in the same format as the other sources. It skews toward Saga and Personal Profile material, stays grounded in truth, uses the humanizer skill, and never sees the criteria it's scored on.
- Phase 2 works from the last ingestion run onward.
- Jev makes the dedupe, merge, and link decisions. Grouping follows stories, not people, companies, products, or events.
- Duplicates merge. Complementary sources link into one post idea. A post idea can be one source or several.
- Published stories cool down through a score penalty. Sharing an entity with a published story doesn't trigger it.

### 6.4 Spec gaps (answered)

Lucas answered all nine during planning on 2026-09-21. The answers are logged in 8.1, and the rest of this plan reflects them.

- GAP-1. Source count. There are 12 source types. A couple of types hold several sources, so expect roughly 13 to 18 individual sources in total. The agent decides which are worthwhile. → D-001
- GAP-2. Sources outside the 12. None. Use only the sources listed in the spec, within its 12 types. Anything named only in the buckets' "Feeds from" lines is out. → D-002
- GAP-3. Old material versus a nightly feed. Oral history archives (B5) and Wikipedia timelines (B2) aren't used. GitHub is about what's been trending, which favors recency. → D-003
- GAP-4. The awesome-lists link. It's a list of AI awesome-lists, monitored alongside the three named lists. Because the lists change slowly, the pulling strategy has to keep producing fresh takes and perspectives. → D-004
- GAP-5. Where "published" comes from. Publishing is a future step. When it exists, published status gets logged by post idea. → D-005
- GAP-6. Copy and captions. Build 3, after Build 2. → D-006
- GAP-7. New sources versus the pool. New sources are compared against a 72-hour reference pool, not the full 3-week pool, so they can join existing post ideas. A post idea is in the reference pool if a source has joined it in the last 72 hours. → D-007
- GAP-8. The web search story's path. It enters the pool as a source and goes through merge and link like everything else. → D-008
- GAP-9. The humanizer. Lucas gives the repo access to the humanizer skill. → D-009

The answers left four follow-up questions, which Lucas also answered during planning.

- FU-1 (P) Wikipedia. B2 is out entirely, including the Pageviews spike detector. Build 1 has 10 source types. → D-010
- FU-2 (P) A4 pulling strategy. Confirmed: the agent designs a strategy that keeps A4 producing fresh takes and perspectives from lists that change slowly (D-004), and brings it to Lucas as options before building it. The strategy itself is still to be designed (SRC-A4). → D-011
- FU-3 (P) Cooldown in Build 1. Only a place to log published status per post idea. No matching logic and no mock-publish testing until publishing exists. → D-012
- FU-4 (A) Humanizer file. Confirmed: check the copy Lucas provides before designing WEB-06. The copy seen during planning started at pattern 10 and said patterns 1 through 9 were missing. If the repo's copy has the same gap, ask Lucas how to proceed. → D-013

### 6.5 Decision inventory

The starting list, not the full list. Add what's missing. When a question is answered, append `→ D-###` pointing at its Decision Log entry. P marks a product decision and A an architecture decision.

#### FND: Foundations

- FND-01 (A) Language and runtime. → D-016
- FND-02 (A) Where the pipeline runs and what fires the 1 AM job. → D-017
- FND-03 (A) Storage for sources, post ideas, and logs. → D-018
- FND-04 (A) Which model does the text work. → D-022
- FND-05 (P) Budget. → D-023
- FND-06 (A) Repo, environments, Run now. → D-015
- FND-07 (A) Credentials. → D-024, D-026
- FND-08 (P) Alerts. → D-025

#### JEV: Jev and TypeSafe setup

- JEV-01 (A) Access and version. → D-019, D-021
- JEV-02 (A) Where question sets live. → D-027
- JEV-03 (A) The map. → D-028
- JEV-04 (A) What gets logged per Jev call. → D-030
- JEV-05 (P) Low confidence. → D-029
- JEV-06 (A) Planted instructions. → D-030

#### ING: Ingestion rules (all sources)

- ING-01 (P) Time zone for the 1 AM run. → D-031
- ING-02 (P) What "new material" means. → D-032, D-066
- ING-03 (P) Topical scope. → D-033
- ING-04 (P) Volume cap. → D-035
- ING-05 (P) Engagement signals. → D-034
- ING-06 (P) Paywalled or truncated content. → D-036, D-067
- ING-07 (P) Media. → D-037
- ING-08 (P) A source fails overnight. → D-038
- ING-09 (P) Updates. → D-032

#### REC: Normalized source record

- REC-01 (P/A) The field list. → D-039
- REC-02 (P) Unit of ingestion. → D-040
- REC-03 (P) Link following. → D-041
- REC-04 (A) Raw payload. → D-042
- REC-05 (P) Entity extraction. → D-043

#### SRC: Source adapters

Each adapter is its own sub-build. Which individual sources to use inside each type is the agent's call (D-001). Choose among the sources the spec lists (D-002), log the picks as a delegated decision with your reasoning, and point them out at the next review gate.

- SRC-00 (P) Build order and review cadence. → D-049. Roster → D-050.

| ID | Source | Open questions |
|---|---|---|
| SRC-A1 | GitHub Trending + REST/GraphQL API | Daily scrape, all languages, README + latest release notes. Topic left to Jev. → D-068 |
| SRC-A2 | Hacker News (Algolia + Firebase) | Front page + Show HN. Points and comment count stored. No comment threads. → D-068 |
| SRC-A3 | Hugging Face Hub + Daily Papers | Daily Papers only (not Hub trending). Abstract counts as full text. → D-050, D-067 |
| SRC-A4 | Awesome-lists and registries | Jev editor over standing catalog; floor 2/night. → D-066 |
| SRC-A5 | Vendor changelogs and release notes | OpenAI, Anthropic, Cursor. → D-050 |
| SRC-A6 | Curated dev newsletters | TLDR, Console.dev. Item-level. → D-050, D-040 |
| SRC-B1 | Tech press RSS | TechCrunch, Ars Technica, 404 Media. Prefer AI/tech feed if it exists. → D-050 |
| SRC-B2 | Wikipedia + Pageviews API | Out of Build 1 (D-010). |
| SRC-B3 | Company blogs, post-mortems, model cards | Cloudflare, DeepMind. Abstracts/HTML summaries count as full text. → D-050, D-067 |
| SRC-B4 | GH Archive (BigQuery) + issue/PR archaeology | Out of Build 1 (D-026). |
| SRC-B5 | Oral history and archive collections | Out of Build 1 (D-003). |
| SRC-B6 | Claude web search | One story/night. Prompt drafted, gated until P-01 approved. → D-064, D-065 |

#### WEB: Claude web search story

- WEB-01 (P) The generation prompt. Drafted in `lib/reels/prompts/web-search.ts`. Gated until Lucas approves (R6).
- WEB-02 (P) Saga/profile shape only; never scoring criteria. → D-064
- WEB-03 (P) Headline, body, byline Helios, citations. Maps to a normal source record. → D-064
- WEB-04 (P) Claims traceable to URLs; ≥2 independent sources; one retry then skip. → D-064
- WEB-05 (P) Do not repeat last 7 B6 headlines or tonight's other headlines. → D-064
- WEB-06 (P/A) Humanizer is not applied to sources or B6. It is for Build 3 copy/captions. → D-065. D-013 closed: repo skill has patterns 1–25.
- WEB-07 (A) After other ingest/clean, before grouping. → D-064

#### RET: Retention and deletion

- RET-01 (P) 3-week clock. → D-044 (ingest time)
- RET-02 (P) Post idea when sources age out. → D-045
- RET-03 (P) Exemptions. → D-046
- RET-04 (A) Hard delete after ingest. → D-046

#### CLN: Cleaning

- CLN-01 (P) What "clean" covers. → D-047
- CLN-02 (A) Code strips chrome; Jev drops junk/off-topic (JEV-03). → D-028, D-047
- CLN-03 (P) Dropped items stay visible with reason. → D-048

#### STY: Story identity

The hardest part of Build 1. Settle it before the grouping engine exists.

- STY-01 (P) Same story = same news event or disclosure. → D-051
- STY-02 (P) Merge near-duplicates; link complementary angles. → D-052
- STY-03 (P) Inside 72h can join; after 72h quiet, new post idea. → D-053
- STY-04 (P) Label pairs on the page after real nights; not a build blocker. → D-054

#### GRP: Grouping engine

- GRP-01 (A) Code shortlist then Jev. → D-055
- GRP-02 (A) Noul same-event, then Choice merge/link/leave. → D-056
- GRP-03 (P) Act only at high confidence; else leave alone, no flag. Starting bar 0.8 pending calibration. → D-057
- GRP-04 (P) One post idea per source. → D-058
- GRP-05 (P) Page override survives later nights; no auto-regroup of decided pairs. → D-058
- GRP-06 (P) Cap 6 members. → D-058
- GRP-07 (A) Sticky stored decisions; log resolved jev-latest ID. → D-058
- GRP-08 (P) Numbers on the page, not prose. → D-058

#### IDEA: Post idea record

- IDEA-01 (P) Structural fields including timely + last-joined. → D-059
- IDEA-02 (P) No working title or synopsis in Build 1. → D-059
- IDEA-03 (P) Version snapshot every membership change. → D-060
- IDEA-04 (P) Timely flag for Build 2. → D-059

#### COOL: Published-story cooldown

- COOL-01 (P) Where "published" comes from. Publishing is a future step, and published status will be logged by post idea when it exists. → D-005
- COOL-02 (P) What the published-status log holds per post idea, and how long it's kept (RET-03). → D-061
- COOL-03 (A) Deferred until publishing exists (D-012). Matching new post ideas against published ones: the grouping question set, or its own? A published post idea leaves the 72-hour reference pool once 72 hours pass without a new source joining it (D-007), so a story that resurfaces later can land in a new post idea that still needs this check.
- COOL-04 (P) Deferred until publishing exists (D-012). The split between flagging a match and applying the penalty, including where the penalty's size and decay live.
- COOL-05 (P) Deferred until publishing exists (D-012). How cooldown gets tested.

#### REV: Review outputs and acceptance

- REV-01 (P) Hub Reels page (`/reels`). → D-062
- REV-02 (P) Same page: members, roles, Jev numbers. → D-062
- REV-03 (P) Marks: wrong merge / missed link / junk source. → D-063
- REV-04 (P) No permanent ingest gate; Run now for iteration. → D-049
- REV-05 (P) Sign-off when Lucas says so (SIGNOFF-B1). → D-063
- REV-06 (P) No fixed night-count. → D-063

### 6.6 Build brief

Approved 2026-09-21 (kickoff interview D-015–D-069).

Build a TypeScript pipeline in this repo that, every night at 1:00 AM America/New_York: (1) ingests 17 sources into normalized records with 3-week retention from ingest time; (2) cleans and topic-filters them; (3) groups them into post ideas; (4) shows the night on `/reels` (run status, raw pool including drops, post ideas, Run now).

Claude is used once per night for B6, and only after P-01 is approved. Jev does every judgment. Humanizer is not used in Build 1.

Stack: The-Helios-Hub / Trial-Reels; new systemd unit `helios-reels` on the existing GCP VM; existing Supabase Postgres schema `reels`; `jev-latest` with resolved ID logged; `claude-sonnet-5` for B6; ~$50/month watch (skip starting a run if month-to-date is already at the ceiling; no mid-night abort); in-app alerts only.

Jev map: code fetches/parses/normalizes/retains/shortlists; Jev does off-topic/junk, planted-instruction, A4 editor picks, and merge/link/leave-alone; Claude writes only the B6 story.

Ingest: dated feeds since last success (24h night one); ranked lists first appearance in 3 weeks, later nights refresh rank/engagement only; skip without freely available full text; papers/model cards: abstract is enough; media URLs only; retry a failed source then continue; ranked lists in full; 15/item feeds; B6 stays one; engagement ranks overflow, never floors; scope AI + developer tooling + AI at work; low-confidence topic filter keeps the item.

Grouping: exact URL auto-merge; trigram/title shortlist of ~5; Noul then Choice; high confidence (starting bar 0.8, to be tuned) or leave alone with no flag; exclusive membership; cap 6; sticky decisions; version snapshot on membership change; no titles.

Review: `/reels` top-level nav item. Sign-off is SIGNOFF-B1 when Lucas says so.

Slice order: foundations → HN+filter → HF papers → GitHub Trending → B1 RSS → A5/A6/B3 → A4 editor → B6 (gated) → grouping page → retention/published log.

### 6.7 Review log

| Date | What was reviewed | Lucas's feedback | Resulting decisions |
|---|---|---|---|
| 2026-09-21 | Build 1 shipped end to end: schema `reels`, 15 adapters, ingest screen, A4 editor, grouping, retention, `/reels` review page, `helios-reels` unit. Verified offline (38 unit tests, plus a full pipeline run against the DB with Jev and HTTP stubbed). No live run has been made. | Superseded by the 09-22 run | |
| 2026-09-22 | First live 24-hour run. 103 sources in the pool, 16 dropped, 101 post ideas, 2 grouped. B6 produced a usable story. $0.52 spent across all runs that day. Five defects found and fixed; one design gap left open (below). | Pending | |

**What the first live run showed.**

Working: every feed URL resolved; the ingest screen dropped 16 items with
legible reasons; A4's editor picked 5 repos off the catalog; B6 returned a
saga-shaped story with eight citations across independent publications, which
is the shape D-064 asks for.

Fixed as a result:

1. **B6 crashed the source** when Claude returned `citation_urls` as a bare
   string instead of an array. Tool input is model output, so its shape is a
   claim, not a guarantee; malformed input now reads as a grounding failure and
   a retry.
2. **The candidate shortlist used a length-sensitive similarity.** Plain
   trigram `similarity` scored "Claude Opus 5.5" against "Anthropic releases
   Opus 5.5 with lower prices and Fable-level performance" at 0.095, under any
   useful floor, so Jev never saw a pair it would have matched at 0.97.
   Meanwhile 296 of 307 pairs that did reach Jev came back at or below 0.1.
   Now scored on the better of `similarity` and `word_similarity` with the
   floor at 0.35: **307 comparisons down to 49 for the same groupings.**
3. **Grouping took the first acceptable candidate rather than the best.** It
   now scores the whole shortlist and attaches to the strongest match.
4. **A night that died partway stranded its sources**, which no later run would
   ever group. Grouping now works from the 72-hour pool of ungrouped sources
   rather than from one run id.
5. **The integration test called retention with a zero-day window** and deleted
   every source in the database. It now ages only its own rows.

Resolved after the run (2026-09-22, second pass):

6. **Two post ideas about one event never merged.** Answered by D-071 and
   built: a second grouping pass where SQL proposes idea pairs and P-07 decides.
   On the real pool it fused the two Opus 5.5 ideas into one idea of four
   sources (TechCrunch, the Anthropic release notes, and both Hacker News
   posts) for the cost of one extra Jev call.
7. **The A4 floor could be missed silently.** `buildCatalogItem` swallowed
   GitHub failures, so the source reported `ok` with zero items and the floor
   of 2 went unmet with nothing to show for it. A4 now fails loudly when picks
   were chosen but could not be built, naming them.
8. **Newsletter tracking links were stored as identity.** TLDR items arrive as
   `tracking.tldrnewsletter.com/CL0/...`, a different URL per recipient that
   can never dedupe against the same article elsewhere. Pointers now record the
   URL the redirect actually landed on, and fingerprint both.

Third pass, same day, after `REELS_GITHUB_TOKEN` was added:

9. **A1 and A4 recovered.** Trending ingested 8 of 8 and the A4 editor built 4
   picks. A personal access token with no scopes is enough; a GitHub App adds
   installation plumbing for the same 5,000 requests an hour. The variable is
   deliberately Reels-specific because `GITHUB_TOKEN` is already the bootstrap
   fallback for Client Dashboards' repo sync.
10. **A1 returns 8 repos, not 25.** Verified against the live page with a
    browser user agent: `github.com/trending` really is listing 8 today. Not a
    parser fault and not the throttle.
11. **The B6 retry path was malformed.** Grounding failed on the first attempt
    and the retry turn sent plain feedback after an assistant `tool_use`, which
    the Messages API rejects with a 400: every `tool_use` needs a matching
    `tool_result` in the next message. The story was paid for and lost. Fixed,
    and a failure on the retry now reports the grounding reason that caused it
    rather than only the transport error.

Still open for Lucas:

- **B6's retry path has not run live since the fix.** It is unit-tested, but
  the first attempt has to fail grounding before the retry is exercised, so it
  needs another night to be seen working end to end.
- **Grouping is sparse so far**: after idea merging, 100 ideas from 103
  sources. Most of the pool is 50 Hugging Face papers and 26 Hacker News
  stories, which really are separate stories. Whether that is the right density
  is a judgment for the review gate, not one the agent should make.
- **Hacker News loses about a third of its items** to the destination fetch
  (7 `fetch_failed`, 7 `no_full_text` on the first night). The pool tab now
  breaks drops down by domain so a repeat offender is visible rather than
  inferred.

Implementation notes worth raising at that review:

- Feed endpoints were probed before being wired. Anthropic publishes no news
  RSS, so A5 reads its platform release notes (`docs.claude.com/en/release-notes/api.md`),
  which is the changelog that source type asks for. Where an outlet has an
  AI-section feed (TechCrunch, Ars Technica) that is what we take.
- `HIGH_CONFIDENCE = 0.8` is provisional (D-057). Jev Nouls return a
  probability with no separate confidence value, so the bar is applied to the
  same-event probability and to the Choice's confidence.
- The group-size cap counts distinct angles: a near-duplicate still folds into
  the primary once an idea holds six, rather than spawning a second idea for
  one event.
- The A4 nightly ceiling (5) has no decision behind it. It is an implementation
  brake because each pick costs GitHub calls; retune it once real nights exist.

## 7. Build 2: scoring

Spec Phase 3. Signed off 2026-09-22 (D-089). Lucas opened it before `SIGNOFF-B1` (D-072). The brief is D-085. Question sets P-08 and P-09 are D-086. The runner calls them at the end of each night.

Scope: score every timely post idea on the four scores and rank them.

Review output: the scored leaderboard of post ideas from the pool built by the latest 24-hour scrape, plus yesterday's ranks 4–13 brought back into that ranking (D-080).

Out of scope: copy and captions (Build 3, D-006), visuals, publishing, cooldown matching (D-012).

Settled by the spec, then narrowed by the kickoff:

- Four scores, each calculated individually by Jev, combine into a net score. Jev's raw score sits on rubric levels. Code divides by the top level so the spec's 0.60 and 0.25 apply on a 0–1 scale (D-075).
- Psychology: three frameworks, scored separately, against the source as it stands, looking for a hook-worthy element and what that element could become (D-073). At or above 0.60 is viable. A viable framework that trails the leader by 0.25 or more is dropped. A framework within 0.25 of the leader stays (D-075).
- A viable framework opens every bucket that lists it, first or second (D-074). The highest bucket score is used. The psychology term is the higher viable framework score among the frameworks listed on that winning bucket.
- Value: knowledge and entertainment, scored after the winning framework and bucket are known. The net uses the higher of the two (D-076).
- Blockbuster: +0.25 once, or 0 (D-087). Subject only. Flagship model or product launch. Seed lists and the 0.80 bar are D-077.
- Net = psychology + bucket + value + blockbuster (D-079), plus 0.08 when the winning bucket is Ball Knowledge. Cooldown adds nothing until publishing exists.
- The day's posts are the top 3 of today's timely ideas plus yesterday's ranks 4–13, rescored (D-080). Same bucket may fill all three (D-082).
- The web-search story uses the same rubrics as every other idea (spec, D-008). Its writer still never sees them (D-064).

### 7.1 Build brief (approved 2026-09-22, D-085)

Lucas approved this by saying he was ready for the next step. The delegated defaults in the list below are part of that approval.

After grouping, on the same nightly run and on Run now:

1. Build one state per post idea. Primary member: headline, source name, and about 1,200 words. Each supporting member: headline, source name, and about 300 words. Merged duplicates: headline and source name. The idea is judged as a whole (D-084). Scraped text stays untrusted. Logging stays on D-030. The ingest planted-instruction screen is not repeated.
2. One Jev request: three psychology Scores, a Score for every bucket a surviving framework could open, and three blockbuster Nouls. The request may ask all six bucket Scores up front. Code ignores a bucket whose frameworks all failed the gate. Questions are independent, so a bucket score does not see the psychology numbers (D-074, D-077).
3. Normalize, apply the 0.60 / 0.25 gate, pick the bucket, then the psychology term (D-074, D-075). An idea with no viable framework is stored with its psychology scores, gets no net, and cannot be selected.
4. Second Jev request: knowledge and entertainment. The state names the winning framework and bucket. Value is the higher of the two (D-076). The viewer is whichever of developers, founders and executives, and operators the idea would hit hardest (D-081).
5. Blockbuster is 0.25 if any of the three subject Nouls is at or above 0.80, else 0 (D-077, D-087).
6. Net is the straight sum (D-079). Warning and Callout scores already include their guardrails (D-083). Feeds-from does not filter candidates (D-078).
7. Rank today's timely ideas. Rescore yesterday's ranks 4 through 13 by that night's net, among ideas that received a net, and put them in the same pool. Take the top 3 (D-080). Persist every component, the chosen framework and bucket, the blockbuster triggers, the net, the rank, and whether the idea was selected.
8. Show the leaderboard on `/reels`.

A second Run now on the same New York calendar day replaces that day's slate. It does not carry from itself. If the previous New York day has no scoring run, nothing carries. An idea that gained a member today is today's idea. Yesterday's selected three do not return. More than one carryover can sit in the three when the scores earn it. A tie at rank 13 includes every idea on that score.

Approved with the brief (D-085):

- Low confidence does not knock an idea out. The score still counts. Confidence is stored and shown.
- Equal nets: higher bucket score, then higher psychology score, then more recent `last_joined`.
- "Grok / SpaceX" in Lucas's list is stored as two entries, xAI (Grok) and SpaceX (D-077).
- Ranks 4 through 13 count only ideas that received a net.

Question sets P-08 and P-09 are approved (`scoring-pass1-v1`, `scoring-pass2-v1`). The gate, net, and slate functions are in `lib/reels/scoring/decide.ts`. The runner scores after grouping and the leaderboard is the Scores tab on `/reels`.

Slice order: pure gate, net, and slate functions with tests (done) → P-08 and P-09 approved (done) → schema, runner, and leaderboard (done) → Lucas reviewed the 2026-09-22 slate and signed off (D-089).

## 8. Registers

### 8.1 Decision Log

One row per decision. Use Lucas's words where possible. New decisions supersede old ones; nothing gets deleted.

| ID | Date | Build | Question | Decision | Evidence / notes | Supersedes |
|---|---|---|---|---|---|---|
| D-001 | 2026-09-21 | 1 | GAP-1 | There are 12 source types. A couple of types hold several sources, so expect 13 to 18 individual sources in total. The coding agent decides which are worthwhile. | Answered during planning. Source selection is delegated (Section 2). D-003 takes two types out of Build 1. | |
| D-002 | 2026-09-21 | 1 | GAP-2 | No. Use the sources listed in the plan, and only its 12 content types. | Out: everything named only in the buckets' "Feeds from" lines (Reddit threads, podcast transcripts, long-form profiles and books, SEC filings, regulatory texts, security disclosures, benchmark results, industry surveys, Helios's own delivery experience). | |
| D-003 | 2026-09-21 | 1 | GAP-3 | Oral history archives and Wikipedia timelines aren't used. GitHub is about what's been trending, which lends itself to recency. | Applies to A1 and B4. D-010 takes the rest of B2 out. | |
| D-004 | 2026-09-21 | 1 | GAP-4 | Yes, the link is a list of AI awesome-lists; monitor it alongside the three named lists. The lists don't change much, so come up with a pulling strategy that allows "constantly refreshed takes or allocation or perspectives." | The strategy is FU-2. | |
| D-005 | 2026-09-21 | 1 | GAP-5 | Publishing comes in the future. When it does, it gets logged by post idea. | Answers COOL-01. What Build 1 builds for cooldown until then is FU-3. | |
| D-006 | 2026-09-21 | 3 | GAP-6 | Yes. On-screen copy and captions come after Build 2, as Build 3. | | |
| D-007 | 2026-09-21 | 1 | GAP-7 | No. Compare new sources against a 72-hour pool so they can join existing post ideas. Any post idea that has had a source join it in the last 72 hours is eligible for the reference pool. | Sources are still kept for 3 weeks. The 72 hours sets what new sources are compared against. | |
| D-008 | 2026-09-21 | 1 | GAP-8 | It enters the pool as a source and goes through merge and link. | | |
| D-009 | 2026-09-21 | 1 | GAP-9 | Lucas gives the repo in his coding agent access to the humanizer skill. | The completeness check is FU-4. How it's applied is still WEB-06. | |
| D-010 | 2026-09-21 | 1 | FU-1 | Wikipedia is out entirely. | B2 is out, Pageviews spike detector included. Build 1 has 10 source types. | |
| D-011 | 2026-09-21 | 1 | FU-2 | Yes, that refresh strategy works. | Confirms the approach in FU-2: the agent designs the A4 strategy and brings options before building. No specific strategy has been proposed yet. | |
| D-012 | 2026-09-21 | 1 | FU-3 | Only a place to log published status. | No cooldown matching or mock-publish testing in Build 1. COOL-03 to COOL-05 wait until publishing exists. | |
| D-013 | 2026-09-21 | 1 | FU-4 | Valid. | The agent checks the humanizer copy for patterns 1 through 9 before designing WEB-06. | |
| D-014 | 2026-09-21 | 2 | Parking lot: Personal Profile feeds | That's fine. Claude web search is the only feed Personal Profile needs. | Resolves the parking-lot note on "Feeds from" sources that aren't ingested, for Personal Profile. | |
| D-015 | 2026-09-21 | 1 | FND-06 | Engine lives in The-Helios-Hub on Trial-Reels. | Manual Run now on `/reels`. | |
| D-016 | 2026-09-21 | 1 | FND-01 | TypeScript / Node. | Official JS SDK `@typesafe-ai/sdk`. | |
| D-017 | 2026-09-21 | 1 | FND-02 | New systemd unit on the existing GCP VM, not the outreach worker process. | Sibling of `helios-worker`. | |
| D-018 | 2026-09-21 | 1 | FND-03 | Existing Supabase Postgres. | Schema `reels`. Similarity is Postgres trigram, not a paid embedding API. | |
| D-019 | 2026-09-21 | 1 | JEV-01 access | TypeSafe key already in `.env.local` and `worker.env`. Full Jev access. | | |
| D-020 | 2026-09-21 | 1 | Section 5 audiences | Developers at all levels, founders/executives, and operators, weighted about equally. Helios as AI-consulting expert still holds. | "Practitioners" is too narrow. | |
| D-021 | 2026-09-21 | 1 | JEV-01 version | Use `jev-latest`. Log the resolved versioned ID per call. | Not pinned to 1.13.0. | |
| D-022 | 2026-09-21 | 1 | FND-04 | `claude-sonnet-5` for B6; same model if anything else writes in Build 1. | Only B6 writes in Build 1 (D-065). | |
| D-023 | 2026-09-21 | 1 | FND-05 | Watch ~$50/month; pause and ask before a run that would blow it. No mid-night abort. | Skip starting a run if month-to-date is already at the ceiling. | |
| D-024 | 2026-09-21 | 1 | FND-07 | Create free accounts/tokens autonomously. No other paid sources. | Anthropic and TypeSafe already exist. | |
| D-025 | 2026-09-21 | 1 | FND-08 | Notification on the Trial Reels product page. Not email/Slack. | | |
| D-026 | 2026-09-21 | 1 | FND-07 B4 | Drop B4 (GH Archive / BigQuery) from Build 1. | Parked until BigQuery spend is explicitly allowed. | |
| D-027 | 2026-09-21 | 1 | JEV-02 | TypeScript modules in git with an explicit version constant. | `lib/reels/jev/` | |
| D-028 | 2026-09-21 | 1 | JEV-03 | Map A: code fetches/parses/normalizes/retains/shortlists; Jev does off-topic/junk, merge/link/leave-alone, planted-instruction, A4 editor; Claude writes only the B6 story. | No Claude in grouping. | |
| D-029 | 2026-09-21 | 1 | JEV-05 | Low-confidence grouping: leave the source as its own post idea; do not flag it. | | |
| D-030 | 2026-09-21 | 1 | JEV-04 + JEV-06 | Log question-set version, resolved model ID, full distribution, confidence, and the state sent, for post-idea life plus 3 weeks. Wrap scraped text as untrusted. Planted-instruction Noul before grouping or Claude. Never put scraped text in a Claude system prompt as instructions. | | |
| D-031 | 2026-09-21 | 1 | ING-01 | 1:00 AM America/New_York. | | |
| D-032 | 2026-09-21 | 1 | ING-02 + ING-09 | Dated feeds: since last successful run (24h lookback night one). Ranked lists: first appearance in 3 weeks is the record; later listings refresh rank/stars/points only. Keep first stored body if an article is edited. | A4 is D-066, not this package. | |
| D-033 | 2026-09-21 | 1 | ING-03 | AI + developer tooling + AI at work/operations. Jev filters at ingest. Low confidence keeps the item. | | |
| D-034 | 2026-09-21 | 1 | ING-05 | Store engagement; use it only to rank when over a cap; no hard floors. | | |
| D-035 | 2026-09-21 | 1 | ING-04 | Entire ranked list. 15 items per article/feed source per night. B6 stays one. | | |
| D-036 | 2026-09-21 | 1 | ING-06 | Skip anything we cannot get freely available full text for. | | |
| D-037 | 2026-09-21 | 1 | ING-07 | Store image/video URLs; do not download binaries. | | |
| D-038 | 2026-09-21 | 1 | ING-08 | Retry that source, continue the night, Phase 2 on what arrived, partial-run notice, next night backfills dated feeds. | | |
| D-039 | 2026-09-21 | 1 | REC-01 | Package A fields (URL, headline, body, author/byline, source name, type, bucket, publish time, ingest time, language; optional engagement, media URLs, raw pointer). | | |
| D-040 | 2026-09-21 | 1 | REC-02 | Smallest useful item, not the bundle. HN body is the destination/README; comment count only. GitHub = README + latest release notes. | | |
| D-041 | 2026-09-21 | 1 | REC-03 | Follow the destination; if full free text fails, skip the item. | Matches D-036. | |
| D-042 | 2026-09-21 | 1 | REC-04 | Keep raw API/HTML 3 weeks. Never send it to Jev/Claude. | | |
| D-043 | 2026-09-21 | 1 | REC-05 | No entity-extraction pipeline in Build 1. | | |
| D-044 | 2026-09-21 | 1 | RET-01 | 3-week clock starts at ingest time. | | |
| D-045 | 2026-09-21 | 1 | RET-02 | Detach aged sources; delete the post idea when none remain unless a published-status row exists. | | |
| D-046 | 2026-09-21 | 1 | RET-03 + RET-04 | Hard-delete bodies and raw payloads after 3 weeks, after that night's ingest. Keep URL fingerprints, published-status rows, and Jev logs (idea life + 3 weeks). | | |
| D-047 | 2026-09-21 | 1 | CLN-01 | Code strips chrome; Jev drops junk/off-topic; English only; no LLM rewrite of bodies. | | |
| D-048 | 2026-09-21 | 1 | CLN-03 | Dropped items stay visible on the raw-pool page with the reason. | | |
| D-049 | 2026-09-21 | 1 | SRC-00 | Easy-first adapters. No permanent ingest gate. Manual Run now for iteration; 1 AM is autonomous. Do not pause the next adapter on waiting for review. | Restated after Lucas rejected a standing review step. | |
| D-050 | 2026-09-21 | 1 | SRC roster | 17 sources: GH Trending; HN; HF Daily Papers; three awesome-lists + list-of-lists; OpenAI/Anthropic/Cursor changelogs; TLDR + Console.dev; TechCrunch, Ars, 404 Media; Cloudflare + DeepMind; B6. | Delegated (D-001). Wired/Verge omitted for paywalls. | |
| D-051 | 2026-09-21 | 1 | STY-01 | Same story = the same news event or disclosure, including same-day explainers and reactions. Recurring entities are not enough. | | |
| D-052 | 2026-09-21 | 1 | STY-02 | Merge near-duplicate coverage; link complementary angles; do not group on company name alone. | | |
| D-053 | 2026-09-21 | 1 | STY-03 | Inside 72h of a source joining, same-event coverage can join; after 72h quiet, a later chapter is a new post idea. | | |
| D-054 | 2026-09-21 | 1 | STY-04 | Label pairs on the page after real nights exist. Not a build blocker. Lucas is the only labeler. | | |
| D-055 | 2026-09-21 | 1 | GRP-01 | Exact URL auto-merge; else code shortlist (title overlap, trigram) of up to ~5, then Jev. Empty shortlist stands alone. | | |
| D-056 | 2026-09-21 | 1 | GRP-02 | Planted-instruction Noul first; Noul "same event?"; if yes, Choice merge / link / leave. State is headlines, types, times, excerpts. | | |
| D-057 | 2026-09-21 | 1 | GRP-03 | Merge or link only at high confidence; otherwise leave alone, no flag. Starting bar 0.8, to be tuned on labels. | Implementation starting value pending calibration. | |
| D-058 | 2026-09-21 | 1 | GRP-04–08 | At most one post idea per source; cap 6 members; page override is sticky; do not re-ask decided pairs; show numbers not prose. | | |
| D-059 | 2026-09-21 | 1 | IDEA-01/02/04 | Structural fields only, including timely + last-joined. No Claude title. | | |
| D-060 | 2026-09-21 | 1 | IDEA-03 | Version snapshot every time membership changes. | Overrides the "current + log is enough" recommendation. | |
| D-061 | 2026-09-21 | 1 | COOL-02 | Published log: yes/no + timestamps; survives source deletion; nothing auto-published. | | |
| D-062 | 2026-09-21 | 1 | REV-01/02 | One authenticated Hub page at `/reels`. | Top-level nav, not an Outreach tab. | |
| D-063 | 2026-09-21 | 1 | REV-03/05/06 | Page flags (wrong merge, missed link, junk). Sign-off when Lucas says so. | | |
| D-064 | 2026-09-21 | 1 | WEB-02–05, WEB-07 | Shape-only brief; citations; ≥2 sources; one retry then skip; after other ingest, before grouping; memory of last 7 B6 headlines + tonight's pool. | | |
| D-065 | 2026-09-21 | 1 | WEB-06 | Humanizer is for copy and captions of the 3 daily posts (Build 3). Do not pass sources through it. B6 stays as the only Build 1 LLM call. | Supersedes spec wording that B6 uses the humanizer. Spec file unchanged (R9). | D-009 for application, not access |
| D-066 | 2026-09-21 | 1 | SRC-A4 | Jev editor: standing catalog, shortlist (news overlap + rotation), Jev picks, floor ≥2 A4 records/night, 3-week fingerprint unless a news peg hits. | Supersedes "new entries + releases" proposal. | D-011 |
| D-067 | 2026-09-21 | 1 | ING-06 papers | For papers and model cards, abstract + metadata counts as full text. A parsed PDF/HTML body is a bonus; a failed PDF parse does not drop an item that already has an abstract. | Corrected after an earlier "drop on failed PDF" note. | |
| D-068 | 2026-09-21 | 1 | SRC-A1 + SRC-A2 | GitHub: scrape daily Trending (all languages) + REST README/release. HN: front page + Show HN. Topic left to Jev. | | |
| D-069 | 2026-09-21 | 1 | D-013 check | Repo humanizer skill has patterns 1–25. Completeness check closed. | | |
| D-070 | 2026-09-22 | 1 | WEB-01 / P-01 | B6 prompt approved. | Registered as `web-search-v1`. Live wherever `REELS_B6_PROMPT_APPROVED=true` is set. Worker not deployed yet. | |
| D-071 | 2026-09-22 | 1 | GRP-05 follow-up | Two ideas about one event should absolutely merge. Code establishes potential idea merges, then a Jev call validates the merge. | Raised by the first live run, where the four Opus 5.5 sources sat in two ideas. Built as a second grouping pass: SQL proposes idea pairs from cross-member headline similarity, P-07 decides, merges repeat up to 3 passes. Extends D-058, which only covered one source joining one idea. | |
| D-072 | 2026-09-22 | 2 | Build 2 opened | Lucas opened the scoring kickoff before SIGNOFF-B1. | He asked to start Build 2. Build 1 sign-off stays open. Scoring code waits on the brief in 7.1. | |
| D-073 | 2026-09-22 | 2 | SCR-JUDGE | Score the source as it already reads, and let Jev consider what it could become. The question is whether the source has an element that makes it hook-worthy. | Applied separately to each framework and each open bucket. No Claude draft before the score. Lucas's wording. | |
| D-074 | 2026-09-22 | 2 | SCR-ELIG | Primary and secondary are both scored. The higher score is the one used. The label is not a priority. | Follow-up picked the wide map: a viable framework opens every bucket that lists it, first or second. Curiosity opens Ball Knowledge, The Number, The Saga, Personal Profile, and The Warning. Arousal opens The Number, The Saga, The Warning, and The Callout. Identity opens Ball Knowledge, Personal Profile, and The Callout. A bucket is scored once. The psychology term for the winning bucket is the higher score among the viable frameworks that bucket lists. A framework the gate dropped does not open buckets and cannot supply the psychology term. | |
| D-075 | 2026-09-22 | 2 | SCR-GATE | Leader-relative 0.25 gap. A total miss cannot be posted. Bucket ties break by framework score, then confidence, then spec order. | Viable means 0.60 or above after code normalizes Jev's level score onto 0–1. Drop a viable framework only when it trails the leader by 0.25 or more. 0.90, 0.70, 0.62 keeps the first two. No viable framework: keep the psychology scores, no bucket, no net, cannot be one of the three. Spec order: Ball Knowledge, The Number, The Saga, Personal Profile, The Warning, The Callout. | |
| D-076 | 2026-09-22 | 2 | SCR-VALUE | The net uses the higher of knowledge and entertainment. | Second Jev call, told which framework and bucket won. Both numbers stay visible. The bucket scores are not told the psychology numbers. | |
| D-077 | 2026-09-22 | 2 | SCR-BUST | Subject only, flagship launch, one +0.40, bar at 0.80. Lucas replaced the seed lists. | Companies: Anthropic, Nvidia, Microsoft, Google, Meta, OpenAI, Hugging Face, xAI (Grok), SpaceX, Higgsfield, Google DeepMind, AWS, DeepSeek, Mistral AI, Perplexity. People: Sam Altman, Elon Musk, Dario Amodei, Jeff Bezos, Mark Zuckerberg, Eric Schmidt, Alex Karp, Jensen Huang, John Ternus, Donald Trump, Demis Hassabis, Ilya Sutskever, Andrej Karpathy, Liang Wenfeng, Satya Nadella. "Grok / SpaceX" is logged as two entries. A passing mention does not count. A price change, a minor API update, or a post about an existing model does not count. Three Nouls, any one at or above 0.80 adds 0.40 once. | |
| D-078 | 2026-09-22 | 2 | SCR-FEEDS | Any timely idea can be scored for any bucket the psychology gate opens. | Feeds-from stays ingestion guidance. | |
| D-079 | 2026-09-22 | 2 | SCR-NET | Straight sum: psychology + bucket + value + 0 or 0.40. | Components stored separately so weights can change later without rescoring. Cooldown subtracts nothing until publishing exists (D-012). | |
| D-080 | 2026-09-22 | 2 | SCR-SLATE | Always 3. Yesterday's top 10 misses are rescored and can take a slot by beating third place. | The window is ranks 4 through 13 of the previous New York day's latest scoring run. A tie at the cutoff includes every idea on that score. Yesterday's top 3 do not return. More than one carryover can make the three. An idea that gained a member today is today's idea. A second Run now on the same New York day replaces today's slate. If yesterday has no scoring run, nothing carries. Anything older than the previous day stays out. Brief reading, correct on approval: those ranks count only ideas that received a net, so an idea with no score does not consume a miss slot. | |
| D-081 | 2026-09-22 | 2 | SCR-AUDIENCE | Score the audience this would hit hardest. One of the three is enough. | Developers, founders and executives, and operators (D-020). Written into the psychology and value questions. | |
| D-082 | 2026-09-22 | 2 | SCR-MIX | The three highest net scores. The same bucket can fill all three. | No portfolio targets and no ban on back-to-back negative-arousal posts. Resolves the 2026-09-21 parking-lot item. | |
| D-083 | 2026-09-22 | 2 | SCR-GUARD | Warning and Callout guardrails are part of those bucket scores. | A Warning needs a concrete cost the source supports. A Callout aims at a practice or a vendor, not at the buyer's identity. | |
| D-084 | 2026-09-22 | 2 | SCR-STATE | Tiered excerpts. The idea is judged as a whole. | Primary: headline, source name, about 1,200 words. Supporting: headline, source name, about 300 words. Merged duplicate: headline and source name. | |
| D-085 | 2026-09-22 | 2 | Build 2 brief | Brief approved. Lucas said he was ready for the next step. | Includes the delegated defaults: low confidence still counts and is shown; equal nets break by bucket score, then psychology score, then more recent last_joined; ranks 4 through 13 count only ideas that received a net; Grok / SpaceX is xAI (Grok) and SpaceX. | |
| D-086 | 2026-09-22 | 2 | P-08 and P-09 | Question sets approved. | `scoring-pass1-v1` and `scoring-pass2-v1`. The runner may call them. Lucas reviews a night he starts; the agent does not. | |
| D-087 | 2026-09-22 | 2 | SCR-BUST | Blockbuster is worth 0.25, not 0.40. | Same trigger: any subject Noul at or above 0.80 adds it once. The 2026-09-22 slate was recomputed from stored components. No rescore. Spec file unchanged (R9). | D-077 |
| D-088 | 2026-09-22 | 2 | Scores tab | A scored row shows only the addends that entered the net. | Winning framework, winning bucket, the higher of knowledge and entertainment, and blockbuster when it is above 0. Confidence stays stored and does not appear on that row. An idea with no net shows the headline and “No framework cleared 0.60.” | D-085, the “shown” clause only |
| D-089 | 2026-09-22 | 2 | SIGNOFF-B2 | Build 2 approved. Lucas said to consider this build approved after reviewing the 2026-09-22 slate. | 119 ideas scored, top 3 selected, blockbuster recomputed at 0.25 (D-087), Scores tab as in D-088. He asked why rank 2’s arousal was high and why rank 16 sat where it did; neither became a rubric change. Build 3 unlocks. `SIGNOFF-B1` stays open. | |
| D-090 | 2026-09-22 | 3 | B3-TRIGGER | Automatically after scoring, every night and on Run now, for the 3 selected ideas. A same-day rerun replaces that day's copy. An env flag keeps it off until the prompt is approved, like B6. | Flag is `REELS_COPY_PROMPT_APPROVED`. Copy is keyed to the slate, so the page follows the latest slate. | |
| D-091 | 2026-09-22 | 3 | B3-CALL | One `claude-sonnet-5` call per idea. The humanizer sits in the cached system prompt, and the model checks its draft against it before returning. | The tool carries working fields (hook drafts, first drafts, remaining humanizer patterns) ahead of the final copy, so the check happens inside the one call. | |
| D-092 | 2026-09-22 | 3 | B3-OUTPUT | One on-screen copy and one caption per idea, shown under that idea on the Scores tab. | On-screen copy is one block with line breaks for screen breaks. Timed screens wait for the visuals build. | |
| D-093 | 2026-09-22 | 3 | B3-MECHANICS | Include the call to action and 3–5 hashtags at the end. No emoji. | Both come after the bucket's caption structure is complete, so Personal Profile's six parts keep their order. | |
| D-094 | 2026-09-22 | 3 | B3-VOICE | No first-person Helios at all. Second or third person only, and every fact comes from the sources. | Overrides the "our" in the Ball Knowledge example copy and the "we" in the In-Group Callout formula. Helios may be named in the third person where a bucket asks for it. | |
| D-095 | 2026-09-22 | 3 | B3-LINKS | Name the source in the caption and store the URLs next to the caption for Lucas's review only. | Reads Ball Knowledge's "link" and The Warning's "source in the caption" as a named source. | |
| D-096 | 2026-09-22 | 3 | B3-BODY | Agent reading, stated at kickoff without objection: "full body" means every member's stored body, merged duplicates included, in the user turn wrapped as untrusted (D-030). No second planted-instruction screen. | Stored bodies are capped at 40,000 characters. The largest idea in the 2026-09-22 top 13 is about 13k tokens; the worst case (6 members at the cap) is about 60k. Confirm at the review gate. | |
| D-097 | 2026-09-23 | 3 | P-10 | Prompt approved. Lucas said the system is still the September 22 canary, so consider it hard approved. | Version stays `copy-caption-v1`. No wording change. `REELS_COPY_PROMPT_APPROVED=true` in `worker.env` and `.env.local`. The canary wrote the top 5 on 2026-09-22 (5 written, 0 failed, $0.221) and did not itself flip the nightly flag. | |
| D-098 | 2026-09-23 | 3 | P-10 | A reel is one screen and one scene. The bucket word count is a hard constraint, and it outranks "across the runtime." | Version `copy-caption-v2`. A line break is a rhythm break on that same still. The Enigma saga had been written past 70 words and marked screen 1 of 6. | |
| D-099 | 2026-09-23 | 3 | P-10 | The live reel writer returns on-screen copy with natural line breaks already in the string. | Version `copy-caption-v3`. The `copy-caption-v1` wording, which was writing the longer posts, is frozen unused at `lib/reels/threads/post-engine-candidate.ts` as a Meta Threads post-engine candidate. | |
| D-100 | 2026-09-24 | 3 | Reel hook | A visual hook dominates the whole screen for exactly the first 0.5 seconds, arrives in one frame, and leaves in one frame. In-scene events (a lock opening, a phone lighting up) are mid-clip story beats, not hooks. The hook may leave the two-tone palette. | ffmpeg stamps the hook frame-exact; Kling never receives it, because a video model blends frames. The motion writer only makes sure the scene is already mid-motion when the hook cuts out. Lucas's wording. | |
| D-101 | 2026-09-24 | 3 | P-11 | At least five ffmpeg hooks, routed by a Jev node that reads only the on-screen copy. | Seven hooks: glitch, static, color_bars, invert, vhs, thermal, blue_screen. An upside-down flip was built and dropped because a dark frame flipped still reads as a dark frame. | |
| D-102 | 2026-09-24 | 3 | P-11 | Drop the static hook. Lucas ranks it last. Concealment (a false public picture, people not told) moves to invert. A breach stays on glitch. An old secret whose age is the point stays on vhs. | Version `hook-route-v2`. Six hooks remain. |
| D-103 | 2026-09-24 | 3 | Reel video | Clips are 8 seconds. Kling 3.0 Standard on Fal accepts 3–15, so 8 is a direct duration, not two shots stitched. | The motion prompt covers 0.0–8.0. The hook stays the first 0.5 seconds. The story beat moves to 3.0–5.0, the middle of the longer clip. Audio stays off. Eight seconds is $0.672. |
| D-104 | 2026-09-24 | 3 | P-10 | The on-screen copy has to be understandable by a general viewer. An insider name cannot be the noun the hook turns on. Expertise is saying the advanced idea in ordinary words, and the source's figure stays. | Version `copy-caption-v4`. Lucas's examples: "A100" / "Hopper", and "KernelBench" / "CUDA kernel". A known company name can stay. |
| D-105 | 2026-09-24 | 3 | P-12 | Three color grades. noir is the existing dark room. paper is a white field with black type. orange floods about 80% of the frame with #FF5E1A as a grade, and the type stays white with a black stroke. | Jev picks from the on-screen copy only. The same grade is stored on the frame and reused for the video plate. |
| D-106 | 2026-09-24 | 3 | P-12 | Noir also covers a record, a permission, or a process that keeps going after the person looks away. Lucas asked for noir a little more often. | Version `color-route-v2`. A price, a loss, or a warning stays orange even when the thing keeps running. A clean fact with nothing continuing offstage stays paper. |
| D-107 | 2026-09-24 | 3 | P-10 | The on-screen copy never starts with a pronoun. A first word like "It" points at nothing, and the viewer is lost. | Version `copy-caption-v5`. Lucas's example: "It asked a government website for spending data." Name the thing in the opening words. "You" can still open, because it addresses the viewer. |
| D-108 | 2026-09-24 | 2 | SCR-NET | A Ball Knowledge story adds 0.08 to its net. Other buckets add nothing. | The bump is its own addend, after blockbuster. It does not change the bucket score Jev returned, and it does not change which bucket wins. |
| D-109 | 2026-09-24 | 3 | P-11 | Three hook timings, each with an equal chance, chosen when the hook is stamped. They apply to every hook. | `double` is on 0.2, off 0.1, on 0.2, inside 0.5s. `strobe` is five 0.1s beats inside 0.5s. `tail` is on 0.1, off 0.1, on 0.1, off 0.1, on 0.2, inside 0.6s. |

### 8.2 Prompt and question-set registry

Every language model prompt and Jev question set, with its approval state. Nothing unapproved produces output Lucas reviews.

| ID | Component | Engine | Build | Status | Approved version | Notes |
|---|---|---|---|---|---|---|
| P-01 | Web search story generator | Language model | 1 | Approved 2026-09-22 | `web-search-v1` | `lib/reels/prompts/web-search.ts`. Runs where `REELS_B6_PROMPT_APPROVED=true` is set. D-064, D-065, D-070. |
| P-02 | Same-story / merge / link decision | Jev | 1 | Shipped, awaiting review | `grouping-v1` | `lib/reels/jev/questions/grouping.ts`. Noul then Choice in one request. |
| P-03 | Published-story match | Jev | Later | Deferred | | Not built until publishing exists (D-012) |
| P-04 | Ingest topic / junk / English screen | Jev | 1 | Shipped, awaiting review | `ingest-filter-v1` | `lib/reels/jev/questions/ingest-filter.ts` |
| P-05 | Planted-instruction check | Jev | 1 | Shipped, awaiting review | `planted-v1` | `lib/reels/jev/questions/planted-instruction.ts`. Sent with P-04 in one call. |
| P-06 | A4 catalog editor | Jev | 1 | Shipped, awaiting review | `a4-editor-v1` | `lib/reels/jev/questions/a4-editor.ts` |
| P-07 | Same-event idea merge | Jev | 1 | Shipped, awaiting review | `idea-merge-v1` | `lib/reels/jev/questions/idea-merge.ts`. Validates idea pairs that code proposed (D-071). |
| P-08 | Psychology, bucket, and blockbuster scores | Jev | 2 | Approved 2026-09-22 | `scoring-pass1-v1` | `lib/reels/jev/questions/scoring-pass1.ts`. One request. D-086. |
| P-09 | Knowledge and entertainment | Jev | 2 | Approved 2026-09-22 | `scoring-pass2-v1` | `lib/reels/jev/questions/scoring-pass2.ts`. Second request. D-086. |
| P-10 | On-screen copy and caption writer | Language model | 3 | Approved 2026-09-24 | `copy-caption-v5` | Seeded text in `lib/reels/copy/skill.ts`; spec and humanizer text frozen in `source-text.generated.ts`. Runs where `REELS_COPY_PROMPT_APPROVED=true`. D-090 to D-099, D-104, D-107. `copy-caption-v4` is retired. |
| P-11 | Reel hook router | Jev | 3 | Shipped, awaiting review | `hook-route-v2` | `lib/reels/jev/questions/hook-route.ts`. One Choice over the on-screen copy only; the top choice is used at any confidence. D-100, D-101, D-102. `hook-route-v1` included static and is retired. |
| P-12 | Reel color router | Jev | 3 | Shipped, awaiting review | `color-route-v2` | `lib/reels/jev/questions/color-route.ts`. One Choice over the on-screen copy only: noir, paper, or orange. D-105, D-106. `color-route-v1` is retired. |

P-02 through P-07 shipped before a Build 1 review and still await one. P-08 and P-09 were reviewed with the 2026-09-22 slate (D-089). P-01 stays hard-gated, because it writes prose rather than returning a judgment.

Add rows as decisions create new components. Likely candidates, depending on the answers: a humanizer pass (WEB-06), whatever the A4 strategy needs (D-011), cleaning (CLN-02), a topic filter (ING-03), entity extraction (REC-05), post idea titles or synopses (IDEA-02), grouping explanations (GRP-08).

### 8.3 Parking lot

Items for later builds. Log them here and don't act on them.

| Date | Item | For | Raised by |
|---|---|---|---|
| 2026-09-21 | Earlier planning attached a recommended portfolio share to each content bucket, and a rule against back-to-back negative-arousal posts was proposed. Neither is in the current spec. Resolved 2026-09-22: the three highest nets win, and a bucket may fill all three (D-082). | Build 2 | Plan setup |
| 2026-09-21 | A third content category is planned but undefined. | Later | Plan setup |
| 2026-09-21 | On-screen copy and captions. | Build 3 (D-006) | Spec |
| 2026-09-21 | Image and video generation. Publishing to Meta, with published status logged by post idea (D-005). | Later | Spec |
| 2026-09-21 | D-002, D-003, and D-010 keep several "Feeds from" sources out of the pool. For Personal Profile, Claude web search is the only feed needed (D-014). Resolved 2026-09-22: Feeds-from does not limit which ideas a bucket can score (D-078). | Build 2 | Gap answers |
| 2026-09-21 | Cooldown matching, the Build 1/Build 2 split for the penalty, and cooldown testing (COOL-03 to COOL-05, P-03). | When publishing exists (D-012) | Gap answers |
| 2026-09-21 | GH Archive / BigQuery (B4). Dropped from Build 1 (D-026). | Later, if BigQuery spend is allowed | Kickoff |
| 2026-09-21 | Humanizer on sources/B6. Not used in Build 1 (D-065). | Build 3 | Kickoff |

## 9. Build 3: on-screen copy and captions

Spec Phase 3 closer. The chosen bucket and the chosen framework inform how the on-screen text and the caption are written from the source. Kickoff answers are D-090 to D-096. Visuals and publishing stay out.

### 9.1 What was built

After scoring, the nightly run writes one on-screen copy and one caption for each of the slate's three selected ideas (D-090), in one cached `claude-sonnet-5` call per idea (D-091). Results show under each selected idea on the Scores tab (D-092). Lucas approved this prompt on 2026-09-23 (D-097). On the same day the on-screen rules were tightened (D-098, `copy-caption-v2`): one screen, and the bucket word count is a hard constraint that outranks a multi-image reading of "across the runtime." It runs where `REELS_COPY_PROMPT_APPROVED=true`.

The assembler (`lib/reels/copy/assemble.ts`) builds one prompt per idea from five inputs:

1. The winning bucket's spec text, verbatim, minus its `Frameworks:` and `Feeds from:` lines.
2. The winning framework's spec text, verbatim. The other two frameworks are not sent.
3. The humanizer skill, verbatim, patterns 1 through 25.
4. Every member's full stored body, in the user turn, wrapped as untrusted (D-096).
5. The copy and caption skill (`lib/reels/copy/skill.ts`), with the winning framework's on-screen and caption logic.

The worker deploy excludes `.cursor/`, so inputs 1 to 3 are frozen into `source-text.generated.ts` by `npm run reels:sync-copy-text`. A test fails if that file drifts from the spec or the skill. `npm run reels:copy-preview` writes the assembled prompt for the latest slate's three to `tmp/reels-copy-preview/` without calling a model.

Cache layout: system block 1 (skill and humanizer, about 8.5k tokens) is identical for every idea; block 2 (bucket and framework, under 1k) is identical per pair; sources go in the user turn. Both system blocks carry 5-minute breakpoints, since a night's three calls run back to back.

Code checks each result and shows flags beside it: on-screen word count against the bucket's range, the 125-character fold, the 2,200-character limit, hashtag count, dashes, URLs in the caption, first-person words, and source URLs not in the idea. Flags do not reject or retry.

### 9.2 Implementation choices to raise at review

- No retry. A failed idea is stored with its error and shown on the Scores tab, and the run is marked partial.
- API default temperature, as with B6. `max_tokens` is 5,000.
- For a compilation source such as B6, the skill tells the writer to credit the cited publication, not the compiler.
- Defect found on deploy and fixed: `helios-reels` exited cleanly about a second after every start (472 restarts in 6 hours) because the poll timer was `unref`'d. systemd restarted it every 15 seconds, so Run now still worked, but a restart just after 1 AM schedules the next day, and `reels.runs` held no scheduled run. The unit now stays up; tonight's 05:00 UTC run is the first real check.

### 9.3 What the seeded text takes from each social skill

Kept lessons enter the skill only where no bucket rule, guardrail, or word count already speaks.

- hook-anatomy. "Evaluating Hook Strength" is the skill's three-question hook test, adjusted so self-contained buckets land the payload on screen. From "Hook Patterns": curiosity gap, story drop (cold open), and "structural patterns, not templates" reinforce the curiosity logic and the rule against copying formula wording; identity call-out and contrarian take reinforce the identity logic. The anti-pattern "hook-content disconnect" became the rule that the post must pay out what the hook promises. Platform notes, pattern interrupt, and transformation tease were left out.
- caption-writer. "The first line is the whole game" and "complement, don't narrate" became the caption opening rule. "Draft 3–5 candidate opening lines" became the hook-drafts step. One CTA matched to a goal became one CTA per framework. Brand-profile loading, multiple options, and per-platform mechanics were left out (D-092).
- social-hook-writer. "Precise numbers feel credible" and "specific enough that it couldn't apply to anyone else's post" became craft notes, tied to keeping the source's exact figure. Confession and before/after need first-person experience and conflict with D-094. The pattern library, A/B testing, and platform guidance were left out.
- ig-captions. The 125-character fold, the 2,200-character limit, short lines with white space, "never 'what do you think?'", no engagement bait, the "The result?" reveal ban, and a sized 3–5 hashtag set became caption rules. Its goal table (saves, shares, comments) became each framework's CTA: curiosity asks for a save, arousal and identity ask for a send. Publishing, emoji (D-093), and its own humanizer pass (the repo humanizer replaces it) were left out.
