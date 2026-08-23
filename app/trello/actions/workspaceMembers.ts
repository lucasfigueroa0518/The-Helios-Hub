'use server';

import { dbQuery, dbTransaction } from '@/lib/db';
import { workspaceRole } from '@/lib/trello/access';
import { requireTrelloSession } from '@/lib/trello/session';
import type { WorkspaceRole } from '@/lib/trello/types';

export async function removeWorkspaceMember(
  workspaceId: string,
  targetUserId: string,
): Promise<void> {
  const session = await requireTrelloSession();
  const meId = session.userId;
  if (meId === targetUserId) throw new Error("You can't remove yourself.");

  const callerRole = await workspaceRole(workspaceId, meId);
  const targetRole = await workspaceRole(workspaceId, targetUserId);
  if (!callerRole) throw new Error("You don't have access to this workspace.");
  if (!targetRole) return;
  if (callerRole !== 'owner' && callerRole !== 'admin') {
    throw new Error('Only owners and admins can remove members.');
  }
  if (callerRole === 'admin' && (targetRole === 'owner' || targetRole === 'admin')) {
    throw new Error('Only the owner can remove admins.');
  }
  if (targetRole === 'owner') {
    const owners = await dbQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM boards.workspace_members
        WHERE workspace_id = $1 AND role = 'owner'`,
      [workspaceId],
    );
    if (Number(owners.rows[0]?.n ?? 0) <= 1) {
      throw new Error('This workspace would be left without an owner. Promote someone else first.');
    }
  }

  await dbTransaction(async (client) => {
    await client.query(
      `DELETE FROM boards.board_members
        WHERE user_id = $2
          AND board_id IN (SELECT id FROM boards.boards WHERE workspace_id = $1)`,
      [workspaceId, targetUserId],
    );
    await client.query(
      'DELETE FROM boards.workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, targetUserId],
    );
  });
}

export async function setWorkspaceMemberRole(
  workspaceId: string,
  targetUserId: string,
  role: WorkspaceRole,
): Promise<void> {
  const session = await requireTrelloSession();
  const meId = session.userId;
  const callerRole = await workspaceRole(workspaceId, meId);
  const targetRole = await workspaceRole(workspaceId, targetUserId);
  if (callerRole !== 'owner') throw new Error('Only the owner can change member roles.');
  if (!targetRole) throw new Error("That user isn't a member of this workspace.");

  if (meId === targetUserId && role !== 'owner') {
    const owners = await dbQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM boards.workspace_members
        WHERE workspace_id = $1 AND role = 'owner'`,
      [workspaceId],
    );
    if (Number(owners.rows[0]?.n ?? 0) <= 1) {
      throw new Error("You're the only owner. Promote someone else before demoting yourself.");
    }
  }

  await dbQuery(
    'UPDATE boards.workspace_members SET role = $3 WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, targetUserId, role],
  );
}
