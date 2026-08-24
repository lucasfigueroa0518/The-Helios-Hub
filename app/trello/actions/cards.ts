'use server';

import { dbQuery, dbTransaction } from '@/lib/db';
import { assertBoardAccess } from '@/lib/trello/access';
import { requireTrelloSession } from '@/lib/trello/session';

const POS_STEP = 1024;

async function boardIdForCard(cardId: string): Promise<string> {
  const { rows } = await dbQuery<{ board_id: string }>(
    'SELECT board_id FROM boards.cards WHERE id = $1 LIMIT 1',
    [cardId],
  );
  if (!rows[0]) throw new Error('Card not found.');
  return rows[0].board_id;
}

export type CreateCardArgs = {
  id: string;
  boardId: string;
  listId: string;
  title: string;
  createdBy: string;
  activityId: string;
};

export async function createCard(args: CreateCardArgs) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, args.boardId);
  const max = await dbQuery<{ max: number | null }>(
    'SELECT MAX(position) AS max FROM boards.cards WHERE list_id = $1',
    [args.listId],
  );
  await dbTransaction(async (client) => {
    await client.query(
      `INSERT INTO boards.cards (id, board_id, list_id, title, position, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [args.id, args.boardId, args.listId, args.title, (max.rows[0]?.max ?? 0) + POS_STEP, session.userId],
    );
    await client.query(
      `INSERT INTO boards.card_members (card_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (card_id, user_id) DO NOTHING`,
      [args.id, session.userId],
    );
    await client.query(
      `INSERT INTO boards.activity (id, user_id, card_id, board_id, action_type, data)
       VALUES ($1, $2, $3, $4, 'created', $5::jsonb)`,
      [args.activityId, session.userId, args.id, args.boardId, JSON.stringify({ detail: 'created this card' })],
    );
  });
}

export type UpdateCardPatch = {
  title?: string;
  description?: string | null;
  due?: string | null;
};

export type UpdateCardMeta = {
  actorId: string;
  dueActivityId?: string;
};

export async function updateCard(id: string, patch: UpdateCardPatch, meta?: UpdateCardMeta) {
  const session = await requireTrelloSession();
  const boardId = await boardIdForCard(id);
  await assertBoardAccess(session.userId, boardId);

  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [];
  if (patch.title !== undefined) {
    params.push(patch.title);
    sets.push(`title = $${params.length}`);
  }
  if (patch.description !== undefined) {
    params.push(patch.description);
    sets.push(`description = $${params.length}`);
  }
  if (patch.due !== undefined) {
    params.push(patch.due);
    sets.push(`due_date = $${params.length}`);
  }
  params.push(id);

  await dbTransaction(async (client) => {
    await client.query(`UPDATE boards.cards SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    if (patch.due !== undefined && meta?.dueActivityId) {
      await client.query(
        `INSERT INTO boards.activity (id, user_id, card_id, board_id, action_type, data)
         VALUES ($1, $2, $3, $4, 'due_changed', $5::jsonb)`,
        [
          meta.dueActivityId,
          session.userId,
          id,
          boardId,
          JSON.stringify({
            detail: patch.due ? `set due date to ${patch.due}` : 'cleared the due date',
          }),
        ],
      );
    }
  });
}

export async function setCardComplete(id: string, complete: boolean) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, await boardIdForCard(id));
  await dbQuery(
    'UPDATE boards.cards SET due_completed = $2, updated_at = now() WHERE id = $1',
    [id, complete],
  );
}

export type MoveCardMeta = {
  actorId: string;
  activityId: string;
  fromListId: string;
};

export async function moveCard(
  cardId: string,
  toListId: string,
  toIndex: number,
  meta?: MoveCardMeta,
) {
  const session = await requireTrelloSession();
  const boardId = await boardIdForCard(cardId);
  await assertBoardAccess(session.userId, boardId);

  const target = await dbQuery<{ id: string; position: number }>(
    'SELECT id, position FROM boards.cards WHERE list_id = $1 ORDER BY position',
    [toListId],
  );
  const neighbors = target.rows.filter((c) => c.id !== cardId);
  const before = neighbors[toIndex - 1]?.position;
  const after = neighbors[toIndex]?.position;
  let newPos: number;
  if (before == null && after == null) newPos = POS_STEP;
  else if (before == null) newPos = after! - POS_STEP;
  else if (after == null) newPos = before + POS_STEP;
  else newPos = (before + after) / 2;

  await dbTransaction(async (client) => {
    await client.query(
      'UPDATE boards.cards SET list_id = $2, position = $3, updated_at = now() WHERE id = $1',
      [cardId, toListId, newPos],
    );
    if (meta && meta.fromListId !== toListId) {
      await client.query(
        `INSERT INTO boards.activity (id, user_id, card_id, board_id, action_type, data)
         VALUES ($1, $2, $3, $4, 'moved', $5::jsonb)`,
        [
          meta.activityId,
          session.userId,
          cardId,
          boardId,
          JSON.stringify({ detail: 'moved this card to a different list' }),
        ],
      );
    }
  });
}

export type CopyCardArgs = {
  newId: string;
  srcId: string;
  createdBy: string;
  activityId: string;
};

export async function copyCard(args: CopyCardArgs) {
  const session = await requireTrelloSession();
  const src = await dbQuery<{
    board_id: string;
    list_id: string;
    title: string;
    description: string | null;
    position: number;
    due_date: Date | string | null;
  }>(
    'SELECT board_id, list_id, title, description, position, due_date FROM boards.cards WHERE id = $1',
    [args.srcId],
  );
  if (!src.rows[0]) return;
  await assertBoardAccess(session.userId, src.rows[0].board_id);
  const next = await dbQuery<{ position: number }>(
    'SELECT position FROM boards.cards WHERE list_id = $1 AND position > $2 ORDER BY position LIMIT 1',
    [src.rows[0].list_id, src.rows[0].position],
  );
  const newPos = next.rows[0]
    ? (src.rows[0].position + next.rows[0].position) / 2
    : src.rows[0].position + POS_STEP;

  await dbTransaction(async (client) => {
    await client.query(
      `INSERT INTO boards.cards (id, board_id, list_id, title, description, position, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        args.newId,
        src.rows[0].board_id,
        src.rows[0].list_id,
        `${src.rows[0].title} (copy)`,
        src.rows[0].description,
        newPos,
        src.rows[0].due_date,
        session.userId,
      ],
    );
    await client.query(
      `INSERT INTO boards.card_labels (card_id, label_id)
       SELECT $1, label_id FROM boards.card_labels WHERE card_id = $2
       ON CONFLICT (card_id, label_id) DO NOTHING`,
      [args.newId, args.srcId],
    );
    await client.query(
      `INSERT INTO boards.card_members (card_id, user_id)
       SELECT $1, user_id FROM boards.card_members WHERE card_id = $2
       ON CONFLICT (card_id, user_id) DO NOTHING`,
      [args.newId, args.srcId],
    );
    await client.query(
      `INSERT INTO boards.card_members (card_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (card_id, user_id) DO NOTHING`,
      [args.newId, session.userId],
    );
    await client.query(
      `INSERT INTO boards.activity (id, user_id, card_id, board_id, action_type, data)
       VALUES ($1, $2, $3, $4, 'created', $5::jsonb)`,
      [
        args.activityId,
        session.userId,
        args.newId,
        src.rows[0].board_id,
        JSON.stringify({ detail: 'copied from another card' }),
      ],
    );
  });
}

export async function archiveCard(id: string) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, await boardIdForCard(id));
  await dbQuery('DELETE FROM boards.cards WHERE id = $1', [id]);
}
