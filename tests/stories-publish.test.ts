/**
 * Stories M2: storage, the Instagram publisher and Story insights against
 * fetch stubs. No network, no Meta, no Supabase.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createStoryInsightsClient, isFinalCapture, readNavigation } from '@/lib/stories/publish/insights';
import { createStoriesMetaClient, type StoriesMetaClient } from '@/lib/stories/publish/meta';
import { publishSet } from '@/lib/stories/publish/publish';
import { createStoriesStorage, frameObjectPath, signedUrl, type StoriesStorage } from '@/lib/stories/storage';

type Call = { method: string; url: URL; body: string | null; headers: Record<string, string> };

function stubFetch(handler: (c: Call) => { status?: number; json?: unknown; text?: string }) {
  const calls: Call[] = [];
  const f = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body == null ? null : init.body instanceof URLSearchParams ? init.body.toString() : Buffer.isBuffer(init.body) ? `<${(init.body as Buffer).length} bytes>` : String(init.body);
    const c = { method: init?.method ?? 'GET', url, body, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(c);
    const r = handler(c);
    return new Response(r.json !== undefined ? JSON.stringify(r.json) : (r.text ?? ''), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

const SET = '0b7c3f0e-2f4d-4b8e-9b5f-6a1d2c3e4f50';
const noSleep = async () => {};

/* ── Storage ─────────────────────────────────────────────────────── */

test('frameObjectPath: one folder per set; bad ids refused', () => {
  assert.equal(frameObjectPath(SET, 3, 'answer'), `sets/${SET}/03-answer.jpg`);
  assert.throws(() => frameObjectPath('../etc', 1, 'intro'), /bad set id/);
});

test('signedUrl keeps the /storage/v1 prefix', () => {
  assert.equal(signedUrl('https://x.supabase.co', '/object/sign/stories/a.jpg?token=t'), 'https://x.supabase.co/storage/v1/object/sign/stories/a.jpg?token=t');
  assert.equal(signedUrl('https://x.supabase.co', 'https://x.supabase.co/storage/v1/object/sign/stories/a.jpg?token=t'), 'https://x.supabase.co/storage/v1/object/sign/stories/a.jpg?token=t');
});

test('storage: upload creates the private bucket on first use, retries outages, signs URLs', async () => {
  let uploads = 0;
  const s = stubFetch((c) => {
    if (c.url.pathname === '/storage/v1/bucket') return { json: { name: 'stories' } };
    if (c.url.pathname.startsWith('/storage/v1/object/sign/')) return { json: { signedURL: '/object/sign/stories/sets/a.jpg?token=abc' } };
    uploads++;
    if (uploads === 1) return { status: 404, json: { message: 'Bucket not found' } };
    if (uploads === 2) return { status: 503, text: 'busy' };
    return { json: { Key: 'stories/sets/a.jpg' } };
  });
  const st = createStoriesStorage({ baseUrl: 'https://x.supabase.co', serviceRole: 'srk', fetch: s.fetch, sleep: noSleep });
  await st.upload(`sets/${SET}/01-intro.jpg`, Buffer.from('jpeg'));
  const bucket = s.calls.find((c) => c.url.pathname === '/storage/v1/bucket')!;
  assert.deepEqual(JSON.parse(bucket.body!), { id: 'stories', name: 'stories', public: false });
  const put = s.calls.filter((c) => c.url.pathname.startsWith('/storage/v1/object/stories/'));
  assert.equal(put.length, 3);
  assert.equal(put[0]!.headers['content-type'], 'image/jpeg');
  assert.equal(put[0]!.headers['x-upsert'], 'true');
  assert.equal(await st.sign('sets/a.jpg'), 'https://x.supabase.co/storage/v1/object/sign/stories/sets/a.jpg?token=abc');
});

test('storage: a 400 is not retried', async () => {
  const s = stubFetch(() => ({ status: 400, text: 'bad mime' }));
  const st = createStoriesStorage({ baseUrl: 'https://x.supabase.co', serviceRole: 'srk', fetch: s.fetch, sleep: noSleep });
  await assert.rejects(st.upload('sets/a.jpg', Buffer.from('x')), /upload failed \(400\)/);
  assert.equal(s.calls.length, 1);
});

/* ── Meta client ─────────────────────────────────────────────────── */

