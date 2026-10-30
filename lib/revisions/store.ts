import type { ActionTarget } from '@/lib/publishing/actions/types';
import type { Query } from '@/lib/social/store/pg';
import type { Interpretation, PartRef, PartState, RevisionRow, Vertical } from '@/lib/revisions/types';

const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(r: any): RevisionRow {
  return {
    id: r.id,
    vertical: r.vertical,
    itemId: r.item_id,
    refs: r.refs ?? {},
    requestedBy: r.requested_by ?? null,
    instruction: r.instruction,
    parentId: r.parent_id ?? null,
    status: r.status,
    question: r.question ?? null,
    interpretation: r.interpretation ?? null,
    stageTag: r.stage_tag ?? null,
    fixKind: r.fix_kind ?? null,
    part: r.part ?? null,
    capUsd: num(r.cap_usd),
    ceilingUsd: num(r.ceiling_usd),
    overrideUsd: num(r.override_usd),
    spendUsd: Number(r.spend_usd ?? 0),
    before: r.before ?? null,
    after: r.after ?? null,
    note: r.note ?? null,
    createdAt: iso(r.created_at) as string,
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    undoneAt: iso(r.undone_at),
    undoneBy: r.undone_by ?? null,
  };
}

export async function createRequest(
  q: Query,
  a: { vertical: Vertical; refs: ActionTarget; itemId: string; by: string | null; instruction: string; parentId?: string | null },
): Promise<RevisionRow> {
  const { rows } = await q(
    `INSERT INTO revisions.requests (vertical, item_id, refs, requested_by, instruction, parent_id)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6) RETURNING *`,
    [a.vertical, a.itemId, JSON.stringify(a.refs), a.by, a.instruction, a.parentId ?? null],
  );
  return toRow(rows[0]);
}

/**
 * Which rows a worker claims: `only` one vertical, or every vertical but the `exclude` one. Explainer
 * revisions run in helios-explainers (only: 'explainers'); the social worker claims the rest.
 */
export type ClaimFilter = { only?: Vertical; exclude?: Vertical };

