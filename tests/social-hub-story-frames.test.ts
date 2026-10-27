import assert from 'node:assert/strict';
import test from 'node:test';

import type { HubDataset } from '@/lib/social-hub/dataset';
import type { HubPost } from '@/lib/social-hub/types';
import { signOpenedPost, signVisibleStoryFrames } from '@/lib/social-hub/views/story-frames';

function frames(id: string, items: Array<{ src: string | null; path?: string | null }>): HubPost {
  return { id, media: { kind: 'frames', frames: items.map((item, i) => ({ src: item.src, label: `Frame ${i + 1}`, path: item.path })) } } as HubPost;
}

function dataset(posts: HubPost[]): HubDataset {
  return { posts } as HubDataset;
}

test('visible story frames are signed in one batch; a missing path, a thrown sign, and an unknown id stay as they were', async () => {
  const shown = dataset([
    frames('stories:set:a', [
      { src: '/api/stories/frames/1', path: 'sets/a/01.jpg' },
      { src: '/api/stories/frames/2', path: null },
      { src: 'https://already.signed/x', path: 'sets/a/03.jpg' },
    ]),
    frames('stories:set:b', [{ src: '/api/stories/frames/9', path: 'sets/b/01.jpg' }]),
  ]);
  const calls: string[][] = [];
  const signed = await signVisibleStoryFrames(shown, new Set(['stories:set:a']), async (paths) => {
    calls.push(paths);
    return paths.map((path) => `https://signed.example/${path}?token=t`);
  });
  assert.deepEqual(calls, [['sets/a/01.jpg']]);
  assert.equal(signed.posts[0]!.media.kind === 'frames' && signed.posts[0]!.media.frames[0]!.src, 'https://signed.example/sets/a/01.jpg?token=t');
  assert.equal(signed.posts[0]!.media.kind === 'frames' && signed.posts[0]!.media.frames[1]!.src, '/api/stories/frames/2');
  assert.equal(signed.posts[0]!.media.kind === 'frames' && signed.posts[0]!.media.frames[2]!.src, 'https://already.signed/x');
  assert.equal(signed.posts[1]!.media.kind === 'frames' && signed.posts[1]!.media.frames[0]!.src, '/api/stories/frames/9');
  assert.equal(shown.posts[0]!.media.kind === 'frames' && shown.posts[0]!.media.frames[0]!.src, '/api/stories/frames/1', 'the cached dataset is not rewritten');

  const thrown = await signVisibleStoryFrames(shown, new Set(['stories:set:a']), async () => { throw new Error('storage down'); });
  assert.equal(thrown, shown);

  const missed = await signOpenedPost(shown, encodeURIComponent('stories:set:missing'), async () => ['https://nope']);
  assert.equal(missed, shown);

  const opened = await signOpenedPost(shown, encodeURIComponent('stories:set:b'), async (paths) => paths.map((path) => `https://signed.example/${path}`));
  assert.equal(opened.posts[1]!.media.kind === 'frames' && opened.posts[1]!.media.frames[0]!.src, 'https://signed.example/sets/b/01.jpg');
});
