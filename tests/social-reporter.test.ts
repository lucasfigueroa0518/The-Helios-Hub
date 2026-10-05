/**
 * Helios Social rebuild — M2 Reporter plumbing tests (offline: saved HTML,
 * no network, no Claude).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEAD_SENTENCE,
  PAGE_AGENCY_INLINE,
  PAGE_COMPANY_PHOTOS,
  PAGE_CREDIT_ELEMENT,
  PAGE_HERO_OUTSIDE_MAIN,
} from '@/fixtures/social/pages';
import { parseArticleHtml, readPage } from '@/lib/social/reporter/read-page';

const URL_A = 'https://tech.example.com/2026/10/03/northwind-opens-model';

test('page reader returns raw text, word for word (spec §4.2c)', () => {
  const page = parseArticleHtml(PAGE_CREDIT_ELEMENT, URL_A)!;
  assert.ok(page.text.includes(LEAD_SENTENCE));
  assert.ok(page.text.includes('The company said it would publish further information in the coming weeks, according to a spokesperson.'));
  assert.equal(page.truncated, false);
  assert.equal(page.publishedTime, '2026-10-03T14:00:00Z');
  // Caption and credit text is reported as photo data, not mixed into nothing: the body still reads as prose.
  assert.ok(page.text.length > 500);
});

test('photos: credit in its own element is split from the caption; largest srcset; og:image last', () => {
  const { photos } = parseArticleHtml(PAGE_CREDIT_ELEMENT, URL_A)!;
  assert.equal(photos.length, 2);
  assert.deepEqual(photos[0], {
    src: 'https://tech.example.com/img/ceo-1600.jpg',
    caption: "Northwind Labs CEO Dana Whitlock at the company's developer event in Seattle.",
    credit: 'Photo: Lee Park for Example Tech',
    alt: 'Dana Whitlock on stage',
    from: 'figure',
  });
  assert.deepEqual(photos[1], {
    src: 'https://cdn.example.com/og/northwind-share.jpg', caption: null, credit: null, alt: null, from: 'og:image',
  });
});

test('photos: agency credits written inside the caption are copied exactly (spec §5.1 ABC example)', () => {
  const { photos } = parseArticleHtml(PAGE_AGENCY_INLINE, 'https://news.example.com/task-force')!;
  assert.equal(photos[0]!.caption, 'Vice President JD Vance speaks at the White House.');
  assert.equal(photos[0]!.credit, 'Kent Nishimura/AFP via Getty Images');
  assert.equal(photos[1]!.caption, 'The Capitol on Thursday.');
  assert.equal(photos[1]!.credit, 'J. Scott Applewhite/AP');
});

test('photos: "Courtesy of", the last labelled credit, lazy src, and no caption', () => {
  const { photos } = parseArticleHtml(PAGE_COMPANY_PHOTOS, 'https://news.example.com/chip')!;
  assert.equal(photos.length, 3);
  assert.equal(photos[0]!.src, 'https://press.example.com/chip.jpg');
  assert.equal(photos[0]!.caption, 'The Northwind N1 chip on display at the launch.');
  assert.equal(photos[0]!.credit, 'Courtesy of Northwind Labs');
  // "An image of…" in the caption is not mistaken for the credit.
  assert.equal(photos[1]!.caption, 'An image of the robot arm used in the lab demo.');
  assert.equal(photos[1]!.credit, 'Photo: Google');
  assert.deepEqual([photos[2]!.caption, photos[2]!.credit], [null, null]);
});

test('photos: hero outside <main> is found, a credit-only caption is a credit, nav figures are skipped (TechCrunch shape)', () => {
  const { photos } = parseArticleHtml(PAGE_HERO_OUTSIDE_MAIN, 'https://techcrunch.example.com/task-force')!;
  assert.equal(photos.length, 1);
  assert.equal(photos[0]!.src, 'https://cdn.example.com/hero.jpg');
  assert.equal(photos[0]!.caption, null);
  assert.equal(photos[0]!.credit, 'Image Credits: Kevin Dietsch / Staff / Getty Images');
});

test('readPage: failed fetch and non-article pages fail cleanly', async () => {
  const failed = await readPage(URL_A, async () => null);
  assert.deepEqual(failed, { ok: false, url: URL_A, error: 'fetch failed' });
  const empty = await readPage(URL_A, async () => '<html><body><p>Hi</p></body></html>');
  assert.equal(empty.ok, false);
  const ok = await readPage(URL_A, async () => PAGE_CREDIT_ELEMENT);
  assert.equal(ok.ok, true);
});
