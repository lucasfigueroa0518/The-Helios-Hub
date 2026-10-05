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
import { BRIEF_SUPER_INTELLIGENCE_FORCE, Q1_TEXT, TC_URL } from '@/fixtures/social/briefs';
import { BriefParseError, briefIndex, parseBrief } from '@/lib/social/reporter/brief';
import { parseArticleHtml, readPage } from '@/lib/social/reporter/read-page';

// ── Brief parser (M2 accept) ───────────────────────────────────────────

test('brief: the Super Intelligence Force fixture parses completely', () => {
  const b = parseBrief(BRIEF_SUPER_INTELLIGENCE_FORCE);
  assert.equal(b.singleStory, true);
  assert.deepEqual(b.news.ids, ['F1', 'F2']);
  assert.deepEqual(b.whyItMatters.map((w) => w.ids), [['F6'], ['F4']]);
  assert.deepEqual(b.facts.map((f) => f.id), ['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
  assert.deepEqual(b.facts[2]!.sources, ['TechCrunch', 'The Wall Street Journal']);
  assert.equal(b.facts[4]!.claimBy, 'Trump');
  assert.deepEqual(b.background.map((f) => f.id), ['B1', 'B2']);
  assert.equal(b.background[1]!.text, 'Trump signed an executive order seeking to rebrand AI as "super intelligence."');
  assert.equal(b.quotes.length, 3);
  assert.deepEqual(
    { ...b.quotes[0]!, text: b.quotes[0]!.text === Q1_TEXT },
    { id: 'Q1', text: true, speaker: 'Donald Trump', where: 'Truth Social post (via TechCrunch)', singleSource: true, cutOff: false },
  );
  assert.equal(b.quotes[2]!.cutOff, true);
  assert.deepEqual(b.numbers, [
    { id: 'N1', value: '120 days', type: 'duration', counts: 'time the task force has to report on the risks and opportunities presented by AI', source: 'TechCrunch' },
  ]);
  assert.equal(b.terms[0]!.name, 'Super Intelligence Force');
  assert.deepEqual(b.subjects[1], { name: 'Jay Clayton', role: 'national intelligence director; chair of the Super Intelligence Force' });
  assert.deepEqual(b.events, []);
  assert.deepEqual(b.articlePhotos, [
    { caption: null, credit: 'Image Credits:Kevin Dietsch / Staff / Getty Images', url: 'https://techcrunch.com/wp-content/uploads/2026/09/GettyImages-2297764008.jpg' },
  ]);
  assert.equal(b.notAnswered.length, 2);
  assert.deepEqual(b.sources, [{ outlet: 'TechCrunch', date: 'October 4, 2026', url: TC_URL }]);
  assert.deepEqual(b.fetchFailures, []);
});

test('brief: copy-by-ID lookups return the exact text (spec §4.2a)', () => {
  const idx = briefIndex(parseBrief(BRIEF_SUPER_INTELLIGENCE_FORCE));
  assert.equal(idx.quote.get('Q1')!.text, Q1_TEXT);
  assert.equal(idx.number.get('N1')!.value, '120 days');
  assert.ok(idx.fact.get('B1'));
});

function errorsOf(raw: string): string[] {
  try {
    parseBrief(raw);
  } catch (err) {
    assert.ok(err instanceof BriefParseError);
    return err.errors.map((e) => `${e.section}: ${e.message}`);
  }
  assert.fail('expected the brief to be rejected');
}

test('brief: malformed briefs fail with clear errors', () => {
  const B = BRIEF_SUPER_INTELLIGENCE_FORCE;
  assert.deepEqual(errorsOf(B.replace(/SOURCES:\n[\s\S]*?FETCH FAILURES:/, 'FETCH FAILURES:')), ['SOURCES: section missing']);
  assert.deepEqual(errorsOf(B.replace('F6: The task', 'F5: The task')), ['IDS: duplicate id F5', 'WHY IT MATTERS: cites F6, which isn\'t in the brief']);
  assert.deepEqual(errorsOf(B.replace(' presented by AI. (TechCrunch, The Wall Street Journal)', ' presented by AI.')), ['FACTS: F4 has no source']);
  assert.deepEqual(
    errorsOf(B.replace('| duration |', '| time |')),
    ['NUMBERS: N1 has type "time"; allowed: money, count, percent, duration, date, other'],
  );
  assert.match(errorsOf(B.replace('N1: 120 days | duration | ', 'N1: 120 days | '))[0]!, /^NUMBERS: expected "N#: value \| type \| what it counts \| source"/);
  assert.deepEqual(errorsOf(B.replace('SINGLE STORY: yes', 'SINGLE STORY: maybe')), ['SINGLE STORY: expected yes/no, got "maybe"']);
  assert.match(errorsOf(B.replace('Q2: "develop', 'Q2: develop'))[0]!, /^QUOTES: expected Q#: "quote" — speaker/);
});

test('brief: a sentence starting with "Background" is content, not a heading', () => {
  const b = parseBrief(BRIEF_SUPER_INTELLIGENCE_FORCE.replace('- The task force\'s budget and staff.', '- Background checks for task force members.'));
  assert.equal(b.notAnswered[0], 'Background checks for task force members.');
});

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
