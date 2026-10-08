import assert from 'node:assert/strict';
import test from 'node:test';

import { episodeLine, parseCaption } from '@/lib/explainers/caption';
import { addTopics, finishJob, nextEpisodeNumber, recordCost, requestRender, claimNextJob } from '@/lib/explainers/repository';
import { DEFAULT_SETTINGS } from '@/lib/explainers/settings';

import { scratchExplainersDb } from './explainers-pglite';

const CONTEXT_WINDOW = `AI BRAIN BREAK - EPISODE 1:

Your AI didn't forget the start of the chat. It fell off the desk.

When a chat runs to 1,200 tokens and the window holds 1,000, the oldest 200 drop out.

Save this for the next time a long chat loses the beginning.

#contextwindow #tokens #ai`;

test('the context-window caption passes the post rules', () => {
  const text = parseCaption(CONTEXT_WINDOW, 1);
  assert.equal(text.split('\n')[0], episodeLine(1));
  const hook = 'Your AI didn\'t forget the start of the chat. It fell off the desk.';
  assert.ok(`${episodeLine(1)}\n\n${hook}`.length <= 125);
});

test('a caption is rejected when the series line, hook, save line, or tags are wrong', () => {
  const base = CONTEXT_WINDOW;
  assert.throws(() => parseCaption(base.replace('EPISODE 1', 'EPISODE 2'), 1), /must open with/);
  assert.throws(() => parseCaption(`AI BRAIN BREAK - EPISODE 1:\n\n${'x'.repeat(120)}\n\nSave this for the next time it happens.\n\n#a #b #c`, 1), /125/);
  assert.throws(() => parseCaption(base.replace('Save this for the next time', 'Keep this'), 1), /save line/);
  assert.throws(() => parseCaption(base.replace('#ai', ''), 1), /3 to 5/);
  assert.throws(() => parseCaption(`${base} #extra #tags #too #many`, 1), /3 to 5/);
  assert.throws(() => parseCaption(`${base} 🔥`, 1), /emoji/);
  assert.throws(() => parseCaption(base.replace('the chat', 'https://example.com'), 1), /URL/);
  assert.throws(() => parseCaption(base.replace('Your AI', 'We'), 1), /speaks as Helios/);
});

test('episode numbers count finished reels that spent money', async () => {
  const { db } = await scratchExplainersDb();
  const [paid, free] = await addTopics(db, [
    { title: 'Context window', scope: 'What fits.', origin: 'manual' },
    { title: 'API fixture', scope: 'A free test.', origin: 'manual' },
  ]);
  await db.query(`UPDATE explainers.topics SET status = 'pool' WHERE id = ANY($1)`, [[paid.id, free.id]]);

  const paidReq = await requestRender(db, { topicId: paid.id, trigger: 'click', settings: DEFAULT_SETTINGS });
  assert.ok(paidReq.ok);
  const paidJob = (await claimNextJob(db))!;
  assert.equal(await nextEpisodeNumber(db, paidJob.id), 1);
  await recordCost(db, { jobId: paidJob.id, mode: 'development', vendor: 'anthropic', component: 'session_a', usd: 2.47 });
  await finishJob(db, paidJob.id, { status: 'ok' });

  const freeReq = await requestRender(db, { topicId: free.id, trigger: 'click', settings: DEFAULT_SETTINGS });
  assert.ok(freeReq.ok);
  const freeJob = (await claimNextJob(db))!;
  await finishJob(db, freeJob.id, { status: 'ok' });

  const [next] = await addTopics(db, [{ title: 'Next reel', scope: 'The one after.', origin: 'manual' }]);
  await db.query(`UPDATE explainers.topics SET status = 'pool' WHERE id = $1`, [next.id]);
  const nextReq = await requestRender(db, { topicId: next.id, trigger: 'click', settings: DEFAULT_SETTINGS });
  assert.ok(nextReq.ok);
  const nextJob = (await claimNextJob(db))!;
  assert.equal(await nextEpisodeNumber(db, nextJob.id), 2);
});
