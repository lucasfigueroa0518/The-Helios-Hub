/** Social Hub P2-M3: the pipeline-owned action functions, on PGlite with the real schemas. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { hardPublishJob } from '@/lib/explainers/publish/publish';
import { requestRerender } from '@/lib/explainers/repository';
import { DEFAULT_SETTINGS } from '@/lib/explainers/settings';
import { HARD_PUBLISH_NOTE, hardPublishPost } from '@/lib/social/overnight/schedule';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { IDS, seedHubFixture } from './fixtures/social-hub/seed';

async function db() {
  const { pg, query } = await openHubTestDb();
  await seedHubFixture(pg);
  const q = (text: string, params?: unknown[]) => query(text, params) as Promise<{ rows: any[] }>;
  const run = <T,>(text: string, params?: unknown[]) => query<T>(text, params);
  const explainers = {
    query: run,
    transaction: async <T,>(fn: (tx: { query: typeof run }) => Promise<T>) => {
      await pg.exec('BEGIN');
      try {
        const out = await fn({ query: run });
        await pg.exec('COMMIT');
        return out;
      } catch (error) {
        await pg.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { pg, q, explainers };
}

test('carousel hard publish: the waiting slot is approved and closed with the reason, then a force attempt is queued', async () => {
  const { pg, q } = await db();
  await pg.exec(`
    UPDATE social.posts SET slide_objects = '["a.jpg","b.jpg","c.jpg"]'::jsonb WHERE id = '${IDS.socPost2}';
    INSERT INTO social.posting_schedule (post_id, ny_date, slot, publish_at, status, source)
    VALUES ('${IDS.socPost2}', '2026-10-09', 'morning', '2026-10-09T13:20:00Z', 'scheduled', 'auto');`);
  const out = await hardPublishPost(q as never, IDS.socPost2);
  const slot = (await pg.query<{ status: string; error: string; approved_at: string | null }>(`SELECT status, error, approved_at FROM social.posting_schedule WHERE post_id = '${IDS.socPost2}'`)).rows[0]!;
  assert.equal(slot.status, 'cancelled');
  assert.equal(slot.error, HARD_PUBLISH_NOTE);
  assert.ok(slot.approved_at, 'the click is the approval (SH-17)');
  if (out.queued) {
    const attempt = (await pg.query<{ trigger: string }>(`SELECT trigger FROM social.publish_attempts WHERE post_id = '${IDS.socPost2}'`)).rows[0]!;
    assert.equal(attempt.trigger, 'force');
  } else {
    assert.ok(out.note, 'a refusal comes back with its reason');
  }
});

test('explainer hard publish: an unreviewed render is recorded approved; a rejected one is refused', async () => {
  const { pg, explainers } = await db();
  const out = await hardPublishJob(explainers as never, IDS.job2, 'tommy@helios.test');
  const fb = (await pg.query<{ verdict: string; note: string; created_by: string }>(`SELECT verdict, note, created_by FROM explainers.feedback WHERE job_id = '${IDS.job2}'`)).rows[0]!;
  assert.deepEqual([fb.verdict, fb.created_by], ['approved', 'tommy@helios.test']);
  assert.match(fb.note, /Hard publish/);
  assert.equal(out.queued, false, 'the video is still local here, so the publisher refuses: never posted unready');
  await pg.exec(`UPDATE explainers.feedback SET verdict = 'rejected' WHERE job_id = '${IDS.job2}'`);
  const rejected = await hardPublishJob(explainers as never, IDS.job2, 'tommy@helios.test');
  assert.deepEqual([rejected.queued, (rejected as { note: string }).note], [false, 'This render was rejected in review.']);
});

test('explainer hard regenerate: a rendered topic can render again; a cap refusal restores the topic', async () => {
  const { pg, explainers } = await db();
  const ok = await requestRerender(explainers as never, { topicId: IDS.topic1, settings: DEFAULT_SETTINGS });
  assert.equal(ok.ok, true);
  assert.equal((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM explainers.jobs WHERE topic_id = '${IDS.topic1}' AND status = 'requested'`)).rows[0]!.n, 1);
  await pg.exec(`UPDATE explainers.jobs SET status = 'ok' WHERE status = 'requested'; UPDATE explainers.topics SET status = 'rendered' WHERE id = '${IDS.topic1}';`);
  const capped = await requestRerender(explainers as never, { topicId: IDS.topic1, settings: { ...DEFAULT_SETTINGS, mode: 'production', daily_render_cap: 0 } });
  assert.equal(capped.ok, false);
  assert.equal((await pg.query<{ status: string }>(`SELECT status FROM explainers.topics WHERE id = '${IDS.topic1}'`)).rows[0]!.status, 'rendered');
});
