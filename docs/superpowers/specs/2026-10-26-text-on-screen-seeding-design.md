# Text on Screen seeding: type an idea into the pool (2026-10-26)

**Status:** design pass for Tommy's review; not built. Nothing here was decided in an interview: **(my call)** and **(guess)** are mine to be checked.
**Part of:** [2026-10-21-idea-seeding-design.md](2026-10-21-idea-seeding-design.md) (the Text on Screen row). Model for shape: [2026-10-25-carousels-seeding-design.md](2026-10-25-carousels-seeding-design.md).
**Branch:** `unify-social-hub`.

## What this is

A person types or pastes their own idea into the Text on Screen queue. It shows with a "Yours" chip, can be pinned or Run now'd, and (once scored) the night can pick it like any idea. It is never rejected, deduped away or trimmed. Seeding never starts a render.

## What a seed is (guess)

A **headline** (required, up to 200 characters), the **story** in the person's own words (optional, up to 10,000 characters; pasted article text is fine), and an **optional link**. With a link and no story text, the page text is read with the plain page reader the night already uses (no model); if the page cannot be read the idea is still added with the headline as its text, and the form says so. Anything over a limit is refused with how much to cut, never cut for them. The writer needs facts, so the form hints that a one-line idea gives thin copy.

## How a Text on Screen idea is born (read from the tree)

- A scraped `reels.sources` row joins a `reels.post_ideas` row through `post_idea_members` (`createPostIdea`, `addMember`, each followed by a `snapshot`). The idea has no title; its headline is its primary member's.
- The night: ingest, `groupRun`, `resetTimelyFlags`, `scoreRun`, then `generatePassingReels`. `scoreRun` scores only ideas that are `timely`, on today's slate already, or one of yesterday's 20 best misses. `resetTimelyFlags` runs at the end of grouping, so an idea nothing joined that night is cold and is not scored.
- A score is a row in `reels.idea_scores` on a slate (`score_slates`, one per run). The hub pool shows only the **newest** slate (`REEL_IDEAS_SQL`). `putOnSlate` copies an idea's latest stored score row (net, bucket, framework all set) onto tonight's slate; with none it returns false and the pin steps aside as "gone".
- "Make it" on a reel needs the idea on **today's** slate (`todaySlateFor`); Run now is a whole new manual night, in which pins reach the slate by `putOnSlate`.

## Design

**Where it lives: no schema change.** A seed is an ordinary source and idea, made by the existing `insertSource`, `createPostIdea` and the existing snapshot. It is marked by its source: `adapter_id = 'seed'`, `source_name = 'Your seed'`, `canonical_url` = the link (canonicalised) or `seed://<id>`, `run_id = NULL` (the column is nullable; the unique index treats NULL runs as distinct, so nothing collides), `raw_payload = { seed: true }`. New code is new files only (`lib/reels/seeds.ts`, one route, one form).

**Scored when added (guess, as Carousels).** `loadIdeaMaterial` + `scoreOneIdea` (the same pass 1 and pass 2 each nightly idea gets), with `runId: null` (`jev_logs` and `cost_events` allow it). The result is written as **one `idea_scores` row, origin `carryover`, `selected = false`, rank = the slate's max + 1, on the newest slate**: exactly the row `putOnSlate` writes, so `putOnSlate` can later copy it to tonight's slate. No new slate or run row (see "what could break"). If the model call fails the idea is kept, shown "not scored yet", with a retry button; if no night has ever been scored the form refuses before spending anything.

**Cost and Rule 1.** Two Jev calls at $0.042 per million input tokens: well under a cent (guess; check against `cost_events` for `scoring-pass1/2`). No Claude Messages call and no web search, so no prompt-caching change. The button says "Scores the idea once, well under a cent. Nothing is made." The click authorizes only that seed's calls. Making a reel later is the usual copy, frame and video (about $1), by a separate click, a pin, or the night's own cap.

**Reading it.** The hub adds seeds to the Text on Screen ideas: the newest slate already lists the new row; a seed whose row is on an older slate is added by a second query (idea has a `seed` member, source under 7 days old, latest score row from any slate). Both carry `yours` (as `queries/carousels.ts` does) and the adapter sets the chip; the 30 cap never cuts them. Open seeds are capped at 10 (made, archived or expired seeds free a place).

**Pin, Run now, the night.** A pin is the existing `pin` row for `reels:idea:<id>`. `generatePassingReels` calls `putOnSlate`, which copies the seed's stored row onto tonight's slate; no change there. Pin is refused up front in the hub for a seed with no net score ("No bucket cleared its bar"), because the night would otherwise report "not in the pool". Run now needs no change. A seed scored on today's slate can also be made by "Make it" the same day; otherwise "Pin it or Run now" is shown. **The night picks a seed on its own** only as a carryover: a row on yesterday's slate that is among the 20 best misses is rescored (about 2 Jev calls) and ranked like any idea. Otherwise the night skips it unless pinned, as for Explainers.

