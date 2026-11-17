# Pool UI standard: inventory (2026-11-16)

What stays, what goes and what is new when every pool moves to the standard pool screen ([mock](mocks/2026-11-15-pool-screen.html), [plan](2026-11-15-pool-ui-standard-plan.md)). Built from a read of the code on branch `content-look-ahead`. Nothing here is built yet.

## Screens

| Today | What happens | Why |
|---|---|---|
| Type pages (`ContentTypePage` → `TypeHub`): 7 types. Day picker, day panel, "The bench", idea drawer, post drawer | **Replaced** by the standard pool screen. Same routes (`/explainers`, `/carousels`, …) | One screen for every pool |
| Text on Screen page (`app/reels/reels-hub.tsx`): own day picker, day cards, bench, "Reel details" drawer | **Moves to the standard screen.** Its post panel keeps the reel-only controls (song pick, finish, publish) inside the standard panel | It is the eighth pool and drifted the least |
| Social Hub pool page (`/social/content/pools/[type]`, `PoolScreen`, `PoolList`): table view, Waiting / Content ready / Everything filters | **Goes.** The route **redirects** to the type page so old links keep working | Two screens for one pool is how they drifted apart |
| Preview pool page (`/social/preview/content/pools/[type]`) | **Goes** with it (redirects to the preview type page) | Imports the deleted screen |
| Field Notes photo grid (`components/field-notes/PoolGrid.tsx`) | **Stays as is** | A photo library, not an idea pool |
| Posting settings drawer, `ScheduleStrip` | **Stays** | Settings, not the pool |

## Pieces inside the screen

| Today | What happens |
|---|---|
| Day picker chips + one day's panel ("No explainer reels posts on this day") | **Replaced** by the **Next three days** board (today and the next two, ‹ › to move) |
| "The bench" heading, `benchNote` | **Becomes** the Ideas tab; `benchNote` stays as its one-line explanation |
| `PoolQueue` (hold and drag, pin zone) | **Stays**, restyled; drop line and flash go orange |
| `QueueControls` (Pin, Archive) | **Stays**, as icon buttons on the row |
| Explainers "Generate" / AI Drama "Make it" row buttons (`ExplainersHub`, `ReelAiDramaHub`) | **Become one Make it button**, only on Idea and Failed rows; the cost confirm moves into the row |
| `GenerateConfirm` | **Stays** for the drag-into-today and pin-into-today asks |
| `RankButtons` (Field Notes up/down) | **Goes.** Field Notes joins the live queue (pin, drag, archive, Make it), decided 2026-11-16 |
| `AiEventsPoolButtons` (Pin / Exclude / Clear) | **Goes.** AI Events uses the shared Pin, drag and Archive (Exclude becomes Archive), decided 2026-11-16 |
| Seed buttons and the 6 seed forms | **Stay**; Seed a topic sits beside the tabs and is switched off at 30 with the reason shown |
| Raw worker errors on rows | **Go.** The row says "Failed, try again"; the full error is in the panel |
| "Generated · / Seeded ·" prefix | **Goes.** The meta line says "Written by the night" or "Seeded by you" |
| Score number column | **Stays.** Last Few Days and AI Events show rank (1, 2, 3), not negative scores |
| Idea drawer (`ScoreSection`, buttons) | **Stays**, restyled, with the error block for failed rows |
| Post drawer (`PostDetail`) | **Stays with every section** (status, action bar, media, caption, checks, details, score, sources, full post / Instagram links), restyled |
| Social Hub-only parts: `ScoreWhy`, per-type HOW text, stale-refill note, "Everything" filter | **Go.** The type pages' own score breakdown stays; Made plus Archived cover "Everything" |

## New

- **Ideas | Made tabs** (orange when selected) with counts that match the list.
- **Next three days board**, filled by made posts and, for open slots, by the ideas queued for them.
- **Up next band**: the ideas that fill the next open slots, each labelled with the slot and when it gets made.
- **"Enough topics for N days of posts" bar** under the header.
- **Made tab**: made posts for 30 days with state, post time and days until archived.
- **Orange pops**: today's column, Up next, pins, Making, flashes after pin / make / drop / undo.
- **Undo** for Archive (5 seconds).
- **Per-type settings** in `TYPE_CONFIG`: item noun, order, moves (see contract).

## Data behind it (what exists, what is missing)

Every type already reaches the UI as one shared `HubIdea` shape (`lib/social-hub/types.ts:153`), so one screen can read all eight. What differs is storage:

| Type | Pool comes from | Made link | Clean-up today |
|---|---|---|---|
| Text on Screen | each night's score slate + seeds (seeds expire after 7 days) | per idea | replaced each night |
| Explainers | `explainers.topics` | per idea | over 30 marked `displaced` |
| Carousels | the last run's shortlist + seeds (7 days) | per idea | replaced each run |
| Stories | `stories.pool` | per day only | **hard-deletes** stale, missing and over-cap rows |
| Last Few Days | the last run's record + seeds | per day only | replaced each run |
| Field Notes | `field_notes.tips` | per tip | unused tips expire after 30 days (technique exempt) |
| AI Events | `ai_events.pool`, one week | per day only | new week, new pool |
| AI Drama | `reel_ai_drama.pitches` | per pitch | retired / killed statuses |

Archive is a row in `social_hub.idea_adjustments`, never a delete. Nothing archives made posts by age today.

### Gaps against the decisions
1. **No "entered the pool" time** for Text on Screen, Carousels, Last Few Days and AI Events, and Stories overwrites its time on every refresh. For Carousels, Last Few Days and AI Events this matters little: the pool is rebuilt each run, so unmade ideas already leave within days. Their **seeds** expire after 7 days, which conflicts with the 30-day rule.
2. **Text on Screen seeds expire after 7 days**, but Text on Screen is evergreen (unmade ideas should stay).
3. **Stories deletes** old pool ideas instead of archiving them.
4. **Stories, Last Few Days and AI Events posts link to a day, not an idea**, so their Made tab lists posts, not ideas.
5. **Field Notes Make it on a specific tip** has no path today: Generate picks the next tip itself. Decided 2026-11-16: build a direct path, like Explainers.
6. **Bug:** the post Archive route skips AI Drama (its idea-id pattern leaves out `reel_ai_drama`, `app/api/social-hub/actions/archive/handler.ts:15`).

## Runs where
UI and reads: Vercel. Refills, trims, expiry, Stories pruning, AI Drama retire: `helios-social-worker` (redeploy with `./scripts/gcp/deploy-social-worker.sh` whenever these change).

## Out of scope
How ideas come into a pool (intake, search, scoring prompts). Field Notes ingestion is Lucas's area; nothing here touches it.
