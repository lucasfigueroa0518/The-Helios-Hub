# Pool UI standard: build contract (2026-11-16, draft for Tommy)

Every name, field and rule that more than one builder touches. Builders own disjoint files; anything shared is defined here first. Target look: [mock](mocks/2026-11-15-pool-screen.html). Decisions: [plan](2026-11-15-pool-ui-standard-plan.md). What changes: [inventory](2026-11-15-pool-ui-inventory.md).

## 1. Scope
- **In:** the pool screen on all 8 type pages, its settings, row states, the Made tab, archive and expiry rules, removing the Social Hub pool page, DESIGN.md.
- **Out:** how ideas come in (intake, search, scoring prompts, Field Notes ingestion), the calendar, analytics, posting settings.
- **Spend:** no live Claude, web search, Jev or render calls in building or testing. Tests stub every model call. A Make it click in the built app is the only live spend, and only a person makes it.

## 2. Settings: `TYPE_CONFIG[type].pool` (`lib/content-type/config.ts`)
Added beside the existing fields (`queue`, `seedable`, `weekPool`, `groupNoun`, `dragNeedsGroup`, `benchNote` stay as they are):

```ts
export type PoolConfig = {
  /** What one entry is called: { one: 'topic', many: 'topics' }. */
  noun: { one: string; many: string };
  /** The number column: score (2 decimals), rank (1, 2, 3), or none. List order: score and rank best first, newest by createdAt. */
  order: 'score' | 'rank' | 'newest';
  /** Which buttons a row offers. */
  moves: { pin: boolean; drag: boolean; archive: boolean; make: boolean; rank: boolean; exclude: boolean };
};
```

| Type | noun | order | pin | drag | archive | make | rank | exclude |
|---|---|---|---|---|---|---|---|---|
| reels | idea | score | ✓ | ✓ | ✓ | | | |
| explainers | topic | score | ✓ | ✓ | ✓ | ✓ | | |
| carousels | story | score | ✓ | ✓ | ✓ | | | |
| stories | idea | score | ✓ | ✓ (series first) | ✓ | | | |
| last_few_days | story | rank | ✓ | ✓ | ✓ | | | |
| field_notes | tip | score | ✓ | ✓ | ✓ | ✓ | | |
| ai_events | event | rank | ✓ | ✓ | ✓ | | | |
| reel_ai_drama | pitch | rank | ✓ | ✓ | ✓ | ✓ | | |

`moves.pin/drag/archive` must agree with `queue` (`live` → pin, drag, archive; `archive_only` → archive). A unit test checks it.

**Freshness** is not a setting. `poolFreshness(type, series?)` in `lib/content-type/pool-rules.ts` returns `'evergreen'` when `leadDaysFor(type, series) > 0` (`lib/social-hub/lead.ts`), else `'time_sensitive'`. Field Notes is evergreen but keeps its own tip expiry (`expireOldTips`).

## 3. Row states (`lib/content-type/pool-rules.ts`)
```ts
export type PoolRowState = 'idea' | 'making' | 'failed' | 'ready' | 'scheduled' | 'needs_you' | 'posted';
export function poolRowState(idea: HubIdea): PoolRowState;  // Ideas tab
export function madeRowState(post: HubPost): PoolRowState;  // Made tab and board
```
- `idea.run.state` `queued`/`running` → `making`; `failed` → `failed`; otherwise `idea_only` → `idea`.
- Made posts: approval waiting → `needs_you`; booked → `scheduled`; posted → `posted`; publish failed → `failed`; otherwise `ready`.
- **Words** (one table, `POOL_STATE_WORDS`): Idea, Making, Failed, try again, Ready, Scheduled, Needs you, Published.
- **Raw errors never render on a row.** `idea.run.error` and post errors show only in the panel, under "The last try stopped."

