/**
 * LFD's shared photo finder helper (PHASE3-CONTRACT.md Owner B). The run itself uses the news photo finder since the
 * wiring contract (2026-11-24); findSharedLfdPhotos stays for the revisions screen. Offline: every engine stubbed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { BuilderHarvest } from '@/lib/lfd/photos';
import { findSharedLfdPhotos, type LfdSharedPhotos } from '@/lib/lfd/run';
import { PHOTO_PROFILES } from '@/lib/photos/profiles';
import type { PhotoDeps, PhotoNeed } from '@/lib/photos/types';

const NOW = new Date('2026-11-10T19:00:00Z');
const noNet = (async () => { throw new Error('no network in tests'); }) as unknown as typeof fetch;
const harvestDeps: BuilderHarvest['deps'] = { http: noNet, create: null, loadPrompt: () => '', serperKey: null, photoBank: null, cutouts: [] };
const photoDeps: PhotoDeps = { harvest: harvestDeps, now: () => NOW };

test('findSharedLfdPhotos never throws: an error leaves every story to today\'s chain, the reason traced', async () => {
  const s: LfdSharedPhotos = { profile: PHOTO_PROFILES.lfd, deps: photoDeps, find: async () => { throw new Error('boom'); }, need: () => ({}) as PhotoNeed };
  const items = [{ pick: { key: 'a' }, copy: {} }, { pick: { key: 'b' }, copy: {} }] as unknown as Parameters<typeof findSharedLfdPhotos>[1];
  const got = await findSharedLfdPhotos(s, items, new Set(), { usd: 0, capUsd: 0.3 });
  assert.deepEqual(got.photos, [null, null]);
  assert.deepEqual(got.traces, [['shared: failed: boom'], ['shared: failed: boom']]);
});
