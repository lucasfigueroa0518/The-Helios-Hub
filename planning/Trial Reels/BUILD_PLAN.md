# Trial reel engine: build plan

The central planning document for the Helios trial reel build. It's a living file. The agent keeps the status block, Decision Log, registry, and parking lot current as work happens. Product direction lives in `PRODUCT_SPEC.md` (Lucas's plan, verbatim) and changes only when Lucas changes it.

The biggest risk on this build is an agent that fills gaps with reasonable-sounding guesses. The spec sets product direction. Nearly everything underneath it is still open: system prompts, Jev question sets, data models, infrastructure, thresholds, and the sub-builds, starting with a source adapter for every source type. Each of those is Lucas's call, reached through an interview.

## Status

| Field | Value |
|---|---|
| Active build | Build 3: on-screen copy and captions (D-006). Kickoff answered (D-090 to D-096), writer built (Section 9), prompt approved (D-097, tightened D-098). |
| Stage | 3, approved. P-10 `copy-caption-v16` on the latest Sonnet (D-222, D-229, D-230, D-235). A night fills three reels that clear the copy gate (D-224, D-225). Written for anyone curious about AI, and the whole on-screen copy is the hook (D-204, D-205). One screen, word count is a hard constraint, natural line breaks, and the on-screen copy never starts with a pronoun (D-098, D-099, D-107). Each idea makes two writer calls; Jev picks among the lines (D-195). After the copy is fixed, Jev decides whether the line "Full story below" belongs under it. Apple's hand pointing down is drawn after the line (D-228). Ball Knowledge asks payoff in that same copy-pick request, and payoff takes plain read's place on the gate (D-231). The draft does not see Jev's questions (D-235). |
| Locked | Visuals, publishing, and cooldown matching. Humanizer stays on copy and captions (D-065). |
| Decisions logged | 203 |
| Next action | `REELS_COPY_PROMPT_APPROVED=true` is set. The 1 AM run writes copy with `copy-caption-v16`. Ball Knowledge is still graded on payoff. The nightly web search writes two stories (`web-search-v2`, D-236). |
| Side build | Hook sound effects (`SFX_HOOK_SOUNDS_PLAN.md`): all five stages done, every decision approved (D-110 to D-135), deployed to the GCP worker 2026-09-27. Left: commit and push (the worker runs working-tree code; Vercel gets the review page on push), then confirm the first real reel after the deploy carries its SFX. |
| Side build 2 | Music selection and trial-reel publishing (`MUSIC_SELECTION_PLAN.md`), D-136 to D-186. Stages 1–5 built and deployed. Meta verified 2026-09-28: System User token for Helios Social, never expires, all needed scopes; @heliosgroup.ai (17841473504001687) linked to the Helios Group Page. Stage 0 spikes: `/ig_audio` returns 25 per page under `audio` with cursor-only paging (client fixed); original_sound is a stable set of 25 with shuffling order and 36% missing previews on page one; music flips between two sets of 25 library tracks; previews are the full track (AAC in MP4), links last about 4.5 days. CLAP endpoint verified 2026-09-28 on `laion/larger_clap_music_and_speech` (D-187), handler fixed for transformers 5, tagging refuses a collapsed endpoint. Original sounds ranked by our trending score (D-190, D-191). Ingest unpaused; day one runs at the next 12:30 AM. Open: OPEN-3, P-13 wording. |
| Last updated | 2026-10-05 |

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

Review output: the scored leaderboard of post ideas from the pool built by the latest 24-hour scrape, plus a carryover window of yesterday's 20 best misses, with a miss from two days ago allowed inside the first ten (D-080, D-227).

Out of scope: copy and captions (Build 3, D-006), visuals, publishing, cooldown matching (D-012).

Settled by the spec, then narrowed by the kickoff:

- Four scores, each calculated individually by Jev, combine into a net score. Jev's raw score sits on rubric levels. Code divides by the top level so the spec's 0.60 and 0.25 apply on a 0–1 scale (D-075).
- Psychology: three frameworks, scored separately, against the source as it stands, looking for a hook-worthy element and what that element could become (D-073). At or above 0.60 is viable. A viable framework that trails the leader by 0.25 or more is dropped. A framework within 0.25 of the leader stays (D-075).
- A viable framework opens every bucket that lists it, first or second (D-074). The highest bucket score is used. The psychology term is the higher viable framework score among the frameworks listed on that winning bucket.
- Value: knowledge and entertainment, scored after the winning framework and bucket are known. The net uses the higher of the two (D-076).
- Blockbuster: +0.25 once, or 0 (D-087). Subject only. Flagship model or product launch. Seed lists and the 0.80 bar are D-077.
- Net = psychology + bucket + value + blockbuster (D-079), plus 0.08 when the winning bucket is Ball Knowledge. Cooldown adds nothing until publishing exists.
- The day's posts are the top 3 of today's timely ideas plus that carryover window, rescored (D-080, D-227). Same bucket may fill all three (D-082).
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
7. Rank today's timely ideas. Rescore yesterday's 20 best misses, and a miss from two days ago when its stored net lands in the first ten of that window (D-227). Count only ideas that received a net. Take the top 3 (D-080). Persist every component, the chosen framework and bucket, the blockbuster triggers, the net, the rank, and whether the idea was selected.
8. Show the leaderboard on `/reels`.

A second Run now on the same New York calendar day replaces that day's slate. It does not carry from itself. If the previous New York day has no scoring run, yesterday contributes nothing, and a miss from two days ago can still fill the first ten (D-227). An idea that gained a member today is today's idea. Yesterday's selected three do not return. The selected three from two days ago do not return on that older score. More than one carryover can sit in the three when the scores earn it. A tie at the 20th score includes every yesterday miss on that score. A tie at the 10th score includes a two-day miss on that score (D-227).

Approved with the brief (D-085):

- Low confidence does not knock an idea out. The score still counts. Confidence is stored and shown.
- Equal nets: higher bucket score, then higher psychology score, then more recent `last_joined`.
- "Grok / SpaceX" in Lucas's list is stored as two entries, xAI (Grok) and SpaceX (D-077).
- The carryover window counts only ideas that received a net.