## 4. Tabs and lists (`lib/content-type/pool-view.ts`)
```ts
export function poolIdeas(model: TypeHubModel, now: Date): PoolIdeaRow[];   // Ideas tab, in queue order
export function poolMade(model: TypeHubModel, now: Date): PoolMadeRow[];     // Made tab, newest first
export function poolBoard(model: TypeHubModel, startDay: string, days: 3): BoardDay[];
export function poolRunway(ideaCount: number, slotsPerDay: number): number; // whole days of posts the pool covers
```
- **Ideas:** ideas in states idea, making or failed, not archived, ordered by the existing queue (`queueOrder`). The header count is `poolIdeas(...).length`.
- **Made:** posts made in the last 30 days (`generatedAt`), any state. Each row shows "archives in N d" = 30 − days since made. Stories, Last Few Days and AI Events list their posts (their posts link to a day, not an idea).
- **30-day archive of made posts is computed on read.** Nothing is written or deleted; a post older than 30 days simply leaves the Made tab. No worker change.
- **Board:** per day, the type's slots (existing slot reader). A slot shows its made post if there is one; otherwise the next idea from `poolIdeas` in order fills the earliest open future slot. The Up next band is the first 3 ideas with their slot labels taken from this same fill, so the board and the list always agree.

## 5. Components (`components/content-type/pool/`)
| File | What it is |
|---|---|
| `PoolScreen.tsx` | The whole pool: header line, runway bar, board, tabs, list, panels. Props: `type`, `model`, `parts` (type-specific seed form, make action, post-panel extras) |
| `PoolBoard.tsx` | Next three days, ‹ ›, today outlined in orange |
| `PoolTabs.tsx` | Ideas / Made segmented control, selected = orange with white text and count |
| `IdeaRow.tsx`, `MadeRow.tsx` | The two row layouts from the mock, including the inline Make it confirm |
| `IdeaPanel.tsx`, `PostPanel.tsx` | Side panels. `PostPanel` keeps every `PostDetail` section in order; Text on Screen passes its reel controls through `parts.postExtras` |
| `pool.css` | Uses the Social Hub tokens from DESIGN.md; orange buttons have white text |

Reused unchanged: `PoolQueue` (drag), `queue-post.ts`, `GenerateConfirm`, `SeedButton` and seed forms. Every type now uses `queue: 'live'`, so the `archive_only` and `none` modes and the `exclude`/`rank` moves can be removed after the build. Removed from the type pages: `TypeHub`'s day picker, bench and drawers; `ExplainersHub`/`ReelAiDramaHub` row buttons (their make actions move to `parts.make`).

**Make it** calls the existing per-type route: explainers `/api/explainers/topics/:id/generate`, AI Drama `/api/reel-ai-drama/make`. The confirm states the cost against the day's cap before anything runs. Field Notes gets a direct make path for the chosen tip (new route, `/api/field-notes/tips/:id/make`, same shape as Explainers'), and `field_notes` moves to `queue: 'live'` so its night picks tips in queue order (Tommy, 2026-11-16). `RankButtons` and `/api/content-type/idea-rank` are retired once nothing uses them.

## 6. Routes
- `/social/content/pools/[type]` and `/social/preview/content/pools/[type]` become permanent redirects to the type page. Delete `PoolScreen` (social-hub) and `PoolList`; keep `lib/social-hub/views/pools.ts` (other screens use it).
- Update the tests that name the old page (`tests/social-hub-nav.test.ts`, `tests/social-hub-server-timing.test.ts`) and the breadcrumb in `lib/social-hub/views/nav.ts`.
- Fix: the post Archive route accepts `reel_ai_drama` ids (`app/api/social-hub/actions/archive/handler.ts:15`).

