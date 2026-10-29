/**
 * Targeted Revisions engine: runs one claimed revision, and undoes or restores a part.
 *
 * The worker claims a row and stores the interpretation before calling runRevision.
 * The engine never deletes rendered files: it only records paths in before/after,
 * and descriptions keep every version on disk.
 */
import type { Query } from '@/lib/social/store/pg';

import { CeilingReached, capFor, createCostMeter } from './caps';
import { VERTICAL_LABELS, descriptionFor } from './registry';
import { latestApplied, listForItem, markApplied, markEnded, markRunning, markUndone, originalOf, requeueWithOverride, unmarkUndone } from './store';
import type { ContentTypeDescription, PartRef, PostSnapshot, RevisionRow } from './types';

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

/** Runs one revision. `row` is already claimed (status `running`) with its interpretation stored. */
export async function runRevision(deps: EngineDeps, row: RevisionRow): Promise<void> {
  const { q } = deps;
  const label = VERTICAL_LABELS[row.vertical];
  const fail = (note: string, cost = 0) => markEnded(q, row.id, 'failed', note, cost);

  const interp = row.interpretation;
  if (!interp) return fail('This revision has no interpretation, so nothing was changed.');
  const desc = descriptionFor(row.vertical);
  if (!desc) return fail(`Revisions are not available for ${label} yet.`);

  const snap = await desc.load(q, row.refs);
  if (!snap) return fail(`This ${label} post could not be found, so nothing was changed.`);
  if (LOCKED.includes(snap.status)) return fail(`This ${label} post is ${snap.status} and can no longer be revised.`);

  if (!desc.fixKinds.includes(interp.fixKind)) {
    return fail(`${label} does not offer a ${interp.fixKind} fix, so nothing was changed.`);
  }
  const cap = capFor(row.vertical, interp.fixKind);
  if (!cap) return fail(`There is no approved cap for ${label} (${interp.fixKind} fixes) yet, so nothing was run.`);

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
  const pauseAtCeiling = async () => {
    await markEnded(
      q,
      row.id,
      'paused_at_ceiling',
      `Paused at the ${usd(ceiling)} ceiling for ${label} after spending ${usd(meter.spent)}. Nothing was changed; you can keep going.`,
      meter.spent,
    );
    await safeNotify(
      deps,
      `A ${label} revision of ${partName(interp.part)} reached its ${usd(ceiling)} ceiling (spent ${usd(meter.spent)}) and is paused. Open the post to keep going.`,
    );
  };

  let result;
  try {
    result = await desc.revise({ q, refs: row.refs, interpretation: interp, meter });
  } catch (e) {
    if (e instanceof CeilingReached || meter.spent > ceiling) return pauseAtCeiling();
    return fail(`The ${interp.fixKind} fix failed and the original was kept: ${errText(e)}`, meter.spent);
  }

  if (meter.spent > ceiling) {
    // The description swallowed CeilingReached. Never keep work done past the ceiling.
    if (result.ok) await desc.restore({ q, refs: row.refs, part: interp.part, state: result.before });
    return pauseAtCeiling();
  }
  if (!result.ok) return markEnded(q, row.id, result.reason, result.note, meter.spent);

  if (SEND_BACK.includes(snap.status)) {
    const back = await sendBackToReview(desc, q, row);
    if (!back.ok) {
      await desc.restore({ q, refs: row.refs, part: interp.part, state: result.before });
      return fail(`The post could not be sent back to review (${back.note}), so the original was kept.`, meter.spent);
    }
  }

  const applied = await markApplied(q, row.id, { before: result.before, after: result.after, costUsd: meter.spent });
  if (!applied) {
    // The row left `running` underneath us: do not leave an unlogged change on the post.
    await desc.restore({ q, refs: row.refs, part: interp.part, state: result.before });
    console.error(`[revisions] ${row.id} was no longer running; the revision was rolled back.`);
  }
}

async function sendBackToReview(desc: ContentTypeDescription, q: Query, row: RevisionRow): Promise<EngineOutcome> {
  try {
    return await desc.unschedule(q, row.refs);
  } catch (e) {
    return { ok: false, note: errText(e) };
  }
}

/** Shared guard for undo and restore: the type exists and the post is not locked. */
async function editable(q: Query, row: RevisionRow): Promise<{ desc: ContentTypeDescription } | EngineOutcome> {
  const label = VERTICAL_LABELS[row.vertical];
  const desc = descriptionFor(row.vertical);
  if (!desc) return { ok: false, note: `Revisions are not available for ${label} yet.` };
  const snap = await desc.load(q, row.refs);
  if (!snap) return { ok: false, note: `This ${label} post could not be found.` };
  if (LOCKED.includes(snap.status)) return { ok: false, note: `This ${label} post is ${snap.status} and can no longer be changed.` };
  return { desc };
}

/**
 * Reverts the latest applied revision of `part` (restores its `before`) and marks it undone.
 * Calling it again walks back one more. Never re-approves and never unschedules.
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
  try {
    await guard.desc.restore({ q, refs: latest.refs, part, state: latest.before });
  } catch (e) {
    await unmarkUndone(q, latest.id);
    return { ok: false, note: `Undo failed and nothing changed: ${errText(e)}` };
  }
  return { ok: true, note: `Undid the last revision of ${partName(part)}.` };
}

/** Puts `part` back to the pipeline's original and marks every applied revision of it undone. */
export async function restoreOriginal(deps: EngineDeps, itemId: string, part: PartRef, by: string): Promise<EngineOutcome> {
  const { q } = deps;
  const original = await originalOf(q, itemId, part);
  const applied = (await listForItem(q, itemId)).filter(
    (r) => r.status === 'applied' && r.part?.kind === part.kind && r.part?.key === part.key,
  );
  if (!original || applied.length === 0) return { ok: false, note: `${partName(part)} is already the original.` };
  const newest = applied[applied.length - 1];
  const guard = await editable(q, newest);
  if (!('desc' in guard)) return guard;

  const marked: string[] = [];
  for (const r of applied) if (await markUndone(q, r.id, by)) marked.push(r.id);
  if (marked.length === 0) return { ok: false, note: `Those revisions of ${partName(part)} were already undone; nothing changed.` };
  try {
    await guard.desc.restore({ q, refs: newest.refs, part, state: original });
  } catch (e) {
    for (const id of marked) await unmarkUndone(q, id);
    return { ok: false, note: `Restoring the original failed and nothing changed: ${errText(e)}` };
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
