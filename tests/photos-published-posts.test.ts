import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aiEventsCandidate,
  carouselCandidate,
  dramaCandidate,
  entriesFor,
  fieldNotesCandidate,
  lfdCandidate,
  publishedPostAdapters,
  storiesCandidate,
} from '@/lib/photos/published-posts';
import type { Query } from '@/lib/social/store/pg';

const BUILT = '2026-11-09T07:00:00Z';

test('LFD: story i is slide i + 2; logo photos and meme slides are never logged', () => {
  const post = lfdCandidate({
    id: 'l1',
    caption: 'Do you realize…',
    created_at: BUILT,
    stories: [
      { photo: { src: 'https://p/a.jpg', credit: 'AP', kind: 'scene' } },
      { photo: { src: 'https://p/logo.png', kind: 'logo' } },
      { photo: { src: 'storage:lfd/meme.jpg', kind: 'scene' } },
      { photo: { src: 'https://p/b.jpg', kind: 'person' } },
    ],
    render: { slides: [{ position: 0 }, { position: 1 }, { position: 2 }, { position: 3, photoKind: 'meme' }, { position: 4 }] },
    slide_objects: ['lfd/l1/slide-01.jpg'],
  });
  assert.deepEqual(post.photos.map((p) => [p.url, p.slide]), [['https://p/a.jpg', 2], ['https://p/b.jpg', 5]]);
  assert.equal(post.coverRender, 'storage:social-slides/lfd/l1/slide-01.jpg');
  const [e] = entriesFor(post, new Date('2026-11-09T14:00:00Z'), 'm1');
  assert.deepEqual([e.vertical, e.postId, e.mediaId, e.credit, e.source], ['lfd', 'l1', 'm1', 'AP', 'lfd']);
});

test('Stories: a set logs its frames\' photos; logos and every Free vs. Paid frame are exempt', () => {
  const frames = [
    { set_id: 's1', seq: 2, role: 'story', photo: { src: 'https://p/x.jpg', kind: 'scene', qid: 'Q1', source: 'wikimedia' }, storage_path: 'sets/s1/02.jpg' },
    { set_id: 's1', seq: 1, role: 'opener', photo: { src: 'https://p/l.png', kind: 'logo' }, storage_path: 'sets/s1/01.jpg' },
  ];
  const md = storiesCandidate({ id: 's1', series: 'morning_download', built_at: BUILT }, frames);
  assert.deepEqual(md.photos.map((p) => [p.url, p.slide, p.qid, p.source, p.scene]), [['https://p/x.jpg', 2, 'Q1', 'wikimedia', 'story']]);
  assert.deepEqual(md.frameRenders, ['storage:stories/sets/s1/01.jpg', 'storage:stories/sets/s1/02.jpg']);
  assert.equal(md.caption, null);
  assert.equal(storiesCandidate({ id: 's2', series: 'free_vs_paid', built_at: BUILT }, frames).photos.length, 0);
});

test('Carousels: photoUrl per slide, logos and memes exempt; the caption is what the publish sends', () => {
  const post = carouselCandidate({
    id: 'c1',
    caption: null,
    created_at: BUILT,
    render: {
      caption: 'Big news.',
      attributionBlock: 'Photo: AP',
      slides: [
        { position: 0, photoUrl: 'https://p/cover.jpg', photoKind: 'subject', photoCredit: 'AP' },
        { position: 1, photoUrl: 'https://p/logo.png', photoKind: 'logo' },
        { position: 2, photoUrl: 'https://p/meme.jpg', photoKind: 'meme' },
      ],
    },
    slide_objects: ['posts/c1/slide-01.jpg'],
  });
  assert.deepEqual(post.photos.map((p) => [p.url, p.slide, p.credit]), [['https://p/cover.jpg', 1, 'AP']]);
  assert.equal(post.caption, 'Big news.\n\nPhoto: AP');
});

test('AI Drama: character cutouts, logos and made pictures are exempt; a pHash key is the entry\'s phash', () => {
  const post = dramaCandidate({ id: 'j1', finished_at: BUILT, caption: 'The reel caption' }, [
    { job_id: 'j1', asset_key: '0123456789abcdef', character_image: false, data: { url: 'https://p/event.jpg', kind: 'event_photo', credit: 'Reuters', qids: ['Q9'] } },
    { job_id: 'j1', asset_key: 'fedcba9876543210', character_image: true, data: { url: 'https://p/cutout.png', kind: 'person' } },
    { job_id: 'j1', asset_key: 'https://p/logo.png', character_image: false, data: { url: 'https://p/logo.png', kind: 'logo' } },
    { job_id: 'j1', asset_key: 'aaaaaaaaaaaaaaaa', character_image: false, data: { url: null, kind: 'map', made: true } },
    { job_id: 'j1', asset_key: 'bbbbbbbbbbbbbbbb', character_image: false, data: { url: 'https://p/face.jpg', kind: 'person_photo', character_image: true } },
    // A logo the harvest flagged (kind says photo, the flag says logo): exempt, as the harvest's reuse rule reads it.
    { job_id: 'j1', asset_key: 'cccccccccccccccc', character_image: false, data: { url: 'https://p/wordmark.jpg', kind: 'company_photo', flags: ['logo', 'wide'] } },
  ]);
  assert.deepEqual(post.photos.map((p) => [p.url, p.phash, p.qid, p.credit]), [['https://p/event.jpg', '0123456789abcdef', 'Q9', 'Reuters']]);
  assert.equal(post.coverRender, null);
});

