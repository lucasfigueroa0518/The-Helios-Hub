/**
 * Golden Graph requests for every content type (backend unification, Move 2).
 * Records what each client sends to Meta: the transport moves into
 * lib/instagram, but each payload must stay exactly as it is. Above all, a
 * Trial Reel must keep `trial_params` (SS_PERFORMANCE: it graduates itself when it performs), or it posts straight to the grid.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createLiveReelClient } from '@/lib/explainers/publish/meta';
import { TRIAL_GRADUATION_STRATEGY } from '@/lib/reels/config';
import { createLiveMetaClient } from '@/lib/reels/music/meta';
import { createLiveCarouselClient } from '@/lib/social/overnight/meta';
import { createStoriesMetaClient } from '@/lib/stories/publish/meta';

const TOKEN = 'golden-token';
const IG = '17840000000000001';
const BASE = 'https://graph.facebook.com/v26.0';

type Sent = { method: string; url: string; params: Record<string, string> };

/** A fetch stub that records each request (token removed) and answers like Meta. */
function recorder() {
  const sent: Sent[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const params: Record<string, string> = {};
    const source = method === 'GET' ? url.searchParams : new URLSearchParams(String(init?.body ?? ''));
    for (const [k, v] of source) params[k] = v;
    assert.equal(params.access_token, TOKEN, 'every call carries the user token');
    delete params.access_token;
    if (method !== 'GET') assert.equal(url.searchParams.has('access_token'), false, 'POST keeps the token out of the URL');
    sent.push({ method, url: `${url.origin}${url.pathname}`, params });
    if (url.pathname.endsWith('/content_publishing_limit')) return Response.json({ data: [{ quota_usage: 3, config: { quota_total: 100 } }] });
    if (params.fields === 'status_code,status') return Response.json({ status_code: 'FINISHED', status: 'Finished: Media has been uploaded and it is complete.' });
    if (params.fields === 'permalink') return Response.json({ permalink: 'https://www.instagram.com/p/x/' });
    return Response.json({ id: url.pathname.endsWith('/media_publish') ? 'media-1' : 'container-1' });
  }) as typeof fetch;
  return { sent, fetchImpl };
}

function withMetaEnv<T>(fn: () => Promise<T>): Promise<T> {
  const before = { token: process.env.META_USER_ACCESS_TOKEN, ig: process.env.META_IG_BUSINESS_ACCOUNT_ID };
  process.env.META_USER_ACCESS_TOKEN = TOKEN;
  process.env.META_IG_BUSINESS_ACCOUNT_ID = IG;
  return fn().finally(() => {
    if (before.token === undefined) delete process.env.META_USER_ACCESS_TOKEN;
    else process.env.META_USER_ACCESS_TOKEN = before.token;
    if (before.ig === undefined) delete process.env.META_IG_BUSINESS_ACCOUNT_ID;
    else process.env.META_IG_BUSINESS_ACCOUNT_ID = before.ig;
  });
}

const STATUS: Sent = { method: 'GET', url: `${BASE}/container-1`, params: { fields: 'status_code,status' } };
const PUBLISH: Sent = { method: 'POST', url: `${BASE}/${IG}/media_publish`, params: { creation_id: 'container-1' } };
const PERMALINK: Sent = { method: 'GET', url: `${BASE}/media-1`, params: { fields: 'permalink' } };
const QUOTA: Sent = { method: 'GET', url: `${BASE}/${IG}/content_publishing_limit`, params: { fields: 'quota_usage,config' } };

