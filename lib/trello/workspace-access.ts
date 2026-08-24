import type { User, WorkspaceMember } from '@/lib/trello/types';

/** Shared company workspace every Helios Hub user should belong to. */
export const SHARED_WORKSPACE_NAME = 'Helios Group';

export function isSharedHeliosWorkspace(name: string): boolean {
  return name.trim().toLowerCase() === SHARED_WORKSPACE_NAME.toLowerCase();
}

export function userIdsInWorkspace(
  members: WorkspaceMember[],
  workspaceId: string,
): Set<string> {
  return new Set(
    members.filter((m) => m.workspaceId === workspaceId).map((m) => m.userId),
  );
}

export function usersInWorkspace(
  users: User[],
  members: WorkspaceMember[],
  workspaceId: string,
): User[] {
  const ids = userIdsInWorkspace(members, workspaceId);
  return users.filter((u) => ids.has(u.id));
}

export function usersNotInWorkspace(
  users: User[],
  members: WorkspaceMember[],
  workspaceId: string,
  excludeUserId?: string,
): User[] {
  const ids = userIdsInWorkspace(members, workspaceId);
  return users
    .filter((u) => !ids.has(u.id) && u.id !== excludeUserId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function matchesUserLookup(user: User, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${user.name} ${user.email ?? ''} ${user.firstName} ${user.lastName}`.toLowerCase();
  return hay.includes(q);
}