Question sets P-08 and P-09 are approved (`scoring-pass1-v2`, `scoring-pass2-v2`; audience D-206). The gate, net, and slate functions are in `lib/reels/scoring/decide.ts`. The runner scores after grouping and the leaderboard is the Scores tab on `/reels`.

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
| D-110 | 2026-09-27 | SFX | SFX-01 | Gated per flicker. Sound plays only on the on-frames and is silent on the off-frames, so the stutter is audible. | Planning interview. `SFX_HOOK_SOUNDS_PLAN.md` §4. | |
| D-111 | 2026-09-27 | SFX | SFX-02 | Pre-built, stored files. The 18 finished sound effects are made once. At render time the pipeline attaches the file for the hook and timing actually used. | Planning interview. | |
| D-112 | 2026-09-27 | SFX | SFX-03 | The agent proposes 2 candidate sources per hook, and Lucas picks one per hook by ear. The final six are six different source files. A candidate may be proposed for more than one hook. | Planning interview. | |
| D-113 | 2026-09-27 | SFX | SFX-04 | Allowed manipulations: trim and gate, time-stretch, pitch shift, gain, and short fades at gate edges. No layering or combining sources without asking. | Planning interview. | |
| D-114 | 2026-09-27 | SFX | SFX-05 | The sound may end anywhere within the 2 frames after the last on-frame. The agent tunes it per SFX, and Lucas judges it by ear. | Planning interview. | |
| D-115 | 2026-09-27 | SFX | SFX-06 | All 18 finished files are normalized to the same loudness target. | Planning interview. What "loudness" measures: D-126. | |
| D-116 | 2026-09-27 | SFX | SFX-07 | Fallbacks follow the actual hook. An `invert` fallback gets invert's SFX for the same timing. No hook, no SFX. | Planning interview. | |
| D-117 | 2026-09-27 | SFX | SFX-08 | Review happens on a page in the Hub, in Trial Reels. | Planning interview. Page shape: D-124. | |
| D-118 | 2026-09-27 | SFX | SFX-09 | Verification is an automated frame test on every finished file, plus a waveform-over-frames chart for every combination on the review page. | Planning interview. Render check: D-127. | |
| D-119 | 2026-09-27 | SFX | Review clip | Stage 2 and 3 renders use a stored finished reel cut from about 1.0s on, past its baked-in hook, with the hook and SFX stamped over it. No new Kling clip. | Only finished reels are stored, and they already carry a hook and text. Costs $0. Fit report. | |
| D-120 | 2026-09-27 | SFX | Render host | Review renders run on Lucas's Mac. ffmpeg installed with Homebrew. | ffmpeg was not on the Mac. The worker installs its own on deploy. | |
| D-121 | 2026-09-27 | SFX | Audio mux | `overlayPlate()` stays as is. A separate mux step copies the video stream and adds the SFX, padded to the clip length. If it fails, the reel keeps its hook and ships silent with a notice. | Changes plan Stage 5, which put the audio in `overlayPlate()`. An audio failure no longer drops the reel to the `invert` fallback. Also confirms the fail-open question Stage 5 left for the Stage 3 gate. | |
| D-122 | 2026-09-27 | SFX | Hook record | `compose()` returns the hook it actually stamped, or none. The record logs that hook, the routed hook when it differs, and the SFX file. | Before this, `motionRecord()` logged the routed hook even after an `invert` fallback or no hook. | |
| D-123 | 2026-09-27 | SFX | FPS mismatch | The SFX is attached only when the clip's probed fps matches the manifest fps (24). Otherwise the reel ships silent with a notice. | Pre-built files are frame-exact at one fps only. | |
| D-124 | 2026-09-27 | SFX | Review page | A `/reels/sfx` page in the Trial Reels shell, linked from the hub header next to Insights. One `Section` per hook, a 2×3 grid of `rh-card`s (candidate × timing), each with a 9:16 player and an inline SVG waveform-over-frames chart drawn from manifest data. `Drawer`, `Section`, and `ReelVideo` move to a shared file, and `ReelVideo` gets a `sound` prop. Picks and approvals happen in chat, and the page is for listening only. | Reuses the beta UI rather than building new components. | |
| D-125 | 2026-09-27 | SFX | File storage | The 18 finished WAVs (48 kHz, 16-bit stereo) and the manifest live in the repo under `lib/reels/sfx/`. Review MP4s go to the private `reels-frames` bucket under `sfx-review/`, served by signed redirect like `/api/reels/video/[id]`. | The frame test reads the files offline, and the worker tarball ships the tree. 48 kHz gives exactly 2,000 samples per frame at 24 fps. | |
| D-126 | 2026-09-27 | SFX | SFX-V2 metric | Loudness is RMS over the on-frames only, with a true-peak ceiling. Not integrated LUFS. | EBU R128 measures in 400 ms blocks, which barely fit a 0.58s gated file. Lucas still picks among 2–3 targets by ear. | D-115, the metric only |
| D-127 | 2026-09-27 | SFX | Render check | The render check is a script, `scripts/reels_sfx_render_check.ts`, run by hand and on the worker. `npm test` stays pure. It also checks that the AAC priming offset is absorbed by the MP4 edit list. | The test suite does not start ffmpeg. | |
| D-128 | 2026-09-27 | SFX | Hub players | Cards in the hub grid stay muted autoplay. The detail drawer plays with sound. | `ReelVideo` was hardcoded `muted`. | |
| D-129 | 2026-09-27 | SFX | SFX-V1 | The six pairings: glitch = Double Glitch, color_bars = TV Noise, invert = Whoosh Glitch, vhs = VHS Smooth Glitch, thermal = Pulse Glitch, blue_screen = Crackle Glitch. | Picked by ear on `/reels/sfx`. Crackle was proposed for invert and moved to blue_screen (SFX-03 allows it). Six different files. Neither blue_screen candidate was picked. The drafts he heard use continuous gating (flickers play consecutive slices). Whether to offer a retrigger version, where each flicker restarts at the attack, is still open. | |
| D-130 | 2026-09-27 | SFX | Loudness method | Add a peak limiter to the allowed manipulations, so all 18 files can match one loudness under the true-peak ceiling. Lucas compares three targets by ear (−18, −16, −14 dBFS RMS on the flickers). | Evidence: with gain only, the loudest level all 18 could match at −1 dBTP was −23.5 dBFS RMS (Whoosh double and Crackle strobe set the floor). A peak-aware trim search did not move that floor. TV Noise and VHS could have gone 11 dB louder. | D-113, the manipulation list only |
| D-131 | 2026-09-27 | SFX | SFX-V2 | −20 dBFS RMS on the flickers, true peak at or under −1 dBTP, with the limiter. Lucas: "−20 is good. Proceed." This approves the 18 finished files at that level. | At −20 all 18 match and the limiter takes at most about 5 dB. At −18 Whoosh, Pulse, and Crackle took up to 8 dB across most of their length; at −16 and −14 they could not reach the target. | |
| D-132 | 2026-09-27 | SFX | SFX-V3 | 3 ms raised-cosine fade at each gate edge, inside the flicker. Delegated: Lucas said "Proceed" after the recommendation without naming a fade. Point out at the next gate. | Edge-vs-sound on strobe: 1 ms read −6.3 to +1.8 dB (clicks on Glitch and Invert), 3 ms read −12.8 to −20.6 dB, 8 ms read −28.6 to −36.7 dB and softens a 2-frame flicker. | |
| D-133 | 2026-09-27 | SFX | SFX-05 | The last flicker rings out over the full 2-frame cushion with a raised-cosine fade, the same for all six sources. Delegated the same way as D-132. | This is what Lucas heard in both reviews. Tuning per source is still open if he hears a cut-off or a smear. | |
| D-134 | 2026-09-27 | SFX | SFX-V4 | Frame-test tolerances approved. WAV files: silence at −120 dBFS, flicker onset within 10 ms, no edge guard. Finished MP4s: silence at −45 dBFS, onset within 10 ms, 5 ms skipped at each gap edge. | Evidence: the WAVs are digital silence off-frame; the only late onsets were first flickers 3–8 ms late on the source's soft attack. The worker's AAC (ffmpeg 4.4) leaves codec noise up to −46.9 dBFS in a gap past the 5 ms guard, about 39 dB under the flickers; −45 passes 18/18 on the worker. Lucas confirmed after it was explained that −45 is the silence cutoff, not the loudness. | |
| D-135 | 2026-09-27 | SFX | D-132, D-133 | Lucas confirmed the delegated settings: 3 ms gate-edge fades and the same 2-frame raised-cosine ring-out for all six sources. | | |
| D-136 | 2026-09-27 | MUS | MUS-01 | **Attach songs by `audio_id`** through `audio_configuration`. Don't bake the song into the video file. The climax rule is dropped. | Planning interview. `MUSIC_SELECTION_PLAN.md` §2, §4. Meta has no start-offset field. |  |
| D-137 | 2026-09-27 | MUS | MUS-02 | The daily ingest runs at 12:30 AM America/New_York, before the 1 AM run. | Planning interview. Scheduling: D-166. |  |
| D-138 | 2026-09-27 | MUS | MUS-03 | Watch the top 10 trending `music` sounds and the top 20 trending `original_sound` sounds, 30 in total. | Planning interview. |  |
| D-139 | 2026-09-27 | MUS | MUS-04 | Dedupe and merge by `audio_id` only. A sound in both lists is one song. A sound already in the pool is never re-ingested. | Planning interview. |  |
| D-140 | 2026-09-27 | MUS | MUS-05 | Day 1 fills the pool with exactly 30 songs, replacing skipped or merged sounds. After day 1, only new entrants to the top 30 are ingested, with no quota. | Planning interview. Replacement source: D-176. |  |
| D-141 | 2026-09-27 | MUS | MUS-06 | The pool holds at most 50 songs. Oldest means first ingested. A 51st song hard-deletes the oldest: metadata, tags, embeddings, cached preview. Reappearing doesn't reset age. | Planning interview. Narrowed by D-163 (decision record keeps a snapshot) and D-164 (songs on unpublished reels are not evicted). |  |
| D-142 | 2026-09-27 | MUS | MUS-07 | Skip sounds with a null `download_url`. If one reappears later with a file, ingest it then. | Planning interview. |  |
| D-143 | 2026-09-27 | MUS | MUS-08 | Keep every sound type, including speech, voiceover, and meme sounds. Jev decides fit. | Planning interview. |  |
| D-144 | 2026-09-27 | MUS | MUS-09 | Tags per song: 1 genre, a BPM, 1–3 main instruments, 5–10 vibe descriptors. This is the full state Jev uses per song. | Planning interview. |  |
| D-145 | 2026-09-27 | MUS | MUS-10 | CLAP picks genre, instruments, and vibes from fixed vocabularies. A beat-tracking library measures BPM. The agent drafts the vocabularies; Lucas approves them before tagging (R6). | Planning interview. Registry P-14. |  |
| D-146 | 2026-09-27 | MUS | MUS-11 | CLAP runs on a hosted inference API, not on the worker and not as a new service. Agent researches vendors; Lucas picks. | Planning interview. MUS-V3. |  |
| D-147 | 2026-09-27 | MUS | MUS-12 | Narrowing compares the reel's on-screen copy plus caption body with each song's tag text, both through the hosted CLAP text encoder. Top by similarity go to Jev. | Planning interview. D-169 adds the audio embedding as evidence only. |  |
| D-148 | 2026-09-27 | MUS | MUS-13 | Exactly 12 songs go to Jev. | Planning interview. Replaces an earlier answer of 15. |  |
| D-149 | 2026-09-27 | MUS | MUS-14 | One Jev request, one Choice over the 12, no escape option. Jev must pick. | Planning interview. **Deliberately against TypeSafe's escape-option advice (Section 3).** Lucas's choice. |  |
| D-150 | 2026-09-27 | MUS | MUS-15 | Jev's state: on-screen copy, caption body only (no CTA, no hashtags), and each of the 12 songs' MUS-09 tags. Question: "How well does this song match the vibe of the copy in an Instagram reel context?" Exact wording to Lucas (R6). | Planning interview. Registry P-13. |  |
| D-151 | 2026-09-27 | MUS | MUS-16 | Always use Jev's pick, even a poor fit. | Planning interview. |  |
| D-152 | 2026-09-27 | MUS | MUS-17 | A song can be used on any number of reels. No cooldown. | Planning interview. Replaced by D-194. |  |
| D-153 | 2026-09-27 | MUS | MUS-18 | The approval gate lives in the Hub. A reel publishes only after Lucas approves it. | Planning interview. | D-061, for reels through this gate |
| D-154 | 2026-09-27 | MUS | MUS-19 | The approval screen plays the video with the song synced from 0:00 from the cached preview, labeled that Instagram may start the song elsewhere. Song details: title, artist, genre, BPM, instruments, vibes. | Planning interview. The "click the video" entry point is replaced by D-172. |  |
| D-155 | 2026-09-27 | MUS | MUS-20 | One control: Approve. Approving publishes. No reject, dismiss, swap, or edit. An unapproved reel stays unpublished. | Planning interview. |  |
| D-156 | 2026-09-27 | MUS | MUS-21 | An auto-publish setting is built now, off by default. On: reels publish as soon as they're ready, with no approval. | Planning interview. Placement: D-173. |  |
| D-157 | 2026-09-27 | MUS | MUS-22 | Publish as a trial reel with `trial_params.graduation_strategy = SS_PERFORMANCE`. | Planning interview. |  |
| D-158 | 2026-09-27 | MUS | MUS-23 | The posted caption includes the hashtags: `fullCaption()` (body, call to action, hashtags). | Planning interview. |  |
| D-159 | 2026-09-27 | MUS | MUS-24 | `audio_volume` and `video_volume` are set from evidence (MUS-V2). | Planning interview. Needs the SFX finals (D-131). |  |
| D-160 | 2026-09-27 | MUS | Fit 1: publishing unlock | The music plan runs as a side build, like SFX. Publishing opens for reels through the approval gate. Cooldown matching (COOL-03 to COOL-05, P-03) stays parked. | Fit report. Lucas approved all recommendations. |  |
| D-161 | 2026-09-27 | MUS | Fit 2: pick trigger | The narrow-and-pick runs as its own queued job after a video job finishes `ok`, not at copy time. | The nightly run writes copy for three ideas, but a reel exists only after Make the reel, and copy can be rewritten. The pick matches the copy burned into the video; only reels that exist pay; a failed pick retries without a new Kling clip. |  |
| D-162 | 2026-09-27 | MUS | Fit 3 + OPEN-4: publish record | Approval and publishing are per reel (video job). A new publish-attempts table records container ID, media ID, `audio_id`, song title and artist, volumes, the caption sent, and status or error. Success also upserts `published_status` for the idea (D-005). | `published_status` is one yes/no row per post idea. Answers OPEN-4: yes, the `audio_id` is recorded, with a title/artist snapshot. |  |
| D-163 | 2026-09-27 | MUS | Fit 4: decision snapshot | The per-reel song decision record keeps a snapshot of what Jev saw for the 12: `audio_id`, title, artist, tags, similarity. Hard-delete removes the pool row, embeddings, and preview file. | The Jev log already keeps the state sent (D-030). | D-141, what hard-delete removes |
| D-164 | 2026-09-27 | MUS | Fit 5: eviction | A song attached to an unpublished reel is not evicted. The 50 cap holds by evicting the oldest unattached song. | Otherwise a reel waiting for approval loses its preview. | D-141, the "oldest" clause |
| D-165 | 2026-09-27 | MUS | Fit 6: ingest/tag split | Ingest fetches and caches previews and stores untagged rows. Tagging is a separate step that runs once the vocabularies are approved. Untagged songs are never shortlisted. Day 1's "30 tagged" is met when gate 1 closes. | Preview links expire in about 1.5 days, before the vocabularies can be approved. |  |
| D-166 | 2026-09-27 | MUS | Fit 7: scheduling | The 12:30 ingest is a second schedule in the `helios-reels` loop (minute support), with its own ingest log table. An ingest failure never blocks the 1 AM run. `npm run reels:songs` runs the day-1 fill by hand. | `reels.runs` allows one run in flight; `nextRunAt` takes whole hours. |  |
| D-167 | 2026-09-27 | MUS | Fit 8: publish host | Approve queues a publish job; the worker claims it, creates the container from a signed video URL, polls to `FINISHED`, publishes. Meta vars go into `worker.env` with a worker redeploy. | A Vercel route can't wait on Meta's status. Stage 0 confirms which token (Page or user) works. |  |
| D-168 | 2026-09-27 | MUS | Fit 9: Jev version | The song pick follows D-021: `jev-latest`, resolved version logged per call. | The music plan's Stage 1 said "pinned." |  |
| D-169 | 2026-09-27 | MUS | Fit 10: audio embedding | Store each song's CLAP audio embedding from tagging. MUS-12's ranking stays live; the audio-based ranking is shown beside it at gate 2 as evidence only. | Zero-shot tagging computes it anyway. |  |
| D-170 | 2026-09-27 | MUS | Fit 11: pick failure | If the pick fails or fewer than 12 songs are tagged, the reel shows "Song pending" with a retry and can't be approved or auto-published until it has a song. |  |  |
| D-171 | 2026-09-27 | MUS | Fit 12: approval screen | The approval screen is the existing reel drawer. A ready reel plays video and song synced from 0:00 (`ReelVideo` gets a `track` prop; volumes follow MUS-V2). The Generate slot becomes Approve. Card chips: Awaiting approval, Publishing, Published, Publish failed. | Reuses the beta UI, no new page. |  |
| D-172 | 2026-09-27 | MUS | Fit 13: song drill-in | A song strip under the player (cover, title, artist) opens a Song section: genre, BPM, instruments, vibes, and the 12-song shortlist with similarity and Jev probabilities. That section is the gate 2 review. | The drawer player has native controls, so a click on the video plays or pauses. | D-154, the "click the video" entry point |
| D-173 | 2026-09-27 | MUS | Fit 14: auto-publish placement | The auto-publish toggle is a Publishing card in the Insights drawer, stored in the database so the page and the worker read the same value. Publish and ingest failures join Reel job errors and the health dot (D-025). |  |  |
| D-174 | 2026-09-27 | MUS | Fit 15: pool page | A `/reels/songs` page built like `/reels/sfx`, linked next to Hook sounds: preview player and tags per MUS-V1 setting side by side for gate 1, then the pool browser (age, eviction order). |  |  |
| D-175 | 2026-09-27 | MUS | OPEN-2 | BPM runs on the worker in the existing Python venv (librosa or essentia, decoded with ffmpeg), at ingest. Library defaults come to gate 1 as evidence (R4). | Hosted CLAP won't return BPM. $0. |  |
| D-176 | 2026-09-27 | MUS | OPEN-1 | A skipped or merged day-1 sound is replaced by the next-ranked sound from the same list, keeping 10 music and 20 original sounds. | Still open: what happens if a list runs dry. Depends on Stage 0 spike 1. |  |
| D-177 | 2026-09-27 | MUS | MUS-V3 | Hosted CLAP runs on Hugging Face Inference Endpoints: `laion/larger_clap_music` on a managed endpoint that sleeps when idle, billed per minute. | No provider sells CLAP pay-per-call (Replicate, fal, Mixpeek checked; HF serverless unconfirmed). Pricing still to be checked on HF directly before the first paid call. | |
| D-178 | 2026-09-27 | MUS | OPEN-1 dry list | If a list runs dry on day one, borrow the shortfall from the other list's next-ranked sounds. | Day one still aims for exactly 30. What is still missing after both lists run dry is logged on the ingest. | D-176, the open clause |
| D-179 | 2026-09-27 | MUS | Cap when all attached | If every song in the pool is attached to an unpublished reel, new songs still land and the pool may briefly go over 50. | Lucas expects this never to happen. Later ingests evict as soon as songs detach. | D-141, the hard cap in that case only |
| D-180 | 2026-09-27 | MUS | P-14 vocabularies | Approved as drafted: 39 genres (three non-music), 29 instruments, 50 vibes. | `song-vocab-v1` in `lib/reels/music/vocab.ts`. | |
| D-181 | 2026-09-27 | MUS | P-14 label sentences | Approved: "This is {genre} music." ("This is {genre}." for spoken word, comedy sound, sound effects), "This audio features {instrument}.", "This audio sounds {vibe}." | | |
| D-182 | 2026-09-27 | MUS | MUS-V1 | Use the relative rule only: every label within 0.05 of the vocabulary's best CLAP score, clamped to 1–3 instruments and 5–10 vibes by rank. Genre is the single best label. No side-by-side of other settings. | The fixed-count and probability-floor settings are dropped. Gate 1 shows the day-1 pool tagged at this rule. 0.05 is the drafted margin, the knob if the tags look off. | |
| D-183 | 2026-09-27 | MUS | Tag text | BPM is left out of the text the narrowing embeds. Jev still sees it. | Tag text: "{genre} with {instruments}. It sounds {vibes}." | |
| D-184 | 2026-09-27 | MUS | P-13 layout | Each of the 12 songs is a Choice option (`song_1` to `song_12`) described by its tags. The state is the on-screen copy and caption body. | Reads MUS-15's "state" as everything Jev reads. | |
| D-185 | 2026-09-27 | MUS | P-13 order | Options go in shortlist order, most similar first. No shuffle. | | |
| D-186 | 2026-09-28 | MUS | MUS-V3 price | The CLAP endpoint runs at $0.134 per hour while awake, scaled to zero after 15 minutes idle. | Lucas's figure from the endpoint page. A nightly ingest of about 30 songs plus the idle tail is roughly 20–30 minutes awake, about $0.05–$0.07. Each song pick wakes it once, about $0.03–$0.05 with the idle tail. | |
| D-187 | 2026-09-28 | MUS | MUS-V3 checkpoint | CLAP runs `laion/larger_clap_music_and_speech`. | `laion/larger_clap_music` returned the same vector for every sentence (cosine 1.000) and nearly the same for every sound (0.995), on transformers 4.57 and 5.17 alike. `larger_clap_music_and_speech`, `clap-htsat-unfused`, and `larger_clap_general` all behaved; music_and_speech matches a pool that keeps speech and meme sounds (D-143). | D-177, the checkpoint only |
| D-188 | 2026-09-28 | MUS | MUS-03 music list | The top 10 music sounds are the first 10 of `/ig_audio` with `audio_type=music`, as returned, even though that list is licensed library music that rotates between sets. | Spike 1: two sets of 25 alternate between calls; artists are royalty-free library names, not chart hits. | |
| D-189 | 2026-09-28 | MUS | CLAP window | CLAP hears the first 90 seconds of each preview: up to nine 10-second windows, averaged. | Spike 2: previews are the full track, up to about 3 minutes. | |
| D-190 | 2026-09-28 | MUS | MUS-03 original sounds | The top 20 original sounds are ranked by our own trending score from Meta's data: sample `/ig_audio` original_sound several times each ingest, record every position, and rank tonight's sounds by nights on the list within a window, then average position. Only original sounds. | Lucas picked option (a). Meta exposes no engagement or trending metric on the list, the audio node, or search. Values confirmed in D-191. The ingest stays paused (`song_ingest_paused`) until then. | D-138, the original-sound half |
| D-191 | 2026-09-28 | MUS | D-190 values | Confirmed: 5 samples per ingest, 50 deep, a 7-night window, observations kept 30 days. | Lucas: "Values confirmed." The agent had noted 2 samples would do; 5 was kept. | |
| D-192 | 2026-09-28 | All | One reel flow | Treat the pipeline as one unit. Every flagged prompt and question set is approved. The nightly run carries each selected idea through copy, frame, video with hook SFX, and song pick. Only publishing stays behind Approve. The SFX and Songs pages stay for testing and analysis. | Lucas's instruction. `REELS_B6_PROMPT_APPROVED` and `REELS_SONG_PICK_APPROVED` set true in `.env.local` and `worker.env`. P-02 to P-07, P-11, P-12, and P-13 marked approved. | |
| D-193 | 2026-09-28 | All | FND-05 watch | The monthly spend watch is $100. | Three full reels a night is about $90/month. | D-023, the amount |
| D-194 | 2026-09-28 | MUS | MUS-17 | A song can be picked onto one reel per calendar day in America/New_York. The next date frees it. Only an ok pick counts. | Lucas: once a song is used for a video it can't be used again until tomorrow. The unit of that lock is the post idea (D-197). | D-152 |
| D-197 | 2026-09-28 | MUS | MUS-17 | The once-a-day song lock is per post idea, not per video generation. Regenerating a reel reuses the song that post idea already claimed today. Other post ideas still cannot use it until the next America/New_York date. | Lucas: regenerating one reel over and over should keep the song already picked for that post idea. | D-194 |
| D-195 | 2026-09-28 | 3 | P-10 / P-15 | Each copy run makes two Sonnet calls. Each call returns one caption and two on-screen lines. Jev scores the four lines alone (plain read, open loop, care, reward). The reel keeps the winning line and that call's caption. | Lucas approved the copy-pick plan. `copy-caption-v6`, `copy-pick-v1`. A line under 0.75 on plain read loses to any line at or above it. | D-090, D-091 |
| D-196 | 2026-09-28 | 3 | P-16 | After the winning line and caption are fixed, Jev decides whether a small cue belongs under the on-screen copy. It sits on the midpoint between the bottom of the copy and the bottom of the frame, in type smaller than the main copy, always one line. | The cue is on only when the caption holds a story whose value was deferred there, and either the caption preview does not continue the line or the on-screen line cannot stand as its own thought. A no on the deferred-story question keeps the cue off. `full-story-cue-v1`. The words are chosen later (D-198). | |
| D-198 | 2026-09-28 | 3 | P-17 | The cue is one of eight lines for the reel's content bucket, chosen by a second Jev call, with a hand pointing down drawn after it. | Lucas: "Full Story Below" converts poorly. The hand is what makes the line make sense. Jev picks the line that names what this caption actually holds. `full-story-line-v1`. | D-196 |
| D-199 | 2026-09-28 | MUS | MUS-17 | The nightly reel run makes the best selected idea first. Copy, frame, video, and song claims go in rank order, and a worse idea waits while a better selected idea on the same slate is still being made and has no song for that slate's calendar day. | Lucas: the best post idea goes first, so the best post gets the best song. Rank 1 picks while that day's songs are still free. | D-197 |
| D-200 | 2026-09-28 | MUS | MUS-17 | A song is used once per calendar day the reel is assigned to. That day is the slate's New York date. Generating the reel on a different day does not move the lock. | Lucas: once-a-day is the reel's calendar-day assignment, not which reels were generated today. Regenerating that reel keeps its song. The next assigned day frees it. | D-194, D-197 |
| D-201 | 2026-09-28 | 3 | P-16 bars | The cue turns on when the deferred-story score is at least 0.70 and at least one of the other two scores is at least 0.26. | Lucas, after the first six reels all stayed off at 0.80 across the board. | D-196 |
| D-202 | 2026-09-28 | 3 | P-16 off | The caption cue is off. Copy does not ask Jev, and a cue already stored is not drawn. The type ratio is 0.68 of the main line for when it returns. | Lucas: the phrases are weird and the line is too small. Disable it for now. | D-196, D-201 |
| D-203 | 2026-09-28 | 3 | Orange hands | The orange grade does not draw hands. The image prompt forbids them, and the orange Kling call sends the same ban as `negative_prompt`. | Lucas: black hands are creepy and not allowed. | |
| D-204 | 2026-09-28 | 3 | P-10 / P-15 | The copy is written for anyone curious about AI, most of whom use it at work or at home, at about a sixth-grade reading level. The whole on-screen copy is the hook, and the hook tests and the copy pick judge all of it. The first line alone does not carry it. | Lucas, on reading the skill: the audience was too professional, and the whole copy drives the viewer to the caption. `copy-caption-v7`, `copy-pick-v2`. Overrides D-020 for P-10 and P-15 only. Ingest, the A4 editor, B6, and scoring keep D-020. | D-020, D-104, D-195 |
| D-205 | 2026-09-28 | 3 | P-10 / P-12 / spec | The rest of the copy path follows D-204. The framework logic names groups by a habit or a tool and asks for a send to a friend or coworker. The spec's Ball Knowledge, Number, Warning, and Callout examples and rules speak to an everyday AI user, and the In-Group Callout formula drops the designer. The color router matches the copy as a whole. | Lucas approved the wording after a sweep for indirect traces of the old audience and the first-line hook. `copy-caption-v8`, `color-route-v3`. The priority order in the skill and the web-search audience were left as they are. | D-204 |
| D-206 | 2026-09-29 | 2 | P-08 / P-09 | Scoring judges for people curious about AI, most of whom use it at work or at home, with about one in seven building with AI. A story is judged first by how it would hit the everyday viewer if told in plain words. Builder interest adds to the score. A builder-only story can score, but not at the top. Bucket and framework meanings speak to habits and tools, a fellow user, and the viewer instead of the four roles. Ball Knowledge keeps repos. | Lucas, after an audit of the upstream prompts: story picking should match the D-204 audience while still counting the builder minority. `scoring-pass1-v2`, `scoring-pass2-v2`. Overrides D-020 for P-08 and P-09 only. A same-day rescore inserts a new slate and leaves the earlier one; the page switches between them. Ingest, the A4 editor, B6, and the blue-chip lists keep D-020 and D-077. Scores and the 0.60 gate were calibrated on v1, so the first nights on v2 are a recalibration check. | D-020, D-086, D-204 |
| D-207 | 2026-09-29 | 5 | Publish | Three Eastern-time slots every day, one reel each: 8:45–10:00 AM, 11:15 AM–12:30 PM, 6:00–9:00 PM. Both endpoints are valid minutes, and the minute is a uniform draw. Schedule uses the next slot whose whole window is still ahead. Live, off by default, is what makes the nightly top three take those slots; the worker posts each one at its minute as a trial reel. Force post publishes immediately, still as a trial reel, and frees the slot. | Lucas: posting is a clock, not "as soon as the song exists." | D-155, D-156 |
| D-208 | 2026-09-29 | 3 | P-12 | A fourth grade, green, is a flooded field (#148C3A), peer of orange, not a rim on noir. It owns a release, a launch, a fix, or a capability that arrived and works. Paper, orange, and noir each yield that job in their not-for. Noir stays the fallback when nothing else fits. Green forbids hands the same way orange does. | Lucas: add a green colorway and give it real routing responsibility. `color-route-v4`. `color-route-v3` is retired. Motion records from this grade on are `motion-writer-v3`. | D-105, D-203, D-205 |
| D-209 | 2026-09-29 | 3 | P-10 | The two copy calls per idea use `claude-opus-5-5`. Opus rejects a forced tool, so the call is tool_choice auto with parallel tool use off, and report_copy is strict. Strict mode rejects minItems above 1, so the two-copy count stays in the parser. The working-field descriptions cannot say "drafts" or "working notes": Opus refuses the request before it writes. Thinking shares the token budget, so the cap is 16,000. Scene, motion, and B6 stay `claude-sonnet-5`. The skill wording is unchanged, so the prompt version stays `copy-caption-v8`. | Lucas: switch the copy calls to Opus 5.5. | D-091, D-195 |
| D-210 | 2026-09-29 | 3 | Checkpoint | The copy, pick, scoring, and color prompts as they stood before D-211 to D-219 are saved verbatim in `lib/reels/saved/prompts-checkpoint-2026-09-29/`, with a README of versions and restore steps, and tagged `reels-prompts-checkpoint-2026-09-29`. | Lucas: this is a large wave of edits, so mark the current prompts as a checkpoint to come back to. | D-205, D-208, D-209 |
| D-211 | 2026-09-29 | 3 | P-10 | The skill states the account's job: grow an audience for Helios with AI news, stories, knowledge, and skills worth following, with no pitch. The whole on-screen copy has two jobs in order. First the viewer understands what happened and why it matters on one read; then the viewer wants the caption. The stake stays on screen. What stays open is how it happened, what to do about it, or what comes next. A bucket that defers its resolution defers the payload, never the stake. Curiosity's on-screen logic says the same. | Viewer feedback on the 2026-09-29 set (`VIEWER_FEEDBACK_GAP_ANALYSIS_2026-09-29.md`): two reels were not understood and two had no "so what." Lucas supplied the account's job. `copy-caption-v9`. | D-204, D-205 |
| D-212 | 2026-09-29 | 3 | P-10 / P-15 | The clarity rule is on ideas, not nouns. An insider idea is anything a person who uses AI, but never reads tech news, would have to look up, in seven kinds, including mechanism chains. One test asks whether the viewer needs to know how a system works to follow the line. The skill gives translations and what can stay, including an unknown name the line survives skipping. The list lives in `lib/reels/copy/insider-ideas.ts`, and the Jev plain read uses the same list. | Lucas: refine the negative examples so they hold at scale. Replaces D-104's noun test. `copy-caption-v9`, `copy-pick-v3`. | D-104 |
| D-213 | 2026-09-29 | 3 | P-10 | `report_copy` asks for `viewer_stake` before the copies: one plain sentence, 20 words at most, on why this viewer should care. Both copies tell the same story about the same subject with the same stake, differing only in the first line and the way in. The caption's first paragraph opens on that story and pays out the stake, never a second thread. | Reel 5 split into two stories because the old rule asked for "a different thing named first." `copy-caption-v9`. The column `reels.idea_copy.viewer_stake` stores it. | D-195 |
| D-214 | 2026-09-29 | 3 | Spec / P-10 | Saga on-screen copy is 20 to 32 words on one screen. | Lucas: the Saga cap can be a bit higher because reels loop. 40 to 70 was unreadable in one pass. | D-098 |
| D-215 | 2026-09-29 | 3 | P-15 / P-18 | The copy pick scores five things: plain, stake, loop, care, reward. Stake folds the viewer-stake question into the pick. A new Noul, `copy-story-match-v1`, reads a line and its caption's first paragraph and asks whether they tell the same story. | Lucas: fold the viewer-stake question into an existing score bucket. `copy-pick-v3`, `copy-story-match-v1`. | D-195, D-204 |
| D-216 | 2026-09-29 | 3 | Copy pick | A line clears the gate when plain and stake are both at least 0.75, its word count is in the bucket's range, and the same-story Noul is at least 0.5. Cleared lines rank on the mean of loop, care, and reward. If no draft line clears, one rewrite call sees every line with its scores and legend levels and writes two more copies and a caption. If still none clears, the line with the best weaker score of plain and stake ships, in-range lines first. Same story is not a tier in that fallback. | Lucas: one rewrite with Jev's scores, then let the highest-scoring candidate through. A rewrite is about $0.11; worst case about $0.34 per idea, about $1 a night. | D-195 |
| D-217 | 2026-09-29 | 2 | Scoring | The blue-chip bonus is 0.10, down from 0.25. A Jev level is 0.25 on one component, so 0.10 breaks a near-tie without letting a known name jump a clearly better story. | Lucas: a smaller bonus, about 0.1. | D-077, D-087 |
| D-218 | 2026-09-29 | 2 | P-08 / P-09 | Both value questions carry a viewer-stake guardrail: the top two levels need a reason to care that fits one plain sentence about the viewer's own life, or about what is on the line for the people in the story, with no technical setup. A story the viewer would first need to learn how a system works to care about stays at Workable at most. Callout fit needs a position on a practice, a tool, or a vendor the viewer chooses; a position on what a company, a lab, or a government should do stays at Workable at most. | Reels 5 and 6 were picked without a "so what" for the viewer. `scoring-pass1-v3`, `scoring-pass2-v3`. | D-086, D-206 |
| D-219 | 2026-09-29 | 3 | P-12 | A cost or risk the copy states for the viewer routes to orange, even when something is also hidden. Noir is for a hidden thing with no stated stake for the viewer. | The viewers said the orange grade dramatized the effect on them. `color-route-v5`. | D-105, D-208 |
| D-220 | 2026-09-29 | 3 | Copy store / writer | Every copy attempt is appended to `reels.idea_copy_history`, seeded once from the existing rows. A failed attempt no longer overwrites an ok row, and the failure message says the earlier copy stays. An empty response logs its stop reason and the first 200 characters of any text. The sources block in the copy user turn carries its own 5-minute breakpoint, so the second call and the rewrite reuse it. | The 36 empty Opus calls in the first regeneration replaced the Sonnet captions and candidate lines in `reels.idea_copy`; the calls to action and hashtags for reels 1 to 5 are gone. Those failures recorded no stop reason, so they could not be told from a truncation. | D-195, D-209 |
| D-221 | 2026-09-29 | 3 | P-12 | Green is the grade when the copy fits no other look, and the grade the frame uses when the color route throws. Noir is no longer the fallback. | Lucas, after the September 29 generation. `color-route-v6`. `color-route-v5` is retired. | D-208, D-219 |
| D-222 | 2026-09-29 | 3 | P-10 | Copy calls use the latest Sonnet release from the models list. The fallback id is `claude-sonnet-5-5`. Scene, motion, and B6 stay `claude-sonnet-5`. Tool choice stays auto, because Sonnet 5.5 rejects a forced tool. Price is $2 per million input tokens and $10 per million output tokens. | Lucas: switch the copy calls to Sonnet 5.5, and keep them on the latest Sonnet. | D-209 |
| D-223 | 2026-09-29 | 3 | P-10 | The rewrite task quotes Jev's plain, stake, and same-story questions, the legend lines at and above 0.75, and the 0.50 line under the bar. Loop, care, and reward do not pass a miss. | Lucas: the second run should see what Jev treats as a passing output. `copy-caption-v10`. | D-216 |
| D-224 | 2026-09-29 | 3 | Copy slots | The idea that opens a slot gets two tries. A miss on both is not published. It takes a same-day score penalty of at least 1.0, stored in `reels.copy_day_penalties`, and the next idea gets one try. After four ideas miss, the best graded line from that pool ships. The penalty is not written into `net`. The day's rank uses net minus the penalty. Tomorrow's carryover uses the original net. | Lucas: a second failure is demoted, a replacement gets one try, and four attempts is the cap for each of the day's slots. | D-216 |
| D-225 | 2026-09-29 | 3 | Generation | "Generate N" means N reels that clear the gate, or the best of four when a slot is exhausted. Locked reels count. The nightly count is 3 (`PASSING_REELS_PER_NIGHT`). Frames for a reel this run wrote start at the frame, so finish does not rewrite the copy. | Lucas: generate three means three that pass, and generate six means six that pass. | D-192, D-224 |
| D-226 | 2026-09-29 | 3 | Locks | September 29 slots 1 and 2 stay as generated. Slot 1 is post idea `be6dcb3a-93e0-4988-b5fa-95594fd481e7` and slot 2 is `394cd848-ef21-4da4-a787-1fe520a61dc1`, both on slate `c0d86bac-ef23-4293-b04d-f60de37e2879`. The pipeline refuses to rewrite them. | Lucas: those two outputs are good and should stay. | D-225 |
| D-227 | 2026-09-29 | 2 | SCR-SLATE | The carryover window is 20 deep. Inside the first ten, a miss from 2 days ago is allowed to carry over. | Lucas. The twenty are yesterday's misses that received a net, best first. A miss from the New York day before yesterday joins when its stored net lands in those first ten. A tie at either cutoff includes every idea on that score. An idea already on yesterday's slate is judged by yesterday, so a miss that was scored again yesterday can sit anywhere in the twenty, and yesterday's score is not replaced by the older one. Two days ago's selected three stay out. If yesterday has no scoring run, the first ten can still fill from two days ago. Anything older than two days stays out. The rest of D-080 stands: always three, yesterday's selected three stay out, a same-day rerun replaces today's slate and does not carry from itself, and an idea that gained a member today is today's idea. | D-080 |
| D-228 | 2026-09-29 | 3 | P-16 | The caption cue is the fixed line "Full story below", with Apple's backhand index pointing down drawn after it, at the type size already set aside (0.68 of the main line, the hand at 1.85 of that). It sits about a third of the way from the bottom of the on-screen copy to the bottom of the frame. Jev sees the on-screen copy and the caption and answers one question: does that line read well there? The line is placed unless the score is under 0.40. It runs as the last step of copy, and the video plate draws it. The six September 29 review reels get the same pass on the finished picture. | Lucas: the eight bucket phrases read weirdly. One preset line, placed unless it does not make sense. `full-story-cue-v2`. `full-story-cue-v1` and the eight-line picker (P-17) are retired. | D-196, D-198, D-202 |
| D-229 | 2026-10-01 | 3 | P-10 | The caption must be short paragraphs with a blank line between them. A caption that is one block is a failed report, and that call is dropped. A tool string that contains the characters backslash and n is stored as a real line break. The same restore applies to the on-screen copies and the call to action. | September 30 captions stored the escape characters and posted as one paragraph. `copy-caption-v11`. `copy-caption-v10` is retired. | D-099 |
| D-230 | 2026-10-01 | 3 | P-10 | The caption ends when the bucket structure ends. The call to action and the hashtags stay in their own fields, and a line already ending the caption is not posted again. If the assembled caption is still over 2,200 characters, publish shortens it before calling Instagram: drop paragraphs from the end, then cut the last paragraph at a sentence. | The October 1 midday reel posted a 2,240-character caption. The call to action was in the caption and appended again. Instagram rejected it. `copy-caption-v12`. `copy-caption-v11` is retired. | D-229 |
| D-231 | 2026-10-04 | 3 | P-19 | Ball Knowledge asks payoff in the same Jev request as the five copy scores. Payoff replaces plain read on the gate at 0.75. Stake, word count, and same story stay. The rewrite for that bucket is shown payoff, and plain read is left off the score list it is asked to fix. | Lucas: plain read asks what happened and to whom, and a Ball Knowledge line is built to withhold the tools. `copy-payoff-v1`. `copy-pick-v3` is unchanged. | D-216 |
| D-232 | 2026-10-04 | 3 | P-10 / P-19 | Ball Knowledge on-screen copy usually names the shape of the get: a repo, a piece of software, or a skill. The specific names stay in the caption. "Never the tools" means those names, and repo, software, and skill are allowed as the shape. A payoff of 0.75 or 1.00 requires that shape along with the get. | Lucas: the viewer should know whether they are getting a repo, a piece of software, or a skill. `copy-caption-v13`, `copy-payoff-v2`. `copy-caption-v12` and `copy-payoff-v1` are retired. | D-231 |
| D-233 | 2026-10-04 | 3 | P-10 | Every bucket's copy draft sees the Jev questions that will score it, and the line that earns a 1.00 on each. Ball Knowledge also sees payoff, and plain read stays visible as a score that does not decide the pass. The first job and the hook check for that bucket point at payoff, so they agree with that scale. | Lucas: the writer should see the evaluation questions and the top tier of each. `copy-caption-v14`. `copy-caption-v13` is retired. The question sets are unchanged. | D-232 |
| D-234 | 2026-10-04 | 3 | P-10 | Ball Knowledge drafts and rewrites do not show plain read. Payoff, stake, loop, care, reward, and same story stay on the page the writer sees. Jev still records plain read. | Lucas: showing plain read on Ball Knowledge is noise. `copy-caption-v15`. `copy-caption-v14` is retired. | D-233 |
| D-235 | 2026-10-05 | 3 | P-10 | The writer goes back to the `copy-caption-v12` wording. Drafts do not see Jev's questions or the top of each scale, and the Ball Knowledge shape line is out of the prompt. Payoff stays the Ball Knowledge gate, including the shape requirement on a 0.75 and a 1.00. The rewrite again shows the plain-read passing legend for every bucket, the same as D-223. | Lucas: restore the checkpoint writer, keep the Ball Knowledge evaluation, and take the scoring visibility out of the drafting prompts. Monday's `copy-caption-v15` night scored lower than the five nights before it. `copy-caption-v16`. `copy-caption-v15` is retired. | D-231, D-234 |
| D-236 | 2026-10-05 | 1 | P-01 | The nightly web search writes two stories. At least one should be about one person and a turn in their work or life. The prompt does not name the content buckets or the scores. A story still needs two independent sources, and the stored write-up ends with those URLs. A story that fails grounding is dropped. If only one of the two grounds, that one still enters the pool. | Lucas: two stories a night, skewed a little more toward personal profile, and the outputs have to cite sources. `web-search-v2`. `web-search-v1` is retired. | D-064, D-070 |

### 8.2 Prompt and question-set registry

Every language model prompt and Jev question set, with its approval state. Nothing unapproved produces output Lucas reviews.

| ID | Component | Engine | Build | Status | Approved version | Notes |
|---|---|---|---|---|---|---|
| P-01 | Web search story generator | Language model | 1 | Approved 2026-10-05 | `web-search-v2` | `lib/reels/prompts/web-search.ts`. Two stories a night. At least one is about one person. The stored write-up lists the source URLs (D-236). Runs where `REELS_B6_PROMPT_APPROVED=true` is set. D-064, D-065, D-070. `web-search-v1` is retired. |
| P-02 | Same-story / merge / link decision | Jev | 1 | Approved 2026-09-28 (D-192) | `grouping-v1` | `lib/reels/jev/questions/grouping.ts`. Noul then Choice in one request. |
| P-03 | Published-story match | Jev | Later | Deferred | | Not built until publishing exists (D-012) |
| P-04 | Ingest topic / junk / English screen | Jev | 1 | Approved 2026-09-28 (D-192) | `ingest-filter-v1` | `lib/reels/jev/questions/ingest-filter.ts` |
| P-05 | Planted-instruction check | Jev | 1 | Approved 2026-09-28 (D-192) | `planted-v1` | `lib/reels/jev/questions/planted-instruction.ts`. Sent with P-04 in one call. |
| P-06 | A4 catalog editor | Jev | 1 | Approved 2026-09-28 (D-192) | `a4-editor-v1` | `lib/reels/jev/questions/a4-editor.ts` |
| P-07 | Same-event idea merge | Jev | 1 | Approved 2026-09-28 (D-192) | `idea-merge-v1` | `lib/reels/jev/questions/idea-merge.ts`. Validates idea pairs that code proposed (D-071). |
| P-08 | Psychology, bucket, and blockbuster scores | Jev | 2 | Approved 2026-09-29 | `scoring-pass1-v3` | `lib/reels/jev/questions/scoring-pass1.ts`. One request. D-086; audience D-206; Callout fit D-218. `scoring-pass1-v2` is retired. |
| P-09 | Knowledge and entertainment | Jev | 2 | Approved 2026-09-29 | `scoring-pass2-v3` | `lib/reels/jev/questions/scoring-pass2.ts`. Second request. D-086; audience D-206; viewer-stake guardrail D-218. `scoring-pass2-v2` is retired. |
| P-10 | On-screen copy and caption writer | Language model | 3 | Approved 2026-10-05 | `copy-caption-v16` | Seeded text in `lib/reels/copy/skill.ts`, insider-idea list in `insider-ideas.ts`; spec and humanizer text frozen in `source-text.generated.ts`. Two calls per idea on the latest Sonnet, fallback `claude-sonnet-5-5` (D-222). Two on-screen lines, a viewer stake, and one caption each. The caption is short paragraphs with a blank line between them; a one-block caption is a failed report (D-229). The call to action and hashtags stay in their own fields, and an assembled caption over 2,200 characters is shortened before it is posted (D-230). The rewrite quotes the passing legend (D-223). A generation fills passing slots (D-224, D-225). Runs where `REELS_COPY_PROMPT_APPROVED=true`. The wording matches `copy-caption-v12`. The draft does not see Jev's questions (D-235). `copy-caption-v15` is retired. |
| P-11 | Reel hook router | Jev | 3 | Approved 2026-09-28 (D-192) | `hook-route-v2` | `lib/reels/jev/questions/hook-route.ts`. One Choice over the on-screen copy only; the top choice is used at any confidence. D-100, D-101, D-102. `hook-route-v1` included static and is retired. |
| P-12 | Reel color router | Jev | 3 | Approved 2026-09-29 | `color-route-v6` | `lib/reels/jev/questions/color-route.ts`. One Choice over the on-screen copy only, read as a whole: noir, paper, orange, or green. Green owns an arrival or a fix (D-208) and is the fallback when nothing else fits (D-221). A stated cost or risk to the viewer is orange (D-219). D-105, D-106, D-205. `color-route-v5` is retired. |
| P-13 | Song pick over the 12-song shortlist | Jev | MUS | Approved 2026-09-28 (D-192) | `song-pick-v1` | `lib/reels/jev/questions/song-pick.ts`. D-184, D-185. One Choice, no escape option (D-149). State per D-150. Runs after the video job (D-161). |
| P-14 | CLAP vocabularies: genre, instruments, vibes, and the per-song selection rule | CLAP zero-shot | MUS | Approved 2026-09-27 | `song-vocab-v1` | `lib/reels/music/vocab.ts`. D-180 to D-183. Treated like a prompt under R6 (D-145). Setting picked at gate 1 (MUS-V1). |
| P-15 | On-screen copy pick | Jev | 3 | Approved 2026-09-29 | `copy-pick-v3` | `lib/reels/jev/questions/copy-pick.ts`. Five Scores on the on-screen text only, read as a whole: plain, stake, loop, care, reward. Code gates on plain and stake and ranks on the rest (D-216). On Ball Knowledge, payoff takes plain read's place (D-231). D-195, D-204, D-212, D-215. `copy-pick-v2` is retired. |
| P-16 | Caption cue | Jev | 3 | Approved 2026-09-29 | `full-story-cue-v2` | `lib/reels/jev/questions/full-story.ts`. One Noul over the on-screen copy and the caption. The line is "Full story below" unless the score is under 0.40 (D-228). `full-story-cue-v1` is retired. |
| P-17 | Caption cue line | Jev | 3 | Retired 2026-09-29 | `full-story-line-v1` | Retired by D-228. The eight bucket lines are no longer chosen. The file remains so old logs keep their meaning. |
| P-18 | Copy and caption same-story check | Jev | 3 | Approved 2026-09-29 | `copy-story-match-v1` | `lib/reels/jev/questions/copy-story-match.ts`. One Noul over a line and its caption's first paragraph. At least 0.5 is part of the copy gate (D-215, D-216). |
| P-19 | Ball Knowledge payoff | Jev | 3 | Approved 2026-10-04 | `copy-payoff-v2` | `lib/reels/jev/questions/copy-payoff.ts`. One Score, injected into the copy-pick request only when the bucket is Ball Knowledge. At least 0.75 replaces plain read on the gate (D-231). A 0.75 or 1.00 requires the shape of the get, a repo, a piece of software, or a skill (D-232). `copy-payoff-v1` is retired. |

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
| 2026-09-27 | Music goes into the separate audio mux step (D-121), mixed with the hook SFX. Not designed for yet. | Music plan (`MUSIC_SELECTION_PLAN.md`) | SFX fit report |
| 2026-10-05 | Copy checkpoint closed. The writer is back to the `copy-caption-v12` wording as `copy-caption-v16` (D-235). Payoff grading stays (`copy-payoff-v2`). The local branch `checkpoint/copy-caption-v12` is removed. The commit it pointed at, `4c2ded9`, stays on main. | Copy hygiene | Lucas |

## 9. Build 3: on-screen copy and captions

Spec Phase 3 closer. The chosen bucket and the chosen framework inform how the on-screen text and the caption are written from the source. Kickoff answers are D-090 to D-096. Visuals and publishing stay out.

### 9.1 What was built

After scoring, the nightly run fills three reels that clear the copy gate (D-225). Locked reels for that date already count (D-226). D-195 makes that two cached calls per idea, on the latest Sonnet since D-222. Each call returns two on-screen lines, a viewer stake, and one caption. Jev scores the lines, and the stored row is the winner plus that call's caption. Since D-216 a line has to clear a gate on plain read, stake, word range, and same story. On Ball Knowledge, payoff stands in for plain read (D-231), and a high payoff requires the shape of the get (D-232). The draft does not see those questions (D-235). The idea that opens a slot gets one rewrite, and that rewrite sees the legend lines Jev treats as a pass (D-223). A miss on both tries is demoted for the day. Each replacement gets one try. After four misses the best graded line from that pool ships (D-224). The Scores button for one idea still ships its nearest miss. Every attempt is kept in `reels.idea_copy_history` (D-220). Results show under each selected idea on the Scores tab (D-092). Lucas approved this prompt on 2026-09-23 (D-097). On the same day the on-screen rules were tightened (D-098, `copy-caption-v2`): one screen, and the bucket word count is a hard constraint that outranks a multi-image reading of "across the runtime." It runs where `REELS_COPY_PROMPT_APPROVED=true`.

The assembler (`lib/reels/copy/assemble.ts`) builds one prompt per idea from five inputs:

1. The winning bucket's spec text, verbatim, minus its `Frameworks:` and `Feeds from:` lines.
2. The winning framework's spec text, verbatim. The other two frameworks are not sent.
3. The humanizer skill, verbatim, patterns 1 through 25.
4. Every member's full stored body, in the user turn, wrapped as untrusted (D-096).
5. The copy and caption skill (`lib/reels/copy/skill.ts`), with the winning framework's on-screen and caption logic.

The worker deploy excludes `.cursor/`, so inputs 1 to 3 are frozen into `source-text.generated.ts` by `npm run reels:sync-copy-text`. A test fails if that file drifts from the spec or the skill. `npm run reels:copy-preview` writes the assembled prompt for the latest slate's three to `tmp/reels-copy-preview/` without calling a model.

Cache layout: system block 1 (skill and humanizer, about 8.5k tokens) is identical for every idea; block 2 (bucket and framework, under 1k) is identical per pair; sources go in the user turn. Both system blocks carry 5-minute breakpoints, since a night's three calls run back to back. Since D-220 the user turn is two blocks: the sources, with a third 5-minute breakpoint so the second call and the rewrite read them from cache, then the uncached task.

Code checks each result and shows flags beside it: on-screen word count against the bucket's range, the viewer stake against its 20 words, the 125-character fold, the 2,200-character limit, hashtag count, dashes, URLs in the caption, first-person words, and source URLs not in the idea. Flags do not reject or retry.

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
