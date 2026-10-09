/**
 * P1-M2 read model: real SELECTs against PGlite loaded with the real schema
 * files, then the adapters; and hub factor groups vs Trial Reels' own.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { reelFactorValues } from '@/lib/social-hub/adapters/reels';
import { setMetrics } from '@/lib/social-hub/adapters/stories';
import { buildDataset, findPost, type HubDataset } from '@/lib/social-hub/dataset';
import { factorsFor, groupPosts, THIN_SAMPLE } from '@/lib/social-hub/factors';
import { hubId } from '@/lib/social-hub/ids';
import { readAll } from '@/lib/social-hub/load';
import type { HubPost } from '@/lib/social-hub/types';
import {
  FACTOR_OPTIONS,
  factorGroups,
  THIN_SAMPLE as REELS_THIN,
  type PerformanceReel,
} from '@/lib/reels/analytics/performance';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { IDS, seedHubFixture } from './fixtures/social-hub/seed';

let cached: Promise<HubDataset> | null = null;
function dataset(): Promise<HubDataset> {
  cached ??= (async () => {
    const { pg, query } = await openHubTestDb();
    await seedHubFixture(pg);
    return buildDataset(await readAll(query), null, new Date('2026-10-08T12:00:00Z'));
  })();
  return cached;
}

/** By id, or by an older id the lifecycle view kept as an alias (D46): old links still open the post. */
const byId = (d: HubDataset, id: string) => {
  const post = findPost(d, id);
  assert.ok(post, `missing ${id}; have ${d.posts.map((p) => p.id).join(', ')}`);
  return post;
};

test('every vertical reads without error from the real schemas', async () => {
  const d = await dataset();
  assert.deepEqual(d.errors, []);
  const verticals = new Set(d.posts.map((p) => p.vertical));
  assert.deepEqual([...verticals].sort(), ['carousels', 'explainers', 'reels', 'stories']);
});

test('Trial Reels: published attempt, scheduled slot, cancelled-unapproved slot', async () => {
  const d = await dataset();
  const pub = byId(d, hubId('reels', 'attempt', IDS.reelAttempt));
  assert.equal(pub.status, 'published');
  assert.equal(pub.name, 'The model nobody saw coming');
  assert.equal(pub.description, 'OpenAI ships a new model');
  assert.equal(pub.nyDate, '2026-10-06');
  assert.equal(pub.metrics.views, 250, 'latest totals (SH-10)');
  assert.equal(pub.history.length, 2);
  assert.equal(pub.media.kind === 'video' && pub.media.src, `/api/reels/video/${IDS.video1}`);
  assert.deepEqual(pub.factorValues.psychology, { kind: 'category', key: 'curiosity', label: 'Curiosity' });
  assert.deepEqual(pub.factorValues.hook, { kind: 'category', key: 'glitch', label: 'Glitch' });
  assert.deepEqual(pub.factorValues.sound, { kind: 'category', key: 'off', label: 'No hook sound' });
  assert.deepEqual(pub.factorValues.lane, { kind: 'category', key: 'knowledge', label: 'Knowledge lane' });
  assert.equal(pub.approval.approvedAt, '2026-10-06T11:00:00.000Z');
  assert.equal(pub.slot?.id, 'morning');

  const scheduled = byId(d, hubId('reels', 'schedule', IDS.reelSched2));
  assert.equal(scheduled.status, 'scheduled');
  assert.equal(scheduled.approval.required, true);
  assert.equal(scheduled.approval.approvedAt, null);
  assert.equal(scheduled.nyDate, '2026-10-07');

  const cancelled = byId(d, hubId('reels', 'schedule', IDS.reelSched3));
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.statusNote, 'Not approved before its slot');
  // The attempted slot is not listed twice.
  assert.equal(d.posts.some((p) => p.id === hubId('reels', 'schedule', IDS.reelSched1)), false);
});

