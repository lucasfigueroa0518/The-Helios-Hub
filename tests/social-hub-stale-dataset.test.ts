import assert from 'node:assert/strict';
import test from 'node:test';

import { dataNoteLines } from '@/components/social-hub/DataNotes';
import type { HubDataset } from '@/lib/social-hub/dataset';
import {
  finishDatasetLoad,
  preferDatasetAfterConnectFailure,
  resetHubDatasetMemory,
  STALE_DATASET_EMPTY,
  STALE_DATASET_NOTE,
} from '@/lib/social-hub/views/stale-dataset';

function dataset(over: Partial<HubDataset> = {}): HubDataset {
  return {
    posts: [],
    ideas: [],
    sources: [],
    errors: [],
    cost: null,
    costNotes: [],
    latestQuota: null,
    account: { present: false },
    loadedAt: '2026-10-27T12:00:00.000Z',
    ...over,
  };
}

const timeout = 'timeout exceeded when trying to connect';

test('a connect timeout keeps the last good read and says so once', () => {
  const previous = dataset({ posts: [{ id: 'p1' } as HubDataset['posts'][number]] });
  const failed = dataset({
    errors: [
      { vertical: 'reels', message: timeout },
      { vertical: 'stories', message: timeout },
    ],
  });
  const shown = preferDatasetAfterConnectFailure(failed, previous);
  assert.ok(shown);
  assert.equal(shown.posts[0]?.id, 'p1');
  assert.equal(shown.errors.length, 0);
  assert.equal(shown.staleNote, STALE_DATASET_NOTE);
  assert.deepEqual(dataNoteLines(shown), [STALE_DATASET_NOTE]);
});

test('a connect timeout with nothing saved is one note, not one line per pipeline', () => {
  const failed = dataset({
    errors: [
      { vertical: 'reels', message: timeout },
      { vertical: 'carousels', message: timeout },
    ],
  });
  const shown = preferDatasetAfterConnectFailure(failed, null);
  assert.ok(shown);
  assert.equal(shown.errors.length, 0);
  assert.equal(shown.staleNote, STALE_DATASET_EMPTY);
  assert.equal(dataNoteLines(shown).length, 1);
});

test('a real read error still shows', () => {
  const failed = dataset({
    errors: [
      { vertical: 'reels', message: timeout },
      { vertical: 'stories', message: 'relation "stories.sets" does not exist' },
    ],
  });
  assert.equal(preferDatasetAfterConnectFailure(failed, dataset()), null);
  assert.match(dataNoteLines(failed)[1] ?? '', /could not be read: relation/);
});

test('the isolate remembers a clean read and serves it after a later timeout', () => {
  resetHubDatasetMemory();
  finishDatasetLoad(dataset({ posts: [{ id: 'kept' } as HubDataset['posts'][number]] }));
  const shown = finishDatasetLoad(dataset({
    errors: [{ vertical: 'reels', message: timeout }],
  }));
  assert.equal(shown.posts[0]?.id, 'kept');
  assert.equal(shown.staleNote, STALE_DATASET_NOTE);
  resetHubDatasetMemory();
  const empty = finishDatasetLoad(dataset({
    errors: [{ vertical: 'reels', message: timeout }],
  }));
  assert.equal(empty.posts.length, 0);
  assert.equal(empty.staleNote, STALE_DATASET_EMPTY);
});
