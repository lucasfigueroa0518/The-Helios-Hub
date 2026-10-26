/**
 * The lifecycle spine (db/social_hub_schema.sql, D36): the identity and the
 * approval every content type shares. Each type keeps its own content tables
 * and its own rules; these two writes are the same for all of them.
 */
export type SpineQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export type SpineVertical = 'carousels' | 'explainers' | 'reels' | 'stories' | 'last_few_days' | 'ai_events';
export type SpineFormat = 'feed' | 'reel' | 'story';

/** The item's stable id, created the first time any lifecycle step touches the content. */
export async function ensureContentItem(
  query: SpineQuery,
  item: { vertical: SpineVertical; format: SpineFormat; nativeRef: string; ideaRef: string | null },
): Promise<string> {
  const { rows } = await query(
    `INSERT INTO social_hub.content_items (vertical, format, native_ref, idea_ref)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (vertical, native_ref) DO UPDATE SET idea_ref = coalesce(excluded.idea_ref, social_hub.content_items.idea_ref)
     RETURNING id`,
    [item.vertical, item.format, item.nativeRef, item.ideaRef],
  );
  return rows[0].id as string;
}

export type ApprovalVia = 'user' | 'force' | 'auto' | 'setting';

/** Approve an item. An item already approved keeps its first approval time and how it came. */
export async function approveItem(query: SpineQuery, itemId: string, via: ApprovalVia, by: string | null = null): Promise<void> {
  await query(
    `INSERT INTO social_hub.approvals (content_item_id, decision, via, decided_by)
     VALUES ($1, 'approved', $2, $3)
     ON CONFLICT (content_item_id) DO UPDATE SET
       decided_at = CASE WHEN social_hub.approvals.decision = 'approved' THEN social_hub.approvals.decided_at ELSE now() END,
       via = CASE WHEN social_hub.approvals.decision = 'approved' THEN social_hub.approvals.via ELSE excluded.via END,
       decided_by = CASE WHEN social_hub.approvals.decision = 'approved' THEN social_hub.approvals.decided_by ELSE excluded.decided_by END,
       decision = 'approved'`,
    [itemId, via, by],
  );
}

/** Reject an item: it never posts, whatever require_approval says. */
export async function rejectItem(query: SpineQuery, itemId: string, by: string | null = null): Promise<void> {
  await query(
    `INSERT INTO social_hub.approvals (content_item_id, decision, via, decided_by)
     VALUES ($1, 'rejected', 'user', $2)
     ON CONFLICT (content_item_id) DO UPDATE SET decision = 'rejected', via = 'user', decided_by = excluded.decided_by, decided_at = now()`,
    [itemId, by],
  );
}

export const DELETED_NOTE = 'Deleted from the Social Hub.';

/**
 * Delete an item (soft): it leaves the hub's lists and can never post. Its waiting
 * slot is cancelled so the day's quota opens, and it is rejected so no publisher
 * path can pick it up even if a list still shows it. Nothing is removed, so
 * the item, its attempts and its costs stay on record. False when the item is
 * unknown or already live (queued, posting, partly posted or published content can't be deleted).
 */
export async function deleteItem(query: SpineQuery, itemId: string, by: string | null = null): Promise<boolean> {
  const live = await query(
    `SELECT 1 FROM social_hub.schedule WHERE content_item_id = $1 AND status IN ('publishing', 'published')
     UNION ALL SELECT 1 FROM social_hub.publish_attempts WHERE content_item_id = $1 AND status IN ('requested', 'creating', 'processing', 'publishing', 'published', 'partial')
     LIMIT 1`,
    [itemId],
  );
  if (live.rows.length) return false;
  const done = await query(
    `UPDATE social_hub.content_items SET deleted_at = coalesce(deleted_at, now()), deleted_by = coalesce(deleted_by, $2) WHERE id = $1 RETURNING id`,
    [itemId, by],
  );
  if (!done.rows.length) return false;
  await rejectItem(query, itemId, by);
  await query(
    `UPDATE social_hub.schedule SET status = 'cancelled', error = $2 WHERE content_item_id = $1 AND status = 'scheduled'`,
    [itemId, DELETED_NOTE],
  );
  return true;
}

/** Withdraw a decision (a review reopened): the item is undecided again. */
export async function clearDecision(query: SpineQuery, itemId: string): Promise<void> {
  await query(`DELETE FROM social_hub.approvals WHERE content_item_id = $1`, [itemId]);
}

/**
 * Book one slot on the calendar: the insert every type's scheduler and the
 * hub's placement (lib/social-hub/placement.ts) share. A Trial Reels slot
 * belongs to its idea (`ideaRef`) and may have no item yet (D39). The unique
 * indexes refuse a taken window or a second waiting slot (23505); the caller
 * decides what that means.
 */
export async function bookSlot(
  query: SpineQuery,
  slot: {
    vertical: SpineVertical;
    itemId: string | null;
    ideaRef?: string | null;
    nyDate: string;
    slot: string;
    publishAt: Date;
    source: 'auto' | 'user';
    /** Trial Reels only: the slot is approved as it is booked (a person scheduling it, D39). */
    approved?: boolean;
    /** Reels and Explainers: Trial or Main for this slot (weekly slot calendar); null while on the legacy schedule. */
    feedMode?: 'trial' | 'main' | null;
    /** Who set it (schedule.slot_by); only where the column exists (R3). Omitted, the INSERT doesn't name it. */
    slotBy?: 'person' | 'system' | null;
  },
): Promise<{ id: string; publishAt: string }> {
  const { text, params } = bookSlotStatement(slot);
  const { rows } = await query(text, params);
  return { id: rows[0].id as string, publishAt: new Date(rows[0].publish_at).toISOString() };
}

/**
 * bookSlot's INSERT (RETURNING id, publish_at), for a caller that runs it in
 * one statement with other writes (placement.ts: a booking and its calendar slot).
 */
export function bookSlotStatement(slot: Parameters<typeof bookSlot>[1]): { text: string; params: unknown[] } {
  // With no feed mode (or mark) the INSERT is the old one, so a database without the column still books.
  const params: unknown[] = [slot.itemId, slot.vertical, slot.ideaRef ?? null, slot.nyDate, slot.slot, slot.publishAt.toISOString(), slot.source, slot.approved === true];
  const cols = ['content_item_id', 'vertical', 'idea_ref', 'ny_date', 'slot', 'publish_at', 'status', 'source', 'approved_at'];
  const values = ['$1', '$2', '$3', '$4::date', '$5', '$6::timestamptz', `'scheduled'`, '$7', 'CASE WHEN $8::boolean THEN now() END'];
  for (const [col, value] of [['feed_mode', slot.feedMode], ['slot_by', slot.slotBy]] as const) {
    if (!value) continue;
    params.push(value);
    cols.push(col);
    values.push(`$${params.length}`);
  }
  return {
    text: `INSERT INTO social_hub.schedule (${cols.join(', ')})
         VALUES (${values.join(', ')}) RETURNING id, publish_at`,
    params,
  };
}
