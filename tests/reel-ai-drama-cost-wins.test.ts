import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

test('a frame gets the inventory records its storyboard entry names, and only those', async () => {
  const { frameAssets } = (await import(path.join(process.cwd(), 'explainers', 'reel-ai-drama', 'kit', 'project-files.mjs'))) as {
    frameAssets: (f: unknown, a: { id: string }[]) => { id: string }[];
  };
  const assets = [{ id: 'V1' }, { id: 'V11' }, { id: 'M3' }, { id: 'V70' }];
  const frame = { id: '02-a', asset_ids: ['V1'], shots: [{ asset: 'M3', words: 'over V70?' }], must_show: 'a V11-like thing' };
  assert.deepEqual(frameAssets({ id: '02-a', asset_ids: ['V1'] }, assets).map((a) => a.id), ['V1'], 'V1 never pulls in V11');
  assert.deepEqual(frameAssets(frame, assets).map((a) => a.id).sort(), ['M3', 'V1', 'V11', 'V70']);
  assert.deepEqual(frameAssets({ id: '03-made', asset_ids: [] }, assets), []);
});
