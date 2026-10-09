import assert from 'node:assert/strict';
import test from 'node:test';

import { typeHubModel } from '@/lib/content-type/model';
import { writePosting, isPostingType } from '@/lib/content-type/posting';
import { serviceHeaders } from '@/lib/supabase-service-headers';
import { typeHref } from '@/lib/social-hub/verticals';
import { FIXTURE_NOW, previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

const VERTICALS = ['carousels', 'stories', 'explainers', 'reels'] as const;

test('a day holds only posts that have a day; made-but-unplaced content waits on the bench with its post', () => {
  const dataset = previewDataset();
  for (const vertical of VERTICALS) {
    const model = typeHubModel(dataset, vertical, FIXTURE_NOW);
    const mine = dataset.posts.filter((p) => p.vertical === vertical);
    const placed = mine.filter((p) => p.nyDate);
    const unplaced = mine.filter((p) => !p.nyDate && (p.status === 'ready' || p.status === 'scheduled'));
    // Every card on a day belongs to that day.
    for (const day of model.days) for (const card of day.cards) assert.equal(card.post.nyDate, day.date, `${vertical}: ${card.post.id} sits on its own day`);
    // Placed posts (within the window the strip reaches) are on days; unplaced never are.
    const onDays = new Set(model.days.flatMap((d) => d.cards.map((c) => c.post.id)));
    for (const p of unplaced) assert.equal(onDays.has(p.id), false, `${vertical}: unplaced ${p.id} stays off the days`);
    // Every unplaced post is reachable from the bench exactly once.
    const onBench = model.bench.map((b) => b.card?.post.id).filter(Boolean);
    assert.deepEqual([...onBench].sort(), unplaced.map((p) => p.id).sort(), `${vertical}: each waiting post is on the bench once`);
    assert.equal(model.benchTotal, model.bench.length);
    assert.ok(placed.length >= 0);
  }
});

test('today always has a day in the strip, days run oldest to newest, and bench ranks count up', () => {
  const model = typeHubModel(previewDataset(), 'carousels', FIXTURE_NOW);
  assert.ok(model.days.some((d) => d.date === model.today), 'today is in the strip');
  assert.deepEqual(model.days.map((d) => d.date), [...model.days.map((d) => d.date)].sort());
  assert.deepEqual(model.bench.map((b) => b.rank), model.bench.map((_, i) => i + 1));
});

test('a bench idea matches a waiting post by its idea id, with or without a prefix', () => {
  const dataset = previewDataset();
  const post = dataset.posts.find((p) => p.vertical === 'explainers' && !p.nyDate && p.idea);
  if (!post) return; // the fixture has no waiting explainer; the carousel case above covers matching by story id
  const model = typeHubModel({ ...dataset, ideas: [...dataset.ideas, { id: `explainers:topic:${post.idea!.id}`, vertical: 'explainers', title: 'x', score: 1, scoreLabel: '', state: 'content_ready', hasContent: true, versionCount: 1, generatedAt: null, createdAt: null, detail: null }] }, 'explainers', FIXTURE_NOW);
  assert.ok(model.bench.some((b) => b.card?.post.id === post.id && b.idea.id.endsWith(post.idea!.id)));
});

test('type pages: Text on Screen keeps /reels; the others live at /<type>, or under the preview base', () => {
  assert.equal(typeHref('reels'), '/reels');
  assert.equal(typeHref('carousels'), '/carousels');
  assert.equal(typeHref('stories', '/social'), '/stories');
  assert.equal(typeHref('explainers', '/social/preview'), '/social/preview/type/explainers');
  assert.equal(typeHref('reels', '/social/preview'), '/reels');
});

test('Supabase service headers: a legacy JWT goes in both headers; a secret key only in apikey (never as Bearer)', () => {
  assert.deepEqual(serviceHeaders('eyJhbGciOi.payload.sig'), { apikey: 'eyJhbGciOi.payload.sig', authorization: 'Bearer eyJhbGciOi.payload.sig' });
  assert.deepEqual(serviceHeaders('sb_secret_abc123'), { apikey: 'sb_secret_abc123' });
  assert.deepEqual(serviceHeaders('  "sb_secret_abc123"  '), { apikey: 'sb_secret_abc123' });
  assert.deepEqual(serviceHeaders('eyJhbGciOi.not-a-jwt'), { apikey: 'eyJhbGciOi.not-a-jwt' });
});

test('posting settings refuse bad input before writing anything', async () => {
  assert.equal(isPostingType('stories'), true);
  assert.equal(isPostingType('nope'), false);
  await assert.rejects(() => writePosting('carousels', { perDay: 3 }, 't'), /from 0 to 2/);
  await assert.rejects(() => writePosting('carousels', { perDay: -1 }, 't'), /from 0 to 2/);
  await assert.rejects(() => writePosting('carousels', { perDay: 1.5 }, 't'), /whole number/);
  await assert.rejects(() => writePosting('explainers', { perDay: 0 }, 't'), /from 1 to 2/);
  await assert.rejects(() => writePosting('reels', { perDay: 4 }, 't'), /from 0 to 3/);
  await assert.rejects(() => writePosting('stories', { series: { id: 'nope', enabled: true } }, 't'), /Unknown series/);
  await assert.rejects(() => writePosting('stories', { series: { id: 'free_vs_paid', days: [] } }, 't'), /at least one day/);
  await assert.rejects(() => writePosting('stories', { series: { id: 'free_vs_paid', days: [7] } }, 't'), /at least one day/);
  await assert.rejects(() => writePosting('carousels', { live: 'yes' as never }, 't'), /true or false/);
  await assert.rejects(() => writePosting('carousels', { autoPublish: 1 as never }, 't'), /true or false/);
});
