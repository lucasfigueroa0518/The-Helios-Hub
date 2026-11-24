/**
 * Photo Bank → Field Notes section (planning/Field Notes/UI-REWORK-CONTRACT.md C1–C3). Renders the screen offline
 * from the preview fixtures with a stub router. No database, network or model.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { previewFieldNotesPool, previewPhotos } from './fixtures/social-hub/preview-libraries';

const NOW = new Date('2026-10-08T19:00:00Z');
const BASE = '/social/preview';

async function render(props: Record<string, unknown>): Promise<string> {
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime');
  const { PhotosScreen } = await import('@/components/social-hub/content/PhotosScreen');
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {}, hmrRefresh() {} };
  return renderToStaticMarkup(
    React.createElement(AppRouterContext.Provider, { value: router as never }, React.createElement(PhotosScreen, { base: BASE, now: NOW, ...props } as never)),
  );
}

/** The section pills: [label, href, current]. */
function sectionPills(html: string): Array<{ label: string; href: string; current: boolean }> {
  const group = html.match(/<div class="sh-pills" role="group" aria-label="Section">(.*?)<\/div>/)?.[1] ?? '';
  return [...group.matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)].map((m) => ({
    label: m[2]!,
    href: (m[1]!.match(/href="([^"]*)"/)?.[1] ?? '').replace(/&amp;/g, '&'),
    current: /aria-current="page"/.test(m[1]!),
  }));
}

test('section param: absent or unknown is the online section; field-notes opens ours', async () => {
  const { photoBankSection } = await import('@/components/social-hub/content/PhotosScreen');
  assert.equal(photoBankSection({}), 'online');
  assert.equal(photoBankSection({ section: 'nonsense' }), 'online');
  assert.equal(photoBankSection({ section: 'online' }), 'online');
  assert.equal(photoBankSection({ section: 'field-notes' }), 'field-notes');
});

test('no param: today\'s screen plus the two pills, "Found online" current', async () => {
  const params = { used: 'unused', tag: 'ai', lane: 'logo', page: '2' };
  const html = await render({ ...previewPhotos({ used: false }), params });
  assert.deepEqual(sectionPills(html).map((p) => [p.label, p.current]), [['Found online', true], ['Field Notes', false]]);
  // Switching drops the online filters and paging.
  const fieldNotes = sectionPills(html).find((p) => p.label === 'Field Notes')!;
  assert.equal(fieldNotes.href, `${BASE}/content/library/photos?section=field-notes`);
  // Today's screen is still there: meta, note, used pills, the grid.
  assert.match(html, /1,240 photos · 812 reusable/);
  assert.match(html, /Photos the carousel and Stories finders vetted/);
  assert.match(html, /aria-label="Show"/);
  assert.match(html, />Not used yet</);
  assert.match(html, /class="sh-photos"/);
  assert.doesNotMatch(html, /sh-fnphotos|Choose photos/);
});

test('section=field-notes (preview): meta line and grid from fixtures, read-only', async () => {
  const params = { section: 'field-notes' };
  const html = await render({ fieldNotes: { pool: previewFieldNotesPool(), error: null, readOnly: true }, params });
  assert.deepEqual(sectionPills(html).map((p) => [p.label, p.current]), [['Found online', false], ['Field Notes', true]]);
  assert.equal(sectionPills(html).find((p) => p.label === 'Found online')!.href, `${BASE}/content/library/photos`);
  assert.match(html, /5 of about 25 live · 2 resting · 1 retired/);
  assert.match(html, /class="fn-grid"/);
  assert.equal((html.match(/class="fn-photo /g) ?? []).length, 8);
  assert.match(html, /src="data:image\/svg\+xml/, 'fixture thumbnails, not the bucket route');
  // Read-only: no upload box, no grid actions, none of the online section.
  assert.doesNotMatch(html, /Choose photos|fn-upload|fn-drop/);
  assert.doesNotMatch(html, /<button|<select|<form/);
  assert.doesNotMatch(html, /class="sh-photos"|aria-label="Show"/);
  // The meta line is shown once: the grid's own head is dropped here.
  assert.doesNotMatch(html, /Photo pool<\/h3>/);
});

test('section=field-notes (live): upload box, then the grid with its actions; switching back clears filters', async () => {
  const params = { section: 'field-notes', used: 'used', page: '3' };
  const html = await render({ fieldNotes: { pool: previewFieldNotesPool(), error: null, readOnly: false }, params });
  const upload = html.indexOf('fn-upload');
  const grid = html.indexOf('fn-grid');
  const meta = html.indexOf('of about 25 live');
  assert.ok(meta > -1 && upload > meta && grid > upload, 'meta line, upload box, grid, in that order');
  assert.match(html, />Choose photos</);
  assert.match(html, />Reject</);
  assert.match(html, />Restore</);
  assert.match(html, /<select/);
  assert.equal(sectionPills(html).find((p) => p.label === 'Found online')!.href, `${BASE}/content/library/photos`);
});

test('section=field-notes: the pool could not be read', async () => {
  const html = await render({ fieldNotes: { pool: null, error: 'relation "field_notes.pool" does not exist', readOnly: false }, params: { section: 'field-notes' } });
  assert.match(html, /Could not load the Field Notes photos/);
  assert.match(html, /schema may not be applied yet/);
  assert.match(html, />Choose photos</, 'the upload box still shows');
  assert.doesNotMatch(html, /fn-grid|of about 25 live/);
});

test('live page reads the Field Notes pool only on that section', () => {
  const src = readFileSync(path.join(process.cwd(), 'app/social/(hub)/content/library/photos/page.tsx'), 'utf8');
  const branch = src.indexOf("photoBankSection(params) === 'field-notes'");
  assert.ok(branch > -1);
  const body = src.slice(src.indexOf('export default async function Page'));
  assert.ok(body.indexOf('loadFieldNotes()') > body.indexOf("=== 'field-notes'"), 'the pool loads inside the field-notes branch');
  assert.ok(body.indexOf('listLibrary(') > body.indexOf("=== 'field-notes'"), 'the online queries run after the field-notes branch returns');
  assert.equal((src.match(/listPool\(/g) ?? []).length, 1);
  const preview = readFileSync(path.join(process.cwd(), 'app/social/(hub)/preview/content/library/photos/page.tsx'), 'utf8');
  assert.match(preview, /readOnly: true/);
  assert.doesNotMatch(preview, /listPool|liveHubQuery/);
});
