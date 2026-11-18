/**
 * "Are you Smarter Than AI?" web game days (AT-76 to AT-79; planning/AI Trivia/Game/HUB-PLAN.md): the builder, the
 * 11 pm lock, Pull, the launch date and the export the website imports. The pure choices live in game.ts.
 *
 *   build    tomorrow's day (and today's while it is the launch day or still short): the open AI Trivia pool in
 *            score order; the opponent's stored answer (asked once where missing); trivia-check@4 on the kind the day
 *            still needs (a fail archives the question); at most MAX_GAME_CHECKS fact-checks a day. Chosen questions
 *            are reserved (pool used_at) so the IG story never takes them; a question swapped out is released.
 *            A question any locked day already holds is never chosen again (the game serves each question once).
 *   serve    once a locked day's date has passed, its questions are released to the pool (once, logged 'served'),
 *            so later IG stories can use what the game already served and the pool keeps growing.
 *   lock     a full day locks at 11 pm New York the night before (a day already under way locks as soon as it is full).
 *            A past day still short is released and logged as missed; it is never exported.
 *   pull     a person removes a draft question: it is archived and the builder fills the gap on its next pass.
 *   export   locked days only, in the website's contract (BUILD-PLAN.md §6.2).
 */
import { archiveTrivia, toFactCheck } from '@/lib/stories/build/ai-trivia';
import type { StoriesDb, Queryable } from '@/lib/stories/db';
import { openPool } from '@/lib/stories/pool';
import { material } from '@/lib/stories/prompts';
import { nyDate } from '@/lib/stories/repository';
import type { StoriesSettings } from '@/lib/stories/settings';
import type { WriterCreate } from '@/lib/stories/writer';
import { writeStructured } from '@/lib/stories/writer';

import { askedItem, askedOnTheme } from './asked';
import { chooseGameDay, GAME_SIZE, AI_RIGHT_TARGET, MAX_GAME_CHECKS, orderEasiestFirst, wantsMore } from './game';
import { aiRight, opponentFor } from './lean';
import { OPPONENT_TAG, type OpponentClient } from './opponent';
import { TRIVIA_CHECK, TRIVIA_CHECK_SEARCHES, type TriviaCheckMaterial, type TriviaCheckOut } from './prompts';
import { LETTERS, poolKeyOf, TRIVIA_SERIES, type FactCheck, type Letter, type TriviaPoolPayload } from './types';

/** stories.settings key holding `{ date: 'YYYY-MM-DD' }`: the New York date of Day 1. */
export const GAME_LAUNCH_KEY = 'trivia_game_launch';
/** The builder starts on tomorrow's day after the 3:00 writer (HUB-PLAN: from 3:30). */
export const GAME_BUILD_AFTER = '03:30';
/** The day locks at 11 pm New York the night before it goes live (AT-76). */
export const GAME_LOCK_AT = '23:00';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** One question of a game day, as stored in stories.trivia_game_days.questions (play order). */
export type GameQuestion = {
  key: string;
  payload: TriviaPoolPayload;
  factCheck: FactCheck;
};

export type GameDayRow = {
  day_number: number;
  ny_date: string;
  status: 'draft' | 'locked';
  questions: GameQuestion[];
  bench: GameQuestion[];
  log: GameLog[];
  built_at: string | null;
  locked_at: string | null;
};

/** What the builder did, one entry per event, kept on the day's row (the hub shows it). */
export type GameLog = { at: string; kind: 'check' | 'skip' | 'pull' | 'lock' | 'missed' | 'release' | 'note'; key?: string; detail: string };

