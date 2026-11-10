/**
 * reels.idea_sources_v and the Reels readers moved onto it (central intake Phase 2, Owner E), offline on PGlite
 * (reels + intake schemas + db/reels_intake_views.sql). Two databases:
 * - legacy only: every reader returns what it returned when it joined post_idea_members ⋈ sources (parity);
 * - legacy + intake: legacy ideas unchanged, intake ideas read from intake.items (incl. a merged chain).
 * No model, no network: the meme lab's intake lanes are stubbed.
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import type { LfdCandidate } from '@/lib/lfd/types';
import { listCandidates } from '@/lib/memes/lfd-source';
import { fillStories } from '@/lib/memes/lfd-sim/fill';
import { loadPerformancePage } from '@/lib/reels/analytics/performance-store';
import { loadPublishedStoryKeys, recentPublishedHeadlines, storyUrlKey } from '@/lib/reels/copy/held-out';
import { loadCopyTargets } from '@/lib/reels/copy/store';
import { loadHealthPage } from '@/lib/reels/health';
import { loadReelsInsights } from '@/lib/reels/insights';
import { loadIdeaMaterial, loadSlateRanked, loadSlates, slateIdeaIds } from '@/lib/reels/scoring/store';
import { loadTarget, memberBucket } from '@/lib/reels/visual/run';
import { loadVideoTarget } from '@/lib/reels/visual/video-run';
import { knownUrlsFor } from '@/lib/revisions/descriptions/text-on-screen';
import type { HubQuery } from '@/lib/social-hub/db';
import { REEL_FACTS_SQL, REEL_IDEAS_SQL, REEL_SOURCES_SQL } from '@/lib/social-hub/queries/reels';

import { F, openIdeaSourcesDb, seedIntake, seedLegacy, seedPublished, seedSlate } from './fixtures/reels-idea-sources';

const sorted = <T>(xs: T[]) => [...xs].sort();
const hubQ = (pg: PGlite): HubQuery => async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as never[] });

const LEGACY_IL = ['Legacy primary', 'Legacy supporting', 'Legacy duplicate'];
const INTAKE_ROOT = ['Intake primary', 'Intake feed-first', 'Intake search find', 'Moved from M1', 'Moved from M2', 'Intake old row'];

/** Every reader's view of the two legacy ideas. Asserted on both databases: intake rows never change them. */
async function assertLegacyReaders(pg: PGlite): Promise<void> {
  const q = hubQ(pg);
  // Social Hub
  const facts = await q<{ post_idea_id: string; headline: string }>(REEL_FACTS_SQL, [[F.IL, F.ISEED], [F.VID_L, null]]);
  assert.deepEqual(facts.rows.map((r) => [r.post_idea_id, r.headline]), [[F.IL, 'Legacy primary'], [F.ISEED, 'Legacy seed']]);
  const sources = await q<{ post_idea_id: string; url: string; headline: string }>(REEL_SOURCES_SQL, [[F.IL, F.ISEED]]);
  assert.deepEqual(sorted(sources.rows.map((r) => `${r.post_idea_id === F.IL ? 'IL' : 'SEED'} ${r.url} ${r.headline}`)), [
    'IL https://legacy.test/1 Legacy primary', 'IL https://legacy.test/2 Legacy supporting', 'SEED https://legacy.test/seed Legacy seed',
  ]);
  const ideas = await q<{ post_idea_id: string; headline: string; yours: boolean }>(REEL_IDEAS_SQL);
  const byId = new Map(ideas.rows.map((r) => [r.post_idea_id, r]));
  assert.equal(byId.get(F.IL)?.headline, 'Legacy primary');
  assert.equal(byId.get(F.IL)?.yours, false);
  assert.equal(byId.get(F.ISEED)?.headline, 'Legacy seed');
  assert.equal(byId.get(F.ISEED)?.yours, true, 'a legacy seed (adapter seed, drop_reason seed) is yours');

  // Scoring store
  const material = await loadIdeaMaterial([F.IL]);
  assert.deepEqual(material[0]!.members.map((m) => [m.role, m.sourceName, m.headline, m.body]), [
    ['primary', 'Hacker News', 'Legacy primary', 'Body one'],
    ['supporting', 'TechCrunch', 'Legacy supporting', 'Body two'],
    ['merged_duplicate', 'The Verge', 'Legacy duplicate', 'Body three'],
  ]);
  assert.ok(!(await slateIdeaIds(F.NY_DATE)).includes(F.ISEED), 'a seed is never re-scored as timely');
  assert.ok((await slateIdeaIds(F.NY_DATE)).includes(F.IL));
  assert.ok(!(await loadSlateRanked(F.NY_DATE)).some((r) => r.id === F.ISEED), 'a seed is never a carryover');
  const scores = (await loadSlates([F.SLATE])).get(F.SLATE)!.scores;
  const il = scores.find((s) => s.postIdeaId === F.IL)!;
  assert.deepEqual(il.headlines, LEGACY_IL);
  assert.equal(il.yours, false);
  assert.equal(scores.find((s) => s.postIdeaId === F.ISEED)!.yours, true);

  // Copy writer
  const targets = await loadCopyTargets(F.SLATE, { postIdeaId: F.IL });
  assert.deepEqual(targets[0]!.members.map((m) => [m.role, m.url, m.citationUrls, m.author, m.byline, m.publishTime != null]), [
    ['primary', 'https://legacy.test/1', ['https://cite.test/a'], 'Ann', 'by Ann', true],
    ['supporting', 'https://legacy.test/2', [], null, null, false],
    ['merged_duplicate', 'https://legacy.test/3', [], null, null, false],
  ]);

  // Frame and video stages
  const target = await loadTarget(F.SLATE, F.IL);
  assert.deepEqual(target!.members.map((m) => [m.role, m.sourceName, m.headline, m.sourceBucket]), [
    ['primary', 'Hacker News', 'Legacy primary', 'A'],
    ['supporting', 'TechCrunch', 'Legacy supporting', 'B'],
    ['merged_duplicate', 'The Verge', 'Legacy duplicate', 'B'],
  ]);
  const video = await loadVideoTarget(F.VID_L);
  assert.equal(video?.postIdeaId, F.IL);

  // Text on Screen: the copy's known URLs
  assert.deepEqual(await knownUrlsFor(q, F.IL), ['https://legacy.test/1', 'https://cite.test/a', 'https://legacy.test/2', 'https://legacy.test/3']);
}

