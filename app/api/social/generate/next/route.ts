import { NextResponse } from 'next/server';

import { dbQuery } from '@/lib/db';
import { generatePostForArticle } from '@/lib/social/pipeline/generate';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Cron target — picks the oldest article that has cleared relevance
 * (`ingest_status = 'approved_for_draft'`) but doesn't yet have a
 * generated post (`copy_json IS NULL`), and runs the full pipeline. One
 * article per tick keeps us safely inside Vercel's 300s function budget.
 *
 * Scheduled by `vercel.ts` — typically every 15 minutes so a 15-article
 * batch is fully drafted within a few hours of ingest.
 *
 * Auth: Vercel cron adds the `CRON_SECRET` bearer token (or the
 * `x-vercel-cron` signal on cron.vercel.app). Manual hits are rejected.
 */
export async function GET(req: Request): Promise<Response> {
  if (!isAuthorizedCronCall(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Concurrency-safety: mark the row as "in progress" before running the
  // pipeline. If a second cron tick fires while the first is still
  // working, the second one will skip this row. The mark auto-expires
  // (`generation_started_at < now() - interval '15 minutes'`) so a crashed
  // job doesn't wedge the article forever.
  const { rows } = await dbQuery<{ id: string; source: string; headline: string }>(
    `WITH candidate AS (
       SELECT id
         FROM helios_social.article_queue
        WHERE ingest_status = 'approved_for_draft'
          AND copy_json IS NULL
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

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ processed: false, reason: 'no pending articles' });
  }

  try {
    const result = await generatePostForArticle(row.id, { force: false });
    // Clear the lock either way — pipeline completed (success or failure).
    await dbQuery(
      `UPDATE helios_social.article_queue SET generation_started_at = NULL WHERE id = $1`,
      [row.id],
    );

    if (!result.ok) {
      return NextResponse.json({
        processed: true,
        ok: false,
        article_id: row.id,
        headline: row.headline,
        code: result.code,
        message: result.message,
      });
    }

    return NextResponse.json({
      processed: true,
      ok: true,
      article_id: row.id,
      headline: row.headline,
      slug: result.slug,
      cost_usd: result.cost_usd,
      stages_run: result.stages_run,
      preview_url: result.preview_url,
    });
  } catch (err) {
    // Clear the lock so the next tick can retry.
    await dbQuery(
      `UPDATE helios_social.article_queue SET generation_started_at = NULL WHERE id = $1`,
      [row.id],
    );
    return NextResponse.json({
      processed: true,
      ok: false,
      article_id: row.id,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

function isAuthorizedCronCall(req: Request): boolean {
  // Vercel cron signal — present on Vercel infrastructure.
  const cronHeader = req.headers.get('x-vercel-cron');
  if (cronHeader) return true;

  // Bearer token for local / manual cron triggers.
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}
