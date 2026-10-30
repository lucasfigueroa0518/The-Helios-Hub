/**
 * Targeted Revisions engine: runs one claimed revision, and undoes or restores a part.
 *
 * The worker claims a row and stores the interpretation before calling runRevision.
 * The engine never deletes rendered files: it only records paths in before/after,
 * and descriptions keep every version on disk.
 *
 * Review rule: any change to an approved or scheduled post (revise, undo, restore)
 * first sends it back to review via description.unschedule. Nothing here re-approves.
 */
import type { Query } from '@/lib/social/store/pg';

import { CeilingReached, capFor, createCostMeter, noCapNote } from './caps';
import { VERTICAL_LABELS, descriptionFor } from './registry';
import { latestApplied, listForItem, markApplied, markEnded, markRunning, markUndone, requeueWithOverride, unmarkUndone } from './store';
import { RevisionFailure, type ContentTypeDescription, type CostMeter, type PartRef, type PartState, type PostSnapshot, type RevisionResult, type RevisionRow } from './types';

export type EngineDeps = { q: Query; notify: (msg: string) => Promise<void>; now: () => Date };
export type EngineOutcome = { ok: boolean; note: string };

const LOCKED: ReadonlyArray<PostSnapshot['status']> = ['published', 'rejected'];
const SEND_BACK: ReadonlyArray<PostSnapshot['status']> = ['approved', 'scheduled'];

const usd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
const partName = (p: PartRef) => `${p.kind} ${p.key}`;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function safeNotify(deps: EngineDeps, msg: string) {
  try {
    await deps.notify(msg);
  } catch (e) {
    console.error('[revisions] notify failed:', errText(e));
  }
}

/** unschedule that never throws. */
async function sendBackToReview(desc: ContentTypeDescription, q: Query, refs: RevisionRow['refs']): Promise<EngineOutcome> {
  try {
    return await desc.unschedule(q, refs);
  } catch (e) {
    return { ok: false, note: errText(e) };
  }
}

/** What a run has done so far, so a failure at any point can be cleaned up honestly. */
type RunState = {
  desc: ContentTypeDescription | null;
  meter: CostMeter | null;
  /** Set once revise reported new content on the post; cleared once that content is logged or rolled back. */
  revisedBefore: PartState | null;
  sentBack: boolean;
};

/** Runs one revision. `row` is already claimed (status `running`) with its interpretation stored. */
export async function runRevision(deps: EngineDeps, row: RevisionRow): Promise<void> {
  const st: RunState = { desc: null, meter: null, revisedBefore: null, sentBack: false };
  try {
    await runSteps(deps, row, st);
  } catch (e) {
    // Anything unexpected: never leave the row `running` or revised content unlogged.
    const spent = st.meter?.spent ?? 0;
    const why = `The revision stopped on an unexpected error: ${errText(e)}.`;
    if (st.revisedBefore) return endWithRollback(deps, row, st, why, spent);
    await markEnded(deps.q, row.id, 'failed', `${why} The original was kept.${reviewSuffix(st)}`, spent);
  }
}

const reviewSuffix = (st: RunState) => (st.sentBack ? ' The post was sent back to review and stays there.' : '');

/**
 * Restores the part's `before` and ends the row `failed`. If the restore itself fails,
 * the row still ends `failed` with a loud note and a notification goes out.
 */
async function endWithRollback(deps: EngineDeps, row: RevisionRow, st: RunState, why: string, spent: number): Promise<void> {
  const before = st.revisedBefore!;
  const part = row.interpretation!.part;
  try {
    await st.desc!.restore({ q: deps.q, refs: row.refs, part, state: before });
    st.revisedBefore = null;
    await markEnded(deps.q, row.id, 'failed', `${why} The original was restored.${reviewSuffix(st)}`, spent);
  } catch (e) {
    const label = VERTICAL_LABELS[row.vertical];
    const loud = `${why} The engine could not roll back (${errText(e)}); the post may still carry the revised content.`;
    await markEnded(deps.q, row.id, 'failed', `${loud}${reviewSuffix(st)}`, spent);
    await safeNotify(deps, `Needs attention: a ${label} revision of ${partName(part)} failed and could not roll back; the post may still carry the revised content.`);
  }
}

