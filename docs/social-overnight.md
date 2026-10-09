# Social overnight: one clock, one contract

Every Helios Social content type generates, schedules, publishes, and reads its
own Instagram insights overnight, on its own. The types stay siloed (each owns
its schema and tables), but each one meets the contract below so the Social
main page can read them side by side later. Trial Reels is the reference
implementation: copy its shapes, not its code paths.

All times are America/New_York (DST-safe, see `lib/reels/schedule.ts`).

## The clock

| Content type | Schema | systemd unit | Run | Posting window(s) | Insights sweep | Status |
|---|---|---|---|---|---|---|
| Trial Reels | `reels` | `helios-reels` | 12:30 song ingest, 1:00 night run | 8:45–10:00 AM, 11:15 AM–12:30 PM, 6:00–9:00 PM | 5:00 | live |
| Explainer Reels | `explainers` | `helios-explainers` | 2:00 idea cycle (only with `auto_render` on; `posts_per_day` less what people placed, up to `daily_render_cap` = 2 renders; see Daily fill) | 1:00–2:30 PM and 3:30–5:00 PM (`posts_per_day` = 2), approved reels only | 5:15 | built; renders need `HEYGEN_API_KEY` on the VM |
| Carousels | `social` | `helios-social` | 3:00 daily run (only with `auto_run` on); the run's top `posts_per_day` = 2 posts, less what people placed for the day, are scheduled (see Daily fill) | 9:00–10:00 AM and 2:30–3:30 PM | 5:30 | built |
| Social Hub | `social_hub` | `helios-social` (same worker) | 5:45 account sweep (account insights, demographics, active times, publishing quota); refreshes the hub queues on visit | none (reads only) | 5:45 | built |
| IG Stories | `stories` | `helios-stories` | 4:00 sets for series with `auto` on (Morning Download daily, Guess the Number Mon/Thu, Free vs. Paid Tue/Sat) | 8:30–10:00 AM, every series; may overlap other types (Stories are not feed posts) | every 2 hours while live, final read at 23 h | built (Lucas); no live set yet |

One type per hour so no two pipelines call Claude, Jev, or Meta at the same
time. All workers run on the social worker VM; outreach stays alone on
`helios-orch-worker`.

## Daily fill (D54, D55)

When a type is on, its night run fills that New York day's quota: Trial
Reels 3 (`PASSING_REELS_PER_NIGHT`), Explainers and Carousels their
`posts_per_day`, IG Stories one set per series on each day it runs.
Whatever a person placed for that day counts toward the quota: a
`social_hub.schedule` row with `source = 'user'` that is scheduled, posting
or posted, for that type and `ny_date` (`lib/social-hub/fill.ts`
`userPlaced`). Cancelled and failed slots, other days and other types don't
count. The night makes only `quota − placed` (never negative). Zero means it
makes nothing new and logs why; each worker logs
`fill_reduced { vertical, nyDate, quota, userPlaced, making }` whenever
placements cut the count.

| Type | What the night does with what's left |
|---|---|
| Trial Reels | `quota − placed` reels, one per window still open. An idea a person placed isn't made again. A **carryover idea whose finished video never posted** (not rejected, never tried on Instagram) ranks with the rest; when it comes up for a slot it takes it with that video, with no new copy or render (D55). With nothing left the run still ingests and scores, so ideas carry to tomorrow. |
| Explainers | Pool topics and topics with an approved (or, with `require_approval` off, unreviewed), unposted render rank together (pool order). The top `quota − placed` are taken: a render is placed (`scheduleJob`, while publishing is live) instead of rendered again; a pool topic is rendered, at most `daily_render_cap`, under the spend caps. Nothing left: the cycle is skipped before any idea call. |
| Carousels | The 3 AM run makes `min(run_stories, quota − placed)` stories and schedules at most that many (`scheduleRunPosts`). A stored finished post that ranks in ships without spend (D37). A story whose post already holds a slot is passed over. Nothing left: the run is `skipped` (`stop_reason` `quota-filled`) and makes nothing. |
| IG Stories | A series' day that a person filled (a set they generated that is approved, scheduled or posted for that day, or their slot for it on the spine) gets no auto set. |