export const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Day 1 is the launch date; each New York date after it is the next day. */
export const dayNumberOf = (launch: string, date: string): number => Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${launch}T12:00:00Z`)) / 86_400_000) + 1;
const nyClock = (at: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);

/* ── Launch date ─────────────────────────────────────────────────────── */

export async function readLaunch(db: Queryable): Promise<string | null> {
  const { rows } = await db.query<{ value: { date?: string } | null }>(`SELECT value FROM stories.settings WHERE key = $1`, [GAME_LAUNCH_KEY]);
  const d = rows[0]?.value?.date;
  return typeof d === 'string' && ISO.test(d) ? d : null;
}

/** Set Day 1's date. Refused once a day has locked (locked days keep their numbers and the site has imported them). */
export async function saveLaunch(db: Queryable, date: string | null, by?: string): Promise<string | null> {
  if (date !== null && !ISO.test(date)) throw new Error('launch date must be YYYY-MM-DD');
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.trivia_game_days WHERE status = 'locked'`);
  if ((rows[0]?.n ?? 0) > 0) throw new Error('a game day has already locked; the launch date can no longer change');
  // Drafts were numbered from the old date: release their questions and start again.
  const drafts = await db.query<{ questions: GameQuestion[] }>(`SELECT questions FROM stories.trivia_game_days WHERE status = 'draft'`);
  await release(db, drafts.rows.flatMap((r) => (r.questions ?? []).map((q) => q.key)));
  await db.query(`DELETE FROM stories.trivia_game_days WHERE status = 'draft'`);
  if (date === null) await db.query(`DELETE FROM stories.settings WHERE key = $1`, [GAME_LAUNCH_KEY]);
  else await db.query(
    `INSERT INTO stories.settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [GAME_LAUNCH_KEY, JSON.stringify({ date, by: by ?? null, at: new Date().toISOString() })],
  );
  return date;
}

/* ── Rows ────────────────────────────────────────────────────────────── */

const rowSql = `SELECT day_number, to_char(ny_date, 'YYYY-MM-DD') AS ny_date, status, questions, bench, log, built_at, locked_at FROM stories.trivia_game_days`;

export async function readDay(db: Queryable, date: string): Promise<GameDayRow | null> {
  const { rows } = await db.query<GameDayRow>(`${rowSql} WHERE ny_date = $1::date`, [date]);
  return rows[0] ?? null;
}

export async function readDays(db: Queryable, opts: { from?: string; status?: 'draft' | 'locked' } = {}): Promise<GameDayRow[]> {
  const { rows } = await db.query<GameDayRow>(
    `${rowSql} WHERE ($1::date IS NULL OR ny_date >= $1::date) AND ($2::text IS NULL OR status = $2) ORDER BY ny_date`,
    [opts.from ?? null, opts.status ?? null],
  );
  return rows;
}

async function saveDay(db: Queryable, d: Pick<GameDayRow, 'day_number' | 'ny_date' | 'questions' | 'bench' | 'log'>): Promise<void> {
  await db.query(
    `INSERT INTO stories.trivia_game_days (day_number, ny_date, status, questions, bench, log, built_at)
     VALUES ($1, $2::date, 'draft', $3::jsonb, $4::jsonb, $5::jsonb, now())
     ON CONFLICT (ny_date) DO UPDATE SET questions = EXCLUDED.questions, bench = EXCLUDED.bench, log = EXCLUDED.log, built_at = now()
      WHERE stories.trivia_game_days.status = 'draft'`,
    [d.day_number, d.ny_date, JSON.stringify(d.questions), JSON.stringify(d.bench), JSON.stringify(d.log.slice(-200))],
  );
}

/** Reserve: chosen game questions are used, so the IG story and the writer's repeat check treat them as posted. */
async function reserve(db: Queryable, keys: string[], at: Date): Promise<void> {
  if (keys.length) await db.query(`UPDATE stories.pool SET used_at = $3::timestamptz WHERE series = $1 AND key = ANY($2::text[]) AND used_at IS NULL`, [TRIVIA_SERIES, keys, at.toISOString()]);
}
async function release(db: Queryable, keys: string[]): Promise<void> {
  if (keys.length) await db.query(`UPDATE stories.pool SET used_at = NULL WHERE series = $1 AND key = ANY($2::text[])`, [TRIVIA_SERIES, keys]);
}

/** Keys every locked game day other than `except` holds: the game never serves a question twice. */
async function gameKeys(db: Queryable, except: string): Promise<string[]> {
  const { rows } = await db.query<{ key: string }>(
    `SELECT DISTINCT q->>'key' AS key FROM stories.trivia_game_days d, jsonb_array_elements(d.questions) q
      WHERE d.status = 'locked' AND d.ny_date <> $1::date`,
    [except],
  );
  return rows.map((r) => r.key).filter(Boolean);
}

/** The log entry that marks a past locked day's questions as handed back to the IG story pool. */
export const SERVED_DETAIL = 'served: questions released to the IG story pool';

/* ── Build ───────────────────────────────────────────────────────────── */

export type GameBuildDeps = {
  db: StoriesDb;
  write: WriterCreate;
  opponent?: OpponentClient;
  settings: StoriesSettings;
  now: Date;
  log?: (line: string) => void;
};

export type GameBuildResult = { date: string; dayNumber: number; questions: number; aiRight: number; checks: number; balanced: boolean } | { skipped: string };

const checksOf = (log: GameLog[]) => log.filter((l) => l.kind === 'check').length;
const kindOf = (p: TriviaPoolPayload) => (aiRight(p) ? 'right' : 'wrong');

/** Whether one more question of this kind could still improve the day (game.ts chooseGameDay's targets). */
function helps(chosen: TriviaPoolPayload[], kind: 'right' | 'wrong'): boolean {
  const right = chosen.filter((p) => aiRight(p) === true).length;
  if (chosen.length < GAME_SIZE) return true;
  return kind === 'right' ? right < AI_RIGHT_TARGET : GAME_SIZE - right < GAME_SIZE - AI_RIGHT_TARGET;
}

/** The day the builder works on now, or null: today while it is short (the launch day, or a day under way), then tomorrow after 3:30. */
export async function dayToBuild(db: Queryable, launch: string, now: Date): Promise<string | null> {
  const today = nyDate(now);
  const tomorrow = addDays(today, 1);
  for (const date of [today, tomorrow]) {
    if (date < launch) continue;
    if (date === tomorrow && nyClock(now) < GAME_BUILD_AFTER) continue;
    const row = await readDay(db, date);
    if (row?.status === 'locked') continue;
    if (row && row.questions.length >= GAME_SIZE && row.questions.filter((q) => aiRight(q.payload)).length === AI_RIGHT_TARGET) continue;
    if (row && checksOf(row.log) >= MAX_GAME_CHECKS) continue; // the day's fact-checks are spent
    if (date === today && date !== launch && !row) continue; // a day that was never started is not built on the day itself
    return date;
  }
  return null;
}

export async function buildGameDay(deps: GameBuildDeps, date: string, launch: string): Promise<GameBuildResult> {
  const { db, now } = deps;
  const say = deps.log ?? (() => {});
  const existing = await readDay(db, date);
  if (existing?.status === 'locked') return { skipped: `${date} is locked` };
  const dayNumber = existing?.day_number ?? dayNumberOf(launch, date);
  const log: GameLog[] = [...(existing?.log ?? [])];
  const stamp = () => now.toISOString();
  const factChecks = new Map<string, FactCheck>();
  for (const g of [...(existing?.questions ?? []), ...(existing?.bench ?? [])]) factChecks.set(g.key, g.factCheck);
  const before = (existing?.questions ?? []).map((g) => g.key);

  // Passed questions so far: the day's own, then its bench while those are still open in the pool.
  const open = (await openPool(db, TRIVIA_SERIES)).trivia ?? [];
  const openKeys = new Set(open.map((p) => poolKeyOf(p.q)));
  const passed: TriviaPoolPayload[] = [
    ...(existing?.questions ?? []).map((g) => g.payload),
    ...(existing?.bench ?? []).filter((g) => openKeys.has(g.key)).map((g) => g.payload),
  ];
  const served = await gameKeys(db, date);
  const seen = new Set([...served, ...passed.map((p) => poolKeyOf(p.q)), ...log.filter((l) => l.kind === 'skip' || l.kind === 'check').map((l) => l.key!).filter(Boolean)]);
  let checks = checksOf(log);

  for (const cand of open) {
    const choice = chooseGameDay(passed);
    if (!wantsMore(choice, checks)) break;
    const key = poolKeyOf(cand.q);
    if (seen.has(key)) continue;
    seen.add(key);
    // The opponent's answer first (stored once, a fraction of a cent): a fact-check is spent only on a kind the day needs.
    let p = cand;
    if (!p.opponent && deps.opponent) {
      try {
        p = await opponentFor({ db, setId: null, opponent: deps.opponent, log: say }, cand);
      } catch (err) {
        say(`trivia-game: opponent failed on ${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!p.opponent) {
      log.push({ at: stamp(), kind: 'skip', key, detail: 'the opponent gave no answer' });
      continue;
    }
    if (!helps(choice.chosen, kindOf(p))) {
      seen.delete(key); // not tried: may help on a later pass
      continue;
    }
    const asked = await askedOnTheme(db, p.q.cellId, { exceptKey: key, alongside: passed.map((x) => askedItem(x.q)) });
    const mat: TriviaCheckMaterial = { question: p.q.question, options: p.q.options, correct: p.q.correct, answer_line: p.q.answerLine, sources: p.q.sources, asked };
    checks++;
    let fc: FactCheck;
    try {
      const out = (await writeStructured<TriviaCheckOut>({
        create: deps.write, db, setId: null, component: 'trivia-game-check', model: deps.settings.models.copy,
        system: TRIVIA_CHECK.system, tool: TRIVIA_CHECK.tool, user: material(mat), webSearch: { maxUses: TRIVIA_CHECK_SEARCHES },
      })).value;
      fc = toFactCheck(out);
    } catch (err) {
      log.push({ at: stamp(), kind: 'check', key, detail: `error: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}` });
      continue;
    }
    log.push({ at: stamp(), kind: 'check', key, detail: fc.verdict === 'pass' ? `pass (AI ${kindOf(p)})` : `fail: ${fc.problems.join('; ').slice(0, 300)}` });
    if (fc.verdict === 'pass') {
      factChecks.set(key, fc);
      passed.push(p);
    } else {
      await archiveTrivia({ db }, p, fc);
    }
  }

  const choice = chooseGameDay(passed);
  const ordered = orderEasiestFirst(choice.chosen);
  const asGame = (p: TriviaPoolPayload): GameQuestion => ({ key: poolKeyOf(p.q), payload: p, factCheck: factChecks.get(poolKeyOf(p.q)) ?? { verdict: 'pass', problems: [], sources: [] } });
  const questions = ordered.map(asGame);
  const chosenKeys = new Set(questions.map((q) => q.key));
  const bench = passed.filter((p) => !chosenKeys.has(poolKeyOf(p.q))).map(asGame);
  const dropped = before.filter((k) => !chosenKeys.has(k));
  if (dropped.length) log.push({ at: stamp(), kind: 'release', detail: `swapped out ${dropped.join(', ')}` });
  if (questions.length < GAME_SIZE && checks >= MAX_GAME_CHECKS) log.push({ at: stamp(), kind: 'note', detail: `short: ${questions.length} of ${GAME_SIZE} after ${checks} fact-checks` });

  await saveDay(db, { day_number: dayNumber, ny_date: date, questions, bench, log });
  await release(db, dropped);
  await reserve(db, [...chosenKeys], now);
  return { date, dayNumber, questions: questions.length, aiRight: choice.aiRight, checks, balanced: choice.balanced };
}

