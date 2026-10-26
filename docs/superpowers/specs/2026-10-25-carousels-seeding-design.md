# Carousels seeding: paste a story link into the pool (2026-10-25)

**Status:** design pass for Tommy's review; not built. Decisions marked **(Tommy)** were made in the 2026-10-25 interview; **(my call)** are mine to be checked.
**Part of:** [2026-10-21-idea-seeding-design.md](2026-10-21-idea-seeding-design.md) (the Carousels section). Explainers and Stories seeding are built; this is the next type.
**Branch:** `unify-social-hub`.

## What this is

A person pastes the link to a specific story into the Carousels queue and it becomes a story the queue can pin, Run now can make, and (once scored) the night can pick, like any shortlisted story. It shows with a "Yours" chip.

## Decisions

- **Input is a link, with an optional headline (Tommy).** A description with no link is out of scope for now: it would need a Claude call with web search to find sources.
- **It is scored when added (Tommy).** One Jev scoring call on the seed (`scoreGroups`, the same call each nightly candidate gets, one per story, a fraction of a cent). That click is the authorization (CLAUDE.md Rule 1), and the button says so first.
- **A seed expires after 7 days (Tommy),** counted from when it was added, unless it has been made or archived first.
- **Seeding never makes a post.** The post is made by a pin, Run now or the night, at the usual run cap (about $2).
- **No schema change (my call).** Seeds are kept as a JSON list in the existing `social.settings` table (key `carousel_seeds`), at most 10 open at a time.

## How it fits what exists

- A Carousels idea is a story group in the shortlist stored in each daily run's record; every run replaces it. There is no idea table.
- Pins, Run now (`--story-id`), the night's pins and promotes all find a story through one function, `loadPinnedCandidates` ([lib/social/overnight/pinned.ts](../../../lib/social/overnight/pinned.ts)). **If it also looks in the seeds, a seed works everywhere with no other change.** Its story id is the link (as shortlist ids are).
- The Reporter reads the story's pages itself when a post is made, so a seed only has to carry its link and the page text.
- The hub's Carousels ideas come from the newest run's shortlist ([lib/social-hub/queries/carousels.ts](../../../lib/social-hub/queries/carousels.ts)); the seeds are added to that list, scored like the rest, with `yours`.

## Build

1. `lib/social/overnight/seeds.ts`: `addSeed(query, { url, headline? }, deps)`: validate the link (http/https, not already a seed or a shortlisted story: say so plainly, still add if the person insists), fetch the page text with the existing plain `fetchBody` (no model), build one `StoryGroup`, score it with `scoreGroups` and the live Jev ask, store it with its `addedAt`. Refuse the 11th open seed ("You have 10 seeded stories waiting; make or archive one first."). `readSeeds(query)` returns the open ones (not expired, not made).
2. `loadPinnedCandidates`: look in the seeds as well as the shortlists.
3. Hub read: seeds join the Carousels ideas with score and `yours`; the 30 cap never cuts them.
4. API `POST /api/carousels/seed` (session; body `{ url, headline? }`); form button on the Carousels page ("Seed an idea") showing "Scores the story once, a fraction of a cent. Nothing is made."
5. Expiry and cleanup: a seed that has shipped is marked made (the pin's settle already knows); expired and archived seeds drop on the next write or read.
6. Night: nothing new. A seed that scores well sits in the shortlist order and the night's pins and promotes already reach it; a seed that fails scoring gates is still kept and shown, and the night skips it unless pinned (same rule as Explainers).

## Tests (offline; no live model)

- Add a seed with a stubbed fetch and Jev: it is stored, scored, listed with `yours`, found by `loadPinnedCandidates`, and made by `pinnedStages` / `promotedStages` like a shortlisted story.
- The 11th seed is refused; a seed past 7 days is gone; an archived or made seed is gone.
- A page that cannot be fetched is refused with why; a bad link is refused.
- The Jev call count is one per seed.

## Not in this design

Description-only seeds (needs web research), editing a seed, bulk import, and Text on Screen / Last Few Days seeding (own passes).

## Left to the builder

Exact copy, the duplicate-link wording, where the JSON list's helpers live, and fixtures.