## 7. Server and worker changes (pending Tommy's answers)
Seeds keep their 7-day expiry (Tommy, 2026-11-16: "Keep 7 days"); no change. Stories' pool clean-up archives instead of deleting (Tommy, 2026-11-16: "Yes, archive them"; `lib/stories/pool.ts` writePool and capSeries). Archived rows never come back to the pool and never count toward the cap. Last Few Days and AI Events move to `queue: 'live'`; their night runs pick in queue order, and AI Events' Exclude becomes Archive (Tommy, 2026-11-16: "Yes, same buttons"). `AiEventsPoolButtons` is retired once the shared row covers Pin and Archive. These change worker code (Field Notes' queue-order pick and make path too), so the same session redeploys `helios-social-worker` (`./scripts/gcp/deploy-social-worker.sh`).

## 8. DESIGN.md
Update in the same build: Primary button label white on Signal Orange (contrast accepted, 2026-11-15); The One Signal Rule widened (orange also marks today, Up next, pins, Making, and confirms an action); segmented control selected state orange; a "Pool screen" component entry.

## 9. Builders (one owner per file)
| Owner | Files | Done when |
|---|---|---|
| A. Rules | `config.ts` (pool block), `pool-rules.ts`, `pool-view.ts`, their tests | Unit tests cover every type's config, every state mapping, the board fill, runway and the 30-day Made window; `npm test` and type check pass |
| B. Screen | `components/content-type/pool/*` | Matches the mock at desktop and 375 px; all states (loading, empty, making, failed, pinned, dragging, full at 30, archived with Undo); reduced motion works; no raw error text on any row |
| C. Pages | `TypeHub.tsx`, `ContentTypePage.tsx`, `type-parts.tsx`, `ExplainersHub.tsx`, `ReelAiDramaHub.tsx`, `app/reels/reels-hub.tsx` | All 8 pages render the standard screen with local data; every existing button still reaches its route |
| D. Routes and server | redirects, archive handler fix, nav, tests, approved worker changes plus redeploy | Old links land on the type page; tests pass; worker redeployed if touched |
| E. Design system | `DESIGN.md`, `.impeccable` sidecar refresh | DESIGN.md matches what was built |

Integration: a fresh read-only reviewer checks every name here against the code, then each of the 8 pages is opened locally and compared with the mock.

## 10. As built (2026-11-16, integration)
Where the code differs from the sections above. The code is the reference.
- **Signatures:** `poolIdeas(model, now, source)`, `poolMade(model, now, source)`, `poolBoard(model, startDay, 3, { ...source, now })` take `source = { posts, dayQuotas, adjustments }` from the loaded dataset, because `TypeHubModel` holds only some posts and no calendar slots. `madeRowState(post, now?)` uses the hub's approval rule when `now` is given. Extra helpers: `poolSlotsPerDay`, `makesText`, `MADE_WINDOW_DAYS`.
- **Screen props:** `PoolScreen({ model, data, readOnly, make, generate, seed, postExtras, ideaExtras, progress, fullPostBase, fromPath })`, fed by `poolPageData` (`components/content-type/pool/pool-data.ts`). Make it reaches the screen through the per-type wrappers `ExplainersHub`, `ReelAiDramaHub` and `FieldNotesHub`, not through `TypeParts`.
- **Board slots:** with the calendar on, a type's day quota is today's slot count, so it cuts today only; other days show their calendar slots. The runway counts the same slots. A week with no slots says "No posting slots this week. Set them in Calendar".
- **Whole-list types:** Last Few Days and AI Events keep the items that are in the post on the Ideas list (the post is built from the whole list), and no single item fills a board slot.
- **Unmade ideas, 30-day rule for time-sensitive pools:** covered by the pools themselves, so no new job: Carousels and Last Few Days rebuild their list every run, AI Events every week, and Stories' refresh archives stale Morning Download ideas. Seeds keep their 7-day expiry (Tommy, 2026-11-16). `poolFreshness` stays as the shared rule for any later use.
- **Field Notes Make it** route: `/api/field-notes/tips/:id/make`.
- **Undo:** Archive is sent when the 5-second Undo window ends (or when the tab is hidden), so Undo needs no unarchive route.
- **Still to remove later:** the `archive_only` / `none` queue modes and the Promote/Demote paths only types off the queue used; every type is now on the queue.
