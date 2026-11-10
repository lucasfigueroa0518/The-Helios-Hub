/**
 * Morning Download's builder lane (Phase 1): in intake mode the build ranks by
 * the intake's stored major-news / story-builder scores (no build-time rank
 * call), one lead queue by margin, builders at most 2 of 5, at least 2. Legacy
 * mode is unchanged (the existing Morning Download tests in
 * stories-pipeline.test.ts cover it; one check here that it still asks Jev and
 * ignores stored scores). Offline: PGlite, stub Jev and writer.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMorningDownload, chooseLeads, chooseStories, MAX_BUILDERS } from '@/lib/stories/build/morning-download';
import { createStoriesJev } from '@/lib/stories/jev';
import { claimNextRequested, requestSet } from '@/lib/stories/repository';
import { BUILDER_BAR, MAJOR_NEWS_BAR } from '@/lib/stories/scores';
import { DEFAULT_SETTINGS } from '@/lib/stories/settings';
import type { StoryCandidate } from '@/lib/stories/sources/reels';

import { harnessDb, stubJev, stubPhotos, stubWriter } from './stories-harness';

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

async function mdDeps(intake: boolean, stories: StoryCandidate[]) {
  const { db } = await harnessDb();
  const { set } = await requestSet(db, { series: 'morning_download', nyDate: DATE, trigger: 'click', style: DEFAULT_SETTINGS.series.morning_download.style });
  await claimNextRequested(db);
  const jev = stubJev((k) => (k === 'supported' ? 0.9 : 0.1));
  const write = stubWriter({
    submit_headlines: (params) => {
      const m = /<material>\n([\s\S]*)\n<\/material>/.exec(String((params.messages as Array<{ content: string }>)[0]!.content));
      const items = JSON.parse(m![1]!) as Array<{ key: string; headline: string }>;
      return {
        stories: items.map((s) => ({ key: s.key, headline: `${s.headline} today. It matters.`, source_verb: 'via', source_name: 'Outlet', subjects: [], visual: { kind: 'thematic', query: 'q' }, alt_visuals: [] })),
        opener_visual: { kind: 'setting', query: 'office' },
      };
    },
  });
  const deps = {
    db, sourceDb: db, jev: createStoriesJev(jev, db), write, photos: stubPhotos(), settings: DEFAULT_SETTINGS, now: NOW, setId: set.id, nyDate: DATE,
    pool: { stories, numbers: [], unbriefed: [], leads: [] }, ...(intake ? { intake: true } : {}),
  };
  return { deps, jev };
}

test('Morning Download, intake mode: stored scores, no rank call, at most 2 builders', async () => {
  const { deps, jev } = await mdDeps(true, [...MAJORS, ...BUILDERS]);
  const r = await buildMorningDownload(deps);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(jev.calls.filter((c) => c.keys.includes('happened')).length, 0, 'no build-time major-news call');
  const keys = (r.payload.stories as Array<{ key: string }>).map((s) => s.key);
  assert.equal(keys.length, 5);
  assert.ok(keys.filter((k) => ['x.test/4', 'x.test/5', 'x.test/6'].includes(k)).length <= MAX_BUILDERS);
  assert.deepEqual(keys, ['x.test/0', 'x.test/4', 'x.test/1', 'x.test/5', 'x.test/2']);
});

test('Morning Download, intake mode: two candidates of one intake story merge in code, no same-event Jev call', async () => {
  const reelsSide = { ...cand(0, 0.9, null), key: 'r.test/0', origin: 'reels' as const, sourceName: 'Reels Outlet', blockbuster: 1 };
  const { deps, jev } = await mdDeps(true, [cand(0, 0.9, null), reelsSide, cand(1, 0.8, null)]);
  const r = await buildMorningDownload(deps);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(jev.calls.filter((c) => c.keys.includes('same_event')).length, 0);
  assert.deepEqual((r.payload.stories as Array<{ key: string }>).map((s) => s.key), ['x.test/0', 'x.test/1']);
});

test('Morning Download: an intake story shown under another member\'s link is used (every member key is checked, nit c)', async () => {
  const shownBefore = { ...cand(0, 0.9, null), intake: { ...cand(0, 0.9, null).intake!, memberKeys: ['x.test/0', 'old.test/same-event'] } };
  const { deps } = await mdDeps(true, [shownBefore, cand(1, 0.8, null), cand(2, 0.7, null)]);
  await deps.db.query(`INSERT INTO stories.history (series, key, shown_at) VALUES ('morning_download', 'old.test/same-event', $1)`, [new Date(NOW.getTime() - 86_400_000)]);
  const r = await buildMorningDownload(deps);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual((r.payload.stories as Array<{ key: string }>).map((s) => s.key), ['x.test/1', 'x.test/2']);
});

test('Morning Download, legacy mode: stored scores are ignored, the rank call runs as before', async () => {
  const { deps, jev } = await mdDeps(false, [...MAJORS, ...BUILDERS]);
  await buildMorningDownload(deps);
  assert.equal(jev.calls.filter((c) => c.keys.includes('happened')).length, 7, 'one major-news call per story');
});
