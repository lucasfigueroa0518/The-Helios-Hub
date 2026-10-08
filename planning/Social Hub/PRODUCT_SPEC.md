# Social Hub — Product Spec

Status: draft from the planning interview with Tommy, 2026-10-07/08. Hub not built. Revised 2026-10-08 against the repo at `3a79147` plus the uncommitted approval-layer changes in the working tree (see §0).
Companion: `BUILD_PLAN.md` (milestones). Decisions are numbered `SH-xx` and are settled unless reopened by Tommy.

## 1. What it is

One place to see, compare and act on everything the Helios Instagram account posts from our pipelines. Two halves:

- **Social Hub** — calendar, profile analytics, content analytics, posts.
- **Content House** — the operating floor: all content, today's posts, on deck, idea pools, sources, per-post analytics, content-type comparison, Hard publish / Hard regenerate.

It sits on top of the "Social overnight" contract (`docs/social-overnight.md`): every vertical keeps its own schema (`runs`, `settings`, `posting_schedule`, `publish_attempts`, `media_insights`), and the hub reads them side by side. Trial Reels is the reference implementation, and its analytics (`/reels/analytics/performance`, `lib/reels/analytics/performance.ts`) is the model for the analytics UX.


## 0. What already exists (repo state, 2026-10-08)

The hub is now mostly an **integration and UI layer**: all four content types generate, schedule, publish and read insights on their own (`docs/social-overnight.md`, all on `helios-social-worker`). Read this before §2; decisions below were revised to match.

