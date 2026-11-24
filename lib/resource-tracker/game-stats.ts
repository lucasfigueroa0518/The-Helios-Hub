import { Pool } from 'pg';

import type { GameDayRow, GameQuestionRow, GameStats, TopPlayer, TrackerRange } from '@/lib/resource-tracker/types';
import { addDays, GAME_PATH, nyDate, pageVisitorsByDay } from '@/lib/resource-tracker/views';

/**
 * "Are you smarter than AI?" stats from the website's Supabase (schema `game`), read through a SELECT-only role
 * (RT-1, db/site_game_reader_role.sql) at GAME_STATS_DATABASE_URL. Daily plays only: archive replays are not "today's
 * players". Synthetic players are computed on the site and never stored, so every row here is a real device.
 */
export type GameQuery = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;

const globalPool = globalThis as typeof globalThis & { __gameStatsPool?: Pool };

export function liveGameQuery(): GameQuery | null {
  const url = process.env.GAME_STATS_DATABASE_URL?.trim();
  if (!url) return null;
  globalPool.__gameStatsPool ??= new Pool({ connectionString: url, max: 3, ssl: { rejectUnauthorized: false }, application_name: 'helios-hub-resource-tracker', connectionTimeoutMillis: 5_000 });
  const pool = globalPool.__gameStatsPool;
  return async <T,>(text: string, params?: unknown[]) => ({ rows: (await pool.query(text, params)).rows as T[] });
}

const RANGE_DAYS: Record<Exclude<TrackerRange, 'all'>, number> = { '14d': 14, '30d': 30, '90d': 90 };
const num = (v: unknown): number | null => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
/** A player beat the AI: on speed points when both have them, else on correct answers. */
const BEAT_AI = `coalesce(p.points > p.ai_points, p.score > p.ai_score, false)`;
const TOP_PLAYERS = 10;

/** "Player 3f9a" for a device that never saved progress; the saved email otherwise (the hub is internal). */
export function playerName(playerId: string, email: string | null): string {
  return email ?? `Player ${playerId.replace(/-/g, '').slice(0, 4)}`;
}

