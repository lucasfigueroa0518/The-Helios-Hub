import assert from 'node:assert/strict';
import test from 'node:test';

import { keepCleanClip } from '@/lib/reels/visual/clean-clip';
import { rawKeyFor } from '@/lib/revisions/descriptions/text-on-screen';

const VIDEO = '60000000-0000-4000-8000-000000000004';

test('the clean clip is uploaded next to the composed video, at the key the revisions reader looks up', async () => {
  const calls: Array<[string, Buffer, string]> = [];
  const bytes = Buffer.from('clean');
  await keepCleanClip(`${VIDEO}/reel.mp4`, bytes, async (k, b, t) => void calls.push([k, b, t]));
  assert.deepEqual(calls, [[`${VIDEO}/raw.mp4`, bytes, 'video/mp4']]);
  assert.equal(rawKeyFor(`${VIDEO}/reel.mp4`), `${VIDEO}/raw.mp4`);
});

test('a failed clean clip upload never throws and logs one line', async () => {
  const lines: string[] = [];
  const ok = await keepCleanClip(
    `${VIDEO}/reel.mp4`,
    Buffer.from('x'),
    async () => {
      throw new Error('storage down');
    },
    (l) => lines.push(l),
  );
  assert.equal(ok, false);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /storage down/);
});

test('a name with no reel.mp4 shape keeps nothing and does not throw', async () => {
  let called = false;
  assert.equal(await keepCleanClip('odd/name.mp4', Buffer.from('x'), async () => void (called = true)), false);
  assert.equal(called, false);
});
