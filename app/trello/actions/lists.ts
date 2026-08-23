'use server';

import { dbQuery, dbTransaction } from '@/lib/db';
import { assertBoardAccess } from '@/lib/trello/access';
import { requireTrelloSession } from '@/lib/trello/session';

const POS_STEP = 1024;

async function boardIdForList(listId: string): Promise<string> {
  const { rows } = await dbQuery<{ board_id: string }>(
    'SELECT board_id FROM boards.lists WHERE id = $1 LIMIT 1',
    [listId],
  );
  if (!rows[0]) throw new Error('List not found.');
  return rows[0].board_id;
}

export async function createList(id: string, boardId: string, name: string) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, boardId);
  const max = await dbQuery<{ max: number | null }>(
    'SELECT MAX(position) AS max FROM boards.lists WHERE board_id = $1',
    [boardId],
  );
  await dbQuery(
    'INSERT INTO boards.lists (id, board_id, name, position) VALUES ($1, $2, $3, $4)',
    [id, boardId, name, (max.rows[0]?.max ?? 0) + POS_STEP],
  );
}

export async function renameList(id: string, name: string) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, await boardIdForList(id));
  await dbQuery('UPDATE boards.lists SET name = $2 WHERE id = $1', [id, name]);
}

export async function deleteList(id: string) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, await boardIdForList(id));
  await dbQuery('DELETE FROM boards.lists WHERE id = $1', [id]);
}

export async function reorderLists(boardId: string, orderedIds: string[]) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, boardId);
  await dbTransaction(async (client) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query('UPDATE boards.lists SET position = $2 WHERE id = $1', [
        orderedIds[i],
        (i + 1) * POS_STEP,
      ]);
    }
  });
}
