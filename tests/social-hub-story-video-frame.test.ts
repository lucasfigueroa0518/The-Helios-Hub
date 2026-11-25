import test from 'node:test';
import assert from 'node:assert/strict';
import { storyFrameMedia } from '@/lib/social-hub/adapters/stories';

test('an image frame shows its JPEG', () => {
  const f = storyFrameMedia({ frame_id: 'a', seq: 2, role: 'story', storage_path: 'sets/s/02-story.jpg', poster_path: null, media: 'image' });
  assert.equal(f.path, 'sets/s/02-story.jpg');
  assert.match(f.src!, /^\/api\/stories\/frames\/a\?v=/);
  assert.equal(f.video, undefined);
});

test('a video frame shows its poster in every <img> and carries its MP4 to play', () => {
  const f = storyFrameMedia({ frame_id: 'b', seq: 3, role: 'story', storage_path: 'sets/s/03-story.mp4', poster_path: 'sets/s/03-story.jpg', media: 'video' });
  assert.equal(f.path, 'sets/s/03-story.jpg');
  assert.match(f.src!, /^\/api\/stories\/frames\/b\?v=/);
  assert.equal(f.videoPath, 'sets/s/03-story.mp4');
  assert.match(f.video!, /^\/api\/stories\/frames\/b\?media=video&v=/);
});

test('an MP4 frame without a poster never puts the MP4 in an <img>', () => {
  const f = storyFrameMedia({ frame_id: 'c', seq: 3, role: 'story', storage_path: 'sets/s/03-story.mp4', poster_path: null, media: null });
  assert.equal(f.src, null);
  assert.equal(f.path, null);
  assert.ok(f.video);
});