async function runSteps(deps: EngineDeps, row: RevisionRow, st: RunState): Promise<void> {
  const { q } = deps;
  const label = VERTICAL_LABELS[row.vertical];
  const fail = (note: string, cost = 0) => markEnded(q, row.id, 'failed', note, cost);

  const interp = row.interpretation;
  if (!interp) return fail('This revision has no interpretation, so nothing was changed.');
  const desc = descriptionFor(row.vertical);
  if (!desc) return fail(`Revisions are not available for ${label} yet.`);
  st.desc = desc;

  // Refusals and cap pauses happen before anything touches the post (no unschedule, no spend).
  const snap = await desc.load(q, row.refs);
  if (!snap) return fail(`This ${label} post could not be found, so nothing was changed.`);
  if (LOCKED.includes(snap.status)) return fail(`This ${label} post is ${snap.status} and can no longer be revised.`);
  if (!desc.fixKinds.includes(interp.fixKind)) {
    return fail(`${label} does not offer a ${interp.fixKind} fix, so nothing was changed.`);
  }
  const cap = capFor(row.vertical, interp.fixKind);
  if (!cap) return fail(noCapNote(row.vertical, interp.fixKind));

  const override = row.overrideUsd ?? 0;
  const effectiveCap = Math.max(cap.capUsd, override);
  const ceiling = Math.max(cap.ceilingUsd, override);
  await markRunning(q, row.id, interp, cap.capUsd, cap.ceilingUsd);

  const estimate = desc.estimate(interp.fixKind);
  if (estimate > effectiveCap) {
    return markEnded(
      q,
      row.id,
      'paused_at_cap',
      `This ${interp.fixKind} fix is estimated at ${usd(estimate)}, above the ${usd(effectiveCap)} cap for ${label}. Allow a higher amount to run it.`,
      0,
    );
  }
  const meter = createCostMeter(ceiling);
  st.meter = meter;

  // Back to review before any content changes, so a scheduled post never goes out half-revised.
  if (SEND_BACK.includes(snap.status)) {
    const back = await sendBackToReview(desc, q, row.refs);
    if (!back.ok) return fail(`The post could not be sent back to review (${back.note}), so nothing was changed.`);
    st.sentBack = true;
  }

  const pauseAtCeiling = async () => {
    await markEnded(
      q,
      row.id,
      'paused_at_ceiling',
      `Paused at the ${usd(ceiling)} ceiling for ${label} after spending ${usd(meter.spent)}. Nothing was changed; you can keep going.${reviewSuffix(st)}`,
      meter.spent,
    );
    await safeNotify(
      deps,
      `A ${label} revision of ${partName(interp.part)} reached its ${usd(ceiling)} ceiling (spent ${usd(meter.spent)}) and is paused. Open the post to keep going.`,
    );
  };

  let result: RevisionResult;
  try {
    result = await desc.revise({ q, refs: row.refs, interpretation: interp, meter });
  } catch (e) {
    // The description's own note, already accurate (it may say the original could NOT be kept).
    if (e instanceof RevisionFailure) return fail(`${e.message}${reviewSuffix(st)}`, meter.spent);
    if (e instanceof CeilingReached || meter.spent > ceiling) return pauseAtCeiling();
    return fail(`The ${interp.fixKind} fix failed and the original was kept: ${errText(e)}.${reviewSuffix(st)}`, meter.spent);
  }
  if (result.ok) st.revisedBefore = result.before;

  if (meter.spent > ceiling) {
    // The description swallowed CeilingReached. Never keep work done past the ceiling.
    if (st.revisedBefore) {
      return endWithRollback(deps, row, st, `The revision went past the ${usd(ceiling)} ceiling for ${label}.`, meter.spent);
    }
    return pauseAtCeiling();
  }
  if (!result.ok) return markEnded(q, row.id, result.reason, `${result.note}${reviewSuffix(st)}`, meter.spent);

  // The post may have changed while revise ran.
  const now = await desc.load(q, row.refs);
  if (!now || LOCKED.includes(now.status)) {
    const what = now ? `became ${now.status}` : 'disappeared';
    return endWithRollback(deps, row, st, `The post ${what} while the revision ran, so it was not kept.`, meter.spent);
  }
  if (SEND_BACK.includes(now.status)) {
    const back = await sendBackToReview(desc, q, row.refs);
    if (!back.ok) {
      return endWithRollback(deps, row, st, `The post was approved during the revision and could not be sent back to review (${back.note}).`, meter.spent);
    }
    st.sentBack = true;
  }

  const applied = await markApplied(q, row.id, { before: result.before, after: result.after, costUsd: meter.spent });
  if (applied) {
    st.revisedBefore = null;
    return;
  }
  // The row left `running` underneath us: someone else owns its status now, so do not
  // overwrite it, but do not leave an unlogged change on the post either.
  try {
    await desc.restore({ q, refs: row.refs, part: interp.part, state: result.before });
    st.revisedBefore = null;
    console.error(`[revisions] ${row.id} was no longer running; the revision was rolled back.`);
  } catch (e) {
    st.revisedBefore = null;
    await safeNotify(
      deps,
      `Needs attention: a ${label} revision of ${partName(interp.part)} could not be logged or rolled back (${errText(e)}); the post may still carry the revised content.`,
    );
  }
}

