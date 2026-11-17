/**
 * db/stories_split.sql (SS-21): re-applies cleanly, moves a pre-split trivia slot onto
 * its own type, seeds both daily caps, and refuses a trivia series under 'stories'.
 * PGlite only (tests/fixtures/social-hub/pglite.ts); no network, no DATABASE_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openHubTestDb } from './fixtures/social-hub/pglite';

const SPLIT = readFileSync(path.join(process.cwd(), 'db', 'stories_split.sql'), 'utf8')
  .split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

test('stories_split.sql re-applies and moves a pre-split trivia slot to ai_trivia', async () => {
  const { pg } = await openHubTestDb();
  // The state before the split: a trivia slot filed under 'stories'.
  await pg.exec(`ALTER TABLE social_hub.slot_template DROP CONSTRAINT slot_template_series_check`);
  await pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, start_minute, series) VALUES (0, 'stories', 510, 'ai_trivia'), (2, 'stories', 510, 'real_or_ai'), (0, 'stories', 510, 'morning_download')`);
  await pg.exec(SPLIT);
  await pg.exec(SPLIT);
  const { rows } = await pg.query<{ vertical: string; series: string }>(`SELECT vertical, series FROM social_hub.slot_template ORDER BY weekday, series`);
  assert.deepEqual(rows.map((r) => `${r.vertical}/${r.series}`), ['ai_trivia/ai_trivia', 'stories/morning_download', 'real_or_ai/real_or_ai']);
  const caps = await pg.query<{ value: Record<string, number> }>(`SELECT value FROM social_hub.settings WHERE key = 'daily_caps'`);
  // AI Trivia and Real or AI? start at once a day (SS-24); Morning Download keeps its stored two a day (R25).
  assert.equal(caps.rows[0].value.ai_trivia, 1);
  assert.equal(caps.rows[0].value.real_or_ai, 1);
  assert.equal(caps.rows[0].value.stories, 2);
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, start_minute, series) VALUES (1, 'stories', 510, 'ai_trivia')`));
  await assert.rejects(pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, start_minute, series) VALUES (1, 'ai_trivia', 510, 'real_or_ai')`));
  await pg.close();
});