/* ── Lock ────────────────────────────────────────────────────────────── */

/** Lock every full draft whose time has come; release and log a past day that is still short; hand served days' questions to the IG pool. */
export async function lockDue(db: Queryable, now: Date): Promise<{ locked: string[]; missed: string[]; served: string[] }> {
  const today = nyDate(now);
  const tomorrow = addDays(today, 1);
  const lockable = (date: string) => date <= today || (date === tomorrow && nyClock(now) >= GAME_LOCK_AT);
  const out = { locked: [] as string[], missed: [] as string[], served: [] as string[] };
  for (const d of await readDays(db, { status: 'draft' })) {
    if (!lockable(d.ny_date)) continue;
    if (d.questions.length === GAME_SIZE) {
      const keys = d.questions.map((q) => q.key);
      await db.query(
        `UPDATE stories.trivia_game_days SET status = 'locked', locked_at = $2::timestamptz, log = log || $3::jsonb WHERE ny_date = $1::date AND status = 'draft'`,
        [d.ny_date, now.toISOString(), JSON.stringify([{ at: now.toISOString(), kind: 'lock', detail: `locked with ${keys.length}` }])],
      );
      await reserve(db, keys, now); // used for good (they already are; a pulled-then-reserved gap is closed here)
      out.locked.push(d.ny_date);
    } else if (d.ny_date < today && !d.log.some((l) => l.kind === 'missed')) {
      const keys = d.questions.map((q) => q.key);
      await release(db, keys);
      await db.query(
        `UPDATE stories.trivia_game_days SET questions = '[]'::jsonb, log = log || $2::jsonb WHERE ny_date = $1::date AND status = 'draft'`,
        [d.ny_date, JSON.stringify([{ at: now.toISOString(), kind: 'missed', detail: `only ${keys.length} of ${GAME_SIZE} by 11 pm; not exported, questions released` }])],
      );
      out.missed.push(d.ny_date);
    }
  }
  // Served days: a locked day whose date has passed gives its questions back to the pool once, so IG stories may use them.
  for (const d of await readDays(db, { status: 'locked' })) {
    if (d.ny_date >= today || d.log.some((l) => l.kind === 'release' && l.detail === SERVED_DETAIL)) continue;
    await release(db, d.questions.map((q) => q.key));
    await db.query(
      `UPDATE stories.trivia_game_days SET log = log || $2::jsonb WHERE ny_date = $1::date`,
      [d.ny_date, JSON.stringify([{ at: now.toISOString(), kind: 'release', detail: SERVED_DETAIL }])],
    );
    out.served.push(d.ny_date);
  }
  return out;
}

