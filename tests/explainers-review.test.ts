import assert from 'node:assert/strict';
import test from 'node:test';

import { loadJobDetail } from '@/lib/explainers/overview';
import { addArtifact, addLintViolations, addTopics, claimNextJob, finishJob, recordCost, requestRender, saveFeedback } from '@/lib/explainers/repository';
import { DEFAULT_SETTINGS } from '@/lib/explainers/settings';

import { scratchExplainersDb } from './explainers-pglite';

test('the review drawer gets inputs, plan, outputs, run, and the saved review', async () => {
  const { db } = await scratchExplainersDb();
  const [topic] = await addTopics(db, [{ title: 'What is an API?', scope: 'Explain an API call.', origin: 'manual' }]);
  await db.query(`UPDATE explainers.topics SET status = 'pool' WHERE id = $1`, [topic.id]);
  await requestRender(db, { topicId: topic.id, trigger: 'click', settings: DEFAULT_SETTINGS });
  const job = (await claimNextJob(db))!;
  await addArtifact(db, { jobId: job.id, kind: 'brief', content: 'BRIEF' });
  await addArtifact(db, { jobId: job.id, kind: 'video', storagePath: `jobs/${job.id}/video.mp4`, bytes: 10 });
  await addLintViolations(db, job.id, [{ source: 'storyboard', rule: 'voiceover_words', frame: 3, severity: 'warning', detail: '22 words' }]);
  await recordCost(db, { jobId: job.id, mode: 'development', vendor: 'anthropic', component: 'session_a:claude-sonnet-5-5', usd: 0.5 });
  await recordCost(db, { jobId: job.id, mode: 'development', vendor: 'heygen', component: 'tts+bgm+sfx', usd: null });
  await finishJob(db, job.id, { status: 'ok' });

  let detail = await loadJobDetail(db, job.id);
  assert.equal(detail?.topic?.title, 'What is an API?');
  assert.equal(detail?.job.status, 'ok');
  assert.deepEqual(detail?.artifacts.map((a) => [a.kind, a.hasFile, a.content]), [['brief', false, 'BRIEF'], ['video', true, null]]);
  assert.deepEqual(detail?.lint.map((v) => v.rule), ['voiceover_words']);
  assert.deepEqual(detail?.costs.map((c) => [c.vendor, c.usd, c.usd_known]), [['anthropic', 0.5, true], ['heygen', 0, false]]);
  assert.equal(detail?.feedback, null);

  await saveFeedback(db, { jobId: job.id, verdict: 'rejected', tags: ['pacing', 'hook'], note: 'Too fast.' });
  detail = await loadJobDetail(db, job.id);
  assert.deepEqual(detail?.feedback && [detail.feedback.verdict, detail.feedback.tags, detail.feedback.note], ['rejected', ['hook', 'pacing'], 'Too fast.']);
  assert.equal(detail?.job.verdict, 'rejected');
  assert.equal(await loadJobDetail(db, crypto.randomUUID()), null);
});
