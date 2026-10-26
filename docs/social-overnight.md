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
| Carousels | `social` | `helios-social` | 3:00 daily run (only with `auto_run` on; not on Last Few Days days while its `auto_run` is on, LFD-02; see the template-mode paragraph below); the run's top `posts_per_day` = 2 posts, less what people placed for the day, are scheduled (see Daily fill) | 9:00–10:00 AM and 2:30–3:30 PM (none on Last Few Days days while its `auto_run` is on) | 5:30 | built |
| Last Few Days | `lfd` | `helios-social` (the same process as Carousels; no unit of its own) | 3:00 on its days (`lfd.settings.days`, Tue/Fri), only with `lfd.settings.auto_run` on, in the carousel run's place; a manual run from the hub's "Make Last Few Days now" on any day | 9:00–10:00 AM on its days | read with Carousels: every 30 minutes while fresh and the 5:30 sweep | built |
| AI Events This Week | `ai_events` | `helios-social` (the same process; no unit of its own) | 12:00 PM on its days (`ai_events.settings.days`, Sunday), only with `ai_events.settings.auto_run` on: ranks the coming week's events (Jev `event-pick@1`, capped at `run_cap_usd`) and renders a ranked carousel each for Miami and Boston; a manual run from the hub's Generate or Rebuild post on any day | Sunday: Miami 6:00–7:00 PM, Boston 7:00–8:00 PM | read with Carousels: every 30 minutes while fresh and the 5:30 sweep | built |
| Social Hub | `social_hub` | `helios-social` (same worker) | 5:45 account sweep (account insights, demographics, active times, publishing quota); refreshes the hub queues on visit | none (reads only) | 5:45 | built |
| IG Stories | `stories` | `helios-stories` | 4:00 sets for series with `auto` on (Morning Download daily, Guess the Number Mon/Thu, Free vs. Paid Tue/Sat) | 8:30–10:00 AM, every series; may overlap other types (Stories are not feed posts) | every 2 hours while live, final read at 23 h | built (Lucas); no live set yet |

Last Few Days (spec `docs/superpowers/specs/2026-10-13-last-few-days-design.md`) runs inside the `helios-social` worker
instead of a systemd unit of its own (step 3 of "Adding a content type" does not apply): one process carries out one run at a
time, so its 3:00 run can never overlap a carousel run, and "one type per hour" holds because it takes the carousel run's
slot on its days. Engine `lib/lfd`, schema `lfd`; its posts are spine items (`vertical 'last_few_days'`). A human-only CLI
run stays available (`npx tsx scripts/lfd_run.ts --live`, Tommy).