test('Explainers: published render, a newer render as Content ready with version history', async () => {
  const d = await dataset();
  const pub = byId(d, hubId('explainers', 'attempt', IDS.expAttempt));
  assert.equal(pub.name, 'What is a webhook?');
  assert.equal(pub.metrics.views, 400);
  assert.equal(pub.approval.note, 'Approved');
  assert.deepEqual(pub.factorValues.reviewTags, { kind: 'tags', values: [{ key: 'hook', label: 'Hook' }, { key: 'pacing', label: 'Pacing' }], empty: 'No tags' });
  assert.equal(pub.media.kind === 'video' && pub.media.src, `/api/explainers/artifacts/${IDS.art1}`);
  assert.equal(pub.versions.length, 2);
  assert.equal(pub.versions.find((v) => v.current)?.id, IDS.job2, 'newest render is current (contract versioning rule)');

  const ready = byId(d, hubId('explainers', 'job', IDS.job2));
  assert.equal(ready.status, 'ready');
  assert.equal(ready.statusNote, 'Waiting for review');
  const ideas = d.ideas.filter((i) => i.vertical === 'explainers');
  assert.equal(ideas.find((i) => i.title === 'What is a webhook?')?.state, 'published');
  assert.equal(ideas.find((i) => i.title === 'Why databases need primary keys')?.state, 'idea_only');
});

test('Carousels: published post with checks and photo sources; review post is Content ready', async () => {
  const d = await dataset();
  const pub = byId(d, hubId('carousels', 'attempt', IDS.socAttempt));
  assert.equal(pub.status, 'published');
  assert.equal(pub.description, 'Crusoe raised $3.9B.');
  assert.equal(pub.metrics.shares, 22);
  assert.equal(pub.media.kind === 'slides' && pub.media.slides.length, 3);
  assert.deepEqual(pub.factorValues.hook, { kind: 'category', key: 'on', label: 'Hook pass on' });
  assert.deepEqual(pub.factorValues.photos, { kind: 'tags', values: [{ key: 'logo', label: 'Logo' }, { key: 'wikimedia', label: 'Wikimedia' }], empty: 'No photo record' });
  assert.deepEqual(pub.reviewNotes, ['Warning: Slide 3 text is tight', 'Fixed: Dash removed']);
  assert.equal(pub.costItemKey, 'carousels:story:story-1');

  const ready = byId(d, hubId('carousels', 'post', IDS.socPost2));
  assert.equal(ready.status, 'ready');
  assert.equal(ready.approval.required, true);
  const ideas = d.ideas.filter((i) => i.vertical === 'carousels');
  assert.deepEqual(ideas.map((i) => [i.title, i.state, i.hasContent]), [
    ['Crusoe raises $3.9B', 'published', true],
    ['Newsom pushes an AI kill switch', 'content_ready', true],
    ['Unused candidate', 'idea_only', false],
  ]);
});

test('IG Stories: a set is one post; completion and frame 1–3 exits match the Stories plan', async () => {
  const d = await dataset();
  const set = byId(d, hubId('stories', 'set', IDS.set1));
  assert.equal(set.name, 'Morning Download: OpenAI ships a new model');
  assert.equal(set.media.kind === 'frames' && set.media.frames.length, 3);
  assert.equal(set.metrics.reach, 100, 'first-frame reach');
  assert.equal(set.metrics.completion, 0.6, 'last ÷ first reach');
  assert.equal(set.metrics.exitsFirst3, 17);
  assert.equal(set.metrics.views, 257);
  assert.equal(set.history.length, 2, 'one snapshot per New York day');
  assert.equal(set.history[0]!.metrics.reach, 70);
  assert.deepEqual(set.factorValues.origins, { kind: 'tags', values: [{ key: 'reels', label: 'Text on Screen' }], empty: 'No chosen items' });

  const ready = byId(d, hubId('stories', 'set', IDS.set2));
  assert.equal(ready.status, 'ready');
  assert.equal(ready.approval.required, true);
  assert.equal(d.ideas.find((i) => i.vertical === 'stories')?.title, 'How many tokens fit in a context window?');
});

test('Stories set metrics: blanks stay blank, single frame, no insight', () => {
  assert.deepEqual(setMetrics([]), {});
  const one = setMetrics([{ seq: 1, insight: { reach: 0, exits: null } as never }]);
  assert.equal(one.completion, null, 'zero first-frame reach gives no completion');
  assert.equal(one.exitsFirst3, 0);
  assert.equal(one.views, null);
});