test('Field Notes: the ledger key is the bank photo id, with the bank\'s dHash', () => {
  const post = fieldNotesCandidate(
    { id: 'f1', caption: 'Tip', created_at: BUILT, photo_ids: ['11111111-1111-1111-1111-111111111111'], slide_objects: ['fn/f1/slide-01.jpg'] },
    [{ id: '11111111-1111-1111-1111-111111111111', dhash: 'abcdabcdabcdabcd', credit: 'Helios team', qids: [], subjects: ['office'], scenes: [], master_path: 'masters/1.jpg' }],
  );
  const [p] = post.photos;
  assert.equal(p.url, 'media-library:11111111-1111-1111-1111-111111111111');
  assert.equal(p.dhash, 'abcdabcdabcdabcd');
  assert.equal(p.fetchFrom, 'storage:photo-bank/masters/1.jpg');
  assert.equal(p.subject, 'office');
});

test('AI Events: every poster image inside a slide, once per slide', () => {
  const post = aiEventsCandidate({
    id: 'a1',
    caption: 'Events',
    created_at: BUILT,
    render: { slides: [{ position: 0 }, { position: 1, aiEvents: { pick: { image: 'https://luma/1.png' }, rows: [{ image: 'https://luma/2.png' }, { image: 'https://luma/1.png' }] } }] },
    slide_objects: [],
  });
  assert.deepEqual(post.photos.map((p) => [p.url, p.slide]), [['https://luma/1.png', 2], ['https://luma/2.png', 2]]);
  assert.equal(post.coverRender, null);
});

test('byMediaId follows publish_attempts.media_id to the item; Stories follow stories.frames.ig_media_id', async () => {
  const seen: string[] = [];
  const query: Query = async (text, params = []) => {
    seen.push(text.split('\n')[0].slice(0, 60));
    if (text.includes('FROM social_hub.publish_attempts')) return { rows: params[0] === 'm1' && params[1] === 'last_few_days' ? [{ native_ref: 'l1' }] : [] };
    if (text.includes('FROM lfd.posts')) return { rows: [{ id: 'l1', caption: 'c', created_at: BUILT, stories: [{ photo: { src: 'https://p/a.jpg' } }], render: { slides: [] }, slide_objects: [] }] };
    if (text.includes('FROM stories.frames WHERE ig_media_id')) return { rows: params[0] === 's-media' ? [{ set_id: 's1' }] : [] };
    if (text.includes('FROM stories.sets')) return { rows: [{ id: 's1', series: 'guess_the_number', built_at: BUILT }] };
    if (text.includes('FROM stories.frames WHERE set_id')) return { rows: [{ set_id: 's1', seq: 1, role: 'question', photo: { src: 'https://p/q.jpg', kind: 'scene' }, storage_path: 'sets/s1/01.jpg' }] };
    return { rows: [] };
  };
  const adapters = publishedPostAdapters(query);
  const lfd = adapters.find((a) => a.vertical === 'lfd')!;
  const stories = adapters.find((a) => a.vertical === 'stories')!;
  assert.equal((await lfd.byMediaId('m1'))?.postId, 'l1');
  assert.equal(await lfd.byMediaId('other'), null);
  const set = await stories.byMediaId('s-media');
  assert.deepEqual([set?.postId, set?.photos[0]?.url], ['s1', 'https://p/q.jpg']);
});

test('publish-time write: one post by its id, its photos hashed best effort, at the publish time; nothing for a post gone', async () => {
  const { recordPublishedPost } = await import('@/lib/photos/published-posts');
  const writes: unknown[][] = [];
  const query: Query = async (text, params = []) => {
    if (text.includes('INSERT INTO social.used_photos')) writes.push(params);
    return { rows: [] };
  };
  const post = { vertical: 'carousels' as const, postId: 'p1', caption: null, builtAt: new Date(BUILT), coverRender: null, photos: [{ url: 'https://p/a.jpg', slide: 2 }, { url: 'https://p/b.jpg', slide: 3 }] };
  const adapters = [{ vertical: 'carousels' as const, byMediaId: async () => null, candidates: async () => [], byPostId: async (id: string) => (id === 'p1' ? post : null) }];
  const read = async (ref: string) => (ref.endsWith('a.jpg') ? Buffer.from('a') : Promise.reject(new Error('404')));
  const lines: string[] = [];
  const at = new Date('2026-11-10T13:00:00Z');
  const n = await recordPublishedPost(query, 'carousels', 'p1', at, { adapters, read, hash: async (b) => ({ phash: `p${b}`, dhash: `d${b}` }), log: (l) => lines.push(l), mediaId: 'm1' });
  assert.equal(n, 2);
  assert.deepEqual(writes.map((w) => [w[0], w[1], w[2], w[9], w[10], w[11], w[12]]), [
    ['https://p/a.jpg', at.toISOString(), 'carousels:p1', 'carousels', 'm1', 'pa', 'da'],
    ['https://p/b.jpg', at.toISOString(), 'carousels:p1', 'carousels', 'm1', null, null],
  ]);
  assert.match(lines[0]!, /logged by URL only: https:\/\/p\/b\.jpg/);
  assert.equal(await recordPublishedPost(query, 'carousels', 'gone', at, { adapters }), 0);
});

test('publish-time write: a ledger failure only logs, never throws (the publish goes on)', async () => {
  const { logPublishedPhotos } = await import('@/lib/social/overnight/publish');
  const warn = console.warn;
  const warned: string[] = [];
  console.warn = (m: string) => void warned.push(m);
  try {
    await logPublishedPhotos((async () => { throw new Error('db down'); }) as Query, 'field_notes', 'f1', '2026-11-10T13:00:00Z', undefined);
  } finally {
    console.warn = warn;
  }
  assert.match(warned[0]!, /used_photos field_notes f1: not logged \(db down\)/);
});