/* ── Pull ────────────────────────────────────────────────────────────── */

/** A person pulls a draft question: archived for good, and the builder fills the gap on its next pass. */
export async function pullQuestion(db: Queryable, date: string, key: string, by: string | null, now: Date = new Date()): Promise<GameDayRow> {
  const d = await readDay(db, date);
  if (!d) throw new Error(`no game day on ${date}`);
  if (d.status !== 'draft') throw new Error(`${date} is locked`);
  const q = d.questions.find((x) => x.key === key);
  if (!q) throw new Error(`${key} is not in ${date}'s game`);
  await db.query(
    `INSERT INTO stories.trivia_archive (key, cell_id, payload, reason) VALUES ($1, $2, $3::jsonb, $4)`,
    [key, q.payload.q.cellId, JSON.stringify({ ...q.payload, factCheck: q.factCheck }), `pulled from game day ${date}${by ? ` by ${by}` : ''}`],
  );
  await db.query(`DELETE FROM stories.pool WHERE series = $1 AND key = $2`, [TRIVIA_SERIES, key]);
  const entry: GameLog = { at: now.toISOString(), kind: 'pull', key, detail: `pulled${by ? ` by ${by}` : ''}` };
  await db.query(
    `UPDATE stories.trivia_game_days SET questions = $2::jsonb, log = log || $3::jsonb WHERE ny_date = $1::date AND status = 'draft'`,
    [date, JSON.stringify(d.questions.filter((x) => x.key !== key)), JSON.stringify([entry])],
  );
  return (await readDay(db, date))!;
}

