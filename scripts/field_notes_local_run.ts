/**
 * One Field Notes run on this Mac (Tommy, 2026-11-06: "Let's test this all locally first").
 *
 *   npm run field-notes:local                 # a normal run (finds, scores and writes new tips)
 *   npm run field-notes:local -- --seed <id>  # a run that uses this seeded tip first
 *   npm run field-notes:local -- --dry        # checks only: schema, settings, photo pool; no run, no spend
 *
 * LIVE: the run makes real Claude calls (Writer, Editor, fact check) and Jev scoring calls, under the run cap in
 * field_notes.settings (run_cap_usd, $0.50 shipped). A person starts it; nothing here starts on its own.
 *
 * It never goes through the shared queue: the run row is inserted already `running` and carried out in this
 * process, so the server worker (which only claims `requested` rows) never picks it up, whatever code it has.
 * The post lands in the hub for review exactly like a worker run. Nothing is booked or published: approval books
 * the calendar, and publishing stays off while field_notes.settings.publishing_live is off.
 *
 * Its own run row never stays `running` (which would block the worker for ABANDONED_AFTER): Ctrl-C, SIGTERM, an
 * uncaught error and the timeout all fail it (failRun) before the process exits. When the cut-off came after the
 * Writer was paid for the tips (the engine's onWriteStarted), each of them also counts an attempt (recordTipAttempt),
 * as the engine itself does for a paid run with no post. The engine is not cancellable, so the process exits right
 * after: nothing of the cut-off run keeps going.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { HubQuery } from '@/lib/social-hub/db';

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}
loadEnvFile(path.join(process.cwd(), '.env.local'));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function args(): { seed: string | null; dry: boolean } {
  const a = process.argv.slice(2);
  const i = a.indexOf('--seed');
  const seed = i >= 0 ? (a[i + 1] ?? '') : null;
  if (seed !== null && !UUID.test(seed)) {
    console.error('--seed needs a tip id (a uuid from the hub seed list)');
    process.exit(2);
  }
  return { seed, dry: a.includes('--dry') };
}

const log = (message: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'field-notes-local', message, ...fields }));

/** The run this process inserted (null before the insert), and the tips the Writer was paid for in it. */
let active: { query: HubQuery; runId: string; writtenTipIds: string[] } | null = null;
let stopping = false;

/** Fail our own run row (and count an attempt for each tip already paid for), once. Never throws. */
async function abandonRun(why: string): Promise<void> {
  const run = active;
  if (!run || stopping) return;
  stopping = true;
  const { failRun, recordTipAttempt } = await import('@/lib/field-notes/store');
  await failRun(run.query, run.runId, why).catch((e) => log('fail_run_error', { runId: run.runId, error: String(e) }));
  for (const id of run.writtenTipIds) await recordTipAttempt(run.query, id, why).catch(() => undefined);
  log('run_abandoned', { runId: run.runId, why, tipsCounted: run.writtenTipIds.length });
}

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
  process.on(signal, () => {
    void abandonRun(`local run stopped by ${signal}`).finally(() => process.exit(code));
  });
}
process.on('uncaughtException', (err) => {
  log('local_run_error', { error: err instanceof Error ? err.message : String(err) });
  void abandonRun(`local run crashed: ${err instanceof Error ? err.message : String(err)}`).finally(() => process.exit(1));
});
process.on('unhandledRejection', (err) => {
  log('local_run_error', { error: err instanceof Error ? err.message : String(err) });
  void abandonRun(`local run crashed: ${err instanceof Error ? err.message : String(err)}`).finally(() => process.exit(1));
});

