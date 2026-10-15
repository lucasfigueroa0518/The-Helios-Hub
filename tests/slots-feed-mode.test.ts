/** Trial / Main from the booking to the request (spec §5). Request builders only; nothing is sent. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { explainerPayloadFlags } from '@/lib/explainers/publish/publish';
import { createLiveReelClient } from '@/lib/explainers/publish/meta';
import { busyFeedTimes } from '@/lib/instagram/feed-spacing';
import { TRIAL_GRADUATION_STRATEGY } from '@/lib/reels/config';
import { createLiveMetaClient } from '@/lib/reels/music/meta';
import { reelPayloadFlags } from '@/lib/reels/music/publish';
import { bookSlot } from '@/lib/social-hub/spine';

import { openHubTestDb } from './fixtures/social-hub/pglite';

/** A fetch stub that records the form body Meta would get. Nothing leaves the process. */
function recorder() {
  const sent: Array<Record<string, string>> = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    sent.push(init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : {});
    return new Response(JSON.stringify({ id: 'c1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { sent, fetchImpl };
}

function withMetaEnv() {
  process.env.META_USER_ACCESS_TOKEN ??= 'test-token';
  process.env.META_IG_BUSINESS_ACCOUNT_ID ??= 'ig-test';
}

test('reel payload flags: trial keeps today\'s trial params, main drops them and shares to feed', () => {
  assert.deepEqual(reelPayloadFlags('trial', null), { graduation_strategy: TRIAL_GRADUATION_STRATEGY, share_to_feed: null });
  assert.deepEqual(reelPayloadFlags('trial', false), { graduation_strategy: TRIAL_GRADUATION_STRATEGY, share_to_feed: false });
  assert.deepEqual(reelPayloadFlags('main', null), { graduation_strategy: null, share_to_feed: true });
  assert.deepEqual(explainerPayloadFlags('main'), { share_to_feed: true, graduation_strategy: null });
  assert.deepEqual(explainerPayloadFlags('trial'), { share_to_feed: true, graduation_strategy: TRIAL_GRADUATION_STRATEGY });
});

test('a Text on Screen main-feed container has no trial_params', async () => {
  withMetaEnv();
  const { sent, fetchImpl } = recorder();
  const meta = createLiveMetaClient(fetchImpl);
  await meta.createReelContainer({ videoUrl: 'https://x/v.mp4', caption: 'c', audioId: 'a', audioVolume: 50, videoVolume: 50, graduationStrategy: null, shareToFeed: true });
  assert.equal(sent[0]!.trial_params, undefined);
  assert.equal(sent[0]!.share_to_feed, 'true');
  await meta.createReelContainer({ videoUrl: 'https://x/v.mp4', caption: 'c', audioId: 'a', audioVolume: 50, videoVolume: 50, graduationStrategy: TRIAL_GRADUATION_STRATEGY, shareToFeed: null });
  assert.deepEqual(JSON.parse(sent[1]!.trial_params!), { graduation_strategy: TRIAL_GRADUATION_STRATEGY });
  assert.equal(sent[1]!.share_to_feed, undefined);
});

test('an Explainer trial container carries trial_params', async () => {
  withMetaEnv();
  const { sent, fetchImpl } = recorder();
  const meta = createLiveReelClient(fetchImpl);
  await meta.createReel({ videoUrl: 'https://x/v.mp4', caption: 'c', shareToFeed: true, graduationStrategy: TRIAL_GRADUATION_STRATEGY });
  await meta.createReel({ videoUrl: 'https://x/v.mp4', caption: 'c', shareToFeed: true, graduationStrategy: null });
  await meta.createReel({ videoUrl: 'https://x/v.mp4', caption: 'c', shareToFeed: true });
  assert.deepEqual(JSON.parse(sent[0]!.trial_params!), { graduation_strategy: TRIAL_GRADUATION_STRATEGY });
  assert.equal(sent[0]!.share_to_feed, 'true');
  assert.equal(sent[1]!.trial_params, undefined);
  assert.equal(sent[2]!.trial_params, undefined);
});

test('bookSlot stores feed_mode; spacing counts main-feed reels and skips trial explainers', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  const at = (iso: string) => new Date(iso);
  const item = async (ref: string) =>
    (await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('explainers', 'reel', $1) RETURNING id`, [ref])).rows[0]!.id;
  await bookSlot(q, { vertical: 'reels', itemId: null, ideaRef: 'idea-main', nyDate: '2026-10-20', slot: 'morning', publishAt: at('2026-10-20T13:00:00Z'), source: 'auto', feedMode: 'main' });
  await bookSlot(q, { vertical: 'reels', itemId: null, ideaRef: 'idea-trial', nyDate: '2026-10-20', slot: 'midday', publishAt: at('2026-10-20T15:30:00Z'), source: 'auto', feedMode: 'trial' });
  await bookSlot(q, { vertical: 'explainers', itemId: await item('e-trial'), nyDate: '2026-10-20', slot: 'afternoon', publishAt: at('2026-10-20T17:30:00Z'), source: 'auto', feedMode: 'trial' });
  await bookSlot(q, { vertical: 'explainers', itemId: await item('e-legacy'), nyDate: '2026-10-20', slot: 'late', publishAt: at('2026-10-20T23:30:00Z'), source: 'auto' });
  const modes = await pg.query(`SELECT slot, feed_mode FROM social_hub.schedule ORDER BY publish_at`);
  assert.deepEqual(modes.rows.map((r) => (r as { feed_mode: string | null }).feed_mode), ['main', 'trial', 'trial', null]);
  const busy = (await busyFeedTimes(q, at('2026-10-20T04:00:00Z'))).map((d) => d.toISOString());
  assert.ok(busy.includes('2026-10-20T13:00:00.000Z'), 'a main-feed reel is a feed post');
  assert.ok(!busy.includes('2026-10-20T15:30:00.000Z'), 'a trial reel is not (D33)');
  assert.ok(!busy.includes('2026-10-20T17:30:00.000Z'), 'a trial explainer is not');
  assert.ok(busy.includes('2026-10-20T23:30:00.000Z'), 'an explainer with no feed_mode is Main');
});

test('a database without the feed_mode column still spaces explainers', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  const item = (await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('explainers', 'reel', 'e1') RETURNING id`)).rows[0]!.id;
  await bookSlot(q, { vertical: 'explainers', itemId: item, nyDate: '2026-10-20', slot: 'late', publishAt: new Date('2026-10-20T23:30:00Z'), source: 'auto' });
  await pg.exec(`ALTER TABLE social_hub.schedule DROP COLUMN feed_mode`);
  const busy = (await busyFeedTimes(q, new Date('2026-10-20T04:00:00Z'))).map((d) => d.toISOString());
  assert.deepEqual(busy, ['2026-10-20T23:30:00.000Z']);
});

test('bookSlot with no feed mode still inserts on a database without the feed_mode column', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.exec(`ALTER TABLE social_hub.schedule DROP COLUMN feed_mode CASCADE`);
  const out = await bookSlot(query as never, { vertical: 'reels', itemId: null, ideaRef: 'idea-x', nyDate: '2026-10-20', slot: 'morning', publishAt: new Date('2026-10-20T13:00:00Z'), source: 'auto' });
  assert.ok(out.id);
});
