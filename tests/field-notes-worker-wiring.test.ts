/** Field Notes in the workers, the deploy guard and the overnight doc, pinned by text like ai-events-worker-wiring. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

test('the social worker runs Field Notes in its own loop: the noon clock, claims, publishing, insights', () => {
  const text = read('scripts/social_worker.ts');
  assert.match(text, /let fieldNotesAt = firstFieldNotesCheckAt\(new Date\(\)\)/);
  assert.match(text, /fieldNotesStore\.requestRun\(lfdQuery, 'scheduled', fn\.runCapUsd\)/);
  assert.match(text, /fieldNotesAt = nextFieldNotesRunAt\(new Date\(\)\)/);
  // Claimed after AI Events' claim, inside the hang guard.
  const aeClaim = text.indexOf('aiEventsStore.claimRun(lfdQuery)');
  const fnClaim = text.indexOf('fieldNotesStore.claimRun(lfdQuery)');
  assert.ok(aeClaim > 0 && fnClaim > aeClaim, 'the Field Notes claim comes after the AI Events claim');
  assert.match(text, /withHangGuard\(\s*carryOutFieldNotesRun\(/);
  assert.match(text, /fieldNotesStore\.failRun\(lfdQuery, fnClaimed\.id, reason\)/);
  assert.match(text, /engine: \(_run, capUsd\) => liveFieldNotesDeps\(lfdQuery, \{ capUsd \}\)/);
  // Release and publish only while the single publisher doesn't drive the type.
  assert.match(text, /fnNow\?\.publishingLive && !\(await publisherOwnsPublishing\(query, FIELD_NOTES_SPINE_VERTICAL\)\)/);
  assert.match(text, /releaseDueFieldNotes\(query, \{ requireApproval: fnNow\.requireApproval \}\)/);
  assert.match(text, /claimAndPublishFieldNotes\(/);
  assert.match(text, /pollCarouselInsights\(query, client, new Date\(\), 200, 'field_notes'\)/);
});

test('the single publisher drives Field Notes', () => {
  assert.match(read('scripts/publisher_worker.ts'), /fieldNotesDriver\(\{ query, meta: createLiveCarouselClient, signImage: \(p, s\) => slideBucket\.sign\(p, s\), token \}\)/);
});

test('the deploy guard waits for a running Field Notes run, and joins it only once the table exists', () => {
  const text = read('scripts/gcp/deploy-social-worker.sh');
  assert.match(text, /SELECT to_regclass\('field_notes\.runs'\) IS NOT NULL/);
  assert.match(text, /FIELD_NOTES_INFLIGHT="UNION ALL SELECT 'field notes run ' \|\| id FROM field_notes\.runs WHERE status = 'running'"/);
  const inflight = text.slice(text.indexOf('INFLIGHT="$(psql'), text.indexOf("|| echo 'CHECK_FAILED'"));
  assert.doesNotMatch(inflight, /FROM field_notes\.runs/, 'the in-flight query names field_notes only through the guarded variable');
  assert.match(inflight, /\$\{FIELD_NOTES_INFLIGHT\}/);
  assert.ok(text.indexOf('FIELD_NOTES_INFLIGHT=""') < text.indexOf('INFLIGHT="$(psql'), 'the guard is decided before the query runs');
});

test('the overnight doc has the Field Notes clock row and its paragraph', () => {
  const doc = read('docs/social-overnight.md');
  assert.match(doc, /\| Field Notes \| `field_notes` \| `helios-social`/);
  assert.match(doc, /Field Notes \(`planning\/Field Notes\/CONTRACT\.md`\) also runs inside `helios-social`/);
});

test('the hub knows Field Notes the way its engine config does: window, days, slot, cap, label, seed, publish gate', async () => {
  const { FIELD_NOTES_AUTO_DAYS, FIELD_NOTES_SLOT, FIELD_NOTES_WINDOW } = await import('@/lib/field-notes/config');
  const { PLAN } = await import('@/lib/social-hub/views/plan');
  const { DEFAULT_CAPS, DEFAULT_TIMES, USUAL } = await import('@/lib/social-hub/slots/times');
  const { WINDOWS } = await import('@/lib/social-hub/health/approvals');
  const { verticalInfo, typeHref } = await import('@/lib/social-hub/verticals');
  const { isSeedable } = await import('@/lib/content-type/seed-verticals');
  const { maxCapFor } = await import('@/lib/content-type/caps');

  const w = PLAN.field_notes[0]!;
  assert.deepEqual([w.id, w.startMinute, w.endMinute], [FIELD_NOTES_SLOT, FIELD_NOTES_WINDOW.startMinute, FIELD_NOTES_WINDOW.endMinute]);
  assert.deepEqual([...(w.days ?? [])], [...FIELD_NOTES_AUTO_DAYS]);
  assert.deepEqual(DEFAULT_TIMES.field_notes, [FIELD_NOTES_WINDOW.startMinute]);
  assert.deepEqual(USUAL.field_notes.map((u) => [u.start, u.end]), [[FIELD_NOTES_WINDOW.startMinute, FIELD_NOTES_WINDOW.endMinute]]);
  assert.deepEqual(WINDOWS.field_notes, { first: [14, 30], lastEnd: [15, 30] });
  // The schema allows one post a day in the afternoon slot only; the daily cap is 1 everywhere.
  assert.equal(DEFAULT_CAPS.field_notes, 1);
  assert.equal(maxCapFor('field_notes'), 1);
  // The label is Field Notes everywhere, the page is /field-notes, a feed carousel on the spine, seedable by source link.
  const info = verticalInfo('field_notes');
  assert.deepEqual([info.label, info.short, info.format, info.href], ['Field Notes', 'Field Notes', 'feed', '/field-notes']);
  assert.equal(typeHref('field_notes'), '/field-notes');
  assert.equal(isSeedable('field_notes'), true);
  assert.doesNotMatch(read('lib/social-hub/verticals.ts'), /trial reels?/i);
});

test('Field Notes ships with Hard publish gated on its own publishing_live', async () => {
  const { actionsFor } = await import('@/lib/social-hub/house');
  const post = {
    vertical: 'field_notes', format: 'feed', status: 'ready', statusNote: null, approval: { required: true, approvedAt: null, note: null },
    media: { kind: 'slides', slides: [{ src: null, alt: 'a', photo: null, layout: null, headline: null, body: null }] },
    refs: { fieldNotesPostId: '11111111-1111-4111-8111-111111111111' }, id: 'field_notes:x',
  } as never;
  const off = actionsFor(post, { quota: null, typicalCostLabel: null });
  assert.ok(off.some((p) => p.kind === 'post' && p.action === 'approveContent'), 'approve is offered');
  assert.ok(!off.some((p) => p.kind === 'post' && p.action === 'hardPublish'), 'no Hard publish while publishing is off');
  const on = actionsFor(post, { quota: null, typicalCostLabel: null, fieldNotesPublishingLive: true });
  assert.ok(on.some((p) => p.kind === 'post' && p.action === 'hardPublish'));
});

test('the local runner never leaves its own run row running: signals, crashes and the timeout fail it; --dry checks the re-pay columns', () => {
  const text = read('scripts/field_notes_local_run.ts');
  for (const signal of ['SIGINT', 'SIGTERM']) assert.match(text, new RegExp(`\\['${signal}', \\d+\\]`), `${signal} is handled`);
  assert.match(text, /process\.on\('uncaughtException'/);
  assert.match(text, /process\.on\('unhandledRejection'/);
  // One path fails the row and counts an attempt for each tip the Writer was already paid for.
  assert.match(text, /async function abandonRun\(why: string\)/);
  assert.match(text, /await failRun\(run\.query, run\.runId, why\)/);
  assert.match(text, /for \(const id of run\.writtenTipIds\) await recordTipAttempt\(run\.query, id, why\)/);
  assert.match(text, /onWriteStarted: \(tipIds: string\[\]\) => void \(run\.writtenTipIds = tipIds\)/);
  // A hang and a thrown error both go through it.
  assert.match(text, /await abandonRun\(`local run \$\{reason\}`\)/);
  assert.match(text, /await abandonRun\(`local run error: \$\{message\}`\)/);
  // The checks (dry or not) need attempts and reject_reason on field_notes.tips, before any insert.
  assert.match(text, /column_name IN \('attempts', 'reject_reason'\)/);
  assert.ok(text.indexOf("column_name IN ('attempts', 'reject_reason')") < text.indexOf('if (dry)'), 'checked before the dry run returns');
});

test('the social worker runs the Field Notes face check each poll: one batch, the photo bank, errors logged once, one line per batch', () => {
  const text = read('scripts/social_worker.ts');
  assert.match(text, /const \{ openLiveFaceDetector, runFacesStep \} = await import\('@\/lib\/field-notes\/photos\/faces-worker'\)/);
  assert.match(text, /const photoBank = mediaBucket\(PHOTO_BANK_BUCKET\)/);
  assert.match(text, /runFacesStep\(\{ db: query as never, download: \(p: string\) => photoBank\.download\(p\), openDetector: openLiveFaceDetector \}\)/);
  assert.match(text, /if \(text !== lastFieldNotesFacesError\) log\('field_notes_faces_failed', \{ error: text \}\)/);
  assert.match(text, /if \(fnFaces && fnFaces\.claimed > 0\) \{\s*lastFieldNotesFacesError = null;\s*log\('field_notes_faces_batch', \{ \.\.\.fnFaces \}\)/);
  // Inside the poll loop, before the sleep.
  const step = text.indexOf('runFacesStep({');
  assert.ok(step > text.indexOf('while (!stopping)') && step < text.indexOf('await sleep(POLL_MS'), 'the step runs in the loop');
});

test('npm run field-notes:faces runs the same step once from this machine', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts['field-notes:faces'], 'tsx scripts/field_notes_faces_once.ts');
  const once = read('scripts/field_notes_faces_once.ts');
  assert.match(once, /runFacesStep\(\{ db, download: \(p\) => bucket\.download\(p\), openDetector: openLiveFaceDetector \}\)/);
  assert.match(once, /mediaBucket\(PHOTO_BANK_BUCKET\)/);
  assert.doesNotMatch(once, /anthropic|messages\.create/i, 'no model call');
});