async function main(): Promise<void> {
  const { seed, dry } = args();
  const { socialQuery } = await import('@/lib/social/store');
  const query = (await socialQuery()) as unknown as HubQuery;

  // Checks first: a missing schema or empty pool is said plainly, before anything is inserted or spent.
  const schema = await query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'field_notes' AND table_name IN ('runs','tips','pool','posts','settings')`);
  if ((schema.rows[0]?.n ?? 0) < 5) throw new Error('the field_notes schema is not applied to this database yet (npm run db:field-notes, after db/media_library_schema.sql)');
  // The re-pay guards need these columns (store.recordTipAttempt, rejectTip): without them a paid run fails at settle time.
  const cols = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'field_notes' AND table_name = 'tips' AND column_name IN ('attempts', 'reject_reason')`,
  );
  const missingCols = ['attempts', 'reject_reason'].filter((c) => !cols.rows.some((r) => r.column_name === c));
  if (missingCols.length) throw new Error(`field_notes.tips is missing ${missingCols.join(', ')}: re-apply the field_notes schema (npm run db:field-notes)`);
  const { readFieldNotesSettings } = await import('@/lib/field-notes/settings');
  const settings = await readFieldNotesSettings(query);
  const pool = await query<{ live: number; faces: number }>(
    `SELECT count(*) FILTER (WHERE status = 'live')::int AS live, count(*) FILTER (WHERE status = 'live' AND kind = 'people')::int AS faces FROM field_notes.pool`,
  );
  const running = await query<{ id: string }>(`SELECT id::text AS id FROM field_notes.runs WHERE status = 'running' LIMIT 1`);
  log('checks', { runCapUsd: settings.runCapUsd, livePhotos: pool.rows[0]?.live ?? 0, facesPhotos: pool.rows[0]?.faces ?? 0, runningRun: running.rows[0]?.id ?? null, seed });
  // FIELD_NOTES_ALLOW_PARALLEL=1: Tommy's one-time parallel test (2026-11-08) only; normally one run at a time.
  if (running.rows[0] && process.env.FIELD_NOTES_ALLOW_PARALLEL !== '1') throw new Error(`another Field Notes run is running (${running.rows[0].id}); wait for it to finish`);
  if (settings.runCapUsd == null) throw new Error('field_notes.settings.run_cap_usd is not a positive number; refusing to run');
  if (dry) {
    log('dry_run_done', { note: 'checks only; no run inserted, nothing spent' });
    return;
  }

  const { rows } = await query<{ id: string }>(
    `INSERT INTO field_notes.runs (trigger, kind, status, started_at, cap_usd, requested_by, record)
     VALUES ('manual', 'build', 'running', now(), $1, 'local', $2::jsonb) RETURNING id::text AS id`,
    [settings.runCapUsd, JSON.stringify(seed ? { seedTipId: seed, local: true } : { local: true })],
  );
  const runId = rows[0]!.id;
  active = { query, runId, writtenTipIds: [] };
  log('run_inserted', { runId, capUsd: settings.runCapUsd });

  const { carryOutFieldNotesRun } = await import('@/lib/field-notes/worker');
  const { tapProcessOutput, withHangGuard } = await import('@/lib/content-runs/hang-guard');
  tapProcessOutput();
  const { liveFieldNotesDeps } = await import('@/lib/field-notes/live');
  const run = active;
  const engine = async (_run: unknown, capUsd: number) => ({
    ...(await liveFieldNotesDeps(query, { capUsd })),
    onWriteStarted: (tipIds: string[]) => void (run.writtenTipIds = tipIds),
  });

  // Never cut off for length; only a hung run (no output for 45 min, or the 12 h backstop) is abandoned.
  const out = await withHangGuard(
    carryOutFieldNotesRun(
      { query, now: () => new Date(), log, engine },
      { id: runId, trigger: 'manual', kind: 'build', requestedBy: 'local', seedTipId: seed },
    ),
    {
      onHang: async (reason) => {
        await abandonRun(`local run ${reason}`);
        return { runId, status: 'failed' as const, note: reason };
      },
    },
  );
  // Finished (or judged hung and already failed): nothing is left for a signal handler to fail.
  if (!stopping) active = null;

  const spend = await query<{ claude_usd: number; jev_usd: number; total_usd: number; stop_reason: string | null }>(
    `SELECT claude_usd, jev_usd, total_usd, stop_reason FROM field_notes.runs WHERE id = $1`,
    [runId],
  );
  log('run_done', { ...out, ...(spend.rows[0] ?? {}) });
  if (out.postId) console.log(`\nPost ready for review: open the Field Notes page in the local hub (npm run dev:web), post ${out.postId}.`);
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    log('local_run_error', { error: message });
    await abandonRun(`local run error: ${message}`);
    process.exit(1);
  });