test('Sources: one article used by all four verticals dedupes to one row', async () => {
  const d = await dataset();
  const a = d.sources.find((s) => s.url.includes('example.com/a'));
  assert.ok(a);
  assert.deepEqual([...a.verticals].sort(), ['carousels', 'explainers', 'reels', 'stories']);
  assert.equal(a.postIds.length >= 4, true);
  assert.equal(d.sources[0], a, 'most reused first');
});

test('a failing vertical degrades to an error note; the others still load', () => {
  const d = buildDataset({ reels: new Error('relation "reels.runs" does not exist'), explainers: new Error('x'), carousels: new Error('y'), stories: { sets: [], frames: [], insights: [], candidates: [] } });
  assert.equal(d.errors.length, 3);
  assert.deepEqual(d.posts, []);
});

// ── Group vs group equals Trial Reels on the same reels ──────────────────────

function lcg(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)]!;
}

function sameReels(n: number, seed: number): { reels: PerformanceReel[]; posts: HubPost[] } {
  const r = lcg(seed);
  const reels: PerformanceReel[] = [];
  const posts: HubPost[] = [];
  for (let i = 0; i < n; i++) {
    const metric = () => (r() < 0.15 ? null : Math.round(r() * 1000));
    const snapshot = {
      nyDate: '2026-10-01', views: metric(), reach: metric(), likes: metric(), comments: metric(), saved: metric(), shares: metric(),
      reposts: metric(), totalInteractions: metric(), avgWatchTimeMs: metric(), totalWatchTimeMs: metric(),
      skipRate: r() < 0.2 ? null : r(), sharedToFeed: null,
    };
    const facts = {
      framework: pick(r, ['curiosity', 'arousal', 'identity', null]),
      bucket: pick(r, ['ball_knowledge', 'the_number', 'the_saga', null]),
      blockbuster: pick(r, [true, false, null]),
      net: r() < 0.2 ? null : Math.round(r() * 50) / 10,
      origin: pick(r, ['timely', 'carryover', null]),
      slot: pick(r, ['morning', 'midday', 'evening', 'unscheduled']),
      color: pick(r, ['noir', 'paper', null]),
      hook: pick(r, ['glitch', 'vhs', 'none', null]),
      hookSound: pick(r, [true, false, null]),
      fullStory: pick(r, [true, false, null]),
      audioType: pick(r, ['music', 'original_sound', null]),
      genre: pick(r, ['Pop', 'Hip-Hop', ' ', null]),
    };
    const id = `a${i}`;
    reels.push({
      attemptId: id, mediaId: `m${i}`, postIdeaId: `i${i}`, videoJobId: null, finishedAt: `2026-10-0${1 + (i % 9)}T12:00:00Z`,
      permalink: null, title: `Reel ${i}`, subtitle: null, onScreenCopy: null, caption: null, songTitle: null, songArtist: null,
      genre: facts.genre, audioType: facts.audioType, slot: facts.slot, slotLabel: '', framework: facts.framework, bucket: facts.bucket,
      blockbuster: facts.blockbuster, net: facts.net, origin: facts.origin, color: facts.color, hook: facts.hook,
      hookSound: facts.hookSound, fullStory: facts.fullStory, graduationStrategy: null, metrics: snapshot, history: [snapshot],
    });
    const { nyDate: _nyDate, sharedToFeed: _shared, ...metrics } = snapshot;
    posts.push({
      id, vertical: 'reels', format: 'reel', metrics, factorValues: reelFactorValues(facts), costMicros: null,
      postedAt: reels[i]!.finishedAt,
    } as HubPost);
  }
  return { reels, posts };
}

test('group vs group equals Trial Reels factorGroups on the same reels, for every factor', () => {
  assert.equal(THIN_SAMPLE, REELS_THIN);
  for (const seed of [1, 7, 42]) {
    const { reels, posts } = sameReels(40, seed);
    for (const { id: factor } of FACTOR_OPTIONS) {
      const theirs = factorGroups(reels, factor);
      const ours = groupPosts(posts, factor, 'shares');
      assert.deepEqual(
        ours.map((g) => ({ key: g.key, label: g.label, count: g.count, thin: g.thin, views: g.means.views ?? null, skipRate: g.means.skipRate ?? null, watchMs: g.means.avgWatchTimeMs ?? null, shares: g.means.shares ?? null, saves: g.means.saved ?? null })),
        theirs.map((g) => ({ key: g.key, label: g.label, count: g.count, thin: g.thin, views: g.views, skipRate: g.skipRate, watchMs: g.watchMs, shares: g.shares, saves: g.saves })),
        `factor ${factor}, seed ${seed}`,
      );
    }
  }
});