## The contract

Each content type has, in its own schema:

1. **`runs`**: `status` in `requested | running | ok | partial | failed | skipped`,
   with the two single-row unique indexes from `reels.runs` (at most one running,
   at most one queued). The app queues a run by inserting `requested`; only the
   worker executes it.
2. **`settings`** (key/value): `auto_run` and `publishing_live`, both default
   off for a new type. Turning either on is a human decision.
3. **`posting_schedule`**: copy of `reels.posting_schedule` (`ny_date`, `slot`,
   `publish_at`, `status scheduled|publishing|published|cancelled|failed`,
   `source auto|user`, `publish_attempt_id`) with the same unique indexes.
4. **`publish_attempts`**: one row per try, holding `media_id`, `permalink`,
   `status_log`, `error`, `insights_checked_at`, `insights_settled_at`.
5. **`media_insights`**: keyed `(media_id, ny_date)`, metric columns plus `raw`.
   Use the due/settle rules in `lib/instagram/insights-rules.ts`.

**The lifecycle spine (D36).** Items 3–5 are moving out of each type's schema
into one shared set of tables in `social_hub`: `content_items` (the stable
identity of each postable unit), `approvals` (one decision per item),
`schedule`, `publish_attempts` and `media_insights`, each with a `vertical`
column. Types join one at a time (expand → backfill → switch → contract;
`scripts/backfill_spine.ts`). **Carousels, Explainers and Trial Reels have
joined**: their slots, attempts, approvals and insights live on the spine, and
their old `posting_schedule`, `publish_attempts` and `media_insights` tables
are frozen history, read only by the backfill until they are dropped.
Explainers keep their review verdict (with its tags) in `explainers.feedback`;
saving it mirrors the decision onto the item's spine approval. A Trial Reels
item is the video; its slot belongs to the post idea (`schedule.idea_ref`) and
is booked before any video exists, so the slot carries its own approval
(`schedule.approved_at`) until the video is attached and the approval moves to
the item. Reels readers use the shapes in `lib/reels/spine-tables.ts`;
`reels.published_status` stays where it is. A new type joins the spine
instead of adding items 3–5 to its own schema.
6. **Media at a signed public URL** in Supabase Storage. Meta fetches the file
   itself, so local paths and session-protected routes don't work.

Versioning: like Trial Reels, there is no "approved version" pointer. The newest
successful render for an idea or story is the one that gets scheduled and
published. Carousels keep that content with its news story (SH-60): when the
3 AM run selects a story whose newest post is finished and in review, it
skips the story's stages (no spend) and ships the stored post at the story's
rank (`social.runs.ship_post_ids`).

