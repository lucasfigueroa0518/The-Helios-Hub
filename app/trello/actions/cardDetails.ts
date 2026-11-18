'use server';

import { dbQuery } from '@/lib/db';
import { assertBoardAccess } from '@/lib/trello/access';
import { activityEntry, iso, type ActivityRow, type CardDetails, type FeedRow, type WeekStatsRows } from '@/lib/trello/card-details';
import { requireTrelloSession } from '@/lib/trello/session';
import type { Checklist, ChecklistItem } from '@/lib/trello/types';

/**
 * Cards the user can see: on a board in one of their workspaces, or on a board
 * shared with them (the same rule as loadWorkspace and assertBoardAccess).
 * `$1` is the user id; `$2` the lower-cased search text ('' for none), matched
 * like the views' filter (title and description).
 */
const VISIBLE_CARDS = `
  SELECT c.id
    FROM boards.cards c
    JOIN boards.boards b ON b.id = c.board_id
   WHERE (
           EXISTS (SELECT 1 FROM boards.workspace_members wm WHERE wm.workspace_id = b.workspace_id AND wm.user_id = $1)
        OR EXISTS (SELECT 1 FROM boards.board_members bm WHERE bm.board_id = b.id AND bm.user_id = $1)
         )
     AND ($2 = '' OR strpos(lower(c.title || ' ' || coalesce(c.description, '')), $2) > 0)`;

/** One card's checklists, attachments, comments and activity, in the order the card view shows them. */
export async function loadCardDetails(cardId: string): Promise<CardDetails> {
  const session = await requireTrelloSession();
  const card = await dbQuery<{ board_id: string }>('SELECT board_id FROM boards.cards WHERE id = $1 LIMIT 1', [cardId]);
  if (!card.rows[0]) return { checklists: [], attachments: [], comments: [], activity: [] };
  await assertBoardAccess(session.userId, card.rows[0].board_id);

  const [checklists, items, comments, attachments, activity] = await Promise.all([
    dbQuery<{ id: string; title: string }>('SELECT id, title FROM boards.checklists WHERE card_id = $1 ORDER BY position', [cardId]),
    dbQuery<{ id: string; checklist_id: string; text: string; completed: boolean; due_date: Date | null }>(
      `SELECT i.id, i.checklist_id, i.text, i.completed, i.due_date
         FROM boards.checklist_items i
         JOIN boards.checklists cl ON cl.id = i.checklist_id
        WHERE cl.card_id = $1
        ORDER BY i.position`,
      [cardId],
    ),
    dbQuery<{ id: string; user_id: string; body: string; created_at: Date }>(
      'SELECT id, user_id, body, created_at FROM boards.comments WHERE card_id = $1 AND deleted_at IS NULL ORDER BY created_at',
      [cardId],
    ),
    dbQuery<{ id: string; file_name: string; mime_type: string; file_url: string; created_at: Date }>(
      'SELECT id, file_name, mime_type, file_url, created_at FROM boards.attachments WHERE card_id = $1 ORDER BY created_at',
      [cardId],
    ),
    dbQuery<ActivityRow>('SELECT id, user_id, action_type, data, created_at FROM boards.activity WHERE card_id = $1 ORDER BY created_at DESC', [cardId]),
  ]);

  const itemsByChecklist = new Map<string, ChecklistItem[]>();
  for (const it of items.rows) {
    const bucket = itemsByChecklist.get(it.checklist_id) ?? [];
    bucket.push({ id: it.id, text: it.text, done: it.completed, due: it.due_date ? iso(it.due_date) : null });
    itemsByChecklist.set(it.checklist_id, bucket);
  }
  return {
    checklists: checklists.rows.map((cl): Checklist => ({ id: cl.id, title: cl.title, items: itemsByChecklist.get(cl.id) ?? [] })),
    attachments: attachments.rows.map((at) => ({ id: at.id, name: at.file_name, mime: at.mime_type, url: at.file_url, addedAt: iso(at.created_at) })),
    comments: comments.rows.map((cm) => ({ id: cm.id, authorId: cm.user_id, body: cm.body, at: iso(cm.created_at) })),
    activity: activity.rows.map(activityEntry),
  };
}

/**
 * The newest activity events and comments across the cards the user can see
 * (the Activity view, and the Profile's recent list with `authorId`).
 */
export async function loadActivityFeed(opts: { query?: string; authorId?: string | null; limit: number }): Promise<FeedRow[]> {
  const session = await requireTrelloSession();
  const limit = Math.max(1, Math.min(500, Math.floor(opts.limit)));
  const query = (opts.query ?? '').trim().toLowerCase();
  const { rows } = await dbQuery<ActivityRow & { card_id: string; src: 'a' | 'c'; body: string | null }>(
    `WITH vis AS (${VISIBLE_CARDS})
     SELECT * FROM (
       (SELECT 'a' AS src, a.id, a.user_id, a.card_id, a.action_type, a.data, NULL::text AS body, a.created_at
          FROM boards.activity a
         WHERE a.card_id IN (SELECT id FROM vis) AND ($3::uuid IS NULL OR a.user_id = $3::uuid)
         ORDER BY a.created_at DESC LIMIT $4)
       UNION ALL
       (SELECT 'c' AS src, m.id, m.user_id, m.card_id, NULL, NULL, m.body, m.created_at
          FROM boards.comments m
         WHERE m.deleted_at IS NULL AND m.card_id IN (SELECT id FROM vis) AND ($3::uuid IS NULL OR m.user_id = $3::uuid)
         ORDER BY m.created_at DESC LIMIT $4)
     ) feed
     ORDER BY created_at DESC
     LIMIT $4`,
    [session.userId, query, opts.authorId ?? null, limit],
  );
  return rows.map((r): FeedRow => {
    if (r.src === 'c') return { id: `${r.card_id}:${r.id}`, authorId: r.user_id, kind: 'commented', detail: r.body ?? '', at: iso(r.created_at), cardId: r.card_id };
    const a = activityEntry(r);
    return { id: `${r.card_id}:${a.id}`, authorId: a.authorId, kind: a.kind, detail: a.detail, at: a.at, cardId: r.card_id };
  });
}

/** What the Profile's week tiles need beyond the board: the user's recent comments and first "checked" per card. */
export async function loadMyWeekStats(): Promise<WeekStatsRows> {
  const session = await requireTrelloSession();
  const params = [session.userId, ''];
  const [comments, checked] = await Promise.all([
    dbQuery<{ id: string; card_id: string; created_at: Date }>(
      `WITH vis AS (${VISIBLE_CARDS})
       SELECT m.id, m.card_id, m.created_at FROM boards.comments m
        WHERE m.user_id = $1 AND m.deleted_at IS NULL AND m.created_at > now() - interval '8 days'
          AND m.card_id IN (SELECT id FROM vis)`,
      params,
    ),
    dbQuery<{ id: string; card_id: string; created_at: Date }>(
      `WITH vis AS (${VISIBLE_CARDS})
       SELECT DISTINCT ON (a.card_id) a.id, a.card_id, a.created_at FROM boards.activity a
        WHERE a.user_id = $1 AND a.action_type = 'checked' AND a.card_id IN (SELECT id FROM vis)
        ORDER BY a.card_id, a.created_at ASC`,
      params,
    ),
  ]);
  return {
    recentComments: comments.rows.map((r) => ({ id: r.id, cardId: r.card_id, at: iso(r.created_at) })),
    firstChecked: checked.rows.map((r) => ({ id: r.id, cardId: r.card_id, at: iso(r.created_at) })),
  };
}