| Type | Schema / UI | Window & cadence today | Approval today | Per-post insights stored |
|---|---|---|---|---|
| Trial Reels | `reels`, `/reels` | 8:45–10:00 AM, 11:15 AM–12:30 PM, 6:00–9:00 PM; **2–3 a night, one from the knowledge lane** (D-272) | `require_approval` (on); slot needs `posting_schedule.approved_at`; Approve / Force on `/reels` | views, reach, likes, comments, saves, shares, reposts, interactions, avg + total watch time, skip rate |
| Explainer Reels | `explainers`, `/explainers` (+ `/reels` review page, `/settings`) | **3:00–4:30 PM, 1 a day**; 2:00 AM idea cycle only with `auto_render`; `daily_render_cap` 1 | `require_approval` (on); only renders with an `approved` verdict in `explainers.feedback` (tags: hook, analogy, accuracy, pacing, visuals, voice, captions, brand) are scheduled | views, reach, likes, comments, saves, shares, interactions, avg + total watch time, skip rate |
| Carousels | `social`, no review UI | **7:00–8:15 AM, 1 a day**; 3:00 AM run only with `auto_run`; only the run's best post is scheduled, today only | `require_approval` (on); `approveSchedule()` exists and is documented as "the Social Hub review screen" — **no UI calls it yet, so carousels cannot post until the hub exists**. An unapproved slot that comes due is **cancelled** with a reason. | views, reach, likes, comments, saves, shares, interactions |
| IG Stories | `stories`, `/stories` (queue, history, settings) — Lucas | **8:30–10:00 AM for every series** (code; supersedes S-20's evening window): Morning Download daily, Guess the Number Mon/Thu, Free vs. Paid Tue/Sat; 4:00 AM build per series with `auto` on | Never auto-approved; Approve / Publish now on `/stories`; `stories.feedback` (tags: story_choice, copy, photo, design, accuracy) | Per **frame**: reach, views, replies, shares, follows, profile visits, interactions, taps forward/back, exits, swipe forward; every 2 h, final read at 23 h |

Also in place:
- **Shared Instagram code** in `lib/instagram/` (clock, posting windows, Graph calls, insights client and due/settle rules) and `lib/media-bucket.ts`. The hub builds on these; Trial Reels keeps its own copies in `lib/reels`.
- **Publishing quota guard:** every publisher reads `content_publishing_limit` and fails when fewer than 5 posts remain in the 24 h window.
- **"Newest successful render is the one that posts"** is already the contract's versioning rule (no approved-version pointer) — consistent with SH-50.
- **Trial Reels insights poll** already has a single-pull claim with a 30-minute cooldown (`lib/reels/media-insights/poll.ts`) — the model for refresh-on-visit (SH-23).
- **Stories plan §12 (S-30):** Stories works in isolation first, then assimilates into this hub; its adapters (`lib/stories/sources`, `publish`, `render`) are kept small for that merge. The Stories plan already expects the hub to show **completion (last-frame reach ÷ first-frame reach)** and **exits on frames 1–3** per set.

Still missing (the hub must add): any **account-level** insights; **follows / profile visits** for feed posts (only Stories record them); a **carousel review/approve UI**; any cross-type view.

The approval layer (`require_approval`, `approved_at`, cancel-on-unapproved) was uncommitted in the tree at this revision; Tommy confirmed 2026-10-08 it will be committed as is (SH-55).

## 2. Scope decisions (interview log)

| ID | Decision |
|---|---|
| SH-01 | Verticals at launch: **Trial Reels, Explainer Reels, Carousels (Helios Social), IG Stories.** |
| SH-02 | **Pipeline posts only.** Posts not created by one of our systems do not appear. |
| SH-03 | **One Instagram account.** No account switcher, no other platforms. |
| SH-04 | **Metadata stays per-vertical for now**; a unified schema comes later. No forced mapping between verticals' fields in v1. |
| SH-05 | Filtering: **pick a vertical first.** Shared filters (date, vertical, format, posting slot, IG metrics) always work; choosing one vertical unlocks that vertical's native metadata filters. Mixed-vertical views use shared fields only. |
| SH-06 | Compare modes: **N posts side by side** and **group vs group.** No cross-tab heatmap, no baseline-deviation view. |
| SH-07 | Insights are **descriptive only**: stats next to each other (counts, averages). No significance tests, regression, or AI-written takeaways. |
| SH-08 | **Success metric is user-selectable** per view (no fixed north star). It drives ranking and "top" lists. |
| SH-09 | Group sample rule = Trial Reels rule: groups **under 3 posts stay visible, marked "thin."** |
| SH-10 | Compare uses **latest totals** (no age-normalized 24h/7d snapshots). |
| SH-11 | Calendar shows **published + scheduled/on-deck posts + Stories**. No forecast/capacity view (dropped). No week view. |
| SH-12 | Calendar color = **vertical.** |
| SH-13 | Calendar and post view are **read-only** (no drag-reschedule, no notes/tags). Actions live in Content House. |
| SH-14 | Users: **Tommy + team, same access.** No roles. |
| SH-15 | Hard publish = **post now, bypass the slot** (like Trial Reels Force post). Hard regenerate = **rerun the pipeline for that one post now.** |
| SH-16 | Hard regenerate requires a **confirm modal with a cost estimate** (vertical's typical cost per post) and respects each vertical's daily cap. |
| SH-17 | **Hard publish counts as approval for every type** (extended from Carousels only; confirmed 2026-10-08). |
| SH-18 | "Articles being used" = **all source material across every vertical**, deduped, with reuse counts. |
| SH-19 | "Story ideas" / "post ideas" = **each pipeline's own idea pool**, read-only. |
| SH-20 | Content-type comparison = **a chart showing performance by category** (vertical as the category; metric selectable). |
| SH-21 | **Cost per post shown everywhere** next to performance (post view, tables, compare, type chart). |
| SH-22 | Metrics Meta's API does not expose are **dropped** from the design (no "not available" placeholders, no manual entry). |
| SH-23 | Freshness: **overnight sweep after the runs**, plus **refresh-on-visit**: opening any Social Hub page when the last refresh is older than 30 minutes triggers a refresh immediately. |
| SH-24 | **Daily account snapshots stored forever** (Meta's own lookback is limited). |
| SH-25 | The hub is a **new item in the sidebar menu.** Existing `/reels` and `/explainers` stay as each pipeline's workshop. |
| SH-26 | Single-post view includes **media preview** and a **metrics-over-time chart**, plus all metadata (§6). |
| SH-27 | ~~Stories: design the slots now, wire later.~~ **Revised:** Stories are built (`stories` schema, `/stories`). The hub **reads Stories from v1** through an adapter. Ownership of Stories generation, approval and publishing stays with Lucas's system until the S-30 assimilation; the hub does not replace `/stories`. |
| SH-28 | **Mobile matters**: calendar and post view must work well on a phone. |
| SH-29 | Date ranges: **7d / 30d / 90d / All + custom**, default 30d. |
| SH-30 | Top performers: **top 5 by the selected metric**, all verticals mixed. |
| SH-31 | No saved views, no CSV export, no shareable-URL requirement in v1. |

### Publishing decisions (expanded scope)

| ID | Decision |
|---|---|
| SH-40 | ~~Build publishing paths for Explainer Reels, Carousels and IG Stories.~~ **Revised:** all three are built (§0). The hub adds the carousel approval UI, the cadence/window changes (SH-46 – SH-48) and Hard publish / Hard regenerate on top of them. |
| SH-41 | **No music on Carousels or Stories** (Meta's API cannot attach sounds to them; confirmed by Tommy 2026-10-08). No song picker, no recorded song. Music selection stays a Trial Reels feature only. |
| SH-42 | **Explainer Reels do not use Meta sounds** — they keep their own (HeyGen) music baked into the video. |
| SH-43 | Carousels and Stories post **silent**. (Supersedes the earlier "record the intended song" idea.) |
| SH-44 | Explainer Reels post as **regular reels shared to the grid** (not trial reels). Already how the code works. |
| SH-45 | **Approval (revised to the 2026-10-08 overnight doc).** Every type ships with `require_approval` on; nothing posts without a person. Tommy turns approval off per type himself. Explainers "auto-publish" (from the interview) therefore means: when Tommy turns Explainers' `require_approval` off, approved-or-not renders schedule themselves. Carousels stay approval-gated; unapproved carousel slots that come due are cancelled (existing code). Stories are never auto-approved. **Hard publish counts as approval for every type** (it is a person's click). |
| SH-46 | **Target** daily layout (America/New_York; today's code is in §0): **9:00–10:00 AM Carousel · 1:00–2:30 PM Explainer · 2:30–3:30 PM Carousel · 3:30–5:00 PM Explainer**, plus Trial Reels' 8:45–10:00 AM, 11:15 AM–12:30 PM, 6:00–9:00 PM. |
| SH-47 | Overlapping windows are allowed; the scheduler keeps **any two feed posts at least 30 minutes apart** across all verticals. Stories are not feed posts and are exempt (as the overnight doc already says). This **replaces the overnight doc's "windows must not overlap" rule**; the doc's clock table is updated when SH-46 is built. |
| SH-48 | Posts-per-day is a **per-vertical setting.** Defaults: Carousels 2, Explainers 2. Trial Reels keep their own logic (2–3 a night, one from the knowledge lane, D-272). Stories keep their series schedule. Only Explainers and Carousels are levers in the hub. For Carousels this means scheduling the run's **top two** posts, not only the best one. |
| SH-49 | Explainer `daily_render_cap` raised **1 → 2** (accepts up to ~2× explainer spend under current per-reel caps). |
| SH-55 | Confirmed 2026-10-08: (1) Explainer "auto-publish" means Tommy turns Explainers' `require_approval` off himself; until then they need approval like every type. (2) Hard publish = approval for every type. (3) The uncommitted approval layer is committed as is and the hub builds on it. |
| SH-56 | **Cost is hierarchical and never double-counted** (§8a). Every ledger row is counted exactly once; shared costs are split down to the items they produced; totals reconcile bottom-up to the cent. Formula shapes follow Trial Reels cost analytics (`lib/reels/analytics/rollups.ts`: every stat is an explicit numerator ÷ denominator) and the Outreach Hub (`lib/analytics-attributed-cost.ts`: an item may appear under several groupings but is counted once in the total). |
| SH-57 | Route: **`/social`**. The existing `app/social/render` and `app/api/social/generated` stay where they are; hub pages use other segment names. |
| SH-58 | HeyGen plan allows two explainer renders a day (confirmed). |
| SH-59 | **Trial Reels content is never reused.** A Trial Reels idea that wins a slot again is produced fresh, as today. Changing Trial Reels code is allowed (spacing check, adapters) but its logic principles stay intact: scoring, carryover, knowledge lane, selection, song picking and approval behave exactly as now. |
| SH-60 | **A carousel news story with a finished run keeps that finished post.** If the story is selected again it reuses the stored slides instead of running again. |
| SH-61 | **The build runs autonomously with no human review gates** (see `BUILD_PLAN.md` §A). Every gate is a self-verification gate. |
| SH-62 | **The autonomous run is confined to UI/UX and simple schema wiring** (`BUILD_PLAN.md` §S): read-only access to existing schemas, one new `social_hub` schema written but not applied, actions wired only to existing functions behind off-by-default flags, an allowlist of editable paths with a hash-based scope guard. Pipeline-changing work (collector, cadence/windows, reuse, enabling actions) is Phase 2, supervised. |


### Generated content lifecycle (2026-10-08)

| ID | Decision |
|---|---|
| SH-50 | **Generated content survives with its post idea (Explainers, Carousels; not Trial Reels — SH-59).** Once a video (Explainers) or carousel (Carousels) is generated for a post idea, it stays attached to that idea. It is not thrown away because it missed a slot. |
| SH-51 | **The post idea keeps competing normally** (Explainer pool, Carousel story selection). Having content does not give it a free pass or a penalty. |
| SH-52 | **When an idea with stored content wins a slot, it posts the stored content** instead of generating again. No new generation cost. |
| SH-53 | **Stories (and Trial Reels, SH-59) are exceptions.** They are time-sensitive and tied to their day (the morning download runs for that morning; Guess the Number and Free vs Paid run on set weekdays). A Story set that misses its window is skipped, never reused or posted late (matches today's code). |
| SH-54 | **Hard regenerate replaces the stored content** for that idea with a new version; earlier versions are kept as history, and the newest is the one that posts. |

## 3. Information architecture

Sidebar: **Social Hub** (new `HUB_NAV` item, `/social`; the sidebar already has Trial Reels, Stories and Explainers, which stay) with children:

```
/social                 Calendar (default)
/social/analytics       Analytics → tabs: Profile · Content · Compare
/social/house           Content House → tabs: Needs approval · Today · On deck · All content · Ideas · Sources · Types
/social/post/[id]       Single-post view (also opens as a drawer from anywhere)
```

Note: `/social` already holds `app/social/render` (carousel render) and `app/api/social/generated`; they stay (SH-57). Hub segments avoid those names.

### The post identity (durable everywhere)

Every post has a hub id `vertical:publish_attempt_id` (scheduled-but-unpublished: `vertical:schedule:<posting_schedule.id>`). Stories have no `publish_attempts`/`posting_schedule`; their id is `stories:<sets.id>` and a set is one post whose frames are its pages. Clicking a post anywhere — calendar, tables, compare, top performers, Content House — opens the **same** single-post view (drawer on desktop, full screen on mobile, deep-linkable at `/social/post/[id]`).

## 4. Calendar

**Month view.** Grid of days. Each day lists its posts as small chips: vertical color · time (ET) · short name. Overflow collapses to "+N more". Scheduled posts render outlined (not filled); failed publishes show a failure mark; **cancelled-unapproved** slots show struck through with the reason ("not approved before its slot"). Stories appear as one chip per **set** (series name, frame count) in the Stories color. Days and chips are clickable.

**Day view.** Timeline of the day (ET) with each post at its time: vertical, short name, a fuller description (first line of on-screen copy / headline / topic scope), status (published / scheduled / failed), and a small metric line (views, shares, saves). Click a post → single-post view.

**Mobile.** Month view becomes a compact grid with colored dots per day; tapping a day opens the day view as a list.

Short name rules: reuse `reelTitle()` for Trial Reels; topic title for Explainers; post title for Carousels; series name + first story headline for Stories.

## 5. Analytics

Global controls on every analytics tab: date range (SH-29), vertical picker (All or one; SH-05), success metric picker (SH-08), metadata filters (only when one vertical is picked).

### 5.1 Profile analytics (account level, new collector)

| Section | Metrics |
|---|---|
| Reach | Accounts reached, impressions/views, follower vs non-follower split |
| Engagement | Accounts engaged, total interactions, link-in-bio taps |
| Followers | Net change, demographics (age, gender, country, city), most active times (hour × day) |
| Top performers | Top 5 posts by the selected metric (SH-30) |

Every metric here must be verified against the current Instagram Graph API before build (M0). Anything not exposed is dropped (SH-22).

> **M0 result (2026-10-08):** see `META_API_CHECK.md` § "Spec §5 trimmed". Reels: no follows / profile visits (not in the API). Per-post follower split, retention curves, plays and surface sources: dropped. `online_followers` and `follower_count`: unverified, shown only when collected.

### 5.2 Content analytics (post level)

| Format | Metrics |
|---|---|
| Reels (Trial + Explainer) | Views, reach, avg watch time, total watch time, skip rate, likes, comments, shares, saves, interactions (+ reposts for Trial Reels); follows and profile visits **if M0 confirms** |
| Feed posts (Carousels) | Reach, views, likes, comments, saves, shares, interactions; profile visits and follows **if M0 confirms** (not collected today for any feed type) |
| Stories (per set, drill to frame) | Reach, views, replies, shares, follows, profile visits, interactions, taps forward, taps back, exits, swipe forward; **completion** (last-frame reach ÷ first-frame reach) and **exits on frames 1–3** (from the Stories plan) |
| Discovery | Follower vs non-follower split; source surface only if the API exposes it |

Expected drops (to confirm in M0): retention curves, initial plays vs replays, per-surface traffic sources (feed / Explore / Reels tab).

### 5.3 Posts table

Filterable, sortable table of posts in range: thumbnail, vertical, short name, posted at, the selected metric, cost, and the vertical's key columns. Row checkbox → add to compare. Row click → single-post view.

### 5.4 Compare

- **Side by side:** pick 2–6 posts; columns per post; rows = metrics, cost, then metadata. Rows where posts differ are highlighted. Mixed verticals show shared rows plus each post's native metadata (blank where a field doesn't apply).
- **Group vs group:** choose a factor (a vertical's native field, or a shared field like vertical / slot / format) → one row per group: count, thin flag, and averages of the metrics (Trial Reels `factorGroups` shape, generalized). Sorted by the selected metric.

Factor sets per vertical (v1, native fields — SH-04):

- **Trial Reels:** psychology, content bucket, blockbuster, posting slot, audio type, song genre, color grade, hook, hook sound, full story cue, timely/carryover, our score (above/below median) (existing `FACTOR_OPTIONS`), plus **knowledge-lane pick vs regular** (D-272).
- **Explainer Reels:** origin (seeded/generated/manual), weighted score band, each Jev score band (audience fit, teachability, analogy, visual, accuracy under simplification, hook strength), posting slot, review tags from `explainers.feedback`, voice id, render spend.
- **Carousels:** hook pass on/off, slide count, photo sources, story source/feed, posting slot, approval (approved by / approved at).
- **Stories:** series (Morning Download / Guess the Number / Free vs. Paid), style (polished / homemade), frame count, backdrop of frame 1, candidate origin of the chosen items (reels / carousel / catalog / github / generated), weekday, flagged by review, trigger (click / auto).

Score bands for numeric scores: above/below the median of the posts in view (same rule as Trial Reels' "our score").

## 6. Single-post view

Same component everywhere (SH-26):

1. Media preview — video player for reels/explainers, swipeable slides for carousels, frames for stories.
2. Header — vertical, short name, posted at (ET), slot, status, permalink to Instagram, link to the pipeline's own page.
3. Small analytics — latest totals for the format's metrics (§5.2) and **cost to make** (SH-21).
4. Metrics over time — line chart of daily `media_insights` snapshots since posting; metric selectable.
5. All metadata — every field the source system holds for the post, grouped: content (bucket, psychology, hook type…), production (color grade, audio, song…), scoring (Jev scores, net score), scheduling (slot, origin, graduation). Fields come from the vertical's adapter; nothing is dropped because another vertical lacks it.

## 7. Content House

| Tab | Shows |
|---|---|
| Needs approval | Everything waiting on a person, across types, soonest slot first, with time left before the slot. **Carousels are approved here** (this is the "Social Hub review screen" `approveSchedule()` was written for, and the carousel plan's M9 review screen): slides, caption, sources, render-check results, Approve / Reject. Trial Reels slots can be approved inline. Explainers and Stories link to their own review pages (`/explainers/reels`, `/stories`), which keep their tag-based feedback. |
| Today | Today's published and scheduled posts across verticals, with live metrics for published ones. |
| On deck | Everything in any `posting_schedule` with status `scheduled`, by publish time. Hard publish per item. |
| All content | Every post (published, scheduled, failed), filterable like the analytics table. Hard publish / Hard regenerate per item. |
| Ideas | Each vertical's idea pool, read-only: Trial Reels post ideas, Explainer topic pool, Carousel candidate stories, Story ideas (when available), with their scores. |
| Sources | All source material across verticals, deduped by URL: title, domain, which posts used it, reuse count, and those posts' performance on the selected metric. |
| Types | Chart of performance by vertical for the selected metric and range, with post counts and cost per post (SH-20, SH-21). |

**Hard publish** (SH-15, SH-17, SH-45): posts the item now, skipping its slot, via that vertical's existing publish path (Trial Reels Force post; Explainer/Carousel `queuePublish` with a `force` trigger; Stories "Publish now"). It records approval for every type. Disabled with a reason when the item isn't ready (no render, failed checks) or when the account's publishing quota has fewer than 5 posts left (existing guard). The Content House header shows the remaining 24 h quota.

**Hard regenerate** (SH-15, SH-16): queues a one-post rerun in that vertical's `runs` (the app inserts a `requested` row; only the worker executes). Confirm modal shows the typical cost per post for that vertical and remaining daily cap; refuses when the cap would be exceeded.

## 8. Data and refresh

- **Read side:** one adapter per vertical (`lib/social-hub/adapters/<vertical>.ts`) maps its tables to a common `HubPost` shell (id, vertical, format, name, description, postedAt/publishAt, status, permalink, media, cost, metrics, history) plus a `native` metadata record and that vertical's factor list. No cross-vertical field mapping (SH-04).
- **Account insights:** new table (proposed `social_hub.account_insights_daily`, keyed by `ny_date`, metric columns + `raw` jsonb, plus `account_demographics_daily` and `online_followers_daily`). Written daily, kept forever (SH-24).
- **Per-post insights:** stay in each vertical's `media_insights` (contract). Missing columns (follows, profile visits, story navigation) are added per vertical.
- **Refresh:** overnight sweeps per the contract clock (Trial Reels 5:00, Explainers 5:15, Carousels 5:30, Stories every 2 h), then a hub sweep for account insights after them. The account collector lives in `lib/instagram/` beside the existing insights client. Refresh-on-visit (SH-23): every hub page load checks `last_refreshed_at`; if older than 30 minutes, the app queues a refresh row and the **worker** pulls (Vercel does not run workers). One refresh at a time, using the same claim-plus-30-minute-cooldown pattern as `claimInsightsPoll` in `lib/reels/media-insights/poll.ts`; a hub refresh triggers each type's own per-post poll plus the account pull. The page shows "Refreshing…" and updates when done. Story insights also need intra-day pulls because they expire after 24h.
- **Cost per post:** see §8a.

## 8a. Cost model (SH-56)

**Levels (bottom-up):** ledger row → content item (post / set / reel version) → post idea → day → vertical → hub total. Each level is the plain sum of the level below. No level adds or re-reads money on its own.

**Ledgers (the only money sources):** `reels.cost_events`, `explainers.cost_events`, carousel run costs (`social.runs.claude_usd` / `total_usd` and the run record's per-stage, per-story costs), `stories.cost_events`. Never also add a denormalized total (`jobs.spend_usd`, `sets.spend_usd`, `runs.total_usd`) on top of the rows it summarizes — use one or the other per item, and test they agree.

**Attribution rules:**

| Vertical | Direct cost (belongs to one item) | Shared cost (split) |
|---|---|---|
| Trial Reels | Copy, image, video, song spend tagged to a post idea / job | Ingest, grouping, scoring for a night → split **equally across the reels produced that night** |
| Explainers | Render job spend (`job_id`) | Idea-cycle spend for a day (generator, scoring, duplicate check) → split **equally across the explainer reels rendered that day** |
| Carousels | Per-story stage costs in the run (reporter, writer, editor, fact-check, photos, render) | Run-level costs (feeds, selection) → split equally across the posts that run produced. **All runs that touched a story are summed into that story's post** (reruns, rerender-photos runs) |
| Stories | Rows with a `set_id` | Rows without a `set_id` that day → split equally across that day's sets |

**No double counting:**
- Splits are computed in integer micro-dollars with a largest-remainder rule so the shares add up to the shared amount exactly.
- When a shared cost has **no item to land on** (a night that produced nothing, a failed run), it stays in an explicit **"Unattributed (no output)"** line at the day and vertical level. It is never spread across other days.
- An item shown under several groupings (factor groups, Sources, Types) is still counted once in any total.
- A reused post (SH-60) carries its cost from the day it was generated; posting it later adds nothing.

**Invariant (tested):** for any window and vertical, `Σ items + Unattributed = Σ ledger rows`, to the micro-dollar; and `Σ verticals = hub total`.

**Stats** use the Trial Reels shape (numerator ÷ denominator, both shown on drill): cost per published post, cost per generated item, spend that reached a published post (yield), failed / unshipped spend, and per-post cost next to performance (views per dollar, shares per dollar).

## 9. Publishing (existing paths; hub changes only)

All four paths exist (§0). The hub changes:

- **Explainer Reels:** second window and 2/day (SH-46, SH-48): windows 1:00–2:30 PM and 3:30–5:00 PM replace 3:00–4:30 PM; `daily_render_cap` 1 → 2 (SH-49). No music change (own HeyGen audio, no `audio_id`).
- **Carousels:** second window and 2/day: 9:00–10:00 AM and 2:30–3:30 PM replace 7:00–8:15 AM; the run schedules its top two posts. Approval in Content House → Needs approval. No music (SH-41).
- **IG Stories:** no change from the hub. Read-only plus Hard publish via the existing "Publish now".
- **Cross-vertical spacing:** one shared check in `lib/instagram/window.ts` that keeps feed posts ≥ 30 minutes apart across all schemas (SH-47); Trial Reels' scheduler calls it too (touches `lib/reels`).
- **Clock doc:** `docs/social-overnight.md` table and overlap rule updated in the same change.

## 9a. Generated content lifecycle (SH-50 – SH-54)

**Model.** Applies to Explainers and Carousels. Each has a *post idea* (Explainer `topics`; Carousel news `story_id`) and zero or more *content versions* generated for it (video job / render / slide set). One version is **current**. Slots belong to ideas; when an idea wins a slot, the current version posts.

**States the hub shows for an idea (Content House → Ideas, All content, and the single-post view):**

| State | Meaning |
|---|---|
| Idea only | In the pool, nothing generated yet. |
| Content ready | Generated, not scheduled. Shows "generated <date>" and the version count. Still competing. |
| On deck | Won a slot; scheduled with its stored content (calendar shows it outlined). Badge "reusing content from <date>" when it was generated on an earlier day. |
| Published | Posted. The post view links back to the idea and which version posted. |
| Retired | Idea left the pool (e.g. aged out of Trial Reels carryover) with content never posted. Content kept and visible; Hard publish still works. |
| Story skipped | Stories only: missed its window; not reusable (SH-53). |

**UX rules.**
- Ideas tab gets a **"Has content"** filter and column, so you can see the stockpile of ready-to-post work per vertical.
- On deck and the calendar show the **content's age** next to reused items so a stale-looking post is visible before it goes out.
- The post view shows **version history** (date, trigger: nightly / force / hard regenerate) and marks the current one.
- Hard publish on an idea with content posts the current version; on an idea without content it is disabled ("nothing generated yet — Hard regenerate first").
- Hard regenerate confirm modal says the new version will **replace** the current one (old kept in history).
- Cost: a reused post shows the cost of the version that posted, with "generated <date>"; it is counted once, on the day it was generated (SH-56).

**Current code vs this rule (from reading the repo 2026-10-08):**

| Vertical | Today | Change needed |
|---|---|---|
| Trial Reels | Missed reels carry over as ideas and re-compete (~2 days); a re-winning idea is produced again for its new slate. | **None** (SH-59). The hub shows earlier unposted versions as history only. |
| Explainers | Approved renders get the next free day up to two weeks out; nothing expires. Newest successful render per topic is the one that posts. | Already reuses content. Approval is per render (`explainers.feedback` keyed by job), so a Hard regenerate needs a fresh approval unless approval is off. |
| Carousels | After the 3 AM run only the best post is scheduled, today's window only; everything else stays in `review`. An unapproved slot that comes due is **cancelled**; the post stays in `review` with no path back. | A story with a finished post keeps it (SH-60): when the story is selected again, the pipeline skips that story and schedules the stored post; a cancelled-unapproved post returns to "Content ready". |
| Stories | A series is built only on its due day and only if its window hasn't ended; a missed window is skipped (risk 6). | None (SH-53). |

## 10. Open items

All design questions are closed. Remaining items are resolved by the builder during the build under the autonomy rules (`BUILD_PLAN.md` §A), recorded in `DECISIONS_LOG.md`:

1. **Meta API metric list** (M0) — builder researches it; fallback in §A.
2. **Stories assimilation (S-30)** — out of this build; decided later with Lucas.
