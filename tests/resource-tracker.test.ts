import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { gameStats, playerName, type GameQuery } from '@/lib/resource-tracker/game-stats';
import { parseRange } from '@/lib/resource-tracker/types';
import { isBotAgent, referrerHost, withTrackedRsvp } from '@/lib/networking/rsvp-tracking';
import type { PublicEventsFeed } from '@/lib/networking/public-snapshot';

// Offline: PGlite loaded with the website's own game schema (copied from FIGMAHELIOSWEBSITE/supabase), no network.
// Page views are skipped (views: false), so Vercel is never called.

const FIX = path.join(process.cwd(), 'tests/fixtures/site-game');
const NOW = new Date('2026-11-19T17:00:00Z');

async function siteDb(): Promise<{ q: GameQuery; pg: PGlite }> {
  const pg = new PGlite();
  for (const f of ['game_schema.sql', 'game_v2_migration.sql', 'game_accounts_migration.sql']) await pg.exec(readFileSync(path.join(FIX, f), 'utf8'));
  const q: GameQuery = async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as never[] });
  return { q, pg };
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const Cc = '33333333-3333-4333-8333-333333333333';

async function seed(q: GameQuery) {
  for (const [n, date] of [[1, '2026-11-17'], [2, '2026-11-18'], [3, '2026-11-19']] as const) {
    await q(`INSERT INTO game.days (day_number, ny_date, ai_label) VALUES ($1, $2, 'GPT-5 nano')`, [n, date]);
    for (let pos = 1; pos <= 5; pos++) {
      // The AI is right on `n + 1` questions (2, 3, 4).
      const picked = pos <= n + 1 ? 'B' : 'A';
      await q(
        `INSERT INTO game.questions (id, day_number, position, question, options, correct, answer_line, ai_model, ai_label, ai_picked)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'B', 'Because.', 'gpt-5-nano', 'GPT-5 nano', $6)`,
        [`d${n}-q${pos}`, n, pos, `Question ${n}.${pos}?`, JSON.stringify([{ letter: 'A', text: 'a' }, { letter: 'B', text: 'b' }, { letter: 'C', text: 'c' }]), picked],
      );
    }
  }
  const play = async (player: string, day: number, score: number | null, points: number | null, aiPoints: number | null, aiScore: number) => {
    const { rows } = await q<{ id: string }>(
      `INSERT INTO game.plays (player_id, day_number, mode, finished_at, score, ai_score, points, ai_points)
       VALUES ($1, $2, 'daily', $3, $4, $5, $6, $7) RETURNING id`,
      [player, day, score === null ? null : '2026-11-19T12:00:00Z', score, aiScore, points, aiPoints],
    );
    return rows[0]!.id;
  };
  await play(A, 1, 4, 3800, 1900, 2);
  await play(A, 2, 2, 1900, 2800, 3);
  const a3 = await play(A, 3, 5, 4600, 3700, 4);
  await play(B, 2, 3, 2900, 2800, 3);
  await play(B, 3, 3, 2500, 3700, 4);
  await play(Cc, 3, null, null, null, 4); // started, never finished
  await play(Cc, 1, 1, null, null, 2); // an older play without points: compared on correct answers
  await q(`INSERT INTO game.plays (player_id, day_number, mode, finished_at, score, ai_score) VALUES ($1, 3, 'archive', now(), 5, 4)`, ['44444444-4444-4444-8444-444444444444']);
  // Answers for day 3 question 1: A right in 2.5 s; B timed out.
  await q(`INSERT INTO game.answers (play_id, position, served_at, answered_at, choice, is_correct) VALUES ($1, 1, '2026-11-19T12:00:00Z', '2026-11-19T12:00:02.5Z', 'B', true)`, [a3]);
  const { rows } = await q<{ id: string }>(`SELECT id FROM game.plays WHERE player_id = $1 AND day_number = 3`, [B]);
  await q(`INSERT INTO game.answers (play_id, position, served_at, answered_at, choice, is_correct) VALUES ($1, 1, '2026-11-19T12:00:00Z', '2026-11-19T12:00:16Z', NULL, false)`, [rows[0]!.id]);
  await q(`INSERT INTO game.accounts (email, player_id, created_ms, last_login_ms) VALUES ('fan@example.com', $1, 0, 0)`, [A]);
}

