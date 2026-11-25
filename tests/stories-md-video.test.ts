/**
 * Morning Download's media ladder (MD-LFD D16–D18) on the locked news chain (WC1, WC3, WC5) with a stubbed video
 * finder: a golden video shows over a photo, a photo over a good video, a good video saves a photo-less top-tier
 * story, a story with neither drops, and a golden video never carries a story past the top-tier stop.
 * Offline: PGlite, stubs only (tests/stories-md-news-stubs.ts).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { BuildDeps } from '@/lib/stories/build/common';
import { buildMorningDownload } from '@/lib/stories/build/morning-download';
import { createStoriesJev } from '@/lib/stories/jev';
import { claimNextRequested, requestSet } from '@/lib/stories/repository';
import { DEFAULT_SETTINGS } from '@/lib/stories/settings';
import type { StoryCandidate } from '@/lib/stories/sources/reels';

import { harnessDb, stubJev, stubPhotos, stubWriter } from './stories-harness';
import { newsStubs, type NewsScript } from './stories-md-news-stubs';

const NOW = new Date('2026-11-09T08:00:00Z');
const DATE = '2026-11-09';
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf'];
const headlineOf = (i: number) => `${NAMES[i]} story number ${i}`;

const cand = (i: number, major: number): StoryCandidate => ({
  key: `x.test/${i}`, origin: 'carousel', ref: `https://x.test/${i}`, headline: headlineOf(i), sourceName: 'Outlet', url: `https://x.test/${i}`,
  body: `${NAMES[i]} body.`, publishedAt: NOW.toISOString(), nativeScore: 1, photo: null,
  intake: { storyId: `s${i}`, major, builder: null, eventDate: NOW.toISOString() },
});

/** Scripts in rank order; story i is NAMES[i]. */
async function build(scripts: Array<Omit<NewsScript, 'headline'>>, o: { video: boolean }) {
  const { db } = await harnessDb();
  const { set } = await requestSet(db, { series: 'morning_download', nyDate: DATE, trigger: 'click', style: DEFAULT_SETTINGS.series.morning_download.style });
  await claimNextRequested(db);
  const stubs = await newsStubs(scripts.map((s, i) => ({ ...s, headline: headlineOf(i) })));
  const deps: BuildDeps = {
    db, sourceDb: db, jev: createStoriesJev(stubJev(), db), write: stubWriter({}), photos: stubPhotos(), settings: DEFAULT_SETTINGS, now: NOW, setId: set.id, nyDate: DATE,
    pool: { stories: scripts.map((_, i) => cand(i, 0.95 - i * 0.05)), leads: [] }, intake: true, news: stubs.news, ...(o.video ? { video: stubs.video } : {}),
  };
  return { r: await buildMorningDownload(deps), calls: stubs.calls };
}

test('Morning Download media ladder: golden over photo, photo over good video, good video saves a photo-less story, no media drops, golden never passes the top-tier stop', async () => {
  const { r, calls } = await build([
    { top: true, photo: 'good' }, // Alpha: photo
    { top: true, photo: 'good', video: 'good' }, // Bravo: has a photo, so its good video is not used
    { top: true, photo: 'none', video: 'good' }, // Charlie: no photo, its good video saves it
    { top: true, photo: 'none' }, // Delta: no media, drops
    { top: true, photo: 'good', video: 'golden' }, // Echo: golden video shows over its photo
    { top: false, photo: 'good', video: 'golden' }, // Foxtrot: past the top-tier stop, its golden video does not carry it (WC1)
  ], { video: true });
  assert.equal(r.ok, true, r.ok ? '' : r.skip);
  if (!r.ok) return;
  // All 6 are inside the check window, so the finder looked at each.
  assert.equal(calls.videoFound.length, 6);
  assert.deepEqual((r.payload.stories as Array<{ key: string }>).map((s) => s.key), ['x.test/0', 'x.test/1', 'x.test/2', 'x.test/4']);
  const stories = r.frames.map((f) => f.copy).filter((d) => d.role === 'story');
  const kinds = stories.map((d) => (d.role === 'story' ? (d.video ? `video:${d.video.tier}` : d.photo ? 'photo' : 'type') : ''));
  assert.deepEqual(kinds, ['photo', 'photo', 'video:good', 'video:golden']);
  assert.deepEqual(calls.videoStored, ['x.test/2', 'x.test/4']);
  const opener = r.frames[0]!.copy;
  assert.equal(opener.role === 'opener' ? opener.storyCount : 0, 4);
});

test('Morning Download without a video finder: photo-less stories drop, the day keeps its minimum of 2', async () => {
  const { r } = await build([{ top: true, photo: 'none' }, { top: true, photo: 'none' }, { top: true, photo: 'none' }], { video: false });
  assert.equal(r.ok, true, r.ok ? '' : r.skip);
  if (!r.ok) return;
  assert.deepEqual((r.payload.stories as Array<{ key: string }>).map((s) => s.key), ['x.test/0', 'x.test/1']);
  assert.ok(r.frames.filter((f) => f.role === 'story').every((f) => !('photo' in f.copy && f.copy.photo)), 'type frames');
});
