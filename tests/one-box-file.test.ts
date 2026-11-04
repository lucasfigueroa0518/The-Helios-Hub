/** One-box seeding: filing a verified finding through each pool's existing add function (stubbed deps, no live call). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { fileIdea, type FileDeps } from '@/lib/seed/one-box/file';
import type { Entry, OneBoxInput, Verified } from '@/lib/seed/one-box/types';

const TEXT = 'body '.repeat(60);
const verified = (entry: Entry, more: Entry[] = [], text = TEXT): Verified => ({
  passed: [entry, ...more].map((en) => ({ entry: en, url: (en.url ?? en.sourceUrl)!, text })),
});

function deps() {
  const seen: Record<string, unknown[]> = { reel: [], carousel: [], lfd: [], story: [], explainer: [] };
  const d: FileDeps = {
    reel: async (a) => (seen.reel!.push(a), { status: 'added', id: 'r1', title: a.headline }),
    carousel: async (a) => (seen.carousel!.push(a), { id: a.url, title: a.headline }),
    lfd: async (a) => (seen.lfd!.push(a), { id: 'k', title: a.headline }),
    story: async (a) => (seen.story!.push(a), { key: 'seed:1', title: 'T' }),
    explainer: async (a) => (seen.explainer!.push(a), { topicId: 'e1', title: a.title }),
    headlines: async () => [],
    existing: async () => null,
  };
  return { d, seen };
}
const run = (input: OneBoxInput, v: Verified, d: FileDeps) => fileIdea({ input, verified: v, deps: d });
const news: Entry = { headline: 'Headline 1', url: 'https://news.test/1' };

test('Text on Screen: headline and url, plus the verified page text', async () => {
  const { d, seen } = deps();
  const r = await run({ vertical: 'reels', blurb: 'b' }, verified(news), d);
  assert.deepEqual(seen.reel, [{ headline: 'Headline 1', url: 'https://news.test/1', text: TEXT }]);
  assert.deepEqual(r, { status: 'added', ideaId: 'r1', title: 'Headline 1' });
});
test('Carousels and Last Few Days: url and headline', async () => {
  const { d, seen } = deps();
  await run({ vertical: 'carousels', blurb: 'b' }, verified(news), d);
  await run({ vertical: 'last_few_days', blurb: 'b' }, verified(news), d);
  assert.deepEqual(seen.carousel, [{ url: 'https://news.test/1', headline: 'Headline 1' }]);
  assert.deepEqual(seen.lfd, [{ url: 'https://news.test/1', headline: 'Headline 1' }]);
});
test('Stories Morning Download: series, headline, url, and the blurb as notes', async () => {
  const { d, seen } = deps();
  await run({ vertical: 'stories', series: 'morning_download', blurb: 'my words' }, verified(news), d);
  assert.deepEqual(seen.story, [{ series: 'morning_download', headline: 'Headline 1', url: 'https://news.test/1', notes: 'my words' }]);
});
test('Stories Guess the Number: value, fact, story headline, url', async () => {
  const { d, seen } = deps();
  await run({ vertical: 'stories', series: 'guess_the_number', blurb: 'b' }, verified({ value: '73%', fact: 'of x', storyHeadline: 'S', url: 'https://news.test/1' }), d);
  assert.deepEqual(seen.story, [{ series: 'guess_the_number', value: '73%', fact: 'of x', storyHeadline: 'S', url: 'https://news.test/1' }]);
});
test('Guess the Number without a story headline uses the fact', async () => {
  const { d, seen } = deps();
  await run({ vertical: 'stories', series: 'guess_the_number', blurb: 'b' }, verified({ value: '73%', fact: 'of x', url: 'https://news.test/1' }), d);
  assert.equal((seen.story![0] as { storyHeadline: string }).storyHeadline, 'of x');
});
test('Stories Free vs. Paid: tool name, url, description', async () => {
  const { d, seen } = deps();
  await run({ vertical: 'stories', series: 'free_vs_paid', blurb: 'b' }, verified({ toolName: 'Acme', url: 'https://acme.test', description: 'does x' }), d);
  assert.deepEqual(seen.story, [{ series: 'free_vs_paid', toolName: 'Acme', url: 'https://acme.test', description: 'does x' }]);
});
test('Explainers: title, manual origin, sourceUrl, sourceText from the passed pages clipped to 20000', async () => {
  const { d, seen } = deps();
  await run({ vertical: 'explainers', blurb: 'AI hallucinations' }, verified({ title: 'Hallucination', sourceUrl: 'https://news.test/1' }, [{ title: 'Hallucination', sourceUrl: 'https://news.test/2' }], 'a'.repeat(30_000)), d);
  const t = seen.explainer![0] as { title: string; origin: string; sourceUrl: string; sourceText: string };
  assert.equal(t.title, 'Hallucination');
  assert.equal(t.origin, 'manual');
  assert.equal(t.sourceUrl, 'https://news.test/1');
  assert.ok(t.sourceText.startsWith('https://news.test/1\n'));
  assert.ok(t.sourceText.length <= 20_000);
});
test('a refusal from an add function becomes refused with its message', async () => {
  const { d } = deps();
  d.carousel = async () => { throw Object.assign(new Error('You have 10 seeded stories waiting.'), { status: 409 }); };
  assert.deepEqual(await run({ vertical: 'carousels', blurb: 'b' }, verified(news), d), { status: 'refused', reason: 'You have 10 seeded stories waiting.' });
});
test('a reels duplicate outcome becomes duplicate with the existing headline', async () => {
  const { d } = deps();
  d.reel = async () => ({ status: 'duplicate', existing: { id: 'x', headline: 'Already there', net: 1, yours: false } });
  assert.deepEqual(await run({ vertical: 'reels', blurb: 'b' }, verified(news), d), { status: 'duplicate', existing: 'Already there' });
});
