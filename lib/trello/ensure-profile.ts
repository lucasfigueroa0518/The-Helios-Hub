import { dbQuery, dbTransaction } from '@/lib/db';
import { displayNameFromEmail } from '@/lib/login-policy';
import { slugify } from '@/lib/trello/session';

function splitDisplayName(displayName: string, email: string): { first: string; last: string } {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { first: parts[0], last: parts.slice(1).join(' ') };
  }
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: displayNameFromEmail(email).split(' ')[0] || 'User', last: '' };
}

/** Create a Trello profile + personal workspace on first visit. Never auto-joins other workspaces. */
export async function ensureTrelloProfile(userId: string, email: string): Promise<void> {
  const existing = await dbQuery<{ id: string }>(
    'SELECT id FROM boards.user_profiles WHERE user_id = $1 LIMIT 1',
    [userId],
  );
  if (existing.rows[0]) return;

  const user = await dbQuery<{ display_name: string }>(
    'SELECT display_name FROM outreach.users WHERE id = $1 LIMIT 1',
    [userId],
  );
  const { first, last } = splitDisplayName(user.rows[0]?.display_name ?? '', email);
  const workspaceName = `${first}'s Workspace`;

  await dbTransaction(async (client) => {
    await client.query(
      `INSERT INTO boards.user_profiles (user_id, first_name, last_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, first, last],
    );

    const owned = await client.query<{ id: string }>(
      'SELECT id FROM boards.workspaces WHERE owner_id = $1 LIMIT 1',
      [userId],
    );
    if (owned.rows[0]) return;

    const workspace = await client.query<{ id: string }>(
      `INSERT INTO boards.workspaces (name, slug, owner_id, description, visibility)
       VALUES ($1, $2, $3, '', 'private')
       RETURNING id`,
      [workspaceName, slugify(workspaceName, userId), userId],
    );
    await client.query(
      `INSERT INTO boards.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [workspace.rows[0].id, userId],
    );
  });
}
