/**
 * The Stories split in the hub's type lists (planning/Stories Split/CONTRACT.md, SS-1): Morning Download keeps
 * `stories`; AI Trivia (`ai_trivia`) and Real or AI? (`real_or_ai`) are types of their own. Every per-type record
 * and calendar list covers the two new types, ids keep the `stories:` namespace (D46), and story-format logic goes
 * through isStoryVertical (a literal `'stories'` check is left only where it means Morning Download). Pure; no database.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { maxCapFor } from '@/lib/content-type/caps';
import { TYPE_CONFIG } from '@/lib/content-type/config';
import { parseQueueAction } from '@/lib/content-type/idea-queue';
import { NO_MISSES } from '@/lib/content-type/run-misses';
import { ideaOfType, seriesLabel } from '@/lib/content-type/story-series';
import { isSeedable } from '@/lib/content-type/seed-verticals';
import { CAPS } from '@/lib/revisions/caps';
import { REVISION_REF_KEY } from '@/lib/revisions/box-state';
import { VERTICAL_LABELS } from '@/lib/revisions/labels';
import { descriptionFor } from '@/lib/revisions/registry';
import { hubId } from '@/lib/social-hub/ids';
import { LEAD_DAYS, leadDaysFor } from '@/lib/social-hub/lead';
import { placementRules } from '@/lib/social-hub/placement';
import { legacyKey } from '@/lib/social-hub/slots/legacy';
import { SCHEDULE_ENTRIES } from '@/lib/social-hub/slots/schedule';
import { DEFAULT_CAPS, DEFAULT_FEED_MODE, DEFAULT_TIMES, RUN_HOUR_LABEL, TYPE_NAME, USUAL, isFeedSlot } from '@/lib/social-hub/slots/times';
import { SERIES_OF_VERTICAL, STORY_VERTICALS, isStoryVertical } from '@/lib/social-hub/story-types';
import { TYPE_PAGE_IDS, VERTICAL_IDS, verticalInfo } from '@/lib/social-hub/verticals';
import { DAY_TYPES } from '@/lib/social-hub/views/day-rank';
import { PLAN } from '@/lib/social-hub/views/plan';
import { REFILL_CADENCE } from '@/lib/social-hub/views/pools';

const NEW = ['ai_trivia', 'real_or_ai'] as const;

test('each Stories-format type is listed with its own page, colour and story format', () => {
  const want = { stories: ['Morning Download', '/morning-download'], ai_trivia: ['Are you smarter than AI?', '/ai-trivia'], real_or_ai: ['Real or AI?', '/real-or-ai'] } as const;
  for (const v of STORY_VERTICALS) {
    const info = verticalInfo(v);
    assert.equal(info.label, want[v][0]);
    assert.equal(info.href, want[v][1]);
    assert.equal(info.format, 'story');
    assert.equal(info.colorVar, `--sh-v-${v}`);
    assert.ok(VERTICAL_IDS.includes(v) && TYPE_PAGE_IDS.includes(v) && DAY_TYPES.includes(v), v);
    assert.equal(isStoryVertical(v), true);
  }
  assert.equal(isStoryVertical('carousels'), false);
  const css = readFileSync(path.join(process.cwd(), 'app', 'social-hub.css'), 'utf8');
  for (const v of NEW) assert.match(css, new RegExp(`--sh-v-${v}:`));
});

test('every per-type record and calendar list has both new keys', () => {
  for (const v of NEW) {
    assert.equal(SERIES_OF_VERTICAL[v], v);
    assert.ok(USUAL[v].length && DEFAULT_TIMES[v].length, v);
    assert.equal(DEFAULT_CAPS[v], 1);
    assert.equal(maxCapFor(v), 1);
    assert.equal(RUN_HOUR_LABEL[v], '4 AM');
    assert.equal(DEFAULT_FEED_MODE[v], null);
    assert.ok(TYPE_NAME[v].one && TYPE_NAME[v].many, v);
    assert.deepEqual(NO_MISSES[v], []);
    assert.ok(REFILL_CADENCE[v], v);
    assert.equal(REVISION_REF_KEY[v], 'setId');
    assert.ok(VERTICAL_LABELS[v], v);
    assert.deepEqual(CAPS[v], CAPS.stories, `${v} keeps the Stories revision caps`);
    assert.equal(descriptionFor(v)?.vertical, v);
    assert.equal(isSeedable(v), false, `${v} has no seed path`);
    assert.equal(isFeedSlot({ vertical: v, feedMode: null }), false);
    assert.deepEqual(SCHEDULE_ENTRIES.filter((e) => e.vertical === v).map((e) => e.series), [v]);
    assert.deepEqual(PLAN[v].map((w) => w.id), [v]);
    assert.deepEqual(legacyKey(v, v), { startMinute: DEFAULT_TIMES[v][0]!, series: v });
  }
  assert.equal(isSeedable('stories'), true);
  assert.deepEqual(PLAN.stories.map((w) => w.id), ['morning_download']);
});

test('days and lead: Trivia Sun/Mon/Thu and Real or AI? Tue/Sat, both two days ahead; Morning Download daily, same day', () => {
  assert.deepEqual(PLAN.ai_trivia[0]!.days, [0, 1, 4]);
  assert.deepEqual(PLAN.real_or_ai[0]!.days, [2, 6]);
  assert.equal(PLAN.stories[0]!.days?.length ?? 7, 7, "every day");
  assert.equal(LEAD_DAYS.ai_trivia, 2);
  assert.equal(LEAD_DAYS.real_or_ai, 2);
  assert.equal(LEAD_DAYS.stories, 0);
  // The engine still asks by series under 'stories' (shim): the series' own type answers.
  assert.equal(leadDaysFor('stories', 'ai_trivia'), 2);
  assert.equal(leadDaysFor('stories', 'morning_download'), 0);
});

test('ids keep the stories: namespace for every Stories-format type (D46); idea ids map to their type by series', () => {
  const ref = '6f1c0c3e-1111-4222-8333-444455556666';
  for (const v of STORY_VERTICALS) assert.equal(hubId(v, 'set', ref), `stories:${ref}`);
  assert.equal(ideaOfType('ai_trivia', 'stories:pool:ai_trivia:k1'), true);
  assert.equal(ideaOfType('stories', 'stories:pool:ai_trivia:k1'), false);
  assert.equal(ideaOfType('real_or_ai', 'stories:pool:real_or_ai:k1'), true);
  assert.equal(ideaOfType('stories', 'stories:pool:morning_download:k1'), true);
  assert.equal(seriesLabel('ai_trivia'), 'Are you smarter than AI?');
  const ideaId = 'stories:pool:ai_trivia:k1';
  assert.throws(() => parseQueueAction({ action: 'pin', vertical: 'real_or_ai', ideaId }), /Unknown idea/);
  assert.equal(parseQueueAction({ action: 'pin', vertical: 'ai_trivia', ideaId }).vertical, 'ai_trivia');
});

test('placement offers each Stories-format type only its own window', async () => {
  for (const v of STORY_VERTICALS) {
    const rules = await placementRules(async () => ({ rows: [] }), v);
    assert.deepEqual(rules.windows.map((w) => w.id), [SERIES_OF_VERTICAL[v]], v);
  }
});

/** Files where a literal 'stories' check means Morning Download in particular (or is the helper itself). */
const MEANS_MORNING_DOWNLOAD = new Set([
  'lib/social-hub/story-types.ts',
  'lib/social-hub/queries/costs.ts',
  'lib/content-type/story-series.ts',
  'lib/revisions/descriptions/stories.ts',
  'components/social-hub/calendar/CalendarScreen.tsx',
]);
/** Builder B's files (CONTRACT §3), checked by B's own tests. */
const OTHER_OWNER = /^(lib\/content-type\/posting\.ts|components\/content-type\/(TypeControls|ScheduleStrip)\.tsx|app\/api\/stories\/|app\/memes\/)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

test('story-format logic goes through isStoryVertical: no stray literal stories check in the hub', () => {
  const root = process.cwd();
  const roots = ['lib/social-hub', 'lib/content-type', 'lib/revisions', 'lib/publishing', 'lib/preflight', 'components/social-hub', 'components/content-type', 'app'];
  const stray: string[] = [];
  for (const r of roots) {
    for (const file of walk(path.join(root, r))) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (MEANS_MORNING_DOWNLOAD.has(rel) || OTHER_OWNER.test(rel)) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/[!=]==\s*'stories'|'stories'\s*[!=]==/.test(line)) stray.push(`${rel}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(stray, []);
});