**Expiry (guess): 7 days** from adding, as Carousels. `runRetention` removes the source at 21 days regardless. Archive uses the existing archive move.

**Warnings, not rejections.** At add time the response lists read-only flags: same link already in the pool, a headline close to an idea in the last 72 hours (`shortlistCandidates`, no model), the story already published recently (`loadPublishedStoryKeys`). The seed is added anyway.

## What could break the nightly pipeline, and how the design avoids it

1. **A seed-time slate would break the page.** `score_slates.run_id` is NOT NULL and unique, and many readers take the "latest" slate (`REEL_IDEAS_SQL`, `loadLatestSlate`, `latestSlateForDate`, `scheduleLatestToday`, `locksForSlate`, and `livePlan`'s "has tonight run" count). A new slate, or a backdated one, would replace the pool or fake a night. So: **no slate and no `reels.runs` row**; one row on the existing newest slate, as `putOnSlate` does.
2. **Grouping could merge the seed away.** `mergeSameEventIdeas` keeps the idea with more members and **deletes** the other (`mergeIdeas`), so a one-member seed is absorbed and its id, pin and "Yours" go. Every grouping read filters `sources.drop_reason IS NULL` (`shortlistCandidates`, `shortlistIdeaMerges`, `listUngroupedSources`, content candidates). **Recommended (my call): store `drop_reason = 'seed'`**, a new named value (the column is plain text; `DropReason` gains one member). Nothing else filters on it (copy targets do not), and the seed still copies, scores and shows. The cost: the raw-pool page lists it as "dropped: seed", and a machine story on the same event forms its own idea instead of joining. The alternative is a three-line guard in the two grouping queries, which is worker code and needs `deploy-worker-code.sh`.
3. **Nothing sweeps it.** `listUngroupedSources` only takes sources with no member; a seed has one from birth. `reels:regroup --reset` deletes every membership (a manual calibration script): out of scope, but a seed would be lost to it.
4. **Held-out checks are visible.** `holdOutReasons` can hold a seed as `published_url` or `teaser_only` (pasted text ending "read more"); the pin then records the reason shown on the page.
5. **Other lanes.** The Last Few Days reels lane needs a `timely` row, so a `carryover` row never feeds it. The lfd replay counts scored ideas per day (+1 per seed; harmless).
6. **Nothing touches `reels.runs`, health, or cost-by-run.** Seed Jev spend appears in the month-to-date total only.
7. **Worker sync.** New files and the hub query/adapter are Vercel-only. The builder greps that the changed query and adapter files are not imported by `scripts/reels_worker.ts` or the social worker; if one is, redeploy.

## Build

1. `lib/reels/seeds.ts`: `addReelSeed(deps, input)`: validate and cap, read the link, flags, insert source (`drop_reason 'seed'`) and idea in one transaction, score, write the row, return `{ id, title, net, flags }`. `readOpenSeeds`. Double-click guard (same headline within a minute returns the first).
2. `REEL_IDEAS_SQL` / `readReels`: add off-slate seeds; adapter sets `yours`, hides "Carryover" for seeds, shows "Not scored yet".
3. Pin guard for unscored seeds in the queue action.
4. `POST /api/reels/seed` (session); "Seed an idea" button on the pool tab (shared `SeedIdeaButton`) with the Text on Screen form.
5. Run the builder's checks in item 7; add `'seed'` to `DropReason`.

## Tests (offline; stub `JevTransport`, no live model)

- Add a seed: source/idea/member rows, one `carryover` row on the newest slate, Jev called twice (once if no framework survives).
- `putOnSlate` copies it to a new slate; `listUngroupedSources`, `shortlistCandidates` and `shortlistIdeaMerges` never return it; `mergeSameEventIdeas` leaves it.
- The pool view: chip, off-slate seed listed, 30 cap keeps it; the 11th seed refused; expired and archived seeds gone.
- Over-limit text refused, not trimmed; unreadable link still adds; Jev failure keeps the idea unscored; no slate refuses with zero calls.
- `carryoverMisses` includes a high-net seed from yesterday's slate.

## Not in this design

A description with no text (model research), editing a seed, bulk import, images, Last Few Days (own design), and any change to grouping, scoring or `generatePassingReels`.

## Questions for Tommy (ranked)

1. Score it when added (about a cent, so it shows a net and can be pinned), as Carousels? **Recommend yes.**
2. Keep it out of grouping with `drop_reason = 'seed'` (raw-pool page shows it as dropped) or add a worker guard and redeploy? **Recommend the drop reason.**
3. Expire after 7 days? **Recommend 7.**
4. Headline plus your own text plus optional link, or link only like Carousels? **Recommend all three, headline required.**
5. When a night picks it up only as a carryover, is that enough, or should every well-scoring seed be tried tonight? **Recommend as built (needs a pin otherwise).**