AI Events This Week (`planning/AI Events/DECISIONS.md`) also runs inside `helios-social`. Its clock is 12:00 PM, after the
networking ingest's 9:00 AM Sunday refresh on `helios-orch-worker` and hours from every other run, so "one type per hour"
holds; its runs are claimed after Last Few Days' in the same loop, under the same 30-minute timeout. Engine `lib/ai-events`,
schema `ai_events`; its posts are spine items (`vertical 'ai_events'`). A run ranks the coming Monday to Sunday per city
(the weekly pool, `ai_events.pool`; events already scored are never asked again, AE-05), renders one ranked post per
city for Miami and Boston (cover, #2 to #4, the locked #1 tease, the closing slide; AE-29) with a drawn look, books Miami
in the Sunday 6:00–7:00 PM window and Boston in 7:00–8:00 PM only while `publishing_live` is on, and republishes the public
calendar snapshot. It makes no Claude calls. A Rebuild post run re-renders both from the cached scores and keeps their
looks. A slot more than 60 minutes late is cancelled, never posted late. The human one-shot is
`npx tsx scripts/ai_events_once.ts` (it carries out a run queued from the hub; Lucas only).

While `social_hub.settings.slot_source` is `template`, each run fills that date's calendar slots instead of `posts_per_day`, Last Few Days runs on dates with an LFD slot, and Stories series post on dates with their slot. `legacy` is the old behavior. In template mode a day with an LFD slot never runs Carousels, even with Last Few Days paused: the 3 AM run queues nothing and logs why.

One type per hour so no two pipelines call Claude, Jev, or Meta at the same
time. All workers run on the social worker VM; outreach stays alone on
`helios-orch-worker`.

## Daily fill (D54, D55)

When a type is on, its night run fills that New York day's quota: Trial
Reels 3 (`PASSING_REELS_PER_NIGHT`), Explainers and Carousels their
`posts_per_day`, IG Stories one set per series on each day it runs.
In template mode the quota is that day's calendar slots instead of `posts_per_day`.
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
| Last Few Days | One post on each of its days. A post a person placed for that day means the 3:00 run is skipped (`stop_reason` `quota-filled: …`). A manual run from the hub is never skipped. |
| AI Events This Week | Two posts a week, Miami and Boston. The Sunday 12:00 run makes only the cities with no post yet; when both have one (a person ran Generate before noon) it is skipped (`stop_reason` `post-exists: …`); Rebuild post re-renders them instead. |
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

## Template mode: times and caps (D59)

With `slot_source = 'template'` each calendar slot is a start minute (8 AM to
9 PM, 15-minute grid). The night run books the post at a random minute in
`[slot, slot+15]` (retries may run to slot+60, never past the day) and keeps the
30-minute feed gap for Main reels, Carousels and Last Few Days; Stories and
Trial reels are exempt. Defaults: Text on Screen 8:45 AM, 11:15 AM, 6 PM;
Explainers 1 PM, 3:30 PM; Carousels 9 AM, 2:30 PM; Last Few Days 9 AM Tue/Fri;
Stories 8:30 AM.

Daily caps (`social_hub.settings` `daily_caps`): Text on Screen 5, Explainers 3,
Carousels 3, Last Few Days 1, Stories 2 per series. A day with more slots than
the cap makes posts for the first `cap` slots by time; the rest stay empty and
the board says "Over today's limit, so nothing is made for this slot." Stories
run once per slot: two sets of one series on a day are two slots, and the
second set skips items the first used. A booked slot that was moved keeps its
post; it never posts twice. Check with
`BEGIN READ ONLY; SELECT value FROM social_hub.settings WHERE key IN ('slot_source','daily_caps'); ROLLBACK;`.
`legacy` mode is unchanged.

### Type schedules and batch select (D60)

Two tools, kept apart. **Schedules** (Calendar header) sets one type's standing
routine: one list of start times plus Mon-Sun days, Trial/Main per time for
Text on Screen and Explainers only, Last Few Days one time, each Stories series
its own entry. It writes `slot_template` and replaces the Standard week tab.
The save is refused if the list is longer than the type's daily cap or repeats
a time; a time near another Main-feed type's only warns. **The board** only
edits single dates, and gained **Select**: Set time (exact minute), Trial/Main
(reels only), Remove (one question for booked posts). Over 20 changes are split
into several saves; one batch is one undo step.

System bookings follow a schedule change; person-set ones stay. A schedule
save moves the posts the system booked on later days (old and new times pair
in time order) or sends them back to Ready to place when their time or day
goes away. Stories sets move through the Stories reschedule path. Started
slots today and published posts are never touched.

Set-by marks: `slot_override.set_by`, `schedule.slot_by`, `stories.sets.slot_by`,
each `person` or `system`. A board edit, batch edit, placement, reschedule or
drag is `person`. System pins and the overnight run's own bookings are
`system`; a click-made Stories set (Generate) is `system` too. A `person` post
is never moved or removed by a schedule save, and the routine slot it replaced
does not come back at its new time on that date. A new Last Few Days day skips
a date that holds a person's Carousel. Rows without a mark count as `system`.
Both tools are read-only in `legacy`.

### Go-live order (D59)

Do these in order. Each step is safe to stop after: until step 4 everything
runs in `legacy` mode.

1. **Apply both schema files:** `node scripts/apply_social_hub_schema.js --apply`
   and `node scripts/apply_stories_schema.js`. Both are idempotent and safe
   for the code that is deployed now. `stories_schema.sql` adds
   `stories.sets.slot_minute` and the per-slot index
   `uq_stories_sets_live_slot`, and it **keeps** the one-a-day index
   `uq_stories_sets_live_day`. The deployed Stories code inserts with
   `ON CONFLICT (series, ny_date)`, and Postgres refuses that insert (42P10)
   if no index on exactly `(series, ny_date)` exists. Check read-only:
   `psql "$DATABASE_URL" -X -c "BEGIN READ ONLY; SELECT indexname FROM pg_indexes WHERE schemaname = 'stories' AND indexname LIKE 'uq_stories_sets_live_%'; SELECT value FROM social_hub.settings WHERE key IN ('slot_source','daily_caps'); ROLLBACK;"`
   lists both indexes, `"legacy"` and the caps. The apply also adds
   `slot_override.set_by`, `schedule.slot_by` and `stories.sets.slot_by` (D60).
   Apply before redeploying the social worker: a worker started earlier caches
   "no column" until it restarts.
2. **Deploy the social worker and the hub:** `./scripts/gcp/deploy-social-worker.sh`,
   and the hub deploy that serves `/api/stories/*` and the Calendar. Both now
   run the free-time-slot code, which works with or without the one-a-day index.
3. **Run stories_multi_slot:** `node scripts/apply_stories_multi_slot.js` prints
   what it would do; `node scripts/apply_stories_multi_slot.js --apply` runs
   `db/stories_multi_slot.sql`. It drops only `uq_stories_sets_live_day`, so a
   series can have one set per slot. Run it only after step 2: any Stories code
   from before the redesign that still runs would fail every request once the
   index is gone. It is idempotent, and a later `stories_schema.sql` apply does
   not bring the index back. Until this step a second set of a series on one
   day is refused (the first set comes back), which is harmless in `legacy`.
   Check read-only: the query in step 1 lists only `uq_stories_sets_live_slot`.
4. **Switch on** from the Calendar (`slot_source = 'template'`).

## Naming

In the `social` (carousel) code, "story" means a **news story** (`story_id`,
`posted_stories`). Instagram Stories live in the `stories` schema and
`lib/stories`; say "IG Stories" in prose when the two could be confused.

## Adding a content type

1. Pick the next free hour and a posting window; add a row above. Schedule through the shared 30-minute feed spacing.
2. Add the six contract items to the type's schema file (additive, idempotent).
3. Add a systemd unit and deploy it to the social worker VM.
4. Ship with `auto_run` and `publishing_live` off.