One-story reruns (Social Hub Regenerate, D51) follow the same contract: the
app inserts a `requested` row in `social.rerun_requests`; only the
`helios-social` worker runs it, after any queued nightly run, by opening its
own `social.runs` row (so it is capped by `run_cap_usd` and never takes the
nightly run's queued place). It remakes the story from the post's saved brief
(Writer onward); the new post waits in review and is not auto-scheduled.
Trial Reels' Regenerate rebuilds only today's video for an idea (D52).

## Approval

Nothing posts without a person's approval (Tommy, 2026-10-08). Every
`publishing_live` ships off. Trial Reels posts only from the Approve / Force
buttons while it is off; Explainers schedules only reels with an `approved`
verdict in `explainers.feedback`; Carousels are approved in the Social Hub
(a slot the run placed, or a carousel in review, which approving places in
the earliest open window); IG Stories post only a set someone approved
(Approve / Publish now on `/stories`).

Each type has a `require_approval` setting, on (and treated as on when the row
is missing). With it on, an auto-scheduled Trial Reel or Carousel slot posts
only once a person approves it (Trial Reels: the slot's
`social_hub.schedule.approved_at`, carried to the video's item when it posts;
Carousels: the item's `social_hub.approvals` row, so approved content stays
approved wherever it is placed); an unapproved slot that comes due is
cancelled with the reason, never posted late. A rejected item never posts. Explainers
need the `approved` verdict; Stories never auto-approve a set. Tommy turns
these off himself.

Shared code lives in `lib/instagram/` (clock, posting windows, the Graph
transport and container calls, insights client and rules) and
`lib/media-bucket.ts` (private Supabase buckets). Trial Reels, Carousels and
Explainers all post through the same Graph transport; each keeps only its own
container payload, pinned by `tests/instagram-payloads.test.ts`. IG Stories
still carry their own copies until they join (unification plan, Stories wave).

## Shared Instagram account

Stories differ from the contract in shape, not in substance: `stories.sets`
is both the run queue and the schedule (`publish_at`, status `scheduled`), and
each frame carries its own `ig_media_id`; there is no separate
`posting_schedule` or `publish_attempts` table. **On the spine as a
projection (D44):** `stories.sets` stays the Stories app's source of truth,
and every transition re-projects the set onto `social_hub` (`lib/stories/spine.ts`):
item, approval, a slot named for the series, one attempt per publish (frames
as child containers, `partial` when it stopped with frames live) and
per-frame insights. Stories post through the account gate (room for every
frame above the reserve), wait while another type is mid-publish, and use
the shared Graph transport. They keep their own clock and worker (a set
posts at its own minute, never late), so the publisher doesn't drive them.

Every type posts to one IG business account (`META_IG_BUSINESS_ACCOUNT_ID`).
Before creating a container, every post goes through the **account gate**
(`lib/instagram/account-gate.ts`): it reads
`GET /{ig-user-id}/content_publishing_limit`, records the reading in
`social_hub.publishing_quota`, and fails the attempt, with the quota in its
error, when fewer than `quota_reserve` posts are left (an account setting in
`social_hub.settings`, default 5; a Story set needs one more per extra frame).

### The single publisher (D40)

Each type places its own content on the calendar (Carousels after the 3 AM
run, Explainers as reels are approved, Trial Reels nightly). The
`helios-publisher` unit (`scripts/publisher_worker.ts`, drivers in
`lib/publishing/drivers/`) does the rest for every type on the spine:
releases due slots under each type's own rules, carries **one post at a time
across the whole account**, oldest first, through the gate, and reads
insights every 30 minutes. Trial Reels are always driven: their `publishing_live`
only switches the nightly auto-schedule, and a person's Approve or Force post
goes out while it is off. Trial Reels now pass the same quota gate as every
other type (D33/D40: quota yes, feed spacing no). `social_hub.settings`
`publisher_mode` decides who posts:

| Mode | Publisher | Type workers |
|---|---|---|
| `off` (default) | idle | release, post and read insights, as before |
| `shadow` | logs `shadow_plan`: what it would release, cancel and post | still post |
| `live` | releases, posts, reads insights; writes `publisher_heartbeat` listing the types it drives | stand down from those steps while the heartbeat (< 5 min old) lists their type; they still schedule, and resume on their own if the publisher goes quiet |

Going live: enable the unit (`sudo systemctl enable --now helios-publisher`),
set `shadow` for a day and compare its `shadow_plan` lines with the type
workers' `schedule_due` / `publish_complete` lines, then set `live`. Each
type's own `publishing_live` still decides whether that type posts at all.
Running both at once is safe: every release and claim is a guarded UPDATE and
a post publishes only once.

Posting windows may overlap (SH-47). The Carousel and Explainer schedulers
keep any two **feed** posts at least 30 minutes apart
(`lib/instagram/feed-spacing.ts`, `lib/instagram/window.ts`
`FEED_GAP_MINUTES`). Stories are not feed posts and are exempt. Trial Reels
are exempt too (D33): trial reels reach non-followers, not the follower feed,
so they keep their own slots exactly as before and other types don't space
around them. Update the table above when adding a window.

## Naming

In the `social` (carousel) code, "story" means a **news story** (`story_id`,
`posted_stories`). Instagram Stories live in the `stories` schema and
`lib/stories`; say "IG Stories" in prose when the two could be confused.

## Adding a content type

1. Pick the next free hour and a posting window; add a row above. Schedule through the shared 30-minute feed spacing.
2. Add the six contract items to the type's schema file (additive, idempotent).
3. Add a systemd unit and deploy it to the social worker VM.
4. Ship with `auto_run` and `publishing_live` off.
