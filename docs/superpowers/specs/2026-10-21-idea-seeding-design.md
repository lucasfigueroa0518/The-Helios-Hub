# Idea seeding: type your own idea into a type's pool (2026-10-21)

**Status:** draft for Tommy's review. Explainers is specified to build; Carousels, Stories, Text on Screen and Last Few Days are sketched and each gets its own design pass later.
**Branch:** `unify-social-hub` (no new branches).

## Why

Every content type's ideas come from the machine: scraped sources, nightly scoring, generated topics. A person cannot say "make an explainer that answers *why do LLMs hallucinate?*" or "cover this story today." The pool is the only door in. Seeding adds a second door: a person types an idea into a type's idea pool, and it becomes a pool entry that the existing make path turns into a post.

What a seed *is* differs per type, so the work per type differs:

| Type | A seed is | Work to turn it into a pool entry |
|---|---|---|
| Explainers | A topic or a question | Write a scope for it. No research. |
| Carousels | A specific story (link or description) | A Claude call with web research builds the story record |
| Stories | A pick for one series (a story, a number, or a tool pair) | Per-series; some need research |
| Text on Screen | A story or an angle | A synthetic source plus post idea |
| Last Few Days | A headline to include | Feeds the next run's selection |

## Goals

- A "Seed an idea" control on each type's **idea pool tab** (the embedded `PoolScreen`), with a form that fits that type.
- A seeded idea appears in that type's pool like any other idea, marked as the person's own, and is made through the existing paths (Make it, Run now, the type's own button).
- Seeding costs nothing until the person clicks Seed; the click authorizes only that seed's calls (CLAUDE.md Rule 1).

## Non-goals and anti-goals

- **No sweeping.** Seeding never touches existing pool rows (Rule 2). It adds exactly what was typed.
- **Seeding itself never starts a render or a run.** Making is the existing click (Make it), a pin, or the existing nightly worker, which treats a seed like any pool topic (see "Overnight eligibility and Pin").
- **No new ranking system.** A seed competes in the pool's existing ranking; it is not a second queue.
- Anti-goal: a seeded idea silently thrown away by a gate the person cannot see (see "Seeds are not filtered").
- Not in this doc: bulk import beyond the paste-a-list Explainers already has; images or files as seeds.

## Where it lives

The pool tab is `PoolScreen` ([components/social-hub/content/PoolScreen.tsx](../../../components/social-hub/content/PoolScreen.tsx)), embedded in each type's page. A "Seed an idea" button goes in the pool tab's header area for every type that supports it, opening the same `Drawer` pattern `AddTopicsButton` already uses ([components/content-type/TypeControls.tsx](../../../components/content-type/TypeControls.tsx)). The form is per type; the button, drawer, toast and refresh are shared.

## Explainers (build first)

### What exists

- `POST /api/explainers/topics` ([app/api/explainers/topics/route.ts](../../../app/api/explainers/topics/route.ts)) takes a title with optional source URL and notes, or a pasted list (max 25). It runs `addAndEvaluateTopics` ([lib/explainers/ideas/cycle.ts](../../../lib/explainers/ideas/cycle.ts)): one Sonnet call writes a scope and term per title, then Jev scores and dedupes each topic, then the pool is trimmed to `pool_size`.
- `explainers.topics.origin` already allows `'manual'`; a single typed title is stored as `manual`, a pasted list as `seeded`.
- An "Add topics" button already exists on the Explainers page header (`AddTopicsButton`, used by `ContentTypePage`).
- Make it already renders one topic (`/api/explainers/topics/{id}/generate`).

So the model, the route and the form exist. What's missing is what the feature is actually for:

### Problem: today a typed topic can be thrown away

`evaluateTopic` can return `rejected_history_duplicate`, `rejected_gates` (a judge score below a gate), `lost_head_to_head` (a similar pool topic scored higher), and `trimPool` marks anything below the `pool_size` cut `displaced`. For a machine-generated topic that is correct. For a topic the person typed, it means they type their question, click, and it vanishes. That defeats the feature.

### Design

1. **Seeds are not filtered.** A seeded topic (`origin = 'manual'`) is scored by Jev for display and ranking only. The duplicate check and gates do not reject it, it never loses head-to-head, and `trimPool` skips it (it neither counts against nor is cut by `pool_size`). Instead of rejecting, the result reports what it *would* have flagged, and the form shows it ("Close to an explainer made 12 days ago: ‘Why LLMs hallucinate’"). The person decides; the topic is still created.
2. **Question or topic, both fine.** The field is a single free-text box, labeled "What should the explainer explain?". A question is stored as typed in the title; the scope writer produces the scope and term as it does today. Optional "Source link or notes" stays.
3. **One seed per submit; list paste stays on the existing button.** A single typed seed is `manual`. (The existing paste-a-list behavior, origin `seeded`, keeps its current filtering; changing it is out of scope.)
4. **Visible in the pool.** The seeded idea shows in `PoolScreen` with a "Yours" chip (from the `origin` the adapter already reads, [lib/social-hub/adapters/explainers.ts](../../../lib/social-hub/adapters/explainers.ts)). The overlap warning shows in the form's result and the toast only; it is not stored, so it is gone after a refresh (my call, no schema change).
   - **A seed never displaces another topic.** If it would have lost or won a head-to-head against a pool topic, both stay and the result carries a `near_pool_topic` flag. If it only duplicates history (nothing in the pool), it enters with `history_duplicate`. Seeding therefore never changes an existing pool row (Rule 2).
   - **Where it sorts:** by its Jev score in the normal ranking, with no bump. Seeding a topic does not put it first.
   - **Status:** it lands as `status = 'pool'`. The builder must check every reader that assumes pool rows passed the gates (`listPool`, `fillCandidates`, the nightly auto-fill) and say which, if any, need changing.
   - **Cap and removal:** at most 10 open `manual` topics at once; the 11th shows "You have 10 seeded ideas waiting; make or remove one first." Existing `manual` rows are covered by the same trim exemption and the "Yours" chip, because they were hand-typed too. Removal uses the existing `archived` status through a small "Remove" action on seeded pool rows.
   - **Analogy pick:** a seed gets the analogy pick like any pool entry, and the cost shown includes it.
5. **Where the button goes.** "Seed an idea" is added to the pool tab. The existing "Add topics" header button stays and opens the same drawer, so there is one form, not two. The form's single-seed mode is the new default; "paste a list" is a secondary toggle.
6. **Making it.** After seeding, the idea is a normal open pool row. Make it (existing) renders it. Seeding does not render. The success toast says the idea is in the pool and offers a "Make it now" button. That is a separate click with its own cost confirmation, never folded into the seed click (Rule 1).

### Cost

One Sonnet scope call (small) plus one Jev score per seed, as today's manual add. Prompt caching: the scope-writer call already sends the theme brief; verify it is marked `cache_control` and fix if not (standing rule). The form shows "Writes the scope and scores it, about $X" (scope call, Jev score and analogy pick), taken from the averages `explainers.cost_events` already records, with a constant as the fallback when there are none. No render cost until Make it.

### Data and code changes

- `lib/explainers/ideas/evaluate.ts`: `evaluateTopic` takes the topic's origin; for `manual`, skip rejection outcomes and return a non-rejecting result with the flags attached. New result shape: `entered_pool` plus `flags: Array<'history_duplicate' | 'below_gate' | 'near_pool_topic'>`.
- `lib/explainers/ideas/evaluate.ts` `trimPool`: exclude `origin = 'manual'` from the cut.
- `lib/explainers/ideas/cycle.ts` `addAndEvaluateTopics`: pass origin through; return flags.
- `app/api/explainers/topics/route.ts`: return the flags; same auth.
- Pool tab: new `SeedIdeaButton` (shared) plus an explainers form; `PoolScreen` renders the chip.
- No schema change expected. If `status` for a kept-despite-gates topic needs a value beyond what the table allows, that is the one schema question for the build.

### Tests (offline; no live model)

- `evaluateTopic` with a `manual` topic: a duplicate, a below-gate score and a lost head-to-head each produce `entered_pool` with the matching flag; the same inputs with origin `generated` still reject.
- `trimPool` leaves manual topics when over `pool_size`, and does not count them toward the cut.
- Route: single title creates a `manual` topic; bad URL and oversize notes are rejected as today.
- Pool view: the chip and flag text render.
- Manual, by Tommy in the browser: seed a real question, click Make it.

## Overnight eligibility and Pin (Explainers)

Decided with Tommy, 2026-10-21.

**Seeds join the nightly rotation (Tommy's call).** A seeded topic is an ordinary pool topic for the nightly auto-render, if auto-render is on: a well-scoring seed can be rendered overnight with no click from the person, within the existing `daily_render_cap` and spend caps. A seed that fell below a gate (flagged `below_gate`) is manual-only: the nightly skips it, and only Make it or a pin makes it. Seeding itself still never starts a render.

**Pin.** Tommy sees an idea he likes that scores low and wants it made overnight without competing again. This is the existing Promote move, not a second mechanism:

- A **Pin** action on any open explainers pool row (seeded or machine-found), in the same place as the existing Promote/Demote buttons ([components/content-type/RankButtons.tsx](../../../components/content-type/RankButtons.tsx)). It writes the existing `social_hub.idea_adjustments` promote move.
- A pinned idea goes first in the next overnight make, whatever its score, including a below-gate seed (a person's pin overrides the manual-only rule). It stays pinned until it is made or retired; the move is consumed then (`consumed_at`), as for the other types.
- The pool shows it at the top with a "Pinned" chip. The "Promote" label is shown as **Pin** on explainers' pool rows; the stored move is unchanged. (My call: one mechanism, a friendlier word.)
- Per the shared-queue rule, one pin is made per night per queue, oldest first, up to the day's explainers quota. Extra pins wait their turn; the pool says "Pinned · next in line".
- Pinning does not change the spend rules. The overnight render of a pinned idea goes through the same `requestRender` caps, and only happens when explainers auto-render is on. With auto-render off, a pin sits until the person clicks Make it; the pin button says so.

**The gap.** Today the Text on Screen, Carousels and Stories workers read the moves ([lib/social-hub/moves-store.ts](../../../lib/social-hub/moves-store.ts)); the explainers cycle does not (it orders `fillCandidates` by `POOL_ORDER_BY` only, [lib/explainers/publish/schedule.ts](../../../lib/explainers/publish/schedule.ts)). The build wires `runIdeaCycle` to read the moves, put tonight's pin first in its candidates, skip a below-gate manual seed unless pinned, record a skip reason if the pin can't be made (the same `recordPromoteSkip` the other workers use), and mark it used when its render is requested. This is worker logic: redeploy the VM via `./scripts/gcp/deploy-worker-code.sh` in the same session, daytime only.

Tests (offline): the pinned idea comes before a higher-scoring one; two pins make one per night, oldest first; a pinned below-gate seed is chosen and an unpinned one is skipped; a pin consumed once its render is requested; a pin that hits a cap is recorded as skipped and the next is tried.

## The other types (later; each needs its own pass)

Listed so the shared pieces are built to fit them; none is specified here.

- **Carousels.** There is no idea table. The pool is the `shortlist` inside a daily `social.runs` record, and Run now pins a run to story ids found there ([lib/social/overnight/pinned.ts](../../../lib/social/overnight/pinned.ts)). A seeded story needs a research call (Claude plus `web_search`) to build the story record, a place to store it, and `loadPinnedCandidates` to find it. This is the costly one: the form must show a cost estimate and confirm before researching (Rule 1), and the research prompt needs caching.
- **Stories.** `stories.pool` is rewritten by the nightly refresh, which deletes unused rows it did not return ([lib/stories/pool.ts](../../../lib/stories/pool.ts)). A seed needs an origin the refresh leaves alone (`manual`), and a per-series form: Morning Download takes a story, Guess the Number a number, Free vs. Paid a tool pair.
- **Text on Screen.** Ideas are `reels.post_ideas` groupings of scraped `reels.sources`. A seed needs a synthetic source and idea, or a new row kind.
- **Last Few Days.** A seed would feed the next run's selection; it needs a look at how a run picks its headlines.
- The "last few days" and multi-story posts you mentioned (text-on-screen sets) belong with these two.

Order after Explainers: Stories (no research for most series), then Carousels, then Text on Screen and Last Few Days.

## Constraints

- CLAUDE.md Rules 1 and 2 and prompt caching (above). Automated tests stub the model.
- Explainers runs on `helios-orch-worker`/the explainers worker only for rendering, which this change does not touch. The scoring and scope calls run in the Vercel route, so **no worker redeploy** is needed for the Explainers slice. (Verify: `trimPool` and `evaluateTopic` are also called by the nightly worker; the change to them *is* worker logic, so a redeploy via `./scripts/gcp/deploy-worker-code.sh` is needed in the same session, daytime only.)

## Calls I made (check these)

1. Seeding never auto-renders; the person clicks Make it. Safer for spend, and matches "a human click authorizes the run."
2. Seeds bypass duplicate/gate/head-to-head rejection and the pool trim, and report flags instead. The alternative (reject with a reason) is simpler but makes the feature unreliable.
3. Question and topic share one text box; no separate "question" field.
4. One shared drawer for "Add topics" and "Seed an idea" on Explainers.

## Left to the builder

Exact copy, the flag wording, chip styling, whether `flags` persists on the topic row or only returns in the response (response-only is fine for v1), and the test fixtures.
