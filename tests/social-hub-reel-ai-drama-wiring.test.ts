/**
 * AI Drama Reels in the hub's type lists (planning/AI Mini Docs/HUB-WIRING-CONTRACT.md §6): the vertical,
 * hub ids, every per-type record, idea ids, and the literal windows the client-safe code keeps, pinned to
 * lib/reel-ai-drama's DRAMA_WINDOWS. Pure; no database.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { DRAMA_REVIEW_TAGS, DRAMA_WINDOWS } from '@/lib/reel-ai-drama/hub';
import { DRAMA_REVIEW_TAG_KEYS } from '@/app/api/social-hub/actions/content-action';
import { parseRankMove } from '@/lib/content-type/idea-rank';
import { parseQueueAction } from '@/lib/content-type/idea-queue';
import { maxCapFor } from '@/lib/content-type/caps';
import { NO_MISSES } from '@/lib/content-type/run-misses';
import { hubId, parseHubId } from '@/lib/social-hub/ids';
import { placementRules } from '@/lib/social-hub/placement';
import { legacyKey } from '@/lib/social-hub/slots/legacy';
import { DEFAULT_CAPS, DEFAULT_FEED_MODE, DEFAULT_TIMES, RUN_HOUR_LABEL, TYPE_NAME, USUAL, isFeedSlot } from '@/lib/social-hub/slots/times';
import { REEL_TYPES } from '@/lib/social-hub/slots/types';
import { DAY_TYPES } from '@/lib/social-hub/views/day-rank';
import { PLAN } from '@/lib/social-hub/views/plan';
import { TYPE_PAGE_IDS, VERTICALS, VERTICAL_IDS, typeHref, verticalInfo } from '@/lib/social-hub/verticals';

test('the vertical is listed with its contract label, colour and pages', () => {
  const info = verticalInfo('reel_ai_drama');
  assert.equal(info.label, 'AI Drama Reels');
  assert.equal(info.short, 'AI Drama');
  assert.equal(info.format, 'reel');
  assert.equal(info.colorVar, '--sh-v-reel_ai_drama');
  assert.equal(info.href, '/reel-ai-drama');
  assert.equal(info.reviewHref, '/reel-ai-drama');
  assert.ok(VERTICAL_IDS.includes('reel_ai_drama'));
  assert.ok(TYPE_PAGE_IDS.includes('reel_ai_drama'));
  assert.ok(DAY_TYPES.includes('reel_ai_drama'));
  assert.ok((REEL_TYPES as readonly string[]).includes('reel_ai_drama'));
  assert.equal(new Set(VERTICALS.map((v) => v.id)).size, VERTICALS.length);
  assert.match(typeHref('reel_ai_drama'), /reel-ai-drama/);
});

test('hub ids round-trip for every drama kind', () => {
  const ref = '6f1c0c3e-1111-4222-8333-444455556666';
  // An attempt id shares the content id's shape (D46), as for Explainers.
  for (const [kind, parsed] of [['content', 'content'], ['attempt', 'content'], ['schedule', 'schedule'], ['job', 'job']] as const) {
    assert.deepEqual(parseHubId(hubId('reel_ai_drama', kind, ref)), { vertical: 'reel_ai_drama', kind: parsed, ref });
  }
  assert.equal(hubId('reel_ai_drama', 'content', ref), `reel_ai_drama:${ref}`);
  assert.throws(() => hubId('reel_ai_drama', 'idea', ref), /no idea ids/);
});

test('every per-type record has the drama key, with the contract values', () => {
  assert.deepEqual(USUAL.reel_ai_drama, [{ start: 1170, end: 1245, name: 'Evening' }]);
  assert.deepEqual(DEFAULT_TIMES.reel_ai_drama, [1200]);
  assert.equal(DEFAULT_CAPS.reel_ai_drama, 1);
  assert.equal(maxCapFor('reel_ai_drama'), 3);
  assert.equal(RUN_HOUR_LABEL.reel_ai_drama, '12 AM');
  assert.equal(DEFAULT_FEED_MODE.reel_ai_drama, 'main');
  assert.ok(TYPE_NAME.reel_ai_drama.one);
  assert.deepEqual(NO_MISSES.reel_ai_drama, []);
  assert.equal(isFeedSlot({ vertical: 'reel_ai_drama', feedMode: 'main' }), true);
});

test('the literal windows match DRAMA_WINDOWS', async () => {
  const [w] = DRAMA_WINDOWS;
  assert.equal(DRAMA_WINDOWS.length, 1);
  assert.deepEqual(PLAN.reel_ai_drama.map((p) => [p.id, p.startMinute, p.endMinute]), DRAMA_WINDOWS.map((d) => [d.id, d.startMinute, d.endMinute]));
  assert.deepEqual(legacyKey('reel_ai_drama', w!.id), { startMinute: w!.startMinute, series: null });
  const rules = await placementRules(async () => ({ rows: [] }), 'reel_ai_drama');
  assert.equal(rules.spaced, true);
  assert.deepEqual(rules.windows.map((x) => [x.id, x.startMinute, x.endMinute]), DRAMA_WINDOWS.map((d) => [d.id, d.startMinute, d.endMinute]));
});

test('idea ids for drama pitches pass the rank and queue parsers; a mismatched type does not', () => {
  const ideaId = 'reel_ai_drama:pitch:6f1c0c3e-1111-4222-8333-444455556666';
  assert.deepEqual(parseRankMove({ vertical: 'reel_ai_drama', ideaId, kind: 'promote' }), { vertical: 'reel_ai_drama', ideaId, kind: 'promote' });
  assert.throws(() => parseRankMove({ vertical: 'explainers', ideaId, kind: 'promote' }), /Unknown idea/);
  assert.equal(parseQueueAction({ action: 'pin', vertical: 'reel_ai_drama', ideaId }).vertical, 'reel_ai_drama');
});

test('the review tags the action route accepts are drama’s own', () => {
  assert.deepEqual([...DRAMA_REVIEW_TAG_KEYS], [...DRAMA_REVIEW_TAGS]);
});