test('gameStats: players per day, new vs returning, the AI score, top players and per-question results', async () => {
  const { q } = await siteDb();
  await seed(q);
  const s = await gameStats(q, '30d', NOW, { views: false });
  assert.equal(s.configured, true);
  assert.deepEqual(s.days.map((d) => [d.dayNumber, d.players, d.newPlayers, d.returningPlayers, d.started, d.aiScore]), [
    [1, 2, 2, 0, 2, 2],
    [2, 2, 1, 1, 2, 3],
    [3, 2, 0, 2, 3, 4],
  ], 'archive replays are left out; an unfinished play counts as started only');
  assert.deepEqual(s.days.map((d) => d.beatAi), [1, 1, 1], 'points when both have them, else correct answers (C: 1 vs the AI 2)');
  assert.equal(s.totals.players, 3);
  assert.equal(s.totals.plays, 6);
  assert.equal(Math.round(s.totals.finishRate! * 100), 86);

  assert.equal(s.topPlayers[0]!.name, 'fan@example.com');
  assert.equal(s.topPlayers[0]!.games, 3);
  assert.deepEqual(s.topPlayers[0]!.byDay[3], { score: 5, beatAi: true });
  assert.equal(s.topPlayers[1]!.name, `Player ${B.replace(/-/g, '').slice(0, 4)}`);

  const q1 = s.questions[3]![0]!;
  assert.equal(s.questions[3]!.length, 5);
  assert.equal(q1.aiRight, true);
  assert.equal(q1.answers, 2);
  assert.equal(q1.right, 1);
  assert.equal(q1.timeouts, 1);
  assert.equal(q1.medianSeconds, 2.5);
});

test('gameStats: not configured without a connection; range parsing defaults to 30 days', async () => {
  const s = await gameStats(null, '14d', NOW);
  assert.equal(s.configured, false);
  assert.deepEqual(s.days, []);
  assert.equal(parseRange('90d'), '90d');
  assert.equal(parseRange('bogus'), '30d');
  assert.equal(playerName('abcd1234-0000', null), 'Player abcd');
});

test('RSVP tracking: links swap to the hub, bots are flagged, referrers keep only the host', () => {
  const feed = { schemaVersion: 1, generatedAt: NOW.toISOString(), metros: [], week: null, events: [{ id: '0123456789abcdef', title: 'AI night', metro: 'nyc', start: NOW.toISOString(), rsvpUrl: 'https://lu.ma/x' }] } as unknown as PublicEventsFeed;
  const out = withTrackedRsvp(feed, 'https://hub.test');
  assert.equal(out.feed.events[0]!.rsvpUrl, 'https://hub.test/api/public/go/rsvp/0123456789abcdef');
  assert.deepEqual(out.links, [{ publicId: '0123456789abcdef', url: 'https://lu.ma/x', title: 'AI night', metro: 'nyc', start: NOW.toISOString() }]);
  assert.equal(feed.events[0]!.rsvpUrl, 'https://lu.ma/x', 'the input feed is not mutated');
  assert.equal(isBotAgent('Mozilla/5.0 (Macintosh) Safari/605'), false);
  assert.equal(isBotAgent('facebookexternalhit/1.1'), true);
  assert.equal(isBotAgent(null), true);
  assert.equal(referrerHost('https://heliosgroup.ai/free-tools/ai-networking-events?x=1'), 'heliosgroup.ai');
  assert.equal(referrerHost('not a url'), null);
});
