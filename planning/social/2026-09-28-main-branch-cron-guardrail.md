# Main-branch cron guardrail hotfix

**Owner:** you. I prepared this file; I do NOT push, deploy, or run the SQL.

## Why

`vercel.json` schedules `GET /api/social/generate/next` every 15 minutes on production. The deployed code on `main` doesn't know about `pipeline_version` or `useCreatorPipeline` — those live on `feature/helios-social` (unmerged). Once we start stamping rows `pipeline_version = 'creator'` (via env var during acceptance testing), the deployed cron would happily pick them up and run **legacy** stages on rows we intended to run creator on. Wasted cost, wrong output stamped into `copy_json`.

The two-line predicate change below teaches the deployed cron to skip creator rows.

## Two pre-checks (run against production Supabase yourself)

Run these before deciding whether to apply the hotfix as-is or to run the additive migration first.

### Pre-check A — is `pipeline_version` column present in prod?

```sql
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_schema = 'helios_social'
   AND table_name   = 'article_queue'
   AND column_name  = 'pipeline_version';
```

- If one row returns → column exists, apply the hotfix as-is.
- If zero rows return → column doesn't exist yet. The hotfix predicate would fail. Run `db/helios_social_creator_pipeline_migration.sql` on prod first (it's idempotent, additive, safe), then apply the hotfix.

### Pre-check B — anything already stamped `creator` in prod?

```sql
SELECT id,
       source,
       headline,
       pipeline_version,
       copy_json IS NOT NULL AS has_copy,
       render_post_json IS NOT NULL AS has_render
  FROM helios_social.article_queue
 WHERE pipeline_version = 'creator'
 ORDER BY added_at DESC
 LIMIT 20;
```

- Zero rows → nothing to worry about. Apply the hotfix and proceed with acceptance.
- Some rows → the current deployed cron may have already processed some of them through legacy stages. If any have `has_copy = true`, tell me and we'll decide whether to null out their `copy_json` so the creator run has a clean slate.

## The hotfix diff (against `main`)

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
         ORDER BY added_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      UPDATE helios_social.article_queue AS q
         SET generation_started_at = now()
        FROM candidate
       WHERE q.id = candidate.id
      RETURNING q.id, q.source, q.headline`,
   );
```

One added condition. Preserves behavior for every row that isn't stamped `pipeline_version = 'creator'`. Any legacy row still gets picked up exactly as before.

## Suggested deploy

1. Run pre-check A. If column exists, skip step 2.
2. Only if pre-check A returned zero rows: apply `db/helios_social_creator_pipeline_migration.sql` to prod (`npm run db:helios-social:creator-pipeline-migration` with `.env.local` pointing at prod).
3. Run pre-check B and share the result with me if any rows come back.
4. Create a branch off `main`: `git checkout main && git pull && git checkout -b hotfix/cron-skip-creator-rows`.
5. Apply the diff above, commit, push, open PR against `main`, merge, deploy.
6. Verify by tailing Vercel logs — the next cron tick should still pick up legacy rows without incident.

After this hotfix is deployed, the acceptance test in the Phase 1 plan is safe to run: any Bloomberg row I stamp `creator` in prod will be skipped by the deployed cron, so only your local `next dev` (which runs the on-branch creator code) can process it.

## Rollback

Revert the PR. The predicate returns to the pre-hotfix form. Nothing else changes.
