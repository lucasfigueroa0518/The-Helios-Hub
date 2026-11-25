// Resuming a failed render (2026-11-24): the job goes back to the queue under its own id, a finished build is not rebuilt,
// and a resumed job's checks never write the same finding twice. Offline (PGlite, temp folders).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { addLintViolations, addTopics, claimNextJob, finishJob, getJob, listLintViolations, requestRender, resumeRenderJob } from '@/lib/explainers/repository';
import { resumePoint } from '@/lib/explainers/render/job';
import { DEFAULT_SETTINGS } from '@/lib/explainers/settings';

import { scratchExplainersDb } from './explainers-pglite';

function jobFolder(files: string[]): { jobDir: string; projectDir: string } {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hx-resume-'));
  const projectDir = path.join(jobDir, 'project');
  for (const f of files) {
    const p = path.join(jobDir, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x');
  }
  return { jobDir, projectDir };
}
const FRAMES = ['01-opener', '02-define', '03-handoff', '04-analogy', '05-payoff', '06-example', '07-tie', '08-close'].map((f) => `project/compositions/frames/${f}.html`);

test('resumePoint reads the disk: no plan, plan only, finished build', () => {
  assert.equal(resumePoint(jobFolder([])), 'plan');
  assert.equal(resumePoint(jobFolder(['project/STORYBOARD.md', 'project/SCRIPT.md'])), 'build');
  // Every frame assembled but session B never wrote its summary: it may have stopped mid-fix, so it builds again.
  assert.equal(resumePoint(jobFolder(['project/STORYBOARD.md', 'project/SCRIPT.md', 'project/index.html', ...FRAMES])), 'build');
  assert.equal(resumePoint(jobFolder(['project/STORYBOARD.md', 'project/SCRIPT.md', 'project/index.html', ...FRAMES.slice(1), 'telemetry/session-b-summary.json'])), 'build');
  assert.equal(resumePoint(jobFolder(['project/STORYBOARD.md', 'project/SCRIPT.md', 'project/index.html', ...FRAMES, 'telemetry/session-b-summary.json'])), 'finish');
});

test('resumeRenderJob requeues only a failed job, keeping its id, place and spend', async () => {
  const { db } = await scratchExplainersDb();
  const [topic] = await addTopics(db, [{ title: 'resume me', origin: 'seeded' }]);
  const req = await requestRender(db, { topicId: topic.id, trigger: 'click', settings: DEFAULT_SETTINGS });
  assert.ok(req.ok);
  const id = req.job.id;
  assert.equal(await resumeRenderJob(db, id), false, 'a requested job is not resumed');
  await claimNextJob(db);
  await db.query(`UPDATE explainers.jobs SET spend_usd = 19.7 WHERE id = $1`, [id]);
  await finishJob(db, id, { status: 'failed', error: 'Worker restarted while this render was running.' });
  assert.equal(await resumeRenderJob(db, id), true);
  const job = await getJob(db, id);
  assert.equal(job?.status, 'requested');
  assert.equal(job?.error ?? null, null);
  assert.equal(Number(job?.spend_usd), 19.7);
  assert.equal((await claimNextJob(db))?.id, id, 'the worker claims it again');
});

test('a resumed job never writes the same finding twice', async () => {
  const { db } = await scratchExplainersDb();
  const [topic] = await addTopics(db, [{ title: 'lint twice', origin: 'seeded' }]);
  const req = await requestRender(db, { topicId: topic.id, trigger: 'click', settings: DEFAULT_SETTINGS });
  assert.ok(req.ok);
  const v = { source: 'storyboard' as const, rule: 'breakage:bounds', frame: null, severity: 'warning' as const, detail: 'off the edge' };
  await addLintViolations(db, req.job.id, [v, { ...v, frame: 3 }]);
  await addLintViolations(db, req.job.id, [v, { ...v, frame: 3 }, { ...v, detail: 'new' }]);
  assert.equal((await listLintViolations(db, req.job.id)).length, 3);
});
