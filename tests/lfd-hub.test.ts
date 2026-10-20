import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isPostingType, writePosting, type PostingState } from '@/lib/content-type/posting';
import { DEFAULT_LFD_DAYS, LFD_WINDOW } from '@/lib/lfd/config';
import { buildDataset } from '@/lib/social-hub/dataset';
import { reportLastFewDays } from '@/lib/social-hub/health/reporters/last-few-days';
import { parseHubId } from '@/lib/social-hub/ids';
import { readAll } from '@/lib/social-hub/load';
import { DEFAULT_DAY_QUOTAS } from '@/lib/social-hub/queries/day';
import { bookSlot, ensureContentItem, type SpineQuery } from '@/lib/social-hub/spine';
import { isVertical, TYPE_PAGE_IDS, typeHref, verticalInfo } from '@/lib/social-hub/verticals';
import { quotaCandidates } from '@/lib/social-hub/views/day-rank';
import { PLAN } from '@/lib/social-hub/views/plan';
import { poolStale } from '@/lib/social-hub/views/pools';

import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

/** Tuesday 2026-10-13, 8:00 AM New York. */
const TUE_8 = new Date('2026-10-13T12:00:00Z');

test('Last Few Days is the fifth type: its page, color, ids and plan window', () => {
  assert.ok(isVertical('last_few_days'));
  const info = verticalInfo('last_few_days');
  assert.deepEqual([info.label, info.short, info.format, info.colorVar, info.href], ['Last Few Days', 'LFD', 'feed', '--sh-v-last_few_days', '/last-few-days']);
  assert.ok(TYPE_PAGE_IDS.includes('last_few_days'));
  assert.equal(typeHref('last_few_days'), '/last-few-days');
  assert.equal(typeHref('last_few_days', '/social/preview'), '/social/preview/type/last_few_days');
  assert.equal(typeHref('carousels'), '/carousels');
  assert.match(readFileSync(path.join(process.cwd(), 'app/social-hub.css'), 'utf8'), /--sh-v-last_few_days: #e0529c;/);
  const id = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(parseHubId(`last_few_days:${id}`), { vertical: 'last_few_days', kind: 'content', ref: id });
  assert.deepEqual(PLAN.last_few_days.map((w) => [w.id, w.startMinute, w.endMinute, w.days]), [[LFD_WINDOW.id, LFD_WINDOW.startMinute, LFD_WINDOW.endMinute, [...DEFAULT_LFD_DAYS]]]);
});

test('a post in review reads as one ready post with its slides, caption, sources and review notes; once booked it is the same post', async () => {
  const { query } = await openHubTestDb();
  const id = await seedLfdPost(query, { short: true, fitProblems: ['slide 3 text fit: body 140px > 126px'], renderProblems: ['slide 5 image failed to load'] });
  let d = buildDataset(await readAll(query), null, TUE_8);
  assert.deepEqual(d.errors, []);
  let mine = d.posts.filter((p) => p.vertical === 'last_few_days');
  assert.equal(mine.length, 1);
  const post = mine[0]!;
  assert.equal(post.id, `last_few_days:${id}`);
  assert.equal(post.status, 'ready');
  assert.equal(post.format, 'feed');
  assert.match(post.name, /^Last Few Days · Tue, Oct 13$/);
  assert.equal(post.media.kind, 'slides');
  const slides = post.media.kind === 'slides' ? post.media.slides : [];
  assert.equal(slides.length, 8);
  assert.equal(slides[0]!.src, `/api/last-few-days/slides/${id}/0`);
  assert.equal(slides[1]!.headline, 'Anthropic Releases Claude Haiku 5.5');
  assert.match(post.description ?? '', /^Do you realize/);
  assert.deepEqual(post.sources.map((s) => [s.url, s.title]), [
    ['https://big.com/haiku', 'The Verge: Anthropic Releases Claude Haiku 5.5'],
    ['https://n.com/1', 'Wired: Niche Thing 1 Happens'],
    ['https://n.com/2', 'Wired: Niche Thing 2 Happens'],
  ]);
  assert.deepEqual(post.reviewNotes, ['Short post: only 3 stories.', 'Text fit: slide 3 text fit: body 140px > 126px', 'Render: slide 5 image failed to load']);
  assert.deepEqual(post.idea, { id: 'lfd:2026-10-13', label: 'Last Few Days for 2026-10-13' });
  assert.equal(post.costItemKey, `last_few_days:${id}`);
  assert.deepEqual(post.refs, { lfdPostId: id });

  const item = await ensureContentItem(query as SpineQuery, { vertical: 'last_few_days', format: 'feed', nativeRef: id, ideaRef: null });
  await bookSlot(query as SpineQuery, { vertical: 'last_few_days', itemId: item, nyDate: '2026-10-13', slot: 'morning', publishAt: new Date('2026-10-13T13:30:00Z'), source: 'auto' });
  d = buildDataset(await readAll(query), null, TUE_8);
  mine = d.posts.filter((p) => p.vertical === 'last_few_days');
  assert.deepEqual(mine.map((p) => [p.id, p.status, p.nyDate, p.slot?.id]), [[`last_few_days:${id}`, 'scheduled', '2026-10-13', 'morning']]);
  assert.equal(mine[0]!.approval.required, true, 'require_approval is on and the slot was booked automatically');
});

test('the latest run gives the Ideas view its picks, drops and queue, in post order', async () => {
  const { query } = await openHubTestDb();
  await query(`INSERT INTO lfd.runs (trigger, status, started_at, record) VALUES ('manual', 'ok', '2026-10-13T07:00:00Z', $1::jsonb)`, [JSON.stringify({
    window: { after: '2026-10-09', through: '2026-10-13' },
    picks: [{ key: 'k1', lane: 'major', headline: 'Pick One', major: 0.8, net: null }],
    drops: [{ key: 'k2', lane: 'rundown', headline: 'Dropped Two', reason: 'not-grounded' }],
    queues: { major: [{ key: 'k1', headline: 'Pick One', major: 0.8, net: null }], rundown: [{ key: 'k3', headline: 'Next Three', major: null, net: 0.7 }] },
  })]);
  const ideas = buildDataset(await readAll(query), null, TUE_8).ideas.filter((i) => i.vertical === 'last_few_days');
  assert.deepEqual(ideas.map((i) => [i.id, i.state]), [['last_few_days:story:k1', 'content_ready'], ['last_few_days:story:k2', 'retired'], ['last_few_days:story:k3', 'idea_only']]);
  assert.match(ideas[0]!.detail ?? '', /window 2026-10-09 → 2026-10-13/);
  assert.match(ideas[1]!.detail ?? '', /dropped: it failed the fact check twice/);
  assert.ok(ideas[0]!.score! > ideas[2]!.score!, 'post order is score order');
});

test('today’s Last Few Days card is today’s post on its days, and nothing on other days', async () => {
  const { query } = await openHubTestDb();
  const id = await seedLfdPost(query);
  const data = { ...buildDataset(await readAll(query), null, TUE_8), dayQuotas: DEFAULT_DAY_QUOTAS };
  assert.deepEqual(quotaCandidates(data, 'last_few_days', TUE_8).map((c) => [c.post?.id ?? null, c.idea, c.locked]), [[`last_few_days:${id}`, null, false]]);
  assert.deepEqual(quotaCandidates(data, 'last_few_days', new Date('2026-10-14T12:00:00Z')), []);
});

test('the health report counts its scheduled runs; its quota is one on its days only', async () => {
  const { query } = await openHubTestDb();
  await query(`INSERT INTO lfd.runs (trigger, status, requested_at, started_at, finished_at, total_usd, cap_usd, error)
               VALUES ('scheduled', 'failed', '2026-10-13T07:00:00Z', '2026-10-13T07:00:05Z', '2026-10-13T07:10:00Z', 0.3, 1, 'writing failed: refusal')`);
  const posting: PostingState = { type: 'last_few_days', live: false, generate: true, autoPublish: false, perDay: null, maxPerDay: null, series: null, days: [2, 5], schedule: null, nights: null };
  const tue = await reportLastFewDays(query, { night: '2026-10-13', posting, now: TUE_8 });
  assert.deepEqual([tue.vertical, tue.due, tue.ran, tue.made, tue.needed, tue.failures.length, tue.failures[0]!.stage], ['last_few_days', true, true, 0, 1, 1, 'run']);
  const wed = await reportLastFewDays(query, { night: '2026-10-14', posting, now: new Date('2026-10-14T12:00:00Z') });
  assert.deepEqual([wed.due, wed.needed], [false, 0]);
});

test('posting: Last Few Days is a posting type with no daily quota; its pool goes stale after five days, not three', async () => {
  assert.equal(isPostingType('last_few_days'), true);
  await assert.rejects(() => writePosting('last_few_days', { perDay: 1 }, 't'), /no daily quota/);
  const fourDaysAgo = new Date(TUE_8.getTime() - 4 * 86_400_000).toISOString();
  assert.equal(poolStale(fourDaysAgo, TUE_8), true);
  assert.equal(poolStale(fourDaysAgo, TUE_8, 'last_few_days'), false);
});

test('Last Few Days copy: the nightly switch names its days and its 3:00 AM run', async () => {
  const { readFileSync } = await import('node:fs');
  const type = readFileSync('components/content-type/TypeControls.tsx', 'utf8');
  assert.ok(type.includes('Make Last Few Days posts on Tuesdays and Fridays at 3:00 AM? Each run makes live model and web calls (up to the run cap).'));
  const hub = readFileSync('components/social-hub/content/HubControls.tsx', 'utf8');
  assert.ok(hub.includes('Makes one recap at 3:00 AM on its days (Tue/Fri).'));
});
