import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { CAROUSEL_SLOTS } from '@/lib/social/overnight/config';
import { EXPLAINER_WINDOWS } from '@/lib/explainers/publish/config';
import { POSTING_SLOTS } from '@/lib/reels/publish/slots';
import { PLAN } from '@/lib/social-hub/views/plan';
import { previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

const ROOT = path.resolve(__dirname, '..');
const HUB = path.join(ROOT, 'app/social/(hub)');

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...pages(abs));
    else if (name === 'page.tsx') out.push(path.relative(HUB, abs));
  }
  return out;
}

test('every live hub page has a fixture preview mirror (the screenshot pass needs both)', () => {
  const live = pages(HUB).filter((p) => !p.startsWith('preview') && !p.startsWith('@drawer'));
  for (const page of live) {
    if (page === 'house/page.tsx') continue; // redirect only
    assert.ok(existsSync(path.join(HUB, 'preview', page)), `no preview mirror for ${page}`);
  }
});

test('the drawer slot has its null pages and both intercepts', () => {
  for (const f of ['@drawer/default.tsx', '@drawer/page.tsx', '@drawer/[...rest]/page.tsx', '@drawer/(.)post/[id]/page.tsx', '@drawer/preview/(.)post/[id]/page.tsx', 'default.tsx']) {
    assert.ok(existsSync(path.join(HUB, f)), f);
  }
  const preview = readFileSync(path.join(HUB, '@drawer/preview/(.)post/[id]/page.tsx'), 'utf8');
  assert.ok(!/@\/lib\/(db|session)'|queries\/|\/load'|\/live'/.test(preview), 'the preview drawer never touches the database or the session');
});

test('no hub control is a GET form: every change goes through the router (REVISIONS G11)', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const abs = path.join(dir, n);
    return statSync(abs).isDirectory() ? walk(abs) : /\.tsx$/.test(n) ? [abs] : [];
  });
  for (const file of [...walk(path.join(ROOT, 'components/social-hub')), ...walk(HUB)]) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!/method=["']get["']/i.test(text), `${path.relative(ROOT, file)} has a GET form`);
    assert.ok(!/<select[\s>]/.test(text), `${path.relative(ROOT, file)} uses a native select (DESIGN.md)`);
  }
});

test('the hub dataset survives JSON (it is cached across requests)', () => {
  const d = previewDataset();
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
});

test('the hub plan mirrors each type’s own posting windows', () => {
  assert.deepEqual(PLAN.reels.map((w) => [w.id, w.startMinute, w.endMinute]), POSTING_SLOTS.map((w) => [w.id, w.startMinute, w.endMinute]));
  assert.deepEqual(PLAN.carousels.map((w) => [w.id, w.startMinute, w.endMinute]), CAROUSEL_SLOTS.map((w) => [w.id, w.startMinute, w.endMinute]));
  assert.deepEqual(PLAN.explainers.map((w) => [w.id, w.startMinute, w.endMinute]), EXPLAINER_WINDOWS.map((w) => [w.id, w.startMinute, w.endMinute]));
  assert.deepEqual(PLAN.stories.map((w) => w.id), ['morning_download', 'guess_the_number', 'free_vs_paid']);
});
