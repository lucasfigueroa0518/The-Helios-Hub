'use server';

import { dbQuery, dbTransaction } from '@/lib/db';
import { assertBoardAccess, workspaceRole } from '@/lib/trello/access';
import { DEFAULT_LIST_NAMES } from '@/lib/trello/boardDefaults';
import { requireTrelloSession } from '@/lib/trello/session';

const POS_STEP = 1024;

export async function renameBoard(id: string, name: string) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, id);
  await dbQuery('UPDATE boards.boards SET name = $2, updated_at = now() WHERE id = $1', [id, name]);
}

export async function setBoardAccent(id: string, accent: string) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, id);
  await dbQuery('UPDATE boards.boards SET background = $2, updated_at = now() WHERE id = $1', [id, accent]);
}

export async function setBoardArchived(id: string, archived: boolean) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, id);
  await dbQuery('UPDATE boards.boards SET archived = $2, updated_at = now() WHERE id = $1', [id, archived]);
}

export async function unarchiveBoard(id: string) {
  await setBoardArchived(id, false);
}

export async function deleteBoard(id: string) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, id);
  await dbQuery('DELETE FROM boards.boards WHERE id = $1', [id]);
}

export async function setBoardTheme(id: string, theme: 'light' | 'dark') {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, id);
  await dbQuery('UPDATE boards.boards SET theme = $2, updated_at = now() WHERE id = $1', [id, theme]);
}

export async function setBoardCanvas(id: string, canvas: string | null) {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, id);
  await dbQuery('UPDATE boards.boards SET canvas = $2, updated_at = now() WHERE id = $1', [id, canvas]);
}

export type CreateBoardArgs = {
  id: string;
  workspaceId: string;
  name: string;
  accent: string;
  createdBy: string;
  defaultListIds: [string, string, string];
};

export async function moveBoardToWorkspace(boardId: string, targetWorkspaceId: string) {
  const session = await requireTrelloSession();
  const meId = session.userId;
  const board = await dbQuery<{ workspace_id: string }>(
    'SELECT workspace_id FROM boards.boards WHERE id = $1 LIMIT 1',
    [boardId],
  );
  if (!board.rows[0]) throw new Error('Board not found.');
  if (board.rows[0].workspace_id === targetWorkspaceId) return;

  await assertBoardAccess(meId, boardId);
  const targetRole = await workspaceRole(targetWorkspaceId, meId);
  if (!targetRole) throw new Error("You can't move boards into that workspace.");

  await dbQuery(
    'UPDATE boards.boards SET workspace_id = $2, updated_at = now() WHERE id = $1',
    [boardId, targetWorkspaceId],
  );
}

export async function createBoard(args: CreateBoardArgs) {
  const session = await requireTrelloSession();
  const role = await workspaceRole(args.workspaceId, session.userId);
  if (!role) throw new Error("You don't have access to this workspace.");

  await dbTransaction(async (client) => {
    await client.query(
      `INSERT INTO boards.boards (id, workspace_id, created_by, name, background)
       VALUES ($1, $2, $3, $4, $5)`,
      [args.id, args.workspaceId, session.userId, args.name, args.accent],
    );
    for (let i = 0; i < DEFAULT_LIST_NAMES.length; i++) {
      await client.query(
        `INSERT INTO boards.lists (id, board_id, name, position)
         VALUES ($1, $2, $3, $4)`,
        [args.defaultListIds[i], args.id, DEFAULT_LIST_NAMES[i], (i + 1) * POS_STEP],
      );
    }
  });
}
