import assert from 'node:assert/strict';
import test from 'node:test';

import {
  episodeLine,
  parseCaption,
  stampCaption,
  stripEpisodePrefix,
} from '@/lib/explainers/caption';
import { nextPublishedEpisode, queuePublish } from '@/lib/explainers/publish/publish';
import { saveFeedback } from '@/lib/explainers/repository';

import { scratchExplainersDb } from './explainers-pglite';

const CONTEXT_WINDOW = `Your AI didn't forget the start of the chat. It fell off the desk.

A context window is the text a language model can see at once, measured in tokens. Think of a desk that only holds so much paper. Once the pile is taller than the desk, the oldest pages slide off the edge. Those pages are gone from what the model can use.

The reel's example is a 1,000-token window and a 1,200-token chat. The first 200 tokens of that chat are no longer in view. That is why a long thread starts answering as if the opening never happened.

This shows up any time a chat runs long, a PDF gets pasted in, or a project file is too big to fit. The model is not being careless. The window filled up.

Save this for the next time a long chat loses the beginning.

#contextwindow #tokens #ai`;

test('the context-window caption passes the post rules', () => {
  const text = parseCaption(CONTEXT_WINDOW);
  assert.equal(text.split('\n')[0], 'Your AI didn\'t forget the start of the chat. It fell off the desk.');
  const hook = text.split('\n')[0]!;
  assert.ok(`${episodeLine(1)}\n\n${hook}`.length <= 125);
  assert.ok(!/^AI Brain Break/i.test(text));
});

test('a caption is rejected when the hook, length, or tags are wrong', () => {
  const base = CONTEXT_WINDOW;
  assert.throws(() => parseCaption(`AI Brain Break Episode 1:\n\n${'x'.repeat(120)}\n\n${base}`), /125/);
  assert.throws(() => parseCaption(base.replace('#ai', '')), /3 to 5/);
  assert.throws(() => parseCaption(`${base} #extra #tags #too #many`), /3 to 5/);
  assert.throws(() => parseCaption(`${base} 🔥`), /emoji/);
  assert.throws(() => parseCaption(base.replace('the chat', 'https://example.com')), /URL/);
  assert.throws(() => parseCaption(base.replace('Your AI', 'We')), /speaks as Helios/);
  assert.throws(
    () => parseCaption('A short hook.\n\nToo thin.\n\nSave this for later.\n\n#a #b #c'),
    /at least 400/,
  );
});

test('publish strips a baked-in episode line and stamps the published count', () => {
  const old = `AI BRAIN BREAK - EPISODE 4:\n\n${CONTEXT_WINDOW}`;
  assert.equal(stripEpisodePrefix(old), CONTEXT_WINDOW);
  assert.equal(stampCaption(old, 1), `${episodeLine(1)}\n\n${CONTEXT_WINDOW}`);
  assert.equal(stampCaption('AI BRAIN BREAK - EPISODE 1: APIs', 2), `${episodeLine(2)}\n\nAPIs`);
});

test('episode numbers count published explainers, not finished renders', async () => {
  const { db } = await scratchExplainersDb();
  assert.equal(await nextPublishedEpisode(db), 1);

  const { rows: t } = await db.query<{ id: string }>(
    `INSERT INTO explainers.topics (title, origin, status) VALUES ('Context window', 'manual', 'rendered') RETURNING id`,
  );
  const { rows: j } = await db.query<{ id: string }>(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, finished_at)
     VALUES ($1, 'ok', 'click', 'development', 5, 'm', 'm', now()) RETURNING id`,
    [t[0]!.id],
  );
  const jobId = j[0]!.id;
  await db.query(
    `INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location)
     VALUES ($1, 'video', $2, 5000000, 'bucket')`,
    [jobId, `jobs/${jobId}/video.mp4`],
  );
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, content) VALUES ($1, 'post_caption', $2)`, [jobId, CONTEXT_WINDOW]);
  await saveFeedback(db, { jobId, verdict: 'approved', tags: [] });

  const queued = await queuePublish(db, jobId, 'approve');
  assert.equal(queued.queued, true);
  assert.equal(await nextPublishedEpisode(db), 1, 'queued is not published');

  await db.query(`UPDATE social_hub.publish_attempts SET status = 'published' WHERE vertical = 'explainers'`);
  assert.equal(await nextPublishedEpisode(db), 2);
});
