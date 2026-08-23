'use server';

import { dbQuery, dbTransaction } from '@/lib/db';
import { assertBoardAccess } from '@/lib/trello/access';
import { requireTrelloSession } from '@/lib/trello/session';

const POS_STEP = 1024;

export type ToggleActorMeta = {
  actorId: string;
  activityId: string;
};

async function boardIdForCard(cardId: string): Promise<string> {
  const { rows } = await dbQuery<{ board_id: string }>(
    'SELECT board_id FROM boards.cards WHERE id = $1 LIMIT 1',
    [cardId],
  );
  if (!rows[0]) throw new Error('Card not found.');
  return rows[0].board_id;
}

export async function toggleCardMember(cardId: string, userId: string, meta?: ToggleActorMeta) {
  const session = await requireTrelloSession();
  const boardId = await boardIdForCard(cardId);
  await assertBoardAccess(session.userId, boardId);

  await dbTransaction(async (client) => {
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM boards.card_members WHERE card_id = $1 AND user_id = $2',
      [cardId, userId],
    );
    const wasAssigned = Boolean(existing.rows[0]);
    if (existing.rows[0]) {
      await client.query('DELETE FROM boards.card_members WHERE id = $1', [existing.rows[0].id]);
    } else {
      await client.query(
        'INSERT INTO boards.card_members (card_id, user_id) VALUES ($1, $2) ON CONFLICT (card_id, user_id) DO NOTHING',
        [cardId, userId],
      );
    }
    if (meta) {
      await client.query(
        `INSERT INTO boards.activity (id, user_id, card_id, board_id, action_type, data)
         VALUES ($1, $2, $3, $4, 'assigned', $5::jsonb)`,
        [
          meta.activityId,
          session.userId,
          cardId,
          boardId,
          JSON.stringify({ detail: wasAssigned ? 'removed an assignee' : 'added an assignee' }),
        ],
      );
    }
  });
}

export async function toggleCardTracker(cardId: string, userId: string) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, await boardIdForCard(cardId));
  const existing = await dbQuery<{ id: string }>(
    'SELECT id FROM boards.card_trackers WHERE card_id = $1 AND user_id = $2',
    [cardId, userId],
  );
  if (existing.rows[0]) {
    await dbQuery('DELETE FROM boards.card_trackers WHERE id = $1', [existing.rows[0].id]);
  } else {
    await dbQuery(
      'INSERT INTO boards.card_trackers (card_id, user_id) VALUES ($1, $2) ON CONFLICT (card_id, user_id) DO NOTHING',
      [cardId, userId],
    );
  }
}

export async function toggleCardLabel(cardId: string, labelId: string, meta?: ToggleActorMeta) {
  const session = await requireTrelloSession();
  const boardId = await boardIdForCard(cardId);
  await assertBoardAccess(session.userId, boardId);
  await dbTransaction(async (client) => {
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM boards.card_labels WHERE card_id = $1 AND label_id = $2',
      [cardId, labelId],
    );
    const hadLabel = Boolean(existing.rows[0]);
    if (existing.rows[0]) {
      await client.query('DELETE FROM boards.card_labels WHERE id = $1', [existing.rows[0].id]);
    } else {
      await client.query(
        'INSERT INTO boards.card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT (card_id, label_id) DO NOTHING',
        [cardId, labelId],
      );
    }
    if (meta) {
      await client.query(
        `INSERT INTO boards.activity (id, user_id, card_id, board_id, action_type, data)
         VALUES ($1, $2, $3, $4, 'labeled', $5::jsonb)`,
        [
          meta.activityId,
          session.userId,
          cardId,
          boardId,
          JSON.stringify({ detail: hadLabel ? 'removed a label' : 'added a label' }),
        ],
      );
    }
  });
}

export async function createChecklist(id: string, cardId: string, title: string) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, await boardIdForCard(cardId));
  const max = await dbQuery<{ max: number | null }>(
    'SELECT MAX(position) AS max FROM boards.checklists WHERE card_id = $1',
    [cardId],
  );
  await dbQuery(
    'INSERT INTO boards.checklists (id, card_id, title, position) VALUES ($1, $2, $3, $4)',
    [id, cardId, title, (max.rows[0]?.max ?? 0) + POS_STEP],
  );
}