async function assertPublishedLegacy(pg: PGlite, extra: { headlines: string[]; hackerNews: number; insights: string[] }): Promise<void> {
  const keys = await loadPublishedStoryKeys();
  assert.ok(keys.ideaIds.has(F.IL));
  for (const url of ['https://legacy.test/1', 'https://cite.test/a', 'https://legacy.test/2', 'https://legacy.test/3']) {
    assert.ok(keys.urls.has(storyUrlKey(url)!), url);
  }
  assert.deepEqual(sorted(await recentPublishedHeadlines()), sorted(['Legacy primary', ...extra.headlines]));
  const health = await loadHealthPage();
  const published = new Map(health.sources.map((s) => [s.id, s.published]));
  assert.equal(published.get('hacker-news'), extra.hackerNews);
  assert.equal(published.get('the-verge-ai'), 1);
  const insights = await loadReelsInsights();
  assert.deepEqual(sorted(insights.recentErrors.map((e) => e.headline ?? '')), sorted(['Legacy primary', ...extra.insights]));
  await loadPerformancePage({}); // its headline lateral runs on the view (no publish attempts here: no rows)
  void pg;
}

describe('legacy rows only (parity)', () => {
  let pg: PGlite;
  before(async () => {
    pg = await openIdeaSourcesDb();
    await seedLegacy(pg);
    await seedSlate(pg, [F.IL, F.ISEED]);
  });
  after(async () => pg.close());

  test('the view legacy branch equals post_idea_members ⋈ sources, column for column', async () => {
    const view = await pg.query(
      `SELECT post_idea_id, member_key, url, headline, body, source_name, adapter_id, role, publish_time, ingest_time, drop_reason,
              joined_at, author, byline, citation_urls, bucket
         FROM reels.idea_sources_v ORDER BY member_key`,
    );
    const join = await pg.query(
      `SELECT m.post_idea_id, s.id::text AS member_key, s.canonical_url AS url, s.headline, s.body, s.source_name, s.adapter_id, m.role,
              s.publish_time, s.ingest_time, s.drop_reason, m.joined_at, s.author, s.byline, s.citation_urls, s.bucket
         FROM reels.post_idea_members m JOIN reels.sources s ON s.id = m.source_id ORDER BY s.id::text`,
    );
    assert.equal(view.rows.length, 4);
    assert.deepEqual(view.rows, join.rows);
    const meta = await pg.query<{ origin: string; family: string; seeded: boolean; member_key: string }>(
      `SELECT origin, family, seeded, member_key FROM reels.idea_sources_v ORDER BY member_key`,
    );
    assert.ok(meta.rows.every((r) => r.origin === 'legacy'));
    assert.deepEqual(meta.rows.map((r) => [r.family, r.seeded]), [['reels', false], ['reels', false], ['reels', false], ['seed', true]]);
  });

  test('every moved reader returns what it returned on the old join', async () => {
    await assertLegacyReaders(pg);
  });

  test('published readers (held-out, health, insights, performance)', async () => {
    await seedPublished(pg, [F.IL]);
    await assertPublishedLegacy(pg, { headlines: [], hackerNews: 1, insights: [] });
  });
});

