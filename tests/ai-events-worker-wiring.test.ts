/** AI Events This Week in the workers, the deploy guard and the overnight doc (plan M4), pinned by text like lfd-worker-wiring. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

test('the social worker runs AI Events in its own loop: the noon clock, claims, publishing, insights', () => {
  const text = read('scripts/social_worker.ts');
  // The Sunday 12:00 clock is a pure decision; the worker only asks it.
  assert.match(text, /let aiEventsAt = firstAiEventsCheckAt\(new Date\(\)\)/);
  assert.match(text, /const noon = noonQueue\(new Date\(\), ae, aePlan \? isAiEventsDay\(aePlan, aeToday\) : null\)/);
  assert.match(text, /aiEventsStore\.requestRun\(lfdQuery, 'scheduled', ae\.runCapUsd\)/);
  assert.match(text, /aiEventsAt = nextAiEventsRunAt\(new Date\(\)\)/);
  // Claimed after Last Few Days' claim, inside the timeout wrapper.
  const lfdClaim = text.indexOf('lfdStore.claimRun(lfdQuery)');
  const aeClaim = text.indexOf('aiEventsStore.claimRun(lfdQuery)');
  assert.ok(lfdClaim > 0 && aeClaim > lfdClaim, 'the AI Events claim comes after the Last Few Days claim');
  assert.match(text, /withAiEventsTimeout\(\s*carryOutAiEventsRun\(/);
  assert.match(text, /AI_EVENTS_RUN_TIMEOUT_MS/);
  assert.match(text, /ai_events_run_timeout/);
  assert.match(text, /aiEventsStore\.failRun\(lfdQuery, aeClaimed\.id, 'timed out after 30 minutes'\)/);
  assert.match(text, /engine: \(_run, capUsd\) => liveAiEventsDeps\(lfdQuery, \{ capUsd \}\)/);
  assert.match(text, /snapshot: aiEventsSnapshot/);
  // Release and publish only while the single publisher doesn't drive the type.
  assert.match(text, /aeNow\?\.publishingLive && !\(await publisherOwnsPublishing\(query, AI_EVENTS_SPINE_VERTICAL\)\)/);
  assert.match(text, /releaseDueAiEvents\(query, \{ requireApproval: aeNow\.requireApproval \}\)/);
  assert.match(text, /claimAndPublishAiEvents\(/);
  assert.match(text, /pollCarouselInsights\(query, client, new Date\(\), 200, 'ai_events'\)/);
});

test('the AI Events engine never builds a Claude client', () => {
  for (const file of ['lib/ai-events/live.ts', 'lib/ai-events/run.ts', 'lib/ai-events/worker.ts']) {
    const text = read(file);
    assert.doesNotMatch(text, /anthropic|messages\.create|liveMessagesCreate/i, file);
  }
});

test('the single publisher drives AI Events with the calendar snapshot', () => {
  const text = read('scripts/publisher_worker.ts');
  assert.match(text, /aiEventsDriver\(\{ query, meta: createLiveCarouselClient, signImage: \(p, s\) => slideBucket\.sign\(p, s\), token, snapshot: liveAiEventsSnapshot\(/);
});

test('a deploy waits for a running AI Events run', () => {
  assert.match(read('scripts/gcp/deploy-social-worker.sh'), /UNION ALL SELECT 'ai events run ' \|\| id FROM ai_events\.runs WHERE status = 'running'/);
});

test('the deploy guard never fails open on a missing ai_events schema: its line joins only once the table exists', () => {
  const text = read('scripts/gcp/deploy-social-worker.sh');
  // A bare reference to ai_events.runs before the schema apply would error the whole UNION and
  // print "deploying anyway", dropping every other in-flight check (LFD, reels, explainers, publish).
  assert.match(text, /SELECT to_regclass\('ai_events\.runs'\) IS NOT NULL/);
  assert.match(text, /AI_EVENTS_INFLIGHT="UNION ALL SELECT 'ai events run ' \|\| id FROM ai_events\.runs WHERE status = 'running'"/);
  const inflight = text.slice(text.indexOf('INFLIGHT="$(psql'), text.indexOf("|| echo 'CHECK_FAILED'"));
  assert.ok(inflight.length > 0, 'the in-flight query exists');
  assert.doesNotMatch(inflight, /FROM ai_events\.runs/, 'the in-flight query names ai_events only through the guarded variable');
  assert.match(inflight, /\$\{AI_EVENTS_INFLIGHT\}/);
  assert.match(inflight, /FROM lfd\.runs WHERE status = 'running'/);
  assert.ok(text.indexOf('AI_EVENTS_INFLIGHT=""') < text.indexOf('INFLIGHT="$(psql'), 'the guard is decided before the query runs');
});

test('orchestration: the Sunday ingest, its details job and the snapshot are wired (plan M1/M3)', () => {
  const handlers = read('lib/orchestration/handlers.ts');
  const types = read('lib/orchestration/types.ts');
  const config = read('lib/orchestration/config.ts');
  assert.match(types, /'networking\.event_details',/);
  assert.match(config, /'networking\.event_details': \{ lane: 'maintenance'/);
  // Never revived once done: one ingest per Sunday key, one details job per ingest run.
  const reconcile = handlers.slice(handlers.indexOf('weeklyIngestDecision'), handlers.indexOf('networkingWeeklyEnqueued = 1'));
  assert.match(reconcile, /decision\.dedupeKey/);
  assert.doesNotMatch(reconcile, /reviveTerminal/);
  const details = handlers.slice(handlers.indexOf('async function handleNetworkingEventDetails'), handlers.indexOf('const HANDLERS'));
  assert.match(details, /runEventDetails\(\)/);
  assert.match(details, /publishSnapshot\(\{ reason: 'networking\.event_details' \}\)/);
  // A snapshot failure is reported, never a failed details job.
  assert.match(details, /catch \(err\)[\s\S]*snapshot = \{ error:/);
});

test('the overnight doc has the AI Events clock row and its paragraph', () => {
  const doc = read('docs/social-overnight.md');
  assert.match(doc, /^\| AI Events This Week \| `ai_events` \| `helios-social`/m);
  assert.match(doc, /12:00 PM on its days \(`ai_events\.settings\.days`, Sunday\)/);
  assert.match(doc, /AI Events This Week \(`planning\/AI Events\/DECISIONS\.md`\) also runs inside `helios-social`/);
});