test('meta: a STORIES container from an image URL; the token never shows in errors', async () => {
  const s = stubFetch((c) => {
    if (c.url.pathname.endsWith('/media')) return { json: { id: 'c1' } };
    if (c.url.pathname.endsWith('/content_publishing_limit')) return { json: { data: [{ quota_usage: 12, config: { quota_total: 100 } }] } };
    if (c.url.pathname.endsWith('/media_publish')) return { status: 400, json: { error: { message: 'Media ID is not available', code: 9007, fbtrace_id: 'T' } } };
    return { json: { status_code: 'FINISHED', status: 'Finished: Media has been uploaded' } };
  });
  const m = createStoriesMetaClient({ token: 'SECRET_TOKEN', igUserId: '1784', fetchImpl: s.fetch, version: 'v26.0' });
  assert.equal(await m.createStoryContainer('https://x/signed.jpg'), 'c1');
  const create = new URLSearchParams(s.calls[0]!.body!);
  assert.equal(s.calls[0]!.url.toString(), 'https://graph.facebook.com/v26.0/1784/media');
  assert.equal(create.get('media_type'), 'STORIES');
  assert.equal(create.get('image_url'), 'https://x/signed.jpg');
  assert.equal(create.get('caption'), null);
  assert.deepEqual(await m.containerStatus('c1'), { state: 'FINISHED', status: 'Finished: Media has been uploaded' });
  assert.deepEqual(await m.publishingQuota(), { used: 12, total: 100 });
  await assert.rejects(m.publishContainer('c1'), (err: Error) => /code 9007/.test(err.message) && !err.message.includes('SECRET_TOKEN'));
});

/* ── Publishing a set ────────────────────────────────────────────── */

function fakeMeta(opts: { quota?: { used: number; total: number } | null; states?: string[][]; failPublishSeq?: number; failTimes?: number } = {}) {
  const log: string[] = [];
  let n = 0;
  const polls = new Map<string, number>();
  let failures = 0;
  const meta: StoriesMetaClient = {
    async createStoryContainer(url) {
      log.push(`create ${url}`);
      return `c${++n}`;
    },
    async containerStatus(id) {
      const i = polls.get(id) ?? 0;
      polls.set(id, i + 1);
      const seq = opts.states?.[Number(id.slice(1)) - 1] ?? ['FINISHED'];
      return { state: (seq[Math.min(i, seq.length - 1)] ?? 'FINISHED') as never, status: null };
    },
    async publishContainer(id) {
      if (opts.failPublishSeq !== undefined && id === `c${opts.failPublishSeq}` && failures < (opts.failTimes ?? 99)) {
        failures++;
        throw new Error('Meta returned 500: try later');
      }
      log.push(`publish ${id}`);
      return `m-${id}`;
    },
    async publishingQuota() {
      return opts.quota === undefined ? { used: 0, total: 100 } : opts.quota;
    },
  };
  return { meta, log };
}
const storage: StoriesStorage = { upload: async () => {}, sign: async (p) => `https://signed/${p}`, download: async () => Buffer.alloc(0), remove: async () => {} };
const FRAMES = [3, 1, 2].map((seq) => ({ id: `f${seq}`, seq, storagePath: `sets/${SET}/0${seq}.jpg` }));