describe('legacy + intake rows', () => {
  let pg: PGlite;
  before(async () => {
    pg = await openIdeaSourcesDb();
    await seedLegacy(pg);
    await seedIntake(pg);
    await seedSlate(pg, [F.IL, F.ISEED, F.ROOT, F.OTHER]);
  });
  after(async () => pg.close());

  test('the view: Reels-kept intake members, the merged chain, seeds, legacy untouched', async () => {
    const members = async (idea: string) =>
      (await pg.query<{ member_key: string }>(`SELECT member_key FROM reels.idea_sources_v WHERE post_idea_id = $1 ORDER BY member_key`, [idea]))
        .rows.map((r) => r.member_key.replace('https://in.test/', ''));
    assert.deepEqual(await members(F.ROOT), ['k1', 'k2', 'k5', 'k6', 'k7', 'k8'], 'feeds-only k3 and reels-dropped k4 are not Reels members');
    assert.deepEqual(await members(F.M1), ['k1', 'k2', 'k5', 'k6', 'k7', 'k8'], 'a merged-away id reads the items of the end of its chain');
    assert.deepEqual(await members(F.M2), ['k1', 'k2', 'k5', 'k6', 'k7', 'k8'], 'M2 → M1 → ROOT: the root, two hops on');
    const ids = (await pg.query<{ id: string }>(`SELECT DISTINCT post_idea_id::text AS id FROM reels.idea_sources_v WHERE member_key = 'https://in.test/k7'`)).rows.map((r) => r.id);
    assert.deepEqual(sorted(ids), sorted([F.ROOT, F.M1, F.M2]), 'the merged ids read the root items under their own id');
    assert.deepEqual(await members(F.OTHER), ['k9'], 'an LFD seed is not a Reels member');
    assert.equal((await members(F.IL)).length, 3);

    const { rows } = await pg.query<Record<string, unknown>>(
      `SELECT member_key, adapter_id, family, role, drop_reason, origin, seeded, bucket, url, source_name, citation_urls
         FROM reels.idea_sources_v WHERE post_idea_id = ANY($1::uuid[]) ORDER BY member_key`,
      [[F.ROOT, F.OTHER]],
    );
    const by = new Map(rows.map((r) => [String(r.member_key).replace('https://in.test/', ''), r]));
    assert.deepEqual([...by.keys()], ['k1', 'k2', 'k5', 'k6', 'k7', 'k8', 'k9']);
    assert.ok(rows.every((r) => r.origin === 'intake' && r.drop_reason === null && r.bucket === null));
    assert.deepEqual(
      [...by.entries()].map(([k, r]) => [k, r.adapter_id, r.family, r.seeded]),
      [
        ['k1', 'hacker-news', 'reels', false],
        ['k2', 'techcrunch', 'feeds', false],
        ['k5', 'search:b6', 'search', false],
        ['k6', 'github-trending', 'reels', false],
        ['k7', 'hf-daily-papers', 'reels', false],
        ['k8', 'hf-daily-papers', 'reels', false],
        ['k9', 'seed:reels', 'seed', true],
      ],
    );
    assert.deepEqual(by.get('k1')!.citation_urls, ['https://cite.test/b']);
  });

  test('legacy ideas read exactly as on the legacy-only database', async () => {
    await assertLegacyReaders(pg);
  });

  test('intake ideas: Social Hub, scoring, copy, frame, video and Text on Screen read intake members', async () => {
    const q = hubQ(pg);
    const facts = await q<{ post_idea_id: string; headline: string }>(REEL_FACTS_SQL, [[F.ROOT], [F.VID_I]]);
    assert.equal(facts.rows[0]!.headline, 'Intake primary');
    const sources = await q<{ url: string }>(REEL_SOURCES_SQL, [[F.ROOT]]);
    assert.deepEqual(sorted(sources.rows.map((r) => r.url.replace('https://in.test/', ''))), ['k1', 'k2', 'k5', 'k7', 'k8'], 'merged_duplicate k6 left out');
    const ideas = new Map((await q<{ post_idea_id: string; headline: string; yours: boolean }>(REEL_IDEAS_SQL)).rows.map((r) => [r.post_idea_id, r]));
    assert.equal(ideas.get(F.ROOT)?.headline, 'Intake primary');
    assert.equal(ideas.get(F.ROOT)?.yours, false);
    assert.equal(ideas.get(F.OTHER)?.yours, true, 'an intake Reels seed is yours');
    assert.equal(ideas.get(F.OTHER)?.headline, 'Intake reels seed');

    const material = await loadIdeaMaterial([F.ROOT]);
    assert.deepEqual(material[0]!.members.map((m) => m.headline), INTAKE_ROOT);
    const ids = await slateIdeaIds(F.NY_DATE);
    assert.ok(ids.includes(F.ROOT) && !ids.includes(F.OTHER), 'the intake seed is not re-scored as timely');
    assert.ok(!(await loadSlateRanked(F.NY_DATE)).some((r) => r.id === F.OTHER));
    const scores = (await loadSlates([F.SLATE])).get(F.SLATE)!.scores;
    assert.deepEqual(scores.find((s) => s.postIdeaId === F.ROOT)!.headlines, INTAKE_ROOT);
    assert.equal(scores.find((s) => s.postIdeaId === F.OTHER)!.yours, true);

    const target = (await loadCopyTargets(F.SLATE, { postIdeaId: F.ROOT }))[0]!;
    assert.deepEqual(target.members.map((m) => m.headline), INTAKE_ROOT);
    assert.deepEqual(target.members[0]!.citationUrls, ['https://cite.test/b']);
    assert.equal(target.members[0]!.author, 'Bo');

    const frame = await loadTarget(F.SLATE, F.ROOT);
    assert.deepEqual(frame!.members.map((m) => m.sourceBucket), ['A', 'B', 'B', 'A', 'A', 'A'], 'buckets from the adapter registry');
    assert.equal((await loadVideoTarget(F.VID_I))?.postIdeaId, F.ROOT);
    assert.deepEqual((await knownUrlsFor(q, F.ROOT)).map((u) => u.replace('https://in.test/', '')), [
      'k1', 'https://cite.test/b', 'k2', 'k5', 'k7', 'k8', 'k6',
    ]);
  });

  test('a published reel merged into another story still reads that story: its members and headline', async () => {
    // M1 was a published reel (its own registry row) before the intake merged it into ROOT.
    await pg.exec(`INSERT INTO reels.post_ideas (id) VALUES ('${F.M1}') ON CONFLICT DO NOTHING;
                   INSERT INTO reels.published_status (post_idea_id, published) VALUES ('${F.M1}', true) ON CONFLICT DO NOTHING;`);
    const q = hubQ(pg);
    const sources = await q<{ post_idea_id: string; url: string }>(REEL_SOURCES_SQL, [[F.M1]]);
    assert.ok(sources.rows.every((r) => r.post_idea_id === F.M1));
    assert.deepEqual(sorted(sources.rows.map((r) => r.url.replace('https://in.test/', ''))), ['k1', 'k2', 'k5', 'k7', 'k8']);
    const facts = await q<{ post_idea_id: string; headline: string }>(REEL_FACTS_SQL, [[F.M1], [null]]);
    assert.deepEqual(facts.rows.map((r) => [r.post_idea_id, r.headline]), [[F.M1, 'Intake primary']]);
    assert.deepEqual((await loadIdeaMaterial([F.ROOT]))[0]!.members.map((m) => m.headline), INTAKE_ROOT, 'the surviving id reads its own items');
    await pg.exec(`DELETE FROM reels.published_status WHERE post_idea_id = '${F.M1}'; DELETE FROM reels.post_ideas WHERE id = '${F.M1}';`);
  });

  test('published intake ideas reach held-out, health and insights', async () => {
    await seedPublished(pg, [F.IL, F.ROOT]);
    await assertPublishedLegacy(pg, { headlines: ['Intake primary'], hackerNews: 2, insights: ['Intake primary'] });
    const keys = await loadPublishedStoryKeys();
    assert.ok(keys.ideaIds.has(F.ROOT));
    assert.ok(keys.urls.has(storyUrlKey('https://in.test/k5')!));
  });
});