export async function gameStats(q: GameQuery | null, range: TrackerRange, now: Date, opts: { views?: boolean } = {}): Promise<GameStats> {
  const empty: GameStats = { range, configured: Boolean(q), error: null, days: [], topPlayers: [], questions: {}, totals: { players: 0, plays: 0, finishRate: null, returningShare: null, beatAiShare: null }, viewsNote: null };
  if (!q) return empty;
  const to = nyDate(now);
  const from = range === 'all' ? '2000-01-01' : addDays(to, -(RANGE_DAYS[range] - 1));

  const daysRes = await q<Record<string, unknown>>(
    `WITH d AS (SELECT day_number, ny_date FROM game.days WHERE ny_date BETWEEN $1::date AND $2::date),
          first_day AS (SELECT player_id, min(day_number) AS first FROM game.plays WHERE mode = 'daily' AND finished_at IS NOT NULL GROUP BY player_id),
          ai AS (SELECT day_number, count(*) FILTER (WHERE ai_picked = correct)::int AS ai_right FROM game.questions GROUP BY day_number)
     SELECT d.day_number, to_char(d.ny_date, 'YYYY-MM-DD') AS date, ai.ai_right,
            count(p.id)::int AS started,
            count(p.id) FILTER (WHERE p.finished_at IS NOT NULL)::int AS players,
            count(p.id) FILTER (WHERE p.finished_at IS NOT NULL AND f.first = p.day_number)::int AS new_players,
            avg(p.score) FILTER (WHERE p.finished_at IS NOT NULL) AS avg_score,
            avg(p.points) FILTER (WHERE p.finished_at IS NOT NULL) AS avg_points,
            avg(p.ai_points) FILTER (WHERE p.finished_at IS NOT NULL) AS ai_points,
            count(p.id) FILTER (WHERE p.finished_at IS NOT NULL AND ${BEAT_AI})::int AS beat_ai
       FROM d
       LEFT JOIN game.plays p ON p.day_number = d.day_number AND p.mode = 'daily'
       LEFT JOIN first_day f ON f.player_id = p.player_id
       LEFT JOIN ai ON ai.day_number = d.day_number
      GROUP BY d.day_number, d.ny_date, ai.ai_right
      ORDER BY d.day_number`,
    [from, to],
  );
  const dayNumbers = daysRes.rows.map((r) => Number(r.day_number));
  const firstDate = (daysRes.rows[0]?.date as string | undefined) ?? to;

  const [topRes, qRes] = await Promise.all([
    q<Record<string, unknown>>(
      `SELECT p.player_id::text AS player_id, a.email, count(*)::int AS games, avg(p.score)::float AS avg_score,
              count(*) FILTER (WHERE ${BEAT_AI})::int AS wins, max(p.day_number)::int AS last_day
         FROM game.plays p LEFT JOIN game.accounts a ON a.player_id = p.player_id
        WHERE p.mode = 'daily' AND p.finished_at IS NOT NULL
        GROUP BY 1, 2 ORDER BY games DESC, avg_score DESC, last_day DESC LIMIT ${TOP_PLAYERS}`,
    ),
    q<Record<string, unknown>>(
      `SELECT q.day_number, q.position, q.question, q.options, q.correct, q.ai_picked,
              count(an.play_id)::int AS answers,
              count(an.play_id) FILTER (WHERE an.is_correct)::int AS right_count,
              count(an.play_id) FILTER (WHERE an.choice IS NULL AND an.answered_at IS NOT NULL)::int AS timeouts,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM an.answered_at - an.served_at))
                FILTER (WHERE an.answered_at IS NOT NULL AND an.choice IS NOT NULL) AS median_seconds
         FROM game.questions q
         LEFT JOIN game.plays p ON p.day_number = q.day_number AND p.mode = 'daily'
         LEFT JOIN game.answers an ON an.play_id = p.id AND an.position = q.position
        WHERE q.day_number = ANY($1::int[])
        GROUP BY q.day_number, q.position, q.question, q.options, q.correct, q.ai_picked
        ORDER BY q.day_number, q.position`,
      [dayNumbers],
    ),
  ]);

  const topIds = topRes.rows.map((r) => String(r.player_id));
  const perDay = topIds.length
    ? await q<{ player_id: string; day_number: number; score: number; beat: boolean }>(
        `SELECT p.player_id::text AS player_id, p.day_number, p.score, ${BEAT_AI} AS beat
           FROM game.plays p
          WHERE p.mode = 'daily' AND p.finished_at IS NOT NULL AND p.player_id = ANY($1::uuid[]) AND p.day_number = ANY($2::int[])`,
        [topIds, dayNumbers],
      )
    : { rows: [] };

  const views = opts.views === false ? { byDay: null, note: null } : await pageVisitorsByDay(GAME_PATH, { from: firstDate, to });

  const days: GameDayRow[] = daysRes.rows.map((r) => {
    const players = Number(r.players);
    const newPlayers = Number(r.new_players);
    return {
      dayNumber: Number(r.day_number),
      date: String(r.date),
      visitors: views.byDay ? views.byDay[String(r.date)] ?? 0 : null,
      started: Number(r.started),
      players,
      newPlayers,
      returningPlayers: players - newPlayers,
      avgScore: num(r.avg_score),
      avgPoints: num(r.avg_points),
      aiScore: num(r.ai_right),
      aiPoints: num(r.ai_points),
      beatAi: Number(r.beat_ai),
    };
  });

  const topPlayers: TopPlayer[] = topRes.rows.map((r) => {
    const id = String(r.player_id);
    const byDay: TopPlayer['byDay'] = {};
    for (const row of perDay.rows) if (row.player_id === id) byDay[Number(row.day_number)] = { score: Number(row.score), beatAi: Boolean(row.beat) };
    const email = (r.email as string | null) ?? null;
    return { key: id.slice(0, 8), name: playerName(id, email), saved: Boolean(email), games: Number(r.games), avgScore: Number(r.avg_score), wins: Number(r.wins), lastDay: Number(r.last_day), byDay };
  });

  const questions: Record<number, GameQuestionRow[]> = {};
  for (const r of qRes.rows) {
    const day = Number(r.day_number);
    (questions[day] ??= []).push({
      position: Number(r.position),
      question: String(r.question),
      options: (r.options as GameQuestionRow['options']) ?? [],
      correct: String(r.correct),
      aiPicked: String(r.ai_picked),
      aiRight: r.ai_picked === r.correct,
      answers: Number(r.answers),
      right: Number(r.right_count),
      timeouts: Number(r.timeouts),
      medianSeconds: num(r.median_seconds),
    });
  }

  const sum = (f: (d: GameDayRow) => number) => days.reduce((n, d) => n + f(d), 0);
  const plays = sum((d) => d.players);
  const started = sum((d) => d.started);
  const uniqueRes = await q<{ n: number }>(
    `SELECT count(DISTINCT player_id)::int AS n FROM game.plays WHERE mode = 'daily' AND finished_at IS NOT NULL AND day_number = ANY($1::int[])`,
    [dayNumbers],
  );
  return {
    range,
    configured: true,
    error: null,
    days,
    topPlayers,
    questions,
    totals: {
      players: Number(uniqueRes.rows[0]?.n ?? 0),
      plays,
      finishRate: started ? plays / started : null,
      returningShare: plays ? sum((d) => d.returningPlayers) / plays : null,
      beatAiShare: plays ? sum((d) => d.beatAi) / plays : null,
    },
    viewsNote: views.note,
  };
}
