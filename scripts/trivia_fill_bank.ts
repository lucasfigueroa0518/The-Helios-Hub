/**
 * A person's top-up of AI Trivia's unused bank (2026-11-22), then today's game day: live Claude, web search and Jev
 * calls, so run it only when Lucas says so (CLAUDE.md rule 1), with the cost estimate first.
 *
 *   npx tsx scripts/trivia_fill_bank.ts                 dry run: prints the bank and the estimate, calls nothing
 *   npx tsx scripts/trivia_fill_bank.ts --go            fills the bank, builds today's and tomorrow's game days, fills again
 *   npx tsx scripts/trivia_fill_bank.ts --go --calls 25 the writer calls the whole run may make (default 25)
 *
 * The writer runs as the daily writer does (runTriviaDaily, forced, adding to today's record) with a larger target and
 * call limit; the repeat check (lib/stories/trivia/repeats.ts) holds every new question to one fact, one question.
 * Then today's and tomorrow's game days are built (buildGameDay, which also re-checks a draft's questions) and locked
 * once due: the top-up takes the day's AI Trivia spend past its daily cap, which would hold the worker's own builds.
 * Last, the writer runs again so the bank ends at TRIVIA_POOL_CAP (50) after the two days took theirs.
 * Reads and writes only the AI Trivia rows (CLAUDE.md rule 2: nothing else is touched).
 *
 * Unset the Claude Code session's ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL first, or .env.local's
 * key is shadowed and every call 401s.
 */
import './stories_env';
import { liveJevTransport } from '@/lib/reels/jev/client';
import { liveStoriesDb } from '@/lib/stories/db';
import { createStoriesJev } from '@/lib/stories/jev';
import { TRIVIA_POOL_CAP, unusedTriviaCount } from '@/lib/stories/pool';
import { nyDate } from '@/lib/stories/repository';
import { loadSettings } from '@/lib/stories/settings';
import { runTriviaDaily } from '@/lib/stories/trivia/daily';
import { addDays, buildGameDay, lockDue, readDay, readLaunch } from '@/lib/stories/trivia/game-days';
import { MAX_GAME_CHECKS } from '@/lib/stories/trivia/game';
import { liveOpponentClient } from '@/lib/stories/trivia/opponent';
import { liveWriterCreate } from '@/lib/stories/writer';

/** From the last 7 days of stories.cost_events: a writer call with its searches, about 3.4 pooled questions a call, a game fact-check. */
const USD_PER_CALL = 0.16;
const POOLED_PER_CALL = 3.4;
const USD_PER_CHECK = 0.04;

async function main() {
  const go = process.argv.includes('--go');
  const i = process.argv.indexOf('--calls');
  const maxCalls = i > 0 ? Number(process.argv[i + 1]) : 25;
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 30) throw new Error('--calls takes 1 to 30');
  const db = liveStoriesDb;
  const now = new Date();
  const bank = await unusedTriviaCount(db);
  const need = Math.max(0, TRIVIA_POOL_CAP - bank);
  // The bank to the cap, plus the two game days' questions (about 2 × GAME_SIZE + fails) taken from it on the way.
  const calls = Math.min(maxCalls, Math.ceil((need + 13) / POOLED_PER_CALL));
  console.log(`unused bank ${bank} of ${TRIVIA_POOL_CAP}; about ${calls} writer calls, about $${(calls * USD_PER_CALL).toFixed(2)} (at most ${maxCalls} calls, $${(maxCalls * USD_PER_CALL).toFixed(2)})`);
  console.log(`game days today and tomorrow: at most ${2 * MAX_GAME_CHECKS} fact-checks, $${(2 * MAX_GAME_CHECKS * USD_PER_CHECK).toFixed(2)}`);
  if (!go) return;

  const settings = await loadSettings(db);
  const write = liveWriterCreate();
  let left = maxCalls;
  const fill = async () => {
    const want = TRIVIA_POOL_CAP - (await unusedTriviaCount(db));
    if (want <= 0 || left <= 0) return;
    const r = await runTriviaDaily({ db, jev: createStoriesJev(liveJevTransport, db), write, settings, now: new Date(), force: true, fill: { target: want, maxCalls: left } });
    if (!r.ran) return;
    left -= r.calls ?? 0;
    console.log(`writer: ${r.calls} calls (${left} left); bank ${r.bank?.before} → ${r.bank?.after}; rejected so far today ${r.rejected.length}${r.error ? `; error ${r.error}` : ''}`);
  };
  await fill();

  const launch = await readLaunch(db);
  const today = nyDate(now);
  if (!launch) return console.log('no launch date: no game day to build');
  const opponent = liveOpponentClient();
  for (const date of [today, addDays(today, 1)]) {
    if (date < launch) continue;
    const built = await buildGameDay({ db, write, opponent, settings, now: new Date(), log: (l) => console.log(l) }, date, launch);
    console.log(`game ${date}: ${JSON.stringify(built)}`);
    console.log(`lock: ${JSON.stringify(await lockDue(db, new Date()))}`);
    const day = await readDay(db, date);
    console.log(`${date}: ${day?.status} with ${day?.questions.length ?? 0} questions`);
  }
  await fill();
  console.log(`bank now ${await unusedTriviaCount(db)}`);
}

main().then(() => process.exit(0), (err) => {
  console.error(err);
  process.exit(1);
});