test('memberBucket: legacy keeps its bucket; intake rows take the registry, deposits and seeds fall back', () => {
  assert.equal(memberBucket('B', 'hacker-news'), 'B');
  assert.equal(memberBucket(null, 'hacker-news'), 'A');
  assert.equal(memberBucket(null, 'techcrunch'), 'B');
  assert.equal(memberBucket(null, 'search:b6'), 'B');
  assert.equal(memberBucket(null, 'search:a4'), 'A');
  assert.equal(memberBucket(null, 'seed:reels'), 'A');
});

// ── Meme lab ───────────────────────────────────────────────────────────────

const cand = (key: string, origin: LfdCandidate['origin']): LfdCandidate =>
  ({ key, refs: [key], origin, headline: `H ${key}`, sourceName: 'S', url: `https://x.test/${key}`, body: '', publishedAt: null, net: null, blockbuster: 0 }) as LfdCandidate;

test('meme lab listCandidates: intake lanes when LFD reads the intake, today\'s lanes otherwise or on a read error', async () => {
  const seen: string[] = [];
  // A hub with no lfd/reels/social rows: today's lanes read it and find nothing.
  const hub: HubQuery = async (text) => {
    seen.push(text.trim().split(/\s+/).slice(0, 3).join(' '));
    return { rows: [] };
  };
  const lanes = async () => ({ reels: [cand('a', 'reels'), cand('b', 'reels')], carousel: [cand('b', 'carousel'), cand('c', 'carousel')] });
  const intake = await listCandidates(hub, new Date('2026-11-09T12:00:00Z'), { mode: async () => 'intake', intakeLanes: lanes });
  assert.deepEqual(intake.map((s) => [s.id, s.origin]), [['a', 'reels'], ['b', 'reels'], ['c', 'carousel']]);

  let asked = false;
  for (const mode of ['legacy', 'stale-fallback'] as const) {
    const out = await listCandidates(hub, new Date('2026-11-09T12:00:00Z'), { mode: async () => mode, intakeLanes: async () => { asked = true; return lanes(); } });
    assert.deepEqual(out, []);
  }
  assert.equal(asked, false, 'legacy and stale-fallback never read the intake');
  const failed = await listCandidates(hub, new Date('2026-11-09T12:00:00Z'), { mode: async () => 'intake', intakeLanes: async () => { throw new Error('down'); } });
  assert.deepEqual(failed, [], 'an intake read error falls back to today\'s lanes');
  assert.ok(seen.length > 0);
});

test('lfd-sim fillStories finds a story the intake holds when reels.sources has none', async () => {
  const pg = await openIdeaSourcesDb();
  try {
    await seedLegacy(pg);
    await seedIntake(pg);
    // Stop right after the lookup: the lab database's first read throws, so nothing is written and no model is asked.
    const local = { query: async () => { throw new Error('STOP after lookup'); } };
    const jev = (async () => { throw new Error('no model'); }) as never;
    await assert.rejects(
      fillStories({ db: local as never, hub: hubQ(pg), jev, briefs: async () => 0, kickMemes: () => undefined, by: 't' }, ['https://legacy.test/1', 'https://in.test/k5']),
      /STOP after lookup/,
      'both URLs are found (legacy source, intake item)',
    );
    await assert.rejects(
      fillStories({ db: local as never, hub: hubQ(pg), jev, briefs: async () => 0, kickMemes: () => undefined, by: 't' }, ['https://nowhere.test/x']),
      /Not in the Hub: https:\/\/nowhere\.test\/x/,
    );
  } finally {
    await pg.close();
  }
});