/** Shared guard for undo and restore: the type exists and the post is not locked. */
async function editable(q: Query, row: RevisionRow): Promise<{ desc: ContentTypeDescription; snap: PostSnapshot } | EngineOutcome> {
  const label = VERTICAL_LABELS[row.vertical];
  const desc = descriptionFor(row.vertical);
  if (!desc) return { ok: false, note: `Revisions are not available for ${label} yet.` };
  const snap = await desc.load(q, row.refs);
  if (!snap) return { ok: false, note: `This ${label} post could not be found.` };
  if (LOCKED.includes(snap.status)) return { ok: false, note: `This ${label} post is ${snap.status} and can no longer be changed.` };
  return { desc, snap };
}

/**
 * After the undo rows are claimed: send an approved/scheduled post back to review, then
 * restore `state`. On any failure the claims are released and nothing is reported as done.
 */
async function reviewThenRestore(
  q: Query,
  g: { desc: ContentTypeDescription; snap: PostSnapshot },
  row: RevisionRow,
  part: PartRef,
  state: PartState,
  claimed: string[],
): Promise<EngineOutcome | null> {
  const release = async () => {
    for (const id of claimed) await unmarkUndone(q, id);
  };
  let sentBack = false;
  if (SEND_BACK.includes(g.snap.status)) {
    const back = await sendBackToReview(g.desc, q, row.refs);
    if (!back.ok) {
      await release();
      return { ok: false, note: `The post could not be sent back to review (${back.note}), so nothing changed.` };
    }
    sentBack = true;
  }
  try {
    await g.desc.restore({ q, refs: row.refs, part, state });
  } catch (e) {
    await release();
    const review = sentBack ? ' The post was sent back to review and stays there.' : '';
    return { ok: false, note: `Restoring ${partName(part)} failed and its content did not change: ${errText(e)}.${review}` };
  }
  return null;
}

/**
 * Reverts the latest applied revision of `part` (restores its `before`) and marks it undone.
 * Calling it again walks back one more. Sends an approved/scheduled post back to review first;
 * never re-approves.
 */
export async function undoRevision(deps: EngineDeps, itemId: string, part: PartRef, by: string): Promise<EngineOutcome> {
  const { q } = deps;
  const latest = await latestApplied(q, itemId, part);
  if (!latest || !latest.before) return { ok: false, note: `There is nothing to undo on ${partName(part)}.` };
  const guard = await editable(q, latest);
  if (!('desc' in guard)) return guard;

  // Claim the undo first so two undos cannot both restore the same row.
  if (!(await markUndone(q, latest.id, by))) {
    return { ok: false, note: `That revision of ${partName(part)} was already undone; nothing changed.` };
  }
  const failed = await reviewThenRestore(q, guard, latest, part, latest.before, [latest.id]);
  return failed ?? { ok: true, note: `Undid the last revision of ${partName(part)}.` };
}

