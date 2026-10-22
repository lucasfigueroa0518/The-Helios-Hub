import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { costOfPosts, summarize } from '@/lib/social-hub/cost';

import { FIXTURE_NOW, previewDataset } from './fixtures/social-hub/preview-dataset';

test('the preview fixture builds through the real adapters and cost model without errors', () => {
  const d = previewDataset();
  assert.deepEqual(d.errors, []);
  assert.deepEqual(d.costNotes, []);
  const count = (v: string, s?: string) => d.posts.filter((p) => p.vertical === v && (!s || p.status === s)).length;
  for (const v of ['reels', 'explainers', 'carousels', 'stories']) assert.ok(count(v, 'published') > 5, v);
  assert.ok(d.posts.some((p) => p.status === 'scheduled'));
  assert.ok(d.posts.some((p) => p.status === 'cancelled'));
  assert.ok(d.posts.some((p) => p.status === 'ready'));
  const s = summarize(d.cost!, { from: null, to: '2026-12-31' });
  assert.equal(s.itemMicros + s.unattributedMicros, s.ledgerMicros);
  assert.ok(costOfPosts(d.posts.filter((p) => p.status === 'published')).micros > 0);
  assert.equal(FIXTURE_NOW.toISOString(), '2026-10-08T19:00:00.000Z');
  console.log(JSON.stringify({ posts: d.posts.length, ideas: d.ideas.length, sources: d.sources.length, byStatus: Object.fromEntries(['published','scheduled','cancelled','failed','ready','skipped'].map((st) => [st, d.posts.filter((p) => p.status === st).length])) }));
});

// ── The Calendar preview (calendar type schedules, Task 4) ──

/** Every module a file reaches through value imports (type-only imports skipped), repo-relative; `stop` files are listed but not followed. */
function reach(start: string, stop: (file: string) => boolean = () => false): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  const resolve = (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith('@/')) base = spec.slice(2);
    else if (spec.startsWith('.')) base = path.join(path.dirname(from), spec);
    else return null;
    for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const f = base + ext;
      if (existsSync(f) && statSync(f).isFile()) return path.normalize(f);
    }
    return null;
  };
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (stop(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
      if (m[1]) continue;
      const next = resolve(file, m[2]!);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

test('the Calendar preview renders the Schedules dropdown and imports no database code', async () => {
  const page = 'app/social/(hub)/preview/calendar/page.tsx';
  // The fixture dataset is the preview's data (it runs the real adapters offline); everything else the page reaches is checked.
  const reached = reach(page, (f) => f.startsWith('tests/fixtures/'));
  assert.ok(reached.has('components/social-hub/calendar/SchedulesMenu.tsx'), 'the page reaches the Schedules dropdown');
  for (const db of ['lib/db.ts', 'lib/social-hub/db.ts', 'lib/social-hub/slots/load.ts', 'lib/social-hub/slots/schedule-write.ts', 'lib/social-hub/live.ts']) {
    assert.ok(!reached.has(db), `the preview must not import ${db}`);
  }

  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime');
  const { PathnameContext, SearchParamsContext } = await import('next/dist/shared/lib/hooks-client-context.shared-runtime');
  const { default: Page } = await import('@/app/social/(hub)/preview/calendar/page');
  const el = await Page({ searchParams: Promise.resolve({ view: 'week' }) });
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {}, hmrRefresh() {} };
  const h = React.createElement;
  const html = renderToStaticMarkup(
    h(AppRouterContext.Provider, { value: router as never },
      h(PathnameContext.Provider, { value: '/social/preview/calendar' },
        h(SearchParamsContext.Provider, { value: new URLSearchParams('view=week') as never }, el))),
  );
  assert.match(html, /<span>Schedules<\/span>/);
  assert.match(html, /Preview: changes stay on this screen/);
});

test('the Schedules form renders its times, Monday-first days, the merge notice and the cap note', async () => {
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { ScheduleForm } = await import('@/components/social-hub/calendar/ScheduleForm');
  const { SCHEDULE_ENTRIES, scheduleFromTemplate } = await import('@/lib/social-hub/slots/schedule');
  const explainers = SCHEDULE_ENTRIES.find((e) => e.label === 'Explainers')!;
  const row = (weekday: number, startMinute: number, feedMode: 'trial' | 'main') => ({ weekday, vertical: 'explainers' as const, startMinute, series: null, feedMode });
  const view = scheduleFromTemplate([row(1, 600, 'main'), row(2, 780, 'trial'), row(3, 780, 'main'), row(3, 1080, 'main')], explainers);
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime');
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {}, hmrRefresh() {} };
  const render = (editable: boolean, note: string | null) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router as never }, React.createElement(ScheduleForm, {
    view, others: [], cap: 3, editable, note, busy: false, anchor: {} as HTMLElement, onClose() {}, onSave: async () => ({ kind: 'saved' as const }),
  })));
  const html = render(true, null);
  assert.match(html, /Explainers schedule/);
  assert.match(html, /They’re merged here; nothing changes until you save\./);
  assert.match(html, /1:00 PM is Trial on some days and Main on others\. Pick one\./);
  const days = [...html.matchAll(/aria-pressed="(?:true|false)">(Mon|Tue|Wed|Thu|Fri|Sat|Sun)</g)].map((m) => m[1]);
  assert.deepEqual(days, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.match(html, /Explainers can post 3 a day\. Raise the daily limit on the Explainers page to add more\./, 'three times at a cap of 3: Add a time is off with the note');
  assert.match(html, /disabled="">.*?Add a time/);
  const locked = render(false, 'The calendar is showing today’s settings. It starts deciding when you switch it on.');
  assert.match(locked, /It starts deciding when you switch it on\./);
  assert.doesNotMatch(locked, />Save</);
});
