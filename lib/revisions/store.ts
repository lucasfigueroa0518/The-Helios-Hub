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
    refs: r.refs ?? [],
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
  a: { vertical: Vertical; refs: PartRef[]; itemId: string; by: string | null; instruction: string; parentId?: string | null },
): Promise<RevisionRow> {
  const { rows } = await q(
    `INSERT INTO revisions.requests (vertical, item_id, refs, requested_by, instruction, parent_id)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6) RETURNING *`,
    [a.vertical, a.itemId, JSON.stringify(a.refs), a.by, a.instruction, a.parentId ?? null],
  );
  return toRow(rows[0]);
}

/** Oldest `requested` row -> `running`, exactly once (single UPDATE, row-locked, SKIP LOCKED). */
export async function claimNextRequested(q: Query): Promise<RevisionRow | null> {
  const { rows } = await q(
    `UPDATE revisions.requests SET status = 'running', started_at = now()
      WHERE id = (SELECT id FROM revisions.requests WHERE status = 'requested'
                   ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
        AND status = 'requested'
      RETURNING *`,
  );
  return rows[0] ? toRow(rows[0]) : null;
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
): Promise<void> {
  await q(
    `UPDATE revisions.requests
        SET status = 'applied', before = $2::jsonb, after = $3::jsonb,
            spend_usd = spend_usd + $4, finished_at = now()
      WHERE id = $1 AND status = 'running'`,
    [id, JSON.stringify(a.before), JSON.stringify(a.after), a.costUsd],
  );
}

export async function markEnded(
  q: Query,
  id: string,
  status: 'blocked' | 'failed' | 'paused_at_ceiling',
  note: string,
  costUsd: number,
): Promise<void> {
  await q(
    `UPDATE revisions.requests SET status = $2, note = $3, spend_usd = spend_usd + $4, finished_at = now() WHERE id = $1`,
    [id, status, note, costUsd],
  );
}

export async function markUndone(q: Query, id: string, by: string): Promise<void> {
  await q(`UPDATE revisions.requests SET status = 'undone', undone_at = now(), undone_by = $2 WHERE id = $1 AND status = 'applied'`, [id, by]);
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

export async function setOverride(q: Query, id: string, overrideUsd: number): Promise<void> {
  await q(`UPDATE revisions.requests SET override_usd = $2 WHERE id = $1`, [id, overrideUsd]);
}
