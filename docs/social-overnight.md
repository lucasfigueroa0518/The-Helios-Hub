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
| Explainer Reels | `explainers` | `helios-explainers` | 2:00 idea cycle (only with `auto_render` on; up to `daily_render_cap` = 2 renders) | 1:00–2:30 PM and 3:30–5:00 PM (`posts_per_day` = 2), approved reels only | 5:15 | built; renders need `HEYGEN_API_KEY` on the VM |
| Carousels | `social` | `helios-social` | 3:00 daily run (only with `auto_run` on); the run's top `posts_per_day` = 2 posts are scheduled | 9:00–10:00 AM and 2:30–3:30 PM | 5:30 | built |
| Social Hub | `social_hub` | `helios-social` (same worker) | 5:45 account sweep (account insights, demographics, active times, publishing quota); refreshes the hub queues on visit | none (reads only) | 5:45 | built |
| IG Stories | `stories` | `helios-stories` | 4:00 sets for series with `auto` on (Morning Download daily, Guess the Number Mon/Thu, Free vs. Paid Tue/Sat) | 8:30–10:00 AM, every series; may overlap other types (Stories are not feed posts) | every 2 hours while live, final read at 23 h | built (Lucas); no live set yet |

One type per hour so no two pipelines call Claude, Jev, or Meta at the same
time. All workers run on the social worker VM; outreach stays alone on
`helios-orch-worker`.

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
   Use the due/settle rules in `lib/instagram/insights-rules.ts` (the same as
   `lib/reels/media-insights/due.ts`).
6. **Media at a signed public URL** in Supabase Storage. Meta fetches the file
   itself, so local paths and session-protected routes don't work.

Versioning: like Trial Reels, there is no "approved version" pointer. The newest
successful render for an idea or story is the one that gets scheduled and
published.

## Approval

Nothing posts without a person's approval (Tommy, 2026-10-08). Every
`publishing_live` ships off. Trial Reels posts only from the Approve / Force
buttons while it is off; Explainers schedules only reels with an `approved`
verdict in `explainers.feedback`; Carousels have no approve step yet, so they
never post until the Social Hub review screen exists; IG Stories post only a
set someone approved (Approve / Publish now on `/stories`).

Each type has a `require_approval` setting, on (and treated as on when the row
is missing). With it on, an auto-scheduled Trial Reel or Carousel slot posts
only once a person approves it (`posting_schedule.approved_at`); an unapproved
slot that comes due is cancelled with the reason, never posted late. Explainers
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
`posting_schedule` or `publish_attempts` table.

Every type posts to one IG business account (`META_IG_BUSINESS_ACCOUNT_ID`).
Before creating a container, each publisher reads
`GET /{ig-user-id}/content_publishing_limit` and fails the attempt, with the
quota in its error, when fewer than 5 posts are left in the 24-hour window.

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
