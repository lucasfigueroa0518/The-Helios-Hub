import { dbQuery } from '@/lib/db';

export async function userCanAccessBoard(userId: string, boardId: string): Promise<boolean> {
  const { rows } = await dbQuery<{ ok: number }>(
    `SELECT 1::int AS ok
       FROM boards.boards b
      WHERE b.id = $1
        AND (
          EXISTS (
            SELECT 1 FROM boards.workspace_members wm
             WHERE wm.workspace_id = b.workspace_id AND wm.user_id = $2
          )
          OR EXISTS (
            SELECT 1 FROM boards.board_members bm
             WHERE bm.board_id = b.id AND bm.user_id = $2
          )
        )
      LIMIT 1`,
    [boardId, userId],
  );
  return Boolean(rows[0]);
}

export async function assertBoardAccess(userId: string, boardId: string): Promise<void> {
  if (!(await userCanAccessBoard(userId, boardId))) {
    throw new Error("You don't have access to this board.");
  }
}

export async function workspaceRole(
  workspaceId: string,
  userId: string,
): Promise<'owner' | 'admin' | 'member' | 'guest' | null> {
  const { rows } = await dbQuery<{ role: 'owner' | 'admin' | 'member' | 'guest' }>(
    `SELECT role FROM boards.workspace_members
      WHERE workspace_id = $1 AND user_id = $2
      LIMIT 1`,
    [workspaceId, userId],
  );
  return rows[0]?.role ?? null;
}
