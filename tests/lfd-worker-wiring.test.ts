// tests/lfd-worker-wiring.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

test('the social worker runs Last Few Days in its own loop: the 3:00 slot, claims, publishing, insights', () => {
  const text = read('scripts/social_worker.ts');
  assert.match(text, /threeAmQueue\(calendarDateKey\(new Date\(\)\), lfd, await autoRunOn\(\)/);
  assert.match(text, /lfdStore\.requestRun\(lfdQuery, 'scheduled'/);
  assert.match(text, /lfdStore\.claimRun\(lfdQuery\)/);
  assert.match(text, /carryOutLfdRun\(/);
  // A hung run can't stall the loop: it is cut off at LFD_RUN_TIMEOUT_MS and failed.
  assert.match(text, /withLfdTimeout\(/);
  assert.match(text, /LFD_RUN_TIMEOUT_MS/);
  assert.match(text, /lfd_run_timeout/);
  assert.match(text, /failRun\(lfdQuery, lfdClaimed\.id, 'timed out after 30 minutes'\)/);
  assert.match(text, /liveLfdDeps\(lfdQuery, \{ capUsd, trigger: run\.trigger, runId: run\.id \}\)/);
  assert.match(text, /publisherOwnsPublishing\(query, 'last_few_days'\)/);
  assert.match(text, /claimAndPublishLfd\(/);
  assert.match(text, /pollCarouselInsights\(query, client, new Date\(\), 200, 'last_few_days'\)/);
  // The carousel run is queued only when the slot belongs to it.
  assert.match(text, /else if \(slot\.queue === 'carousels'\)/);
});

test('a deploy waits for a running Last Few Days run', () => {
  assert.match(read('scripts/gcp/deploy-social-worker.sh'), /UNION ALL SELECT 'last few days run ' \|\| id FROM lfd\.runs WHERE status = 'running'/);
});

test('the overnight doc has the Last Few Days clock row', () => {
  const doc = read('docs/social-overnight.md');
  assert.match(doc, /^\| Last Few Days \| `lfd` \| `helios-social`/m);
  assert.match(doc, /not on Last Few Days days while its `auto_run` is on/);
});
