import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { checkCoverFit } from '@/lib/social/editorial/v2/cover-fit';
import type { Post } from '@/lib/social/render/types';

/**
 * Cover-fit is a Playwright-backed check that measures the rendered
 * cover against the safe area and the orange arrow. Unit tests can't
 * spin up a browser, so `skip: true` is the offline path — the check
 * returns ok without touching Playwright. Live runs enable it by
 * default when the dev server is reachable.
 */
const minimalPost: Post = {
  format: 'carousel',
  storyType: 'ai_release',
  source: 'Outlet',
  sourceUrl: '',
  publishedAt: '2026-01-01',
  issueNumber: 1,
  caption: 'x',
  slides: [
    {
      position: 0,
      layoutVariant: 'cover',
      variant: 'C3',
      headline: [{ text: 'A short cover.', role: 'narrative' }],
      altText: 'Cover',
    },
  ],
};

describe('checkCoverFit — Playwright-backed pre-render gate', () => {
  test('skip:true returns ok without touching Playwright (offline test path)', async () => {
    const r = await checkCoverFit(minimalPost, { skip: true });
    assert.equal(r.ok, true);
    assert.equal(r.errors.length, 0);
  });

  test('server unreachable FAILS loudly on live runs (only `skip: true` bypasses)', async () => {
    // 2026-09-29 late second pass: prior version returned ok when the
    // dev server was down, on the theory that the post-render detector
    // would catch anything visible. But that meant a live run with no
    // dev server SKIPPED the whole cover-fit gate — silently. The rule
    // now: only `skip: true` (unit tests) is a silent bypass; every
    // other caller must hit the browser or fail loudly.
    const r = await checkCoverFit(minimalPost, { server: 'http://127.0.0.1:1' });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0]!.message, /could not reach the dev preview server/);
  });
});

describe('REFLOW_COVER_JS — shape of the shared browser-side reflow', () => {
  test('exported source string contains the expected structural markers', async () => {
    const { REFLOW_COVER_JS } = await import('@/lib/social/editorial/v2/cover-reflow');
    // Sanity: the returned object shape from the IIFE must include the
    // four keys renderPreview + checkCoverFit read (`inserted`,
    // `stillOverlaps`, `tooTall`, `singleWordOverflow`).
    for (const key of ['inserted', 'stillOverlaps', 'tooTall', 'singleWordOverflow']) {
      assert.match(REFLOW_COVER_JS, new RegExp(key));
    }
    // Must query the cover headline + chevron, and must insert a <br>
    // with a data-cover-fit-inserted marker so we can identify our
    // reflow-inserted breaks in the DOM later.
    assert.match(REFLOW_COVER_JS, /helios-cover__headline/);
    assert.match(REFLOW_COVER_JS, /helios-cover__chevron/);
    assert.match(REFLOW_COVER_JS, /data-cover-fit-inserted/);
    // The iteration cap keeps the reflow bounded.
    assert.match(REFLOW_COVER_JS, /MAX_ITER/);
  });
});


describe('REFLOW_COVER_JS — Rule 2: textOverFace field', () => {
  test('reflow source computes textOverFace from face zone + headline top', async () => {
    const { REFLOW_COVER_JS } = await import('@/lib/social/editorial/v2/cover-reflow');
    // The returned outcome must include textOverFace + read the face
    // zone from the cover's data-face-zone-bottom attribute so the
    // vision-detected face box can override the 40% default.
    assert.match(REFLOW_COVER_JS, /textOverFace/);
    assert.match(REFLOW_COVER_JS, /data-face-zone-bottom/);
    // The default face-zone bottom is 40% of image height.
    assert.match(REFLOW_COVER_JS, /0\.40/);
    // The margin above the face zone is 40px.
    assert.match(REFLOW_COVER_JS, /faceBottomY \+ 40/);
    // Only applies to photo-bleed covers.
    assert.match(REFLOW_COVER_JS, /helios-cover--bleed/);
  });
});
