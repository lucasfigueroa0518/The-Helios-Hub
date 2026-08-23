'use server';

import { dbQuery } from '@/lib/db';
import { assertBoardAccess } from '@/lib/trello/access';
import { requireTrelloSession } from '@/lib/trello/session';

export async function toggleFavoriteBoard(_userId: string, boardId: string) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, boardId);
  const existing = await dbQuery<{ id: string }>(
    'SELECT id FROM boards.favorite_boards WHERE user_id = $1 AND board_id = $2',
    [session.userId, boardId],
  );
  if (existing.rows[0]) {
    await dbQuery('DELETE FROM boards.favorite_boards WHERE id = $1', [existing.rows[0].id]);
  } else {
    await dbQuery(
      `INSERT INTO boards.favorite_boards (user_id, board_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, board_id) DO NOTHING`,
      [session.userId, boardId],
    );
  }
}
