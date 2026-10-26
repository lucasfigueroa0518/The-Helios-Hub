/**
 * AI Events This Week renders (plan M5): the real SlideTemplate + preview.css + premium.css + drafts CSS in
 * headless Chromium (fit-check.ts). Every look at max copy, and every hook on every look's cover, renders with
 * no problems and no bounds violations; overflowing copy is reported, never shrunk past its minimum or cut.
 * No model calls. Run: npx tsx --test tests/ai-events-render.integration.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AI_EVENTS_FIXTURES, sampleInput } from '@/fixtures/social/ai-events-posts';
import { HOOK_KEYS } from '@/lib/ai-events/hooks';
import { LOOKS } from '@/lib/ai-events/looks';
import { buildAiEventsPost } from '@/lib/ai-events/post';
import { AiEventsSlide } from '@/lib/social/render/ai-events';
import { checkRenderFit } from '@/lib/social/render/fit-check';
import type { AeSlide, Post } from '@/lib/social/render/types';

const clone = (post: Post): Post => structuredClone(post);

for (const look of LOOKS) {
  test(`${look}: max copy renders with no problems or violations`, async () => {
    const res = await checkRenderFit(AI_EVENTS_FIXTURES[`ae-${look}`]!);
    assert.deepEqual(res.problems, []);
    assert.deepEqual(res.violations, []);
    assert.equal(res.slideText.length, 6);
  });

  test(`${look}: min copy renders with no problems or violations`, async () => {
    const res = await checkRenderFit(AI_EVENTS_FIXTURES[`ae-${look}-min`]!);
    assert.deepEqual(res.problems, []);
    assert.deepEqual(res.violations, []);
  });

  test(`${look}: every hook in the bank fits the cover`, async () => {
    const covers = HOOK_KEYS.map((key, i) => ({ ...buildAiEventsPost(sampleInput(look, key)).slides[0]!, position: i }));
    const post: Post = { ...AI_EVENTS_FIXTURES[`ae-${look}`]!, slides: covers };
    const res = await checkRenderFit(post);
    assert.deepEqual(res.problems, []);
    assert.deepEqual(res.violations, []);
  });
}

test('an event title too long for its region is reported as a text-fit problem', async () => {
  const post = clone(AI_EVENTS_FIXTURES['ae-spotlight']!);
  const city = post.slides[1]!.aiEvents as Extract<AeSlide, { role: 'city' }>;
  city.pick.title = 'word '.repeat(120).trim();
  const res = await checkRenderFit(post);
  assert.ok(res.problems.some((p) => /^slide 2 text fit: p\.ae-title/.test(p)), res.problems.join('\n'));
});

test('a hook too long for the cover is reported as a text-fit problem', async () => {
  const post = clone(AI_EVENTS_FIXTURES['ae-orb']!);
  const cover = post.slides[0]!.aiEvents as Extract<AeSlide, { role: 'cover' }>;
  cover.lead = 'word '.repeat(40).trim();
  const res = await checkRenderFit(post);
  assert.ok(res.problems.some((p) => /^slide 1 text fit: h1\.hp-headline/.test(p)), res.problems.join('\n'));
});

test('a single word wider than its line is reported, not cut off', async () => {
  const post = clone(AI_EVENTS_FIXTURES['ae-glass']!);
  const city = post.slides[2]!.aiEvents as Extract<AeSlide, { role: 'city' }>;
  city.city = 'Supercalifragilisticexpialidocious';
  const res = await checkRenderFit(post);
  assert.ok(res.problems.some((p) => /^slide 3 text fit: h2\.hp-headline/.test(p) && /wider/.test(p)), res.problems.join('\n'));
});

test('the Helios mark is drawn only on the closing slide (AE-26)', () => {
  for (const [id, post] of Object.entries(AI_EVENTS_FIXTURES)) {
    for (const slide of post.slides) {
      const html = renderToStaticMarkup(createElement(AiEventsSlide, { slide }));
      const marked = /helios-mark|data-protect="logo"/.test(html);
      assert.equal(marked, slide.aiEvents!.role === 'cta', `${id} ${slide.layoutVariant}`);
    }
  }
});
