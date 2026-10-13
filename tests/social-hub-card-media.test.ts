/** The images a card steps through with its arrows (offline). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { mediaFrames } from '@/lib/social-hub/views/card-media';

test('slides: rendered image first, else the photo (remote), and outline-only slides are skipped', () => {
  const frames = mediaFrames({ kind: 'slides', slides: [
    { src: '/r/1.jpg', alt: '', photo: null, layout: null, headline: null, body: null },
    { src: null, alt: '', photo: 'https://img/2.jpg', layout: null, headline: null, body: null },
    { src: null, alt: '', photo: null, layout: 'text', headline: 'H', body: null },
  ] });
  assert.deepEqual(frames, [{ src: '/r/1.jpg', remote: false }, { src: 'https://img/2.jpg', remote: true }]);
});

test('frames: only those with an image; video and none have no frames', () => {
  assert.deepEqual(mediaFrames({ kind: 'frames', frames: [{ src: '/f/1.png', label: 'a' }, { src: null, label: 'b' }] }), [{ src: '/f/1.png', remote: false }]);
  assert.deepEqual(mediaFrames({ kind: 'video', src: 'v.mp4' }), []);
  assert.deepEqual(mediaFrames({ kind: 'none', note: 'x' }), []);
});
