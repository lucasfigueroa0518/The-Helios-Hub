// tests/lfd-driver.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { approveLfdPost } from '@/lib/lfd/schedule';
import { lastFewDaysDriver } from '@/lib/publishing/drivers/last-few-days';
import { publisherTick } from '@/lib/publishing/publisher';
import { ensureContentItem } from '@/lib/social-hub/spine';
import { pollCarouselInsights, type CarouselInsightsClient } from '@/lib/social/overnight/insights';
import type { CarouselMetaClient } from '@/lib/social/overnight/meta';
import type { Query } from '@/lib/social/store/pg';

import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

const meta: CarouselMetaClient = {
  async createImageItem() { return 'child'; },
  async createCarousel() { return 'parent'; },
  async containerStatus() { return { statusCode: 'FINISHED', status: null }; },
  async publishContainer() { return 'media-lfd'; },
  async permalink() { return 'https://instagram.com/p/lfd'; },
  async publishingLimit() { return { quotaUsage: 3, quotaTotal: 100 }; },
};

const driverFor = (q: Query) => lastFewDaysDriver({ query: q, meta: () => meta, signImage: async (p) => `https://signed/${p}`, token: () => 't' });

test('the publisher releases an approved due Last Few Days post and carries it', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  await q(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'publishing_live'`);
  await q(`INSERT INTO social_hub.settings (key, value) VALUES ('publisher_mode', '"live"'::jsonb) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  const id = await seedLfdPost(query);
  assert.equal((await approveLfdPost(q, id, new Date('2026-10-13T07:30:00Z'))).scheduled, true);
  await q(`UPDATE social_hub.schedule SET publish_at = now() - interval '1 minute'`);
  const tick = await publisherTick(q, [driverFor(q)]);
  assert.deepEqual(tick.mode === 'live' ? [tick.released, tick.published?.vertical, tick.published?.status] : [tick.mode], [1, 'last_few_days', 'published']);
  assert.equal((await q(`SELECT status FROM lfd.posts WHERE id = $1`, [id])).rows[0].status, 'published');
  assert.equal((await q(`SELECT status FROM social_hub.schedule`)).rows[0].status, 'published');
});

test('the driver is off while lfd publishing_live is off, and when the lfd schema is missing', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  assert.equal(await driverFor(q).live(), false);
  assert.equal(await driverFor(q).requireApproval(), true);
  const broken: Query = async (text) => {
    if (/lfd\./.test(text)) throw new Error('relation "lfd.settings" does not exist');
    return { rows: [] };
  };
  assert.equal(await driverFor(broken).live(), false);
  assert.equal(await driverFor(broken).requireApproval(), true);
});

test('Last Few Days insights are read into the spine under their own vertical only', async () => {
  const { query } = await openHubTestDb();
  const q = query as unknown as Query;
  const lfdItem = await ensureContentItem(q, { vertical: 'last_few_days', format: 'feed', nativeRef: 'p1', ideaRef: null });
  const carItem = await ensureContentItem(q, { vertical: 'carousels', format: 'feed', nativeRef: 'c1', ideaRef: null });
  for (const [item, vertical, media] of [[lfdItem, 'last_few_days', 'm-lfd'], [carItem, 'carousels', 'm-car']]) {
    await q(
      `INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption, media_id, finished_at) VALUES ($1, $2, 'auto', 'published', 'c', $3, '2026-10-13T14:00:00Z')`,
      [item, vertical, media],
    );
  }
  const seen: string[] = [];
  const client: CarouselInsightsClient = {
    async insights(mediaId) { seen.push(mediaId); return { views: 300, reach: 120, likes: 10, comments: 1, saved: 4, shares: 2, total_interactions: 17, follows: 3, profile_visits: 9, raw: {} }; },
  };
  const r = await pollCarouselInsights(q, client, new Date('2026-10-13T15:00:00Z'), 200, 'last_few_days');
  assert.deepEqual([r.considered, r.written, seen], [1, 1, ['m-lfd']]);
  const row = (await q(`SELECT vertical, views FROM social_hub.media_insights WHERE media_id = 'm-lfd'`)).rows[0];
  assert.deepEqual([row.vertical, row.views], ['last_few_days', 300]);
});

test('the publisher worker registers the Last Few Days driver', () => {
  const text = readFileSync(path.join(process.cwd(), 'scripts/publisher_worker.ts'), 'utf8');
  assert.match(text, /lastFewDaysDriver\(\{ query, meta: createLiveCarouselClient/);
});
