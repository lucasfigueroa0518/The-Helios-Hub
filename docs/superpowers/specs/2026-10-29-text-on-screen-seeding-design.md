# Text on Screen seeding — redesign (2026-10-29)

Supersedes the Text on Screen part of `2026-10-21-idea-seeding-design.md`. Other content types are out of scope here. Everything below is what Tommy said in the interview unless marked **(my call)**.

## Intent

Tommy finds a story online and wants it in the Text on Screen queue as an idea, scored and ranked like any other. The usual input is a headline plus a link to an article. The system reads the article, builds the idea, scores it, and puts it in the queue where its score says it belongs, marked as Tommy's. Nothing is made until Tommy pins it or runs it.

Why now: seeding returned "Request failed (500)" on the live site (fixed in code, commits `724f0cad` and `0c225700`, not yet deployed). While diagnosing it we found the current behavior differs from what Tommy wants: seeds land at the bottom of the queue, and a duplicate is only a note.

## Behavior

### 1. Headline and link (the normal path)
- Read the page at the link, build the idea from it, score it, place it.
- Text pasted by Tommy still counts as the body, as today (text, else the page at the link).

### 2. Placement and look
- The seed is scored with the same Jev passes as every other idea and ranked by that score among the others. It is not pushed to the bottom and not forced to the top.
- It carries a visible "Yours" badge in the queue **(my call on the wording and look)**.
- It is never made automatically. Tommy can pin it or generate it from the queue like any other idea.
- **The nightly run must leave seeds alone (Tommy, 2026-10-29).** Today the night carries over unselected scored ideas by score and does not exclude seeds, so a high-scoring seed can be made without Tommy touching it. Seeds are excluded from that carryover. A pin or Run now still makes them.
- Placement is by score in the queue view (sort seeds into the list by their net). Do not re-rank the whole stored slate to do it **(my call: ranks feed slot filling and copy, so moving them could change what gets made)**.

### 3. Duplicates
- If the story is already in the queue (same link, or a close match to an idea already there), stop. Do not add it. Show the existing idea and let Tommy choose: seed it anyway, or use the existing one.
- A story that was already posted stays a note on the seed rather than a stop **(my call: Tommy only spoke about the queue)**.

### 4. Headline only (rare)
- Search for the story, pick the best match, build the idea from it.
- Search order: stories the system has already collected, then Google News (free), then, only if neither finds a good enough match, a paid model web search.
- Pick the best match with the same kind of Jev logic used for the daily story pick.
- Paid search: capped at 3 searches, hard ceiling 15 cents per seed (search fees plus model tokens). The drawer shows the estimated cost before the paid search runs and waits for Tommy's go-ahead **(my reading of "sounds good" to showing the cost first)**. If it would pass 15 cents, it stops and says so.
- If nothing good is found, say so and add nothing.

### 5. Link that cannot be read (paywall, bot block)
- Tell Tommy the link could not be read, and at the same time search for the next best fit using the headline (same search as section 4).
- Use the best match automatically. The idea carries a note that the link was unreadable and which story was used instead.

### 6. Limits
- Seeds expire after 7 days if nobody makes them (kept).
- No cap on how many seeds are open at once (the current limit of 10 goes away).
- Kept as they are: headline up to 200 characters, text up to 10,000, the 60-second double-click guard, and the requirement that a scored slate exists.

## Non-goals
- A single shared seeding toolset across all five idea pools. Parked; the five existing systems stay.
- Changes to Carousels, Last Few Days, Explainers or Stories seeding.
- Enriching or backfilling anything already in the database.

## Constraints (CLAUDE.md)
- Rule 1: the Seed click is a human action and authorizes only that seed's search and scoring. Automated tests never call the live Claude API or `web_search`; they stub the model with canned responses and use 1–2 item fixtures. Agents do not run a live seed.
- Rule 2: lookups of existing queue ideas and collected stories are read-only matching for the one seed. Nothing loops over the database.
- Prompt caching: any new or changed `messages.create` puts the stable prefix first with `cache_control` (`lib/anthropic-cache.ts`).
- Worker sync: if worker code changes, redeploy with `./scripts/gcp/deploy-worker-code.sh` in the same session. The jsdom pin also needs a worker redeploy.
- Cost is recorded through the existing Jev recording runner so each seed's spend is visible.

## Left to the builder
- Where the "collected stories" live and how to match a headline against them.
- Reusing the daily pick's Jev call for choosing among candidates, rather than writing a new prompt.
- How to rank a seed into the newest slate by score (today it is inserted at rank max+1, unselected).
- The duplicate check's thresholds (today: link in pool, trigram floor 0.6) and the existing-idea panel in the drawer.
- Wiring the 15-cent ceiling and the estimate/confirm step through the paid search.

## Known bumps (pre-mortem, 2026-10-29, from reading the code, nothing run)
- **Night carryover** picks up seeds (see section 2). Fix: exclude seeds there; add a test that a high-net seed on yesterday's slate is not a carryover candidate.
- **Rank vs score.** The queue sorts by stored rank and a seed gets max+1 (last). Sort by net in the view instead of re-ranking the slate.
- **Candidate scoring cost.** Choosing among search results costs two Jev calls each (pass 1 and 2). Cap at 3–5 candidates, reuse the winner's score for the idea, and count it toward the 15-cent ceiling.
- **Paid search gate and metering.** The model web-search adapter refuses to run unless `REELS_B6_PROMPT_APPROVED=true` and is built for batches, not one match. Check the flag in production; add the 3-search cap, the 15-cent ceiling and the estimate/confirm step around it.
- **Duplicate detection** is a link match plus a 0.6 headline similarity, both notes today. As a stop it can block a different story or miss the same story at another URL. Needs a panel with Seed anyway / Use existing.
- **Smaller:** the double-click guard matches the exact headline (the substitute-story path needs its own); `readPage` returns null for both paywall and timeout, so "unreadable" can't say why; a substitute story has a different link than the one pasted; an unscored seed (scoring failed) needs a defined place in the queue.

## Not yet verified
- No seed has been run on a deployed build. The 500 fix is untested live.
- The cost figures (about 1 cent for link-only, about 7–10 cents with paid search) are estimates from pricing, not measurements.