test('groups under 3 posts stay visible and are marked thin (SH-09)', () => {
  const { posts } = sameReels(5, 3);
  const groups = groupPosts(posts, 'vertical', 'views');
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.thin, false);
  const small = groupPosts(posts.slice(0, 2), 'vertical', 'views');
  assert.equal(small[0]!.thin, true);
  assert.equal(small[0]!.count, 2);
});

test('tags put a post in each tag group; shared slot splits by vertical in a mixed view', async () => {
  const d = await dataset();
  const exp = d.posts.filter((p) => p.vertical === 'explainers' && p.status === 'published');
  const tags = groupPosts(exp, 'reviewTags', 'views');
  assert.deepEqual(tags.map((g) => g.key).sort(), ['hook', 'pacing']);
  const published = d.posts.filter((p) => p.status === 'published');
  const slots = groupPosts(published, 'slot', 'views').map((g) => g.key);
  assert.ok(slots.includes('reels:morning') && slots.includes('carousels:morning'), slots.join(','));
  assert.deepEqual(factorsFor(null).map((f) => f.id), ['vertical', 'format', 'slot']);
  assert.ok(factorsFor('stories').some((f) => f.id === 'series'));
});

test('regressions from the M2 critique: unlinked published slots, failed tries, unlinked photo rows', async () => {
  const { pg, query } = await openHubTestDb();
  await seedHubFixture(pg);
  // "Already published" slot with no attempt link: not a second post.
  await pg.exec(`INSERT INTO social_hub.schedule (vertical, idea_ref, ny_date, slot, publish_at, status, source)
                 VALUES ('reels', '${IDS.idea1}', '2026-10-05', 'evening', '2026-10-05T23:00:00Z', 'published', 'auto')`);
  // A failed try on the review carousel: it stays Content ready.
  await pg.exec(`INSERT INTO social_hub.content_items (id, vertical, format, native_ref, idea_ref)
                 VALUES ('30000000-0000-4000-8000-000000000042', 'carousels', 'feed', '${IDS.socPost2}', 'story-2');
                 INSERT INTO social_hub.approvals (content_item_id, decision, via) VALUES ('30000000-0000-4000-8000-000000000042', 'approved', 'force');
                 INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption, error)
                 VALUES ('30000000-0000-4000-8000-000000000042', 'carousels', 'force', 'failed', 'c', 'container error')`);
  // Photo rows the pipeline writes without post_id still count for the story.
  await pg.exec(`INSERT INTO social.used_photos (url, used_at, story_id, slide, source) VALUES ('https://img/9', '2026-10-06T07:31:00Z', 'story-2', 0, 'unsplash')`);
  const d = buildDataset(await readAll(query), null, new Date('2026-10-08T12:00:00Z'));
  assert.equal(d.posts.filter((p) => p.vertical === 'reels' && p.status === 'published').length, 1);
  // One post per content (D46): the failed try folds into the review carousel, which is Content ready again.
  const ready = findPost(d, hubId('carousels', 'post', IDS.socPost2))!;
  assert.equal(ready.id, hubId('carousels', 'content', IDS.socPost2), 'stable id: the post\'s own id');
  assert.equal(ready.status, 'ready');
  assert.equal(ready.statusNote, 'Last try failed: container error');
  assert.deepEqual(ready.tries?.map((t) => [t.status, t.note]), [['failed', 'container error']]);
  assert.equal(d.posts.some((p) => p.vertical === 'carousels' && p.status === 'failed'), false, 'no separate failed post for the same content');
  assert.deepEqual(ready.factorValues.photos, { kind: 'tags', values: [{ key: 'unsplash', label: 'Unsplash' }], empty: 'No photo record' });
  assert.equal(d.ideas.some((i) => i.vertical === 'reels' && i.state === 'content_ready'), false, 'SH-59');
});
