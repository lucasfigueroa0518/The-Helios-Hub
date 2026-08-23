'use server';

import { dbQuery, dbTransaction } from '@/lib/db';
import { workspaceRole } from '@/lib/trello/access';
import { requireTrelloSession } from '@/lib/trello/session';

/**
 * Remove a person's Trello workspaces/memberships/profile.
 * Never deletes outreach.users — that would break Outreach campaigns.
 */
export async function deleteUser(userId: string): Promise<void> {
  const session = await requireTrelloSession();
  if (userId === session.userId) {
    throw new Error("You can't delete your own account here — sign out first if you want to leave.");
  }

  const workspaces = await dbQuery<{ id: string }>(
    'SELECT id FROM boards.workspaces WHERE owner_id = $1',
    [session.userId],
  );
  const canDelete = await Promise.all(
    workspaces.rows.map((w) => workspaceRole(w.id, session.userId)),
  );
  if (!canDelete.some((role) => role === 'owner')) {
    throw new Error('Only workspace owners can delete user accounts.');
  }

  await dbTransaction(async (client) => {
    await client.query('DELETE FROM boards.workspaces WHERE owner_id = $1', [userId]);
    await client.query('DELETE FROM boards.workspace_members WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM boards.board_members WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM boards.card_members WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM boards.card_trackers WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM boards.favorite_boards WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM boards.notification_reads WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM boards.user_profiles WHERE user_id = $1', [userId]);
  });
}
