// tests/photos-switch.test.ts — the shared photo finder's per-type switch (intake.settings 'photo_finders').
// Offline: the query is a stub. Every failure reads as 'legacy'.
import assert from 'node:assert/strict';
import test from 'node:test';

import { photoFinderMode, readPhotoFinderModes } from '@/lib/photos/switch';
import { PHOTO_FINDERS_SETTINGS_KEY, PHOTO_PROFILE_IDS, type PhotoFinderModes } from '@/lib/photos/types';

const ALL_LEGACY: PhotoFinderModes = { lfd: 'legacy', md: 'legacy', gtn: 'legacy', fvp: 'legacy', carousel: 'legacy' };

function stub(rows: Array<{ value: unknown }> | Error) {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  return {
    calls,
    q: {
      async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
        calls.push({ text, params });
        if (rows instanceof Error) throw rows;
        return { rows: rows as T[] };
      },
    },
  };
}

test('switch: a missing row reads as all legacy; the query reads only the photo_finders key, read only', async () => {
  const s = stub([]);
  assert.deepEqual(await readPhotoFinderModes(s.q), ALL_LEGACY);
  assert.equal(s.calls.length, 1);
  assert.match(s.calls[0]!.text, /^SELECT value FROM intake\.settings WHERE key = \$1$/);
  assert.deepEqual(s.calls[0]!.params, [PHOTO_FINDERS_SETTINGS_KEY]);
});

test("switch: 'shared' values turn on only their types; missing keys and other values stay legacy", async () => {
  const modes = await readPhotoFinderModes(stub([{ value: { lfd: 'shared', md: 'legacy', carousel: 'shared', gtn: 'SHARED', fvp: true, reels: 'shared' } }]).q);
  assert.deepEqual(modes, { lfd: 'shared', md: 'legacy', gtn: 'legacy', fvp: 'legacy', carousel: 'shared' });
  assert.deepEqual(Object.keys(modes).sort(), [...PHOTO_PROFILE_IDS].sort(), 'only the profile ids');
  // A JSON string (a text column, or a driver that doesn't parse jsonb) reads the same.
  assert.deepEqual(await readPhotoFinderModes(stub([{ value: JSON.stringify({ md: 'shared' }) }]).q), { ...ALL_LEGACY, md: 'shared' });
});

test('switch: garbage values read as all legacy', async () => {
  for (const value of ['{not json', 'shared', 42, null, ['lfd'], JSON.stringify(['shared']), JSON.stringify('shared')]) {
    assert.deepEqual(await readPhotoFinderModes(stub([{ value }]).q), ALL_LEGACY, `value ${JSON.stringify(value)}`);
  }
});

test('switch: a read error or a missing intake.settings table reads as all legacy and never throws', async () => {
  assert.deepEqual(await readPhotoFinderModes(stub(new Error('relation "intake.settings" does not exist')).q), ALL_LEGACY);
  assert.deepEqual(await readPhotoFinderModes(stub(new Error('connection terminated')).q), ALL_LEGACY);
});

test('photoFinderMode: one type, legacy unless the modes say shared', () => {
  assert.equal(photoFinderMode({ ...ALL_LEGACY, gtn: 'shared' }, 'gtn'), 'shared');
  assert.equal(photoFinderMode({ ...ALL_LEGACY, gtn: 'shared' }, 'md'), 'legacy');
  assert.equal(photoFinderMode(null, 'lfd'), 'legacy');
  assert.equal(photoFinderMode(undefined, 'carousel'), 'legacy');
  assert.equal(photoFinderMode({ lfd: 'weird' } as unknown as PhotoFinderModes, 'lfd'), 'legacy');
});
