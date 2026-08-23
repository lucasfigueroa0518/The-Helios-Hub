'use server';

import { dbQuery } from '@/lib/db';
import { assertBoardAccess } from '@/lib/trello/access';
import { requireTrelloSession } from '@/lib/trello/session';

async function boardIdForLabel(labelId: string): Promise<string> {
  const { rows } = await dbQuery<{ board_id: string }>(
    'SELECT board_id FROM boards.labels WHERE id = $1 LIMIT 1',
    [labelId],
  );
  if (!rows[0]) throw new Error('Label not found.');
  return rows[0].board_id;
}

export async function createLabel(args: {
  id: string;
  boardId: string;
  name: string;
  color: string;
}) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, args.boardId);
  const name = args.name.trim();
  if (!name) throw new Error('Label name is required.');
  await dbQuery(
    'INSERT INTO boards.labels (id, board_id, name, color) VALUES ($1, $2, $3, $4)',
    [args.id, args.boardId, name, args.color],
  );
}

export async function renameLabel(labelId: string, name: string) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, await boardIdForLabel(labelId));
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Label name is required.');
  await dbQuery('UPDATE boards.labels SET name = $2 WHERE id = $1', [labelId, trimmed]);
}

export async function updateLabelColor(labelId: string, color: string) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, await boardIdForLabel(labelId));
  await dbQuery('UPDATE boards.labels SET color = $2 WHERE id = $1', [labelId, color]);
}

export async function deleteLabel(labelId: string) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, await boardIdForLabel(labelId));
  await dbQuery('DELETE FROM boards.labels WHERE id = $1', [labelId]);
}