test('Trial Reel: REELS with trial_params SS_PERFORMANCE and the song attached by audio_id', async () => {
  assert.equal(TRIAL_GRADUATION_STRATEGY, 'SS_PERFORMANCE', 'a trial reel graduates itself when it performs');
  await withMetaEnv(async () => {
    const { sent, fetchImpl } = recorder();
    const meta = createLiveMetaClient(fetchImpl);
    const input = {
      videoUrl: 'https://store.example/reel.mp4',
      caption: 'Reel caption',
      audioId: 'audio-42',
      audioVolume: 80,
      videoVolume: 20,
      graduationStrategy: TRIAL_GRADUATION_STRATEGY,
    };
    assert.equal(await meta.createReelContainer({ ...input, shareToFeed: null }), 'container-1');
    await meta.createReelContainer({ ...input, shareToFeed: false });
    await meta.containerStatus('container-1');
    await meta.publishContainer('container-1');
    await meta.permalink('media-1');
    const reel = {
      media_type: 'REELS',
      video_url: 'https://store.example/reel.mp4',
      caption: 'Reel caption',
      audio_configuration: '{"audio_id":"audio-42","audio_volume":80,"video_volume":20}',
      trial_params: '{"graduation_strategy":"SS_PERFORMANCE"}',
    };
    assert.deepEqual(sent, [
      { method: 'POST', url: `${BASE}/${IG}/media`, params: reel },
      { method: 'POST', url: `${BASE}/${IG}/media`, params: { ...reel, share_to_feed: 'false' } },
      STATUS,
      PUBLISH,
      PERMALINK,
    ]);
  });
});

test('Explainer: a plain REELS shared to the feed, with no audio configuration and no trial', async () => {
  await withMetaEnv(async () => {
    const { sent, fetchImpl } = recorder();
    const meta = createLiveReelClient(fetchImpl);
    await meta.createReel({ videoUrl: 'https://store.example/explainer.mp4', caption: 'Explainer caption', shareToFeed: true });
    await meta.containerStatus('container-1');
    await meta.publishContainer('container-1');
    await meta.permalink('media-1');
    await meta.publishingLimit();
    assert.deepEqual(sent, [
      {
        method: 'POST',
        url: `${BASE}/${IG}/media`,
        params: { media_type: 'REELS', video_url: 'https://store.example/explainer.mp4', caption: 'Explainer caption', share_to_feed: 'true' },
      },
      STATUS,
      PUBLISH,
      PERMALINK,
      QUOTA,
    ]);
  });
});

test('Carousel: one is_carousel_item container per slide, then a CAROUSEL parent with the caption', async () => {
  await withMetaEnv(async () => {
    const { sent, fetchImpl } = recorder();
    const meta = createLiveCarouselClient(fetchImpl);
    await meta.createImageItem('https://store.example/slide-01.jpg');
    await meta.createImageItem('https://store.example/slide-02.jpg');
    await meta.createCarousel(['item-1', 'item-2'], 'Carousel caption');
    await meta.containerStatus('container-1');
    await meta.publishContainer('container-1');
    await meta.permalink('media-1');
    await meta.publishingLimit();
    assert.deepEqual(sent, [
      { method: 'POST', url: `${BASE}/${IG}/media`, params: { image_url: 'https://store.example/slide-01.jpg', is_carousel_item: 'true' } },
      { method: 'POST', url: `${BASE}/${IG}/media`, params: { image_url: 'https://store.example/slide-02.jpg', is_carousel_item: 'true' } },
      { method: 'POST', url: `${BASE}/${IG}/media`, params: { media_type: 'CAROUSEL', children: 'item-1,item-2', caption: 'Carousel caption' } },
      STATUS,
      PUBLISH,
      PERMALINK,
      QUOTA,
    ]);
  });
});

test('Story: one STORIES image container per frame, then the shared status, publish and quota calls', async () => {
  const { sent, fetchImpl } = recorder();
  const meta = createStoriesMetaClient({ token: TOKEN, igUserId: IG, fetchImpl });
  await meta.createStoryContainer('https://store.example/frame-1.png');
  assert.deepEqual(await meta.containerStatus('container-1'), { state: 'FINISHED', status: 'Finished: Media has been uploaded and it is complete.' });
  await meta.publishContainer('container-1');
  assert.deepEqual(await meta.publishingQuota(), { used: 3, total: 100 });
  assert.deepEqual(sent, [
    { method: 'POST', url: `${BASE}/${IG}/media`, params: { media_type: 'STORIES', image_url: 'https://store.example/frame-1.png' } },
    STATUS,
    PUBLISH,
    QUOTA,
  ]);
});
