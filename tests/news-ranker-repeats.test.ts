/**
 * lib/news-ranker/repeats (spin-offs: a different article about a story we ran) and lib/news-ranker/major
 * (one major-news call). Stub Jev only; nothing reaches the network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { askMajorNews } from '@/lib/news-ranker/major';
import { MAJOR_NEWS, SAME_EVENT } from '@/lib/news-ranker/questions';
import { findSpinOffs } from '@/lib/news-ranker/repeats';
import { SAME_EVENT_BAR } from '@/lib/news-ranker/scores';
import type { JevAsk } from '@/lib/social/jev/client';
import { SAME_EVENT_BAR as STORIES_SAME_EVENT_BAR } from '@/lib/stories/scores';

type Pair = { a: string; b: string; subject: string; version: string; aText: string };

/** same_event is high when both headlines name Acme. */
function stubJev() {
  const pairs: Pair[] = [];
  const jev: JevAsk = async (req, meta) => {
    const st = req.state as { story_a: { headline: string; untrusted_content: string }; story_b: { headline: string } };
    pairs.push({ a: st.story_a.headline, b: st.story_b.headline, subject: meta.subjectId, version: meta.version, aText: st.story_a.untrusted_content });
    const same = st.story_a.headline.includes('Acme') && st.story_b.headline.includes('Acme');
    return { answers: { same_event: { noul: same ? SAME_EVENT_BAR + 0.1 : SAME_EVENT_BAR - 0.1 } }, usage: { input_tokens: 100, output_tokens: 1 }, model: 's' };
  };
  return { jev, pairs };
}

test('findSpinOffs: asks SAME_EVENT only for pairs sharing a name, past headline-only items compare by headline, first hit wins', async () => {
  const { jev, pairs } = stubJev();
  const past = [
    { id: 'p0', headline: null },
    { id: 'p1', headline: 'Acme Ships Rocket' },
    { id: 'p2', headline: 'Acme Rocket Explodes', body: 'Long body about the rocket.' },
    { id: 'p3', headline: 'Zorblax Buys Startup' },
  ];
  const cands = [
    { id: 's1', headline: 'Acme Rocket Recap', text: 'x'.repeat(5000) },
    { id: 's2', headline: 'Quillon Raises Money', text: 'y' },
    { id: 's3', headline: 'Zorblax Deal Closes', text: 'z' },
  ];
  const r = await findSpinOffs(cands, past, { jev, component: 'test' });
  assert.deepEqual([...r.hits].map(([id, p]) => [id, p.id]), [['s1', 'p1']]);
  // s1 stops at its first hit (p1); s2 shares no name; s3 is asked once (Zorblax) and is below the bar; p0 has no headline.
  assert.deepEqual(pairs.map((p) => [p.a, p.b]).sort(), [['Acme Ships Rocket', 'Acme Rocket Recap'], ['Zorblax Buys Startup', 'Zorblax Deal Closes']]);
  assert.equal(r.asked, 2);
  assert.ok(pairs.every((p) => p.version === SAME_EVENT.version && p.subject.startsWith('test|')));
  assert.equal(pairs.find((p) => p.a === 'Acme Ships Rocket')!.aText, 'Acme Ships Rocket', 'a headline-only past item is its own content');
  assert.ok(r.costUsd > 0);
  assert.equal(STORIES_SAME_EVENT_BAR, SAME_EVENT_BAR, 'lib/stories/scores re-exports the bar');
});

test('findSpinOffs: no past items or no candidates make no call', async () => {
  const { jev, pairs } = stubJev();
  assert.equal((await findSpinOffs([{ id: 's', headline: 'Acme', text: '' }], [], { jev, component: 't' })).hits.size, 0);
  assert.equal((await findSpinOffs([], [{ headline: 'Acme' }], { jev, component: 't' })).hits.size, 0);
  assert.equal(pairs.length, 0);
});

test('askMajorNews: one MAJOR_NEWS call scored by majorNewsScore', async () => {
  const seen: string[] = [];
  const jev: JevAsk = async (req, meta) => {
    seen.push(meta.version);
    assert.deepEqual(Object.keys(req.questions).sort(), Object.keys(MAJOR_NEWS.questions).sort());
    return { answers: { happened: { noul: 1 }, news_kind: { noul: 1 }, blockbuster_entity: { noul: 1 }, global_relevance: { noul: 1 }, political_relevance: { noul: 1 }, speculative: { noul: 0 } }, usage: { input_tokens: 10, output_tokens: 0 }, model: 's' };
  };
  const r = await askMajorNews(jev, { key: 'k', headline: 'H', text: 'T', outlets: ['O'], published: null });
  assert.deepEqual(seen, [MAJOR_NEWS.version]);
  assert.ok(Math.abs(r.major - 1) < 1e-9);
});
