'use server';

import { dbQuery, dbTransaction } from '@/lib/db';
import { workspaceRole } from '@/lib/trello/access';
import { requireTrelloSession, slugify } from '@/lib/trello/session';

export type CreateWorkspaceArgs = {
  name: string;
  description?: string;
};

export type CreatedWorkspace = {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  description: string;
  accent: string;
  createdAt: string;
};

async function assertOwnerOrAdmin(workspaceId: string, userId: string) {
  const role = await workspaceRole(workspaceId, userId);
  if (!role) throw new Error("You don't have access to this workspace.");
  if (role !== 'owner' && role !== 'admin') {
    throw new Error('Only owners and admins can change workspace settings.');
  }
  return role;
}

export async function renameWorkspace(id: string, name: string): Promise<void> {
  const session = await requireTrelloSession();
  await assertOwnerOrAdmin(id, session.userId);
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Workspace name is required.');
  await dbQuery('UPDATE boards.workspaces SET name = $2 WHERE id = $1', [id, trimmed]);
}

export async function setWorkspaceAccent(id: string, accent: string): Promise<void> {
  const session = await requireTrelloSession();
  await assertOwnerOrAdmin(id, session.userId);
  if (!/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(accent)) {
    throw new Error('Invalid color.');
  }
  await dbQuery('UPDATE boards.workspaces SET accent = $2 WHERE id = $1', [id, accent]);
}

export async function deleteWorkspace(id: string): Promise<void> {
  const session = await requireTrelloSession();
  const role = await workspaceRole(id, session.userId);
  if (!role) throw new Error("You don't have access to this workspace.");
  if (role !== 'owner') throw new Error('Only the owner can delete this workspace.');

  const owned = await dbQuery<{ n: number }>(
    'SELECT count(*)::int AS n FROM boards.workspaces WHERE owner_id = $1',
    [session.userId],
  );
  if (Number(owned.rows[0]?.n ?? 0) <= 1) {
    throw new Error('This is your only workspace. Create another before deleting it.');
  }
  await dbQuery('DELETE FROM boards.workspaces WHERE id = $1', [id]);
}

export async function createWorkspace(args: CreateWorkspaceArgs): Promise<CreatedWorkspace> {
  const session = await requireTrelloSession();
  const name = args.name.trim();
  const description = (args.description ?? '').trim();
  if (!name) throw new Error('Workspace name is required.');

  return dbTransaction(async (client) => {
    const inserted = await client.query<{
      id: string;
      name: string;
      slug: string;
      owner_id: string;
      description: string | null;
      accent: string;
      created_at: Date;
    }>(
      `INSERT INTO boards.workspaces (name, slug, owner_id, description, visibility)
       VALUES ($1, $2, $3, $4, 'private')
       RETURNING id, name, slug, owner_id, description, accent, created_at`,
      [name, slugify(name, session.userId), session.userId, description],
    );
    const workspace = inserted.rows[0];
    await client.query(
      `INSERT INTO boards.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [workspace.id, session.userId],
    );
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      ownerId: workspace.owner_id,
      description: workspace.description ?? '',
      accent: workspace.accent,
      createdAt: workspace.created_at.toISOString(),
    };
  });
}
