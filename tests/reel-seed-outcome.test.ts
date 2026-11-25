/** What the Text on Screen seed drawer says for each way a seed click can come out (pure; no database, no network). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { seedOutcomeView } from '@/lib/reels/seed-outcome';

const added = { status: 'added' as const, id: 'i1', title: 'My headline', scored: true, net: 2.345, flags: [] as string[] };

test('added: names the score and says nothing was made', () => {
  assert.deepEqual(seedOutcomeView(added), { kind: 'toast', text: '“My headline” is in the queue, scored 2.35. Nothing was made.' });
  assert.match((seedOutcomeView({ ...added, scored: false, net: null }) as { text: string }).text, /not scored yet/);
  assert.match((seedOutcomeView({ ...added, net: null }) as { text: string }).text, /no bucket cleared its bar/);
});

test('added from a substitute story: the note says which story and why', () => {
  const out = seedOutcomeView({ ...added, flags: ['Built from “Wire story” (Wire), found from your headline.'], substitute: { url: 'https://w.test/a', title: 'Wire story', why: 'headline_only' } });
  assert.equal(out.kind, 'toast');
  assert.match((out as { text: string }).text, /Built from “Wire story” \(Wire\), found from your headline\./);
});

test('duplicate: shows the existing idea, its score and whether it is yours', () => {
  assert.deepEqual(seedOutcomeView({ status: 'duplicate', existing: { id: 'i9', headline: 'Already here', net: 1.5, yours: true } }), {
    kind: 'duplicate',
    existing: { id: 'i9', headline: 'Already here', scoreText: 'scored 1.50', yours: true },
  });
  const unscored = seedOutcomeView({ status: 'duplicate', existing: { id: 'i9', headline: 'Already here', net: null, yours: false } });
  assert.equal(unscored.kind === 'duplicate' && unscored.existing.scoreText, 'not scored');
});

test('needs_paid_confirm: quotes the cost in cents and the ceiling, and says why a search is offered', () => {
  const out = seedOutcomeView({ status: 'needs_paid_confirm', estimateUsd: 0.1, maxUsd: 0.15 });
  assert.equal(out.kind, 'confirm');
  assert.match((out as { text: string }).text, /about 10¢/i);
  assert.match((out as { text: string }).text, /never more than 15¢/);
  assert.match((out as { text: string }).text, /no related story/);
  const link = seedOutcomeView({ status: 'needs_paid_confirm', estimateUsd: 0.1, maxUsd: 0.15, linkUnreadable: true });
  assert.match((link as { text: string }).text, /couldn’t read your link/);
});

test('no_match: a plain message for each reason, and the link when it was the problem', () => {
  assert.match((seedOutcomeView({ status: 'no_match', reason: 'nothing_found' }) as { text: string }).text, /couldn’t find a related story/);
  assert.match((seedOutcomeView({ status: 'no_match', reason: 'nothing_found', linkUnreadable: true }) as { text: string }).text, /couldn’t read your link.*paste/is);
  assert.match((seedOutcomeView({ status: 'no_match', reason: 'scoring_unavailable' }) as { text: string }).text, /scoring is unavailable/i);
});