export async function createChecklistItem(id: string, checklistId: string, text: string) {
  const session = await requireTrelloSession();
  const card = await dbQuery<{ card_id: string }>(
    'SELECT card_id FROM boards.checklists WHERE id = $1 LIMIT 1',
    [checklistId],
  );
  if (!card.rows[0]) throw new Error('Checklist not found.');
  await assertBoardAccess(session.userId, await boardIdForCard(card.rows[0].card_id));
  const max = await dbQuery<{ max: number | null }>(
    'SELECT MAX(position) AS max FROM boards.checklist_items WHERE checklist_id = $1',
    [checklistId],
  );
  await dbQuery(
    'INSERT INTO boards.checklist_items (id, checklist_id, text, position) VALUES ($1, $2, $3, $4)',
    [id, checklistId, text, (max.rows[0]?.max ?? 0) + POS_STEP],
  );
}

export async function toggleChecklistItem(itemId: string, meta?: ToggleActorMeta) {
  const session = await requireTrelloSession();
  const lookup = await dbQuery<{ card_id: string; board_id: string; completed: boolean; checklist_id: string }>(
    `SELECT i.completed, i.checklist_id, c.card_id, cards.board_id
       FROM boards.checklist_items i
       JOIN boards.checklists c ON c.id = i.checklist_id
       JOIN boards.cards cards ON cards.id = c.card_id
      WHERE i.id = $1`,
    [itemId],
  );
  if (!lookup.rows[0]) return;
  await assertBoardAccess(session.userId, lookup.rows[0].board_id);
  await dbTransaction(async (client) => {
    const current = await client.query<{ completed: boolean; checklist_id: string }>(
      'SELECT completed, checklist_id FROM boards.checklist_items WHERE id = $1',
      [itemId],
    );
    if (!current.rows[0]) return;
    const chk = { rows: [{ card_id: lookup.rows[0].card_id }] };
    const board = { rows: [{ board_id: lookup.rows[0].board_id }] };
    const nowCompleted = !current.rows[0].completed;
    await client.query('UPDATE boards.checklist_items SET completed = $2 WHERE id = $1', [
      itemId,
      nowCompleted,
    ]);
    if (meta) {
      await client.query(
        `INSERT INTO boards.activity (id, user_id, card_id, board_id, action_type, data)
         VALUES ($1, $2, $3, $4, 'checked', $5::jsonb)`,
        [
          meta.activityId,
          session.userId,
          chk.rows[0].card_id,
          board.rows[0].board_id,
          JSON.stringify({
            detail: nowCompleted ? 'checked off a checklist item' : 'unchecked a checklist item',
          }),
        ],
      );
    }
  });
}

export async function deleteChecklistItem(itemId: string) {
  const session = await requireTrelloSession();
  const row = await dbQuery<{ card_id: string }>(
    `SELECT c.card_id
       FROM boards.checklist_items i
       JOIN boards.checklists c ON c.id = i.checklist_id
      WHERE i.id = $1`,
    [itemId],
  );
  if (!row.rows[0]) return;
  await assertBoardAccess(session.userId, await boardIdForCard(row.rows[0].card_id));
  await dbQuery('DELETE FROM boards.checklist_items WHERE id = $1', [itemId]);
}

export async function createComment(
  id: string,
  cardId: string,
  _userId: string,
  body: string,
  activityId: string,
) {
  const session = await requireTrelloSession();
  const boardId = await boardIdForCard(cardId);
  await assertBoardAccess(session.userId, boardId);
  await dbTransaction(async (client) => {
    await client.query(
      'INSERT INTO boards.comments (id, card_id, user_id, body) VALUES ($1, $2, $3, $4)',
      [id, cardId, session.userId, body],
    );
    await client.query(
      `INSERT INTO boards.activity (id, user_id, card_id, board_id, action_type, data)
       VALUES ($1, $2, $3, $4, 'commented', $5::jsonb)`,
      [activityId, session.userId, cardId, boardId, JSON.stringify({ detail: `commented: ${body.slice(0, 120)}` })],
    );
  });
}
