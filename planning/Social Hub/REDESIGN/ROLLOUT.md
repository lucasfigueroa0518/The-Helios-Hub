# Social Hub redesign: rollout

Everything below is built and tested locally on `unify-social-hub`, **uncommitted, unpushed, undeployed**. Each production step waits for Tommy's OK. Run them in this order; each one is safe to stop after.

## 0. Commit (local only)

Nothing is committed yet. Not pushed, not merged to `main` (the hub goes live on Vercel only when the branch merges).

## 1. Schemas (shared database)

Both are additive and safe to re-run.

| Step | Command | Adds |
|---|---|---|
| 1a | `node scripts/apply_social_schema.js` | `social.rerun_requests` (the Carousels "Regenerate" queue, D51). Re-applying keeps every CHECK list whole (D45). |
| 1b | `node scripts/apply_media_library_schema.js --apply` | `media_library.*`: the photo bank (D49). Starts with `capture = false` and `finder_source = "off"`, so nothing changes until step 4. |

Check: the Content page's Photo bank row stops saying "not set up yet" (it will read 0 photos).

## 2. Social worker redeploy (all four units)

`./scripts/gcp/deploy-social-worker.sh`

It ships the daily fill rule (D54, D55), the Carousels rerun claim (D51), the shared `bookSlot` (D50) and the photo-bank hooks, with capture still off.

When: outside every posting window and night run. **10:15–11:00 AM ET** is the clean gap: after the morning windows, before Trial Reels midday at 11:15.

Check the morning after: each worker's log has a `fill_reduced` line only when a person placed something; with nothing placed, every type made what it made before.

## 3. Turn the hub's actions on, one type at a time

Flags are constants in `lib/social-hub/flags.ts` (all `false` today), so each one is a code change plus an app deploy. Tommy makes the first real click on each one.

| Order | Flag | Why this order |
|---|---|---|
| 1 | `approveCarousel` | Carousels have no approval page outside the hub, so today a Carousel waiting for approval can't be approved anywhere and is cancelled at its slot. |
| 2 | `approveTrialReel` | Approving slots from the hub instead of `/reels`. |
| 3 | `reject` | Pairs with approval; releases the slot (Explainers rejects keep their tags). |
| 4 | `reschedule` | "Schedule…" / "Move…" and the calendar's "Schedule something here". Counts toward the day's quota (D54). |
| 5 | `hardRegenerate` | Spends money. The confirm shows the typical cost and today's cap. |
| 6 | `hardPublish` | Posts immediately, skipping the slot. |

## 4. Photo bank capture, then backfill

| Step | Command |
|---|---|
| 4a | Turn capture on: `UPDATE media_library.settings SET value = 'true'::jsonb, updated_at = now() WHERE key = 'capture';` Let one night run. |
| 4b | Backfill plan (no fetches, no writes): `npx tsx scripts/photo_bank_backfill.ts --dry-run` |
| 4c | Backfill, a slice at a time (Commons and Openverse only, no paid APIs): `npx tsx scripts/photo_bank_backfill.ts --apply --limit 200` |
| 4d | Later, once the bank has depth: `UPDATE media_library.settings SET value = '"compete"'::jsonb, updated_at = now() WHERE key = 'finder_source';` (the bank competes with online search; `"first"` makes it the first source). |

Tell Lucas before 4a: `lib/stories/photos.ts` (his module) now offers vetted photos to the bank.

## Decisions to confirm (from the fill-rule build, D54/D55)

1. **Explainers:** only person-placed slots reduce the night's renders. Approved renders that the scheduler booked itself (`source = 'auto'`) don't.
2. **Explainers while publishing is off:** approved renders that rank high keep filling the quota, so no new renders are made until those post. That is the "allocate, don't regenerate" rule, but it may surprise Lucas while he reviews.
3. **Carousels:** a fully placed day skips the 3:00 AM run entirely, so there's no fresh shortlist that day. The Morning Download reads the last 30 hours of runs, so it still has yesterday's.
4. **Trial Reels reuse (D55):** a reused video has no copy row on today's slate, so `/reels` may show it without copy. That page wasn't changed.

## After rollout

- Re-run `/impeccable critique` on the live pages (the snapshots so far are on the fixture preview).
- Critique trend on the fixture preview: 19 → 28 → 28 (`.impeccable/critique/`). The third round's findings are fixed in R4 (REVISIONS.md §R3) and haven't been re-scored yet.