/* ── Export (the website's contract) ─────────────────────────────────── */

export type ExportQuestion = {
  id: string;
  position: number;
  question: string;
  options: Array<{ letter: Letter; text: string }>;
  correct: Letter;
  answerLine: string;
  sources: string[];
  ai: { model: string; label: string; picked: Letter };
};
export type ExportDay = { dayNumber: number; nyDate: string; questions: ExportQuestion[] };

const isLetter = (v: unknown): v is Letter => v === 'A' || v === 'B' || v === 'C';
const url = (s: unknown): s is string => typeof s === 'string' && /^https?:\/\//.test(s);

/** One locked day in the contract, or null when it would fail the website's checks (the site would skip it anyway). */
export function exportDay(d: Pick<GameDayRow, 'day_number' | 'ny_date' | 'questions'>): ExportDay | null {
  if (!Number.isInteger(d.day_number) || d.day_number < 1 || !ISO.test(d.ny_date) || d.questions.length !== GAME_SIZE) return null;
  const questions: ExportQuestion[] = [];
  for (const [i, g] of d.questions.entries()) {
    const q = g.payload.q;
    const o = g.payload.opponent;
    const options = LETTERS.map((letter) => ({ letter, text: q.options.find((x) => x.letter === letter)?.text?.trim() ?? '' }));
    if (!q.question?.trim() || !q.answerLine?.trim() || options.some((x) => !x.text) || !isLetter(q.correct) || !o || !isLetter(o.picked) || !o.label) return null;
    questions.push({
      id: `d${d.day_number}-${g.key.replace(/^trivia:/, '').replace(/:/g, '-')}`,
      position: i + 1,
      question: q.question.trim(),
      options,
      correct: q.correct,
      answerLine: q.answerLine.trim(),
      sources: [...new Set([...(q.sources ?? []), ...(g.factCheck?.sources ?? [])].filter(url))],
      ai: { model: o.model, label: `${o.label} ${OPPONENT_TAG}`, picked: o.picked },
    });
  }
  return { dayNumber: d.day_number, nyDate: d.ny_date, questions };
}

/** Locked days after `after` (a New York date), oldest first. */
export async function exportDays(db: Queryable, after: string | null): Promise<{ days: ExportDay[] }> {
  const { rows } = await db.query<GameDayRow>(
    `${rowSql} WHERE status = 'locked' AND ($1::date IS NULL OR ny_date > $1::date) ORDER BY ny_date`,
    [after],
  );
  return { days: rows.map(exportDay).filter((d): d is ExportDay => d !== null) };
}

