/**
 * Morning Download's old intake lead queue (chooseLeads: one queue by margin, builders at most 2 of 5, at least 2).
 * Since the locked news chain (2026-11-24) it is off the build path and kept for scripts/intake/replay.ts, so its
 * unit checks stay here. The build checks that remain describe intake mode on the chain: one intake story's two
 * sides merge in code, and a story shown under another member's link counts as ran. Offline: PGlite, stubs only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { BuildDeps } from '@/lib/stories/build/common';
import { buildMorningDownload, chooseLeads, chooseStories, MAX_BUILDERS } from '@/lib/stories/build/morning-download';
import { createStoriesJev } from '@/lib/stories/jev';
import { claimNextRequested, requestSet } from '@/lib/stories/repository';
import { BUILDER_BAR, MAJOR_NEWS_BAR } from '@/lib/stories/scores';
import { DEFAULT_SETTINGS } from '@/lib/stories/settings';
import type { StoryCandidate } from '@/lib/stories/sources/reels';

import { harnessDb, stubJev, stubPhotos, stubWriter } from './stories-harness';
import { newsStubs } from './stories-md-news-stubs';

const NOW = new Date('2026-11-09T08:00:00Z');
const DATE = '2026-11-09';
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf'];

function cand(i: number, major: number, builder: number | null): StoryCandidate {
  return {
    key: `x.test/${i}`, origin: 'carousel', ref: `https://x.test/${i}`, headline: `${NAMES[i]} story number ${i}`, sourceName: 'Outlet', url: `https://x.test/${i}`,
    body: `${NAMES[i]} body.`, publishedAt: NOW.toISOString(), nativeScore: 1, photo: null,
    intake: { storyId: `s${i}`, major, builder, eventDate: NOW.toISOString() },
  };
}

// 4 majors (margins .35 .25 .15 .05) and 3 builders (margins .30 .25 .20).
const MAJORS = [0.9, 0.8, 0.7, 0.6].map((m, i) => cand(i, m, 0.1));
const BUILDERS = [0.95, 0.9, 0.85].map((b, i) => cand(4 + i, 0.2, b));
const scored = (c: StoryCandidate) => ({ ...c, score: c.intake!.major! });

test('chooseLeads: lead queue by margin, at most 2 builders of 5', () => {
  assert.ok(MAJOR_NEWS_BAR === 0.55 && BUILDER_BAR === 0.65, 'fixture margins assume these bars');
  const chosen = chooseLeads([...MAJORS, ...BUILDERS].map(scored), NOW);
  assert.equal(chosen.length, 5);
  assert.deepEqual(chosen.map((c) => c.key), ['x.test/0', 'x.test/4', 'x.test/1', 'x.test/5', 'x.test/2']);
  assert.equal(chosen.filter((c) => (c.intake!.builder ?? 0) >= BUILDER_BAR).length, MAX_BUILDERS);
});

test('chooseLeads: fewer than 2 lead → the best major scores fill to 2; a stale builder does not lead', () => {
  const old = { ...cand(6, 0.1, 0.95), intake: { storyId: 's6', major: 0.1, builder: 0.95, eventDate: new Date(NOW.getTime() - 9 * 86_400_000).toISOString() } };
  const chosen = chooseLeads([cand(0, 0.3, null), cand(1, 0.6, null), cand(2, 0.4, null), old].map(scored), NOW);
  assert.deepEqual(chosen.map((c) => c.key), ['x.test/1', 'x.test/2']);
  // Same minimum rule as legacy chooseStories when nobody clears.
  assert.deepEqual(chooseLeads([cand(0, 0.3, null), cand(1, 0.2, null)].map(scored), NOW).length, chooseStories([{ score: 0.3 }, { score: 0.2 }]).length);
});

async function mdDeps(stories: StoryCandidate[]) {
  const { db } = await harnessDb();
  const { set } = await requestSet(db, { series: 'morning_download', nyDate: DATE, trigger: 'click', style: DEFAULT_SETTINGS.series.morning_download.style });
  await claimNextRequested(db);
  const jev = stubJev((k) => (k === 'supported' ? 0.9 : 0.1));
  // Every distinct headline in the pool, in pool order, top tier with a good photo.
  const stubs = await newsStubs([...new Set(stories.map((c) => c.headline))].map((headline) => ({ headline, top: true, photo: 'good' as const })));
  const deps: BuildDeps = {
    db, sourceDb: db, jev: createStoriesJev(jev, db), write: stubWriter({}), photos: stubPhotos(), settings: DEFAULT_SETTINGS, now: NOW, setId: set.id, nyDate: DATE,
    pool: { stories, leads: [] }, intake: true, news: stubs.news,
  };
  return { deps, jev, calls: stubs.calls };
}

test('Morning Download, intake mode: two candidates of one intake story merge in code, no same-event Jev call', async () => {
  const reelsSide = { ...cand(0, 0.9, null), key: 'r.test/0', origin: 'reels' as const, sourceName: 'Reels Outlet', blockbuster: 1 };
  const { deps, jev, calls } = await mdDeps([cand(0, 0.9, null), reelsSide, cand(1, 0.8, null)]);
  const r = await buildMorningDownload(deps);
  assert.equal(r.ok, true, r.ok ? '' : r.skip);
  if (!r.ok) return;
  assert.equal(jev.calls.filter((c) => c.keys.includes('same_event')).length, 0);
  assert.deepEqual((r.payload.stories as Array<{ key: string }>).map((s) => s.key), ['x.test/0', 'x.test/1']);
  // The chain saw one story for the intake story, carrying both sides' outlets.
  const turn = String((calls.rerank[0]!.messages as Array<{ content: string }>)[0]!.content);
  assert.equal([...turn.matchAll(/<story id=/g)].length, 2);
});

// Bald-Eagle D2: a story we ran goes through the development test; this row has no set (no headline we can
// compare against), so the story stays out exactly as under the old 3-day rule. tests/stories-md-development.test.ts
// covers it coming back.
test('Morning Download: an intake story shown under another member\'s link is recognized as ran (every member key is checked, nit c)', async () => {
  const shownBefore = { ...cand(0, 0.9, null), intake: { ...cand(0, 0.9, null).intake!, memberKeys: ['x.test/0', 'old.test/same-event'] } };
  const { deps } = await mdDeps([shownBefore, cand(1, 0.8, null), cand(2, 0.7, null)]);
  await deps.db.query(`INSERT INTO stories.history (series, key, shown_at) VALUES ('morning_download', 'old.test/same-event', $1)`, [new Date(NOW.getTime() - 86_400_000)]);
  const r = await buildMorningDownload(deps);
  assert.equal(r.ok, true, r.ok ? '' : r.skip);
  if (!r.ok) return;
  assert.deepEqual((r.payload.stories as Array<{ key: string }>).map((s) => s.key), ['x.test/1', 'x.test/2']);
});
