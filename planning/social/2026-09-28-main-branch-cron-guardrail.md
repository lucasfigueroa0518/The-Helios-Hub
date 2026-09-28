# Cron guardrail hotfix packet (for Lucas)

**Status:** ready. Local branch `hotfix/cron-skip-creator-rows` off `feature/helios-social` (NOT `main`, see below). One commit. Unpushed.

## Correction from the original plan

The Phase 1 plan assumed the fix should ship on `main`. It shouldn't — the entire Helios Social feature (`app/api/social/**`, `app/social/**`, `vercel.json` with the cron) is NOT on `main`. That code lives on `feature/helios-social`, and — based on the fact that the production Supabase database is actively being written to by the cron — Vercel's production deployment must be built off `feature/helios-social` (not `main`).

So the hotfix branches off `feature/helios-social` and merges back into `feature/helios-social`. Please confirm with Lucas that this is where Vercel prod deploys from before merging.

## Prod pre-check outcome

Ran earlier by you against `okslkogkokdwylmcsygz`:

- `pipeline_version` column exists (creator-pipeline migration was applied).
- `compose_status` column does NOT exist (compose migration was never applied to prod — the v2 migration on `feature/helios-social-pipeline-v2` is now self-sufficient about this).
- 0 rows currently stamped `pipeline_version = 'creator'`, so no legacy contamination has happened yet.

## The diff (one condition added)

File: `app/api/social/generate/next/route.ts`

```diff
   const { rows } = await dbQuery<{ id: string; source: string; headline: string }>(
     `WITH candidate AS (
        SELECT id
          FROM helios_social.article_queue
         WHERE ingest_status = 'approved_for_draft'
           AND copy_json IS NULL
+          AND (pipeline_version IS NULL OR pipeline_version <> 'creator')
           AND (generation_started_at IS NULL
                OR generation_started_at < now() - interval '15 minutes')
```

Legacy rows still qualify as before (their `pipeline_version` is `NULL` or `'legacy'`). Creator-stamped rows get skipped so the legacy pipeline can't overwrite the creator run's output.

## Suggested PR description (paste into GitHub)

**Title:** `fix(social-cron): skip creator-pipeline rows in the drafting cron predicate`

**Body:**

```
The /api/social/generate/next cron picks the oldest approved-for-draft
article with copy_json IS NULL and runs the legacy pipeline on it. Once
rows start getting stamped pipeline_version = 'creator' (via the coming
feature/helios-social-pipeline-v2 branch), the legacy cron would happily
pick them up too and overwrite what the creator pipeline is supposed to
produce.

## What this changes

One-condition predicate change on the cron's SELECT:

    AND (pipeline_version IS NULL OR pipeline_version <> 'creator')

Legacy rows (pipeline_version NULL or 'legacy') behave exactly as before.
Creator rows are handled by the v2 branch's own routing.

## Prod pre-check

Confirmed the pipeline_version column already exists in prod (added by
db/helios_social_creator_pipeline_migration.sql). Zero rows currently
stamped 'creator', so this change is a no-op on today's data — it starts
mattering the moment the acceptance test flips one row to 'creator'.

## Deploy sequence

1. Merge this PR.
2. Vercel builds + deploys off feature/helios-social (production branch).
3. The next cron tick uses the new predicate.

Rollback: revert this commit. Nothing else moves.
```

## Deploy sequence for Lucas

1. Pull this branch or apply the one-condition diff to a fresh branch off `feature/helios-social`.
2. Push, open PR, merge to `feature/helios-social`.
3. Vercel redeploys automatically off that branch.
4. Verify from a Vercel log tail: the next cron tick's SQL now contains the added condition, and rows still drain out of the queue at the same rate.

## Notes

- I did NOT push this branch. It's local at `dbfd151` on `hotfix/cron-skip-creator-rows`.
- The v2 branch's `generate/next/route.ts` uses a bigger legacy-vs-creator predicate. That version will replace this hotfix's version when v2 lands — the hotfix is temporary insurance for the window between "creator rows exist in prod" and "v2 code is deployed."
- Rollback: `git revert dbfd151`.