test('publishSet: containers first, all ready, then publish in order', async () => {
  const { meta, log } = fakeMeta({ states: [['IN_PROGRESS', 'FINISHED'], ['FINISHED'], ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED']] });
  const recorded: string[] = [];
  const sleeps: number[] = [];
  const out = await publishSet(FRAMES, {
    meta, storage, sleep: async (ms) => { sleeps.push(ms); },
    onContainer: async (f, c) => { recorded.push(`${f}:${c}`); },
    onPublished: async (f, m) => { recorded.push(`${f}=${m}`); },
  });
  assert.deepEqual(out, { ok: true, mediaIds: ['m-c1', 'm-c2', 'm-c3'] });
  assert.deepEqual(log, [`create https://signed/sets/${SET}/01.jpg`, `create https://signed/sets/${SET}/02.jpg`, `create https://signed/sets/${SET}/03.jpg`, 'publish c1', 'publish c2', 'publish c3']);
  assert.deepEqual(recorded, ['f1:c1', 'f2:c2', 'f3:c3', 'f1=m-c1', 'f2=m-c2', 'f3=m-c3']);
  // Two status rounds a minute apart, then two 4-second gaps between frames.
  assert.deepEqual(sleeps, [60_000, 60_000, 4000, 4000]);
});

test('publishSet: no quota room or a failed container stops the set before anything goes live', async () => {
  const full = await publishSet(FRAMES, { ...fakeMeta({ quota: { used: 98, total: 100 } }), storage, sleep: noSleep });
  assert.deepEqual(full, { ok: false, stage: 'quota', error: 'publishing quota: 98/100 used in 24 hours, 3 frames to post', published: [] });

  const { meta, log } = fakeMeta({ states: [['FINISHED'], ['ERROR']] });
  const bad = await publishSet(FRAMES, { meta, storage, sleep: noSleep });
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.stage, 'container');
  assert.ok(!log.some((l) => l.startsWith('publish')));

  const slow = await publishSet(FRAMES, { ...fakeMeta({ states: [['IN_PROGRESS']] }), storage, sleep: noSleep });
  assert.match(!slow.ok ? slow.error : '', /not ready after 5 checks/);
});

test('publishSet: a frame that keeps failing stops the set; what went out is reported', async () => {
  const flaky = await publishSet(FRAMES, { ...fakeMeta({ failPublishSeq: 2, failTimes: 2 }), storage, sleep: noSleep });
  assert.equal(flaky.ok, true);
  const dead = await publishSet(FRAMES, { ...fakeMeta({ failPublishSeq: 2 }), storage, sleep: noSleep });
  assert.deepEqual(dead, { ok: false, stage: 'publish', error: 'frame 2: Meta returned 500: try later', published: [{ frameId: 'f1', mediaId: 'm-c1' }] });
});

/* ── Insights ─────────────────────────────────────────────────────── */

test('insights: lifetime metrics plus the navigation breakdown', async () => {
  const s = stubFetch((c) => {
    if (c.url.searchParams.get('metric') === 'navigation') {
      return { json: { data: [{ name: 'navigation', total_value: { value: 140, breakdowns: [{ dimension_keys: ['story_navigation_action_type'], results: [{ dimension_values: ['TAP_FORWARD'], value: 100 }, { dimension_values: ['tap_exit'], value: 25 }, { dimension_values: ['TAP_BACK'], value: 10 }, { dimension_values: ['SWIPE_FORWARD'], value: 5 }] }] } }] } };
    }
    return { json: { data: [{ name: 'reach', values: [{ value: 412 }] }, { name: 'views', values: [{ value: 530 }] }, { name: 'replies', values: [{ value: 3 }] }, { name: 'shares', values: [{ value: 1 }] }] } };
  });
  const c = createStoryInsightsClient({ token: 'T', fetchImpl: s.fetch, version: 'v26.0' });
  const r = await c.storyInsights('m1');
  assert.equal(s.calls[0]!.url.searchParams.get('metric'), 'reach,views,replies,shares,follows,profile_visits,total_interactions');
  assert.equal(s.calls[0]!.url.searchParams.get('period'), 'lifetime');
  assert.equal(s.calls[1]!.url.searchParams.get('breakdown'), 'story_navigation_action_type');
  assert.deepEqual(r.metrics, { reach: 412, views: 530, replies: 3, shares: 1, follows: null, profile_visits: null, total_interactions: null, taps_forward: 100, taps_back: 10, exits: 25, swipe_forward: 5 });
  assert.equal(r.notEnoughViewers, false);
});

test('insights: a rejected metric is dropped and the rest asked again; under 5 viewers is an empty capture', async () => {
  let first = true;
  const s = stubFetch((c) => {
    if (c.url.searchParams.get('metric') === 'navigation') return { json: { data: [] } };
    if (first) {
      first = false;
      return { status: 400, json: { error: { message: '(#100) metric[4] must be one of the following values: reach, views (follows is not supported)', code: 100 } } };
    }
    return { json: { data: [{ name: 'reach', values: [{ value: 9 }] }] } };
  });
  const r = await createStoryInsightsClient({ token: 'T', fetchImpl: s.fetch }).storyInsights('m1');
  assert.equal(r.metrics.reach, 9);
  assert.equal(r.metrics.follows, null);
  assert.ok(!s.calls[1]!.url.searchParams.get('metric')!.includes('follows'));

  const few = stubFetch(() => ({ status: 400, json: { error: { message: '(#10) Not enough viewers for the media to show insights', code: 10 } } }));
  const r2 = await createStoryInsightsClient({ token: 'T', fetchImpl: few.fetch }).storyInsights('m2');
  assert.equal(r2.notEnoughViewers, true);
  assert.deepEqual(r2.metrics, {});
});

test('insights: final capture an hour before the 24-hour expiry', () => {
  const t = new Date('2026-10-10T23:00:00Z');
  assert.equal(isFinalCapture(t, new Date('2026-10-11T21:59:00Z')), false);
  assert.equal(isFinalCapture(t, new Date('2026-10-11T22:00:00Z')), true);
  assert.deepEqual(readNavigation({}), { taps_forward: null, taps_back: null, exits: null, swipe_forward: null });
});