/** Oldest `requested` row (within `filter`) -> `running`, exactly once (single UPDATE, row-locked, SKIP LOCKED). */
export async function claimNextRequested(q: Query, filter: ClaimFilter = {}): Promise<RevisionRow | null> {
  const { rows } = await q(
    `UPDATE revisions.requests SET status = 'running', started_at = now()
      WHERE id = (SELECT id FROM revisions.requests WHERE status = 'requested'
                     AND ($1::text IS NULL OR vertical = $1) AND ($2::text IS NULL OR vertical <> $2)
                   ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
        AND status = 'requested'
      RETURNING *`,
    [filter.only ?? null, filter.exclude ?? null],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * The note on a row a worker's start-up found `running`: the process that ran it died (deploy, OOM,
 * systemd). It may have died after the type's guarded write but before markApplied, so the note never
 * claims the post is unchanged.
 */
export const RESTARTED_NOTE =
  'The worker restarted while this change ran, so it did not finish. Check the post: it may have been sent back to review, and in rare cases the change may already be on it.';
/** The note on a row still `running` long after any change takes (the per-tick sweep). */
export const STALE_RUNNING_NOTE = 'This change did not finish in time. Check the post: in rare cases the change may already be on it.';

/**
 * Ends rows left `running` by a process that is gone: `failed`, finished now, with a plain note. Only
 * the rows `filter` gives this worker (the same filter its claims use), and with `olderThanMs` only
 * rows started longer ago than that. Never requeues: a half-run may already have made its one guarded
 * write, so running it again could apply it twice. Returns the ended rows' ids.
 */
export async function failStaleRunning(
  q: Query,
  o: { filter?: ClaimFilter; olderThanMs?: number; note?: string } = {},
): Promise<string[]> {
  const note = o.note ?? (o.olderThanMs !== undefined ? STALE_RUNNING_NOTE : RESTARTED_NOTE);
  const { rows } = await q(
    `UPDATE revisions.requests SET status = 'failed', finished_at = now(), note = $3
      WHERE status = 'running'
        AND ($1::text IS NULL OR vertical = $1) AND ($2::text IS NULL OR vertical <> $2)
        AND ($4::double precision IS NULL OR started_at IS NULL OR started_at < now() - make_interval(secs => $4::double precision))
      RETURNING id`,
    [o.filter?.only ?? null, o.filter?.exclude ?? null, note, o.olderThanMs !== undefined ? o.olderThanMs / 1000 : null],
  );
  return rows.map((r) => String(r.id));
}

export async function markAsking(q: Query, id: string, question: string): Promise<void> {
  await q(`UPDATE revisions.requests SET status = 'asking', question = $2, finished_at = now() WHERE id = $1`, [id, question]);
}

export async function markRunning(q: Query, id: string, interpretation: Interpretation, capUsd: number, ceilingUsd: number): Promise<void> {
  await q(
    `UPDATE revisions.requests
        SET status = 'running', interpretation = $2::jsonb, cap_usd = $3, ceiling_usd = $4,
            part = $5::jsonb, fix_kind = $6, stage_tag = $7,
            started_at = COALESCE(started_at, now())
      WHERE id = $1`,
    [
      id,
      JSON.stringify(interpretation),
      capUsd,
      ceilingUsd,
      interpretation.part ? JSON.stringify(interpretation.part) : null,
      interpretation.fixKind ?? null,
      interpretation.stageTag ?? null,
    ],
  );
}

export async function markApplied(
  q: Query,
  id: string,
  a: { before: PartState; after: PartState; costUsd: number },
): Promise<boolean> {
  const { rows } = await q(
    `UPDATE revisions.requests
        SET status = 'applied', before = $2::jsonb, after = $3::jsonb,
            spend_usd = spend_usd + $4, finished_at = now()
      WHERE id = $1 AND status = 'running'
      RETURNING id`,
    [id, JSON.stringify(a.before), JSON.stringify(a.after), a.costUsd],
  );
  return rows.length > 0;
}

export async function markEnded(
  q: Query,
  id: string,
  status: 'blocked' | 'failed' | 'paused_at_cap' | 'paused_at_ceiling',
  note: string,
  costUsd: number,
): Promise<void> {
  await q(
    `UPDATE revisions.requests SET status = $2, note = $3, spend_usd = spend_usd + $4, finished_at = now() WHERE id = $1`,
    [id, status, note, costUsd],
  );
}

/** applied -> undone. Returns false (and changes nothing) when the row is not `applied`. */
export async function markUndone(q: Query, id: string, by: string): Promise<boolean> {
  const { rows } = await q(
    `UPDATE revisions.requests SET status = 'undone', undone_at = now(), undone_by = $2 WHERE id = $1 AND status = 'applied' RETURNING id`,
    [id, by],
  );
  return rows.length > 0;
}

/** Puts back an undo whose restore failed: undone -> applied. */
export async function unmarkUndone(q: Query, id: string): Promise<boolean> {
  const { rows } = await q(
    `UPDATE revisions.requests SET status = 'applied', undone_at = NULL, undone_by = NULL WHERE id = $1 AND status = 'undone' RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

/** The item's newest rows first, at most `limit` (the post view's revision box polls this; a plain read). */
export async function recentForItem(q: Query, itemId: string, limit = 50): Promise<RevisionRow[]> {
  const { rows } = await q(`SELECT * FROM revisions.requests WHERE item_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`, [itemId, limit]);
  return rows.map(toRow);
}

export async function listForItem(q: Query, itemId: string): Promise<RevisionRow[]> {
  const { rows } = await q(`SELECT * FROM revisions.requests WHERE item_id = $1 ORDER BY created_at, id`, [itemId]);
  return rows.map(toRow);
}

const partMatch = `part->>'kind' = $2 AND part->>'key' = $3`;

export async function latestApplied(q: Query, itemId: string, part: PartRef): Promise<RevisionRow | null> {
  const { rows } = await q(
    `SELECT * FROM revisions.requests WHERE item_id = $1 AND ${partMatch} AND status = 'applied'
      ORDER BY finished_at DESC, created_at DESC, id DESC LIMIT 1`,
    [itemId, part.kind, part.key],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * The part as the pipeline made it: the `before` of the earliest row that ever applied for it.
 * Undone rows count, since undoing a revision does not change what the original was.
 */
export async function originalOf(q: Query, itemId: string, part: PartRef): Promise<PartState | null> {
  const { rows } = await q(
    `SELECT before FROM revisions.requests WHERE item_id = $1 AND ${partMatch} AND status IN ('applied', 'undone') AND before IS NOT NULL
      ORDER BY finished_at ASC, created_at ASC, id ASC LIMIT 1`,
    [itemId, part.kind, part.key],
  );
  return rows[0]?.before ?? null;
}

/**
 * A paused row (at its cap or its ceiling) goes back to `requested` with a raised override,
 * so the worker re-runs it from the start. spend_usd keeps what earlier attempts spent.
 */
export async function requeueWithOverride(q: Query, id: string, overrideUsd: number, note: string): Promise<boolean> {
  const { rows } = await q(
    `UPDATE revisions.requests
        SET status = 'requested', override_usd = $2, note = $3, finished_at = NULL
      WHERE id = $1 AND status IN ('paused_at_cap', 'paused_at_ceiling')
      RETURNING id`,
    [id, overrideUsd, note],
  );
  return rows.length > 0;
}

export async function setOverride(q: Query, id: string, overrideUsd: number): Promise<void> {
  await q(`UPDATE revisions.requests SET override_usd = $2 WHERE id = $1`, [id, overrideUsd]);
}

export async function getRequest(q: Query, id: string): Promise<RevisionRow | null> {
  const { rows } = await q(`SELECT * FROM revisions.requests WHERE id = $1`, [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

/** Logs what the interpreter decided on a claimed row (the engine sets the caps when it runs). */
export async function setInterpretation(q: Query, id: string, interpretation: Interpretation): Promise<void> {
  await q(
    `UPDATE revisions.requests SET interpretation = $2::jsonb, part = $3::jsonb, fix_kind = $4, stage_tag = $5 WHERE id = $1`,
    [id, JSON.stringify(interpretation), JSON.stringify(interpretation.part), interpretation.fixKind, interpretation.stageTag],
  );
}

/** Adds a cost that was spent outside the engine's meter (the interpreter's call). */
export async function addSpend(q: Query, id: string, usd: number): Promise<void> {
  if (!(usd > 0)) return;
  await q(`UPDATE revisions.requests SET spend_usd = spend_usd + $2 WHERE id = $1`, [id, usd]);
}
