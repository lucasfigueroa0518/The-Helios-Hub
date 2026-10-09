/**
 * The lifecycle spine (db/social_hub_schema.sql, D36): the identity and the
 * approval every content type shares. Each type keeps its own content tables
 * and its own rules; these two writes are the same for all of them.
 */
export type SpineQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export type SpineVertical = 'carousels' | 'explainers' | 'reels' | 'stories';
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
  },
): Promise<{ id: string; publishAt: string }> {
  const { rows } = await query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, idea_ref, ny_date, slot, publish_at, status, source, approved_at)
     VALUES ($1, $2, $3, $4::date, $5, $6::timestamptz, 'scheduled', $7, CASE WHEN $8::boolean THEN now() END) RETURNING id, publish_at`,
    [slot.itemId, slot.vertical, slot.ideaRef ?? null, slot.nyDate, slot.slot, slot.publishAt.toISOString(), slot.source, slot.approved === true],
  );
  return { id: rows[0].id as string, publishAt: new Date(rows[0].publish_at).toISOString() };
}
