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
| Explainer Reels | `explainers` | `helios-explainers` | 2:00 idea cycle | TBD (must not overlap the rows above) | 5:15 | publishing not built |
| Carousels | `social` | `helios-social` | 3:00 daily run | 7:00–8:15 AM | 5:30 | publishing not built |
| IG Stories | `ig_story` (proposed) | TBD | 4:00 | TBD | 5:45, plus within the day (story insights expire after 24h) | Lucas, in progress |

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
   Use the due/settle rules in `lib/reels/media-insights/due.ts`.
6. **Media at a signed public URL** in Supabase Storage. Meta fetches the file
   itself, so local paths and session-protected routes don't work.

Versioning: like Trial Reels, there is no "approved version" pointer. The newest
successful render for an idea or story is the one that gets scheduled and
published.

## Shared Instagram account

Every type posts to one IG business account (`META_IG_BUSINESS_ACCOUNT_ID`).
Before creating a container, each publisher reads
`GET /{ig-user-id}/content_publishing_limit` and skips the attempt (logged,
retried on the next pass) when the account is near its 24-hour quota. Posting
windows across types must not overlap: update the table above before adding one.

## Naming

In the `social` (carousel) code, "story" means a **news story** (`story_id`,
`posted_stories`). Use `ig_story` for Instagram Stories so the two never collide.

## Adding a content type

1. Pick the next free hour and a non-overlapping posting window; add a row above.
2. Add the six contract items to the type's schema file (additive, idempotent).
3. Add a systemd unit and deploy it to the social worker VM.
4. Ship with `auto_run` and `publishing_live` off.