/** Newest applied first: the order the revisions were put in place (finished), then created, then id. */
function newestAppliedFirst(rows: RevisionRow[]): RevisionRow[] {
  const key = (r: RevisionRow) => [r.finishedAt ?? '', r.createdAt, r.id] as const;
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? 1 : -1;
    return 0;
  });
}

/**
 * Puts `part` back to the pipeline's original by walking its applied revisions NEWEST -> OLDEST:
 * each step restores that row's `before` (whole-item types such as text on screen and explainers
 * can only go back one revision at a time; per-part types recompute their derived fields each step)
 * and the last step lands on the first row's `before`, the original. Every row is claimed first; an
 * approved/scheduled post is sent back to review ONCE before the first step. The walk stops at the
 * first failure: that row and the older ones are released (still applied) and the note says how many
 * were undone and why it stopped. Running it again picks up from there. Never re-approves.
 */
export async function restoreOriginal(deps: EngineDeps, itemId: string, part: PartRef, by: string): Promise<EngineOutcome> {
  const { q } = deps;
  const chain = newestAppliedFirst(
    (await listForItem(q, itemId)).filter((r) => r.status === 'applied' && r.part?.kind === part.kind && r.part?.key === part.key),
  );
  if (chain.length === 0) return { ok: false, note: `${partName(part)} is already the original.` };
  const guard = await editable(q, chain[0]);
  if (!('desc' in guard)) return guard;

  const release = async (rows: RevisionRow[]) => {
    for (const r of rows) await unmarkUndone(q, r.id);
  };
  const claimed: RevisionRow[] = [];
  for (const r of chain) if (await markUndone(q, r.id, by)) claimed.push(r);
  if (claimed.length === 0) return { ok: false, note: `Those revisions of ${partName(part)} were already undone; nothing changed.` };
  if (claimed.length !== chain.length) {
    // Someone undid one of them meanwhile: walking around it could skip a step of the chain.
    await release(claimed);
    return { ok: false, note: `The revisions of ${partName(part)} changed while restoring, so nothing changed. Try again.` };
  }

  let sentBack = false;
  if (SEND_BACK.includes(guard.snap.status)) {
    const back = await sendBackToReview(guard.desc, q, chain[0].refs);
    if (!back.ok) {
      await release(claimed);
      return { ok: false, note: `The post could not be sent back to review (${back.note}), so nothing changed.` };
    }
    sentBack = true;
  }
  const review = sentBack ? ' The post was sent back to review and stays there.' : '';

  for (let i = 0; i < chain.length; i += 1) {
    const r = chain[i];
    try {
      if (!r.before) throw new Error('This revision has no record of what came before it');
      await guard.desc.restore({ q, refs: r.refs, part, state: r.before });
    } catch (e) {
      await release(chain.slice(i));
      const why = errText(e).replace(/\.+$/, '');
      if (i === 0) return { ok: false, note: `Restoring ${partName(part)} failed and its content did not change: ${why}.${review}` };
      return {
        ok: false,
        note: `Undid ${i} of ${chain.length} revisions of ${partName(part)}, then stopped: ${why}. The older ones are still in place; Restore original again picks up from there.${review}`,
      };
    }
  }
  return { ok: true, note: `Restored the original ${partName(part)}.` };
}

/**
 * The user's go-ahead on a row paused at its cap or ceiling: raise its allowance to
 * `overrideUsd` and queue it again. The worker re-runs it from the start.
 */
export async function continueAfterCeiling(deps: EngineDeps, id: string, by: string, overrideUsd: number): Promise<EngineOutcome> {
  if (!Number.isFinite(overrideUsd) || overrideUsd <= 0) return { ok: false, note: 'The allowed amount must be a positive number.' };
  const note = `Continued by ${by}, allowing up to ${usd(overrideUsd)}.`;
  if (!(await requeueWithOverride(deps.q, id, overrideUsd, note))) {
    return { ok: false, note: 'Only a paused revision can be continued; nothing changed.' };
  }
  return { ok: true, note };
}
