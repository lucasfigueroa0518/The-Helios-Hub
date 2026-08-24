'use server';

import { dbQuery } from '@/lib/db';
import { assertBoardAccess } from '@/lib/trello/access';
import { requireTrelloSession } from '@/lib/trello/session';

import { addWorkspaceMember } from '@/app/trello/actions/workspaceMembers';

export type ShareBoardArgs = {
  boardId: string;
  userId: string;
};

export type ShareBoardResult = {
  userId: string;
  workspaceId: string;
  alreadyMember: boolean;
};

/** Share a board by adding an existing Hub user to its workspace. */
export async function shareBoard(args: ShareBoardArgs): Promise<ShareBoardResult> {
  const session = await requireTrelloSession();
  await assertBoardAccess(session.userId, args.boardId);

  const userId = args.userId.trim();
  if (!userId) throw new Error('Pick someone to share with.');
  if (userId === session.userId) throw new Error("You already have this board.");

  const board = await dbQuery<{ workspace_id: string }>(
    'SELECT workspace_id FROM boards.boards WHERE id = $1 LIMIT 1',
    [args.boardId],
  );
  if (!board.rows[0]) throw new Error('Board not found.');

  const result = await addWorkspaceMember(board.rows[0].workspace_id, userId);
  return {
    userId,
    workspaceId: board.rows[0].workspace_id,
    alreadyMember: result.alreadyMember,
  };
}
