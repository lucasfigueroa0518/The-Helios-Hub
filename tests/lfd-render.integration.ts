import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPost } from '@/lib/lfd/post';
import type { Ready } from '@/lib/lfd/types';
import { checkRenderFit } from '@/lib/social/render/fit-check';

const svg = (w: number, h: number) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#556"/></svg>`)}`;
const ready = (i: number, o: { setup?: string; headline?: string; body?: string } = {}): Ready => ({
  pick: { key: `k${i}`, refs: [], origin: 'reels', headline: '', sourceName: 'S', url: 'https://s.com', body: '', publishedAt: null, net: 1, blockbuster: 0, firstSeen: null, alsoFrom: [], major: null, lane: 'rundown' },
  copy: { key: `k${i}`, setup: o.setup ?? '', headline: o.headline ?? 'Google Just Dropped Nano Banana 2.1', highlight: 'Nano Banana 2.1', names: ['Google'], body: o.body ?? 'Google says it beats its earlier image models. API images cost half what Nano Banana 2 charged', photo: { kind: 'product', query: 'q', subjects: [], alts: [] } },
  photo: { src: svg(i % 2 ? 900 : 1600, i % 2 ? 1200 : 900), credit: 'C', kind: 'scene' },
});

test('5 and 6 story posts at the writer targets render with no fit problems', async () => {
  for (const count of [5, 6]) {
    const res = await checkRenderFit(buildPost(Array.from({ length: count }, (_, i) => ready(i)), new Date()));
    assert.deepEqual(res.problems.filter((p) => /text fit/.test(p)), [], `count ${count}`);
    assert.deepEqual(res.violations, []);
  }
});

test('copy at the hard maximums fits exactly', async () => {
  const max = ready(0, {
    setup: 'All those years of refusing to learn Excel and PowerPoint are about to pay off for you:',
    headline: 'Claude Now Works Inside Google Docs, Sheets and Slides for Every Team',
    body: 'A sidebar reads your open file and edits it in place. Or paste a Google file link into a Claude chat and it edits from there. Anthropic says it ships to paid plans',
  });
  const res = await checkRenderFit(buildPost([max, ready(1), ready(2), ready(3), ready(4)], new Date()));
  assert.deepEqual(res.problems.filter((p) => /text fit/.test(p)), []);
});

test('over-long body is reported as a text-fit problem (never shrunk)', async () => {
  const long = ready(0, { body: 'word '.repeat(80).trim() });
  const res = await checkRenderFit(buildPost([long, ready(1), ready(2), ready(3), ready(4)], new Date()));
  assert.ok(res.problems.some((p) => /slide 2 text fit/.test(p)), res.problems.join('\n'));
});

test('a 3-line headline is reported as a text-fit problem', async () => {
  const three = ready(0, { headline: 'Anthropic Announces Another Major Update Bringing Faster Smarter Cheaper Models to Every Developer Team Worldwide Today' });
  const res = await checkRenderFit(buildPost([three, ready(1), ready(2), ready(3), ready(4)], new Date()));
  assert.ok(res.problems.some((p) => /slide 2 text fit/.test(p)), res.problems.join('\n'));
});

test('a headline with one extremely long word is reported, not cut off', async () => {
  const wide = ready(0, { headline: 'Supercalifragilisticexpialidociousagentplatformthingy' });
  const res = await checkRenderFit(buildPost([wide, ready(1), ready(2), ready(3), ready(4)], new Date()));
  assert.ok(res.problems.some((p) => /slide 2 text fit/.test(p)) || res.violations.length > 0, res.problems.join('\n'));
});
