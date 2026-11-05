/**
 * The social worker's revisions step (scripts/social_worker.ts, each tick):
 * claim the oldest `requested` rows one at a time, interpret each new one with Haiku,
 * then either ask back (`asking`, no spend beyond the Haiku call) or hand the
 * row to the engine (lib/revisions/engine.ts runRevision). A row continued past its cap or
 * ceiling already carries its interpretation and goes straight to the engine.
 *
 * Only rows a person queued from the hub are ever touched (CLAUDE.md Rule 2:
 * no sweeps). A claimed row never stays `running`: every failure before the
 * engine ends it `failed` with a plain note, and the engine owns it after.
 * `complete` is injected; tests stub it, only the worker script wires the live call.
 */
import type { Query } from '@/lib/social/store/pg';

import { hasAnyCap, noCapNote } from './caps';
import { runRevision } from './engine';
import { interpret, type Complete } from './interpret';
import { VERTICAL_LABELS, descriptionFor } from './registry';
import { addSpend, claimNextRequested, failStaleRunning, getRequest, markAsking, markEnded, setInterpretation, type ClaimFilter } from './store';
import type { RevisionRow } from './types';

export type RevisionWorkerDeps = {
  q: Query;
  complete: Complete;
  notify: (msg: string) => Promise<void>;
  now: () => Date;
  /** Rows handled per tick (default 3), so revisions never starve the rest of the loop. */
  max?: number;
  log?: Log;
  /** Which verticals this worker claims (default: all). The social worker excludes explainers; helios-explainers takes only them. */
  filter?: ClaimFilter;
};

const LOCKED = new Set(['published', 'rejected']);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A change runs for minutes; a row of this worker's still `running` after this long has no live process behind it. */
export const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;

type Log = (message: string, fields?: Record<string, unknown>) => void;

/**
 * A worker's start-up, before its loop: `recover` (the explainers worker's job-folder repair,
 * recoverSceneRedos) first, so the workspace is put back before any row is ended; then every row
 * this worker owns (`filter`) that is still `running` is ended `failed` with a plain note: the
 * process that ran it is gone. Rows are never requeued (a half-run may already have made its one
 * guarded write). `query` null: no sweep (e.g. the revisions log is not reachable from this worker).
 * The sweep never throws (a failure is logged and start-up goes on); `recover` keeps its own behaviour.
 */
export async function startUpRevisions(o: {
  recover?: () => Promise<unknown>;
  query: (() => Promise<Query>) | null;
  filter: ClaimFilter;
  log: Log;
}): Promise<string[]> {
  if (o.recover) await o.recover();
  if (!o.query) return [];
  try {
    const ids = await failStaleRunning(await o.query(), { filter: o.filter });
    if (ids.length) o.log('revisions_restart_swept', { ids });
    return ids;
  } catch (e) {
    o.log('revisions_restart_sweep_failed', { error: errText(e) });
    return [];
  }
}

/** Claims and handles up to `max` requested rows. Returns how many it claimed. */
export async function claimAndRunRevisions(deps: RevisionWorkerDeps): Promise<number> {
  const max = deps.max ?? 3;
  let n = 0;
  // Belt and braces beside the start-up sweep: this worker's rows stuck `running` for hours.
  const stale = await failStaleRunning(deps.q, { filter: deps.filter, olderThanMs: STALE_RUNNING_MS });
  if (stale.length) deps.log?.('revisions_stale_swept', { ids: stale });
  while (n < max) {
    const row = await claimNextRequested(deps.q, deps.filter);
    if (!row) break;
    n += 1;
    await handle(deps, row);
  }
  return n;
}

async function handle(deps: RevisionWorkerDeps, row: RevisionRow): Promise<void> {
  const { q } = deps;
  const label = VERTICAL_LABELS[row.vertical];
  let spent = 0;
  const fail = (note: string) => markEnded(q, row.id, 'failed', note, 0);
  try {
    // A row continued past its cap or ceiling keeps its interpretation: run it as the person
    // approved it, without paying Haiku again or risking a different part, fix or a question.
    if (row.interpretation) {
      await runRevision({ q, notify: deps.notify, now: deps.now }, row);
      deps.log?.('revision_continued', { id: row.id, vertical: row.vertical });
      return;
    }
    const desc = descriptionFor(row.vertical);
    if (!desc) return await fail(`Revisions are not available for ${label} yet.`);
    // No approved cap: nothing could run, so never pay the interpreter to find that out.
    if (!hasAnyCap(row.vertical)) return await fail(noCapNote(row.vertical));
    const snapshot = await desc.load(q, row.refs);
    if (!snapshot) return await fail(`This ${label} post could not be found, so nothing was changed.`);
    if (LOCKED.has(snapshot.status)) return await fail(`This ${label} post is ${snapshot.status} and can no longer be revised.`);

    let prior: { sentence: string; question: string } | undefined;
    if (row.parentId) {
      const parent = await getRequest(q, row.parentId);
      if (parent?.question) prior = { sentence: parent.instruction, question: parent.question };
    }

    const out = await interpret({ complete: deps.complete }, { snapshot, sentence: row.instruction, ...(prior ? { prior } : {}) });
    spent = out.costUsd;
    await addSpend(q, row.id, out.costUsd);
    if (out.status === 'ask') {
      await markAsking(q, row.id, out.question);
      deps.log?.('revision_asking', { id: row.id, vertical: row.vertical });
      return;
    }
    // Logged before the engine runs; the engine sets the cap and ceiling and owns the row from here.
    await setInterpretation(q, row.id, out.interpretation);
    await runRevision({ q, notify: deps.notify, now: deps.now }, { ...row, interpretation: out.interpretation });
    deps.log?.('revision_ran', { id: row.id, vertical: row.vertical });
  } catch (e) {
    const why = errText(e);
    deps.log?.('revision_failed', { id: row.id, error: why, spentUsd: spent });
    try {
      // Only a row still `running` is ours to end; one the engine already ended keeps its outcome.
      if ((await getRequest(q, row.id))?.status === 'running') {
        await markEnded(q, row.id, 'failed', `The revision could not start: ${why}. Nothing was changed.`, 0);
      }
    } catch (err) {
      deps.log?.('revision_fail_failed', { id: row.id, error: errText(err) });
    }
  }
}
