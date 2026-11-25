# Pool UI standard: living plan (2026-11-15)

Method: Bald-Eagle-Iteration. Tommy decides; this file collects decisions in his words. No code edits until the build stage.

## Goal (Tommy's words)
> "Standardize UI/UX for idea pool management. Look at the explainers pool, it's wrong. Check to make sure each and every pool is right."

Builds on the behavior spec [2026-10-21-idea-pool-standard-design.md](2026-10-21-idea-pool-standard-design.md) (pin, drag, archive, generate, cap 30). This plan is about how every pool *looks and reads*, and whether each one follows that standard.

## Surfaces in play
- **The bench** on each type page (`components/content-type/TypeHub.tsx` + `PoolQueue.tsx`): /reels (own page, `app/reels/reels-hub.tsx`), /explainers, /carousels, /stories, /last-few-days, /field-notes, /ai-events, /reel-ai-drama.
- **Social Hub pool page** `/social/content/pools/[type]` (`components/social-hub/content/PoolScreen.tsx` + `PoolList.tsx`): a second, table-style view of the same pools.

## Audit, 2026-11-15 (local dev, live data)

| Pool | Header count vs bench count | Row controls | State words | Problems seen |
|---|---|---|---|---|
| Text on Screen | 105 / 30 | pin, archive | No reel, Carryover | Cleanest; no Generate on the row |
| Explainers | 37 / 32 | pin, archive, **Generate on every row** | Idea, Content ready, Video ready | Generate shown on rows that already have content; raw worker errors on rows ("--dangerously-skip-permissions…", "Worker restarted…") while chip still says Idea; "Generated ·"/"Seeded ·" prefix collides with "Content ready"; near-duplicate topics (#2 and #3); top 2 have content but today says "No explainer reels posts" |
| Carousels | 25 / 45 | pin, archive | Idea | **Layout broken**: titles right-aligned, chevron wraps to its own line, score clipped |
| Stories | 82 / 82 | pin, archive (drag needs a series) | | Bench far below a tall story preview |
| Last Few Days | 17 / 28 | archive only | Content ready, Idea | Score column is rank as negatives (0.00, −1.00 …) |
| Field Notes | 368 / 50 | **none** | Content ready, Slides ready, Idea | Tips that already made a post sit in the pool; detail repeats the kind twice; many titles are source names ("GitHub: claude-code topic") |
| AI Events | 233 / 399 | pin/exclude in drawer | | Week list, city filter; different model by design |
| AI Drama | 4 / 4 | pin, archive, **Make it** | Content ready, Idea | Long pitch paragraphs fill the row; "Make it" vs Explainers' "Generate" |

## Draft: what each pool's settings include (2026-11-15, not yet approved)
Tommy: "lets draft what the settings should include". Taken to mean the per-pool settings in `TYPE_CONFIG` (`lib/content-type/config.ts`) that one shared pool screen reads. Everything not listed here is fixed by the standard, so it cannot drift between pools.

### Per-pool settings (allowed to differ)
| Setting | What it decides | Today |
|---|---|---|
| `itemNoun` | What one entry is called (topic, story, tip, pitch, event, idea), in the count, empty state and buttons | Only in benchNote prose |
| `order` | How the list sorts and what the number column shows: `score`, `rank`, `newest`, or `none` | Implicit; Last Few Days shows rank as a negative score |
| `moves` | Which of pin, drag, archive and make-one the row offers | `queue` (live / archive_only / none) plus per-component buttons |
| `groups` | The filter above the list (series, cities, or none) and whether drag needs a group picked | `groupNoun`, `dragNeedsGroup` |
| `seedable` | Whether "Seed an idea" shows | Same |
| `weekPool` | One week's ranked list in place of a rolling pool (AI Events) | Same |
| `detail` | What the drawer shows: source link, score breakdown, full pitch, made post | Hard-coded per component |
| `benchNote` | The one sentence under the heading | Same |
| `freshness` | Unmade ideas only. `evergreen`: they stay until made or archived by hand. `time_sensitive`: they are archived 30 days after they entered the pool. Taken from the existing split in `lib/social-hub/lead.ts` (see below), not set again here | Exists as lead days |

### Fixed by the standard (the same for every pool)
- **Row:** position, title on one line, one meta line, state chip, number column, then the row's moves. Long text (AI Drama pitches) goes in the drawer.
- **State words:** Idea, Making, Ready, Failed, Posted. A raw worker error never reaches the row; it shows "Failed, try again" and the full error in the drawer.
- **Make-one button:** one verb for every pool, shown only on an Idea or Failed row. Remaking a Ready row is done from the drawer.
- **Tabs:** Ideas (not made yet) and Made (made posts, posted or not). The header count matches the tab being shown.
- **Leaving the pool:** a made post sits in Made for 30 days after it was made, then it is archived (kept, not deleted). The rule is the same for every pool.
- **One screen:** the bench is the pool. The Social Hub table page links to it.
- **Behaviour** stays as the 2026-10-21 spec has it: pin with a cost confirm, archive, cap of 30, the top of the queue fills today.

### Proposed values per pool
| Pool | itemNoun | order | moves | groups | seedable |
|---|---|---|---|---|---|
| Text on Screen | idea | score | pin, drag, archive | series | yes |
| Explainers | topic | score | pin, drag, archive, make | none | yes |
| Carousels | story | score | pin, drag, archive | none | yes |
| Stories | idea | score | pin, drag (series first), archive | series | yes |
| Last Few Days | story | rank | archive | none | yes |
| Field Notes | tip | newest | make | none | yes |
| AI Events | event | rank | pin, exclude | cities | no |
| AI Drama | pitch | rank | pin, drag, archive, make | none | no |

## Pool screen brief (impeccable shape, 2026-11-15, confirmed 2026-11-15)
Tommy's answers to the discovery round: draft as a "Clickable mock", the main job is "Pick what's next", and the device is "Desktop, works on phone".

1. **Summary.** One pool screen that every content type's page uses for its own pool. It shows what will be made next and lets a person steer that order. The settings above are the only things that differ between types. The mock uses Explainers' real topics as its example.
2. **Primary action.** Steer what's next: see which ideas fill today and the next two days, then pin, drag or archive. Make it is available on each row but kept quiet.
3. **Direction.** Restrained, per DESIGN.md (Social Hub tokens, Roboto, flat panels, hairlines). Orange only where a person can act. State words in Muted Ink, and only Failed and Needs you get color. Scene: Tommy at a desk in the morning, in daylight, taking a minute to check what's lined up, so the screen is light. Anchors: Spotify's Up next queue (drag order, a clear "next" band), Linear's issue list (dense one-line rows, status as icon plus word), Instagram's Professional Dashboard (already the hub's reference).
4. **Scope.** A clickable static HTML mock: the Explainers pool with both tabs, every row state, the drawer opening, and a phone width. No app code changes.
5. **Layout.**
   - **Next three days** board (added after Tommy's review: "It needs a place to show that day and the next 2 days content ideas and made posts, kinda like what the idea pool page we have now"): three day columns, the selected day plus the next two, with ‹ › to move. Each slot shows the made post in it (thumbnail, time, state) or, if nothing is made yet, the queued idea that will fill it (dashed thumbnail, when it gets made). The list's Up next labels come from the same slots, so the board and the list always agree.
   - Header: page title, then one line: "32 topics waiting · 6 made in the last 30 days".
   - Tabs **Ideas | Made** as a segmented control. The count on each tab matches its list.
   - A group filter row (series or cities) only for pools that have groups.
   - **Up next** band: the top N rows (today's quota and the two-day cushion), each labeled with the day it fills ("Today", "Tue", "Wed"). Pinned rows sit at the top with a pin icon.
   - A hairline divider labeled "Later", then the rest of the list.
   - Row, left to right: grip, position, title (one line, cut off with an ellipsis), one meta line (source · added 3 d ago, plus "archives in 4 d" for time-sensitive pools inside their last week), state badge, number column (score or rank, tabular, right-aligned), then Pin, Archive and Make it (only on Idea and Failed rows).
   - **Made** tab: the same row with a thumbnail in place of the grip, the state (Ready, Scheduled, Published, Failed), the date made, and "archives in 12 d".
   - Drawer from the right: full title and text, where the score comes from, source link, the made post preview, Regenerate, and the full error when a row Failed.
6. **Key states.** Default; loading (skeleton rows); empty ("No topics waiting", with Seed a topic when the pool is seedable); Making (loader badge, buttons locked); Failed ("Failed, try again" badge, error in the drawer); pinned; dragging (the pin zone lights up while a row is held above the pins); at the cap of 30 (seeding says why it is off); archived (the row leaves, with a 5-second Undo toast); a phone width (the number column folds into the meta line, the drawer goes full-screen).
7. **Interaction.** Hold and drag to reorder (the current 180 ms hold); a click opens the drawer; Pin asks for confirmation with the cost when it pulls an unmade idea into today; Make it states the cost, then the row shows Making; Archive takes effect at once and can be undone. Transitions run 150 to 250 ms with the Helios ease-out, and reduced motion fades instead.
8. **Content.** The item noun comes from `itemNoun` (topics, stories, tips, pitches, events, ideas). Button words: Pin, Unpin, Archive, Make it, Regenerate, Undo. No raw worker errors, developer codes or table names on screen.
9. **References for the build.** layout.md, clarify.md, harden.md (states), animate.md (the drag and the Undo toast).
10. **Visual probes.** Skipped: this harness has no built-in image generation. The clickable mock stands in for them.

**Mock:** [mocks/2026-11-15-pool-screen.html](mocks/2026-11-15-pool-screen.html), checked at desktop and phone widths. Tommy confirmed the brief ("Yes, build the mock"). Tommy approved the mock: "yeah this is looking great".

## Decisions
- **2026-11-15, make-one verb.** Tommy: "Yes, \"Make it\"". Every pool's make-one button says **Make it**. Explainers' "Generate" on the row is renamed. The settings drawer's "Generate every morning" switch is a different control and keeps its name.
- **2026-11-15, Field Notes gets Make it.** Tommy: "Yes, add it". Field Notes rows get the Make it button (moves: make). It shows only on Idea and Failed rows, the same as every other pool.
- ~~**2026-11-15, when an idea leaves the pool.** Tommy: "Until posted if it is an evergreen content type, if it is a time-sensitive one, then 7 days after." A new per-pool setting, `freshness`, holds this. Still open: which pools are evergreen.~~ *Replaced below.*
- ~~**2026-11-15, the time-sensitive window.** Tommy: "make it 14 days and when it enters". A time-sensitive idea leaves the pool 14 days after it entered, whether or not a post was made. This replaces the 7 days.~~ *Replaced below.*
- **2026-11-15, one rule for made posts (replaces the two above).** Tommy: "hmm maybe I have that wrong. lets just make it 30 days after it is made, and it gets archived rather than deleted. Perhaps a \"made\" tab." Every pool follows the same rule, so there is no evergreen or time-sensitive split. A made post moves to a **Made** tab, and 30 days after it was made it is archived, not deleted.
- **2026-11-15, unmade ideas in time-sensitive pools.** Asked whether ideas that are never made should also be archived after a while, Tommy said: "This should be for those time sensitive ones". In time-sensitive pools, an unmade idea is archived after a set time. In evergreen pools it stays. This brings `freshness` back as a per-pool setting for unmade ideas only. The 30-day Made rule still applies to every pool. Still open: which pools are time-sensitive.
- **2026-11-15, the unmade-idea window.** Tommy: "30 days from entry". In a time-sensitive pool, an unmade idea is archived 30 days after it entered the pool. Every pool now uses 30 days, for unmade ideas (counted from entry) and for made posts (counted from when they were made).
- **2026-11-15, the evergreen list.** Tommy: "I think we determined what content types were evergreen and what weren't when we did some rework." `freshness` comes from the D4 split in `lib/social-hub/lead.ts`, and Stories goes by series. This replaces "by source".
- **2026-11-15, Field Notes tip expiry.** Tommy: "Keep it". Field Notes keeps its 30-day expiry for unused tips, and `technique` tips stay exempt. It is the one evergreen pool where unmade ideas expire. The pool screen shows those expired tips as archived.

### The existing evergreen split (Bald-Eagle 2026-11-12, D4)
Tommy, quoted in `planning/bald-eagle-2026-11-12/PLAN.md` D4 and in `lib/social-hub/lead.ts`: "For evergreen content, we will have a 2-day cushion; for time-sensitive content like morning download, that will be generated the day of."
- **Evergreen (2-day lead):** Text on Screen, Explainers, AI Drama, Field Notes, and the Stories series Guess the Number and Free vs. Paid.
- **Time-sensitive (same day):** Carousels, Last Few Days, AI Events, and the Stories series Morning Download.
- Stories splits by series, not by where an idea came from. This replaces the "by source" idea from the conversation.
- Settled (see Decisions): Field Notes is evergreen in D4, but its night already archives unused tips after 30 days (`expireOldTips`, `lib/field-notes/store.ts`, setting `tip_expiry_days`), with `technique` tips exempt.
- **2026-11-15, text on orange.** Tommy: "all text above orange should be white". Labels on orange buttons are white, the same as the live app's buttons today. This differs from DESIGN.md, which says Ink labels on orange.
- **2026-11-15, orange stays bright.** Asked whether to use a deeper orange so white text passes the 4.5:1 contrast bar (white on #ff5e1a is about 2.9:1), Tommy said: "Keep it as is". Buttons keep #ff5e1a with white labels, accepting the lower contrast. The build updates DESIGN.md (Primary button, The One Signal Rule's Ink label note, the WCAG line) to match.
- **2026-11-15, orange pops.** Tommy: "Wouldn't mind some orange highlights or pops just around it. You just litter in some dopamine-spiking kind of things." Orange also marks where you are and what's next: today's column outlined in orange with an orange Today chip, an orange-tinted Up next band with a pulsing dot and orange positions 1 to 3, the Ideas count, pinned pins, Making badges, the drop line while dragging, and a "days of topics left" bar. Actions get a short orange flash: pin (icon pops), Make it, a drop, Undo. Hover glow on Make it. Each motion has a reduced-motion fallback. This loosens DESIGN.md's One Signal Rule ("orange only where a person can act"); the build updates DESIGN.md to match.
- **2026-11-15, Ideas | Made toggle.** Tommy: "can we make the \"Ideas and Made\" tab toggle button orange with white text". The selected tab is orange with white text and count; the other tab stays grey.
- **2026-11-15, post panel matches the app.** Tommy: "Yes, match the app". A made post's panel has the live PostDetail's sections, in order: state and status line; the state's buttons (Publish now / Approve / Try again first in orange, then Unschedule, Regenerate, Reject, Archive); the playable reel or carousel pages; caption; checks and review notes; details (length, words, voice, music, cost to make, render time); where the score comes from; sources; Open the full post and View on Instagram.
- **2026-11-15, mock approved.** Tommy: "yeah this is looking great". The mock at `mocks/2026-11-15-pool-screen.html` is the target for the build.
- **2026-11-16, seed expiry stays.** Asked whether seeds in Text on Screen, Carousels and Last Few Days should follow the freshness rule instead of expiring after 7 days, Tommy said: "Keep 7 days". Seeds keep their 7-day expiry; the freshness rule covers ideas the pools find themselves.
- **2026-11-16, Stories archives.** Asked whether Stories should archive old pool ideas instead of deleting them, Tommy said: "Yes, archive them". Stories' pool clean-up (stale, missing from a refresh, over the cap) archives rows instead of deleting them. This is worker code, so the build redeploys `helios-social-worker`.
- **2026-11-16, Field Notes runs like the others.** Asked how Field Notes' Make it should work, Tommy said: "The whole point is for all these to kind of run the same so that the UI/UX of each content pool page feels similar. I guess, however the other ones are running, it should run." Field Notes joins the live queue like Explainers: Pin, hold-and-drag, Archive, and Make it on the chosen tip (a direct make path, like Explainers' and AI Drama's). Its Up/Down rank buttons go. The night picks tips in queue order. Worker code changes, so the build redeploys `helios-social-worker`.
- **2026-11-16, Last Few Days and AI Events get the same buttons.** Asked whether they should get the same row buttons too, Tommy said: "Yes, same buttons". Both get Pin, hold-and-drag and Archive on the row, and their night runs follow the queue order (pins first, then the order set by dragging) when picking stories or events. AI Events' Exclude becomes Archive. Make it does not apply to them, because each of their posts is built from the whole list; their page-level Rebuild / Generate stays. Worker code changes, so the build redeploys `helios-social-worker`.
- **2026-11-16, ship later.** Tommy: "Commit, deploy later". The build is committed on `pool-ui-standard` (stacked on `content-look-ahead`, PR #41). Applying `db/stories_pool_archive.sql` and redeploying `helios-social-worker` (`./scripts/gcp/deploy-social-worker.sh`) happen in the session that merges and ships this, so the overnight runs and the live app change together.

## Open questions
- Before shipping: apply the Stories migration, redeploy the social worker, and click Pin, drag, Archive, Undo and Make it once on the live app. See the [inventory](2026-11-15-pool-ui-inventory.md) and [contract](2026-11-15-pool-ui-contract.md).
