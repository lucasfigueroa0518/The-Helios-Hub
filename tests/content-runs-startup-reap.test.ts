/** Startup reaping (CI-33): each content daemon fails or releases only its own rows left running, at age 0. Offline, stubbed query. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { failStaleJobs } from '@/lib/reel-ai-drama/production/jobs';
import { failStaleDramaRequests } from '@/lib/reel-ai-drama/requests';
import { reapReelsAtStartup } from '@/lib/reels/startup-reap';
import { reapRunsAtStartup as reapCarouselRuns } from '@/lib/social/overnight/runs';
import { releaseBuildsAtStartup } from '@/lib/stories/repository';

type Call = { text: string; params?: unknown[] };
function stub(rows: unknown[] = [{ id: 'a' }]) {
  const calls: Call[] = [];
  const query = async (text: string, params?: unknown[]) => {
    calls.push({ text: text.replace(/\s+/g, ' '), params });
    return { rows, rowCount: rows.length } as never;
  };
  return { calls, query };
}

test('Stories: building sets go back to requested at age 0', async () => {
  const s = stub();
  assert.deepEqual(await releaseBuildsAtStartup({ query: s.query } as never), ['a']);
  assert.equal(s.calls.length, 1);
  assert.match(s.calls[0].text, /UPDATE stories\.sets SET status = 'requested'/);
  assert.match(s.calls[0].text, /WHERE status = 'building'/);
  assert.deepEqual(s.calls[0].params, [0]);
});

test('Carousels: only running social.runs are failed; requested stay queued', async () => {
  const s = stub();
  assert.equal(await reapCarouselRuns(s.query as never), 1);
  assert.match(s.calls[0].text, /UPDATE social\.runs SET status = 'failed'/);
  assert.match(s.calls[0].text, /WHERE status = 'running' RETURNING/);
  assert.doesNotMatch(s.calls[0].text, /requested/);
});

test('Reels: the night run and every stage table fail their running rows, nothing else', async () => {
  const s = stub([{}]);
  const out = await reapReelsAtStartup(s.query);
  const tables = s.calls.map((c) => /UPDATE (\S+)/.exec(c.text)?.[1]);
  assert.deepEqual(tables, ['reels.runs', 'reels.copy_jobs', 'reels.visual_jobs', 'reels.video_jobs', 'reels.song_picks']);
  for (const c of s.calls) {
    assert.match(c.text, /SET status = 'failed'/);
    assert.match(c.text, /WHERE status = 'running'$/);
  }
  assert.match(s.calls[0].text, /note = COALESCE\(note, \$1\)/);
  assert.equal(Object.keys(out).length, 5);
});

test('AI Drama: age 0 reaches the job and request reapers', async () => {
  const jobs = stub([]);
  assert.equal(await failStaleJobs({ query: jobs.query } as never, 'restart', 0), 0);
  assert.match(jobs.calls[0].text, /FROM reel_ai_drama\.jobs j WHERE j\.status = 'running'/);
  assert.deepEqual(jobs.calls[0].params, [0]);
  const reqs = stub();
  assert.equal(await failStaleDramaRequests({ query: reqs.query } as never, 0), 1);
  assert.match(reqs.calls[0].text, /UPDATE reel_ai_drama\.requests SET status = 'failed'.*WHERE status = 'running'/);
  assert.deepEqual(reqs.calls[0].params, [0]);
});

test('Workers wire the startup reap, and --once never reaps at age 0', () => {
  const src = (f: string) => fs.readFileSync(`scripts/${f}`, 'utf8');
  assert.match(src('stories_worker.ts'), /if \(!once\) \{\s*const released = await releaseBuildsAtStartup\(db\)/);
  const reels = src('reels_worker.ts');
  assert.ok(reels.indexOf('reapReelsAtStartup()') > reels.indexOf('if (once) {'), 'reels reaps after the --once branch');
  assert.match(src('social_worker.ts'), /runs\.reapRunsAtStartup\(query\)/);
  assert.match(src('reel_ai_drama_worker.ts'), /const startupAge = once \? undefined : 0;/);
});
