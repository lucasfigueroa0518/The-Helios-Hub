/**
 * The /ai-events page's body (TypeHub over typeHubModel) rendered to HTML for an empty week and a
 * full week, from the hub's PGlite read (tests/fixtures/ai-events/seed.ts). Offline: nothing here
 * ranks, scores or calls a model; the router is a stub so the client components render.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { typeHubModel } from '@/lib/content-type/model';
import { buildDataset } from '@/lib/social-hub/dataset';
import { readAll } from '@/lib/social-hub/load';
import { DEFAULT_DAY_QUOTAS } from '@/lib/social-hub/queries/day';

import { addEvent, openAiEventsDb, seedPoolRow, seedRenderedPost, SUN_NOON } from './fixtures/ai-events/seed';

// The components compile to classic React.createElement calls under tsx.
(globalThis as { React?: unknown }).React = React;
const { createElement } = React;

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function page(query: Parameters<typeof readAll>[0], now = SUN_NOON) {
  const data = { ...buildDataset(await readAll(query, undefined, now), null, now), dayQuotas: DEFAULT_DAY_QUOTAS };
  assert.deepEqual(data.errors, []);
  const model = typeHubModel(data, 'ai_events', now);
  const { TypeHub } = await import('@/components/content-type/TypeHub');
  const html = renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router as never }, createElement(TypeHub, { model, title: 'AI Events This Week' })),
  );
  return { model, html };
}

test('/ai-events with an empty week: four city tabs at zero, the empty-pool line, no post', async () => {
  const { query } = await openAiEventsDb();
  const { model, html } = await page(query);
  assert.deepEqual(model.bench, []);
  assert.deepEqual(model.groups, ['Miami', 'Boston', 'NYC', 'SF']);
  assert.deepEqual(model.poolWeek, { label: 'Oct 26–Nov 1', editable: true });
  assert.match(html, /aria-label="Cities"/);
  assert.match(html, /All cities <span class="rh-bench-filter__n">0<\/span>/);
  for (const city of ['Miami', 'Boston', 'NYC', 'SF']) assert.match(html, new RegExp(`>${city} <span class="rh-bench-filter__n">0</span>`));
  assert.match(html, /The pool is empty until the Sunday run ranks the coming week\./);
  assert.match(html, /Week of Oct 26–Nov 1\. Pin or exclude events, then Rebuild post\./);
  assert.match(html, /No AI Events posts on this day\./);
});

test('/ai-events with a full week: the post is today’s card, cities ranked with chips, pool buttons and the score bar', async () => {
  const { query } = await openAiEventsDb();
  const { id } = await seedRenderedPost(query);
  const a = await addEvent(query, { title: 'AI Tinkerers Boston', startAt: '2026-10-27T22:30:00Z' });
  const b = await addEvent(query, { title: 'Miami AI Night', metro: 'miami', startAt: '2026-10-28T22:30:00Z' });
  await seedPoolRow(query, a, { rank: 1, score: 7.2, picked: true, pickRank: 1, parts: [{ label: 'Notable speakers', points: 1.6, detail: '0.80 yes' }] });
  await seedPoolRow(query, b, { metro: 'miami', rank: 1, score: 5, excludedBy: 'tommy@helios.test', parts: [{ label: 'Crowd', points: 1, detail: '0.50 yes' }] });
  const { model, html } = await page(query);
  // Sunday: the week's post is today's card, so the bench is the pool alone, Miami before Boston (AE-02).
  assert.deepEqual(model.bench.map((r) => r.idea.id), [`ai_events:event:${b}`, `ai_events:event:${a}`]);
  assert.deepEqual(model.days.find((d) => d.date === '2026-10-25')?.cards.map((c) => c.post.id), [`ai_events:${id}`]);
  assert.match(html, /All cities <span class="rh-bench-filter__n">2<\/span>/);
  assert.match(html, />Miami <span class="rh-bench-filter__n">1<\/span>/);
  assert.match(html, />Boston <span class="rh-bench-filter__n">1<\/span>/);
  assert.match(html, /In the post/);
  assert.match(html, /ae-chip--out">Excluded</);
  assert.match(html, /aria-label="Pin into its city"/);
  assert.match(html, /aria-label="Clear the exclude"/);
  assert.match(html, /class="ae-pool__bar"/);
  assert.match(html, /Where the score comes from/);
  // Sunday: the week's post is today's card.
  assert.match(html, /AI Events This Week · Oct 26–Nov 1/);
});

test('Rebuild post is offered only for the coming week’s post while it waits (final review)', async () => {
  const { aiEventsRebuildRefusal, AI_EVENTS_NO_REVIEW_POST } = await import('@/lib/content-type/model');
  const { query } = await openAiEventsDb();
  const at = async (now: Date) => buildDataset(await readAll(query, undefined, now), null, now);
  assert.equal(aiEventsRebuildRefusal(await at(SUN_NOON)), AI_EVENTS_NO_REVIEW_POST, 'no post yet');
  await seedRenderedPost(query);
  assert.equal(aiEventsRebuildRefusal(await at(SUN_NOON)), null, 'Sunday: the coming week’s post is in review');
  // Tuesday: the coming week is the next one; this week's post (still in review, never posted) is not what a rebuild targets.
  assert.equal(aiEventsRebuildRefusal(await at(new Date('2026-10-27T16:00:00Z'))), AI_EVENTS_NO_REVIEW_POST);
});

test('the week board shows the Sunday 6:00 and 7:00 PM AI Events slots, in the dated week and the standard schedule (final review)', async () => {
  const { DEFAULT_SEED_INPUTS, seedTemplate } = await import('@/lib/social-hub/slots/seed');
  const { DEFAULT_CAPS } = await import('@/lib/social-hub/slots/times');
  const { boardModel, datedWeek, standardByWeekday } = await import('@/lib/social-hub/views/week');
  const tpl = seedTemplate(DEFAULT_SEED_INPUTS);
  const now = new Date('2026-10-20T14:00:00Z');
  const week = boardModel({ days: datedWeek(tpl, '2026-10-19'), posts: [], now, caps: DEFAULT_CAPS });
  const ae = week.cards.filter((c) => c.vertical === 'ai_events');
  assert.deepEqual(ae.map((c) => [week.columns[c.day]!.nyDate, c.startMinute, c.status]), [['2026-10-25', 1080, 'empty'], ['2026-10-25', 1140, 'empty']]);
  assert.equal(ae[0]!.statusText, 'Empty for now. The 12 PM run makes it on Sun Oct 25.');
  assert.equal(ae[0]!.outsideUsual, false);
  // The Standard week tab is gone (PR #17); the standard schedule still holds both Sunday slots.
  assert.deepEqual(standardByWeekday(tpl)[0]!.filter((s) => s.vertical === 'ai_events').map((s) => s.startMinute), [1080, 1140]);
});
